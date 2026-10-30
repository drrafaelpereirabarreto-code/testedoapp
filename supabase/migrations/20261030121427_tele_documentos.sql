-- Documentos médicos da teleconsulta do IMED (depende de 20261030092931_teleconsulta: aplicar DEPOIS dela).
--
-- Em linguagem simples:
-- - Na teleconsulta, o médico pode emitir: pedido de exames, receita, atestado, declaração de comparecimento,
--   encaminhamento, relatório médico e orientações. Só depois que o atendimento COMEÇOU (vídeo conectado, ligação,
--   mensagem ou "continuou por telefone": started_at). Consulta só aceita, ou que o paciente desistiu/expirou antes de
--   começar, não tem documento (Código de Ética Médica, art. 80: documento só com o ato médico que o justifique).
-- - Cada documento ganha um código curto e difícil de adivinhar (10 letras/números, sem 0, O, 1 e I). O QR do documento
--   leva a documento.html?c=CÓDIGO, que mostra só o necessário para conferir: tipo, data e hora, médico (nome, CRM/UF),
--   iniciais do paciente, se está válido ou cancelado e se há PDF assinado. Nunca o conteúdo clínico.
-- - Assinatura: o IMED monta o documento; o médico assina o PDF com o certificado ICP-Brasil dele num assinador externo
--   e envia o PDF assinado de volta (UM por documento: para corrigir, cancela e emite outro). O PDF precisa ter o código
--   do documento (o PDF gerado pelo IMED traz o código em texto simples) e um campo de assinatura PAdES (/ByteRange e
--   /SubFilter conhecido). O paciente baixa esse PDF no resumo da consulta. O IMED NÃO diz que a assinatura é válida;
--   quem confere é o validar.iti.gov.br. Sem PDF assinado, o documento é só um rascunho: não vale como documento oficial.
-- - Prontuário: nada é apagado nem trocado. Cancelar só marca (com motivo); o médico emite outro se precisar.
-- - Res. CFM 2.314/2022, art. 13, e Res. CFM 2.381/2024: o documento guarda uma cópia (snapshot) dos dados do médico
--   (nome, CRM/UF, RQE, endereço e contato profissional) e do paciente (nome, nascimento, CPF ou a declaração "não possui
--   CPF", endereço/local informado e a hora em que o médico registrou que conferiu a identidade) do momento da emissão.
--   Por isso, antes de emitir: endereço e contato profissionais do médico; CPF do paciente (ou "não possui CPF", que só
--   o médico registra); endereço/local do paciente; e a conferência de identidade (documento oficial com foto e CPF,
--   Res. CFM 2.381/2024, art. 3º, na redação da 2.418/2024), que precisa ser feita de novo se o CPF mudar.
-- - O médico manda em tele_doc_create os dados do paciente que está vendo (p_expect). Se o paciente mudou CPF ou
--   endereço na página dele nesse meio-tempo, a emissão é recusada ('dados_paciente_mudaram'): o documento sai sempre
--   com o que o médico revisou.
-- - Receita: hoje só a "simples" (sem controle especial e sem retenção), com o endereço residencial confirmado pelo médico
--   (Lei 5.991/1973, art. 35). A Anvisa está passando a receita eletrônica de controle especial (C1/C5), de antimicrobiano
--   e as demais de retenção para o SNCR (RDC 1.000/2025; desde 30/09/2026, com transição que a Anvisa prorrogou para
--   3/3/2027, ato ainda a confirmar no Diário Oficial). O IMED não é integrado ao SNCR: para evitar recusa na farmácia,
--   esses tipos ficam bloqueados. Notificação de receita (amarela/azul, listas A e B; também retinoides e talidomida) é
--   sempre bloqueada aqui. Ver private.tele_receita_liberada.
-- - Atestado: começa no dia da consulta ou até 7 dias depois (nunca antes). CID só a pedido e com autorização expressa
--   do paciente (Res. CFM 2.381/2024); a mesma regra vale para o CID no relatório.
-- - Declaração de comparecimento: só com a consulta encerrada; dia e horários vêm do registro (started_at e ended_at,
--   hora de São Paulo), nunca digitados.
-- - PDF assinado guardado no próprio banco (até 3 MB), baixado em base64 por função: paciente (id + código da consulta),
--   médico da consulta e quem lê prontuários na equipe do IMED (tele_record_readers; cada leitura fica em
--   tele_access_log, como em tele_doctor_status). Sem Storage e sem Edge Function.
-- - LGPD: pedido que nenhum médico atendeu tem CPF e endereço apagados junto com o resto (tele_forget).
-- - Termo (TCLE): termo-teleconsulta.html passou a explicar os documentos, o CPF e o endereço (versão 2026-10-30.2).
--   tele_request é recriada aqui aceitando a versão nova e, por um tempo, a anterior.
-- - Tabelas fechadas para anon/authenticated: todo acesso passa pelas funções abaixo (SECURITY DEFINER).
-- - Erros: mensagens curtas e estáveis; quando é um campo, o nome vai em "details" (e o número do item em "hint").
--
-- Funções (contrato para o site):
--   Paciente (anon/authenticated, com id + código secreto da consulta):
--     tele_patient_details(p_id, p_token, p_cpf, p_address) -> (patient_cpf, patient_address)   [nulo = não muda; '' = apaga]
--     tele_patient_documents(p_id, p_token) -> lista dos documentos da consulta
--     tele_patient_document_pdf(p_id, p_token, p_doc) -> base64 do PDF assinado (nulo se ainda não há)
--   Médico (logado):
--     tele_doctor_profile(p_prof_address, p_prof_contact) -> (prof_address, prof_contact)       [nulo = não muda; '' = apaga]
--     tele_doc_patient_data(p_id, p_cpf, p_address, p_no_cpf, p_identity)
--       -> (patient_cpf, patient_address, patient_no_cpf, identity_checked_at)   [nulo = não muda]
--     tele_doc_create(p_id, p_kind, p_payload, p_expect) -> (id, code)
--       p_expect = {cpf: 'só dígitos' | null, sem_cpf: true | false, endereco: 'como gravado'} (o que o médico vê)
--     tele_doc_cancel(p_doc, p_reason) -> 'cancelado'   (médico da consulta ou quem lê prontuários)
--     tele_doc_list(p_id) -> documentos da consulta (médico da consulta ou quem lê prontuários)
--     tele_doc_pending() -> documentos do médico sem PDF assinado (últimos 30 dias; expired = passou dos 7 dias)
--     tele_doc_upload(p_doc, p_pdf_base64) -> (signed_at, file_size, file_sha256)   (só o médico que emitiu, aprovado)
--     tele_doc_pdf(p_doc) -> base64 do PDF assinado (médico da consulta ou quem lê prontuários)
--   Público (anon): tele_doc_verify(p_code) -> dados mínimos para conferir
--   Equipe do IMED (quem lê prontuários): tele_admin_documents(p_days) -> lista para auditoria (sem conteúdo e sem PDF)
--
-- Formato de p_payload por tipo (o banco guarda só os campos conhecidos, já arrumados):
--   exames:         {itens?: [{code?, name, group?, search?, note?}] (1-60; sem "itens" usa os exames já pedidos na
--                   consulta), indicacao?: texto <= 1000 (sem "indicacao" usa a da consulta)}
--   receita:        {tipo: 'simples', itens: [{medicamento, concentracao, forma?, via, posologia, quantidade, duracao,
--                   observacao?}] (1-20), observacao?, endereco_residencial: true (o médico confirmou que o endereço do
--                   paciente é o residencial completo)}  -> guarda também vias (1)
--   atestado:       {dias: 1-90, inicio?: 'AAAA-MM-DD' (padrão: dia da consulta; do dia da consulta a 7 dias depois),
--                   cid?: CID-10 (ex.: 'J11.1'), cid_autorizado: true (obrigatório quando há CID), observacao?}
--                   -> guarda também fim (último dia de afastamento)
--   comparecimento: {observacao?} (data, hora_inicio, data_fim e hora_fim vêm do registro da consulta encerrada;
--                   mandar qualquer um deles é recusado)
--   encaminhamento: {especialidade, motivo (<= 2000), prioridade?: 'eletiva' | 'prioritaria' | 'urgente' (padrão
--                   'eletiva'), observacao?}
--   relatorio:      {texto (3-4000), cid?, cid_autorizado (como no atestado)}
--   orientacoes:    {texto (3-4000)}

/* ===================== Funções internas usadas pelas colunas e tabelas ===================== */

-- CPF com dígitos verificadores certos (11 dígitos, sem todos iguais).
create or replace function private.tele_cpf_ok(p text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when p is null or p !~ '^[0-9]{11}$' or p = repeat(left(p, 1), 11) then false
    else (select ((sum(substr(p, i, 1)::integer * (11 - i)) * 10) % 11) % 10 from generate_series(1, 9) as i)
           = substr(p, 10, 1)::integer
     and (select ((sum(substr(p, i, 1)::integer * (12 - i)) * 10) % 11) % 10 from generate_series(1, 10) as i)
           = substr(p, 11, 1)::integer
  end;
$$;

-- Texto de uma linha: espaços repetidos viram um; vazio vira nulo.
create or replace function private.tele_one_line(p text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), '');
$$;

-- Iniciais do nome (ex.: 'Maria da Silva Souza' -> 'M.S.S.'), sem as partículas de/da/do...
create or replace function private.tele_initials(p_name text)
returns text
language sql immutable
set search_path = ''
as $$
  select coalesce(string_agg(upper(left(x.w, 1)) || '.', '' order by x.n), '')
  from regexp_split_to_table(btrim(coalesce(p_name, '')), '\s+') with ordinality as x(w, n)
  where x.w <> ''
    and lower(x.w) not in ('da', 'das', 'de', 'des', 'di', 'do', 'dos', 'du', 'e', 'y', 'del', 'della', 'der', 'van', 'von');
$$;

-- Erro de dado inválido com o campo em "details" (e, se houver, o item em "hint").
create or replace function private.tele_bad(p_detail text, p_hint text default null)
returns void
language plpgsql volatile
set search_path = ''
as $$
begin
  if p_hint is null then
    raise exception 'dados_invalidos' using errcode = 'P0001', detail = p_detail;
  end if;
  raise exception 'dados_invalidos' using errcode = 'P0001', detail = p_detail, hint = p_hint;
end $$;

-- Texto de um campo do JSON (aceita texto ou número; ausente/nulo/vazio = nulo; outro tipo = erro com o campo).
create or replace function private.tele_jtext(p jsonb, p_key text, p_hint text default null)
returns text
language plpgsql stable
set search_path = ''
as $$
begin
  if p is null or jsonb_typeof(p -> p_key) is null or jsonb_typeof(p -> p_key) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p -> p_key) not in ('string', 'number') then
    perform private.tele_bad(p_key, p_hint);
  end if;
  return nullif(btrim(p ->> p_key), '');
