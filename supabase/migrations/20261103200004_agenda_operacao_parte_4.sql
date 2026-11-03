-- iMed Agenda, fase 3.3: parte 4 de 4 (a ÚNICA destrutiva, pequena e aplicada por último; o conector pede a aprovação
-- do dono). O cabeçalho está na parte 1. Nada de dado é apagado; só um índice que perdeu a função e três restrições
-- trocadas por versões mais largas (os valores de hoje continuam valendo).
--   1. Sai o índice appointment_requests_slot_uq (clínica, exame e início): ele só comparava o INÍCIO do horário e
--      recusaria, por engano, dois exames no mesmo início em aparelhos diferentes. Quem garante o horário agora é a
--      restrição de exclusão da ocupação (3.1), e o caminho antigo com horário foi fechado na parte 1.
--   2. Situações do agendamento: as 5 de hoje + reserva temporária, aguardando pagamento, presente, em atendimento,
--      não compareceu, remarcação solicitada e reserva expirada (§5).
--   3. Quem cancelou: patient, clinic e imed de hoje + system (rotinas) e external (sistema da clínica).
--   4. Por que a ocupação foi solta: os motivos de hoje + concluido e faltou (atendimento encerrado).
-- Pode rodar de novo sem erro e sem mudar nada. Volta (das 4 partes): supabase/volta/<versão>_agenda_operacao_parte_4.sql.

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

drop index if exists public.appointment_requests_slot_uq;

alter table public.appointment_requests drop constraint if exists appointment_requests_status_check;
alter table public.appointment_requests add constraint appointment_requests_status_check
  check (status in ('pending', 'contacted', 'hold', 'awaiting_payment', 'confirmed', 'checked_in', 'in_service', 'completed',
                    'no_show', 'reschedule_requested', 'cancelled', 'expired'));

alter table public.appointment_requests drop constraint if exists appointment_requests_cancelled_by_check;
alter table public.appointment_requests add constraint appointment_requests_cancelled_by_check
  check (cancelled_by is null or cancelled_by in ('patient', 'clinic', 'imed', 'system', 'external'));

alter table agenda.occupancy drop constraint if exists occupancy_release_reason_check;
alter table agenda.occupancy add constraint occupancy_release_reason_check
  check (release_reason in ('cancelado', 'expirada', 'remarcado', 'bloqueio_forcado', 'removido', 'capacidade', 'corrigido',
                            'concluido', 'faltou'));
