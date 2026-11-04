-- Fechamento da leitura direta (iMed Agenda, fase 4.2, parte 2 da migração agenda_leitura; arquitetura §2.3, §12 e
-- R2-13; decisão 4.2-d). Vale com as duas partes aplicadas:
--   - a clínica não lê mais os pedidos direto pela API (lê por agenda_requests, que registra a leitura); horários e
--     bloqueios da clínica só pelas funções (a leitura direta dá "sem permissão");
--   - a equipe do IMED lê direto só os pedidos ao IMED (sem clínica); os de clínica, pela função, com o motivo;
--   - continua igual: o paciente com conta lê os próprios pedidos; o visitante pede (as 23 colunas), cancela com o
--     código e acompanha a situação; a clínica muda a situação do pedido sem horário (set_request_status).
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test; nomes fictícios.
begin;
select plan(22);

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
create function pg_temp.u(p_n integer) returns uuid language sql immutable as $$
  select ('a3390000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['recepcao', 'paciente', 'admin'])[p_n] || '.fechamento@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.a() returns uuid language sql immutable as $$ select 'c3390000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.hoje() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create function pg_temp.hash(p text) returns text language sql immutable as $$ select encode(extensions.digest(p, 'sha256'), 'hex') $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated', pg_temp.email(n), now(),
       '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from generate_series(1, 3) n;
insert into public.admin_emails (email) values (pg_temp.email(3));
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
values (pg_temp.a(), 'Clínica do Fechamento', 'imagem', 'Rua do Fechamento, 1', 'São Paulo', 'SP',
        extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false);
insert into public.clinic_members (clinic_id, user_id, role) values (pg_temp.a(), pg_temp.u(1), 'reception');
insert into public.clinic_blocks (clinic_id, starts_at, ends_at, reason)
values (pg_temp.a(), (pg_temp.hoje() + 10)::timestamp at time zone 'America/Sao_Paulo',
        (pg_temp.hoje() + 11)::timestamp at time zone 'America/Sao_Paulo', 'Reforma');

/* ===================== O site de hoje continua igual ===================== */
-- visitante: pede (as 23 colunas que o site manda), na clínica e ao IMED (local que ainda não é parceiro)
select pg_temp.entrar('anon');
select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_ref, place_name, place_address, place_phone, exam_code,
    preferred_date, preferred_period, patient_name, patient_phone, patient_email, notes, consent, slot_start, for_other, other_name,
    relationship, other_minor, guardian_consent, other_consent, review_token_hash)
  values ('b3390000-0000-4000-8000-000000000001', pg_temp.a(), 'imed', null, 'Clínica do Fechamento', 'Rua do Fechamento, 1', null, 'usg',
    pg_temp.hoje() + 2, 'manha', 'Visitante Fechamento', '11966665555', null, null, true, null, false, null, null, false, false, false,
    pg_temp.hash('codigo-fechamento-1'))
$$, 'visitante pede agendamento na clínica (as 23 colunas do site)');
select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_ref, place_name, exam_code, preferred_date, preferred_period,
    patient_name, patient_phone, consent, review_token_hash)
  values ('b3390000-0000-4000-8000-000000000002', null, 'cnes', 'cnes:7777777', 'Laboratório do Fechamento', 'lab', pg_temp.hoje() + 3,
    'tarde', 'Visitante Concierge', '11966664444', true, pg_temp.hash('codigo-fechamento-2'))
$$, 'visitante pede ao IMED (local que ainda não é parceiro)');
select is((select count(*)::int from public.appointment_requests), 0, 'o visitante continua sem ler pedido nenhum');
-- paciente com conta: pede e lê os próprios pedidos (inclusive "Baixar meus dados", select *)
select pg_temp.como(2);
select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date, preferred_period,
    patient_name, patient_phone, consent, review_token_hash)
  values ('b3390000-0000-4000-8000-000000000003', pg_temp.a(), 'imed', 'Clínica do Fechamento', 'usg', pg_temp.hoje() + 4, 'manha',
    'Paciente com Conta Fechamento', '11966663333', true, pg_temp.hash('codigo-fechamento-3'))
