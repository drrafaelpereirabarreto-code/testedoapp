-- VOLTA da parte 1 de 2 da migração agenda_leitura (iMed Agenda, fase 4.2; só se for preciso desfazer). Tem o mesmo
-- nome da migração da parte 1: se ela for renomeada, renomeie esta também. Cada parte tem a própria volta (as 2 partes
-- vão para a produção em dias diferentes, decisão 4.2-g): se a parte 2 (o fechamento) estiver aplicada, rode ANTES a
-- volta dela (supabase/volta/<versão>_agenda_leitura_parte_2.sql). Testada no CI (banco.yml): depois das voltas a
-- impressão digital é IGUAL à da produção antes da 4.2; reaplicadas as 2 partes, igual à com elas. Bloqueios,
-- conflitos, situações e registros de leitura gravados pelas funções novas ficam (são dados).
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

-- o gatilho que tira da lista "Para remarcar" o item que saiu da remarcação (conflitos já fechados ficam: são dados)
drop trigger if exists appointment_items_fecha_conflitos on agenda.appointment_items;
drop function if exists private.agenda_conflicts_close();
-- agenda_reschedule volta a ser a da 3.3 (20261103053814_agenda_operacao_parte_2.sql), igual, letra por letra
create or replace function public.agenda_reschedule(p_id uuid, p_items jsonb, p_token text default null, p_key uuid default null,
                                                    p_version integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_prev_reason text := coalesce(current_setting('imed.reason', true), '');
  r public.appointment_requests;
  c public.clinics;
  v_u agenda.unit_settings;
  v_actor text;
  v_origin text;
  v_idem_actor text;
  v_fp text;
  v_idem agenda.idempotency;
  v_novo jsonb;
  v_antigo jsonb;
  v_res uuid[];
  v_it record;
  v_prefer uuid[];
  v_now timestamptz;
  v_falha integer;
  v_out jsonb;
  v_local timestamp;
  v_antes jsonb;
  v_pref jsonb := '{}'::jsonb;
begin
  if p_id is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 4
     or exists (select 1 from jsonb_array_elements(p_items) x where private.agenda_unknown_keys(x.value, array['seq', 'starts_at'])) then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into r from public.appointment_requests a where a.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if p_token is not null and (r.review_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')) is true then
    v_actor := 'paciente';
    v_idem_actor := r.review_token_hash;
  elsif r.clinic_id is not null and public.has_clinic_perm(r.clinic_id, 'agenda.remarcar') then
    v_actor := 'clinica';
  elsif public.imed_has('imed.agenda.operar') then
    v_actor := 'imed';
  elsif (r.user_id = auth.uid()) is true then
    v_actor := 'paciente';
  else
    return jsonb_build_object('status', 'forbidden');
  end if;
  v_idem_actor := coalesce(v_idem_actor, auth.uid()::text);
  v_origin := case v_actor when 'paciente' then 'app' when 'clinica' then 'painel' else 'central' end;
  if not r.uses_resources then return jsonb_build_object('status', 'not_agenda'); end if;
  begin
    select jsonb_agg(jsonb_build_object('seq', (x.value ->> 'seq')::integer, 'starts_at', (x.value ->> 'starts_at')::timestamptz)
                     order by (x.value ->> 'seq')::integer)
      into v_novo from jsonb_array_elements(p_items) x;
  exception when others then
    return jsonb_build_object('status', 'invalid');
  end;
  if p_key is not null and v_idem_actor is not null then
    v_fp := encode(extensions.digest(jsonb_build_object('r', p_id, 'i', v_novo)::text, 'sha256'), 'hex');
    insert into agenda.idempotency (scope, actor, key, fingerprint) values ('agenda_reschedule', v_idem_actor, p_key, v_fp)
    on conflict (scope, actor, key) do nothing;
    if not found then
      select * into v_idem from agenda.idempotency i where i.scope = 'agenda_reschedule' and i.actor = v_idem_actor and i.key = p_key;
      if v_idem.fingerprint <> v_fp then return jsonb_build_object('status', 'idempotency_conflict'); end if;
      return coalesce(v_idem.result, '{}'::jsonb) || jsonb_build_object('replay', true);
    end if;
  end if;

  -- §6, passos 1 e 2: configuração (compartilhada), o pedido, a versão e o prazo do paciente
  perform private.agenda_lock_config(r.clinic_id, false);
  select * into r from public.appointment_requests a where a.id = p_id for update;
  select * into c from public.clinics x where x.id = r.clinic_id;
  select * into v_u from agenda.unit_settings u where u.clinic_id = r.clinic_id;
  if p_version is not null and p_version <> r.version then
    v_out := jsonb_build_object('status', 'version_conflict', 'version', r.version);
  elsif r.status not in ('confirmed', 'reschedule_requested') then
    v_out := jsonb_build_object('status', 'transition_not_allowed', 'request_status', r.status);
  elsif exists (select 1 from jsonb_array_elements(v_novo) x
                where not exists (select 1 from agenda.appointment_items i where i.request_id = r.id and i.seq = (x.value ->> 'seq')::integer
                                    and i.status in ('confirmed', 'reschedule_requested'))
                   or x.value ->> 'starts_at' is null) then
    v_out := jsonb_build_object('status', 'invalid');
  elsif v_actor = 'paciente' and r.slot_start - make_interval(mins => coalesce(v_u.patient_reschedule_until_min, 120)) <= now() then
    v_out := jsonb_build_object('status', 'too_late');
  elsif v_actor = 'paciente' and not (c.status = 'published' and c.accepts_online_booking and not c.is_demo and c.agenda_online_since is not null) then
    v_out := jsonb_build_object('status', 'not_online');
  end if;
  -- o pacote com os horários novos (os itens não citados ficam onde estão)
  if v_out is null then
    select jsonb_agg(jsonb_build_object('seq', i.seq, 'procedure_id', i.procedure_id,
                                        'starts_at', coalesce((n.value ->> 'starts_at')::timestamptz, i.starts_at),
                                        'ends_at', coalesce((n.value ->> 'starts_at')::timestamptz, i.starts_at) + (i.ends_at - i.starts_at),
                                        'move', n.value is not null) order by i.seq)
      into v_antigo
    from agenda.appointment_items i
    left join jsonb_array_elements(v_novo) n on (n.value ->> 'seq')::integer = i.seq
    where i.request_id = r.id and i.status in ('confirmed', 'reschedule_requested');
    if jsonb_array_length(v_antigo) > 1 and private.agenda_package_check(r.clinic_id, v_antigo) is not null then
      v_out := jsonb_build_object('status', 'invalid_package');
    end if;
  end if;
  if v_out is not null then
    if p_key is not null then
      update agenda.idempotency i set result = v_out where i.scope = 'agenda_reschedule' and i.actor = v_idem_actor and i.key = p_key;
    end if;
    return v_out;
  end if;

  -- §6, passo 3: travas dos recursos (antigos e novos são as mesmas alternativas) e reservas vencidas
  v_res := private.agenda_candidates(array(select i.procedure_id from agenda.appointment_items i where i.request_id = r.id));
  perform private.agenda_lock_resources(v_res);
  perform private.agenda_release_expired(v_res);

  -- §6, passos 4 e 5: solta o antigo e grava o novo, preferindo os mesmos recursos; tudo ou nada
  v_antes := jsonb_build_object('slot_start', r.slot_start, 'slot_end', r.slot_end,
               'items', (select jsonb_agg(jsonb_build_object('seq', i.seq, 'starts_at', i.starts_at) order by i.seq)
                         from agenda.appointment_items i where i.request_id = r.id));
  begin
    perform set_config('imed.origin', v_origin, true), set_config('imed.reason', 'remarcado', true);
    for v_it in select (x.value ->> 'seq')::integer as seq, (x.value ->> 'starts_at')::timestamptz as t,
                       (x.value ->> 'ends_at')::timestamptz as e, (x.value ->> 'procedure_id')::uuid as pid
                from jsonb_array_elements(v_antigo) x where (x.value ->> 'move')::boolean order by 1 loop
      v_pref := v_pref || jsonb_build_object(v_it.seq::text, (
        select coalesce(jsonb_agg(o.resource_id), '[]'::jsonb) from agenda.occupancy o join agenda.appointment_items i on i.id = o.item_id
        where i.request_id = r.id and i.seq = v_it.seq and o.active));
      update agenda.occupancy o set active = false, released_at = now(), release_reason = 'remarcado'
      where o.active and o.item_id = (select i.id from agenda.appointment_items i where i.request_id = r.id and i.seq = v_it.seq);
    end loop;
    for v_it in select (x.value ->> 'seq')::integer as seq, (x.value ->> 'starts_at')::timestamptz as t,
                       (x.value ->> 'ends_at')::timestamptz as e, (x.value ->> 'procedure_id')::uuid as pid
                from jsonb_array_elements(v_antigo) x where (x.value ->> 'move')::boolean order by 1 loop
      v_falha := v_it.seq;
      v_now := case when v_actor = 'paciente' then now()
                    else now() - make_interval(mins => coalesce((select p.min_notice_min from agenda.procedures p where p.id = v_it.pid),
                                                                v_u.min_notice_min)) end;
      if not private.agenda_start_ok(r.clinic_id, v_it.pid, v_it.t, v_now, c.timezone) then
        raise exception 'slot_taken' using errcode = 'IMA03';
      end if;
      -- prefere os recursos de antes
      v_prefer := array(select x::uuid from jsonb_array_elements_text(coalesce(v_pref -> v_it.seq::text, '[]'::jsonb)) x);
      update agenda.appointment_items i set starts_at = v_it.t, ends_at = v_it.e, local_start = v_it.t at time zone c.timezone,
             tz = c.timezone, status = 'confirmed', version = i.version + 1, updated_at = now()
      where i.request_id = r.id and i.seq = v_it.seq;
      perform private.agenda_place((select i.id from agenda.appointment_items i where i.request_id = r.id and i.seq = v_it.seq),
                                   null, v_prefer);
    end loop;
    update agenda.appointment_items i set status = 'confirmed', version = i.version + 1, updated_at = now()
    where i.request_id = r.id and i.status = 'reschedule_requested'
      and exists (select 1 from agenda.occupancy o where o.item_id = i.id and o.active);
    v_local := (select min(i.starts_at) from agenda.appointment_items i
                where i.request_id = r.id and private.agenda_active_status(i.status)) at time zone c.timezone;
    update public.appointment_requests a set
      slot_start = (select min(i.starts_at) from agenda.appointment_items i where i.request_id = r.id and private.agenda_active_status(i.status)),
      slot_end = (select max(i.ends_at) from agenda.appointment_items i where i.request_id = r.id and private.agenda_active_status(i.status)),
      preferred_date = v_local::date,
      preferred_period = case when v_local::time < '12:00' then 'manha' when v_local::time < '18:00' then 'tarde' else 'noite' end,
      status = private.agenda_rollup(r.id)
    where a.id = r.id;
    insert into agenda.audit_log (clinic_id, actor_kind, actor_user, actor_role, origin, action, object_type, object_id,
                                  old_value, new_value, reason_code)
    values (r.clinic_id, case v_actor when 'paciente' then 'paciente' when 'clinica' then 'clinica' else 'imed' end, auth.uid(),
            private.agenda_actor_role(r.clinic_id, v_origin), v_origin, 'agendamento.remarcar', 'appointment_request', r.id::text,
            v_antes,
            jsonb_build_object('items', (select jsonb_agg(jsonb_build_object('seq', x.value ->> 'seq', 'starts_at', x.value ->> 'starts_at'))
                                         from jsonb_array_elements(v_antigo) x where (x.value ->> 'move')::boolean),
                               'slot_start', (select a.slot_start from public.appointment_requests a where a.id = r.id)),
            'remarcado');
  exception
    when sqlstate 'IMA03' or exclusion_violation then
      v_out := jsonb_build_object('status', 'slot_taken', 'seq', v_falha,
                 'alternatives', private.agenda_alternatives(r.clinic_id,
                   (select (x.value ->> 'procedure_id')::uuid from jsonb_array_elements(v_antigo) x where (x.value ->> 'seq')::integer = v_falha),
                   (select (x.value ->> 'starts_at')::timestamptz from jsonb_array_elements(v_antigo) x where (x.value ->> 'seq')::integer = v_falha),
                   now()));
  end;
  perform set_config('imed.origin', v_prev, true), set_config('imed.reason', v_prev_reason, true);
  if v_out is null then
    v_out := jsonb_build_object('status', 'ok', 'id', r.id,
               'request_status', (select a.status from public.appointment_requests a where a.id = r.id),
               'items', (select jsonb_agg(jsonb_build_object('seq', i.seq, 'starts_at', i.starts_at, 'ends_at', i.ends_at) order by i.seq)
                         from agenda.appointment_items i where i.request_id = r.id));
  end if;
  if p_key is not null then
    update agenda.idempotency i set result = v_out where i.scope = 'agenda_reschedule' and i.actor = v_idem_actor and i.key = p_key;
  end if;
  if v_out ->> 'status' = 'ok' then perform private.agenda_touch(r.clinic_id); end if;
  return v_out;
end $$;

-- agenda_request_detail volta a ser a da 3.4 (20261103181553_agenda_painel_parte_1.sql), igual, letra por letra
create or replace function public.agenda_request_detail(p_id uuid, p_justification text default null)
returns jsonb
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_scope text;
  v_full boolean;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'forbidden'); end if;
  select * into r from public.appointment_requests a where a.id = p_id;
  if not found or r.clinic_id is null then return jsonb_build_object('status', 'not_found'); end if;
  v_scope := public.clinic_perm_scope(r.clinic_id, 'agenda.pacientes');
  if v_scope = 'propria' and not private.agenda_request_on(r.id, private.agenda_own_resources(r.clinic_id)) then
    v_scope := null;
  end if;
  if v_scope is null or v_scope not in ('clinica', 'propria') then
    if public.imed_has('imed.pacientes.ver') then
      if p_justification is null or p_justification !~ '^[a-z][a-z0-9_]{2,59}$' or p_justification ~ '[0-9]{4,}' then
        return jsonb_build_object('status', 'justification_required');
      end if;
      v_scope := 'central';
    else
      return jsonb_build_object('status', 'forbidden');
    end if;
  end if;
  -- reserva expirada: some do painel da clínica (como na leitura direta); fica só para a equipe do IMED
  if r.status = 'expired' and v_scope <> 'central' then
    return jsonb_build_object('status', 'not_found');
  end if;
  v_full := v_scope in ('clinica', 'central');
  perform private.agenda_log_access('agenda_request_detail', r.clinic_id, r.id, v_scope,
                                    case when v_scope = 'central' then p_justification end);
  return jsonb_build_object(
    'status', 'ok', 'scope', v_scope, 'id', r.id, 'clinic_id', r.clinic_id, 'request_status', r.status,
    'version', r.version, 'agenda', r.uses_resources, 'channel', r.channel, 'created_at', r.created_at,
    'exam_code', r.exam_code, 'preferred_date', r.preferred_date, 'preferred_period', r.preferred_period,
    'slot_start', r.slot_start, 'slot_end', r.slot_end, 'hold_expires_at', r.hold_expires_at,
    'cancel_reason', r.cancel_reason, 'cancelled_by', r.cancelled_by, 'cancelled_at', r.cancelled_at,
    'anonymized', r.anonymized_at is not null,
    'patient', jsonb_build_object(
      'name', r.patient_name,
      'phone', case when v_full then r.patient_phone end,
      'email', case when v_full then r.patient_email end,
      'for_other', r.for_other, 'other_name', r.other_name, 'relationship', r.relationship, 'other_minor', r.other_minor,
      'notes', case when v_full then r.notes end),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', i.id, 'seq', i.seq, 'procedure_id', i.procedure_id, 'procedure', p.name,
                         'exam_code', i.exam_code, 'starts_at', i.starts_at, 'ends_at', i.ends_at, 'status', i.status,
                         'version', i.version, 'price_cents', i.price_cents,
                         'resources', (select coalesce(jsonb_agg(jsonb_build_object('id', rs.id, 'name', rs.name, 'kind', rs.kind)
                                                                 order by o.group_no), '[]'::jsonb)
                                       from agenda.occupancy o join agenda.resources rs on rs.id = o.resource_id
                                       where o.item_id = i.id and (o.active or o.release_reason in ('concluido', 'faltou'))))
                       order by i.seq)
                       from agenda.appointment_items i join agenda.procedures p on p.id = i.procedure_id
                       where i.request_id = r.id), '[]'::jsonb),
    'notes', case when v_full then coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'text', n.text,
                                                                             'created_at', n.created_at) order by n.created_at)
                                         from agenda.notes n where n.request_id = r.id and n.deleted_at is null), '[]'::jsonb)
                  else '[]'::jsonb end);
