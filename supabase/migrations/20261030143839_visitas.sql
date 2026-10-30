-- Contador de visitas próprio do IMED (30/10/2026): sem cookies e sem dados pessoais (LGPD).
--
-- Em linguagem simples, esta migração:
--   1. Cria duas tabelas de NÚMEROS SOMADOS POR DIA (dia de São Paulo), no schema private, que a API não alcança:
--      - private.page_views_daily: quantas vezes cada página do site foi aberta no dia ("/perto.html": 120);
--      - private.site_events_daily: quantas buscas por exame, por tipo de local e por cidade houve no dia.
--      Não há coluna para IP, navegador, aparelho, conta, cookie ou qualquer identificador: cada visita só soma 1
--      num total. Não dá para saber quem visitou nem juntar as visitas de uma mesma pessoa.
--   2. Cria public.track(p_path, p_event, p_detail), chamada pelo site (assets/js/visitas.js) com a chave pública.
--      Só soma 1 (nunca mais que 1 por chamada) e só aceita páginas que existem no site (lista fechada das páginas
--      fixas e páginas de cidade de um município que existe), as buscas da lista e detalhes da lista. O que não
--      passa é ignorado: devolve false, sem erro. Ninguém consegue escrever texto livre (um nome, por exemplo).
--   3. Cria public.admin_stats(p_days), só para a equipe do IMED (is_imed_admin): visitas por dia, páginas mais
--      vistas, exames, tipos de local e cidades mais buscados, e os números que vêm das próprias tabelas do site
--      (não do contador, que qualquer um pode chamar e que não conta quem liga "Não rastrear"): pedidos de
--      agendamento por exame e teleconsultas pedidas, nos últimos p_days dias (com hoje). Usada pela aba "Visitas".
--
-- Contra abuso: tamanho máximo; só páginas do site; só buscas e detalhes conhecidos (a cidade tem de existir no
-- cadastro de municípios); nada que pareça e-mail, telefone, CPF ou CEP ("@" ou 5 dígitos seguidos); 1 por chamada;
-- e um teto de linhas novas por dia (3.000 páginas e 2.000 eventos diferentes), para as tabelas não crescerem.
-- Página nova no site: rode  node scripts/aplicar-visitas.mjs --sql  e aplique o private.visit_path que ele mostra
-- (numa migração nova); sem isso, as visitas da página nova não são contadas (tests/visitas.test.mjs avisa).
-- Nada é apagado (nenhum DROP) e tudo pode rodar de novo sem erro. Usa is_imed_admin como está (não mexe nela),
-- então funciona antes ou depois da migração de segurança.
--
-- Contrato das chamadas (PostgREST):
--   POST /rest/v1/rpc/track        {"p_path": "/perto.html"}                                   -> true | false
--                                  {"p_path": "/perto.html", "p_event": "busca_exame", "p_detail": "rm"}
--     eventos: busca_exame (rx, usg, tc, rm, mamo, dens, ecg, eco, lab), busca_tipo (imagem, laboratorio, clinica,
--     hospital) e busca_cidade ("UF/Nome", ex.: "SP/São Paulo", de um município que existe).
--   POST /rest/v1/rpc/admin_stats  {"p_days": 7}  (com a sessão de um admin)  -> jsonb:
--     { dias, de, ate, visitas, por_dia: [{dia, visitas}], paginas: [{pagina, visitas}],
--       exames: [{exame, total}], tipos: [{tipo, total}], cidades: [{cidade, total}],
--       pedidos_total, pedidos: [{exame, total}] (de appointment_requests), teleconsultas (de teleconsultations,
--       nulo se a tabela não existir), eventos: {evento: total} }
--     Sem ser admin: erro 42501 ("forbidden").

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

/* ===================== 1. Tabelas (só números somados por dia) ===================== */
create table if not exists private.page_views_daily (
  day date not null,
  path text not null check (char_length(path) between 1 and 120),
  views bigint not null default 0 check (views >= 0),
  primary key (day, path)
);
comment on table private.page_views_daily is 'Contador de visitas próprio do IMED: quantas vezes cada página foi aberta por dia (dia de São Paulo). Sem IP, aparelho, cookie ou identificador: só o caminho da página, o dia e o total.';

create table if not exists private.site_events_daily (
  day date not null,
  event text not null check (event ~ '^[a-z_]{3,40}$'),
  detail text not null default '' check (char_length(detail) <= 80),
  total bigint not null default 0 check (total >= 0),
  primary key (day, event, detail)
);
comment on table private.site_events_daily is 'Buscas do site somadas por dia (por exame, tipo de local e cidade). Sem dado pessoal: só o tipo da busca, um detalhe da lista (exame, tipo de local ou "UF/Cidade") e o total.';

