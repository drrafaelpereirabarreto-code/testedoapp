-- iMed Agenda, fase 3.1 ("Fundação"), 31/10/2026. Arquitetura: memory/projects/imed-agenda-arquitetura.md
-- (§2.1 a §2.5, §3.1, §3.2, §5, §12 e §14, item 3.1).
-- O número da versão (20261031100000) é provisório: ao aplicar na produção, renomeie este arquivo e a volta
-- (supabase/volta/, mesmo nome) com a versão que o Supabase gravar, e troque ULTIMA_NA_PRODUCAO no banco.yml.
-- Só junte o ramo na main DEPOIS disso.
--
-- Em linguagem simples, esta migração prepara o banco para a agenda nova SEM mudar nada do que o site faz hoje:
--   1. Cria o schema "agenda", fora da API (nenhum papel do site o alcança), com as tabelas da fundação:
--      recursos (aparelhos, salas, profissionais, vagas de chegada), procedimentos e o que cada um exige, itens do
--      agendamento, a OCUPAÇÃO (o único lugar que diz "este recurso está ocupado", protegida por uma restrição de
--      exclusão: dois usos do mesmo recurso no mesmo horário são recusados pelo próprio banco), feriados, trilhas
--      de auditoria (só acrescentam), notas, conflitos, idempotência, versão por clínica, limites e as tabelas de
--      referência (papéis e permissões; transições da máquina de estados). Tudo vazio, fora as referências.
--   2. Colunas novas nas tabelas de hoje (clínicas, membros, horários, bloqueios e pedidos), todas com valor
--      padrão. Nada é apagado nem trocado.
--   3. Pedido de agendamento: o navegador continua gravando exatamente as 23 colunas que grava hoje (permissão
--      coluna por coluna); as colunas novas ele não grava. UPDATE e DELETE diretos pela API acabam (o site não
--      usa: quem muda a situação são set_request_status e cancel_request, que continuam respondendo igual).
--   4. Marca de origem (imed.origin): cada função da agenda diz de onde vem a mudança. Mudar a situação, o
--      horário ou a clínica de um pedido sem a marca é recusado, até pelo SQL do painel do Supabase (há uma
--      saída de emergência registrada, abaixo). Toda mudança de situação vai para o histórico
--      (agenda.status_history): quando, quem, de onde e o motivo, só com códigos.
--   5. Papéis: has_clinic_perm (permissão pelo papel na clínica) e imed_has (equipe do IMED fora de admin_emails;
--      o dono continua sendo is_imed_admin). Ninguém ganha acesso novo: hoje não há membros nem equipe.
--
-- Emergência no SQL (só se for preciso mudar um pedido, um item ou a ocupação à mão; fica em agenda.audit_log):
--   begin;
--   select set_config('imed.origin', 'sql', true), set_config('imed.reason', '<codigo_do_motivo>', true);
--   update public.appointment_requests set ... where id = '...';
--   commit;
--
-- O que NÃO está aqui, de propósito:
--   - Nenhum comando apaga objeto ou dado que já existe. A policy "admin atualiza pedidos" fica sem efeito por
--     ALTER POLICY (using false), e as permissões saem por REVOKE.
--   - Os CHECKs que precisam ser TROCADOS (papéis novos em clinic_members; situações e cancelled_by novos em
--     appointment_requests) exigem apagar a restrição antiga: vão numa migração pequena separada, antes da 3.3/3.4, aplicada
--     quando o dono puder aprovar. Até lá existem só os papéis owner/staff e as 5 situações de hoje.
--   - Funções de cadastro, motor de horários (3.2), marcar/cancelar/remarcar (3.3), painel e policies por
--     permissão (3.4).
--
-- Pode rodar de novo sem erro e sem mudar nada. Volta: supabase/volta/20261031100000_agenda_base.sql (testada no
-- CI: depois da volta o banco fica igual ao da produção antes desta migração; reaplicada, igual ao com ela).

/* ===================== 1. Extensão e schema ===================== */
-- btree_gist: "=" em uuid dentro do índice GiST da restrição de exclusão. No schema extensions (fora da API).
create extension if not exists btree_gist with schema extensions;

create schema if not exists agenda;
comment on schema agenda is
  'iMed Agenda (memory/projects/imed-agenda-arquitetura.md). Fora da API: sem USAGE para anon, authenticated e '
  'service_role; acesso só pelas funções. Toda tabela com RLS ligada, sem policy e sem permissão para a API.';
revoke all on schema agenda from public, anon, authenticated, service_role;

/* ===================== 2. Marca de origem, motivo e fuso sugerido ===================== */
-- A marca (imed.origin) só é definida por SQL (set_config): o cliente da API (PostgREST) não consegue defini-la.
-- Valores: app (paciente), painel (clínica), central (equipe do IMED), api (integração), webhook_pagamento, cron,
-- sql (emergência pelo editor SQL, sempre com motivo). Sem marca = caminho antigo. Valor desconhecido = erro.
create or replace function private.agenda_origin()
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v text := nullif(btrim(current_setting('imed.origin', true)), '');
begin
  if v is null then return null; end if;
  if v not in ('app', 'painel', 'central', 'api', 'webhook_pagamento', 'cron', 'sql') then
    raise exception 'Marca de origem desconhecida (imed.origin): %', left(v, 40) using errcode = '22023';
  end if;
  return v;
end $$;

-- Motivo da mudança (imed.reason): só código (letras minúsculas, números e _), nunca texto livre.
create or replace function private.agenda_reason()
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v text := nullif(btrim(current_setting('imed.reason', true)), '');
begin
  if v is not null and v !~ '^[a-z][a-z0-9_]{2,59}$' then
    raise exception 'Motivo inválido (imed.reason): use um código com letras minúsculas, números e _' using errcode = '22023';
  end if;
  return v;
end $$;

-- Fuso sugerido pela UF (a clínica confirma antes de ativar a agenda: clinics.timezone_confirmed_at).
-- Fernando de Noronha (IBGE 2605459, pelo CNES) tem fuso próprio. Oeste do AM (UTC-5) e oeste do PA não são
-- deduzidos: a clínica confirma (decisão 15). UF desconhecida: São Paulo.
create or replace function private.agenda_suggested_timezone(p_state text, p_cnes text default null)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when p_cnes is not null and exists (select 1 from public.establishments e where e.cnes = p_cnes and e.city_ibge = 2605459)
      then 'America/Noronha'
    else case upper(coalesce(p_state, ''))
      when 'AC' then 'America/Rio_Branco'
      when 'AM' then 'America/Manaus'
      when 'RR' then 'America/Boa_Vista'
      when 'RO' then 'America/Porto_Velho'
      when 'MT' then 'America/Cuiaba'
      when 'MS' then 'America/Campo_Grande'
      when 'PA' then 'America/Belem'
      when 'AP' then 'America/Belem'
      when 'TO' then 'America/Araguaina'
      when 'MA' then 'America/Fortaleza'
      when 'PI' then 'America/Fortaleza'
      when 'CE' then 'America/Fortaleza'
      when 'RN' then 'America/Fortaleza'
      when 'PB' then 'America/Fortaleza'
      when 'PE' then 'America/Recife'
      when 'AL' then 'America/Maceio'
      when 'SE' then 'America/Maceio'
      when 'BA' then 'America/Bahia'
      else 'America/Sao_Paulo'   -- SP, RJ, MG, ES, PR, SC, RS, GO e DF
    end
  end
$$;

revoke all on function private.agenda_origin() from public, anon, authenticated, service_role;
revoke all on function private.agenda_reason() from public, anon, authenticated, service_role;
revoke all on function private.agenda_suggested_timezone(text, text) from public, anon, authenticated, service_role;

/* ===================== 3. Colunas novas nas tabelas de hoje (§2.3; só ADD, com valor padrão) ===================== */

-- clinics: a unidade.
alter table public.clinics add column if not exists timezone text not null default 'America/Sao_Paulo'
  constraint clinics_timezone_ck check (timezone in (
    'America/Sao_Paulo', 'America/Bahia', 'America/Fortaleza', 'America/Recife', 'America/Maceio', 'America/Belem',
    'America/Santarem', 'America/Araguaina', 'America/Manaus', 'America/Eirunepe', 'America/Rio_Branco',
    'America/Porto_Velho', 'America/Boa_Vista', 'America/Cuiaba', 'America/Campo_Grande', 'America/Noronha'));
