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
import { createHash } from 'node:crypto';

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
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'DiagnoCenter Paulista', kind: 'imagem', description: null, address_line: 'Endereço de demonstração · Bela Vista', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: null, lat: -23.5614, lng: -46.6559, distance_m: 563, phone: null, whatsapp: null, email: null, website: null, specialties: ['Radiologia'], opening_hours: null, accepts_online_booking: true, is_demo: true, exams: [{ code: 'rm', price_cents: null }, { code: 'rx', price_cents: null }, { code: 'tc', price_cents: null }], insurances: [], cnes: null },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Ecocor Cardiologia', kind: 'clinica', description: null, address_line: 'Endereço de demonstração · Jardins', neighborhood: 'Jardins', city: 'São Paulo', state: 'SP', cep: null, lat: -23.57, lng: -46.662, distance_m: 1161, phone: null, whatsapp: null, email: null, website: null, specialties: ['Cardiologia'], opening_hours: null, accepts_online_booking: true, is_demo: true, exams: [{ code: 'ecg', price_cents: null }, { code: 'eco', price_cents: null }], insurances: [], cnes: null },
];
const OSM = { elements: [
  { type: 'node', id: 101, lat: -23.5617, lon: -46.6561, tags: { name: 'DiagnoCenter Paulista', healthcare: 'radiology' } },
  { type: 'node', id: 102, lat: -23.5590, lon: -46.6600, tags: { name: 'Laboratório Vida', healthcare: 'laboratory', phone: '+55 11 3333-4444', opening_hours: 'Mo-Fr 06:00-18:00', 'addr:street': 'Rua Augusta', 'addr:housenumber': '900' } },
  { type: 'way', id: 103, center: { lat: -23.5700, lon: -46.6450 }, tags: { name: 'Hospital Central', amenity: 'hospital', website: 'hospitalcentral.com.br' } },
  { type: 'node', id: 104, lat: -23.5620, lon: -46.6530, tags: { name: 'Clínica Odontológica Sorriso', amenity: 'clinic' } },
  { type: 'node', id: 105, lat: -23.5660, lon: -46.6580, tags: { name: 'Centro de Ressonância e Tomografia Paulista', healthcare: 'clinic', 'contact:whatsapp': '(11) 98888-7777' } },
] };

