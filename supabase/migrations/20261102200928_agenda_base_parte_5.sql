-- iMed Agenda, fase 3.1 ("Fundação"): parte 5 de 5 (blocos 12 a 18). O cabeçalho, com o que a
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

/* ===================== 12. Trilhas: só acrescentam ===================== */
-- UPDATE, DELETE e TRUNCATE dão erro, até pelo SQL do painel. Exceções: a rotina de retenção (dono do banco, com
-- set local imed.retencao = 'on') e, em access_log, a mesma leitura no mesmo dia somando reads e last_at.
create or replace function private.agenda_trail_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if session_user = 'postgres' and current_setting('imed.retencao', true) = 'on' then
    if tg_op = 'TRUNCATE' then return null; end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  -- (bloco próprio: o PL/pgSQL só resolve new.<coluna> da tabela do gatilho)
  if tg_op = 'UPDATE' and tg_table_name = 'access_log' then
    if (new.id, new.day, new.first_at, new.user_id, new.clinic_id, new.fn, new.request_id, new.scope, new.justification_code)
       is not distinct from
       (old.id, old.day, old.first_at, old.user_id, old.clinic_id, old.fn, old.request_id, old.scope, old.justification_code)
       and new.reads >= old.reads and new.last_at >= old.last_at then
      return new;
    end if;
  end if;
  raise exception 'trilha_so_acrescenta: % não pode mudar nem ser apagada', tg_table_name
    using errcode = 'P0001', hint = 'Trilhas da agenda só recebem linhas novas (a retenção é a única exceção).';
end $$;
revoke all on function private.agenda_trail_guard() from public, anon, authenticated, service_role;

create or replace trigger status_history_guard
  before update or delete on agenda.status_history for each row execute function private.agenda_trail_guard();
create or replace trigger status_history_guard_truncate
  before truncate on agenda.status_history for each statement execute function private.agenda_trail_guard();
create or replace trigger audit_log_guard
  before update or delete on agenda.audit_log for each row execute function private.agenda_trail_guard();
create or replace trigger audit_log_guard_truncate
  before truncate on agenda.audit_log for each statement execute function private.agenda_trail_guard();
create or replace trigger access_log_guard
  before update or delete on agenda.access_log for each row execute function private.agenda_trail_guard();
create or replace trigger access_log_guard_truncate
  before truncate on agenda.access_log for each statement execute function private.agenda_trail_guard();

/* ===================== 13. Permissões do pedido: INSERT coluna por coluna, sem UPDATE/DELETE diretos ===================== */
-- O site grava exatamente estas 23 colunas (assets/js/geo-core.js, bookingRow, mais review_token_hash; conferido
-- por supabase/tests/000_catalogo.sql e tests/banco/pedido-do-site.mjs). As colunas novas e as de controle
-- (status, user_id, created_at, cancelled_*) ficam sem INSERT para o navegador. UPDATE e DELETE pela API acabam:
-- a policy "admin atualiza pedidos" fica sem efeito (ALTER POLICY, nada é apagado).
revoke insert, update, delete on table public.appointment_requests from anon, authenticated;
grant insert (id, clinic_id, place_source, place_ref, place_name, place_address, place_phone, exam_code,
  preferred_date, preferred_period, patient_name, patient_phone, patient_email, notes, consent, slot_start,
  for_other, other_name, relationship, other_minor, guardian_consent, other_consent, review_token_hash)
  on table public.appointment_requests to anon, authenticated;
alter policy "admin atualiza pedidos" on public.appointment_requests using (false) with check (false);

