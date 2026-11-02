-- Permissões e marca de origem (iMed Agenda, fase 3.1; arquitetura §2.1, §2.3 e §12):
--   - pedido: o navegador grava só as 23 colunas do site (nada de situação, conta, versão ou colunas novas); as
--     colunas novas nascem no padrão; UPDATE e DELETE diretos pela API acabaram (nem o admin), e a policy
--     "admin atualiza pedidos" ficou sem efeito;
--   - guarda de origem: situação, horário e clínica do pedido só mudam com a marca (imed.origin), até para o dono do
--     banco; a emergência pelo SQL exige motivo e fica na auditoria e no histórico; apagar a clínica continua
--     soltando os pedidos dela;
--   - as duas funções de hoje (cancel_request e set_request_status) respondem igual, gravam o histórico com a origem
--     certa (app, painel, central) e não deixam a marca "vazar" para o resto da transação;
--   - clínica: fuso, modalidade e venda online só pelas funções (nem o PATCH do admin); clínica nova nasce no modelo
--     de pedido, com o fuso sugerido pela UF (Fernando de Noronha pelo CNES);
--   - o schema agenda e as funções internas fora do alcance de anon, authenticated e service_role.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(65);

create function pg_temp.entrar(p_papel text, p_usuario uuid default null, p_email text default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_papel = 'postgres' then ''
         else jsonb_strip_nulls(jsonb_build_object(
                'role', p_papel, 'sub', p_usuario, 'email', p_email,
                'aud', case when p_usuario is not null then 'authenticated' end,
                'amr', case when p_usuario is not null then '[{"method": "otp", "timestamp": 1}]'::jsonb end))::text
    end, true);
  perform set_config('role', p_papel, true);
end $$;
create function pg_temp.marca(p_origem text, p_motivo text default null) returns void language plpgsql as $$
begin
  perform set_config('imed.origin', coalesce(p_origem, ''), true);
  perform set_config('imed.reason', coalesce(p_motivo, ''), true);
end $$;

/* ===================== Dados do teste ===================== */
do $$
begin
  perform set_config('teste.dia', ((now() at time zone 'America/Sao_Paulo')::date + 7)::text, true);
  perform set_config('teste.h0900', ((current_setting('teste.dia')::date + '09:00'::time) at time zone 'America/Sao_Paulo')::text, true);
  perform set_config('teste.h0930', ((current_setting('teste.dia')::date + '09:30'::time) at time zone 'America/Sao_Paulo')::text, true);
  perform set_config('teste.hash', encode(extensions.digest('codigo-p1', 'sha256'), 'hex'), true);
end $$;

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'clinica.permissoes@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1200000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'admin.permissoes@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1200000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'paciente.permissoes@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now());
insert into public.admin_emails (email) values ('admin.permissoes@exemplo.test');
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
values
  ('c1200000-0000-4000-8000-000000000001', 'Clínica das Permissões', 'imagem', 'Rua das Permissões, 1', 'São Paulo', 'SP',
   extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false),
  ('c1200000-0000-4000-8000-000000000004', 'Clínica que Será Apagada', 'imagem', 'Rua das Permissões, 4', 'São Paulo', 'SP',
   extensions.st_setsrid(extensions.st_makepoint(-46.64, -23.56), 4326)::extensions.geography, 'published', true, false);
insert into public.clinic_exams (clinic_id, exam_code) values ('c1200000-0000-4000-8000-000000000001', 'usg');
insert into public.clinic_members (clinic_id, user_id, role)
values ('c1200000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000001', 'owner');
insert into public.clinic_schedules (clinic_id, weekday, start_time, end_time, slot_minutes, exam_codes)
values ('c1200000-0000-4000-8000-000000000001', extract(dow from current_setting('teste.dia')::date)::smallint,
        '09:00', '10:00', 30, '{}');

/* ===================== A. INSERT coluna por coluna ===================== */
select pg_temp.entrar('anon');

