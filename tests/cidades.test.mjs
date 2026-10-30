// Testes do gerador das páginas por cidade (scripts/gerar-cidades.mjs): páginas, perguntas frequentes, sitemap,
// robots.txt e llms.txt. No fim, a caixa "O que levar" dos 8 guias de exames (exames/*.html).
// Rodar com: node --test tests/cidades.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync, readdirSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  slugify, ufName, UF_NAMES, TYPES, cityDir, typePath, cityTitle, typeTitle, fmt, generate, groupByState,
  sitemapPaths, siteUrlFromConfig, listExamPages, normBase, dateLong, faqItems, PAGINAS_FIXAS, renderLlms, examGuides,
  deCidade, dataDosNumeros,
} from '../scripts/gerar-cidades.mjs';
import { rodapeHtml } from '../scripts/rodape.mjs';
import { deCidade as deCidadeSite } from '../assets/js/confianca.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CITIES = JSON.parse(readFileSync(join(ROOT, 'scripts/cidades.json'), 'utf8'));
const BASE = 'https://exemplo.com.br/';
const DATE = '2026-10-30';
const SP = CITIES.find((c) => c.ibge === 3550308);
const byKind = Object.fromEntries(TYPES.map((t) => [t.kind, t]));

// Bloco de perguntas frequentes de uma página gerada: perguntas e respostas visíveis e o JSON-LD FAQPage.
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function faqDaPagina(html) {
  const sec = html.match(/<section class="cd-faq"[\s\S]*?<\/section>/)?.[0] ?? '';
  const visiveis = [...sec.matchAll(/<div class="cd-faq-item"><h3>([^<]*)<\/h3><p>([^<]*)<\/p><\/div>/g)].map((m) => ({ q: unesc(m[1]), a: unesc(m[2]) }));
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((m) => JSON.parse(m[1])).find((o) => o['@type'] === 'FAQPage');
  return { sec, visiveis, ld };
}
// Todo número das respostas vem do JSON da cidade ou da data (nada inventado).
function numerosDoJson(items, c) {
  const ok = new Set([...['total', ...TYPES.map((t) => t.kind)].map((k) => fmt(c[k])), ...dateLong(DATE).match(/\d+/g)]);
  for (const { q, a } of items) for (const n of `${q} ${a}`.match(/\d[\d.]*\d|\d/g) ?? []) assert.ok(ok.has(n), `${c.name}: número ${n} fora do JSON`);
}

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
  // A data dos números das páginas publicadas: o gerador grava a mesma no <lastmod> do sitemap.
  const data = sm.match(/<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/)?.[1];
  assert.ok(data, 'sitemap com a data dos números');
  const rode = '(rode node scripts/gerar-cidades.mjs)';
  for (const c of CITIES) {
    assert.ok(existsSync(join(ROOT, cityDir(c), 'index.html')), c.name);
    assert.ok(sm.includes(`<loc>${base}${cityDir(c)}</loc>`), c.name);
    const html = readFileSync(join(ROOT, cityDir(c), 'index.html'), 'utf8');
    assert.ok(html.includes(cityTitle(c)));
    assert.ok(html.includes(rodapeHtml('../../../')), `${c.name}: rodapé atual ${rode}`);
    assert.ok(html.includes(`Números atualizados em ${dateLong(data)}.`), `${c.name}: data dos números no topo ${rode}`);
    // Perguntas e respostas em dia com o gerador, com a mesma data dos números.
    const { visiveis, ld } = faqDaPagina(html);
    assert.deepEqual(visiveis, faqItems(c, null, data), `${c.name}: perguntas frequentes ${rode}`);
    assert.equal(ld?.mainEntity.length, 5, `${c.name}: FAQPage`);
    for (const t of TYPES.filter((tp) => c[tp.kind] > 0)) {
      const page = readFileSync(join(ROOT, typePath(c, t)), 'utf8');
      assert.deepEqual(faqDaPagina(page).visiveis, faqItems(c, t, data), `${c.name} ${t.kind}: perguntas frequentes ${rode}`);
    }
  }
  assert.ok(readFileSync(join(ROOT, 'cidades/index.html'), 'utf8').includes(rodapeHtml('../')));
  assert.ok(readFileSync(join(ROOT, 'robots.txt'), 'utf8').includes(`Sitemap: ${base}sitemap.xml`));
  // llms.txt na raiz igual ao que o gerador escreve: endereço do site, totais do cidades.json, a mesma data e as regras.
  const llms = readFileSync(join(ROOT, 'llms.txt'), 'utf8');
  assert.equal(llms, renderLlms(CITIES, { base, date: data, guides: examGuides(listExamPages(ROOT), ROOT) }), `llms.txt ${rode}`);
  assert.ok(llms.includes(`](${base}como-funciona.html)`) && !llms.includes(BASE), 'llms.txt com o siteUrl do config.js');
});