/* ===================== 14. Referências: papéis e permissões (§12) ===================== */
insert into agenda.role_permissions (role, permission, scope) values
  -- dono: tudo
  ('owner', 'pedidos.ver', 'clinica'), ('owner', 'agenda.ver', 'clinica'), ('owner', 'agenda.pacientes', 'clinica'),
  ('owner', 'agenda.marcar', 'clinica'), ('owner', 'agenda.cancelar', 'clinica'), ('owner', 'agenda.remarcar', 'clinica'),
  ('owner', 'agenda.atender', 'clinica'), ('owner', 'agenda.bloquear', 'clinica'), ('owner', 'agenda.configurar', 'clinica'),
  ('owner', 'precos.editar', 'clinica'), ('owner', 'clinica.editar', 'clinica'), ('owner', 'equipe.gerenciar', 'clinica'),
  ('owner', 'financeiro.ver', 'clinica'), ('owner', 'integracao.gerenciar', 'clinica'), ('owner', 'auditoria.ver', 'clinica'),
  ('owner', 'conflitos.resolver', 'clinica'),
  -- gestor: tudo, menos integração; equipe sem mexer nos donos
  ('manager', 'pedidos.ver', 'clinica'), ('manager', 'agenda.ver', 'clinica'), ('manager', 'agenda.pacientes', 'clinica'),
  ('manager', 'agenda.marcar', 'clinica'), ('manager', 'agenda.cancelar', 'clinica'), ('manager', 'agenda.remarcar', 'clinica'),
  ('manager', 'agenda.atender', 'clinica'), ('manager', 'agenda.bloquear', 'clinica'), ('manager', 'agenda.configurar', 'clinica'),
  ('manager', 'precos.editar', 'clinica'), ('manager', 'clinica.editar', 'clinica'), ('manager', 'equipe.gerenciar', 'sem_donos'),
  ('manager', 'financeiro.ver', 'clinica'), ('manager', 'auditoria.ver', 'clinica'), ('manager', 'conflitos.resolver', 'clinica'),
  -- recepção (e "staff", o papel antigo, igual à recepção)
  ('reception', 'pedidos.ver', 'clinica'), ('reception', 'agenda.ver', 'clinica'), ('reception', 'agenda.pacientes', 'clinica'),
  ('reception', 'agenda.marcar', 'clinica'), ('reception', 'agenda.cancelar', 'clinica'), ('reception', 'agenda.remarcar', 'clinica'),
  ('reception', 'agenda.atender', 'clinica'), ('reception', 'agenda.bloquear', 'clinica'), ('reception', 'conflitos.resolver', 'clinica'),
  ('staff', 'pedidos.ver', 'clinica'), ('staff', 'agenda.ver', 'clinica'), ('staff', 'agenda.pacientes', 'clinica'),
  ('staff', 'agenda.marcar', 'clinica'), ('staff', 'agenda.cancelar', 'clinica'), ('staff', 'agenda.remarcar', 'clinica'),
  ('staff', 'agenda.atender', 'clinica'), ('staff', 'agenda.bloquear', 'clinica'), ('staff', 'conflitos.resolver', 'clinica'),
  -- profissional: só a própria agenda (pacientes sem telefone)
  ('professional', 'agenda.ver', 'propria'), ('professional', 'agenda.pacientes', 'propria'), ('professional', 'agenda.atender', 'propria'),
  -- financeiro: só o financeiro (não vê nomes)
  ('finance', 'financeiro.ver', 'clinica'),
  -- equipe do IMED (proposta; decisão 21 do dono: quem recebe cada papel). O dono (is_imed_admin) tem todas.
  ('imed_operacao', 'imed.agenda.monitor', 'imed'), ('imed_operacao', 'imed.agenda.operar', 'imed'),
  ('imed_operacao', 'imed.pacientes.ver', 'imed'), ('imed_operacao', 'imed.conflitos.resolver', 'imed'),
  ('imed_operacao', 'imed.feriados.editar', 'imed'), ('imed_operacao', 'imed.clinicas.configurar', 'imed'),
  ('imed_suporte', 'imed.agenda.monitor', 'imed'),
  ('imed_financeiro', 'imed.financeiro.ver', 'imed'),
  ('imed_auditoria', 'imed.agenda.monitor', 'imed'), ('imed_auditoria', 'imed.auditoria.ver', 'imed')
on conflict (role, permission) do nothing;

