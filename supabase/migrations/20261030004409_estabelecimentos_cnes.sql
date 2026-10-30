-- Clínicas, laboratórios, centros de diagnóstico e hospitais reais, importados do CNES
-- (Cadastro Nacional de Estabelecimentos de Saúde, do Ministério da Saúde).
-- Não são parceiros do IMED: servem para o paciente ver onde ficam e pedir ajuda para agendar.
-- Só entram estabelecimentos ativos no CNES. Coordenadas duvidosas são descartadas; nesses casos
-- a localização vem do endereço (aproximada) e fica marcada em location_source = 'endereco'.
-- A importação é feita pela Edge Function importar-clinicas, cidade por cidade, quando alguém
-- busca clínicas naquela cidade.

create table public.municipalities (
  ibge integer primary key check (ibge between 1000000 and 9999999),
  cnes_code integer not null unique,
  name text not null,
  name_key text not null,
  uf text not null check (uf ~ '^[A-Z]{2}$')
);
comment on table public.municipalities is 'Municípios do IBGE. cnes_code é o código de 6 dígitos usado pelo CNES.';
create index municipalities_uf_name_idx on public.municipalities (uf, name_key);

create table public.establishments (
  cnes text primary key check (cnes ~ '^[0-9]{7}$'),
  name text not null check (char_length(name) between 2 and 200),
  legal_name text,
  kind text not null check (kind in ('imagem', 'laboratorio', 'clinica', 'hospital')),
  cnes_type smallint not null,
  address_line text,
  neighborhood text,
  cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  city_ibge integer not null references public.municipalities (ibge),
  location extensions.geography(point, 4326),
  location_source text check (location_source in ('cnes', 'endereco')),
  geocode_tried_at timestamptz,
  phone text,
  shift text,
  open_24h boolean not null default false,
  sus boolean,
  services text[] not null default '{}',
  specialties text[] not null default '{}',
  cnes_updated_at date,
  imported_at timestamptz not null default now(),
  check ((location is null) = (location_source is null))
);
comment on table public.establishments is 'Estabelecimentos de saúde ativos no CNES. Não são parceiros do IMED.';
comment on column public.establishments.location_source is 'cnes: coordenada do próprio CNES; endereco: aproximada, achada pelo endereço.';
comment on column public.establishments.shift is 'Turno de atendimento informado ao CNES (ex.: Manhã e tarde). Não é horário exato.';
create index establishments_location_idx on public.establishments using gist (location);
create index establishments_city_idx on public.establishments (city_ibge);
create index establishments_sem_local_idx on public.establishments (city_ibge) where location is null and geocode_tried_at is null;