test('perguntas frequentes: 5 perguntas com as regras publicadas e os números da cidade, com a data', () => {
  const RJ = CITIES.find((c) => c.ibge === 3304557);
  const city = faqItems(SP, null, DATE);
  assert.equal(city.length, 5);
  assert.deepEqual(city.map((it) => it.q), [
    'Quantos locais de saúde de São Paulo aparecem no IMED?',
    'O IMED é plano de saúde ou cartão de desconto?',
    'Buscar e pedir agendamento pelo IMED é grátis?',
    'O horário já fica marcado quando faço o pedido?',
    'Os locais de São Paulo atendem pelo SUS?',
  ]);
  // Quantos locais por tipo, com a data.
  assert.equal(city[0].a, `O IMED mostra ${fmt(SP.total)} estabelecimentos de saúde em São Paulo (SP), do cadastro oficial do Ministério da Saúde (CNES): ${fmt(SP.imagem)} centros de diagnóstico por imagem, ${fmt(SP.laboratorio)} laboratórios, ${fmt(SP.clinica)} clínicas e ${fmt(SP.hospital)} hospitais. Números atualizados em 30 de outubro de 2026.`);
  // "do Rio de Janeiro", "no Rio de Janeiro" (a regra do "do/de" do resto do site).
  const rj = faqItems(RJ, null, DATE);
  assert.equal(rj[0].q, 'Quantos locais de saúde do Rio de Janeiro aparecem no IMED?');
  assert.match(rj[0].a, /^O IMED mostra [\d.]+ estabelecimentos de saúde no Rio de Janeiro \(RJ\),/);
  assert.equal(rj[4].q, 'Os locais do Rio de Janeiro atendem pelo SUS?');
  // Não é plano nem cartão de desconto; grátis só buscar, pedir e cancelar (há cobranças previstas em outros serviços).
  assert.match(city[1].a, /^Não\. O IMED é uma plataforma on-line de busca e de pedido de agendamento/);
  assert.match(city[2].a, /^Para o paciente, sim: buscar, pedir e cancelar o pedido pelo IMED não têm custo\./);
  assert.match(city[2].a, /pagamento é feito direto lá\. O IMED nunca pede Pix/);
  // O horário só vale quando aparece "Confirmado"; o SUS vem do CNES e o pedido do SUS é pela UBS.
  assert.match(city[3].a, /^Só quando o pedido aparece como Confirmado/);
  assert.match(city[4].a, /“Atende SUS” da lista vem do cadastro oficial \(CNES\) e pode estar desatualizada: confirme com o local\./);
  assert.match(city[4].a, /unidades públicas do SUS não agendam pelo IMED\. Para marcar pelo SUS, procure a sua Unidade Básica de Saúde \(UBS\)\.$/);
  for (const c of CITIES) {
    for (const t of [null, ...TYPES.filter((tp) => c[tp.kind] > 0)]) {
      const items = faqItems(c, t, DATE);
      const all = items.map((it) => `${it.q} ${it.a}`).join(' ');
      assert.ok(!/sempre|gratuit|100%|R\$|★|\bnota\b|desconto de|garant/i.test(all.replace('cartão de desconto', '')), `${c.name} ${t?.kind ?? ''}: sem promessa, preço ou nota`);
      numerosDoJson(items, c);
    }
  }
});