alter table public.clinics add column if not exists timezone_confirmed_at timestamptz;
alter table public.clinics add column if not exists agenda_mode text not null default 'pedido'
  constraint clinics_agenda_mode_ck check (agenda_mode in ('pedido', 'nativa', 'manual', 'externa'));
alter table public.clinics add column if not exists agenda_online_since timestamptz;

-- clinic_members: quem criou o vínculo e quando mudou (os papéis novos vêm na migração dos CHECKs, antes da 3.4).
alter table public.clinic_members add column if not exists created_by uuid;
alter table public.clinic_members add column if not exists updated_at timestamptz not null default now();

-- clinic_schedules: passa a ser a tabela de regras de disponibilidade (abre/pausa; unidade ou recurso; validade).
-- exam_codes e slot_minutes ficam só para o editor antigo (o motor novo ignora; saem depois da 4.1).
alter table public.clinic_schedules add column if not exists resource_id uuid;   -- nulo = a unidade
alter table public.clinic_schedules add column if not exists kind text not null default 'abre'
  constraint clinic_schedules_kind_ck check (kind in ('abre', 'pausa'));
alter table public.clinic_schedules add column if not exists valid_from date;
alter table public.clinic_schedules add column if not exists valid_to date;
alter table public.clinic_schedules add column if not exists label text
  constraint clinic_schedules_label_ck check (char_length(label) <= 60);
alter table public.clinic_schedules add column if not exists procedure_ids uuid[] not null default '{}';  -- vazio = todos
alter table public.clinic_schedules add column if not exists created_by uuid;
alter table public.clinic_schedules add column if not exists updated_at timestamptz not null default now();

-- clinic_blocks: bloqueio da unidade inteira ou de um recurso; remoção lógica (removed_at).
alter table public.clinic_blocks add column if not exists resource_id uuid;      -- nulo = a unidade inteira
alter table public.clinic_blocks add column if not exists kind text not null default 'bloqueio'
  constraint clinic_blocks_kind_ck check (kind in ('bloqueio', 'manutencao', 'feriado', 'folga'));
alter table public.clinic_blocks add column if not exists created_by uuid;
alter table public.clinic_blocks add column if not exists removed_at timestamptz;
alter table public.clinic_blocks add column if not exists removed_by uuid;

-- appointment_requests: o agendamento (cabeçalho, inclusive de pacote). Nome, telefone e consentimento continuam
-- obrigatórios (toda reserva tem dados do paciente).
alter table public.appointment_requests add column if not exists channel text not null default 'imed_app'
  constraint appointment_requests_channel_ck check (channel in
    ('imed_app', 'imed_equipe', 'clinica_telefone', 'clinica_balcao', 'clinica_outro', 'externo'));
alter table public.appointment_requests add column if not exists slot_end timestamptz;          -- fim do último item
alter table public.appointment_requests add column if not exists hold_expires_at timestamptz;   -- prazo da reserva (fonte única)
alter table public.appointment_requests add column if not exists version integer not null default 1;
alter table public.appointment_requests add column if not exists updated_at timestamptz not null default now();
alter table public.appointment_requests add column if not exists cancel_reason text
  constraint appointment_requests_cancel_reason_ck check (cancel_reason in ('paciente_desistiu', 'paciente_nao_pode',
    'clinica_indisponivel', 'equipamento_manutencao', 'profissional_ausente', 'nao_pago', 'reserva_expirada',
    'duplicado', 'remarcado', 'outro'));
alter table public.appointment_requests add column if not exists total_cents integer
  constraint appointment_requests_total_cents_ck check (total_cents >= 0);   -- nulo se algum preço é "sob consulta"
alter table public.appointment_requests add column if not exists payment_mode text not null default 'no_local'
  constraint appointment_requests_payment_mode_ck check (payment_mode in ('no_local', 'online'));
alter table public.appointment_requests add column if not exists notify_channels text[] not null default '{}';  -- consentimento por canal
alter table public.appointment_requests add column if not exists uses_resources boolean not null default false; -- marcado pelo motor novo

-- Chaves compostas (id, clinic_id): as tabelas da agenda que apontam para um bloqueio ou um pedido exigem a
-- MESMA clínica (§2.5: "FKs compostas = mesma clínica").
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinic_blocks'::regclass
                 and conname = 'clinic_blocks_id_clinic_uq') then
    alter table public.clinic_blocks add constraint clinic_blocks_id_clinic_uq unique (id, clinic_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.appointment_requests'::regclass
                 and conname = 'appointment_requests_id_clinic_uq') then
    alter table public.appointment_requests add constraint appointment_requests_id_clinic_uq unique (id, clinic_id);
  end if;
end $$;

create index if not exists appointment_requests_clinic_slot_idx on public.appointment_requests (clinic_id, slot_start)
  where slot_start is not null;
create index if not exists appointment_requests_hold_idx on public.appointment_requests (hold_expires_at)
  where status in ('hold', 'awaiting_payment');

/* ===================== 4. Tabelas da agenda (§2.5, fase 3.1) ===================== */
-- Regras de todas: RLS ligada, sem policy e sem permissão para a API (item 8). Os nomes das restrições são fixos
-- (as funções das fases seguintes e os testes se referem a eles).

-- Configurações da unidade (1:1 com clinics; criada ao ativar a agenda).
create table if not exists agenda.unit_settings (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  step_min smallint not null default 5 check (step_min in (5, 10, 15, 20, 30, 60)),
  min_notice_min integer not null default 120 check (min_notice_min between 0 and 10080),
  max_advance_days smallint not null default 90 check (max_advance_days between 1 and 365),
  holidays_checked_until date,                         -- até quando a clínica conferiu os feriados estaduais e municipais
  hold_minutes smallint not null default 10 check (hold_minutes between 3 and 30),
  payment_grace_min smallint not null default 5 check (payment_grace_min between 0 and 15),
  patient_cancel_until_min integer not null default 0 check (patient_cancel_until_min between 0 and 10080),
  patient_reschedule_until_min integer not null default 120 check (patient_reschedule_until_min between 0 and 10080),
  checkin_before_min smallint not null default 120 check (checkin_before_min between 0 and 1440),
  no_show_after_min smallint not null default 15 check (no_show_after_min between 0 and 240),
  patient_gap_min smallint not null default 0 check (patient_gap_min between 0 and 240 and patient_gap_min % 5 = 0),
  closes_on_holidays boolean not null default true,
  manual_commitment_at timestamptz,                    -- modalidade manual: "registro tudo no painel antes"
  manual_commitment_by uuid,
  payment_mode text not null default 'no_local' check (payment_mode in ('no_local')),  -- 'online_*' só na 5.4
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint unit_settings_compromisso_ck check ((manual_commitment_at is null) = (manual_commitment_by is null))
);

-- [espelho do laço local]
-- Recursos: aparelho, sala, profissional ou "chegadas" (pacientes por horário). capacity = vagas simultâneas.
create table if not exists agenda.resources (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  kind text not null check (kind in ('equipamento', 'sala', 'profissional', 'chegadas')),
  name text not null check (char_length(name) between 2 and 80),
  capacity smallint not null default 1 check (capacity between 1 and 50),
  setup_min smallint not null default 0 check (setup_min between 0 and 240 and setup_min % 5 = 0),      -- preparo
  cleanup_min smallint not null default 0 check (cleanup_min between 0 and 240 and cleanup_min % 5 = 0), -- higienização
  member_user_id uuid,                                 -- profissional (membro da clínica) que vê a própria agenda
  council text check (council in ('CRM', 'CRBM', 'CRF', 'CRBio', 'CRO', 'COREN', 'CRTR', 'outro')),
  council_number text check (char_length(council_number) <= 20),   -- só se a clínica informar
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint resources_clinic_fk foreign key (clinic_id) references public.clinics (id) on delete cascade,   -- [só no banco]
  constraint resources_member_fk foreign key (clinic_id, member_user_id) references public.clinic_members (clinic_id, user_id) on delete set null (member_user_id),   -- [só no banco]
  constraint resources_id_clinic_uq unique (id, clinic_id)
);
create unique index if not exists resources_nome_uq on agenda.resources (clinic_id, lower(name)) where archived_at is null;
-- [fim do espelho]

