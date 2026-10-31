-- VOLTA da migração supabase/migrations/20261031100000_agenda_base.sql (iMed Agenda, fase 3.1; só se for preciso
-- desfazer). Tem o mesmo nome da migração: se a migração for renomeada, renomeie esta também.
-- Deixa o banco como estava antes dela (testado no CI, .github/workflows/banco.yml: depois desta volta a
-- impressão digital do banco é IGUAL à da produção antes da 3.1, e a migração reaplicada volta a ficar igual):
--   - as funções do pedido voltam às da migração 20261030143738_confianca (sem a marca de origem; o gatilho do
--     pedido volta a ser SECURITY INVOKER);
--   - a policy "admin atualiza pedidos" volta a valer e anon/authenticated voltam a ter INSERT na tabela inteira
--     (e authenticated, UPDATE e DELETE), como antes;
--   - is_clinic_member volta a contar qualquer papel (como em 20261030021903_marketplace);
--   - sai tudo o que a 3.1 criou: o schema agenda (com os dados dele: recursos, ocupação, histórico, auditoria...),
--     private.imed_staff, has_clinic_perm, imed_has, as funções private.agenda_*, as colunas novas das tabelas de
--     hoje (com os valores delas) e a extensão btree_gist.
-- ATENÇÃO: apaga dados da agenda (se já houver) e o histórico de situação. Na produção, a versão da migração
-- continua no histórico (supabase_migrations.schema_migrations); reaplicar pelo conector grava uma versão nova.

/* ===================== 1. Gatilhos novos nas tabelas de hoje ===================== */
drop trigger if exists appointment_requests_guard on public.appointment_requests;
drop trigger if exists appointment_requests_touch on public.appointment_requests;
drop trigger if exists appointment_requests_hist on public.appointment_requests;
drop trigger if exists clinics_agenda_guard on public.clinics;

/* ===================== 2. As funções do pedido como eram (20261030143738_confianca) ===================== */
-- Pedido com horário: confere se o horário existe e está livre; se estiver, já sai confirmado.
-- Igual à versão da agenda, mais a conferência do pedido para outra pessoa.
create or replace function public.check_appointment_request()
returns trigger language plpgsql set search_path = '' as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  local_ts timestamp;
begin
  if new.preferred_date < today or new.preferred_date > today + 120 then
    raise exception 'Data preferida fora do intervalo permitido' using errcode = '22023';
  end if;
  if new.clinic_id is not null and not exists (
    select 1 from public.clinics c
    where c.id = new.clinic_id and c.status = 'published' and c.accepts_online_booking
  ) then
    raise exception 'Esta clínica não recebe pedidos de agendamento pelo site' using errcode = '22023';
  end if;
  -- Exame para outra pessoa: nome e parentesco; menor de 18 anos só com o consentimento do responsável legal;
  -- maior de idade só com a confirmação de que a pessoa sabe do pedido e concordou (ou de que quem pede é o
  -- representante legal dela): o exame é dado de saúde DELA (LGPD, art. 11).
  if coalesce(new.for_other, false) then
    new.for_other := true;
    new.other_name := nullif(btrim(regexp_replace(coalesce(new.other_name, ''), '\s+', ' ', 'g')), '');
    new.relationship := nullif(btrim(regexp_replace(coalesce(new.relationship, ''), '\s+', ' ', 'g')), '');
    new.other_minor := coalesce(new.other_minor, false);
    if char_length(coalesce(new.other_name, '')) not between 2 and 120 then
      raise exception 'Informe o nome de quem vai fazer o exame' using errcode = '22023';
    end if;
    if char_length(coalesce(new.relationship, '')) not between 2 and 60 then
      raise exception 'Informe o parentesco de quem vai fazer o exame' using errcode = '22023';
    end if;
    if new.other_minor and not coalesce(new.guardian_consent, false) then
      raise exception 'Para menor de 18 anos, é preciso o consentimento do responsável legal' using errcode = '22023';
    end if;
    if not new.other_minor and not coalesce(new.other_consent, false) then
      raise exception 'Confirme que a pessoa sabe do pedido e concordou (ou que você é o representante legal dela)' using errcode = '22023';
    end if;
    new.guardian_consent := new.other_minor;
    new.other_consent := not new.other_minor;
  else
    new.for_other := false;
    new.other_name := null;
    new.relationship := null;
    new.other_minor := false;
    new.guardian_consent := false;
    new.other_consent := false;
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
  return new;
end $$;
-- Função de gatilho: ninguém chama como RPC (o gatilho continua funcionando). Igual à migração de segurança.
revoke execute on function public.check_appointment_request() from public, anon, authenticated;
comment on function public.check_appointment_request() is null;