test('perguntas frequentes das páginas de tipo: número do tipo, singular e o total da cidade só se houver outros tipos', () => {
  const tipo = faqItems(SP, byKind.clinica, DATE);
  assert.equal(tipo[0].q, 'Quantas clínicas de São Paulo aparecem no IMED?');
  assert.equal(tipo[0].a, `O IMED mostra ${fmt(SP.clinica)} clínicas em São Paulo (SP), do cadastro oficial do Ministério da Saúde (CNES). Na cidade toda, são ${fmt(SP.total)} estabelecimentos de saúde no IMED: ${fmt(SP.imagem)} centros de diagnóstico por imagem, ${fmt(SP.laboratorio)} laboratórios, ${fmt(SP.clinica)} clínicas e ${fmt(SP.hospital)} hospitais. Números atualizados em 30 de outubro de 2026.`);
  assert.equal(tipo[4].q, 'As clínicas de São Paulo atendem pelo SUS?');
  assert.equal(faqItems(SP, byKind.imagem, DATE)[0].q, 'Quantos centros de diagnóstico por imagem de São Paulo aparecem no IMED?');
  assert.equal(faqItems(SP, byKind.hospital, DATE)[4].q, 'Os hospitais de São Paulo atendem pelo SUS?');
  // As outras 4 perguntas são as mesmas da página da cidade.
  assert.deepEqual(tipo.slice(1, 4), faqItems(SP, null, DATE).slice(1, 4));
  // Singular e cidade com um tipo só.
  const pequena = { ibge: 1, name: 'Cidade Só Hospital', uf: 'TO', total: 1, imagem: 0, laboratorio: 0, clinica: 0, hospital: 1 };
  const h = faqItems(pequena, byKind.hospital, DATE)[0];
  assert.equal(h.a, 'O IMED mostra 1 hospital em Cidade Só Hospital (Tocantins), do cadastro oficial do Ministério da Saúde (CNES). Números atualizados em 30 de outubro de 2026.');
  assert.equal(faqItems(pequena, null, DATE)[0].a, 'O IMED mostra 1 estabelecimento de saúde em Cidade Só Hospital (Tocantins), do cadastro oficial do Ministério da Saúde (CNES): 1 hospital. Números atualizados em 30 de outubro de 2026.');
  const dois = { ibge: 2, name: 'Duas', uf: 'SP', total: 2, imagem: 0, laboratorio: 1, clinica: 0, hospital: 1 };
  assert.match(faqItems(dois, byKind.laboratorio, DATE)[0].a, /^O IMED mostra 1 laboratório em Duas \(São Paulo\), .* Na cidade toda, são 2 estabelecimentos de saúde no IMED: 1 laboratório e 1 hospital\./);
});

test('perguntas frequentes nas páginas geradas: visíveis, iguais ao JSON-LD FAQPage, depois da lista e antes de "Assumir o cadastro"', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'imed-faq-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const { cities } = generate({ cities: CITIES, base: BASE, date: DATE, out, examPages: [] });
  const primeiras = new Set();
  let paginas = 0;
  for (const c of cities) {
    for (const tp of [null, ...TYPES.filter((x) => c[x.kind] > 0)]) {
      const html = readFileSync(join(out, tp ? typePath(c, tp) : `${cityDir(c)}index.html`), 'utf8');
      const name = `${c.name} ${tp?.kind ?? 'cidade'}`;
      const { sec, visiveis, ld } = faqDaPagina(html);
      assert.match(sec, /<h2 id="faqTitle">Perguntas frequentes<\/h2>/, name);
      assert.deepEqual(visiveis, faqItems(c, tp, DATE), `${name}: as 5 perguntas, abertas (sem clicar)`);
      assert.ok(!/<details|hidden/.test(sec), `${name}: respostas visíveis`);
      // O JSON-LD tem exatamente o que está na página.
      assert.equal(ld['@context'], 'https://schema.org');
      assert.deepEqual(ld.mainEntity.map((q) => ({ q: q.name, a: q.acceptedAnswer.text })), visiveis, `${name}: JSON-LD igual ao texto da página`);
      assert.ok(ld.mainEntity.every((q) => q['@type'] === 'Question' && q.acceptedAnswer['@type'] === 'Answer'));
      // Fonte das regras, com links que existem; estilo do bloco no <head>.
      for (const p of ['como-funciona.html', 'sobre.html', 'termos.html']) {
        assert.ok(sec.includes(`<a href="../../../${p}">`), `${name}: link para ${p}`);
        assert.ok(existsSync(join(ROOT, p)));
      }
      assert.match(html, /<style>\.cd-faq\{[^<]*<\/style>\n<script type="application\/ld\+json">/, `${name}: estilo do bloco`);
      // Ordem: lista, (veja também), perguntas, "Assumir o cadastro", fonte dos dados.
      const pos = ['id="cdList"', 'class="cd-faq"', 'class="cd-claim"', 'class="cd-src"'].map((s) => html.indexOf(s));
      assert.ok(pos.every((p, i) => p > 0 && (i === 0 || p > pos[i - 1])), `${name}: ordem dos blocos ${pos}`);
      if (tp && html.includes('class="cd-also"')) assert.ok(html.indexOf('class="cd-also"') < pos[1], `${name}: "Veja também" antes das perguntas`);
      if (!tp) primeiras.add(visiveis[0].a);
      paginas += 1;
    }
  }
  assert.ok(paginas > 1500, `páginas conferidas: ${paginas}`);
  // Nada de texto igual em todas as cidades: a primeira resposta tem o nome e os números de cada uma.
  assert.equal(primeiras.size, cities.length);
  // O índice das cidades não tem o bloco.
  assert.ok(!readFileSync(join(out, 'cidades/index.html'), 'utf8').includes('cd-faq'));
});

