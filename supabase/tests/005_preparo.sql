-- Migração de preparo da fase 3.0 (supabase/migrations/*_agenda_preparo.sql):
--   - private.app_settings fechada para a API (tabela inteira e coluna por coluna);
--   - só aceita o endereço das funções em https://<projeto>.supabase.co/functions/v1 (http só desta máquina);
--   - a fila de importação, sem o endereço, não chama nada e não muda (com cidade esperando, falha com aviso
--     claro, em vez de parar em silêncio) e, com o endereço, monta a chamada igual à de antes (mesmo token
--     interno, corpo e tempo-limite);
--   - limpeza diária do histórico do pg_cron.
-- Tudo dentro de uma transação desfeita no fim: a chamada HTTP enfileirada no pg_net some junto (nada é enviado),
-- e o endereço usado no teste é local (127.0.0.1, porta 9) de qualquer forma.
begin;
select plan(23);

/* ===================== private.app_settings ===================== */

select has_table('private', 'app_settings', 'private.app_settings existe');

select ok((select relrowsecurity from pg_class where oid = 'private.app_settings'::regclass),
          'private.app_settings com RLS ligada');

select is(
  array(select r || ' ' || lower(p)
        from unnest(array['anon', 'authenticated', 'service_role']) r,
             unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
        where has_table_privilege(r, 'private.app_settings', p)
           or (p in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
               and has_any_column_privilege(r, 'private.app_settings', p))
        order by 1),
  '{}'::text[],
  'private.app_settings sem nenhuma permissão (nem por coluna) para anon, authenticated e service_role'
);

/* ===================== Fila de importação sem o endereço: não chama nada ===================== */

select is((select count(*)::int from private.app_settings where key = 'functions_url'), 0,
          'banco novo não tem o endereço das funções');

select ok((select count(*) from public.import_queue where status = 'pending') >= 2,
          'a fila tem cidades esperando (as da migração fila_importacao)');

-- Antes: a fila inteira e o último pedido HTTP do pg_net (conta só o que for enfileirado DEPOIS daqui; um pedido
-- antigo que o pg_net consumir no meio do teste não muda a conta).
create temp table fila_antes on commit drop as select id, status, attempts, last_try from public.import_queue;
do $$
begin
  perform set_config('teste.ultimo_http', coalesce((select max(id) from net.http_request_queue), 0)::text, true);
end $$;

select throws_ok(
  $$ select private.process_import_queue() $$,
  '55000', 'Fila de importação parada: falta o endereço das funções (private.app_settings, chave functions_url)',
  'sem o endereço e com cidade esperando: falha com aviso claro (aparece como "failed" no pg_cron)'
);

-- Sem cidade esperando, sem o endereço: termina sem erro e sem fazer nada.
update public.import_queue set status = 'done' where status in ('pending', 'sent');
select lives_ok($$ select private.process_import_queue() $$,
                'sem o endereço e sem cidade esperando: termina sem erro');
update public.import_queue q set status = a.status from fila_antes a where a.id = q.id;

select is((select count(*)::int from net.http_request_queue where id > current_setting('teste.ultimo_http')::bigint), 0,
          'sem o endereço, nenhuma chamada HTTP é enfileirada');

select is(
  (select count(*)::int from public.import_queue q join fila_antes a using (id)
   where (q.status, q.attempts, q.last_try) is distinct from (a.status, a.attempts, a.last_try)),
  0, 'sem o endereço, a fila não muda (nada marcado como enviado)');

/* ===================== Regra do endereço ===================== */

select throws_ok(
  $$ insert into private.app_settings (key, value) values ('functions_url', 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/') $$,
  '23514', null, 'endereço com barra no fim é recusado (a função monta <endereço>/importar-clinicas)');

select throws_ok(
  $$ insert into private.app_settings (key, value) values ('functions_url', 'http://abcdefghijklmnopqrst.supabase.co/functions/v1') $$,
  '23514', null, 'http:// pela internet é recusado (o token interno iria em texto aberto)');

select throws_ok(
  $$ insert into private.app_settings (key, value) values ('functions_url', 'https://outro-servidor.example.com/functions/v1') $$,
  '23514', null, 'outro servidor é recusado (só o endereço do projeto no Supabase)');

select lives_ok(
  $$ insert into private.app_settings (key, value) values ('functions_url', 'https://abcdefghijklmnopqrst.supabase.co/functions/v1')
     on conflict (key) do update set value = excluded.value $$,
  'https://<projeto>.supabase.co/functions/v1 é aceito (o formato da produção)');

select lives_ok(
  $$ insert into private.app_settings (key, value) values ('functions_url', 'http://kong:8000/functions/v1')
     on conflict (key) do update set value = excluded.value $$,
  'http:// desta máquina é aceito (testes: kong, 127.0.0.1, localhost)');

/* ===================== Com o endereço: a mesma chamada de antes ===================== */

insert into private.app_settings (key, value) values ('functions_url', 'http://127.0.0.1:9/functions/v1')
on conflict (key) do update set value = excluded.value;
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

-- O corpo inteiro de cada chamada é o das cidades marcadas agora (now() é o mesmo dentro da transação).
select is(
  array(select convert_from(q.body, 'UTF8')::jsonb
        from net.http_request_queue q where q.url = 'http://127.0.0.1:9/functions/v1/importar-clinicas' order by q.id),
  array(select jsonb_build_object('action', 'importar', 'fila', iq.id, 'uf', iq.uf, 'cidade', iq.city_name)
        from public.import_queue iq where iq.status = 'sent' and iq.last_try = now() order by iq.priority, iq.id),
  'corpo de cada chamada igual ao de antes: action importar, fila (id), uf e cidade das cidades marcadas');

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