/* ===================== 15. Referências: transições da máquina de estados (§5) ===================== */
-- Usadas pela 3.3 (agenda_transition e as fachadas set_request_status/cancel_request). Hoje nada as consulta.
insert into agenda.status_transitions (from_status, to_status, actor_kind, permission, requires_reason, time_rule, needs_engine) values
  -- nascer
  ('novo', 'pending', 'paciente', null, false, null, false),                          -- pedido sem horário, igual a hoje
  ('novo', 'confirmed', 'paciente', null, false, null, true),                         -- agenda_book, sem pagamento online
  ('novo', 'confirmed', 'clinica', 'agenda.marcar', false, null, true),               -- balcão
  ('novo', 'confirmed', 'imed', 'imed.agenda.operar', false, null, true),
  ('novo', 'hold', 'paciente', null, false, null, true),                              -- só com pagamento online (5.4)
  ('novo', 'hold', 'integracao', null, false, null, true),                            -- aguardando o sistema da clínica
  -- reserva e pagamento
  ('hold', 'awaiting_payment', 'paciente', null, false, 'antes_do_prazo', false),
  ('hold', 'confirmed', 'integracao', null, false, 'antes_do_prazo', false),
  ('awaiting_payment', 'confirmed', 'gateway', null, false, null, false),             -- pagamento aprovado e valor conferido
  ('hold', 'expired', 'sistema', null, false, 'prazo_vencido', false),
  ('awaiting_payment', 'expired', 'sistema', null, false, 'prazo_vencido', false),
  ('hold', 'cancelled', 'paciente', null, false, null, false),
  ('hold', 'cancelled', 'clinica', 'agenda.cancelar', true, null, false),
  ('awaiting_payment', 'cancelled', 'paciente', null, false, null, false),
  ('awaiting_payment', 'cancelled', 'clinica', 'agenda.cancelar', true, null, false),
  ('expired', 'confirmed', 'sistema', null, false, null, true),                       -- pagamento atrasado, se o horário ainda estiver livre
  -- pedido (como hoje)
  ('pending', 'contacted', 'clinica', 'pedidos.ver', false, null, false),
  ('pending', 'contacted', 'imed', 'imed.agenda.operar', false, null, false),
  ('contacted', 'pending', 'clinica', 'pedidos.ver', false, null, false),
  ('contacted', 'pending', 'imed', 'imed.agenda.operar', false, null, false),
  ('pending', 'confirmed', 'clinica', 'pedidos.ver', false, null, false),
  ('pending', 'confirmed', 'imed', 'imed.agenda.operar', false, null, false),
  ('contacted', 'confirmed', 'clinica', 'pedidos.ver', false, null, false),
  ('contacted', 'confirmed', 'imed', 'imed.agenda.operar', false, null, false),
  ('pending', 'cancelled', 'paciente', null, false, null, false),
  ('pending', 'cancelled', 'clinica', 'pedidos.ver', false, null, false),
  ('pending', 'cancelled', 'imed', 'imed.agenda.operar', false, null, false),
  ('contacted', 'cancelled', 'paciente', null, false, null, false),
  ('contacted', 'cancelled', 'clinica', 'pedidos.ver', false, null, false),
  ('contacted', 'cancelled', 'imed', 'imed.agenda.operar', false, null, false),
  -- atendimento
  ('confirmed', 'checked_in', 'clinica', 'agenda.atender', false, 'janela_de_chegada', false),
  ('checked_in', 'in_service', 'clinica', 'agenda.atender', false, null, false),
  ('in_service', 'completed', 'clinica', 'agenda.atender', false, null, false),
  ('confirmed', 'completed', 'clinica', 'agenda.atender', false, 'depois_do_inicio', false),   -- fluxo simples (decisão 23)
  ('confirmed', 'completed', 'imed', 'imed.agenda.operar', false, 'depois_do_inicio', false),
  ('confirmed', 'no_show', 'clinica', 'agenda.atender', false, 'depois_da_tolerancia', false),
  ('no_show', 'checked_in', 'clinica', 'agenda.atender', true, 'mesmo_dia', true),        -- volta a ocupar: motor completo (I2)
  -- remarcação
  ('confirmed', 'reschedule_requested', 'paciente', null, false, 'prazo_remarcar_paciente', false),
  ('confirmed', 'reschedule_requested', 'clinica', 'agenda.remarcar', false, null, false),
  ('confirmed', 'reschedule_requested', 'sistema', null, true, null, false),          -- bloqueio forçado: libera e abre conflito
  ('reschedule_requested', 'confirmed', 'paciente', null, false, 'prazo_remarcar_paciente', true),
  ('reschedule_requested', 'confirmed', 'clinica', 'agenda.remarcar', false, null, true),
  -- cancelamento com horário
  ('confirmed', 'cancelled', 'paciente', null, false, 'prazo_cancelar_paciente', false),
  ('reschedule_requested', 'cancelled', 'paciente', null, false, 'prazo_cancelar_paciente', false),
  ('checked_in', 'cancelled', 'paciente', null, false, 'prazo_cancelar_paciente', false),
  ('confirmed', 'cancelled', 'clinica', 'agenda.cancelar', true, null, false),
  ('reschedule_requested', 'cancelled', 'clinica', 'agenda.cancelar', true, null, false),
  ('checked_in', 'cancelled', 'clinica', 'agenda.cancelar', true, null, false),
  ('confirmed', 'cancelled', 'imed', 'imed.agenda.operar', true, null, false),
  ('reschedule_requested', 'cancelled', 'imed', 'imed.agenda.operar', true, null, false),
  ('checked_in', 'cancelled', 'imed', 'imed.agenda.operar', true, null, false),
  -- só a equipe do IMED: reabrir (volta à situação anterior pelo motor completo) e corrigir
  ('cancelled', 'pending', 'imed', 'imed.agenda.operar', false, null, false),
  ('cancelled', 'contacted', 'imed', 'imed.agenda.operar', false, null, false),
  ('cancelled', 'confirmed', 'imed', 'imed.agenda.operar', false, null, true),
  ('cancelled', 'reschedule_requested', 'imed', 'imed.agenda.operar', false, null, true),
  ('cancelled', 'checked_in', 'imed', 'imed.agenda.operar', false, null, true),
  ('completed', 'no_show', 'imed', 'imed.agenda.operar', true, null, false),
  ('no_show', 'completed', 'imed', 'imed.agenda.operar', true, null, false)
