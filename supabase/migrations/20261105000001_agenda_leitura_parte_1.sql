-- iMed Agenda, fase 4.2 ("Agenda visual e recepção"), parte 1 de 2: SÓ ACRESCENTA. Arquitetura:
-- memory/projects/imed-agenda-arquitetura.md (§3.2 item 4, §5, §11, §12, §14 item 4.2).
-- Nome provisório no ramo de teste: depois de aplicada na produção, este arquivo e a volta ganham a versão que o
-- conector gravar (e ULTIMA_NA_PRODUCAO no banco.yml muda junto).
--
-- Em linguagem simples: funções novas para a tela da agenda — o catálogo da recepção (exames, aparelhos e prazos),
-- os horários livres da grade, os horários do balcão, a lista de bloqueios, a lista de pedidos da clínica (com
-- registro de quem leu), o "bloquear mesmo assim" (os pacientes do horário vão para remarcação, com conflito aberto)
-- e chegada/atendimento/falta pelo profissional, na própria agenda. Nada é apagado nem trocado; o site de hoje
-- continua igual. Pode rodar de novo sem erro e sem mudar nada. Volta: supabase/volta/<versão>_agenda_leitura_parte_2.sql
-- (a volta é única, para as 2 partes; a desta parte não faz nada).
--
-- Conferir na produção depois desta parte (só leitura; tem de dar true):
--   select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'agenda\_%') = 53
--      and (select bool_and(has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE'))
--           from unnest(array['public.agenda_catalog(uuid)', 'public.agenda_free(uuid,date,integer)',
--                             'public.agenda_desk_slots(uuid,uuid,date,date,uuid,uuid)', 'public.agenda_blocks(uuid,date,date)',
--                             'public.agenda_requests(uuid,text,text)',
--                             'public.agenda_block_force(uuid,uuid,timestamptz,timestamptz,text,text,text)',
--                             'public.agenda_attend(uuid,text,text,integer,uuid)']) f)
--      and (select provolatile from pg_proc where oid = 'public.agenda_requests(uuid,text,text)'::regprocedure) = 'v'
--      and (select provolatile from pg_proc where oid = 'public.agenda_attend(uuid,text,text,integer,uuid)'::regprocedure) = 'v'
--      and not has_function_privilege('authenticated', 'private.agenda_block_hits(uuid,uuid[],timestamptz,timestamptz)', 'EXECUTE')
--      and (select qual from pg_policies where tablename = 'appointment_requests' and policyname = 'clinica ve pedidos para ela') like '%pedidos.ver%';
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. Apoio ===================== */
-- Quem um bloqueio em p_res × [p_starts, p_ends) atingiria: usos ativos de agendamento (sem reserva vencida) e
-- "ocupados". Só ids, situação, versão e horários (nada de paciente). Um item que usa dois recursos da lista aparece
-- uma vez só (UNION).
create or replace function private.agenda_block_hits(p_clinic uuid, p_res uuid[], p_starts timestamptz, p_ends timestamptz)
returns table (kind text, item_id uuid, request_id uuid, busy_id uuid, status text, request_version integer,
               starts_at timestamptz, ends_at timestamptz, procedure_id uuid, seq smallint)
language sql stable
set search_path = ''
as $$
  select 'agendamento'::text, i.id, i.request_id, null::uuid, i.status, a.version, i.starts_at, i.ends_at, i.procedure_id, i.seq
  from agenda.occupancy o
  join agenda.appointment_items i on i.id = o.item_id
  join public.appointment_requests a on a.id = i.request_id
  where o.clinic_id = p_clinic and o.resource_id = any (p_res) and o.active and o.kind = 'agendamento'
    and o.during && tstzrange(p_starts, p_ends, '[)')
    and (o.hold_until is null or o.hold_until > now())
  union
  select 'ocupado'::text, null::uuid, null::uuid, b.id, null::text, null::integer, b.starts_at, b.ends_at, b.procedure_id, null::smallint
  from agenda.occupancy o
  join agenda.busy_marks b on b.id = o.busy_id
  where o.clinic_id = p_clinic and o.resource_id = any (p_res) and o.active and o.kind = 'ocupado'
    and o.during && tstzrange(p_starts, p_ends, '[)');
$$;
revoke all on function private.agenda_block_hits(uuid, uuid[], timestamptz, timestamptz) from public, anon, authenticated, service_role;

-- Último dia com feriado nacional lançado: o fim do ano do feriado nacional mais novo (o mesmo corte do motor,
-- private.agenda_free_starts). Nulo = nenhum lançado (o motor não oferece horário nenhum).
create or replace function private.agenda_national_until()
returns date
language sql stable
set search_path = ''
as $$
  select (date_trunc('year', max(h.day)) + interval '1 year' - interval '1 day')::date from agenda.holidays h where h.scope = 'nacional';
$$;
revoke all on function private.agenda_national_until() from public, anon, authenticated, service_role;

/* ===================== 2. Leituras sem dado de paciente ===================== */

-- O que a recepção precisa para trabalhar (a configuração inteira é só de quem configura: agenda_config).
-- O profissional recebe só os recursos ligados a ele e os procedimentos que usam algum deles.
create or replace function public.agenda_catalog(p_clinic uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_scope text := private.agenda_scope(p_clinic, 'agenda.ver', 'imed.agenda.monitor');
  c public.clinics;
  u agenda.unit_settings;
  v_own uuid[];
begin
  if v_scope is null then return jsonb_build_object('status', 'forbidden'); end if;
  select * into c from public.clinics x where x.id = p_clinic;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into u from agenda.unit_settings s where s.clinic_id = p_clinic;
  v_own := case when v_scope = 'propria' then private.agenda_own_resources(p_clinic) end;
  return jsonb_build_object(
    'status', 'ok', 'scope', v_scope, 'clinic_id', c.id, 'timezone', c.timezone, 'agenda_mode', c.agenda_mode,
    'active', u.clinic_id is not null, 'online', c.agenda_online_since is not null,
    'can', jsonb_build_object(
      'marcar', private.agenda_actor(p_clinic, 'agenda.marcar', 'imed.agenda.operar') is not null,
      'remarcar', private.agenda_actor(p_clinic, 'agenda.remarcar', 'imed.agenda.operar') is not null,
      'cancelar', private.agenda_actor(p_clinic, 'agenda.cancelar', 'imed.agenda.operar') is not null,
      'bloquear', private.agenda_actor(p_clinic, 'agenda.bloquear', 'imed.agenda.operar') is not null,
      'atender', coalesce(public.clinic_perm_scope(p_clinic, 'agenda.atender') in ('clinica', 'propria'), false)
                 or public.imed_has('imed.agenda.operar'),
      'pacientes', coalesce(public.clinic_perm_scope(p_clinic, 'agenda.pacientes') in ('clinica', 'propria'), false),
      'conflitos', private.agenda_actor(p_clinic, 'conflitos.resolver', 'imed.conflitos.resolver') is not null),
    'unit', case when u.clinic_id is null then null else jsonb_build_object(
      'step_min', u.step_min, 'min_notice_min', u.min_notice_min, 'max_advance_days', u.max_advance_days,
      'checkin_before_min', u.checkin_before_min, 'no_show_after_min', u.no_show_after_min,
      'patient_cancel_until_min', u.patient_cancel_until_min, 'patient_reschedule_until_min', u.patient_reschedule_until_min,
      'holidays_checked_until', u.holidays_checked_until, 'closes_on_holidays', u.closes_on_holidays) end,
    'national_holidays_until', private.agenda_national_until(),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'name', r.name, 'capacity', r.capacity,
                                          'active', r.active, 'mine', coalesce(r.member_user_id = auth.uid(), false))
                       order by r.kind, lower(r.name), r.id)
      from agenda.resources r
      where r.clinic_id = p_clinic and r.archived_at is null and (v_own is null or r.id = any (v_own))), '[]'::jsonb),
    'procedures', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'exam_code', p.exam_code, 'name', p.name, 'duration_min', p.duration_min,
               'price_cents', p.price_cents, 'online_booking', p.online_booking, 'prep_text', p.patient_prep_text,
               'fasting_hours', p.fasting_hours, 'min_notice_min', coalesce(p.min_notice_min, u.min_notice_min),
               'groups', coalesce((
                 select jsonb_agg(jsonb_build_object('group_no', g.group_no, 'resource_kind', g.resource_kind,
                          'resource_ids', coalesce((select jsonb_agg(o.resource_id order by o.priority, o.resource_id)
                                                    from agenda.requirement_options o where o.requirement_id = g.id), '[]'::jsonb))
                        order by g.group_no)
                 from agenda.procedure_requirements g where g.procedure_id = p.id), '[]'::jsonb))
             order by p.exam_code, lower(p.name), p.id)
      from agenda.procedures p
      where p.clinic_id = p_clinic and p.active and p.archived_at is null
        and (v_own is null or exists (select 1 from agenda.requirement_options o
                                      where o.procedure_id = p.id and o.resource_id = any (v_own)))), '[]'::jsonb));
