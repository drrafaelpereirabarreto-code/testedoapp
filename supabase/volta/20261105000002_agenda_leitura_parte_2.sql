-- VOLTA ÚNICA das 2 partes da migração agenda_leitura (iMed Agenda, fase 4.2; só se for preciso desfazer). Tem o mesmo
-- nome da migração da parte 2: se ela for renomeada, renomeie esta também. Testada no CI (banco.yml): depois dela a
-- impressão digital é IGUAL à da produção antes da 4.2; reaplicadas as 2 partes, igual à com elas.
-- Para desfazer SÓ o fechamento (parte 2), rode só o primeiro bloco. Bloqueios, conflitos e situações gravados pelas
-- funções novas ficam (são dados).
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== Parte 2 (o fechamento) ===================== */
grant select on table public.clinic_schedules, public.clinic_blocks to authenticated;
alter policy "membro ve os bloqueios da clinica" on public.clinic_blocks
  using ((public.has_clinic_perm(clinic_id, 'agenda.ver') or public.is_imed_admin()) and removed_at is null);
alter policy "membro ve a agenda da clinica" on public.clinic_schedules
  using (public.has_clinic_perm(clinic_id, 'agenda.ver') or public.is_imed_admin());
alter policy "admin le pedidos" on public.appointment_requests
  using (public.is_imed_admin() and status not in ('hold', 'expired'));
alter policy "clinica ve pedidos para ela" on public.appointment_requests
  using (clinic_id is not null and public.has_clinic_perm(clinic_id, 'pedidos.ver') and status not in ('hold', 'expired'));

/* ===================== Parte 1 ===================== */
drop function if exists public.agenda_attend(uuid, text, text, integer, uuid);
drop function if exists public.agenda_block_force(uuid, uuid, timestamptz, timestamptz, text, text, text);
drop function if exists public.agenda_requests(uuid, text, text);
drop function if exists public.agenda_blocks(uuid, date, date);
drop function if exists public.agenda_desk_slots(uuid, uuid, date, date, uuid, uuid);
drop function if exists public.agenda_free(uuid, date, integer);
drop function if exists public.agenda_catalog(uuid);
drop function if exists private.agenda_national_until();
drop function if exists private.agenda_block_hits(uuid, uuid[], timestamptz, timestamptz);
