-- Base mínima do laço rápido (tests/banco/local/): só o que os testes da agenda precisam do Supabase.
-- Papéis da API (anon, authenticated, service_role), funções auth.uid(), auth.role() e auth.jwt() iguais às do
-- Supabase (leem request.jwt.claims, como o PostgREST grava a cada chamada) e a extensão btree_gist (= em uuid
-- dentro do índice GiST da restrição de exclusão). Não tem PostGIS, PostgREST, Auth nem Realtime: isso é do CI.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema extensions;
create extension btree_gist with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