end $$;

-- O "Livre" da grade: por recurso, onde há pelo menos uma vaga livre (o mapa do motor, §4), mais quando a unidade
-- atende, os feriados do período e até quando os feriados foram conferidos (depois dessa data o balcão não marca).
-- Sem paciente. 1 a 7 dias, na hora local da unidade. Regras só para alguns exames não entram no "Livre" geral.
create or replace function public.agenda_free(p_clinic uuid, p_from date, p_days integer default 1)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  v_scope text := private.agenda_scope(p_clinic, 'agenda.ver', 'imed.agenda.monitor');
  c public.clinics;
  u agenda.unit_settings;
  v_ini timestamptz;
  v_fim timestamptz;
  v_own uuid[];
  v_res uuid[];
  v_cidade public.establishments.city_ibge%type;
begin
  if v_scope is null then return jsonb_build_object('status', 'forbidden'); end if;
  if p_from is null or p_days is null or p_days not between 1 and 7 then return jsonb_build_object('status', 'invalid'); end if;
  select * into c from public.clinics x where x.id = p_clinic;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into u from agenda.unit_settings s where s.clinic_id = p_clinic;
  if not found then return jsonb_build_object('status', 'agenda_not_started'); end if;
  v_ini := p_from::timestamp at time zone c.timezone;
  v_fim := (p_from + p_days)::timestamp at time zone c.timezone;
  v_own := case when v_scope = 'propria' then private.agenda_own_resources(p_clinic) end;
  v_res := array(select r.id from agenda.resources r
                 where r.clinic_id = p_clinic and r.active and r.archived_at is null and (v_own is null or r.id = any (v_own))
                 order by r.id);
  select e.city_ibge into v_cidade from public.establishments e where e.cnes = c.cnes;
  return jsonb_build_object(
    'status', 'ok', 'scope', v_scope, 'timezone', c.timezone, 'from', v_ini, 'to', v_fim,
    'holidays_checked_until', u.holidays_checked_until, 'national_holidays_until', private.agenda_national_until(),
    'closes_on_holidays', u.closes_on_holidays,
    'unit_open', coalesce((
      select jsonb_agg(jsonb_build_array(lower(w.r), upper(w.r)) order by lower(w.r))
      from unnest(private.agenda_unit_free(p_clinic, v_ini, v_fim, null) * tstzmultirange(tstzrange(v_ini, v_fim, '[)'))) w (r)),
      '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.resource_id, 'free', f.livre) order by f.resource_id)
      from (select m.resource_id, jsonb_agg(jsonb_build_array(lower(z.r), upper(z.r)) order by lower(z.r)) as livre
            from (select x.resource_id, range_agg(y.r) as uniao
                  from private.agenda_free_map(p_clinic, v_res, v_ini, v_fim, now(), null, '{}') x
                  cross join lateral unnest(x.free) y (r)
                  group by x.resource_id) m
            cross join lateral unnest(m.uniao) z (r)
            group by m.resource_id) f), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('day', h.day, 'name', h.name, 'scope', h.scope,
                                          'open', exists (select 1 from agenda.holiday_openings o
                                                          where o.clinic_id = p_clinic and o.day = h.day))
                       order by h.day, h.scope)
      from agenda.holidays h
      where h.day between p_from and p_from + p_days - 1
        and (h.scope = 'nacional' or (h.scope = 'uf' and h.uf = upper(c.state))
             or (h.scope = 'municipio' and h.city_ibge = v_cidade))), '[]'::jsonb));
