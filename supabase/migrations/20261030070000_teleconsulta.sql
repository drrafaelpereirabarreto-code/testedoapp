-- Teleconsulta do IMED: o paciente entra na fila pelo site, um médico com cadastro aprovado atende por vídeo,
-- pede exames e registra a consulta (prontuário).
-- - Paciente não precisa de conta: recebe um código secreto que fica só no aparelho; o banco guarda o SHA-256 dele
--   (igual aos pedidos de agendamento).
-- - Só atende médico APROVADO pela equipe do IMED (nome, CRM/UF e RQE conferidos na busca do CFM).
-- - Vídeo: WebRTC direto entre os dois navegadores. O banco só troca a "oferta" e a "resposta" de conexão (SDP)
--   enquanto a consulta está em andamento e as apaga ao terminar. Não há gravação de vídeo.
-- - Telemedicina (Res. CFM 2.314/2022 e Lei 14.510/2022): consentimento (TCLE) registrado com versão e hora,
--   identificação do médico guardada na consulta, prontuário só para o médico da consulta e a equipe do IMED.
-- - Tabelas fechadas para anon/authenticated: todo acesso passa pelas funções abaixo. Nada é apagado.
-- - Erros: mensagens curtas e estáveis (ex.: 'emergencia', 'fila_cheia'); quando é um campo, o nome vai em "details".

/* ===================== Tabelas ===================== */

-- Médicos da teleconsulta. O próprio médico (logado) se cadastra; a equipe do IMED aprova, recusa ou suspende.
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
  available_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Um CRM/UF por conta. Cadastro recusado não prende o número (o médico verdadeiro consegue se cadastrar).
create unique index if not exists doctors_crm_uq on public.doctors (crm, crm_uf) where status <> 'rejected';
comment on table public.doctors is 'Médicos da teleconsulta. Só atende quem a equipe do IMED aprovou (CRM/UF e RQE conferidos no CFM).';
comment on column public.doctors.specialty is 'Especialidade só com RQE (regra do CFM para anunciar especialidade).';
comment on column public.doctors.phone is 'Privado: só o próprio médico e a equipe do IMED veem.';
comment on column public.doctors.available_until is 'Disponível para atender até esta hora (o site renova a cada minuto).';

create table if not exists public.teleconsultations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'waiting'
    check (status in ('waiting', 'accepted', 'in_call', 'ended', 'cancelled', 'expired')),
  patient_name text not null check (char_length(patient_name) between 3 and 120),
  patient_birthdate date not null,
  patient_phone text not null check (patient_phone ~ '^[1-9][1-9][0-9]{8,9}$'),
  for_other boolean not null default false,
  requester_name text check (requester_name is null or char_length(requester_name) between 3 and 120),
  relationship text check (relationship is null or char_length(relationship) between 2 and 60),
  guardian_consent boolean not null default false,
  reason text not null check (char_length(reason) between 3 and 1000),
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  consent_at timestamptz not null,
  doctor_id uuid references public.doctors (id),
  doctor_info jsonb,
  accepted_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  offer_sdp text check (offer_sdp is null or char_length(offer_sdp) <= 30000),
  offer_version integer not null default 0,
  answer_sdp text check (answer_sdp is null or char_length(answer_sdp) <= 30000),
  answer_version integer not null default 0,
  exams jsonb not null default '[]'::jsonb check (jsonb_typeof(exams) = 'array'),
  indication text check (indication is null or char_length(indication) <= 1000),
  guidance text check (guidance is null or char_length(guidance) <= 4000),
  notes text check (notes is null or char_length(notes) <= 60000),
  created_at timestamptz not null default now(),
  check (case status when 'waiting' then doctor_id is null
                     when 'accepted' then doctor_id is not null
                     when 'in_call' then doctor_id is not null
                     when 'ended' then doctor_id is not null
                     else true end)
);
create index if not exists teleconsultations_status_idx on public.teleconsultations (status, created_at);
create index if not exists teleconsultations_doctor_idx on public.teleconsultations (doctor_id, created_at) where doctor_id is not null;
-- Uma consulta ativa por telefone e uma por médico (garantido pelo banco, mesmo com cliques ao mesmo tempo).
create unique index if not exists teleconsultations_phone_ativa_uq on public.teleconsultations (patient_phone)
  where status in ('waiting', 'accepted', 'in_call');
create unique index if not exists teleconsultations_medico_ativo_uq on public.teleconsultations (doctor_id)
  where status in ('accepted', 'in_call');
