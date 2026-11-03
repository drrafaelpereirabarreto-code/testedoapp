-- iMed Agenda, fase 3.3 ("Marcar, cancelar, remarcar e balcão"), 03/11/2026. Arquitetura:
-- memory/projects/imed-agenda-arquitetura.md (§2.3, §3.2, §3.3, §5, §6, §12, §13 e §14, item 3.3).
-- Aplicada na produção em 4 partes (supabase/migrations/<versão>_agenda_operacao_parte_1 a 4), cada uma uma migração
-- própria, na ordem: esta é a parte 1 (o alocador, as conferências no COMMIT, a manutenção e o fim do caminho antigo
-- com horário). Volta única das 4 partes: supabase/volta/<versão>_agenda_operacao_parte_4.sql.
--
-- Em linguagem simples:
--   1. MARCAR passa a ser só pelas funções da agenda (parte 2): elas travam a configuração da clínica e cada aparelho,
--      sala ou profissional que podem usar (sempre na mesma ordem: ninguém fica esperando o outro em roda), soltam as
--      reservas vencidas desses recursos, conferem o horário com o motor da 3.2 e gravam o agendamento, os itens (um
--      por exame) e a OCUPAÇÃO de cada recurso. A restrição de exclusão da 3.1 é a última palavra: dois usos do mesmo
--      recurso no mesmo horário nunca entram, por nenhum caminho.
--   2. No COMMIT, três conferências (gatilhos adiados, "I2" da arquitetura) recusam a transação se um agendamento ativo
--      ficou sem a ocupação de algum recurso, se um encerrado ainda segura recurso ou se o cabeçalho não bate com os
--      itens. Valem para qualquer caminho de escrita, inclusive o SQL de emergência.
--   3. Manutenção a cada 30 s (pg_cron imed-agenda-manutencao): reserva temporária vencida vira "expirada" e solta os
--      recursos (lotes de 50, com COMMIT entre eles); idempotência com mais de 7 dias e contadores com mais de 48 h saem.
--   4. O CAMINHO ANTIGO COM HORÁRIO ACABA: o INSERT direto com horário (slot_start) é recusado com 23P01 e a mensagem de
--      sempre ("Este horário não está mais livre. Escolha outro."); a grade antiga não mostra mais horários
--      (available_slots e clinics_with_schedule só respondem pela agenda nova, que ninguém vende online antes da 5.1);
--      o editor antigo (set_my_schedule) só apaga as faixas antigas e responde managed_by_agenda para gravar.
--      Conferido na produção em 03/11/2026: 0 faixas antigas, 0 pedidos com horário, 0 clínicas na agenda nova.
--      O PEDIDO SEM HORÁRIO (concierge e parceiros no modo de pedido) continua IGUAL.
--   5. Leitura direta dos pedidos: a clínica e a equipe não veem reserva temporária nem reserva expirada (são da
--      integração e do pagamento); o INSERT direto só cria pedido "pending".
--
-- O que é destrutivo (tirar o índice appointment_requests_slot_uq e trocar as restrições de situação, de quem cancelou
-- e do motivo de liberar a ocupação) está SÓ na parte 4, pequena, aplicada por último.
--
-- Pode rodar de novo sem erro e sem mudar nada. Conferir na produção depois de aplicar as 4 partes (tem de dar true):
--   select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'agenda\_%') = 25
--      and (select count(*) from cron.job where jobname = 'imed-agenda-manutencao' and schedule = '30 seconds') = 1
--      and (select count(*) from pg_trigger where tgname in ('appointment_items_i2', 'occupancy_i2', 'appointment_requests_i2')
--             and tgdeferrable and tginitdeferred and tgenabled = 'A') = 3
--      and to_regclass('public.appointment_requests_slot_uq') is null
--      and has_function_privilege('anon', 'public.agenda_book(uuid,jsonb,jsonb,uuid,text)', 'EXECUTE')
--      and not has_function_privilege('anon', 'public.agenda_hold(uuid,jsonb,jsonb,uuid,text)', 'EXECUTE')
--      and not has_function_privilege('authenticated', 'public.agenda_confirm(uuid)', 'EXECUTE');