-- Segunda tranca: RLS ligado e sem política. Só as funções abaixo (dono postgres) leem e escrevem.
alter table private.page_views_daily enable row level security;
alter table private.site_events_daily enable row level security;
revoke all on table private.page_views_daily from public, anon, authenticated;
revoke all on table private.site_events_daily from public, anon, authenticated;

/* ===================== 2. Regras do que pode ser contado ===================== */
-- Nome da cidade sem acento, como no endereço das páginas das cidades (o mesmo slugify de scripts/gerar-cidades.mjs):
-- "Santa Bárbara d'Oeste" -> "santa-barbara-d-oeste".
create or replace function private.visit_slug(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(translate(coalesce(p_name, ''),
    'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy')), '[^a-z0-9]+', '-', 'g'), '-');
$$;

-- Caminho de página aceito (ou nulo). ".../index.html" vira ".../". Lista FECHADA das páginas fixas do site (raiz,
-- exames/, a 404 e o índice das cidades) e páginas de cidade só de um município que existe: ninguém escreve
-- um caminho inventado ("/maria-da-silva.html") nas estatísticas.
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
      '/contato.html', '/documento.html', '/exames/', '/exames/densitometria-ossea.html',
      '/exames/ecocardiograma.html', '/exames/eletrocardiograma.html', '/exames/mamografia.html',
      '/exames/raio-x.html', '/exames/ressonancia-magnetica.html', '/exames/tomografia.html',
      '/exames/ultrassom.html', '/local.html', '/medico.html', '/painel.html', '/parceiros.html',
      '/perto.html', '/privacidade.html', '/reivindicar.html', '/sobre.html', '/teleconsulta.html',
      '/termo-teleconsulta.html', '/termos.html']) then p
    -- Página de cidade: só de um município que existe (mesmo nome sem acento do gerador das cidades).
    when p ~ '^/cidades/[a-z]{2}/[a-z0-9]+(-[a-z0-9]+)*/((diagnostico-por-imagem|laboratorios|clinicas|hospitais)\.html)?$'
         and exists (select 1 from public.municipalities m
                     where m.uf = upper(split_part(p, '/', 3)) and private.visit_slug(m.name) = split_part(p, '/', 4)) then p
    else null
  end
  from c;
$$;

-- Detalhe aceito para cada busca (ou nulo se a busca ou o detalhe não valem). Só listas fechadas: exame, tipo de
-- local e "UF/Cidade" (a cidade é conferida no cadastro de municípios, em track).
create or replace function private.visit_event_detail(p_event text, p_detail text)
returns text
language sql
immutable
set search_path = ''
as $$
  with c as (select btrim(regexp_replace(left(coalesce(p_detail, ''), 200), '\s+', ' ', 'g')) as d)
  select case
    when char_length(d) > 80 or d ~ '@' or d ~ '[0-9]{5}' then null
    when p_event = 'busca_exame' and d = any (array['rx','usg','tc','rm','mamo','dens','ecg','eco','lab']) then d
    when p_event = 'busca_tipo' and d = any (array['imagem','laboratorio','clinica','hospital']) then d
    when p_event = 'busca_cidade' and d ~ '^[A-Z]{2}/[^/]{2,60}$'
         and left(d, 2) = any (array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
           'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']) then d
    else null
  end
  from c;
$$;
revoke all on function private.visit_slug(text) from public, anon, authenticated;
revoke all on function private.visit_path(text) from public, anon, authenticated;
revoke all on function private.visit_event_detail(text, text) from public, anon, authenticated;

