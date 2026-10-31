-- O pedido de agendamento de HOJE continua funcionando (iMed Agenda, fase 3.0; arquitetura §13, 010_pedidos_atuais).
-- É o contrato que o site no ar usa e que nenhuma fase da agenda pode quebrar:
--   - o visitante (anon) grava o pedido direto na tabela, com consentimento (geo-core.js bookingRow, return=minimal);
--   - na clínica com agenda, horário livre sai "confirmed" e horário ocupado ou fora da grade é recusado (23P01);
--   - request_status e cancel_request com o código do pedido (o aparelho guarda o código; o banco, o SHA-256);
--   - set_request_status pela clínica (membro) e pela equipe do IMED (admin), com as regras de quem cancelou;
--   - o pedido COMPLETO (as 23 colunas do bookingRow: endereço e telefone do local, e-mail, observação e o pedido
--     para outra pessoa, adulta ou menor), como visitante e como paciente logado. O mesmo pedido, montado pelo
--     próprio assets/js/geo-core.js e enviado pelo PostgREST, é conferido em tests/banco/pedido-do-site.mjs.
-- Todos os dados são criados aqui e desfeitos no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(50);

-- Troca de papel como o PostgREST faz: role + request.jwt.claims (só até o fim da transação).
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

/* ===================== Dados do teste ===================== */
-- Dia: o mesmo dia da semana, daqui a 7 dias (horário de São Paulo, como available_slots).
-- Guardados em variáveis da transação (teste.*), que qualquer papel lê com current_setting.
do $$
declare
  h text;
  c text;
begin
  perform set_config('teste.dia', ((now() at time zone 'America/Sao_Paulo')::date + 7)::text, true);
  foreach h in array array['08:00', '08:30', '09:00', '09:10', '09:30'] loop
    perform set_config('teste.h' || replace(h, ':', ''),
      ((current_setting('teste.dia')::date + h::time) at time zone 'America/Sao_Paulo')::text, true);
  end loop;
  foreach c in array array['r1', 'r2', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9'] loop
    perform set_config('teste.hash_' || c, encode(extensions.digest('codigo-' || c, 'sha256'), 'hex'), true);
  end loop;
end $$;

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'clinica.teste@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'outra.pessoa@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a3000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'admin.teste@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a4000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'paciente.teste@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now());
insert into public.admin_emails (email) values ('admin.teste@exemplo.test');

insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
values
  ('c1000000-0000-4000-8000-000000000001', 'Clínica de Teste do CI', 'imagem', 'Rua do Teste, 100', 'São Paulo', 'SP',
   extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false),
  ('c2000000-0000-4000-8000-000000000002', 'Clínica Sem Pedidos do CI', 'imagem', 'Rua do Teste, 200', 'São Paulo', 'SP',
   extensions.st_setsrid(extensions.st_makepoint(-46.64, -23.56), 4326)::extensions.geography, 'published', false, false);
insert into public.clinic_exams (clinic_id, exam_code) values ('c1000000-0000-4000-8000-000000000001', 'usg');
insert into public.clinic_members (clinic_id, user_id, role)
values ('c1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner');
-- Grade da clínica no dia do teste: 08:00, 08:30, 09:00 e 09:30 (30 min).
insert into public.clinic_schedules (clinic_id, weekday, start_time, end_time, slot_minutes, exam_codes)
values ('c1000000-0000-4000-8000-000000000001', extract(dow from current_setting('teste.dia')::date)::smallint,
        '08:00', '10:00', 30, '{}');

/* ===================== A. O visitante pede (anon, INSERT direto) ===================== */
select pg_temp.entrar('anon');

select lives_ok($$
  insert into public.appointment_requests (id, place_source, place_ref, place_name, exam_code, preferred_date,
    preferred_period, patient_name, patient_phone, consent, review_token_hash)
  values ('b1000000-0000-4000-8000-000000000001', 'cnes', 'cnes:1234567', 'Laboratório do Teste', 'lab',
    current_setting('teste.dia')::date, 'manha', 'Paciente Um', '11999990001', true, current_setting('teste.hash_r1'))
$$, 'visitante pede agendamento para local não parceiro (concierge)');

