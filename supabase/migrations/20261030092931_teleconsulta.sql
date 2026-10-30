-- Teleconsulta do IMED: o paciente entra na fila pelo site, um médico com cadastro aprovado atende por vídeo,
-- pede exames e registra a consulta (prontuário).
-- - Paciente não precisa de conta: recebe um código secreto que fica só no aparelho; o banco guarda o SHA-256 dele
--   (igual aos pedidos de agendamento). Repetir o pedido com o mesmo código (resposta perdida) devolve a mesma consulta.
-- - Só atende médico APROVADO pela equipe do IMED. Antes de aprovar, a equipe grava a conferência (doctor_checks):
--   situação ativa no CFM, RQE (se houver) e prova de identidade (vídeo com documento com foto e carteira do CRM, ou
--   documento assinado com o certificado ICP-Brasil do médico). A conferência vale 12 meses; depois o cadastro é suspenso
--   até nova conferência.
-- - Vídeo: WebRTC direto entre os dois navegadores. O banco só troca a "oferta" e a "resposta" de conexão (SDP)
--   enquanto a consulta está em andamento e as apaga ao terminar. Não há gravação de vídeo.
-- - Telemedicina (Res. CFM 2.314/2022 e Lei 14.510/2022): consentimento (TCLE) registrado com a versão publicada e a hora,
--   identificação do médico guardada na consulta, prontuário só para o médico da consulta e para quem a equipe do IMED
--   autorizou a ler prontuários (médico, como o diretor técnico: tele_record_readers), com registro de cada acesso.
-- - Exames, indicação e orientações trocados depois de enviados ficam com a versão anterior em tele_record_changes.
-- - Pedido que nenhum médico atendeu (cancelado ou expirado): nome, nascimento, celular e motivo são apagados em 30 dias.
--   O resto é guardado (prontuário: no mínimo 20 anos, Lei 13.787/2018).
-- - Tabelas fechadas para anon/authenticated: todo acesso passa pelas funções abaixo.
-- - Erros: mensagens curtas e estáveis (ex.: 'emergencia', 'fila_cheia'); quando é um campo, o nome vai em "details".

/* ===================== Tabelas ===================== */

-- Médicos da teleconsulta. O próprio médico (logado) se cadastra; a equipe do IMED confere, aprova, recusa ou suspende.
create table if not exists public.doctors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 5 and 120),
  crm text not null check (crm ~ '^[1-9][0-9]{0,9}$'),
  crm_uf char(2) not null check (crm_uf in ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
                                             'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO')),
  rqe text check (rqe is null or rqe ~ '^[1-9][0-9]{0,9}$'),
  specialty text check (specialty is null or (rqe is not null and char_length(specialty) between 2 and 80)),
  phone text check (phone is null or phone ~ '^[1-9][1-9][0-9]{8,9}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  review_note text check (review_note is null or char_length(review_note) <= 300),
  reviewed_at timestamptz,
  reviewed_by text,
  checked_at timestamptz,
  available_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Um CRM/UF aprovado (ou suspenso) por vez. Cadastro em análise ou recusado não prende o número: se alguém se
-- cadastrar com o CRM de outro médico, o médico verdadeiro também consegue se cadastrar, e a equipe do IMED vê os dois.
create unique index if not exists doctors_crm_uq on public.doctors (crm, crm_uf) where status in ('approved', 'suspended');
create index if not exists doctors_crm_idx on public.doctors (crm, crm_uf);
comment on table public.doctors is 'Médicos da teleconsulta. Só atende quem a equipe do IMED aprovou depois da conferência (doctor_checks).';
comment on column public.doctors.specialty is 'Especialidade só com RQE (regra do CFM para anunciar especialidade).';
comment on column public.doctors.phone is 'Privado: só o próprio médico e a equipe do IMED veem.';
comment on column public.doctors.checked_at is 'Data da conferência usada na última aprovação. Vale 12 meses; depois o cadastro é suspenso até conferir de novo.';
comment on column public.doctors.available_until is 'Disponível para atender até esta hora (o site renova a cada minuto).';

-- Conferência da equipe do IMED antes de aprovar um médico. Só acrescenta (o histórico fica).
-- Completa = situação ativa no CFM + RQE conferido (se houver) + identidade provada por um dos dois caminhos:
-- (a) chamada de vídeo com documento oficial com foto e carteira do CRM, rosto conferido; ou
-- (b) documento assinado com o certificado ICP-Brasil do médico, validado em validar.iti.gov.br.
-- Guarda os dados conferidos: se o médico mudar nome, CRM, UF, RQE ou especialidade, é preciso conferir de novo.
create table if not exists public.doctor_checks (
  id bigint generated always as identity primary key,
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  full_name text not null,
  crm text not null,
  crm_uf text not null,
  rqe text,
  specialty text,
  cfm_active boolean not null default false,
  rqe_checked boolean not null default false,
  id_video boolean not null default false,
  crm_card boolean not null default false,
  icp_signature boolean not null default false,
  note text check (note is null or char_length(note) <= 300),
  checked_by text not null,
  checked_at timestamptz not null default now()
);
create index if not exists doctor_checks_doctor_idx on public.doctor_checks (doctor_id, id desc);
comment on table public.doctor_checks is 'Conferência antes de aprovar o médico: CFM ativo, RQE e prova de identidade (vídeo com documento com foto e carteira do CRM, ou assinatura ICP-Brasil). Só acrescenta.';

create table if not exists public.teleconsultations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'waiting'
    check (status in ('waiting', 'accepted', 'in_call', 'ended', 'cancelled', 'expired')),
  patient_name text check (patient_name is null or char_length(patient_name) between 3 and 120),
  patient_birthdate date,
  patient_phone text check (patient_phone is null or patient_phone ~ '^[1-9][1-9][0-9]{8,9}$'),
  for_other boolean not null default false,
  requester_name text check (requester_name is null or char_length(requester_name) between 3 and 120),
  relationship text check (relationship is null or char_length(relationship) between 2 and 60),
  guardian_consent boolean not null default false,
  patient_agrees boolean not null default false,
  reason text check (reason is null or char_length(reason) between 3 and 1000),
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  consent_at timestamptz not null,
  doctor_id uuid references public.doctors (id),
  doctor_info jsonb,
  accepted_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  closed_by text check (closed_by is null or closed_by in ('patient', 'doctor', 'system')),
  dismissed_by uuid references public.doctors (id),
  phone_call_at timestamptz,
  patient_seen_at timestamptz,
  offer_sdp text check (offer_sdp is null or char_length(offer_sdp) <= 30000),
  offer_version integer not null default 0,
  answer_sdp text check (answer_sdp is null or char_length(answer_sdp) <= 30000),
  answer_version integer not null default 0,
  exams jsonb not null default '[]'::jsonb check (jsonb_typeof(exams) = 'array'),
  indication text check (indication is null or char_length(indication) <= 1000),
  exams_version integer not null default 0,
  exams_at timestamptz,
  guidance text check (guidance is null or char_length(guidance) <= 4000),
  guidance_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 60000),
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  check (case status when 'waiting' then doctor_id is null
                     when 'accepted' then doctor_id is not null
                     when 'in_call' then doctor_id is not null
                     when 'ended' then doctor_id is not null
                     else true end),
  -- Dados pessoais só podem faltar depois de apagados, e só se apagam de pedidos que nenhum médico atendeu.
  check (anonymized_at is not null
         or (patient_name is not null and patient_birthdate is not null and patient_phone is not null and reason is not null)),
  check (anonymized_at is null or (doctor_id is null and status in ('cancelled', 'expired')))
);
create unique index if not exists teleconsultations_token_uq on public.teleconsultations (token_hash);
create index if not exists teleconsultations_status_idx on public.teleconsultations (status, created_at);
create index if not exists teleconsultations_created_idx on public.teleconsultations (created_at);
create index if not exists teleconsultations_phone_idx on public.teleconsultations (patient_phone, created_at) where patient_phone is not null;
create index if not exists teleconsultations_doctor_idx on public.teleconsultations (doctor_id, created_at) where doctor_id is not null;
-- Uma consulta ativa por telefone e uma por médico (garantido pelo banco, mesmo com cliques ao mesmo tempo).
create unique index if not exists teleconsultations_phone_ativa_uq on public.teleconsultations (patient_phone)
  where status in ('waiting', 'accepted', 'in_call');