end $$;

-- Horários do balcão e da remarcação pela clínica: o mesmo motor, com o "agora" recuado da antecedência mínima
-- (igual a agenda_desk_book e agenda_reschedule para a clínica) e, na remarcação, sem contar o próprio item.
-- Devolve também até quando os feriados foram conferidos (a tela explica por que não há horário).
create or replace function public.agenda_desk_slots(p_clinic uuid, p_procedure uuid, p_from date, p_to date default null,
                                                    p_request uuid default null, p_item uuid default null)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  v_origin text := private.agenda_actor(p_clinic, case when p_request is null then 'agenda.marcar' else 'agenda.remarcar' end,
                                        'imed.agenda.operar');
  v_tz text;
  u agenda.unit_settings;
  v_p agenda.procedures;
  v_to date;
  v_ign uuid[] := '{}';
  v_slots jsonb;
begin
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  if p_procedure is null or p_from is null then return jsonb_build_object('status', 'invalid'); end if;
  v_to := coalesce(p_to, p_from);
  if v_to < p_from or v_to - p_from > 13 then return jsonb_build_object('status', 'invalid'); end if;
  select c.timezone into v_tz from public.clinics c where c.id = p_clinic;
  if v_tz is null then return jsonb_build_object('status', 'not_found'); end if;
  select * into u from agenda.unit_settings s where s.clinic_id = p_clinic;
  if not found then return jsonb_build_object('status', 'agenda_not_started'); end if;
  select * into v_p from agenda.procedures x
  where x.id = p_procedure and x.clinic_id = p_clinic and x.active and x.archived_at is null;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if p_request is not null then
    if not exists (select 1 from public.appointment_requests a
                   where a.id = p_request and a.clinic_id = p_clinic and a.uses_resources) then
      return jsonb_build_object('status', 'not_found');
    end if;
    v_ign := array(select i.id from agenda.appointment_items i where i.request_id = p_request and (p_item is null or i.id = p_item));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('start', s.slot_start, 'end', s.slot_end) order by s.slot_start), '[]'::jsonb)
    into v_slots
  from (select f.slot_start, f.slot_end
        from private.agenda_free_starts(p_clinic, p_procedure, p_from, v_to,
               now() - make_interval(mins => coalesce(v_p.min_notice_min, u.min_notice_min)), v_ign) f
        order by f.slot_start
        limit 500) s;
  return jsonb_build_object('status', 'ok', 'timezone', v_tz, 'from', p_from, 'to', v_to, 'slots', v_slots,
                            'holidays_checked_until', u.holidays_checked_until,
                            'national_holidays_until', private.agenda_national_until());