select throws_ok($$
  insert into public.appointment_requests (id, place_source, place_ref, place_name, preferred_date, patient_name,
    patient_phone, consent)
  values ('b1000000-0000-4000-8000-000000000099', 'cnes', 'cnes:1234567', 'Laboratório do Teste',
    current_setting('teste.dia')::date, 'Sem Consentimento', '11999990099', false)
$$, '42501', null, 'sem consentimento o pedido é recusado (RLS)');

select throws_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
    patient_name, patient_phone, consent)
  values ('b1000000-0000-4000-8000-000000000098', 'c2000000-0000-4000-8000-000000000002', 'imed', 'Clínica Sem Pedidos do CI',
    'usg', current_setting('teste.dia')::date, 'Paciente Recusado', '11999990098', true)
$$, '22023', 'Esta clínica não recebe pedidos de agendamento pelo site',
   'clínica que não recebe pedidos pelo site: recusado');

select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
    patient_name, patient_phone, consent, slot_start, review_token_hash)
  values ('b2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'imed', 'Clínica de Teste do CI',
    'usg', current_setting('teste.dia')::date, 'Paciente Dois', '11999990002', true,
    current_setting('teste.h0900')::timestamptz, current_setting('teste.hash_r2'))
$$, 'visitante marca um horário livre (09:00)');

select throws_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
    patient_name, patient_phone, consent, slot_start)
  values ('b3000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'imed', 'Clínica de Teste do CI',
    'usg', current_setting('teste.dia')::date, 'Paciente Tres', '11999990003', true,
    current_setting('teste.h0900')::timestamptz)
$$, '23P01', 'Este horário não está mais livre. Escolha outro.', 'o mesmo horário de novo é recusado (23P01)');

select throws_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
    patient_name, patient_phone, consent, slot_start)
  values ('b3000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'imed', 'Clínica de Teste do CI',
    'usg', current_setting('teste.dia')::date, 'Paciente Tres', '11999990003', true,
    current_setting('teste.h0910')::timestamptz)
$$, '23P01', 'Este horário não está mais livre. Escolha outro.', 'horário fora da grade (09:10) é recusado (23P01)');

select is(
  array(select a.slot_start from public.available_slots('c1000000-0000-4000-8000-000000000001', 'usg',
                                                          current_setting('teste.dia')::date, 1) a order by 1),
  array[current_setting('teste.h0800'), current_setting('teste.h0830'), current_setting('teste.h0930')]::timestamptz[],
  'available_slots mostra 08:00, 08:30 e 09:30 (09:00 está ocupado)');

select is((select count(*)::int from public.appointment_requests), 0, 'o visitante não lê pedidos (RLS)');

select is((select s.status || '|' || s.reviewed from public.request_status(
             array['b2000000-0000-4000-8000-000000000002']::uuid[], array['codigo-r2']) s),
          'confirmed|false', 'request_status com o código do pedido: confirmado');

select is((select count(*)::int from public.request_status(
             array['b2000000-0000-4000-8000-000000000002']::uuid[], array['codigo-errado'])),
          0, 'request_status com código errado não mostra nada');

select pg_temp.entrar('postgres');

select is((select status || '|' || coalesce(user_id::text, '-') || '|' || coalesce(slot_start::text, '-')
           from public.appointment_requests where id = 'b1000000-0000-4000-8000-000000000001'),
          'pending|-|-', 'pedido sem horário fica pendente e sem conta');

select is((select status || '|' || preferred_period || '|' || preferred_date
           from public.appointment_requests where id = 'b2000000-0000-4000-8000-000000000002'),
          'confirmed|manha|' || current_setting('teste.dia'), 'horário livre sai confirmado, com dia e período do horário');

/* ===================== B. O paciente cancela com o código (anon) ===================== */
select pg_temp.entrar('anon');

select is(public.cancel_request('b2000000-0000-4000-8000-000000000002', 'codigo-errado'), 'forbidden',
          'cancelar com código errado: forbidden');
select is(public.cancel_request('b2000000-0000-4000-8000-000000000002', 'codigo-r2'), 'ok',
          'cancelar com o código do pedido: ok');
