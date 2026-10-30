// Teste de ponta a ponta da página "Clínicas perto de você" num navegador de verdade (Playwright),
// com localização simulada e respostas simuladas do servidor, do banco e do OpenStreetMap.
// Rodar com: node tests/e2e-perto.mjs   (precisa do pacote "playwright" instalado)
// Opcional: SHOTS=pasta node tests/e2e-perto.mjs  salva capturas de tela nessa pasta.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const FN = 'https://pyoqiecupxhdzigjudyd.supabase.co/functions/v1/clinicas-proximas';
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
await new Promise((r) => server.listen(8765, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:8765/';

// Três clínicas IMED de demonstração (sem preço e sem horário) e estabelecimentos do OpenStreetMap.
const IMED_ROWS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'DiagnoCenter Paulista', kind: 'imagem', description: null, address_line: 'Endereço de demonstração · Bela Vista', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: null, lat: -23.5614, lng: -46.6559, distance_m: 563, phone: null, whatsapp: null, email: null, website: null, specialties: ['Radiologia'], opening_hours: null, accepts_online_booking: true, is_demo: true, exams: [{ code: 'rm', price_cents: null }, { code: 'rx', price_cents: null }, { code: 'tc', price_cents: null }] },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Ecocor Cardiologia', kind: 'clinica', description: null, address_line: 'Endereço de demonstração · Jardins', neighborhood: 'Jardins', city: 'São Paulo', state: 'SP', cep: null, lat: -23.57, lng: -46.662, distance_m: 1161, phone: null, whatsapp: null, email: null, website: null, specialties: ['Cardiologia'], opening_hours: null, accepts_online_booking: true, is_demo: true, exams: [{ code: 'ecg', price_cents: null }, { code: 'eco', price_cents: null }] },
];
const OSM = { elements: [
  { type: 'node', id: 101, lat: -23.5617, lon: -46.6561, tags: { name: 'DiagnoCenter Paulista', healthcare: 'radiology' } },
  { type: 'node', id: 102, lat: -23.5590, lon: -46.6600, tags: { name: 'Laboratório Vida', healthcare: 'laboratory', phone: '+55 11 3333-4444', opening_hours: 'Mo-Fr 06:00-18:00', 'addr:street': 'Rua Augusta', 'addr:housenumber': '900' } },
  { type: 'way', id: 103, center: { lat: -23.5700, lon: -46.6450 }, tags: { name: 'Hospital Central', amenity: 'hospital', website: 'hospitalcentral.com.br' } },
  { type: 'node', id: 104, lat: -23.5620, lon: -46.6530, tags: { name: 'Clínica Odontológica Sorriso', amenity: 'clinic' } },
  { type: 'node', id: 105, lat: -23.5660, lon: -46.6580, tags: { name: 'Centro de Ressonância e Tomografia Paulista', healthcare: 'clinic', 'contact:whatsapp': '(11) 98888-7777' } },
] };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*' } });

// Estabelecimentos reais do CNES, como vêm da função nearby_establishments.
const CNES_ROWS = [
  { cnes: '2077485', name: 'Hospital Santa Exemplo', kind: 'hospital', cnes_type: 5, address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César', cep: '01409001', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5598, lng: -46.6602, distance_m: 420, location_source: 'cnes', phone: '(11) 3141-1000', shift: null, open_24h: true, sus: false, services: ['rm', 'tc', 'rx'], specialties: ['Cardiologia'], cnes_updated_at: '2026-09-15' },
  { cnes: '6543210', name: 'Laboratório Análise Paulista', kind: 'laboratorio', cnes_type: 39, address_line: 'Alameda Santos, 200', neighborhood: 'Bela Vista', cep: '01418000', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5655, lng: -46.6520, distance_m: 640, location_source: 'endereco', phone: '(11) 3000-2000', shift: 'Manhã e tarde', open_24h: false, sus: true, services: ['lab'], specialties: [], cnes_updated_at: '2026-08-02' },
];

async function newPage(browser, { geo = true, mobile = false, fn, rpc, overpass, insert, cnesRpc } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 860 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block',
    ...(geo ? { geolocation: { latitude: -23.561234, longitude: -46.656789, accuracy: 30 }, permissions: ['geolocation'] } : {}),
  });
  const log = { fn: [], overpass: [], rpc: [], insert: [], cnes: [] };
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await context.route(FN, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const body = JSON.parse(route.request().postData() || '{}');
    log.fn.push(body);
    return (fn ?? defaultFn)(route, body);
  });
  await context.route('https://overpass-api.de/**', async (route) => { log.overpass.push(route.request().postData()); return (overpass ?? ((r) => json(r, OSM)))(route); });
  await context.route('https://overpass.kumi.systems/**', async (route) => { log.overpass.push(route.request().postData()); return (overpass ?? ((r) => json(r, OSM)))(route); });
  await context.route(`${REST}rpc/nearby_clinics`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    log.rpc.push(JSON.parse(route.request().postData() || '{}'));
    return (rpc ?? ((r) => json(r, IMED_ROWS)))(route);
  });
  await context.route(`${REST}rpc/nearby_establishments`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    log.cnes.push(JSON.parse(route.request().postData() || '{}'));
    return (cnesRpc ?? ((r) => json(r, [])))(route);
  });
  await context.route(`${REST}appointment_requests`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    log.insert.push({ body: JSON.parse(route.request().postData()), headers: route.request().headers() });
    return (insert ?? ((r) => r.fulfill({ status: 201, body: '', headers: { 'Access-Control-Allow-Origin': '*' } })))(route);
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, log, errors };
}