-- Procedimentos: o exame específico que a clínica faz (dentro de uma das 9 categorias). Duração sem valor padrão.
create table if not exists agenda.procedures (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  exam_code text not null check (exam_code in ('rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab')),
  name text not null check (char_length(name) between 2 and 120),
  duration_min smallint not null check (duration_min between 5 and 480 and duration_min % 5 = 0),
  step_min smallint check (step_min is null or (step_min between 5 and 120 and step_min % 5 = 0)),
  price_cents integer check (price_cents is null or price_cents between 100 and 10000000),   -- nulo = sob consulta
  price_confirmed_at timestamptz,                      -- trava L11 (preço fora do normal)
  patient_prep_text text check (char_length(patient_prep_text) <= 600),
  fasting_hours smallint check (fasting_hours between 0 and 24),
  min_notice_min integer check (min_notice_min between 0 and 10080),        -- nulo = o da unidade
  max_advance_days smallint check (max_advance_days between 1 and 365),     -- nulo = o da unidade
  online_booking boolean not null default true,
  default_for_exam boolean not null default false,     -- usado por available_slots(p_exam)
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint procedures_id_clinic_uq unique (id, clinic_id)
);
create unique index if not exists procedures_nome_uq on agenda.procedures (clinic_id, lower(name)) where archived_at is null;
create unique index if not exists procedures_padrao_uq on agenda.procedures (clinic_id, exam_code)
  where default_for_exam and archived_at is null;

-- Requisitos: "precisa de 1 aparelho de USG" (um grupo por recurso exigido, até 5).
create table if not exists agenda.procedure_requirements (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null,
  clinic_id uuid not null,
  group_no smallint not null check (group_no between 1 and 5),
  resource_kind text not null check (resource_kind in ('equipamento', 'sala', 'profissional', 'chegadas')),
  offset_min smallint not null default 0 check (offset_min between 0 and 480 and offset_min % 5 = 0),
  duration_min smallint check (duration_min is null or (duration_min between 5 and 480 and duration_min % 5 = 0)),
  align_min smallint check (align_min is null or align_min in (5, 10, 15, 20, 30, 60)),   -- "chegadas": bloco alinhado
  label text check (char_length(label) <= 60),
  constraint procedure_requirements_procedure_fk foreign key (procedure_id, clinic_id)
    references agenda.procedures (id, clinic_id) on delete cascade,
  constraint procedure_requirements_align_ck check (align_min is null or resource_kind = 'chegadas'),
  constraint procedure_requirements_grupo_uq unique (procedure_id, group_no),
  constraint procedure_requirements_id_clinic_uq unique (id, clinic_id),
  constraint procedure_requirements_id_proc_uq unique (id, procedure_id, clinic_id)
);

-- Alternativas de cada requisito: "USG-1 ou USG-2". Um recurso não aparece em dois grupos do mesmo procedimento
-- (grupos disjuntos: a conferência por grupo é exata). A arquitetura previa um gatilho; aqui é uma restrição
-- única (procedure_id, resource_id), que vale também sob concorrência.
create table if not exists agenda.requirement_options (
  requirement_id uuid not null,
  procedure_id uuid not null,
  clinic_id uuid not null,
  resource_id uuid not null,
  priority smallint not null default 1 check (priority between 1 and 50),
  primary key (requirement_id, resource_id),
  constraint requirement_options_requirement_fk foreign key (requirement_id, procedure_id, clinic_id)
    references agenda.procedure_requirements (id, procedure_id, clinic_id) on delete cascade,
  constraint requirement_options_resource_fk foreign key (resource_id, clinic_id)
    references agenda.resources (id, clinic_id) on delete cascade,
  constraint requirement_options_grupos_disjuntos_uq unique (procedure_id, resource_id)
);
create index if not exists requirement_options_recurso_idx on agenda.requirement_options (resource_id);

-- Regras de pacote, sempre configuradas pela clínica.
create table if not exists agenda.procedure_pair_rules (
  clinic_id uuid not null,
  first_procedure uuid not null,
  second_procedure uuid not null,
  rule text not null check (rule in ('ordem', 'intervalo_min', 'nao_mesmo_dia')),
  min_gap_min smallint check (min_gap_min is null or (min_gap_min between 5 and 1440 and min_gap_min % 5 = 0)),
  primary key (first_procedure, second_procedure, rule),
  constraint procedure_pair_rules_first_fk foreign key (first_procedure, clinic_id)
    references agenda.procedures (id, clinic_id) on delete cascade,
  constraint procedure_pair_rules_second_fk foreign key (second_procedure, clinic_id)
    references agenda.procedures (id, clinic_id) on delete cascade,
  constraint procedure_pair_rules_par_ck check (first_procedure <> second_procedure),
  constraint procedure_pair_rules_gap_ck check ((rule = 'intervalo_min') = (min_gap_min is not null))
);

