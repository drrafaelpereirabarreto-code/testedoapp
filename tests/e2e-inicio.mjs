// Teste de ponta a ponta da página inicial (Playwright), com respostas simuladas do banco (Supabase).
// Confere que a página só mostra dados reais: nada de preço, nota ou número inventado.
// Rodar com: node tests/e2e-inicio.mjs   (precisa do pacote "playwright" instalado)
// Opcional: SHOTS=pasta node tests/e2e-inicio.mjs  salva capturas de tela nessa pasta.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const PORT = 8770;
const REST = 'https://pyoqiecupxhdzigjudyd.supabase.co/rest/v1/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/+F9PQAJYwN6V0E0WwAAAABJRU5ErkJggg==', 'base64');

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('não encontrado');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;

const CITIES = [
  { ibge: 3550308, name: 'São Paulo', uf: 'SP', total: 6548, imagem: 574, laboratorio: 524, clinica: 5161, hospital: 289 },
  { ibge: 3106200, name: 'Belo Horizonte', uf: 'MG', total: 2284, imagem: 191, laboratorio: 206, clinica: 1794, hospital: 93 },
  { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', total: 3000, imagem: 300, laboratorio: 200, clinica: 2300, hospital: 200 },
  { ibge: 3545803, name: "Santa Bárbara d'Oeste", uf: 'SP', total: 150, imagem: 10, laboratorio: 20, clinica: 110, hospital: 10 },
];
const PARTNER_ID = '33333333-3333-4333-8333-333333333333';
const PARTNERS = [
  { id: PARTNER_ID, name: 'Clínica Parceira Paulista', kind: 'imagem', description: null, address_line: 'Av. Paulista, 1500', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: '01310200', lat: -23.5614, lng: -46.6559, distance_m: 300, phone: '(11) 3333-4444', whatsapp: null, email: null, website: null, specialties: [], opening_hours: null, accepts_online_booking: true, is_demo: false, exams: [{ code: 'rm', price_cents: 45000 }, { code: 'usg', price_cents: null }], insurances: [], cnes: '9999999' },
];
const CNES_ROWS = [
  { cnes: '2077485', name: 'Hospital Santa Exemplo', kind: 'hospital', address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César', cep: '01409001', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5598, lng: -46.6602, distance_m: 420, location_source: 'cnes', phone: '(11) 3141-1000', shift: null, open_24h: true, sus: false, services: ['rm', 'tc', 'rx'], specialties: ['Cardiologia'], cnes_updated_at: '2026-09-15' },
  { cnes: '6543210', name: 'Laboratório Análise Paulista', kind: 'laboratorio', address_line: 'Alameda Santos, 200', neighborhood: 'Bela Vista', cep: '01418000', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5655, lng: -46.6520, distance_m: 640, location_source: 'endereco', phone: '(11) 3000-2000', shift: 'Manhã e tarde', open_24h: false, sus: true, services: ['lab'], specialties: [], cnes_updated_at: '2026-08-02' },
  { cnes: '7000001', name: 'Centro de Imagem <b>Teste</b>', kind: 'imagem', address_line: 'Rua Augusta, 1000', neighborhood: 'Consolação', cep: '01304001', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.556, lng: -46.657, distance_m: 900, location_source: 'cnes', phone: null, shift: null, open_24h: false, sus: false, services: ['rx'], specialties: [], cnes_updated_at: '2026-09-01' },
];
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const APPTS = [
  { type: 'pedido', code: 'IMED-11111111', id: ID1, token: 'a'.repeat(64), place_key: 'cnes:2077485', name: 'Hospital Santa Exemplo', exam: 'rm', items: ['Ressonância'], date: '2026-11-05', period: 'manha', status: 'pendente', created: '2026-10-30T12:00:00Z' },
  { type: 'pedido', code: 'IMED-22222222', id: ID2, token: 'b'.repeat(64), place_key: 'cnes:6543210', name: 'Laboratório Análise Paulista', exam: 'lab', items: ['Exames de laboratório'], date: '2026-10-20', period: 'qualquer', status: 'pendente', created: '2026-10-15T12:00:00Z' },
  { type: 'pedido', code: 'IMED-3F2A9C1E', status: 'pendente', name: 'Laboratório Vida', items: ['Exames de laboratório'], date: 'segunda-feira, 03 de novembro', time: 'manhã', total: null },
  { code: 'IMED-ABCDE', type: 'exame', clinic: 'dcp', name: 'DiagnoCenter Paulista', items: ['Ressonância'], date: 'amanhã', time: '14:30', total: 405, pay: 'pix' },
  { code: 'TELE-XYZ', type: 'tele', name: 'Dra. Camila Ruiz', items: ['Teleconsulta'], date: 'Hoje', time: 'agora', total: 120 },
];

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*' } });
const preflight = (route) => route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' } });

// device: { memory, cores, saveData } simula o aparelho (navigator.deviceMemory, hardwareConcurrency, connection.saveData).
async function newPage(browser, { mobile = false, cities, cnes, partners, status, waitlist, whatsapp = '', appts, motion = 'reduce', device = null } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 860 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block', reducedMotion: motion, acceptDownloads: true,
  });
  const log = { cities: 0, cnes: [], partners: [], status: [], waitlist: [] };
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await context.route(`${REST}rpc/imported_cities`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.cities += 1;
    return (cities ?? ((r) => json(r, CITIES)))(route);
  });
  await context.route(`${REST}rpc/nearby_establishments`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.cnes.push(JSON.parse(route.request().postData() || '{}'));
    return (cnes ?? ((r) => json(r, CNES_ROWS)))(route);
  });
  await context.route(`${REST}rpc/nearby_clinics`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.partners.push(JSON.parse(route.request().postData() || '{}'));
    return (partners ?? ((r) => json(r, PARTNERS)))(route);
  });
  await context.route(`${REST}rpc/request_status`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.status.push(JSON.parse(route.request().postData() || '{}'));
    return (status ?? ((r) => json(r, [{ id: ID1, status: 'confirmed', reviewed: false }, { id: ID2, status: 'completed', reviewed: false }])))(route);
  });
  await context.route(`${REST}app_waitlist`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.waitlist.push(JSON.parse(route.request().postData() || '{}'));
    return (waitlist ?? ((r) => r.fulfill({ status: 201, body: '', headers: { 'Access-Control-Allow-Origin': '*' } })))(route);
  });
  if (whatsapp) {
    await context.route(`${BASE}assets/js/config.js`, async (route) => {
      const body = (await readFile(join(ROOT, 'assets/js/config.js'), 'utf8')).replace("whatsapp: ''", `whatsapp: '${whatsapp}'`);
      return route.fulfill({ status: 200, contentType: 'text/javascript', body });
    });
  }
  await context.addInitScript(({ list }) => {
    try { localStorage.setItem('imed_lgpd', '1'); } catch { /* ignora */ }
    if (!sessionStorage.getItem('fav')) { localStorage.setItem('imed_fav', '["dcp"]'); sessionStorage.setItem('fav', '1'); }
    if (list && !sessionStorage.getItem('seeded')) { localStorage.setItem('imed_appts', JSON.stringify(list)); sessionStorage.setItem('seeded', '1'); }
  }, { list: appts ?? null });
  if (device) {
    await context.addInitScript((d) => {
      if (d.memory != null) Object.defineProperty(navigator, 'deviceMemory', { get: () => d.memory, configurable: true });
      if (d.cores != null) Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => d.cores, configurable: true });
      if (d.saveData) Object.defineProperty(navigator, 'connection', { get: () => ({ saveData: true, effectiveType: '4g' }), configurable: true });
    }, device);
  }
  const page = await context.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, log, errors, requests };
}

