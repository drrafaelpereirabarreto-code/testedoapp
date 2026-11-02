-- iMed Agenda, fase 3.1 ("Fundação"): parte 3 de 5 (blocos 5 a 8). O cabeçalho, com o que a
-- migração faz e as conferências, está na parte 1 (<versão>_agenda_base_parte_1.sql). Repete o bloco 0 (limite
-- de espera e travas): cada parte é uma transação própria.

/* ===================== 0. Limite de espera e travas (para aplicar na produção sem segurar o site) ===================== */
-- Se uma transação longa estiver segurando uma destas tabelas (por exemplo, uma consulta largada aberta no painel), a
-- migração desiste em 5 s com erro 55P03 e NADA é aplicado: é só rodar de novo. Sem isso, ela esperaria para sempre e
-- toda leitura do site entraria na fila atrás dela (o visitante levaria erro em 3 s). As travas são pegas de uma vez e
-- na mesma ordem do INSERT do site (primeiro o pedido, depois a clínica), para não haver impasse (40P01) com um pedido
-- feito durante a aplicação. (O LOCK fica num bloco DO porque a CLI do Supabase manda o arquivo como uma transação
-- implícita, onde LOCK TABLE solto é recusado; as travas valem até o fim da transação, como as dos ALTER.)
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
do $$
begin
  lock table public.appointment_requests, public.clinics, public.clinic_members, public.clinic_schedules,
    public.clinic_blocks in access exclusive mode;
end $$;

/* ===================== 5. Restrições novas nas tabelas de hoje (só ADD; precisam das tabelas acima) ===================== */
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinics'::regclass
                 and conname = 'clinics_agenda_online_ck') then
    -- venda online só com modalidade de agenda e fuso confirmado
    alter table public.clinics add constraint clinics_agenda_online_ck
      check (agenda_online_since is null or (agenda_mode <> 'pedido' and timezone_confirmed_at is not null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinic_schedules'::regclass
                 and conname = 'clinic_schedules_valid_ck') then
    alter table public.clinic_schedules add constraint clinic_schedules_valid_ck
      check (valid_to is null or valid_from is null or valid_to >= valid_from);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinic_schedules'::regclass
                 and conname = 'clinic_schedules_resource_fk') then
    alter table public.clinic_schedules add constraint clinic_schedules_resource_fk
      foreign key (resource_id, clinic_id) references agenda.resources (id, clinic_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinic_blocks'::regclass
                 and conname = 'clinic_blocks_resource_fk') then
    alter table public.clinic_blocks add constraint clinic_blocks_resource_fk
      foreign key (resource_id, clinic_id) references agenda.resources (id, clinic_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.appointment_requests'::regclass
                 and conname = 'appointment_requests_slot_end_ck') then
    alter table public.appointment_requests add constraint appointment_requests_slot_end_ck
      check (slot_end is null or (slot_start is not null and slot_end > slot_start));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.appointment_requests'::regclass
                 and conname = 'appointment_requests_hold_ck') then
    -- o prazo da reserva só existe enquanto ela é reserva
    alter table public.appointment_requests add constraint appointment_requests_hold_ck
      check (hold_expires_at is null or status in ('hold', 'awaiting_payment'));
  end if;
end $$;

/* ===================== 6. Funções internas da agenda ===================== */

