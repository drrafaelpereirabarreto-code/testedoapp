-- Marketplace do IMED: convênios, avaliações de pacientes, reivindicação do cadastro pela clínica,
-- painel da clínica, conta do paciente e listas por cidade (páginas para o Google).

/* ===================== Clínicas parceiras ===================== */
alter table public.clinics add column if not exists insurances text[] not null default '{}';
alter table public.clinics add column if not exists cnes text unique references public.establishments (cnes) on delete set null;
comment on column public.clinics.insurances is 'Convênios aceitos, como a clínica informou (ex.: Bradesco Saúde, SulAmérica).';
comment on column public.clinics.cnes is 'Estabelecimento do CNES que virou esta clínica parceira (cadastro reivindicado).';

-- Pessoas que administram cada clínica (dono e equipe).
create table if not exists public.clinic_members (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);
create index if not exists clinic_members_user_idx on public.clinic_members (user_id);
alter table public.clinic_members enable row level security;
revoke all on public.clinic_members from anon;
revoke insert, update, delete, truncate on public.clinic_members from authenticated;
create policy "membro ve seus vinculos" on public.clinic_members
  for select to authenticated using (user_id = auth.uid() or public.is_imed_admin());

create or replace function public.is_clinic_member(p_clinic uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.clinic_members m where m.clinic_id = p_clinic and m.user_id = auth.uid());
$$;
revoke execute on function public.is_clinic_member(uuid) from public, anon;
grant execute on function public.is_clinic_member(uuid) to authenticated;

create policy "membro ve a propria clinica" on public.clinics
  for select to authenticated using (public.is_clinic_member(id));
create policy "membro ve exames da propria clinica" on public.clinic_exams
  for select to authenticated using (public.is_clinic_member(clinic_id));

-- Busca de parceiros: agora devolve também convênios e o código CNES.
drop function if exists public.nearby_clinics(double precision, double precision, integer, text, text, text, integer, integer, boolean, integer);
create function public.nearby_clinics(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 10000,
  p_exam text default null,
  p_kind text default null,
  p_specialty text default null,
  p_min_price_cents integer default null,
  p_max_price_cents integer default null,
  p_include_demo boolean default false,
  p_limit integer default 50
)
returns table (
  id uuid, name text, kind text, description text, address_line text, neighborhood text, city text, state text,
  cep text, lat double precision, lng double precision, distance_m integer, phone text, whatsapp text, email text,
  website text, specialties text[], opening_hours jsonb, accepts_online_booking boolean, is_demo boolean, exams jsonb,
  insurances text[], cnes text
)
language sql stable security invoker
set search_path = public, extensions
as $$
  with origin as (
    select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography as g
    where p_lat between -90 and 90 and p_lng between -180 and 180
  )
  select
    c.id, c.name, c.kind, c.description, c.address_line, c.neighborhood, c.city, c.state, c.cep,
    extensions.st_y(c.location::extensions.geometry) as lat,
    extensions.st_x(c.location::extensions.geometry) as lng,
    round(extensions.st_distance(c.location, o.g))::integer as distance_m,
    c.phone, c.whatsapp, c.email, c.website, c.specialties, c.opening_hours,
    c.accepts_online_booking, c.is_demo,
    coalesce((
      select jsonb_agg(jsonb_build_object('code', e.exam_code, 'price_cents', e.price_cents, 'price_updated_at', e.price_updated_at) order by e.exam_code)
      from public.clinic_exams e where e.clinic_id = c.id
    ), '[]'::jsonb) as exams,
    c.insurances, c.cnes
  from public.clinics c
  cross join origin o
  where c.status = 'published'
    and (p_include_demo or not c.is_demo)
    and extensions.st_dwithin(c.location, o.g, least(greatest(coalesce(p_radius_m, 10000), 100), 50000))
    and (p_kind is null or c.kind = p_kind)
    and (p_specialty is null or p_specialty = any (c.specialties))
    and (p_exam is null or exists (
      select 1 from public.clinic_exams e where e.clinic_id = c.id and e.exam_code = p_exam))
    and ((p_min_price_cents is null and p_max_price_cents is null) or exists (
      select 1 from public.clinic_exams e
      where e.clinic_id = c.id
        and (p_exam is null or e.exam_code = p_exam)
        and e.price_cents is not null
        and (p_min_price_cents is null or e.price_cents >= p_min_price_cents)
        and (p_max_price_cents is null or e.price_cents <= p_max_price_cents)))
  order by extensions.st_distance(c.location, o.g)
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;
grant execute on function public.nearby_clinics(double precision, double precision, integer, text, text, text, integer, integer, boolean, integer) to anon, authenticated;

