-- Geolocalização do IMED: clínicas parceiras com localização, exames oferecidos,
-- pedidos de agendamento e busca de clínicas ordenada por distância.

create extension if not exists postgis with schema extensions;

-- Clínicas cadastradas no IMED. Preços e horários só entram quando a clínica informa.
create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null check (char_length(name) between 2 and 200),
  kind text not null default 'imagem' check (kind in ('imagem', 'laboratorio', 'clinica', 'hospital')),
  description text check (description is null or char_length(description) <= 1000),
  address_line text not null check (char_length(address_line) between 3 and 300),
  neighborhood text check (neighborhood is null or char_length(neighborhood) <= 120),
  city text not null check (char_length(city) between 2 and 120),
  state text not null check (state ~ '^[A-Z]{2}$'),
  cep text check (cep is null or cep ~ '^[0-9]{5}-?[0-9]{3}$'),
  location extensions.geography(point, 4326) not null,
  phone text check (phone is null or char_length(phone) between 8 and 25),
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{12,13}$'),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  website text check (website is null or website ~* '^https?://'),
  specialties text[] not null default '{}',
  opening_hours jsonb,
  accepts_online_booking boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'published', 'suspended')),
  is_demo boolean not null default false
);
comment on table public.clinics is 'Clínicas parceiras do IMED. location em WGS84; opening_hours só quando informado pela clínica.';
comment on column public.clinics.whatsapp is 'Número com DDI e DDD, só dígitos (ex.: 5511987654321).';
comment on column public.clinics.is_demo is 'Clínicas fictícias do protótipo. Ficam fora das buscas, a menos que include_demo seja pedido.';

create index clinics_location_idx on public.clinics using gist (location);
create index clinics_published_idx on public.clinics (status) where status = 'published';

-- Exames de cada clínica. price_cents fica nulo até a clínica informar o preço.
create table public.clinic_exams (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  exam_code text not null check (exam_code in ('rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab')),
  price_cents integer check (price_cents is null or price_cents between 100 and 10000000),
  price_updated_at timestamptz,
  primary key (clinic_id, exam_code)
);
create index clinic_exams_exam_idx on public.clinic_exams (exam_code);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger clinics_touch_updated_at before update on public.clinics
for each row execute function public.touch_updated_at();

-- Pedidos de agendamento. Não guardam a localização do paciente.
create table public.appointment_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  clinic_id uuid references public.clinics (id) on delete set null,
  place_source text not null check (place_source in ('imed', 'google', 'osm')),
  place_ref text check (place_ref is null or char_length(place_ref) <= 200),
  place_name text not null check (char_length(place_name) between 2 and 200),
  place_address text check (place_address is null or char_length(place_address) <= 300),
  place_phone text check (place_phone is null or char_length(place_phone) <= 30),
  exam_code text check (exam_code is null or exam_code in ('rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab', 'consulta', 'outro')),
  preferred_date date not null,
  preferred_period text not null default 'qualquer' check (preferred_period in ('manha', 'tarde', 'noite', 'qualquer')),
  patient_name text not null check (char_length(patient_name) between 2 and 120),
  patient_phone text not null check (patient_phone ~ '^[0-9]{10,11}$'),
  patient_email text check (patient_email is null or (char_length(patient_email) <= 254 and patient_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  notes text check (notes is null or char_length(notes) <= 500),
  consent boolean not null check (consent),
  status text not null default 'pending' check (status in ('pending', 'contacted', 'confirmed', 'cancelled')),
  check (place_source <> 'imed' or clinic_id is not null)
);
comment on table public.appointment_requests is 'Pedidos de agendamento feitos pelo site. Dado pessoal sensível: leitura só para administradores.';

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
  return new;
end $$;

create trigger appointment_requests_check before insert on public.appointment_requests
for each row execute function public.check_appointment_request();

-- Regras de acesso
alter table public.clinics enable row level security;
alter table public.clinic_exams enable row level security;
alter table public.appointment_requests enable row level security;

create policy "publico ve clinicas publicadas" on public.clinics
  for select to anon, authenticated using (status = 'published');
create policy "admin gerencia clinicas" on public.clinics
  for all to authenticated using (public.is_imed_admin()) with check (public.is_imed_admin());

create policy "publico ve exames de clinicas publicadas" on public.clinic_exams
  for select to anon, authenticated
  using (exists (select 1 from public.clinics c where c.id = clinic_id and c.status = 'published'));
create policy "admin gerencia exames" on public.clinic_exams
  for all to authenticated using (public.is_imed_admin()) with check (public.is_imed_admin());

create policy "qualquer pessoa pede agendamento" on public.appointment_requests
  for insert to anon, authenticated with check (consent and status = 'pending');
create policy "admin le pedidos" on public.appointment_requests
  for select to authenticated using (public.is_imed_admin());
create policy "admin atualiza pedidos" on public.appointment_requests
  for update to authenticated using (public.is_imed_admin()) with check (public.is_imed_admin());

revoke update, delete, truncate on public.appointment_requests from anon;
revoke insert, update, delete, truncate on public.clinics, public.clinic_exams from anon;

-- Busca de clínicas publicadas perto de um ponto, ordenadas pela distância real (metros).
create or replace function public.nearby_clinics(
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
  id uuid,
  name text,
  kind text,
  description text,
  address_line text,
  neighborhood text,
  city text,
  state text,
  cep text,
  lat double precision,
  lng double precision,
  distance_m integer,
  phone text,
  whatsapp text,
  email text,
  website text,
  specialties text[],
  opening_hours jsonb,
  accepts_online_booking boolean,
  is_demo boolean,
  exams jsonb
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
    ), '[]'::jsonb) as exams
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

revoke execute on function public.nearby_clinics(double precision, double precision, integer, text, text, text, integer, integer, boolean, integer) from public;
grant execute on function public.nearby_clinics(double precision, double precision, integer, text, text, text, integer, integer, boolean, integer) to anon, authenticated;
