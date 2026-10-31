-- iMed Agenda, fase 3.0 (preparo do banco de verdade no GitHub), 31/10/2026.
-- O número da versão (20261031000000) é provisório: ao aplicar na produção, renomeie o arquivo com a versão
-- que o Supabase gravar (e o da volta, em supabase/volta/, com o mesmo nome). Só junte o ramo na main DEPOIS
-- disso: a main não pode ter migração com um número que não existe na produção.
--
-- Em linguagem simples, esta migração:
--   1. Cria private.app_settings: configurações do servidor que NÃO são segredo (hoje, só o endereço das Edge
--      Functions do projeto, chave 'functions_url'). Fica no schema private (a API não alcança), com RLS ligada
--      e sem nenhuma permissão para anon, authenticated e service_role. O endereço aceito é só
--      https://<projeto>.supabase.co/functions/v1 (sem barra no fim); http:// só para endereço desta máquina
--      (127.0.0.1, localhost, kong, host.docker.internal), que é o que os testes usam.
--   2. A fila de importação (private.process_import_queue, que o pg_cron roda a cada minuto) deixa de ter o
--      endereço da produção escrito no código: lê de private.app_settings. SEM o endereço, nada é chamado e a fila
--      não muda; se houver cidade esperando, a execução FALHA com o aviso "Fila de importação parada: falta o
--      endereço das funções" (aparece como "failed" no histórico do pg_cron, em vez de parar em silêncio).
--      Assim o banco de testes do GitHub, uma cópia local ou qualquer banco novo nunca chamam a produção. COM o
--      endereço, faz exatamente o que fazia antes: os mesmos passos, o mesmo token interno (private.app_tokens,
--      nome 'importer', no cabeçalho x-imed-token), o mesmo corpo e o mesmo tempo-limite.
--   3. Limpa todo dia o histórico do pg_cron (cron.job_run_details) com mais de 7 dias (job imed-limpeza-cron,
--      03:41 UTC = 00:41 em Brasília). Hoje entram cerca de 1.600 linhas por dia (1.440 da fila, que roda a cada
--      minuto, e 144 da teleconsulta), sem limpeza nenhuma.
--
-- Na produção, LOGO DEPOIS de aplicar (não é segredo: é o endereço público das funções do projeto, o mesmo que
-- estava escrito no código):
--   insert into private.app_settings (key, value)
--   values ('functions_url', 'https://pyoqiecupxhdzigjudyd.supabase.co/functions/v1')
--   on conflict (key) do update set value = excluded.value, updated_at = now();
-- Conferir (tem de dar true; false = o endereço não está lá, ou está diferente):
--   select count(*) = 1 from private.app_settings
--   where key = 'functions_url' and value = 'https://pyoqiecupxhdzigjudyd.supabase.co/functions/v1';
-- Se a migração for desfeita (supabase/volta/) e aplicada de novo, grave o functions_url de novo: a volta apaga
-- a tabela junto com o endereço.
--
-- Nada é apagado e tudo pode rodar de novo sem erro. Volta: supabase/volta/20261031000000_agenda_preparo.sql
-- (testada no CI: o banco depois da volta tem de ficar igual ao banco sem esta migração, e a reaplicação, igual
-- ao banco com ela).

/* ===================== 1. Configurações do servidor ===================== */
create table if not exists private.app_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  value text not null check (char_length(value) between 1 and 500),
  updated_at timestamptz not null default now()
);
-- O endereço das funções (a fila monta '<endereço>/importar-clinicas'): https no endereço do projeto no Supabase,
-- sem barra no fim. http só para endereço desta máquina (testes): o token interno nunca vai em texto aberto pela
-- internet nem para outro servidor por causa de um erro de digitação.
-- Criada só se ainda não existir (sem DROP: aplicar de novo não muda nada).
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'private.app_settings'::regclass and conname = 'app_settings_functions_url_ck') then
    alter table private.app_settings add constraint app_settings_functions_url_ck check (
      key <> 'functions_url'
      or value ~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1$'
      or value ~ '^http://(127\.0\.0\.1|localhost|kong|host\.docker\.internal)(:[0-9]{1,5})?/functions/v1$'
    );
  end if;
end $$;
comment on table private.app_settings is
  'Configurações do servidor que não são segredo (ex.: functions_url, o endereço das Edge Functions do projeto). '
  'Banco sem functions_url (testes do GitHub, cópia local) não chama nenhuma função. Segredos ficam no Vault ou em private.app_tokens.';
alter table private.app_settings enable row level security;
revoke all on table private.app_settings from public, anon, authenticated, service_role;

/* ===================== 2. Fila de importação lê o endereço de app_settings ===================== */
-- Igual à versão de 20261030021434_fila_importacao, com uma diferença: o endereço vem de private.app_settings.
-- Sem ele, nada é chamado nem marcado; com cidade esperando, a execução falha com o aviso (fila parada).
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
  -- Sem o endereço das funções (banco de testes, cópia local, banco novo): nada é chamado e a fila não muda.
  select nullif(btrim(s.value), '') into base from private.app_settings s where s.key = 'functions_url';
  if base is null then
    if exists (select 1 from public.import_queue where status in ('pending', 'sent')) then
      raise exception 'Fila de importação parada: falta o endereço das funções (private.app_settings, chave functions_url)'
        using errcode = '55000',
              hint = 'Na produção, grave o endereço (veja o cabeçalho da migração agenda_preparo). Em banco de teste, é o esperado.';
    end if;
    return;
  end if;

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