end $$;

-- Bloqueios da clínica (unidade e recursos), sem leitura direta da tabela. O motivo (texto da clínica) só para quem
-- vê a clínica inteira; o profissional vê os da unidade e os dos recursos dele. Padrão: de hoje até 400 dias.
create or replace function public.agenda_blocks(p_clinic uuid, p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_scope text := private.agenda_scope(p_clinic, 'agenda.ver', 'imed.agenda.monitor');
  v_tz text;
  v_from date;
  v_to date;
  v_own uuid[];
begin
  if v_scope is null then return jsonb_build_object('status', 'forbidden'); end if;
  select c.timezone into v_tz from public.clinics c where c.id = p_clinic;
  if v_tz is null then return jsonb_build_object('status', 'not_found'); end if;
  v_from := coalesce(p_from, (now() at time zone v_tz)::date);
  v_to := coalesce(p_to, v_from + 400);
  if v_to < v_from or v_to - v_from > 731 then return jsonb_build_object('status', 'invalid'); end if;
  v_own := case when v_scope = 'propria' then private.agenda_own_resources(p_clinic) end;
  return jsonb_build_object(
    'status', 'ok', 'scope', v_scope, 'timezone', v_tz, 'from', v_from, 'to', v_to,
    'can_edit', private.agenda_actor(p_clinic, 'agenda.bloquear', 'imed.agenda.operar') is not null,
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'resource_id', b.resource_id, 'resource_name', r.name,
                                          'resource_kind', r.kind, 'kind', b.kind, 'starts_at', b.starts_at,
                                          'ends_at', b.ends_at, 'reason', case when v_scope = 'clinica' then b.reason end,
                                          'created_at', b.created_at)
                       order by b.starts_at, b.id)
      from (select * from public.clinic_blocks x
            where x.clinic_id = p_clinic and x.removed_at is null
              and x.starts_at < (v_to + 1)::timestamp at time zone v_tz and x.ends_at > v_from::timestamp at time zone v_tz
              and (v_own is null or x.resource_id is null or x.resource_id = any (v_own))
            order by x.starts_at, x.id
            limit 500) b
      left join agenda.resources r on r.id = b.resource_id), '[]'::jsonb));
end $$;

/* ===================== 3. Lista de pedidos da clínica (registra a leitura) ===================== */
-- A aba "Pedidos" do painel: a mesma lista da leitura direta de hoje (sem reserva em andamento ou expirada), na mesma
-- ordem e com o mesmo limite, mas por função: fica em agenda.access_log quando a lista tem dado de paciente.
-- p_when: nulo (os 100 mais novos), 'hoje' ou 'semana' (hoje e os próximos 6 dias), pela data do exame no fuso da
-- clínica. A equipe do IMED (imed.pacientes.ver) só com uma justificativa em código ("quebra de vidro").
create or replace function public.agenda_requests(p_clinic uuid, p_when text default null, p_justification text default null)
returns jsonb
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  v_scope text;
  v_tz text;
  v_today date;
  v_rows jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'forbidden'); end if;
  if p_when is not null and p_when not in ('hoje', 'semana') then return jsonb_build_object('status', 'invalid'); end if;
  if public.clinic_perm_scope(p_clinic, 'pedidos.ver') = 'clinica' then
    v_scope := 'clinica';
  elsif public.imed_has('imed.pacientes.ver') then
    if p_justification is null or p_justification !~ '^[a-z][a-z0-9_]{2,59}$' or p_justification ~ '[0-9]{4,}' then
      return jsonb_build_object('status', 'justification_required');
    end if;
    v_scope := 'central';
  else
    return jsonb_build_object('status', 'forbidden');
  end if;
  select c.timezone into v_tz from public.clinics c where c.id = p_clinic;
  if v_tz is null then return jsonb_build_object('status', 'not_found'); end if;
  v_today := (now() at time zone v_tz)::date;
  select coalesce(jsonb_agg(to_jsonb(x) - 'k1' - 'k2' - 'k3' order by x.k1 nulls last, x.k2 nulls last, x.k3 desc), '[]'::jsonb)
    into v_rows
  from (select a.id, a.created_at, a.exam_code, a.preferred_date, a.preferred_period, a.patient_name, a.patient_phone,
               a.patient_email, a.notes, a.status, a.slot_start, a.slot_end, a.for_other, a.other_name, a.relationship,
               a.other_minor, a.guardian_consent, a.other_consent, a.cancelled_at, a.cancelled_by, a.cancel_reason,
               a.uses_resources, a.version, a.channel,
               case when p_when = 'semana' then a.preferred_date end as k1,
               case when p_when is not null then a.slot_start end as k2,
               a.created_at as k3
        from public.appointment_requests a
        where a.clinic_id = p_clinic and a.status not in ('hold', 'expired') and a.anonymized_at is null
          and (p_when is null
               or (p_when = 'hoje' and a.preferred_date = v_today)
               or (p_when = 'semana' and a.preferred_date between v_today and v_today + 6))
        order by k1 nulls last, k2 nulls last, k3 desc
        limit case when p_when is null then 100 else 200 end) x;
  if jsonb_array_length(v_rows) > 0 then
    perform private.agenda_log_access('agenda_requests', p_clinic, null, 'lista',
                                      case when v_scope = 'central' then p_justification end);
  end if;
  return jsonb_build_object('status', 'ok', 'scope', v_scope, 'timezone', v_tz, 'today', v_today, 'requests', v_rows);
