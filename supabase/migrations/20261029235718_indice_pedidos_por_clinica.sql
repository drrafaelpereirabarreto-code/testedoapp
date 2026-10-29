-- Índice para a chave estrangeira dos pedidos (sugestão do Supabase Advisor):
-- acelera a lista de pedidos de uma clínica e a exclusão de clínicas.
create index if not exists appointment_requests_clinic_idx on public.appointment_requests (clinic_id);
