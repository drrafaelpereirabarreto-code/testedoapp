-- Migração de preparo da fase 3.0 (supabase/migrations/*_agenda_preparo.sql):
--   - private.app_settings fechada para a API;
--   - a fila de importação não faz nada sem o endereço das funções (o banco de testes nunca chama a produção)
--     e, com o endereço, monta a chamada igual à de antes (mesmo token interno, corpo e tempo-limite);
--   - limpeza diária do histórico do pg_cron.
-- Tudo dentro de uma transação desfeita no fim: a chamada HTTP enfileirada no pg_net some junto (nada é enviado),
-- e o endereço usado no teste é local (127.0.0.1, porta 9) de qualquer forma.
begin;
select plan(18);

/* ===================== private.app_settings ===================== */

select has_table('private', 'app_settings', 'private.app_settings existe');

select ok((select relrowsecurity from pg_class where oid = 'private.app_settings'::regclass),
          'private.app_settings com RLS ligada');

select is(
  array(select r || ' ' || lower(p)
        from unnest(array['anon', 'authenticated', 'service_role']) r,
             unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
        where has_table_privilege(r, 'private.app_settings', p)
        order by 1),
  '{}'::text[],
  'private.app_settings sem nenhuma permissão para anon, authenticated e service_role'
);

select throws_ok(
  $$ insert into private.app_settings (key, value) values ('functions_url', 'https://exemplo.test/functions/v1/') $$,
  '23514', null,
  'functions_url com barra no fim é recusado (a função monta <endereço>/importar-clinicas)'
);

/* ===================== Fila de importação sem o endereço: não faz nada ===================== */

select is((select count(*)::int from private.app_settings where key = 'functions_url'), 0,
          'banco novo não tem o endereço das funções');

select ok((select count(*) from public.import_queue where status = 'pending') >= 2,
          'a fila tem cidades esperando (as da migração fila_importacao)');

do $$
begin
  perform set_config('teste.pedidos_http', (select count(*) from net.http_request_queue)::text, true);
  perform set_config('teste.fila', (select string_agg(id || ':' || status || ':' || attempts, ',' order by id)
                                    from public.import_queue), true);
end $$;

select lives_ok($$ select private.process_import_queue() $$, 'a fila roda sem o endereço');

select is((select count(*) from net.http_request_queue)::text, current_setting('teste.pedidos_http'),
          'sem o endereço, nenhuma chamada HTTP é enfileirada');

select is((select string_agg(id || ':' || status || ':' || attempts, ',' order by id) from public.import_queue),
          current_setting('teste.fila'),
          'sem o endereço, a fila não muda (nada marcado como enviado)');

/* ===================== Com o endereço: a mesma chamada de antes ===================== */

insert into private.app_settings (key, value) values ('functions_url', 'http://127.0.0.1:9/functions/v1');
do $$
begin
  perform set_config('teste.enviadas', (select count(*) from public.import_queue where status = 'sent')::text, true);
end $$;
select lives_ok($$ select private.process_import_queue() $$, 'a fila roda com o endereço');

select is((select count(*)::int from public.import_queue where status = 'sent')
            - current_setting('teste.enviadas')::int, 2,
          'duas cidades a mais marcadas como enviadas (2 por minuto, como antes)');

select is((select count(*)::int from net.http_request_queue
           where url = 'http://127.0.0.1:9/functions/v1/importar-clinicas' and method = 'POST'),
          2, 'duas chamadas POST para <endereço>/importar-clinicas');

select ok((select bool_and(q.headers ->> 'x-imed-token' = t.token and q.headers ->> 'Content-Type' = 'application/json'
                           and q.timeout_milliseconds = 30000)
           from net.http_request_queue q, private.app_tokens t
           where q.url = 'http://127.0.0.1:9/functions/v1/importar-clinicas' and t.name = 'importer'),
          'cabeçalho x-imed-token com o token interno de private.app_tokens e tempo-limite de 30 s');

select is((select string_agg(convert_from(q.body, 'UTF8')::jsonb ->> 'action', ',' order by q.id)
           from net.http_request_queue q where q.url = 'http://127.0.0.1:9/functions/v1/importar-clinicas'),
          'importar,importar', 'corpo com action = importar (e fila, uf, cidade)');

/* ===================== pg_cron ===================== */

select is((select schedule || ' | ' || command from cron.job where jobname = 'imed-fila-importacao'),
          '* * * * * | select private.process_import_queue()',
          'o job da fila continua igual (a cada minuto, mesma chamada)');

select is((select schedule || ' | ' || command from cron.job where jobname = 'imed-limpeza-cron'),
          '41 3 * * * | select private.cron_limpar_historico(7)',
          'job diário de limpeza do histórico do pg_cron');

insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
values (0, -101, 0, 'postgres', 'postgres', 'teste antigo', 'succeeded', 'teste', now() - interval '8 days', now() - interval '8 days'),
       (0, -102, 0, 'postgres', 'postgres', 'teste recente', 'succeeded', 'teste', now() - interval '1 day', now() - interval '1 day');

select ok(private.cron_limpar_historico(7) >= 1, 'a limpeza apaga as execuções com mais de 7 dias');

select is(array(select command from cron.job_run_details where runid in (-101, -102) order by runid),
          array['teste recente'], 'e mantém as de menos de 7 dias');

select * from finish();
rollback;