end $$;

/* ===================== 4. Bloquear mesmo assim ===================== */
-- Prévia (p_confirm nulo): quem o bloqueio atingiria e um código da lista; nada é gravado (só o registro de leitura,
-- quando a lista tem nomes). Para valer (p_confirm = o código da prévia): trava EXCLUSIVA da configuração da clínica,
-- os pedidos atingidos (FOR UPDATE, em ordem de id) e os recursos (do bloqueio e os outros dos itens atingidos, em
-- ordem crescente: §3.2); libera as reservas vencidas; refaz a lista: mudou → affected_changed (com a lista nova);
-- alguém presente, em atendimento ou com reserva em andamento → cannot_move. Senão: os "só ocupar" do período saem;
-- cada agendamento atingido solta TODOS os recursos ("todos ou nenhum", I2) e vai para remarcação, com um conflito
-- 'bloqueio_sobre_agendamento' (a lista "Para remarcar" da clínica); grava o bloqueio e os fechamentos.
create or replace function public.agenda_block_force(p_clinic uuid, p_resource uuid, p_starts timestamptz, p_ends timestamptz,
                                                     p_kind text default 'bloqueio', p_reason text default null,
                                                     p_confirm text default null)
returns jsonb
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  v_origin text := private.agenda_actor(p_clinic, 'agenda.bloquear', 'imed.agenda.operar');
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_prev_reason text := coalesce(current_setting('imed.reason', true), '');
  v_kind text := coalesce(p_kind, 'bloqueio');
  v_pac boolean;
  v_res uuid[];
  v_req uuid;
  v_hits jsonb;
  v_fp text;
  v_block uuid;
  v_items integer := 0;
  v_busy integer := 0;
  h record;
