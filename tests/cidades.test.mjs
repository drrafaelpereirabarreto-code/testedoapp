// Testes do gerador das páginas por cidade (scripts/gerar-cidades.mjs).
// Rodar com: node --test tests/cidades.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  slugify, ufName, UF_NAMES, TYPES, cityDir, typePath, cityTitle, typeTitle, fmt, generate, groupByState,
  sitemapPaths, siteUrlFromConfig, listExamPages, normBase, dateLong,
} from '../scripts/gerar-cidades.mjs';
import { rodapeHtml } from '../scripts/rodape.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CITIES = JSON.parse(readFileSync(join(ROOT, 'scripts/cidades.json'), 'utf8'));
const BASE = 'https://exemplo.com.br/';
const DATE = '2026-10-30';

test('slug: sem acento, minúsculo, não alfanumérico vira hífen', () => {
  assert.equal(slugify('São Paulo'), 'sao-paulo');
  assert.equal(slugify('São Luís'), 'sao-luis');
  assert.equal(slugify('Goiânia'), 'goiania');
  assert.equal(slugify("Santa Bárbara d'Oeste"), 'santa-barbara-d-oeste');
  assert.equal(slugify('  Mogi-Guaçu  '), 'mogi-guacu');
  assert.equal(slugify('Embu das Artes'), 'embu-das-artes');
});

test('nomes dos estados por extenso (27 unidades da federação)', () => {
  assert.equal(Object.keys(UF_NAMES).length, 27);
  assert.equal(ufName('SP'), 'São Paulo');
  assert.equal(ufName('df'), 'Distrito Federal');
  assert.equal(ufName('AP'), 'Amapá');
  for (const c of CITIES) assert.ok(UF_NAMES[c.uf], `UF desconhecida: ${c.uf}`);
});

test('caminhos das páginas', () => {
  const sp = CITIES.find((c) => c.ibge === 3550308);
  assert.equal(cityDir(sp), 'cidades/sp/sao-paulo/');
  assert.equal(typePath(sp, TYPES[0]), 'cidades/sp/sao-paulo/diagnostico-por-imagem.html');
  assert.deepEqual(TYPES.map((t) => t.file), ['diagnostico-por-imagem', 'laboratorios', 'clinicas', 'hospitais']);
  assert.deepEqual(TYPES.map((t) => t.kind), ['imagem', 'laboratorio', 'clinica', 'hospital']);
});

test('títulos usam os números do JSON', () => {
  const sp = CITIES.find((c) => c.ibge === 3550308);
  assert.equal(cityTitle(sp), `${fmt(sp.total)} clínicas, laboratórios e hospitais em São Paulo - SP | IMED`);
  assert.equal(fmt(6548), '6.548');
  assert.match(typeTitle(sp, TYPES[3]), new RegExp(`^${sp.hospital} hospitais em São Paulo - SP`));
  assert.equal(typeTitle({ ...sp, hospital: 1 }, TYPES[3]).startsWith('1 hospital em'), true);
});

test('siteUrl vem do config.js e a base sempre termina com /', () => {
  const s = siteUrlFromConfig(ROOT);
  assert.match(s, /^https:\/\/.+\/$/);
  assert.equal(normBase('https://a.com'), 'https://a.com/');
  assert.equal(dateLong('2026-10-30'), '30 de outubro de 2026');
});

