-- iMed Agenda, fase 3.2 ("Cadastros e motor de disponibilidade"): parte 2 de 3 (os cadastros). O cabeçalho, com o
-- que a migração faz e as conferências, está na parte 1 (<versão>_agenda_motor_parte_1.sql).
--
-- Funções de cadastro (só quem tem agenda.configurar na clínica inteira, ou a equipe do IMED com
-- imed.clinicas.configurar; feriados: imed.feriados.editar; bloqueios: agenda.bloquear ou imed.agenda.operar).
-- Todas respondem jsonb com "status": ok, forbidden, not_found, invalid, agenda_not_started, ... e:
--   - pegam a trava EXCLUSIVA de configuração da clínica (§3.2, passo 1) antes de ler o que vão mudar (bloqueio de
--     um recurso só: a compartilhada, mais a trava do recurso);
--   - mudam, e na MESMA transação revalidam os agendamentos futuros com o motor (§3.2, item 5). Se algum deixa de
--     caber e p_confirm não é true, NADA fica gravado e a resposta é affects_appointments com a lista (ids e
--     horários, sem dado de paciente); com p_confirm = true, grava e abre um conflito 'grade_mudou' para cada um;
--   - gravam a auditoria (agenda.audit_log: ids, números e códigos; nunca nome de pessoa nem texto livre) e sobem a
--     versão da agenda da clínica (agenda_touch, a última instrução).

/* ===================== 0. Limite de espera ===================== */
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 4. Apoio ===================== */