select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
    patient_name, patient_phone, consent, slot_start, review_token_hash)
  values ('b1200000-0000-4000-8000-000000000001', 'c1200000-0000-4000-8000-000000000001', 'imed', 'Clínica das Permissões',
    'usg', current_setting('teste.dia')::date, 'Paciente Um', '11999991201', true,
    current_setting('teste.h0900')::timestamptz, current_setting('teste.hash'))
$$, 'visitante grava o pedido com as colunas do site');
select throws_ok($$
  insert into public.appointment_requests (place_source, place_name, preferred_date, patient_name, patient_phone, consent, channel)
  values ('cnes', 'Laboratório', current_setting('teste.dia')::date, 'Paciente Canal', '11999991202', true, 'clinica_balcao')
$$, '42501', null, 'visitante não grava coluna nova (channel)');
select throws_ok($$
  insert into public.appointment_requests (place_source, place_name, preferred_date, patient_name, patient_phone, consent, status)
  values ('cnes', 'Laboratório', current_setting('teste.dia')::date, 'Paciente Situação', '11999991203', true, 'confirmed')
$$, '42501', null, 'visitante não grava a situação');
select throws_ok($$
  insert into public.appointment_requests (place_source, place_name, preferred_date, patient_name, patient_phone, consent, created_at)
  values ('cnes', 'Laboratório', current_setting('teste.dia')::date, 'Paciente Data', '11999991204', true, now() - interval '1 year')
$$, '42501', null, 'visitante não grava a data do pedido');

select pg_temp.entrar('authenticated', 'a1200000-0000-4000-8000-000000000004', 'paciente.permissoes@exemplo.test');
select throws_ok($$
  insert into public.appointment_requests (place_source, place_name, preferred_date, patient_name, patient_phone, consent, user_id)
  values ('cnes', 'Laboratório', current_setting('teste.dia')::date, 'Paciente Conta', '11999991205', true,
          'a1200000-0000-4000-8000-000000000001')
$$, '42501', null, 'paciente logado não escolhe a conta do pedido (user_id)');
select throws_ok($$
  insert into public.appointment_requests (place_source, place_name, preferred_date, patient_name, patient_phone, consent, version)
  values ('cnes', 'Laboratório', current_setting('teste.dia')::date, 'Paciente Versão', '11999991206', true, 9)
$$, '42501', null, 'paciente logado não grava a versão');

select pg_temp.entrar('postgres');
select is((select concat_ws('|', status, channel, version, uses_resources::text, payment_mode, notify_channels::text,
                            coalesce(slot_end::text, '-'), coalesce(hold_expires_at::text, '-'), coalesce(cancel_reason, '-'),
                            coalesce(total_cents::text, '-'))
           from public.appointment_requests where id = 'b1200000-0000-4000-8000-000000000001'),
          'confirmed|imed_app|1|false|no_local|{}|-|-|-|-', 'o pedido do site nasce com as colunas novas no padrão');

insert into public.appointment_requests (id, place_source, place_name, preferred_date, patient_name, patient_phone, consent,
                                         channel, version, uses_resources, status)
values ('b1200000-0000-4000-8000-000000000002', 'cnes', 'Laboratório', current_setting('teste.dia')::date, 'Paciente Dois',
        '11999991207', true, 'externo', 7, true, 'confirmed');
select is((select concat_ws('|', status, channel, version, uses_resources::text) from public.appointment_requests
           where id = 'b1200000-0000-4000-8000-000000000002'),
          'pending|imed_app|1|false', 'sem a marca (caminho antigo), até o dono do banco grava com as regras de hoje');

select pg_temp.marca('sql', 'teste_permissoes');
insert into public.appointment_requests (id, clinic_id, place_source, place_name, preferred_date, patient_name, patient_phone,
                                         consent, channel, status, version)
values ('b1200000-0000-4000-8000-000000000003', 'c1200000-0000-4000-8000-000000000001', 'imed', 'Clínica das Permissões',
        current_setting('teste.dia')::date, 'Paciente Três', '11999991208', true, 'clinica_balcao', 'contacted', 5);
select is((select concat_ws('|', status, channel, version) from public.appointment_requests
           where id = 'b1200000-0000-4000-8000-000000000003'),
          'contacted|clinica_balcao|1', 'com a marca (funções da agenda), a função decide situação e canal; a versão nasce 1');