test('agrupa por estado, em ordem alfabética', () => {
  const g = groupByState(CITIES);
  const names = g.map((x) => x.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  const sp = g.find((x) => x.uf === 'SP');
  const spNames = sp.cities.map((c) => c.name);
  assert.deepEqual(spNames, CITIES.filter((c) => c.uf === 'SP').map((c) => c.name).sort((a, b) => a.localeCompare(b, 'pt-BR')));
  assert.ok(spNames.includes('Campinas') && spNames.includes('São Paulo'));
});

test('gera páginas, sitemap e robots com conteúdo real', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'imed-cidades-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const examPages = listExamPages(ROOT);
  assert.ok(examPages.length >= 8);
  const extra = { ibge: 9999999, name: 'Cidade Só Hospital', uf: 'TO', total: 1, imagem: 0, laboratorio: 0, clinica: 0, hospital: 1 };
  const { written, cities } = generate({ cities: [...CITIES, extra, { ibge: 1, name: 'Sem UF', uf: 'XX', total: 3 }], base: BASE, date: DATE, out, examPages });
  assert.equal(cities.length, CITIES.length + 1, 'cidade com UF inválida fica de fora');
  const read = (p) => readFileSync(join(out, p), 'utf8');

  // Índice
  const idx = read('cidades/index.html');
  assert.match(idx, /<h1>Clínicas, laboratórios e hospitais por cidade<\/h1>/);
  assert.match(idx, /<h2 id="uf-sp">São Paulo<\/h2>/);
  assert.match(idx, /<h2 id="uf-df">Distrito Federal<\/h2>/);
  assert.ok(idx.includes('href="sp/sao-paulo/"'));
  assert.ok(idx.includes(`${fmt(CITIES[0].total)} estabelecimentos`));
  assert.ok(idx.includes(`<link rel="canonical" href="${BASE}cidades/">`));

  for (const c of CITIES) {
    const html = read(`${cityDir(c)}index.html`);
    assert.ok(html.includes(`<title>${fmt(c.total)} clínicas, laboratórios e hospitais em ${c.name} - ${c.uf} | IMED</title>`), c.name);
    assert.ok(html.includes(`<link rel="canonical" href="${BASE}${cityDir(c)}">`));
    assert.ok(html.includes(`<meta property="og:url" content="${BASE}${cityDir(c)}">`));
    assert.ok(html.includes('<meta name="description"'));
    assert.ok(html.includes('<h1>'));
    assert.ok(html.includes(`data-city="${c.ibge}"`));
    assert.ok(html.includes('connect-src \'self\' https://pyoqiecupxhdzigjudyd.supabase.co'));
    assert.ok(html.includes('href="../../../manifest.webmanifest"'));
    assert.ok(html.includes('src="../../../assets/js/config.js"'));
    assert.ok(html.includes('src="../../../assets/js/cidade.js"'));
    assert.ok(html.includes('href="../../../perto.html"'));
    assert.ok(html.includes('"@type":"BreadcrumbList"'));
    assert.ok(html.includes('<noscript>'));
    assert.ok(html.includes(rodapeHtml('../../../')), `${c.name}: rodapé do IMED`);
    assert.ok(html.includes('sem vínculo com o governo ou o SUS'), `${c.name}: IMED não é do governo`);
    for (const tp of TYPES) {
      const n = c[tp.kind];
      if (n > 0) {
        assert.ok(html.includes(`<strong>${fmt(n)}</strong>`), `${c.name} ${tp.kind}`);
        const page = read(typePath(c, tp));
        assert.ok(page.includes(`<title>${fmt(n)} ${n === 1 ? tp.singular : tp.plural} em ${c.name} - ${c.uf} | IMED</title>`));
        assert.ok(page.includes(`data-kind="${tp.kind}"`));
        assert.ok(page.includes(`<link rel="canonical" href="${BASE}${typePath(c, tp)}">`));
      } else {
        assert.equal(existsSync(join(out, typePath(c, tp))), false);
      }
    }
  }
  // Só hospital: não gera páginas de tipos vazios.
  assert.ok(existsSync(join(out, 'cidades/to/cidade-so-hospital/hospitais.html')));
  assert.equal(existsSync(join(out, 'cidades/to/cidade-so-hospital/clinicas.html')), false);
  assert.ok(read('cidades/to/cidade-so-hospital/hospitais.html').includes('<title>1 hospital em Cidade Só Hospital - TO | IMED</title>'));

  // Nada inventado: sem nota, sem preço.
  for (const p of written.filter((f) => f.endsWith('.html'))) {
    const html = read(p);
    assert.equal(html.includes('AggregateRating'), false, p);
    assert.equal(html.includes('R$'), false, p);
    assert.equal(/ratingValue|reviewCount/.test(html), false, p);
  }

  // Sitemap com todas as URLs
  const sm = read('sitemap.xml');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const expected = sitemapPaths(cities, examPages).map((p) => BASE + p);
  assert.deepEqual(locs, expected);
  for (const must of ['', 'perto.html', 'parceiros.html', 'reivindicar.html', 'como-funciona.html', 'acessibilidade.html', 'exames/', 'exames/raio-x.html', 'cidades/', 'cidades/sp/sao-paulo/', 'cidades/sp/sao-paulo/hospitais.html']) {
    assert.ok(locs.includes(BASE + must), must);
  }
  const htmlPages = written.filter((f) => f.startsWith('cidades/'));
  assert.equal(locs.filter((l) => l.startsWith(`${BASE}cidades/`)).length, htmlPages.length);
  assert.equal((sm.match(/<lastmod>2026-10-30<\/lastmod>/g) || []).length, locs.length);

  const robots = read('robots.txt');
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Allow: \//);
  assert.ok(robots.includes(`Sitemap: ${BASE}sitemap.xml`));
});

test('arquivos gerados no repositório estão em dia com o JSON', () => {
  const base = siteUrlFromConfig(ROOT);
  const sm = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  for (const c of CITIES) {
    assert.ok(existsSync(join(ROOT, cityDir(c), 'index.html')), c.name);
    assert.ok(sm.includes(`<loc>${base}${cityDir(c)}</loc>`), c.name);
    const html = readFileSync(join(ROOT, cityDir(c), 'index.html'), 'utf8');
    assert.ok(html.includes(cityTitle(c)));
    assert.ok(html.includes(rodapeHtml('../../../')), `${c.name}: rodapé atual (rode node scripts/gerar-cidades.mjs)`);
  }
  assert.ok(readFileSync(join(ROOT, 'cidades/index.html'), 'utf8').includes(rodapeHtml('../')));
  assert.ok(readFileSync(join(ROOT, 'robots.txt'), 'utf8').includes(`Sitemap: ${base}sitemap.xml`));
});