const shot = async (page, name, full = false) => { if (SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: full }); } };
const results = [];
async function scenario(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 5).join('\n  ')}`); }
}
// Rola a página inteira para carregar as seções que só aparecem ao rolar.
async function scrollAll(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
    window.scrollTo(0, 0);
  });
}

const browser = await chromium.launch();

await scenario('só dados reais: sem preço, nota ou número inventado; pílula com número do banco', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(BASE);
  await page.waitForFunction(() => /estabelecimentos oficiais/.test(document.querySelector('#livePill').textContent));
  assert.equal(await page.textContent('#livePill'), '11.982 estabelecimentos oficiais em 4 cidades');
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_fav')), null, 'favoritos fictícios antigos apagados');
  assert.equal(log.cities, 1, 'uma chamada só para pílula e cidades');
  await scrollAll(page);
  await page.waitForSelector('#realList li b');
  const text = await page.evaluate(() => document.body.innerText);
  assert.ok(!/R\$/.test(text), 'nenhum "R$" na página');
  assert.ok(!/★/.test(text), 'nenhuma estrela de nota');
  assert.ok(!/4,9|4,8 ★|\+500|nota média|IMED10|Super Clínica|Juliana/i.test(text), 'nenhum número ou depoimento inventado');
  assert.ok(!/Protótipo|ilustrativos: clínicas/.test(text), 'sem aviso de protótipo');
  assert.ok(!/a partir de/i.test(text), 'sem "a partir de R$"');
  const html = await page.content();
  assert.equal(await page.evaluate(() => [typeof CLINICS, typeof DOCS, typeof COUPONS, typeof REVIEWS].join()), 'undefined,undefined,undefined,undefined', 'dados fictícios não existem mais');
  assert.ok(html.includes('Content-Security-Policy'));
  // categorias levam à busca com o exame
  const cats = await page.$$eval('#cats a', (els) => els.map((e) => e.getAttribute('href')));
  assert.ok(cats.includes('perto.html?exame=rm') && cats.includes('perto.html?exame=rx') && cats.includes('perto.html?exame=lab'));
  assert.ok(cats.every((h) => /^perto\.html\?exame=\w+$/.test(h)));
  // cidades com link para a página da cidade
  const cities = await page.$$eval('#cities a', (els) => els.map((e) => [e.getAttribute('href'), e.textContent]));
  assert.deepEqual(cities.map((c) => c[0]), ['cidades/sp/sao-paulo/', 'cidades/rj/rio-de-janeiro/', 'cidades/mg/belo-horizonte/', 'cidades/sp/santa-barbara-d-oeste/'], 'mesma regra de scripts/gerar-cidades.mjs');
  const { slugify } = await import('../scripts/gerar-cidades.mjs');
  assert.equal(cities[3][0], `cidades/sp/${slugify("Santa Bárbara d'Oeste")}/`);
  assert.match(cities[0][1], /6\.548 estabelecimentos/);
  // clínicas reais (CNES) perto
  const list = await page.$$eval('#realList li b', (els) => els.map((e) => e.textContent));
  assert.deepEqual(list, ['Clínica Parceira Paulista', 'Hospital Santa Exemplo', 'Laboratório Análise Paulista', 'Centro de Imagem <b>Teste</b>'], 'nome do CNES mostrado como texto, parceiros juntos por distância');
  assert.match(await page.textContent('#realList li:first-child'), /Parceiro do IMED/);
  const links = await page.$$eval('#realList li > a', (els) => els.map((e) => e.getAttribute('href')));
  assert.deepEqual(links, [`local.html?id=${PARTNER_ID}`, 'local.html?cnes=2077485', 'local.html?cnes=6543210', 'local.html?cnes=7000001'], 'cada item leva à página do local');
  // FAQ: 5 perguntas principais e "Ver todas"
  assert.equal(await page.locator('.faq details:visible').count(), 5, 'FAQ com 5 perguntas visíveis');
  await page.click('#faqAll');
  assert.equal(await page.locator('.faq details:visible').count(), 7, 'Ver todas mostra as outras');
  assert.equal(await page.locator('#faqAll').count(), 0);
  const stats = await page.$$eval('#realStats .rm-stat b', (els) => els.map((e) => e.textContent));
  assert.deepEqual(stats, ['2', '1', '0', '1'], 'contagem por tipo inclui o parceiro (imagem)');
  const r = log.cnes.find((a) => a.p_radius_m === 2000);
  assert.ok(String(r.p_lat).split('.')[1].length <= 3, 'coordenada arredondada');
  const pr = log.partners.find((a) => a.p_radius_m === 2000);
  assert.ok(pr && pr.p_include_demo === false && pr.p_lat === r.p_lat, 'parceiros pedidos no mesmo ponto, sem demonstração');
  // para clínicas e rodapé
  for (const href of ['reivindicar.html', 'painel.html', 'conta.html', 'cidades/', 'exames/', 'privacidade.html']) {
    assert.ok(await page.locator(`footer a[href="${href}"]`).count() >= 1, `rodapé com ${href}`);
  }
  assert.ok(await page.locator('#clinicas a[href="reivindicar.html"]').count() === 1);
  assert.equal(await page.getAttribute('#nearCta', 'href'), 'perto.html?usar=localizacao');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('sem dado do banco: pílula com texto neutro, sem número e sem erro', async () => {
  const { page, errors, context } = await newPage(browser, { cities: (r) => json(r, { message: 'erro' }, 500), cnes: (r) => json(r, { message: 'erro' }, 500) });
  await page.goto(BASE);
  await page.waitForTimeout(800);
  const pill = await page.textContent('#livePill');
  assert.ok(!/\d/.test(pill), `pílula sem número (${pill})`);
  assert.ok(await page.locator('#cities a[href="cidades/"]').count() === 1, 'cidades: só o link geral');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('mapa 3D: estabelecimentos reais perto, com tipo e distância, e painel do local', async () => {
  const { page, log, errors, context } = await newPage(browser, { motion: 'no-preference', device: { memory: 8, cores: 8 } });
  await page.goto(BASE);
  const supported = await page.evaluate(() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } });
  const r3 = await page.waitForFunction(() => document.querySelector('#hero3d').classList.contains('h3d-ready') || document.body.classList.contains('no-webgl'), null, { timeout: 15000 }).then(() => true);
  assert.ok(r3);
  const call = log.cnes.find((a) => a.p_radius_m === 3000);
  assert.ok(call, 'pede os locais num raio de ~3 km');
  assert.deepEqual([call.p_lat, call.p_lng], [-23.565, -46.652]);
  if (supported && !(await page.evaluate(() => document.body.classList.contains('no-webgl')))) {
    await page.waitForFunction(() => document.querySelectorAll('.h3d-label').length === 4);
    assert.equal(await page.getAttribute('#hero3d', 'role'), 'region', 'botões do 3D não ficam dentro de role=img');
    const hiddenFocusable = await page.$$eval('.h3d-label:not(.on)', (els) => els.filter((e) => e.tabIndex !== -1 || e.getAttribute('aria-hidden') !== 'true').length);
    assert.equal(hiddenFocusable, 0, 'rótulo escondido fora do Tab e do leitor de tela');
    const labels = await page.$$eval('.h3d-label', (els) => els.map((e) => e.textContent));
    assert.ok(labels.some((t) => /Hospital Santa Exemplo/.test(t) && /Hospital · 420 m/.test(t)), labels.join(' | '));
    assert.ok(labels.every((t) => !/★|\d,\d ?★|Fechada|\d\d:\d\d/.test(t)), 'sem nota e sem horário');
    assert.ok(labels.some((t) => t.includes('<b>Teste</b>')), 'nome escapado (sem HTML)');
    await page.evaluate(() => [...document.querySelectorAll('.h3d-label')].find((e) => /Hospital Santa/.test(e.textContent)).click());
    await page.waitForSelector('.ov.open');
    const sheet = await page.textContent('#sheet');
    assert.match(sheet, /CNES/);
    assert.equal(await page.getAttribute('#sheet .btn-coral', 'href'), 'local.html?cnes=2077485#agendar', 'Pedir agendamento leva ao formulário da página do local');
    assert.match(await page.textContent('#sheet .btn-coral'), /Pedir agendamento/);
    assert.equal(await page.locator('#sheet a[href="local.html?cnes=2077485"]').count(), 1, 'Ver página do local');
    assert.equal(await page.locator('#sheet a[href="reivindicar.html?cnes=2077485"]').count(), 1, 'É sua clínica?');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
    await page.evaluate(() => [...document.querySelectorAll('.h3d-label')].find((e) => /Parceira/.test(e.textContent)).click());
    await page.waitForSelector('.ov.open');
    const ps = await page.textContent('#sheet');
    assert.match(ps, /Parceiro do IMED/);
    assert.match(ps, /Ressonância/);
    assert.equal(await page.getAttribute('#sheet .btn-coral', 'href'), `local.html?id=${PARTNER_ID}#agendar`, 'parceiro pelo id');
    assert.ok(!/R\$/.test(ps));
    assert.equal(await page.locator('#sheet a[href^="reivindicar.html"]').count(), 0, 'parceiro já tem dono');
    await page.keyboard.press('Escape');
  } else {
    console.log('  (sem WebGL neste navegador: confere só que a página não quebrou)');
  }
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('aparelho fraco (deviceMemory=1): não baixa o 3D e mostra fundo leve com a lista real', async () => {
  const { page, errors, context, requests } = await newPage(browser, { mobile: true, motion: 'no-preference', device: { memory: 1, cores: 8 } });
  await page.goto(BASE);
  await page.waitForSelector('#heroLite li a');
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => document.body.dataset.hero), 'leve');
  assert.ok(!requests.some((u) => /three\.module\.min\.js|hero3d\.js/.test(u)), 'three.js e hero3d.js não são baixados');
  assert.equal(await page.locator('#hero3d canvas').count(), 0);
  assert.ok(await page.locator('#heroLite').isVisible());
  const items = await page.$$eval('#heroLite li a', (els) => els.map((e) => [e.getAttribute('href'), e.textContent]));
  assert.ok(items.length >= 1 && items.length <= 4, `até 4 locais no celular (${items.length})`);
  assert.ok(items.some(([h, t]) => h === 'local.html?cnes=2077485' && /Hospital Santa Exemplo/.test(t) && /420 m/.test(t)), JSON.stringify(items));
  assert.ok(items.some(([h]) => h === `local.html?id=${PARTNER_ID}`), 'parceiro pelo id');
  assert.ok(items.some(([, t]) => t.includes('<b>Teste</b>')), 'nome escapado');
  assert.ok(!/R\$|★/.test(await page.textContent('#heroLite')));
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('#hero3d'), '::before').backgroundImage);
  assert.match(bg, /svg/, 'fundo em SVG, sem foto');
  assert.ok(!requests.some((u) => /recepcao\.webp/.test(u)), 'sem foto de fundo');
  assert.ok(!requests.some((u) => /geo-core\.js/.test(u)), 'geo-core.js só ao abrir Agendados');
  assert.ok(!requests.some((u) => /leaflet\.js/.test(u)), 'Leaflet só quando o mapa se aproxima da tela');
  await shot(page, 'inicio-celular-leve');
  // economia de dados também usa o modo leve
  const b = await newPage(browser, { mobile: true, motion: 'no-preference', device: { memory: 8, cores: 8, saveData: true } });
  await b.page.goto(BASE);
  await b.page.waitForSelector('#heroLite li a');
  assert.ok(!b.requests.some((u) => /three\.module/.test(u)));
  await b.context.close();
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('aparelho normal: baixa o 3D só depois do H1 aparecer', async () => {
  const { page, errors, context } = await newPage(browser, { motion: 'no-preference', device: { memory: 8, cores: 8 } });
  await page.goto(BASE);
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /three\.module\.min\.js/.test(e.name)), null, { timeout: 15000 });
  const t = await page.evaluate(() => {
    const fcp = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint');
    const three = performance.getEntriesByType('resource').find((e) => /three\.module\.min\.js/.test(e.name));
    return { fcp: fcp ? fcp.startTime : null, three: three.startTime, preload: !!document.querySelector('link[href*="three.module"]') };
  });
  assert.equal(t.preload, false, 'sem modulepreload do three.js');
  assert.ok(t.fcp != null && t.three > t.fcp, `three.js (${Math.round(t.three)} ms) depois da primeira pintura com o H1 (${Math.round(t.fcp)} ms)`);
  console.log(`  primeira pintura ${Math.round(t.fcp)} ms; three.js pedido em ${Math.round(t.three)} ms`);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular com 3D: no máximo 2 rótulos, dentro da tela e sem sobreposição', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, motion: 'no-preference', device: { memory: 8, cores: 8 } });
  await page.goto(BASE);
  await page.waitForFunction(() => ['3d', 'leve'].includes(document.body.dataset.hero), null, { timeout: 20000 });
  if (await page.evaluate(() => document.body.dataset.hero) !== '3d') { console.log('  (sem WebGL neste navegador: confere só o modo leve)'); await context.close(); return; }
  await page.waitForFunction(() => document.querySelectorAll('.h3d-label').length >= 3, null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 4; i++) {
    const boxes = await page.$$eval('.h3d-label.on', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
    assert.ok(boxes.length <= 2, `no máximo 2 rótulos (${boxes.length})`);
    const W = await page.evaluate(() => document.querySelector('#hero3d').clientWidth);
    boxes.forEach((b) => assert.ok(b.l >= 0 && b.r <= W, `rótulo dentro da tela (${Math.round(b.l)}..${Math.round(b.r)} de ${W})`));
    if (boxes.length === 2) { const [a, b] = boxes; assert.ok(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t, 'rótulos não se sobrepõem'); }
    await page.waitForTimeout(500);
  }
  const ratio = await page.evaluate(() => { const c = document.querySelector('#hero3d canvas'); return c.width / c.clientWidth; });
  assert.ok(ratio <= 1.5 + 1e-6, `pixel ratio no máximo 1,5 (${ratio})`);
  await shot(page, 'inicio-celular-3d');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Agendados: só pedidos reais, situação do banco, avaliar e lembrete .ics', async () => {
  const { page, log, errors, context } = await newPage(browser, { appts: APPTS });
  await page.goto(`${BASE}#agenda`);
  await page.waitForSelector('.appt');
  await page.waitForFunction(() => /Confirmado/.test(document.querySelector('#appts').textContent));
  const cards = await page.$$eval('.appt', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  assert.equal(cards.length, 3, 'agendamentos fictícios antigos (exame/tele) somem');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(stored.length, 3, 'e são limpos do aparelho');
  assert.ok(stored.every((a) => a.type === 'pedido'));
  assert.equal(log.status.length, 1);
  assert.deepEqual(log.status[0].p_ids, [ID1, ID2]);
  assert.deepEqual(log.status[0].p_tokens, ['a'.repeat(64), 'b'.repeat(64)]);
  assert.match(cards[0], /Hospital Santa Exemplo/);
  assert.match(cards[0], /Confirmado/);
  assert.match(cards[0], /Protocolo IMED-11111111/);
  assert.match(cards[0], /manhã/);
  assert.match(cards[1], /Concluído/);
  assert.equal(await page.getAttribute('.appt >> nth=1 >> a:has-text("Avaliar")', 'href'), `conta.html#pedido-${ID2}`);
  assert.equal(await page.locator('.appt >> nth=0 >> a:has-text("Avaliar")').count(), 0, 'só avalia o que foi concluído');
  assert.match(cards[2], /Pedido enviado/, 'pedido antigo sem código: sem situação ao vivo');
  assert.ok(cards.every((c) => !/R\$/.test(c)));
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.appt >> nth=0 >> button:has-text("Adicionar à agenda")')]);
  assert.match(download.suggestedFilename(), /^imed-imed-11111111\.ics$/);
  const ics = await readFile(await download.path(), 'utf8');
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART;TZID=America\/Sao_Paulo:20261105T080000/);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics.replace(/\r\n /g, ''), /Retire objetos de metal/, 'preparo da ressonância');
  await shot(page, 'inicio-agendados');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Agendados vazio e falha ao consultar a situação', async () => {
  const { page, errors, context } = await newPage(browser, { appts: [APPTS[0]], status: (r) => json(r, { message: 'erro' }, 500) });
  await page.goto(`${BASE}#agenda`);
  await page.waitForFunction(() => /indisponível/.test(document.querySelector('#appts').textContent));
  page.once('dialog', (d) => d.accept());
  await page.click('.appt .rmv');
  await page.waitForSelector('#appts .empty');
  assert.match(await page.textContent('#appts'), /ainda não fez nenhum pedido/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Agendados: remover apaga o pedido mostrado, mesmo se a lista mudou em outra aba', async () => {
  const { page, errors, context } = await newPage(browser, { appts: APPTS.slice(0, 2) });
  await page.goto(`${BASE}#agenda`);
  await page.waitForFunction(() => /Confirmado/.test(document.querySelector('#appts').textContent));
  assert.equal(await page.evaluate(() => document.querySelector('main#conteudo').closest('[data-view]').hidden), true, 'visão início escondida com hidden');
  assert.equal(await page.evaluate(() => document.querySelector('#agendaMain').hidden), false);
  assert.equal(await page.getAttribute('.skip', 'href'), '#agendaMain', 'pular para o conteúdo vai à visão aberta');
  // Outra aba grava um pedido novo no começo da lista.
  await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('imed_appts'));
    all.unshift({ type: 'pedido', code: 'IMED-NOVO0000', id: '44444444-4444-4444-8444-444444444444', token: 'c'.repeat(64), name: 'Pedido de outra aba', items: [], date: '2026-12-01', period: 'tarde', status: 'pendente', created: '2026-10-30T13:00:00Z' });
    localStorage.setItem('imed_appts', JSON.stringify(all));
  });
  page.once('dialog', (d) => d.accept());
  await page.click('.appt >> nth=0 >> .rmv'); // o cartão mostrado: Hospital Santa Exemplo
  await page.waitForFunction(() => !/Hospital Santa Exemplo/.test(document.querySelector('#appts').textContent));
  const left = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')).map((a) => a.code));
  assert.deepEqual(left, ['IMED-NOVO0000', 'IMED-22222222'], 'o pedido novo e o seu código continuam');
  await page.evaluate(() => document.querySelector('.bnav [data-go="inicio"]').click());
  assert.equal(await page.evaluate(() => document.querySelector('#agendaMain').hidden), true);
  assert.equal(await page.getAttribute('.skip', 'href'), '#conteudo');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('teleconsulta "em breve" com lista de espera (interesse teleconsulta)', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}#tele`);
  await page.waitForTimeout(300);
  const sec = await page.textContent('#lista');
  assert.match(sec, /Em breve/);
  assert.match(sec, /Teleconsulta/);
  assert.ok(!/R\$|Dra\.|Dr\./.test(sec), 'sem médicos nem preço');
  assert.equal(await page.inputValue('#wlForm select'), 'teleconsulta');
  await page.fill('#wlForm input[name=email]', 'Maria@Exemplo.com');
  await page.fill('#wlForm input[name=city]', 'Recife');
  await page.click('#wlBtn');
  await page.waitForSelector('#wlMsg.ok');
  assert.deepEqual(log.waitlist[0], { email: 'maria@exemplo.com', city: 'Recife', interest: 'teleconsulta' });
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('WhatsApp: escondido com a configuração vazia e visível quando configurado', async () => {
  {
    const { page, errors, context } = await newPage(browser, { mobile: true });
    await page.goto(BASE);
    await page.waitForTimeout(300);
    assert.equal(await page.locator('a[href*="wa.me"]').count(), 0, 'sem número, sem botão');
    assert.deepEqual(errors, []);
    await context.close();
  }
  const { page, errors, context } = await newPage(browser, { mobile: true, whatsapp: '5511987654321' });
  await page.goto(BASE);
  const fab = page.locator('#waFab');
  await fab.waitFor();
  assert.match(await fab.getAttribute('href'), /^https:\/\/wa\.me\/5511987654321\?text=/);
  const [f, nav] = await Promise.all([fab.boundingBox(), page.locator('.bnav').boundingBox()]);
  assert.ok(f.y + f.height <= nav.y, 'não cobre a barra de navegação de baixo');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular 390px: sem rolagem lateral, menu de baixo coerente', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, appts: APPTS.slice(0, 2) });
  await page.goto(BASE);
  await page.waitForFunction(() => /estabelecimentos oficiais/.test(document.querySelector('#livePill').textContent));
  await shot(page, 'inicio-celular');
  await scrollAll(page);
  await page.waitForSelector('#realList li b');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `sem rolagem lateral (${overflow}px)`);
  const wide = await page.evaluate(() => [...document.querySelectorAll('main *, header *, footer *')].filter((el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.right > innerWidth + 1 && st.position !== 'fixed' && !el.closest('.cats,.cities,.hchips,.h3d-labels,.leaflet-container'); }).map((el) => el.className || el.tagName).slice(0, 5));
  assert.deepEqual(wide, [], 'nenhum elemento passa da largura da tela');
  const items = await page.$$eval('.bnav > *', (els) => els.map((e) => [e.textContent.trim(), e.getAttribute('href'), e.getBoundingClientRect().height]));
  assert.deepEqual(items.map((i) => i[0]), ['Início', 'Perto de mim', 'Agendados', 'Conta']);
  assert.equal(items[3][1], 'conta.html');
  assert.ok(items.every((i) => i[2] < 60), 'rótulos numa linha só');
  // Página mais curta: antes destas mudanças media 7.295 px (390x844, 4 cidades, modo leve).
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(`  altura da página no celular: ${height} px (antes: 7295 px)`);
  assert.ok(height < 6800, `página mais curta no celular (${height} px)`);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#cities')).overflowX), 'auto', 'cidades em carrossel');
  if (SHOTS) { await page.screenshot({ path: join(SHOTS, 'inicio-celular-inteira.png'), fullPage: true }); }
  await page.click('.bnav [data-go="agenda"]');
  await page.waitForFunction(() => /Confirmado/.test(document.querySelector('#appts').textContent));
  await shot(page, 'inicio-celular-agendados');
  const ov2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(ov2 <= 0, `Agendados sem rolagem lateral (${ov2}px)`);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('desktop: topo, busca por exame e capturas', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(BASE);
  await page.waitForFunction(() => /estabelecimentos oficiais/.test(document.querySelector('#livePill').textContent));
  await shot(page, 'inicio-desktop');
  assert.equal(await page.locator('.tabs a[href="perto.html"]').count(), 1);
  assert.equal(await page.locator('.tabs a[href="conta.html"]').count(), 1);
  await page.fill('#heroQ', 'resson');
  await page.waitForSelector('#heroSug .sug');
  assert.ok(!/R\$|clínicas ·/.test(await page.textContent('#heroSug')), 'sugestão sem preço nem contagem inventada');
  await Promise.all([page.waitForURL(/perto\.html\?exame=rm/), page.press('#heroQ', 'Enter')]);
  if (SHOTS) {
    await page.goto(BASE);
    await scrollAll(page);
    await page.waitForSelector('#realList li b');
    await page.screenshot({ path: join(SHOTS, 'inicio-desktop-inteira.png'), fullPage: true });
  }
  assert.deepEqual(errors.filter((e) => !/perto/.test(e)), []);
  await context.close();
});