-- Itens do agendamento (1 por exame; o cabeçalho é appointment_requests). groups = os grupos exigidos na
-- marcação (a conferência "o item segura todos os recursos", na 3.3, compara com isto).
create table if not exists agenda.appointment_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  clinic_id uuid not null,
  seq smallint not null check (seq between 1 and 4),
  procedure_id uuid not null,
  exam_code text not null check (exam_code in ('rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  local_start timestamp not null,                      -- hora local pretendida (detecta regra de fuso nova)
  tz text not null check (tz in (
    'America/Sao_Paulo', 'America/Bahia', 'America/Fortaleza', 'America/Recife', 'America/Maceio', 'America/Belem',
    'America/Santarem', 'America/Araguaina', 'America/Manaus', 'America/Eirunepe', 'America/Rio_Branco',
    'America/Porto_Velho', 'America/Boa_Vista', 'America/Cuiaba', 'America/Campo_Grande', 'America/Noronha')),
  groups smallint[] not null check (cardinality(groups) between 1 and 5),
  status text not null check (status in ('hold', 'awaiting_payment', 'confirmed', 'checked_in', 'in_service',
                                         'completed', 'no_show', 'reschedule_requested', 'cancelled', 'expired')),
  price_cents integer check (price_cents is null or price_cents between 100 and 10000000),   -- foto do preço na marcação
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_items_periodo_ck check (ends_at > starts_at),
  constraint appointment_items_request_fk foreign key (request_id, clinic_id)
    references public.appointment_requests (id, clinic_id) on delete cascade,
  constraint appointment_items_procedure_fk foreign key (procedure_id, clinic_id)
    references agenda.procedures (id, clinic_id),
  constraint appointment_items_id_clinic_uq unique (id, clinic_id),
  constraint items_seq_uq unique (request_id, seq) deferrable initially deferred,
  -- o paciente não está em dois exames do mesmo pedido ao mesmo tempo
  constraint items_patient_no_overlap exclude using gist
    (request_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (status in ('hold', 'awaiting_payment', 'confirmed', 'checked_in', 'in_service', 'reschedule_requested'))
    deferrable initially deferred
);
create index if not exists appointment_items_clinica_inicio_idx on agenda.appointment_items (clinic_id, starts_at);
create index if not exists appointment_items_pedido_idx on agenda.appointment_items (request_id);

-- "Ocupado (agenda própria)": uso sem paciente (balcão), sem dado pessoal.
create table if not exists agenda.busy_marks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  procedure_id uuid,                                   -- opcional: ocupa os recursos do procedimento
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason_code text not null check (reason_code in ('agenda_propria', 'uso_interno', 'outro')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid,
  constraint busy_marks_periodo_ck check (ends_at > starts_at),
  constraint busy_marks_procedure_fk foreign key (procedure_id, clinic_id) references agenda.procedures (id, clinic_id),
  constraint busy_marks_remocao_ck check (removed_by is null or removed_at is not null),
  constraint busy_marks_id_clinic_uq unique (id, clinic_id)
);

-- [espelho do laço local]
-- OCUPAÇÃO: o único lugar que diz "este recurso está ocupado". Uso (agendamento ou "ocupado") ocupa UMA vaga
-- [s, s+1) de 1 a capacity; fechamento (bloqueio) cobre todas as vagas [1, 51). A restrição de exclusão
-- (imediata, nunca adiável) recusa no próprio banco: dois usos na mesma vaga que se cruzam no tempo e qualquer
-- uso dentro de um fechamento. Dois fechamentos podem se cruzar (manutenção × feriado): o excl_group de um
-- fechamento é o próprio id, o de um uso é o intervalo infinito, que cruza com tudo. Arquitetura §2.5, §3.2 e §3.4.
create table if not exists agenda.occupancy (
  id bigint generated always as identity primary key,
  clinic_id uuid not null,
  resource_id uuid not null,
  kind text not null check (kind in ('agendamento', 'ocupado', 'bloqueio')),   -- uso, uso sem paciente, fechamento
  seats int4range not null,                            -- uso: uma vaga [s,s+1); fechamento: todas [1,51)
  during tstzrange not null check (not isempty(during) and lower_inc(during) and not upper_inc(during)
                                   and not lower_inf(during) and not upper_inf(during)),
  excl_group int8range not null default '(,)',         -- gatilho occupancy_seats: [id,id] para fechamento
  item_id uuid,
  group_no smallint check (group_no between 1 and 5),
  busy_id uuid,
  block_id uuid,
  hold_until timestamptz,                              -- cópia de hold_expires_at + carência; nula depois de confirmar
  active boolean not null default true,
  released_at timestamptz,
  release_reason text check (release_reason in ('cancelado', 'expirada', 'remarcado', 'bloqueio_forcado',
                                                'removido', 'capacidade', 'corrigido')),
  created_at timestamptz not null default now(),
  constraint occupancy_resource_fk foreign key (resource_id, clinic_id) references agenda.resources (id, clinic_id) on delete restrict,
  constraint occupancy_item_fk foreign key (item_id, clinic_id) references agenda.appointment_items (id, clinic_id) on delete cascade,   -- [só no banco]
  constraint occupancy_busy_fk foreign key (busy_id, clinic_id) references agenda.busy_marks (id, clinic_id) on delete cascade,   -- [só no banco]
  constraint occupancy_block_fk foreign key (block_id, clinic_id) references public.clinic_blocks (id, clinic_id) on delete cascade,   -- [só no banco]
  constraint occupancy_kind_item_ck check ((kind = 'agendamento') = (item_id is not null and group_no is not null)),
  constraint occupancy_kind_busy_ck check ((kind = 'ocupado') = (busy_id is not null)),     -- 6.1: "ou external_ref_id"
  constraint occupancy_kind_block_ck check ((kind = 'bloqueio') = (block_id is not null)),
  constraint occupancy_seats_ck check (case when kind = 'bloqueio'
                                             then seats = int4range(1, 51) and excl_group = int8range(id, id, '[]')
                                             else upper(seats) - lower(seats) = 1 and lower(seats) >= 1 and upper(seats) <= 51
                                                  and excl_group = '(,)'::int8range end),
  constraint occupancy_hold_ck check (hold_until is null or kind = 'agendamento'),
  constraint occupancy_released_ck check (active or released_at is not null),
  constraint occupancy_no_overlap exclude using gist
    (resource_id with =, seats with &&, during with &&, excl_group with &&) where (active)
);
create index if not exists occupancy_recurso_idx on agenda.occupancy (resource_id, clinic_id);
create index if not exists occupancy_item_idx on agenda.occupancy (item_id);
create index if not exists occupancy_block_idx on agenda.occupancy (block_id) where block_id is not null;
create index if not exists occupancy_busy_idx on agenda.occupancy (busy_id) where busy_id is not null;
create index if not exists occupancy_hold_idx on agenda.occupancy (hold_until) where active and hold_until is not null;
-- [fim do espelho]

-- Feriados: lançados pela equipe do IMED a partir de lei, decreto ou portaria (fonte obrigatória). A clínica confere
-- os estaduais e municipais da cidade dela (unit_settings.holidays_checked_until) e lança o que faltar como
-- bloqueio 'feriado' da unidade.
create table if not exists agenda.holidays (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('nacional', 'uf', 'municipio')),
  uf text check (uf ~ '^[A-Z]{2}$'),
  city_ibge integer references public.municipalities (ibge),
  day date not null,
  name text not null check (char_length(name) between 2 and 120),
  source text not null check (char_length(source) between 3 and 300),
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint holidays_escopo_ck check (case scope when 'nacional' then uf is null and city_ibge is null
                                                  when 'uf' then uf is not null and city_ibge is null
                                                  else uf is not null and city_ibge is not null end),
  constraint holidays_uq unique nulls not distinct (scope, uf, city_ibge, day)
);

-- "Abrimos neste feriado" (exceção por unidade).
create table if not exists agenda.holiday_openings (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  day date not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (clinic_id, day)
);

-- TRILHAS (§2.1 e §12): só acréscimo, sem chave estrangeira (guardam o uuid), só códigos. UPDATE, DELETE e
-- TRUNCATE dão erro (gatilhos abaixo), exceto a rotina de retenção.
create table if not exists agenda.status_history (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  item_id uuid,
  from_status text check (from_status in ('pending', 'contacted', 'hold', 'awaiting_payment', 'confirmed',
    'checked_in', 'in_service', 'completed', 'no_show', 'reschedule_requested', 'cancelled', 'expired')),
  to_status text not null check (to_status in ('pending', 'contacted', 'hold', 'awaiting_payment', 'confirmed',
    'checked_in', 'in_service', 'completed', 'no_show', 'reschedule_requested', 'cancelled', 'expired')),
  at timestamptz not null default now(),
  actor_kind text not null check (actor_kind in ('paciente', 'clinica', 'imed', 'sistema', 'integracao', 'gateway', 'sql')),
  actor_user uuid,
  actor_role text check (actor_role ~ '^[a-z][a-z_]{1,29}$'),
  origin text not null check (origin in ('app', 'painel', 'central', 'api', 'webhook_pagamento', 'cron', 'sql')),
  reason_code text check (reason_code ~ '^[a-z][a-z0-9_]{2,59}$'),
  request_version integer
);
create index if not exists status_history_pedido_idx on agenda.status_history (request_id, at);

create table if not exists agenda.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  clinic_id uuid,
  actor_kind text not null check (actor_kind in ('paciente', 'clinica', 'imed', 'sistema', 'integracao', 'gateway', 'sql')),
  actor_user uuid,
  actor_role text check (actor_role ~ '^[a-z][a-z_]{1,29}$'),
  origin text not null check (origin in ('app', 'painel', 'central', 'api', 'webhook_pagamento', 'cron', 'sql')),
  action text not null check (action ~ '^[a-z][a-z0-9_.]{2,59}$'),
  object_type text not null check (object_type ~ '^[a-z][a-z0-9_]{2,40}$'),
  object_id text check (char_length(object_id) <= 80),
  old_value jsonb,                                     -- sem dado pessoal nem texto livre
  new_value jsonb,
  reason_code text check (reason_code ~ '^[a-z][a-z0-9_]{2,59}$'),
  txid bigint not null default txid_current(),
  constraint audit_log_tamanho_ck check (coalesce(octet_length(old_value::text), 0)
                                         + coalesce(octet_length(new_value::text), 0) <= 8000)
);
create index if not exists audit_log_clinica_idx on agenda.audit_log (clinic_id, at);

-- Quem leu dado de paciente: uma linha por (dia, pessoa, clínica, função, pedido, escopo); a leitura repetida
-- só soma em reads e last_at.
create table if not exists agenda.access_log (
  id bigint generated always as identity primary key,
  day date not null,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  user_id uuid not null,
  clinic_id uuid,
  fn text not null check (fn ~ '^[a-z][a-z0-9_]{2,60}$'),
  request_id uuid,
  scope text not null check (scope ~ '^[a-z][a-z0-9_]{1,30}$'),
  reads integer not null default 1 check (reads >= 1),
  justification_code text check (justification_code ~ '^[a-z][a-z0-9_]{2,59}$'),
  constraint access_log_uq unique nulls not distinct (day, user_id, clinic_id, fn, request_id, scope)
);

-- O ÚNICO lugar com texto livre (observação curta, justificativa, motivo): apagável.
create table if not exists agenda.notes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  request_id uuid references public.appointment_requests (id) on delete cascade,
  kind text not null check (kind in ('observacao', 'justificativa_acesso', 'motivo')),
  text text not null check (char_length(btrim(text)) between 1 and 300),
  author_user uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists notes_pedido_idx on agenda.notes (request_id) where request_id is not null;

-- Idempotência (reenvio com a mesma chave devolve o mesmo resultado). fingerprint = SHA-256 de parâmetros SEM dado
-- pessoal. Apagada em 7 dias (rotina da 3.3).
create table if not exists agenda.idempotency (
  scope text not null check (scope ~ '^[a-z][a-z0-9_]{2,40}$'),
  actor text not null check (char_length(actor) between 1 and 100),
  key uuid not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (scope, actor, key)
);
create index if not exists idempotency_criada_idx on agenda.idempotency (created_at);

-- Versão da agenda de cada clínica (sobe a cada escrita; private.agenda_touch). O painel relê quando muda.
create table if not exists agenda.clinic_versions (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  version bigint not null default 0 check (version >= 0),
  changed_at timestamptz not null default now()
);