create table public.establishment_imports (
  city_ibge integer primary key references public.municipalities (ibge),
  status text not null check (status in ('running', 'done', 'error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  found integer,
  active integer,
  with_location integer,
  pending_geocode integer,
  last_geocode_at timestamptz,
  error text
);
comment on table public.establishment_imports is 'Situação da importação do CNES por município.';

alter table public.municipalities enable row level security;
alter table public.establishments enable row level security;
alter table public.establishment_imports enable row level security;

create policy "publico ve municipios" on public.municipalities
  for select to anon, authenticated using (true);
create policy "publico ve estabelecimentos no mapa" on public.establishments
  for select to anon, authenticated using (location is not null);
create policy "admin ve importacoes" on public.establishment_imports
  for select to authenticated using (public.is_imed_admin());

revoke insert, update, delete, truncate on public.municipalities, public.establishments, public.establishment_imports from anon, authenticated;

-- Pedidos de agendamento também podem ser para estabelecimentos do CNES.
alter table public.appointment_requests drop constraint appointment_requests_place_source_check;
alter table public.appointment_requests add constraint appointment_requests_place_source_check
  check (place_source in ('imed', 'google', 'osm', 'cnes'));

-- Estabelecimentos reais perto de um ponto, ordenados pela distância real (metros).
create or replace function public.nearby_establishments(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 5000,
  p_limit integer default 150
)
returns table (
  cnes text,
  name text,
  kind text,
  cnes_type smallint,
  address_line text,
  neighborhood text,
  cep text,
  city text,
  uf text,
  city_code integer,
  lat double precision,
  lng double precision,
  distance_m integer,
  location_source text,
  phone text,
  shift text,
  open_24h boolean,
  sus boolean,
  services text[],
  specialties text[],
  cnes_updated_at date
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
  order by extensions.st_distance(e.location, o.g)
  limit least(greatest(coalesce(p_limit, 150), 1), 300);
$$;

revoke execute on function public.nearby_establishments(double precision, double precision, integer, integer) from public;
grant execute on function public.nearby_establishments(double precision, double precision, integer, integer) to anon, authenticated;

-- ===== Funções usadas só pelo importador (chave de serviço) =====

-- Começa a importação de um município, se ainda não foi feita (ou se está velha).
-- Devolve: started, running, done, busy (já há 3 importações rodando) ou error (falhou há pouco).
create or replace function public.start_establishment_import(p_city integer, p_max_age interval default interval '30 days')
returns text
language plpgsql
set search_path = public
as $$
declare
  cur public.establishment_imports;
  running integer;
begin
  select * into cur from public.establishment_imports where city_ibge = p_city for update;
  if found then
    if cur.status = 'running' and cur.started_at > now() - interval '15 minutes' then return 'running'; end if;
    if cur.status = 'done' and cur.finished_at > now() - p_max_age then return 'done'; end if;
    if cur.status = 'error' and cur.started_at > now() - interval '1 hour' then return 'error'; end if;
  end if;
  select count(*) into running from public.establishment_imports
  where status = 'running' and started_at > now() - interval '15 minutes';
  if running >= 3 then return 'busy'; end if;
  insert into public.establishment_imports (city_ibge, status, started_at)
  values (p_city, 'running', now())
  on conflict (city_ibge) do update set status = 'running', started_at = now(), finished_at = null, error = null;
  return 'started';
end $$;

-- Grava (ou atualiza) os estabelecimentos de um município. Mantém a localização achada pelo
-- endereço quando o CNES continua sem coordenada boa e o endereço não mudou.
create or replace function public.upsert_establishments(p_city integer, p_run timestamptz, p_rows jsonb)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  n integer;
begin
  insert into public.establishments as e (
    cnes, name, legal_name, kind, cnes_type, address_line, neighborhood, cep, city_ibge,
    location, location_source, phone, shift, open_24h, sus, services, specialties, cnes_updated_at, imported_at
  )
  select
    r->>'cnes', r->>'name', r->>'legal_name', r->>'kind', (r->>'cnes_type')::smallint,
    r->>'address_line', r->>'neighborhood', r->>'cep', p_city,
    case when r->>'lat' is not null then st_setsrid(st_makepoint((r->>'lng')::float8, (r->>'lat')::float8), 4326)::geography end,
    case when r->>'lat' is not null then 'cnes' end,
    r->>'phone', r->>'shift', coalesce((r->>'open_24h')::boolean, false), (r->>'sus')::boolean,
    coalesce(array(select jsonb_array_elements_text(r->'services')), '{}'),
    coalesce(array(select jsonb_array_elements_text(r->'specialties')), '{}'),
    (r->>'cnes_updated_at')::date, p_run
  from jsonb_array_elements(p_rows) r
  on conflict (cnes) do update set
    name = excluded.name,
    legal_name = excluded.legal_name,
    kind = excluded.kind,
    cnes_type = excluded.cnes_type,
    address_line = excluded.address_line,
    neighborhood = excluded.neighborhood,
    cep = excluded.cep,
    city_ibge = excluded.city_ibge,
    location = case
      when excluded.location is not null then excluded.location
      when e.location_source = 'endereco' and e.address_line is not distinct from excluded.address_line then e.location
    end,
    location_source = case
      when excluded.location is not null then 'cnes'
      when e.location_source = 'endereco' and e.address_line is not distinct from excluded.address_line then 'endereco'
    end,
    geocode_tried_at = case
      when excluded.location is null and e.address_line is not distinct from excluded.address_line then e.geocode_tried_at
    end,
    phone = excluded.phone,
    shift = excluded.shift,
    open_24h = excluded.open_24h,
    sus = excluded.sus,
    services = excluded.services,
    specialties = excluded.specialties,
    cnes_updated_at = excluded.cnes_updated_at,
    imported_at = excluded.imported_at;
  get diagnostics n = row_count;
  return n;
end $$;

-- Conta o que foi importado e remove o que saiu do CNES (desativado) desde a última importação.
create or replace function public.finish_establishment_import(p_city integer, p_run timestamptz, p_found integer, p_error text default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r jsonb;
begin
  if p_error is null then
    delete from public.establishments where city_ibge = p_city and imported_at < p_run;
  end if;
  update public.establishment_imports i set
    status = case when p_error is null then 'done' else 'error' end,
    finished_at = now(),
    found = coalesce(p_found, i.found),
    active = (select count(*) from public.establishments where city_ibge = p_city),
    with_location = (select count(*) from public.establishments where city_ibge = p_city and location is not null),
    pending_geocode = (select count(*) from public.establishments where city_ibge = p_city and location is null and geocode_tried_at is null),
    error = p_error
  where i.city_ibge = p_city
  returning to_jsonb(i.*) into r;
  return r;
end $$;

-- Grava as localizações achadas pelo endereço (lote) e atualiza a contagem de pendentes.
create or replace function public.save_establishment_geocodes(p_city integer, p_rows jsonb)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  r jsonb;
begin
  update public.establishments e set
    location = case when x->>'lat' is not null then st_setsrid(st_makepoint((x->>'lng')::float8, (x->>'lat')::float8), 4326)::geography end,
    location_source = case when x->>'lat' is not null then 'endereco' end,
    geocode_tried_at = now()
  from jsonb_array_elements(p_rows) x
  where e.cnes = x->>'cnes' and e.city_ibge = p_city and e.location is null;
  update public.establishment_imports i set
    last_geocode_at = now(),
    with_location = (select count(*) from public.establishments where city_ibge = p_city and location is not null),
    pending_geocode = (select count(*) from public.establishments where city_ibge = p_city and location is null and geocode_tried_at is null)
  where i.city_ibge = p_city
  returning to_jsonb(i.*) into r;
  return r;
end $$;

revoke execute on function public.start_establishment_import(integer, interval) from public, anon, authenticated;
revoke execute on function public.upsert_establishments(integer, timestamptz, jsonb) from public, anon, authenticated;
revoke execute on function public.finish_establishment_import(integer, timestamptz, integer, text) from public, anon, authenticated;
revoke execute on function public.save_establishment_geocodes(integer, jsonb) from public, anon, authenticated;
grant execute on function public.start_establishment_import(integer, interval) to service_role;
grant execute on function public.upsert_establishments(integer, timestamptz, jsonb) to service_role;
grant execute on function public.finish_establishment_import(integer, timestamptz, integer, text) to service_role;
grant execute on function public.save_establishment_geocodes(integer, jsonb) to service_role;