create unique index if not exists teleconsultations_medico_ativo_uq on public.teleconsultations (doctor_id)
  where status in ('accepted', 'in_call');
comment on table public.teleconsultations is
  'Teleconsultas: fila, conexão de vídeo, exames pedidos e prontuário. O prontuário só o médico da consulta e quem está em tele_record_readers leem.';
comment on column public.teleconsultations.token_hash is 'SHA-256 (hex) do código secreto que fica só no aparelho do paciente.';
comment on column public.teleconsultations.consent_version is 'Versão do termo de consentimento (TCLE) que o paciente aceitou, em consent_at.';
comment on column public.teleconsultations.patient_agrees is 'Paciente adulto, pedido por outra pessoa: quem pediu declarou que o paciente está presente e concorda (ou que é o representante legal dele).';
comment on column public.teleconsultations.doctor_info is 'Identificação do médico no momento do atendimento (nome, CRM/UF, RQE, especialidade).';
comment on column public.teleconsultations.closed_by is 'Quem terminou a parte ao vivo: patient (desistiu ou encerrou), doctor (encerrou ou tirou da fila) ou system (expirou).';
comment on column public.teleconsultations.dismissed_by is 'Médico que tirou o pedido da fila (pedido falso ou repetido).';
comment on column public.teleconsultations.phone_call_at is 'Última vez que o médico tocou em "Ligar para o paciente" (plano B).';
comment on column public.teleconsultations.patient_seen_at is 'Última vez que a página do paciente consultou a situação (gravado no máximo a cada 15 s).';
comment on column public.teleconsultations.offer_sdp is 'Oferta de conexão do vídeo (temporária: apagada ao terminar).';
comment on column public.teleconsultations.exams is 'Exames pedidos: lista de {code, name, group, search, note}; search = código da busca do site.';
comment on column public.teleconsultations.exams_version is 'Versão do pedido de exames (sobe a cada mudança da lista ou da indicação); exams_at = hora da versão.';
comment on column public.teleconsultations.guidance is 'Orientações do médico, visíveis ao paciente.';
comment on column public.teleconsultations.notes is 'Prontuário: só o médico da consulta e quem está em tele_record_readers leem.';
comment on column public.teleconsultations.anonymized_at is 'Pedido que nenhum médico atendeu: dados pessoais apagados nesta data (30 dias depois do pedido).';

-- Chat de texto da consulta (plano B quando o vídeo não conecta).
create table if not exists public.tele_messages (
  id bigint generated always as identity primary key,
  consultation_id uuid not null references public.teleconsultations (id) on delete cascade,
  sender text not null check (sender in ('patient', 'doctor')),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists tele_messages_consulta_idx on public.tele_messages (consultation_id, id);
comment on table public.tele_messages is 'Mensagens de texto da teleconsulta (fazem parte do registro da consulta).';

-- Mudanças em exames, indicação e orientações já enviados ao paciente: o valor anterior fica aqui (só acrescenta).
create table if not exists public.tele_record_changes (
  id bigint generated always as identity primary key,
  consultation_id uuid not null references public.teleconsultations (id) on delete cascade,
  field text not null check (field in ('exams', 'indication', 'guidance')),
  old_value jsonb,
  new_value jsonb,
  changed_by uuid references public.doctors (id),
  changed_at timestamptz not null default now()
);
create index if not exists tele_record_changes_consulta_idx on public.tele_record_changes (consultation_id, id);
comment on table public.tele_record_changes is 'Registro de alterações do pedido de exames, da indicação e das orientações depois de enviados (Res. CFM 1.638/2002 e 1.821/2007).';

-- Quem da equipe do IMED pode abrir prontuários (só médico, como o diretor técnico). Precisa estar também em admin_emails.
-- Outro admin (que cuida de clínicas, por exemplo) não lê prontuário.
create table if not exists public.tele_record_readers (
  email text primary key check (email = lower(email) and char_length(email) between 3 and 254),
  added_at timestamptz not null default now()
);
comment on table public.tele_record_readers is 'Equipe médica do IMED que pode ler prontuários da teleconsulta (ex.: diretor técnico). Cada leitura fica em tele_access_log.';
-- Na criação (tabela vazia): os admins de hoje, isto é, o médico responsável pelo IMED. Admin que entrar depois NÃO
-- vira leitor sozinho, nem se esta migração rodar de novo. Para incluir alguém (só médico):
-- insert into public.tele_record_readers (email) values ('<e-mail em minúsculas>');
insert into public.tele_record_readers (email)
select lower(a.email) from public.admin_emails a
where not exists (select 1 from public.tele_record_readers)
on conflict (email) do nothing;

-- Registro de cada leitura de prontuário feita por quem não é o médico da consulta.
create table if not exists public.tele_access_log (
  id bigint generated always as identity primary key,
  consultation_id uuid not null references public.teleconsultations (id) on delete cascade,
  user_id uuid,
  email text,
  fn text not null,
  at timestamptz not null default now()
);
create index if not exists tele_access_log_consulta_idx on public.tele_access_log (consultation_id, at);
comment on table public.tele_access_log is 'Quem da equipe do IMED abriu qual teleconsulta e quando (trilha de auditoria do prontuário).';

-- Ninguém lê ou escreve direto pela API: só pelas funções.
alter table public.doctors enable row level security;
alter table public.doctor_checks enable row level security;
alter table public.teleconsultations enable row level security;
alter table public.tele_messages enable row level security;
alter table public.tele_record_changes enable row level security;
alter table public.tele_record_readers enable row level security;
alter table public.tele_access_log enable row level security;
revoke all on public.doctors, public.doctor_checks, public.teleconsultations, public.tele_messages,
  public.tele_record_changes, public.tele_record_readers, public.tele_access_log from anon, authenticated;
do $$
declare
  t text;
begin
  foreach t in array array['public.doctor_checks', 'public.tele_messages', 'public.tele_record_changes', 'public.tele_access_log'] loop
    execute format('revoke all on sequence %s from anon, authenticated', pg_get_serial_sequence(t, 'id'));
  end loop;
end $$;

/* ===================== Funções internas ===================== */

-- Situação de fato: esperando há mais de 2 h ou aceita e não iniciada em 30 min = expirada;
-- em andamento há mais de 3 h = encerrada (o médico saiu sem encerrar).
create or replace function private.tele_effective_status(p_status text, p_created timestamptz, p_accepted timestamptz, p_started timestamptz)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when p_status = 'waiting' and p_created < now() - interval '2 hours' then 'expired'
    when p_status = 'accepted' and p_started is null and p_accepted < now() - interval '30 minutes' then 'expired'
    when p_status in ('accepted', 'in_call') and p_started < now() - interval '3 hours' then 'ended'
    else p_status
  end;
$$;

-- Grava a situação de fato (pg_cron a cada 10 min e antes de cada pedido novo). Apaga as SDPs, guarda o resto.
create or replace function private.tele_expire()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
  total integer := 0;
begin
  update public.teleconsultations set status = 'expired', closed_by = 'system', offer_sdp = null, answer_sdp = null
  where status = 'waiting' and created_at < now() - interval '2 hours';
  get diagnostics n = row_count; total := total + n;
  update public.teleconsultations set status = 'expired', closed_by = 'system', offer_sdp = null, answer_sdp = null
  where status = 'accepted' and started_at is null and accepted_at < now() - interval '30 minutes';
  get diagnostics n = row_count; total := total + n;
  update public.teleconsultations set status = 'ended', closed_by = 'system', ended_at = now(), offer_sdp = null, answer_sdp = null
  where status in ('accepted', 'in_call') and started_at < now() - interval '3 hours';
  get diagnostics n = row_count; total := total + n;
  return total;
end $$;

-- Conferência anual: médico aprovado há mais de 12 meses da última conferência é suspenso até conferir de novo
-- (não no meio de uma consulta: fica para a próxima rodada).
create or replace function private.tele_recheck_doctors()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  update public.doctors d
  set status = 'suspended', available_until = null, reviewed_at = now(), reviewed_by = 'sistema',
      review_note = 'A conferência anual do cadastro venceu. Fale com o IMED para conferir de novo.', updated_at = now()
  where d.status = 'approved'
    and (d.checked_at is null or d.checked_at < now() - interval '12 months')
    and not exists (select 1 from public.teleconsultations t where t.doctor_id = d.id and t.status in ('accepted', 'in_call'));
  get diagnostics n = row_count;
  return n;
end $$;

-- LGPD (finalidade e necessidade): pedido que nenhum médico atendeu (cancelado ou expirado) tem nome, nascimento,
-- celular, motivo e dados de quem pediu apagados 30 dias depois. Ficam só a data, a situação e o aceite do termo.
create or replace function private.tele_forget()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  update public.teleconsultations t
  set patient_name = null, patient_birthdate = null, patient_phone = null, reason = null,
      requester_name = null, relationship = null, anonymized_at = now()
  where t.doctor_id is null and t.status in ('cancelled', 'expired') and t.anonymized_at is null
    and t.created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- O que o pg_cron roda a cada 10 min.
create or replace function private.tele_maintenance()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer := 0;
begin
  n := n + private.tele_expire();
  n := n + private.tele_recheck_doctors();
  n := n + private.tele_forget();
  return n;
end $$;

-- Idade em anos completos (data de São Paulo).
create or replace function private.tele_age(p_birth date)
returns integer
language sql stable
set search_path = ''
as $$
  select extract(year from age((now() at time zone 'America/Sao_Paulo')::date::timestamp, p_birth::timestamp))::integer;
$$;

-- Cadastro de médico de quem está logado (com erro claro se não tiver ou não estiver aprovado).
create or replace function private.tele_me(p_need_approved boolean)
returns public.doctors
language plpgsql stable
set search_path = ''
as $$
declare
  v_doc public.doctors;
begin
  if auth.uid() is null then raise exception 'sem_login' using errcode = 'P0001'; end if;
  select * into v_doc from public.doctors where user_id = auth.uid();
  if not found then raise exception 'sem_cadastro' using errcode = 'P0001'; end if;
  if p_need_approved and v_doc.status <> 'approved' then raise exception 'nao_aprovado' using errcode = 'P0001'; end if;
  return v_doc;
end $$;

-- Pode ler prontuários: admin do IMED que está em tele_record_readers.
create or replace function private.tele_is_reader()
returns boolean
language sql stable
set search_path = ''
as $$
  select public.is_imed_admin()
     and exists (select 1 from public.tele_record_readers r where r.email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- Consulta ainda no prazo de fechar o registro: em andamento, encerrada há até 24 h ou cancelada/expirada depois
-- de aceita há até 24 h. Médico com cadastro não aprovado (ex.: suspenso) só vê estas, e sem o celular do paciente.
create or replace function private.tele_in_window(t public.teleconsultations)
returns boolean
language sql stable
set search_path = ''
as $$
  select case private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at)
           when 'accepted' then true
           when 'in_call' then true
           when 'ended' then coalesce(t.ended_at, now()) > now() - interval '24 hours'
           when 'expired' then coalesce(t.accepted_at > now() - interval '24 hours', false)
           when 'cancelled' then coalesce(t.accepted_at > now() - interval '24 hours', false)
           else false
         end;
$$;

-- O que falta numa conferência para aprovar (null = completa e com os dados de hoje do médico).
create or replace function private.tele_check_missing(c public.doctor_checks, d public.doctors)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when c.id is null then 'conferencia'
    when (c.full_name, c.crm, c.crm_uf, c.rqe, c.specialty)
         is distinct from (d.full_name, d.crm, d.crm_uf::text, d.rqe, d.specialty) then 'dados'
    when not c.cfm_active then 'cfm'
    when d.rqe is not null and not c.rqe_checked then 'rqe'
    when not ((c.id_video and c.crm_card) or c.icp_signature) then 'identidade'
  end;
$$;

revoke all on function private.tele_effective_status(text, timestamptz, timestamptz, timestamptz) from public;
revoke all on function private.tele_expire() from public;
revoke all on function private.tele_recheck_doctors() from public;
revoke all on function private.tele_forget() from public;
revoke all on function private.tele_maintenance() from public;
revoke all on function private.tele_age(date) from public;
revoke all on function private.tele_me(boolean) from public;
revoke all on function private.tele_is_reader() from public;
revoke all on function private.tele_in_window(public.teleconsultations) from public;
revoke all on function private.tele_check_missing(public.doctor_checks, public.doctors) from public;

/* ===================== Paciente (sem conta) ===================== */

-- Médicos atendendo agora (aprovados e com a página aberta). Nada privado. (Também usado pela página inicial.)
create or replace function public.tele_doctors_online()
returns table (full_name text, crm text, crm_uf text, rqe text, specialty text)
language sql stable security definer
set search_path = ''
as $$
  select d.full_name, d.crm, d.crm_uf::text, d.rqe, case when d.rqe is not null then d.specialty end
  from public.doctors d
  where d.status = 'approved' and d.available_until > now()
  order by d.full_name
  limit 50;
$$;

-- Entrar na fila. Ordem das conferências: sinal de alerta, consentimento, dados, menor de idade, quem pede, limites.
-- Versões do termo (TCLE) aceitas: a cada mudança de termo-teleconsulta.html, acrescente a nova aqui e em
-- TCLE_VERSION (assets/js/tele-core.js).
create or replace function public.tele_request(
  p_patient_name text default null,
  p_birthdate date default null,
  p_phone text default null,
  p_reason text default null,
  p_alert_flags text[] default null,
  p_for_other boolean default false,
  p_requester_name text default null,
  p_relationship text default null,
  p_guardian_consent boolean default false,
  p_consent boolean default false,
  p_consent_version text default null,
  p_token_hash text default null,
  p_patient_agrees boolean default false
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_patient_name, ''), '\s+', ' ', 'g'));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_reason text := btrim(coalesce(p_reason, ''));
  v_for_other boolean := coalesce(p_for_other, false);
  v_requester text := nullif(btrim(regexp_replace(coalesce(p_requester_name, ''), '\s+', ' ', 'g')), '');
  v_relationship text := nullif(btrim(regexp_replace(coalesce(p_relationship, ''), '\s+', ' ', 'g')), '');
  v_version text := btrim(coalesce(p_consent_version, ''));
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_age integer;
  v_minor boolean;
  v_old public.teleconsultations;
  v_id uuid;