-- Estabelecimento do CNES que já virou parceiro aparece só como parceiro.
create or replace function public.nearby_establishments(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 5000,
  p_limit integer default 150
)
returns table (
  cnes text, name text, kind text, cnes_type smallint, address_line text, neighborhood text, cep text, city text,
  uf text, city_code integer, lat double precision, lng double precision, distance_m integer, location_source text,
  phone text, shift text, open_24h boolean, sus boolean, services text[], specialties text[], cnes_updated_at date
)
language sql stable security invoker
set search_path = public, extensions
as $$
  with origin as (
    select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography as g
    where p_lat between -90 and 90 and p_lng between -180 and 180
  )
  select
    e.cnes, e.name, e.kind, e.cnes_type, e.address_line, e.neighborhood, e.cep,
    m.name as city, m.uf, m.cnes_code as city_code,
    extensions.st_y(e.location::extensions.geometry) as lat,
    extensions.st_x(e.location::extensions.geometry) as lng,
    round(extensions.st_distance(e.location, o.g))::integer as distance_m,
    e.location_source, e.phone, e.shift, e.open_24h, e.sus, e.services, e.specialties, e.cnes_updated_at
  from public.establishments e
  join public.municipalities m on m.ibge = e.city_ibge
  cross join origin o
  where e.location is not null
    and extensions.st_dwithin(e.location, o.g, least(greatest(coalesce(p_radius_m, 5000), 100), 50000))
    and not exists (select 1 from public.clinics c where c.cnes = e.cnes and c.status = 'published')
  order by extensions.st_distance(e.location, o.g)
  limit least(greatest(coalesce(p_limit, 150), 1), 300);
$$;

/* ===================== Pedidos de agendamento ===================== */
alter table public.appointment_requests add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.appointment_requests add column if not exists review_token_hash text
  check (review_token_hash is null or review_token_hash ~ '^[0-9a-f]{64}$');
alter table public.appointment_requests drop constraint if exists appointment_requests_status_check;
alter table public.appointment_requests add constraint appointment_requests_status_check
  check (status in ('pending', 'contacted', 'confirmed', 'cancelled', 'completed'));
create index if not exists appointment_requests_user_idx on public.appointment_requests (user_id) where user_id is not null;
comment on column public.appointment_requests.review_token_hash is
  'SHA-256 (hex) de um código aleatório que fica só no aparelho do paciente. Prova que o pedido é dele para ver a situação e avaliar.';

-- O pedido fica ligado à conta de quem está logado (nunca a uma conta escolhida pelo navegador).
create or replace function public.check_appointment_request()
returns trigger language plpgsql set search_path = '' as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if new.preferred_date < today or new.preferred_date > today + 120 then
    raise exception 'Data preferida fora do intervalo permitido' using errcode = '22023';
  end if;
  if new.clinic_id is not null and not exists (
    select 1 from public.clinics c
    where c.id = new.clinic_id and c.status = 'published' and c.accepts_online_booking
  ) then
    raise exception 'Esta clínica não recebe pedidos de agendamento pelo site' using errcode = '22023';
  end if;
  new.status := 'pending';
  new.created_at := now();
  new.user_id := auth.uid();
  return new;
end $$;

create policy "paciente ve seus pedidos" on public.appointment_requests
  for select to authenticated using (user_id = auth.uid());
create policy "clinica ve pedidos para ela" on public.appointment_requests
  for select to authenticated using (clinic_id is not null and public.is_clinic_member(clinic_id));

-- A clínica (ou a equipe do IMED) muda a situação do pedido.
create or replace function public.set_request_status(p_id uuid, p_status text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
begin
  if p_status not in ('contacted', 'confirmed', 'cancelled', 'completed') then return 'invalid_status'; end if;
  select * into r from public.appointment_requests where id = p_id for update;
  if not found then return 'not_found'; end if;
  if not (public.is_imed_admin() or (r.clinic_id is not null and public.is_clinic_member(r.clinic_id))) then
    return 'forbidden';
  end if;
  update public.appointment_requests set status = p_status where id = p_id;
  return 'ok';
end $$;
revoke execute on function public.set_request_status(uuid, text) from public, anon;
grant execute on function public.set_request_status(uuid, text) to authenticated;

/* ===================== Avaliações ===================== */
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  request_id uuid not null unique references public.appointment_requests (id) on delete cascade,
  place_key text not null check (char_length(place_key) <= 200),
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 500),
  author_name text not null check (char_length(author_name) between 1 and 60),
  status text not null default 'published' check (status in ('published', 'hidden'))
);
create index if not exists reviews_place_idx on public.reviews (place_key) where status = 'published';
alter table public.reviews enable row level security;
revoke all on public.reviews from anon, authenticated;
grant select, update on public.reviews to authenticated;
create policy "admin modera avaliacoes" on public.reviews
  for all to authenticated using (public.is_imed_admin()) with check (public.is_imed_admin());
