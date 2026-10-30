-- Segurança e LGPD do banco do IMED (auditoria de 30/10/2026, revisada no mesmo dia).
--
-- Em linguagem simples, esta migração:
--   1. Fecha uma brecha nas avaliações: um visitante sem conta conseguia avaliar, SEM o código secreto do
--      pedido, um atendimento concluído de um paciente que fez o pedido com a conta aberta. A avaliação saía
--      com o primeiro nome desse paciente. Agora só avalia quem tem o código do pedido ou é o dono da conta.
--   2. A equipe do IMED (admin) só é reconhecida na conta certa e em sessão aberta pelo link do e-mail.
--      Antes bastava a sessão trazer o e-mail do admin. Com "Confirm email" desligado, ou com entrada anônima
--      ligada, dava para conseguir esse e-mail numa conta sem ter acesso à caixa de e-mail (criando a conta
--      com senha, ou entrando como anônimo e acrescentando o e-mail, que o Supabase confirma sozinho).
--      Agora: a conta tem de ter esse e-mail confirmado, só login por e-mail (sem celular, Google ou anônimo)
--      e a sessão não pode ter sido aberta com senha nem como anônima. Depois que o admin entrar pela 1ª vez,
--      a conta dele pode ser presa ao e-mail (private.vincular_admin, abaixo) e nenhuma outra conta vale.
--   3. Liga a proteção por linha (RLS) na tabela do token interno (private.app_tokens). Ela já não era
--      alcançável pela API; isto é uma segunda tranca e tira o alerta "crítico" do painel do Supabase.
--   4. Funções internas (fila de importação, grade da agenda, gatilhos) deixam de ser executáveis por
--      anon/authenticated. O pg_cron, os gatilhos e as funções do site continuam funcionando.
--   5. Tira de anon/authenticated privilégios que a API nunca usa (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN;
--      o TRUNCATE ignora o RLS) e acessos diretos sem uso (admin_emails, leitura da lista de espera por
--      visitantes, sequência da fila).
--   6. Faz o item 5 valer também para tabelas e sequências criadas daqui para a frente no schema public.
--   7. A avaliação de um pedido não pode cair em outro local: o código do local (place_ref) tem de começar
--      pela fonte do próprio pedido. Antes, um pedido para local não parceiro podia levar o código de uma
--      clínica parceira, e a nota ia para a média dela.
--
-- Nada é apagado e tudo pode rodar de novo sem erro. As chamadas que o site faz continuam iguais
-- (testado como anon, paciente logado, clínica e admin, numa transação desfeita, antes de aplicar).
-- Se outra migração mexer em submit_review ou is_imed_admin depois desta, mantenha as regras abaixo.

/* ===================== 1. Avaliações: checagem de dono sem brecha ===================== */
-- Antes: "if not ((user_id = auth.uid()) or (hash = ...))". Para quem não está logado, auth.uid() é nulo,
-- a comparação vira NULL, "not (NULL or false)" continua NULL e o "if" não barrava. "is true" trata nulo
-- como "não é o dono".
-- O código do local da avaliação vem da clínica parceira (clinic_id) ou do place_ref do pedido (regra da
-- seção 7). Pedido sem place_ref (o site sempre manda) não ganha mais código montado com o nome digitado
-- (um nome "2077485" virava "cnes:2077485", a nota de outro local): fica num código só daquele pedido.
create or replace function public.submit_review(p_request uuid, p_token text, p_rating integer, p_comment text default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  c text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then return 'invalid_rating'; end if;
  if c is not null and char_length(c) > 500 then return 'comment_too_long'; end if;
  select * into r from public.appointment_requests where id = p_request;
  if not found then return 'not_found'; end if;
  if not ((r.user_id = auth.uid()) is true
          or (r.review_token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')) is true) then
    return 'forbidden';
  end if;
  if r.status <> 'completed' then return 'not_completed'; end if;
  if exists (select 1 from public.reviews where request_id = r.id) then return 'already_reviewed'; end if;
  insert into public.reviews (request_id, place_key, rating, comment, author_name)
  values (r.id, case when r.clinic_id is not null then 'imed:' || r.clinic_id
                     when r.place_ref is not null then r.place_ref
                     else 'pedido:' || r.id end,
          p_rating, c, left(split_part(btrim(r.patient_name), ' ', 1), 60));
  return 'ok';
end $$;
revoke execute on function public.submit_review(uuid, text, integer, text) from public;
grant execute on function public.submit_review(uuid, text, integer, text) to anon, authenticated;

/* ===================== 2. Admin: a conta certa, aberta pelo link do e-mail ===================== */
-- Quem é admin continua em admin_emails. A nova coluna user_id prende o admin a UMA conta do Supabase Auth;
-- fica vazia até alguém rodar "select * from private.vincular_admin();" depois da 1ª entrada do admin.
alter table public.admin_emails add column if not exists user_id uuid unique references auth.users (id) on delete set null;

-- O admin só é reconhecido quando tudo isto vale ao mesmo tempo:
--   a) o e-mail da sessão está em admin_emails e é o e-mail atual da conta, já confirmado;
--   b) se o admin já foi vinculado (user_id preenchido), a conta é exatamente essa;
--   c) a conta só entra por e-mail: não é anônima, não tem celular e não tem Google/outro login ligado
--      (com celular ou outro login dá para abrir sessão sem a caixa de e-mail do admin);
--   d) a sessão não foi aberta com senha nem como anônima (amr "password"/"anonymous"). O site só usa o
--      link do e-mail (amr "otp"); se o Supabase deixar alguém criar conta com senha, ou entrar como anônimo
--      e acrescentar o e-mail, a sessão dessa pessoa continua marcada assim e não vale como admin.
-- Sem nada disso, um token de outra conta com o e-mail do admin não passa (a conta não tem esse e-mail).
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
           where coalesce(m ->> 'method', m #>> '{}') in ('password', 'anonymous')
         );
