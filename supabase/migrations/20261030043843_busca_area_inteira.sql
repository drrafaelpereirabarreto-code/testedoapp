-- Busca na área inteira: antes o site recebia só os 250 estabelecimentos mais próximos (em São Paulo, todos a
-- menos de ~550 m), e os filtros eram aplicados só sobre eles. Agora:
--   * nearby_establishments aceita filtros (tipo, exame, SUS) e paginação (p_offset) e devolve o total da área;
--   * establishment_points devolve os pontos (leves) de toda a área para desenhar no mapa.

drop function if exists public.nearby_establishments(double precision, double precision, integer, integer);
create function public.nearby_establishments(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 5000,
  p_limit integer default 150,
  p_kind text default null,
  p_exam text default null,
  p_sus boolean default null,
  p_offset integer default 0
)
returns table (
  cnes text, name text, kind text, cnes_type smallint, address_line text, neighborhood text, cep text, city text,
  uf text, city_code integer, lat double precision, lng double precision, distance_m integer, location_source text,
  phone text, shift text, open_24h boolean, sus boolean, services text[], specialties text[], cnes_updated_at date,
  total bigint
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
    e.location_source, e.phone, e.shift, e.open_24h, e.sus, e.services, e.specialties, e.cnes_updated_at,
    count(*) over () as total
  from public.establishments e
  join public.municipalities m on m.ibge = e.city_ibge
  cross join origin o
  where e.location is not null
    and extensions.st_dwithin(e.location, o.g, least(greatest(coalesce(p_radius_m, 5000), 100), 50000))
    and not exists (select 1 from public.clinics c where c.cnes = e.cnes and c.status = 'published')
    and (p_kind is null or e.kind = p_kind)
    and (p_exam is null or p_exam = any (e.services))
    and (p_sus is null or e.sus = p_sus)
  order by extensions.st_distance(e.location, o.g), e.cnes
  limit least(greatest(coalesce(p_limit, 150), 1), 300)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke execute on function public.nearby_establishments(double precision, double precision, integer, integer, text, text, boolean, integer) from public;
grant execute on function public.nearby_establishments(double precision, double precision, integer, integer, text, text, boolean, integer) to anon, authenticated;

-- Pontos de toda a área, só com o necessário para o mapa (o detalhe é carregado ao tocar no ponto).
create or replace function public.establishment_points(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 5000,
  p_kind text default null,
  p_exam text default null,
  p_sus boolean default null,
  p_limit integer default 3000
)
returns table (cnes text, name text, kind text, lat double precision, lng double precision, distance_m integer, total bigint)
language sql stable security invoker
set search_path = public, extensions
as $$
  with origin as (
    select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography as g
    where p_lat between -90 and 90 and p_lng between -180 and 180
  )
  select e.cnes, e.name, e.kind,
         extensions.st_y(e.location::extensions.geometry), extensions.st_x(e.location::extensions.geometry),
         round(extensions.st_distance(e.location, o.g))::integer,
         count(*) over ()
  from public.establishments e
  cross join origin o
  where e.location is not null
    and extensions.st_dwithin(e.location, o.g, least(greatest(coalesce(p_radius_m, 5000), 100), 50000))
    and not exists (select 1 from public.clinics c where c.cnes = e.cnes and c.status = 'published')
    and (p_kind is null or e.kind = p_kind)
    and (p_exam is null or p_exam = any (e.services))
    and (p_sus is null or e.sus = p_sus)
  order by extensions.st_distance(e.location, o.g), e.cnes
  limit least(greatest(coalesce(p_limit, 3000), 1), 5000);
$$;
revoke execute on function public.establishment_points(double precision, double precision, integer, text, text, boolean, integer) from public;
grant execute on function public.establishment_points(double precision, double precision, integer, text, text, boolean, integer) to anon, authenticated;
