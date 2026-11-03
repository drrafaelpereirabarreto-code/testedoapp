-- iMed Agenda, fase 3.3: parte 2 de 4 (marcar, reservar, confirmar, cancelar, remarcar, balcão, situação, consulta do
-- paciente e opções de pacote). O cabeçalho, com o que a migração faz e as conferências, está na parte 1.
--
-- Todas respondem jsonb com "status" (ok, forbidden, not_found, invalid, slot_taken, ...), são SECURITY DEFINER com
-- search_path vazio, conferem a permissão por dentro e derivam a clínica do próprio registro. Quem ALOCA recurso segue o
-- protocolo de travas da arquitetura (§3.2, item 4): trava compartilhada da configuração da clínica → linha do próprio
-- pedido → travas dos recursos candidatos (em ordem crescente) → liberação das reservas vencidas desses recursos →
-- planejar e gravar → agenda_touch por último. Quem só libera ou muda a situação trava só o pedido.
-- Dados do paciente só entram e ficam no cabeçalho (appointment_requests); respostas, idempotência, histórico e
-- auditoria levam só ids, horários e códigos.

/* ===================== 0. Limite de espera ===================== */
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 10. Marcar (o núcleo de agenda_book, agenda_hold e agenda_desk_book) ===================== */
-- p_items: 1 a 4 itens [{procedure_id, starts_at}] (pacote: tudo ou nada, numa transação). p_patient: name, phone,
-- email, consent (obrigatório: true), for_other, other_name, relationship, other_minor, guardian_consent,
-- other_consent (as mesmas regras do pedido de hoje, private.agenda_validate_patient). p_public: só com a venda
-- online ligada e procedimentos à venda (paciente). p_desk: balcão (pode marcar para daqui a pouco: o "agora" do motor
-- recua a antecedência mínima). Idempotência (§3.2, item 7): a mesma chave com os mesmos parâmetros devolve o mesmo
-- resultado (replay); com outros, idempotency_conflict.
create or replace function private.agenda_book_int(p_clinic uuid, p_items jsonb, p_patient jsonb, p_id uuid, p_token_hash text,
                                                   p_status text, p_channel text, p_origin text, p_public boolean, p_desk boolean,
                                                   p_idem_scope text, p_idem_actor text, p_idem_key uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_pat jsonb := coalesce(p_patient, '{}'::jsonb);
  c public.clinics;
  u agenda.unit_settings;
  v_items jsonb;
  v_procs uuid[];
  v_n integer;
  v_fp text;
  v_idem agenda.idempotency;
  v_res uuid[];
  v_hold_exp timestamptz;
  v_hold_until timestamptz;
  v_first timestamptz;
  v_last timestamptz;
  v_local timestamp;
  v_it record;
  v_item uuid;
  v_now timestamptz;
  v_total integer;
  v_phone text;
  v_falha integer;
  v_det text;
  v_cons text;
  v_out jsonb;
begin
  -- forma do pedido
  if p_id is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 4
     or exists (select 1 from jsonb_array_elements(p_items) x
                where private.agenda_unknown_keys(x.value, array['procedure_id', 'starts_at'])
                   or x.value ->> 'procedure_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     or private.agenda_unknown_keys(v_pat, array['name', 'phone', 'email', 'consent', 'for_other', 'other_name', 'relationship',
                                                 'other_minor', 'guardian_consent', 'other_consent']) then
    return jsonb_build_object('status', 'invalid');
  end if;
  begin
    v_items := (select jsonb_agg(jsonb_build_object('procedure_id', (x.value ->> 'procedure_id')::uuid,
                                                    'starts_at', (x.value ->> 'starts_at')::timestamptz)
                                 order by (x.value ->> 'starts_at')::timestamptz, x.value ->> 'procedure_id')
                from jsonb_array_elements(p_items) x);
  exception when others then
    return jsonb_build_object('status', 'invalid');
  end;
  if exists (select 1 from jsonb_array_elements(v_items) x where x.value ->> 'starts_at' is null)
     or (select count(distinct x.value ->> 'procedure_id') from jsonb_array_elements(v_items) x) <> jsonb_array_length(v_items) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not coalesce((v_pat ->> 'consent')::boolean, false) then return jsonb_build_object('status', 'consent_required'); end if;
  v_phone := regexp_replace(coalesce(v_pat ->> 'phone', ''), '\D', '', 'g');
  if char_length(btrim(coalesce(v_pat ->> 'name', ''))) not between 2 and 120 or v_phone !~ '^[0-9]{10,11}$' then
    return jsonb_build_object('status', 'invalid_patient');
  end if;

  -- idempotência (antes das travas: a segunda chamada com a mesma chave espera a primeira e lê o resultado)
  if p_idem_key is not null then
    v_fp := encode(extensions.digest(jsonb_build_object('c', p_clinic, 's', p_status, 'i',
              (select jsonb_agg(jsonb_build_array(x.value ->> 'procedure_id', extract(epoch from (x.value ->> 'starts_at')::timestamptz)))
               from jsonb_array_elements(v_items) x))::text, 'sha256'), 'hex');
    insert into agenda.idempotency (scope, actor, key, fingerprint) values (p_idem_scope, p_idem_actor, p_idem_key, v_fp)
    on conflict (scope, actor, key) do nothing;
    if not found then
      select * into v_idem from agenda.idempotency i where i.scope = p_idem_scope and i.actor = p_idem_actor and i.key = p_idem_key;
      if v_idem.fingerprint <> v_fp then return jsonb_build_object('status', 'idempotency_conflict'); end if;
      return coalesce(v_idem.result, '{}'::jsonb) || jsonb_build_object('replay', true, 'request_status',
               (select a.status from public.appointment_requests a where a.id = (v_idem.result ->> 'id')::uuid));
    end if;
  end if;

  -- §3.2, passo 1: trava compartilhada da configuração; o que depende dela é lido depois
  perform private.agenda_lock_config(p_clinic, false);
  select * into c from public.clinics x where x.id = p_clinic;
  select * into u from agenda.unit_settings s where s.clinic_id = p_clinic;
  if c.id is null then
    v_out := jsonb_build_object('status', 'not_found');
  elsif u.clinic_id is null then
    v_out := jsonb_build_object('status', 'agenda_not_started');
  elsif p_public and not (c.status = 'published' and c.accepts_online_booking and not c.is_demo and c.agenda_online_since is not null) then
    v_out := jsonb_build_object('status', 'not_online');
  end if;
  if v_out is null then
    select jsonb_agg(jsonb_build_object('seq', q.seq, 'procedure_id', q.pid, 'starts_at', q.t,
                                        'ends_at', q.t + make_interval(mins => p.duration_min), 'exam_code', p.exam_code,
                                        'price_cents', p.price_cents,
                                        'notice', coalesce(p.min_notice_min, u.min_notice_min)) order by q.seq),
           array_agg(q.pid), count(*), sum(p.price_cents), count(*) filter (where p.price_cents is null)
      into v_items, v_procs, v_n, v_total, v_falha
    from (select (x.value ->> 'procedure_id')::uuid as pid, (x.value ->> 'starts_at')::timestamptz as t, x.ordinality::integer as seq
          from jsonb_array_elements(v_items) with ordinality x) q
    join agenda.procedures p on p.id = q.pid and p.clinic_id = p_clinic and p.active and p.archived_at is null
                            and (not p_public or p.online_booking);
    if coalesce(v_n, 0) <> jsonb_array_length(p_items) then
      v_out := jsonb_build_object('status', 'not_found');
    elsif v_n > 1 and private.agenda_package_check(p_clinic, v_items) is not null then
      v_out := jsonb_build_object('status', 'invalid_package');
    elsif p_public and (select count(*) from public.appointment_requests a
                        where a.clinic_id = p_clinic and a.patient_phone = v_phone and a.uses_resources
                          and private.agenda_active_status(a.status) and a.slot_end > now())
                       >= private.agenda_setting_int('agenda.limite_futuros_por_telefone', 3) then
      v_out := jsonb_build_object('status', 'too_many_bookings');
    end if;
  end if;
  if v_out is not null then
    if p_idem_key is not null then
      update agenda.idempotency i set result = v_out where i.scope = p_idem_scope and i.actor = p_idem_actor and i.key = p_idem_key;
    end if;
    return v_out;
  end if;
  if v_falha > 0 then v_total := null; end if;

  -- §3.2, passos 3 e 4: travas dos recursos candidatos (ordem crescente) e liberação das reservas vencidas neles
  v_res := private.agenda_candidates(v_procs);
  perform private.agenda_lock_resources(v_res);
  perform private.agenda_release_expired(v_res);

  if p_status = 'hold' then
    v_hold_exp := now() + make_interval(mins => u.hold_minutes);
    v_hold_until := v_hold_exp + make_interval(mins => u.payment_grace_min);
  end if;
  v_first := (v_items -> 0 ->> 'starts_at')::timestamptz;
  v_last := (select max((x.value ->> 'ends_at')::timestamptz) from jsonb_array_elements(v_items) x);
  v_local := v_first at time zone c.timezone;
  -- conferência rápida pela ocupação (quem perdeu a corrida responde já, sem gravar nada nem rodar o motor inteiro)
  v_falha := (select (x.value ->> 'seq')::integer from jsonb_array_elements(v_items) x
              where private.agenda_quick_taken((x.value ->> 'procedure_id')::uuid, (x.value ->> 'starts_at')::timestamptz, c.timezone)
              order by 1 limit 1);
  if v_falha is not null then
    v_out := jsonb_build_object('status', 'slot_taken', 'seq', v_falha);
  end if;
  -- §3.2, passo 5 (um único bloco com exceção por chamada: converte o choque em slot_taken; nada fica gravado)
  if v_out is null then
  v_falha := null;
  begin
    perform set_config('imed.origin', p_origin, true);
    insert into public.appointment_requests (id, clinic_id, place_source, place_name, place_address, place_phone, exam_code,
      preferred_date, preferred_period, patient_name, patient_phone, patient_email, consent, status, user_id, review_token_hash,
      slot_start, slot_end, channel, hold_expires_at, total_cents, uses_resources, for_other, other_name, relationship,
      other_minor, guardian_consent, other_consent)
    values (p_id, p_clinic, 'imed', left(c.name, 200),
      left(concat_ws(' · ', c.address_line, nullif(c.neighborhood, ''), c.city || ' - ' || c.state), 300), left(c.phone, 30),
      v_items -> 0 ->> 'exam_code', v_local::date,
      case when v_local::time < '12:00' then 'manha' when v_local::time < '18:00' then 'tarde' else 'noite' end,
      btrim(regexp_replace(v_pat ->> 'name', '\s+', ' ', 'g')), v_phone, nullif(btrim(coalesce(v_pat ->> 'email', '')), ''), true,
      p_status, case when p_origin = 'app' then auth.uid() end, p_token_hash, v_first, v_last, p_channel, v_hold_exp, v_total, true,
      coalesce((v_pat ->> 'for_other')::boolean, false), v_pat ->> 'other_name', v_pat ->> 'relationship',
      coalesce((v_pat ->> 'other_minor')::boolean, false), coalesce((v_pat ->> 'guardian_consent')::boolean, false),
      coalesce((v_pat ->> 'other_consent')::boolean, false));
    for v_it in select (x.value ->> 'seq')::integer as seq, (x.value ->> 'procedure_id')::uuid as pid,
                       (x.value ->> 'starts_at')::timestamptz as t, (x.value ->> 'ends_at')::timestamptz as e,
                       x.value ->> 'exam_code' as exam, (x.value ->> 'price_cents')::integer as price, (x.value ->> 'notice')::integer as notice
                from jsonb_array_elements(v_items) x order by 1 loop
      v_falha := v_it.seq;
      v_now := case when p_desk then now() - make_interval(mins => v_it.notice) else now() end;
      if not private.agenda_start_ok(p_clinic, v_it.pid, v_it.t, v_now, c.timezone) then
        raise exception 'slot_taken' using errcode = 'IMA03', detail = v_it.seq::text;
      end if;
      insert into agenda.appointment_items (request_id, clinic_id, seq, procedure_id, exam_code, starts_at, ends_at, local_start, tz,
                                            groups, status, price_cents)
      values (p_id, p_clinic, v_it.seq, v_it.pid, v_it.exam, v_it.t, v_it.e, v_it.t at time zone c.timezone, c.timezone,
              (select array_agg(g.group_no order by g.group_no) from agenda.procedure_requirements g where g.procedure_id = v_it.pid),
              p_status, v_it.price)
      returning id into v_item;
      perform private.agenda_place(v_item, v_hold_until, '{}');
    end loop;
    perform private.agenda_history(p_id, null, null, p_status, p_origin, p_clinic, 1);
  exception
    when sqlstate 'IMA03' or exclusion_violation then
      v_out := jsonb_build_object('status', 'slot_taken', 'seq', v_falha);
    when unique_violation then
      get stacked diagnostics v_cons = constraint_name;
      v_out := jsonb_build_object('status', case when v_cons = 'appointment_requests_pkey' then 'idempotency_conflict' else 'slot_taken' end);
    when sqlstate '22023' then
      get stacked diagnostics v_det = message_text;
      v_out := jsonb_build_object('status', 'invalid_patient', 'message', v_det);
    when check_violation then
      get stacked diagnostics v_cons = constraint_name;
      v_out := jsonb_build_object('status', 'invalid_patient', 'field', v_cons);
  end;
  end if;
  perform set_config('imed.origin', v_prev, true);
  if v_out is null then
    v_out := jsonb_build_object('status', 'ok', 'id', p_id, 'request_status', p_status, 'slot_start', v_first, 'slot_end', v_last,
               'hold_expires_at', v_hold_exp,
               'items', (select jsonb_agg(jsonb_build_object('seq', i.seq, 'procedure_id', i.procedure_id, 'starts_at', i.starts_at,
                                                             'ends_at', i.ends_at) order by i.seq)
                         from agenda.appointment_items i where i.request_id = p_id));
  elsif v_out ->> 'status' = 'slot_taken' and v_falha is not null then
    v_out := v_out || jsonb_build_object('alternatives', private.agenda_alternatives(p_clinic,
               (v_items -> (v_falha - 1) ->> 'procedure_id')::uuid, (v_items -> (v_falha - 1) ->> 'starts_at')::timestamptz,
               case when p_desk then now() - make_interval(mins => (v_items -> (v_falha - 1) ->> 'notice')::integer) else now() end));
  end if;
  if p_idem_key is not null then
    update agenda.idempotency i set result = v_out where i.scope = p_idem_scope and i.actor = p_idem_actor and i.key = p_idem_key;
  end if;
  if v_out ->> 'status' = 'ok' then
    -- contador por clínica e hora (alerta de pico, §3.2 item 10): só agendamentos feitos, e no fim (a linha do
    -- contador fica travada até o COMMIT, como a do touch: ninguém espera por ela antes de planejar)
    if p_public then perform private.agenda_count('agenda_book.clinica:' || p_clinic::text); end if;
    perform private.agenda_touch(p_clinic);
  end if;
  return v_out;