-- O paciente cancela o próprio pedido: pelo código do pedido (aparelho) ou pela conta.
-- Pode cancelar o que ainda está ativo (aguardando contato, em contato ou confirmado), desde que o horário
-- marcado ainda não tenha passado (sem horário marcado, pode cancelar).
-- Devolve: ok, not_found, forbidden, already_cancelled, not_cancellable (concluído) ou past (horário passou).
create or replace function public.cancel_request(p_id uuid, p_token text default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
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
  update public.appointment_requests
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'patient'
   where id = r.id;
  return 'ok';
end $$;
revoke execute on function public.cancel_request(uuid, text) from public;
grant execute on function public.cancel_request(uuid, text) to anon, authenticated;

-- A clínica (ou a equipe do IMED) muda a situação do pedido. Igual a antes, e agora também guarda quem cancelou.
-- Devolve: ok, invalid_status, not_found, forbidden, cancelled_by_patient (a clínica não desfaz o cancelamento
-- do paciente: para remarcar, é preciso um novo pedido) ou slot_taken (reabrir um pedido cujo horário outra
-- pessoa já pegou depois do cancelamento).
create or replace function public.set_request_status(p_id uuid, p_status text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_admin boolean := coalesce(public.is_imed_admin(), false);
  who text;
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
  return 'ok';
end $$;
revoke execute on function public.set_request_status(uuid, text) from public, anon;
grant execute on function public.set_request_status(uuid, text) to authenticated;

-- is_clinic_member como era (20261030021903_marketplace: qualquer papel conta).
create or replace function public.is_clinic_member(p_clinic uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.clinic_members m where m.clinic_id = p_clinic and m.user_id = auth.uid());
$$;
revoke execute on function public.is_clinic_member(uuid) from public, anon;
grant execute on function public.is_clinic_member(uuid) to authenticated;

/* ===================== 3. Permissões e policy do pedido como eram ===================== */
alter policy "admin atualiza pedidos" on public.appointment_requests
  using (public.is_imed_admin()) with check (public.is_imed_admin());
revoke insert (id, clinic_id, place_source, place_ref, place_name, place_address, place_phone, exam_code,
  preferred_date, preferred_period, patient_name, patient_phone, patient_email, notes, consent, slot_start,
  for_other, other_name, relationship, other_minor, guardian_consent, other_consent, review_token_hash)
  on table public.appointment_requests from anon, authenticated;
grant insert on table public.appointment_requests to anon, authenticated;
grant update, delete on table public.appointment_requests to authenticated;

/* ===================== 4. Schema agenda, equipe do IMED e funções novas ===================== */
drop schema if exists agenda cascade;
drop table if exists private.imed_staff;
drop function if exists public.has_clinic_perm(uuid, text);
drop function if exists public.clinic_perm_scope(uuid, text);
drop function if exists public.imed_has(text);
drop function if exists private.agenda_requests_guard();
drop function if exists private.agenda_requests_touch();
drop function if exists private.agenda_requests_history();
drop function if exists private.agenda_clinics_guard();
drop function if exists private.agenda_occupancy_seats();
drop function if exists private.agenda_resources_guard();
drop function if exists private.agenda_write_guard();
drop function if exists private.agenda_trail_guard();
drop function if exists private.agenda_access_audit();
drop function if exists private.agenda_audit_sql(uuid, text, text, text, jsonb, jsonb);
drop function if exists private.agenda_validate_patient(public.appointment_requests);
drop function if exists private.agenda_touch(uuid);
drop function if exists private.agenda_secure_session();
drop function if exists private.agenda_suggested_timezone(text, text);
drop function if exists private.agenda_reason();
drop function if exists private.agenda_origin();

/* ===================== 5. Colunas, restrições e índices novos das tabelas de hoje ===================== */
drop index if exists public.appointment_requests_clinic_slot_idx;
drop index if exists public.appointment_requests_hold_idx;
alter table public.appointment_requests drop constraint if exists appointment_requests_id_clinic_uq;
alter table public.appointment_requests drop constraint if exists appointment_requests_slot_end_ck;
alter table public.appointment_requests drop constraint if exists appointment_requests_hold_ck;
alter table public.appointment_requests
  drop column if exists channel, drop column if exists slot_end, drop column if exists hold_expires_at,
  drop column if exists version, drop column if exists updated_at, drop column if exists cancel_reason,
  drop column if exists total_cents, drop column if exists payment_mode, drop column if exists notify_channels,
  drop column if exists uses_resources;

alter table public.clinic_blocks drop constraint if exists clinic_blocks_resource_fk;
alter table public.clinic_blocks drop constraint if exists clinic_blocks_id_clinic_uq;
alter table public.clinic_blocks
  drop column if exists resource_id, drop column if exists kind, drop column if exists created_by,
  drop column if exists removed_at, drop column if exists removed_by;

alter table public.clinic_schedules drop constraint if exists clinic_schedules_resource_fk;
alter table public.clinic_schedules drop constraint if exists clinic_schedules_valid_ck;
alter table public.clinic_schedules
  drop column if exists resource_id, drop column if exists kind, drop column if exists valid_from,
  drop column if exists valid_to, drop column if exists label, drop column if exists procedure_ids,
  drop column if exists created_by, drop column if exists updated_at;

alter table public.clinic_members drop column if exists created_by, drop column if exists updated_at;

alter table public.clinics drop constraint if exists clinics_agenda_online_ck;
alter table public.clinics
  drop column if exists timezone, drop column if exists timezone_confirmed_at, drop column if exists agenda_mode,
  drop column if exists agenda_online_since;

/* ===================== 6. Extensão ===================== */
drop extension if exists btree_gist;
