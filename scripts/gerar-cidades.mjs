#!/usr/bin/env node
// Gera as páginas por cidade (cidades/**), o sitemap.xml e o robots.txt a partir de scripts/cidades.json
// (a saída da função imported_cities() do banco). Sem dependências: rode com
//   node scripts/gerar-cidades.mjs                 (usa o siteUrl de assets/js/config.js)
//   node scripts/gerar-cidades.mjs --base=https://meudominio.com.br/
// Opções para testes: --out=pasta (onde gravar; padrão: raiz do site) e --date=AAAA-MM-DD.
// Os números vêm só do JSON (cadastro oficial CNES importado no IMED). Nada é inventado:
// sem preço, sem nota, sem horário. A lista de cada cidade é carregada no navegador por assets/js/cidade.js.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const UF_NAMES = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

// Tipos de estabelecimento: arquivo da página, campo no JSON e textos (plural e singular).
export const TYPES = [
  { file: 'diagnostico-por-imagem', kind: 'imagem', plural: 'centros de diagnóstico por imagem', singular: 'centro de diagnóstico por imagem', short: 'Diagnóstico por imagem', icon: 'fa-x-ray' },
  { file: 'laboratorios', kind: 'laboratorio', plural: 'laboratórios', singular: 'laboratório', short: 'Laboratórios', icon: 'fa-flask' },
  { file: 'clinicas', kind: 'clinica', plural: 'clínicas', singular: 'clínica', short: 'Clínicas', icon: 'fa-stethoscope' },
  { file: 'hospitais', kind: 'hospital', plural: 'hospitais', singular: 'hospital', short: 'Hospitais', icon: 'fa-hospital' },
];

export const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const ufName = (uf) => UF_NAMES[String(uf).toUpperCase()] ?? String(uf).toUpperCase();
export const fmt = (n) => Number(n).toLocaleString('pt-BR');
export const cityDir = (c) => `cidades/${String(c.uf).toLowerCase()}/${slugify(c.name)}/`;
export const typePath = (c, t) => `${cityDir(c)}${t.file}.html`;
const typeLabel = (t, n) => (Number(n) === 1 ? t.singular : t.plural);
// "Campinas (São Paulo)", mas "São Paulo (SP)" quando o nome da cidade é igual ao do estado.
const where = (c) => (ufName(c.uf) === c.name ? `${c.name} (${c.uf})` : `${c.name} (${ufName(c.uf)})`);