function defaultFn(route, body) {
  if (body.action === 'search') return json(route, { ok: true, provider: 'osm', radius_m: body.radius_m, warnings: [], imed: body.include_demo ? IMED_ROWS : [], places: [] });
  if (body.action === 'geocode') {
    if (/99999/.test(body.q)) return json(route, { ok: false, error: 'not_found' }, 404);
    return json(route, { ok: true, lat: -23.5617698, lng: -46.6553299, label: 'Avenida Paulista, Bela Vista, São Paulo - SP', precision: 'cep', provider: 'osm' });
  }
  return json(route, { ok: true, provider: 'osm' });
}

const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(450); await page.screenshot({ path: join(SHOTS, `${name}.png`) }); } };
const results = [];
async function scenario(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 4).join('\n  ')}`); }
}

const browser = await chromium.launch();

await scenario('localização permitida: parceiros IMED do banco + mapa, sem guardar coordenadas', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.waitForSelector('.pc');
  await page.waitForFunction(() => !document.querySelector('.pt-more'));
  assert.equal(new URL(page.url()).search, '?demo=1', 'o parâmetro usar=localizacao sai da URL');
  const search = log.fn.find((b) => b.action === 'search');
  assert.deepEqual([search.lat, search.lng], [-23.561, -46.657], 'manda só coordenadas arredondadas (~110 m)');
  assert.equal(search.include_demo, true);
  assert.equal(log.overpass.length, 1);
  assert.ok(!log.overpass[0].includes('-23.561234'), 'o OpenStreetMap não recebe a posição precisa');
  const names = await page.$$eval('.pc h3', (els) => els.map((e) => e.textContent));
  assert.ok(names.includes('DiagnoCenter Paulista') && names.includes('Laboratório Vida') && names.includes('Hospital Central'));
  assert.equal(names.filter((n) => n === 'DiagnoCenter Paulista').length, 1, 'não repete parceiro que também está no mapa');
  assert.ok(!names.some((n) => /Odonto/.test(n)), 'dentistas ficam de fora');
  const dists = await page.$$eval('.pc .pc-dist', (els) => els.map((e) => e.textContent));
  assert.match(dists[0], /m$/);
  assert.match(await page.textContent('#count'), /resultados em até 5 km da sua localização/);
  assert.equal(await page.locator('.leaflet-marker-icon .mk').count(), names.length, 'um marcador por resultado');
  assert.match(await page.locator('.pc.imed').first().textContent(), /Preço sob consulta/, 'sem preço inventado');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  assert.ok(!/-23\.56|-46\.65/.test(stored), 'nenhuma coordenada guardada no aparelho');
  await shot(page, '01-resultados-desktop');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('filtros de exame, tipo, especialidade, distância e preço', async () => {
  const { page, log, context } = await newPage(browser);
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.waitForSelector('.pc');
  await page.waitForFunction(() => !document.querySelector('.pt-more'));
  const names = () => page.$$eval('.pc h3', (els) => els.map((e) => e.textContent));
  await page.selectOption('#fExam', 'rm');
  assert.deepEqual((await names()).sort(), ['Centro de Ressonância e Tomografia Paulista', 'DiagnoCenter Paulista']);
  await page.selectOption('#fExam', '');
  await page.selectOption('#fKind', 'laboratorio');
  assert.deepEqual(await names(), ['Laboratório Vida']);
  await page.selectOption('#fKind', '');
  await page.selectOption('#fSpec', 'Cardiologia');
  assert.deepEqual(await names(), ['Ecocor Cardiologia']);
  await page.click('#fClear');
  await page.click('#fImed');
  assert.deepEqual((await names()).sort(), ['DiagnoCenter Paulista', 'Ecocor Cardiologia']);
  await page.click('#fImed');
  await page.selectOption('#fPrice', 'ate100');
  await page.waitForSelector('.st h2');
  assert.match(await page.textContent('.st'), /Nada com esses filtros.*Nenhum valor é estimado/s);
  await page.click('[data-act="clear"]');
  await page.selectOption('#fDist', '1000');
  assert.ok((await names()).length < 5, 'raio menor filtra sem nova busca');
  const before = log.fn.length;
  await page.selectOption('#fDist', '10000');
  await page.waitForFunction((n) => document.querySelectorAll('.pc').length > 0 && !document.querySelector('.pt-more'), before);
  assert.equal(log.fn.length, before + 1, 'raio maior busca de novo');
  assert.equal(log.fn.at(-1).radius_m, 10000);
  await context.close();
});

await scenario('detalhes e pedido de agendamento gravado no banco', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.click('.pc.imed >> nth=0');
  await page.waitForSelector('.sh-ov.open');
  const sheet = await page.textContent('#sheet');
  assert.match(sheet, /Preço sob consulta/);
  assert.match(sheet, /Horário não informado/);
  assert.match(sheet, /Clínica de demonstração/);
  await shot(page, '02-detalhes');
  await page.click('[data-book]');
  await page.waitForSelector('#bookForm');
  await page.click('#bkBtn');
  assert.ok(await page.locator('[data-f="exam"].bad').count(), 'exige o exame');
  assert.ok(await page.locator('[data-f="consent"].bad').count(), 'exige o consentimento');
  assert.equal(log.insert.length, 0);
  await page.selectOption('#bkExam', 'rm');
  const date = await page.$eval('#bkDate', (el) => el.min);
  await page.fill('#bkDate', date);
  await page.check('input[name="periodo"][value="manha"]', { force: true });
  await page.fill('#bkName', 'Ana Teste');
  await page.type('#bkPhone', '11987654321');
  assert.equal(await page.inputValue('#bkPhone'), '(11) 98765-4321');
  await page.check('input[name="consent"]');
  await shot(page, '03-formulario');
  await page.click('#bkBtn');
  await page.waitForSelector('.ok h3');
  assert.equal(log.insert.length, 1);
  const row = log.insert[0].body;
  assert.equal(row.clinic_id, IMED_ROWS[0].id);
  assert.equal(row.place_source, 'imed');
  assert.equal(row.exam_code, 'rm');
  assert.equal(row.preferred_period, 'manha');
  assert.equal(row.patient_phone, '11987654321');
  assert.equal(row.consent, true);
  assert.ok(!('status' in row) && !('lat' in row) && !('lng' in row), 'sem status e sem localização do paciente');
  assert.match(log.insert[0].headers.prefer, /return=minimal/);
  assert.match(await page.textContent('.ok .code'), /^IMED-[0-9A-F]{8}$/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(saved[0].type, 'pedido');
  assert.equal(saved[0].status, 'pendente');
  await shot(page, '04-pedido-enviado');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('estabelecimento do mapa: pedido ao IMED (concierge) com contato do local', async () => {
  const { page, log, context } = await newPage(browser);
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.click('.pc:has-text("Laboratório Vida")');
  const sheet = await page.textContent('#sheet');
  assert.match(sheet, /seg–sex 06:00–18:00/);
  assert.match(sheet, /Fonte: OpenStreetMap/);
  assert.equal(await page.getAttribute('.dt-acts a[href^="tel:"]', 'href'), 'tel:+551133334444');
  await page.click('[data-book]');
  await page.selectOption('#bkExam', 'lab');
  await page.fill('#bkDate', await page.$eval('#bkDate', (el) => el.min));
  await page.fill('#bkName', 'Carlos Teste');
  await page.fill('#bkPhone', '1133334444');
  await page.check('input[name="consent"]');
  await page.click('#bkBtn');
  await page.waitForSelector('.ok h3');
  const row = log.insert[0].body;
  assert.equal(row.clinic_id, null);
  assert.equal(row.place_source, 'osm');
  assert.equal(row.place_ref, 'osm:n102');
  assert.equal(row.place_phone, '+55 11 3333-4444');
  await context.close();
});

await scenario('falha ao enviar o pedido mostra erro e permite tentar de novo', async () => {
  const { page, context } = await newPage(browser, { insert: (r) => r.fulfill({ status: 503, body: '', headers: { 'Access-Control-Allow-Origin': '*' } }) });
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.click('.pc.imed >> nth=0');
  await page.click('[data-book]');
  await page.selectOption('#bkExam', 'rx');
  await page.fill('#bkDate', await page.$eval('#bkDate', (el) => el.min));
  await page.fill('#bkName', 'Ana Teste');
  await page.fill('#bkPhone', '11987654321');
  await page.check('input[name="consent"]');
  await page.click('#bkBtn');
  await page.waitForSelector('.bk-err.show');
  assert.match(await page.textContent('.bk-err'), /Não foi possível enviar agora/);
  assert.match(await page.textContent('#bkBtn'), /Tentar de novo/);
  await context.close();
});

await scenario('localização negada: explica e permite buscar por CEP', async () => {
  const { page, log, context } = await newPage(browser, { geo: false });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('.st h2:has-text("não liberou")');
  await shot(page, '05-localizacao-negada');
  await page.fill('#q', '01310-100');
  await page.press('#q', 'Enter');
  await page.waitForSelector('.pc');
  assert.equal(log.fn[0].action, 'geocode');
  assert.equal(log.fn[0].q, '01310-100');
  assert.deepEqual([log.fn[1].lat, log.fn[1].lng], [-23.562, -46.655], 'endereço também é arredondado');
  assert.match(await page.textContent('#count'), /Avenida Paulista, Bela Vista/);
  await page.fill('#q', '99999-999');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#qMsg:not([hidden])');
  assert.match(await page.textContent('#qMsg'), /Não encontramos esse endereço/);
  await page.fill('#q', '0131');
  await page.press('#q', 'Enter');
  assert.match(await page.textContent('#qMsg'), /O CEP tem 8 números/);
  await context.close();
});

await scenario('sem pedir permissão ao abrir a página direto', async () => {
  const { page, context } = await newPage(browser, { geo: false });
  await page.goto(`${BASE}perto.html`);
  await page.waitForSelector('.st h2:has-text("Veja o que tem perto de você")');
  assert.match(await page.textContent('.st'), /cerca de 100 metros/);
  await shot(page, '06-inicio');
  await context.close();
});

await scenario('servidor fora do ar: usa o banco direto e o mapa continua', async () => {
  const { page, log, context } = await newPage(browser, { fn: (r) => json(r, { ok: false, error: 'internal' }, 500) });
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.waitForSelector('.pc.imed');
  await page.waitForFunction(() => !document.querySelector('.pt-more'));
  assert.equal(log.rpc.length, 1);
  assert.equal(log.rpc[0].p_include_demo, true);
  assert.equal(log.rpc[0].p_lat, -23.561);
  assert.ok(await page.locator('.pc:not(.imed)').count() > 0, 'estabelecimentos do mapa também aparecem');
  await context.close();
});

await scenario('mapa fora do ar: aviso e só parceiros IMED', async () => {
  const { page, context } = await newPage(browser, { overpass: (r) => r.fulfill({ status: 504, body: 'erro' }) });
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.waitForSelector('.bn.warn');
  assert.match(await page.textContent('#banners'), /não carregaram agora/);
  assert.equal(await page.locator('.pc').count(), 2);
  await context.close();
});

await scenario('tudo fora do ar: estado de erro com "Tentar de novo"', async () => {
  let fail = true;
  const { page, context } = await newPage(browser, {
    fn: (r, b) => (fail ? json(r, { ok: false, error: 'unavailable' }, 502) : defaultFn(r, b)),
    rpc: (r) => (fail ? r.fulfill({ status: 503, body: '' }) : json(r, IMED_ROWS)),
    overpass: (r) => (fail ? r.fulfill({ status: 504, body: '' }) : json(r, OSM)),
    cnesRpc: (r) => (fail ? r.fulfill({ status: 503, body: '' }) : json(r, [])),
  });
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.waitForSelector('.st h2:has-text("Não foi possível buscar agora")');
  await shot(page, '07-erro');
  fail = false;
  await page.click('[data-act="retry"]');
  await page.waitForSelector('.pc');
  await context.close();
});

await scenario('com Google Places no servidor, o site não chama o OpenStreetMap', async () => {
  const google = [{ id: 'google:abc', source: 'google', name: 'Lumen Diagnóstico por Imagem', types: ['doctor'], hint: 'imagem', address: 'Rua X, 10 - São Paulo', lat: -23.562, lng: -46.657, distance_m: 100, phone: '(11) 2222-3333', website: 'https://lumen.example', maps_url: 'https://maps.google.com/?cid=1', hours: ['segunda-feira: 07:00–19:00'] }];
  const { page, log, context } = await newPage(browser, { fn: (r, b) => (b.action === 'search' ? json(r, { ok: true, provider: 'google', radius_m: 5000, warnings: [], imed: [], places: google }) : defaultFn(r, b)) });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('.pc');
  assert.equal(log.overpass.length, 0);
  assert.match(await page.textContent('.pc'), /Google Maps/);
  await page.click('.pc');
  assert.match(await page.textContent('#sheet'), /Fonte: Google Maps/);
  await context.close();
});

await scenario('celular: lista, mapa em tela cheia e detalhes pelo marcador', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true });
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.waitForSelector('.pc');
  await page.waitForFunction(() => !document.querySelector('.pt-more'));
  await shot(page, '08-celular-lista');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `sem rolagem lateral (${overflow}px)`);
  await page.click('#viewToggle');
  await page.waitForTimeout(400);
  assert.ok(await page.isVisible('#map'));
  await shot(page, '09-celular-mapa');
  await page.click('.leaflet-marker-icon .mk-imed >> nth=0', { force: true });
  await page.waitForSelector('.sh-ov.open');
  await shot(page, '10-celular-detalhes');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('página inicial: botão "Encontrar clínicas perto de mim" e menus levam à busca', async () => {
  const { page, errors, context } = await newPage(browser, { geo: false });
  await page.goto(BASE);
  const cta = page.locator('#nearCta');
  assert.ok(await cta.isVisible(), 'botão em destaque no topo');
  assert.match(await cta.textContent(), /Encontrar clínicas perto de mim/);
  assert.equal(await cta.getAttribute('href'), 'perto.html?usar=localizacao');
  assert.equal(await page.locator('.tabs a[href="perto.html"]').count(), 1);
  assert.equal(await page.locator('#realbar a[href="perto.html?usar=localizacao"]').count(), 1);
  assert.equal(await page.locator('.f-grid a[href="perto.html"]').count(), 1);
  await shot(page, '11-inicio-desktop');
  await page.goto(`${BASE}#perto`);
  await page.waitForURL(/perto\.html/);
  await page.waitForSelector('.st h2');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('página inicial no celular: menu com "Perto de mim" e pedido em "Agendados"', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, geo: false });
  await context.addInitScript(() => {
    if (!localStorage.getItem('imed_appts')) {
      localStorage.setItem('imed_appts', JSON.stringify([{ code: 'IMED-3F2A9C1E', type: 'pedido', status: 'pendente', name: 'Laboratório Vida', ini: '', c: '#6C4BD8', img: null, items: ['Exames de laboratório'], date: 'segunda-feira, 03 de novembro', time: 'manhã', total: null }]));
    }
  });
  await page.goto(BASE);
  const items = await page.$$eval('.bnav > *', (els) => els.map((e) => [e.textContent.trim(), e.getBoundingClientRect().height]));
  assert.deepEqual(items.map((i) => i[0]), ['Início', 'Busca', 'Perto de mim', 'Agendados', 'Perfil']);
  assert.ok(items.every((i) => i[1] < 60), 'rótulos numa linha só');
  await shot(page, '12-inicio-celular');
  await page.click('.bnav [data-go="agenda"]');
  await page.waitForSelector('.appt');
  const appt = await page.textContent('.appt');
  assert.match(appt, /Aguardando confirmação/);
  assert.match(appt, /Protocolo IMED-3F2A9C1E/);
  assert.ok(!/R\$/.test(appt), 'pedido sem preço inventado');
  await shot(page, '13-agendados');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('clínicas reais do CNES: sem OpenStreetMap, selo oficial, ficha e pedido', async () => {
  const { page, log, errors, context } = await newPage(browser, { fn: (r, b) => (b.action === 'search'
    ? json(r, { ok: true, provider: 'osm', radius_m: 5000, warnings: [], imed: [], cnes: CNES_ROWS, places: [], coverage: { status: 'done', city: 'São Paulo', uf: 'SP' } })
    : defaultFn(r, b)) });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('.pc');
  await page.waitForFunction(() => !document.querySelector('.pt-more'));
  assert.equal(log.overpass.length, 0, 'com a cidade coberta pelo CNES, não precisa do OpenStreetMap');
  const names = await page.$$eval('.pc h3', (els) => els.map((e) => e.textContent));
  assert.deepEqual(names, ['Hospital Santa Exemplo', 'Laboratório Análise Paulista']);
  assert.match(await page.textContent('.pc >> nth=0'), /Cadastro oficial/);
  assert.match(await page.textContent('.pc >> nth=0'), /24 horas/);
  assert.match(await page.textContent('.pc >> nth=1'), /Atende SUS/);
  assert.match(await page.textContent('.pc >> nth=1 >> .pc-dist'), /^~/, 'distância aproximada quando o local veio do endereço');
  assert.equal(await page.locator('.leaflet-marker-icon .mk').count(), 2);
  await shot(page, '14-cnes-resultados');
  await page.click('.pc >> nth=0');
  await page.waitForSelector('.sh-ov.open');
  const sheet = await page.textContent('#sheet');
  assert.match(sheet, /Aberto 24 horas/);
  assert.match(sheet, /CNES/);
  assert.equal(await page.getAttribute('#sheet a[href*="cnes.datasus.gov.br"]', 'href'), 'https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/3550302077485');
  assert.ok(!/R\$/.test(sheet), 'sem preço inventado');
  await shot(page, '15-cnes-detalhes');
  await page.click('[data-book]');
  await page.selectOption('#bkExam', 'rm');
  await page.fill('#bkDate', await page.$eval('#bkDate', (el) => el.min));
  await page.fill('#bkName', 'Bia Teste');
  await page.fill('#bkPhone', '11987654321');
  await page.check('input[name="consent"]');
  await page.click('#bkBtn');
  await page.waitForSelector('.ok h3');
  const row = log.insert[0].body;
  assert.equal(row.clinic_id, null);
  assert.equal(row.place_source, 'cnes');
  assert.equal(row.place_ref, 'cnes:2077485');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('cidade ainda sendo importada: aviso, mapa provisório e atualização sozinha', async () => {
  let calls = 0;
  const { page, log, context } = await newPage(browser, { fn: (r, b) => {
    if (b.action !== 'search') return defaultFn(r, b);
    calls += 1;
    return calls === 1
      ? json(r, { ok: true, provider: 'osm', radius_m: 5000, warnings: [], imed: [], cnes: [], places: [], coverage: { status: 'loading', city: 'Campinas', uf: 'SP' } })
      : json(r, { ok: true, provider: 'osm', radius_m: 5000, warnings: [], imed: [], cnes: CNES_ROWS, places: [], coverage: { status: 'done', city: 'Campinas', uf: 'SP' } });
  } });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('.bn .spin');
  assert.match(await page.textContent('#banners'), /Campinas/);
  assert.equal(log.overpass.length, 1, 'enquanto importa, mostra o OpenStreetMap');
  await page.waitForSelector('.pc:has-text("Hospital Santa Exemplo")', { timeout: 15000 });
  assert.equal(calls, 2);
  assert.equal(await page.locator('.bn .spin').count(), 0);
  await context.close();
});

await scenario('página inicial: mapa com as clínicas reais perto', async () => {
  const { page, log, errors, context } = await newPage(browser, { geo: false, cnesRpc: (r) => json(r, CNES_ROWS) });
  await page.goto(BASE);
  await page.locator('#reais').scrollIntoViewIfNeeded();
  await page.waitForSelector('#realList li');
  assert.equal(log.cnes.length, 1);
  const args = log.cnes[0];
  assert.equal(args.p_radius_m, 2000);
  assert.ok(String(args.p_lat).split('.')[1].length <= 3, 'coordenada arredondada');
  const list = await page.$$eval('#realList li b', (els) => els.map((e) => e.textContent));
  assert.deepEqual(list, ['Hospital Santa Exemplo', 'Laboratório Análise Paulista']);
  assert.equal(await page.locator('#realMap .leaflet-interactive').count(), 3, 'um ponto por estabelecimento + o ponto de origem');
  assert.match(await page.textContent('#realStats'), /1\s*Hospitais/);
  await shot(page, '16-inicio-clinicas-reais');
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
