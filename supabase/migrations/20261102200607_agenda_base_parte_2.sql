-- iMed Agenda, fase 3.1 ("Fundação"): parte 2 de 5 (blocos 4 a 4). O cabeçalho, com o que a
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
  -- cada linha tem exatamente o dono do seu tipo (um fechamento com item_id sumiria na cascata do pedido)
  constraint occupancy_kind_item_ck check ((kind = 'agendamento') = (item_id is not null)
                                           and (kind = 'agendamento') = (group_no is not null)),
  constraint occupancy_kind_busy_ck check ((kind = 'ocupado') = (busy_id is not null)),     -- 6.1: "ou external_ref_id"
  constraint occupancy_kind_block_ck check ((kind = 'bloqueio') = (block_id is not null)),
  -- vaga vazia ou sem limite daria NULL dentro do CASE (e CHECK com NULL passa): recusadas fora dele
  constraint occupancy_seats_ck check (not isempty(seats) and not lower_inf(seats) and not upper_inf(seats)
                                       and case when kind = 'bloqueio'
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
-- no máximo um uso ativo por grupo de cada item (§3.3, I2: "no máximo um", na hora)
create unique index if not exists occupancy_item_grupo_uq on agenda.occupancy (item_id, group_no)
  where active and kind = 'agendamento';
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
  reason_code text check (reason_code ~ '^[a-z][a-z0-9_]{2,59}$' and reason_code !~ '[0-9]{4,}'),
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
  object_id text check (object_id ~ '^[0-9a-f-]{1,36}$'),   -- só id (uuid ou número), nunca texto livre
  old_value jsonb,                                     -- sem dado pessoal nem texto livre
  new_value jsonb,
  reason_code text check (reason_code ~ '^[a-z][a-z0-9_]{2,59}$' and reason_code !~ '[0-9]{4,}'),
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
  justification_code text check (justification_code ~ '^[a-z][a-z0-9_]{2,59}$' and justification_code !~ '[0-9]{4,}'),
  constraint access_log_uq unique nulls not distinct (day, user_id, clinic_id, fn, request_id, scope)
);

-- O ÚNICO lugar com texto livre (observação curta, justificativa, motivo): apagável.
create table if not exists agenda.notes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  request_id uuid,
  kind text not null check (kind in ('observacao', 'justificativa_acesso', 'motivo')),
  text text check (char_length(btrim(text)) between 1 and 300),
  author_user uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- o pedido é da MESMA clínica da nota
  constraint notes_request_fk foreign key (request_id, clinic_id)
    references public.appointment_requests (id, clinic_id) on delete cascade,
  -- apagar = tirar o texto de verdade (deleted_at preenchido e text nulo); nota viva sempre tem texto
  constraint notes_apagada_ck check ((deleted_at is null) = (text is not null))
);
create index if not exists notes_pedido_idx on agenda.notes (request_id) where request_id is not null;

-- Idempotência (reenvio com a mesma chave devolve o mesmo resultado). fingerprint = SHA-256 de parâmetros SEM dado
-- pessoal. Apagada em 7 dias (rotina da 3.3).
create table if not exists agenda.idempotency (
  scope text not null check (scope ~ '^[a-z][a-z0-9_]{2,40}$'),
  -- quem pediu: uuid da conta ou SHA-256 (hex) de um identificador; nunca telefone, e-mail ou IP em claro
  actor text not null check (actor ~ '^([0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'),
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
  request_id uuid,
  item_id uuid,
  details jsonb not null default '{}'::jsonb check (octet_length(details::text) <= 4000),   -- sem dado pessoal
  status text not null default 'aberto' check (status in ('aberto', 'em_andamento', 'resolvido', 'descartado')),
  resolution_code text check (resolution_code ~ '^[a-z][a-z0-9_]{2,59}$' and resolution_code !~ '[0-9]{4,}'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  constraint conflicts_resolucao_ck check ((status in ('resolvido', 'descartado')) = (resolved_at is not null)),
  -- pedido e item da MESMA clínica do conflito
  constraint conflicts_request_fk foreign key (request_id, clinic_id)
    references public.appointment_requests (id, clinic_id) on delete cascade,
  constraint conflicts_item_fk foreign key (item_id, clinic_id)
    references agenda.appointment_items (id, clinic_id) on delete cascade
);
create unique index if not exists conflicts_aberto_item_uq on agenda.conflicts (kind, item_id)
  where status in ('aberto', 'em_andamento') and item_id is not null;
create unique index if not exists conflicts_aberto_pedido_uq on agenda.conflicts (kind, request_id)
  where status in ('aberto', 'em_andamento') and item_id is null and request_id is not null;
create index if not exists conflicts_clinica_idx on agenda.conflicts (clinic_id, status);

-- Limites contra abuso: "upsert ... returning n" (serializa no contador; nunca "conta e depois insere").
create table if not exists agenda.rate_counters (
  -- "<limite>:<uuid ou SHA-256 hex>" (ex.: agenda_book:<hash do aparelho>); nunca telefone, e-mail ou IP em claro
  key text not null check (key ~ '^[a-z][a-z0-9_.]{2,40}:([0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'),
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