select throws_ok($$
  insert into public.appointment_requests (place_source, place_name, preferred_date, patient_name, patient_phone, consent,
                                           for_other, relationship, other_consent)
  values ('cnes', 'Laboratório', current_setting('teste.dia')::date, 'Paciente Outra', '11999991209', true, true, 'Mãe', true)
$$, '22023', 'Informe o nome de quem vai fazer o exame',
   'com a marca, os dados do paciente passam pela mesma validação (pedido para outra pessoa)');
select pg_temp.marca(null);

/* ===================== B. Sem UPDATE nem DELETE diretos pela API ===================== */
select pg_temp.entrar('authenticated', 'a1200000-0000-4000-8000-000000000003', 'admin.permissoes@exemplo.test');
select ok(public.is_imed_admin(), 'admin reconhecido');
select throws_ok($$ update public.appointment_requests set status = 'cancelled' where id = 'b1200000-0000-4000-8000-000000000002' $$,
                 '42501', null, 'nem o admin muda a situação direto pela API (só pelas funções)');
select throws_ok($$ update public.appointment_requests set notes = 'mudou' where id = 'b1200000-0000-4000-8000-000000000002' $$,
                 '42501', null, 'nem o admin muda outra coluna direto pela API');
select throws_ok($$ delete from public.appointment_requests where id = 'b1200000-0000-4000-8000-000000000002' $$,
                 '42501', null, 'ninguém apaga pedido pela API');
select pg_temp.entrar('postgres');
select is((select qual || '|' || with_check from pg_policies
           where schemaname = 'public' and tablename = 'appointment_requests' and policyname = 'admin atualiza pedidos'),
          'false|false', 'a policy "admin atualiza pedidos" ficou sem efeito (nada foi apagado)');
select is(
  array(select r || ' ' || p from unnest(array['anon', 'authenticated']) r, unnest(array['UPDATE', 'DELETE', 'TRUNCATE']) p
        where has_table_privilege(r, 'public.appointment_requests', p) order by 1),
  '{}'::text[], 'anon e authenticated sem UPDATE, DELETE e TRUNCATE em appointment_requests');

/* ===================== C. Guarda de origem do pedido ===================== */
select throws_ok($$ update public.appointment_requests set status = 'contacted' where id = 'b1200000-0000-4000-8000-000000000002' $$,
                 '42501', 'A situação, o horário e a clínica de um pedido só mudam pelas funções da agenda',
                 'sem a marca, nem o dono do banco muda a situação');
select throws_ok($$ update public.appointment_requests set slot_start = now() + interval '1 day'
                    where id = 'b1200000-0000-4000-8000-000000000002' $$,
                 '42501', null, 'sem a marca, nem o dono do banco muda o horário');
select throws_ok($$ update public.appointment_requests set clinic_id = 'c1200000-0000-4000-8000-000000000001'
                    where id = 'b1200000-0000-4000-8000-000000000002' $$,
                 '42501', null, 'sem a marca, nem o dono do banco muda a clínica');
update public.appointment_requests set notes = 'Observação nova' where id = 'b1200000-0000-4000-8000-000000000002';
select is((select version from public.appointment_requests where id = 'b1200000-0000-4000-8000-000000000002'), 2,
          'coluna fora da guarda muda sem marca, e a versão sobe');
update public.appointment_requests set notes = notes where id = 'b1200000-0000-4000-8000-000000000002';
select is((select version from public.appointment_requests where id = 'b1200000-0000-4000-8000-000000000002'), 2,
          'UPDATE que não muda nada não sobe a versão');
select throws_ok($$ select pg_temp.marca('sql');
                    update public.appointment_requests set status = 'contacted' where id = 'b1200000-0000-4000-8000-000000000002' $$,
                 '42501', null, 'emergência pelo SQL sem motivo é recusada');
select throws_ok($$ select pg_temp.marca('sql', 'Motivo Com Texto Livre');
                    update public.appointment_requests set status = 'contacted' where id = 'b1200000-0000-4000-8000-000000000002' $$,
                 '22023', null, 'motivo tem de ser um código (nada de texto livre)');
