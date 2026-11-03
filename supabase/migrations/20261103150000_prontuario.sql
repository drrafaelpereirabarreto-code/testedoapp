-- iMed Medical Workspace, fase 2 (prontuário): núcleo verificável do registro clínico da teleconsulta.
-- Plano: memory/projects/imed-workspace-arquitetura.md, §4.1 a §4.6 e §4.10 (fases 2.0 e 2.3, parte mínima).
--
-- O que entra (só acréscimos; nada existente é alterado, apagado ou esvaziado):
--   - schema prontuario (clínico) e schema catalogo (referência), fechados para a API (anon, authenticated e
--     service_role sem USAGE e sem permissão em tabela); RLS ligada em toda tabela, sem policy;
--   - prontuario.evolucoes: o registro da consulta (anamnese, exame físico, diagnósticos, conduta, evolução SOAP ou
--     texto livre) ligado a public.teleconsultations e public.doctors. Rascunho salvo no servidor com versão
--     (conflito = versao_conflito); finalizado = imutável, com hash SHA-256 encadeado; correção só por adendo
--     (linha nova, autor e data próprios, finalizado na hora e encadeado);
--   - prontuario.evolucao_versoes: fotos do rascunho (no máximo 1 por minuto, mais a troca SOAP/texto livre);
--   - prontuario.medidas: sinais vitais com a ORIGEM de cada número (quem mediu e como foi obtido), gravados ao
--     finalizar e imutáveis; nada se preenche sozinho;
--   - prontuario.diagnosticos: hipóteses e diagnósticos com CID-10 do catálogo oficial (ou só descrição), papel e
--     situação; o sistema nunca atribui diagnóstico;
--   - prontuario.trilha_acesso (toda chamada, inclusive as negadas) e prontuario.trilha_escrita (cada gravação),
--     só de acréscimo e sem chave estrangeira;
--   - catalogo.cid10: CID-10 do DATASUS (arquivo CID10CSV, versão 2008), carregado por private.cid10_carregar a
--     partir do arquivo gerado pelo workflow cid10.yml (ramo dados/cid10);
--   - pg_cron 'imed-prontuario-encerra': rascunho esquecido (consulta fora do prazo de 24 h) vira
--     'encerrada_sem_finalizar' e entra na cadeia de hash marcado como não finalizado (nunca finaliza pelo médico).
--
-- Quem lê e quem escreve (plano §4.4; D1 sem resposta do dono): só o médico da consulta. Rascunho e finalizar: o
-- médico aprovado (ou com o cadastro suspenso, só dentro do prazo de 24 h, como a teleconsulta), com a consulta no
-- prazo (private.tele_in_window). Adendo: o médico da consulta, aprovado, a qualquer tempo. Equipe médica do IMED
-- (tele_record_readers): só leitura, com justificativa, cada leitura na trilha. Ninguém mais: a função grava a
-- trilha com "negado" e devolve {"erro": "forbidden"} sem raise (o raise desfaria a gravação da trilha).
-- O histórico de OUTRAS consultas do mesmo paciente fica para a fase 2.2 (identidade do paciente e TCLE v3).
--
-- Fora do alcance da trilha (declarado no plano, §4.1): quem entra no banco como postgres (painel SQL, conector).
-- Até haver assinatura ICP-Brasil do registro, a tela diz "registro não assinado digitalmente".
-- Volta: supabase/volta/<mesmo nome>.sql.

/* ===================== 1. Schemas fechados ===================== */
create schema if not exists prontuario;
create schema if not exists catalogo;
revoke all on schema prontuario from public, anon, authenticated, service_role;
revoke all on schema catalogo from public, anon, authenticated, service_role;
comment on schema prontuario is 'Registro clínico do IMED. Fora da API: acesso só pelas funções public.ws_* (SECURITY DEFINER).';
comment on schema catalogo is 'Catálogos de referência (CID-10). Fora da API: acesso só pelas funções public.cat_*.';

/* ===================== 2. Catálogo CID-10 ===================== */
create table if not exists catalogo.cid10 (
  codigo text primary key check (codigo ~ '^[A-Z][0-9]{2}[0-9X]?$'),
  sistema text not null default 'CID-10' check (sistema = 'CID-10'),
  categoria boolean not null,                 -- true = categoria de 3 caracteres (A00); false = subcategoria (A00.0)
  capitulo smallint check (capitulo between 1 and 22),
  descricao text not null check (char_length(descricao) between 2 and 400),
  descricao_abrev text check (descricao_abrev is null or char_length(descricao_abrev) <= 200),
  restr_sexo text check (restr_sexo is null or restr_sexo in ('F', 'M')),
  busca text not null,
  fonte text not null check (char_length(fonte) between 3 and 200),
  fonte_versao text not null check (char_length(fonte_versao) between 1 and 40),
  carregado_em timestamptz not null default now(),
  check (categoria = (char_length(codigo) = 3))
);
comment on table catalogo.cid10 is
  'CID-10 (OMS; tradução CBCD/FSP-USP; arquivo CID10CSV do DATASUS). Carga por private.cid10_carregar; nada é criado pelo IMED.';
alter table catalogo.cid10 enable row level security;
revoke all on table catalogo.cid10 from public, anon, authenticated, service_role;

/* ===================== 3. Registro clínico ===================== */
create table if not exists prontuario.evolucoes (
  id uuid primary key default gen_random_uuid(),
  teleconsulta_id uuid not null references public.teleconsultations (id) on delete restrict,
  medico_id uuid not null references public.doctors (id) on delete restrict,
  tipo text not null check (tipo in ('evolucao', 'adendo')),
  adendo_de uuid references prontuario.evolucoes (id) on delete restrict,
  situacao text not null check (situacao in ('rascunho', 'finalizada', 'encerrada_sem_finalizar')),
  conteudo jsonb not null check (jsonb_typeof(conteudo) = 'object' and pg_column_size(conteudo) <= 200000),
  versao integer not null default 1 check (versao >= 1),
  salvo_em timestamptz not null default now(),
  finalizada_em timestamptz,
  encerrada_em timestamptz,
  hash_sha256 text check (hash_sha256 is null or hash_sha256 ~ '^[0-9a-f]{64}$'),
  hash_anterior text check (hash_anterior is null or hash_anterior ~ '^[0-9a-f]{64}$'),
  cadeia_pos bigint unique,
  criado_em timestamptz not null default now(),
  check ((tipo = 'adendo') = (adendo_de is not null)),
  check (tipo = 'evolucao' or situacao = 'finalizada'),
  check (situacao <> 'finalizada' or (finalizada_em is not null and hash_sha256 is not null and cadeia_pos is not null and encerrada_em is null)),
  check (situacao <> 'encerrada_sem_finalizar' or (encerrada_em is not null and hash_sha256 is not null and cadeia_pos is not null and finalizada_em is null)),
  check (situacao <> 'rascunho' or (finalizada_em is null and encerrada_em is null and hash_sha256 is null and cadeia_pos is null))
);
comment on table prontuario.evolucoes is
  'Registro clínico de cada teleconsulta (1 evolução por consulta + adendos). Finalizado = imutável (private.ws_guard), com hash encadeado.';
create unique index if not exists evolucoes_uma_por_consulta on prontuario.evolucoes (teleconsulta_id) where tipo = 'evolucao';
create index if not exists evolucoes_medico on prontuario.evolucoes (medico_id, criado_em desc);
create index if not exists evolucoes_adendo_de on prontuario.evolucoes (adendo_de) where adendo_de is not null;
create index if not exists evolucoes_rascunho on prontuario.evolucoes (criado_em) where situacao = 'rascunho';