-- Erro do banco → status da resposta (só erros de dado, classe 22, e de restrição, classe 23).
create or replace function private.agenda_err(p_state text, p_constraint text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_constraint in ('resources_nome_uq', 'procedures_nome_uq') then 'duplicate_name'
    when p_constraint = 'procedures_padrao_uq' then 'default_exists'
    when p_constraint = 'requirement_options_grupos_disjuntos_uq' then 'resource_in_two_groups'
    when p_constraint = 'holidays_uq' then 'duplicate'
    when p_state = '23P01' then 'has_appointments'
    when p_state = '23503' then 'invalid_reference'
    else 'invalid' end;
$$;

-- Itens ativos futuros da clínica (os que seguram horário).
create or replace function private.agenda_has_future_items(p_clinic uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (select 1 from agenda.appointment_items i
                 where i.clinic_id = p_clinic and i.ends_at > now()
                   and i.status in ('hold', 'awaiting_payment', 'confirmed', 'checked_in', 'in_service', 'reschedule_requested'));
$$;

-- Chaves de um objeto jsonb fora da lista (para recusar erro de digitação em vez de ignorar em silêncio).
create or replace function private.agenda_unknown_keys(p_obj jsonb, p_allowed text[])
returns boolean
language sql immutable
set search_path = ''
as $$
  select jsonb_typeof(p_obj) <> 'object' or exists (select 1 from jsonb_object_keys(p_obj) k where k <> all (p_allowed));
$$;

revoke all on function private.agenda_err(text, text) from public, anon, authenticated, service_role;
revoke all on function private.agenda_has_future_items(uuid) from public, anon, authenticated, service_role;
revoke all on function private.agenda_unknown_keys(jsonb, text[]) from public, anon, authenticated, service_role;

/* ===================== 5. Unidade ===================== */
-- Cria (na primeira vez: é o que coloca a clínica na agenda nova) ou muda as configurações da unidade, o fuso e a
-- confirmação do fuso. p_settings: step_min, min_notice_min, max_advance_days, holidays_checked_until, hold_minutes,
-- payment_grace_min, patient_cancel_until_min, patient_reschedule_until_min, checkin_before_min, no_show_after_min,
-- patient_gap_min, closes_on_holidays, timezone, confirm_timezone. Clínica com faixas do editor antigo:
-- old_schedule_exists (apague as faixas antigas antes; nada é convertido no escuro). Trocar o fuso com a venda online
-- ligada (online_active) ou com agendamentos futuros (has_appointments) é recusado.
create or replace function public.agenda_unit_save(p_clinic uuid, p_settings jsonb, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := private.agenda_actor(p_clinic, 'agenda.configurar', 'imed.clinicas.configurar');
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_s jsonb := coalesce(p_settings, '{}'::jsonb);
  v_campos text[] := array['step_min', 'min_notice_min', 'max_advance_days', 'holidays_checked_until', 'hold_minutes',
                           'payment_grace_min', 'patient_cancel_until_min', 'patient_reschedule_until_min',
                           'checkin_before_min', 'no_show_after_min', 'patient_gap_min', 'closes_on_holidays'];
  v_c public.clinics;
  v_old agenda.unit_settings;
  v_new agenda.unit_settings;
  v_tz text;
  v_confirma boolean;
  v_afetados jsonb := '[]'::jsonb;
  v_state text;
  v_cons text;
begin
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  if private.agenda_unknown_keys(v_s, v_campos || array['timezone', 'confirm_timezone']) then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform private.agenda_lock_config(p_clinic, true);
  select * into v_c from public.clinics c where c.id = p_clinic for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into v_old from agenda.unit_settings u where u.clinic_id = p_clinic for update;
  if not found and exists (select 1 from public.clinic_schedules s where s.clinic_id = p_clinic) then
    return jsonb_build_object('status', 'old_schedule_exists');
  end if;
  begin
    v_tz := coalesce(nullif(v_s ->> 'timezone', ''), v_c.timezone);
    v_confirma := coalesce((v_s ->> 'confirm_timezone')::boolean, false);
    if v_tz <> v_c.timezone then
      if v_c.agenda_online_since is not null then raise exception 'online_active' using errcode = 'IMA02'; end if;
      if private.agenda_has_future_items(p_clinic) then raise exception 'has_appointments' using errcode = 'IMA02'; end if;
    end if;
    perform set_config('imed.origin', v_origin, true);
    insert into agenda.unit_settings (clinic_id, updated_by) values (p_clinic, auth.uid())
    on conflict (clinic_id) do nothing;
    select * into v_new from agenda.unit_settings u where u.clinic_id = p_clinic;
    v_new := jsonb_populate_record(v_new, (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                                           from jsonb_each(v_s) e where e.key = any (v_campos)));
    update agenda.unit_settings u set
      step_min = v_new.step_min, min_notice_min = v_new.min_notice_min, max_advance_days = v_new.max_advance_days,
      holidays_checked_until = v_new.holidays_checked_until, hold_minutes = v_new.hold_minutes,
      payment_grace_min = v_new.payment_grace_min, patient_cancel_until_min = v_new.patient_cancel_until_min,
      patient_reschedule_until_min = v_new.patient_reschedule_until_min, checkin_before_min = v_new.checkin_before_min,
      no_show_after_min = v_new.no_show_after_min, patient_gap_min = v_new.patient_gap_min,
      closes_on_holidays = v_new.closes_on_holidays, updated_at = now(), updated_by = auth.uid()
    where u.clinic_id = p_clinic
    returning * into v_new;
    if v_tz <> v_c.timezone or v_confirma then
      update public.clinics c set
        timezone = v_tz,
        timezone_confirmed_at = case when v_confirma then now() when v_tz <> v_c.timezone then null else c.timezone_confirmed_at end
      where c.id = p_clinic;
    end if;
    v_afetados := private.agenda_revalidate(p_clinic, coalesce(p_confirm, false));
    if jsonb_array_length(v_afetados) > 0 and not coalesce(p_confirm, false) then
      raise exception 'afeta agendamentos' using errcode = 'IMA01';
    end if;
    perform private.agenda_audit(p_clinic, v_origin, case when v_old.clinic_id is null then 'unidade.criar' else 'unidade.salvar' end,
      'unit_settings', p_clinic::text,
      case when v_old.clinic_id is not null then to_jsonb(v_old) - 'clinic_id' - 'updated_at' - 'updated_by' || jsonb_build_object('timezone', v_c.timezone) end,
      to_jsonb(v_new) - 'clinic_id' - 'updated_at' - 'updated_by' || jsonb_build_object('timezone', v_tz, 'timezone_confirmado', v_confirma));
  exception
    when sqlstate 'IMA02' then
      return jsonb_build_object('status', sqlerrm);
    when sqlstate 'IMA01' then
      return jsonb_build_object('status', 'affects_appointments', 'items', v_afetados);
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_cons = constraint_name;
      if left(v_state, 2) in ('22', '23') then
        return jsonb_build_object('status', private.agenda_err(v_state, v_cons));
      end if;
      raise;
  end;
  perform set_config('imed.origin', v_prev, true);
  perform private.agenda_touch(p_clinic);
  return jsonb_build_object('status', 'ok', 'conflicts', jsonb_array_length(v_afetados));
end $$;

/* ===================== 6. Recursos ===================== */
-- Cria (sem "id") ou muda (com "id") um aparelho, sala, profissional ou "chegadas". p_resource: id, kind (só ao
-- criar), name, capacity, setup_min, cleanup_min, member_user_id (membro da clínica), council, council_number,
-- active, archived (arquivar é definitivo). Recurso novo herda os bloqueios futuros da unidade inteira (fechamentos na
-- ocupação). Reduzir a capacidade, desativar ou arquivar com usos futuros que deixariam de caber: has_appointments
-- (redução temporária é bloqueio, nunca edição).
create or replace function public.agenda_resource_save(p_clinic uuid, p_resource jsonb, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := private.agenda_actor(p_clinic, 'agenda.configurar', 'imed.clinicas.configurar');
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_r jsonb := coalesce(p_resource, '{}'::jsonb);
  v_campos text[] := array['name', 'capacity', 'setup_min', 'cleanup_min', 'member_user_id', 'council', 'council_number', 'active'];
  v_old agenda.resources;
  v_new agenda.resources;
  v_arquivar boolean;
  v_afetados jsonb := '[]'::jsonb;
  v_state text;
  v_cons text;
begin
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  if private.agenda_unknown_keys(v_r, v_campos || array['id', 'kind', 'archived']) then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform private.agenda_lock_config(p_clinic, true);
  if not exists (select 1 from agenda.unit_settings u where u.clinic_id = p_clinic) then
    return jsonb_build_object('status', 'agenda_not_started');
  end if;
  begin
    v_arquivar := coalesce((v_r ->> 'archived')::boolean, false);
    perform set_config('imed.origin', v_origin, true);
    if nullif(v_r ->> 'id', '') is not null then
      select * into v_old from agenda.resources r
      where r.id = (v_r ->> 'id')::uuid and r.clinic_id = p_clinic and r.archived_at is null
      for update;
      if not found then raise exception 'not_found' using errcode = 'IMA02'; end if;
      if v_r ? 'kind' and v_r ->> 'kind' is distinct from v_old.kind then raise exception 'invalid' using errcode = 'IMA02'; end if;
      v_new := jsonb_populate_record(v_old, (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                                             from jsonb_each(v_r) e where e.key = any (v_campos)));
      if exists (select 1 from agenda.occupancy o
                 where o.resource_id = v_old.id and o.active and o.kind <> 'bloqueio' and upper(o.during) > now()
                   and (v_arquivar or not coalesce(v_new.active, true) or upper(o.seats) - 1 > v_new.capacity)) then
        raise exception 'has_appointments' using errcode = 'IMA02';
      end if;
      update agenda.resources r set
        name = btrim(v_new.name), capacity = v_new.capacity, setup_min = v_new.setup_min, cleanup_min = v_new.cleanup_min,
        member_user_id = v_new.member_user_id, council = v_new.council, council_number = nullif(btrim(v_new.council_number), ''),
        active = v_new.active and not v_arquivar,
        archived_at = case when v_arquivar then now() else r.archived_at end,
        updated_at = now(), updated_by = auth.uid()
      where r.id = v_old.id
      returning * into v_new;
    else
      v_new := jsonb_populate_record(null::agenda.resources, (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                                                              from jsonb_each(v_r) e where e.key = any (v_campos || array['kind'])));
      insert into agenda.resources (clinic_id, kind, name, capacity, setup_min, cleanup_min, member_user_id, council,
                                    council_number, active, created_by, updated_by)
      values (p_clinic, v_new.kind, btrim(v_new.name), coalesce(v_new.capacity, 1), coalesce(v_new.setup_min, 0),
              coalesce(v_new.cleanup_min, 0), v_new.member_user_id, v_new.council, nullif(btrim(v_new.council_number), ''),
              coalesce(v_new.active, true) and not v_arquivar, auth.uid(), auth.uid())
      returning * into v_new;
      -- herda os bloqueios futuros da unidade inteira (§3.2, item 5)
      insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, block_id)
      select p_clinic, v_new.id, 'bloqueio', int4range(1, 51), tstzrange(b.starts_at, b.ends_at, '[)'), b.id
      from public.clinic_blocks b
      where b.clinic_id = p_clinic and b.resource_id is null and b.removed_at is null and b.ends_at > now();
    end if;
    v_afetados := private.agenda_revalidate(p_clinic, coalesce(p_confirm, false));
    if jsonb_array_length(v_afetados) > 0 and not coalesce(p_confirm, false) then
      raise exception 'afeta agendamentos' using errcode = 'IMA01';
    end if;
    perform private.agenda_audit(p_clinic, v_origin, case when v_old.id is null then 'recurso.criar' else 'recurso.salvar' end,
      'resource', v_new.id::text,
      case when v_old.id is not null then jsonb_build_object('kind', v_old.kind, 'capacity', v_old.capacity, 'setup_min', v_old.setup_min,
        'cleanup_min', v_old.cleanup_min, 'active', v_old.active, 'member_user_id', v_old.member_user_id) end,
      jsonb_build_object('kind', v_new.kind, 'capacity', v_new.capacity, 'setup_min', v_new.setup_min,
        'cleanup_min', v_new.cleanup_min, 'active', v_new.active, 'member_user_id', v_new.member_user_id,
        'archived', v_new.archived_at is not null));
  exception
    when sqlstate 'IMA02' then
      return jsonb_build_object('status', sqlerrm);
    when sqlstate 'IMA01' then
      return jsonb_build_object('status', 'affects_appointments', 'items', v_afetados);
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_cons = constraint_name;
      if left(v_state, 2) in ('22', '23') then
        return jsonb_build_object('status', private.agenda_err(v_state, v_cons));
      end if;
      raise;
  end;
  perform set_config('imed.origin', v_prev, true);
  perform private.agenda_touch(p_clinic);
  return jsonb_build_object('status', 'ok', 'id', v_new.id, 'conflicts', jsonb_array_length(v_afetados));
end $$;

/* ===================== 7. Procedimentos, requisitos e alternativas ===================== */
-- Cria ou muda um procedimento (o exame específico, numa das 9 categorias). p_proc: id, exam_code, name,
-- duration_min (obrigatória ao criar; sem valor padrão), step_min, price_cents (nulo = sob consulta),
-- price_confirmed (o preço fora do normal foi conferido), patient_prep_text, fasting_hours, min_notice_min,
-- max_advance_days, online_booking, default_for_exam, active, archived e, se vier, requirements (troca a lista
-- inteira): até 5 grupos, na ordem = número do grupo, cada um {resource_kind, offset_min, duration_min, align_min
-- (só "chegadas"), label, options: [{resource_id, priority}]}; as alternativas são recursos da clínica, do mesmo tipo
-- do grupo e não arquivados (invalid_option); um recurso não aparece em dois grupos (resource_in_two_groups).
create or replace function public.agenda_procedure_save(p_clinic uuid, p_proc jsonb, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := private.agenda_actor(p_clinic, 'agenda.configurar', 'imed.clinicas.configurar');
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_p jsonb := coalesce(p_proc, '{}'::jsonb);
  v_campos text[] := array['exam_code', 'name', 'duration_min', 'step_min', 'price_cents', 'patient_prep_text', 'fasting_hours',
                           'min_notice_min', 'max_advance_days', 'online_booking', 'default_for_exam', 'active'];
  v_old agenda.procedures;
  v_new agenda.procedures;
  v_arquivar boolean;
  v_g jsonb;
  v_n integer;
  v_o jsonb;
  v_req uuid;
  v_kind text;
  v_afetados jsonb := '[]'::jsonb;
  v_state text;
  v_cons text;
begin
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  if private.agenda_unknown_keys(v_p, v_campos || array['id', 'archived', 'price_confirmed', 'requirements']) then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform private.agenda_lock_config(p_clinic, true);
  if not exists (select 1 from agenda.unit_settings u where u.clinic_id = p_clinic) then
    return jsonb_build_object('status', 'agenda_not_started');
  end if;
  begin
    v_arquivar := coalesce((v_p ->> 'archived')::boolean, false);
    perform set_config('imed.origin', v_origin, true);
    if nullif(v_p ->> 'id', '') is not null then
      select * into v_old from agenda.procedures p
      where p.id = (v_p ->> 'id')::uuid and p.clinic_id = p_clinic and p.archived_at is null
      for update;
      if not found then raise exception 'not_found' using errcode = 'IMA02'; end if;
      v_new := jsonb_populate_record(v_old, (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                                             from jsonb_each(v_p) e where e.key = any (v_campos)));
      update agenda.procedures p set
        exam_code = v_new.exam_code, name = btrim(v_new.name), duration_min = v_new.duration_min, step_min = v_new.step_min,
        price_cents = v_new.price_cents,
        price_confirmed_at = case when v_new.price_cents is null then null
                                  when coalesce((v_p ->> 'price_confirmed')::boolean, false) then now()
                                  when v_new.price_cents is distinct from v_old.price_cents then null
                                  else p.price_confirmed_at end,
        patient_prep_text = nullif(btrim(v_new.patient_prep_text), ''), fasting_hours = v_new.fasting_hours,
        min_notice_min = v_new.min_notice_min, max_advance_days = v_new.max_advance_days,
        online_booking = v_new.online_booking, default_for_exam = v_new.default_for_exam and not v_arquivar,
        active = v_new.active and not v_arquivar,
        archived_at = case when v_arquivar then now() else p.archived_at end,
        updated_at = now(), updated_by = auth.uid()
      where p.id = v_old.id
      returning * into v_new;
    else
      v_new := jsonb_populate_record(null::agenda.procedures, (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                                                               from jsonb_each(v_p) e where e.key = any (v_campos)));
      insert into agenda.procedures (clinic_id, exam_code, name, duration_min, step_min, price_cents, price_confirmed_at,
                                     patient_prep_text, fasting_hours, min_notice_min, max_advance_days, online_booking,
                                     default_for_exam, active, created_by, updated_by)
      values (p_clinic, v_new.exam_code, btrim(v_new.name), v_new.duration_min, v_new.step_min, v_new.price_cents,
              case when v_new.price_cents is not null and coalesce((v_p ->> 'price_confirmed')::boolean, false) then now() end,
              nullif(btrim(v_new.patient_prep_text), ''), v_new.fasting_hours, v_new.min_notice_min, v_new.max_advance_days,
              coalesce(v_new.online_booking, true), coalesce(v_new.default_for_exam, false) and not v_arquivar,
              coalesce(v_new.active, true) and not v_arquivar, auth.uid(), auth.uid())
      returning * into v_new;
    end if;

    if v_p ? 'requirements' then
      if jsonb_typeof(v_p -> 'requirements') <> 'array' or jsonb_array_length(v_p -> 'requirements') > 5 then
        raise exception 'invalid' using errcode = 'IMA02';
      end if;
      delete from agenda.procedure_requirements g where g.procedure_id = v_new.id;
      for v_g, v_n in select x.value, x.ordinality from jsonb_array_elements(v_p -> 'requirements') with ordinality x loop
        if private.agenda_unknown_keys(v_g, array['resource_kind', 'offset_min', 'duration_min', 'align_min', 'label', 'options'])
           or jsonb_typeof(v_g -> 'options') is distinct from 'array' or jsonb_array_length(v_g -> 'options') = 0 then
          raise exception 'invalid' using errcode = 'IMA02';
        end if;
        insert into agenda.procedure_requirements (procedure_id, clinic_id, group_no, resource_kind, offset_min, duration_min,
                                                   align_min, label)
        values (v_new.id, p_clinic, v_n, v_g ->> 'resource_kind', coalesce((v_g ->> 'offset_min')::smallint, 0),
                (v_g ->> 'duration_min')::smallint, (v_g ->> 'align_min')::smallint, nullif(btrim(v_g ->> 'label'), ''))
        returning id into v_req;
        for v_o in select x.value from jsonb_array_elements(v_g -> 'options') x loop
          if private.agenda_unknown_keys(v_o, array['resource_id', 'priority']) then
            raise exception 'invalid' using errcode = 'IMA02';
          end if;
          select r.kind into v_kind from agenda.resources r
          where r.id = (v_o ->> 'resource_id')::uuid and r.clinic_id = p_clinic and r.archived_at is null;
          if v_kind is null or v_kind <> v_g ->> 'resource_kind' then
            raise exception 'invalid_option' using errcode = 'IMA02';
          end if;
          insert into agenda.requirement_options (requirement_id, procedure_id, clinic_id, resource_id, priority)
          values (v_req, v_new.id, p_clinic, (v_o ->> 'resource_id')::uuid, coalesce((v_o ->> 'priority')::smallint, 1));
          v_kind := null;
        end loop;
      end loop;
    end if;

    v_afetados := private.agenda_revalidate(p_clinic, coalesce(p_confirm, false));
    if jsonb_array_length(v_afetados) > 0 and not coalesce(p_confirm, false) then
      raise exception 'afeta agendamentos' using errcode = 'IMA01';
    end if;
    perform private.agenda_audit(p_clinic, v_origin, case when v_old.id is null then 'procedimento.criar' else 'procedimento.salvar' end,
      'procedure', v_new.id::text,
      case when v_old.id is not null then jsonb_build_object('exam_code', v_old.exam_code, 'duration_min', v_old.duration_min,
        'step_min', v_old.step_min, 'price_cents', v_old.price_cents, 'online_booking', v_old.online_booking, 'active', v_old.active) end,
      jsonb_build_object('exam_code', v_new.exam_code, 'duration_min', v_new.duration_min, 'step_min', v_new.step_min,
        'price_cents', v_new.price_cents, 'online_booking', v_new.online_booking, 'active', v_new.active,
        'archived', v_new.archived_at is not null,
        'requirements', (select coalesce(jsonb_agg(jsonb_build_object('group_no', g.group_no, 'kind', g.resource_kind,
                           'offset_min', g.offset_min, 'duration_min', g.duration_min, 'align_min', g.align_min,
                           'options', (select coalesce(jsonb_agg(o.resource_id order by o.priority, o.resource_id), '[]'::jsonb)
                                       from agenda.requirement_options o where o.requirement_id = g.id))
                           order by g.group_no), '[]'::jsonb)
                         from agenda.procedure_requirements g where g.procedure_id = v_new.id)));
  exception
    when sqlstate 'IMA02' then
      return jsonb_build_object('status', sqlerrm);
    when sqlstate 'IMA01' then
      return jsonb_build_object('status', 'affects_appointments', 'items', v_afetados);
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_cons = constraint_name;
      if left(v_state, 2) in ('22', '23') then
        return jsonb_build_object('status', private.agenda_err(v_state, v_cons));
      end if;
      raise;
  end;
  perform set_config('imed.origin', v_prev, true);
  perform private.agenda_touch(p_clinic);
  return jsonb_build_object('status', 'ok', 'id', v_new.id, 'conflicts', jsonb_array_length(v_afetados));
end $$;

-- Regras de pacote da clínica (troca a lista inteira): [{first_procedure, second_procedure, rule ('ordem',
-- 'intervalo_min', 'nao_mesmo_dia'), min_gap_min (só intervalo_min)}]. Usadas na marcação de vários exames (3.3/5.2).
create or replace function public.agenda_pair_rules_set(p_clinic uuid, p_rules jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := private.agenda_actor(p_clinic, 'agenda.configurar', 'imed.clinicas.configurar');
  v_n integer;
  v_state text;
  v_cons text;
begin
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  if jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules) > 100
     or exists (select 1 from jsonb_array_elements(p_rules) x
                where private.agenda_unknown_keys(x.value, array['first_procedure', 'second_procedure', 'rule', 'min_gap_min'])) then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform private.agenda_lock_config(p_clinic, true);
  if not exists (select 1 from agenda.unit_settings u where u.clinic_id = p_clinic) then
    return jsonb_build_object('status', 'agenda_not_started');
  end if;
  begin
    delete from agenda.procedure_pair_rules r where r.clinic_id = p_clinic;
    insert into agenda.procedure_pair_rules (clinic_id, first_procedure, second_procedure, rule, min_gap_min)
    select p_clinic, (x.value ->> 'first_procedure')::uuid, (x.value ->> 'second_procedure')::uuid, x.value ->> 'rule',
           (x.value ->> 'min_gap_min')::smallint
    from jsonb_array_elements(p_rules) x;
    get diagnostics v_n = row_count;
    perform private.agenda_audit(p_clinic, v_origin, 'pacote.regras', 'clinic', p_clinic::text, null,
      jsonb_build_object('regras', v_n));
  exception
    when sqlstate 'IMA02' then
      return jsonb_build_object('status', sqlerrm);
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_cons = constraint_name;
      if left(v_state, 2) in ('22', '23') then
        return jsonb_build_object('status', private.agenda_err(v_state, v_cons));
      end if;
      raise;
  end;
  perform private.agenda_touch(p_clinic);
  return jsonb_build_object('status', 'ok', 'rules', v_n);
end $$;

/* ===================== 8. Regras de horário (abre e pausa) ===================== */
-- Troca a lista inteira de regras da unidade (p_resource nulo) ou de um recurso (escala própria; recurso sem escala
-- própria usa a da unidade). Cada regra: {weekday 0-6 (0 = domingo), start "HH:MM", end "HH:MM" (até "24:00"),
-- kind 'abre' ou 'pausa', valid_from, valid_to (datas; nulas = sempre), label (ex.: "Almoço"), procedure_ids
-- (vazio = todos)}. Horários de 5 em 5 minutos; janelas não atravessam a meia-noite. Duas regras do mesmo tipo que se
-- cruzam no mesmo dia, validade e procedimentos: overlapping_rules. Até 200 regras por escopo.
create or replace function public.agenda_rules_set(p_clinic uuid, p_resource uuid, p_rules jsonb, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := private.agenda_actor(p_clinic, 'agenda.configurar', 'imed.clinicas.configurar');
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_n integer;
  v_afetados jsonb := '[]'::jsonb;
  v_state text;
  v_cons text;
begin
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  if jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules) > 200
     or exists (select 1 from jsonb_array_elements(p_rules) x
                where private.agenda_unknown_keys(x.value, array['weekday', 'start', 'end', 'kind', 'valid_from', 'valid_to',
                                                                 'label', 'procedure_ids'])) then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform private.agenda_lock_config(p_clinic, true);
  if not exists (select 1 from agenda.unit_settings u where u.clinic_id = p_clinic) then
    return jsonb_build_object('status', 'agenda_not_started');
  end if;
  if p_resource is not null and not exists (select 1 from agenda.resources r
                                            where r.id = p_resource and r.clinic_id = p_clinic and r.archived_at is null) then
    return jsonb_build_object('status', 'not_found');
  end if;
  begin
    perform set_config('imed.origin', v_origin, true);
    delete from public.clinic_schedules s where s.clinic_id = p_clinic and s.resource_id is not distinct from p_resource;
    insert into public.clinic_schedules (clinic_id, resource_id, weekday, start_time, end_time, kind, valid_from, valid_to,
                                         label, procedure_ids, created_by)
    select p_clinic, p_resource, (x.value ->> 'weekday')::smallint, (x.value ->> 'start')::time, (x.value ->> 'end')::time,
           coalesce(x.value ->> 'kind', 'abre'), (x.value ->> 'valid_from')::date, (x.value ->> 'valid_to')::date,
           nullif(btrim(x.value ->> 'label'), ''),
           array(select distinct y::uuid from jsonb_array_elements_text(coalesce(x.value -> 'procedure_ids', '[]'::jsonb)) y order by 1),
           auth.uid()
    from jsonb_array_elements(p_rules) x;
    get diagnostics v_n = row_count;
    -- de 5 em 5 minutos, sem segundos
    if exists (select 1 from public.clinic_schedules s
               where s.clinic_id = p_clinic and s.resource_id is not distinct from p_resource
                 and (extract(epoch from s.start_time)::integer % 300 <> 0 or extract(epoch from s.end_time)::integer % 300 <> 0)) then
      raise exception 'invalid' using errcode = 'IMA02';
    end if;
    -- procedimentos da própria clínica
    if exists (select 1 from public.clinic_schedules s cross join lateral unnest(s.procedure_ids) pid
               where s.clinic_id = p_clinic and s.resource_id is not distinct from p_resource
                 and not exists (select 1 from agenda.procedures p where p.id = pid and p.clinic_id = p_clinic)) then
      raise exception 'invalid_option' using errcode = 'IMA02';
    end if;
    if exists (select 1 from public.clinic_schedules a
               join public.clinic_schedules b
                 on b.clinic_id = a.clinic_id and b.resource_id is not distinct from a.resource_id and b.id > a.id
                and b.kind = a.kind and b.weekday = a.weekday
                and a.start_time < b.end_time and b.start_time < a.end_time
                and coalesce(a.valid_from, '-infinity'::date) <= coalesce(b.valid_to, 'infinity'::date)
                and coalesce(b.valid_from, '-infinity'::date) <= coalesce(a.valid_to, 'infinity'::date)
                and (cardinality(a.procedure_ids) = 0 or cardinality(b.procedure_ids) = 0 or a.procedure_ids && b.procedure_ids)
               where a.clinic_id = p_clinic and a.resource_id is not distinct from p_resource) then
      raise exception 'overlapping_rules' using errcode = 'IMA02';
    end if;
    v_afetados := private.agenda_revalidate(p_clinic, coalesce(p_confirm, false));
    if jsonb_array_length(v_afetados) > 0 and not coalesce(p_confirm, false) then
      raise exception 'afeta agendamentos' using errcode = 'IMA01';
    end if;
    perform private.agenda_audit(p_clinic, v_origin, 'regras.salvar', case when p_resource is null then 'clinic' else 'resource' end,
      coalesce(p_resource, p_clinic)::text, null,
      jsonb_build_object('regras', v_n, 'abre', (select count(*) from public.clinic_schedules s where s.clinic_id = p_clinic
                                                    and s.resource_id is not distinct from p_resource and s.kind = 'abre'),
                         'conflitos', jsonb_array_length(v_afetados)));
  exception
    when sqlstate 'IMA02' then
      return jsonb_build_object('status', sqlerrm);
    when sqlstate 'IMA01' then
      return jsonb_build_object('status', 'affects_appointments', 'items', v_afetados);
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_cons = constraint_name;
      if left(v_state, 2) in ('22', '23') then
        return jsonb_build_object('status', private.agenda_err(v_state, v_cons));
      end if;
      raise;
  end;
  perform set_config('imed.origin', v_prev, true);
  perform private.agenda_touch(p_clinic);
  return jsonb_build_object('status', 'ok', 'rules', v_n, 'conflicts', jsonb_array_length(v_afetados));
end $$;

/* ===================== 9. Feriados (equipe do IMED) e aberturas em feriado (clínica) ===================== */
-- Feriado lançado pela equipe a partir de lei, decreto ou portaria (source obrigatório): {scope ('nacional', 'uf',
-- 'municipio'), uf, city_ibge, day, name, source}. Revalida as clínicas afetadas (uma a uma, em ordem, cada uma com a
-- trava exclusiva) e abre os conflitos 'grade_mudou' na hora: o feriado é um fato, não uma escolha da clínica.
create or replace function public.agenda_holiday_save(p_holiday jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_h jsonb := coalesce(p_holiday, '{}'::jsonb);
  v_id uuid;
  v_clinicas uuid[];
  v_c uuid;
  v_n integer := 0;
  v_state text;
  v_cons text;
begin
  if not public.imed_has('imed.feriados.editar') then return jsonb_build_object('status', 'forbidden'); end if;
  if private.agenda_unknown_keys(v_h, array['scope', 'uf', 'city_ibge', 'day', 'name', 'source']) then
    return jsonb_build_object('status', 'invalid');
  end if;
  begin
    select array_agg(c.id order by c.id) into v_clinicas
    from agenda.unit_settings u join public.clinics c on c.id = u.clinic_id
    where v_h ->> 'scope' = 'nacional'
       or (v_h ->> 'scope' = 'uf' and upper(c.state) = upper(v_h ->> 'uf'))
       or (v_h ->> 'scope' = 'municipio'
           and (select e.city_ibge from public.establishments e where e.cnes = c.cnes) = (v_h ->> 'city_ibge')::integer);
    foreach v_c in array coalesce(v_clinicas, '{}') loop
      perform private.agenda_lock_config(v_c, true);
    end loop;
    perform set_config('imed.origin', 'central', true);
    insert into agenda.holidays (scope, uf, city_ibge, day, name, source, created_by)
    values (v_h ->> 'scope', upper(nullif(btrim(v_h ->> 'uf'), '')), (v_h ->> 'city_ibge')::integer, (v_h ->> 'day')::date,
            btrim(v_h ->> 'name'), btrim(v_h ->> 'source'), auth.uid())
    returning id into v_id;
    foreach v_c in array coalesce(v_clinicas, '{}') loop
      v_n := v_n + jsonb_array_length(private.agenda_revalidate(v_c, true));
    end loop;
    perform private.agenda_audit(null, 'central', 'feriado.criar', 'holiday', v_id::text, null,
      jsonb_build_object('scope', v_h ->> 'scope', 'uf', v_h ->> 'uf', 'city_ibge', v_h ->> 'city_ibge', 'day', v_h ->> 'day',
                         'clinicas', coalesce(cardinality(v_clinicas), 0), 'conflitos', v_n));
  exception
    when sqlstate 'IMA02' then
      return jsonb_build_object('status', sqlerrm);
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_cons = constraint_name;
      if left(v_state, 2) in ('22', '23') then
        return jsonb_build_object('status', private.agenda_err(v_state, v_cons));
      end if;
      raise;
  end;
  perform set_config('imed.origin', v_prev, true);
  foreach v_c in array coalesce(v_clinicas, '{}') loop
    perform private.agenda_touch(v_c);
  end loop;
  return jsonb_build_object('status', 'ok', 'id', v_id, 'conflicts', v_n);
end $$;

-- Tira um feriado lançado por engano (só libera horários; nada a revalidar).
create or replace function public.agenda_holiday_remove(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h agenda.holidays;
begin
  if not public.imed_has('imed.feriados.editar') then return jsonb_build_object('status', 'forbidden'); end if;
  delete from agenda.holidays h where h.id = p_id returning * into v_h;
  if v_h.id is null then return jsonb_build_object('status', 'not_found'); end if;
  perform private.agenda_audit(null, 'central', 'feriado.remover', 'holiday', v_h.id::text,
    jsonb_build_object('scope', v_h.scope, 'uf', v_h.uf, 'city_ibge', v_h.city_ibge, 'day', v_h.day), null);
  return jsonb_build_object('status', 'ok');
end $$;

-- "Abrimos neste feriado" (p_open = true) ou desfazer (false: o dia volta a fechar e os agendamentos desse dia são
-- revalidados, com a confirmação de sempre).
create or replace function public.agenda_holiday_opening_set(p_clinic uuid, p_day date, p_open boolean, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := private.agenda_actor(p_clinic, 'agenda.configurar', 'imed.clinicas.configurar');
  v_afetados jsonb := '[]'::jsonb;
begin
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  if p_day is null or p_open is null then return jsonb_build_object('status', 'invalid'); end if;
  perform private.agenda_lock_config(p_clinic, true);
  if not exists (select 1 from agenda.unit_settings u where u.clinic_id = p_clinic) then
    return jsonb_build_object('status', 'agenda_not_started');
  end if;
  begin
    if p_open then
      insert into agenda.holiday_openings (clinic_id, day, created_by) values (p_clinic, p_day, auth.uid())
      on conflict (clinic_id, day) do nothing;
    else
      delete from agenda.holiday_openings o where o.clinic_id = p_clinic and o.day = p_day;
      v_afetados := private.agenda_revalidate(p_clinic, coalesce(p_confirm, false));
      if jsonb_array_length(v_afetados) > 0 and not coalesce(p_confirm, false) then
        raise exception 'afeta agendamentos' using errcode = 'IMA01';
      end if;
    end if;
    perform private.agenda_audit(p_clinic, v_origin, case when p_open then 'feriado.abrir' else 'feriado.fechar' end,
      'clinic', p_clinic::text, null, jsonb_build_object('day', p_day, 'conflitos', jsonb_array_length(v_afetados)));
  exception
    when sqlstate 'IMA02' then
      return jsonb_build_object('status', sqlerrm);
    when sqlstate 'IMA01' then
      return jsonb_build_object('status', 'affects_appointments', 'items', v_afetados);
  end;
  perform private.agenda_touch(p_clinic);
  return jsonb_build_object('status', 'ok', 'conflicts', jsonb_array_length(v_afetados));
end $$;

/* ===================== 10. Bloqueios ===================== */
-- Bloqueio da unidade inteira (p_resource nulo: trava exclusiva da clínica; fecha TODOS os recursos não arquivados,
-- e os recursos criados depois herdam) ou de um recurso (manutenção, folga: trava compartilhada da clínica + trava do
-- recurso). Cada recurso afetado ganha uma linha de fechamento na ocupação (protegida pela restrição de exclusão).
-- Com agendamento ou "ocupado" ativo no intervalo: has_appointments com a lista, e NADA é gravado (o "bloquear
-- mesmo assim" vem com o painel novo). p_reason: texto curto da clínica (fica no bloqueio, nunca na auditoria).
create or replace function private.agenda_block_add_int(p_clinic uuid, p_resource uuid, p_starts timestamptz,
                                                       p_ends timestamptz, p_kind text, p_reason text, p_origin text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_res uuid[];
  v_block uuid;
  v_lista jsonb;
  v_ocupados integer;
begin
  if p_starts is null or p_ends is null or p_ends <= p_starts or p_ends <= now() or p_ends - p_starts > interval '400 days' then
    return jsonb_build_object('status', 'invalid_period');
  end if;
  if coalesce(p_kind, 'bloqueio') not in ('bloqueio', 'manutencao', 'feriado', 'folga') then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform private.agenda_lock_config(p_clinic, p_resource is null);
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
  perform private.agenda_lock_resources(v_res);
  select coalesce(jsonb_agg(distinct jsonb_build_object('item_id', i.id, 'request_id', i.request_id, 'starts_at', i.starts_at))
                    filter (where i.id is not null), '[]'::jsonb),
         count(*) filter (where o.kind = 'ocupado')
    into v_lista, v_ocupados
  from agenda.occupancy o
  left join agenda.appointment_items i on i.id = o.item_id
  where o.resource_id = any (v_res) and o.active and o.kind <> 'bloqueio' and o.during && tstzrange(p_starts, p_ends, '[)');
  if jsonb_array_length(v_lista) > 0 or v_ocupados > 0 then
    return jsonb_build_object('status', 'has_appointments', 'items', v_lista, 'busy', v_ocupados);
  end if;
  begin
    perform set_config('imed.origin', p_origin, true);
    insert into public.clinic_blocks (clinic_id, starts_at, ends_at, reason, resource_id, kind, created_by)
    values (p_clinic, p_starts, p_ends, left(nullif(btrim(p_reason), ''), 120), p_resource, coalesce(p_kind, 'bloqueio'), auth.uid())
    returning id into v_block;
    insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, block_id)
    select p_clinic, r, 'bloqueio', int4range(1, 51), tstzrange(p_starts, p_ends, '[)'), v_block from unnest(v_res) r;
    perform private.agenda_audit(p_clinic, p_origin, 'bloqueio.criar', 'clinic_block', v_block::text, null,
      jsonb_build_object('resource_id', p_resource, 'kind', coalesce(p_kind, 'bloqueio'), 'starts_at', p_starts,
                         'ends_at', p_ends, 'recursos', cardinality(v_res)));
  exception
    when sqlstate 'IMA02' then
      return jsonb_build_object('status', sqlerrm);
    when exclusion_violation then
      return jsonb_build_object('status', 'has_appointments', 'items', '[]'::jsonb, 'busy', 0);
  end;
  perform set_config('imed.origin', v_prev, true);
  perform private.agenda_touch(p_clinic);
  return jsonb_build_object('status', 'ok', 'id', v_block);
end $$;

-- Remover um bloqueio = remoção lógica (removed_at) e os fechamentos dele liberados na ocupação.
create or replace function private.agenda_block_remove_int(p_block uuid, p_origin text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_b public.clinic_blocks;
begin
  select * into v_b from public.clinic_blocks b where b.id = p_block;
  if not found or v_b.removed_at is not null then return jsonb_build_object('status', 'not_found'); end if;
  perform private.agenda_lock_config(v_b.clinic_id, v_b.resource_id is null);
  select * into v_b from public.clinic_blocks b where b.id = p_block and b.removed_at is null for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  perform set_config('imed.origin', p_origin, true);
  update public.clinic_blocks b set removed_at = now(), removed_by = auth.uid() where b.id = p_block;
  update agenda.occupancy o set active = false, released_at = now(), release_reason = 'removido'
  where o.block_id = p_block and o.active;
  perform private.agenda_audit(v_b.clinic_id, p_origin, 'bloqueio.remover', 'clinic_block', p_block::text,
    jsonb_build_object('resource_id', v_b.resource_id, 'kind', v_b.kind, 'starts_at', v_b.starts_at, 'ends_at', v_b.ends_at), null);
  perform set_config('imed.origin', v_prev, true);
  perform private.agenda_touch(v_b.clinic_id);
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.agenda_block_add(p_clinic uuid, p_resource uuid, p_starts timestamptz, p_ends timestamptz,
                                                   p_kind text default 'bloqueio', p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := private.agenda_actor(p_clinic, 'agenda.bloquear', 'imed.agenda.operar');
begin
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  return private.agenda_block_add_int(p_clinic, p_resource, p_starts, p_ends, p_kind, p_reason, v_origin);
end $$;

create or replace function public.agenda_block_remove(p_block uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_origin text;
begin
  select b.clinic_id into v_clinic from public.clinic_blocks b where b.id = p_block and b.removed_at is null;
  if v_clinic is null then return jsonb_build_object('status', 'not_found'); end if;
  v_origin := private.agenda_actor(v_clinic, 'agenda.bloquear', 'imed.agenda.operar');
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  return private.agenda_block_remove_int(p_block, v_origin);
end $$;

/* ===================== 11. Permissões ===================== */
revoke all on function private.agenda_block_add_int(uuid, uuid, timestamptz, timestamptz, text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.agenda_block_remove_int(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.agenda_unit_save(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.agenda_resource_save(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.agenda_procedure_save(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.agenda_pair_rules_set(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.agenda_rules_set(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.agenda_holiday_save(jsonb) from public, anon, authenticated;
revoke all on function public.agenda_holiday_remove(uuid) from public, anon, authenticated;
revoke all on function public.agenda_holiday_opening_set(uuid, date, boolean, boolean) from public, anon, authenticated;
revoke all on function public.agenda_block_add(uuid, uuid, timestamptz, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.agenda_block_remove(uuid) from public, anon, authenticated;
grant execute on function public.agenda_unit_save(uuid, jsonb, boolean) to authenticated;
grant execute on function public.agenda_resource_save(uuid, jsonb, boolean) to authenticated;
grant execute on function public.agenda_procedure_save(uuid, jsonb, boolean) to authenticated;
grant execute on function public.agenda_pair_rules_set(uuid, jsonb) to authenticated;
grant execute on function public.agenda_rules_set(uuid, uuid, jsonb, boolean) to authenticated;
grant execute on function public.agenda_holiday_save(jsonb) to authenticated;
grant execute on function public.agenda_holiday_remove(uuid) to authenticated;
grant execute on function public.agenda_holiday_opening_set(uuid, date, boolean, boolean) to authenticated;
grant execute on function public.agenda_block_add(uuid, uuid, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.agenda_block_remove(uuid) to authenticated;