export function cityTitle(c) {
  return `${fmt(c.total)} clínicas, laboratórios e hospitais em ${c.name} - ${c.uf} | IMED`;
}
export function typeTitle(c, t) {
  return `${fmt(c[t.kind])} ${typeLabel(t, c[t.kind])} em ${c.name} - ${c.uf} | IMED`;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// JSON dentro de <script>: impede fechar a tag por engano.
const ldJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

export function dateLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function siteUrlFromConfig(root = ROOT) {
  const src = readFileSync(join(root, 'assets/js/config.js'), 'utf8');
  const m = src.match(/siteUrl\s*:\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('siteUrl não encontrado em assets/js/config.js');
  return m[1];
}
export const normBase = (b) => (String(b).endsWith('/') ? String(b) : `${b}/`);

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://pyoqiecupxhdzigjudyd.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'";

function head({ title, description, canonical, rel, base, ld }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#05161e">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="IMED">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(base)}assets/img/og.jpg">
<link rel="icon" type="image/png" sizes="32x32" href="${rel}assets/icons/favicon-32.png">
<link rel="apple-touch-icon" href="${rel}assets/icons/apple-touch-icon.png">
<link rel="manifest" href="${rel}manifest.webmanifest">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="IMED">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${rel}assets/vendor/fa/css/all.min.css">
<link rel="stylesheet" href="${rel}assets/css/cidade.css">
${ld.map((o) => `<script type="application/ld+json">${ldJson(o)}</script>`).join('\n')}
</head>`;
}

function topbar(rel, current) {
  return `<a class="skip" href="#main">Pular para o conteúdo</a>
<header class="cd-top">
  <div class="cd-top-in">
    <a class="logo" href="${rel}" aria-label="IMED, página inicial"><span class="logo-mk"><i class="fa-solid fa-plus" aria-hidden="true"></i></span>IMED</a>
    <nav class="cd-nav" aria-label="Seções">
      <a href="${rel}">Início</a>
      <a href="${rel}perto.html">Perto de mim</a>
      <a href="${rel}cidades/"${current ? ' aria-current="page"' : ' aria-current="true"'}>Clínicas por cidade</a>
    </nav>
    <a class="cd-partner" href="${rel}parceiros.html">Para clínicas</a>
  </div>
</header>`;
}

function footer(rel, dateIso) {
  return `<footer class="cd-foot">
  <div class="cd-wrap">
    <p>Dados do Cadastro Nacional de Estabelecimentos de Saúde (CNES), do Ministério da Saúde, importados no IMED. Números atualizados em ${dateLong(dateIso)}. Confirme horários e atendimento direto com o local.</p>
    <p><a href="${rel}">Início</a> · <a href="${rel}perto.html">Perto de mim</a> · <a href="${rel}cidades/">Clínicas por cidade</a> · <a href="${rel}exames/">Guias de exames</a> · <a href="${rel}parceiros.html">Para clínicas</a> · <a href="${rel}sobre.html">Quem somos</a> · <a href="${rel}termos.html">Termos de uso</a> · <a href="${rel}privacidade.html">Privacidade</a></p>
  </div>
</footer>
<script src="${rel}assets/js/aviso.js" data-base="${rel}" defer></script>
<script src="${rel}assets/js/config.js"></script>`;
}

function crumbsHtml(items) {
  return `<nav class="cd-crumbs" aria-label="Você está em"><ol>${items.map((it, i) => (i === items.length - 1
    ? `<li aria-current="page">${esc(it.name)}</li>`
    : `<li><a href="${esc(it.href)}">${esc(it.name)}</a></li>`)).join('')}</ol></nav>`;
}
const crumbsLd = (items) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
});

// Frase com os números reais por tipo, só dos tipos com algum estabelecimento.
function countsSentence(c) {
  const parts = TYPES.filter((t) => Number(c[t.kind]) > 0).map((t) => `${fmt(c[t.kind])} ${typeLabel(t, c[t.kind])}`);
  if (!parts.length) return '';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`;
}

function listSection({ c, kind, rel, tabs }) {
  const tabBtns = tabs ? `<div class="cd-tabs" role="group" aria-label="Filtrar por tipo">
        <button type="button" class="cd-tab" data-kind="" aria-pressed="true">Todos <span>${fmt(c.total)}</span></button>
        ${TYPES.filter((t) => Number(c[t.kind]) > 0).map((t) => `<button type="button" class="cd-tab" data-kind="${t.kind}" aria-pressed="false">${t.short} <span>${fmt(c[t.kind])}</span></button>`).join('\n        ')}
      </div>` : '';
  return `<section class="cd-list-wrap" aria-labelledby="listTitle">
      <h2 id="listTitle">Lista de estabelecimentos</h2>
      ${tabBtns}
      <label class="cd-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><span class="sr">Buscar pelo nome na lista</span>
        <input id="cdQ" type="search" placeholder="Buscar pelo nome na lista" maxlength="80" autocomplete="off" aria-describedby="cdCount"></label>
      <p class="cd-count" id="cdCount" aria-live="polite"></p>
      <div id="cdList" class="cd-list" data-city="${c.ibge}" data-kind="${kind ?? ''}" data-base="${rel}" data-city-name="${esc(c.name)}" data-uf="${esc(c.uf)}"></div>
      <div class="cd-more-wrap"><button type="button" class="btn btn-ghost" id="cdMore" hidden>Carregar mais</button></div>
      <noscript><p class="cd-noscript">Para ver a lista, ative o JavaScript no navegador. Você também pode <a href="${rel}perto.html">ver os estabelecimentos no mapa perto de você</a>.</p></noscript>
    </section>`;
}

export function renderCity(c, { base, date }) {
  const rel = '../../../';
  const dir = cityDir(c);
  const url = base + dir;
  const title = cityTitle(c);
  const sentence = countsSentence(c);
  const description = `${fmt(c.total)} estabelecimentos de saúde em ${c.name} (${c.uf}) no cadastro oficial: ${sentence}. Veja endereço, telefone e se atende SUS.`;
  const crumbs = [
    { name: 'Início', href: rel, url: base },
    { name: 'Clínicas por cidade', href: '../../', url: `${base}cidades/` },
    { name: `${c.name} - ${c.uf}`, href: './', url },
  ];
  const types = TYPES.filter((t) => Number(c[t.kind]) > 0);
  const ld = [crumbsLd(crumbs), {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: title.replace(/ \| IMED$/, ''), description, url, inLanguage: 'pt-BR',
    dateModified: date, isPartOf: { '@type': 'WebSite', name: 'IMED', url: base },
    about: { '@type': 'City', name: c.name, containedInPlace: { '@type': 'State', name: ufName(c.uf) } },
    mainEntity: { '@type': 'ItemList', numberOfItems: types.length, itemListElement: types.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: `${t.short} em ${c.name}`, url: base + typePath(c, t) })) },
  }];
  return `${head({ title, description, canonical: url, rel, base, ld })}
<body>
${topbar(rel, false)}
<main id="main" class="cd">
  <section class="cd-hero">
    <div class="cd-wrap">
      ${crumbsHtml(crumbs)}
      <h1>Clínicas, laboratórios e hospitais em ${esc(c.name)} - ${esc(c.uf)}</h1>
      <p class="cd-lead">O IMED tem <strong>${fmt(c.total)} estabelecimentos de saúde</strong> em ${esc(where(c))}, do cadastro oficial do Ministério da Saúde (CNES): ${sentence}. Números atualizados em ${dateLong(date)}.</p>
      <a class="btn btn-coral" href="${rel}perto.html"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i>Ver no mapa perto de mim</a>
    </div>
  </section>
  <div class="cd-wrap">
    <ul class="cd-cards" aria-label="Tipos de estabelecimento">
      ${types.map((t) => `<li><a class="cd-card" href="${t.file}.html"><i class="fa-solid ${t.icon}" aria-hidden="true"></i><strong>${fmt(c[t.kind])}</strong><span>${typeLabel(t, c[t.kind])}</span></a></li>`).join('\n      ')}
    </ul>
    <noscript><p class="cd-noscript">${esc(c.name)} tem ${fmt(c.total)} estabelecimentos no IMED: ${sentence}. <a href="${rel}perto.html">Ver no mapa perto de mim</a>.</p></noscript>
    ${listSection({ c, kind: '', rel, tabs: true })}
    <aside class="cd-claim">
      <h2>Sua clínica está nesta lista?</h2>
      <p>Assuma o cadastro, sem custo, para receber pedidos de agendamento e informar exames, preços e convênios.</p>
      <a class="btn btn-primary" href="${rel}reivindicar.html">Assumir o cadastro</a>
    </aside>
  </div>
</main>
${footer(rel, date)}
<script type="module" src="${rel}assets/js/cidade.js"></script>
</body>
</html>
`;
}

