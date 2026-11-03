-- Equipe da clínica (iMed Agenda, fase 3.4; arquitetura §12, R2-21):
--   - convite por e-mail (equipe.gerenciar): papel válido, e-mail válido, quem já é da equipe, convite repetido
--     atualiza o papel; o gestor não convida nem mexe em dono;
--   - aceitar: só o mesmo e-mail, confirmado, com sessão pelo link (senha não); preso à conta; uma vez só; vencido não;
--   - trocar papel e remover: o último dono nunca é rebaixado nem sai; o financeiro não gerencia a equipe;
--   - auditoria sem e-mail.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(29);

create function pg_temp.entrar(p_papel text, p_usuario uuid default null, p_email text default null, p_amr text default 'otp')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_papel = 'postgres' then ''
         else jsonb_strip_nulls(jsonb_build_object(
                'role', p_papel, 'sub', p_usuario, 'email', p_email,
                'aud', case when p_usuario is not null then 'authenticated' end,
                'amr', case when p_usuario is not null then jsonb_build_array(jsonb_build_object('method', p_amr, 'timestamp', 1)) end))::text
    end, true);
  perform set_config('role', p_papel, true);
end $$;
create function pg_temp.u(p_n integer) returns uuid language sql immutable as $$
  select ('a3400000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['dona', 'gestor', 'convidado', 'outro', 'fin'])[p_n] || '.equipe@exemplo.test' $$;
create function pg_temp.como(p_n integer, p_amr text default 'otp') returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n), p_amr) $$;
create function pg_temp.c() returns uuid language sql immutable as $$ select 'c3400000-0000-4000-8000-000000000001'::uuid $$;

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated', pg_temp.email(n), now(),
       '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from generate_series(1, 5) n;
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
values (pg_temp.c(), 'Clínica da Equipe', 'imagem', 'Rua da Equipe, 1', 'São Paulo', 'SP',
        extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false);
insert into public.clinic_members (clinic_id, user_id, role) values
  (pg_temp.c(), pg_temp.u(1), 'owner'), (pg_temp.c(), pg_temp.u(2), 'manager'), (pg_temp.c(), pg_temp.u(5), 'finance');

/* ===================== Convidar ===================== */
select pg_temp.como(1);
select set_config('teste.i1', public.agenda_invite(pg_temp.c(), '  Convidado.Equipe@Exemplo.test ', 'reception') ->> 'id', true);
select ok(current_setting('teste.i1', true) is not null, 'a dona convida (e-mail com maiúsculas e espaços vira minúsculo)');
select is(public.agenda_invite(pg_temp.c(), pg_temp.email(3), 'professional') ->> 'id', current_setting('teste.i1'),
          'convidar de novo o mesmo e-mail atualiza o convite aberto (não cria outro)');
select is(public.agenda_invite(pg_temp.c(), 'sem-arroba', 'reception') ->> 'status', 'invalid_email', 'e-mail inválido');
select is(public.agenda_invite(pg_temp.c(), 'a.equipe@exemplo.test', 'chefe') ->> 'status', 'invalid_role', 'papel inválido');
select is(public.agenda_invite(pg_temp.c(), pg_temp.email(2), 'reception') ->> 'status', 'already_member', 'quem já é da equipe');
select pg_temp.como(2);
select is(public.agenda_invite(pg_temp.c(), 'socio.equipe@exemplo.test', 'owner') ->> 'status', 'forbidden', 'o gestor não convida dono');
select is(public.agenda_invite(pg_temp.c(), 'caixa.equipe@exemplo.test', 'finance') ->> 'status', 'ok', 'o gestor convida o financeiro');
select is((select concat_ws('|', jsonb_array_length(j -> 'members'), jsonb_array_length(j -> 'invites')) from (select public.agenda_team(pg_temp.c()) as j) x),
          '3|2', 'agenda_team: 3 membros e 2 convites abertos');
select pg_temp.como(5);
select is(public.agenda_team(pg_temp.c()) ->> 'status', 'forbidden', 'o financeiro não gerencia a equipe');
select is(public.agenda_invite(pg_temp.c(), 'y.equipe@exemplo.test', 'reception') ->> 'status', 'forbidden', 'nem convida');

