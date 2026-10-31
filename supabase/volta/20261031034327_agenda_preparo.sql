-- VOLTA da migração supabase/migrations/20261031000000_agenda_preparo.sql (só se for preciso desfazer).
-- Deixa o banco como estava antes dela: a fila de importação volta a ter o endereço da produção escrito no
-- código (versão de 20261030021434_fila_importacao), sem a limpeza do histórico do pg_cron e sem
-- private.app_settings. Tem o mesmo nome da migração; se a migração for renomeada, renomeie esta também.
-- Testada no CI (.github/workflows/banco.yml): o banco depois da volta tem de ficar IGUAL ao banco que nasceu
-- sem a migração (impressão digital), e a reaplicação, igual ao banco com ela.
-- ATENÇÃO: a volta apaga private.app_settings JUNTO com o endereço das funções (functions_url). Se a migração
-- for aplicada de novo depois, grave o functions_url de novo (comando no cabeçalho da migração); sem ele, a
-- fila de importação não chama nada e, com cidade esperando, falha com "Fila de importação parada".
-- Na produção, a versão da migração continua no histórico (supabase_migrations.schema_migrations) depois da
-- volta; reaplicar pelo conector grava uma versão nova: renomeie os dois arquivos com ela.

select cron.unschedule(jobid) from cron.job where jobname = 'imed-limpeza-cron';
drop function if exists private.cron_limpar_historico(integer);

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
begin
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
      url := 'https://pyoqiecupxhdzigjudyd.supabase.co/functions/v1/importar-clinicas',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-imed-token', tok),
      body := jsonb_build_object('action', 'importar', 'fila', q.id, 'uf', q.uf, 'cidade', q.city_name),
      timeout_milliseconds := 30000
    );
  end loop;
end $$;
revoke execute on function private.process_import_queue() from public, anon, authenticated;

drop table if exists private.app_settings;