export function renderType(c, t, { base, date }) {
  const rel = '../../../';
  const url = base + typePath(c, t);
  const n = c[t.kind];
  const title = typeTitle(c, t);
  const label = typeLabel(t, n);
  const description = `${fmt(n)} ${label} em ${c.name} (${c.uf}) no cadastro oficial do Ministério da Saúde. Veja endereço, telefone, turno e se atende SUS.`;
  const crumbs = [
    { name: 'Início', href: rel, url: base },
    { name: 'Clínicas por cidade', href: '../../', url: `${base}cidades/` },
    { name: `${c.name} - ${c.uf}`, href: './', url: base + cityDir(c) },
    { name: t.short, href: `${t.file}.html`, url },
  ];
  const others = TYPES.filter((o) => o !== t && Number(c[o.kind]) > 0);
  const ld = [crumbsLd(crumbs), {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: title.replace(/ \| IMED$/, ''), description, url, inLanguage: 'pt-BR',
    dateModified: date, isPartOf: { '@type': 'WebSite', name: 'IMED', url: base },
    about: { '@type': 'City', name: c.name, containedInPlace: { '@type': 'State', name: ufName(c.uf) } },
  }];
  const cap = label.charAt(0).toUpperCase() + label.slice(1);
  return `${head({ title, description, canonical: url, rel, base, ld })}
<body>
${topbar(rel, false)}
<main id="main" class="cd">
  <section class="cd-hero">
    <div class="cd-wrap">
      ${crumbsHtml(crumbs)}
      <h1>${esc(cap)} em ${esc(c.name)} - ${esc(c.uf)}</h1>
      <p class="cd-lead">São <strong>${fmt(n)} ${esc(label)}</strong> em ${esc(where(c))} no cadastro oficial do Ministério da Saúde (CNES), de um total de ${fmt(c.total)} estabelecimentos de saúde na cidade. Números atualizados em ${dateLong(date)}.</p>
      <a class="btn btn-coral" href="${rel}perto.html"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i>Ver no mapa perto de mim</a>
    </div>
  </section>
  <div class="cd-wrap">
    <noscript><p class="cd-noscript">${esc(c.name)} tem ${fmt(n)} ${esc(label)} no IMED. <a href="${rel}perto.html">Ver no mapa perto de mim</a>.</p></noscript>
    ${listSection({ c, kind: t.kind, rel, tabs: false })}
    ${others.length ? `<nav class="cd-also" aria-label="Outros tipos em ${esc(c.name)}"><h2>Veja também em ${esc(c.name)}</h2><ul>
      <li><a href="./">Todos (${fmt(c.total)})</a></li>
      ${others.map((o) => `<li><a href="${o.file}.html">${o.short} (${fmt(c[o.kind])})</a></li>`).join('\n      ')}
    </ul></nav>` : ''}
    <aside class="cd-claim">
      <h2>É responsável por um destes locais?</h2>
      <p>Assuma o cadastro, sem custo, para receber pedidos de agendamento e informar exames, preços e convênios.</p>
      <a class="btn btn-primary" href="${rel}reivindicar.html">Assumir o cadastro</a>
    </aside>
  </div>
</main>
${footer(rel, date)}
<script type="module" src="${rel}assets/js/cidade.js"></script>
</body>
</html>
`;
}