select is(public.cancel_request('b2000000-0000-4000-8000-000000000002', 'codigo-r2'), 'already_cancelled',
          'cancelar de novo: already_cancelled');
select ok(current_setting('teste.h0900')::timestamptz = any (array(
            select a.slot_start from public.available_slots('c1000000-0000-4000-8000-000000000001', 'usg',
                                                            current_setting('teste.dia')::date, 1) a)),
          'o horário cancelado (09:00) volta a ficar livre');
select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
    patient_name, patient_phone, consent, slot_start, review_token_hash)
  values ('b4000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 'imed', 'Clínica de Teste do CI',
    'usg', current_setting('teste.dia')::date, 'Paciente Quatro', '11999990004', true,
    current_setting('teste.h0900')::timestamptz, current_setting('teste.hash_r4'))
$$, 'outro visitante marca o horário que foi liberado (09:00)');

select pg_temp.entrar('postgres');

select is((select status || '|' || cancelled_by || '|' || (cancelled_at is not null)
           from public.appointment_requests where id = 'b2000000-0000-4000-8000-000000000002'),
          'cancelled|patient|true', 'cancelamento do paciente grava quem e quando');
select is((select status from public.appointment_requests where id = 'b4000000-0000-4000-8000-000000000004'),
          'confirmed', 'o novo pedido no horário liberado sai confirmado');

/* ===================== C. A clínica e a equipe do IMED mudam a situação ===================== */
select pg_temp.entrar('anon');
select throws_ok($$ select public.set_request_status('b4000000-0000-4000-8000-000000000004', 'confirmed') $$,
                 '42501', null, 'visitante não chama set_request_status');

select pg_temp.entrar('authenticated', 'a1000000-0000-4000-8000-000000000001', 'clinica.teste@exemplo.test');
select is(public.set_request_status('b4000000-0000-4000-8000-000000000004', 'contacted'), 'ok',
          'membro da clínica marca "em contato"');
select is(public.set_request_status('b4000000-0000-4000-8000-000000000004', 'nada'), 'invalid_status',
          'situação desconhecida: invalid_status');
select is((select count(*)::int from public.appointment_requests where clinic_id = 'c1000000-0000-4000-8000-000000000001'),
          2, 'membro da clínica lê os pedidos da clínica');
select is((select count(*)::int from public.appointment_requests where id = 'b1000000-0000-4000-8000-000000000001'),
          0, 'membro da clínica não lê pedido de outro local');
select is(public.set_request_status('b2000000-0000-4000-8000-000000000002', 'confirmed'), 'cancelled_by_patient',
          'a clínica não reabre pedido cancelado pelo paciente');

select pg_temp.entrar('authenticated', 'a2000000-0000-4000-8000-000000000002', 'outra.pessoa@exemplo.test');
select is(public.set_request_status('b4000000-0000-4000-8000-000000000004', 'confirmed'), 'forbidden',
          'quem não é da clínica: forbidden');
select is((select count(*)::int from public.appointment_requests where clinic_id = 'c1000000-0000-4000-8000-000000000001'),
          0, 'quem não é da clínica não lê os pedidos dela');

select pg_temp.entrar('authenticated', 'a3000000-0000-4000-8000-000000000003', 'admin.teste@exemplo.test');
select ok(public.is_imed_admin(), 'admin (e-mail confirmado, sessão pelo link) é reconhecido');
select is(public.set_request_status('b2000000-0000-4000-8000-000000000002', 'confirmed'), 'slot_taken',
          'admin reabre pedido cancelado cujo horário já foi pego: slot_taken');
select is(public.set_request_status('b1000000-0000-4000-8000-000000000001', 'contacted'), 'ok',
          'admin marca "em contato" no pedido concierge');
select is(public.set_request_status('b4000000-0000-4000-8000-000000000004', 'cancelled'), 'ok',
          'admin cancela um pedido');

select pg_temp.entrar('anon');
select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
    patient_name, patient_phone, consent, slot_start, review_token_hash)
  values ('b5000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000001', 'imed', 'Clínica de Teste do CI',
    'usg', current_setting('teste.dia')::date, 'Paciente Cinco', '11999990005', true,
    current_setting('teste.h0800')::timestamptz, current_setting('teste.hash_r5'))