begin
  if v_origin is null or (v_origin = 'painel' and not public.has_clinic_perm(p_clinic, 'agenda.remarcar')) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts or p_ends <= now() or p_ends - p_starts > interval '400 days' then
    return jsonb_build_object('status', 'invalid_period');
  end if;
  if v_kind not in ('bloqueio', 'manutencao', 'feriado', 'folga') then return jsonb_build_object('status', 'invalid'); end if;
  if p_confirm is not null then
    -- §3.2: todo "mesmo assim" pega a trava EXCLUSIVA da clínica, depois os pedidos atingidos (em ordem de id) e por
    -- último os recursos (em ordem crescente). Quem marca, remarca, atende ou volta a ocupar espera.
    perform private.agenda_lock_config(p_clinic, true);
  end if;
  if not exists (select 1 from agenda.unit_settings u where u.clinic_id = p_clinic) then
    return jsonb_build_object('status', 'agenda_not_started');
  end if;
  if p_resource is not null and not exists (select 1 from agenda.resources r
                                            where r.id = p_resource and r.clinic_id = p_clinic and r.archived_at is null) then
    return jsonb_build_object('status', 'not_found');
  end if;
  v_res := case when p_resource is null
                then array(select r.id from agenda.resources r where r.clinic_id = p_clinic and r.archived_at is null order by r.id)
                else array[p_resource] end;
  if p_confirm is not null then
    for v_req in select distinct x.request_id from private.agenda_block_hits(p_clinic, v_res, p_starts, p_ends) x
                 where x.request_id is not null order by 1 loop
      perform 1 from public.appointment_requests a where a.id = v_req for update;
    end loop;
    perform private.agenda_lock_resources(v_res || array(
      select distinct o.resource_id from agenda.occupancy o
      join private.agenda_block_hits(p_clinic, v_res, p_starts, p_ends) x on x.item_id = o.item_id
      where o.active));
    perform private.agenda_release_expired(v_res);
  end if;
  -- quem é atingido (depois das travas, quando é para valer)
  v_pac := coalesce(v_origin = 'painel' and public.clinic_perm_scope(p_clinic, 'agenda.pacientes') = 'clinica', false);
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', x.kind, 'item_id', x.item_id, 'request_id', x.request_id, 'busy_id', x.busy_id, 'seq', x.seq,
           'status', x.status, 'request_version', x.request_version, 'starts_at', x.starts_at, 'ends_at', x.ends_at,
           'procedure_id', x.procedure_id, 'procedure', p.name, 'channel', a.channel,
           'patient', case when v_pac and x.kind = 'agendamento'
                           then private.agenda_short_name(case when a.for_other then a.other_name else a.patient_name end) end,
           'can_move', x.kind = 'ocupado' or x.status in ('confirmed', 'reschedule_requested'))
         order by x.starts_at, x.kind, coalesce(x.item_id, x.busy_id)), '[]'::jsonb)
    into v_hits
  from private.agenda_block_hits(p_clinic, v_res, p_starts, p_ends) x
  left join public.appointment_requests a on a.id = x.request_id
  left join agenda.procedures p on p.id = x.procedure_id;
  if jsonb_array_length(v_hits) > 200 then
    return jsonb_build_object('status', 'too_many', 'count', jsonb_array_length(v_hits));
  end if;
  v_fp := encode(extensions.digest(jsonb_build_object(
            'c', p_clinic, 'r', p_resource, 's', extract(epoch from p_starts), 'e', extract(epoch from p_ends), 'k', v_kind,
            'h', (select coalesce(jsonb_agg(jsonb_build_array(y ->> 'kind', coalesce(y ->> 'item_id', y ->> 'busy_id'),
                                                              y ->> 'status', y ->> 'request_version')
                                            order by y ->> 'kind', coalesce(y ->> 'item_id', y ->> 'busy_id')), '[]'::jsonb)
                  from jsonb_array_elements(v_hits) y))::text, 'sha256'), 'hex');
  if p_confirm is null then
    -- PRÉVIA: nada é gravado (só o registro de leitura, quando a lista tem nomes)
    if v_pac and exists (select 1 from jsonb_array_elements(v_hits) y where y ->> 'kind' = 'agendamento') then
      perform private.agenda_log_access('agenda_block_force', p_clinic, null, 'bloqueio');
    end if;
    return jsonb_build_object('status', 'confirm_required', 'items', v_hits, 'confirm', v_fp);
  end if;
  if v_fp <> p_confirm then
    if v_pac and exists (select 1 from jsonb_array_elements(v_hits) y where y ->> 'kind' = 'agendamento') then
      perform private.agenda_log_access('agenda_block_force', p_clinic, null, 'bloqueio');
    end if;
    return jsonb_build_object('status', 'affected_changed', 'items', v_hits, 'confirm', v_fp);
  end if;
  if exists (select 1 from jsonb_array_elements(v_hits) y where not (y ->> 'can_move')::boolean) then
    return jsonb_build_object('status', 'cannot_move', 'items', v_hits);
  end if;
  begin
    perform set_config('imed.origin', v_origin, true), set_config('imed.reason', 'bloqueio_forcado', true);
    -- 1) "só ocupar" do período: retirados
    for h in select (y ->> 'busy_id')::uuid as busy_id from jsonb_array_elements(v_hits) y where y ->> 'kind' = 'ocupado' loop
      update agenda.busy_marks b set removed_at = now(), removed_by = auth.uid() where b.id = h.busy_id and b.removed_at is null;
      update agenda.occupancy o set active = false, released_at = now(), release_reason = 'bloqueio_forcado'
      where o.busy_id = h.busy_id and o.active;
      perform private.agenda_audit(p_clinic, v_origin, 'ocupado.remover', 'busy_mark', h.busy_id::text, null, null);
      v_busy := v_busy + 1;
    end loop;
    -- 2) agendamentos: soltam TODOS os recursos do item (remarcação = "todos ou nenhum", I2) e vão para remarcação
    for h in select (y ->> 'item_id')::uuid as item_id, (y ->> 'request_id')::uuid as request_id, y ->> 'status' as status
             from jsonb_array_elements(v_hits) y where y ->> 'kind' = 'agendamento' order by 2, 1 loop
      update agenda.occupancy o set active = false, released_at = now(), release_reason = 'bloqueio_forcado'
      where o.item_id = h.item_id and o.active;
      if h.status = 'confirmed' then
        update agenda.appointment_items i set status = 'reschedule_requested', version = i.version + 1, updated_at = now()
        where i.id = h.item_id;
        perform private.agenda_history(h.request_id, h.item_id, 'confirmed', 'reschedule_requested', v_origin, p_clinic,
                                       (select a.version from public.appointment_requests a where a.id = h.request_id));
      end if;
      v_items := v_items + 1;
    end loop;
    -- 3) a situação de cada agendamento é a soma dos itens (o gatilho grava o histórico do cabeçalho)
    update public.appointment_requests a set status = private.agenda_rollup(a.id)
    where a.id in (select (y ->> 'request_id')::uuid from jsonb_array_elements(v_hits) y where y ->> 'kind' = 'agendamento')
      and a.status is distinct from private.agenda_rollup(a.id);
    -- 4) o bloqueio e os fechamentos (a restrição de exclusão confere de novo)
    insert into public.clinic_blocks (clinic_id, starts_at, ends_at, reason, resource_id, kind, created_by)
    values (p_clinic, p_starts, p_ends, left(nullif(btrim(p_reason), ''), 120), p_resource, v_kind, auth.uid())
    returning id into v_block;
    insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, block_id)
    select p_clinic, r, 'bloqueio', int4range(1, 51), tstzrange(p_starts, p_ends, '[)'), v_block from unnest(v_res) r;
    -- 5) um conflito por item: a lista "Para remarcar" da clínica
    insert into agenda.conflicts (clinic_id, kind, request_id, item_id, details)
    select p_clinic, 'bloqueio_sobre_agendamento', (y ->> 'request_id')::uuid, (y ->> 'item_id')::uuid,
           jsonb_build_object('starts_at', y ->> 'starts_at', 'procedure_id', y ->> 'procedure_id', 'block_id', v_block)
    from jsonb_array_elements(v_hits) y where y ->> 'kind' = 'agendamento'
    on conflict (kind, item_id) where status in ('aberto', 'em_andamento') and item_id is not null do nothing;
    perform private.agenda_audit(p_clinic, v_origin, 'bloqueio.criar_forcado', 'clinic_block', v_block::text, null,
      jsonb_build_object('resource_id', p_resource, 'kind', v_kind, 'starts_at', p_starts, 'ends_at', p_ends,
                         'recursos', cardinality(v_res), 'remarcar', v_items, 'ocupados_retirados', v_busy));
  exception
    when exclusion_violation then
      perform set_config('imed.origin', v_prev, true), set_config('imed.reason', v_prev_reason, true);
      return jsonb_build_object('status', 'affected_changed', 'items', '[]'::jsonb);
  end;
  perform set_config('imed.origin', v_prev, true), set_config('imed.reason', v_prev_reason, true);
  perform private.agenda_touch(p_clinic);
  return jsonb_build_object('status', 'ok', 'id', v_block, 'moved', v_items, 'busy_removed', v_busy);