comment on table public.teleconsultations is
  'Teleconsultas: fila, conexão de vídeo, exames pedidos e prontuário. Guardadas; o prontuário só o médico da consulta e a equipe do IMED leem.';
comment on column public.teleconsultations.token_hash is 'SHA-256 (hex) do código secreto que fica só no aparelho do paciente.';
comment on column public.teleconsultations.consent_version is 'Versão do termo de consentimento (TCLE) que o paciente aceitou, em consent_at.';
comment on column public.teleconsultations.doctor_info is 'Identificação do médico no momento do atendimento (nome, CRM/UF, RQE, especialidade).';
comment on column public.teleconsultations.offer_sdp is 'Oferta de conexão do vídeo (temporária: apagada ao terminar).';
comment on column public.teleconsultations.exams is 'Exames pedidos: lista de {code, name, group, search, note}; search = código da busca do site.';
comment on column public.teleconsultations.guidance is 'Orientações do médico, visíveis ao paciente.';
comment on column public.teleconsultations.notes is 'Prontuário: só o médico da consulta e a equipe do IMED leem.';

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

-- Ninguém lê ou escreve direto pela API: só pelas funções.
alter table public.doctors enable row level security;
alter table public.teleconsultations enable row level security;
alter table public.tele_messages enable row level security;
revoke all on public.doctors, public.teleconsultations, public.tele_messages from anon, authenticated;
do $$ begin
  execute format('revoke all on sequence %s from anon, authenticated', pg_get_serial_sequence('public.tele_messages', 'id'));
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
  update public.teleconsultations set status = 'expired', offer_sdp = null, answer_sdp = null
  where status = 'waiting' and created_at < now() - interval '2 hours';
  get diagnostics n = row_count; total := total + n;
  update public.teleconsultations set status = 'expired', offer_sdp = null, answer_sdp = null
  where status = 'accepted' and started_at is null and accepted_at < now() - interval '30 minutes';
  get diagnostics n = row_count; total := total + n;
  update public.teleconsultations set status = 'ended', ended_at = now(), offer_sdp = null, answer_sdp = null
  where status in ('accepted', 'in_call') and started_at < now() - interval '3 hours';
  get diagnostics n = row_count; total := total + n;
  return total;
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

revoke all on function private.tele_effective_status(text, timestamptz, timestamptz, timestamptz) from public;
revoke all on function private.tele_expire() from public;
revoke all on function private.tele_age(date) from public;
revoke all on function private.tele_me(boolean) from public;

/* ===================== Paciente (sem conta) ===================== */

-- Médicos atendendo agora (aprovados e com a página aberta). Nada privado.
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

-- Entrar na fila. Ordem das conferências: sinal de alerta, consentimento, dados, menor de idade, limites.
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
  p_token_hash text default null
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
  v_id uuid;
begin
  -- Sinal de alerta (dor no peito, falta de ar intensa...): não entra na fila; o site manda para 192 / pronto-socorro.
  if exists (select 1 from unnest(coalesce(p_alert_flags, '{}'::text[])) as f where nullif(btrim(f), '') is not null) then
    raise exception 'emergencia' using errcode = 'P0001';
  end if;
  -- Termo de consentimento (TCLE) aceito, com a versão do texto.
  if p_consent is not true or v_version = '' or char_length(v_version) > 40 then
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
  -- Menor de 18 anos: só com o responsável legal presente e de acordo.
  if v_age < 18 and not (v_for_other and coalesce(p_guardian_consent, false)) then
    raise exception 'menor_sem_responsavel' using errcode = 'P0001';
  end if;
  if v_for_other then
    if v_requester is null or char_length(v_requester) not between 3 and 120 then
      raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'responsavel';
    end if;
    if v_relationship is null or char_length(v_relationship) not between 2 and 60 then
      raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'parentesco';
    end if;
  else
    v_requester := null;
    v_relationship := null;
  end if;

  -- Limites contra abuso: um pedido de cada vez (fila em ordem), 1 consulta ativa por telefone, 30 na fila.
  perform pg_advisory_xact_lock(hashtext('imed_tele_request'));
  perform private.tele_expire();
  if exists (select 1 from public.teleconsultations t
             where t.patient_phone = v_phone and t.status in ('waiting', 'accepted', 'in_call')) then
    raise exception 'ja_na_fila' using errcode = 'P0001';
  end if;
  if (select count(*) from public.teleconsultations t where t.status = 'waiting') >= 30 then
    raise exception 'fila_cheia' using errcode = 'P0001';
  end if;

  insert into public.teleconsultations (token_hash, patient_name, patient_birthdate, patient_phone, for_other,
                                        requester_name, relationship, guardian_consent, reason, consent_version, consent_at)
  values (v_hash, v_name, p_birthdate, v_phone, v_for_other, v_requester, v_relationship,
          v_for_other and coalesce(p_guardian_consent, false), v_reason, v_version, now())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'ja_na_fila' using errcode = 'P0001';