create table if not exists prontuario.evolucao_versoes (
  id bigint generated always as identity primary key,
  evolucao_id uuid not null references prontuario.evolucoes (id) on delete restrict,
  versao integer not null check (versao >= 1),
  conteudo jsonb not null,
  salvo_em timestamptz not null default now(),
  salvo_por uuid not null references public.doctors (id) on delete restrict,
  unique (evolucao_id, versao)
);
comment on table prontuario.evolucao_versoes is 'Fotos do rascunho do registro (histórico de versões), só de acréscimo.';

create table if not exists prontuario.medidas (
  id uuid primary key default gen_random_uuid(),
  evolucao_id uuid not null references prontuario.evolucoes (id) on delete restrict,
  ordem smallint not null check (ordem between 1 and 30),
  tipo text not null check (tipo in ('pa_sistolica', 'pa_diastolica', 'fc', 'fr', 'temperatura', 'spo2', 'peso', 'altura', 'glicemia_capilar')),
  valor numeric not null,
  unidade text not null check (unidade in ('mmHg', 'bpm', 'irpm', '°C', '%', 'kg', 'cm', 'mg/dL')),
  quem_mediu text not null check (quem_mediu in ('paciente', 'acompanhante', 'profissional', 'medico')),
  como_obtido text not null check (como_obtido in ('relato', 'estimado', 'aparelho_na_camera', 'contado_pelo_medico_no_video', 'integracao')),
  aparelho text check (aparelho is null or char_length(aparelho) between 2 and 80),
  medido_em timestamptz,
  registrado_por uuid not null references public.doctors (id) on delete restrict,
  registrado_em timestamptz not null default now(),
  unique (evolucao_id, ordem),
  check (como_obtido <> 'contado_pelo_medico_no_video' or tipo = 'fr'),
  check (quem_mediu <> 'medico' or como_obtido = 'contado_pelo_medico_no_video'),
  check (como_obtido not in ('aparelho_na_camera', 'integracao') or medido_em is not null)
);
comment on table prontuario.medidas is
  'Sinais vitais com a origem de cada número (quem mediu e como foi obtido). Gravados ao finalizar; imutáveis. Nada é preenchido sozinho.';

create table if not exists prontuario.diagnosticos (
  id uuid primary key default gen_random_uuid(),
  evolucao_id uuid not null references prontuario.evolucoes (id) on delete restrict,
  ordem smallint not null check (ordem between 1 and 20),
  cid text references catalogo.cid10 (codigo) on delete restrict,
  descricao text not null check (char_length(descricao) between 2 and 300),
  papel text not null check (papel in ('principal', 'secundario', 'hipotese')),
  situacao text not null check (situacao in ('suspeito', 'confirmado', 'descartado')),
  registrado_por uuid not null references public.doctors (id) on delete restrict,
  registrado_em timestamptz not null default now(),
  unique (evolucao_id, ordem)
);
comment on table prontuario.diagnosticos is 'Hipóteses e diagnósticos escolhidos pelo médico (CID-10 do catálogo oficial ou só descrição). Imutáveis.';

/* ===================== 4. Trilhas (só acréscimo, sem chave estrangeira) ===================== */
create table if not exists prontuario.trilha_acesso (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  user_id uuid,
  papel text,
  fn text not null,
  resultado text not null check (resultado in ('permitido', 'negado')),
  motivo text,
  teleconsulta_id uuid,
  objeto_tipo text,
  objeto_id uuid,
  justificativa_codigo text,
  sessao_id text,
  aal text,
  origem text
);
create index if not exists trilha_acesso_consulta on prontuario.trilha_acesso (teleconsulta_id, em);
create table if not exists prontuario.trilha_escrita (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  user_id uuid,
  papel text,
  fn text not null,
  operacao text not null,
  objeto_tipo text not null,
  objeto_id uuid not null,
  teleconsulta_id uuid,
  versao_antes integer,
  versao_depois integer,
  hash_depois text,
  sessao_id text,
  origem text
);
create index if not exists trilha_escrita_objeto on prontuario.trilha_escrita (objeto_id, em);
comment on table prontuario.trilha_acesso is 'Cada chamada às funções do prontuário, inclusive as negadas. Dado sensível: mesma guarda do prontuário.';
comment on table prontuario.trilha_escrita is 'Cada gravação no prontuário (versão antes e depois, hash). Só de acréscimo.';

alter table prontuario.evolucoes enable row level security;
alter table prontuario.evolucao_versoes enable row level security;
alter table prontuario.medidas enable row level security;
alter table prontuario.diagnosticos enable row level security;
alter table prontuario.trilha_acesso enable row level security;
alter table prontuario.trilha_escrita enable row level security;
revoke all on table prontuario.evolucoes from public, anon, authenticated, service_role;
revoke all on table prontuario.evolucao_versoes from public, anon, authenticated, service_role;
revoke all on table prontuario.medidas from public, anon, authenticated, service_role;
revoke all on table prontuario.diagnosticos from public, anon, authenticated, service_role;
revoke all on table prontuario.trilha_acesso from public, anon, authenticated, service_role;
revoke all on table prontuario.trilha_escrita from public, anon, authenticated, service_role;
revoke all on sequence prontuario.evolucao_versoes_id_seq from public, anon, authenticated, service_role;
revoke all on sequence prontuario.trilha_acesso_id_seq from public, anon, authenticated, service_role;
revoke all on sequence prontuario.trilha_escrita_id_seq from public, anon, authenticated, service_role;

/* ===================== 5. Guardas (imutabilidade) ===================== */
-- Evolução: rascunho pode mudar (só pelas funções); finalizada ou encerrada nunca muda. Nada se apaga. As colunas
-- de identidade (consulta, médico, tipo, adendo_de, id) nunca mudam.
create or replace function private.ws_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'prontuario_imutavel: % não pode ser esvaziada', tg_table_name using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'prontuario_imutavel: registro clínico não se apaga' using errcode = 'P0001';
  end if;
  -- UPDATE
  if old.situacao <> 'rascunho' then
    raise exception 'prontuario_imutavel: registro finalizado não muda (use um adendo)' using errcode = 'P0001';
  end if;
  if new.id <> old.id or new.teleconsulta_id <> old.teleconsulta_id or new.medico_id <> old.medico_id
     or new.tipo <> old.tipo or new.adendo_de is distinct from old.adendo_de or new.criado_em <> old.criado_em then
    raise exception 'prontuario_imutavel: identidade do registro não muda' using errcode = 'P0001';
  end if;
  if new.versao < old.versao then
    raise exception 'prontuario_imutavel: versão não volta' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Tabelas só de acréscimo (versões, trilhas): nada muda, nada se apaga.
create or replace function private.ws_so_acrescimo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'prontuario_imutavel: % só aceita acréscimo', tg_table_name using errcode = 'P0001';
end $$;

-- Filhas da evolução (medidas, diagnósticos): só entram enquanto a evolução é rascunho (no ato de finalizar);
-- depois, nada muda nem se apaga.
create or replace function private.ws_filha_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'prontuario_imutavel: % não muda nem se apaga', tg_table_name using errcode = 'P0001';
  end if;
  if not exists (select 1 from prontuario.evolucoes e where e.id = new.evolucao_id and e.situacao = 'rascunho' and e.tipo = 'evolucao') then
    raise exception 'prontuario_imutavel: % só entra no registro ainda não finalizado', tg_table_name using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function private.ws_guard() from public, anon, authenticated, service_role;
revoke all on function private.ws_so_acrescimo() from public, anon, authenticated, service_role;
revoke all on function private.ws_filha_guard() from public, anon, authenticated, service_role;

create trigger evolucoes_guard before update or delete on prontuario.evolucoes
  for each row execute function private.ws_guard();
create trigger evolucoes_guard_truncate before truncate on prontuario.evolucoes
  for each statement execute function private.ws_guard();
create trigger medidas_guard before insert or update or delete on prontuario.medidas
  for each row execute function private.ws_filha_guard();