select throws_ok($$ select pg_temp.marca('qualquer');
                    update public.appointment_requests set status = 'contacted' where id = 'b1200000-0000-4000-8000-000000000002' $$,
                 '22023', null, 'marca de origem desconhecida é recusada');
select pg_temp.marca('sql', 'correcao_teste');
update public.appointment_requests set status = 'contacted' where id = 'b1200000-0000-4000-8000-000000000002';
select pg_temp.marca(null);
select is((select concat_ws('|', a.action, a.origin, a.actor_kind, a.reason_code, a.old_value ->> 'status', a.new_value ->> 'status')
           from agenda.audit_log a where a.object_id = 'b1200000-0000-4000-8000-000000000002'),
          'pedido_alterado_sql|sql|sql|correcao_teste|pending|contacted', 'a emergência pelo SQL fica na auditoria, com o motivo');
select is((select concat_ws('|', h.from_status, h.to_status, h.origin, h.actor_kind, h.reason_code, h.request_version)
           from agenda.status_history h where h.request_id = 'b1200000-0000-4000-8000-000000000002'),
          'pending|contacted|sql|sql|correcao_teste|3', 'e no histórico de situação, com a versão do pedido');

-- As outras colunas guardadas e o DELETE (revisão da 3.1).
select throws_ok($$ update public.appointment_requests set slot_end = now() + interval '2 days'
                    where id = 'b1200000-0000-4000-8000-000000000002' $$,
                 '42501', null, 'sem a marca, nem o dono do banco muda o fim do horário (slot_end)');
select throws_ok($$ update public.appointment_requests set hold_expires_at = now() + interval '10 minutes'
                    where id = 'b1200000-0000-4000-8000-000000000002' $$,
                 '42501', null, 'sem a marca, nem o dono do banco muda o prazo da reserva (hold_expires_at)');
select throws_ok($$ update public.appointment_requests set uses_resources = true
                    where id = 'b1200000-0000-4000-8000-000000000002' $$,
                 '42501', null, 'sem a marca, nem o dono do banco muda uses_resources');
select throws_ok($$ delete from public.appointment_requests where id = 'b1200000-0000-4000-8000-000000000002' $$,
                 '42501', 'Um pedido só é apagado pelas funções da agenda',
                 'sem a marca, nem o dono do banco (ou a chave de serviço) apaga um pedido');
select throws_ok($$ select pg_temp.marca('sql');
                    insert into public.appointment_requests (id, place_source, place_name, preferred_date, patient_name, patient_phone, consent)
                    values ('b1200000-0000-4000-8000-000000000009', 'cnes', 'Laboratório', current_setting('teste.dia')::date,
                            'Paciente Nove', '11999991219', true) $$,
                 '42501', null, 'pedido criado pelo SQL sem motivo é recusado');
select pg_temp.marca('sql', 'correcao_teste');
insert into public.appointment_requests (id, place_source, place_name, preferred_date, patient_name, patient_phone, consent, status)
values ('b1200000-0000-4000-8000-000000000009', 'cnes', 'Laboratório', current_setting('teste.dia')::date,
        'Paciente Nove', '11999991219', true, 'contacted');
delete from public.appointment_requests where id = 'b1200000-0000-4000-8000-000000000009';
select pg_temp.marca(null);
select is(array(select a.action || '|' || a.reason_code from agenda.audit_log a
                where a.object_id = 'b1200000-0000-4000-8000-000000000009' order by a.id),
          array['pedido_criado_sql|correcao_teste', 'pedido_apagado_sql|correcao_teste'],
          'pedido criado e apagado pelo SQL: os dois ficam na auditoria, com o motivo');
select is((select count(*)::int from agenda.audit_log a
           where a.object_id = 'b1200000-0000-4000-8000-000000000009' and a.new_value ->> 'status' = 'contacted'), 1,
          'a auditoria do pedido criado pelo SQL guarda a situação gravada');

-- Apagar uma clínica continua soltando os pedidos dela (on delete set null), sem marca.
select pg_temp.entrar('anon');
insert into public.appointment_requests (id, clinic_id, place_source, place_ref, place_name, preferred_date, patient_name,
                                         patient_phone, consent)