/* ===================== 3. track: soma 1 (visita ou evento) ===================== */
create or replace function public.track(p_path text, p_event text default null, p_detail text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
  v_path text := private.visit_path(p_path);
  v_event text := nullif(btrim(left(coalesce(p_event, ''), 60)), '');
  v_detail text;
begin
  if v_path is null then return false; end if;

  -- Visita: abrir uma página (sem evento e sem detalhe).
  if v_event is null then
    if btrim(left(coalesce(p_detail, ''), 200)) <> '' then return false; end if;
    update private.page_views_daily set views = views + 1 where day = v_day and path = v_path;
    if found then return true; end if;
    if (select count(*) from private.page_views_daily where day = v_day) >= 3000 then return false; end if;
    insert into private.page_views_daily as t (day, path, views) values (v_day, v_path, 1)
      on conflict (day, path) do update set views = t.views + 1;
    return true;
  end if;

  -- Evento: uma busca (por exame, tipo de local ou cidade).
  v_detail := private.visit_event_detail(v_event, p_detail);
  if v_detail is null then return false; end if;
  if v_event = 'busca_cidade' and not exists (
       select 1 from public.municipalities m where m.uf = left(v_detail, 2) and m.name = substr(v_detail, 4)) then
    return false;
  end if;
  update private.site_events_daily set total = total + 1 where day = v_day and event = v_event and detail = v_detail;
  if found then return true; end if;
  if (select count(*) from private.site_events_daily where day = v_day) >= 2000 then return false; end if;
  insert into private.site_events_daily as t (day, event, detail, total) values (v_day, v_event, v_detail, 1)
    on conflict (day, event, detail) do update set total = t.total + 1;
  return true;
end $$;
comment on function public.track(text, text, text) is 'Contador de visitas próprio (assets/js/visitas.js): soma 1 na página do dia ou na busca do dia. Sem dado pessoal; o que não é página do site (lista fechada) ou busca da lista é ignorado (false).';
revoke all on function public.track(text, text, text) from public;
grant execute on function public.track(text, text, text) to anon, authenticated;

/* ===================== 4. admin_stats: os números para a equipe do IMED ===================== */
-- Pedidos e teleconsultas vêm das próprias tabelas do site (o número real, que ninguém infla chamando track e que
-- inclui quem liga "Não rastrear"); visitas e buscas vêm do contador.
create or replace function public.admin_stats(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 366);
  v_to date := (now() at time zone 'America/Sao_Paulo')::date;
  v_from date := v_to - (v_days - 1);
  -- Começo do primeiro dia e fim de hoje, no horário de São Paulo.
  v_from_ts timestamptz := v_from::timestamp at time zone 'America/Sao_Paulo';
  v_to_ts timestamptz := (v_to + 1)::timestamp at time zone 'America/Sao_Paulo';
  v_tele bigint;
  v_out jsonb;
begin
  if not coalesce(public.is_imed_admin(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Teleconsultas pedidas (entraram na fila do médico). Sem a tabela da teleconsulta no banco: nulo.
  if to_regclass('public.teleconsultations') is not null then
    execute 'select count(*) from public.teleconsultations t where t.created_at >= $1 and t.created_at < $2'
      into v_tele using v_from_ts, v_to_ts;
  end if;
  with pv as (
    select v.day, v.path, v.views from private.page_views_daily v where v.day between v_from and v_to
  ), ev as (
    select e.event, e.detail, sum(e.total) as n
    from private.site_events_daily e where e.day between v_from and v_to
    group by e.event, e.detail
  ), rk as (
    select ev.event, ev.detail, ev.n, row_number() over (partition by ev.event order by ev.n desc, ev.detail) as pos
    from ev
  ), rq as (
    select coalesce(a.exam_code, '') as exam, count(*) as n
    from public.appointment_requests a where a.created_at >= v_from_ts and a.created_at < v_to_ts
    group by 1
  )
  select jsonb_build_object(
    'dias', v_days,
    'de', v_from,
    'ate', v_to,
    'visitas', (select coalesce(sum(pv.views), 0) from pv),
    'por_dia', (select jsonb_agg(jsonb_build_object('dia', g.d, 'visitas', coalesce(s.n, 0)) order by g.d)
                from (select v_from + i as d from generate_series(0, v_days - 1) as i) g
                left join (select pv.day, sum(pv.views) as n from pv group by pv.day) s on s.day = g.d),
    'paginas', coalesce((select jsonb_agg(jsonb_build_object('pagina', x.path, 'visitas', x.n) order by x.n desc, x.path)
                from (select pv.path, sum(pv.views) as n from pv group by pv.path order by n desc, pv.path limit 20) x), '[]'::jsonb),
    'exames', coalesce((select jsonb_agg(jsonb_build_object('exame', t.detail, 'total', t.n) order by t.pos)
                from rk t where t.event = 'busca_exame' and t.pos <= 10), '[]'::jsonb),
    'tipos', coalesce((select jsonb_agg(jsonb_build_object('tipo', t.detail, 'total', t.n) order by t.pos)
                from rk t where t.event = 'busca_tipo' and t.pos <= 10), '[]'::jsonb),
    'cidades', coalesce((select jsonb_agg(jsonb_build_object('cidade', t.detail, 'total', t.n) order by t.pos)
                from rk t where t.event = 'busca_cidade' and t.pos <= 10), '[]'::jsonb),
    'pedidos_total', (select coalesce(sum(rq.n), 0) from rq),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('exame', x.exam, 'total', x.n) order by x.n desc, x.exam)
                from (select rq.exam, rq.n from rq order by rq.n desc, rq.exam limit 12) x), '[]'::jsonb),
    'teleconsultas', v_tele,
    'eventos', coalesce((select jsonb_object_agg(x.event, x.n)
                from (select ev.event, sum(ev.n) as n from ev group by ev.event) x), '{}'::jsonb)
  ) into v_out;
  return v_out;
end $$;
comment on function public.admin_stats(integer) is 'Números para a equipe do IMED (aba Visitas do painel): visitas e buscas do contador próprio; pedidos de agendamento e teleconsultas das próprias tabelas. Só admin (is_imed_admin).';
revoke all on function public.admin_stats(integer) from public, anon;
grant execute on function public.admin_stats(integer) to authenticated;
