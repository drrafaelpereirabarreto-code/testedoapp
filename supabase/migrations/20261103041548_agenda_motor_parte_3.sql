-- iMed Agenda, fase 3.2 ("Cadastros e motor de disponibilidade"): parte 3 de 3 (as funções de hoje, com as mesmas
-- assinaturas e permissões). O cabeçalho, com o que a migração faz e as conferências, está na parte 1.
--
-- Clínica SEM unit_settings (todas hoje): available_slots, clinics_with_schedule, set_my_schedule, add_my_block e
-- remove_my_block fazem EXATAMENTE o que faziam (o corpo de 20261030034539_agenda, copiado). Clínica COM unit_settings
-- (entrou na agenda nova pelos cadastros da parte 2):
--   - available_slots: o motor novo, pelos procedimentos da categoria p_exam à venda online (o padrão da categoria,
--     default_for_exam, se houver; senão a união), só com a venda online ligada; até 31 dias e 2000 horários;
--   - clinics_with_schedule: só se vende online (publicada, aceita pedidos, não fictícia, com procedimento à venda);
--   - set_my_schedule: responde managed_by_agenda e não grava (as regras novas vêm de agenda_rules_set);
--   - add_my_block: bloqueio da unidade inteira no modelo novo; com agendamento no intervalo responde
--     has_appointments e não grava; período inválido: invalid_period;
--   - remove_my_block: remoção lógica, e os fechamentos saem da ocupação.
-- O editor antigo e a ativação disputam a mesma trava de configuração (set_my_schedule pega a exclusiva antes de
-- olhar o modo), então uma faixa antiga nunca entra numa clínica que acabou de entrar na agenda nova.
-- A leitura direta dos bloqueios (policy) passa a esconder os removidos (no modo de hoje nada é removido assim).

/* ===================== 0. Limite de espera ===================== */
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 12. Fachadas ===================== */

-- Horários livres de uma clínica parceira para um exame. Público (não mostra quem marcou).
create or replace function public.available_slots(p_clinic uuid, p_exam text default null, p_from date default null, p_days integer default 14)
returns table (slot_start timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_from date;
begin
  if not exists (select 1 from agenda.unit_settings u where u.clinic_id = p_clinic) then
    -- modo de hoje (sem a agenda nova): igual a 20261030034539_agenda
    return query
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
    return;
  end if;
  -- agenda nova: só com a venda online ligada
  select c.timezone into v_tz from public.clinics c
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

-- Clínica com agenda? (para o site saber se mostra horários ou o pedido).
create or replace function public.clinics_with_schedule(p_ids uuid[])
returns table (clinic_id uuid)
language sql stable security definer
set search_path = ''
as $$
  -- modo de hoje: igual a 20261030034539_agenda
  select distinct s.clinic_id from public.clinic_schedules s
  join public.clinics c on c.id = s.clinic_id and c.status = 'published' and c.accepts_online_booking
  where s.clinic_id = any (p_ids[1:300])
    and not exists (select 1 from agenda.unit_settings u where u.clinic_id = s.clinic_id)
  union
  -- agenda nova: só com a venda online ligada e algum procedimento à venda
  select c.id from public.clinics c
  join agenda.unit_settings u on u.clinic_id = c.id
  where c.id = any (p_ids[1:300]) and c.status = 'published' and c.accepts_online_booking and not c.is_demo
    and c.agenda_online_since is not null
    and exists (select 1 from agenda.procedures p
                where p.clinic_id = c.id and p.active and p.archived_at is null and p.online_booking);
$$;
revoke execute on function public.clinics_with_schedule(uuid[]) from public;
grant execute on function public.clinics_with_schedule(uuid[]) to anon, authenticated;

-- A clínica grava a agenda semanal (a lista enviada substitui a anterior). Na agenda nova: managed_by_agenda.
create or replace function public.set_my_schedule(p_clinic uuid, p_rows jsonb)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if not (public.is_clinic_member(p_clinic) or public.is_imed_admin()) then return 'forbidden'; end if;
  -- a mesma trava da ativação (agenda_unit_save): uma faixa antiga nunca entra numa clínica que acabou de mudar
  perform private.agenda_lock_config(p_clinic, true);
  if exists (select 1 from agenda.unit_settings u where u.clinic_id = p_clinic) then return 'managed_by_agenda'; end if;
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
  if exists (select 1 from agenda.unit_settings u where u.clinic_id = p_clinic) then
    return private.agenda_block_add_int(p_clinic, null, p_starts, p_ends, 'bloqueio', p_reason,
             case when public.is_clinic_member(p_clinic) then 'painel' else 'central' end) ->> 'status';
  end if;
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
  if exists (select 1 from agenda.unit_settings u where u.clinic_id = cid) then
    return private.agenda_block_remove_int(p_block, case when public.is_clinic_member(cid) then 'painel' else 'central' end) ->> 'status';
  end if;
  delete from public.clinic_blocks where id = p_block;
  return 'ok';
end $$;
revoke execute on function public.remove_my_block(uuid) from public, anon;
grant execute on function public.remove_my_block(uuid) to authenticated;

/* ===================== 13. Leitura direta dos bloqueios: sem os removidos ===================== */
alter policy "membro ve os bloqueios da clinica" on public.clinic_blocks
  using ((public.is_clinic_member(clinic_id) or public.is_imed_admin()) and removed_at is null);

/* ===================== 14. Descrições ===================== */
comment on function public.available_slots(uuid, text, date, integer) is
  'Horários livres (público). Sem agenda nova: a grade antiga (20261030034539_agenda). Com agenda nova: o motor (agenda_free_starts), só com a venda online ligada.';
comment on function public.set_my_schedule(uuid, jsonb) is
  'Editor antigo de horários. Clínica na agenda nova: managed_by_agenda (as regras vêm de agenda_rules_set).';
comment on table agenda.unit_settings is
  'Configurações da unidade na agenda nova. A linha existir = a clínica usa a agenda nova (criada por agenda_unit_save).';