values ('b1200000-0000-4000-8000-000000000004', 'c1200000-0000-4000-8000-000000000004', 'cnes', 'cnes:1234567',
        'Clínica que Será Apagada', current_setting('teste.dia')::date, 'Paciente Quatro', '11999991210', true);
select pg_temp.entrar('postgres');
select lives_ok($$ delete from public.clinics where id = 'c1200000-0000-4000-8000-000000000004' $$,
                'apagar uma clínica solta os pedidos dela, como antes (a guarda deixa a chave estrangeira agir)');
select is((select coalesce(clinic_id::text, 'sem clínica') || '|' || status from public.appointment_requests
           where id = 'b1200000-0000-4000-8000-000000000004'), 'sem clínica|pending', 'o pedido ficou sem clínica, na mesma situação');

/* ===================== D. As funções de hoje, com a marca ===================== */
select pg_temp.entrar('anon');
select is(public.cancel_request('b1200000-0000-4000-8000-000000000001', 'codigo-p1'), 'ok', 'cancel_request: ok, como antes');
select is(coalesce(current_setting('imed.origin', true), ''), '', 'cancel_request não deixa a marca para o resto da transação');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', h.from_status, h.to_status, h.origin, h.actor_kind, coalesce(h.actor_user::text, '-'),
                            coalesce(h.actor_role, '-'), h.request_version)
           from agenda.status_history h where h.request_id = 'b1200000-0000-4000-8000-000000000001'),
          'confirmed|cancelled|app|paciente|-|-|2', 'cancelamento do paciente no histórico (origem app)');
select is((select status || '|' || cancelled_by || '|' || version from public.appointment_requests
           where id = 'b1200000-0000-4000-8000-000000000001'), 'cancelled|patient|2', 'o pedido cancelado como antes, versão 2');

select pg_temp.entrar('authenticated', 'a1200000-0000-4000-8000-000000000001', 'clinica.permissoes@exemplo.test');
select is(public.set_request_status('b1200000-0000-4000-8000-000000000003', 'confirmed'), 'ok', 'clínica confirma: ok, como antes');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', h.from_status, h.to_status, h.origin, h.actor_kind, h.actor_user, h.actor_role)
           from agenda.status_history h where h.request_id = 'b1200000-0000-4000-8000-000000000003'),
          'contacted|confirmed|painel|clinica|a1200000-0000-4000-8000-000000000001|owner',
          'mudança da clínica no histórico (origem painel, com o papel)');

select pg_temp.entrar('authenticated', 'a1200000-0000-4000-8000-000000000003', 'admin.permissoes@exemplo.test');
select is(public.set_request_status('b1200000-0000-4000-8000-000000000002', 'completed'), 'ok', 'equipe do IMED conclui: ok, como antes');
select is(public.set_request_status('b1200000-0000-4000-8000-000000000002', 'completed'), 'ok', 'concluir de novo: ok, como antes');
select pg_temp.entrar('postgres');
select is(
  array(select concat_ws('|', h.from_status, h.to_status, h.origin, h.actor_kind, h.actor_role)
        from agenda.status_history h where h.request_id = 'b1200000-0000-4000-8000-000000000002' order by h.id),
  array['pending|contacted|sql|sql', 'contacted|completed|central|imed|imed_admin'],
  'mudança da equipe no histórico (origem central); a repetição sem mudança não gera linha');
select is((select version from public.appointment_requests where id = 'b1200000-0000-4000-8000-000000000002'), 4,
          'a repetição sem mudança também não sobe a versão');

-- Reabrir um cancelado cujo horário outro pegou: slot_taken, sem histórico e sem marca sobrando.
select pg_temp.entrar('anon');
insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date, patient_name,
                                         patient_phone, consent, slot_start)
values ('b1200000-0000-4000-8000-000000000005', 'c1200000-0000-4000-8000-000000000001', 'imed', 'Clínica das Permissões', 'usg',
        current_setting('teste.dia')::date, 'Paciente Cinco', '11999991211', true, current_setting('teste.h0900')::timestamptz);