end $$;

-- Tipos de receita que o IMED pode emitir hoje (ver o cabeçalho). Só mude numa migração nova, depois de confirmar a
-- regra da Anvisa e, se for o caso, integrar o IMED ao SNCR.
create or replace function private.tele_receita_liberada(p_tipo text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_tipo = 'simples';
$$;

/* ===================== Colunas novas ===================== */

-- Paciente: CPF ("quando houver"), a declaração "não possui CPF" (só o médico registra), o endereço ou local
-- (cidade/UF) informado para o atendimento e a hora em que o médico registrou que conferiu a identidade.
alter table public.teleconsultations add column if not exists patient_cpf text
  constraint teleconsultations_patient_cpf_fmt check (patient_cpf is null or patient_cpf ~ '^[0-9]{11}$');
alter table public.teleconsultations add column if not exists patient_address text
  constraint teleconsultations_patient_address_len check (patient_address is null or char_length(patient_address) between 3 and 200);
alter table public.teleconsultations add column if not exists patient_no_cpf boolean not null default false
  constraint teleconsultations_patient_no_cpf_ck check (not (patient_no_cpf and patient_cpf is not null));
alter table public.teleconsultations add column if not exists identity_checked_at timestamptz;
comment on column public.teleconsultations.patient_cpf is
  'CPF do paciente (só dígitos, opcional; dígitos verificadores conferidos nas funções). Vai impresso nos documentos.';
comment on column public.teleconsultations.patient_address is
  'Endereço ou local (cidade/UF) que o paciente informou para o atendimento (Res. CFM 2.314/2022, art. 13).';
comment on column public.teleconsultations.patient_no_cpf is
  'O médico registrou que o paciente não possui CPF (Res. CFM 2.381/2024: CPF "quando houver"). Sai como "não possui CPF".';
comment on column public.teleconsultations.identity_checked_at is
  'Quando o médico registrou que conferiu documento oficial com foto e o CPF do paciente (Res. CFM 2.381/2024, art. 3º). Volta a nulo se o CPF mudar.';

-- Médico: endereço e contato profissionais (vão impressos nos documentos).
alter table public.doctors add column if not exists prof_address text
  constraint doctors_prof_address_len check (prof_address is null or char_length(prof_address) between 5 and 200);
alter table public.doctors add column if not exists prof_contact text
  constraint doctors_prof_contact_fmt check (
    prof_contact is null
    or prof_contact ~ '^[1-9][1-9][0-9]{8,9}$'
    or (char_length(prof_contact) between 6 and 120 and prof_contact ~ '^[^@\s]+@[^@\s]+\.[^@\s.]+$'));
comment on column public.doctors.prof_address is 'Endereço profissional do médico, impresso nos documentos da teleconsulta.';
comment on column public.doctors.prof_contact is
  'Telefone (só dígitos, com DDD) ou e-mail profissional do médico, impresso nos documentos da teleconsulta.';

/* ===================== Tabelas ===================== */

create table if not exists public.tele_documents (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.teleconsultations (id) on delete restrict,
  doctor_id uuid not null references public.doctors (id) on delete restrict,
  kind text not null
    check (kind in ('exames', 'receita', 'atestado', 'comparecimento', 'encaminhamento', 'relatorio', 'orientacoes')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 65536),
  code text not null unique check (code ~ '^[2-9A-HJ-NP-Z]{10}$'),
  status text not null default 'emitido' check (status in ('emitido', 'cancelado')),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) between 3 and 300),
  cancelled_by text check (cancelled_by is null or char_length(cancelled_by) between 4 and 330),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  signed_at timestamptz,
  doctor_snapshot jsonb not null check (jsonb_typeof(doctor_snapshot) = 'object'),
  patient_snapshot jsonb not null check (jsonb_typeof(patient_snapshot) = 'object'),
  constraint tele_documents_cancel_ck check (
    (status = 'emitido' and cancelled_at is null and cancel_reason is null and cancelled_by is null)
    or (status = 'cancelado' and cancelled_at is not null and cancel_reason is not null and cancelled_by is not null))
);
create index if not exists tele_documents_consulta_idx on public.tele_documents (consultation_id, created_at);
create index if not exists tele_documents_criado_idx on public.tele_documents (created_at);
comment on table public.tele_documents is
  'Documentos médicos da teleconsulta (prontuário: nunca apagados; cancelar só marca). Acesso só pelas funções tele_doc_*/tele_patient_*.';