end $$;

/* ===================== 5. Chegada, atendimento, concluído e falta (inclusive pelo profissional) ===================== */
-- Dono, gestor, recepção e equipe do IMED: exatamente o caminho de agenda_set_status (3.3). Profissional (escopo
-- 'propria'): só itens que usam um recurso ligado a ele e só as transições de atendimento que não voltam a ocupar
-- recurso (chegou, em atendimento, concluído, não compareceu; desfazer a falta não: volta a ocupar pelo motor).
create or replace function public.agenda_attend(p_id uuid, p_status text, p_reason text default null,
                                                p_version integer default null, p_item uuid default null)
returns jsonb
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_prev_reason text := coalesce(current_setting('imed.reason', true), '');
  v_clinic uuid;
  v_own uuid[];
  r public.appointment_requests;
  v_from text;
  v_tr agenda.status_transitions;
  v_items uuid[];
  v_start timestamptz;
  v_u agenda.unit_settings;
  v_soma text;
  v_it uuid;
begin
  if p_status is null or p_status not in ('checked_in', 'in_service', 'completed', 'no_show') then
    return jsonb_build_object('status', 'invalid_status');
  end if;
  select a.clinic_id into v_clinic from public.appointment_requests a where a.id = p_id;
  if v_clinic is null then return jsonb_build_object('status', 'not_found'); end if;
  if public.clinic_perm_scope(v_clinic, 'agenda.atender') is distinct from 'propria' then
    return private.agenda_set_status_int(p_id, p_status, p_reason, p_version, p_item);
  end if;
  -- profissional: a mesma ordem de travas de agenda_set_status (configuração compartilhada, depois o pedido)
  perform private.agenda_lock_config(v_clinic, false);
  v_own := private.agenda_own_resources(v_clinic);
  select * into r from public.appointment_requests a where a.id = p_id for update;
  if not r.uses_resources then return jsonb_build_object('status', 'not_agenda'); end if;
  if p_version is not null and p_version <> r.version then
    return jsonb_build_object('status', 'version_conflict', 'version', r.version);
  end if;
  if p_item is not null then
    select i.status into v_from from agenda.appointment_items i where i.id = p_item and i.request_id = r.id;
    if not found then return jsonb_build_object('status', 'not_found'); end if;
  else
    v_from := r.status;
  end if;
  if v_from = p_status then return jsonb_build_object('status', 'ok', 'request_status', r.status, 'unchanged', true); end if;
  select * into v_tr from agenda.status_transitions t
  where t.from_status = v_from and t.to_status = p_status and t.actor_kind = 'clinica' and t.permission = 'agenda.atender'
    and not t.needs_engine;
  if not found then return jsonb_build_object('status', 'transition_not_allowed', 'from', v_from); end if;
  select array_agg(i.id order by i.seq), min(i.starts_at) into v_items, v_start
  from agenda.appointment_items i where i.request_id = r.id and i.status = v_from and (p_item is null or i.id = p_item);
  if v_items is null or exists (
       select 1 from unnest(v_items) x (id)
       where not exists (select 1 from agenda.occupancy o
                         where o.item_id = x.id and o.resource_id = any (v_own)
                           and (o.active or o.release_reason in ('concluido', 'faltou')))) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select * into v_u from agenda.unit_settings u where u.clinic_id = r.clinic_id;
  if v_tr.time_rule = 'janela_de_chegada' and now() < v_start - make_interval(mins => coalesce(v_u.checkin_before_min, 120))
     or v_tr.time_rule = 'depois_do_inicio' and now() < v_start
     or v_tr.time_rule = 'depois_da_tolerancia' and now() < v_start + make_interval(mins => coalesce(v_u.no_show_after_min, 15)) then
    return jsonb_build_object('status', 'too_early');
  end if;
  if v_tr.requires_reason and p_reason is null then return jsonb_build_object('status', 'reason_required'); end if;
  begin
    perform set_config('imed.origin', 'painel', true), set_config('imed.reason', coalesce(p_reason, ''), true);
    perform private.agenda_reason();   -- motivo fora do formato de código: invalid_reason
    if p_status in ('completed', 'no_show') then
      update agenda.occupancy o set active = false, released_at = now(),
             release_reason = case p_status when 'completed' then 'concluido' else 'faltou' end
      where o.active and o.item_id = any (v_items);
    end if;
    update agenda.appointment_items i set status = p_status, version = i.version + 1, updated_at = now()
    where i.id = any (v_items);
    foreach v_it in array v_items loop
      perform private.agenda_history(r.id, v_it, v_from, p_status, 'painel', r.clinic_id, r.version);
    end loop;
    v_soma := private.agenda_rollup(r.id);
    update public.appointment_requests a set status = v_soma where a.id = r.id and a.status is distinct from v_soma;
  exception
    when sqlstate '22023' then
      perform set_config('imed.origin', v_prev, true), set_config('imed.reason', v_prev_reason, true);
      return jsonb_build_object('status', 'invalid_reason');
  end;
  perform set_config('imed.origin', v_prev, true), set_config('imed.reason', v_prev_reason, true);
  perform private.agenda_touch(r.clinic_id);
  return jsonb_build_object('status', 'ok', 'request_status', v_soma,
                            'version', (select a.version from public.appointment_requests a where a.id = r.id));