test('sitemap: todas as páginas fixas (inclusive para-medicos.html) e nenhuma página pública da raiz fica de fora sem querer', () => {
  const base = siteUrlFromConfig(ROOT);
  for (const p of ['', 'perto.html', 'parceiros.html', 'reivindicar.html', 'sobre.html', 'como-funciona.html', 'termos.html', 'privacidade.html', 'acessibilidade.html', 'contato.html', 'para-medicos.html']) {
    assert.ok(PAGINAS_FIXAS.includes(p), `${p || 'início'} na lista fixa`);
  }
  for (const p of PAGINAS_FIXAS) assert.ok(existsSync(join(ROOT, p || 'index.html')), `${p}: a página existe`);
  // Página da raiz indexável (sem noindex e com o endereço dela mesma como canônico) entra no sitemap.
  // De fora de propósito, por enquanto: a teleconsulta e o termo dela (como no vídeo de divulgação).
  const DE_FORA = ['teleconsulta.html', 'termo-teleconsulta.html'];
  const raiz = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  for (const f of raiz) {
    const h = readFileSync(join(ROOT, f), 'utf8');
    const noindex = /<meta name="robots" content="[^"]*noindex/.test(h);
    const canon = h.match(/<link rel="canonical"[^>]*href="([^"]+)"/)?.[1];
    const propria = canon === base + (f === 'index.html' ? '' : f);
    if (!noindex && propria && !DE_FORA.includes(f)) assert.ok(PAGINAS_FIXAS.includes(f === 'index.html' ? '' : f), `${f}: página pública fora do sitemap (acrescente em PAGINAS_FIXAS)`);
    if (noindex) assert.ok(!PAGINAS_FIXAS.includes(f), `${f}: noindex não vai para o sitemap`);
  }
  // O sitemap do repositório tem todas elas, os guias e o índice das cidades.
  const sm = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  const locs = new Set([...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  for (const p of [...PAGINAS_FIXAS, 'exames/', ...listExamPages(ROOT), 'cidades/']) assert.ok(locs.has(base + p), `${p || 'início'} no sitemap.xml`);
  assert.ok(!sm.includes('gestao.html') && !sm.includes('llms.txt'));
});

test('llms.txt: formato do llmstxt.org, regras publicadas, links do site e números do cidades.json', () => {
  const guides = examGuides(listExamPages(ROOT), ROOT);
  assert.equal(guides.length, 8);
  assert.deepEqual(guides.map((g) => g.name).sort(), ['Densitometria óssea', 'Ecocardiograma', 'Eletrocardiograma (ECG)', 'Mamografia', 'Raio-X (radiografia)', 'Ressonância magnética', 'Tomografia computadorizada', 'Ultrassom (ultrassonografia)']);
  const txt = renderLlms(CITIES, { base: BASE, date: DATE, guides });
  const lines = txt.split('\n');
  // Título (H1), resumo em citação e seções H2 com listas de links.
  assert.equal(lines[0], '# IMED');
  assert.equal(lines[1], '');
  assert.match(lines[2], /^> .*Não é plano de saúde nem cartão de desconto, é um serviço privado sem vínculo com o governo ou o SUS e não é serviço de urgência\.$/);
  assert.equal(lines.filter((l) => l.startsWith('# ')).length, 1);
  assert.deepEqual(lines.filter((l) => l.startsWith('## ')), ['## Páginas principais', '## Para clínicas', '## Optional']);
  // Números do cidades.json, com a data.
  const total = CITIES.reduce((s, c) => s + c.total, 0);
  assert.ok(txt.includes(`Números atualizados em 30 de outubro de 2026: ${fmt(total)} estabelecimentos de saúde em ${fmt(CITIES.length)} cidades`));
  // Regras publicadas: dados do CNES, nada inventado, ordem por distância, custo, Confirmado, SUS, localização, emergência.
  for (const s of ['CRM-SP 266930', 'ligue 192 (SAMU)', 'confirme com o local', 'O IMED nunca inventa preço, nota, horário ou depoimento.',
    'Ninguém paga para aparecer primeiro', 'só vale como agendamento quando aparece como "Confirmado"', 'buscar, pedir e cancelar o pedido pelo IMED não têm custo',
    'nunca pede Pix', 'arredondada antes de sair do aparelho e não é gravada', 'Siga a orientação do seu médico']) {
    assert.ok(txt.includes(s), s);
  }
  assert.ok(!/R\$|★|sempre|gratuit|garant/i.test(txt), 'sem preço, nota nem promessa');
  // Links: todos absolutos no endereço do site e para páginas que existem.
  const links = [...txt.matchAll(/^- \[([^\]]+)\]\(([^)]+)\)(: .+)?$/gm)];
  assert.equal(links.length, lines.filter((l) => l.startsWith('- [')).length, 'toda linha de link no formato - [nome](url): nota');
  assert.ok(links.length >= 20);
  for (const [, name, url] of links) {
    assert.ok(url.startsWith(BASE), `${name}: ${url}`);
    const p = url.slice(BASE.length);
    assert.ok(existsSync(join(ROOT, p === '' || p.endsWith('/') ? `${p}index.html` : p)), `${name}: ${p} existe`);
  }
  for (const g of guides) assert.ok(txt.includes(`- [Guia: ${g.name}](${BASE}${g.path})`), g.name);
  // Sem guias (como nos testes de outras partes), sem a seção Optional.
  assert.ok(!renderLlms(CITIES, { base: BASE, date: DATE }).includes('## Optional'));
});