$$, 'visitante marca 08:00');

select pg_temp.entrar('authenticated', 'a1000000-0000-4000-8000-000000000001', 'clinica.teste@exemplo.test');
select is(public.set_request_status('b5000000-0000-4000-8000-000000000005', 'cancelled'), 'ok',
          'membro da clínica cancela um pedido');

select pg_temp.entrar('postgres');
select is((select status || '|' || cancelled_by from public.appointment_requests
           where id = 'b4000000-0000-4000-8000-000000000004'), 'cancelled|imed', 'cancelado pela equipe: cancelled_by = imed');
select is((select status || '|' || cancelled_by from public.appointment_requests
           where id = 'b5000000-0000-4000-8000-000000000005'), 'cancelled|clinic', 'cancelado pela clínica: cancelled_by = clinic');
select is((select status || '|' || cancelled_by from public.appointment_requests
           where id = 'b2000000-0000-4000-8000-000000000002'), 'cancelled|patient',
          'depois do slot_taken o pedido continua cancelado pelo paciente');

/* ===================== D. Paciente com conta (authenticated) ===================== */
select pg_temp.entrar('authenticated', 'a4000000-0000-4000-8000-000000000004', 'paciente.teste@exemplo.test');
select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
    patient_name, patient_phone, consent, slot_start, review_token_hash)
  values ('b6000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-000000000001', 'imed', 'Clínica de Teste do CI',
    'usg', current_setting('teste.dia')::date, 'Paciente Seis', '11999990006', true,
    current_setting('teste.h0830')::timestamptz, current_setting('teste.hash_r6'))
$$, 'paciente logado marca 08:30');
select is((select user_id::text from public.appointment_requests where id = 'b6000000-0000-4000-8000-000000000006'),
          'a4000000-0000-4000-8000-000000000004', 'o pedido fica ligado à conta de quem está logado (e ele o lê)');

select pg_temp.entrar('anon');
select is(public.cancel_request('b6000000-0000-4000-8000-000000000006', null), 'forbidden',
          'sem código e sem conta não cancela pedido de outra pessoa');

select pg_temp.entrar('authenticated', 'a4000000-0000-4000-8000-000000000004', 'paciente.teste@exemplo.test');
select is(public.cancel_request('b6000000-0000-4000-8000-000000000006', null), 'ok',
          'o dono da conta cancela sem o código');

/* ===================== E. Horário que já passou, concluído e avaliação ===================== */
select pg_temp.entrar('anon');
select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
    patient_name, patient_phone, consent, slot_start, review_token_hash)
  values ('b7000000-0000-4000-8000-000000000007', 'c1000000-0000-4000-8000-000000000001', 'imed', 'Clínica de Teste do CI',
    'usg', current_setting('teste.dia')::date, 'Paciente Sete', '11999990007', true,
    current_setting('teste.h0930')::timestamptz, current_setting('teste.hash_r7'))
$$, 'visitante marca 09:30');

select pg_temp.entrar('postgres');
update public.appointment_requests set slot_start = now() - interval '1 hour'
where id = 'b7000000-0000-4000-8000-000000000007';

select pg_temp.entrar('anon');
select is(public.cancel_request('b7000000-0000-4000-8000-000000000007', 'codigo-r7'), 'past',
          'horário que já passou não pode ser cancelado pelo site: past');

select pg_temp.entrar('authenticated', 'a3000000-0000-4000-8000-000000000003', 'admin.teste@exemplo.test');
select is(public.set_request_status('b1000000-0000-4000-8000-000000000001', 'completed'), 'ok',
          'admin conclui o pedido concierge');

select pg_temp.entrar('anon');
select is(public.cancel_request('b1000000-0000-4000-8000-000000000001', 'codigo-r1'), 'not_cancellable',
          'pedido concluído não pode ser cancelado: not_cancellable');
select is(public.submit_review('b1000000-0000-4000-8000-000000000001', 'codigo-r1', 5, 'Atendimento ótimo'), 'ok',
          'o paciente avalia o atendimento concluído com o código');
select is((select s.status || '|' || s.reviewed from public.request_status(
             array['b1000000-0000-4000-8000-000000000001']::uuid[], array['codigo-r1']) s),
          'completed|true', 'request_status mostra concluído e avaliado');