/* ===================== Aceitar ===================== */
select pg_temp.como(4);
select is(jsonb_array_length(public.agenda_my_invites() -> 'invites'), 0, 'outra pessoa não vê o convite');
select is(public.agenda_invite_accept(current_setting('teste.i1')::uuid) ->> 'status', 'not_found', 'nem aceita o convite de outro e-mail');
select pg_temp.como(3, 'password');
select is(public.agenda_invite_accept(current_setting('teste.i1')::uuid) ->> 'status', 'forbidden', 'entrou com senha: não aceita (só pelo link)');
select pg_temp.como(3);
select is((select concat_ws('|', jsonb_array_length(j -> 'invites'), j #>> '{invites,0,role}', j #>> '{invites,0,clinic_name}')
           from (select public.agenda_my_invites() as j) x), '1|professional|Clínica da Equipe', 'o convidado vê o próprio convite');
select is(public.agenda_invite_accept(current_setting('teste.i1')::uuid) ->> 'status', 'ok', 'o convidado aceita');
select is(public.agenda_me() #>> '{clinics,0,role}', 'professional', 'e entra na equipe com o papel do convite');
select is(public.agenda_invite_accept(current_setting('teste.i1')::uuid) ->> 'status', 'not_open', 'aceitar de novo: não');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', status, accepted_by = pg_temp.u(3)) from agenda.member_invites where id = current_setting('teste.i1')::uuid),
          'aceito|t', 'o convite fica preso à conta que aceitou');
update agenda.member_invites set expires_at = now() - interval '1 minute', created_at = now() - interval '8 days'
where clinic_id = pg_temp.c() and email = 'caixa.equipe@exemplo.test';
select set_config('teste.i2', (select id::text from agenda.member_invites where clinic_id = pg_temp.c() and email = 'caixa.equipe@exemplo.test'), true);
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', pg_temp.u(6), 'authenticated', 'authenticated', 'caixa.equipe@exemplo.test', now(),
        '{"provider": "email", "providers": ["email"]}', '{}', now(), now());
select pg_temp.entrar('authenticated', pg_temp.u(6), 'caixa.equipe@exemplo.test');
select is(public.agenda_invite_accept(current_setting('teste.i2')::uuid) ->> 'status', 'expired', 'convite vencido (7 dias) não vale');

/* ===================== Papéis e último dono ===================== */
select pg_temp.como(2);
select is(public.agenda_member_role(pg_temp.c(), pg_temp.u(3), 'reception') ->> 'status', 'ok', 'o gestor troca o papel de alguém');
select is(public.agenda_member_role(pg_temp.c(), pg_temp.u(3), 'owner') ->> 'status', 'forbidden', 'o gestor não faz ninguém dono');
select is(public.agenda_member_role(pg_temp.c(), pg_temp.u(1), 'manager') ->> 'status', 'forbidden', 'o gestor não rebaixa a dona');
select pg_temp.como(1);
select is(public.agenda_member_role(pg_temp.c(), pg_temp.u(1), 'manager') ->> 'status', 'last_owner', 'a única dona não se rebaixa');
select is(public.agenda_member_remove(pg_temp.c(), pg_temp.u(1)) ->> 'status', 'last_owner', 'nem sai da equipe');
select is(public.agenda_member_role(pg_temp.c(), pg_temp.u(2), 'owner') ->> 'status', 'ok', 'a dona faz o gestor dono');
select is(public.agenda_member_role(pg_temp.c(), pg_temp.u(1), 'manager') ->> 'status', 'ok', 'com outro dono, ela pode virar gestora');
select pg_temp.como(2);
select is(public.agenda_member_remove(pg_temp.c(), pg_temp.u(3)) ->> 'status', 'ok', 'o dono tira alguém da equipe');
select pg_temp.como(3);
select is(jsonb_array_length(public.agenda_me() -> 'clinics'), 0, 'quem saiu perde o acesso na próxima chamada');
select pg_temp.entrar('postgres');
select is((select count(*)::int from agenda.audit_log where clinic_id = pg_temp.c()
           and action in ('convite_criado', 'convite_aceito', 'papel_trocado', 'membro_removido')
           and (coalesce(old_value::text, '') ~ '@' or coalesce(new_value::text, '') ~ '@')), 0, 'auditoria da equipe sem e-mail');

select * from finish();
rollback;
