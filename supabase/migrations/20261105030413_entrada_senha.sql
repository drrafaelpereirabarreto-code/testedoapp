-- Entrada com senha (05/11/2026). Volta: supabase/volta/<mesmo nome>.sql.
--
-- Em linguagem simples: o site só entrava por link mandado por e-mail, e o e-mail do Supabase Auth está parado
-- (SMTP sem domínio verificado e limite de 2 e-mails por hora). O dono saiu da conta em 03/11 e desde então não
-- consegue entrar em lugar nenhum. A partir desta migração, quem tem senha pode entrar com e-mail e senha
-- (assets/js/auth.js: signInWithPassword; senha definida em definir-senha.html com um link de recuperação).
-- Para isso, as três funções que marcavam "sessão aberta com senha não vale" passam a aceitar a senha:
--   1. public.is_imed_admin()             (equipe do IMED: painel, gestão, área do médico);
--   2. private.agenda_secure_session()    (imed_has, convites da equipe da clínica);
--   3. private.vincular_admin()           (prende o e-mail do admin à conta dele).
-- O que NÃO muda: e-mail confirmado, conta não anônima, sem celular, sem outro login ligado (Google etc.),
-- conta não banida; sessão ANÔNIMA continua recusada. Senha vazada: ligar "Leaked password protection" no painel do
-- Supabase (Authentication > Attack protection) — aviso do advisor de segurança.
--   4. private.visit_path: a lista fechada de páginas ganha definir-senha.html (31 páginas fixas; gerada por
--      node scripts/aplicar-visitas.mjs --sql; tests/visitas.test.mjs confere).
--
-- Nada aqui apaga nem troca dado: só CREATE OR REPLACE FUNCTION. Pode rodar de novo sem erro.
-- Aplicada na produção em 05/11/2026 (versão 20261105030413). Conferir (como postgres; tem de dar true):
--   select not (pg_get_functiondef('public.is_imed_admin()'::regprocedure) like '%''password''%')
--      and not (pg_get_functiondef('private.agenda_secure_session()'::regprocedure) like '%''password''%')
--      and pg_get_functiondef('private.visit_path(text)'::regprocedure) like '%/definir-senha.html%';

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. Equipe do IMED: senha vale, anônimo não ===================== */
-- Igual à versão da migração 20261030074604_seguranca, menos o 'password' na lista de métodos recusados.
create or replace function public.is_imed_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
           select 1
           from public.admin_emails a
           join auth.users u on u.id = auth.uid()
           where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
             and (a.user_id is null or a.user_id = u.id)
             and lower(u.email) = a.email
             and u.email_confirmed_at is not null
             and u.deleted_at is null
             and (u.banned_until is null or u.banned_until <= now())
             and not coalesce(u.is_anonymous, false)
             and coalesce(u.phone, '') = ''
             and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider <> 'email')
         )
     and not exists (
           select 1
           from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) m
           where coalesce(m ->> 'method', m #>> '{}') = 'anonymous'
         );
$$;
revoke all on function public.is_imed_admin() from public, anon;
grant execute on function public.is_imed_admin() to authenticated;

/* ===================== 2. Sessão segura da agenda (imed_has, convites) ===================== */
create or replace function private.agenda_secure_session()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
           select 1
           from auth.users u
           where u.id = auth.uid()
             and u.email is not null
             and lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
             and u.email_confirmed_at is not null
             and u.deleted_at is null
             and (u.banned_until is null or u.banned_until <= now())
             and not coalesce(u.is_anonymous, false)
             and coalesce(u.phone, '') = ''
             and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider <> 'email')
         )
     and not exists (
           select 1
           from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) m
           where coalesce(m ->> 'method', m #>> '{}') = 'anonymous'
         );
$$;
revoke all on function private.agenda_secure_session() from public, anon, authenticated;

/* ===================== 3. Vincular o admin à conta: sessão por link OU por senha ===================== */
-- Rodar uma vez, pelo SQL do Supabase, depois que o admin entrar: "select * from private.vincular_admin();".
create or replace function private.vincular_admin()
returns table (conta uuid, criada_em timestamptz, ultima_entrada timestamptz, resultado text)
language plpgsql
set search_path = ''
as $$
declare
  a record;
  u auth.users;
  n integer;
