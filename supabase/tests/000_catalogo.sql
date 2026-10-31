-- Guardas do catálogo (iMed Agenda, fase 3.0; arquitetura §13): regras de segurança que valem para TODO objeto
-- do banco, conferidas a cada envio num banco criado do zero pelas migrações (.github/workflows/banco.yml).
-- Quando uma guarda reprova, a mensagem traz o que está fora da regra ("have" = o que existe, "want" = o certo).
-- As guardas das fases seguintes já estão aqui e são puladas (SKIP) até o objeto existir.
begin;
select plan(15);

/* ===================== Tabelas ===================== */

select is(
  array(select c.relname::text
        from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
          and not exists (select 1 from pg_depend d
                          where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
        order by 1),
  '{}'::text[],
  'nenhuma tabela de public sem RLS (ligue com: alter table ... enable row level security)'
);

select is(
  array(select format('%s%s', c.relname, case when c.relrowsecurity then '' else ' (sem RLS)' end)
          || coalesce(' (' || (select string_agg(r || ' ' || lower(p), ', ' order by r, p)
                               from unnest(array['anon', 'authenticated', 'service_role']) r,
                                    unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
                               where has_table_privilege(r, c.oid, p)) || ')', '')
        from pg_class c
        where c.relnamespace = 'private'::regnamespace and c.relkind in ('r', 'p')
          and (not c.relrowsecurity
               or exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r,
                                        unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
                          where has_table_privilege(r, c.oid, p)))
        order by 1),
  '{}'::text[],
  'tabelas de private com RLS e sem nenhuma permissão para anon, authenticated e service_role'
);

select ok(
  not has_schema_privilege('anon', 'private', 'USAGE')
  and not has_schema_privilege('authenticated', 'private', 'USAGE')
  and not has_schema_privilege('service_role', 'private', 'USAGE'),
  'schema private sem USAGE para anon, authenticated e service_role (a API não alcança)'
);

/* ===================== Funções ===================== */