end $$;

drop function if exists public.agenda_attend(uuid, text, text, integer, uuid);
drop function if exists public.agenda_block_force(uuid, uuid, timestamptz, timestamptz, text, text, text);
drop function if exists public.agenda_requests(uuid, text, text);
drop function if exists public.agenda_blocks(uuid, date, date);
drop function if exists public.agenda_desk_slots(uuid, uuid, date, date, uuid, uuid);
drop function if exists public.agenda_free(uuid, date, integer);
drop function if exists public.agenda_catalog(uuid);
drop function if exists private.agenda_national_until();
drop function if exists private.agenda_block_hits(uuid, uuid[], timestamptz, timestamptz);
drop function if exists private.agenda_justification_ok(text);
-- a chave do registro de leitura volta a ser a da 3.1 (sem o motivo), mas só se nenhuma leitura já gravada ficar
-- repetida nela (a trilha não se apaga): se ficar, a chave com o motivo continua (ela só separa mais as linhas, e a
-- função de registro da 3.4 usa o mesmo nome de chave).
do $$
begin
  if (select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conrelid = 'agenda.access_log'::regclass and c.conname = 'access_log_uq') like '%justification_code%' then
    if exists (select 1 from agenda.access_log l
               group by l.day, l.user_id, l.clinic_id, l.fn, l.request_id, l.scope having count(*) > 1) then
      raise notice 'agenda.access_log: há leituras do mesmo dia com motivos diferentes; a chave com o motivo fica (nada é apagado)';
    else
      alter table agenda.access_log drop constraint access_log_uq,
        add constraint access_log_uq unique nulls not distinct (day, user_id, clinic_id, fn, request_id, scope);
    end if;
  end if;
end $$;