end $$;

-- O paciente marca (sem pagamento online: "Confirmar" confere, reserva e confirma de uma vez; §0, item 4). p_id: o id do
-- agendamento, gerado UMA vez por intenção no aparelho (o reenvio com o mesmo id, código e horários devolve o mesmo
-- resultado); p_token: o código secreto do pedido, que fica só no aparelho (o banco guarda o SHA-256).
create or replace function public.agenda_book(p_clinic uuid, p_items jsonb, p_patient jsonb, p_id uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if p_clinic is null or p_id is null or char_length(coalesce(p_token, '')) not between 16 and 200 then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  return private.agenda_book_int(p_clinic, p_items, p_patient, p_id, v_hash, 'confirmed', 'imed_app', 'app', true, false,
                                 'agenda_book', v_hash, p_id);
end $$;

-- Só o servidor (service_role): reserva temporária para a integração com o sistema da clínica (6.1) e o pagamento
-- online (5.4). Prazo: unit_settings.hold_minutes (+ a carência na ocupação). Sem confirmação no prazo, a manutenção
-- (ou a próxima marcação nos mesmos recursos) expira e solta.
create or replace function public.agenda_hold(p_clinic uuid, p_items jsonb, p_patient jsonb, p_id uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return jsonb_build_object('status', 'forbidden'); end if;
  if p_clinic is null or p_id is null or char_length(coalesce(p_token, '')) not between 16 and 200 then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  return private.agenda_book_int(p_clinic, p_items, p_patient, p_id, v_hash, 'hold', 'externo', 'api', false, false,
                                 'agenda_hold', v_hash, p_id);
end $$;

-- Só o servidor: confirma a reserva ainda no prazo (hold → confirmed). Trava o pedido antes de olhar o prazo; a
-- expiração também trava o pedido (com SKIP LOCKED) e confere o mesmo prazo: só uma das duas vence (§3.3, I5).
create or replace function public.agenda_confirm(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_grace integer;
  v_prev text := coalesce(current_setting('imed.origin', true), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then return jsonb_build_object('status', 'forbidden'); end if;
  select * into r from public.appointment_requests a where a.id = p_id for update;
  if not found or not r.uses_resources then return jsonb_build_object('status', 'not_found'); end if;
  if r.status = 'confirmed' then return jsonb_build_object('status', 'ok', 'request_status', 'confirmed', 'replay', true); end if;
  if r.status = 'expired' then return jsonb_build_object('status', 'expired'); end if;
  if r.status <> 'hold' then return jsonb_build_object('status', 'transition_not_allowed', 'request_status', r.status); end if;
  select coalesce(u.payment_grace_min, 0) into v_grace from agenda.unit_settings u where u.clinic_id = r.clinic_id;
  if r.hold_expires_at + make_interval(mins => coalesce(v_grace, 0)) <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  perform set_config('imed.origin', 'api', true);
  update agenda.occupancy o set hold_until = null
  where o.active and o.item_id in (select i.id from agenda.appointment_items i where i.request_id = r.id);
  update agenda.appointment_items i set status = 'confirmed', version = i.version + 1, updated_at = now()
  where i.request_id = r.id and i.status = 'hold';
  update public.appointment_requests a set status = 'confirmed', hold_expires_at = null where a.id = r.id;
  perform set_config('imed.origin', v_prev, true);
  perform private.agenda_touch(r.clinic_id);
  return jsonb_build_object('status', 'ok', 'request_status', 'confirmed');
end $$;

/* ===================== 11. Cancelar ===================== */
-- Solta a ocupação e cancela os itens e o cabeçalho (o pedido já está travado por quem chama).
create or replace function private.agenda_cancel_do(p_request uuid, p_origin text, p_by text, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_prev_reason text := coalesce(current_setting('imed.reason', true), '');
begin
  perform set_config('imed.origin', p_origin, true), set_config('imed.reason', p_reason, true);
  update agenda.occupancy o set active = false, released_at = now(), release_reason = 'cancelado'
  where o.active and o.item_id in (select i.id from agenda.appointment_items i where i.request_id = p_request);
  update agenda.appointment_items i set status = 'cancelled', version = i.version + 1, updated_at = now()
  where i.request_id = p_request and i.status not in ('completed', 'no_show', 'cancelled', 'expired');
  update public.appointment_requests a
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by, cancel_reason = p_reason, hold_expires_at = null
   where a.id = p_request;
  perform set_config('imed.origin', v_prev, true), set_config('imed.reason', v_prev_reason, true);
end $$;

-- Cancelar um agendamento do motor novo. Quem: o paciente (código do pedido ou a conta dele; até o início e o prazo da
-- unidade: past, too_late), a clínica (agenda.cancelar; motivo obrigatório) ou a equipe do IMED (imed.agenda.operar;
-- motivo obrigatório). p_only_patient: a fachada cancel_request (só o paciente). Motivo = código de cancel_reason.
create or replace function private.agenda_cancel_int(p_id uuid, p_token text, p_reason text, p_version integer, p_only_patient boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_token_ok boolean;
  v_actor text;
  v_origin text;
  v_tr agenda.status_transitions;
  v_u agenda.unit_settings;
  v_reason text;
begin
  select * into r from public.appointment_requests a where a.id = p_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  v_token_ok := p_token is not null and (r.review_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')) is true;
  if v_token_ok or (p_only_patient and (r.user_id = auth.uid()) is true) then
    v_actor := 'paciente';
  elsif not p_only_patient and r.clinic_id is not null and public.has_clinic_perm(r.clinic_id, 'agenda.cancelar') then
    v_actor := 'clinica';
  elsif not p_only_patient and public.imed_has('imed.agenda.operar') then
    v_actor := 'imed';
  elsif (r.user_id = auth.uid()) is true then
    v_actor := 'paciente';
  else
    return jsonb_build_object('status', 'forbidden');
  end if;
  if not r.uses_resources then return jsonb_build_object('status', 'not_agenda'); end if;
  if p_version is not null and p_version <> r.version then
    return jsonb_build_object('status', 'version_conflict', 'version', r.version);
  end if;
  if r.status = 'cancelled' then return jsonb_build_object('status', 'already_cancelled'); end if;
  select * into v_tr from agenda.status_transitions t
  where t.from_status = r.status and t.to_status = 'cancelled' and t.actor_kind = v_actor;
  if not found then return jsonb_build_object('status', 'not_cancellable', 'request_status', r.status); end if;
  select * into v_u from agenda.unit_settings u where u.clinic_id = r.clinic_id;
  if v_actor = 'paciente' then
    if r.slot_start is not null and r.slot_start <= now() then return jsonb_build_object('status', 'past'); end if;
    if v_tr.time_rule = 'prazo_cancelar_paciente'
       and r.slot_start - make_interval(mins => coalesce(v_u.patient_cancel_until_min, 0)) <= now() then
      return jsonb_build_object('status', 'too_late');
    end if;
    v_reason := coalesce(p_reason, 'paciente_desistiu');
  else
    v_reason := p_reason;
    if v_reason is null and v_tr.requires_reason then return jsonb_build_object('status', 'reason_required'); end if;
  end if;
  if v_reason not in ('paciente_desistiu', 'paciente_nao_pode', 'clinica_indisponivel', 'equipamento_manutencao',
                      'profissional_ausente', 'nao_pago', 'duplicado', 'outro') then
    return jsonb_build_object('status', 'invalid_reason');
  end if;
  v_origin := case v_actor when 'paciente' then 'app' when 'clinica' then 'painel' else 'central' end;
  perform private.agenda_cancel_do(r.id, v_origin,
                                   case v_actor when 'paciente' then 'patient' when 'clinica' then 'clinic' else 'imed' end, v_reason);
  perform private.agenda_touch(r.clinic_id);
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.agenda_cancel(p_id uuid, p_reason text default null, p_token text default null,
                                                p_version integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.agenda_cancel_int(p_id, p_token, p_reason, p_version, false);
end $$;

-- Só o servidor: a integração solta a reserva que o sistema da clínica recusou (hold → cancelled, por "external").
create or replace function public.agenda_release(p_id uuid, p_reason text default 'clinica_indisponivel')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return jsonb_build_object('status', 'forbidden'); end if;
  select * into r from public.appointment_requests a where a.id = p_id for update;
  if not found or not r.uses_resources then return jsonb_build_object('status', 'not_found'); end if;
  if r.status = 'cancelled' then return jsonb_build_object('status', 'already_cancelled'); end if;
  if r.status <> 'hold' then return jsonb_build_object('status', 'transition_not_allowed', 'request_status', r.status); end if;
  if coalesce(p_reason, '') not in ('clinica_indisponivel', 'equipamento_manutencao', 'profissional_ausente', 'nao_pago',
                                    'duplicado', 'outro') then
    return jsonb_build_object('status', 'invalid_reason');
  end if;
  perform private.agenda_cancel_do(r.id, 'api', 'external', p_reason);
  perform private.agenda_touch(r.clinic_id);
  return jsonb_build_object('status', 'ok');
end $$;

-- Fachada de hoje (mesma assinatura, mesmas respostas): o paciente cancela com o código ou pela conta.
-- Pedido sem o motor novo: EXATAMENTE como antes. Agendamento do motor novo: as regras da agenda (ganha too_late).
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
  if r.uses_resources then
    return private.agenda_cancel_int(p_id, p_token, null, null, true) ->> 'status';
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

/* ===================== 12. Mudar a situação (máquina de estados, §5) ===================== */
-- Agendamento do motor novo, inteiro (p_item nulo) ou um item. Quem: a clínica (a permissão de cada transição em
-- agenda.status_transitions) ou a equipe do IMED. Regras de horário: too_early / too_late; motivo: reason_required;
-- versão: version_conflict. Encerrar (concluído, faltou, cancelado) solta a ocupação; voltar a ocupar (faltou →
-- presente, reabrir um cancelado, desistir de remarcar depois de solto) passa pelo motor e pode dar slot_taken.
create or replace function private.agenda_set_status_int(p_id uuid, p_status text, p_reason text, p_version integer, p_item uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_prev_reason text := coalesce(current_setting('imed.reason', true), '');
  v_clinic uuid;
  r public.appointment_requests;
  v_from text;
  v_actor text;
  v_origin text;
  v_tr agenda.status_transitions;
  v_u agenda.unit_settings;
  v_tz text;
  v_start timestamptz;
  v_items uuid[];
  v_item record;
  v_res uuid[];
  v_rel text;
  v_soma text;
begin
  if p_status is null or p_status not in ('pending', 'contacted', 'hold', 'awaiting_payment', 'confirmed', 'checked_in',
                                          'in_service', 'completed', 'no_show', 'reschedule_requested', 'cancelled', 'expired') then
    return jsonb_build_object('status', 'invalid_status');
  end if;
  select a.clinic_id into v_clinic from public.appointment_requests a where a.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  -- §3.2: configuração (compartilhada) antes do pedido, para quem precisar voltar a ocupar recurso
  if v_clinic is not null then perform private.agenda_lock_config(v_clinic, false); end if;
  select * into r from public.appointment_requests a where a.id = p_id for update;
  if not r.uses_resources then return jsonb_build_object('status', 'not_agenda'); end if;
  if public.has_clinic_perm(r.clinic_id, 'agenda.ver') or public.has_clinic_perm(r.clinic_id, 'pedidos.ver') then
    v_actor := 'clinica';
  elsif public.imed_has('imed.agenda.operar') then
    v_actor := 'imed';
  else
    return jsonb_build_object('status', 'forbidden');
  end if;
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
  where t.from_status = v_from and t.to_status = p_status and t.actor_kind = v_actor;
  if not found then return jsonb_build_object('status', 'transition_not_allowed', 'from', v_from); end if;
  if not (case v_actor when 'clinica' then public.has_clinic_perm(r.clinic_id, v_tr.permission)
                       else public.imed_has(v_tr.permission) end) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if v_tr.requires_reason and p_reason is null then return jsonb_build_object('status', 'reason_required'); end if;
  if p_status = 'cancelled' and coalesce(p_reason, 'outro') not in ('paciente_desistiu', 'paciente_nao_pode', 'clinica_indisponivel',
       'equipamento_manutencao', 'profissional_ausente', 'nao_pago', 'duplicado', 'outro') then
    return jsonb_build_object('status', 'invalid_reason');
  end if;
  select array_agg(i.id order by i.seq), min(i.starts_at) into v_items, v_start
  from agenda.appointment_items i where i.request_id = r.id and i.status = v_from and (p_item is null or i.id = p_item);
  select * into v_u from agenda.unit_settings u where u.clinic_id = r.clinic_id;
  select c.timezone into v_tz from public.clinics c where c.id = r.clinic_id;
  if v_tr.time_rule = 'janela_de_chegada' and now() < v_start - make_interval(mins => coalesce(v_u.checkin_before_min, 120))
     or v_tr.time_rule = 'depois_do_inicio' and now() < v_start
     or v_tr.time_rule = 'depois_da_tolerancia' and now() < v_start + make_interval(mins => coalesce(v_u.no_show_after_min, 15)) then
    return jsonb_build_object('status', 'too_early');
  end if;
  if v_tr.time_rule = 'mesmo_dia' and (now() at time zone v_tz)::date <> (v_start at time zone v_tz)::date then
    return jsonb_build_object('status', 'too_late');
  end if;
  v_origin := case v_actor when 'clinica' then 'painel' else 'central' end;
  begin
    perform set_config('imed.origin', v_origin, true),
            set_config('imed.reason', coalesce(p_reason, case p_status when 'cancelled' then 'outro' else '' end), true);
    perform private.agenda_reason();   -- motivo fora do formato de código: invalid_reason
    if private.agenda_active_status(p_status) and p_status <> 'reschedule_requested' then
      -- voltar a ocupar o que foi solto (o motor completo: as travas dos recursos e a vaga livre de verdade)
      if exists (select 1 from agenda.appointment_items i where i.id = any (v_items)
                 and not exists (select 1 from agenda.occupancy o where o.item_id = i.id and o.active)) then
        v_res := private.agenda_candidates(array(select i.procedure_id from agenda.appointment_items i where i.id = any (v_items)));
        perform private.agenda_lock_resources(v_res);
        perform private.agenda_release_expired(v_res);
        for v_item in select i.id from agenda.appointment_items i where i.id = any (v_items)
                      and not exists (select 1 from agenda.occupancy o where o.item_id = i.id and o.active) order by i.seq loop
          perform private.agenda_place(v_item.id, null,
            array(select distinct o.resource_id from agenda.occupancy o where o.item_id = v_item.id and o.kind = 'agendamento'));
        end loop;
      end if;
    elsif not private.agenda_active_status(p_status) then
      v_rel := case p_status when 'completed' then 'concluido' when 'no_show' then 'faltou' when 'expired' then 'expirada' else 'cancelado' end;
      update agenda.occupancy o set active = false, released_at = now(), release_reason = v_rel
      where o.active and o.item_id = any (v_items);
    end if;
    update agenda.appointment_items i set status = p_status, version = i.version + 1, updated_at = now()
    where i.id = any (v_items);
    for v_item in select i.id from agenda.appointment_items i where i.id = any (v_items) loop
      perform private.agenda_history(r.id, v_item.id, v_from, p_status, v_origin, r.clinic_id, r.version);
    end loop;
    v_soma := private.agenda_rollup(r.id);
    update public.appointment_requests a set
      status = v_soma,
      cancelled_at = case when v_soma = 'cancelled' and r.status <> 'cancelled' then now() else a.cancelled_at end,
      cancelled_by = case when v_soma = 'cancelled' and r.status <> 'cancelled'
                          then case v_actor when 'clinica' then 'clinic' else 'imed' end else a.cancelled_by end,
      cancel_reason = case when v_soma = 'cancelled' and r.status <> 'cancelled' then coalesce(p_reason, 'outro') else a.cancel_reason end
    where a.id = r.id;
  exception
    when sqlstate 'IMA03' or exclusion_violation then
      perform set_config('imed.origin', v_prev, true), set_config('imed.reason', v_prev_reason, true);
      return jsonb_build_object('status', 'slot_taken');
    when sqlstate '22023' then
      perform set_config('imed.origin', v_prev, true), set_config('imed.reason', v_prev_reason, true);
      return jsonb_build_object('status', 'invalid_reason');
  end;
  perform set_config('imed.origin', v_prev, true), set_config('imed.reason', v_prev_reason, true);
  perform private.agenda_touch(r.clinic_id);
  return jsonb_build_object('status', 'ok', 'request_status', v_soma,
                            'version', (select a.version from public.appointment_requests a where a.id = r.id));
end $$;

create or replace function public.agenda_set_status(p_id uuid, p_status text, p_reason text default null,
                                                    p_version integer default null, p_item uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.agenda_set_status_int(p_id, p_status, p_reason, p_version, p_item);
end $$;

-- Fachada de hoje (mesma assinatura e respostas): a clínica (membro) ou a equipe do IMED (admin) muda a situação.
-- Pedido sem o motor novo: EXATAMENTE como antes. Agendamento do motor novo: a máquina de estados (ganha
-- transition_not_allowed, too_early, reason_required; cancelar por aqui grava o motivo "outro").
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
  select * into r from public.appointment_requests where id = p_id;
  if not found then return 'not_found'; end if;
  if r.uses_resources then
    if not (v_admin or (r.clinic_id is not null and public.is_clinic_member(r.clinic_id))) then
      return 'forbidden';
    end if;
    if r.status = 'cancelled' and r.cancelled_by = 'patient' and not v_admin then return 'cancelled_by_patient'; end if;
    return private.agenda_set_status_int(p_id, p_status, case when p_status = 'cancelled' then 'outro' end, null, null) ->> 'status';
  end if;
  select * into r from public.appointment_requests where id = p_id for update;
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
    return 'slot_taken';
  end;
  perform set_config('imed.origin', v_marca, true);
  return 'ok';
end $$;
revoke execute on function public.set_request_status(uuid, text) from public, anon;
grant execute on function public.set_request_status(uuid, text) to authenticated;

/* ===================== 13. Remarcar (§6) ===================== */
-- Troca o horário de um ou mais itens numa transação: a ocupação antiga só é solta junto com a gravação da nova; se a
-- nova não couber, nada muda (slot_taken com alternativas) e o horário antigo continua valendo (§3.3, I4). p_items:
-- [{seq, starts_at}] (os itens não citados ficam como estão). Quem: o paciente (código ou conta; até o prazo de
-- remarcação da unidade: too_late), a clínica (agenda.remarcar) ou a equipe (imed.agenda.operar). p_key: idempotência.
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

/* ===================== 14. Balcão e "só ocupar" ===================== */
-- A recepção (agenda.marcar) ou a equipe do IMED (imed.agenda.operar) marca pelo telefone ou no balcão: o mesmo motor,
-- sem exigir a venda online, podendo marcar para daqui a pouco. p_patient: name, phone, email e consent (true = a
-- pessoa foi avisada de que o agendamento fica registrado no sistema), e o pedido para outra pessoa, se for o caso.
-- p_key: idempotência (o reenvio com a mesma chave devolve o mesmo agendamento).
create or replace function public.agenda_desk_book(p_clinic uuid, p_items jsonb, p_patient jsonb,
                                                   p_channel text default 'clinica_balcao', p_key uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := private.agenda_actor(p_clinic, 'agenda.marcar', 'imed.agenda.operar');
  v_channel text;
begin
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  v_channel := case when v_origin = 'central' then 'imed_equipe' else p_channel end;
  if v_channel not in ('clinica_telefone', 'clinica_balcao', 'clinica_outro', 'imed_equipe') then
    return jsonb_build_object('status', 'invalid');
  end if;
  return private.agenda_book_int(p_clinic, p_items, p_patient, gen_random_uuid(), null, 'confirmed', v_channel, v_origin, false, true,
                                 'agenda_desk_book', auth.uid()::text, p_key);
end $$;

-- "Só ocupar o horário" (agenda própria da clínica, uso interno): sem dado de paciente. Com p_procedure, ocupa um
-- recurso de cada grupo do procedimento a partir de p_starts (com preparo e higienização); com p_resource, ocupa esse
-- recurso de p_starts a p_ends. Choque com agendamento, outro "ocupado" ou bloqueio: slot_taken.
create or replace function public.agenda_desk_busy(p_clinic uuid, p_starts timestamptz, p_ends timestamptz default null,
                                                   p_resource uuid default null, p_procedure uuid default null,
                                                   p_reason text default 'agenda_propria')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := private.agenda_actor(p_clinic, 'agenda.marcar', 'imed.agenda.operar');
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_tz text;
  v_p agenda.procedures;
  v_res uuid[];
  v_busy uuid;
  v_ends timestamptz;
  g record;
  v_rid uuid;
  v_seat integer;
  v_need tstzrange;
begin
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  if p_starts is null or (p_resource is null) = (p_procedure is null) or coalesce(p_reason, '') not in ('agenda_propria', 'uso_interno', 'outro')
     or p_resource is not null and (p_ends is null or p_ends <= p_starts or p_ends - p_starts > interval '24 hours') then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform private.agenda_lock_config(p_clinic, false);
  if not exists (select 1 from agenda.unit_settings u where u.clinic_id = p_clinic) then
    return jsonb_build_object('status', 'agenda_not_started');
  end if;
  select c.timezone into v_tz from public.clinics c where c.id = p_clinic;
  if p_procedure is not null then
    select * into v_p from agenda.procedures p where p.id = p_procedure and p.clinic_id = p_clinic and p.active and p.archived_at is null;
    if not found then return jsonb_build_object('status', 'not_found'); end if;
    v_res := private.agenda_candidates(array[p_procedure]);
    v_ends := p_starts + make_interval(mins => v_p.duration_min);
  else
    if not exists (select 1 from agenda.resources r where r.id = p_resource and r.clinic_id = p_clinic and r.active and r.archived_at is null) then
      return jsonb_build_object('status', 'not_found');
    end if;
    v_res := array[p_resource];
    v_ends := p_ends;
  end if;
  perform private.agenda_lock_resources(v_res);
  perform private.agenda_release_expired(v_res);
  begin
    perform set_config('imed.origin', v_origin, true);
    insert into agenda.busy_marks (clinic_id, procedure_id, starts_at, ends_at, reason_code, created_by)
    values (p_clinic, p_procedure, p_starts, v_ends, p_reason, auth.uid())
    returning id into v_busy;
    for g in select rq.id, rq.group_no, rq.offset_min, coalesce(rq.duration_min, v_p.duration_min)::integer as dur, rq.align_min
             from agenda.procedure_requirements rq where rq.procedure_id = p_procedure
             union all
             select null, 1::smallint, 0::smallint, null::integer, null::smallint where p_procedure is null
             order by 2 loop
      v_rid := null;
      -- a menor vaga do primeiro recurso livre: sem uso ativo na vaga e sem fechamento no intervalo
      select o.rid, s.seat, n.need into v_rid, v_seat, v_need
      from (select x.resource_id as rid, x.priority from agenda.requirement_options x where x.requirement_id = g.id
            union all select p_resource, 1 where p_procedure is null) o
      join agenda.resources r on r.id = o.rid and r.active and r.archived_at is null
      cross join lateral (select case when p_procedure is null then tstzrange(p_starts, v_ends, '[)')
                                      else private.agenda_need(p_starts, g.offset_min, g.dur, g.align_min, r.setup_min, r.cleanup_min, v_tz) end as need) n
      cross join lateral generate_series(1, r.capacity::integer) s (seat)
      where not exists (select 1 from agenda.occupancy oc
                        where oc.resource_id = o.rid and oc.active and oc.during && n.need
                          and (oc.kind = 'bloqueio' or lower(oc.seats) = s.seat))
      order by o.priority, o.rid, s.seat
      limit 1;
      if v_rid is null then raise exception 'slot_taken' using errcode = 'IMA03'; end if;
      insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, busy_id)
      values (p_clinic, v_rid, 'ocupado', int4range(v_seat, v_seat + 1), v_need, v_busy);
    end loop;
    perform private.agenda_audit(p_clinic, v_origin, 'ocupado.criar', 'busy_mark', v_busy::text, null,
      jsonb_build_object('procedure_id', p_procedure, 'resource_id', p_resource, 'starts_at', p_starts, 'ends_at', v_ends,
                         'reason_code', p_reason));
  exception
    when sqlstate 'IMA03' or exclusion_violation then
      perform set_config('imed.origin', v_prev, true);
      return jsonb_build_object('status', 'slot_taken');
  end;
  perform set_config('imed.origin', v_prev, true);
  perform private.agenda_touch(p_clinic);
  return jsonb_build_object('status', 'ok', 'id', v_busy);
end $$;

-- Tira um "ocupado" (remoção lógica; a ocupação dele é solta).
create or replace function public.agenda_desk_busy_remove(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b agenda.busy_marks;
  v_origin text;
  v_prev text := coalesce(current_setting('imed.origin', true), '');
begin
  select * into v_b from agenda.busy_marks b where b.id = p_id and b.removed_at is null;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  v_origin := private.agenda_actor(v_b.clinic_id, 'agenda.marcar', 'imed.agenda.operar');
  if v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  select * into v_b from agenda.busy_marks b where b.id = p_id and b.removed_at is null for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  perform set_config('imed.origin', v_origin, true);
  update agenda.busy_marks b set removed_at = now(), removed_by = auth.uid() where b.id = p_id;
  update agenda.occupancy o set active = false, released_at = now(), release_reason = 'removido' where o.busy_id = p_id and o.active;
  perform private.agenda_audit(v_b.clinic_id, v_origin, 'ocupado.remover', 'busy_mark', p_id::text,
    jsonb_build_object('starts_at', v_b.starts_at, 'ends_at', v_b.ends_at), null);
  perform set_config('imed.origin', v_prev, true);
  perform private.agenda_touch(v_b.clinic_id);
  return jsonb_build_object('status', 'ok');
end $$;

/* ===================== 15. O paciente consulta o próprio agendamento ===================== */
-- Com o código do pedido (ou a conta dele): situação, horários (instantes e o fuso da unidade), exames, prazos para
-- cancelar e remarcar. Nada de nome, telefone ou e-mail (quem tem o código já sabe; a resposta não precisa repetir).
create or replace function public.agenda_my_booking(p_id uuid, p_token text default null)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  c public.clinics;
  u agenda.unit_settings;
begin
  select * into r from public.appointment_requests a where a.id = p_id;
  if not found or not ((r.user_id = auth.uid()) is true
                       or (r.review_token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')) is true) then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into c from public.clinics x where x.id = r.clinic_id;
  select * into u from agenda.unit_settings s where s.clinic_id = r.clinic_id;
  return jsonb_build_object(
    'status', 'ok', 'id', r.id, 'request_status', r.status, 'version', r.version, 'agenda', r.uses_resources,
    'clinic_id', r.clinic_id, 'clinic_name', c.name, 'timezone', coalesce(c.timezone, 'America/Sao_Paulo'),
    'slot_start', r.slot_start, 'slot_end', r.slot_end, 'hold_expires_at', r.hold_expires_at,
    'cancel_until', case when r.uses_resources and r.slot_start is not null
                         then r.slot_start - make_interval(mins => coalesce(u.patient_cancel_until_min, 0)) end,
    'reschedule_until', case when r.uses_resources and r.slot_start is not null
                             then r.slot_start - make_interval(mins => coalesce(u.patient_reschedule_until_min, 120)) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object('seq', i.seq, 'exam_code', i.exam_code, 'procedure', p.name,
                                                           'starts_at', i.starts_at, 'ends_at', i.ends_at, 'status', i.status,
                                                           'prep_text', p.patient_prep_text, 'fasting_hours', p.fasting_hours)
                                        order by i.seq)
                       from agenda.appointment_items i join agenda.procedures p on p.id = i.procedure_id
                       where i.request_id = r.id), '[]'::jsonb));
end $$;

/* ===================== 16. Opções de pacote (§6) ===================== */
-- Para 2 a 4 procedimentos num dia: os inícios livres de cada um (o motor), todas as ordens permitidas pelas regras de
-- par e, para cada início do primeiro, o próximo exame no primeiro horário livre depois do fim do anterior + o intervalo
-- (do paciente ou da regra de par). Ordena por menor espera total, fim mais cedo e início mais cedo; até p_limit opções
-- (padrão 5). São sugestões: a marcação (agenda_book) confere tudo de novo, tudo ou nada.
create or replace function public.agenda_package_options(p_clinic uuid, p_procedures uuid[], p_day date, p_limit integer default 5)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  v_n integer := coalesce(cardinality(p_procedures), 0);
  v_gap integer;
  v_dur integer[];
  v_starts jsonb := '[]'::jsonb;
  v_ord integer[];
  v_t0 timestamptz;
  v_t timestamptz;
  v_fim timestamptz;
  v_plano jsonb;
  v_ok boolean;
  v_espera integer;
  v_opcoes jsonb := '[]'::jsonb;
  v_regra integer;
  k integer;
  j integer;
begin
  if p_clinic is null or p_day is null or v_n not between 2 and 4
     or (select count(distinct x) from unnest(p_procedures) x where x is not null) <> v_n then
    return jsonb_build_object('status', 'invalid');
  end if;
  for k in 1 .. v_n loop
    if not private.agenda_can_see_slots(p_clinic, p_procedures[k]) then return jsonb_build_object('status', 'not_found'); end if;
  end loop;
  select coalesce(u.patient_gap_min, 0) into v_gap from agenda.unit_settings u where u.clinic_id = p_clinic;
  v_dur := array(select p.duration_min::integer from unnest(p_procedures) with ordinality x (id, n)
                 join agenda.procedures p on p.id = x.id order by x.n);
  for k in 1 .. v_n loop
    v_starts := v_starts || jsonb_build_array(coalesce((select jsonb_agg(s.slot_start order by s.slot_start)
                                                        from private.agenda_free_starts(p_clinic, p_procedures[k], p_day, p_day, now()) s),
                                                       '[]'::jsonb));
  end loop;
  for v_ord in
    with recursive perm (ord) as (
      select array[i] from generate_series(1, v_n) i
      union all
      select perm.ord || i from perm cross join generate_series(1, v_n) i where i <> all (perm.ord) and cardinality(perm.ord) < v_n)
    select perm.ord from perm where cardinality(perm.ord) = v_n
  loop
    -- regras de ordem e "não no mesmo dia" (num dia só, "não no mesmo dia" elimina a combinação)
    continue when exists (select 1 from agenda.procedure_pair_rules r
                          join generate_subscripts(v_ord, 1) a (ia) on p_procedures[v_ord[ia]] = r.first_procedure
                          join generate_subscripts(v_ord, 1) b (ib) on p_procedures[v_ord[ib]] = r.second_procedure
                          where (r.rule = 'ordem' and ia > ib) or r.rule = 'nao_mesmo_dia');
    for v_t0 in select (x.value #>> '{}')::timestamptz from jsonb_array_elements(v_starts -> (v_ord[1] - 1)) x loop
      v_plano := jsonb_build_array(jsonb_build_object('procedure_id', p_procedures[v_ord[1]], 'starts_at', v_t0,
                                                      'ends_at', v_t0 + make_interval(mins => v_dur[v_ord[1]])));
      v_fim := v_t0 + make_interval(mins => v_dur[v_ord[1]]);
      v_ok := true;
      for j in 2 .. v_n loop
        select coalesce(max(r.min_gap_min), 0) into v_regra from agenda.procedure_pair_rules r
        where r.first_procedure = p_procedures[v_ord[j - 1]] and r.second_procedure = p_procedures[v_ord[j]] and r.rule = 'intervalo_min';
        select min((x.value #>> '{}')::timestamptz) into v_t from jsonb_array_elements(v_starts -> (v_ord[j] - 1)) x
        where (x.value #>> '{}')::timestamptz >= v_fim + make_interval(mins => greatest(v_gap, v_regra));
        if v_t is null then v_ok := false; exit; end if;
        v_plano := v_plano || jsonb_build_array(jsonb_build_object('procedure_id', p_procedures[v_ord[j]], 'starts_at', v_t,
                                                                   'ends_at', v_t + make_interval(mins => v_dur[v_ord[j]])));
        v_fim := v_t + make_interval(mins => v_dur[v_ord[j]]);
      end loop;
      continue when not v_ok;
      v_espera := (extract(epoch from (v_fim - v_t0)) / 60)::integer - (select sum(d) from unnest(v_dur) d)::integer;
      v_opcoes := v_opcoes || jsonb_build_array(jsonb_build_object('items', v_plano, 'wait_min', v_espera,
                                                                   'starts_at', v_t0, 'ends_at', v_fim));
    end loop;
  end loop;
  return jsonb_build_object('status', 'ok', 'options', coalesce((
    select jsonb_agg(o.value order by (o.value ->> 'wait_min')::integer, (o.value ->> 'ends_at')::timestamptz,
                     (o.value ->> 'starts_at')::timestamptz)
    from (select x.value from jsonb_array_elements(v_opcoes) x
          order by (x.value ->> 'wait_min')::integer, (x.value ->> 'ends_at')::timestamptz, (x.value ->> 'starts_at')::timestamptz
          limit least(greatest(coalesce(p_limit, 5), 1), 20)) o), '[]'::jsonb));
end $$;

/* ===================== 17. Permissões ===================== */
revoke all on function private.agenda_book_int(uuid, jsonb, jsonb, uuid, text, text, text, text, boolean, boolean, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.agenda_cancel_do(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.agenda_cancel_int(uuid, text, text, integer, boolean) from public, anon, authenticated, service_role;
revoke all on function private.agenda_set_status_int(uuid, text, text, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.agenda_book(uuid, jsonb, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.agenda_hold(uuid, jsonb, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.agenda_confirm(uuid) from public, anon, authenticated;
revoke all on function public.agenda_release(uuid, text) from public, anon, authenticated;
revoke all on function public.agenda_cancel(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.agenda_set_status(uuid, text, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.agenda_reschedule(uuid, jsonb, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.agenda_desk_book(uuid, jsonb, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.agenda_desk_busy(uuid, timestamptz, timestamptz, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.agenda_desk_busy_remove(uuid) from public, anon, authenticated;
revoke all on function public.agenda_my_booking(uuid, text) from public, anon, authenticated;
revoke all on function public.agenda_package_options(uuid, uuid[], date, integer) from public, anon, authenticated;
grant execute on function public.agenda_book(uuid, jsonb, jsonb, uuid, text) to anon, authenticated;
grant execute on function public.agenda_hold(uuid, jsonb, jsonb, uuid, text) to service_role;
grant execute on function public.agenda_confirm(uuid) to service_role;
grant execute on function public.agenda_release(uuid, text) to service_role;
grant execute on function public.agenda_cancel(uuid, text, text, integer) to anon, authenticated;
grant execute on function public.agenda_set_status(uuid, text, text, integer, uuid) to authenticated;
grant execute on function public.agenda_reschedule(uuid, jsonb, text, uuid, integer) to anon, authenticated;
grant execute on function public.agenda_desk_book(uuid, jsonb, jsonb, text, uuid) to authenticated;
grant execute on function public.agenda_desk_busy(uuid, timestamptz, timestamptz, uuid, uuid, text) to authenticated;
grant execute on function public.agenda_desk_busy_remove(uuid) to authenticated;
grant execute on function public.agenda_my_booking(uuid, text) to anon, authenticated;
grant execute on function public.agenda_package_options(uuid, uuid[], date, integer) to anon, authenticated;

comment on function public.agenda_book(uuid, jsonb, jsonb, uuid, text) is
  'O paciente marca 1 a 4 exames (tudo ou nada) num horário livre do motor: confere, reserva e confirma de uma vez. Idempotente pelo id + código.';
comment on function public.agenda_reschedule(uuid, jsonb, text, uuid, integer) is
  'Remarca numa transação: o horário antigo só é solto junto com a gravação do novo; sem lugar, nada muda (slot_taken).';