-- Conflitos para alguém resolver (no máximo um aberto por tipo e item; ou por tipo e pedido, sem item).
create table if not exists agenda.conflicts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  kind text not null check (kind in ('grade_mudou', 'capacidade', 'bloqueio_sobre_agendamento', 'fuso_mudou',
    'pagamento_apos_expirar', 'divergencia_externa', 'evento_externo_rejeitado', 'paciente_em_dois_horarios')),
  request_id uuid references public.appointment_requests (id) on delete cascade,
  item_id uuid references agenda.appointment_items (id) on delete cascade,
  details jsonb not null default '{}'::jsonb check (octet_length(details::text) <= 4000),   -- sem dado pessoal
  status text not null default 'aberto' check (status in ('aberto', 'em_andamento', 'resolvido', 'descartado')),
  resolution_code text check (resolution_code ~ '^[a-z][a-z0-9_]{2,59}$'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  constraint conflicts_resolucao_ck check ((status in ('resolvido', 'descartado')) = (resolved_at is not null))
);
create unique index if not exists conflicts_aberto_item_uq on agenda.conflicts (kind, item_id)
  where status in ('aberto', 'em_andamento') and item_id is not null;
create unique index if not exists conflicts_aberto_pedido_uq on agenda.conflicts (kind, request_id)
  where status in ('aberto', 'em_andamento') and item_id is null and request_id is not null;
create index if not exists conflicts_clinica_idx on agenda.conflicts (clinic_id, status);

-- Limites contra abuso: "upsert ... returning n" (serializa no contador; nunca "conta e depois insere").
create table if not exists agenda.rate_counters (
  key text not null check (char_length(key) between 3 and 200),
  window_start timestamptz not null,
  n integer not null default 1 check (n >= 0),
  primary key (key, window_start)
);

-- REFERÊNCIA: o que cada papel pode (§12). Papéis da clínica (clinic_members.role) e da equipe do IMED
-- ('imed_' + private.imed_staff.role). scope: clinica (tudo da clínica), propria (só os recursos ligados ao
-- profissional; em agenda.pacientes, sem telefone), sem_donos (equipe, menos donos), imed (permissões da equipe).
create table if not exists agenda.role_permissions (
  role text not null check (role in ('owner', 'manager', 'reception', 'professional', 'finance', 'staff',
                                     'imed_operacao', 'imed_suporte', 'imed_financeiro', 'imed_auditoria')),
  permission text not null check (permission ~ '^[a-z]+(\.[a-z_]+)+$'),
  scope text not null default 'clinica' check (scope in ('clinica', 'propria', 'sem_donos', 'imed')),
  primary key (role, permission),
  constraint role_permissions_imed_ck check ((role like 'imed\_%') = (permission like 'imed.%')
                                             and (role like 'imed\_%') = (scope = 'imed'))
);

-- REFERÊNCIA: a máquina de estados (§5). 'novo' = o agendamento ainda não existe. time_rule = regra de horário
-- conferida pela função (antes_do_prazo: dentro do prazo da reserva; prazo_vencido: prazo + carência vencidos;
-- janela_de_chegada: a partir de checkin_before_min antes do início; depois_do_inicio; depois_da_tolerancia:
-- início + no_show_after_min; mesmo_dia; prazo_cancelar_paciente e prazo_remarcar_paciente: até o início e o prazo
-- da unidade). needs_engine = passa pelo motor completo (horário ainda livre).
create table if not exists agenda.status_transitions (
  from_status text not null check (from_status in ('novo', 'pending', 'contacted', 'hold', 'awaiting_payment',
    'confirmed', 'checked_in', 'in_service', 'completed', 'no_show', 'reschedule_requested', 'cancelled', 'expired')),
  to_status text not null check (to_status in ('pending', 'contacted', 'hold', 'awaiting_payment', 'confirmed',
    'checked_in', 'in_service', 'completed', 'no_show', 'reschedule_requested', 'cancelled', 'expired')),
  actor_kind text not null check (actor_kind in ('paciente', 'clinica', 'imed', 'sistema', 'integracao', 'gateway')),
  permission text check (permission ~ '^[a-z]+(\.[a-z_]+)+$'),
  requires_reason boolean not null default false,
  time_rule text check (time_rule in ('antes_do_prazo', 'prazo_vencido', 'janela_de_chegada', 'depois_do_inicio',
    'depois_da_tolerancia', 'mesmo_dia', 'prazo_cancelar_paciente', 'prazo_remarcar_paciente')),
  needs_engine boolean not null default false,
  primary key (from_status, to_status, actor_kind),
  constraint status_transitions_permissao_ck check (
    case actor_kind when 'clinica' then permission is not null and permission not like 'imed.%'
                    when 'imed' then permission like 'imed.%'
                    else permission is null end)
);

-- REFERÊNCIA: parâmetros globais (limites contra abuso, saúde da integração...). Vazia até a decisão 25 do dono.
create table if not exists agenda.settings_global (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{2,60}$'),
  value jsonb not null check (octet_length(value::text) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Equipe do IMED (§12): fora de admin_emails; o dono continua sendo is_imed_admin(). Fora da API.
create table if not exists private.imed_staff (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('operacao', 'suporte', 'financeiro', 'auditoria')),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, role),
  constraint imed_staff_revogacao_ck check (revoked_at is null or revoked_at >= granted_at)
);

-- Ninguém da API lê nem escreve: RLS ligada, sem policy, sem permissão (nem para service_role, que nem tem USAGE).
do $$
declare
  t regclass;
begin
  for t in select c.oid::regclass from pg_class c
           where (c.relnamespace = 'agenda'::regnamespace and c.relkind in ('r', 'p'))
              or c.oid = 'private.imed_staff'::regclass
  loop
    execute format('alter table %s enable row level security', t);
    execute format('revoke all on table %s from public, anon, authenticated, service_role', t);
  end loop;
end $$;
revoke all on all sequences in schema agenda from public, anon, authenticated, service_role;

/* ===================== 5. Restrições novas nas tabelas de hoje (só ADD; precisam das tabelas acima) ===================== */
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinics'::regclass
                 and conname = 'clinics_agenda_online_ck') then
    -- venda online só com modalidade de agenda e fuso confirmado
    alter table public.clinics add constraint clinics_agenda_online_ck
      check (agenda_online_since is null or (agenda_mode <> 'pedido' and timezone_confirmed_at is not null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinic_schedules'::regclass
                 and conname = 'clinic_schedules_valid_ck') then
    alter table public.clinic_schedules add constraint clinic_schedules_valid_ck
      check (valid_to is null or valid_from is null or valid_to >= valid_from);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinic_schedules'::regclass
                 and conname = 'clinic_schedules_resource_fk') then
    alter table public.clinic_schedules add constraint clinic_schedules_resource_fk
      foreign key (resource_id, clinic_id) references agenda.resources (id, clinic_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinic_blocks'::regclass
                 and conname = 'clinic_blocks_resource_fk') then
    alter table public.clinic_blocks add constraint clinic_blocks_resource_fk
      foreign key (resource_id, clinic_id) references agenda.resources (id, clinic_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.appointment_requests'::regclass
                 and conname = 'appointment_requests_slot_end_ck') then
    alter table public.appointment_requests add constraint appointment_requests_slot_end_ck
      check (slot_end is null or (slot_start is not null and slot_end > slot_start));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.appointment_requests'::regclass
                 and conname = 'appointment_requests_hold_ck') then
    -- o prazo da reserva só existe enquanto ela é reserva
    alter table public.appointment_requests add constraint appointment_requests_hold_ck
      check (hold_expires_at is null or status in ('hold', 'awaiting_payment'));
  end if;
end $$;

/* ===================== 6. Funções internas da agenda ===================== */

