-- iMed Agenda, fase 3.4: parte 3 de 3 (a ÚNICA que troca regra existente; pequena e aplicada por último; o conector
-- pede a aprovação do dono). O cabeçalho está na parte 1. Nenhum dado é apagado.
--   1. Papéis da equipe da clínica: aos dois de hoje (owner, staff) somam-se gestor, recepção, profissional e
--      financeiro (manager, reception, professional, finance; §12). A restrição é trocada por uma mais larga: os
--      vínculos de hoje continuam valendo (na produção, 0 vínculos em 03/11/2026).
--   2. As leituras diretas antigas passam a exigir a PERMISSÃO certa em vez de "ser da equipe" (§12: sem isso o
--      financeiro e o profissional, que os convites passam a criar, leriam telefones de pacientes):
--      pedidos da clínica → pedidos.ver; horários e bloqueios → agenda.ver. Para os papéis de hoje (dono e staff)
--      nada muda.
-- Pode rodar de novo sem erro e sem mudar nada. Volta (das 3 partes): supabase/volta/<versão>_agenda_painel_parte_3.sql.

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

alter table public.clinic_members drop constraint if exists clinic_members_role_check;
alter table public.clinic_members add constraint clinic_members_role_check
  check (role in ('owner', 'manager', 'reception', 'professional', 'finance', 'staff'));

alter policy "clinica ve pedidos para ela" on public.appointment_requests
  using (clinic_id is not null and public.has_clinic_perm(clinic_id, 'pedidos.ver') and status not in ('hold', 'expired'));
alter policy "membro ve a agenda da clinica" on public.clinic_schedules
  using (public.has_clinic_perm(clinic_id, 'agenda.ver') or public.is_imed_admin());
alter policy "membro ve os bloqueios da clinica" on public.clinic_blocks
  using ((public.has_clinic_perm(clinic_id, 'agenda.ver') or public.is_imed_admin()) and removed_at is null);