on conflict (from_status, to_status, actor_kind) do nothing;

/* ===================== 16. Quem dá acesso fica registrado (§12: equipe na auditoria) ===================== */
-- Toda mudança na equipe do IMED (private.imed_staff) e na matriz de permissões (agenda.role_permissions) vai para
-- agenda.audit_log, com a origem e o motivo quando houver (sem marca = 'sql'). Na equipe, tirar o acesso = preencher
-- revoked_at: o DELETE só passa quando a conta já foi apagada (cascata de auth.users). TRUNCATE dá erro nas duas.
-- (As linhas de referência do bloco 14 entram antes destes gatilhos: a matriz inicial é a da migração.)
create or replace function private.agenda_access_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := coalesce(private.agenda_origin(), 'sql');
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'TRUNCATE' then
    raise exception '%: não se apaga em bloco (cada mudança de acesso fica registrada)', tg_table_name using errcode = '42501';
  end if;
  if tg_when = 'BEFORE' then   -- só DELETE em private.imed_staff
    if exists (select 1 from auth.users u where u.id = old.user_id) then
      raise exception 'Equipe do IMED: para tirar o acesso, preencha revoked_at (o registro não se apaga)' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  insert into agenda.audit_log (clinic_id, actor_kind, actor_user, actor_role, origin, action, object_type, object_id,
                                old_value, new_value, reason_code)
  values (null,
          case v_origin when 'app' then 'paciente' when 'painel' then 'clinica' when 'central' then 'imed'
                        when 'api' then 'integracao' when 'webhook_pagamento' then 'gateway' when 'cron' then 'sistema'
                        else 'sql' end,
          auth.uid(), null, v_origin, tg_table_name || '_' || lower(tg_op), tg_table_name,
          coalesce(v_new, v_old) ->> 'user_id', v_old, v_new, private.agenda_reason());
  return null;
end $$;
revoke all on function private.agenda_access_audit() from public, anon, authenticated, service_role;

create or replace trigger imed_staff_guard
  before delete on private.imed_staff
  for each row execute function private.agenda_access_audit();
create or replace trigger imed_staff_audit
  after insert or update or delete on private.imed_staff
  for each row execute function private.agenda_access_audit();
create or replace trigger imed_staff_guard_truncate
  before truncate on private.imed_staff
  for each statement execute function private.agenda_access_audit();
create or replace trigger role_permissions_audit
  after insert or update or delete on agenda.role_permissions
  for each row execute function private.agenda_access_audit();
create or replace trigger role_permissions_guard_truncate
  before truncate on agenda.role_permissions
  for each statement execute function private.agenda_access_audit();

/* ===================== 17. Guardas valem sempre (ENABLE ALWAYS) ===================== */
-- Com session_replication_role = replica (o dono do banco consegue ligar na produção: está em
-- supautils.privileged_role_allowed_configs), os gatilhos comuns NÃO disparam. As guardas da agenda são ALWAYS:
-- valem também nesse modo (a restrição de exclusão já valia). Uma restauração de dados (só dados) nestas tabelas
-- precisa da marca de emergência (imed.origin = 'sql' + motivo), como qualquer escrita à mão. O pg_dump completo cria os
-- gatilhos depois dos dados, então a restauração normal não é afetada. occupancy_seats e resources_guard já ficaram
-- ALWAYS no bloco 11 (junto do espelho do laço local). O gatilho antigo do pedido (appointment_requests_check) fica
-- como está (não é desta fase).
alter table public.appointment_requests enable always trigger appointment_requests_guard;
alter table public.appointment_requests enable always trigger appointment_requests_touch;
alter table public.appointment_requests enable always trigger appointment_requests_hist;
alter table public.clinics enable always trigger clinics_agenda_guard;
alter table agenda.occupancy enable always trigger occupancy_guard;
alter table agenda.occupancy enable always trigger occupancy_guard_audit;
alter table agenda.occupancy enable always trigger occupancy_guard_truncate;
alter table agenda.appointment_items enable always trigger appointment_items_guard;
alter table agenda.appointment_items enable always trigger appointment_items_guard_audit;
alter table agenda.appointment_items enable always trigger appointment_items_guard_truncate;
alter table agenda.status_history enable always trigger status_history_guard;
alter table agenda.status_history enable always trigger status_history_guard_truncate;
alter table agenda.audit_log enable always trigger audit_log_guard;
alter table agenda.audit_log enable always trigger audit_log_guard_truncate;
alter table agenda.access_log enable always trigger access_log_guard;
alter table agenda.access_log enable always trigger access_log_guard_truncate;
alter table private.imed_staff enable always trigger imed_staff_guard;
alter table private.imed_staff enable always trigger imed_staff_audit;
alter table private.imed_staff enable always trigger imed_staff_guard_truncate;
alter table agenda.role_permissions enable always trigger role_permissions_audit;
alter table agenda.role_permissions enable always trigger role_permissions_guard_truncate;