-- Registro de mudança feita pelo editor SQL (saída de emergência): exige o motivo e grava em agenda.audit_log.
create or replace function private.agenda_audit_sql(p_clinic uuid, p_action text, p_object_type text,
                                                     p_object_id text, p_old jsonb, p_new jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := private.agenda_reason();
begin
  if v_reason is null then
    raise exception 'Mudança pelo SQL sem motivo: defina imed.reason (um código) junto com imed.origin = ''sql'''
      using errcode = '42501',
            hint = 'select set_config(''imed.origin'', ''sql'', true), set_config(''imed.reason'', ''<codigo>'', true);';
  end if;
  insert into agenda.audit_log (clinic_id, actor_kind, actor_user, actor_role, origin, action, object_type, object_id,
                                old_value, new_value, reason_code)
  values (p_clinic, 'sql', auth.uid(), null, 'sql', p_action, p_object_type, left(p_object_id, 80), p_old, p_new, v_reason);
end $$;

-- Validação ÚNICA dos dados do paciente (a mesma para o site de hoje e para as funções da agenda): pedido para
-- outra pessoa (nome e parentesco; menor de 18 só com o consentimento do responsável legal, LGPD art. 14; maior
-- de idade só com a confirmação de que a pessoa sabe e concordou). Devolve a linha normalizada.
create or replace function private.agenda_validate_patient(p public.appointment_requests)
returns public.appointment_requests
language plpgsql
set search_path = ''
as $$
declare
  r public.appointment_requests := p;
begin
  if coalesce(r.for_other, false) then
    r.for_other := true;
    r.other_name := nullif(btrim(regexp_replace(coalesce(r.other_name, ''), '\s+', ' ', 'g')), '');
    r.relationship := nullif(btrim(regexp_replace(coalesce(r.relationship, ''), '\s+', ' ', 'g')), '');
    r.other_minor := coalesce(r.other_minor, false);
    if char_length(coalesce(r.other_name, '')) not between 2 and 120 then
      raise exception 'Informe o nome de quem vai fazer o exame' using errcode = '22023';
    end if;
    if char_length(coalesce(r.relationship, '')) not between 2 and 60 then
      raise exception 'Informe o parentesco de quem vai fazer o exame' using errcode = '22023';
    end if;
    if r.other_minor and not coalesce(r.guardian_consent, false) then
      raise exception 'Para menor de 18 anos, é preciso o consentimento do responsável legal' using errcode = '22023';
    end if;
    if not r.other_minor and not coalesce(r.other_consent, false) then
      raise exception 'Confirme que a pessoa sabe do pedido e concordou (ou que você é o representante legal dela)' using errcode = '22023';
    end if;
    r.guardian_consent := r.other_minor;
    r.other_consent := not r.other_minor;
  else
    r.for_other := false;
    r.other_name := null;
    r.relationship := null;
    r.other_minor := false;
    r.guardian_consent := false;
    r.other_consent := false;
  end if;
  return r;
end $$;

-- Versão da agenda da clínica: sobe 1 a cada chamada e devolve a versão nova. É a ÚLTIMA instrução de cada escrita
-- (a trava curta da linha faz a ordem das versões ser a ordem dos COMMITs). O aviso pelo Realtime entra na 3.4.
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

-- Conta e sessão com as mesmas exigências de is_imed_admin (para a equipe do IMED fora de admin_emails): e-mail
-- confirmado e igual ao da sessão, só login por e-mail (sem celular, Google ou anônimo), conta ativa, e a sessão
-- não foi aberta com senha nem como anônima (o site só usa o link do e-mail).
create or replace function private.agenda_secure_session()
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
           select 1
           from auth.users u
           where u.id = auth.uid()
             and u.email is not null
             and lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
             and u.email_confirmed_at is not null
             and u.deleted_at is null
             and (u.banned_until is null or u.banned_until <= now())
             and not coalesce(u.is_anonymous, false)
             and coalesce(u.phone, '') = ''
             and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider <> 'email')
         )
     and not exists (
           select 1
           from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) m
           where coalesce(m ->> 'method', m #>> '{}') in ('password', 'anonymous')
         );
$$;