begin
  for a in select e.email from public.admin_emails e where e.user_id is null order by e.email loop
    conta := null; criada_em := null; ultima_entrada := null;
    select count(*) into n from auth.users x where lower(x.email) = a.email and x.deleted_at is null;
    if n <> 1 then
      resultado := case when n = 0 then 'sem conta: o admin precisa entrar no painel.html (link do e-mail ou senha)'
                        else 'mais de uma conta com o e-mail do admin: confira em Authentication > Users' end;
      return next;
      continue;
    end if;
    select x.* into u from auth.users x where lower(x.email) = a.email and x.deleted_at is null;
    conta := u.id; criada_em := u.created_at; ultima_entrada := u.last_sign_in_at;
    if u.email_confirmed_at is null or coalesce(u.is_anonymous, false) or coalesce(u.phone, '') <> ''
       or exists (select 1 from auth.identities i where i.user_id = u.id and i.provider <> 'email') then
      resultado := 'não vinculada: e-mail não confirmado, conta anônima, com celular ou com outro login ligado';
    elsif exists (select 1 from auth.sessions s join auth.mfa_amr_claims c on c.session_id = s.id
                  where s.user_id = u.id and c.authentication_method = 'anonymous') then
      resultado := 'não vinculada: a conta já abriu sessão como anônima; confira em Authentication > Users';
    elsif not exists (select 1 from auth.sessions s join auth.mfa_amr_claims c on c.session_id = s.id
                      where s.user_id = u.id and c.authentication_method in ('otp', 'magiclink', 'email/signup', 'recovery', 'password')) then
      resultado := 'não vinculada: nenhuma sessão aberta pelo link do e-mail ou com senha (o admin precisa entrar e continuar conectado)';
    else
      update public.admin_emails e set user_id = u.id where e.email = a.email and e.user_id is null;
      resultado := 'vinculada';
    end if;
    return next;
  end loop;
end $$;
revoke all on function private.vincular_admin() from public, anon, authenticated;

/* ===================== 4. Contador de visitas: definir-senha.html ===================== */
-- Lista de páginas do contador de visitas (31 páginas fixas), gerada por scripts/aplicar-visitas.mjs --sql
create or replace function private.visit_path(p_path text)
returns text
language sql
stable
set search_path = ''
as $$
  with c as (select regexp_replace(btrim(left(coalesce(p_path, ''), 200)), '/index\.html$', '/') as p)
  select case
    when char_length(p) not between 1 and 120 or p ~ '[0-9]{5}' then null
    -- Páginas fixas do site (lista fechada, gerada por scripts/aplicar-visitas.mjs --sql).
    when p = any (array[
      '/', '/404', '/acessibilidade.html', '/cidades/', '/como-funciona.html', '/conta.html',
      '/contato.html', '/definir-senha.html', '/documento.html', '/exames/',
      '/exames/densitometria-ossea.html', '/exames/ecocardiograma.html', '/exames/eletrocardiograma.html',
      '/exames/mamografia.html', '/exames/raio-x.html', '/exames/ressonancia-magnetica.html',
      '/exames/tomografia.html', '/exames/ultrassom.html', '/gestao.html', '/local.html', '/medico.html',
      '/painel.html', '/para-medicos.html', '/parceiros.html', '/perto.html', '/privacidade.html',
      '/reivindicar.html', '/sobre.html', '/teleconsulta.html', '/termo-teleconsulta.html', '/termos.html']) then p
    -- Página de cidade: só de um município que existe (mesmo nome sem acento do gerador das cidades).
    when p ~ '^/cidades/[a-z]{2}/[a-z0-9]+(-[a-z0-9]+)*/((diagnostico-por-imagem|laboratorios|clinicas|hospitais)\.html)?$'
         and exists (select 1 from public.municipalities m
                     where m.uf = upper(split_part(p, '/', 3)) and private.visit_slug(m.name) = split_part(p, '/', 4)) then p
    else null
  end
  from c;
$$;
revoke all on function private.visit_path(text) from public, anon, authenticated;