/* ===================== 18. Descrições ===================== */
comment on column public.clinics.timezone is 'Fuso da unidade (IANA). Sugerido pela UF; vale para a agenda só depois de confirmado (timezone_confirmed_at). Só muda pelas funções da agenda.';
comment on column public.clinics.timezone_confirmed_at is 'Quando a clínica confirmou o fuso. Sem confirmação, a agenda não é ativada.';
comment on column public.clinics.agenda_mode is 'Modalidade: pedido (padrão: a clínica ou o IMED liga), nativa, manual (com compromisso) ou externa. Só muda por ação explícita, pelas funções da agenda.';
comment on column public.clinics.agenda_online_since is 'Desde quando vende horário online (nulo = não vende). Exige modalidade de agenda e fuso confirmado.';
comment on column public.appointment_requests.channel is 'Por onde o agendamento entrou. O INSERT direto do site é sempre imed_app.';
comment on column public.appointment_requests.version is 'Sobe a cada mudança (gatilho appointment_requests_touch): controle de concorrência do painel.';
comment on column public.appointment_requests.hold_expires_at is 'Prazo da reserva temporária (só em hold e awaiting_payment). Fonte única do prazo.';
comment on column public.appointment_requests.uses_resources is 'Agendamento do motor novo (com itens e ocupação). O site de hoje grava sempre false.';
comment on function public.check_appointment_request() is 'Gatilho do pedido. Sem imed.origin: caminho antigo (as regras de sempre). Com a marca: funções da agenda (só dados do paciente e datas). Validação do paciente em private.agenda_validate_patient.';
comment on function public.has_clinic_perm(uuid, text) is 'A pessoa logada tem esta permissão na clínica INTEIRA (escopo clinica), pelo papel em clinic_members (agenda.role_permissions), com conta ativa? Escopo parcial: clinic_perm_scope.';
comment on function public.clinic_perm_scope(uuid, text) is 'Escopo da permissão da pessoa logada nesta clínica (clinica, propria, sem_donos) ou nulo; só conta ativa (e-mail confirmado, não apagada, não banida, não anônima).';
comment on function public.imed_has(text) is 'A pessoa logada tem esta permissão da equipe do IMED? O dono (is_imed_admin) tem todas; a equipe, as do papel ativo em private.imed_staff, com sessão pelo link do e-mail.';
comment on table agenda.occupancy is 'O único lugar que diz "este recurso está ocupado". Restrição de exclusão occupancy_no_overlap: uso × uso na mesma vaga e uso × fechamento nunca se cruzam.';
comment on table agenda.status_history is 'Histórico de situação dos agendamentos: só acréscimo, só códigos, sem chave estrangeira.';
comment on table agenda.audit_log is 'Auditoria da agenda (configuração, preços, equipe, bloqueios, mudanças pelo SQL): só acréscimo, sem dado pessoal nem texto livre.';
comment on table agenda.access_log is 'Quem leu dado de paciente: uma linha por dia, pessoa, função, pedido e escopo (a leitura repetida soma em reads).';
comment on table agenda.notes is 'O único lugar com texto livre da agenda (curto). Apagar = deleted_at e text nulo (o texto sai de verdade). Não escreva dados de saúde.';
comment on table agenda.role_permissions is 'Referência: permissões de cada papel da clínica e da equipe do IMED (arquitetura §12).';
comment on table agenda.status_transitions is 'Referência: a máquina de estados do agendamento (arquitetura §5).';
comment on table private.imed_staff is 'Equipe do IMED (operação, suporte, financeiro, auditoria), fora de admin_emails. Revogar = revoked_at (DELETE só quando a conta foi apagada). Toda mudança vai para agenda.audit_log.';