/* ===================== 0. Limite de espera ===================== */
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. Referências ===================== */
-- A integração solta a reserva que o sistema da clínica recusou (agenda_release).
insert into agenda.status_transitions (from_status, to_status, actor_kind, permission, requires_reason, time_rule, needs_engine)
values ('hold', 'cancelled', 'integracao', null, false, null, false)
on conflict (from_status, to_status, actor_kind) do nothing;

/* ===================== 2. Apoio ===================== */

-- Situações que seguram recurso (com reschedule_requested: "todas ou nenhuma").
create or replace function private.agenda_active_status(p_status text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_status in ('hold', 'awaiting_payment', 'confirmed', 'checked_in', 'in_service', 'reschedule_requested');
$$;

-- A situação do cabeçalho é a soma dos itens (§5): a mais "viva" vence; sem item vivo, concluído se algum foi
-- concluído, senão faltou, senão expirado (só expirados e cancelados), senão cancelado.
create or replace function private.agenda_rollup(p_request uuid)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when bool_or(i.status = 'in_service') then 'in_service'
    when bool_or(i.status = 'checked_in') then 'checked_in'
    when bool_or(i.status = 'confirmed') then 'confirmed'
    when bool_or(i.status = 'reschedule_requested') then 'reschedule_requested'
    when bool_or(i.status = 'awaiting_payment') then 'awaiting_payment'
    when bool_or(i.status = 'hold') then 'hold'
    when bool_or(i.status = 'completed') then 'completed'
    when bool_or(i.status = 'no_show') then 'no_show'
    when bool_and(i.status in ('expired', 'cancelled')) and bool_or(i.status = 'expired') then 'expired'
    when count(*) > 0 then 'cancelled'
  end
  from agenda.appointment_items i where i.request_id = p_request;
$$;

-- Papel de quem age, para as trilhas (como agenda_audit da 3.2).
create or replace function private.agenda_actor_role(p_clinic uuid, p_origin text)
returns text
language sql stable
set search_path = ''
as $$
  select case p_origin
    when 'painel' then (select m.role from public.clinic_members m where m.clinic_id = p_clinic and m.user_id = auth.uid())
    when 'central' then case when coalesce(public.is_imed_admin(), false) then 'imed_admin'
                             else (select 'imed_' || s.role from private.imed_staff s
                                   where s.user_id = auth.uid() and s.revoked_at is null order by s.role limit 1) end
  end;
$$;

-- Uma linha no histórico (o gatilho appointment_requests_hist cobre as mudanças de situação do cabeçalho; esta cobre
-- o nascimento do agendamento e as mudanças de cada item). Só códigos.
create or replace function private.agenda_history(p_request uuid, p_item uuid, p_from text, p_to text, p_origin text,
                                                  p_clinic uuid, p_version integer)
returns void
language sql
set search_path = ''
as $$
  insert into agenda.status_history (request_id, item_id, from_status, to_status, actor_kind, actor_user, actor_role,
                                     origin, reason_code, request_version)
  values (p_request, p_item, p_from, p_to,
          case p_origin when 'app' then 'paciente' when 'painel' then 'clinica' when 'central' then 'imed'
                        when 'api' then 'integracao' when 'webhook_pagamento' then 'gateway' when 'cron' then 'sistema'
                        else 'sql' end,
          auth.uid(), private.agenda_actor_role(p_clinic, p_origin), p_origin, private.agenda_reason(), p_version);
$$;

-- Contador por janela de 1 hora (limites e alertas contra abuso, §3.2 item 10): "upsert ... returning n" serializa no
-- próprio contador. A chave é "<limite>:<uuid ou SHA-256>"; nunca telefone, e-mail ou IP em claro.
create or replace function private.agenda_count(p_key text)
returns integer
language sql
set search_path = ''
as $$
  insert into agenda.rate_counters as rc (key, window_start, n)
  values (p_key, date_trunc('hour', now()), 1)
  on conflict (key, window_start) do update set n = rc.n + 1
  returning rc.n;
$$;

-- Parâmetro global (agenda.settings_global; vazia até a decisão 25 do dono: vale o padrão da arquitetura).
create or replace function private.agenda_setting_int(p_key text, p_default integer)
returns integer
language sql stable
set search_path = ''
as $$
  select coalesce((select (s.value #>> '{}')::integer from agenda.settings_global s
                   where s.key = p_key and jsonb_typeof(s.value) = 'number'), p_default);
$$;

-- Recursos que podem atender os procedimentos (as alternativas de todos os grupos), para travar antes de planejar.
create or replace function private.agenda_candidates(p_procedures uuid[])
returns uuid[]
language sql stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct o.resource_id order by o.resource_id), '{}')
  from agenda.requirement_options o where o.procedure_id = any (p_procedures);
