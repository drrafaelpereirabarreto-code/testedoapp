-- VOLTA ÚNICA das 3 partes da migração do painel (supabase/migrations/*_agenda_painel_parte_1 a 3; iMed Agenda,
-- fase 3.4; só se for preciso desfazer). As voltas das partes 1 e 2 não fazem nada. Tem o mesmo nome da última parte:
-- se ela for renomeada, renomeie esta também. Deixa o banco como estava antes da 3.4 (testado no CI, banco.yml: depois
-- desta volta a impressão digital é IGUAL à da produção antes da 3.4, e reaplicada, igual à com ela):
--   - a restrição de papéis de clinic_members e as policies de leitura voltam ao "ser da equipe" (is_clinic_member);
--   - saem a policy do Realtime, o gatilho do preço "a partir de", as funções novas, a tabela de convites e a coluna
--     anonymized_at;
--   - agenda_touch (sem aviso), agenda_manutencao (sem a retenção), update_my_clinic e set_my_clinic_exams voltam ao
--     corpo de antes.
-- ATENÇÃO: com vínculos de equipe nos papéis novos, a volta FALHA ao recolocar a restrição de papéis (e é o certo).
-- Antes de desfazer na produção, confira:
--   select count(*) from public.clinic_members where role not in ('owner', 'staff');   -- tem de ser 0
-- (Os convites e a marca anonymized_at somem; os dados já apagados das reservas expiradas não voltam.)

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== Parte 3 ===================== */
alter policy "clinica ve pedidos para ela" on public.appointment_requests
  using (clinic_id is not null and public.is_clinic_member(clinic_id) and status not in ('hold', 'expired'));
alter policy "membro ve a agenda da clinica" on public.clinic_schedules
  using (public.is_clinic_member(clinic_id) or public.is_imed_admin());
alter policy "membro ve os bloqueios da clinica" on public.clinic_blocks
  using ((public.is_clinic_member(clinic_id) or public.is_imed_admin()) and removed_at is null);
alter table public.clinic_members drop constraint if exists clinic_members_role_check;
alter table public.clinic_members add constraint clinic_members_role_check check (role in ('owner', 'staff'));

/* ===================== Parte 2 ===================== */
drop policy if exists "agenda: avisos da agenda" on realtime.messages;
drop trigger if exists procedures_price_from on agenda.procedures;
drop function if exists private.agenda_price_from();
drop function if exists private.agenda_anonimizar(integer);
drop function if exists public.agenda_realtime_ok(text);
drop function if exists public.agenda_member_remove(uuid, uuid);
drop function if exists public.agenda_member_role(uuid, uuid, text);
drop function if exists public.agenda_invite_accept(uuid);
drop function if exists public.agenda_my_invites();
drop function if exists public.agenda_invite_cancel(uuid);
drop function if exists public.agenda_invite(uuid, text, text);
drop function if exists private.agenda_team_actor(uuid, text);
drop function if exists public.agenda_team(uuid);

/* ===================== Parte 1 ===================== */
drop function if exists public.agenda_conflict_resolve(uuid, text, text);
drop function if exists public.agenda_conflicts(uuid, boolean);
drop function if exists public.agenda_dashboard_financeiro(uuid, date, date);
drop function if exists public.agenda_dashboard(uuid, date, date, jsonb);
drop function if exists public.agenda_history(uuid);
drop function if exists public.agenda_request_detail(uuid, text);
drop function if exists public.agenda_search(uuid, text);
drop function if exists public.agenda_month(uuid, date);
drop function if exists public.agenda_view(uuid, date, integer);
drop function if exists public.agenda_version(uuid);
drop function if exists public.agenda_me();
drop function if exists private.agenda_log_access(text, uuid, uuid, text, text);
drop function if exists private.agenda_short_name(text);
drop function if exists private.agenda_request_on(uuid, uuid[]);
drop function if exists private.agenda_own_resources(uuid);
drop function if exists private.agenda_scope(uuid, text, text);
drop table if exists agenda.member_invites;
alter table public.appointment_requests drop column if exists anonymized_at;

/* ===================== As funções de antes ===================== */
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

create or replace function public.update_my_clinic(p_clinic uuid, p jsonb)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if not (public.is_clinic_member(p_clinic) or public.is_imed_admin()) then return 'forbidden'; end if;
  update public.clinics c set
    phone = case when p ? 'phone' then nullif(btrim(p ->> 'phone'), '') else c.phone end,
    whatsapp = case when p ? 'whatsapp' then nullif(regexp_replace(coalesce(p ->> 'whatsapp', ''), '\D', '', 'g'), '') else c.whatsapp end,
    email = case when p ? 'email' then nullif(lower(btrim(p ->> 'email')), '') else c.email end,
    website = case when p ? 'website' then nullif(btrim(p ->> 'website'), '') else c.website end,
    description = case when p ? 'description' then nullif(btrim(p ->> 'description'), '') else c.description end,
    opening_hours = case when p ? 'opening_hours' then nullif(p -> 'opening_hours', 'null'::jsonb) else c.opening_hours end,
    accepts_online_booking = case when p ? 'accepts_online_booking' then coalesce((p ->> 'accepts_online_booking')::boolean, false) else c.accepts_online_booking end,
    specialties = case when p ? 'specialties' then coalesce(array(select left(btrim(x), 60) from jsonb_array_elements_text(p -> 'specialties') x where btrim(x) <> '' limit 30), '{}') else c.specialties end,
    insurances = case when p ? 'insurances' then coalesce(array(select left(btrim(x), 60) from jsonb_array_elements_text(p -> 'insurances') x where btrim(x) <> '' limit 60), '{}') else c.insurances end,
    updated_at = now()
  where c.id = p_clinic;
  return 'ok';
end $$;

create or replace function public.set_my_clinic_exams(p_clinic uuid, p_exams jsonb)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if not (public.is_clinic_member(p_clinic) or public.is_imed_admin()) then return 'forbidden'; end if;
  delete from public.clinic_exams where clinic_id = p_clinic;
  insert into public.clinic_exams (clinic_id, exam_code, price_cents, price_updated_at)
  select p_clinic, x ->> 'code', nullif(x ->> 'price_cents', '')::integer,
         case when nullif(x ->> 'price_cents', '') is not null then now() end
  from jsonb_array_elements(coalesce(p_exams, '[]'::jsonb)) x
  where x ->> 'code' in ('rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab')
  on conflict do nothing;
  return 'ok';
end $$;
revoke execute on function public.update_my_clinic(uuid, jsonb) from public, anon;
grant execute on function public.update_my_clinic(uuid, jsonb) to authenticated;
revoke execute on function public.set_my_clinic_exams(uuid, jsonb) from public, anon;
grant execute on function public.set_my_clinic_exams(uuid, jsonb) to authenticated;