$$;
revoke all on function public.is_imed_admin() from public, anon;
grant execute on function public.is_imed_admin() to authenticated;

-- Prende cada e-mail de admin à conta dele. Rodar uma vez, pelo SQL do Supabase, DEPOIS que o admin entrar
-- no painel.html pelo link do e-mail: "select * from private.vincular_admin();". Só vincula a conta que
-- passa nas regras acima, que já entrou pelo link e que nunca abriu sessão com senha nem como anônima;
-- senão diz o motivo e não muda nada. Confira a data e a hora da entrada com o admin antes.
-- (Não mostra o e-mail; para desfazer: "update public.admin_emails set user_id = null;".)
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
      resultado := case when n = 0 then 'sem conta: o admin precisa entrar no painel.html pelo link do e-mail'
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
                  where s.user_id = u.id and c.authentication_method in ('password', 'anonymous')) then
      resultado := 'não vinculada: a conta já abriu sessão com senha ou como anônima; confira em Authentication > Users';
    elsif not exists (select 1 from auth.sessions s join auth.mfa_amr_claims c on c.session_id = s.id
                      where s.user_id = u.id and c.authentication_method in ('otp', 'magiclink', 'email/signup')) then
      resultado := 'não vinculada: nenhuma sessão aberta pelo link do e-mail (o admin precisa entrar e continuar conectado)';
    else
      update public.admin_emails e set user_id = u.id where e.email = a.email and e.user_id is null;
      resultado := 'vinculada';
    end if;
    return next;
  end loop;
end $$;
revoke all on function private.vincular_admin() from public, anon, authenticated;

/* ===================== 3. Token interno com RLS ===================== */
-- Só as funções do próprio banco (dono postgres) leem esta tabela; elas não são afetadas pelo RLS.
alter table private.app_tokens enable row level security;

/* ===================== 4. Funções internas fora do alcance de anon/authenticated ===================== */
do $$
declare
  f text;
begin
  foreach f in array array[
    'private.process_import_queue()',                          -- chamada só pelo pg_cron (dono postgres)
    'private.clinic_slot_grid(uuid, text, date, integer)',      -- usada por available_slots (SECURITY DEFINER)
    'public.touch_updated_at()',                                -- função de gatilho
    'public.check_appointment_request()',                       -- função de gatilho
    'public.check_establishment_claim()'                        -- função de gatilho (já estava assim)
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', to_regprocedure(f));
    end if;
  end loop;
end $$;

/* ===================== 5. Privilégios de tabela que a API nunca usa ===================== */
do $$
declare
  t regclass;
  privs text := 'truncate, references, trigger';
begin
  if current_setting('server_version_num')::int >= 170000 then privs := privs || ', maintain'; end if;
  for t in
    select c.oid::regclass
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('revoke %s on table %s from anon, authenticated', privs, t);
  end loop;
end $$;

-- Lista de administradores: ninguém lê nem escreve pela API (is_imed_admin lê como dono da tabela).
revoke all on table public.admin_emails from anon, authenticated;

-- Lista de espera: o visitante só insere (o site envia com "return=minimal", sem ler de volta).
-- A leitura continua só para o admin (policy "admin le app_waitlist").
revoke select, update, delete on table public.app_waitlist from anon;
revoke update, delete on table public.app_waitlist from authenticated;

-- Sequência da fila de importação: só o banco e o importador usam.
do $$
begin
  if to_regclass('public.import_queue_id_seq') is not null then
    revoke all on sequence public.import_queue_id_seq from anon, authenticated;
  end if;
end $$;

/* ===================== 6. O mesmo para objetos novos no schema public ===================== */
-- Tabelas novas continuam com SELECT/INSERT/UPDATE/DELETE para anon/authenticated (protegidas pelo RLS de
-- cada uma); só saem os privilégios que a API não usa. Sequências novas continuam com USAGE (nextval).
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke update on sequences from anon, authenticated;
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'alter default privileges for role postgres in schema public revoke maintain on tables from anon, authenticated';
  end if;
end $$;

/* ===================== 7. Avaliação não cai em outro local ===================== */
-- Pedido para local não parceiro (concierge) guarda em place_ref o código do local ("cnes:1234567",
-- "osm:n123", "google:..."), e a avaliação vai para esse código (seção 1). Sem regra, um visitante mandava
-- place_ref "imed:<clínica parceira>" num pedido concierge; quando a equipe do IMED concluísse o pedido, a
-- nota entrava na média da clínica parceira, que nem recebeu o pedido. Agora o código tem de começar pela
-- fonte do próprio pedido, como o site sempre manda (assets/js/geo-core.js, bookingRow). Pedido de parceiro
-- (place_source "imed") usa clinic_id e o site manda place_ref vazio.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.appointment_requests'::regclass and conname = 'appointment_requests_place_ref_fmt') then
    alter table public.appointment_requests add constraint appointment_requests_place_ref_fmt
      check (place_ref is null or starts_with(place_ref, place_source || ':')) not valid;
  end if;
end $$;
-- Confere os pedidos que já existem (em 30/10 todos seguiam o formato). Se algum não seguir, a migração
-- para aqui sem mudar nada: veja o pedido antes de aplicar de novo.
alter table public.appointment_requests validate constraint appointment_requests_place_ref_fmt;