select pg_temp.marca('sql', 'marca_de_fora');
select pg_temp.entrar('authenticated', 'a1200000-0000-4000-8000-000000000003', 'admin.permissoes@exemplo.test');
select is(public.set_request_status('b1200000-0000-4000-8000-000000000001', 'confirmed'), 'slot_taken',
          'admin reabre pedido cujo horário outro pegou: slot_taken, como antes');
select is(current_setting('imed.origin', true) || '|' || current_setting('imed.reason', true), 'sql|marca_de_fora',
          'depois do slot_taken, a marca de quem chamou continua a mesma');
select pg_temp.marca(null);
select pg_temp.entrar('postgres');
select is((select count(*)::int from agenda.status_history where request_id = 'b1200000-0000-4000-8000-000000000001'), 1,
          'o slot_taken não grava histórico');

/* ===================== E. Clínica: fuso, modalidade e venda online ===================== */
select pg_temp.entrar('authenticated', 'a1200000-0000-4000-8000-000000000003', 'admin.permissoes@exemplo.test');
select throws_ok($$ update public.clinics set agenda_mode = 'nativa' where id = 'c1200000-0000-4000-8000-000000000001' $$,
                 '42501', 'Fuso, modalidade da agenda e venda online só mudam pelas funções da agenda',
                 'nem o admin muda a modalidade da agenda direto pela API');
select throws_ok($$ update public.clinics set timezone = 'America/Manaus' where id = 'c1200000-0000-4000-8000-000000000001' $$,
                 '42501', null, 'nem o admin muda o fuso direto pela API');
select throws_ok($$ update public.clinics set timezone_confirmed_at = now() where id = 'c1200000-0000-4000-8000-000000000001' $$,
                 '42501', null, 'confirmação do fuso só pelas funções da agenda');
select throws_ok($$ update public.clinics set agenda_online_since = now() where id = 'c1200000-0000-4000-8000-000000000001' $$,
                 '42501', null, 'venda online só pelas funções da agenda');
select lives_ok($$ update public.clinics set phone = '(11) 3000-1200' where id = 'c1200000-0000-4000-8000-000000000001' $$,
                'o admin continua editando os outros dados da clínica, como antes');
select throws_ok($$ insert into public.clinics (name, kind, address_line, city, state, location, status, agenda_mode)
                    values ('Clínica Nativa', 'imagem', 'Rua X, 1', 'Manaus', 'AM',
                            extensions.st_setsrid(extensions.st_makepoint(-60.02, -3.1), 4326)::extensions.geography,
                            'draft', 'nativa') $$,
                 '42501', null, 'clínica nova não nasce fora do modelo de pedido sem as funções da agenda');
insert into public.clinics (id, name, kind, address_line, city, state, location, status)
values ('c1200000-0000-4000-8000-000000000005', 'Clínica de Manaus', 'imagem', 'Rua X, 2', 'Manaus', 'AM',
        extensions.st_setsrid(extensions.st_makepoint(-60.02, -3.1), 4326)::extensions.geography, 'draft');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', timezone, agenda_mode, coalesce(timezone_confirmed_at::text, '-'), coalesce(agenda_online_since::text, '-'))
           from public.clinics where id = 'c1200000-0000-4000-8000-000000000005'),
          'America/Manaus|pedido|-|-', 'clínica nova: modelo de pedido, fuso sugerido pela UF (AM), não confirmado');
insert into public.clinics (id, name, kind, address_line, city, state, location, status, timezone)
values ('c1200000-0000-4000-8000-000000000006', 'Clínica de Salvador', 'imagem', 'Rua Y, 1', 'Salvador', 'BA',
        extensions.st_setsrid(extensions.st_makepoint(-38.5, -12.97), 4326)::extensions.geography, 'draft', 'America/Sao_Paulo'),
       ('c1200000-0000-4000-8000-000000000007', 'Clínica de Cuiabá', 'imagem', 'Rua Z, 1', 'Cuiabá', 'MT',
        extensions.st_setsrid(extensions.st_makepoint(-56.1, -15.6), 4326)::extensions.geography, 'draft', 'America/Sao_Paulo');