$$;

/* ===================== 3. Reserva vencida e expiração ===================== */

-- Expira UMA reserva (hold ou awaiting_payment) cujo prazo + carência passou: solta a ocupação, itens e cabeçalho viram
-- "expired". Trava o pedido com SKIP LOCKED (quem está confirmando ou marcando não é esperado: §3.3, I5) e confere o
-- prazo de novo depois de travar. Devolve true se expirou. Quem chama faz o agenda_touch da clínica.
create or replace function private.agenda_expire(p_request uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_grace integer;
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_prev_reason text := coalesce(current_setting('imed.reason', true), '');
begin
  select * into r from public.appointment_requests a
  where a.id = p_request and a.status in ('hold', 'awaiting_payment')
  for update skip locked;
  if not found then return false; end if;
  select coalesce(u.payment_grace_min, 0) into v_grace from agenda.unit_settings u where u.clinic_id = r.clinic_id;
  if r.hold_expires_at is null or r.hold_expires_at + make_interval(mins => coalesce(v_grace, 0)) > now() then
    return false;
  end if;
  perform set_config('imed.origin', 'cron', true), set_config('imed.reason', 'reserva_expirada', true);
  update agenda.occupancy o set active = false, released_at = now(), release_reason = 'expirada'
  where o.active and o.item_id in (select i.id from agenda.appointment_items i where i.request_id = r.id);
  update agenda.appointment_items i set status = 'expired', version = i.version + 1, updated_at = now()
  where i.request_id = r.id and i.status in ('hold', 'awaiting_payment');
  update public.appointment_requests a set status = 'expired', hold_expires_at = null, cancel_reason = 'reserva_expirada'
  where a.id = r.id;
  perform set_config('imed.origin', v_prev, true), set_config('imed.reason', v_prev_reason, true);
  return true;
end $$;

-- Liberação preguiçosa (§3.2, passo 4): antes de planejar, quem já segura as travas destes recursos expira as reservas
-- vencidas que ocupam algum deles (a restrição de exclusão não olha o relógio). Devolve quantas expirou.
create or replace function private.agenda_release_expired(p_resources uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_req uuid;
  v_n integer := 0;
begin
  for v_req in
    select distinct i.request_id
    from agenda.occupancy o join agenda.appointment_items i on i.id = o.item_id
    where o.resource_id = any (p_resources) and o.active and o.hold_until is not null and o.hold_until <= now()
    order by 1
  loop
    if private.agenda_expire(v_req) then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- A rotina do pg_cron (a cada 30 s): expira as reservas vencidas em lotes de 50, com COMMIT entre os lotes (por isso
-- é PROCEDURE, chamada com CALL, e sem SET: procedimento com SET não pode dar COMMIT; todos os nomes vão com o schema).
-- Não pega trava de agenda: só SKIP LOCKED nos pedidos e o touch da clínica no fim de cada lote. Depois, a retenção:
-- idempotência com mais de 7 dias e contadores com mais de 48 h (arquitetura §12).
create or replace procedure private.agenda_manutencao()
language plpgsql
as $$
declare
  v_ids uuid[];
  v_clinics uuid[];
  v_id uuid;
  v_c uuid;
  v_n integer;
  v_lote integer := 0;
begin
  loop
    v_lote := v_lote + 1;
    exit when v_lote > 40;
    perform pg_catalog.set_config('lock_timeout', '2s', true);
    select pg_catalog.array_agg(x.id order by x.venc), pg_catalog.array_agg(x.clinic_id order by x.venc)
      into v_ids, v_clinics
    from (select a.id, a.clinic_id, a.hold_expires_at + pg_catalog.make_interval(mins => coalesce(u.payment_grace_min, 0)::integer) as venc
          from public.appointment_requests a
          left join agenda.unit_settings u on u.clinic_id = a.clinic_id
          where a.status in ('hold', 'awaiting_payment')
            and a.hold_expires_at + pg_catalog.make_interval(mins => coalesce(u.payment_grace_min, 0)::integer) <= pg_catalog.now()
          order by 3
          limit 50) x;
    exit when v_ids is null;
    v_n := 0;
    for i in 1 .. pg_catalog.cardinality(v_ids) loop
      if private.agenda_expire(v_ids[i]) then
        v_n := v_n + 1;
      else
        v_clinics[i] := null;
      end if;
    end loop;
    for v_c in select distinct c from pg_catalog.unnest(v_clinics) c where c is not null order by 1 loop
      perform private.agenda_touch(v_c);
    end loop;
    commit;
    exit when v_n = 0 or pg_catalog.cardinality(v_ids) < 50;
  end loop;
  delete from agenda.idempotency where ctid in (
    select ctid from agenda.idempotency where created_at < pg_catalog.now() - interval '7 days' limit 5000);
  delete from agenda.rate_counters where ctid in (
    select ctid from agenda.rate_counters where window_start < pg_catalog.now() - interval '48 hours' limit 5000);
  commit;
end $$;

/* ===================== 4. O alocador ===================== */

-- O início t vale para o procedimento (o motor da 3.2: antecedência, regras, pausas, feriados, bloqueios e algum
-- recurso livre em cada grupo)? p_now é o "agora" do motor: o balcão usa agora − antecedência mínima (marca para
-- daqui a pouco), o paciente usa agora.
create or replace function private.agenda_start_ok(p_clinic uuid, p_procedure uuid, p_t timestamptz, p_now timestamptz, p_tz text)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (select 1
                 from private.agenda_free_starts(p_clinic, p_procedure, (p_t at time zone p_tz)::date,
                                                 (p_t at time zone p_tz)::date, p_now) s
                 where s.slot_start = p_t);
$$;

-- Grava a ocupação de UM item: para cada grupo do procedimento, o primeiro recurso permitido (os de p_prefer primeiro,
-- depois a prioridade da clínica) com uma vaga livre no intervalo que o grupo pede (o mapa da 3.2, que já vê o que
-- esta transação gravou), e grava na menor vaga livre. Sem vaga em algum grupo: erro IMA03 (vira slot_taken).
-- Quem chama já pegou as travas da clínica e dos recursos (§3.2, passos 1 a 4).
create or replace function private.agenda_place(p_item uuid, p_hold_until timestamptz, p_prefer uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_i agenda.appointment_items;
  v_p agenda.procedures;
  g record;
  v_rid uuid;
  v_seat smallint;
  v_need tstzrange;
begin
  select * into v_i from agenda.appointment_items it where it.id = p_item;
  select * into v_p from agenda.procedures pr where pr.id = v_i.procedure_id;
  for g in select * from agenda.procedure_requirements rq where rq.procedure_id = v_p.id and rq.group_no = any (v_i.groups)
           order by rq.group_no loop
    v_rid := null;
    select o.resource_id, m.seat, n.need into v_rid, v_seat, v_need
    from agenda.requirement_options o
    join agenda.resources r on r.id = o.resource_id and r.active and r.archived_at is null
    cross join lateral (select private.agenda_need(v_i.starts_at, g.offset_min, coalesce(g.duration_min, v_p.duration_min)::integer,
                                                   g.align_min, r.setup_min, r.cleanup_min, v_i.tz) as need) n
    cross join lateral private.agenda_free_map(v_i.clinic_id, array[o.resource_id], v_i.starts_at - interval '1 day',
                                               v_i.starts_at + interval '2 days', now(), v_p.id) m
    where o.requirement_id = g.id and m.free @> n.need
    order by (o.resource_id = any (coalesce(p_prefer, '{}'))) desc, o.priority, o.resource_id, m.seat
    limit 1;
    if v_rid is null then
      raise exception 'slot_taken' using errcode = 'IMA03', detail = v_i.seq::text;
    end if;
    insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, item_id, group_no, hold_until)
    values (v_i.clinic_id, v_rid, 'agendamento', int4range(v_seat, v_seat + 1), v_need, v_i.id, g.group_no, p_hold_until);
  end loop;
end $$;

-- Conferência rápida, só pela ocupação (sem regras): para algum grupo do procedimento, NENHUM recurso permitido tem
-- uma vaga sem uso ativo e sem fechamento no intervalo que o grupo pede? Então o horário já foi pego, e quem espera na
-- fila do recurso responde slot_taken sem rodar o motor inteiro (sob concorrência, a fila anda em milissegundos).
-- Se a conferência rápida passa, o motor completo (agenda_start_ok + agenda_place) decide.
create or replace function private.agenda_quick_taken(p_procedure uuid, p_t timestamptz, p_tz text)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1
    from agenda.procedure_requirements g
    join agenda.procedures p on p.id = g.procedure_id
    where g.procedure_id = p_procedure
      and not exists (
        select 1
        from agenda.requirement_options o
        join agenda.resources r on r.id = o.resource_id and r.active and r.archived_at is null
        cross join lateral (select private.agenda_need(p_t, g.offset_min, coalesce(g.duration_min, p.duration_min)::integer,
                                                       g.align_min, r.setup_min, r.cleanup_min, p_tz) as need) n
        cross join lateral generate_series(1, r.capacity::integer) v (seat)
        where o.requirement_id = g.id
          and not exists (select 1 from agenda.occupancy x
                          where x.resource_id = o.resource_id and x.active and x.during && n.need
                            and (x.hold_until is null or x.hold_until > now())
                            and (x.kind = 'bloqueio' or lower(x.seats) = v.seat))));
$$;

-- Horários livres de outra hora, para oferecer quando o escolhido acabou de ser pego (até 5, do mesmo dia: quem perdeu
-- o horário responde ainda dentro da fila do recurso, então a conta é curta). Só horários (nada de quem marcou).
create or replace function private.agenda_alternatives(p_clinic uuid, p_procedure uuid, p_t timestamptz, p_now timestamptz)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.slot_start order by x.slot_start), '[]'::jsonb)
  from (select s.slot_start
        from public.clinics c
        cross join lateral private.agenda_free_starts(p_clinic, p_procedure, (p_t at time zone c.timezone)::date,
                                                      (p_t at time zone c.timezone)::date, p_now) s
        where c.id = p_clinic
        order by s.slot_start
        limit 5) x;