begin
  -- Sinal de alerta (dor no peito, falta de ar intensa...): não entra na fila; o site manda para 192 / pronto-socorro.
  if exists (select 1 from unnest(coalesce(p_alert_flags, '{}'::text[])) as f where nullif(btrim(f), '') is not null) then
    raise exception 'emergencia' using errcode = 'P0001';
  end if;
  -- Termo de consentimento (TCLE) aceito, numa versão publicada.
  if p_consent is not true or v_version not in ('2026-10-30') then
    raise exception 'sem_consentimento' using errcode = 'P0001';
  end if;
  if char_length(v_name) not between 3 and 120 then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'nome';
  end if;
  if p_birthdate is null or p_birthdate > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'nascimento';
  end if;
  v_age := private.tele_age(p_birthdate);
  if v_age > 120 then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'nascimento';
  end if;
  v_minor := v_age < 18;
  if char_length(v_phone) in (12, 13) and left(v_phone, 2) = '55' then v_phone := substr(v_phone, 3); end if;
  if v_phone !~ '^[1-9][1-9][0-9]{8,9}$' then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'telefone';
  end if;
  if char_length(v_reason) not between 3 and 1000 then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'motivo';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'token';
  end if;
  -- Menor de 18 anos: só com o pai, a mãe ou o responsável legal pedindo, presente e de acordo.
  if v_minor and not (v_for_other and coalesce(p_guardian_consent, false)) then
    raise exception 'menor_sem_responsavel' using errcode = 'P0001';
  end if;
  if v_for_other then
    if v_requester is null or char_length(v_requester) not between 3 and 120 then
      raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'responsavel';
    end if;
    if v_relationship is null or char_length(v_relationship) not between 2 and 60 then
      raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'parentesco';
    end if;
    if v_minor and v_relationship not in ('Mãe', 'Pai', 'Responsável legal (tutor ou guardião)') then
      raise exception 'menor_sem_responsavel' using errcode = 'P0001';
    end if;
    -- Adulto: quem pede declara que o paciente está presente e concorda (ou que é o representante legal dele).
    if not v_minor and p_patient_agrees is not true then
      raise exception 'sem_consentimento' using errcode = 'P0001', detail = 'paciente';
    end if;
  else
    v_requester := null;
    v_relationship := null;
  end if;

  -- Um pedido de cada vez (fila em ordem e limites certos).
  perform pg_advisory_xact_lock(hashtext('imed_tele_request'));
  perform private.tele_expire();
  -- Mesmo código do aparelho (a resposta anterior se perdeu): devolve a mesma consulta, se ainda está ativa.
  select * into v_old from public.teleconsultations t where t.token_hash = v_hash;
  if found then
    if private.tele_effective_status(v_old.status, v_old.created_at, v_old.accepted_at, v_old.started_at)
       in ('waiting', 'accepted', 'in_call') then
      return v_old.id;
    end if;
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'token';
  end if;
  -- Limites contra abuso. Para não revelar se um celular está em teleconsulta, "já tem consulta ativa" e "muitos
  -- pedidos hoje" dão o mesmo erro.
  if exists (select 1 from public.teleconsultations t
             where t.patient_phone = v_phone and t.status in ('waiting', 'accepted', 'in_call'))
     or (select count(*) from public.teleconsultations t
         where t.patient_phone = v_phone and t.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'telefone_indisponivel' using errcode = 'P0001';
  end if;
  if (select count(*) from public.teleconsultations t where t.created_at > now() - interval '1 hour') >= 200
     or (select count(*) from public.teleconsultations t where t.status = 'waiting') >= 30 then
    raise exception 'fila_cheia' using errcode = 'P0001';
  end if;

  insert into public.teleconsultations (token_hash, patient_name, patient_birthdate, patient_phone, for_other,
                                        requester_name, relationship, guardian_consent, patient_agrees, reason,
                                        consent_version, consent_at)
  values (v_hash, v_name, p_birthdate, v_phone, v_for_other, v_requester, v_relationship,
          v_for_other and v_minor and coalesce(p_guardian_consent, false),
          v_for_other and not v_minor and coalesce(p_patient_agrees, false),
          v_reason, v_version, now())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'telefone_indisponivel' using errcode = 'P0001';
end $$;

-- Situação da consulta para o paciente (código errado = nenhuma linha). Marca que a página do paciente está aberta.
create or replace function public.tele_status(p_id uuid, p_token text)
returns table (
  status text, "position" integer, doctors_online integer, doctor jsonb,
  offer_sdp text, offer_version integer, answer_version integer,
  exams jsonb, indication text, guidance text,
  created_at timestamptz, accepted_at timestamptz, started_at timestamptz, ended_at timestamptz,
  patient_name text, patient_birthdate date,
  closed_by text, phone_call_at timestamptz, exams_version integer, exams_at timestamptz, guidance_at timestamptz
)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_row public.teleconsultations;
  v_eff text;
begin
  select * into v_row from public.teleconsultations t
  where t.id = p_id and t.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then return; end if;
  v_eff := private.tele_effective_status(v_row.status, v_row.created_at, v_row.accepted_at, v_row.started_at);
  if v_eff in ('waiting', 'accepted', 'in_call')
     and (v_row.patient_seen_at is null or v_row.patient_seen_at < now() - interval '15 seconds') then
    update public.teleconsultations t set patient_seen_at = now() where t.id = v_row.id;
  end if;
  return query select
    v_eff,
    case when v_eff = 'waiting' then (
      select count(*)::integer + 1 from public.teleconsultations w
      where w.status = 'waiting' and w.created_at >= now() - interval '2 hours'
        and (w.created_at, w.id) < (v_row.created_at, v_row.id)
    ) end,
    (select count(*)::integer from public.doctors d where d.status = 'approved' and d.available_until > now()),
    v_row.doctor_info,
    case when v_eff in ('accepted', 'in_call') then v_row.offer_sdp end,
    v_row.offer_version, v_row.answer_version,
    v_row.exams, v_row.indication, v_row.guidance,
    v_row.created_at, v_row.accepted_at, v_row.started_at, v_row.ended_at,
    v_row.patient_name, v_row.patient_birthdate,
    case when v_eff <> v_row.status then 'system' else v_row.closed_by end,
    v_row.phone_call_at, v_row.exams_version, v_row.exams_at, v_row.guidance_at;
end $$;

-- Resposta do paciente à oferta de vídeo do médico (só para a oferta mais recente).
create or replace function public.tele_answer(p_id uuid, p_token text, p_sdp text, p_version integer)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.teleconsultations;
begin
  select * into v_row from public.teleconsultations t
  where t.id = p_id and t.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  for update;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  if private.tele_effective_status(v_row.status, v_row.created_at, v_row.accepted_at, v_row.started_at) not in ('accepted', 'in_call')
     or v_row.offer_sdp is null then
    raise exception 'estado_invalido' using errcode = 'P0001';
  end if;
  if p_version is distinct from v_row.offer_version then
    raise exception 'versao_antiga' using errcode = 'P0001';
  end if;
  if p_sdp is null or char_length(p_sdp) > 30000 or left(p_sdp, 3) <> 'v=0' then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'sdp';
  end if;
  update public.teleconsultations t
  set answer_sdp = p_sdp, answer_version = p_version, status = 'in_call', started_at = coalesce(t.started_at, now()),
      patient_seen_at = now()
  where t.id = v_row.id;
end $$;

-- Paciente desiste: na fila, ou aceita antes de o atendimento começar (sem vídeo, ligação nem mensagem do médico).
-- Depois de começar, quem encerra é tele_patient_end (ou o médico). Consulta já terminada: não faz nada.
create or replace function public.tele_cancel(p_id uuid, p_token text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.teleconsultations;
  v_eff text;
begin
  select * into v_row from public.teleconsultations t
  where t.id = p_id and t.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  for update;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  v_eff := private.tele_effective_status(v_row.status, v_row.created_at, v_row.accepted_at, v_row.started_at);
  if v_eff in ('ended', 'cancelled', 'expired') then return; end if;
  if not (v_eff = 'waiting' or (v_eff = 'accepted' and v_row.started_at is null)) then
    raise exception 'estado_invalido' using errcode = 'P0001';
  end if;
  update public.teleconsultations t set status = 'cancelled', closed_by = 'patient', offer_sdp = null, answer_sdp = null
  where t.id = v_row.id;
end $$;

-- Paciente encerra a consulta já começada (vídeo, ligação ou mensagem). O médico ainda registra em até 24 h.
-- Antes de começar, use tele_cancel. Consulta já terminada: não faz nada.
create or replace function public.tele_patient_end(p_id uuid, p_token text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.teleconsultations;
  v_eff text;
begin
  select * into v_row from public.teleconsultations t
  where t.id = p_id and t.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  for update;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  v_eff := private.tele_effective_status(v_row.status, v_row.created_at, v_row.accepted_at, v_row.started_at);
  if v_eff in ('ended', 'cancelled', 'expired') then return; end if;
  if not (v_eff = 'in_call' or (v_eff = 'accepted' and v_row.started_at is not null)) then
    raise exception 'estado_invalido' using errcode = 'P0001';
  end if;
  update public.teleconsultations t
  set status = 'ended', ended_at = now(), closed_by = 'patient', offer_sdp = null, answer_sdp = null
  where t.id = v_row.id;
end $$;

-- Chat do paciente: enviar (consulta aceita ou em andamento) e ler (qualquer situação).
create or replace function public.tele_patient_send(p_id uuid, p_token text, p_body text)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.teleconsultations;
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
begin
  select * into v_row from public.teleconsultations t
  where t.id = p_id and t.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  if private.tele_effective_status(v_row.status, v_row.created_at, v_row.accepted_at, v_row.started_at) not in ('accepted', 'in_call') then
    raise exception 'estado_invalido' using errcode = 'P0001';
  end if;
  if char_length(v_body) not between 1 and 1000 then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'mensagem';
  end if;
  if (select count(*) from public.tele_messages m where m.consultation_id = v_row.id) >= 500 then
    raise exception 'limite_mensagens' using errcode = 'P0001';
  end if;
  insert into public.tele_messages (consultation_id, sender, body) values (v_row.id, 'patient', v_body)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.tele_patient_messages(p_id uuid, p_token text, p_after bigint default 0)
returns table (id bigint, sender text, body text, created_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select m.id, m.sender, m.body, m.created_at
  from public.tele_messages m
  join public.teleconsultations t on t.id = m.consultation_id
  where t.id = p_id
    and t.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and m.id > coalesce(p_after, 0)
  order by m.id
  limit 200;
$$;

/* ===================== Médico (logado) ===================== */

-- O próprio cadastro (sem nada de outros) e se é da equipe do IMED. Sem cadastro: campos vazios.
create or replace function public.tele_doctor_me()
returns table (
  id uuid, full_name text, crm text, crm_uf text, rqe text, specialty text, phone text, status text,
  review_note text, reviewed_at timestamptz, available_until timestamptz, created_at timestamptz,
  updated_at timestamptz, is_admin boolean, checked_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select d.id, d.full_name, d.crm, d.crm_uf::text, d.rqe, d.specialty, d.phone, d.status,
         d.review_note, d.reviewed_at, d.available_until, d.created_at, d.updated_at, public.is_imed_admin(), d.checked_at
  from (select 1) as x
  left join public.doctors d on d.user_id = auth.uid()
  where auth.uid() is not null;
$$;

-- Cria ou atualiza o próprio cadastro. Mudou nome, CRM, UF, RQE ou especialidade de um cadastro aprovado:
-- volta para conferência. Recusado que reenvia: volta para conferência. Suspenso continua suspenso.
create or replace function public.tele_doctor_register(
  p_full_name text,
  p_crm text,
  p_crm_uf text,
  p_rqe text default null,
  p_specialty text default null,
  p_phone text default null
)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
  v_crm text := ltrim(regexp_replace(coalesce(p_crm, ''), '\D', '', 'g'), '0');
  v_uf text := upper(btrim(coalesce(p_crm_uf, '')));
  v_rqe text := nullif(ltrim(regexp_replace(coalesce(p_rqe, ''), '\D', '', 'g'), '0'), '');
  v_spec text := nullif(btrim(regexp_replace(coalesce(p_specialty, ''), '\s+', ' ', 'g')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  v_doc public.doctors;
  v_status text;
begin
  if v_uid is null then raise exception 'sem_login' using errcode = 'P0001'; end if;
  if char_length(v_name) not between 5 and 120 or v_name !~ '\S \S' then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'nome';
  end if;
  if v_crm !~ '^[1-9][0-9]{0,9}$' then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'crm';
  end if;
  if v_uf not in ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
                  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO') then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'uf';
  end if;
  if v_rqe is not null and v_rqe !~ '^[1-9][0-9]{0,9}$' then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'rqe';
  end if;
  -- Especialidade só com RQE (e RQE sempre com a especialidade).
  if (v_spec is null) <> (v_rqe is null) or (v_spec is not null and char_length(v_spec) not between 2 and 80) then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'especialidade';
  end if;
  if v_phone is not null then
    if char_length(v_phone) in (12, 13) and left(v_phone, 2) = '55' then v_phone := substr(v_phone, 3); end if;
    if v_phone !~ '^[1-9][1-9][0-9]{8,9}$' then
      raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'telefone';
    end if;
  end if;

  select * into v_doc from public.doctors where user_id = v_uid for update;
  if not found then
    insert into public.doctors (user_id, full_name, crm, crm_uf, rqe, specialty, phone)
    values (v_uid, v_name, v_crm, v_uf, v_rqe, v_spec, v_phone);
    return 'pending';
  end if;
  v_status := case
    when v_doc.status = 'rejected' then 'pending'
    when v_doc.status = 'approved'
         and (v_doc.full_name, v_doc.crm, v_doc.crm_uf::text, v_doc.rqe, v_doc.specialty)
             is distinct from (v_name, v_crm, v_uf, v_rqe, v_spec) then 'pending'
    else v_doc.status
  end;
  update public.doctors d
  set full_name = v_name, crm = v_crm, crm_uf = v_uf, rqe = v_rqe, specialty = v_spec, phone = v_phone,
      status = v_status,
      review_note = case when v_status = 'pending' and v_doc.status <> 'pending' then null else d.review_note end,
      available_until = case when v_status = 'approved' then d.available_until end,
      updated_at = now()
  where d.id = v_doc.id;
  return v_status;
exception when unique_violation then
  raise exception 'crm_em_uso' using errcode = 'P0001';
end $$;

-- "Estou atendendo": renovar a cada minuto (vale 90 s). Desligar sempre funciona.
create or replace function public.tele_set_available(p_on boolean)
returns timestamptz
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_until timestamptz;
begin
  if coalesce(p_on, false) then
    v_doc := private.tele_me(true);
    update public.doctors d set available_until = now() + interval '90 seconds' where d.id = v_doc.id
    returning d.available_until into v_until;
    return v_until;
  end if;
  if auth.uid() is null then raise exception 'sem_login' using errcode = 'P0001'; end if;
  update public.doctors d set available_until = null where d.user_id = auth.uid();
  return null;
end $$;

-- Fila para o médico aprovado: primeiro as próprias consultas em andamento, depois quem espera (ordem de chegada).
-- seen_seconds: há quantos segundos a página do paciente deu sinal (null = nunca).
create or replace function public.tele_queue()
returns table (
  id uuid, status text, patient_name text, age_years integer, reason text, for_other boolean,
  relationship text, wait_minutes integer, created_at timestamptz, accepted_at timestamptz, seen_seconds integer
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
begin
  v_doc := private.tele_me(true);
  return query
    select t.id, t.status, t.patient_name, private.tele_age(t.patient_birthdate), t.reason, t.for_other,
           t.relationship, floor(extract(epoch from (now() - t.created_at)) / 60)::integer, t.created_at, t.accepted_at,
           floor(extract(epoch from (now() - t.patient_seen_at)))::integer
    from public.teleconsultations t
    where (t.status = 'waiting' and t.created_at >= now() - interval '2 hours')
       or (t.doctor_id = v_doc.id and t.status in ('accepted', 'in_call')
           and private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at) in ('accepted', 'in_call'))
    order by (t.status = 'waiting'), t.created_at, t.id
    limit 100;
end $$;

-- Aceitar um paciente da fila (atômico: se dois médicos clicarem juntos, só um consegue).
create or replace function public.tele_accept(p_id uuid)
returns table (
  id uuid, patient_name text, patient_birthdate date, age_years integer, patient_phone text, reason text,
  for_other boolean, requester_name text, relationship text, guardian_consent boolean,
  consent_version text, consent_at timestamptz, created_at timestamptz, accepted_at timestamptz
)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_row public.teleconsultations;
begin
  v_doc := private.tele_me(true);
  perform private.tele_expire();  -- consulta antiga parada não segura o médico
  if exists (select 1 from public.teleconsultations t where t.doctor_id = v_doc.id and t.status in ('accepted', 'in_call')) then
    raise exception 'consulta_ativa' using errcode = 'P0001';
  end if;
  update public.teleconsultations t
  set status = 'accepted', doctor_id = v_doc.id, accepted_at = now(),
      doctor_info = jsonb_build_object('full_name', v_doc.full_name, 'crm', v_doc.crm, 'crm_uf', v_doc.crm_uf::text,
                                       'rqe', v_doc.rqe, 'specialty', case when v_doc.rqe is not null then v_doc.specialty end)
  where t.id = p_id and t.status = 'waiting' and t.created_at >= now() - interval '2 hours'
  returning t.* into v_row;
  if not found then
    if exists (select 1 from public.teleconsultations t where t.id = p_id and t.status in ('accepted', 'in_call', 'ended')) then
      raise exception 'ja_atendida' using errcode = 'P0001';
    elsif exists (select 1 from public.teleconsultations t where t.id = p_id) then
      raise exception 'indisponivel' using errcode = 'P0001';
    end if;
    raise exception 'nao_encontrado' using errcode = 'P0001';
  end if;
  return query select v_row.id, v_row.patient_name, v_row.patient_birthdate, private.tele_age(v_row.patient_birthdate),
                      v_row.patient_phone, v_row.reason, v_row.for_other, v_row.requester_name, v_row.relationship,
                      v_row.guardian_consent, v_row.consent_version, v_row.consent_at, v_row.created_at, v_row.accepted_at;
exception when unique_violation then
  raise exception 'consulta_ativa' using errcode = 'P0001';
end $$;

-- O médico tira da fila um pedido que ainda espera (pedido falso ou repetido). O paciente vê "pedido retirado da fila".
create or replace function public.tele_dismiss(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_row public.teleconsultations;
begin
  v_doc := private.tele_me(true);
  select * into v_row from public.teleconsultations t where t.id = p_id for update;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  if private.tele_effective_status(v_row.status, v_row.created_at, v_row.accepted_at, v_row.started_at) <> 'waiting' then
    raise exception 'estado_invalido' using errcode = 'P0001';
  end if;
  update public.teleconsultations t set status = 'cancelled', closed_by = 'doctor', dismissed_by = v_doc.id
  where t.id = v_row.id;
end $$;

-- O médico avisa que o atendimento começou fora do vídeo (ligou para o paciente ou continuou por mensagem):
-- a consulta não expira em 30 min e o paciente não pode mais "desistir" (passa a "encerrar").
-- p_phone = true: tocou em "Ligar"; o paciente vê que o médico está ligando. Devolve o início do atendimento.
create or replace function public.tele_mark_started(p_id uuid, p_phone boolean default false)
returns timestamptz
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_row public.teleconsultations;
  v_started timestamptz;
begin
  v_doc := private.tele_me(true);
  select * into v_row from public.teleconsultations t where t.id = p_id and t.doctor_id = v_doc.id for update;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  if private.tele_effective_status(v_row.status, v_row.created_at, v_row.accepted_at, v_row.started_at) not in ('accepted', 'in_call') then
    raise exception 'estado_invalido' using errcode = 'P0001';
  end if;
  update public.teleconsultations t
  set started_at = coalesce(t.started_at, now()),
      phone_call_at = case when coalesce(p_phone, false) then now() else t.phone_call_at end
  where t.id = v_row.id
  returning t.started_at into v_started;
  return v_started;
end $$;

-- Oferta de vídeo do médico (nova versão a cada tentativa; a resposta antiga deixa de valer).
create or replace function public.tele_offer(p_id uuid, p_sdp text)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_row public.teleconsultations;
  v_version integer;
begin
  v_doc := private.tele_me(true);
  select * into v_row from public.teleconsultations t where t.id = p_id and t.doctor_id = v_doc.id for update;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  if private.tele_effective_status(v_row.status, v_row.created_at, v_row.accepted_at, v_row.started_at) not in ('accepted', 'in_call') then
    raise exception 'estado_invalido' using errcode = 'P0001';
  end if;
  if p_sdp is null or char_length(p_sdp) > 30000 or left(p_sdp, 3) <> 'v=0' then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'sdp';
  end if;
  update public.teleconsultations t
  set offer_sdp = p_sdp, offer_version = t.offer_version + 1, answer_sdp = null
  where t.id = v_row.id
  returning t.offer_version into v_version;
  return v_version;
end $$;

-- Situação da consulta para o médico dela ou para quem lê prontuários (tele_record_readers, com registro do acesso).
-- access: 'own' (médico aprovado da consulta), 'limited' (médico da consulta com cadastro não aprovado: só no prazo
-- de 24 h para fechar o registro, sem o celular do paciente) ou 'reader'. Outro médico: nenhuma linha.
create or replace function public.tele_doctor_status(p_id uuid)
returns table (
  id uuid, status text, offer_version integer, answer_version integer, answer_sdp text,
  created_at timestamptz, accepted_at timestamptz, started_at timestamptz, ended_at timestamptz,
  patient_name text, patient_birthdate date, age_years integer, patient_phone text, reason text,
  for_other boolean, requester_name text, relationship text, guardian_consent boolean, patient_agrees boolean,
  consent_version text, consent_at timestamptz,
  exams jsonb, indication text, guidance text, notes text, doctor jsonb,
  closed_by text, phone_call_at timestamptz, patient_seen_seconds integer, exams_version integer, exams_at timestamptz,
  access text
)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_row public.teleconsultations;
  v_doc public.doctors;
  v_access text;
  v_eff text;
begin
  if v_uid is null then return; end if;
  select * into v_row from public.teleconsultations t where t.id = p_id;
  if not found then return; end if;
  select * into v_doc from public.doctors d where d.user_id = v_uid;
  if found and v_row.doctor_id = v_doc.id then
    v_access := case when v_doc.status = 'approved' then 'own' when private.tele_in_window(v_row) then 'limited' end;
  end if;
  if v_access is null and private.tele_is_reader() then
    v_access := 'reader';
    insert into public.tele_access_log (consultation_id, user_id, email, fn)
    values (v_row.id, v_uid, lower(coalesce(auth.jwt() ->> 'email', '')), 'tele_doctor_status');
  end if;
  if v_access is null then return; end if;
  v_eff := private.tele_effective_status(v_row.status, v_row.created_at, v_row.accepted_at, v_row.started_at);
  return query select
    v_row.id, v_eff, v_row.offer_version, v_row.answer_version,
    case when v_row.status in ('accepted', 'in_call') then v_row.answer_sdp end,
    v_row.created_at, v_row.accepted_at, v_row.started_at, v_row.ended_at,
    v_row.patient_name, v_row.patient_birthdate, private.tele_age(v_row.patient_birthdate),
    case when v_access = 'limited' then null else v_row.patient_phone end,
    v_row.reason, v_row.for_other, v_row.requester_name, v_row.relationship, v_row.guardian_consent, v_row.patient_agrees,
    v_row.consent_version, v_row.consent_at,
    v_row.exams, v_row.indication, v_row.guidance, v_row.notes, v_row.doctor_info,
    case when v_eff <> v_row.status then 'system' else v_row.closed_by end,
    v_row.phone_call_at,
    case when v_eff in ('waiting', 'accepted', 'in_call') then floor(extract(epoch from (now() - v_row.patient_seen_at)))::integer end,
    v_row.exams_version, v_row.exams_at,
    v_access;
end $$;

-- Exames pedidos (a lista enviada substitui a anterior). Durante a consulta ou até 24 h depois de encerrar.
-- Trocar uma lista (ou indicação) já enviada guarda a anterior em tele_record_changes; cada mudança sobe a versão.
create or replace function public.tele_set_exams(p_id uuid, p_exams jsonb, p_indication text default null)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_row public.teleconsultations;
  v_items jsonb;
  v_ind text := nullif(btrim(coalesce(p_indication, '')), '');
begin
  v_doc := private.tele_me(true);
  select * into v_row from public.teleconsultations t where t.id = p_id and t.doctor_id = v_doc.id for update;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  if v_row.status = 'ended' then
    if v_row.ended_at < now() - interval '24 hours' then raise exception 'prazo_encerrado' using errcode = 'P0001'; end if;
  elsif private.tele_effective_status(v_row.status, v_row.created_at, v_row.accepted_at, v_row.started_at)
        not in ('accepted', 'in_call', 'ended') then
    raise exception 'estado_invalido' using errcode = 'P0001';
  end if;
  if p_exams is null or jsonb_typeof(p_exams) <> 'array' or jsonb_array_length(p_exams) > 60 then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'exames';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_exams) as x(e)
    where not coalesce(
      jsonb_typeof(x.e) = 'object'
      and jsonb_typeof(x.e -> 'name') = 'string'
      and char_length(btrim(x.e ->> 'name')) between 1 and 120
      and char_length(coalesce(x.e ->> 'note', '')) <= 200
      and char_length(coalesce(x.e ->> 'code', '')) <= 60
      and char_length(coalesce(x.e ->> 'group', '')) <= 60
      and char_length(coalesce(x.e ->> 'search', '')) <= 20, false)
  ) then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'exames';
  end if;
  if char_length(v_ind) > 1000 then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'indicacao';
  end if;
  -- Guarda só os campos conhecidos. "search" só com um código da busca do site (senão fica vazio).
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', nullif(btrim(x.e ->> 'code'), ''),
           'name', btrim(x.e ->> 'name'),
           'group', nullif(btrim(x.e ->> 'group'), ''),
           'search', case when x.e ->> 'search' in ('rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab')
                          then x.e ->> 'search' end,
           'note', nullif(btrim(x.e ->> 'note'), '')
         ) order by x.n), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(p_exams) with ordinality as x(e, n);
  if v_items is distinct from v_row.exams or v_ind is distinct from v_row.indication then
    if jsonb_array_length(v_row.exams) > 0 and v_items is distinct from v_row.exams then
      insert into public.tele_record_changes (consultation_id, field, old_value, new_value, changed_by)
      values (v_row.id, 'exams', v_row.exams, v_items, v_doc.id);
    end if;
    if v_row.indication is not null and v_ind is distinct from v_row.indication then
      insert into public.tele_record_changes (consultation_id, field, old_value, new_value, changed_by)
      values (v_row.id, 'indication', to_jsonb(v_row.indication), to_jsonb(v_ind), v_doc.id);
    end if;
    update public.teleconsultations t
    set exams = v_items, indication = v_ind, exams_version = t.exams_version + 1, exams_at = now()
    where t.id = v_row.id;
  end if;
  return jsonb_array_length(v_items);
end $$;

-- Encerrar com o registro (prontuário) e as orientações ao paciente. Chamar de novo em até 24 h não apaga nada:
-- texto novo entra como adendo; o mesmo texto (repetição) não muda nada; orientação nova substitui a anterior, que
-- fica guardada em tele_record_changes. Também registra consulta expirada ou cancelada depois de aceita (até 24 h).
create or replace function public.tele_end(p_id uuid, p_notes text default null, p_guidance text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_row public.teleconsultations;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_guid text := nullif(btrim(coalesce(p_guidance, '')), '');
begin
  v_doc := private.tele_me(false);
  if char_length(v_notes) > 20000 then raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'notas'; end if;
  if char_length(v_guid) > 4000 then raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'orientacoes'; end if;
  select * into v_row from public.teleconsultations t where t.id = p_id and t.doctor_id = v_doc.id for update;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;

  if v_row.status = 'ended' then
    if v_row.ended_at < now() - interval '24 hours' then raise exception 'prazo_encerrado' using errcode = 'P0001'; end if;
    if char_length(coalesce(v_row.notes, '')) + char_length(coalesce(v_notes, '')) > 59000 then
      raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'notas';
    end if;
    if v_guid is not null and v_row.guidance is not null and v_guid <> v_row.guidance then
      insert into public.tele_record_changes (consultation_id, field, old_value, new_value, changed_by)
      values (v_row.id, 'guidance', to_jsonb(v_row.guidance), to_jsonb(v_guid), v_doc.id);
    end if;
    update public.teleconsultations t
    set notes = case
          when v_notes is null or v_notes = t.notes then t.notes
          when t.notes is null then v_notes
          else t.notes || E'\n\n[Adendo ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '] ' || v_notes
        end,
        guidance = coalesce(v_guid, t.guidance),
        guidance_at = case when v_guid is not null and v_guid is distinct from t.guidance then now() else t.guidance_at end
    where t.id = v_row.id;
    return;
  end if;

  -- Aceita/em andamento, ou expirada/cancelada depois de aceita (ex.: atendeu por telefone e o vídeo nunca conectou).
  if not (v_row.status in ('accepted', 'in_call')
          or (v_row.status in ('expired', 'cancelled') and v_row.accepted_at > now() - interval '24 hours')) then
    raise exception 'estado_invalido' using errcode = 'P0001';
  end if;
  update public.teleconsultations t
  set status = 'ended', ended_at = now(), offer_sdp = null, answer_sdp = null, notes = v_notes, guidance = v_guid,
      guidance_at = case when v_guid is not null then now() end,
      closed_by = case when v_row.status in ('accepted', 'in_call') then 'doctor' else coalesce(t.closed_by, 'system') end
  where t.id = v_row.id;
end $$;

-- Chat do médico. A primeira mensagem marca o início do atendimento (plano B: chat/telefone sem vídeo).
create or replace function public.tele_doctor_send(p_id uuid, p_body text)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_row public.teleconsultations;
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
begin
  v_doc := private.tele_me(true);
  select * into v_row from public.teleconsultations t where t.id = p_id and t.doctor_id = v_doc.id;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  if private.tele_effective_status(v_row.status, v_row.created_at, v_row.accepted_at, v_row.started_at) not in ('accepted', 'in_call') then
    raise exception 'estado_invalido' using errcode = 'P0001';
  end if;
  if char_length(v_body) not between 1 and 1000 then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'mensagem';
  end if;
  if (select count(*) from public.tele_messages m where m.consultation_id = v_row.id) >= 500 then
    raise exception 'limite_mensagens' using errcode = 'P0001';
  end if;
  insert into public.tele_messages (consultation_id, sender, body) values (v_row.id, 'doctor', v_body)
  returning id into v_id;
  update public.teleconsultations t set started_at = now() where t.id = v_row.id and t.started_at is null;
  return v_id;
end $$;

-- Mensagens para o médico da consulta (cadastro não aprovado: só no prazo de 24 h) ou para quem lê prontuários
-- (com registro do acesso). Para os demais: nada.
create or replace function public.tele_doctor_messages(p_id uuid, p_after bigint default 0)
returns table (id bigint, sender text, body text, created_at timestamptz)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_row public.teleconsultations;
  v_doc public.doctors;
  v_ok boolean := false;
begin
  if v_uid is null then return; end if;
  select * into v_row from public.teleconsultations t where t.id = p_id;
  if not found then return; end if;
  select * into v_doc from public.doctors d where d.user_id = v_uid;
  if found and v_row.doctor_id = v_doc.id then
    v_ok := v_doc.status = 'approved' or private.tele_in_window(v_row);
  end if;
  if not v_ok and private.tele_is_reader() then
    v_ok := true;
    insert into public.tele_access_log (consultation_id, user_id, email, fn)
    values (v_row.id, v_uid, lower(coalesce(auth.jwt() ->> 'email', '')), 'tele_doctor_messages');
  end if;
  if not v_ok then return; end if;
  return query
    select m.id, m.sender, m.body, m.created_at
    from public.tele_messages m
    where m.consultation_id = v_row.id and m.id > coalesce(p_after, 0)
    order by m.id
    limit 200;
end $$;

-- Consultas terminadas do próprio médico (encerradas e também as canceladas/expiradas depois de aceitas), sem SDP.
-- Toda consulta do médico está ou na fila (tele_queue) ou aqui. Cadastro não aprovado (ex.: suspenso): só as que ainda
-- estão no prazo de 24 h para fechar o registro, e sem o celular do paciente.
create or replace function public.tele_history()
returns table (
  id uuid, status text, patient_name text, patient_birthdate date, patient_phone text, reason text,
  for_other boolean, requester_name text, relationship text,
  created_at timestamptz, accepted_at timestamptz, started_at timestamptz, ended_at timestamptz,
  exams jsonb, indication text, guidance text, notes text, closed_by text, exams_version integer
)
language sql stable security definer
set search_path = ''
as $$
  select t.id, private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at),
         t.patient_name, t.patient_birthdate, case when d.status = 'approved' then t.patient_phone end, t.reason,
         t.for_other, t.requester_name, t.relationship,
         t.created_at, t.accepted_at, t.started_at, t.ended_at,
         t.exams, t.indication, t.guidance, t.notes,
         case when private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at) <> t.status
              then 'system' else t.closed_by end,
         t.exams_version
  from public.teleconsultations t
  join public.doctors d on d.id = t.doctor_id and d.user_id = auth.uid()
  where private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at) in ('ended', 'cancelled', 'expired')
    and (d.status = 'approved' or private.tele_in_window(t))
  order by coalesce(t.ended_at, t.accepted_at, t.created_at) desc
  limit 100;
$$;

/* ===================== Equipe do IMED (admin) ===================== */

-- Todos os médicos, pendentes primeiro (mais antigos primeiro), com o e-mail da conta, a última conferência
-- (last_check, com "missing" = o que falta para aprovar) e quantos outros cadastros usam o mesmo CRM/UF.
create or replace function public.tele_admin_doctors()
returns table (
  id uuid, user_id uuid, email text, full_name text, crm text, crm_uf text, rqe text, specialty text, phone text,
  status text, review_note text, reviewed_at timestamptz, reviewed_by text, available_until timestamptz,
  created_at timestamptz, updated_at timestamptz, consultations integer,
  checked_at timestamptz, last_check jsonb, crm_duplicates integer
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_imed_admin() then raise exception 'so_admin' using errcode = 'P0001'; end if;
  return query
    select d.id, d.user_id, u.email::text, d.full_name, d.crm, d.crm_uf::text, d.rqe, d.specialty, d.phone,
           d.status, d.review_note, d.reviewed_at, d.reviewed_by, d.available_until, d.created_at, d.updated_at,
           (select count(*)::integer from public.teleconsultations t where t.doctor_id = d.id),
           d.checked_at,
           (select to_jsonb(c) - 'doctor_id' || jsonb_build_object('missing', private.tele_check_missing(c, d))
            from public.doctor_checks c where c.doctor_id = d.id order by c.id desc limit 1),
           (select count(*)::integer from public.doctors o
            where o.crm = d.crm and o.crm_uf = d.crm_uf and o.id <> d.id and o.status <> 'rejected')
    from public.doctors d
    left join auth.users u on u.id = d.user_id
    order by (d.status <> 'pending'), case when d.status = 'pending' then d.created_at end, d.created_at desc
    limit 500;
end $$;

-- Grava a conferência de um médico (nova linha; os dados do cadastro de agora vão junto). Pode salvar aos poucos.
-- p_checks: {cfm_active, rqe_checked, id_video, crm_card, icp_signature: true/false, note: texto até 300}.
-- Devolve 'completa' (já dá para aprovar) ou 'incompleta'.
create or replace function public.tele_admin_save_checks(p_doctor uuid, p_checks jsonb)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_c public.doctor_checks;
  v_checks jsonb := case when jsonb_typeof(p_checks) = 'object' then p_checks else '{}'::jsonb end;
  v_note text := nullif(btrim(coalesce(v_checks ->> 'note', '')), '');
begin
  if not public.is_imed_admin() then raise exception 'so_admin' using errcode = 'P0001'; end if;
  if char_length(v_note) > 300 then raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'nota'; end if;
  select * into v_doc from public.doctors d where d.id = p_doctor for update;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  insert into public.doctor_checks (doctor_id, full_name, crm, crm_uf, rqe, specialty,
                                    cfm_active, rqe_checked, id_video, crm_card, icp_signature, note, checked_by)
  values (v_doc.id, v_doc.full_name, v_doc.crm, v_doc.crm_uf::text, v_doc.rqe, v_doc.specialty,
          coalesce(v_checks -> 'cfm_active' = 'true'::jsonb, false),
          v_doc.rqe is not null and coalesce(v_checks -> 'rqe_checked' = 'true'::jsonb, false),
          coalesce(v_checks -> 'id_video' = 'true'::jsonb, false),
          coalesce(v_checks -> 'crm_card' = 'true'::jsonb, false),
          coalesce(v_checks -> 'icp_signature' = 'true'::jsonb, false),
          v_note, lower(coalesce(auth.jwt() ->> 'email', '')))
  returning * into v_c;
  return case when private.tele_check_missing(v_c, v_doc) is null then 'completa' else 'incompleta' end;
end $$;

-- Aprovar, recusar ou suspender (com observação opcional, que o médico vê). Recusado/suspenso sai do ar na hora;
-- recusar solta o CRM (útil quando alguém usou o CRM de outro médico). Aprovar (ou reativar) exige a última
-- conferência completa, com os dados de hoje do médico e feita há até 30 dias ('conferencia_incompleta', com o que
-- falta em "details": conferencia, dados, cfm, rqe, identidade ou antiga).
create or replace function public.tele_admin_set_doctor(p_doctor uuid, p_status text, p_note text default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_c public.doctor_checks;
  v_missing text;
  v_status text;
begin
  if not public.is_imed_admin() then raise exception 'so_admin' using errcode = 'P0001'; end if;
  if p_status is null or p_status not in ('approved', 'rejected', 'suspended') then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'status';
  end if;
  select * into v_doc from public.doctors d where d.id = p_doctor for update;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  if p_status = 'approved' then
    select * into v_c from public.doctor_checks c where c.doctor_id = v_doc.id order by c.id desc limit 1;
    v_missing := private.tele_check_missing(v_c, v_doc);
    if v_missing is null and v_c.checked_at < now() - interval '30 days' then v_missing := 'antiga'; end if;
    if v_missing is not null then
      raise exception 'conferencia_incompleta' using errcode = 'P0001', detail = v_missing;
    end if;
  end if;
  update public.doctors d
  set status = p_status, reviewed_at = now(), reviewed_by = lower(coalesce(auth.jwt() ->> 'email', '')),
      review_note = nullif(left(btrim(coalesce(p_note, '')), 300), ''),
      available_until = case when p_status = 'approved' then d.available_until end,
      checked_at = case when p_status = 'approved' then v_c.checked_at else d.checked_at end,
      updated_at = now()
  where d.id = v_doc.id
  returning d.status into v_status;
  return v_status;
exception when unique_violation then
  raise exception 'crm_em_uso' using errcode = 'P0001';
end $$;

/* ===================== Permissões ===================== */
-- Paciente (com ou sem conta)
revoke all on function public.tele_doctors_online() from public, anon, authenticated;
revoke all on function public.tele_request(text, date, text, text, text[], boolean, text, text, boolean, boolean, text, text, boolean) from public, anon, authenticated;
revoke all on function public.tele_status(uuid, text) from public, anon, authenticated;
revoke all on function public.tele_answer(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.tele_cancel(uuid, text) from public, anon, authenticated;
revoke all on function public.tele_patient_end(uuid, text) from public, anon, authenticated;
revoke all on function public.tele_patient_send(uuid, text, text) from public, anon, authenticated;
revoke all on function public.tele_patient_messages(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.tele_doctors_online() to anon, authenticated;
grant execute on function public.tele_request(text, date, text, text, text[], boolean, text, text, boolean, boolean, text, text, boolean) to anon, authenticated;
grant execute on function public.tele_status(uuid, text) to anon, authenticated;
grant execute on function public.tele_answer(uuid, text, text, integer) to anon, authenticated;
grant execute on function public.tele_cancel(uuid, text) to anon, authenticated;
grant execute on function public.tele_patient_end(uuid, text) to anon, authenticated;
grant execute on function public.tele_patient_send(uuid, text, text) to anon, authenticated;
grant execute on function public.tele_patient_messages(uuid, text, bigint) to anon, authenticated;

-- Médico e equipe do IMED (só logado)
revoke all on function public.tele_doctor_me() from public, anon, authenticated;
revoke all on function public.tele_doctor_register(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.tele_set_available(boolean) from public, anon, authenticated;
revoke all on function public.tele_queue() from public, anon, authenticated;
revoke all on function public.tele_accept(uuid) from public, anon, authenticated;
revoke all on function public.tele_dismiss(uuid) from public, anon, authenticated;
revoke all on function public.tele_mark_started(uuid, boolean) from public, anon, authenticated;
revoke all on function public.tele_offer(uuid, text) from public, anon, authenticated;
revoke all on function public.tele_doctor_status(uuid) from public, anon, authenticated;
revoke all on function public.tele_set_exams(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.tele_end(uuid, text, text) from public, anon, authenticated;
revoke all on function public.tele_doctor_send(uuid, text) from public, anon, authenticated;
revoke all on function public.tele_doctor_messages(uuid, bigint) from public, anon, authenticated;
revoke all on function public.tele_history() from public, anon, authenticated;
revoke all on function public.tele_admin_doctors() from public, anon, authenticated;
revoke all on function public.tele_admin_save_checks(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.tele_admin_set_doctor(uuid, text, text) from public, anon, authenticated;
grant execute on function public.tele_doctor_me() to authenticated;
grant execute on function public.tele_doctor_register(text, text, text, text, text, text) to authenticated;
grant execute on function public.tele_set_available(boolean) to authenticated;
grant execute on function public.tele_queue() to authenticated;
grant execute on function public.tele_accept(uuid) to authenticated;
grant execute on function public.tele_dismiss(uuid) to authenticated;
grant execute on function public.tele_mark_started(uuid, boolean) to authenticated;
grant execute on function public.tele_offer(uuid, text) to authenticated;
grant execute on function public.tele_doctor_status(uuid) to authenticated;
grant execute on function public.tele_set_exams(uuid, jsonb, text) to authenticated;
grant execute on function public.tele_end(uuid, text, text) to authenticated;
grant execute on function public.tele_doctor_send(uuid, text) to authenticated;
grant execute on function public.tele_doctor_messages(uuid, bigint) to authenticated;
grant execute on function public.tele_history() to authenticated;
grant execute on function public.tele_admin_doctors() to authenticated;
grant execute on function public.tele_admin_save_checks(uuid, jsonb) to authenticated;
grant execute on function public.tele_admin_set_doctor(uuid, text, text) to authenticated;

/* ===================== Limpeza automática ===================== */
-- A cada 10 min: fila parada há 2 h e aceitas sem início em 30 min viram 'expired'; em andamento há 3 h, 'ended';
-- médico com a conferência vencida (12 meses) é suspenso; pedido não atendido há 30 dias tem os dados pessoais apagados.
select cron.unschedule(jobid) from cron.job where jobname = 'imed-teleconsulta-expira';
select cron.schedule('imed-teleconsulta-expira', '*/10 * * * *', 'select private.tele_maintenance()');