$$, 'paciente logado pede agendamento');
select is((select count(*)::int from public.appointment_requests where user_id = pg_temp.u(2)), 1, 'o paciente lê o próprio pedido');
select is((select concat_ws('|', count(*), max(patient_name)) from (select * from public.appointment_requests) x),
          '1|Paciente com Conta Fechamento', 'e baixa os próprios dados (select *), só os dele');

/* ===================== A clínica: só pelas funções ===================== */
select pg_temp.como(1);
select is((select count(*)::int from public.appointment_requests where clinic_id = pg_temp.a()), 0,
          'a recepção não lê mais os pedidos direto pela API');
select is((select concat_ws('|', j ->> 'status', jsonb_array_length(j -> 'requests'))
           from (select public.agenda_requests(pg_temp.a()) as j) x), 'ok|2', 'a recepção lê os 2 pedidos pela função agenda_requests');
select throws_ok($$ select count(*) from public.clinic_blocks $$, '42501', null, 'bloqueios: a leitura direta dá "sem permissão"');
select throws_ok($$ select count(*) from public.clinic_schedules $$, '42501', null, 'horários: a leitura direta dá "sem permissão"');
select is((select jsonb_array_length(public.agenda_blocks(pg_temp.a()) -> 'blocks')), 1, 'os bloqueios, pela função agenda_blocks');
select is(public.set_request_status('b3390000-0000-4000-8000-000000000001', 'contacted'), 'ok',
          'a recepção muda a situação do pedido sem horário (set_request_status)');

/* ===================== A equipe do IMED ===================== */
select pg_temp.como(3);
select is((select concat_ws('|', count(*) filter (where clinic_id is null), count(*) filter (where clinic_id is not null))
           from public.appointment_requests), '1|0', 'a equipe do IMED lê direto só os pedidos ao IMED (sem clínica)');
select is(public.agenda_requests(pg_temp.a()) ->> 'status', 'justification_required', 'os pedidos da clínica, pela função e com o motivo');
select is(jsonb_array_length(public.agenda_requests(pg_temp.a(), null, 'auditoria') -> 'requests'), 2, '... com o motivo, a lista inteira');
select is(public.set_request_status('b3390000-0000-4000-8000-000000000002', 'contacted'), 'ok',
          'a equipe muda a situação do pedido ao IMED (aba "Pedidos ao IMED")');

/* ===================== O visitante cancela e acompanha ===================== */
select pg_temp.entrar('anon');
select is(public.cancel_request('b3390000-0000-4000-8000-000000000001', 'codigo-fechamento-1'), 'ok', 'o visitante cancela com o código do pedido');
select is((select status from public.request_status(array['b3390000-0000-4000-8000-000000000001'::uuid], array['codigo-fechamento-1'])),
          'cancelled', 'e acompanha a situação pelo código');

/* ===================== As regras gravadas ===================== */
select pg_temp.entrar('postgres');
select is((select string_agg(policyname || '=' || qual, ';' order by policyname) from pg_policies
           where schemaname = 'public' and ((tablename = 'appointment_requests' and policyname = 'clinica ve pedidos para ela')
                                            or (tablename = 'clinic_blocks' and policyname = 'membro ve os bloqueios da clinica')
                                            or (tablename = 'clinic_schedules' and policyname = 'membro ve a agenda da clinica'))),
          'clinica ve pedidos para ela=false;membro ve a agenda da clinica=false;membro ve os bloqueios da clinica=false',
          'as policies de leitura da clínica ficam (nada apagado), com "false"');
select ok((select qual from pg_policies where schemaname = 'public' and tablename = 'appointment_requests' and policyname = 'admin le pedidos')
          like '%clinic_id IS NULL%', 'a leitura direta da equipe do IMED: só sem clínica');
select is((select qual from pg_policies where schemaname = 'public' and tablename = 'appointment_requests' and policyname = 'paciente ve seus pedidos'),
          '(user_id = auth.uid())', 'a do paciente fica igual');
select ok(not has_table_privilege('authenticated', 'public.clinic_blocks', 'SELECT')
          and not has_table_privilege('authenticated', 'public.clinic_schedules', 'SELECT')
          and has_table_privilege('authenticated', 'public.appointment_requests', 'SELECT')
          and has_column_privilege('anon', 'public.appointment_requests', 'review_token_hash', 'INSERT'),
          'sem SELECT em horários e bloqueios para quem está logado; pedidos e o INSERT do site iguais');

select * from finish();
rollback;
