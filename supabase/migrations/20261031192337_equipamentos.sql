-- Aparelhos do CNES por estabelecimento (ressonância, tomógrafo, mamógrafo, raio-X, densitômetro, ultrassom,
-- eletrocardiógrafo), para o filtro de exame do site. Antes o exame de um local do cadastro oficial era deduzido só
-- pelo NOME ("ressonância em Campinas" dava 0). Agora vale o aparelho EM USO informado ao CNES OU o nome.
-- Fonte: arquivos EQ<UF><AAMM> do FTP do DATASUS, gerados pelo workflow equipamentos.yml (ramo dados/cnes-equip).
-- Dado público, sem nome de pessoa nem CPF. A ligação aparelho -> exame é do IMED (scripts/cnes-equip/gerar.py).
-- Só acréscimos: tabela nova, colunas novas em establishments e CREATE OR REPLACE das buscas (mesma assinatura e
-- mesmo retorno; a coluna services passa a trazer também os exames dos aparelhos em uso).
-- Carga: select private.carregar_equipamentos(<texto do CSV>, true); depois de cada carga as colunas equip_* de
-- establishments são recalculadas. Aparelho que sumiu da fonte fica com qt_uso = 0 (UPDATE, nada é apagado).

create table if not exists public.establishment_equipment (
  cnes text not null check (cnes ~ '^\d{7}$'),
  exam text not null check (exam in ('rm', 'tc', 'mamo', 'rx', 'dens', 'usg', 'ecg')),
  qt_uso smallint not null check (qt_uso >= 0),
  sus boolean not null,
  competencia date not null,
  updated_at timestamptz not null default now(),
  primary key (cnes, exam)
);
comment on table public.establishment_equipment is
  'Aparelhos em uso informados ao CNES (DATASUS), por estabelecimento e exame do site. Não garante que o local faça o exame para o público.';
alter table public.establishment_equipment enable row level security;
create policy "publico ve aparelhos do cnes" on public.establishment_equipment
  for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.establishment_equipment from anon, authenticated;

alter table public.establishments add column if not exists equip_exams text[] not null default '{}';
alter table public.establishments add column if not exists equip_exams_sus text[] not null default '{}';
alter table public.establishments add column if not exists equip_competencia date;
comment on column public.establishments.equip_exams is 'Exames com aparelho em uso no CNES (calculado de establishment_equipment).';
create index if not exists establishments_equip_exams_idx on public.establishments using gin (equip_exams);

-- Recalcula as colunas equip_* (todas, ou só dos CNES dados). Só UPDATE nas colunas novas.
create or replace function private.refresh_equip_exams(p_cnes text[] default null)
returns integer
language plpgsql
set search_path = ''
as $$
declare n integer;
begin
  with agg as (
    select q.cnes,
           coalesce(array_agg(q.exam order by q.exam) filter (where q.qt_uso > 0), '{}') as ex,
           coalesce(array_agg(q.exam order by q.exam) filter (where q.qt_uso > 0 and q.sus), '{}') as sus,
           max(q.competencia) filter (where q.qt_uso > 0) as comp
    from public.establishment_equipment q
    where p_cnes is null or q.cnes = any (p_cnes)
    group by q.cnes
  )
  update public.establishments e
     set equip_exams = coalesce(agg.ex, '{}'), equip_exams_sus = coalesce(agg.sus, '{}'), equip_competencia = agg.comp
    from public.establishments e2
    left join agg on agg.cnes = e2.cnes
   where e.cnes = e2.cnes
     and (p_cnes is null or e2.cnes = any (p_cnes))
     and (e.equip_exams, e.equip_exams_sus, e.equip_competencia)
         is distinct from (coalesce(agg.ex, '{}'), coalesce(agg.sus, '{}'), agg.comp);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function private.refresh_equip_exams(text[]) from public;

-- Linhas válidas do CSV do workflow (cabeçalho cnes,exame,qt_uso,sus,competencia; competência AAAA-MM).
create or replace function private.equip_csv_linhas(p_csv text)
returns table (cnes text, exam text, qt_uso smallint, sus boolean, competencia date)
language sql immutable
set search_path = ''
as $$
  select m[1], m[2], m[3]::smallint, m[4] = '1', to_date(m[5], 'YYYY-MM')
  from regexp_split_to_table(p_csv, '\r?\n') as l,
       regexp_match(l, '^(\d{7}),(rm|tc|mamo|rx|dens|usg|ecg),(\d{1,4}),([01]),(\d{4}-\d{2})$') as m
  where m is not null;