export function groupByState(cities) {
  const map = new Map();
  for (const c of cities) {
    const uf = String(c.uf).toUpperCase();
    if (!map.has(uf)) map.set(uf, []);
    map.get(uf).push(c);
  }
  return [...map.entries()]
    .map(([uf, list]) => ({ uf, name: ufName(uf), cities: list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function renderIndex(cities, { base, date }) {
  const rel = '../';
  const url = `${base}cidades/`;
  const title = 'Clínicas, laboratórios e hospitais por cidade | IMED';
  const total = cities.reduce((s, c) => s + Number(c.total), 0);
  const description = `Veja clínicas, laboratórios, centros de diagnóstico e hospitais de ${fmt(cities.length)} cidades, do cadastro oficial do Ministério da Saúde: endereço, telefone e se atende SUS.`;
  const groups = groupByState(cities);
  const crumbs = [{ name: 'Início', href: rel, url: base }, { name: 'Clínicas por cidade', href: './', url }];
  const ld = [crumbsLd(crumbs), {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: title.replace(/ \| IMED$/, ''), description, url, inLanguage: 'pt-BR',
    dateModified: date, isPartOf: { '@type': 'WebSite', name: 'IMED', url: base },
    mainEntity: { '@type': 'ItemList', numberOfItems: cities.length, itemListElement: groups.flatMap((g) => g.cities).map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: `${c.name} - ${c.uf}`, url: base + cityDir(c) })) },
  }];
  return `${head({ title, description, canonical: url, rel, base, ld })}
<body>
${topbar(rel, true)}
<main id="main" class="cd">
  <section class="cd-hero">
    <div class="cd-wrap">
      ${crumbsHtml(crumbs)}
      <h1>Clínicas, laboratórios e hospitais por cidade</h1>
      <p class="cd-lead">${fmt(total)} estabelecimentos de saúde em ${fmt(cities.length)} cidades, do cadastro oficial do Ministério da Saúde (CNES). Escolha a cidade para ver a lista com endereço e telefone. Números atualizados em ${dateLong(date)}.</p>
      <a class="btn btn-coral" href="${rel}perto.html"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i>Ver no mapa perto de mim</a>
    </div>
  </section>
  <div class="cd-wrap">
    ${groups.map((g) => `<section class="cd-state" aria-labelledby="uf-${g.uf.toLowerCase()}">
      <h2 id="uf-${g.uf.toLowerCase()}">${esc(g.name)}</h2>
      <ul class="cd-cities">
        ${g.cities.map((c) => `<li><a href="${cityDir(c).slice('cidades/'.length)}"><span>${esc(c.name)}</span><small>${fmt(c.total)} ${Number(c.total) === 1 ? 'estabelecimento' : 'estabelecimentos'}</small></a></li>`).join('\n        ')}
      </ul>
    </section>`).join('\n    ')}
    <p class="cd-note">Novas cidades entram aqui conforme o cadastro oficial é importado no IMED. Não achou a sua? <a href="${rel}perto.html">Busque pelo mapa</a>.</p>
  </div>
</main>
${footer(rel, date)}
</body>
</html>
`;
}

export function listExamPages(root = ROOT) {
  const dir = join(root, 'exames');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.html') && f !== 'index.html').sort().map((f) => `exames/${f}`);
}

export function sitemapPaths(cities, examPages = []) {
  const paths = ['', 'perto.html', 'parceiros.html', 'reivindicar.html', 'sobre.html', 'termos.html', 'privacidade.html', 'exames/', ...examPages, 'cidades/'];
  for (const c of cities) {
    paths.push(cityDir(c));
    for (const t of TYPES) if (Number(c[t.kind]) > 0) paths.push(typePath(c, t));
  }
  return paths;
}

export function renderSitemap(paths, { base, date }) {
  const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${xmlEsc(base + p)}</loc><lastmod>${date}</lastmod></url>`).join('\n')}
</urlset>
`;
}

export const renderRobots = ({ base }) => `User-agent: *\nAllow: /\n\nSitemap: ${base}sitemap.xml\n`;

// Gera tudo. Devolve a lista de arquivos gravados (caminhos relativos a `out`).
export function generate({ cities, base, date, out = ROOT, examPages = listExamPages(ROOT) }) {
  base = normBase(base);
  const valid = cities.filter((c) => c && c.ibge && c.name && UF_NAMES[String(c.uf).toUpperCase()] && Number(c.total) > 0);
  // Duas cidades com o mesmo nome no mesmo estado não existem no IBGE; se aparecer, fica a primeira.
  const seen = new Set();
  const list = valid.filter((c) => { const k = cityDir(c); if (seen.has(k)) return false; seen.add(k); return true; });
  const written = [];
  const put = (rel, content) => {
    const file = join(out, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    written.push(rel);
  };
  rmSync(join(out, 'cidades'), { recursive: true, force: true });
  put('cidades/index.html', renderIndex(list, { base, date }));
  for (const c of list) {
    put(`${cityDir(c)}index.html`, renderCity(c, { base, date }));
    for (const t of TYPES) if (Number(c[t.kind]) > 0) put(typePath(c, t), renderType(c, t, { base, date }));
  }
  put('sitemap.xml', renderSitemap(sitemapPaths(list, examPages), { base, date }));
  put('robots.txt', renderRobots({ base }));
  return { written, cities: list };
}

function parseArgs(argv) {
  const o = {};
  for (const a of argv) { const m = a.match(/^--([a-z]+)=(.*)$/); if (m) o[m[1]] = m[2]; }
  return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const base = normBase(args.base || siteUrlFromConfig());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(args.date ?? '') ? args.date : today();
  const cities = JSON.parse(readFileSync(join(ROOT, args.json || 'scripts/cidades.json'), 'utf8'));
  const { written, cities: list } = generate({ cities, base, date, out: args.out || ROOT });
  console.log(`${list.length} cidades, ${written.length} arquivos gerados (base ${base}, data ${date}).`);
}