revoke all on function private.agenda_audit_sql(uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.agenda_validate_patient(public.appointment_requests) from public, anon, authenticated, service_role;
revoke all on function private.agenda_touch(uuid) from public, anon, authenticated, service_role;
revoke all on function private.agenda_secure_session() from public, anon, authenticated, service_role;

/* ===================== 7. Papéis (§12) ===================== */

-- A pessoa logada tem esta permissão nesta clínica (pelo papel dela em clinic_members)? Qualquer escopo conta
-- (o escopo "propria" do profissional é aplicado pelas funções da 3.4). A equipe do IMED NÃO entra aqui: é imed_has.
create or replace function public.has_clinic_perm(p_clinic uuid, p_perm text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clinic_members m
    join agenda.role_permissions rp on rp.role = m.role and rp.permission = p_perm
    where m.clinic_id = p_clinic and m.user_id = auth.uid()
  );
$$;
revoke all on function public.has_clinic_perm(uuid, text) from public, anon, authenticated;
grant execute on function public.has_clinic_perm(uuid, text) to authenticated;

-- A pessoa logada tem esta permissão da equipe do IMED? O dono (is_imed_admin) tem todas; a equipe, as do papel
-- ativo em private.imed_staff, com as mesmas exigências de conta e sessão do admin.
create or replace function public.imed_has(p_perm text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select coalesce(public.is_imed_admin(), false)
      or (p_perm like 'imed.%'
          and private.agenda_secure_session()
          and exists (select 1
                      from private.imed_staff s
                      join agenda.role_permissions rp on rp.role = 'imed_' || s.role and rp.permission = p_perm
                      where s.user_id = auth.uid() and s.revoked_at is null));
$$;
revoke all on function public.imed_has(text) from public, anon, authenticated;
grant execute on function public.imed_has(text) to authenticated;

/* ===================== 8. Pedido de agendamento: gatilhos de origem, versão e histórico ===================== */

-- Antes de gravar um pedido (BEFORE INSERT). SECURITY DEFINER (search_path vazio, sem EXECUTE para ninguém):
-- a validação não depende de quem grava.
--   Sem a marca imed.origin: caminho antigo (o INSERT direto do site de hoje), com as MESMAS regras, na mesma
--   ordem e com as mesmas mensagens de antes; as colunas novas ficam sempre no valor padrão.
--   Com a marca (funções da agenda, 3.3 em diante): só os dados do paciente (validação única) e as datas; a função
--   decide situação, horário e canal.
create or replace function public.check_appointment_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  local_ts timestamp;
  v_origin text := private.agenda_origin();
begin
  if v_origin is null then
    if new.preferred_date < today or new.preferred_date > today + 120 then
      raise exception 'Data preferida fora do intervalo permitido' using errcode = '22023';
    end if;
    if new.clinic_id is not null and not exists (
      select 1 from public.clinics c
      where c.id = new.clinic_id and c.status = 'published' and c.accepts_online_booking
    ) then
      raise exception 'Esta clínica não recebe pedidos de agendamento pelo site' using errcode = '22023';
    end if;
  end if;
  new := private.agenda_validate_patient(new);
  if v_origin is not null then
    new.created_at := now();
    new.updated_at := now();
    new.version := 1;
    return new;
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
  -- Colunas novas: sempre o padrão no caminho antigo (o navegador nem tem permissão para gravá-las).
  new.channel := 'imed_app';
  new.slot_end := null;
  new.hold_expires_at := null;
  new.version := 1;
  new.updated_at := now();
  new.cancel_reason := null;
  new.total_cents := null;
  new.payment_mode := 'no_local';
  new.notify_channels := '{}';
  new.uses_resources := false;
  return new;
end $$;
-- Função de gatilho: ninguém chama como RPC (o gatilho continua funcionando), como antes.
revoke execute on function public.check_appointment_request() from public, anon, authenticated;

-- BEFORE UPDATE OF status, slot_start, slot_end, clinic_id: só com a marca de origem. Saída de emergência pelo
-- SQL (imed.origin = 'sql' + imed.reason), registrada em agenda.audit_log. Exceção: a clínica foi apagada e a
-- chave estrangeira (on delete set null) solta o pedido dela, como sempre.
create or replace function private.agenda_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text;
begin
  if (new.status, new.slot_start, new.slot_end, new.clinic_id)
     is not distinct from (old.status, old.slot_start, old.slot_end, old.clinic_id) then
    return new;
  end if;
  if new.clinic_id is null and old.clinic_id is not null
     and (new.status, new.slot_start, new.slot_end) is not distinct from (old.status, old.slot_start, old.slot_end)
     and not exists (select 1 from public.clinics c where c.id = old.clinic_id) then
    return new;
  end if;
  v_origin := private.agenda_origin();
  if v_origin is null then
    raise exception 'A situação, o horário e a clínica de um pedido só mudam pelas funções da agenda'
      using errcode = '42501',
            hint = 'Emergência no SQL: select set_config(''imed.origin'', ''sql'', true), set_config(''imed.reason'', ''<codigo>'', true); (fica registrado)';
  end if;
  if v_origin = 'sql' then
    perform private.agenda_audit_sql(coalesce(new.clinic_id, old.clinic_id), 'pedido_alterado_sql', 'appointment_request',
      new.id::text,
      jsonb_build_object('status', old.status, 'slot_start', old.slot_start, 'slot_end', old.slot_end, 'clinic_id', old.clinic_id),
      jsonb_build_object('status', new.status, 'slot_start', new.slot_start, 'slot_end', new.slot_end, 'clinic_id', new.clinic_id));
  end if;
  return new;
end $$;

-- BEFORE UPDATE: toda mudança de verdade sobe a versão (controle de concorrência do painel) e o updated_at.
create or replace function private.agenda_requests_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new is not distinct from old then
    return new;
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

-- AFTER UPDATE OF status (só quando muda): uma linha no histórico, com a origem da marca e o motivo (código).
create or replace function private.agenda_requests_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := coalesce(private.agenda_origin(), 'sql');
  v_actor text;
  v_role text;
begin
  v_actor := case v_origin when 'app' then 'paciente' when 'painel' then 'clinica' when 'central' then 'imed'
                           when 'api' then 'integracao' when 'webhook_pagamento' then 'gateway' when 'cron' then 'sistema'
                           else 'sql' end;
  if v_actor = 'clinica' then
    select m.role into v_role from public.clinic_members m where m.clinic_id = new.clinic_id and m.user_id = auth.uid();
  elsif v_actor = 'imed' then
    v_role := case when coalesce(public.is_imed_admin(), false) then 'imed_admin'
                   else (select 'imed_' || s.role from private.imed_staff s
                         where s.user_id = auth.uid() and s.revoked_at is null order by s.role limit 1) end;
  end if;
  insert into agenda.status_history (request_id, item_id, from_status, to_status, actor_kind, actor_user, actor_role,
                                     origin, reason_code, request_version)
  values (new.id, null, old.status, new.status, v_actor, auth.uid(), v_role, v_origin, private.agenda_reason(), new.version);
  return null;
end $$;

revoke all on function private.agenda_requests_guard() from public, anon, authenticated, service_role;
revoke all on function private.agenda_requests_touch() from public, anon, authenticated, service_role;
revoke all on function private.agenda_requests_history() from public, anon, authenticated, service_role;

create or replace trigger appointment_requests_guard
  before update of status, slot_start, slot_end, clinic_id on public.appointment_requests
  for each row execute function private.agenda_requests_guard();
create or replace trigger appointment_requests_touch
  before update on public.appointment_requests
  for each row execute function private.agenda_requests_touch();
create or replace trigger appointment_requests_hist
  after update of status on public.appointment_requests
  for each row when (old.status is distinct from new.status) execute function private.agenda_requests_history();

/* ===================== 9. Clínica: fuso, modalidade e venda online só pelas funções da agenda ===================== */
-- BEFORE INSERT: sem a marca, clínica nova nasce no modelo de pedido, sem venda online e com o fuso sugerido pela UF
-- (não confirmado). BEFORE UPDATE OF timezone, timezone_confirmed_at, agenda_mode, agenda_online_since: só com a
-- marca (fecha também o PATCH direto que a policy "admin gerencia clinicas" permite hoje); pelo SQL, registrado.
create or replace function private.agenda_clinics_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := private.agenda_origin();
begin
  if tg_op = 'INSERT' then
    if v_origin is null then
      if new.agenda_mode is distinct from 'pedido' or new.agenda_online_since is not null
         or new.timezone_confirmed_at is not null then
        raise exception 'Modalidade da agenda, venda online e confirmação do fuso só mudam pelas funções da agenda'
          using errcode = '42501';
      end if;
      new.timezone := private.agenda_suggested_timezone(new.state, new.cnes);
    end if;
    return new;
  end if;
  if (new.timezone, new.timezone_confirmed_at, new.agenda_mode, new.agenda_online_since)
     is not distinct from (old.timezone, old.timezone_confirmed_at, old.agenda_mode, old.agenda_online_since) then
    return new;
  end if;
  if v_origin is null then
    raise exception 'Fuso, modalidade da agenda e venda online só mudam pelas funções da agenda'
      using errcode = '42501',
            hint = 'Emergência no SQL: select set_config(''imed.origin'', ''sql'', true), set_config(''imed.reason'', ''<codigo>'', true); (fica registrado)';
  end if;
  if v_origin = 'sql' then
    perform private.agenda_audit_sql(new.id, 'clinica_agenda_sql', 'clinic', new.id::text,
      jsonb_build_object('timezone', old.timezone, 'timezone_confirmed_at', old.timezone_confirmed_at,
                         'agenda_mode', old.agenda_mode, 'agenda_online_since', old.agenda_online_since),
      jsonb_build_object('timezone', new.timezone, 'timezone_confirmed_at', new.timezone_confirmed_at,
                         'agenda_mode', new.agenda_mode, 'agenda_online_since', new.agenda_online_since));
  end if;
  return new;
end $$;
revoke all on function private.agenda_clinics_guard() from public, anon, authenticated, service_role;

create or replace trigger clinics_agenda_guard
  before insert or update of timezone, timezone_confirmed_at, agenda_mode, agenda_online_since on public.clinics
  for each row execute function private.agenda_clinics_guard();

/* ===================== 10. Ocupação e recursos: vagas, capacidade e marca de origem ===================== */

-- [espelho do laço local]
-- Antes de gravar uma ocupação: o fechamento ganha o próprio grupo ([id,id]); o uso (novo, reativado ou que mudou
-- de vaga, horário ou recurso) precisa de recurso ativo da mesma clínica e de vaga dentro da capacidade, lida com
-- FOR SHARE (espera quem estiver mudando a capacidade ao mesmo tempo, e vice-versa; §3.2 e §3.3, I1-c).
create or replace function private.agenda_occupancy_seats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap smallint;
begin
  if new.kind = 'bloqueio' and new.excl_group = '(,)'::int8range then
    new.excl_group := int8range(new.id, new.id, '[]');
  end if;
  if new.kind <> 'bloqueio' and new.active
     and (tg_op = 'INSERT' or not old.active or new.seats <> old.seats or new.during <> old.during
          or new.resource_id <> old.resource_id or new.clinic_id <> old.clinic_id) then
    select r.capacity into v_cap
    from agenda.resources r
    where r.id = new.resource_id and r.clinic_id = new.clinic_id and r.active and r.archived_at is null
    for share;
    if v_cap is null then
      raise exception 'Recurso inexistente, inativo ou arquivado' using errcode = '23503';
    end if;
    if upper(new.seats) - 1 > v_cap then
      raise exception 'Vaga % acima da capacidade % do recurso', upper(new.seats) - 1, v_cap using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create or replace trigger occupancy_seats
  before insert or update on agenda.occupancy
  for each row execute function private.agenda_occupancy_seats();

-- Reduzir a capacidade, desativar ou arquivar um recurso só sem usos futuros ativos que deixariam de caber
-- (redução temporária é bloqueio, nunca edição). Com a trava da linha do recurso, quem marca na vaga alta espera
-- esta mudança e depois é recusado, ou esta mudança espera a marcação e depois a vê (§3.3, I1-c).
create or replace function private.agenda_resources_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.capacity < old.capacity and exists (
       select 1 from agenda.occupancy o
       where o.resource_id = old.id and o.active and o.kind <> 'bloqueio'
         and upper(o.during) > now() and upper(o.seats) - 1 > new.capacity) then
    raise exception 'Há usos futuros nas vagas acima da nova capacidade (%): remarque antes ou use um bloqueio', new.capacity
      using errcode = '23514';
  end if;
  if ((old.active and not new.active) or (old.archived_at is null and new.archived_at is not null)) and exists (
       select 1 from agenda.occupancy o
       where o.resource_id = old.id and o.active and o.kind <> 'bloqueio' and upper(o.during) > now()) then
    raise exception 'O recurso tem usos futuros: remarque ou cancele antes de desativar ou arquivar'
      using errcode = '23514';
  end if;
  return new;
end $$;

create or replace trigger resources_guard
  before update of capacity, active, archived_at on agenda.resources
  for each row execute function private.agenda_resources_guard();
-- [fim do espelho]

-- Itens e ocupação só mudam pelas funções da agenda (marca de origem); pelo SQL, com motivo e registrado.
-- Apagar em cascata (o pedido, o item, o "ocupado" ou o bloqueio dono da linha foi apagado) segue livre.
create or replace function private.agenda_write_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text;
begin
  -- (cada tabela no seu bloco: o PL/pgSQL só resolve old.<coluna> da tabela do gatilho)
  if tg_op = 'DELETE' then
    if tg_table_name = 'occupancy' then
      if (old.item_id is not null and not exists (select 1 from agenda.appointment_items i where i.id = old.item_id))
         or (old.busy_id is not null and not exists (select 1 from agenda.busy_marks b where b.id = old.busy_id))
         or (old.block_id is not null and not exists (select 1 from public.clinic_blocks b where b.id = old.block_id)) then
        return old;
      end if;
    elsif tg_table_name = 'appointment_items' then
      if not exists (select 1 from public.appointment_requests r where r.id = old.request_id) then
        return old;
      end if;
    end if;
  end if;
  v_origin := private.agenda_origin();
  if v_origin is null then
    raise exception 'Itens e ocupação da agenda só mudam pelas funções da agenda'
      using errcode = '42501',
            hint = 'Emergência no SQL: select set_config(''imed.origin'', ''sql'', true), set_config(''imed.reason'', ''<codigo>'', true); (fica registrado)';
  end if;
  if v_origin = 'sql' then
    if tg_op = 'TRUNCATE' then
      perform private.agenda_audit_sql(null, tg_table_name || '_truncate', tg_table_name, null, null, null);
    else
      perform private.agenda_audit_sql(case tg_op when 'DELETE' then old.clinic_id else new.clinic_id end,
        tg_table_name || '_' || lower(tg_op), tg_table_name,
        case tg_op when 'DELETE' then old.id::text else new.id::text end,
        case tg_op when 'INSERT' then null else to_jsonb(old) end,
        case tg_op when 'DELETE' then null else to_jsonb(new) end);
    end if;
  end if;
  if tg_op = 'TRUNCATE' then return null; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

revoke all on function private.agenda_occupancy_seats() from public, anon, authenticated, service_role;
revoke all on function private.agenda_resources_guard() from public, anon, authenticated, service_role;
revoke all on function private.agenda_write_guard() from public, anon, authenticated, service_role;

create or replace trigger occupancy_guard
  before insert or update or delete on agenda.occupancy
  for each row execute function private.agenda_write_guard();
create or replace trigger occupancy_guard_truncate
  before truncate on agenda.occupancy
  for each statement execute function private.agenda_write_guard();
create or replace trigger appointment_items_guard
  before insert or update or delete on agenda.appointment_items
  for each row execute function private.agenda_write_guard();
create or replace trigger appointment_items_guard_truncate
  before truncate on agenda.appointment_items
  for each statement execute function private.agenda_write_guard();

/* ===================== 11. Trilhas: só acrescentam ===================== */
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

/* ===================== 12. As duas funções que mudam pedidos hoje: só a marca de origem ===================== */
-- Iguais às da migração 20261030143738_confianca, com uma diferença: antes do UPDATE, a marca de origem (a guarda
-- nova não as barra e o histórico sabe de onde veio); depois, a marca anterior volta (a marca não "vaza" para o
-- resto da transação). As respostas não mudam.

-- O paciente cancela o próprio pedido (origem 'app').
create or replace function public.cancel_request(p_id uuid, p_token text default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_marca text := coalesce(current_setting('imed.origin', true), '');
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
  perform set_config('imed.origin', 'app', true);
  update public.appointment_requests
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'patient'
   where id = r.id;
  perform set_config('imed.origin', v_marca, true);
  return 'ok';
end $$;
revoke execute on function public.cancel_request(uuid, text) from public;
grant execute on function public.cancel_request(uuid, text) to anon, authenticated;

-- A clínica (origem 'painel') ou a equipe do IMED (origem 'central') muda a situação do pedido.
create or replace function public.set_request_status(p_id uuid, p_status text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_admin boolean := coalesce(public.is_imed_admin(), false);
  who text;
  v_marca text := coalesce(current_setting('imed.origin', true), '');
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
    -- (se o UPDATE falhar, a marca some junto com o bloco desfeito)
    perform set_config('imed.origin', case who when 'clinic' then 'painel' else 'central' end, true);
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
  perform set_config('imed.origin', v_marca, true);
  return 'ok';
end $$;
revoke execute on function public.set_request_status(uuid, text) from public, anon;
grant execute on function public.set_request_status(uuid, text) to authenticated;

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
  ('no_show', 'checked_in', 'clinica', 'agenda.atender', true, 'mesmo_dia', false),
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

/* ===================== 16. Fuso das clínicas que já existem (pela UF; não confirmado) ===================== */
-- Na produção de 31/10/2026 todas as clínicas são de SP: nada muda. Pelo SQL com a marca (fica registrado).
do $$
begin
  if exists (select 1 from public.clinics c
             where c.timezone_confirmed_at is null
               and c.timezone is distinct from private.agenda_suggested_timezone(c.state, c.cnes)) then
    perform set_config('imed.origin', 'sql', true);
    perform set_config('imed.reason', 'migracao_fuso_pela_uf', true);
    update public.clinics c set timezone = private.agenda_suggested_timezone(c.state, c.cnes)
     where c.timezone_confirmed_at is null
       and c.timezone is distinct from private.agenda_suggested_timezone(c.state, c.cnes);
    perform set_config('imed.origin', '', true);
    perform set_config('imed.reason', '', true);
  end if;
end $$;

/* ===================== 17. Descrições ===================== */
comment on column public.clinics.timezone is 'Fuso da unidade (IANA). Sugerido pela UF; vale para a agenda só depois de confirmado (timezone_confirmed_at). Só muda pelas funções da agenda.';
comment on column public.clinics.timezone_confirmed_at is 'Quando a clínica confirmou o fuso. Sem confirmação, a agenda não é ativada.';
comment on column public.clinics.agenda_mode is 'Modalidade: pedido (padrão: a clínica ou o IMED liga), nativa, manual (com compromisso) ou externa. Só muda por ação explícita, pelas funções da agenda.';
comment on column public.clinics.agenda_online_since is 'Desde quando vende horário online (nulo = não vende). Exige modalidade de agenda e fuso confirmado.';
comment on column public.appointment_requests.channel is 'Por onde o agendamento entrou. O INSERT direto do site é sempre imed_app.';
comment on column public.appointment_requests.version is 'Sobe a cada mudança (gatilho appointment_requests_touch): controle de concorrência do painel.';
comment on column public.appointment_requests.hold_expires_at is 'Prazo da reserva temporária (só em hold e awaiting_payment). Fonte única do prazo.';
comment on column public.appointment_requests.uses_resources is 'Agendamento do motor novo (com itens e ocupação). O site de hoje grava sempre false.';
comment on function public.check_appointment_request() is 'Gatilho do pedido. Sem imed.origin: caminho antigo (as regras de sempre). Com a marca: funções da agenda (só dados do paciente e datas). Validação do paciente em private.agenda_validate_patient.';
comment on function public.has_clinic_perm(uuid, text) is 'A pessoa logada tem esta permissão nesta clínica, pelo papel em clinic_members (agenda.role_permissions)?';
comment on function public.imed_has(text) is 'A pessoa logada tem esta permissão da equipe do IMED? O dono (is_imed_admin) tem todas; a equipe, as do papel ativo em private.imed_staff, com sessão pelo link do e-mail.';
comment on table agenda.occupancy is 'O único lugar que diz "este recurso está ocupado". Restrição de exclusão occupancy_no_overlap: uso × uso na mesma vaga e uso × fechamento nunca se cruzam.';
comment on table agenda.status_history is 'Histórico de situação dos agendamentos: só acréscimo, só códigos, sem chave estrangeira.';
comment on table agenda.audit_log is 'Auditoria da agenda (configuração, preços, equipe, bloqueios, mudanças pelo SQL): só acréscimo, sem dado pessoal nem texto livre.';
comment on table agenda.access_log is 'Quem leu dado de paciente: uma linha por dia, pessoa, função, pedido e escopo (a leitura repetida soma em reads).';
comment on table agenda.notes is 'O único lugar com texto livre da agenda (curto, apagável). Não escreva dados de saúde.';
comment on table agenda.role_permissions is 'Referência: permissões de cada papel da clínica e da equipe do IMED (arquitetura §12).';
comment on table agenda.status_transitions is 'Referência: a máquina de estados do agendamento (arquitetura §5).';
comment on table private.imed_staff is 'Equipe do IMED (operação, suporte, financeiro, auditoria), fora de admin_emails. Revogar = revoked_at.';