create trigger medidas_guard_truncate before truncate on prontuario.medidas
  for each statement execute function private.ws_so_acrescimo();
create trigger diagnosticos_guard before insert or update or delete on prontuario.diagnosticos
  for each row execute function private.ws_filha_guard();
create trigger diagnosticos_guard_truncate before truncate on prontuario.diagnosticos
  for each statement execute function private.ws_so_acrescimo();
create trigger evolucao_versoes_guard before update or delete on prontuario.evolucao_versoes
  for each row execute function private.ws_so_acrescimo();
create trigger evolucao_versoes_guard_truncate before truncate on prontuario.evolucao_versoes
  for each statement execute function private.ws_so_acrescimo();
create trigger trilha_acesso_guard before update or delete on prontuario.trilha_acesso
  for each row execute function private.ws_so_acrescimo();
create trigger trilha_acesso_guard_truncate before truncate on prontuario.trilha_acesso
  for each statement execute function private.ws_so_acrescimo();
create trigger trilha_escrita_guard before update or delete on prontuario.trilha_escrita
  for each row execute function private.ws_so_acrescimo();
create trigger trilha_escrita_guard_truncate before truncate on prontuario.trilha_escrita
  for each statement execute function private.ws_so_acrescimo();
-- As guardas valem sempre, também com session_replication_role = replica.
alter table prontuario.evolucoes enable always trigger evolucoes_guard;
alter table prontuario.evolucoes enable always trigger evolucoes_guard_truncate;
alter table prontuario.medidas enable always trigger medidas_guard;
alter table prontuario.medidas enable always trigger medidas_guard_truncate;
alter table prontuario.diagnosticos enable always trigger diagnosticos_guard;
alter table prontuario.diagnosticos enable always trigger diagnosticos_guard_truncate;
alter table prontuario.evolucao_versoes enable always trigger evolucao_versoes_guard;
alter table prontuario.evolucao_versoes enable always trigger evolucao_versoes_guard_truncate;
alter table prontuario.trilha_acesso enable always trigger trilha_acesso_guard;
alter table prontuario.trilha_acesso enable always trigger trilha_acesso_guard_truncate;
alter table prontuario.trilha_escrita enable always trigger trilha_escrita_guard;
alter table prontuario.trilha_escrita enable always trigger trilha_escrita_guard_truncate;

/* ===================== 6. Funções internas ===================== */
-- Texto para busca: minúsculas e sem acento (igual a fold() de assets/js/tele-core.js para o português).
create or replace function private.ws_fold(p text)
returns text
language sql immutable
set search_path = ''
as $$
  select regexp_replace(translate(lower(coalesce(p, '')),
           'áàâãäåéèêëíìîïóòôõöúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn'), '\s+', ' ', 'g');
$$;

-- Unidade fixa de cada medida (a tela mostra a mesma).
create or replace function private.ws_unidade(p_tipo text)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_tipo
    when 'pa_sistolica' then 'mmHg' when 'pa_diastolica' then 'mmHg' when 'fc' then 'bpm' when 'fr' then 'irpm'
    when 'temperatura' then '°C' when 'spo2' then '%' when 'peso' then 'kg' when 'altura' then 'cm'
    when 'glicemia_capilar' then 'mg/dL' end;
$$;

-- Faixa plausível de cada medida (a mesma em assets/js/ws-core.js): fora dela, recusa (provável erro de digitação).
create or replace function private.ws_faixa_ok(p_tipo text, p_valor numeric)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case p_tipo
    when 'pa_sistolica' then p_valor between 40 and 300
    when 'pa_diastolica' then p_valor between 20 and 200
    when 'fc' then p_valor between 20 and 300
    when 'fr' then p_valor between 4 and 80
    when 'temperatura' then p_valor between 30 and 45
    when 'spo2' then p_valor between 50 and 100
    when 'peso' then p_valor between 0.3 and 400
    when 'altura' then p_valor between 20 and 250
    when 'glicemia_capilar' then p_valor between 10 and 1000
    else false end;
$$;

-- Confere o conteúdo do registro (chaves fixas, tipos e tamanhos). Devolve null se estiver certo; senão, o nome do
-- campo com problema (vai em {"erro": "dados_invalidos", "campo": ...}).
create or replace function private.ws_conteudo_erro(p jsonb)
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  m jsonb;
  d jsonb;
  n integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'conteudo'; end if;
  if octet_length(p::text) > 150000 then return 'conteudo_grande'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('modo', 'anamnese', 'exame', 'diagnosticos', 'conduta', 'soap', 'livre', 'nao_classificado') then return k; end if;
  end loop;
  if coalesce(p ->> 'modo', 'soap') not in ('soap', 'livre') then return 'modo'; end if;
  -- textos soltos
  foreach k in array array['conduta', 'livre', 'nao_classificado'] loop
    v := p -> k;
    if v is not null and jsonb_typeof(v) <> 'null' and (jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 20000) then return k; end if;
  end loop;
  -- anamnese
  v := p -> 'anamnese';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'object' then return 'anamnese'; end if;
    for k in select jsonb_object_keys(v) loop
      if k not in ('queixa', 'hda', 'antecedentes', 'familiares', 'habitos', 'medicamentos', 'alergias', 'revisao') then return 'anamnese.' || k; end if;
      if jsonb_typeof(v -> k) not in ('string', 'null') or char_length(coalesce(v ->> k, '')) > 8000 then return 'anamnese.' || k; end if;
    end loop;
  end if;
  -- SOAP
  v := p -> 'soap';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'object' then return 'soap'; end if;
    for k in select jsonb_object_keys(v) loop
      if k not in ('s', 'o', 'a', 'p') then return 'soap.' || k; end if;
      if jsonb_typeof(v -> k) not in ('string', 'null') or char_length(coalesce(v ->> k, '')) > 8000 then return 'soap.' || k; end if;
    end loop;
  end if;
  -- exame físico: texto do que o médico observou + medidas com origem
  v := p -> 'exame';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'object' then return 'exame'; end if;
    for k in select jsonb_object_keys(v) loop
      if k not in ('geral', 'medidas') then return 'exame.' || k; end if;
    end loop;
    if jsonb_typeof(v -> 'geral') not in ('string', 'null') or char_length(coalesce(v ->> 'geral', '')) > 8000 then return 'exame.geral'; end if;
    if v ? 'medidas' and jsonb_typeof(v -> 'medidas') <> 'null' then
      if jsonb_typeof(v -> 'medidas') <> 'array' or jsonb_array_length(v -> 'medidas') > 30 then return 'exame.medidas'; end if;
      n := 0;
      for m in select x from jsonb_array_elements(v -> 'medidas') x loop
        n := n + 1;
        if jsonb_typeof(m) <> 'object' then return 'medida.' || n; end if;
        if coalesce(jsonb_typeof(m -> 'valor'), 'null') <> 'number' then return 'medida.' || n || '.valor'; end if;
        for k in select jsonb_object_keys(m) loop
          if k not in ('tipo', 'valor', 'quem_mediu', 'como_obtido', 'aparelho', 'medido_em') then return 'medida.' || n || '.' || k; end if;
        end loop;
        if private.ws_unidade(m ->> 'tipo') is null then return 'medida.' || n || '.tipo'; end if;
        if not private.ws_faixa_ok(m ->> 'tipo', (m ->> 'valor')::numeric) then return 'medida.' || n || '.valor'; end if;
        if coalesce(m ->> 'quem_mediu', '') not in ('paciente', 'acompanhante', 'medico') then return 'medida.' || n || '.quem_mediu'; end if;
        if coalesce(m ->> 'como_obtido', '') not in ('relato', 'estimado', 'aparelho_na_camera', 'contado_pelo_medico_no_video') then return 'medida.' || n || '.como_obtido'; end if;
        if m ->> 'como_obtido' = 'contado_pelo_medico_no_video' and m ->> 'tipo' <> 'fr' then return 'medida.' || n || '.como_obtido'; end if;
        if (m ->> 'quem_mediu' = 'medico') <> (m ->> 'como_obtido' = 'contado_pelo_medico_no_video') then return 'medida.' || n || '.quem_mediu'; end if;
        if jsonb_typeof(m -> 'aparelho') not in ('string', 'null') or char_length(coalesce(m ->> 'aparelho', '')) > 80 then return 'medida.' || n || '.aparelho'; end if;
        if m ->> 'como_obtido' = 'aparelho_na_camera' and coalesce(m ->> 'medido_em', '') = '' then return 'medida.' || n || '.medido_em'; end if;
        if coalesce(m ->> 'medido_em', '') <> '' then
          if m ->> 'medido_em' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then return 'medida.' || n || '.medido_em'; end if;
          begin
            if (m ->> 'medido_em')::timestamptz > now() + interval '5 minutes' or (m ->> 'medido_em')::timestamptz < now() - interval '30 days' then
              return 'medida.' || n || '.medido_em';
            end if;
          exception when others then return 'medida.' || n || '.medido_em';
          end;
        end if;
      end loop;
    end if;
  end if;
  -- diagnósticos
  v := p -> 'diagnosticos';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20 then return 'diagnosticos'; end if;
    n := 0;
    for d in select x from jsonb_array_elements(v) x loop
      n := n + 1;
      if jsonb_typeof(d) <> 'object' then return 'diagnostico.' || n; end if;
      for k in select jsonb_object_keys(d) loop
        if k not in ('cid', 'descricao', 'papel', 'situacao') then return 'diagnostico.' || n || '.' || k; end if;
      end loop;
      if jsonb_typeof(d -> 'cid') not in ('string', 'null') or coalesce(d ->> 'cid', 'A00') !~ '^[A-Z][0-9]{2}[0-9X]?$' then return 'diagnostico.' || n || '.cid'; end if;
      if coalesce(jsonb_typeof(d -> 'descricao'), 'null') <> 'string' or char_length(btrim(d ->> 'descricao')) not between 2 and 300 then return 'diagnostico.' || n || '.descricao'; end if;
      if coalesce(d ->> 'papel', '') not in ('principal', 'secundario', 'hipotese') then return 'diagnostico.' || n || '.papel'; end if;
      if coalesce(d ->> 'situacao', '') not in ('suspeito', 'confirmado', 'descartado') then return 'diagnostico.' || n || '.situacao'; end if;
    end loop;
    if (select count(*) from jsonb_array_elements(v) x where x ->> 'papel' = 'principal') > 1 then return 'diagnosticos.principal'; end if;
  end if;
  return null;