end $$;

/* ===================== 6. Permissões (só quem está logado; cada função confere por dentro) ===================== */
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.agenda_catalog(uuid)', 'public.agenda_free(uuid, date, integer)',
    'public.agenda_desk_slots(uuid, uuid, date, date, uuid, uuid)', 'public.agenda_blocks(uuid, date, date)',
    'public.agenda_requests(uuid, text, text)',
    'public.agenda_block_force(uuid, uuid, timestamptz, timestamptz, text, text, text)',
    'public.agenda_attend(uuid, text, text, integer, uuid)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

/* ===================== 7. Descrições ===================== */
comment on function public.agenda_catalog(uuid) is
  'Catálogo da recepção (procedimentos, recursos, prazos da unidade, feriados e o que a pessoa pode fazer), sem dado de paciente. Fase 4.2.';
comment on function public.agenda_free(uuid, date, integer) is
  'Horários livres da grade (por recurso), quando a unidade atende e os feriados do período. Sem dado de paciente. Fase 4.2.';
comment on function public.agenda_desk_slots(uuid, uuid, date, date, uuid, uuid) is
  'Horários do balcão e da remarcação pela clínica (o motor com a antecedência recuada, como agenda_desk_book). Fase 4.2.';
comment on function public.agenda_blocks(uuid, date, date) is
  'Bloqueios da clínica por função (o motivo só para quem vê a clínica inteira). Fase 4.2.';
comment on function public.agenda_requests(uuid, text, text) is
  'Pedidos da clínica para a aba Pedidos (pedidos.ver; equipe do IMED com justificativa). Leitura registrada em agenda.access_log. Fase 4.2.';
comment on function public.agenda_block_force(uuid, uuid, timestamptz, timestamptz, text, text, text) is
  'Bloquear mesmo assim: prévia (p_confirm nulo) e, com o código da prévia, bloqueio + pacientes para remarcação com conflito. Fase 4.2.';
comment on function public.agenda_attend(uuid, text, text, integer, uuid) is
  'Chegada, atendimento, concluído e falta. Clínica inteira e equipe: agenda_set_status; profissional: só na própria agenda. Fase 4.2.';
