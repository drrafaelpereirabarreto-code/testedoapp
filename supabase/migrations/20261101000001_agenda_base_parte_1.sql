-- iMed Agenda, fase 3.1 ("Fundação"), 31/10/2026. Arquitetura: memory/projects/imed-agenda-arquitetura.md
-- (§2.1 a §2.5, §3.1, §3.2, §5, §12 e §14, item 3.1).
-- Aplicada na produção em 5 partes (supabase/migrations/<versão>_agenda_base_parte_1 a 5), cada uma uma
-- migração própria, na ordem: esta é a parte 1 (cabeçalho e blocos 0 a 3). Juntas, são a migração da fundação
-- inteira, bloco a bloco, sem mudança; cada parte repete o bloco 0 (limite de espera e travas) no começo.
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
--      horário, a clínica, o prazo da reserva ou uses_resources de um pedido, ou APAGAR um pedido, sem a marca é
--      recusado, até pelo SQL do painel do Supabase e até com session_replication_role = replica (guardas ALWAYS;
--      há uma saída de emergência registrada, abaixo). Toda mudança de situação vai para o histórico
--      (agenda.status_history): quando, quem, de onde e o motivo, só com códigos.
--   5. Papéis: has_clinic_perm (permissão na clínica inteira), clinic_perm_scope (o escopo dela) e imed_has (equipe
--      do IMED fora de admin_emails; o dono continua sendo is_imed_admin). is_clinic_member passa a contar só dono,
--      gestor, recepção e staff (hoje só existem owner e staff: nada muda). Ninguém ganha acesso novo.
--
-- Emergência no SQL (só se for preciso mudar um pedido, um item ou a ocupação à mão; fica em agenda.audit_log):
--   begin;
--   select set_config('imed.origin', 'sql', true), set_config('imed.reason', '<codigo_do_motivo>', true);
--   update public.appointment_requests set ... where id = '...';
--   commit;
--
-- O que NÃO está aqui, de propósito:
--   - Nenhum comando apaga objeto ou dado que já existe, nem UPDATE em dado existente. A policy "admin atualiza
--     pedidos" fica sem efeito por ALTER POLICY (using false), e as permissões saem por REVOKE (o conector pode
--     pedir confirmação ao dono por causa dos REVOKE: combine antes).
--   - Os CHECKs que precisam ser TROCADOS (papéis novos em clinic_members; situações e cancelled_by novos em
--     appointment_requests) exigem apagar a restrição antiga: vão numa migração pequena separada, antes da 3.3/3.4, aplicada
--     quando o dono puder aprovar. Até lá existem só os papéis owner/staff e as 5 situações de hoje.
--   - Funções de cadastro, motor de horários (3.2), marcar/cancelar/remarcar (3.3), painel e policies por
--     permissão (3.4). O fuso das clínicas que já existem (hoje todas de SP, já no padrão) é conferido quando a
--     clínica confirma o fuso (3.4); clínica nova recebe o fuso pela UF no gatilho.
--
-- Pode rodar de novo sem erro e sem mudar nada (o CI aplica duas vezes seguidas e compara). Volta:
-- supabase/volta/<versão>_agenda_base_parte_5.sql (volta única das 5 partes; testada no CI: depois da volta o banco fica igual ao da produção
-- antes desta migração; reaplicada, igual ao com ela).
--
-- Conferir na produção depois de aplicar (só leitura; tem de dar true):
--   select to_regnamespace('agenda') is not null
--      and (select extnamespace::regnamespace::text from pg_extension where extname = 'btree_gist') = 'extensions'
--      and not has_schema_privilege('anon', 'agenda', 'USAGE') and not has_schema_privilege('authenticated', 'agenda', 'USAGE')
--      and not has_schema_privilege('service_role', 'agenda', 'USAGE')
--      and (select count(*) from pg_tables where schemaname = 'agenda') = 22
--      and (select count(*) from agenda.role_permissions) = 63 and (select count(*) from agenda.status_transitions) = 58
--      and not has_table_privilege('anon', 'public.appointment_requests', 'INSERT')
--      and has_column_privilege('anon', 'public.appointment_requests', 'review_token_hash', 'INSERT')
--      and not has_column_privilege('anon', 'public.appointment_requests', 'channel', 'INSERT')
--      and not has_table_privilege('authenticated', 'public.appointment_requests', 'UPDATE')
--      and not has_table_privilege('authenticated', 'public.appointment_requests', 'DELETE')
--      and (select qual from pg_policies where tablename = 'appointment_requests' and policyname = 'admin atualiza pedidos') = 'false'
--      and (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'A'
--             and tgfoid::regprocedure::text like 'private.agenda\_%') = 23
--      and has_function_privilege('authenticated', 'public.has_clinic_perm(uuid,text)', 'EXECUTE')
--      and not has_function_privilege('anon', 'public.clinic_perm_scope(uuid,text)', 'EXECUTE')
--      and (select count(*) from public.appointment_requests where channel <> 'imed_app' or version <> 1) = 0
--      and (select count(*) from public.clinics where agenda_mode <> 'pedido' or timezone <> 'America/Sao_Paulo') = 0
--      and (select count(*) from agenda.audit_log) = 0;

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

-- Motivo da mudança (imed.reason): só código (letras minúsculas, números e _), nunca texto livre. No máximo 3
-- algarismos seguidos: telefone, CPF ou número de documento não cabem num código (as trilhas não se apagam; LGPD).
create or replace function private.agenda_reason()
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v text := nullif(btrim(current_setting('imed.reason', true)), '');
begin
  if v is not null and (v !~ '^[a-z][a-z0-9_]{2,59}$' or v ~ '[0-9]{4,}') then
    raise exception 'Motivo inválido (imed.reason): use um código com letras minúsculas, números (até 3 seguidos) e _' using errcode = '22023';
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