end $$;

-- Tem algo escrito? (para finalizar: registro vazio não se finaliza)
create or replace function private.ws_conteudo_vazio(p jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select not exists (
    select 1 from jsonb_each_text((case when jsonb_typeof(p -> 'anamnese') = 'object' then p -> 'anamnese' else '{}'::jsonb end)
                                  || (case when jsonb_typeof(p -> 'soap') = 'object' then p -> 'soap' else '{}'::jsonb end)) e
    where btrim(coalesce(e.value, '')) <> ''
  )
  and btrim(coalesce(p ->> 'livre', '')) = '' and btrim(coalesce(p ->> 'conduta', '')) = ''
  and btrim(coalesce(p #>> '{exame,geral}', '')) = '' and btrim(coalesce(p ->> 'nao_classificado', '')) = ''
  and coalesce(jsonb_array_length(case when jsonb_typeof(p #> '{exame,medidas}') = 'array' then p #> '{exame,medidas}' end), 0) = 0
  and coalesce(jsonb_array_length(case when jsonb_typeof(p -> 'diagnosticos') = 'array' then p -> 'diagnosticos' end), 0) = 0;
$$;

-- Data em texto fixo (UTC), para o hash não depender do fuso da sessão.
create or replace function private.ws_ts(p timestamptz)
returns text
language sql immutable
set search_path = ''
as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;

-- Conteúdo canônico de uma evolução (com as filhas, em ordem fixa) e o hash dele.
create or replace function private.ws_canonico(p_id uuid, p_consulta uuid, p_medico uuid, p_tipo text, p_adendo_de uuid,
                                               p_situacao text, p_conteudo jsonb, p_quando timestamptz, p_hash_anterior text)
returns text
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'v', 1, 'id', p_id, 'teleconsulta_id', p_consulta, 'medico_id', p_medico, 'tipo', p_tipo, 'adendo_de', p_adendo_de,
    'situacao', p_situacao, 'quando', private.ws_ts(p_quando), 'hash_anterior', p_hash_anterior, 'conteudo', p_conteudo,
    'medidas', coalesce((select jsonb_agg(jsonb_build_object('ordem', m.ordem, 'tipo', m.tipo, 'valor', m.valor, 'unidade', m.unidade,
                          'quem_mediu', m.quem_mediu, 'como_obtido', m.como_obtido, 'aparelho', m.aparelho,
                          'medido_em', private.ws_ts(m.medido_em), 'registrado_por', m.registrado_por) order by m.ordem, m.id)
                         from prontuario.medidas m where m.evolucao_id = p_id), '[]'::jsonb),
    'diagnosticos', coalesce((select jsonb_agg(jsonb_build_object('ordem', d.ordem, 'cid', d.cid, 'descricao', d.descricao,
                          'papel', d.papel, 'situacao', d.situacao, 'registrado_por', d.registrado_por) order by d.ordem, d.id)
                         from prontuario.diagnosticos d where d.evolucao_id = p_id), '[]'::jsonb))::text;
$$;
create or replace function private.ws_hash(p_texto text)
returns text
language sql immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_texto, 'UTF8')), 'hex');
$$;

-- Próximo elo da cadeia (com a trava 7201/0: um elo por vez em todo o banco).
create or replace function private.ws_cadeia_proximo()
returns table (pos bigint, anterior text)
language plpgsql volatile
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(7201, 0);
  return query
    select coalesce(max(e.cadeia_pos), 0) + 1,
           (select e2.hash_sha256 from prontuario.evolucoes e2 where e2.cadeia_pos = (select max(e3.cadeia_pos) from prontuario.evolucoes e3))
    from prontuario.evolucoes e;
end $$;

-- Trilha de acesso (toda chamada) e de escrita.
create or replace function private.ws_trilha(p_fn text, p_resultado text, p_motivo text, p_papel text, p_consulta uuid,
                                             p_objeto_tipo text default null, p_objeto_id uuid default null,
                                             p_justificativa text default null)
returns void
language sql volatile
set search_path = ''
as $$
  insert into prontuario.trilha_acesso (user_id, papel, fn, resultado, motivo, teleconsulta_id, objeto_tipo, objeto_id,
                                        justificativa_codigo, sessao_id, aal, origem)
  values (auth.uid(), p_papel, p_fn, p_resultado, p_motivo, p_consulta, p_objeto_tipo, p_objeto_id, p_justificativa,
          left(auth.jwt() ->> 'session_id', 80), left(auth.jwt() ->> 'aal', 10),
          coalesce(nullif(current_setting('imed.origin', true), ''), 'app'));
$$;
create or replace function private.ws_escrita(p_fn text, p_operacao text, p_objeto_tipo text, p_objeto_id uuid, p_consulta uuid,
                                              p_antes integer, p_depois integer, p_hash text)
returns void
language sql volatile
set search_path = ''
as $$
  insert into prontuario.trilha_escrita (user_id, papel, fn, operacao, objeto_tipo, objeto_id, teleconsulta_id, versao_antes,
                                         versao_depois, hash_depois, sessao_id, origem)
  values (auth.uid(), 'medico', p_fn, p_operacao, p_objeto_tipo, p_objeto_id, p_consulta, p_antes, p_depois, p_hash,
          left(auth.jwt() ->> 'session_id', 80), coalesce(nullif(current_setting('imed.origin', true), ''), 'app'));
$$;

-- Quem pode o quê nesta consulta. Devolve jsonb com "acesso" ('own', 'limited', 'reader'), "medico_id",
-- "pode_editar" (rascunho e finalizar), "pode_adendo"; ou {"erro": ...} (e a trilha já ficou com "negado").
-- Leitura da equipe médica (reader) exige justificativa de uma lista fechada.
create or replace function private.ws_acesso(p_consulta uuid, p_fn text, p_justificativa text default null)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_t public.teleconsultations;
  v_doc public.doctors;
  v_janela boolean;
begin
  if v_uid is null then
    perform private.ws_trilha(p_fn, 'negado', 'sem_login', null, p_consulta);
    return jsonb_build_object('erro', 'sem_login');
  end if;
  select * into v_t from public.teleconsultations t where t.id = p_consulta;
  select * into v_doc from public.doctors d where d.user_id = v_uid;
  if v_t.id is not null and v_doc.id is not null and v_t.doctor_id = v_doc.id then
    v_janela := private.tele_in_window(v_t);
    if v_doc.status = 'approved' then
      perform private.ws_trilha(p_fn, 'permitido', null, 'medico', p_consulta);
      return jsonb_build_object('acesso', 'own', 'medico_id', v_doc.id, 'pode_editar', v_janela, 'pode_adendo', true);
    elsif v_janela then
      perform private.ws_trilha(p_fn, 'permitido', 'cadastro_nao_aprovado_no_prazo', 'medico', p_consulta);
      return jsonb_build_object('acesso', 'limited', 'medico_id', v_doc.id, 'pode_editar', true, 'pode_adendo', true);
    end if;
    perform private.ws_trilha(p_fn, 'negado', 'cadastro_nao_aprovado', 'medico', p_consulta);
    return jsonb_build_object('erro', 'forbidden');
  end if;
  if v_t.id is not null and private.tele_is_reader() then
    if coalesce(p_justificativa, '') not in ('auditoria', 'pedido_do_paciente', 'continuidade_do_cuidado', 'qualidade') then
      perform private.ws_trilha(p_fn, 'negado', 'sem_justificativa', 'equipe', p_consulta);
      return jsonb_build_object('erro', 'justificativa');
    end if;
    perform private.ws_trilha(p_fn, 'permitido', null, 'equipe', p_consulta, null, null, p_justificativa);
    return jsonb_build_object('acesso', 'reader', 'medico_id', null, 'pode_editar', false, 'pode_adendo', false);
  end if;
  -- Consulta de outro médico, inexistente ou sem cadastro: mesma resposta (não revela se existe).
  perform private.ws_trilha(p_fn, 'negado', 'sem_vinculo', case when v_doc.id is not null then 'medico' end, p_consulta);
  return jsonb_build_object('erro', 'forbidden');
end $$;

-- Evolução em jsonb para a tela (com filhas e adendos quando finalizada).
create or replace function private.ws_evolucao_json(e prontuario.evolucoes)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'tipo', e.tipo, 'situacao', e.situacao, 'versao', e.versao, 'conteudo', e.conteudo,
    'salvo_em', e.salvo_em, 'finalizada_em', e.finalizada_em, 'encerrada_em', e.encerrada_em, 'criado_em', e.criado_em,
    'hash', e.hash_sha256,
    'medico', (select jsonb_build_object('nome', d.full_name, 'crm', d.crm, 'crm_uf', d.crm_uf) from public.doctors d where d.id = e.medico_id),
    'medidas', coalesce((select jsonb_agg(jsonb_build_object('tipo', m.tipo, 'valor', m.valor, 'unidade', m.unidade,
                         'quem_mediu', m.quem_mediu, 'como_obtido', m.como_obtido, 'aparelho', m.aparelho, 'medido_em', m.medido_em)
                         order by m.ordem) from prontuario.medidas m where m.evolucao_id = e.id), '[]'::jsonb),
    'diagnosticos', coalesce((select jsonb_agg(jsonb_build_object('cid', d.cid, 'descricao', d.descricao, 'papel', d.papel,
                         'situacao', d.situacao) order by d.ordem) from prontuario.diagnosticos d where d.evolucao_id = e.id), '[]'::jsonb));
$$;

-- Fecha o registro (finalizar pelo médico ou encerrar sem finalizar pelo sistema): grava as filhas a partir do
-- rascunho, calcula o hash do conteúdo canônico e encadeia. Chamada só pelas funções abaixo.
create or replace function private.ws_fechar(p_id uuid, p_situacao text)
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  e prontuario.evolucoes;
  v_pos bigint;
  v_ant text;
  v_quando timestamptz := now();
  v_hash text;
  m jsonb;
  d jsonb;
  i integer;
begin
  select * into e from prontuario.evolucoes where id = p_id for update;
  if e.situacao <> 'rascunho' or e.tipo <> 'evolucao' then raise exception 'estado_invalido' using errcode = 'P0001'; end if;
  i := 0;
  for m in select x from jsonb_array_elements(case when jsonb_typeof(e.conteudo #> '{exame,medidas}') = 'array' then e.conteudo #> '{exame,medidas}' else '[]' end) x loop
    i := i + 1;
    insert into prontuario.medidas (evolucao_id, ordem, tipo, valor, unidade, quem_mediu, como_obtido, aparelho, medido_em, registrado_por)
    values (e.id, i, m ->> 'tipo', (m ->> 'valor')::numeric, private.ws_unidade(m ->> 'tipo'), m ->> 'quem_mediu', m ->> 'como_obtido',
            nullif(btrim(coalesce(m ->> 'aparelho', '')), ''), nullif(m ->> 'medido_em', '')::timestamptz, e.medico_id);
  end loop;
  i := 0;
  for d in select x from jsonb_array_elements(case when jsonb_typeof(e.conteudo -> 'diagnosticos') = 'array' then e.conteudo -> 'diagnosticos' else '[]' end) x loop
    i := i + 1;
    insert into prontuario.diagnosticos (evolucao_id, ordem, cid, descricao, papel, situacao, registrado_por)
    values (e.id, i, nullif(d ->> 'cid', ''), btrim(d ->> 'descricao'), d ->> 'papel', d ->> 'situacao', e.medico_id);
  end loop;
  select c.pos, c.anterior into v_pos, v_ant from private.ws_cadeia_proximo() c;
  v_hash := private.ws_hash(private.ws_canonico(e.id, e.teleconsulta_id, e.medico_id, e.tipo, e.adendo_de, p_situacao, e.conteudo, v_quando, v_ant));
  update prontuario.evolucoes
     set situacao = p_situacao,
         finalizada_em = case when p_situacao = 'finalizada' then v_quando end,
         encerrada_em = case when p_situacao = 'encerrada_sem_finalizar' then v_quando end,
         hash_sha256 = v_hash, hash_anterior = v_ant, cadeia_pos = v_pos
   where id = e.id;
  return v_hash;
end $$;

-- pg_cron: rascunho de consulta fora do prazo (24 h) vira 'encerrada_sem_finalizar' (nunca 'finalizada').
create or replace function private.ws_encerrar_rascunhos()
returns integer
language plpgsql volatile
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_hash text;
begin
  for r in select e.id, e.teleconsulta_id, e.versao from prontuario.evolucoes e join public.teleconsultations t on t.id = e.teleconsulta_id
           where e.situacao = 'rascunho' and not private.tele_in_window(t)
           order by e.criado_em limit 200 loop
    v_hash := private.ws_fechar(r.id, 'encerrada_sem_finalizar');
    insert into prontuario.trilha_escrita (user_id, papel, fn, operacao, objeto_tipo, objeto_id, teleconsulta_id, versao_antes, versao_depois, hash_depois, origem)
    values (null, 'sistema', 'ws_encerrar_rascunhos', 'encerrar_sem_finalizar', 'evolucao', r.id, r.teleconsulta_id, r.versao, r.versao, v_hash, 'pg_cron');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Carga da CID-10: texto do arquivo gerado pelo workflow cid10.yml (UTF-8, separado por TAB, cabeçalho
-- "codigo	capitulo	restr_sexo	descricao	descricao_abrev"). Upsert; nada se apaga. Rodar como postgres:
--   select private.cid10_carregar(<texto>, 'DATASUS CID10CSV (OMS; tradução CBCD/FSP-USP)', '2008');
create or replace function private.cid10_linhas(p_texto text)
returns table (codigo text, capitulo smallint, restr_sexo text, descricao text, descricao_abrev text)
language sql immutable
set search_path = ''
as $$
  select distinct on (m[1]) m[1], nullif(m[2], '')::smallint, nullif(m[3], ''), btrim(m[4]), nullif(btrim(m[5]), '')
  from regexp_split_to_table(p_texto, '\r?\n') as l,
       regexp_match(l, '^([A-Z][0-9]{2}[0-9X]?)\t([0-9]{0,2})\t([FM]?)\t([^\t]+)\t([^\t]*)$') as m
  where m is not null and char_length(btrim(m[4])) between 2 and 400 and char_length(m[5]) <= 200
  order by m[1];
$$;

create or replace function private.cid10_carregar(p_texto text, p_fonte text, p_fonte_versao text)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  n_linhas integer;
  n_gravadas integer;
begin
  select count(*) into n_linhas from private.cid10_linhas(p_texto);
  if n_linhas = 0 then raise exception 'arquivo sem linhas válidas' using errcode = 'P0001'; end if;
  insert into catalogo.cid10 as c (codigo, categoria, capitulo, descricao, descricao_abrev, restr_sexo, busca, fonte, fonte_versao, carregado_em)
  select x.codigo, char_length(x.codigo) = 3, x.capitulo, x.descricao, x.descricao_abrev, x.restr_sexo,
         private.ws_fold(x.codigo || ' ' || case when char_length(x.codigo) = 4 then left(x.codigo, 3) || '.' || right(x.codigo, 1) else x.codigo end
                         || ' ' || x.descricao || ' ' || coalesce(x.descricao_abrev, '')),
         p_fonte, p_fonte_versao, now()
  from private.cid10_linhas(p_texto) x
  on conflict (codigo) do update
    set categoria = excluded.categoria, capitulo = excluded.capitulo, descricao = excluded.descricao,
        descricao_abrev = excluded.descricao_abrev, restr_sexo = excluded.restr_sexo, busca = excluded.busca,
        fonte = excluded.fonte, fonte_versao = excluded.fonte_versao, carregado_em = now()
    where (c.categoria, c.capitulo, c.descricao, c.descricao_abrev, c.restr_sexo, c.fonte, c.fonte_versao)
          is distinct from (excluded.categoria, excluded.capitulo, excluded.descricao, excluded.descricao_abrev,
                            excluded.restr_sexo, excluded.fonte, excluded.fonte_versao);
  get diagnostics n_gravadas = row_count;
  return jsonb_build_object('linhas_validas', n_linhas, 'gravadas', n_gravadas,
                            'total', (select count(*) from catalogo.cid10),
                            'categorias', (select count(*) from catalogo.cid10 where categoria),
                            'subcategorias', (select count(*) from catalogo.cid10 where not categoria));
end $$;

revoke all on function private.ws_fold(text) from public, anon, authenticated, service_role;
revoke all on function private.ws_unidade(text) from public, anon, authenticated, service_role;
revoke all on function private.ws_faixa_ok(text, numeric) from public, anon, authenticated, service_role;
revoke all on function private.ws_conteudo_erro(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.ws_conteudo_vazio(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.ws_ts(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.ws_canonico(uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, text) from public, anon, authenticated, service_role;
revoke all on function private.ws_hash(text) from public, anon, authenticated, service_role;
revoke all on function private.ws_cadeia_proximo() from public, anon, authenticated, service_role;
revoke all on function private.ws_trilha(text, text, text, text, uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.ws_escrita(text, text, text, uuid, uuid, integer, integer, text) from public, anon, authenticated, service_role;
revoke all on function private.ws_acesso(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function private.ws_evolucao_json(prontuario.evolucoes) from public, anon, authenticated, service_role;
revoke all on function private.ws_fechar(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.ws_encerrar_rascunhos() from public, anon, authenticated, service_role;
revoke all on function private.cid10_linhas(text) from public, anon, authenticated, service_role;
revoke all on function private.cid10_carregar(text, text, text) from public, anon, authenticated, service_role;

/* ===================== 7. Funções da API (médico) ===================== */
-- Abre o registro da consulta: a evolução (rascunho ou finalizada, com filhas) e os adendos. Sem evolução ainda:
-- "evolucao": null (o primeiro salvamento cria). Equipe médica: p_justificativa obrigatória.
create or replace function public.ws_registro_abrir(p_consulta uuid, p_justificativa text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  a jsonb := private.ws_acesso(p_consulta, 'ws_registro_abrir', p_justificativa);
  e prontuario.evolucoes;
begin
  if a ? 'erro' then return a; end if;
  select * into e from prontuario.evolucoes x where x.teleconsulta_id = p_consulta and x.tipo = 'evolucao';
  return jsonb_build_object(
    'acesso', a ->> 'acesso', 'pode_editar', (a ->> 'pode_editar')::boolean and coalesce(e.situacao, 'rascunho') = 'rascunho',
    'pode_adendo', (a ->> 'pode_adendo')::boolean and coalesce(e.situacao in ('finalizada', 'encerrada_sem_finalizar'), false),
    'assinatura', 'registro não assinado digitalmente',
    'evolucao', case when e.id is not null then private.ws_evolucao_json(e) end,
    'adendos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'texto', x.conteudo ->> 'texto', 'finalizada_em', x.finalizada_em,
                         'hash', x.hash_sha256, 'medico', (select jsonb_build_object('nome', d.full_name, 'crm', d.crm, 'crm_uf', d.crm_uf)
                                                          from public.doctors d where d.id = x.medico_id)) order by x.finalizada_em, x.id)
                         from prontuario.evolucoes x where x.teleconsulta_id = p_consulta and x.tipo = 'adendo'), '[]'::jsonb));
end $$;

-- Salva o rascunho (cria no primeiro salvamento: p_versao = 0). Versão diferente da do banco: versao_conflito (outra
-- aba ou outro aparelho salvou antes), com a versão e o conteúdo de agora para a tela decidir.
create or replace function public.ws_registro_salvar(p_consulta uuid, p_conteudo jsonb, p_versao integer)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  a jsonb := private.ws_acesso(p_consulta, 'ws_registro_salvar');
  e prontuario.evolucoes;
  v_err text;
  v_medico uuid;
  v_ult timestamptz;
begin
  if a ? 'erro' then return a; end if;
  if not (a ->> 'pode_editar')::boolean then return jsonb_build_object('erro', 'prazo_encerrado'); end if;
  v_err := private.ws_conteudo_erro(p_conteudo);
  if v_err is not null then return jsonb_build_object('erro', 'dados_invalidos', 'campo', v_err); end if;
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_conteudo -> 'diagnosticos') = 'array' then p_conteudo -> 'diagnosticos' else '[]' end) x
             where coalesce(x ->> 'cid', '') <> '' and not exists (select 1 from catalogo.cid10 c where c.codigo = x ->> 'cid')) then
    return jsonb_build_object('erro', 'dados_invalidos', 'campo', 'cid_desconhecido');
  end if;
  v_medico := (a ->> 'medico_id')::uuid;
  perform pg_advisory_xact_lock(7201, hashtext(p_consulta::text));
  select * into e from prontuario.evolucoes x where x.teleconsulta_id = p_consulta and x.tipo = 'evolucao' for update;
  if e.id is null then
    if coalesce(p_versao, 0) <> 0 then
      return jsonb_build_object('erro', 'versao_conflito', 'versao', 0, 'conteudo', null);
    end if;
    insert into prontuario.evolucoes (teleconsulta_id, medico_id, tipo, situacao, conteudo, versao)
    values (p_consulta, v_medico, 'evolucao', 'rascunho', p_conteudo, 1)
    returning * into e;
    insert into prontuario.evolucao_versoes (evolucao_id, versao, conteudo, salvo_por) values (e.id, 1, p_conteudo, v_medico);
    perform private.ws_escrita('ws_registro_salvar', 'criar_rascunho', 'evolucao', e.id, p_consulta, null, 1, null);
    return jsonb_build_object('ok', true, 'id', e.id, 'versao', 1, 'salvo_em', e.salvo_em);
  end if;
  if e.situacao <> 'rascunho' then return jsonb_build_object('erro', 'ja_finalizado'); end if;
  if e.versao <> coalesce(p_versao, -1) then
    return jsonb_build_object('erro', 'versao_conflito', 'versao', e.versao, 'conteudo', e.conteudo, 'salvo_em', e.salvo_em);
  end if;
  if e.conteudo = p_conteudo then
    return jsonb_build_object('ok', true, 'id', e.id, 'versao', e.versao, 'salvo_em', e.salvo_em, 'igual', true);
  end if;
  update prontuario.evolucoes set conteudo = p_conteudo, versao = e.versao + 1, salvo_em = now() where id = e.id;
  -- Foto da versão: no máximo uma por minuto, e sempre que trocar SOAP / texto livre.
  select max(v.salvo_em) into v_ult from prontuario.evolucao_versoes v where v.evolucao_id = e.id;
  if v_ult is null or v_ult < now() - interval '60 seconds' or coalesce(e.conteudo ->> 'modo', 'soap') <> coalesce(p_conteudo ->> 'modo', 'soap') then
    insert into prontuario.evolucao_versoes (evolucao_id, versao, conteudo, salvo_por) values (e.id, e.versao + 1, p_conteudo, v_medico);
  end if;
  perform private.ws_escrita('ws_registro_salvar', 'salvar_rascunho', 'evolucao', e.id, p_consulta, e.versao, e.versao + 1, null);
  return jsonb_build_object('ok', true, 'id', e.id, 'versao', e.versao + 1, 'salvo_em', now());
end $$;

-- Finaliza: confere (não vazio, CID do catálogo), grava medidas e diagnósticos, hash encadeado. Depois disso, só adendo.
create or replace function public.ws_registro_finalizar(p_consulta uuid, p_versao integer)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  a jsonb := private.ws_acesso(p_consulta, 'ws_registro_finalizar');
  e prontuario.evolucoes;
  v_err text;
  v_hash text;
begin
  if a ? 'erro' then return a; end if;
  if not (a ->> 'pode_editar')::boolean then return jsonb_build_object('erro', 'prazo_encerrado'); end if;
  perform pg_advisory_xact_lock(7201, hashtext(p_consulta::text));
  select * into e from prontuario.evolucoes x where x.teleconsulta_id = p_consulta and x.tipo = 'evolucao' for update;
  if e.id is null then return jsonb_build_object('erro', 'vazio'); end if;
  if e.situacao <> 'rascunho' then return jsonb_build_object('erro', 'ja_finalizado'); end if;
  if e.versao <> coalesce(p_versao, -1) then
    return jsonb_build_object('erro', 'versao_conflito', 'versao', e.versao, 'conteudo', e.conteudo, 'salvo_em', e.salvo_em);
  end if;
  v_err := private.ws_conteudo_erro(e.conteudo);
  if v_err is not null then return jsonb_build_object('erro', 'dados_invalidos', 'campo', v_err); end if;
  if private.ws_conteudo_vazio(e.conteudo) then return jsonb_build_object('erro', 'vazio'); end if;
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(e.conteudo -> 'diagnosticos') = 'array' then e.conteudo -> 'diagnosticos' else '[]' end) x
             where coalesce(x ->> 'cid', '') <> '' and not exists (select 1 from catalogo.cid10 c where c.codigo = x ->> 'cid')) then
    return jsonb_build_object('erro', 'dados_invalidos', 'campo', 'cid_desconhecido');
  end if;
  v_hash := private.ws_fechar(e.id, 'finalizada');
  perform private.ws_escrita('ws_registro_finalizar', 'finalizar', 'evolucao', e.id, p_consulta, e.versao, e.versao, v_hash);
  select * into e from prontuario.evolucoes where id = e.id;
  return jsonb_build_object('ok', true, 'evolucao', private.ws_evolucao_json(e));
end $$;

-- Adendo: texto novo, com autor e data próprios, finalizado e encadeado na hora. Só depois de finalizar (ou do
-- encerramento sem finalizar). O registro original não muda.
create or replace function public.ws_adendo_criar(p_consulta uuid, p_texto text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  a jsonb := private.ws_acesso(p_consulta, 'ws_adendo_criar');
  e prontuario.evolucoes;
  v_id uuid := gen_random_uuid();
  v_texto text := btrim(coalesce(p_texto, ''));
  v_conteudo jsonb;
  v_pos bigint;
  v_ant text;
  v_quando timestamptz := now();
  v_hash text;
  v_medico uuid;
begin
  if a ? 'erro' then return a; end if;
  if not (a ->> 'pode_adendo')::boolean then return jsonb_build_object('erro', 'forbidden'); end if;
  if char_length(v_texto) not between 3 and 8000 then return jsonb_build_object('erro', 'dados_invalidos', 'campo', 'texto'); end if;
  perform pg_advisory_xact_lock(7201, hashtext(p_consulta::text));
  select * into e from prontuario.evolucoes x where x.teleconsulta_id = p_consulta and x.tipo = 'evolucao';
  if e.id is null or e.situacao = 'rascunho' then return jsonb_build_object('erro', 'nao_finalizado'); end if;
  v_medico := (a ->> 'medico_id')::uuid;
  v_conteudo := jsonb_build_object('texto', v_texto);
  select c.pos, c.anterior into v_pos, v_ant from private.ws_cadeia_proximo() c;
  v_hash := private.ws_hash(private.ws_canonico(v_id, p_consulta, v_medico, 'adendo', e.id, 'finalizada', v_conteudo, v_quando, v_ant));
  insert into prontuario.evolucoes (id, teleconsulta_id, medico_id, tipo, adendo_de, situacao, conteudo, versao, salvo_em,
                                    finalizada_em, hash_sha256, hash_anterior, cadeia_pos)
  values (v_id, p_consulta, v_medico, 'adendo', e.id, 'finalizada', v_conteudo, 1, v_quando, v_quando, v_hash, v_ant, v_pos);
  perform private.ws_escrita('ws_adendo_criar', 'adendo', 'evolucao', v_id, p_consulta, null, 1, v_hash);
  return jsonb_build_object('ok', true, 'id', v_id, 'finalizada_em', v_quando, 'hash', v_hash);
end $$;

-- Linha do tempo do registro desta consulta: criação, versões salvas (fotos), finalização ou encerramento,
-- adendos, diagnósticos e documentos emitidos. Sem o conteúdo das versões (ver ws_registro_versao).
create or replace function public.ws_registro_historico(p_consulta uuid, p_justificativa text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  a jsonb := private.ws_acesso(p_consulta, 'ws_registro_historico', p_justificativa);
begin
  if a ? 'erro' then return a; end if;
  return jsonb_build_object('eventos', coalesce((select jsonb_agg(x.ev order by x.em desc, x.ordem desc) from (
      select v.salvo_em as em, 1 as ordem, jsonb_build_object('tipo', 'versao', 'em', v.salvo_em, 'versao', v.versao, 'evolucao_id', v.evolucao_id,
             'modo', coalesce(v.conteudo ->> 'modo', 'soap')) as ev
      from prontuario.evolucao_versoes v join prontuario.evolucoes e on e.id = v.evolucao_id
      where e.teleconsulta_id = p_consulta
      union all
      select coalesce(e.finalizada_em, e.encerrada_em), 2, jsonb_build_object('tipo', case when e.tipo = 'adendo' then 'adendo' when e.situacao = 'finalizada' then 'finalizado' else 'encerrado_sem_finalizar' end,
             'em', coalesce(e.finalizada_em, e.encerrada_em), 'id', e.id, 'hash', e.hash_sha256,
             'texto', case when e.tipo = 'adendo' then e.conteudo ->> 'texto' end,
             'medico', (select d.full_name from public.doctors d where d.id = e.medico_id))
      from prontuario.evolucoes e
      where e.teleconsulta_id = p_consulta and e.situacao <> 'rascunho'
      union all
      select e.finalizada_em, 3, jsonb_build_object('tipo', 'diagnostico', 'em', e.finalizada_em, 'cid', d.cid, 'descricao', d.descricao,
             'papel', d.papel, 'situacao', d.situacao)
      from prontuario.diagnosticos d join prontuario.evolucoes e on e.id = d.evolucao_id
      where e.teleconsulta_id = p_consulta
      union all
      select doc.created_at, 4, jsonb_build_object('tipo', 'documento', 'em', doc.created_at, 'documento', doc.kind, 'codigo', doc.code)
      from public.tele_documents doc
      where doc.consultation_id = p_consulta
    ) x), '[]'::jsonb),
    'outras_consultas', 'O histórico de outras consultas do mesmo paciente depende do cadastro do paciente e do termo novo (fase 2.2).');
end $$;

-- Conteúdo de uma versão salva do rascunho (histórico de versões).
create or replace function public.ws_registro_versao(p_consulta uuid, p_versao integer, p_justificativa text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  a jsonb := private.ws_acesso(p_consulta, 'ws_registro_versao', p_justificativa);
  r record;
begin
  if a ? 'erro' then return a; end if;
  select v.versao, v.conteudo, v.salvo_em into r
  from prontuario.evolucao_versoes v join prontuario.evolucoes e on e.id = v.evolucao_id
  where e.teleconsulta_id = p_consulta and e.tipo = 'evolucao' and v.versao = p_versao;
  if not found then return jsonb_build_object('erro', 'nao_encontrado'); end if;
  return jsonb_build_object('versao', r.versao, 'conteudo', r.conteudo, 'salvo_em', r.salvo_em);
end $$;

-- Busca na CID-10 (só médico aprovado): por código (A00, A00.0, a000) ou por palavras (todas, sem acento). Até 20.
create or replace function public.cat_cid_buscar(p_q text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_q text := btrim(private.ws_fold(left(coalesce(p_q, ''), 80)));
  v_cod text;
  v_pal text[];
begin
  if auth.uid() is null or not exists (select 1 from public.doctors d where d.user_id = auth.uid() and d.status = 'approved') then
    return jsonb_build_object('erro', 'forbidden');
  end if;
  if char_length(v_q) < 2 then return jsonb_build_object('itens', '[]'::jsonb); end if;
  if v_q ~ '^[a-z][0-9]{1,2}(\.?[0-9x])?$' then
    v_cod := upper(replace(v_q, '.', ''));
    return jsonb_build_object('itens', coalesce((select jsonb_agg(jsonb_build_object('codigo', c.codigo, 'descricao', c.descricao,
             'categoria', c.categoria, 'restr_sexo', c.restr_sexo) order by c.codigo)
           from (select * from catalogo.cid10 c where c.codigo like v_cod || '%' order by c.codigo limit 20) c), '[]'::jsonb),
           'fonte', (select max(c.fonte || ', versão ' || c.fonte_versao) from catalogo.cid10 c));
  end if;
  v_pal := array(select '%' || w || '%' from unnest(string_to_array(v_q, ' ')) w where char_length(w) >= 2 limit 6);
  if cardinality(v_pal) = 0 then return jsonb_build_object('itens', '[]'::jsonb); end if;
  return jsonb_build_object('itens', coalesce((select jsonb_agg(jsonb_build_object('codigo', c.codigo, 'descricao', c.descricao,
           'categoria', c.categoria, 'restr_sexo', c.restr_sexo) order by c.ord, char_length(c.descricao), c.codigo)
         from (select x.codigo, x.descricao, x.categoria, x.restr_sexo,
                      case when private.ws_fold(x.descricao) like substr(v_pal[1], 2) then 0 else 1 end as ord
               from catalogo.cid10 x where x.busca like all (v_pal)
               order by 5, char_length(x.descricao), x.codigo limit 20) c), '[]'::jsonb),
         'fonte', (select max(c.fonte || ', versão ' || c.fonte_versao) from catalogo.cid10 c));
end $$;

-- Confere a cadeia de hash inteira (só a equipe médica do IMED). Devolve o total e os elos que não conferem.
create or replace function public.ws_integridade_conferir()
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  r prontuario.evolucoes;
  v_ant text := null;
  v_total integer := 0;
  v_quebras jsonb := '[]'::jsonb;
begin
  if not private.tele_is_reader() then
    perform private.ws_trilha('ws_integridade_conferir', 'negado', 'nao_equipe', null, null);
    return jsonb_build_object('erro', 'forbidden');
  end if;
  perform private.ws_trilha('ws_integridade_conferir', 'permitido', null, 'equipe', null);
  for r in select * from prontuario.evolucoes where cadeia_pos is not null order by cadeia_pos loop
    v_total := v_total + 1;
    if r.hash_anterior is distinct from v_ant
       or r.hash_sha256 <> private.ws_hash(private.ws_canonico(r.id, r.teleconsulta_id, r.medico_id, r.tipo, r.adendo_de, r.situacao,
                                                               r.conteudo, coalesce(r.finalizada_em, r.encerrada_em), r.hash_anterior)) then
      v_quebras := v_quebras || jsonb_build_array(jsonb_build_object('pos', r.cadeia_pos, 'id', r.id));
    end if;
    v_ant := r.hash_sha256;
  end loop;
  return jsonb_build_object('total', v_total, 'quebras', v_quebras, 'ultimo_hash', v_ant);
end $$;

revoke all on function public.ws_registro_abrir(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.ws_registro_salvar(uuid, jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function public.ws_registro_finalizar(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.ws_adendo_criar(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.ws_registro_historico(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.ws_registro_versao(uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.cat_cid_buscar(text) from public, anon, authenticated, service_role;
revoke all on function public.ws_integridade_conferir() from public, anon, authenticated, service_role;
grant execute on function public.ws_registro_abrir(uuid, text) to authenticated;
grant execute on function public.ws_registro_salvar(uuid, jsonb, integer) to authenticated;
grant execute on function public.ws_registro_finalizar(uuid, integer) to authenticated;
grant execute on function public.ws_adendo_criar(uuid, text) to authenticated;
grant execute on function public.ws_registro_historico(uuid, text) to authenticated;
grant execute on function public.ws_registro_versao(uuid, integer, text) to authenticated;
grant execute on function public.cat_cid_buscar(text) to authenticated;
grant execute on function public.ws_integridade_conferir() to authenticated;

/* ===================== 8. Rascunho esquecido (pg_cron, a cada hora) ===================== */
select cron.schedule('imed-prontuario-encerra', '23 * * * *', 'select private.ws_encerrar_rascunhos()');