comment on table public.reviews is 'Avaliações de pacientes. Só quem teve o pedido concluído pode avaliar, uma vez por pedido.';

-- Situação dos pedidos guardados no aparelho, para quem não tem conta: só com o código do pedido.
create or replace function public.request_status(p_ids uuid[], p_tokens text[])
returns table (id uuid, status text, reviewed boolean)
language sql stable security definer
set search_path = ''
as $$
  select r.id, r.status, exists (select 1 from public.reviews v where v.request_id = r.id)
  from unnest(p_ids[1:30], p_tokens[1:30]) as t(id, token)
  join public.appointment_requests r on r.id = t.id
  where r.review_token_hash is not null
    and r.review_token_hash = encode(extensions.digest(coalesce(t.token, ''), 'sha256'), 'hex');
$$;
revoke execute on function public.request_status(uuid[], text[]) from public;
grant execute on function public.request_status(uuid[], text[]) to anon, authenticated;

-- Avaliar: o pedido precisa estar concluído e ser do paciente (pelo código do pedido ou pela conta).
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
  if not ((r.user_id is not null and r.user_id = auth.uid())
          or (r.review_token_hash is not null and r.review_token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex'))) then
    return 'forbidden';
  end if;
  if r.status <> 'completed' then return 'not_completed'; end if;
  if exists (select 1 from public.reviews where request_id = r.id) then return 'already_reviewed'; end if;
  insert into public.reviews (request_id, place_key, rating, comment, author_name)
  values (r.id, case when r.clinic_id is not null then 'imed:' || r.clinic_id else coalesce(r.place_ref, r.place_source || ':' || r.place_name) end,
          p_rating, c, left(split_part(btrim(r.patient_name), ' ', 1), 60));
  return 'ok';
end $$;
revoke execute on function public.submit_review(uuid, text, integer, text) from public;
grant execute on function public.submit_review(uuid, text, integer, text) to anon, authenticated;

-- Nota média e número de avaliações dos locais pedidos (ids do site: imed:<uuid>, cnes:<código>...).
create or replace function public.place_ratings(p_keys text[])
returns table (place_key text, rating numeric, reviews integer)
language sql stable security definer
set search_path = ''
as $$
  select v.place_key, round(avg(v.rating)::numeric, 1), count(*)::integer
  from public.reviews v
  where v.status = 'published' and v.place_key = any (p_keys[1:300])
  group by v.place_key;
$$;
revoke execute on function public.place_ratings(text[]) from public;
grant execute on function public.place_ratings(text[]) to anon, authenticated;

create or replace function public.place_reviews(p_key text, p_limit integer default 10)
returns table (rating smallint, comment text, author_name text, created_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select v.rating, v.comment, v.author_name, v.created_at
  from public.reviews v
  where v.status = 'published' and v.place_key = p_key
  order by v.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;
revoke execute on function public.place_reviews(text, integer) from public;
grant execute on function public.place_reviews(text, integer) to anon, authenticated;

/* ===================== Reivindicação do cadastro ===================== */
create table if not exists public.establishment_claims (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cnes text not null references public.establishments (cnes) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  email text,
  claimant_name text not null check (char_length(claimant_name) between 2 and 120),
  role text not null check (role in ('proprietario', 'socio', 'gestor', 'responsavel_tecnico', 'outro')),
  document text not null check (document ~ '^([0-9]{11}|[0-9]{14})$'),
  crm text check (crm is null or char_length(crm) <= 20),
  phone text not null check (phone ~ '^[0-9]{10,11}$'),
  message text check (message is null or char_length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  clinic_id uuid references public.clinics (id) on delete set null
);
create unique index if not exists establishment_claims_pending_uq on public.establishment_claims (cnes, user_id) where status = 'pending';
alter table public.establishment_claims enable row level security;
revoke all on public.establishment_claims from anon;
revoke update, delete, truncate on public.establishment_claims from authenticated;
create policy "clinica pede o cadastro" on public.establishment_claims
  for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
create policy "quem pediu ou admin ve" on public.establishment_claims
  for select to authenticated using (user_id = auth.uid() or public.is_imed_admin());
comment on table public.establishment_claims is 'Pedidos de clínicas para assumir o próprio cadastro do CNES. A equipe do IMED confere e aprova.';

create or replace function public.check_establishment_claim()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Entre com seu e-mail para pedir o cadastro' using errcode = '42501'; end if;
  if exists (select 1 from public.clinics c where c.cnes = new.cnes and c.status = 'published') then
    raise exception 'Este estabelecimento já é parceiro do IMED' using errcode = '22023';
  end if;
  new.user_id := auth.uid();
  new.email := lower(coalesce(auth.jwt() ->> 'email', ''));
  new.status := 'pending';
  new.created_at := now();
  new.decided_at := null;
  new.clinic_id := null;
  return new;
end $$;
drop trigger if exists establishment_claims_check on public.establishment_claims;
create trigger establishment_claims_check before insert on public.establishment_claims
for each row execute function public.check_establishment_claim();

-- A equipe do IMED aprova: o estabelecimento vira clínica parceira e quem pediu passa a administrá-la.
create or replace function public.approve_claim(p_claim uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  cl public.establishment_claims;
  e public.establishments;
  m public.municipalities;
  cid uuid;
begin
  if not public.is_imed_admin() then raise exception 'Só a equipe do IMED aprova' using errcode = '42501'; end if;
  select * into cl from public.establishment_claims where id = p_claim for update;
  if not found or cl.status <> 'pending' then raise exception 'Pedido não encontrado ou já decidido' using errcode = '22023'; end if;
  select * into e from public.establishments where cnes = cl.cnes;
  if e.location is null then raise exception 'Estabelecimento sem localização no mapa' using errcode = '22023'; end if;
  select * into m from public.municipalities where ibge = e.city_ibge;
  select id into cid from public.clinics where cnes = e.cnes;
  if cid is null then
    insert into public.clinics (name, kind, address_line, neighborhood, city, state, cep, location, phone, specialties,
                                accepts_online_booking, status, is_demo, cnes)
    values (e.name, e.kind, coalesce(nullif(e.address_line, ''), 'Endereço a confirmar'), e.neighborhood, m.name, m.uf,
            case when e.cep ~ '^[0-9]{8}$' then left(e.cep, 5) || '-' || right(e.cep, 3) end,
            e.location, case when char_length(coalesce(e.phone, '')) between 8 and 25 then e.phone end, e.specialties,
            true, 'published', false, e.cnes)
    returning id into cid;
    insert into public.clinic_exams (clinic_id, exam_code, price_cents)
    select cid, s, null from unnest(e.services) s
    where s in ('rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab')
    on conflict do nothing;
  else
    update public.clinics set status = 'published' where id = cid;
  end if;
  insert into public.clinic_members (clinic_id, user_id, role) values (cid, cl.user_id, 'owner') on conflict do nothing;
  update public.establishment_claims set status = 'approved', decided_at = now(), clinic_id = cid where id = cl.id;
  return cid;
end $$;
revoke execute on function public.approve_claim(uuid) from public, anon;
grant execute on function public.approve_claim(uuid) to authenticated;

create or replace function public.reject_claim(p_claim uuid, p_note text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_imed_admin() then raise exception 'Só a equipe do IMED decide' using errcode = '42501'; end if;
  update public.establishment_claims set status = 'rejected', decided_at = now(), decision_note = left(p_note, 300)
  where id = p_claim and status = 'pending';
end $$;
revoke execute on function public.reject_claim(uuid, text) from public, anon;
grant execute on function public.reject_claim(uuid, text) to authenticated;

/* ===================== Painel da clínica ===================== */
-- A clínica edita os próprios dados. Só os campos da lista mudam; o resto fica com a equipe do IMED.
create or replace function public.update_my_clinic(p_clinic uuid, p jsonb)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if not (public.is_clinic_member(p_clinic) or public.is_imed_admin()) then return 'forbidden'; end if;
  update public.clinics c set
    phone = case when p ? 'phone' then nullif(btrim(p ->> 'phone'), '') else c.phone end,
    whatsapp = case when p ? 'whatsapp' then nullif(regexp_replace(coalesce(p ->> 'whatsapp', ''), '\D', '', 'g'), '') else c.whatsapp end,
    email = case when p ? 'email' then nullif(lower(btrim(p ->> 'email')), '') else c.email end,
    website = case when p ? 'website' then nullif(btrim(p ->> 'website'), '') else c.website end,
    description = case when p ? 'description' then nullif(btrim(p ->> 'description'), '') else c.description end,
    opening_hours = case when p ? 'opening_hours' then nullif(p -> 'opening_hours', 'null'::jsonb) else c.opening_hours end,
    accepts_online_booking = case when p ? 'accepts_online_booking' then coalesce((p ->> 'accepts_online_booking')::boolean, false) else c.accepts_online_booking end,
    specialties = case when p ? 'specialties' then coalesce(array(select left(btrim(x), 60) from jsonb_array_elements_text(p -> 'specialties') x where btrim(x) <> '' limit 30), '{}') else c.specialties end,
    insurances = case when p ? 'insurances' then coalesce(array(select left(btrim(x), 60) from jsonb_array_elements_text(p -> 'insurances') x where btrim(x) <> '' limit 60), '{}') else c.insurances end,
    updated_at = now()
  where c.id = p_clinic;
  return 'ok';
end $$;
revoke execute on function public.update_my_clinic(uuid, jsonb) from public, anon;
grant execute on function public.update_my_clinic(uuid, jsonb) to authenticated;

-- Exames e preços da clínica: a lista enviada substitui a anterior. Preço vazio = "sob consulta".
create or replace function public.set_my_clinic_exams(p_clinic uuid, p_exams jsonb)
returns text
language plpgsql security definer
set search_path = ''
as $$
begin
  if not (public.is_clinic_member(p_clinic) or public.is_imed_admin()) then return 'forbidden'; end if;
  delete from public.clinic_exams where clinic_id = p_clinic;
  insert into public.clinic_exams (clinic_id, exam_code, price_cents, price_updated_at)
  select p_clinic, x ->> 'code', nullif(x ->> 'price_cents', '')::integer,
         case when nullif(x ->> 'price_cents', '') is not null then now() end
  from jsonb_array_elements(coalesce(p_exams, '[]'::jsonb)) x
  where x ->> 'code' in ('rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab')
  on conflict do nothing;
  return 'ok';
end $$;
revoke execute on function public.set_my_clinic_exams(uuid, jsonb) from public, anon;
grant execute on function public.set_my_clinic_exams(uuid, jsonb) to authenticated;

/* ===================== Listas por cidade (páginas para o Google) ===================== */
create or replace function public.city_establishments(p_city integer, p_kind text default null, p_limit integer default 60, p_offset integer default 0)
returns table (
  cnes text, name text, kind text, address_line text, neighborhood text, cep text, phone text, shift text,
  open_24h boolean, sus boolean, services text[], lat double precision, lng double precision, total bigint
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select e.cnes, e.name, e.kind, e.address_line, e.neighborhood, e.cep, e.phone, e.shift, e.open_24h, e.sus, e.services,
         extensions.st_y(e.location::extensions.geometry), extensions.st_x(e.location::extensions.geometry),
         count(*) over ()
  from public.establishments e
  where e.city_ibge = p_city and e.location is not null and (p_kind is null or e.kind = p_kind)
  order by e.name
  limit least(greatest(coalesce(p_limit, 60), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke execute on function public.city_establishments(integer, text, integer, integer) from public;
grant execute on function public.city_establishments(integer, text, integer, integer) to anon, authenticated;

create or replace function public.imported_cities()
returns table (ibge integer, name text, uf text, total bigint, imagem bigint, laboratorio bigint, clinica bigint, hospital bigint)
language sql stable security definer
set search_path = public
as $$
  select m.ibge, m.name, m.uf, count(*),
         count(*) filter (where e.kind = 'imagem'), count(*) filter (where e.kind = 'laboratorio'),
         count(*) filter (where e.kind = 'clinica'), count(*) filter (where e.kind = 'hospital')
  from public.establishment_imports i
  join public.municipalities m on m.ibge = i.city_ibge
  join public.establishments e on e.city_ibge = i.city_ibge and e.location is not null
  where i.status = 'done'
  group by m.ibge, m.name, m.uf
  order by count(*) desc;
$$;
revoke execute on function public.imported_cities() from public;
grant execute on function public.imported_cities() to anon, authenticated;