end $$;

-- Situação da consulta para o paciente (código errado = nenhuma linha).
create or replace function public.tele_status(p_id uuid, p_token text)
returns table (
  status text, "position" integer, doctors_online integer, doctor jsonb,
  offer_sdp text, offer_version integer, answer_version integer,
  exams jsonb, indication text, guidance text,
  created_at timestamptz, accepted_at timestamptz, started_at timestamptz, ended_at timestamptz,
  patient_name text, patient_birthdate date
)
language sql stable security definer
set search_path = ''
as $$
  with c as (
    select t.*, private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at) as eff
    from public.teleconsultations t
    where t.id = p_id
      and t.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  )
  select
    c.eff,
    case when c.eff = 'waiting' then (
      select count(*)::integer + 1 from public.teleconsultations w
      where w.status = 'waiting' and w.created_at >= now() - interval '2 hours'
        and (w.created_at, w.id) < (c.created_at, c.id)
    ) end,
    (select count(*)::integer from public.doctors d where d.status = 'approved' and d.available_until > now()),
    c.doctor_info,
    case when c.eff in ('accepted', 'in_call') then c.offer_sdp end,
    c.offer_version, c.answer_version,
    c.exams, c.indication, c.guidance,
    c.created_at, c.accepted_at, c.started_at, c.ended_at,
    c.patient_name, c.patient_birthdate
  from c;
$$;

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
  set answer_sdp = p_sdp, answer_version = p_version, status = 'in_call', started_at = coalesce(t.started_at, now())
  where t.id = v_row.id;
end $$;

-- Paciente desiste (na fila ou antes de o vídeo começar). Consulta já terminada: não faz nada.
create or replace function public.tele_cancel(p_id uuid, p_token text)
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
  if v_row.status in ('ended', 'cancelled', 'expired') then return; end if;
  if v_row.status not in ('waiting', 'accepted') then raise exception 'estado_invalido' using errcode = 'P0001'; end if;
  update public.teleconsultations t set status = 'cancelled', offer_sdp = null, answer_sdp = null where t.id = v_row.id;
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
  updated_at timestamptz, is_admin boolean
)
language sql stable security definer
set search_path = ''
as $$
  select d.id, d.full_name, d.crm, d.crm_uf::text, d.rqe, d.specialty, d.phone, d.status,
         d.review_note, d.reviewed_at, d.available_until, d.created_at, d.updated_at, public.is_imed_admin()
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
create or replace function public.tele_queue()
returns table (
  id uuid, status text, patient_name text, age_years integer, reason text, for_other boolean,
  relationship text, wait_minutes integer, created_at timestamptz, accepted_at timestamptz
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
           t.relationship, floor(extract(epoch from (now() - t.created_at)) / 60)::integer, t.created_at, t.accepted_at
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

-- Situação da consulta para o médico dela (ou a equipe do IMED). Outro médico: nenhuma linha.
create or replace function public.tele_doctor_status(p_id uuid)
returns table (
  id uuid, status text, offer_version integer, answer_version integer, answer_sdp text,
  created_at timestamptz, accepted_at timestamptz, started_at timestamptz, ended_at timestamptz,
  patient_name text, patient_birthdate date, age_years integer, patient_phone text, reason text,
  for_other boolean, requester_name text, relationship text, guardian_consent boolean,
  consent_version text, consent_at timestamptz,
  exams jsonb, indication text, guidance text, notes text, doctor jsonb
)
language sql stable security definer
set search_path = ''
as $$
  select t.id, private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at),
         t.offer_version, t.answer_version,
         case when t.status in ('accepted', 'in_call') then t.answer_sdp end,
         t.created_at, t.accepted_at, t.started_at, t.ended_at,
         t.patient_name, t.patient_birthdate, private.tele_age(t.patient_birthdate), t.patient_phone, t.reason,
         t.for_other, t.requester_name, t.relationship, t.guardian_consent, t.consent_version, t.consent_at,
         t.exams, t.indication, t.guidance, t.notes, t.doctor_info
  from public.teleconsultations t
  where t.id = p_id
    and auth.uid() is not null
    and (exists (select 1 from public.doctors d where d.id = t.doctor_id and d.user_id = auth.uid())
         or public.is_imed_admin());