$$;

-- Os itens pedidos (1 a 4) respeitam o pacote? Sem se cruzar, com o intervalo do paciente (patient_gap_min) e as
-- regras de par da clínica: ordem, intervalo mínimo e "não no mesmo dia". p_items: [{procedure_id, starts_at,
-- ends_at}]. Devolve nulo se está tudo certo, ou o código do problema.
create or replace function private.agenda_package_check(p_clinic uuid, p_items jsonb)
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v_gap integer;
  v_tz text;
  a record;
  b record;
begin
  select coalesce(u.patient_gap_min, 0), c.timezone into v_gap, v_tz
  from public.clinics c left join agenda.unit_settings u on u.clinic_id = c.id where c.id = p_clinic;
  for a in select (x ->> 'procedure_id')::uuid as p, (x ->> 'starts_at')::timestamptz as s, (x ->> 'ends_at')::timestamptz as e
           from jsonb_array_elements(p_items) x loop
    for b in select (x ->> 'procedure_id')::uuid as p, (x ->> 'starts_at')::timestamptz as s, (x ->> 'ends_at')::timestamptz as e
             from jsonb_array_elements(p_items) x loop
      continue when a.p = b.p and a.s = b.s;
      -- a antes de b: b começa depois do fim de a + o intervalo (o do paciente ou o da regra de par, o maior)
      if a.s <= b.s and b.s < a.e + make_interval(mins => greatest(v_gap, coalesce((
           select max(r.min_gap_min) from agenda.procedure_pair_rules r
           where r.first_procedure = a.p and r.second_procedure = b.p and r.rule = 'intervalo_min'), 0))) then
        return 'invalid_package';
      end if;
      if exists (select 1 from agenda.procedure_pair_rules r
                 where r.first_procedure = a.p and r.second_procedure = b.p and r.rule = 'ordem') and not a.s < b.s then
        return 'invalid_package';
      end if;
      if exists (select 1 from agenda.procedure_pair_rules r
                 where r.first_procedure = a.p and r.second_procedure = b.p and r.rule = 'nao_mesmo_dia')
         and (a.s at time zone v_tz)::date = (b.s at time zone v_tz)::date then
        return 'invalid_package';
      end if;
    end loop;
  end loop;
  return null;