select is(array(select timezone from public.clinics where id in ('c1200000-0000-4000-8000-000000000006',
                                                                'c1200000-0000-4000-8000-000000000007') order by name),
          array['America/Cuiaba', 'America/Bahia'], 'o fuso vem da UF (BA, MT), mesmo se mandarem outro');
insert into public.municipalities (ibge, cnes_code, name, name_key, uf)
values (2605459, 260545, 'Fernando de Noronha', 'fernando de noronha', 'PE') on conflict do nothing;
insert into public.establishments (cnes, name, kind, cnes_type, city_ibge)
values ('9912345', 'Unidade de Noronha', 'clinica', 2, 2605459);
insert into public.clinics (id, name, kind, address_line, city, state, location, status, cnes)
values ('c1200000-0000-4000-8000-000000000008', 'Clínica de Noronha', 'clinica', 'Vila dos Remédios', 'Fernando de Noronha', 'PE',
        extensions.st_setsrid(extensions.st_makepoint(-32.42, -3.85), 4326)::extensions.geography, 'draft', '9912345');
select is((select timezone from public.clinics where id = 'c1200000-0000-4000-8000-000000000008'), 'America/Noronha',
          'Fernando de Noronha (pelo CNES) tem fuso próprio');
select throws_ok($$ update public.clinics set agenda_mode = 'nativa' where id = 'c1200000-0000-4000-8000-000000000005' $$,
                 '42501', null, 'sem a marca, nem o dono do banco muda a modalidade');
select pg_temp.marca('sql', 'teste_fuso');
update public.clinics set timezone = 'America/Eirunepe' where id = 'c1200000-0000-4000-8000-000000000005';
select pg_temp.marca(null);
select is((select concat_ws('|', a.action, a.old_value ->> 'timezone', a.new_value ->> 'timezone', a.reason_code)
           from agenda.audit_log a where a.object_type = 'clinic' and a.object_id = 'c1200000-0000-4000-8000-000000000005'),
          'clinica_agenda_sql|America/Manaus|America/Eirunepe|teste_fuso', 'mudança de fuso pelo SQL fica na auditoria');
select pg_temp.entrar('authenticated', 'a1200000-0000-4000-8000-000000000001', 'clinica.permissoes@exemplo.test');
select is(public.update_my_clinic('c1200000-0000-4000-8000-000000000001', '{"phone": "(11) 3000-1201"}'), 'ok',
          'a clínica continua editando o próprio cadastro (update_my_clinic), como antes');

/* ===================== F. Fora do alcance da API ===================== */
select pg_temp.entrar('anon');
select throws_ok($$ select count(*) from agenda.occupancy $$, '42501', null, 'visitante não alcança o schema agenda');
select pg_temp.entrar('authenticated', 'a1200000-0000-4000-8000-000000000001', 'clinica.permissoes@exemplo.test');
select throws_ok($$ select count(*) from agenda.status_history $$, '42501', null, 'membro de clínica não lê a agenda direto');
select throws_ok($$ select private.agenda_touch('c1200000-0000-4000-8000-000000000001') $$, '42501', null,
                 'quem está logado não chama funções internas da agenda');
select pg_temp.entrar('postgres');
select ok(not has_schema_privilege('service_role', 'agenda', 'USAGE')
          and not has_table_privilege('service_role', 'agenda.resources', 'SELECT'),
          'nem a chave de serviço (service_role) alcança o schema agenda');
select is(
  array(select r || ' ' || f from unnest(array['anon', 'authenticated']) r,
          unnest(array['public.check_appointment_request()', 'public.has_clinic_perm(uuid,text)',
                       'public.clinic_perm_scope(uuid,text)', 'public.imed_has(text)']) f
        where has_function_privilege(r, f, 'EXECUTE') order by 1),
  array['authenticated public.clinic_perm_scope(uuid,text)', 'authenticated public.has_clinic_perm(uuid,text)',
        'authenticated public.imed_has(text)'],
  'só quem está logado executa has_clinic_perm, clinic_perm_scope e imed_has; o gatilho do pedido, ninguém');

select * from finish();
rollback;