// Parceiros verificados (não são demonstração), com preços e convênios informados pela clínica.
const PARTNER_ROWS = [
  { id: 'bbbbbbbb-0000-4000-8000-000000000011', name: 'Imagem Paulista Verificada', kind: 'imagem', description: 'Centro de imagem.', address_line: 'Av. Paulista, 1500', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: '01310-200', lat: -23.5625, lng: -46.6565, distance_m: 300, phone: '(11) 3222-1000', whatsapp: null, email: null, website: null, specialties: ['Radiologia'], opening_hours: { seg: '07:00–19:00' }, accepts_online_booking: true, is_demo: false, exams: [{ code: 'rm', price_cents: 45000 }, { code: 'tc', price_cents: 30000 }, { code: 'rx', price_cents: null }], insurances: ['Bradesco Saúde', 'SulAmérica'], cnes: '7654321' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000012', name: 'Clínica Jardins Verificada', kind: 'clinica', description: null, address_line: 'Rua Oscar Freire, 100', neighborhood: 'Jardins', city: 'São Paulo', state: 'SP', cep: null, lat: -23.5672, lng: -46.6650, distance_m: 1100, phone: null, whatsapp: null, email: null, website: null, specialties: ['Cardiologia'], opening_hours: null, accepts_online_booking: true, is_demo: false, exams: [{ code: 'rm', price_cents: 89990 }, { code: 'ecg', price_cents: null }], insurances: ['Amil'], cnes: null },
];
const RATINGS = { 'cnes:2077485': { rating: 4.6, reviews: 12 }, 'imed:bbbbbbbb-0000-4000-8000-000000000011': { rating: 4, reviews: 3 } };
const REVIEWS = { 'cnes:2077485': [
  { rating: 5, comment: '<b>Ótimo</b> atendimento, rápido.', author_name: 'Maria', created_at: '2026-10-20T13:00:00Z' },
  { rating: 4, comment: null, author_name: 'João', created_at: '2026-10-02T13:00:00Z' },
] };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*' } });

// Estabelecimentos reais do CNES, como vêm da função nearby_establishments.
const CNES_ROWS = [
  { cnes: '2077485', name: 'Hospital Santa Exemplo', kind: 'hospital', cnes_type: 5, address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César', cep: '01409001', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5598, lng: -46.6602, distance_m: 420, location_source: 'cnes', phone: '(11) 3141-1000', shift: null, open_24h: true, sus: false, services: ['rm', 'tc', 'rx'], specialties: ['Cardiologia'], cnes_updated_at: '2026-09-15' },
  { cnes: '6543210', name: 'Laboratório Análise Paulista', kind: 'laboratorio', cnes_type: 39, address_line: 'Alameda Santos, 200', neighborhood: 'Bela Vista', cep: '01418000', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5655, lng: -46.6520, distance_m: 640, location_source: 'endereco', phone: '(11) 3000-2000', shift: 'Manhã e tarde', open_24h: false, sus: true, services: ['lab'], specialties: [], cnes_updated_at: '2026-08-02' },
];

async function newPage(browser, { geo = true, mobile = false, fn, rpc, overpass, insert, cnesRpc, ratings, reviews } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 860 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block',
    ...(geo ? { geolocation: { latitude: -23.561234, longitude: -46.656789, accuracy: 30 }, permissions: ['geolocation'] } : {}),
  });
  const log = { fn: [], overpass: [], rpc: [], insert: [], cnes: [], ratings: [], reviews: [] };
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
  await context.route(`${REST}rpc/place_ratings`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const body = JSON.parse(route.request().postData() || '{}');
    log.ratings.push(body);
    if (ratings) return ratings(route, body);
    return json(route, body.p_keys.filter((k) => RATINGS[k]).map((k) => ({ place_key: k, ...RATINGS[k] })));
  });
  await context.route(`${REST}rpc/place_reviews`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const body = JSON.parse(route.request().postData() || '{}');
    log.reviews.push(body);
    if (reviews) return reviews(route, body);
    return json(route, (REVIEWS[body.p_key] ?? []).slice(0, body.p_limit));
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

// Busca com parceiros verificados e estabelecimentos do CNES (cidade já no banco).
const fullFn = (r, b) => (b.action === 'search'
  ? json(r, { ok: true, provider: 'osm', radius_m: b.radius_m, warnings: [], imed: PARTNER_ROWS, cnes: CNES_ROWS, places: [], coverage: { status: 'done', city: 'São Paulo', uf: 'SP' } })
  : defaultFn(r, b));
const names = (page) => page.$$eval('.pc h3', (els) => els.map((e) => e.textContent));
const ready = async (page) => { await page.waitForSelector('.pc'); await page.waitForFunction(() => !document.querySelector('.pt-more')); };
const fillBooking = async (page, exam = 'rm') => {
  await page.selectOption('#bkExam', exam);
  await page.fill('#bkDate', await page.$eval('#bkDate', (el) => el.min));
  await page.check('input[name="periodo"][value="manha"]', { force: true });
  await page.fill('#bkName', 'Ana Teste');
  await page.fill('#bkPhone', '11987654321');
  await page.check('input[name="consent"]');
};
const WA_CONFIG = () => {
  let cfg;
  Object.defineProperty(window, 'IMED_CONFIG', { configurable: true, get: () => cfg, set: (v) => { cfg = { ...v, whatsapp: '+55 (11) 99999-8888' }; } });
};

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
  assert.match(row.review_token_hash, /^[0-9a-f]{64}$/, 'manda só o resumo (SHA-256) do código do pedido');
  assert.equal(log.insert[0].headers.authorization, `Bearer ${(await page.evaluate(() => window.IMED_CONFIG.supabaseAnonKey))}`, 'sem conta, usa a chave pública');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(saved[0].type, 'pedido');
  assert.equal(saved[0].status, 'pendente');
  assert.equal(saved[0].id, row.id);
  assert.match(saved[0].token, /^[0-9a-f]{64}$/);
  assert.equal(createHash('sha256').update(saved[0].token).digest('hex'), row.review_token_hash, 'o código guardado bate com o resumo enviado');
  assert.equal(saved[0].code, await page.textContent('.ok .code'));
  assert.equal(saved[0].place_key, `imed:${IMED_ROWS[0].id}`);
  assert.equal(saved[0].name, 'DiagnoCenter Paulista');
  assert.equal(saved[0].exam, 'rm');
  assert.deepEqual(saved[0].items, ['Ressonância']);
  assert.equal(saved[0].date, date);
  assert.equal(saved[0].period, 'manha');
  assert.ok(!Number.isNaN(Date.parse(saved[0].created)));
  assert.ok(!JSON.stringify(saved).includes(row.review_token_hash), 'o resumo não precisa ficar no aparelho');
  assert.ok(await page.isVisible('.ok a[href="conta.html"]'), 'oferece criar conta para acompanhar');
  assert.ok(await page.isVisible('.ok a[href="./#agenda"]'));
  await shot(page, '04-pedido-enviado');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-ics]')]);
  assert.match(download.suggestedFilename(), /^imed-[0-9a-f]{8}\.ics$/);
  const ics = (await readFile(await download.path(), 'utf8'));
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.trimEnd().endsWith('END:VCALENDAR'));
  assert.match(unfolded, new RegExp(`DTSTART;TZID=America/Sao_Paulo:${date.replace(/-/g, '')}T080000`));
  assert.match(unfolded, /SUMMARY:Exame: Ressonância — DiagnoCenter Paulista/);
  assert.match(unfolded, /DESCRIPTION:.*Retire objetos de metal.*Confirme o horário com o IMED.*exames\/ressonancia-magnetica\.html#preparo/);
  assert.match(unfolded, /BEGIN:VALARM\r\n.*TRIGGER:-P1D/s);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pedido com conta: grava pelo login e não oferece criar conta', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await context.addInitScript(() => localStorage.setItem('imed_session', JSON.stringify({ access_token: 'tok-paciente', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'ana@exemplo.com' } })));
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.click('.pc.imed >> nth=0');
  await page.click('[data-book]');
  await fillBooking(page);
  await page.click('#bkBtn');
  await page.waitForSelector('.ok h3');
  assert.equal(log.insert.length, 1);
  assert.equal(log.insert[0].headers.authorization, 'Bearer tok-paciente');
  assert.match(log.insert[0].body.review_token_hash, /^[0-9a-f]{64}$/);
  assert.equal(await page.locator('.ok a[href="conta.html"]').count(), 0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(saved[0].id, log.insert[0].body.id);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('sessão vencida que não renova: pedido vai sem conta e oferece criar conta', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await context.addInitScript(() => localStorage.setItem('imed_session', JSON.stringify({ access_token: 'tok-velho', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) - 3600, user: { id: 'u1', email: 'ana@exemplo.com' } })));
  await context.route('**/auth/v1/token**', (r) => (r.request().method() === 'OPTIONS'
    ? r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
    : r.fulfill({ status: 400, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"invalid_grant"}' })));
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.click('.pc.imed >> nth=0');
  await page.click('[data-book]');
  await fillBooking(page, 'consulta');
  await page.click('#bkBtn');
  await page.waitForSelector('.ok h3');
  assert.equal(log.insert.length, 1);
  assert.notEqual(log.insert[0].headers.authorization, 'Bearer tok-velho', 'não usa o token vencido');
  assert.equal(await page.locator('.ok a[href="conta.html"]').count(), 1, 'oferece criar conta');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(saved[0].exam, 'consulta', 'guarda o código da consulta para o preparo nas outras páginas');
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


await scenario('selos: parceiro verificado, cadastro oficial, demonstração e legenda', async () => {
  const { page, errors, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  assert.deepEqual(await names(page), ['Imagem Paulista Verificada', 'Hospital Santa Exemplo', 'Laboratório Análise Paulista', 'Clínica Jardins Verificada']);
  const card = (n) => page.textContent(`.pc:has-text("${n}")`);
  assert.match(await card('Imagem Paulista Verificada'), /Parceiro verificado/);
  assert.match(await card('Hospital Santa Exemplo'), /Cadastro oficial/);
  assert.doesNotMatch(await card('Hospital Santa Exemplo'), /verificado/);
  assert.match(await page.textContent('#count'), /2 parceiros verificados/);
  assert.match(await page.textContent('#fImed'), /Parceiros verificados/);
  assert.ok(await page.isVisible('#legend summary'));
  assert.ok(!(await page.isVisible('#legend ul')), 'legenda fechada por padrão');
  await page.click('#legend summary');
  const legend = await page.textContent('#legend');
  assert.match(legend, /Parceiro verificado.*confirmados pela própria clínica/s);
  assert.match(legend, /Cadastro oficial.*Ministério da Saúde/s);
  await shot(page, '16-selos-legenda');
  await page.click('#fImed');
  assert.deepEqual((await names(page)).sort(), ['Clínica Jardins Verificada', 'Imagem Paulista Verificada']);
  assert.deepEqual(errors, []);
  await context.close();
  // Demonstração continua com o próprio selo, sem "verificado".
  const demo = await newPage(browser);
  await demo.page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await ready(demo.page);
  const t = await demo.page.textContent('.pc.imed >> nth=0');
  assert.match(t, /Demonstração/);
  assert.doesNotMatch(t, /verificado/);
  assert.match(await demo.page.textContent('#count'), /2 de demonstração/);
  await demo.context.close();
});

await scenario('filtro "Atende SUS" usa o dado do CNES', async () => {
  const { page, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  await page.click('#fSus');
  assert.equal(await page.getAttribute('#fSus', 'aria-pressed'), 'true');
  assert.deepEqual(await names(page), ['Laboratório Análise Paulista']);
  assert.match(await page.textContent('#list'), /vem do cadastro oficial \(CNES\)/);
  assert.ok(await page.isVisible('#fClear'));
  await page.selectOption('#fExam', 'rm');
  const band = (await page.textContent('#priceBand')).replace(/\s+/g, ' ');
  assert.match(band, /Ressonância perto de você: de R\$ 450 a R\$ 899,90 em 2 clínicas/, 'com SUS ligado, a faixa ainda mostra os preços dos parceiros da região');
  assert.doesNotMatch(band, /Nenhuma clínica informou/);
  await page.selectOption('#fExam', '');
  await page.click('#fSus');
  assert.equal((await names(page)).length, 4);
  await context.close();
});

await scenario('filtro de convênio com as opções dos parceiros encontrados', async () => {
  const { page, errors, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  assert.ok(await page.isVisible('#fIns'));
  assert.deepEqual(await page.$$eval('#fIns option', (o) => o.map((x) => x.value)), ['', 'Amil', 'Bradesco Saúde', 'SulAmérica']);
  await page.selectOption('#fIns', 'Amil');
  assert.deepEqual(await names(page), ['Clínica Jardins Verificada']);
  assert.match(await page.textContent('#list'), /Convênios informados pelas clínicas parceiras/);
  await page.selectOption('#fIns', 'Bradesco Saúde');
  assert.deepEqual(await names(page), ['Imagem Paulista Verificada']);
  await page.click('.pc:has-text("Imagem Paulista Verificada")');
  const sheet = await page.textContent('#sheet');
  assert.match(sheet, /Convênios.*Bradesco Saúde.*SulAmérica.*Convênios informados pela clínica/s);
  await page.keyboard.press('Escape');
  await page.click('#fClear');
  assert.equal(await page.inputValue('#fIns'), '');
  assert.equal((await names(page)).length, 4);
  assert.deepEqual(errors, []);
  await context.close();
  // Sem parceiros com convênio, o filtro não aparece.
  const other = await newPage(browser, { fn: (r, b) => (b.action === 'search' ? json(r, { ok: true, provider: 'osm', radius_m: 5000, warnings: [], imed: [], cnes: CNES_ROWS, places: [], coverage: { status: 'done' } }) : defaultFn(r, b)) });
  await other.page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(other.page);
  assert.ok(!(await other.page.isVisible('#fIns')));
  await other.context.close();
});

await scenario('faixa de preço do exame só com preços informados', async () => {
  const { page, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  assert.equal(await page.textContent('#priceBand'), '', 'sem exame escolhido, sem faixa');
  await page.selectOption('#fExam', 'rm');
  const band = (await page.textContent('#priceBand')).replace(/\s+/g, ' ');
  assert.match(band, /Ressonância perto de você: de R\$ 450 a R\$ 899,90 em 2 clínicas que informaram o preço/);
  await shot(page, '17-faixa-de-preco');
  await page.selectOption('#fExam', 'tc');
  assert.match((await page.textContent('#priceBand')).replace(/\s+/g, ' '), /Tomografia perto de você: R\$ 300 em 1 clínica que informou o preço/);
  await page.selectOption('#fExam', 'ecg');
  assert.match(await page.textContent('#priceBand'), /Nenhuma clínica informou o preço de Eletrocardiograma por aqui ainda\. Os valores aparecem quando as clínicas parceiras informam\./);
  await context.close();
});

await scenario('notas e avaliações vindas do banco, sem quebrar a busca quando falham', async () => {
  const { page, log, errors, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  await page.waitForSelector('.pc-rate');
  assert.equal(log.ratings.length, 1);
  assert.deepEqual(log.ratings[0].p_keys.sort(), ['cnes:2077485', 'cnes:6543210', `imed:${PARTNER_ROWS[0].id}`, `imed:${PARTNER_ROWS[1].id}`].sort());
  assert.match(await page.textContent('.pc:has-text("Hospital Santa Exemplo") .pc-rate'), /4,6\s*\(12\)/);
  assert.equal(await page.getAttribute('.pc:has-text("Hospital Santa Exemplo") .pc-rate', 'aria-label'), 'Nota 4,6 de 5, 12 avaliações');
  const cardLabel = await page.getAttribute('.pc:has-text("Hospital Santa Exemplo")', 'aria-label');
  assert.match(cardLabel, /^Hospital Santa Exemplo, .+Cadastro oficial.+Nota 4,6 de 5, 12 avaliações\. Ver detalhes$/, 'leitor de tela ouve selo e nota');
  assert.match(await page.getAttribute('.pc:has-text("Imagem Paulista Verificada")', 'aria-label'), /Parceiro verificado.*(a partir de R\$|Preço sob consulta)/);
  assert.equal(await page.locator('.pc:has-text("Laboratório Análise Paulista") .pc-rate').count(), 0, 'sem avaliação, sem nota');
  assert.equal(await page.locator('#fSort option[value="rating"]:not([disabled])').count(), 1);
  await page.selectOption('#fSort', 'rating');
  assert.deepEqual((await names(page)).slice(0, 2), ['Hospital Santa Exemplo', 'Imagem Paulista Verificada']);
  await page.click('.pc:has-text("Hospital Santa Exemplo")');
  await page.waitForSelector('#dtReviews:not([hidden]) li');
  assert.equal(log.reviews[0].p_key, 'cnes:2077485');
  assert.equal(log.reviews[0].p_limit, 5);
  const rv = await page.textContent('#dtReviews');
  assert.match(rv, /<b>Ótimo<\/b> atendimento/, 'comentário aparece como texto (HTML escapado)');
  assert.equal(await page.locator('#dtReviews b:has-text("Ótimo")').count(), 0);
  assert.match(rv, /Maria/);
  assert.match(rv, /João/);
  assert.match(await page.textContent('.dt-top'), /4,6/);
  await page.locator('#dtReviews').scrollIntoViewIfNeeded();
  await shot(page, '18-avaliacoes');
  await page.keyboard.press('Escape');
  await page.click('.pc:has-text("Laboratório Análise Paulista")');
  await page.waitForFunction(() => !document.querySelector('#dtReviews'));
  assert.deepEqual(errors, []);
  await context.close();

  const bad = await newPage(browser, { fn: fullFn, ratings: (r) => r.fulfill({ status: 500, body: '' }), reviews: (r) => r.fulfill({ status: 500, body: '' }) });
  await bad.page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(bad.page);
  await bad.page.waitForTimeout(300);
  assert.equal((await names(bad.page)).length, 4);
  assert.equal(await bad.page.locator('.pc-rate').count(), 0);
  assert.equal(await bad.page.locator('#fSort option[value="rating"]:not([disabled])').count(), 0);
  await bad.page.click('.pc >> nth=1');
  await bad.page.waitForFunction(() => !document.querySelector('#dtReviews'));
  assert.ok(await bad.page.isVisible('#sheet h3'));
  assert.deepEqual(bad.errors, []);
  await bad.context.close();
});

await scenario('?exame=rm na URL já escolhe o exame', async () => {
  const { page, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao&exame=rm`);
  await ready(page);
  assert.equal(await page.inputValue('#fExam'), 'rm');
  assert.equal(new URL(page.url()).search, '?exame=rm', 'tira usar=localizacao e mantém o exame');
  assert.deepEqual(await names(page), ['Imagem Paulista Verificada', 'Hospital Santa Exemplo', 'Clínica Jardins Verificada']);
  assert.match(await page.textContent('#priceBand'), /Ressonância perto de você/);
  await context.close();
  const bad = await newPage(browser, { fn: fullFn });
  await bad.page.goto(`${BASE}perto.html?usar=localizacao&exame=xyz`);
  await ready(bad.page);
  assert.equal(await bad.page.inputValue('#fExam'), '', 'código desconhecido é ignorado');
  await bad.context.close();
  for (const key of ['toString', '__proto__', 'constructor']) {
    const proto = await newPage(browser, { fn: fullFn });
    await proto.page.goto(`${BASE}perto.html?usar=localizacao&exame=${key}`);
    await ready(proto.page);
    assert.equal(await proto.page.inputValue('#fExam'), '', `${key} é ignorado`);
    assert.equal((await proto.page.textContent('#priceBand')).trim(), '', 'sem faixa de preço');
    assert.ok((await names(proto.page)).length > 0, 'lista não fica vazia');
    assert.deepEqual(proto.errors, []);
    await proto.context.close();
  }
});

await scenario('WhatsApp do IMED: escondido sem número, visível quando configurado', async () => {
  const { page, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  await page.click('.pc:has-text("Hospital Santa Exemplo")');
  await page.waitForSelector('.sh-ov.open');
  assert.equal(await page.locator('.wa-imed').count(), 0);
  assert.equal(await page.locator('#sheet a[href*="wa.me"]').count(), 0);
  await context.close();

  const on = await newPage(browser, { fn: fullFn });
  await on.context.addInitScript(WA_CONFIG);
  await on.page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(on.page);
  await on.page.click('.pc:has-text("Hospital Santa Exemplo")');
  await on.page.waitForSelector('.sh-ov.open');
  const a = on.page.locator('.wa-imed');
  assert.match(await a.textContent(), /Falar com o IMED no WhatsApp/);
  const href = await a.getAttribute('href');
  assert.ok(href.startsWith('https://wa.me/5511999998888?text='), href);
  assert.match(decodeURIComponent(href.split('text=')[1]), /Hospital Santa Exemplo/);
  await shot(on.page, '19-whatsapp-imed');
  assert.deepEqual(on.errors, []);
  await on.context.close();
});

await scenario('local do CNES: link "Assuma o cadastro" para o responsável', async () => {
  const { page, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  await page.click('.pc:has-text("Hospital Santa Exemplo")');
  const link = page.locator('#sheet a:has-text("Assuma o cadastro")');
  assert.match(await link.textContent(), /É o responsável por este local\? Assuma o cadastro/);
  assert.equal(await link.getAttribute('href'), 'reivindicar.html?cnes=2077485');
  await page.keyboard.press('Escape');
  await page.click('.pc:has-text("Imagem Paulista Verificada")');
  assert.equal(await page.locator('#sheet a:has-text("Assuma o cadastro")').count(), 0, 'parceiro já tem cadastro');
  await context.close();
});

await scenario('celular (390px): selos, filtros, faixa de preço e detalhes sem rolagem lateral', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, fn: fullFn });
  await context.addInitScript(WA_CONFIG);
  await page.goto(`${BASE}perto.html?usar=localizacao&exame=rm`);
  await ready(page);
  await page.waitForSelector('.pc-rate');
  await page.click('#legend summary');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `sem rolagem lateral (${overflow}px)`);
  await shot(page, '20-celular-faixa-selos');
  await page.click('.pc:has-text("Hospital Santa Exemplo")');
  await page.waitForSelector('#dtReviews:not([hidden]) li');
  await page.locator('.dt-claim').scrollIntoViewIfNeeded();
  await shot(page, '21-celular-detalhes-avaliacoes');
  await page.keyboard.press('Escape');
  await page.click('.pc:has-text("Imagem Paulista Verificada")');
  await page.click('[data-book]');
  await fillBooking(page);
  await page.click('#bkBtn');
  await page.waitForSelector('.ok h3');
  await shot(page, '22-celular-pedido-enviado');
  const ov2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(ov2 <= 0, `sem rolagem lateral (${ov2}px)`);
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
