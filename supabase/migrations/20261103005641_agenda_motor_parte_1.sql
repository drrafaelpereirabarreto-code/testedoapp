-- iMed Agenda, fase 3.2 ("Cadastros e motor de disponibilidade"), 03/11/2026. Arquitetura:
-- memory/projects/imed-agenda-arquitetura.md (§2.3, §2.4, §2.5, §3.2 itens 4 e 5, §4 e §14, item 3.2).
-- Aplicada na produção em 3 partes (supabase/migrations/<versão>_agenda_motor_parte_1 a 3), cada uma uma migração
-- própria, na ordem: esta é a parte 1 (o motor e a consulta pública). Volta única das 3 partes:
-- supabase/volta/<versão>_agenda_motor_parte_3.sql.
--
-- Em linguagem simples:
--   1. O MOTOR DE HORÁRIOS mora no banco (fonte única, para mostrar e, na 3.3, para marcar): a partir das regras da
--      clínica (abre e pausa, da unidade ou de cada aparelho/sala/profissional, por dia da semana e validade), dos
--      feriados (nacionais, da UF e da cidade, com as aberturas em feriado), dos bloqueios e da ocupação, calcula os
--      horários em que TODOS os recursos que o procedimento exige estão livres, com preparo e higienização, no fuso
--      da unidade (instantes em UTC; regras na hora local de cada dia, inclusive nos dias de horário de verão).
--   2. Consulta pública sem dado pessoal: agenda_public_info, agenda_slots (até 62 dias) e agenda_days (o mês).
--   3. Cadastros da clínica (parte 2) e as funções antigas com as mesmas assinaturas (parte 3).
--
-- "Usa a agenda nova" = a clínica tem a linha de configurações (agenda.unit_settings), criada por agenda_unit_save
-- (a dona da clínica ou a equipe do IMED; nunca sozinha). Sem essa linha a clínica continua no modo de hoje, com
-- available_slots, clinics_with_schedule, set_my_schedule, add_my_block e remove_my_block EXATAMENTE como antes.
-- Por isso não há conversão nem parada por dados antigos (hoje 0 faixas, 0 bloqueios e 0 pedidos com horário):
-- nada é convertido no escuro; a clínica com faixas antigas não entra na agenda nova enquanto não apagar as faixas
-- (agenda_unit_save responde old_schedule_exists).
--
-- Ninguém vende horário online antes da 5.1: a venda exige agenda_online_since, que só muda pelas funções da agenda
-- (nenhuma desta fase a liga) ou pela marca de emergência no SQL. Até lá os horários do motor só aparecem para a
-- própria clínica e para a equipe do IMED (pré-visualização em agenda_slots).
--
-- O que NÃO está aqui: marcar, cancelar, remarcar e balcão (3.3); painel e Realtime (3.4). Nenhum DROP, DELETE,
-- TRUNCATE nem ALTER ... DROP sobre o que existe. As funções antigas trocam de corpo (CREATE OR REPLACE, mesma
-- assinatura e mesmas permissões) e a policy de leitura dos bloqueios ganha "removed_at is null" (ALTER POLICY).
--
-- Pode rodar de novo sem erro e sem mudar nada. Conferir na produção depois de aplicar as 3 partes (tem de dar true):
--   select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'agenda\_%') = 13
--      and (select count(*) from pg_proc where pronamespace = 'private'::regnamespace and proname in ('agenda_free_map',
--             'agenda_free_starts', 'agenda_rule_windows', 'agenda_holiday_ranges', 'agenda_unit_free', 'agenda_need',
--             'agenda_floor', 'agenda_item_fits', 'agenda_revalidate', 'agenda_actor', 'agenda_lock_config',
--             'agenda_lock_resources', 'agenda_audit', 'agenda_block_add_int', 'agenda_block_remove_int',
--             'agenda_can_see_slots')) = 16
--      and has_function_privilege('anon', 'public.agenda_slots(uuid,uuid,date,date)', 'EXECUTE')
--      and not has_function_privilege('anon', 'public.agenda_unit_save(uuid,jsonb,boolean)', 'EXECUTE')
--      and has_function_privilege('anon', 'public.available_slots(uuid,text,date,integer)', 'EXECUTE')
--      and not has_function_privilege('anon', 'public.set_my_schedule(uuid,jsonb)', 'EXECUTE')
--      and (select count(*) from agenda.unit_settings) = 0;