-- Registro de mudança feita pelo editor SQL (saída de emergência): exige o motivo e grava em agenda.audit_log.
create or replace function private.agenda_audit_sql(p_clinic uuid, p_action text, p_object_type text,
                                                     p_object_id text, p_old jsonb, p_new jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := private.agenda_reason();
begin
  if v_reason is null then
    raise exception 'Mudança pelo SQL sem motivo: defina imed.reason (um código) junto com imed.origin = ''sql'''
      using errcode = '42501',
            hint = 'select set_config(''imed.origin'', ''sql'', true), set_config(''imed.reason'', ''<codigo>'', true);';
  end if;
  insert into agenda.audit_log (clinic_id, actor_kind, actor_user, actor_role, origin, action, object_type, object_id,
                                old_value, new_value, reason_code)
  values (p_clinic, 'sql', auth.uid(), null, 'sql', p_action, p_object_type, p_object_id, p_old, p_new, v_reason);
end $$;

-- Validação ÚNICA dos dados do paciente (a mesma para o site de hoje e para as funções da agenda): pedido para
-- outra pessoa (nome e parentesco; menor de 18 só com o consentimento do responsável legal, LGPD art. 14; maior
-- de idade só com a confirmação de que a pessoa sabe e concordou). Devolve a linha normalizada.
create or replace function private.agenda_validate_patient(p public.appointment_requests)
returns public.appointment_requests
language plpgsql
set search_path = ''
as $$
declare
  r public.appointment_requests := p;
begin
  if coalesce(r.for_other, false) then
    r.for_other := true;
    r.other_name := nullif(btrim(regexp_replace(coalesce(r.other_name, ''), '\s+', ' ', 'g')), '');
    r.relationship := nullif(btrim(regexp_replace(coalesce(r.relationship, ''), '\s+', ' ', 'g')), '');
    r.other_minor := coalesce(r.other_minor, false);
    if char_length(coalesce(r.other_name, '')) not between 2 and 120 then
      raise exception 'Informe o nome de quem vai fazer o exame' using errcode = '22023';
    end if;
    if char_length(coalesce(r.relationship, '')) not between 2 and 60 then
      raise exception 'Informe o parentesco de quem vai fazer o exame' using errcode = '22023';
    end if;
    if r.other_minor and not coalesce(r.guardian_consent, false) then
      raise exception 'Para menor de 18 anos, é preciso o consentimento do responsável legal' using errcode = '22023';
    end if;
    if not r.other_minor and not coalesce(r.other_consent, false) then
      raise exception 'Confirme que a pessoa sabe do pedido e concordou (ou que você é o representante legal dela)' using errcode = '22023';
    end if;
    r.guardian_consent := r.other_minor;
    r.other_consent := not r.other_minor;
  else
    r.for_other := false;
    r.other_name := null;
    r.relationship := null;
    r.other_minor := false;
    r.guardian_consent := false;
    r.other_consent := false;
  end if;
  return r;
end $$;

-- Versão da agenda da clínica: sobe 1 a cada chamada e devolve a versão nova. É a ÚLTIMA instrução de cada escrita
-- (a trava curta da linha faz a ordem das versões ser a ordem dos COMMITs). O aviso pelo Realtime entra na 3.4.
create or replace function private.agenda_touch(p_clinic uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v bigint;
begin
  insert into agenda.clinic_versions as cv (clinic_id, version, changed_at)
  values (p_clinic, 1, now())
  on conflict (clinic_id) do update set version = cv.version + 1, changed_at = now()
  returning cv.version into v;
  return v;
end $$;

-- Conta e sessão com as mesmas exigências de is_imed_admin (para a equipe do IMED fora de admin_emails): e-mail
-- confirmado e igual ao da sessão, só login por e-mail (sem celular, Google ou anônimo), conta ativa, e a sessão
-- não foi aberta com senha nem como anônima (o site só usa o link do e-mail).
create or replace function private.agenda_secure_session()
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
           select 1
           from auth.users u
           where u.id = auth.uid()
             and u.email is not null
             and lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
             and u.email_confirmed_at is not null
             and u.deleted_at is null
             and (u.banned_until is null or u.banned_until <= now())
             and not coalesce(u.is_anonymous, false)
             and coalesce(u.phone, '') = ''
             and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider <> 'email')
         )
     and not exists (
           select 1
           from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) m
           where coalesce(m ->> 'method', m #>> '{}') in ('password', 'anonymous')
         );
$$;