await scenario('links antigos: #exame-rm vai para a busca e #perto abre perto de mim', async () => {
  const { page, context } = await newPage(browser);
  await page.goto(`${BASE}#exame-rm`);
  await page.waitForURL(/perto\.html\?exame=rm/);
  await page.goto(`${BASE}#perto`);
  await page.waitForURL(/perto\.html/);
  await context.close();
});

await scenario('guias de exames: sem preço nem clínica fictícia, com link para a busca', async () => {
  const { page, errors, context } = await newPage(browser);
  for (const [slug, code] of [['raio-x', 'rx'], ['ressonancia-magnetica', 'rm'], ['ecocardiograma', 'eco']]) {
    await page.goto(`${BASE}exames/${slug}.html`);
    const text = await page.evaluate(() => document.body.innerText);
    assert.ok(!/R\$|★|Pix|exemplo/.test(text), `${slug}: sem preço, nota ou exemplo`);
    assert.ok(await page.locator(`a[href="../perto.html?exame=${code}"]`).count() >= 2, `${slug}: botão para a busca`);
    assert.ok(await page.locator('a[href="../cidades/"]').count() >= 1, `${slug}: ver por cidade`);
    assert.ok(await page.locator('#preparo').count() === 1, `${slug}: preparo mantido`);
  }
  await page.goto(`${BASE}exames/`);
  assert.ok(!/R\$/.test(await page.evaluate(() => document.body.innerText)));
  if (SHOTS) { await page.goto(`${BASE}exames/raio-x.html`); await page.screenshot({ path: join(SHOTS, 'guia-raio-x.png'), fullPage: true }); }
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
