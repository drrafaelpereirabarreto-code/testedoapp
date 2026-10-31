-- iMed Agenda, fase 3.0 (preparo do banco de verdade no GitHub), 31/10/2026.
-- O número da versão (20261031000000) é provisório: ao aplicar na produção, renomeie o arquivo com a versão
-- que o Supabase gravar (e o da volta, em supabase/volta/, com o mesmo nome).
--
-- Em linguagem simples, esta migração:
--   1. Cria private.app_settings: configurações do servidor que NÃO são segredo (hoje, só o endereço das Edge
--      Functions do projeto, chave 'functions_url'). Fica no schema private (a API não alcança), com RLS ligada
--      e sem nenhuma permissão para anon, authenticated e service_role.
--   2. A fila de importação (private.process_import_queue, que o pg_cron roda a cada minuto) deixa de ter o
--      endereço da produção escrito no código: lê de private.app_settings. SEM o endereço, não faz nada (a fila
--      fica parada, nada é marcado e nada é chamado). Assim o banco de testes do GitHub, uma cópia local ou
--      qualquer banco novo nunca chamam a produção. COM o endereço, faz exatamente o que fazia antes: os mesmos
--      passos, o mesmo token interno (private.app_tokens, nome 'importer', no cabeçalho x-imed-token), o mesmo
--      corpo e o mesmo tempo-limite.
--   3. Limpa todo dia o histórico do pg_cron (cron.job_run_details) com mais de 7 dias (job imed-limpeza-cron,
--      03:41 UTC = 00:41 em Brasília). Hoje são 1.400 linhas a mais por dia, sem limpeza nenhuma.
--
-- Na produção, logo depois de aplicar (não é segredo: é o endereço público das funções do projeto):
--   insert into private.app_settings (key, value)
--   values ('functions_url', 'https://pyoqiecupxhdzigjudyd.supabase.co/functions/v1')
--   on conflict (key) do update set value = excluded.value, updated_at = now();
-- Enquanto o endereço não estiver lá, a fila só espera (nada se perde).
--
-- Nada é apagado e tudo pode rodar de novo sem erro. Volta: supabase/volta/20261031000000_agenda_preparo.sql
-- (testada no CI: volta, reaplica e o banco tem de ficar igual).

/* ===================== 1. Configurações do servidor ===================== */
create table if not exists private.app_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  value text not null check (char_length(value) between 1 and 500),
  updated_at timestamptz not null default now(),
  -- O endereço das funções: http(s), sem espaço e sem barra no fim (a função monta '<endereço>/<nome da função>').
  constraint app_settings_functions_url_ck
    check (key <> 'functions_url' or value ~ '^https?://[^\s/?#]+(/[^\s?#]*[^\s?#/])?$')
);
comment on table private.app_settings is
  'Configurações do servidor que não são segredo (ex.: functions_url, o endereço das Edge Functions do projeto). '
  'Banco sem functions_url (testes do GitHub, cópia local) não chama nenhuma função. Segredos ficam no Vault ou em private.app_tokens.';
alter table private.app_settings enable row level security;
revoke all on table private.app_settings from public, anon, authenticated, service_role;

/* ===================== 2. Fila de importação lê o endereço de app_settings ===================== */
-- Igual à versão de 20261030021434_fila_importacao, com uma diferença: o endereço vem de private.app_settings e,
-- sem ele, a função sai antes de mexer na fila.
create or replace function private.process_import_queue()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q record;
  tok text;
  running integer;
  base text;
begin
  -- Sem o endereço das funções (banco de testes, cópia local, banco novo): a fila fica parada e nada é chamado.
  select nullif(btrim(s.value), '') into base from private.app_settings s where s.key = 'functions_url';
  if base is null then return; end if;

  -- cidades enviadas: terminam quando a importação delas termina
  update public.import_queue iq set status = case ei.status when 'done' then 'done' else 'error' end, error = ei.error
  from public.establishment_imports ei
  where iq.status = 'sent' and ei.city_ibge = iq.city_ibge and ei.status in ('done', 'error');
  -- envio sem resposta em 10 minutos volta para a fila (até 3 tentativas)
  update public.import_queue set status = case when attempts >= 3 then 'error' else 'pending' end
  where status = 'sent' and last_try < now() - interval '10 minutes';

  select count(*) into running from public.establishment_imports
  where status = 'running' and started_at > now() - interval '15 minutes';
  if running >= 2 then return; end if;

  select token into tok from private.app_tokens where name = 'importer';
  for q in
    select id, uf, city_name from public.import_queue
    where status = 'pending' order by priority, id limit 2 - running
  loop
    update public.import_queue set status = 'sent', attempts = attempts + 1, last_try = now() where id = q.id;
    perform net.http_post(
      url := base || '/importar-clinicas',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-imed-token', tok),
      body := jsonb_build_object('action', 'importar', 'fila', q.id, 'uf', q.uf, 'cidade', q.city_name),
      timeout_milliseconds := 30000
    );
  end loop;
end $$;
-- Como antes (migração de segurança): só o pg_cron (dono postgres) chama.
revoke execute on function private.process_import_queue() from public, anon, authenticated;

/* ===================== 3. Limpeza diária do histórico do pg_cron ===================== */
-- Apaga as execuções terminadas (ou começadas, se nunca terminaram) há mais de p_dias dias (mínimo 1).
-- Devolve quantas linhas apagou. Só o pg_cron chama (dono postgres).
create or replace function private.cron_limpar_historico(p_dias integer default 7)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  delete from cron.job_run_details
  where coalesce(end_time, start_time) < now() - make_interval(days => greatest(coalesce(p_dias, 7), 1));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.cron_limpar_historico(integer) from public, anon, authenticated, service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'imed-limpeza-cron';
select cron.schedule('imed-limpeza-cron', '41 3 * * *', 'select private.cron_limpar_historico(7)');