$$;
revoke execute on function private.equip_csv_linhas(text) from public;

-- Carga: só entram CNES que já existem em establishments. p_completo = true: o que não veio no arquivo fica com
-- qt_uso = 0 (UPDATE). Depois recalcula as colunas equip_* de establishments.
create or replace function private.carregar_equipamentos(p_csv text, p_completo boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n_arquivo integer;
  n_gravadas integer;
  n_zeradas integer := 0;
  n_estab integer;
begin
  select count(*) into n_arquivo from private.equip_csv_linhas(p_csv);
  if n_arquivo = 0 then raise exception 'arquivo sem linhas válidas'; end if;

  insert into public.establishment_equipment as t (cnes, exam, qt_uso, sus, competencia, updated_at)
  select c.cnes, c.exam, c.qt_uso, c.sus, c.competencia, now()
  from private.equip_csv_linhas(p_csv) c
  where exists (select 1 from public.establishments e where e.cnes = c.cnes)
  on conflict (cnes, exam) do update
    set qt_uso = excluded.qt_uso, sus = excluded.sus, competencia = excluded.competencia, updated_at = now()
    where (t.qt_uso, t.sus, t.competencia) is distinct from (excluded.qt_uso, excluded.sus, excluded.competencia);
  get diagnostics n_gravadas = row_count;

  if p_completo then
    update public.establishment_equipment t set qt_uso = 0, updated_at = now()
    where t.qt_uso > 0
      and (t.cnes, t.exam) not in (select c.cnes, c.exam from private.equip_csv_linhas(p_csv) c);
    get diagnostics n_zeradas = row_count;
  end if;

  n_estab := private.refresh_equip_exams(
    case when p_completo then null else array(select distinct c.cnes from private.equip_csv_linhas(p_csv) c) end);
  return jsonb_build_object('linhas_arquivo', n_arquivo, 'gravadas', n_gravadas, 'zeradas', n_zeradas,
                            'estabelecimentos_atualizados', n_estab);
end $$;
revoke execute on function private.carregar_equipamentos(text, boolean) from public;

-- Buscas: mesma assinatura e mesmo retorno. O exame vale pelo nome (services) OU pelo aparelho em uso (equip_exams);
-- services devolvido = services do nome + exames dos aparelhos.
create or replace function public.nearby_establishments(
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
    e.location_source, e.phone, e.shift, e.open_24h, e.sus,
    e.services || array(select x from unnest(e.equip_exams) x where not x = any (e.services)) as services,
    e.specialties, e.cnes_updated_at,
    count(*) over () as total
  from public.establishments e
  join public.municipalities m on m.ibge = e.city_ibge
  cross join origin o
  where e.location is not null
    and extensions.st_dwithin(e.location, o.g, least(greatest(coalesce(p_radius_m, 5000), 100), 50000))
    and not exists (select 1 from public.clinics c where c.cnes = e.cnes and c.status = 'published')
    and (p_kind is null or e.kind = p_kind)
    and (p_exam is null or p_exam = any (e.services) or p_exam = any (e.equip_exams))
    and (p_sus is null or e.sus = p_sus)
  order by extensions.st_distance(e.location, o.g), e.cnes
  limit least(greatest(coalesce(p_limit, 150), 1), 300)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

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
    and (p_exam is null or p_exam = any (e.services) or p_exam = any (e.equip_exams))
    and (p_sus is null or e.sus = p_sus)
  order by extensions.st_distance(e.location, o.g), e.cnes
  limit least(greatest(coalesce(p_limit, 3000), 1), 5000);
$$;

create or replace function public.city_establishments(p_city integer, p_kind text default null, p_limit integer default 60, p_offset integer default 0)
returns table (
  cnes text, name text, kind text, address_line text, neighborhood text, cep text, phone text, shift text,
  open_24h boolean, sus boolean, services text[], lat double precision, lng double precision, total bigint
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select e.cnes, e.name, e.kind, e.address_line, e.neighborhood, e.cep, e.phone, e.shift, e.open_24h, e.sus,
         e.services || array(select x from unnest(e.equip_exams) x where not x = any (e.services)),
         extensions.st_y(e.location::extensions.geometry), extensions.st_x(e.location::extensions.geometry),
         count(*) over ()
  from public.establishments e
  where e.city_ibge = p_city and e.location is not null and (p_kind is null or e.kind = p_kind)
  order by e.name
  limit least(greatest(coalesce(p_limit, 60), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;