comment on column public.tele_documents.code is 'Código para conferir (10 caracteres de 23456789ABCDEFGHJKLMNPQRSTUVWXYZ), usado no QR.';
comment on column public.tele_documents.payload is 'Conteúdo do documento, conferido e arrumado por tipo (ver o cabeçalho da migração).';
comment on column public.tele_documents.cancelled_by is '''medico'' (quem emitiu) ou ''imed:<e-mail>'' (equipe do IMED).';
comment on column public.tele_documents.signed_at is 'Quando o médico enviou o PDF assinado (o IMED não confere a validade da assinatura).';
comment on column public.tele_documents.doctor_snapshot is 'Médico na emissão: full_name, crm, crm_uf, rqe, specialty (só com RQE), prof_address, prof_contact.';
comment on column public.tele_documents.patient_snapshot is
  'Paciente na emissão: name, birthdate, age, cpf, sem_cpf, address, for_other, requester_name, relationship, identidade_conferida_em e inicio_atendimento.';

-- PDF assinado pelo médico: UM por documento, que nunca é trocado nem apagado (para corrigir: cancelar e emitir outro).
create table if not exists public.tele_document_files (
  document_id uuid primary key references public.tele_documents (id) on delete restrict,
  pdf bytea not null,
  size integer not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_at timestamptz not null default now(),
  constraint tele_document_files_pdf_ck check (
    size = octet_length(pdf) and size between 16 and 3145728
    and substring(pdf from 1 for 5) = '\x255044462d'::bytea)  -- começa com '%PDF-'
);
-- PDF já vem comprimido: guardar sem tentar comprimir de novo.
alter table public.tele_document_files alter column pdf set storage external;
comment on table public.tele_document_files is
  'PDF assinado (ICP-Brasil, conferido fora do IMED) de cada documento da teleconsulta. Até 3 MB. Nunca apagado.';

-- Ninguém lê ou escreve direto pela API: só pelas funções.
alter table public.tele_documents enable row level security;
alter table public.tele_document_files enable row level security;
revoke all on public.tele_documents, public.tele_document_files from anon, authenticated;

/* ===================== Prontuário: nada é apagado ===================== */
-- Segunda tranca, além das funções: apagar (DELETE/TRUNCATE) dá erro, um documento só muda de situação
-- (emitido -> cancelado, uma vez) e ganha a hora da assinatura uma vez só, e o PDF assinado nunca muda.
-- Vale até para o SQL do painel do Supabase.
create or replace function private.tele_doc_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'prontuario_nao_apaga' using errcode = 'P0001';
  end if;
  if (new.id, new.consultation_id, new.doctor_id, new.kind, new.payload, new.code, new.created_at,
      new.doctor_snapshot, new.patient_snapshot)
     is distinct from
     (old.id, old.consultation_id, old.doctor_id, old.kind, old.payload, old.code, old.created_at,
      old.doctor_snapshot, old.patient_snapshot)
     or (old.status = 'cancelado'
         and (new.status, new.cancel_reason, new.cancelled_at, new.cancelled_by)
             is distinct from (old.status, old.cancel_reason, old.cancelled_at, old.cancelled_by))
     or (old.signed_at is not null and new.signed_at is distinct from old.signed_at) then
    raise exception 'prontuario_imutavel' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function private.tele_doc_file_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'prontuario_imutavel' using errcode = 'P0001';
  end if;
  raise exception 'prontuario_nao_apaga' using errcode = 'P0001';
end $$;

create or replace trigger tele_documents_guard before update or delete on public.tele_documents
  for each row execute function private.tele_doc_guard();
create or replace trigger tele_documents_sem_truncate before truncate on public.tele_documents
  for each statement execute function private.tele_doc_guard();
create or replace trigger tele_document_files_guard before update or delete on public.tele_document_files
  for each row execute function private.tele_doc_file_guard();
create or replace trigger tele_document_files_sem_truncate before truncate on public.tele_document_files
  for each statement execute function private.tele_doc_file_guard();

/* ===================== Funções internas ===================== */

-- Código novo para conferir: 10 sorteios de 32 símbolos (2^50 combinações). 256 é múltiplo de 32: sem viés.
create or replace function private.tele_doc_code()
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_alpha constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_code text;
begin
  for v_try in 1..8 loop
    v_bytes := extensions.gen_random_bytes(10);
    select string_agg(substr(v_alpha, (get_byte(v_bytes, g.n) % 32) + 1, 1), '' order by g.n)
      into v_code
    from generate_series(0, 9) as g(n);
    if not exists (select 1 from public.tele_documents d where d.code = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'erro_codigo' using errcode = 'P0001';
end $$;

-- Consulta aberta para documentos (mesma regra de tele_set_exams): aceita/em andamento, ou encerrada há até 24 h.
create or replace function private.tele_doc_check_open(t public.teleconsultations)
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if t.status = 'ended' then
    if t.ended_at < now() - interval '24 hours' then
      raise exception 'prazo_encerrado' using errcode = 'P0001';
    end if;
  elsif private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at)
          not in ('accepted', 'in_call', 'ended') then
    raise exception 'estado_invalido' using errcode = 'P0001';
  end if;
end $$;

-- Quem vê os documentos de uma consulta (mesmo modelo de tele_doctor_status): o médico dela ('own'; com cadastro não
-- aprovado, só no prazo de fechar o registro: 'limited') ou quem lê prontuários ('reader', com registro em
-- tele_access_log). Ninguém mais: nulo.
create or replace function private.tele_doc_access(t public.teleconsultations, p_fn text)
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_doc public.doctors;
begin
  if v_uid is null or t.id is null then return null; end if;
  select * into v_doc from public.doctors d where d.user_id = v_uid;
  if found and t.doctor_id = v_doc.id then
    if v_doc.status = 'approved' then return 'own'; end if;
    if private.tele_in_window(t) then return 'limited'; end if;
  end if;
  if private.tele_is_reader() then
    insert into public.tele_access_log (consultation_id, user_id, email, fn)
    values (t.id, v_uid, lower(coalesce(auth.jwt() ->> 'email', '')), p_fn);
    return 'reader';
  end if;
  return null;
end $$;

-- LGPD: quando tele_forget apaga os dados de um pedido que nenhum médico atendeu, apaga também CPF e endereço.
create or replace function private.tele_forget_doc_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.anonymized_at is not null and old.anonymized_at is null then
    new.patient_cpf := null;
    new.patient_address := null;
    new.patient_no_cpf := false;
    new.identity_checked_at := null;
  end if;
  return new;
end $$;
create or replace trigger teleconsultations_apaga_cpf_endereco before update of anonymized_at on public.teleconsultations
  for each row execute function private.tele_forget_doc_fields();

-- Grava CPF, endereço/local, "não possui CPF" e a conferência de identidade (nulo = não muda; '' apaga CPF ou endereço).
-- Confere antes de gravar. Gravar um CPF desfaz o "não possui CPF". Se o CPF (ou o "não possui CPF") mudar, a
-- conferência de identidade volta a nulo, a não ser que a mesma chamada a confirme (p_identity = true, só o médico).
create or replace function private.tele_set_patient_details(p_id uuid, p_cpf text, p_address text,
                                                             p_no_cpf boolean default null, p_identity boolean default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_row public.teleconsultations;
  v_cpf text;
  v_addr text;
  v_no boolean;
  v_changed boolean;
  v_ident timestamptz;
begin
  select * into v_row from public.teleconsultations t where t.id = p_id;
  if not found then return; end if;
  v_cpf := v_row.patient_cpf;
  v_addr := v_row.patient_address;
  if p_cpf is not null then
    v_cpf := btrim(p_cpf);
    if v_cpf = '' then
      v_cpf := null;
    elsif v_cpf !~ '^[0-9.\-\s]+$' then
      perform private.tele_bad('cpf');
    else
      v_cpf := regexp_replace(v_cpf, '\D', '', 'g');
      if not private.tele_cpf_ok(v_cpf) then perform private.tele_bad('cpf'); end if;
    end if;
  end if;
  if p_address is not null then
    v_addr := private.tele_one_line(p_address);
    if v_addr is not null and char_length(v_addr) not between 3 and 200 then perform private.tele_bad('endereco'); end if;
  end if;
  v_no := case when p_no_cpf is not null then p_no_cpf when v_cpf is not null then false else v_row.patient_no_cpf end;
  if v_no and v_cpf is not null then perform private.tele_bad('cpf'); end if;
  v_changed := (v_cpf, v_no) is distinct from (v_row.patient_cpf, v_row.patient_no_cpf);
  v_ident := case when p_identity is false then null
                  when p_identity is true then case when v_changed then now() else coalesce(v_row.identity_checked_at, now()) end
                  when v_changed then null
                  else v_row.identity_checked_at end;
  if (v_cpf, v_addr, v_no, v_ident) is distinct from
     (v_row.patient_cpf, v_row.patient_address, v_row.patient_no_cpf, v_row.identity_checked_at) then
    update public.teleconsultations t
    set patient_cpf = v_cpf, patient_address = v_addr, patient_no_cpf = v_no, identity_checked_at = v_ident
    where t.id = p_id;
  end if;
end $$;

-- CID-10 do atestado ou do relatório: só a pedido e com autorização expressa do paciente (Res. CFM 2.381/2024).
-- Devolve o CID arrumado ('j 111' -> 'J11.1') ou nulo; sem a autorização: 'cid_sem_autorizacao'.
create or replace function private.tele_doc_cid(p jsonb)
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v_cid text := nullif(upper(translate(coalesce(private.tele_jtext(p, 'cid'), ''), ' ', '')), '');
begin
  if v_cid is null then return null; end if;
  if (p -> 'cid_autorizado') is distinct from 'true'::jsonb then
    raise exception 'cid_sem_autorizacao' using errcode = 'P0001';
  end if;
  if v_cid ~ '^[A-Z][0-9]{3}$' then v_cid := left(v_cid, 3) || '.' || right(v_cid, 1); end if;
  if v_cid !~ '^[A-Z][0-9]{2}(\.[0-9])?$' then perform private.tele_bad('cid'); end if;
  return v_cid;
end $$;

-- Confere e arruma o conteúdo de cada tipo de documento. Devolve só os campos conhecidos.
create or replace function private.tele_doc_payload(p_kind text, p_payload jsonb, p_consult public.teleconsultations)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  p jsonb := coalesce(p_payload, '{}'::jsonb);
  -- Dia da consulta = dia do início do atendimento (tele_doc_create só chega aqui com started_at preenchido).
  v_day date := (coalesce(p_consult.started_at, p_consult.accepted_at, p_consult.created_at) at time zone 'America/Sao_Paulo')::date;
  v_items jsonb;
  v_list jsonb := '[]'::jsonb;
  v_e jsonb;
  v_n bigint;
  v_hint text;
  v_tipo text;
  v_txt text;
  v_obs text;
  v_med text; v_conc text; v_forma text; v_via text; v_pos text; v_qtd text; v_dur text;
  v_dias integer;
  v_ini date;
  v_cid text;
begin
  if jsonb_typeof(p) <> 'object' then perform private.tele_bad('payload'); end if;

  /* ---------- pedido de exames ---------- */
  if p_kind = 'exames' then
    v_items := case when jsonb_typeof(p -> 'itens') is null or jsonb_typeof(p -> 'itens') = 'null'
                    then p_consult.exams else p -> 'itens' end;
    if (case when jsonb_typeof(v_items) = 'array' then jsonb_array_length(v_items) not between 1 and 60 else true end) then
      perform private.tele_bad('itens');
    end if;
    -- Mesmas regras de tele_set_exams.
    if exists (
      select 1 from jsonb_array_elements(v_items) as x(e)
      where not coalesce(
        jsonb_typeof(x.e) = 'object'
        and jsonb_typeof(x.e -> 'name') = 'string'
        and char_length(btrim(x.e ->> 'name')) between 1 and 120
        and char_length(coalesce(x.e ->> 'note', '')) <= 200
        and char_length(coalesce(x.e ->> 'code', '')) <= 60
        and char_length(coalesce(x.e ->> 'group', '')) <= 60
        and char_length(coalesce(x.e ->> 'search', '')) <= 20, false)
    ) then
      perform private.tele_bad('itens');
    end if;
    if p ? 'indicacao' then
      v_txt := private.tele_jtext(p, 'indicacao');
    else
      v_txt := nullif(btrim(coalesce(p_consult.indication, '')), '');
    end if;
    if char_length(v_txt) > 1000 then perform private.tele_bad('indicacao'); end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', nullif(btrim(x.e ->> 'code'), ''),
             'name', btrim(x.e ->> 'name'),
             'group', nullif(btrim(x.e ->> 'group'), ''),
             'search', case when x.e ->> 'search' in ('rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab')
                            then x.e ->> 'search' end,
             'note', nullif(btrim(x.e ->> 'note'), '')
           ) order by x.n), '[]'::jsonb)
      into v_list
    from jsonb_array_elements(v_items) with ordinality as x(e, n);
    return jsonb_build_object('itens', v_list, 'indicacao', v_txt);
  end if;

  /* ---------- receita ---------- */
  if p_kind = 'receita' then
    v_tipo := lower(regexp_replace(coalesce(private.tele_jtext(p, 'tipo'), ''), '[\s\-]+', '_', 'g'));
    v_tipo := translate(v_tipo, 'áàâãéêíóôõúç', 'aaaaeeiooouc');
    v_tipo := case
      when v_tipo in ('antibiotico', 'receita_antimicrobiano', 'receita_de_antimicrobiano') then 'antimicrobiano'
      when v_tipo in ('c1', 'especial', 'receita_especial', 'controle_especial', 'receita_controle_especial', 'receita_de_controle_especial')
        then 'controle_especial_c1'
      else v_tipo end;
    if v_tipo = '' then perform private.tele_bad('tipo'); end if;
    -- Notificação de receita (listas A e B: amarela/azul; também retinoides e talidomida): nunca pelo IMED.
    if v_tipo ~ '^(receita_|notificacao_|notificacao_de_receita_|lista_)?(a|a1|a2|a3|b|b1|b2|amarela|azul|retinoide|retinoides|talidomida|c2|c3)$'
       or v_tipo in ('notificacao_especial', 'notificacao_de_receita_especial') then
      raise exception 'receita_bloqueada' using errcode = 'P0001', detail = 'notificacao';
    end if;
    -- Controle especial e retenção: só por plataforma integrada ao SNCR (ver private.tele_receita_liberada).
    if v_tipo in ('antimicrobiano', 'controle_especial_c1', 'controle_especial_c5', 'c5', 'retencao')
       and not private.tele_receita_liberada(v_tipo) then
      raise exception 'receita_bloqueada' using errcode = 'P0001', detail = 'sncr';
    end if;
    if v_tipo not in ('simples', 'antimicrobiano', 'controle_especial_c1') then perform private.tele_bad('tipo'); end if;

    v_items := p -> 'itens';
    if (case when jsonb_typeof(v_items) = 'array' then jsonb_array_length(v_items) not between 1 and 20 else true end) then
      perform private.tele_bad('itens');
    end if;
    for v_e, v_n in select x.e, x.n from jsonb_array_elements(v_items) with ordinality as x(e, n) loop
      v_hint := 'item ' || v_n;
      if jsonb_typeof(v_e) <> 'object' then perform private.tele_bad('itens', v_hint); end if;
      v_med := private.tele_one_line(private.tele_jtext(v_e, 'medicamento', v_hint));
      v_conc := private.tele_one_line(private.tele_jtext(v_e, 'concentracao', v_hint));
      v_forma := private.tele_one_line(private.tele_jtext(v_e, 'forma', v_hint));
      v_via := private.tele_one_line(private.tele_jtext(v_e, 'via', v_hint));
      v_pos := private.tele_jtext(v_e, 'posologia', v_hint);
      v_qtd := private.tele_one_line(private.tele_jtext(v_e, 'quantidade', v_hint));
      v_dur := private.tele_one_line(private.tele_jtext(v_e, 'duracao', v_hint));
      v_obs := private.tele_jtext(v_e, 'observacao', v_hint);
      if v_med is null or char_length(v_med) not between 2 and 200 then perform private.tele_bad('medicamento', v_hint); end if;
      if v_conc is null or char_length(v_conc) > 60 then perform private.tele_bad('concentracao', v_hint); end if;
      if char_length(v_forma) > 60 then perform private.tele_bad('forma', v_hint); end if;
      if v_via is null or char_length(v_via) > 40 then perform private.tele_bad('via', v_hint); end if;
      if v_pos is null or char_length(v_pos) not between 3 and 500 then perform private.tele_bad('posologia', v_hint); end if;
      if v_qtd is null or char_length(v_qtd) > 100 then perform private.tele_bad('quantidade', v_hint); end if;
      if v_dur is null or char_length(v_dur) > 60 then perform private.tele_bad('duracao', v_hint); end if;
      if char_length(v_obs) > 300 then perform private.tele_bad('observacao', v_hint); end if;
      v_list := v_list || jsonb_build_array(jsonb_build_object(
        'medicamento', v_med, 'concentracao', v_conc, 'forma', v_forma, 'via', v_via,
        'posologia', v_pos, 'quantidade', v_qtd, 'duracao', v_dur, 'observacao', v_obs));
    end loop;
    v_obs := private.tele_jtext(p, 'observacao');
    if char_length(v_obs) > 500 then perform private.tele_bad('observacao'); end if;
    -- Lei 5.991/1973, art. 35, II: endereço residencial do paciente. O médico confirma que é o residencial completo.
    if (p -> 'endereco_residencial') is distinct from 'true'::jsonb then perform private.tele_bad('endereco_residencial'); end if;
    return jsonb_build_object('tipo', v_tipo, 'vias', case when v_tipo = 'simples' then 1 else 2 end,
                              'itens', v_list, 'observacao', v_obs, 'endereco_residencial', true);
  end if;

  /* ---------- atestado ---------- */
  if p_kind = 'atestado' then
    v_txt := private.tele_jtext(p, 'dias');
    if (case when v_txt ~ '^[0-9]{1,3}$' then v_txt::integer not between 1 and 90 else true end) then
      perform private.tele_bad('dias');
    end if;
    v_dias := v_txt::integer;
    v_txt := private.tele_jtext(p, 'inicio');
    if v_txt is null then
      v_ini := v_day;
    else
      if v_txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then perform private.tele_bad('inicio'); end if;
      begin
        v_ini := v_txt::date;
      exception when others then
        perform private.tele_bad('inicio');
      end;
    end if;
    -- Nunca antes do dia da consulta (Código de Ética Médica, art. 80); até 7 dias depois.
    if v_ini not between v_day and v_day + 7 then perform private.tele_bad('inicio'); end if;
    v_cid := private.tele_doc_cid(p);
    v_obs := private.tele_jtext(p, 'observacao');
    if char_length(v_obs) > 500 then perform private.tele_bad('observacao'); end if;
    return jsonb_build_object('dias', v_dias, 'inicio', v_ini, 'fim', v_ini + (v_dias - 1),
                              'cid', v_cid, 'cid_autorizado', v_cid is not null, 'observacao', v_obs);
  end if;

  /* ---------- declaração de comparecimento ---------- */
  -- Só com a consulta encerrada. Dia e horários vêm do registro (início do atendimento e encerramento, hora de São
  -- Paulo), nunca digitados: mandar data ou horário é recusado. Consulta que passou da meia-noite: data_fim é o dia
  -- seguinte.
  if p_kind = 'comparecimento' then
    v_txt := case when p ? 'data' then 'data' when p ? 'hora_inicio' then 'hora_inicio'
                  when p ? 'data_fim' then 'data_fim' when p ? 'hora_fim' then 'hora_fim' end;
    if v_txt is not null then perform private.tele_bad(v_txt); end if;
    if p_consult.status <> 'ended' or p_consult.ended_at is null or p_consult.started_at is null then
      raise exception 'consulta_nao_encerrada' using errcode = 'P0001';
    end if;
    v_obs := private.tele_jtext(p, 'observacao');
    if char_length(v_obs) > 300 then perform private.tele_bad('observacao'); end if;
    return jsonb_build_object(
      'data', (p_consult.started_at at time zone 'America/Sao_Paulo')::date,
      'hora_inicio', to_char(p_consult.started_at at time zone 'America/Sao_Paulo', 'HH24:MI'),
      'data_fim', (p_consult.ended_at at time zone 'America/Sao_Paulo')::date,
      'hora_fim', to_char(p_consult.ended_at at time zone 'America/Sao_Paulo', 'HH24:MI'),
      'observacao', v_obs);
  end if;

  /* ---------- encaminhamento ---------- */
  if p_kind = 'encaminhamento' then
    v_txt := private.tele_one_line(private.tele_jtext(p, 'especialidade'));
    if v_txt is null or char_length(v_txt) not between 2 and 80 then perform private.tele_bad('especialidade'); end if;
    v_med := private.tele_jtext(p, 'motivo');
    if v_med is null or char_length(v_med) not between 3 and 2000 then perform private.tele_bad('motivo'); end if;
    v_tipo := coalesce(lower(private.tele_one_line(private.tele_jtext(p, 'prioridade'))), 'eletiva');
    v_tipo := translate(v_tipo, 'áàâãéêíóôõúç', 'aaaaeeiooouc');
    if v_tipo not in ('eletiva', 'prioritaria', 'urgente') then perform private.tele_bad('prioridade'); end if;
    v_obs := private.tele_jtext(p, 'observacao');
    if char_length(v_obs) > 500 then perform private.tele_bad('observacao'); end if;
    return jsonb_build_object('especialidade', v_txt, 'motivo', v_med, 'prioridade', v_tipo, 'observacao', v_obs);
  end if;

  /* ---------- relatório médico e orientações ---------- */
  if p_kind in ('relatorio', 'orientacoes') then
    v_txt := private.tele_jtext(p, 'texto');
    if v_txt is null or char_length(v_txt) not between 3 and 4000 then perform private.tele_bad('texto'); end if;
    if p_kind = 'orientacoes' then
      return jsonb_build_object('texto', v_txt);
    end if;
    -- Relatório: CID (diagnóstico) só a pedido e com autorização expressa do paciente, como no atestado.
    v_cid := private.tele_doc_cid(p);
    return jsonb_build_object('texto', v_txt, 'cid', v_cid, 'cid_autorizado', v_cid is not null);
  end if;

  perform private.tele_bad('documento');
  return null;
end $$;

revoke all on function private.tele_cpf_ok(text) from public, anon, authenticated;
revoke all on function private.tele_one_line(text) from public, anon, authenticated;
revoke all on function private.tele_initials(text) from public, anon, authenticated;
revoke all on function private.tele_bad(text, text) from public, anon, authenticated;
revoke all on function private.tele_jtext(jsonb, text, text) from public, anon, authenticated;
revoke all on function private.tele_receita_liberada(text) from public, anon, authenticated;
revoke all on function private.tele_doc_guard() from public, anon, authenticated;
revoke all on function private.tele_doc_file_guard() from public, anon, authenticated;
revoke all on function private.tele_doc_code() from public, anon, authenticated;
revoke all on function private.tele_doc_check_open(public.teleconsultations) from public, anon, authenticated;
revoke all on function private.tele_doc_access(public.teleconsultations, text) from public, anon, authenticated;
revoke all on function private.tele_forget_doc_fields() from public, anon, authenticated;
revoke all on function private.tele_set_patient_details(uuid, text, text, boolean, boolean) from public, anon, authenticated;
revoke all on function private.tele_doc_cid(jsonb) from public, anon, authenticated;
revoke all on function private.tele_doc_payload(text, jsonb, public.teleconsultations) from public, anon, authenticated;

/* ===================== Paciente (sem conta: id + código secreto da consulta) ===================== */

-- Completar CPF e endereço/local do atendimento. Sem p_cpf e p_address: só mostra o que está gravado.
-- Para gravar: consulta na fila, aceita ou em andamento, ou encerrada há até 24 h. Trocar o CPF desfaz a conferência
-- de identidade que o médico tinha registrado (ele confere de novo), e o médico vê a mudança antes de emitir.
create or replace function public.tele_patient_details(p_id uuid, p_token text, p_cpf text default null, p_address text default null)
returns table (patient_cpf text, patient_address text)
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
  if p_cpf is not null or p_address is not null then
    if v_row.status = 'ended' then
      if v_row.ended_at < now() - interval '24 hours' then raise exception 'prazo_encerrado' using errcode = 'P0001'; end if;
    elsif private.tele_effective_status(v_row.status, v_row.created_at, v_row.accepted_at, v_row.started_at)
            not in ('waiting', 'accepted', 'in_call') then
      raise exception 'estado_invalido' using errcode = 'P0001';
    end if;
    perform private.tele_set_patient_details(v_row.id, p_cpf, p_address);
  end if;
  return query select t.patient_cpf, t.patient_address from public.teleconsultations t where t.id = v_row.id;
end $$;

-- Documentos da consulta para o paciente (código errado = nenhuma linha). Documento cancelado vem sem o conteúdo
-- (para ninguém usar por engano), com o motivo do cancelamento.
create or replace function public.tele_patient_documents(p_id uuid, p_token text)
returns table (
  id uuid, kind text, payload jsonb, code text, status text, cancel_reason text, created_at timestamptz,
  cancelled_at timestamptz, signed boolean, signed_at timestamptz, doctor_snapshot jsonb, patient_snapshot jsonb
)
language sql stable security definer
set search_path = ''
as $$
  select d.id, d.kind, case when d.status = 'emitido' then d.payload end, d.code, d.status, d.cancel_reason,
         d.created_at, d.cancelled_at, d.signed_at is not null, d.signed_at, d.doctor_snapshot, d.patient_snapshot
  from public.tele_documents d
  join public.teleconsultations t on t.id = d.consultation_id
  where t.id = p_id
    and t.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  order by d.created_at, d.id
  limit 100;
$$;

-- PDF assinado (base64, sem quebras de linha) de um documento da consulta. Ainda sem PDF: nulo.
create or replace function public.tele_patient_document_pdf(p_id uuid, p_token text, p_doc uuid)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_status text;
  v_b64 text;
begin
  select d.status into v_status
  from public.tele_documents d
  join public.teleconsultations t on t.id = d.consultation_id
  where d.id = p_doc and t.id = p_id
    and t.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  if v_status = 'cancelado' then raise exception 'documento_cancelado' using errcode = 'P0001'; end if;
  select translate(encode(f.pdf, 'base64'), E'\n', '') into v_b64
  from public.tele_document_files f where f.document_id = p_doc;
  return v_b64;
end $$;

/* ===================== Médico (logado) ===================== */

-- Endereço e telefone/e-mail profissionais (vão nos documentos). Qualquer médico cadastrado, mesmo em análise.
-- Sem parâmetros: só mostra o que está gravado. Não volta o cadastro para conferência.
create or replace function public.tele_doctor_profile(p_prof_address text default null, p_prof_contact text default null)
returns table (prof_address text, prof_contact text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_addr text;
  v_contact text;
  v_digits text;
begin
  v_doc := private.tele_me(false);
  v_addr := v_doc.prof_address;
  v_contact := v_doc.prof_contact;
  if p_prof_address is not null then
    v_addr := private.tele_one_line(p_prof_address);
    if v_addr is not null and char_length(v_addr) not between 5 and 200 then perform private.tele_bad('endereco'); end if;
  end if;
  if p_prof_contact is not null then
    v_contact := private.tele_one_line(p_prof_contact);
    if v_contact is not null then
      if position('@' in v_contact) > 0 then
        v_contact := lower(v_contact);
        if char_length(v_contact) not between 6 and 120 or v_contact !~ '^[^@\s]+@[^@\s]+\.[^@\s.]+$' then
          perform private.tele_bad('contato');
        end if;
      else
        if v_contact !~ '^[0-9()+.\- ]+$' then perform private.tele_bad('contato'); end if;
        v_digits := regexp_replace(v_contact, '\D', '', 'g');
        if char_length(v_digits) in (12, 13) and left(v_digits, 2) = '55' then v_digits := substr(v_digits, 3); end if;
        if v_digits !~ '^[1-9][1-9][0-9]{8,9}$' then perform private.tele_bad('contato'); end if;
        v_contact := v_digits;
      end if;
    end if;
  end if;
  if (v_addr, v_contact) is distinct from (v_doc.prof_address, v_doc.prof_contact) then
    update public.doctors d set prof_address = v_addr, prof_contact = v_contact, updated_at = now() where d.id = v_doc.id;
  end if;
  return query select v_addr, v_contact;
end $$;

-- O médico completa CPF e endereço/local do paciente (perguntando na chamada), registra "não possui CPF" e a
-- conferência de identidade (documento oficial com foto e CPF, Res. CFM 2.381/2024, art. 3º). Sem parâmetros: só mostra.
-- p_no_cpf = true apaga o CPF (mande p_cpf = ''); p_identity = true só depois que o atendimento começou.
create or replace function public.tele_doc_patient_data(p_id uuid, p_cpf text default null, p_address text default null,
                                                        p_no_cpf boolean default null, p_identity boolean default null)
returns table (patient_cpf text, patient_address text, patient_no_cpf boolean, identity_checked_at timestamptz)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_row public.teleconsultations;
begin
  v_doc := private.tele_me(true);
  select * into v_row from public.teleconsultations t where t.id = p_id and t.doctor_id = v_doc.id for update;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  if p_cpf is not null or p_address is not null or p_no_cpf is not null or p_identity is not null then
    perform private.tele_doc_check_open(v_row);
    if p_identity is true and v_row.started_at is null then
      raise exception 'atendimento_nao_iniciado' using errcode = 'P0001';
    end if;
    perform private.tele_set_patient_details(v_row.id, p_cpf, p_address, p_no_cpf, p_identity);
  end if;
  return query select t.patient_cpf, t.patient_address, t.patient_no_cpf, t.identity_checked_at
               from public.teleconsultations t where t.id = v_row.id;
end $$;

-- Emitir um documento. Só o médico da consulta (aprovado), com a consulta aceita/em andamento ou encerrada há até 24 h
-- E com o atendimento começado (started_at), com endereço e contato profissionais preenchidos, com o CPF (ou "não
-- possui CPF") e o endereço/local do paciente e com a conferência de identidade registrada. p_expect traz os dados do
-- paciente que o médico está vendo: se o banco tiver outros (o paciente mudou na página dele), recusa.
-- O mesmo documento enviado de novo em até 2 minutos (clique duplo, internet que caiu) devolve o que já foi criado.
create or replace function public.tele_doc_create(p_id uuid, p_kind text, p_payload jsonb default null, p_expect jsonb default null)
returns table (id uuid, code text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_row public.teleconsultations;
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_payload jsonb;
  v_dsnap jsonb;
  v_psnap jsonb;
  v_id uuid;
  v_code text;
begin
  v_doc := private.tele_me(true);
  if v_kind not in ('exames', 'receita', 'atestado', 'comparecimento', 'encaminhamento', 'relatorio', 'orientacoes') then
    perform private.tele_bad('documento');
  end if;
  select * into v_row from public.teleconsultations t where t.id = p_id and t.doctor_id = v_doc.id for update;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  perform private.tele_doc_check_open(v_row);
  -- Sem atendimento, sem documento (aceita e ainda não começou, ou desistiu/expirou antes de começar).
  if v_row.started_at is null then raise exception 'atendimento_nao_iniciado' using errcode = 'P0001'; end if;
  if v_doc.prof_address is null then raise exception 'perfil_incompleto' using errcode = 'P0001', detail = 'endereco'; end if;
  if v_doc.prof_contact is null then raise exception 'perfil_incompleto' using errcode = 'P0001', detail = 'contato'; end if;
  -- O documento sai com os dados que o médico revisou: se o paciente mudou CPF ou endereço, o médico vê antes.
  if p_expect is null or jsonb_typeof(p_expect) <> 'object' then perform private.tele_bad('conferencia'); end if;
  if (nullif(p_expect ->> 'cpf', ''), coalesce((p_expect -> 'sem_cpf') = 'true'::jsonb, false), nullif(p_expect ->> 'endereco', ''))
     is distinct from (v_row.patient_cpf, v_row.patient_no_cpf, v_row.patient_address) then
    raise exception 'dados_paciente_mudaram' using errcode = 'P0001';
  end if;
  if v_row.patient_name is null then raise exception 'paciente_incompleto' using errcode = 'P0001', detail = 'nome'; end if;
  if v_row.patient_address is null then raise exception 'paciente_incompleto' using errcode = 'P0001', detail = 'endereco'; end if;
  if v_row.patient_cpf is null and not v_row.patient_no_cpf then
    raise exception 'paciente_incompleto' using errcode = 'P0001', detail = 'cpf';
  end if;
  if v_row.identity_checked_at is null then raise exception 'sem_conferencia_identidade' using errcode = 'P0001'; end if;

  v_payload := private.tele_doc_payload(v_kind, p_payload, v_row);
  v_dsnap := jsonb_build_object(
    'full_name', v_doc.full_name, 'crm', v_doc.crm, 'crm_uf', v_doc.crm_uf::text, 'rqe', v_doc.rqe,
    'specialty', case when v_doc.rqe is not null then v_doc.specialty end,
    'prof_address', v_doc.prof_address, 'prof_contact', v_doc.prof_contact);
  v_psnap := jsonb_build_object(
    'name', v_row.patient_name, 'birthdate', v_row.patient_birthdate, 'age', private.tele_age(v_row.patient_birthdate),
    'cpf', v_row.patient_cpf, 'sem_cpf', v_row.patient_no_cpf, 'address', v_row.patient_address, 'for_other', v_row.for_other,
    'requester_name', v_row.requester_name, 'relationship', v_row.relationship,
    'identidade_conferida_em', v_row.identity_checked_at, 'inicio_atendimento', v_row.started_at);

  select d.id, d.code into v_id, v_code
  from public.tele_documents d
  where d.consultation_id = v_row.id and d.kind = v_kind and d.status = 'emitido'
    and d.payload = v_payload and d.doctor_snapshot = v_dsnap and d.patient_snapshot = v_psnap
    and d.created_at > now() - interval '2 minutes'
  order by d.created_at desc
  limit 1;
  if found then
    return query select v_id, v_code;
    return;
  end if;
  if (select count(*) from public.tele_documents d where d.consultation_id = v_row.id) >= 30 then
    raise exception 'limite_documentos' using errcode = 'P0001';
  end if;

  v_code := private.tele_doc_code();
  insert into public.tele_documents as d (consultation_id, doctor_id, kind, payload, code, doctor_snapshot, patient_snapshot)
  values (v_row.id, v_doc.id, v_kind, v_payload, v_code, v_dsnap, v_psnap)
  returning d.id into v_id;
  return query select v_id, v_code;
end $$;

-- Cancelar (com motivo). O médico da consulta (com cadastro não aprovado, só no prazo de fechar o registro) ou quem lê
-- prontuários na equipe do IMED (tele_record_readers). Nada é apagado. Cancelar de novo não muda nada.
create or replace function public.tele_doc_cancel(p_doc uuid, p_reason text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_d public.tele_documents;
  v_row public.teleconsultations;
  v_access text;
  v_reason text := private.tele_one_line(p_reason);
begin
  if auth.uid() is null then raise exception 'sem_login' using errcode = 'P0001'; end if;
  select * into v_d from public.tele_documents d where d.id = p_doc for update;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  select * into v_row from public.teleconsultations t where t.id = v_d.consultation_id;
  v_access := private.tele_doc_access(v_row, 'tele_doc_cancel');
  if v_access is null then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  if v_d.status = 'cancelado' then return 'cancelado'; end if;
  if v_reason is null or char_length(v_reason) not between 3 and 300 then perform private.tele_bad('motivo'); end if;
  update public.tele_documents d
  set status = 'cancelado', cancel_reason = v_reason, cancelled_at = now(),
      cancelled_by = case when v_access = 'reader' then 'imed:' || lower(coalesce(auth.jwt() ->> 'email', '')) else 'medico' end
  where d.id = v_d.id;
  return 'cancelado';
end $$;

-- Documentos da consulta para o médico dela ou quem lê prontuários (leitura registrada em tele_access_log).
-- Outros: nenhuma linha.
create or replace function public.tele_doc_list(p_id uuid)
returns table (
  id uuid, kind text, payload jsonb, code text, status text, cancel_reason text, cancelled_by text,
  created_at timestamptz, cancelled_at timestamptz, signed boolean, signed_at timestamptz,
  file_size integer, file_sha256 text, doctor_snapshot jsonb, patient_snapshot jsonb
)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.teleconsultations;
begin
  select * into v_row from public.teleconsultations t where t.id = p_id;
  if not found or private.tele_doc_access(v_row, 'tele_doc_list') is null then return; end if;
  return query
    select d.id, d.kind, d.payload, d.code, d.status, d.cancel_reason, split_part(d.cancelled_by, ':', 1),
           d.created_at, d.cancelled_at, d.signed_at is not null, d.signed_at,
           f.size, f.sha256, d.doctor_snapshot, d.patient_snapshot
    from public.tele_documents d
    left join public.tele_document_files f on f.document_id = d.id
    where d.consultation_id = v_row.id
    order by d.created_at, d.id
    limit 200;
end $$;

-- Documentos do médico logado ainda sem PDF assinado, dos últimos 30 dias (lista "Falta assinar"). expired = passou o
-- prazo de 7 dias para enviar o PDF (o médico cancela o rascunho, com motivo). Médico com cadastro não aprovado: erro
-- (ele não pode enviar PDF).
create or replace function public.tele_doc_pending()
returns table (
  id uuid, consultation_id uuid, patient_name text, kind text, payload jsonb, code text, status text,
  created_at timestamptz, signed boolean, doctor_snapshot jsonb, patient_snapshot jsonb, expired boolean
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
begin
  v_doc := private.tele_me(true);
  return query
    select d.id, d.consultation_id, d.patient_snapshot ->> 'name', d.kind, d.payload, d.code, d.status,
           d.created_at, false, d.doctor_snapshot, d.patient_snapshot, d.created_at < now() - interval '7 days'
    from public.tele_documents d
    where d.doctor_id = v_doc.id and d.status = 'emitido' and d.signed_at is null
      and d.created_at > now() - interval '30 days'
    order by d.created_at, d.id
    limit 100;
end $$;

-- O médico que emitiu envia o PDF assinado (base64; aceita "data:application/pdf;base64,..."). Até 3 MB, tem de
-- começar com %PDF-, terminar com %%EOF, ter campo de assinatura (/ByteRange, com /SubFilter de PAdES) e trazer o
-- código DESTE documento (o PDF gerado pelo IMED grava o código em texto simples; a assinatura PAdES é acrescentada
-- no fim e não apaga o que já estava). Isso NÃO prova que a assinatura é válida: quem confere é o validar.iti.gov.br.
-- Até 7 dias depois de emitir. Um PDF por documento: depois de enviado não se troca ('ja_assinado'; para corrigir,
-- cancelar e emitir outro). O mesmo arquivo de novo (internet que caiu) não muda nada.
create or replace function public.tele_doc_upload(p_doc uuid, p_pdf_base64 text)
returns table (signed_at timestamptz, file_size integer, file_sha256 text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_d public.tele_documents;
  v_txt text;
  v_pdf bytea;
  v_len integer;
  v_sha text;
  v_old_sha text;
  v_at timestamptz;
begin
  v_doc := private.tele_me(true);
  select * into v_d from public.tele_documents d where d.id = p_doc and d.doctor_id = v_doc.id for update;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  if v_d.status = 'cancelado' then raise exception 'documento_cancelado' using errcode = 'P0001'; end if;
  if v_d.created_at < now() - interval '7 days' then raise exception 'prazo_encerrado' using errcode = 'P0001'; end if;

  v_txt := coalesce(p_pdf_base64, '');
  if octet_length(v_txt) > 4500000 then perform private.tele_bad('pdf_tamanho'); end if;
  if left(v_txt, 5) = 'data:' then v_txt := substr(v_txt, strpos(v_txt, ',') + 1); end if;
  v_txt := translate(v_txt, E'-_ \t\r\n', '+/');  -- base64url -> base64; tira espaços e quebras de linha
  if v_txt = '' then perform private.tele_bad('pdf'); end if;
  v_txt := v_txt || repeat('=', (4 - octet_length(v_txt) % 4) % 4);
  begin
    v_pdf := decode(v_txt, 'base64');
  exception when others then
    perform private.tele_bad('pdf');
  end;
  v_len := octet_length(v_pdf);
  if v_len > 3145728 then perform private.tele_bad('pdf_tamanho'); end if;
  v_sha := encode(extensions.digest(v_pdf, 'sha256'), 'hex');
  -- Um PDF por documento: o mesmo arquivo de novo não muda nada; outro arquivo é recusado.
  select f.sha256 into v_old_sha from public.tele_document_files f where f.document_id = v_d.id;
  if found then
    if v_old_sha = v_sha then
      return query select v_d.signed_at, v_len, v_sha;
      return;
    end if;
    raise exception 'ja_assinado' using errcode = 'P0001';
  end if;
  if v_len < 16
     or substring(v_pdf from 1 for 5) <> '\x255044462d'::bytea                                       -- '%PDF-'
     or position('\x2525454f46'::bytea in substring(v_pdf from greatest(v_len - 1023, 1))) = 0 then  -- '%%EOF'
    perform private.tele_bad('pdf');
  end if;
  if position(convert_to('/ByteRange', 'UTF8') in v_pdf) = 0 then
    raise exception 'pdf_sem_assinatura' using errcode = 'P0001';
  end if;
  -- Assinatura PAdES (ICP-Brasil usa estes formatos). Outro tipo de "assinatura" não é aceito.
  if position(convert_to('/ETSI.CAdES.detached', 'UTF8') in v_pdf) = 0
     and position(convert_to('/adbe.pkcs7.detached', 'UTF8') in v_pdf) = 0
     and position(convert_to('/adbe.pkcs7.sha1', 'UTF8') in v_pdf) = 0 then
    raise exception 'pdf_sem_assinatura' using errcode = 'P0001', detail = 'subfilter';
  end if;
  -- O arquivo tem de ser DESTE documento (evita mandar ao paciente o documento de outra pessoa).
  if position(convert_to(v_d.code, 'UTF8') in v_pdf) = 0 then
    raise exception 'pdf_outro_documento' using errcode = 'P0001', detail = 'codigo';
  end if;
  insert into public.tele_document_files (document_id, pdf, size, sha256) values (v_d.id, v_pdf, v_len, v_sha);
  update public.tele_documents d set signed_at = now() where d.id = v_d.id returning d.signed_at into v_at;
  return query select v_at, v_len, v_sha;
end $$;

-- PDF assinado (base64) para o médico da consulta ou quem lê prontuários (leitura registrada), mesmo de documento
-- cancelado. Sem PDF: nulo.
create or replace function public.tele_doc_pdf(p_doc uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_d public.tele_documents;
  v_row public.teleconsultations;
  v_b64 text;
begin
  if auth.uid() is null then raise exception 'sem_login' using errcode = 'P0001'; end if;
  select * into v_d from public.tele_documents d where d.id = p_doc;
  if not found then raise exception 'nao_encontrado' using errcode = 'P0001'; end if;
  select * into v_row from public.teleconsultations t where t.id = v_d.consultation_id;
  if private.tele_doc_access(v_row, 'tele_doc_pdf') is null then
    raise exception 'nao_encontrado' using errcode = 'P0001';
  end if;
  select translate(encode(f.pdf, 'base64'), E'\n', '') into v_b64
  from public.tele_document_files f where f.document_id = v_d.id;
  return v_b64;
end $$;

/* ===================== Conferência pública (documento.html?c=CÓDIGO) ===================== */
-- Só o necessário para conferir; nada do conteúdo clínico, do motivo do cancelamento nem do nome completo.
-- Contra varredura: o código tem 10 símbolos de 32 (2^50 ≈ 10^15 combinações). Código com tamanho ou letras
-- erradas é recusado antes de qualquer busca, e não há como listar códigos. Mais que isso (limite de tentativas por
-- aparelho/IP) não dá para fazer só em SQL: esta função é só de leitura (não pode registrar tentativas) e o banco não
-- recebe um endereço IP confiável; um limite assim teria de ficar na frente da API (ex.: Cloudflare/WAF no domínio
-- próprio) ou numa Edge Function.
create or replace function public.tele_doc_verify(p_code text)
returns table (
  kind text, created_at timestamptz, status text, cancelled_at timestamptz, signed boolean,
  doctor_name text, doctor_crm text, doctor_crm_uf text, patient_initials text
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if p_code is null or char_length(p_code) > 40 then perform private.tele_bad('codigo'); end if;
  v_code := upper(regexp_replace(p_code, '[^0-9A-Za-z]', '', 'g'));
  if v_code !~ '^[2-9A-HJ-NP-Z]{10}$' then perform private.tele_bad('codigo'); end if;
  return query
    select d.kind, d.created_at, d.status, d.cancelled_at, d.signed_at is not null,
           d.doctor_snapshot ->> 'full_name', d.doctor_snapshot ->> 'crm', d.doctor_snapshot ->> 'crm_uf',
           private.tele_initials(d.patient_snapshot ->> 'name')
    from public.tele_documents d
    where d.code = v_code;
end $$;

/* ===================== Equipe do IMED (admin) ===================== */
-- Auditoria dos documentos emitidos nos últimos p_days dias (1 a 366; padrão 30), só para quem lê prontuários.
-- Sem conteúdo clínico (nem o motivo do cancelamento) e sem PDF: o conteúdo de uma consulta é tele_doc_list e o PDF,
-- tele_doc_pdf (ambos com a leitura registrada).
create or replace function public.tele_admin_documents(p_days integer default 30)
returns table (
  id uuid, consultation_id uuid, kind text, code text, status text, cancelled_by text,
  created_at timestamptz, cancelled_at timestamptz, signed boolean, signed_at timestamptz,
  file_size integer, doctor_id uuid, doctor_name text, doctor_crm text, doctor_crm_uf text,
  patient_initials text
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_days integer := coalesce(p_days, 30);
begin
  if not public.is_imed_admin() then raise exception 'so_admin' using errcode = 'P0001'; end if;
  if not private.tele_is_reader() then raise exception 'nao_leitor' using errcode = 'P0001'; end if;
  if v_days not between 1 and 366 then perform private.tele_bad('dias'); end if;
  return query
    select d.id, d.consultation_id, d.kind, d.code, d.status, d.cancelled_by,
           d.created_at, d.cancelled_at, d.signed_at is not null, d.signed_at, f.size, d.doctor_id,
           d.doctor_snapshot ->> 'full_name', d.doctor_snapshot ->> 'crm', d.doctor_snapshot ->> 'crm_uf',
           private.tele_initials(d.patient_snapshot ->> 'name')
    from public.tele_documents d
    left join public.tele_document_files f on f.document_id = d.id
    where d.created_at >= now() - make_interval(days => v_days)
    order by d.created_at desc, d.id
    limit 1000;
end $$;

/* ===================== Permissões ===================== */
-- Paciente (com ou sem conta) e conferência pública
revoke all on function public.tele_patient_details(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.tele_patient_documents(uuid, text) from public, anon, authenticated;
revoke all on function public.tele_patient_document_pdf(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.tele_doc_verify(text) from public, anon, authenticated;
grant execute on function public.tele_patient_details(uuid, text, text, text) to anon, authenticated;
grant execute on function public.tele_patient_documents(uuid, text) to anon, authenticated;
grant execute on function public.tele_patient_document_pdf(uuid, text, uuid) to anon, authenticated;
grant execute on function public.tele_doc_verify(text) to anon, authenticated;

-- Médico e equipe do IMED (só logado)
revoke all on function public.tele_doctor_profile(text, text) from public, anon, authenticated;
revoke all on function public.tele_doc_patient_data(uuid, text, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.tele_doc_create(uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.tele_doc_cancel(uuid, text) from public, anon, authenticated;
revoke all on function public.tele_doc_list(uuid) from public, anon, authenticated;
revoke all on function public.tele_doc_pending() from public, anon, authenticated;
revoke all on function public.tele_doc_upload(uuid, text) from public, anon, authenticated;
revoke all on function public.tele_doc_pdf(uuid) from public, anon, authenticated;
revoke all on function public.tele_admin_documents(integer) from public, anon, authenticated;
grant execute on function public.tele_doctor_profile(text, text) to authenticated;
grant execute on function public.tele_doc_patient_data(uuid, text, text, boolean, boolean) to authenticated;
grant execute on function public.tele_doc_create(uuid, text, jsonb, jsonb) to authenticated;
grant execute on function public.tele_doc_cancel(uuid, text) to authenticated;
grant execute on function public.tele_doc_list(uuid) to authenticated;
grant execute on function public.tele_doc_pending() to authenticated;
grant execute on function public.tele_doc_upload(uuid, text) to authenticated;
grant execute on function public.tele_doc_pdf(uuid) to authenticated;
grant execute on function public.tele_admin_documents(integer) to authenticated;

/* ===================== Termo da teleconsulta (TCLE) ===================== */
-- termo-teleconsulta.html ganhou a parte de documentos (receita simples, atestado e outros; CPF e endereço; PDF
-- assinado guardado como prontuário; página de conferência): versão 2026-10-30.2 (TCLE_VERSION em
-- assets/js/tele-core.js). tele_request é a MESMA de 20261030092931_teleconsulta, só com a versão nova na lista; a
-- anterior continua aceita por um tempo (página antiga ainda aberta ou guardada no aparelho).
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
  if p_consent is not true or v_version not in ('2026-10-30', '2026-10-30.2') then
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
revoke all on function public.tele_request(text, date, text, text, text[], boolean, text, text, boolean, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.tele_request(text, date, text, text, text[], boolean, text, text, boolean, boolean, text, text, boolean) to anon, authenticated;
