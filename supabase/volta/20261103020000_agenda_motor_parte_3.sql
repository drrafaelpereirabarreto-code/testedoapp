-- VOLTA ÚNICA das 3 partes da migração do motor (supabase/migrations/*_agenda_motor_parte_1 a 3; iMed Agenda, fase
-- 3.2; só se for preciso desfazer). As voltas das partes 1 e 2 não fazem nada. Tem o mesmo nome da última parte: se
-- ela for renomeada, renomeie esta também. Deixa o banco como estava antes (testado no CI, .github/workflows/banco.yml:
-- depois desta volta a impressão digital é IGUAL à da produção antes da 3.2, e reaplicada, igual à com ela):
--   - available_slots, clinics_with_schedule, set_my_schedule, add_my_block e remove_my_block voltam ao corpo de
--     20261030034539_agenda (copiado abaixo);
--   - a policy de leitura dos bloqueios volta a mostrar todos;
--   - saem as funções novas da 3.2 (public.agenda_* e private.agenda_* desta fase).
-- ATENÇÃO: os dados gravados pelos cadastros (unit_settings, recursos, procedimentos, regras, bloqueios, feriados)
-- FICAM nas tabelas da 3.1; sem as funções da 3.2 eles não são usados. Clínica que entrou na agenda nova volta a ser
-- tratada pelo modo de hoje (e as regras novas em clinic_schedules passariam a valer como grade antiga): antes de
-- desfazer na produção, confira "select count(*) from agenda.unit_settings" (tem de ser 0).

/* ===================== 1. As funções de hoje como eram (20261030034539_agenda) ===================== */
-- Horários livres de uma clínica parceira para um exame. Público (não mostra quem marcou).
create or replace function public.available_slots(p_clinic uuid, p_exam text default null, p_from date default null, p_days integer default 14)
returns table (slot_start timestamptz)
language sql stable security definer
set search_path = ''
as $$
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
$$;
revoke execute on function public.available_slots(uuid, text, date, integer) from public;
grant execute on function public.available_slots(uuid, text, date, integer) to anon, authenticated;

-- Clínica com agenda? (para o site saber se mostra horários ou o pedido).
create or replace function public.clinics_with_schedule(p_ids uuid[])
returns table (clinic_id uuid)
language sql stable security definer
set search_path = ''
as $$
  select distinct s.clinic_id from public.clinic_schedules s
  join public.clinics c on c.id = s.clinic_id and c.status = 'published' and c.accepts_online_booking
  where s.clinic_id = any (p_ids[1:300]);
$$;
revoke execute on function public.clinics_with_schedule(uuid[]) from public;
grant execute on function public.clinics_with_schedule(uuid[]) to anon, authenticated;

-- A clínica grava a agenda semanal (a lista enviada substitui a anterior).
create or replace function public.set_my_schedule(p_clinic uuid, p_rows jsonb)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if not (public.is_clinic_member(p_clinic) or public.is_imed_admin()) then return 'forbidden'; end if;
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

create or replace function public.add_my_block(p_clinic uuid, p_starts timestamptz, p_ends timestamptz, p_reason text default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if not (public.is_clinic_member(p_clinic) or public.is_imed_admin()) then return 'forbidden'; end if;
  insert into public.clinic_blocks (clinic_id, starts_at, ends_at, reason) values (p_clinic, p_starts, p_ends, left(p_reason, 120));
  return 'ok';
end $$;
revoke execute on function public.add_my_block(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.add_my_block(uuid, timestamptz, timestamptz, text) to authenticated;

create or replace function public.remove_my_block(p_block uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare cid uuid;
begin
  select clinic_id into cid from public.clinic_blocks where id = p_block;
  if cid is null then return 'not_found'; end if;
  if not (public.is_clinic_member(cid) or public.is_imed_admin()) then return 'forbidden'; end if;
  delete from public.clinic_blocks where id = p_block;
  return 'ok';
end $$;
revoke execute on function public.remove_my_block(uuid) from public, anon;
grant execute on function public.remove_my_block(uuid) to authenticated;

/* ===================== 2. Policy de leitura dos bloqueios ===================== */
alter policy "membro ve os bloqueios da clinica" on public.clinic_blocks
  using (public.is_clinic_member(clinic_id) or public.is_imed_admin());
comment on function public.available_slots(uuid, text, date, integer) is null;
comment on function public.set_my_schedule(uuid, jsonb) is null;
comment on table agenda.unit_settings is null;

/* ===================== 3. Funções novas da 3.2 ===================== */
drop function if exists public.agenda_block_remove(uuid);
drop function if exists public.agenda_block_add(uuid, uuid, timestamptz, timestamptz, text, text);
drop function if exists public.agenda_holiday_opening_set(uuid, date, boolean, boolean);
drop function if exists public.agenda_holiday_remove(uuid);
drop function if exists public.agenda_holiday_save(jsonb);
drop function if exists public.agenda_rules_set(uuid, uuid, jsonb, boolean);
drop function if exists public.agenda_pair_rules_set(uuid, jsonb);
drop function if exists public.agenda_procedure_save(uuid, jsonb, boolean);
drop function if exists public.agenda_resource_save(uuid, jsonb, boolean);
drop function if exists public.agenda_unit_save(uuid, jsonb, boolean);
drop function if exists public.agenda_days(uuid, uuid, date, date);
drop function if exists public.agenda_slots(uuid, uuid, date, date);
drop function if exists public.agenda_public_info(uuid);
drop function if exists private.agenda_block_remove_int(uuid, text);
drop function if exists private.agenda_block_add_int(uuid, uuid, timestamptz, timestamptz, text, text, text);
drop function if exists private.agenda_unknown_keys(jsonb, text[]);
drop function if exists private.agenda_has_future_items(uuid);
drop function if exists private.agenda_err(text, text);
drop function if exists private.agenda_can_see_slots(uuid, uuid);
drop function if exists private.agenda_revalidate(uuid, boolean);
drop function if exists private.agenda_item_fits(uuid);
drop function if exists private.agenda_free_starts(uuid, uuid, date, date, timestamptz, uuid[]);
drop function if exists private.agenda_need(timestamptz, integer, integer, integer, integer, integer, text);
drop function if exists private.agenda_floor(timestamptz, integer, text);
drop function if exists private.agenda_free_map(uuid, uuid[], timestamptz, timestamptz, timestamptz, uuid, uuid[]);
drop function if exists private.agenda_unit_free(uuid, timestamptz, timestamptz, uuid);
drop function if exists private.agenda_holiday_ranges(uuid, timestamptz, timestamptz);
drop function if exists private.agenda_rule_windows(uuid, timestamptz, timestamptz, uuid);
drop function if exists private.agenda_audit(uuid, text, text, text, text, jsonb, jsonb);
drop function if exists private.agenda_actor(uuid, text, text);
drop function if exists private.agenda_lock_resources(uuid[]);
drop function if exists private.agenda_lock_config(uuid, boolean);