/* ===================== F. O pedido completo que o site manda (todas as colunas do bookingRow) ===================== */
-- Visitante, local não parceiro (concierge), para outra pessoa adulta (com a confirmação de que ela concordou).
select pg_temp.entrar('anon');
select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_ref, place_name, place_address, place_phone,
    exam_code, preferred_date, preferred_period, patient_name, patient_phone, patient_email, notes, consent,
    for_other, other_name, relationship, other_minor, guardian_consent, other_consent, review_token_hash)
  values ('b8000000-0000-4000-8000-000000000008', null, 'cnes', 'cnes:7654321', 'Laboratório Completo do Teste',
    'Rua Completa, 1 · Centro · São Paulo - SP', '(11) 3141-1000', 'lab', current_setting('teste.dia')::date, 'tarde',
    'Paciente Oito', '11999990008', 'paciente.oito@exemplo.test', 'Prefiro depois das 14h', true,
    true, 'Mãe do Paciente Oito', 'Pai ou mãe', false, false, true, current_setting('teste.hash_r8'))
$$, 'visitante pede para outra pessoa adulta, com todas as colunas que o site manda');

-- Paciente logado, clínica parceira com horário (09:30, livre de novo), para um menor (com o responsável).
select pg_temp.entrar('authenticated', 'a4000000-0000-4000-8000-000000000004', 'paciente.teste@exemplo.test');
select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_ref, place_name, place_address, place_phone,
    exam_code, preferred_date, preferred_period, patient_name, patient_phone, patient_email, notes, consent, slot_start,
    for_other, other_name, relationship, other_minor, guardian_consent, other_consent, review_token_hash)
  values ('b9000000-0000-4000-8000-000000000009', 'c1000000-0000-4000-8000-000000000001', 'imed', null,
    'Clínica de Teste do CI', 'Rua do Teste, 100 · São Paulo - SP', '(11) 3000-0000', 'usg',
    current_setting('teste.dia')::date, 'manha', 'Paciente Nove', '11999990009', null, null, true,
    current_setting('teste.h0930')::timestamptz,
    true, 'Filho do Paciente Nove', 'Filho ou filha', true, true, false, current_setting('teste.hash_r9'))
$$, 'paciente logado marca horário para um menor de idade, com todas as colunas que o site manda');

select pg_temp.entrar('postgres');
select is(
  (select concat_ws('|', status, coalesce(user_id::text, '-'), place_ref, place_address, place_phone, exam_code,
                    preferred_period, patient_email, notes, for_other::text, other_name, relationship, other_minor::text,
                    guardian_consent::text, other_consent::text, (review_token_hash = current_setting('teste.hash_r8'))::text)
   from public.appointment_requests where id = 'b8000000-0000-4000-8000-000000000008'),
  'pending|-|cnes:7654321|Rua Completa, 1 · Centro · São Paulo - SP|(11) 3141-1000|lab|tarde|paciente.oito@exemplo.test'
    || '|Prefiro depois das 14h|true|Mãe do Paciente Oito|Pai ou mãe|false|false|true|true',
  'pedido do visitante gravado como o site mandou (pendente, sem conta)');
select is(
  (select concat_ws('|', status, user_id::text, coalesce(place_ref, '-'), place_address, place_phone,
                    (slot_start = current_setting('teste.h0930')::timestamptz)::text, preferred_period,
                    coalesce(patient_email, '-'), coalesce(notes, '-'), for_other::text, other_name, relationship,
                    other_minor::text, guardian_consent::text, other_consent::text,
                    (review_token_hash = current_setting('teste.hash_r9'))::text)
   from public.appointment_requests where id = 'b9000000-0000-4000-8000-000000000009'),
  'confirmed|a4000000-0000-4000-8000-000000000004|-|Rua do Teste, 100 · São Paulo - SP|(11) 3000-0000|true|manha|-|-'
    || '|true|Filho do Paciente Nove|Filho ou filha|true|true|false|true',
  'pedido do paciente logado gravado como o site mandou (confirmado, ligado à conta)');

select * from finish();
rollback;