// Cada frase do llms.txt e onde ela está publicada: [trecho do llms.txt, página, como está na página].
// Mudou a página, mude renderLlms (scripts/gerar-cidades.mjs) e gere de novo; regra nova no llms.txt precisa de fonte aqui.
// Falta publicar "não é plano de saúde nem cartão de desconto" (resumo do llms.txt e perguntas das cidades): quando
// sobre.html ou termos.html tiver a frase, acrescente a linha aqui e em tests/e2e-cidades-faq.mjs.
const FONTES_LLMS = [
  ['Dr. Rafael Pereira Barreto Silva, CRM-SP 266930', 'sobre.html', /Dr\. Rafael Pereira Barreto Silva — médico, CRM-SP 266930/],
  ['Em emergência, ligue 192 (SAMU) ou vá ao pronto-socorro mais próximo.', 'sobre.html', /ligue 192 \(SAMU\) ou vá ao pronto-socorro mais próximo\./],
  ['é um serviço privado sem vínculo com o governo ou o SUS', 'sobre.html', /O IMED é um serviço privado, sem vínculo com o governo ou o SUS/],
  ['não é serviço de urgência', 'sobre.html', /não é serviço de urgência/],
  ['turno de atendimento e atendimento pelo SUS vêm do CNES', 'sobre.html', /turno de atendimento e atendimento pelo SUS vêm do Cadastro Nacional de Estabelecimentos de Saúde, uma base pública do Ministério da Saúde/],
  ['podem estar desatualizados: confirme com o local.', 'termos.html', /vêm do CNES, do Ministério da Saúde, e podem estar desatualizados\. Confirme com o local/],
  ['O CNES não lista os exames de cada local. Nos locais que ainda não são parceiros, os serviços mostrados são deduzidos pelo nome do estabelecimento', 'como-funciona.html', /o CNES não lista os exames de cada local\. Quando mostramos serviços de um local que não é parceiro, eles foram deduzidos pelo nome do estabelecimento\. Confirme com o local\./],
  ['a busca pode mostrar locais do OpenStreetMap ou do Google Maps, com a fonte indicada', 'como-funciona.html', /a busca pode mostrar locais do OpenStreetMap ou do Google Maps, com a fonte indicada/],
  ['Preços, exames, convênios e horários de clínicas parceiras são informados pela própria clínica', 'sobre.html', /preços, convênios, horários e exames são informados pela própria clínica/],
  ['Sem o dado, a informação não aparece ou aparece como "sob consulta".', 'sobre.html', /Quando uma informação não existe, ela não aparece ou aparece como “sob consulta”/],
  ['O IMED nunca inventa preço, nota, horário ou depoimento.', 'sobre.html', /O IMED nunca inventa preço, nota, horário ou depoimento\./],
  ['A lista vem em ordem de distância.', 'termos.html', /A lista de resultados é ordenada por distância\./],
  ['Ninguém paga para aparecer primeiro', 'como-funciona.html', /Ninguém paga para aparecer primeiro\./],
  ['o selo "Parceiro verificado" não se vende', 'como-funciona.html', /Selo não se vende: o selo “Parceiro verificado”/],
  ['Só avalia quem fez um pedido pelo IMED e teve o atendimento concluído.', 'sobre.html', /só quem teve o atendimento concluído por um pedido feito no IMED pode avaliar/],
  ['Sem avaliações, não há nota.', 'como-funciona.html', /Sem avaliações, não mostramos nota\./],
  ['Um pedido só vale como agendamento quando aparece como "Confirmado".', 'termos.html', /Um pedido só vale como agendamento quando aparece como Confirmado\./],
  ['O pedido é para atendimento particular ou por convênio: unidades públicas do SUS não agendam pelo IMED', 'termos.html', /O pedido é para atendimento particular ou por convênio\. Unidades públicas do SUS não agendam pelo IMED/],
  ['para marcar pelo SUS, procure a Unidade Básica de Saúde, a UBS', 'como-funciona.html', /Para ser atendido pelo SUS, procure a sua Unidade Básica de Saúde \(UBS\)\./],
  ['Para o paciente, buscar, pedir e cancelar o pedido pelo IMED não têm custo. Se houver cobrança pelo exame ou pela consulta, o pagamento é feito direto no local.', 'sobre.html', /Para você, o IMED é gratuito: se houver cobrança pelo exame ou pela consulta no local, o pagamento é feito direto lá\./],
  ['cancelar o pedido pelo IMED não têm custo', 'termos.html', /Cancelar pelo IMED é grátis\./],
  ['O IMED nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp.', 'sobre.html', /O IMED nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp\./],
  ['A localização do aparelho só é usada quando a pessoa permite', 'privacidade.html', /A localização só é usada com a sua permissão/],
  ['é arredondada antes de sair do aparelho e não é gravada', 'privacidade.html', /Antes de sair do aparelho, elas são arredondadas.*Elas não são gravadas/],
  ['Os guias de exames são orientação geral: o preparo pode mudar conforme o local e o caso. Siga a orientação do seu médico e confirme com o local.', 'exames/raio-x.html', /Conteúdo educativo e geral\. O preparo pode mudar conforme a clínica, o aparelho e o seu caso: siga sempre a orientação do seu médico e da clínica onde fará o exame\./],
];