$$;

-- Exames pedidos (a lista enviada substitui a anterior). Durante a consulta ou até 24 h depois de encerrar.
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
  elsif v_row.status not in ('accepted', 'in_call') then
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
  update public.teleconsultations t set exams = v_items, indication = v_ind where t.id = v_row.id;
  return jsonb_array_length(v_items);
end $$;

-- Encerrar com o registro (prontuário) e as orientações ao paciente. Chamar de novo em até 24 h não apaga nada:
-- texto novo entra como adendo; o mesmo texto (repetição) não muda nada.
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
    update public.teleconsultations t
    set notes = case
          when v_notes is null or v_notes = t.notes then t.notes
          when t.notes is null then v_notes
          else t.notes || E'\n\n[Adendo ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '] ' || v_notes
        end,
        guidance = coalesce(v_guid, t.guidance)
    where t.id = v_row.id;
    return;
  end if;

  -- Aceita/em andamento, ou expirada depois de aceita (ex.: atendeu por telefone e o vídeo nunca conectou).
  if not (v_row.status in ('accepted', 'in_call')
          or (v_row.status = 'expired' and v_row.accepted_at > now() - interval '24 hours')) then
    raise exception 'estado_invalido' using errcode = 'P0001';
  end if;
  update public.teleconsultations t
  set status = 'ended', ended_at = now(), offer_sdp = null, answer_sdp = null, notes = v_notes, guidance = v_guid
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

create or replace function public.tele_doctor_messages(p_id uuid, p_after bigint default 0)
returns table (id bigint, sender text, body text, created_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select m.id, m.sender, m.body, m.created_at
  from public.tele_messages m
  join public.teleconsultations t on t.id = m.consultation_id
  where t.id = p_id
    and m.id > coalesce(p_after, 0)
    and auth.uid() is not null
    and (exists (select 1 from public.doctors d where d.id = t.doctor_id and d.user_id = auth.uid())
         or public.is_imed_admin())
  order by m.id
  limit 200;
$$;

-- Consultas terminadas do próprio médico (encerradas e também as canceladas/expiradas depois de aceitas), sem SDP.
-- Toda consulta do médico está ou na fila (tele_queue) ou aqui.
create or replace function public.tele_history()
returns table (
  id uuid, status text, patient_name text, patient_birthdate date, patient_phone text, reason text,
  for_other boolean, requester_name text, relationship text,
  created_at timestamptz, accepted_at timestamptz, started_at timestamptz, ended_at timestamptz,
  exams jsonb, indication text, guidance text, notes text
)
language sql stable security definer
set search_path = ''
as $$
  select t.id, private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at),
         t.patient_name, t.patient_birthdate, t.patient_phone, t.reason,
         t.for_other, t.requester_name, t.relationship,
         t.created_at, t.accepted_at, t.started_at, t.ended_at,
         t.exams, t.indication, t.guidance, t.notes
  from public.teleconsultations t
  join public.doctors d on d.id = t.doctor_id and d.user_id = auth.uid()
  where private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at) in ('ended', 'cancelled', 'expired')
  order by coalesce(t.ended_at, t.accepted_at, t.created_at) desc
  limit 100;
$$;

/* ===================== Equipe do IMED (admin) ===================== */