end $$;

/* ===================== 5. Conferências no COMMIT (I2, §3.3) ===================== */

-- Item: em hold, awaiting_payment, confirmed, checked_in ou in_service, exatamente um uso ativo por grupo gravado na
-- marcação (e nenhum fora deles); em reschedule_requested, todos ou nenhum; nas demais situações, nenhum.
create or replace function private.agenda_check_item(p_item uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_i agenda.appointment_items;
  v_n integer;
  v_grupos smallint[];
begin
  select * into v_i from agenda.appointment_items it where it.id = p_item;
  if not found then return; end if;
  select count(*), coalesce(array_agg(distinct o.group_no order by o.group_no), '{}')
    into v_n, v_grupos
  from agenda.occupancy o where o.item_id = p_item and o.active and o.kind = 'agendamento';
  if v_i.status in ('hold', 'awaiting_payment', 'confirmed', 'checked_in', 'in_service')
       and not (v_n = cardinality(v_i.groups) and v_grupos = (select array_agg(distinct g order by g) from unnest(v_i.groups) g))
     or v_i.status = 'reschedule_requested'
       and not (v_n = 0 or (v_n = cardinality(v_i.groups) and v_grupos = (select array_agg(distinct g order by g) from unnest(v_i.groups) g)))
     or not private.agenda_active_status(v_i.status) and v_n > 0 then
    raise exception 'agenda_i2: o item % (situação %) tem % uso(s) ativo(s) para os grupos %', v_i.id, v_i.status, v_n, v_i.groups
      using errcode = '23514', hint = 'Itens e ocupação só mudam juntos, pelas funções da agenda (arquitetura §3.3, I2).';
  end if;
end $$;

-- Cabeçalho: agendamento do motor novo (uses_resources) tem itens e a situação é a soma deles; pedido sem o motor não
-- tem itens; e, em clínica fora do modo de pedido, situação ativa com horário exige o motor novo.
create or replace function private.agenda_check_request(p_request uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_soma text;
begin
  select * into r from public.appointment_requests a where a.id = p_request;
  if not found then return; end if;
  if r.uses_resources then
    v_soma := private.agenda_rollup(r.id);
    if v_soma is null or v_soma <> r.status then
      raise exception 'agenda_i2: o agendamento % está "%" e os itens somam "%"', r.id, r.status, coalesce(v_soma, 'nenhum item')
        using errcode = '23514';
    end if;
  else
    if exists (select 1 from agenda.appointment_items i where i.request_id = r.id) then
      raise exception 'agenda_i2: o pedido % tem itens sem ser do motor novo (uses_resources)', r.id using errcode = '23514';
    end if;
    if r.slot_start is not null and private.agenda_active_status(r.status)
       and exists (select 1 from public.clinics c where c.id = r.clinic_id and c.agenda_mode <> 'pedido') then
      raise exception 'agenda_i2: horário em clínica com agenda só pelo motor novo (pedido %)', r.id using errcode = '23514';
    end if;
  end if;
end $$;

create or replace function private.agenda_i2_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'appointment_items' then
    perform private.agenda_check_item(new.id);
    perform private.agenda_check_request(new.request_id);
  elsif tg_table_name = 'occupancy' then
    if tg_op = 'DELETE' then
      if old.item_id is not null then perform private.agenda_check_item(old.item_id); end if;
    elsif new.item_id is not null then
      perform private.agenda_check_item(new.item_id);
    end if;
  else
    perform private.agenda_check_request(new.id);
  end if;
  return null;
end $$;

revoke all on function private.agenda_active_status(text) from public, anon, authenticated, service_role;
revoke all on function private.agenda_rollup(uuid) from public, anon, authenticated, service_role;
revoke all on function private.agenda_actor_role(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.agenda_history(uuid, uuid, text, text, text, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function private.agenda_count(text) from public, anon, authenticated, service_role;
revoke all on function private.agenda_setting_int(text, integer) from public, anon, authenticated, service_role;
revoke all on function private.agenda_candidates(uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.agenda_expire(uuid) from public, anon, authenticated, service_role;
revoke all on function private.agenda_release_expired(uuid[]) from public, anon, authenticated, service_role;
revoke all on procedure private.agenda_manutencao() from public, anon, authenticated, service_role;
revoke all on function private.agenda_start_ok(uuid, uuid, timestamptz, timestamptz, text) from public, anon, authenticated, service_role;
revoke all on function private.agenda_place(uuid, timestamptz, uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.agenda_alternatives(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.agenda_quick_taken(uuid, timestamptz, text) from public, anon, authenticated, service_role;
revoke all on function private.agenda_package_check(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.agenda_check_item(uuid) from public, anon, authenticated, service_role;
revoke all on function private.agenda_check_request(uuid) from public, anon, authenticated, service_role;
revoke all on function private.agenda_i2_trigger() from public, anon, authenticated, service_role;

-- Gatilhos adiados (só no COMMIT; CREATE OR REPLACE não vale para gatilho de restrição: cria se não existe). ALWAYS:
-- valem também com session_replication_role = replica, como as outras guardas da agenda.
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'agenda.appointment_items'::regclass and tgname = 'appointment_items_i2') then
    create constraint trigger appointment_items_i2
      after insert or update on agenda.appointment_items
      deferrable initially deferred
      for each row execute function private.agenda_i2_trigger();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'agenda.occupancy'::regclass and tgname = 'occupancy_i2') then
    create constraint trigger occupancy_i2
      after insert or update of active, item_id, group_no or delete on agenda.occupancy
      deferrable initially deferred
      for each row execute function private.agenda_i2_trigger();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.appointment_requests'::regclass and tgname = 'appointment_requests_i2') then
    create constraint trigger appointment_requests_i2
      after insert or update of status, uses_resources, slot_start, clinic_id on public.appointment_requests
      deferrable initially deferred
      for each row execute function private.agenda_i2_trigger();
  end if;
end $$;
alter table agenda.appointment_items enable always trigger appointment_items_i2;
alter table agenda.occupancy enable always trigger occupancy_i2;
alter table public.appointment_requests enable always trigger appointment_requests_i2;

/* ===================== 6. O caminho antigo com horário acaba ===================== */

-- Gatilho do pedido: igual ao da 3.1, menos o horário no caminho antigo (sem a marca imed.origin): recusado com o
-- 23P01 e a mensagem de sempre (o site no ar reconhece: geo-core.js, isSlotTaken). Horário agora só pelas funções da
-- agenda (agenda_book e as outras), com a marca.
create or replace function public.check_appointment_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
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
    if new.slot_start is not null then
      raise exception 'Este horário não está mais livre. Escolha outro.' using errcode = '23P01',
        hint = 'Horário só pelas funções da agenda (agenda_book), desde a fase 3.3.';
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
revoke execute on function public.check_appointment_request() from public, anon, authenticated;

-- Horários livres (público). Só a agenda nova, com a venda online ligada (a grade antiga não oferece mais horário:
-- o horário que ela mostrasse seria recusado no envio). Mesma assinatura e permissões.
create or replace function public.available_slots(p_clinic uuid, p_exam text default null, p_from date default null, p_days integer default 14)
returns table (slot_start timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_from date;
begin
  select c.timezone into v_tz from public.clinics c
  join agenda.unit_settings u on u.clinic_id = c.id
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

-- Clínica com agenda? Só a agenda nova com a venda online ligada e algum procedimento à venda.
create or replace function public.clinics_with_schedule(p_ids uuid[])
returns table (clinic_id uuid)
language sql stable security definer
set search_path = ''
as $$
  select c.id from public.clinics c
  join agenda.unit_settings u on u.clinic_id = c.id
  where c.id = any (p_ids[1:300]) and c.status = 'published' and c.accepts_online_booking and not c.is_demo
    and c.agenda_online_since is not null
    and exists (select 1 from agenda.procedures p
                where p.clinic_id = c.id and p.active and p.archived_at is null and p.online_booking);
$$;
revoke execute on function public.clinics_with_schedule(uuid[]) from public;
grant execute on function public.clinics_with_schedule(uuid[]) to anon, authenticated;

-- Editor antigo de horários: só apaga as faixas antigas (lista vazia: ok); gravar faixa nova responde
-- managed_by_agenda (os horários vêm dos cadastros da agenda nova, agenda_rules_set).
create or replace function public.set_my_schedule(p_clinic uuid, p_rows jsonb)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if not (public.is_clinic_member(p_clinic) or public.is_imed_admin()) then return 'forbidden'; end if;
  perform private.agenda_lock_config(p_clinic, true);
  if exists (select 1 from agenda.unit_settings u where u.clinic_id = p_clinic)
     or jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) > 0 then
    return 'managed_by_agenda';
  end if;
  delete from public.clinic_schedules where clinic_id = p_clinic;
  return 'ok';
end $$;
revoke execute on function public.set_my_schedule(uuid, jsonb) from public, anon;
grant execute on function public.set_my_schedule(uuid, jsonb) to authenticated;

/* ===================== 7. Leitura e INSERT diretos dos pedidos ===================== */
alter policy "qualquer pessoa pede agendamento" on public.appointment_requests
  with check (consent and status = 'pending');
alter policy "clinica ve pedidos para ela" on public.appointment_requests
  using (clinic_id is not null and public.is_clinic_member(clinic_id) and status not in ('hold', 'expired'));
alter policy "admin le pedidos" on public.appointment_requests
  using (public.is_imed_admin() and status not in ('hold', 'expired'));

/* ===================== 8. Manutenção a cada 30 s ===================== */
select cron.schedule('imed-agenda-manutencao', '30 seconds', 'call private.agenda_manutencao()');

/* ===================== 9. Descrições ===================== */
comment on function public.available_slots(uuid, text, date, integer) is
  'Horários livres (público): só a agenda nova (agenda_free_starts) com a venda online ligada. Desde a 3.3 a grade antiga não oferece horário.';
comment on function public.set_my_schedule(uuid, jsonb) is
  'Editor antigo de horários: só apaga as faixas antigas (lista vazia). Gravar responde managed_by_agenda (regras novas: agenda_rules_set).';
comment on procedure private.agenda_manutencao() is
  'pg_cron imed-agenda-manutencao (30 s): expira reservas vencidas em lotes de 50 (COMMIT entre lotes) e apaga idempotência (7 dias) e contadores (48 h).';