/* ===================== 0. Limite de espera ===================== */
-- Se algo segurar um objeto por mais de 5 s, a migração desiste (55P03) e nada é aplicado: é só rodar de novo.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. Travas, quem age e auditoria ===================== */

-- Trava de configuração da clínica (§3.2, passo 1): compartilhada para quem ocupa recurso (3.3), exclusiva para quem
-- muda a configuração (regras, recursos, procedimentos, requisitos, feriados, fuso, bloqueio de unidade). Vale até o
-- fim da transação.
create or replace function private.agenda_lock_config(p_clinic uuid, p_exclusive boolean)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_exclusive then
    perform pg_advisory_xact_lock(7101, hashtext(p_clinic::text));
  else
    perform pg_advisory_xact_lock_shared(7101, hashtext(p_clinic::text));
  end if;
end $$;

-- Trava de cada recurso (§3.2, passo 3), sem repetição e em ordem crescente da chave (sem ciclo, sem impasse).
create or replace function private.agenda_lock_resources(p_resources uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  k integer;
begin
  for k in select distinct hashtext(r::text) from unnest(coalesce(p_resources, '{}')) r where r is not null order by 1 loop
    perform pg_advisory_xact_lock(7102, k);
  end loop;
end $$;

-- Quem age e de onde: 'painel' (a pessoa tem a permissão na clínica inteira), 'central' (equipe do IMED com a
-- permissão da equipe; o dono, is_imed_admin, tem todas) ou nulo (não pode).
create or replace function private.agenda_actor(p_clinic uuid, p_perm text, p_imed_perm text)
returns text
language sql stable
set search_path = ''
as $$
  select case when p_clinic is not null and public.has_clinic_perm(p_clinic, p_perm) then 'painel'
              when public.imed_has(p_imed_perm) then 'central' end;
$$;

-- Uma linha de auditoria (configuração, bloqueios, feriados). Só ids, números e códigos: nunca nome de pessoa,
-- motivo em texto livre ou dado de paciente.
create or replace function private.agenda_audit(p_clinic uuid, p_origin text, p_action text, p_object_type text,
                                                p_object_id text, p_old jsonb, p_new jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
begin
  if p_origin = 'painel' then
    select m.role into v_role from public.clinic_members m where m.clinic_id = p_clinic and m.user_id = auth.uid();
  elsif p_origin = 'central' then
    v_role := case when coalesce(public.is_imed_admin(), false) then 'imed_admin'
                   else (select 'imed_' || s.role from private.imed_staff s
                         where s.user_id = auth.uid() and s.revoked_at is null order by s.role limit 1) end;
  end if;
  insert into agenda.audit_log (clinic_id, actor_kind, actor_user, actor_role, origin, action, object_type, object_id,
                                old_value, new_value, reason_code)
  values (p_clinic,
          case p_origin when 'painel' then 'clinica' when 'central' then 'imed' when 'cron' then 'sistema' else 'sql' end,
          auth.uid(), v_role, coalesce(p_origin, 'sql'), p_action, p_object_type, p_object_id, p_old, p_new,
          private.agenda_reason());
end $$;

revoke all on function private.agenda_lock_config(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function private.agenda_lock_resources(uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.agenda_actor(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function private.agenda_audit(uuid, text, text, text, text, jsonb, jsonb) from public, anon, authenticated, service_role;

/* ===================== 2. O motor (§4) ===================== */

-- Janelas das regras (public.clinic_schedules) num intervalo, dia a dia, na hora local da unidade convertida pela
-- regra de fuso DAQUELE dia: ((dia + hora local) at time zone clinics.timezone). Fim 24:00 = meia-noite do dia
-- seguinte. Hora local que não existe (começo do horário de verão) vira o instante seguinte que existe; a janela
-- só sai se o início vier antes do fim. resource_id nulo = regra da unidade. p_procedure: regras com
-- procedure_ids vazio valem para todos; as outras, só para os procedimentos da lista.
create or replace function private.agenda_rule_windows(p_clinic uuid, p_from timestamptz, p_to timestamptz,
                                                       p_procedure uuid default null)
returns table (resource_id uuid, kind text, w tstzrange)
language sql stable
set search_path = ''
as $$
  select s.resource_id, s.kind, tstzrange(a.ini, a.fim, '[)')
  from public.clinics c
  cross join lateral generate_series(((p_from at time zone c.timezone)::date - 1)::timestamp,
                                     ((p_to at time zone c.timezone)::date + 1)::timestamp, interval '1 day') g
  join public.clinic_schedules s
    on s.clinic_id = c.id and s.weekday = extract(dow from g)::smallint
   and (s.valid_from is null or s.valid_from <= g::date) and (s.valid_to is null or s.valid_to >= g::date)
   and (cardinality(s.procedure_ids) = 0 or p_procedure = any (s.procedure_ids))
  cross join lateral (select (g::date + s.start_time) at time zone c.timezone as ini,
                             (g::date + s.end_time) at time zone c.timezone as fim) a
  where c.id = p_clinic and a.ini < a.fim and a.ini < p_to and a.fim > p_from;
$$;

-- Feriados que fecham a unidade (o dia inteiro, na hora local): nacionais, da UF da clínica e da cidade dela (pelo
-- CNES), se a unidade fecha em feriado (unit_settings.closes_on_holidays) e não marcou "abrimos neste dia".
create or replace function private.agenda_holiday_ranges(p_clinic uuid, p_from timestamptz, p_to timestamptz)
returns tstzmultirange
language sql stable
set search_path = ''
as $$
  select coalesce(range_agg(tstzrange(h.day::timestamp at time zone c.timezone,
                                      (h.day + 1)::timestamp at time zone c.timezone, '[)')), '{}'::tstzmultirange)
  from public.clinics c
  left join agenda.unit_settings u on u.clinic_id = c.id
  join agenda.holidays h
    on h.day between (p_from at time zone c.timezone)::date - 1 and (p_to at time zone c.timezone)::date + 1
   and (h.scope = 'nacional'
        or (h.scope = 'uf' and h.uf = upper(c.state))
        or (h.scope = 'municipio' and h.city_ibge = (select e.city_ibge from public.establishments e where e.cnes = c.cnes)))
  where c.id = p_clinic
    and coalesce(u.closes_on_holidays, true)
    and not exists (select 1 from agenda.holiday_openings o where o.clinic_id = c.id and o.day = h.day);
$$;

-- Quando a UNIDADE atende o paciente (para o procedimento): janelas 'abre' da unidade − pausas da unidade −
-- feriados − bloqueios da unidade inteira (clinic_blocks sem recurso e não removidos).
create or replace function private.agenda_unit_free(p_clinic uuid, p_from timestamptz, p_to timestamptz,
                                                    p_procedure uuid default null)
returns tstzmultirange
language sql stable
set search_path = ''
as $$
  with j as materialized (
    select * from private.agenda_rule_windows(p_clinic, p_from, p_to, p_procedure) x where x.resource_id is null
  )
  select coalesce((select range_agg(j.w) from j where j.kind = 'abre'), '{}'::tstzmultirange)
       - coalesce((select range_agg(j.w) from j where j.kind = 'pausa'), '{}'::tstzmultirange)
       - private.agenda_holiday_ranges(p_clinic, p_from, p_to)
       - coalesce((select range_agg(tstzrange(b.starts_at, b.ends_at, '[)'))
                   from public.clinic_blocks b
                   where b.clinic_id = p_clinic and b.resource_id is null and b.removed_at is null
                     and b.starts_at < p_to and b.ends_at > p_from), '{}'::tstzmultirange);
$$;

-- O MAPA DE LIVRES (§4): para cada recurso pedido (ativo, não arquivado) e cada vaga de 1 a capacity,
--   aberto  = janelas 'abre' do recurso (sem escala própria: as da unidade), dentro de [p_from, p_to)
--   fechado = pausas da unidade e do recurso ∪ feriados ∪ fechamentos ativos na ocupação (bloqueios de unidade e de
--             recurso)
--   ocupado = usos ativos da vaga (agendamento e "ocupado"), ignorando reserva vencida (hold_until <= p_now) e os
--             itens de p_ignore_items (a revalidação de um item não conta o próprio item)
--   livre   = aberto − fechado − ocupado (operações de multirange), calculado uma vez por chamada.
create or replace function private.agenda_free_map(p_clinic uuid, p_resources uuid[], p_from timestamptz,
                                                   p_to timestamptz, p_now timestamptz, p_procedure uuid default null,
                                                   p_ignore_items uuid[] default '{}')
returns table (resource_id uuid, seat smallint, free tstzmultirange)
language sql stable
set search_path = ''
as $$
  with jan as materialized (
    select * from private.agenda_rule_windows(p_clinic, p_from, p_to, p_procedure)
  ), unidade as materialized (
    select coalesce((select range_agg(j.w) from jan j where j.resource_id is null and j.kind = 'abre'), '{}'::tstzmultirange) as abre,
           coalesce((select range_agg(j.w) from jan j where j.resource_id is null and j.kind = 'pausa'), '{}'::tstzmultirange)
             + private.agenda_holiday_ranges(p_clinic, p_from, p_to) as fechado
  ), rec as materialized (
    select r.id, r.capacity,
           case when exists (select 1 from public.clinic_schedules s
                             where s.clinic_id = p_clinic and s.resource_id = r.id and s.kind = 'abre')
                then coalesce((select range_agg(j.w) from jan j where j.resource_id = r.id and j.kind = 'abre'), '{}'::tstzmultirange)
                else (select u.abre from unidade u) end as abre,
           coalesce((select range_agg(j.w) from jan j where j.resource_id = r.id and j.kind = 'pausa'), '{}'::tstzmultirange)
             + coalesce((select range_agg(o.during) from agenda.occupancy o
                         where o.resource_id = r.id and o.active and o.kind = 'bloqueio'
                           and o.during && tstzrange(p_from, p_to, '[)')), '{}'::tstzmultirange) as fechado
    from agenda.resources r
    where r.clinic_id = p_clinic and r.id = any (p_resources) and r.active and r.archived_at is null
  )
  select rec.id, v.seat::smallint,
         (rec.abre * tstzmultirange(tstzrange(p_from, p_to, '[)')))
         - (select u.fechado from unidade u) - rec.fechado
         - coalesce((select range_agg(o.during) from agenda.occupancy o
                     where o.resource_id = rec.id and o.active and o.kind <> 'bloqueio' and lower(o.seats) = v.seat
                       and (o.hold_until is null or o.hold_until > p_now)
                       and (o.item_id is null or o.item_id <> all (coalesce(p_ignore_items, '{}')))
                       and o.during && tstzrange(p_from, p_to, '[)')), '{}'::tstzmultirange)
  from rec
  cross join lateral generate_series(1, rec.capacity::integer) v (seat);
$$;

-- Início do bloco alinhado (recurso "chegadas"): piso na hora local da unidade (align divide 60).
create or replace function private.agenda_floor(p_t timestamptz, p_align integer, p_tz text)
returns timestamptz
language sql stable
set search_path = ''
as $$
  select (date_trunc('hour', l) + make_interval(mins => (extract(minute from l)::integer / p_align) * p_align)) at time zone p_tz
  from (select p_t at time zone p_tz as l) x;
$$;

-- O intervalo que um grupo de requisito ocupa num recurso para um início t:
-- [t + offset − preparo, t + offset + duração do grupo + higienização); "chegadas" com align_min: o bloco alinhado
-- [piso(t + offset), piso + align) com o preparo e a higienização do recurso em volta.
create or replace function private.agenda_need(p_t timestamptz, p_offset integer, p_dur integer, p_align integer,
                                               p_setup integer, p_cleanup integer, p_tz text)
returns tstzrange
language sql stable
set search_path = ''
as $$
  select case when p_align is null
    then tstzrange(p_t + make_interval(mins => p_offset - p_setup), p_t + make_interval(mins => p_offset + p_dur + p_cleanup), '[)')
    else (select tstzrange(b - make_interval(mins => p_setup), b + make_interval(mins => p_align + p_cleanup), '[)')
          from (select private.agenda_floor(p_t + make_interval(mins => p_offset), p_align, p_tz) as b) x)
  end;
$$;

-- OS INÍCIOS LIVRES de um procedimento entre dois dias (na hora local da unidade), §4:
--   candidatos: de passo em passo a partir do começo de cada janela 'abre' da unidade (instantes em série
--   crescente: a hora repetida no fim do horário de verão não duplica, a que não existe não aparece);
--   t vale se:
--    · t >= agora + antecedência mínima e t < agora + antecedência máxima (do procedimento ou da unidade);
--    · o dia de t não passa de holidays_checked_until (a clínica conferiu os feriados da cidade e do estado) nem do
--      último ano com feriados nacionais lançados (sem isso, nenhum horário: nunca vender num feriado não lançado);
--    · [t, t + duração) cabe no aberto da unidade (sem pausas, feriados e bloqueios de unidade);
--    · para CADA grupo de requisito existe ALGUM recurso permitido e ALGUMA vaga com o intervalo do grupo livre
--      (grupos disjuntos: a conferência por grupo é exata).
-- Procedimento sem requisito não tem horário. Clínica sem unit_settings também não.
create or replace function private.agenda_free_starts(p_clinic uuid, p_procedure uuid, p_from date, p_to date,
                                                      p_now timestamptz default now(), p_ignore_items uuid[] default '{}')
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql stable
set search_path = ''
as $$
declare
  v_tz text;
  v_u agenda.unit_settings;
  v_p agenda.procedures;
  v_nacional date;
  v_ini timestamptz;
  v_fim timestamptz;
  v_res uuid[];
  v_dur interval;
  v_step interval;
begin
  if p_from is null or p_to is null or p_to < p_from then return; end if;
  select c.timezone into v_tz from public.clinics c where c.id = p_clinic;
  if v_tz is null then return; end if;
  select * into v_u from agenda.unit_settings us where us.clinic_id = p_clinic;
  if not found or v_u.holidays_checked_until is null then return; end if;
  select * into v_p from agenda.procedures pr
  where pr.id = p_procedure and pr.clinic_id = p_clinic and pr.active and pr.archived_at is null;
  if not found then return; end if;
  select (date_trunc('year', max(h.day)) + interval '1 year' - interval '1 day')::date into v_nacional
  from agenda.holidays h where h.scope = 'nacional';
  if v_nacional is null then return; end if;

  v_ini := greatest(p_from::timestamp at time zone v_tz,
                    p_now + make_interval(mins => coalesce(v_p.min_notice_min, v_u.min_notice_min)));
  v_fim := least((least(p_to, v_u.holidays_checked_until, v_nacional) + 1)::timestamp at time zone v_tz,
                 p_now + make_interval(days => coalesce(v_p.max_advance_days, v_u.max_advance_days)::integer));
  if v_ini >= v_fim then return; end if;
  if not exists (select 1 from agenda.procedure_requirements g where g.procedure_id = v_p.id) then return; end if;
  v_dur := make_interval(mins => v_p.duration_min);
  v_step := make_interval(mins => coalesce(v_p.step_min, v_u.step_min));
  select array_agg(distinct o.resource_id) into v_res from agenda.requirement_options o where o.procedure_id = v_p.id;

  return query
  with mapa as materialized (
    select * from private.agenda_free_map(p_clinic, v_res, v_ini - interval '1 day', v_fim + interval '1 day', p_now,
                                          v_p.id, p_ignore_items)
  ), opc as materialized (
    select g.group_no, g.offset_min::integer as off, coalesce(g.duration_min, v_p.duration_min)::integer as dur,
           g.align_min::integer as al, o.resource_id as rid, r.setup_min::integer as setup, r.cleanup_min::integer as cleanup
    from agenda.procedure_requirements g
    join agenda.requirement_options o on o.requirement_id = g.id
    join agenda.resources r on r.id = o.resource_id and r.active and r.archived_at is null
    where g.procedure_id = v_p.id
  ), grupos as materialized (
    select g.group_no from agenda.procedure_requirements g where g.procedure_id = v_p.id
  ), unidade as materialized (
    select private.agenda_unit_free(p_clinic, v_ini - interval '1 day', v_fim + interval '1 day', v_p.id) as livre
  ), cand as materialized (
    select distinct t.t
    from private.agenda_rule_windows(p_clinic, v_ini, v_fim, v_p.id) w
    cross join lateral generate_series(lower(w.w), upper(w.w) - v_dur, v_step) t (t)
    where w.resource_id is null and w.kind = 'abre' and t.t >= v_ini and t.t < v_fim
      and (select u.livre from unidade u) @> tstzrange(t.t, t.t + v_dur, '[)')
  )
  select c.t, c.t + v_dur
  from cand c
  where not exists (
    select 1 from grupos gr
    where not exists (
      select 1 from opc o join mapa m on m.resource_id = o.rid
      where o.group_no = gr.group_no
        and m.free @> private.agenda_need(c.t, o.off, o.dur, o.al, o.setup, o.cleanup, v_tz)))
  order by c.t;
end $$;

-- Um item ativo ainda cabe na configuração de hoje? (revalidação, §3.2 item 5: regras, pausas, feriados, preparo,
-- higienização e durações não viram ocupação). Cabe se [início, fim) do item está no aberto da unidade e, para cada
-- grupo gravado na marcação, o recurso que ele usa ainda é opção do grupo e o intervalo que o grupo pede HOJE está
-- livre na vaga dele (sem contar o próprio item).
create or replace function private.agenda_item_fits(p_item uuid)
returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  v_i agenda.appointment_items;
  v_tz text;
  v_dur integer;
begin
  select * into v_i from agenda.appointment_items it where it.id = p_item;
  if not found then return true; end if;
  select c.timezone into v_tz from public.clinics c where c.id = v_i.clinic_id;
  select pr.duration_min into v_dur from agenda.procedures pr where pr.id = v_i.procedure_id;
  if not private.agenda_unit_free(v_i.clinic_id, v_i.starts_at - interval '1 day', v_i.ends_at + interval '1 day',
                                  v_i.procedure_id) @> tstzrange(v_i.starts_at, v_i.ends_at, '[)') then
    return false;
  end if;
  return not exists (
    select 1 from unnest(v_i.groups) gn (g)
    where not exists (
      select 1
      from agenda.occupancy o
      join agenda.procedure_requirements rq on rq.procedure_id = v_i.procedure_id and rq.group_no = o.group_no
      join agenda.requirement_options op on op.requirement_id = rq.id and op.resource_id = o.resource_id
      join agenda.resources r on r.id = o.resource_id
      cross join lateral private.agenda_free_map(v_i.clinic_id, array[o.resource_id], v_i.starts_at - interval '1 day',
                                                 v_i.ends_at + interval '1 day', now(), v_i.procedure_id, array[v_i.id]) m
      where o.item_id = v_i.id and o.group_no = gn.g and o.active and o.kind = 'agendamento'
        and m.seat = lower(o.seats)
        and m.free @> private.agenda_need(v_i.starts_at, rq.offset_min, coalesce(rq.duration_min, v_dur), rq.align_min,
                                          r.setup_min, r.cleanup_min, v_tz)));
end $$;

-- Revalida os itens ativos futuros da clínica (com ocupação ativa) contra a configuração de hoje. Devolve os que
-- deixaram de caber (só ids e horários, sem dado de paciente); com p_open, abre um conflito 'grade_mudou' para cada
-- um (no máximo um aberto por item). Chamada pelas funções de cadastro DEPOIS de mudar, sob a trava exclusiva.
create or replace function private.agenda_revalidate(p_clinic uuid, p_open boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v jsonb := '[]'::jsonb;
  r record;
begin
  for r in
    select i.id, i.request_id, i.starts_at, i.procedure_id
    from agenda.appointment_items i
    where i.clinic_id = p_clinic and i.ends_at > now()
      and i.status in ('hold', 'awaiting_payment', 'confirmed', 'checked_in', 'in_service', 'reschedule_requested')
      and exists (select 1 from agenda.occupancy o where o.item_id = i.id and o.active)
    order by i.starts_at, i.id
  loop
    if not private.agenda_item_fits(r.id) then
      if jsonb_array_length(v) < 200 then
        v := v || jsonb_build_array(jsonb_build_object('item_id', r.id, 'request_id', r.request_id,
                                                       'starts_at', r.starts_at, 'procedure_id', r.procedure_id));
      end if;
      if p_open then
        insert into agenda.conflicts (clinic_id, kind, request_id, item_id, details)
        values (p_clinic, 'grade_mudou', r.request_id, r.id,
                jsonb_build_object('starts_at', r.starts_at, 'procedure_id', r.procedure_id))
        on conflict (kind, item_id) where status in ('aberto', 'em_andamento') and item_id is not null do nothing;
      end if;
    end if;
  end loop;
  return v;
end $$;

revoke all on function private.agenda_rule_windows(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function private.agenda_holiday_ranges(uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.agenda_unit_free(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function private.agenda_free_map(uuid, uuid[], timestamptz, timestamptz, timestamptz, uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.agenda_floor(timestamptz, integer, text) from public, anon, authenticated, service_role;
revoke all on function private.agenda_need(timestamptz, integer, integer, integer, integer, integer, text) from public, anon, authenticated, service_role;
revoke all on function private.agenda_free_starts(uuid, uuid, date, date, timestamptz, uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.agenda_item_fits(uuid) from public, anon, authenticated, service_role;
revoke all on function private.agenda_revalidate(uuid, boolean) from public, anon, authenticated, service_role;

/* ===================== 3. Consulta pública (sem dado pessoal) ===================== */

-- Quem vê os horários deste procedimento? Qualquer pessoa, se a clínica vende horário online agora (publicada,
-- aceita pedidos, não é fictícia, usa a agenda nova, ligou a venda) e o procedimento está à venda; ou quem é da
-- clínica (agenda.ver) ou da equipe do IMED (pré-visualização da configuração, inclusive antes de ligar a venda).
create or replace function private.agenda_can_see_slots(p_clinic uuid, p_procedure uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (select 1 from public.clinics c
                 join agenda.unit_settings u on u.clinic_id = c.id
                 join agenda.procedures p on p.clinic_id = c.id and p.id = p_procedure
                 where c.id = p_clinic and c.status = 'published' and c.accepts_online_booking and not c.is_demo
                   and c.agenda_online_since is not null and p.online_booking and p.active and p.archived_at is null)
      or (auth.uid() is not null
          and exists (select 1 from agenda.unit_settings u where u.clinic_id = p_clinic)
          and exists (select 1 from agenda.procedures p where p.clinic_id = p_clinic and p.id = p_procedure)
          and (public.has_clinic_perm(p_clinic, 'agenda.ver') or public.imed_has('imed.agenda.monitor')));
$$;
revoke all on function private.agenda_can_see_slots(uuid, uuid) from public, anon, authenticated, service_role;

-- O que o paciente precisa saber antes de marcar, com texto honesto por modalidade. Procedimentos (nome, duração,
-- preço ou "sob consulta", preparo) só quando a clínica vende horário online.
create or replace function public.agenda_public_info(p_clinic uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c public.clinics;
  u agenda.unit_settings;
  v_online boolean;
begin
  select * into c from public.clinics x where x.id = p_clinic and x.status = 'published' and not x.is_demo;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into u from agenda.unit_settings s where s.clinic_id = p_clinic;
  v_online := u.clinic_id is not null and c.accepts_online_booking and c.agenda_online_since is not null;
  return jsonb_build_object(
    'status', 'ok',
    'clinic_id', c.id,
    'timezone', c.timezone,
    'mode', c.agenda_mode,
    'mode_text', case c.agenda_mode
      when 'nativa' then 'A clínica usa a agenda do IMED: os horários mostrados são os livres na agenda dela agora.'
      when 'manual' then 'A clínica registra os agendamentos dela na agenda do IMED. Em caso de dúvida, confirme com a clínica.'
      when 'externa' then 'A agenda é a do sistema da própria clínica; o IMED mostra os horários que esse sistema informa.'
      else 'Você envia um pedido e a clínica ou a equipe do IMED entra em contato para combinar o horário.' end,
    'online', v_online,
    'online_text', case when v_online then 'Escolha um horário livre e confirme.'
                        else 'Esta clínica ainda não marca horário pelo site.' end,
    'payment', 'no_local',
    'payment_text', 'Pagamento no local, direto com a clínica.',
    'cancel_until_min', case when v_online then u.patient_cancel_until_min end,
    'reschedule_until_min', case when v_online then u.patient_reschedule_until_min end,
    'procedures', case when not v_online then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'exam_code', p.exam_code, 'name', p.name, 'duration_min', p.duration_min,
               'price_cents', p.price_cents,
               'price_text', case when p.price_cents is null then 'sob consulta' end,
               'prep_text', p.patient_prep_text, 'fasting_hours', p.fasting_hours) order by p.exam_code, p.name)
      from agenda.procedures p
      where p.clinic_id = p_clinic and p.active and p.archived_at is null and p.online_booking
        and exists (select 1 from agenda.procedure_requirements g where g.procedure_id = p.id)), '[]'::jsonb) end);
end $$;
revoke all on function public.agenda_public_info(uuid) from public, anon, authenticated;
grant execute on function public.agenda_public_info(uuid) to anon, authenticated;

-- Horários livres de um procedimento entre dois dias (hora local da unidade; padrão: hoje e os próximos 13 dias;
-- no máximo 62 dias e 2000 horários). Público só quando a clínica vende online; a clínica e a equipe do IMED veem a
-- pré-visualização. Nada de quem marcou.
create or replace function public.agenda_slots(p_clinic uuid, p_procedure uuid, p_from date default null, p_to date default null)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql stable security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  v_tz text;
  v_from date;
  v_to date;
begin
  if p_clinic is null or p_procedure is null or not private.agenda_can_see_slots(p_clinic, p_procedure) then return; end if;
  select c.timezone into v_tz from public.clinics c where c.id = p_clinic;
  v_from := coalesce(p_from, (now() at time zone v_tz)::date);
  v_to := least(coalesce(p_to, v_from + 13), v_from + 61);
  return query select s.slot_start, s.slot_end from private.agenda_free_starts(p_clinic, p_procedure, v_from, v_to, now()) s
               order by 1 limit 2000;
end $$;
revoke all on function public.agenda_slots(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public.agenda_slots(uuid, uuid, date, date) to anon, authenticated;

-- O calendário do mês: por dia (hora local da unidade), quantos horários livres e o primeiro. Até 62 dias.
create or replace function public.agenda_days(p_clinic uuid, p_procedure uuid, p_from date default null, p_to date default null)
returns table (day date, livres integer, primeiro timestamptz)
language plpgsql stable security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  v_tz text;
  v_from date;
  v_to date;
begin
  if p_clinic is null or p_procedure is null or not private.agenda_can_see_slots(p_clinic, p_procedure) then return; end if;
  select c.timezone into v_tz from public.clinics c where c.id = p_clinic;
  v_from := coalesce(p_from, (now() at time zone v_tz)::date);
  v_to := least(coalesce(p_to, v_from + 30), v_from + 61);
  return query
    select (s.slot_start at time zone v_tz)::date, count(*)::integer, min(s.slot_start)
    from private.agenda_free_starts(p_clinic, p_procedure, v_from, v_to, now()) s
    group by 1 order by 1;
end $$;
revoke all on function public.agenda_days(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public.agenda_days(uuid, uuid, date, date) to anon, authenticated;

comment on function private.agenda_free_map(uuid, uuid[], timestamptz, timestamptz, timestamptz, uuid, uuid[]) is
  'Mapa de livres por recurso e vaga (arquitetura §4): aberto − fechado − ocupado, sem reserva vencida.';
comment on function private.agenda_free_starts(uuid, uuid, date, date, timestamptz, uuid[]) is
  'Inícios livres de um procedimento (arquitetura §4): fonte única para mostrar (3.2) e marcar (3.3).';
comment on function public.agenda_slots(uuid, uuid, date, date) is
  'Horários livres de um procedimento (até 62 dias). Público só com a venda online ligada; a clínica e a equipe do IMED veem a pré-visualização.';
