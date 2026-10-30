-- Contador de visitas próprio do IMED (30/10/2026): sem cookies e sem dados pessoais (LGPD).
--
-- Em linguagem simples, esta migração:
--   1. Cria duas tabelas de NÚMEROS SOMADOS POR DIA (dia de São Paulo), no schema private, que a API não alcança:
--      - private.page_views_daily: quantas vezes cada página do site foi aberta no dia ("/perto.html": 120);
--      - private.site_events_daily: quantas buscas por exame, por tipo de local e por cidade, quantos pedidos
--        enviados (por exame) e quantas teleconsultas iniciadas houve no dia.
--      Não há coluna para IP, navegador, aparelho, conta, cookie ou qualquer identificador: cada visita só soma 1
--      num total. Não dá para saber quem visitou nem juntar as visitas de uma mesma pessoa.
--   2. Cria public.track(p_path, p_event, p_detail), chamada pelo site (assets/js/visitas.js) com a chave pública.
--      Só soma 1 (nunca mais que 1 por chamada) e só aceita páginas do site, eventos da lista e detalhes sem dado
--      pessoal. O que não passa é ignorado: devolve false, sem erro.
--   3. Cria public.admin_stats(p_days), só para a equipe do IMED (is_imed_admin): visitas por dia, páginas mais
--      vistas, exames, tipos de local e cidades mais buscados, pedidos por exame e o total de cada evento nos
--      últimos p_days dias (com hoje). Usada pela aba "Visitas" do painel.html.
--
-- Contra abuso: tamanho máximo; só caminhos de páginas do site (raiz, exames/, cidades/UF/cidade/ e a página 404);
-- só eventos e detalhes conhecidos (a cidade tem de existir no cadastro de municípios); nada que pareça e-mail,
-- telefone, CPF ou CEP ("@" ou 5 dígitos seguidos); 1 por chamada; e um teto de linhas novas por dia (3.000 páginas
-- e 2.000 eventos diferentes), para as tabelas não crescerem sem limite.
-- Nada é apagado (nenhum DROP) e tudo pode rodar de novo sem erro. Usa is_imed_admin como está (não mexe nela),
-- então funciona antes ou depois da migração de segurança.
--
-- Contrato das chamadas (PostgREST):
--   POST /rest/v1/rpc/track        {"p_path": "/perto.html"}                                   -> true | false
--                                  {"p_path": "/perto.html", "p_event": "busca_exame", "p_detail": "rm"}
--     eventos: busca_exame (rx, usg, tc, rm, mamo, dens, ecg, eco, lab), busca_tipo (imagem, laboratorio, clinica,
--     hospital), busca_cidade ("UF/Nome", ex.: "SP/São Paulo"), pedido_enviado (código do exame, consulta, outro ou
--     vazio) e teleconsulta_iniciada (vazio ou um código curto em minúsculas, ex.: "clinica_geral").
--   POST /rest/v1/rpc/admin_stats  {"p_days": 7}  (com a sessão de um admin)  -> jsonb:
--     { dias, de, ate, visitas, por_dia: [{dia, visitas}], paginas: [{pagina, visitas}],
--       exames: [{exame, total}], tipos: [{tipo, total}], cidades: [{cidade, total}], pedidos: [{exame, total}],
--       eventos: {evento: total} }
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
comment on table private.site_events_daily is 'Eventos do site somados por dia (buscas por exame, tipo de local e cidade; pedidos enviados por exame; teleconsultas iniciadas). Sem dado pessoal: só o tipo do evento, um detalhe da lista (exame, tipo de local ou "UF/Cidade") e o total.';

-- Segunda tranca: RLS ligado e sem política. Só as funções abaixo (dono postgres) leem e escrevem.
alter table private.page_views_daily enable row level security;
alter table private.site_events_daily enable row level security;
revoke all on table private.page_views_daily from public, anon, authenticated;
revoke all on table private.site_events_daily from public, anon, authenticated;

/* ===================== 2. Regras do que pode ser contado ===================== */
-- Caminho de página aceito (ou nulo). ".../index.html" vira ".../". Páginas: "/" e "/<nome>.html" da raiz,
-- "/exames/" e os guias, "/cidades/", "/cidades/<uf>/<cidade>/" e as páginas de tipo, e "/404".
create or replace function private.visit_path(p_path text)
returns text
language sql
immutable
set search_path = ''
as $$
  with c as (select regexp_replace(btrim(left(coalesce(p_path, ''), 200)), '/index\.html$', '/') as p)
  select case
    when char_length(p) not between 1 and 120 or p ~ '[0-9]{5}' then null
    when p = '/404' then p
    when p ~ '^/([a-z0-9][a-z0-9-]{0,59}\.html)?$' then p
    when p ~ '^/exames/([a-z0-9][a-z0-9-]{0,59}\.html)?$' then p
    when p = '/cidades/' then p
    when p ~ '^/cidades/[a-z]{2}/[a-z0-9]+(-[a-z0-9]+)*/((diagnostico-por-imagem|laboratorios|clinicas|hospitais)\.html)?$'
         and upper(substr(p, 10, 2)) = any (array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
           'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']) then p
    else null
  end
  from c;
$$;

-- Detalhe aceito para cada evento (ou nulo se o evento ou o detalhe não valem). '' = sem detalhe.
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
    when p_event = 'pedido_enviado'
         and d = any (array['','rx','usg','tc','rm','mamo','dens','ecg','eco','lab','consulta','outro']) then d
    when p_event = 'teleconsulta_iniciada' and d ~ '^([a-z0-9_-]{1,40})?$' then d
    else null
  end
  from c;
$$;
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

  -- Evento: busca, pedido enviado ou teleconsulta iniciada.
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
comment on function public.track(text, text, text) is 'Contador de visitas próprio (assets/js/visitas.js): soma 1 na página do dia ou no evento do dia. Sem dado pessoal; o que não é página do site ou evento da lista é ignorado (false).';
revoke all on function public.track(text, text, text) from public;
grant execute on function public.track(text, text, text) to anon, authenticated;

/* ===================== 4. admin_stats: os números para a equipe do IMED ===================== */
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
  v_out jsonb;
begin
  if not coalesce(public.is_imed_admin(), false) then
    raise exception 'forbidden' using errcode = '42501';
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
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('exame', t.detail, 'total', t.n) order by t.pos)
                from rk t where t.event = 'pedido_enviado' and t.pos <= 12), '[]'::jsonb),
    'eventos', coalesce((select jsonb_object_agg(x.event, x.n)
                from (select ev.event, sum(ev.n) as n from ev group by ev.event) x), '{}'::jsonb)
  ) into v_out;
  return v_out;
end $$;
comment on function public.admin_stats(integer) is 'Números do contador de visitas próprio para a equipe do IMED (aba Visitas do painel). Só admin (is_imed_admin).';
revoke all on function public.admin_stats(integer) from public, anon;
grant execute on function public.admin_stats(integer) to authenticated;