test('llms.txt: cada regra está publicada no site (Quem somos, Como funciona, Termos, Privacidade e guias), sem prometer mais', () => {
  const txt = renderLlms(CITIES, { base: BASE, date: DATE });
  // Texto da página: as marcas de dentro da frase (negrito, link, ícone) somem; as outras viram espaço.
  const pagina = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/<\/?(?:b|strong|a|i|em|span)\b[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const [trecho, p, re] of FONTES_LLMS) {
    assert.ok(txt.includes(trecho), `llms.txt: ${trecho}`);
    assert.match(pagina(p), re, `${p}: ${trecho}`);
  }
  // Toda regra da lista do llms.txt tem fonte publicada.
  const regras = txt.split('Regras que o IMED segue:')[1].split('\n## ')[0].split('\n').filter((l) => l.startsWith('- '));
  assert.ok(regras.length >= 10, `regras: ${regras.length}`);
  for (const r of regras) assert.ok(FONTES_LLMS.some(([trecho]) => r.includes(trecho)), `regra do llms.txt sem fonte publicada: ${r}`);
  // O que o site não publica fica fora do llms.txt.
  assert.ok(!/contagem|nunca inventa[^.]*médico/.test(txt), 'sem "contagem" nem "médico" na regra do que o IMED não inventa (o site não diz isso)');
});