-- SECURITY DEFINER sempre com search_path vazio. Exceção conhecida e listada (arquitetura §13):
-- public.imported_cities, com search_path=public (só lê tabelas de public; trocar exige testar as páginas de cidade).
select is(
  array(select format('%I.%I(%s): %s', n.nspname, p.proname, oidvectortypes(p.proargtypes),
                      coalesce(array_to_string(p.proconfig, ' '), 'sem search_path'))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private', 'agenda') and p.prosecdef
          and not exists (select 1 from pg_depend d
                          where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
          and not coalesce(p.proconfig, '{}') @> array['search_path=""']
          and not (n.nspname = 'public' and p.proname = 'imported_cities'
                   and coalesce(p.proconfig, '{}') @> array['search_path=public'])
        order by 1),
  '{}'::text[],
  'toda função SECURITY DEFINER tem search_path vazio (set search_path = ''''), fora a exceção listada'
);

-- Quem executa cada função de public: lista permitida para anon e authenticated (PUBLIC vale para os dois).
-- Gerada do estado das migrações e conferida com a produção em 31/10/2026 (82 funções, iguais).
-- Função nova SEM entrada aqui reprova: acrescente a linha com as permissões que ela deve ter
-- ('' = só o servidor; 'authenticated' = só quem está logado; 'anon,authenticated' = qualquer visitante).
create temp table esperado_acl (fn text primary key, acl text not null) on commit drop;
insert into esperado_acl (fn, acl) values
    ('add_my_block(uuid, timestamp with time zone, timestamp with time zone, text)', 'authenticated'),
    ('admin_cobranca_listar(text, integer)', 'authenticated'),
    ('admin_cobranca_salvar(jsonb)', 'authenticated'),
    ('admin_cobranca_status(uuid, text, text)', 'authenticated'),
    ('admin_gestao(integer)', 'authenticated'),
    ('admin_stats(integer)', 'authenticated'),
    ('approve_claim(uuid)', 'authenticated'),
    ('available_slots(uuid, text, date, integer)', 'anon,authenticated'),
    ('cancel_request(uuid, text)', 'anon,authenticated'),
    ('check_appointment_request()', ''),
    ('check_establishment_claim()', ''),
    ('check_internal_token(text, text)', ''),
    ('city_establishments(integer, text, integer, integer)', 'anon,authenticated'),
    ('clinics_with_schedule(uuid[])', 'anon,authenticated'),
    ('cnes_last_update(integer)', 'anon,authenticated'),
    ('establishment_points(double precision, double precision, integer, text, text, boolean, integer)', 'anon,authenticated'),
    ('finish_establishment_import(integer, timestamp with time zone, integer, text)', ''),
    ('import_queue_mark(integer, integer, text, text)', ''),
    ('imported_cities()', 'anon,authenticated'),
    ('is_clinic_member(uuid)', 'authenticated'),
    ('is_imed_admin()', 'authenticated'),
    -- busca pública; o PUBLIC (além de anon e authenticated) vem da migração marketplace, como na produção
    ('nearby_clinics(double precision, double precision, integer, text, text, text, integer, integer, boolean, integer)', 'anon,authenticated,PUBLIC'),
    ('nearby_establishments(double precision, double precision, integer, integer, text, text, boolean, integer)', 'anon,authenticated'),
    ('place_ratings(text[])', 'anon,authenticated'),
    ('place_reviews(text, integer)', 'anon,authenticated'),
    ('reject_claim(uuid, text)', 'authenticated'),
    ('remove_my_block(uuid)', 'authenticated'),
    ('report_place_issue(text, uuid, text, text)', 'anon,authenticated'),
    ('request_status(uuid[], text[])', 'anon,authenticated'),
    ('save_claim_checks(uuid, jsonb)', 'authenticated'),
    ('save_establishment_geocodes(integer, jsonb)', ''),
    ('send_contact(text, text, text, text, text)', 'anon,authenticated'),
    ('set_contact_status(uuid, text)', 'authenticated'),
    ('set_my_clinic_exams(uuid, jsonb)', 'authenticated'),
    ('set_my_schedule(uuid, jsonb)', 'authenticated'),
    ('set_place_report_status(uuid, text)', 'authenticated'),
    ('set_request_status(uuid, text)', 'authenticated'),
    ('start_establishment_import(integer, interval)', ''),
    ('submit_review(uuid, text, integer, text)', 'anon,authenticated'),
    ('tele_accept(uuid)', 'authenticated'),
    ('tele_admin_doctors()', 'authenticated'),
    ('tele_admin_documents(integer)', 'authenticated'),
    ('tele_admin_save_checks(uuid, jsonb)', 'authenticated'),
    ('tele_admin_set_doctor(uuid, text, text)', 'authenticated'),
    ('tele_answer(uuid, text, text, integer)', 'anon,authenticated'),
    ('tele_cancel(uuid, text)', 'anon,authenticated'),
    ('tele_dismiss(uuid)', 'authenticated'),
    ('tele_doc_cancel(uuid, text)', 'authenticated'),
    ('tele_doc_create(uuid, text, jsonb, jsonb)', 'authenticated'),
    ('tele_doc_list(uuid)', 'authenticated'),
    ('tele_doc_patient_data(uuid, text, text, boolean, boolean)', 'authenticated'),
    ('tele_doc_pdf(uuid)', 'authenticated'),
    ('tele_doc_pending()', 'authenticated'),
    ('tele_doc_upload(uuid, text)', 'authenticated'),
    ('tele_doc_verify(text)', 'anon,authenticated'),
    ('tele_doctor_me()', 'authenticated'),
    ('tele_doctor_messages(uuid, bigint)', 'authenticated'),
    ('tele_doctor_profile(text, text)', 'authenticated'),
    ('tele_doctor_register(text, text, text, text, text, text)', 'authenticated'),
    ('tele_doctor_send(uuid, text)', 'authenticated'),
    ('tele_doctor_status(uuid)', 'authenticated'),
    ('tele_doctors_online()', 'anon,authenticated'),
    ('tele_end(uuid, text, text)', 'authenticated'),
    ('tele_history()', 'authenticated'),
    ('tele_mark_started(uuid, boolean)', 'authenticated'),
    ('tele_offer(uuid, text)', 'authenticated'),
    ('tele_painel_medico()', 'authenticated'),
    ('tele_patient_details(uuid, text, text, text)', 'anon,authenticated'),
    ('tele_patient_document_pdf(uuid, text, uuid)', 'anon,authenticated'),
    ('tele_patient_documents(uuid, text)', 'anon,authenticated'),
    ('tele_patient_end(uuid, text)', 'anon,authenticated'),
    ('tele_patient_messages(uuid, text, bigint)', 'anon,authenticated'),
    ('tele_patient_send(uuid, text, text)', 'anon,authenticated'),
    ('tele_queue()', 'authenticated'),
    ('tele_request(text, date, text, text, text[], boolean, text, text, boolean, boolean, text, text, boolean)', 'anon,authenticated'),
    ('tele_set_available(boolean)', 'authenticated'),
    ('tele_set_exams(uuid, jsonb, text)', 'authenticated'),
    ('tele_status(uuid, text)', 'anon,authenticated'),
    ('touch_updated_at()', ''),
    ('track(text, text, text)', 'anon,authenticated'),
    ('update_my_clinic(uuid, jsonb)', 'authenticated'),
    ('upsert_establishments(integer, timestamp with time zone, jsonb)', '');

create temp table atual_acl on commit drop as
select format('%I(%s)', p.proname, oidvectortypes(p.proargtypes)) as fn,
       coalesce((select string_agg(x.g, ',' order by x.g)
                 from (select case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end as g
                       from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where a.privilege_type = 'EXECUTE'
                         and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole))) x), '') as acl
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');

select is(
  array(select a.fn || ' → executável por: ' || coalesce(nullif(a.acl, ''), 'só o servidor')
        from atual_acl a left join esperado_acl e using (fn) where e.fn is null order by 1),
  '{}'::text[],
  'toda função de public está na lista de permissões (função nova: acrescente a linha em 000_catalogo.sql)'
);

select is(
  array(select e.fn from esperado_acl e left join atual_acl a using (fn) where a.fn is null order by 1),
  '{}'::text[],
  'nenhuma função da lista sumiu (removeu de propósito? tire a linha da lista)'
);

select is(
  array(select format('%s: executável por "%s", a lista diz "%s"', a.fn, a.acl, e.acl)
        from atual_acl a join esperado_acl e using (fn) where a.acl <> e.acl order by 1),
  '{}'::text[],
  'quem executa cada função de public é exatamente o da lista (anon, authenticated, PUBLIC)'
);

/* ===================== Nada aponta para a produção ===================== */

select is(
  array(select format('%I.%I', n.nspname, p.proname)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private', 'agenda') and p.prosrc ~* 'https?://[a-z0-9-]+\.supabase\.co'
        order by 1),
  '{}'::text[],
  'nenhuma função com o endereço do projeto escrito no código (o endereço fica em private.app_settings)'
);

select is(
  array(select jobname::text from cron.job where command ~* 'https?://' order by 1),
  '{}'::text[],
  'nenhum job do pg_cron com endereço de internet no comando'
);

/* ===================== Guardas das próximas fases (puladas até o objeto existir) ===================== */

-- 3.1: o schema agenda fica fora da API.
select case when to_regnamespace('agenda') is null
  then skip('fase 3.1: o schema agenda ainda não existe', 1)
  else is(array(select r::text from unnest(array['anon', 'authenticated', 'service_role']) r
                where has_schema_privilege(r, 'agenda', 'USAGE') order by 1),
          '{}'::text[], 'schema agenda sem USAGE para anon, authenticated e service_role')
end;

-- 3.1: toda tabela do schema agenda com RLS ligada, sem policy e sem permissão para os papéis da API.
select case when to_regnamespace('agenda') is null
  then skip('fase 3.1: o schema agenda ainda não existe', 1)
  else is(array(select c.relname || case when not c.relrowsecurity then ' (sem RLS)' else '' end
                       || case when exists (select 1 from pg_policy po where po.polrelid = c.oid) then ' (com policy)' else '' end
                       || case when exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r
                                            where has_table_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, DELETE'))
                               then ' (com permissão para a API)' else '' end
                from pg_class c
                where c.relnamespace = to_regnamespace('agenda') and c.relkind in ('r', 'p')
                  and (not c.relrowsecurity
                       or exists (select 1 from pg_policy po where po.polrelid = c.oid)
                       or exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r
                                  where has_table_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, DELETE')))
                order by 1),
          '{}'::text[], 'tabelas do schema agenda: RLS ligada, sem policy e sem permissão para a API')
end;

-- 3.1: as colunas novas do agendamento não podem ser gravadas pelo navegador (INSERT por coluna, §2.3).
select case when not exists (select 1 from pg_attribute
                             where attrelid = 'public.appointment_requests'::regclass and attname = 'channel' and not attisdropped)
  then skip('fase 3.1: appointment_requests ainda não tem as colunas novas', 1)
  else is(array(select r || ': ' || a.attname
                from pg_attribute a, unnest(array['anon', 'authenticated']) r
                where a.attrelid = 'public.appointment_requests'::regclass and not a.attisdropped
                  and a.attname in ('channel', 'slot_end', 'hold_expires_at', 'version', 'updated_at', 'cancel_reason',
                                    'total_cents', 'payment_mode', 'notify_channels', 'uses_resources',
                                    'status', 'user_id', 'cancelled_at', 'cancelled_by')
                  and has_column_privilege(r, 'public.appointment_requests'::regclass, a.attname, 'INSERT')
                order by 1),
          '{}'::text[], 'colunas novas de appointment_requests sem INSERT para anon e authenticated')
end;

-- 3.1: trilhas só de acréscimo (UPDATE, DELETE e TRUNCATE barrados por gatilho).
select case when to_regclass('agenda.status_history') is null
  then skip('fase 3.1: as trilhas (agenda.status_history, audit_log, access_log) ainda não existem', 1)
  else is(array(select t
                from unnest(array['agenda.status_history', 'agenda.audit_log', 'agenda.access_log']) t
                where to_regclass(t) is null
                   -- tgtype: 8 = DELETE, 16 = UPDATE, 32 = TRUNCATE (um gatilho para cada um, ou um só para vários)
                   or not exists (select 1 from pg_trigger g
                                  where g.tgrelid = to_regclass(t) and not g.tgisinternal and (g.tgtype & 16) <> 0)
                   or not exists (select 1 from pg_trigger g
                                  where g.tgrelid = to_regclass(t) and not g.tgisinternal and (g.tgtype & 8) <> 0)
                   or not exists (select 1 from pg_trigger g
                                  where g.tgrelid = to_regclass(t) and not g.tgisinternal and (g.tgtype & 32) <> 0)
                order by 1),
          '{}'::text[], 'trilhas da agenda com guarda contra UPDATE, DELETE e TRUNCATE')
end;

-- 3.3: nenhuma função grava em agenda.occupancy com ON CONFLICT (pularia uma linha em silêncio; §2.5).
select case when to_regclass('agenda.occupancy') is null
  then skip('fase 3.3: agenda.occupancy ainda não existe', 1)
  else is(array(select format('%I.%I', n.nspname, p.proname)
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in ('public', 'private', 'agenda')
                  and p.prosrc ~* 'insert\s+into\s+agenda\.occupancy[^;]*on\s+conflict'
                order by 1),
          '{}'::text[], 'nenhuma função com INSERT ... ON CONFLICT em agenda.occupancy')
end;

-- 3.1: a equipe do IMED fica fora de admin_emails e o is_imed_admin continua só do dono (§12).
select case when to_regclass('private.imed_staff') is null
  then skip('fase 3.1: private.imed_staff ainda não existe', 1)
  else ok(not has_table_privilege('authenticated', 'private.imed_staff', 'SELECT')
          and not has_table_privilege('anon', 'private.imed_staff', 'SELECT'),
          'private.imed_staff fora do alcance de anon e authenticated')
end;

select * from finish();
rollback;
