-- Agenda com horário para clínicas parceiras: a clínica define os horários de atendimento por exame e os
-- bloqueios (feriados, manutenção). O paciente escolhe um horário livre e o agendamento já sai confirmado.
-- Locais sem agenda continuam no modelo de pedido (a equipe ou a clínica liga para combinar).

create table if not exists public.clinic_schedules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),          -- 0 = domingo
  start_time time not null,
  end_time time not null check (end_time > start_time),
  slot_minutes smallint not null default 30 check (slot_minutes between 5 and 240),
  exam_codes text[] not null default '{}',                              -- vazio = todos os exames da clínica
  created_at timestamptz not null default now()
);
create index if not exists clinic_schedules_clinic_idx on public.clinic_schedules (clinic_id);

create table if not exists public.clinic_blocks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  reason text check (reason is null or char_length(reason) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists clinic_blocks_clinic_idx on public.clinic_blocks (clinic_id, starts_at);

alter table public.clinic_schedules enable row level security;
alter table public.clinic_blocks enable row level security;
revoke all on public.clinic_schedules, public.clinic_blocks from anon;
revoke insert, update, delete, truncate on public.clinic_schedules, public.clinic_blocks from authenticated;
create policy "membro ve a agenda da clinica" on public.clinic_schedules
  for select to authenticated using (public.is_clinic_member(clinic_id) or public.is_imed_admin());
create policy "membro ve os bloqueios da clinica" on public.clinic_blocks
  for select to authenticated using (public.is_clinic_member(clinic_id) or public.is_imed_admin());

-- Horário escolhido pelo paciente (só para clínica com agenda).
alter table public.appointment_requests add column if not exists slot_start timestamptz;
create unique index if not exists appointment_requests_slot_uq
  on public.appointment_requests (clinic_id, coalesce(exam_code, ''), slot_start)
  where slot_start is not null and status <> 'cancelled';

-- Gera os horários de uma clínica num intervalo (horário de São Paulo), sem olhar se estão ocupados.
create or replace function private.clinic_slot_grid(p_clinic uuid, p_exam text, p_from date, p_days integer)
returns table (slot_start timestamptz)
language sql stable
set search_path = ''
as $$
  select (t at time zone 'America/Sao_Paulo') as slot_start
  from generate_series(p_from::timestamp, (p_from + (least(greatest(p_days, 1), 31) - 1))::timestamp, interval '1 day') d
  join public.clinic_schedules s
    on s.clinic_id = p_clinic and s.weekday = extract(dow from d)::smallint
   and (cardinality(s.exam_codes) = 0 or p_exam = any (s.exam_codes))
  cross join lateral generate_series(d + s.start_time, d + s.end_time - make_interval(mins => s.slot_minutes), make_interval(mins => s.slot_minutes)) t
$$;

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

-- Pedido com horário: confere se o horário existe e está livre; se estiver, já sai confirmado.
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

drop policy if exists "qualquer pessoa pede agendamento" on public.appointment_requests;
create policy "qualquer pessoa pede agendamento" on public.appointment_requests
  for insert to anon, authenticated with check (consent and status in ('pending', 'confirmed'));

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