test('português: "do/no Rio de Janeiro", "da/na Serra" e "do/no Cabo de Santo Agostinho" nas perguntas, no topo, em "Veja também" e na descrição', (t) => {
  const RJ = CITIES.find((c) => c.ibge === 3304557);
  const SERRA = CITIES.find((c) => c.name === 'Serra' && c.uf === 'ES');
  const CABO = CITIES.find((c) => c.name === 'Cabo de Santo Agostinho' && c.uf === 'PE');
  assert.ok(RJ && SERRA && CABO);
  // Perguntas e respostas.
  const serra = faqItems(SERRA, null, DATE);
  assert.equal(serra[0].q, 'Quantos locais de saúde da Serra aparecem no IMED?');
  assert.ok(serra[0].a.startsWith(`O IMED mostra ${fmt(SERRA.total)} estabelecimentos de saúde na Serra (Espírito Santo), do cadastro oficial`), serra[0].a);
  assert.match(serra[1].a, /mostra os estabelecimentos de saúde da Serra e encaminha/);
  assert.equal(serra[4].q, 'Os locais da Serra atendem pelo SUS?');
  const tipo = TYPES.find((tp) => SERRA[tp.kind] > 0);
  assert.equal(faqItems(SERRA, tipo, DATE)[0].q, `${tipo.quant} ${tipo.plural} da Serra aparecem no IMED?`);
  assert.match(faqItems(SERRA, tipo, DATE)[0].a, new RegExp(`^O IMED mostra [\\d.]+ [^.]+ na Serra \\(Espírito Santo\\),`));
  const cabo = faqItems(CABO, null, DATE);
  assert.equal(cabo[0].q, 'Quantos locais de saúde do Cabo de Santo Agostinho aparecem no IMED?');
  assert.ok(cabo[0].a.startsWith(`O IMED mostra ${fmt(CABO.total)} estabelecimentos de saúde no Cabo de Santo Agostinho (Pernambuco), do cadastro oficial`), cabo[0].a);
  assert.equal(cabo[4].q, 'Os locais do Cabo de Santo Agostinho atendem pelo SUS?');
  // Fora dessas duas, a regra é a mesma de assets/js/confianca.js (a da página inicial).
  for (const c of CITIES) if (!['Serra', 'Cabo de Santo Agostinho'].includes(c.name)) assert.equal(deCidade(c.name), deCidadeSite(c.name), c.name);
  // Nas páginas: o parágrafo do topo, "Veja também" e a descrição usam a mesma forma das perguntas.
  const out = mkdtempSync(join(tmpdir(), 'imed-pt-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  generate({ cities: [RJ, SERRA, CABO, SP], base: BASE, date: DATE, out, examPages: [] });
  const read = (p) => readFileSync(join(out, p), 'utf8');
  const rio = read(`${cityDir(RJ)}index.html`);
  assert.ok(rio.includes(`<p class="cd-lead">O IMED tem <strong>${fmt(RJ.total)} estabelecimentos de saúde</strong> no Rio de Janeiro (RJ), do cadastro oficial`));
  assert.ok(rio.includes(`<meta name="description" content="${fmt(RJ.total)} estabelecimentos de saúde no Rio de Janeiro (RJ) no cadastro oficial:`));
  const rioH = read(typePath(RJ, byKind.hospital));
  assert.ok(rioH.includes(`<p class="cd-lead">São <strong>${fmt(RJ.hospital)} hospitais</strong> no Rio de Janeiro (RJ) no cadastro oficial`));
  assert.ok(rioH.includes('<nav class="cd-also" aria-label="Outros tipos no Rio de Janeiro"><h2>Veja também no Rio de Janeiro</h2>'));
  assert.ok(rioH.includes(`<meta name="description" content="${fmt(RJ.hospital)} hospitais no Rio de Janeiro (RJ) no cadastro oficial`));
  const serraT = read(typePath(SERRA, tipo));
  assert.ok(serraT.includes(` na Serra (Espírito Santo) no cadastro oficial do Ministério da Saúde (CNES), de um total de ${fmt(SERRA.total)}`));
  assert.ok(serraT.includes('<h2>Veja também na Serra</h2>'));
  assert.ok(read(`${cityDir(CABO)}index.html`).includes('</strong> no Cabo de Santo Agostinho (Pernambuco), do cadastro oficial'));
  // Cidade sem artigo: "em".
  const sp = read(`${cityDir(SP)}index.html`);
  assert.ok(sp.includes('</strong> em São Paulo (SP), do cadastro oficial'));
  assert.ok(read(typePath(SP, byKind.clinica)).includes('<h2>Veja também em São Paulo</h2>'));
  // Título e <h1> continuam no formato de sempre ("em <cidade> - UF").
  assert.ok(rio.includes(`<title>${cityTitle(RJ)}</title>`) && rio.includes('<h1>Clínicas, laboratórios e hospitais em Rio de Janeiro - RJ</h1>'));
});

test('data dos números: a do último commit do JSON (no fuso de São Paulo); com mudança ainda sem commit, a do arquivo gravado', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'imed-data-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, GIT_AUTHOR_DATE: '2026-09-15T23:30:00-03:00', GIT_COMMITTER_DATE: '2026-09-20T10:00:00-03:00' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=IMED', '-c', 'user.email=imed@localhost', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, env, stdio: 'ignore' });
  mkdirSync(join(dir, 'scripts'));
  const json = join(dir, 'scripts/cidades.json');
  writeFileSync(json, '[]');
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'Números das cidades');
  // Gravado às 23h30 de 15/9 em São Paulo (já 16/9 em UTC): vale o dia de São Paulo. Gerar de novo depois não muda.
  assert.deepEqual(dataDosNumeros('scripts/cidades.json', dir), { date: '2026-09-15', origem: 'último commit de scripts/cidades.json' });
  // Números novos, ainda sem commit: o dia em que o arquivo foi gravado.
  writeFileSync(json, '[{}]');
  const gravado = new Date('2026-10-02T15:00:00Z');
  utimesSync(json, gravado, gravado);
  assert.deepEqual(dataDosNumeros('scripts/cidades.json', dir), { date: '2026-10-02', origem: 'dia em que scripts/cidades.json foi gravado' });
  // O JSON do repositório também tem uma data (a do último commit ou a do arquivo).
  assert.match(dataDosNumeros().date, /^\d{4}-\d{2}-\d{2}$/);
});