-- Todos os médicos, pendentes primeiro (mais antigos primeiro), com o e-mail da conta.
create or replace function public.tele_admin_doctors()
returns table (
  id uuid, user_id uuid, email text, full_name text, crm text, crm_uf text, rqe text, specialty text, phone text,
  status text, review_note text, reviewed_at timestamptz, reviewed_by text, available_until timestamptz,
  created_at timestamptz, updated_at timestamptz, consultations integer
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_imed_admin() then raise exception 'so_admin' using errcode = 'P0001'; end if;
  return query
    select d.id, d.user_id, u.email::text, d.full_name, d.crm, d.crm_uf::text, d.rqe, d.specialty, d.phone,
           d.status, d.review_note, d.reviewed_at, d.reviewed_by, d.available_until, d.created_at, d.updated_at,
           (select count(*)::integer from public.teleconsultations t where t.doctor_id = d.id)
    from public.doctors d
    left join auth.users u on u.id = d.user_id
    order by (d.status <> 'pending'), case when d.status = 'pending' then d.created_at end, d.created_at desc
    limit 500;
end $$;

-- Aprovar, recusar ou suspender (com observação opcional, que o médico vê). Recusado/suspenso sai do ar na hora.
create or replace function public.tele_admin_set_doctor(p_doctor uuid, p_status text, p_note text default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.is_imed_admin() then raise exception 'so_admin' using errcode = 'P0001'; end if;
  if p_status is null or p_status not in ('approved', 'rejected', 'suspended') then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = 'status';
  end if;
  update public.doctors d
  set status = p_status, reviewed_at = now(), reviewed_by = lower(coalesce(auth.jwt() ->> 'email', '')),
      review_note = nullif(left(btrim(coalesce(p_note, '')), 300), ''),
      available_until = case when p_status = 'approved' then d.available_until end,
      updated_at = now()
  where d.id = p_doctor
  returning d.status into v_status;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  return v_status;
exception when unique_violation then
  raise exception 'crm_em_uso' using errcode = 'P0001';
end $$;

/* ===================== Permissões ===================== */
-- Paciente (com ou sem conta)
revoke all on function public.tele_doctors_online() from public, anon, authenticated;
revoke all on function public.tele_request(text, date, text, text, text[], boolean, text, text, boolean, boolean, text, text) from public, anon, authenticated;
revoke all on function public.tele_status(uuid, text) from public, anon, authenticated;
revoke all on function public.tele_answer(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.tele_cancel(uuid, text) from public, anon, authenticated;
revoke all on function public.tele_patient_send(uuid, text, text) from public, anon, authenticated;
revoke all on function public.tele_patient_messages(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.tele_doctors_online() to anon, authenticated;
grant execute on function public.tele_request(text, date, text, text, text[], boolean, text, text, boolean, boolean, text, text) to anon, authenticated;
grant execute on function public.tele_status(uuid, text) to anon, authenticated;
grant execute on function public.tele_answer(uuid, text, text, integer) to anon, authenticated;
grant execute on function public.tele_cancel(uuid, text) to anon, authenticated;
grant execute on function public.tele_patient_send(uuid, text, text) to anon, authenticated;
grant execute on function public.tele_patient_messages(uuid, text, bigint) to anon, authenticated;

-- Médico e equipe do IMED (só logado)
revoke all on function public.tele_doctor_me() from public, anon, authenticated;
revoke all on function public.tele_doctor_register(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.tele_set_available(boolean) from public, anon, authenticated;
revoke all on function public.tele_queue() from public, anon, authenticated;
revoke all on function public.tele_accept(uuid) from public, anon, authenticated;
revoke all on function public.tele_offer(uuid, text) from public, anon, authenticated;
revoke all on function public.tele_doctor_status(uuid) from public, anon, authenticated;
revoke all on function public.tele_set_exams(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.tele_end(uuid, text, text) from public, anon, authenticated;
revoke all on function public.tele_doctor_send(uuid, text) from public, anon, authenticated;
revoke all on function public.tele_doctor_messages(uuid, bigint) from public, anon, authenticated;
revoke all on function public.tele_history() from public, anon, authenticated;
revoke all on function public.tele_admin_doctors() from public, anon, authenticated;
revoke all on function public.tele_admin_set_doctor(uuid, text, text) from public, anon, authenticated;
grant execute on function public.tele_doctor_me() to authenticated;
grant execute on function public.tele_doctor_register(text, text, text, text, text, text) to authenticated;
grant execute on function public.tele_set_available(boolean) to authenticated;
grant execute on function public.tele_queue() to authenticated;
grant execute on function public.tele_accept(uuid) to authenticated;
grant execute on function public.tele_offer(uuid, text) to authenticated;
grant execute on function public.tele_doctor_status(uuid) to authenticated;
grant execute on function public.tele_set_exams(uuid, jsonb, text) to authenticated;
grant execute on function public.tele_end(uuid, text, text) to authenticated;
grant execute on function public.tele_doctor_send(uuid, text) to authenticated;
grant execute on function public.tele_doctor_messages(uuid, bigint) to authenticated;
grant execute on function public.tele_history() to authenticated;
grant execute on function public.tele_admin_doctors() to authenticated;
grant execute on function public.tele_admin_set_doctor(uuid, text, text) to authenticated;

/* ===================== Limpeza automática ===================== */
-- A cada 10 min: fila parada há 2 h e aceitas sem início em 30 min viram 'expired'; em andamento há 3 h, 'ended'.
select cron.unschedule(jobid) from cron.job where jobname = 'imed-teleconsulta-expira';
select cron.schedule('imed-teleconsulta-expira', '*/10 * * * *', 'select private.tele_expire()');