revoke all on function private.agenda_audit_sql(uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.agenda_validate_patient(public.appointment_requests) from public, anon, authenticated, service_role;
revoke all on function private.agenda_touch(uuid) from public, anon, authenticated, service_role;
revoke all on function private.agenda_secure_session() from public, anon, authenticated, service_role;

/* ===================== 7. Papéis (§12) ===================== */

-- Escopo da permissão da pessoa logada nesta clínica (pelo papel dela em clinic_members): 'clinica' (tudo da
-- clínica), 'propria' (só os recursos ligados ao profissional), 'sem_donos' (a equipe, menos os donos) ou nulo (não
-- tem). Só conta conta ativa: e-mail confirmado, não apagada, não banida e não anônima. A equipe do IMED NÃO entra
-- aqui: é imed_has. As funções que tratam escopo parcial (3.4) usam esta; as policies usam has_clinic_perm.
create or replace function public.clinic_perm_scope(p_clinic uuid, p_perm text)
returns text
language sql stable
security definer
set search_path = ''
as $$
  select rp.scope
  from public.clinic_members m
  join agenda.role_permissions rp on rp.role = m.role and rp.permission = p_perm
  join auth.users u on u.id = m.user_id
  where m.clinic_id = p_clinic and m.user_id = auth.uid()
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
    and not coalesce(u.is_anonymous, false)
  limit 1;
$$;
revoke all on function public.clinic_perm_scope(uuid, text) from public, anon, authenticated;
grant execute on function public.clinic_perm_scope(uuid, text) to authenticated;

-- A pessoa logada tem esta permissão na clínica INTEIRA? Só o escopo 'clinica' conta: na dúvida, nega. Quem tem só
-- um escopo parcial ('propria', 'sem_donos') passa pelas funções que aplicam o escopo (clinic_perm_scope).
create or replace function public.has_clinic_perm(p_clinic uuid, p_perm text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select coalesce(public.clinic_perm_scope(p_clinic, p_perm) = 'clinica', false);
$$;
revoke all on function public.has_clinic_perm(uuid, text) from public, anon, authenticated;
grant execute on function public.has_clinic_perm(uuid, text) to authenticated;

-- is_clinic_member (de 20261030021903_marketplace, usado pelas policies e funções de hoje): conta só os papéis de
-- quem já vê a clínica inteira (dono, gestor, recepção e o "staff" antigo). Hoje só existem owner e staff (CHECK de
-- clinic_members): nada muda. Quando a migração dos CHECKs liberar "finance" e "professional", eles NÃO passam a ler
-- os pedidos com telefone nem a mudar preço, cadastro ou situação pelas funções antigas (§12).
create or replace function public.is_clinic_member(p_clinic uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.clinic_members m
                 where m.clinic_id = p_clinic and m.user_id = auth.uid()
                   and m.role in ('owner', 'manager', 'reception', 'staff'));
$$;
revoke execute on function public.is_clinic_member(uuid) from public, anon;
grant execute on function public.is_clinic_member(uuid) to authenticated;

-- A pessoa logada tem esta permissão da equipe do IMED? O dono (is_imed_admin) tem todas; a equipe, as do papel
-- ativo em private.imed_staff, com as mesmas exigências de conta e sessão do admin.
create or replace function public.imed_has(p_perm text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select coalesce(public.is_imed_admin(), false)
      or (p_perm like 'imed.%'
          and private.agenda_secure_session()
          and exists (select 1
                      from private.imed_staff s
                      join agenda.role_permissions rp on rp.role = 'imed_' || s.role and rp.permission = p_perm
                      where s.user_id = auth.uid() and s.revoked_at is null));
$$;
revoke all on function public.imed_has(text) from public, anon, authenticated;
grant execute on function public.imed_has(text) to authenticated;

/* ===================== 8. As duas funções que mudam pedidos hoje: só a marca de origem (antes da guarda nova) ===================== */
-- Iguais às da migração 20261030143738_confianca, com uma diferença: antes do UPDATE, a marca de origem (a guarda
-- nova não as barra e o histórico sabe de onde veio); depois, a marca anterior volta (a marca não "vaza" para o
-- resto da transação). As respostas não mudam. Vêm ANTES da guarda (bloco 9): em nenhum momento da aplicação a guarda
-- existe sem que as duas funções já levem a marca.

-- O paciente cancela o próprio pedido (origem 'app').
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

-- A clínica (origem 'painel') ou a equipe do IMED (origem 'central') muda a situação do pedido.
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