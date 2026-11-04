-- Configuração da unidade e modalidade (iMed Agenda, fase 4.1; arquitetura §8, §11 e §12):
--   A. quem lê a configuração (agenda_config): visitante não executa; recepção, profissional, financeiro e a dona de
--      OUTRA clínica recebem forbidden; dona, gestor e a equipe do IMED leem; nada de dado de paciente;
--   B. o que a leitura devolve: unidade (fuso, confirmação, modalidade, compromisso), recursos, procedimentos com os
--      grupos e as alternativas, regras de abrir e pausar;
--   C. modalidade (agenda_mode_set): agenda_not_started, timezone_not_confirmed, commitment_required, externa só com
--      integracao.gerenciar (o gestor não entra nem sai dela), online_active, invalid; auditoria só com códigos;
--      a versão da agenda sobe.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(31);

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
  select ('a3700000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['dona', 'gestor', 'recepcao', 'prof', 'fin', 'outra', 'admin'])[p_n] || '.config41@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.c(p_n integer default 1) returns uuid language sql immutable as $$
  select ('c3700000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated', pg_temp.email(n), now(),
       '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from generate_series(1, 7) n;
insert into public.admin_emails (email) values (pg_temp.email(7));
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select pg_temp.c(n), 'Clínica da Configuração ' || n, 'imagem', 'Rua da Configuração, ' || n, 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from generate_series(1, 2) n;
insert into public.clinic_members (clinic_id, user_id, role) values
  (pg_temp.c(), pg_temp.u(1), 'owner'), (pg_temp.c(), pg_temp.u(2), 'manager'), (pg_temp.c(), pg_temp.u(3), 'reception'),
  (pg_temp.c(), pg_temp.u(4), 'professional'), (pg_temp.c(), pg_temp.u(5), 'finance'), (pg_temp.c(2), pg_temp.u(6), 'owner');

/* ===================== A. Quem lê ===================== */
select pg_temp.entrar('anon');
select throws_ok($$ select public.agenda_config(pg_temp.c()) $$, '42501', null, 'visitante não lê a configuração');
select throws_ok($$ select public.agenda_mode_set(pg_temp.c(), 'nativa', false) $$, '42501', null, 'nem troca a modalidade');
select pg_temp.como(3);
select is(public.agenda_config(pg_temp.c()) ->> 'status', 'forbidden', 'a recepção não lê a configuração');
select is(public.agenda_mode_set(pg_temp.c(), 'pedido', false) ->> 'status', 'forbidden', 'nem troca a modalidade');
select pg_temp.como(4);
select is(public.agenda_config(pg_temp.c()) ->> 'status', 'forbidden', 'o profissional não lê a configuração');
select pg_temp.como(5);
select is(public.agenda_config(pg_temp.c()) ->> 'status', 'forbidden', 'o financeiro não lê a configuração');
select pg_temp.como(6);
select is(public.agenda_config(pg_temp.c()) ->> 'status', 'forbidden', 'a dona de outra clínica não lê');
select is(public.agenda_mode_set(pg_temp.c(), 'pedido', false) ->> 'status', 'forbidden', 'nem troca a modalidade da outra');
select pg_temp.como(1);
select is((select concat_ws('|', j ->> 'status', j ->> 'active', j #>> '{unit,agenda_mode}', j #>> '{unit,timezone}',
                            j #>> '{unit,timezone_confirmed_at}' is null, jsonb_array_length(j -> 'resources'))
           from (select public.agenda_config(pg_temp.c()) j) x),
          'ok|false|pedido|America/Sao_Paulo|t|0', 'a dona lê: agenda ainda não ativa, modo pedido, fuso não confirmado');

/* ===================== C. Modalidade antes de ativar ===================== */
select is(public.agenda_mode_set(pg_temp.c(), 'nativa', false) ->> 'status', 'agenda_not_started', 'sem a agenda ativa não sai do pedido');
select is(public.agenda_mode_set(pg_temp.c(), 'qualquer', false) ->> 'status', 'invalid', 'modalidade desconhecida');
select is(public.agenda_unit_save(pg_temp.c(), '{"step_min": 10}'::jsonb) ->> 'status', 'ok', 'a dona ativa a agenda');
select is(public.agenda_mode_set(pg_temp.c(), 'nativa', false) ->> 'status', 'timezone_not_confirmed', 'fuso não confirmado: não sai do pedido');
select is(public.agenda_unit_save(pg_temp.c(), '{"confirm_timezone": true}'::jsonb) ->> 'status', 'ok', 'a dona confirma o fuso');
select is(public.agenda_mode_set(pg_temp.c(), 'manual', false) ->> 'status', 'commitment_required', 'manual sem o compromisso: não');
select pg_temp.entrar('postgres');
select set_config('teste.v0', (select coalesce(version, 0)::text from agenda.clinic_versions where clinic_id = pg_temp.c()), true);
select pg_temp.como(1);
select is(public.agenda_mode_set(pg_temp.c(), 'manual', true) ->> 'status', 'ok', 'manual com o compromisso: sim');
select is((select concat_ws('|', j #>> '{unit,agenda_mode}', j #>> '{unit,manual_commitment_at}' is not null,
                            j #>> '{unit,timezone_confirmed_at}' is not null, j #>> '{unit,step_min}', j ->> 'active')
           from (select public.agenda_config(pg_temp.c()) j) x),
          'manual|t|t|10|true', 'a leitura mostra manual, compromisso, fuso confirmado e o passo');
select pg_temp.entrar('postgres');
select ok((select version from agenda.clinic_versions where clinic_id = pg_temp.c()) > current_setting('teste.v0')::bigint,
          'trocar a modalidade sobe a versão da agenda');

/* ===================== B. Cadastros na leitura ===================== */
select pg_temp.como(2);
select set_config('teste.r', public.agenda_resource_save(pg_temp.c(), '{"kind": "equipamento", "name": "Aparelho A", "cleanup_min": 5}'::jsonb) ->> 'id', true);
select set_config('teste.p', public.agenda_procedure_save(pg_temp.c(), jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom A', 'duration_min', 20,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento',
     'options', jsonb_build_array(jsonb_build_object('resource_id', current_setting('teste.r'))))))) ->> 'id', true);
select is(public.agenda_rules_set(pg_temp.c(), null, '[{"weekday": 1, "start": "08:00", "end": "12:00", "kind": "abre"},
                                                       {"weekday": 1, "start": "10:00", "end": "10:30", "kind": "pausa", "label": "Café"}]'::jsonb) ->> 'status',
          'ok', 'o gestor grava as regras da unidade');
select is((select concat_ws('|', jsonb_array_length(j -> 'resources'), j #>> '{resources,0,cleanup_min}',
                            j #>> '{procedures,0,name}', j #>> '{procedures,0,duration_min}', j #>> '{procedures,0,price_cents}' is null,
                            j #>> '{procedures,0,requirements,0,options,0,resource_id}' = current_setting('teste.r'),
                            jsonb_array_length(j -> 'rules'), j #>> '{rules,0,start}', j #>> '{rules,1,kind}', j #>> '{rules,1,label}')
           from (select public.agenda_config(pg_temp.c()) j) x),
          '1|5|Ultrassom A|20|t|t|2|08:00|pausa|Café', 'o gestor lê recursos, procedimento com grupo e regras');
select is((select count(*)::int from jsonb_path_query(public.agenda_config(pg_temp.c()), 'strict $.**.patient_name')), 0,
          'a leitura não tem campo de paciente');

/* ===================== C. Externa e volta ao pedido ===================== */
select is(public.agenda_mode_set(pg_temp.c(), 'externa', false) ->> 'status', 'forbidden', 'o gestor não liga a externa (integração é da dona)');
select pg_temp.como(1);
select is(public.agenda_mode_set(pg_temp.c(), 'externa', false) ->> 'status', 'ok', 'a dona liga a externa');
select is((select concat_ws('|', j #>> '{unit,agenda_mode}', j #>> '{unit,manual_commitment_at}' is null)
           from (select public.agenda_config(pg_temp.c()) j) x), 'externa|t', 'saiu da manual: o compromisso some');
select pg_temp.como(2);
select is(public.agenda_mode_set(pg_temp.c(), 'nativa', false) ->> 'status', 'forbidden', 'o gestor também não tira da externa');
select pg_temp.como(7);
select is(public.agenda_config(pg_temp.c()) ->> 'status', 'ok', 'a equipe do IMED lê a configuração');
select is(public.agenda_mode_set(pg_temp.c(), 'nativa', false) ->> 'status', 'ok', 'a equipe do IMED troca a modalidade (central)');
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_config_online', true);
update public.clinics set agenda_online_since = now() where id = pg_temp.c();
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
select pg_temp.como(1);
select is(public.agenda_mode_set(pg_temp.c(), 'pedido', false) ->> 'status', 'online_active', 'com a venda online ligada não volta ao pedido');
select is(public.agenda_mode_set(pg_temp.c(), 'nativa', false) ->> 'unchanged', 'true', 'a mesma modalidade: nada muda');
select pg_temp.entrar('postgres');
select is((select string_agg(concat_ws(':', origin, actor_role, new_value ->> 'agenda_mode'), ',' order by id) from agenda.audit_log
           where clinic_id = pg_temp.c() and action = 'modalidade.trocar'),
          'painel:owner:manual,painel:owner:externa,central:imed_admin:nativa', 'auditoria: quem, de onde e a modalidade');
select is((select count(*)::int from agenda.audit_log where clinic_id = pg_temp.c() and action = 'modalidade.trocar'
           and (coalesce(old_value::text, '') ~ '@' or coalesce(new_value::text, '') ~ '@')), 0, 'auditoria sem e-mail');

select * from finish();
rollback;
