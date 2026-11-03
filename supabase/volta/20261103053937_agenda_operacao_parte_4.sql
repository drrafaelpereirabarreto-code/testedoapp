-- VOLTA ÚNICA das 4 partes da migração da operação (supabase/migrations/*_agenda_operacao_parte_1 a 4; iMed Agenda,
-- fase 3.3; só se for preciso desfazer). As voltas das partes 1 a 3 não fazem nada. Tem o mesmo nome da última parte:
-- se ela for renomeada, renomeie esta também. Deixa o banco como estava antes da 3.3 (testado no CI, banco.yml: depois
-- desta volta a impressão digital é IGUAL à da produção antes da 3.3, e reaplicada, igual à com ela):
--   - o índice appointment_requests_slot_uq e as restrições antigas de situação, quem cancelou e motivo de soltar a
--     ocupação voltam;
--   - as funções de hoje voltam ao corpo de antes (check_appointment_request, cancel_request e set_request_status da
--     3.1; available_slots, clinics_with_schedule e set_my_schedule da 3.2; admin_stats de 20261030143839_visitas;
--     admin_gestao de 20261030191354_painel_medico), as policies do pedido também;
--   - saem as funções novas da 3.3, os gatilhos adiados (I2), o job imed-agenda-manutencao e a transição nova.
-- ATENÇÃO: com agendamentos do motor novo, reservas ou situações novas gravados, a volta FALHA ao recolocar as
-- restrições (e é o certo: o caminho antigo não sabe tratá-los). Antes de desfazer na produção, confira:
--   select count(*) from public.appointment_requests where uses_resources or status not in
--     ('pending', 'contacted', 'confirmed', 'cancelled', 'completed');   -- tem de ser 0

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. Job, gatilhos adiados e transição nova ===================== */
select cron.unschedule('imed-agenda-manutencao') where exists (select 1 from cron.job where jobname = 'imed-agenda-manutencao');
drop trigger if exists appointment_items_i2 on agenda.appointment_items;
drop trigger if exists occupancy_i2 on agenda.occupancy;
drop trigger if exists appointment_requests_i2 on public.appointment_requests;
delete from agenda.status_transitions where from_status = 'hold' and to_status = 'cancelled' and actor_kind = 'integracao';

/* ===================== 2. Restrições e índice de antes ===================== */
alter table agenda.occupancy drop constraint if exists occupancy_release_reason_check;
alter table agenda.occupancy add constraint occupancy_release_reason_check
  check (release_reason in ('cancelado', 'expirada', 'remarcado', 'bloqueio_forcado', 'removido', 'capacidade', 'corrigido'));
alter table public.appointment_requests drop constraint if exists appointment_requests_cancelled_by_check;
alter table public.appointment_requests add constraint appointment_requests_cancelled_by_check
  check (cancelled_by is null or cancelled_by in ('patient', 'clinic', 'imed'));
alter table public.appointment_requests drop constraint if exists appointment_requests_status_check;
alter table public.appointment_requests add constraint appointment_requests_status_check
  check (status in ('pending', 'contacted', 'confirmed', 'cancelled', 'completed'));
create unique index if not exists appointment_requests_slot_uq
  on public.appointment_requests (clinic_id, coalesce(exam_code, ''), slot_start)
  where slot_start is not null and status <> 'cancelled';

/* ===================== 3. Policies do pedido ===================== */
alter policy "qualquer pessoa pede agendamento" on public.appointment_requests
  with check (consent and status in ('pending', 'confirmed'));
alter policy "clinica ve pedidos para ela" on public.appointment_requests
  using (clinic_id is not null and public.is_clinic_member(clinic_id));
alter policy "admin le pedidos" on public.appointment_requests
  using (public.is_imed_admin());

/* ===================== 4. As funções de hoje como eram ===================== */
create or replace function public.check_appointment_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  local_ts timestamp;
  v_origin text := private.agenda_origin();
begin
  if v_origin is null then
    if new.preferred_date < today or new.preferred_date > today + 120 then
      raise exception 'Data preferida fora do intervalo permitido' using errcode = '22023';
    end if;
    if new.clinic_id is not null and not exists (
      select 1 from public.clinics c
      where c.id = new.clinic_id and c.status = 'published' and c.accepts_online_booking
    ) then
      raise exception 'Esta clínica não recebe pedidos de agendamento pelo site' using errcode = '22023';
    end if;
  end if;
  new := private.agenda_validate_patient(new);
  if v_origin is not null then
    new.created_at := now();
    new.updated_at := now();
    new.version := 1;
    if v_origin = 'sql' then
      -- pedido criado à mão pelo SQL (sem a conferência do horário): exige o motivo e fica registrado (§5)
      perform private.agenda_audit_sql(new.clinic_id, 'pedido_criado_sql', 'appointment_request', new.id::text, null,
        jsonb_build_object('status', new.status, 'slot_start', new.slot_start, 'slot_end', new.slot_end,
                           'clinic_id', new.clinic_id, 'channel', new.channel));
    end if;
    return new;
  end if;
  new.cancelled_at := null;
  new.cancelled_by := null;
  new.status := 'pending';
  if new.slot_start is not null then
    if new.clinic_id is null then
      raise exception 'Horário só pode ser escolhido em clínica parceira com agenda' using errcode = '22023';
    end if;
    if not exists (select 1 from public.available_slots(new.clinic_id, new.exam_code,
                     (new.slot_start at time zone 'America/Sao_Paulo')::date, 1) a where a.slot_start = new.slot_start) then
      raise exception 'Este horário não está mais livre. Escolha outro.' using errcode = '23P01';
    end if;
    local_ts := new.slot_start at time zone 'America/Sao_Paulo';
    new.preferred_date := local_ts::date;
    new.preferred_period := case when local_ts::time < '12:00' then 'manha' when local_ts::time < '18:00' then 'tarde' else 'noite' end;
    new.status := 'confirmed';
  end if;
  new.created_at := now();
  new.user_id := auth.uid();
  -- Colunas novas: sempre o padrão no caminho antigo (o navegador nem tem permissão para gravá-las).
  new.channel := 'imed_app';
  new.slot_end := null;
  new.hold_expires_at := null;
  new.version := 1;
  new.updated_at := now();
  new.cancel_reason := null;
  new.total_cents := null;
  new.payment_mode := 'no_local';
  new.notify_channels := '{}';
  new.uses_resources := false;
  return new;
end $$;


create or replace function public.cancel_request(p_id uuid, p_token text default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_marca text := coalesce(current_setting('imed.origin', true), '');
begin
  select * into r from public.appointment_requests where id = p_id for update;
  if not found then return 'not_found'; end if;
  -- "is true": para quem não está logado, auth.uid() é nulo e a comparação não pode virar "dono".
  if not ((r.user_id = auth.uid()) is true
          or (r.review_token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')) is true) then
    return 'forbidden';
  end if;
  if r.status = 'cancelled' then return 'already_cancelled'; end if;
  if r.status not in ('pending', 'contacted', 'confirmed') then return 'not_cancellable'; end if;
  if r.slot_start is not null and r.slot_start <= now() then return 'past'; end if;
  perform set_config('imed.origin', 'app', true);
  update public.appointment_requests
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'patient'
   where id = r.id;
  perform set_config('imed.origin', v_marca, true);
  return 'ok';
end $$;
revoke execute on function public.cancel_request(uuid, text) from public;
grant execute on function public.cancel_request(uuid, text) to anon, authenticated;

create or replace function public.set_request_status(p_id uuid, p_status text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_admin boolean := coalesce(public.is_imed_admin(), false);
  who text;
  v_marca text := coalesce(current_setting('imed.origin', true), '');
begin
  if p_status is null or p_status not in ('contacted', 'confirmed', 'cancelled', 'completed') then return 'invalid_status'; end if;
  select * into r from public.appointment_requests where id = p_id for update;
  if not found then return 'not_found'; end if;
  if not (v_admin or (r.clinic_id is not null and public.is_clinic_member(r.clinic_id))) then
    return 'forbidden';
  end if;
  -- Cancelado pelo próprio paciente: a clínica não reabre (o paciente veria "Confirmado" de novo depois de cancelar).
  -- Só a equipe do IMED pode reabrir, por exemplo quando o próprio paciente pede.
  if r.status = 'cancelled' and r.cancelled_by = 'patient' and not v_admin then return 'cancelled_by_patient'; end if;
  who := case when r.clinic_id is not null and public.is_clinic_member(r.clinic_id) then 'clinic' else 'imed' end;
  begin
    -- (se o UPDATE falhar, a marca some junto com o bloco desfeito)
    perform set_config('imed.origin', case who when 'clinic' then 'painel' else 'central' end, true);
    update public.appointment_requests set
      status = p_status,
      -- Quem cancelou e quando: gravado ao cancelar e mantido se o pedido for reaberto (o registro não some).
      cancelled_at = case when p_status = 'cancelled' and r.status <> 'cancelled' then now() else r.cancelled_at end,
      cancelled_by = case when p_status = 'cancelled' and r.status <> 'cancelled' then who else r.cancelled_by end
    where id = p_id;
  exception when unique_violation then
    -- O horário ficou livre no cancelamento e outra pessoa já o reservou (índice appointment_requests_slot_uq).
    return 'slot_taken';
  end;
  perform set_config('imed.origin', v_marca, true);
  return 'ok';
end $$;
revoke execute on function public.set_request_status(uuid, text) from public, anon;
grant execute on function public.set_request_status(uuid, text) to authenticated;

create or replace function public.available_slots(p_clinic uuid, p_exam text default null, p_from date default null, p_days integer default 14)
returns table (slot_start timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_from date;
begin
  if not exists (select 1 from agenda.unit_settings u where u.clinic_id = p_clinic) then
    -- modo de hoje (sem a agenda nova): igual a 20261030034539_agenda
    return query
    select g.slot_start
    from private.clinic_slot_grid(p_clinic, p_exam,
           coalesce(p_from, (now() at time zone 'America/Sao_Paulo')::date), p_days) g
    join public.clinics c on c.id = p_clinic and c.status = 'published' and c.accepts_online_booking
    where g.slot_start > now() + interval '2 hours'
      and (p_exam is null or exists (select 1 from public.clinic_exams e where e.clinic_id = p_clinic and e.exam_code = p_exam))
      and not exists (select 1 from public.clinic_blocks b where b.clinic_id = p_clinic and g.slot_start >= b.starts_at and g.slot_start < b.ends_at)
      and not exists (select 1 from public.appointment_requests r
                      where r.clinic_id = p_clinic and r.slot_start = g.slot_start
                        and coalesce(r.exam_code, '') = coalesce(p_exam, '') and r.status <> 'cancelled')
    order by g.slot_start
    limit 300;
    return;
  end if;
  -- agenda nova: só com a venda online ligada
  select c.timezone into v_tz from public.clinics c
  where c.id = p_clinic and c.status = 'published' and c.accepts_online_booking and not c.is_demo
    and c.agenda_online_since is not null;
  if v_tz is null then return; end if;
  v_from := coalesce(p_from, (now() at time zone v_tz)::date);
  return query
  select distinct s.slot_start
  from agenda.procedures p
  cross join lateral private.agenda_free_starts(p_clinic, p.id, v_from, v_from + least(greatest(p_days, 1), 31) - 1, now()) s
  where p.clinic_id = p_clinic and p.active and p.archived_at is null and p.online_booking
    and (p_exam is null or p.exam_code = p_exam)
    and (p_exam is null or p.default_for_exam
         or not exists (select 1 from agenda.procedures d
                        where d.clinic_id = p_clinic and d.exam_code = p_exam and d.default_for_exam and d.active
                          and d.archived_at is null and d.online_booking))
  order by 1
  limit 2000;
end $$;
revoke execute on function public.available_slots(uuid, text, date, integer) from public;
grant execute on function public.available_slots(uuid, text, date, integer) to anon, authenticated;

create or replace function public.clinics_with_schedule(p_ids uuid[])
returns table (clinic_id uuid)
language sql stable security definer
set search_path = ''
as $$
  -- modo de hoje: igual a 20261030034539_agenda
  select distinct s.clinic_id from public.clinic_schedules s
  join public.clinics c on c.id = s.clinic_id and c.status = 'published' and c.accepts_online_booking
  where s.clinic_id = any (p_ids[1:300])
    and not exists (select 1 from agenda.unit_settings u where u.clinic_id = s.clinic_id)
  union
  -- agenda nova: só com a venda online ligada e algum procedimento à venda
  select c.id from public.clinics c
  join agenda.unit_settings u on u.clinic_id = c.id
  where c.id = any (p_ids[1:300]) and c.status = 'published' and c.accepts_online_booking and not c.is_demo
    and c.agenda_online_since is not null
    and exists (select 1 from agenda.procedures p
                where p.clinic_id = c.id and p.active and p.archived_at is null and p.online_booking);
$$;
revoke execute on function public.clinics_with_schedule(uuid[]) from public;
grant execute on function public.clinics_with_schedule(uuid[]) to anon, authenticated;

create or replace function public.set_my_schedule(p_clinic uuid, p_rows jsonb)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if not (public.is_clinic_member(p_clinic) or public.is_imed_admin()) then return 'forbidden'; end if;
  -- a mesma trava da ativação (agenda_unit_save): uma faixa antiga nunca entra numa clínica que acabou de mudar
  perform private.agenda_lock_config(p_clinic, true);
  if exists (select 1 from agenda.unit_settings u where u.clinic_id = p_clinic) then return 'managed_by_agenda'; end if;
  delete from public.clinic_schedules where clinic_id = p_clinic;
  insert into public.clinic_schedules (clinic_id, weekday, start_time, end_time, slot_minutes, exam_codes)
  select p_clinic, (x ->> 'weekday')::smallint, (x ->> 'start')::time, (x ->> 'end')::time,
         coalesce((x ->> 'slot_minutes')::smallint, 30),
         coalesce(array(select y from jsonb_array_elements_text(x -> 'exams') y
                        where y in ('rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab')), '{}')
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
  limit 100;
  return 'ok';
end $$;
revoke execute on function public.set_my_schedule(uuid, jsonb) from public, anon;
grant execute on function public.set_my_schedule(uuid, jsonb) to authenticated;

create or replace function public.admin_stats(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 366);
  v_to date := (now() at time zone 'America/Sao_Paulo')::date;
  v_from date := v_to - (v_days - 1);
  -- Começo do primeiro dia e fim de hoje, no horário de São Paulo.
  v_from_ts timestamptz := v_from::timestamp at time zone 'America/Sao_Paulo';
  v_to_ts timestamptz := (v_to + 1)::timestamp at time zone 'America/Sao_Paulo';
  v_tele bigint;
  v_out jsonb;
begin
  if not coalesce(public.is_imed_admin(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Teleconsultas pedidas (entraram na fila do médico). Sem a tabela da teleconsulta no banco: nulo.
  if to_regclass('public.teleconsultations') is not null then
    execute 'select count(*) from public.teleconsultations t where t.created_at >= $1 and t.created_at < $2'
      into v_tele using v_from_ts, v_to_ts;
  end if;
  with pv as (
    select v.day, v.path, v.views from private.page_views_daily v where v.day between v_from and v_to
  ), ev as (
    select e.event, e.detail, sum(e.total) as n
    from private.site_events_daily e where e.day between v_from and v_to
    group by e.event, e.detail
  ), rk as (
    select ev.event, ev.detail, ev.n, row_number() over (partition by ev.event order by ev.n desc, ev.detail) as pos
    from ev
  ), rq as (
    select coalesce(a.exam_code, '') as exam, count(*) as n
    from public.appointment_requests a where a.created_at >= v_from_ts and a.created_at < v_to_ts
    group by 1
  )
  select jsonb_build_object(
    'dias', v_days,
    'de', v_from,
    'ate', v_to,
    'visitas', (select coalesce(sum(pv.views), 0) from pv),
    'por_dia', (select jsonb_agg(jsonb_build_object('dia', g.d, 'visitas', coalesce(s.n, 0)) order by g.d)
                from (select v_from + i as d from generate_series(0, v_days - 1) as i) g
                left join (select pv.day, sum(pv.views) as n from pv group by pv.day) s on s.day = g.d),
    'paginas', coalesce((select jsonb_agg(jsonb_build_object('pagina', x.path, 'visitas', x.n) order by x.n desc, x.path)
                from (select pv.path, sum(pv.views) as n from pv group by pv.path order by n desc, pv.path limit 20) x), '[]'::jsonb),
    'exames', coalesce((select jsonb_agg(jsonb_build_object('exame', t.detail, 'total', t.n) order by t.pos)
                from rk t where t.event = 'busca_exame' and t.pos <= 10), '[]'::jsonb),
    'tipos', coalesce((select jsonb_agg(jsonb_build_object('tipo', t.detail, 'total', t.n) order by t.pos)
                from rk t where t.event = 'busca_tipo' and t.pos <= 10), '[]'::jsonb),
    'cidades', coalesce((select jsonb_agg(jsonb_build_object('cidade', t.detail, 'total', t.n) order by t.pos)
                from rk t where t.event = 'busca_cidade' and t.pos <= 10), '[]'::jsonb),
    'pedidos_total', (select coalesce(sum(rq.n), 0) from rq),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('exame', x.exam, 'total', x.n) order by x.n desc, x.exam)
                from (select rq.exam, rq.n from rq order by rq.n desc, rq.exam limit 12) x), '[]'::jsonb),
    'teleconsultas', v_tele,
    'eventos', coalesce((select jsonb_object_agg(x.event, x.n)
                from (select ev.event, sum(ev.n) as n from ev group by ev.event) x), '{}'::jsonb)
  ) into v_out;
  return v_out;
end $$;


create or replace function public.admin_gestao(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := coalesce(p_days, 30);
  v_now timestamptz := now();
  v_to date := (now() at time zone 'America/Sao_Paulo')::date;
  v_from date;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_serie jsonb;
  v_pedidos jsonb;
  v_tele jsonb;
  v_tele_atendidos bigint;
  v_docs jsonb;
  v_aval jsonb;
  v_funil jsonb;
  v_medicos jsonb;
  v_clinicas jsonb;
  v_outros jsonb;
  v_cobranca jsonb;
begin
  if not coalesce(public.is_imed_admin(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_days not between 1 and 366 then
    raise exception 'Período inválido: use de 1 a 366 dias.' using errcode = '22023';
  end if;
  v_from := v_to - (v_days - 1);
  -- Começo do primeiro dia e fim de hoje, no horário de São Paulo.
  v_from_ts := v_from::timestamp at time zone 'America/Sao_Paulo';
  v_to_ts := (v_to + 1)::timestamp at time zone 'America/Sao_Paulo';

  -- Série: um item por dia do período, em ordem (dia sem nada: zeros).
  with dias as (
    select v_from + i as dia from generate_series(0, v_days - 1) as i
  ), vis as (
    select v.day as dia, sum(v.views) as n
    from private.page_views_daily v
    where v.day between v_from and v_to
    group by v.day
  ), ped as (
    select (a.created_at at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
    from public.appointment_requests a
    where a.created_at >= v_from_ts and a.created_at < v_to_ts
      and not exists (select 1 from public.clinics c where c.id = a.clinic_id and c.is_demo)
    group by 1
  ), tel as (
    select (t.created_at at time zone 'America/Sao_Paulo')::date as dia,
           count(*) as pedidas,
           count(*) filter (where private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at) = 'ended') as encerradas
    from public.teleconsultations t
    where t.created_at >= v_from_ts and t.created_at < v_to_ts
    group by 1
  ), doc as (
    select (d.created_at at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
    from public.tele_documents d
    where d.created_at >= v_from_ts and d.created_at < v_to_ts
    group by 1
  )
  select jsonb_agg(jsonb_build_object(
           'dia', g.dia,
           'visitas', coalesce(vis.n, 0),
           'pedidos', coalesce(ped.n, 0),
           'tele_pedidas', coalesce(tel.pedidas, 0),
           'tele_encerradas', coalesce(tel.encerradas, 0),
           'documentos', coalesce(doc.n, 0)) order by g.dia)
    into v_serie
  from dias g
  left join vis on vis.dia = g.dia
  left join ped on ped.dia = g.dia
  left join tel on tel.dia = g.dia
  left join doc on doc.dia = g.dia;

  -- Pedidos de agendamento feitos no período, pela situação de hoje (sem os de teste às clínicas de demonstração).
  select jsonb_build_object(
           'total', count(*),
           'pendente', count(*) filter (where a.status = 'pending'),
           'contatado', count(*) filter (where a.status = 'contacted'),
           'confirmado', count(*) filter (where a.status = 'confirmed'),
           'cancelado', count(*) filter (where a.status = 'cancelled'),
           'concluido', count(*) filter (where a.status = 'completed'),
           'parceiro', count(*) filter (where a.clinic_id is not null),
           'concierge', count(*) filter (where a.clinic_id is null))
    into v_pedidos
  from public.appointment_requests a
  where a.created_at >= v_from_ts and a.created_at < v_to_ts
    and not exists (select 1 from public.clinics c where c.id = a.clinic_id and c.is_demo);

  -- Teleconsultas pedidas no período, pela situação de fato; a parte da teleconsulta no funil; e as encerradas em que
  -- o atendimento começou (vídeo, ligação ou mensagem do médico), que são os pacientes atendidos.
  with t as (
    select x.id, x.created_at, x.accepted_at, x.started_at, x.ended_at, x.closed_by,
           private.tele_effective_status(x.status, x.created_at, x.accepted_at, x.started_at) as eff
    from public.teleconsultations x
    where x.created_at >= v_from_ts and x.created_at < v_to_ts
  )
  select jsonb_build_object(
           'total', count(*),
           'aguardando', count(*) filter (where t.eff = 'waiting'),
           'aceita', count(*) filter (where t.eff = 'accepted' and t.started_at is null),
           'em_atendimento', count(*) filter (where t.eff = 'in_call' or (t.eff = 'accepted' and t.started_at is not null)),
           'encerrada', count(*) filter (where t.eff = 'ended'),
           'cancelada', count(*) filter (where t.eff = 'cancelled'),
           'expirada', count(*) filter (where t.eff = 'expired'),
           'espera_media_min', round(avg(extract(epoch from (t.accepted_at - t.created_at)) / 60)
                                       filter (where t.accepted_at is not null), 1),
           'duracao_media_min', round(avg(extract(epoch from (t.ended_at - t.started_at)) / 60)
                                        filter (where t.eff = 'ended' and t.started_at is not null and t.ended_at is not null
                                                  and t.closed_by is distinct from 'system'), 1)),
         jsonb_build_object(
           'tele_fila', count(*),
           'tele_atendidas', count(*) filter (where t.eff in ('accepted', 'in_call', 'ended')),
           'tele_encerradas', count(*) filter (where t.eff = 'ended'),
           'tele_com_documento', count(*) filter (where exists (
             select 1 from public.tele_documents d where d.consultation_id = t.id and d.status = 'emitido'))),
         count(*) filter (where t.eff = 'ended' and t.started_at is not null)
    into v_tele, v_funil, v_tele_atendidos
  from t;

  -- Documentos médicos emitidos no período (os 7 tipos sempre aparecem; zero quando não houve).
  with d as (
    select x.kind, x.status, (x.signed_at is not null) as pdf
    from public.tele_documents x
    where x.created_at >= v_from_ts and x.created_at < v_to_ts
  ), k as (
    select unnest(array['exames', 'receita', 'atestado', 'comparecimento', 'encaminhamento', 'relatorio', 'orientacoes']) as kind
    union
    select d.kind from d
  )
  select jsonb_build_object(
           'total', (select count(*) from d),
           'por_tipo', (select jsonb_object_agg(k.kind, (select count(*) from d where d.kind = k.kind)) from k),
           'cancelados', (select count(*) from d where d.status = 'cancelado'),
           'pdf_assinado', (select count(*) from d where d.pdf))
    into v_docs;

  -- Avaliações publicadas no período (sem as de pedidos às clínicas de demonstração).
  select jsonb_build_object('total', count(*), 'media', round(avg(r.rating), 1))
    into v_aval
  from public.reviews r
  where r.status = 'published' and r.created_at >= v_from_ts and r.created_at < v_to_ts
    and not exists (select 1 from public.appointment_requests a join public.clinics c on c.id = a.clinic_id
                    where a.id = r.request_id and c.is_demo);

  -- Funil: páginas abertas (contador próprio) e os pedidos do período.
  select v_funil || jsonb_build_object(
           'visitas', coalesce(sum(v.views), 0),
           'abriram_busca', coalesce(sum(v.views) filter (where v.path = '/perto.html'), 0),
           'abriram_local', coalesce(sum(v.views) filter (where v.path = '/local.html'), 0),
           'abriram_tele', coalesce(sum(v.views) filter (where v.path = '/teleconsulta.html'), 0),
           'pedidos', v_pedidos -> 'total',
           'confirmados', (v_pedidos ->> 'confirmado')::bigint + (v_pedidos ->> 'concluido')::bigint,
           'concluidos', v_pedidos -> 'concluido')
    into v_funil
  from private.page_views_daily v
  where v.day between v_from and v_to;

  -- Médicos: inscritos no período, situação de hoje e a fila de quem espera a conferência.
  select jsonb_build_object(
           'inscritos_periodo', count(*) filter (where d.created_at >= v_from_ts and d.created_at < v_to_ts),
           'pendente', count(*) filter (where d.status = 'pending'),
           'aprovado', count(*) filter (where d.status = 'approved'),
           'recusado', count(*) filter (where d.status = 'rejected'),
           'suspenso', count(*) filter (where d.status = 'suspended'),
           'disponiveis_agora', count(*) filter (where d.status = 'approved' and d.available_until > v_now),
           -- Só os inscritos no período: reviewed_at é a última decisão (ver o topo do arquivo).
           'aprovacao_media_horas', round(avg(extract(epoch from (d.reviewed_at - d.created_at)) / 3600)
                                            filter (where d.status = 'approved' and d.created_at >= v_from_ts
                                                      and d.created_at < v_to_ts), 1),
           'aguardando', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', w.id,
                      'nome', w.full_name,
                      'crm', w.crm,
                      'uf', w.crm_uf::text,
                      'especialidade', w.specialty,
                      'desde', private.gestao_iso(w.created_at)) order by w.created_at, w.id)
             from (select p.id, p.full_name, p.crm, p.crm_uf, p.specialty, p.created_at
                   from public.doctors p
                   where p.status = 'pending'
                   order by p.created_at, p.id
                   limit 50) w), '[]'::jsonb))
    into v_medicos
  from public.doctors d;

  -- Clínicas parceiras (sem as de demonstração), interessadas no período e pedidos de cadastro (situação de hoje).
  select jsonb_build_object(
           'parceiras', count(*),
           'com_agenda', count(*) filter (where c.accepts_online_booking
                                            and exists (select 1 from public.clinic_schedules s where s.clinic_id = c.id)),
           'com_preco', count(*) filter (where exists (select 1 from public.clinic_exams e
                                                       where e.clinic_id = c.id and e.price_cents is not null)),
           'interessadas', (select count(*) from public.partner_leads l
                            where l.partner_type = 'clinica' and l.created_at >= v_from_ts and l.created_at < v_to_ts),
           'reivindicacoes', (select jsonb_build_object(
                                       'pendente', count(*) filter (where r.status = 'pending'),
                                       'aprovado', count(*) filter (where r.status = 'approved'),
                                       'recusado', count(*) filter (where r.status = 'rejected'))
                              from public.establishment_claims r))
    into v_clinicas
  from public.clinics c
  where c.status = 'published' and not c.is_demo;

  -- Lista de espera e Fale com o IMED feitos no período; avisos de erro com algum envio no período.
  select jsonb_build_object(
           'lista_espera', (select count(*) from public.app_waitlist w
                            where w.created_at >= v_from_ts and w.created_at < v_to_ts),
           'contatos', (select count(*) from public.contact_messages m
                        where m.created_at >= v_from_ts and m.created_at < v_to_ts),
           'avisos_de_erro', (select count(*) from public.place_reports r
                              where r.last_at >= v_from_ts and r.last_at < v_to_ts))
    into v_outros;

  -- Cobrança: faturado no período (pelo dia do pagamento), pendentes, atrasadas, canceladas e os últimos 12 meses.
  select jsonb_build_object(
           'faturado_cents', coalesce(sum(b.amount_cents) filter (where b.status = 'pago'
                                                                     and b.paid_at >= v_from_ts and b.paid_at < v_to_ts), 0),
           'a_receber_cents', coalesce(sum(b.amount_cents) filter (where b.status = 'pendente'), 0),
           'atrasado_cents', coalesce(sum(b.amount_cents) filter (where b.status = 'pendente' and b.due_date < v_to), 0),
           'cancelado_cents', coalesce(sum(b.amount_cents) filter (where b.status = 'cancelado'), 0),
           'qtd_pagas', count(*) filter (where b.status = 'pago' and b.paid_at >= v_from_ts and b.paid_at < v_to_ts),
           'qtd_pendentes', count(*) filter (where b.status = 'pendente'),
           'por_mes', (
             select jsonb_agg(jsonb_build_object(
                      'mes', to_char(m.ini, 'YYYY-MM'),
                      'faturado_cents', coalesce((
                        select sum(x.amount_cents) from private.billing_charges x
                        where x.status = 'pago'
                          and x.paid_at >= (m.ini at time zone 'America/Sao_Paulo')
                          and x.paid_at < ((m.ini + interval '1 month') at time zone 'America/Sao_Paulo')), 0),
                      'a_receber_cents', coalesce((
                        select sum(x.amount_cents) from private.billing_charges x
                        where x.status = 'pendente'
                          and x.due_date >= m.ini::date
                          and x.due_date < (m.ini + interval '1 month')::date), 0)) order by m.ini)
             from (select date_trunc('month', v_to::timestamp) - make_interval(months => 11 - i) as ini
                   from generate_series(0, 11) as i) m))
    into v_cobranca
  from private.billing_charges b;

  return jsonb_build_object(
    'dias', v_days,
    'de', v_from,
    'ate', v_to,
    'gerado_em', private.gestao_iso(v_now),
    'serie', coalesce(v_serie, '[]'::jsonb),
    'pacientes', jsonb_build_object(
      'atendidos', v_tele_atendidos + (v_pedidos ->> 'concluido')::bigint,
      'pedidos', v_pedidos,
      'tele', v_tele,
      'documentos', v_docs,
      'avaliacoes', v_aval),
    'funil', v_funil,
    'medicos', v_medicos,
    'clinicas', v_clinicas,
    'outros', v_outros,
    'cobranca', v_cobranca,
    -- A teleconsulta neste momento (não depende do período): a mesma conta do painel do médico.
    'agora', private.tele_agora(null::uuid));
end $$;


comment on function public.available_slots(uuid, text, date, integer) is
  'Horários livres (público). Sem agenda nova: a grade antiga (20261030034539_agenda). Com agenda nova: o motor (agenda_free_starts), só com a venda online ligada.';
comment on function public.set_my_schedule(uuid, jsonb) is
  'Editor antigo de horários. Clínica na agenda nova: managed_by_agenda (as regras vêm de agenda_rules_set).';

/* ===================== 5. Funções novas da 3.3 ===================== */
drop function if exists public.agenda_package_options(uuid, uuid[], date, integer);
drop function if exists public.agenda_my_booking(uuid, text);
drop function if exists public.agenda_desk_busy_remove(uuid);
drop function if exists public.agenda_desk_busy(uuid, timestamptz, timestamptz, uuid, uuid, text);
drop function if exists public.agenda_desk_book(uuid, jsonb, jsonb, text, uuid);
drop function if exists public.agenda_reschedule(uuid, jsonb, text, uuid, integer);
drop function if exists public.agenda_set_status(uuid, text, text, integer, uuid);
drop function if exists public.agenda_release(uuid, text);
drop function if exists public.agenda_cancel(uuid, text, text, integer);
drop function if exists public.agenda_confirm(uuid);
drop function if exists public.agenda_hold(uuid, jsonb, jsonb, uuid, text);
drop function if exists public.agenda_book(uuid, jsonb, jsonb, uuid, text);
drop function if exists private.agenda_set_status_int(uuid, text, text, integer, uuid);
drop function if exists private.agenda_cancel_int(uuid, text, text, integer, boolean);
drop function if exists private.agenda_cancel_do(uuid, text, text, text);
drop function if exists private.agenda_book_int(uuid, jsonb, jsonb, uuid, text, text, text, text, boolean, boolean, text, text, uuid);
drop function if exists private.agenda_i2_trigger();
drop function if exists private.agenda_check_request(uuid);
drop function if exists private.agenda_check_item(uuid);
drop function if exists private.agenda_package_check(uuid, jsonb);
drop function if exists private.agenda_alternatives(uuid, uuid, timestamptz, timestamptz);
drop function if exists private.agenda_quick_taken(uuid, timestamptz, text);
drop function if exists private.agenda_place(uuid, timestamptz, uuid[]);
drop function if exists private.agenda_start_ok(uuid, uuid, timestamptz, timestamptz, text);
drop procedure if exists private.agenda_manutencao();
drop function if exists private.agenda_release_expired(uuid[]);
drop function if exists private.agenda_expire(uuid);
drop function if exists private.agenda_candidates(uuid[]);
drop function if exists private.agenda_setting_int(text, integer);
drop function if exists private.agenda_count(text);
drop function if exists private.agenda_history(uuid, uuid, text, text, text, uuid, integer);
drop function if exists private.agenda_actor_role(uuid, text);
drop function if exists private.agenda_rollup(uuid);
drop function if exists private.agenda_active_status(text);