/* ======================= guias de exames: caixa "O que levar" (exames/*.html) ======================= */
// Os avisos de cada guia (o que pode impedir ou exige cuidado) continuam com o mesmo texto.
const AVISOS = {
  'densitometria-ossea': 'Exames com contraste feitos nos dias anteriores podem alterar o resultado. Conte à clínica ao agendar.',
  ecocardiograma: 'Se o pedido for de eco transesofágico ou de estresse, confirme o preparo com a clínica: eles exigem jejum e acompanhante.',
  eletrocardiograma: 'Dor no peito forte ou que não passa é emergência: procure um pronto-socorro ou ligue 192 (SAMU).',
  mamografia: 'A idade de início e a frequência da mamografia dependem do seu histórico. Converse com seu médico.',
  'raio-x': 'Gestantes só devem fazer raio-X com indicação médica e proteção adequada. Avise sempre a equipe.',
  'ressonancia-magnetica': 'Marca-passo e alguns implantes podem impedir o exame. A clínica precisa saber antes do agendamento.',
  tomografia: 'A tomografia usa radiação. Gestantes ou quem pode estar grávida devem avisar antes do exame.',
  ultrassom: 'O preparo muda muito conforme a região do corpo. Confira as orientações da clínica ao agendar.',
};
const texto = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('guias de exames: caixa "O que levar" nos 8 guias, só logística e com "confirme com o local"', () => {
  const guias = listExamPages(ROOT);
  assert.deepEqual(guias.map((g) => g.slice('exames/'.length, -'.html'.length)).sort(), Object.keys(AVISOS).sort());
  for (const g of guias) {
    const slug = g.slice('exames/'.length, -'.html'.length);
    const h = readFileSync(join(ROOT, g), 'utf8');
    assert.equal((h.match(/<section id="levar"/g) || []).length, 1, `${slug}: uma caixa`);
    const box = h.match(/<section id="levar" class="card">([\s\S]*?)<\/section>/)?.[1] ?? '';
    const t = texto(box);
    assert.match(box, /<h2>.*O que levar<\/h2>/, `${slug}: título`);
    // Depois do "Como se preparar" e antes das perguntas frequentes.
    const [prep, levar, faq] = ['<section id="preparo">', '<section id="levar"', 'Perguntas frequentes</h2>'].map((s) => h.indexOf(s));
    assert.ok(prep > 0 && levar > prep && faq > levar, `${slug}: lugar da caixa`);
    // O que levar: documento com foto e carteirinha, pedido médico, exames anteriores, remédios e a antecedência.
    assert.match(t, /Documento com foto e, se for pelo convênio, a carteirinha\./, slug);
    assert.match(t, /Pedido médico/, slug);
    assert.match(t, /anteriores/, slug);
    assert.match(t, /A lista dos remédios que você usa\./, slug);
    assert.match(t, /Chegue com a antecedência que o local pedir\./, slug);
    assert.match(t, /confirme com o local/, `${slug}: confirme com o local`);
    // Só logística: nada de preparo, impedimento ou orientação clínica nova na caixa.
    assert.ok(!/jejum|contraste|grávid|gravidez|marca-passo|implante|suplement|desodorante|creme|metal|radiação|R\$/i.test(t), `${slug}: só logística (${t})`);
    // Lado do corpo nos exames de uma parte do corpo.
    if (['raio-x', 'ultrassom', 'tomografia', 'ressonancia-magnetica'].includes(slug)) assert.match(t, /com a parte do corpo e o lado escritos quando for o caso \(como “[a-z]+ (direito|esquerdo)”\)/, slug);
    // Como no resto do guia (tests/e2e-inicio.mjs): sem preço, nota, Pix nem a palavra "exemplo" na página.
    assert.ok(!/R\$|★|Pix|exemplo/.test(texto(h.match(/<body>[\s\S]*<\/body>/)[0].replace(/<script[\s\S]*?<\/script>/g, ''))), `${slug}: sem preço, nota, Pix ou "exemplo"`);
    // O aviso do guia continua igual e o "Leve ..." saiu do preparo (foi para a caixa, com o mesmo sentido).
    const prepSec = h.match(/<section id="preparo">([\s\S]*?)<\/section>/)[1];
    assert.ok(prepSec.includes(`<div class="warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>${AVISOS[slug]}</span></div>`), `${slug}: aviso igual`);
    assert.ok(!/<span>Leve /.test(prepSec), `${slug}: "Leve" fica só na caixa`);
    assert.ok((prepSec.match(/<li>/g) || []).length >= 3, `${slug}: preparo mantido`);
  }
  // O que saiu do preparo está na caixa.
  const caixa = (slug) => texto(readFileSync(join(ROOT, `exames/${slug}.html`), 'utf8').match(/<section id="levar"[\s\S]*?<\/section>/)[0]);
  assert.match(caixa('mamografia'), /Mamografias e ultrassons das mamas anteriores, para comparação\./);
  assert.match(caixa('raio-x'), /Pedido médico.*Exames anteriores da mesma região, se tiver\./);
  assert.match(caixa('ecocardiograma'), /Exames anteriores do coração, se tiver\..*A lista dos remédios que você usa\./);
  assert.match(caixa('eletrocardiograma'), /A lista dos remédios que você usa\./);
});
