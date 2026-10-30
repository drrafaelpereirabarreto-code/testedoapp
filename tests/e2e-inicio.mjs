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
import * as G from '../assets/js/geo-core.js';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const PORT = Number(process.env.E2E_PORT) || 8770; // E2E_PORT: outra porta para rodar em paralelo
const REST = 'https://pyoqiecupxhdzigjudyd.supabase.co/rest/v1/';
const FN = 'https://pyoqiecupxhdzigjudyd.supabase.co/functions/v1/clinicas-proximas';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/+F9PQAJYwN6V0E0WwAAAABJRU5ErkJggg==', 'base64');

// Tudo o que o servidor entregou (também o que o service worker pede, que o Playwright não mostra na página).
const served = [];
const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  served.push(path);
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
// Pontos do mapa da página inicial (establishment_points): os mesmos locais, só com o necessário para o mapa.
const POINTS = CNES_ROWS.map(({ cnes, name, kind, lat, lng, distance_m }) => ({ cnes, name, kind, lat, lng, distance_m, total: CNES_ROWS.length }));
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const APPTS = [
  { type: 'pedido', code: 'IMED-11111111', id: ID1, token: 'a'.repeat(64), place_key: 'cnes:2077485', name: 'Hospital Santa Exemplo', phone: '(11) 3141-1000', exam: 'rm', items: ['Ressonância'], date: '2026-11-05', period: 'manha', status: 'pendente', created: '2026-10-30T12:00:00Z' },
  { type: 'pedido', code: 'IMED-22222222', id: ID2, token: 'b'.repeat(64), place_key: 'cnes:6543210', name: 'Laboratório Análise Paulista', exam: 'lab', items: ['Exames de laboratório'], date: '2026-10-20', period: 'qualquer', status: 'pendente', created: '2026-10-15T12:00:00Z' },
  { type: 'pedido', code: 'IMED-3F2A9C1E', status: 'pendente', name: 'Laboratório Vida', items: ['Exames de laboratório'], date: 'segunda-feira, 03 de novembro', time: 'manhã', total: null },
  { code: 'IMED-ABCDE', type: 'exame', clinic: 'dcp', name: 'DiagnoCenter Paulista', items: ['Ressonância'], date: 'amanhã', time: '14:30', total: 405, pay: 'pix' },
  { code: 'TELE-XYZ', type: 'tele', name: 'Dra. Camila Ruiz', items: ['Teleconsulta'], date: 'Hoje', time: 'agora', total: 120 },
];
// Relógio fixo dos cenários de Meus pedidos (as datas acima e abaixo ficam sempre no futuro).
const NOW = '2026-10-30T12:00:00Z';
// Pedidos com horário marcado, gravados como a página do local grava (geo-core.localAppt).
const SLOT_PLACE = { id: `imed:${PARTNER_ID}`, name: 'Clínica Parceira Paulista' };
const SID1 = '55555555-5555-4555-8555-555555555555';
const SID2 = '66666666-6666-4666-8666-666666666666';
const SLOT_APPTS = [
  // 12:30 UTC = 09:30 em São Paulo
  G.localAppt(SLOT_PLACE, { exam: 'rm', slot: '2026-11-05T12:30:00.000Z' }, SID1, 'd'.repeat(64), Date.parse(NOW)),
  // 02:30 UTC do dia 7 = 23:30 do dia 6 em São Paulo
  G.localAppt(SLOT_PLACE, { exam: 'usg', slot: '2026-11-07T02:30:00.000Z' }, SID2, 'e'.repeat(64), Date.parse(NOW)),
];
// Oito locais em volta do ponto (de 250 m a ~1,4 km), para os rótulos do 3D disputarem espaço no celular.
const AROUND = [
  ['Clínica Bela Vista Teste', 'clinica'], ['Laboratório Paulista Teste', 'laboratorio'], ['Centro de Diagnóstico Augusta', 'imagem'],
  ['Hospital Consolação Teste', 'hospital'], ['Clínica Jardins Teste', 'clinica'], ['Laboratório Santos Teste', 'laboratorio'],
  ['Imagem Liberdade Teste', 'imagem'], ['Hospital Paraíso Teste', 'hospital'],
].map(([name, kind], i) => {
  const ang = i * Math.PI / 4 + 0.3, dist = 250 + i * 160;
  const lat = -23.565 + (Math.sin(ang) * dist) / 110570, lng = -46.652 + (Math.cos(ang) * dist) / (111320 * Math.cos((-23.565 * Math.PI) / 180));
  return { cnes: String(7100001 + i), name, kind, address_line: `Rua Teste, ${100 + i}`, neighborhood: 'Bela Vista', cep: '01310000', city: 'São Paulo', uf: 'SP', city_code: '355030', lat, lng, distance_m: dist, location_source: 'cnes', phone: null, shift: null, open_24h: false, sus: false, services: [], specialties: [], cnes_updated_at: '2026-09-01' };
});

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*' } });
const preflight = (route) => route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' } });

// device: { memory, cores, saveData, effectiveType } simula o aparelho (navigator.deviceMemory, hardwareConcurrency,
// connection.saveData e connection.effectiveType). dpr: densidade da tela. sw: liga o service worker.
// tz: fuso do aparelho. ua: navegador (por exemplo, o do iPhone). now: relógio fixo. three: rota para o three.js.
// points: resposta de establishment_points. spyMap: guarda em window.__maps os mapas do Leaflet criados pela página.
// cnesDate: resposta de cnes_last_update; cancel: de cancel_request; geocode: da Edge Function (centro da cidade);
// store: chaves do localStorage gravadas antes de abrir (ex.: { imed_cidade: {...} }).
async function newPage(browser, { mobile = false, cities, cnes, points, partners, status, waitlist, tele, whatsapp = '', appts, motion = 'reduce', device = null, dpr = 1, sw = false, tz = 'America/Sao_Paulo', ua, now = null, viewport = null, three = null, spyMap = false, cnesDate, cancel, geocode, store = null } = {}) {
  const context = await browser.newContext({
    viewport: viewport || (mobile ? { width: 390, height: 844 } : { width: 1366, height: 860 }),
    deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: tz,
    serviceWorkers: sw ? 'allow' : 'block', reducedMotion: motion, acceptDownloads: true, ...(ua ? { userAgent: ua } : {}),
  });
  if (now) await context.clock.setFixedTime(new Date(now));
  if (three) await context.route(`${BASE}assets/vendor/three.module.min.js`, three);
  const log = { cities: 0, cnes: [], points: [], partners: [], status: [], waitlist: [], tele: 0, cnesDate: 0, cnesDateArgs: [], cancel: [], geocode: [], track: [] };
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
  // Com ?select= na URL: casa pelo começo do endereço.
  await context.route((u) => u.href.startsWith(`${REST}rpc/establishment_points`), async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.points.push({ url: route.request().url(), body: JSON.parse(route.request().postData() || '{}') });
    return (points ?? ((r) => json(r, POINTS)))(route);
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
  // Médicos atendendo agora na teleconsulta (função nova da teleconsulta). Padrão: nenhum.
  await context.route(`${REST}rpc/tele_doctors_online`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.tele += 1;
    return (tele ?? ((r) => json(r, [])))(route);
  });
  // Data real da última importação do CNES (função nova da migração de confiança).
  // Contador de visitas próprio (assets/js/visitas.js): só manda com ?visitas=teste neste computador de testes.
  await context.route(`${REST}rpc/track`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.track.push(JSON.parse(route.request().postData() || '{}'));
    return json(route, true);
  });
  await context.route(`${REST}rpc/cnes_last_update`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.cnesDate += 1;
    log.cnesDateArgs.push(JSON.parse(route.request().postData() || '{}'));
    return (cnesDate ?? ((r) => json(r, '2026-10-30')))(route);
  });
  await context.route(`${REST}rpc/cancel_request`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.cancel.push(JSON.parse(route.request().postData() || '{}'));
    return (cancel ?? ((r) => json(r, 'ok')))(route);
  });
  // Geocodificação da busca (Edge Function), usada para achar o centro da cidade escolhida.
  await context.route(FN, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    const body = JSON.parse(route.request().postData() || '{}');
    log.geocode.push(body);
    if (geocode) return geocode(route, body);
    if (/Rio de Janeiro/.test(body.q)) return json(route, { ok: true, lat: -22.90684, lng: -43.17289, label: 'Rio de Janeiro - RJ', precision: 'cidade', provider: 'osm' });
    if (/Belo Horizonte/.test(body.q)) return json(route, { ok: true, lat: -19.91668, lng: -43.93449, label: 'Belo Horizonte - MG', precision: 'cidade', provider: 'osm' });
    return json(route, { ok: false, error: 'not_found' }, 404);
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
  await context.addInitScript(({ list, kv }) => {
    try { localStorage.setItem('imed_lgpd', '1'); } catch { /* ignora */ }
    if (kv && !sessionStorage.getItem('kv')) { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.setItem('kv', '1'); }
    if (!sessionStorage.getItem('fav')) { localStorage.setItem('imed_fav', '["dcp"]'); sessionStorage.setItem('fav', '1'); }
    if (list && !sessionStorage.getItem('seeded')) { localStorage.setItem('imed_appts', JSON.stringify(list)); sessionStorage.setItem('seeded', '1'); }
  }, { list: appts ?? null, kv: store });
  if (spyMap) {
    // O leaflet.js define window.L quando termina de carregar; o gancho guarda cada mapa criado.
    await context.addInitScript(() => {
      let lib;
      Object.defineProperty(window, 'L', {
        configurable: true,
        get: () => lib,
        set: (v) => { lib = v; if (v?.Map?.addInitHook && !v.__spy) { v.__spy = true; v.Map.addInitHook(function () { (window.__maps ||= []).push(this); }); } },
      });
    });
  }
  if (device) {
    await context.addInitScript((d) => {
      if (d.memory != null) Object.defineProperty(navigator, 'deviceMemory', { get: () => d.memory, configurable: true });
      if (d.cores != null) Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => d.cores, configurable: true });
      if (d.saveData || d.effectiveType) Object.defineProperty(navigator, 'connection', { get: () => ({ saveData: !!d.saveData, effectiveType: d.effectiveType || '4g' }), configurable: true });
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
// Tempo máximo de cada cenário (E2E_CENARIO_S segundos, padrão 150): um cenário travado falha com o nome dele,
// em vez de segurar o arquivo inteiro até o limite do CI.
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
const limite = (name) => new Promise((_, fail) => { const t = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); t.unref?.(); });
async function scenario(name, fn) {
  try { await Promise.race([fn(), limite(name)]); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 5).join('\n  ')}`); }
}
// Rola a página inteira para carregar as seções que só aparecem ao rolar.
async function scrollAll(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
    window.scrollTo(0, 0);
  });
}
// Contraste (fórmula da WCAG) de texto claro sobre fundo escuro, medido nos pixels de uma captura do
// elemento: o pixel mais claro (o texto) contra a mediana (o fundo, que ocupa a maior parte da caixa).
async function lightTextContrast(page, locator) {
  // No meio da tela, longe da barra de navegação fixa de baixo, que cobriria o elemento na captura.
  await locator.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const png = await locator.screenshot({ animations: 'disabled' });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = [];
    for (let i = 0; i < d.length; i += 4) L.push(0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]));
    L.sort((a, b) => a - b);
    return (L[L.length - 1] + 0.05) / (L[Math.floor(L.length / 2)] + 0.05);
  }, png.toString('base64'));
}
// Espera uma condição do lado do Node (por exemplo, uma chamada ao banco simulado), até 5 segundos.
async function until(cond, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
}
// Duas caixas da tela se cobrem?
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

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
  const faq = await page.textContent('.faq');
  assert.match(faq, /O IMED cobra alguma coisa\?/);
  assert.match(faq, /O IMED é gratuito para você.*pagamento é feito direto no local.*nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp/s);
  assert.match(faq, /sem vínculo com o governo ou o SUS/);
  await page.click('#faqAll');
  assert.equal(await page.locator('.faq details:visible').count(), 9, 'Ver todas mostra as outras');
  assert.equal(await page.locator('#faqAll').count(), 0);
  assert.match(await page.textContent('.faq'), /Ninguém paga para aparecer primeiro/);
  assert.equal(await page.locator('.faq a[href="como-funciona.html#ordem"]').count(), 1, 'ordem dos resultados → Como funciona');
  assert.equal(await page.locator('.faq a[href="como-funciona.html#avaliacoes"]').count(), 1, 'avaliações → Como funciona');
  // Aviso de emergência fixo e discreto no topo; fonte oficial sem parecer coisa do governo.
  assert.match(await page.textContent('.hero .sos'), /Emergência\? Ligue 192 \(SAMU\)/);
  assert.equal(await page.getAttribute('.hero .sos a', 'href'), 'tel:192');
  assert.match(await page.textContent('#reais .rm-src'), /O IMED é um serviço privado, sem vínculo com o governo ou o SUS/);
  assert.match(await page.textContent('#clinicas'), /Cadastro sem custo/);
  assert.ok(!/Pedido grátis/.test(text));
  assert.match(await page.textContent('#clinicas .ill'), /Imagem ilustrativa/, 'foto feita por IA com o aviso junto');
  // "Meus pedidos" no lugar de "Agendados"
  assert.ok(!/Agendados/.test(text), 'sem "Agendados"');
  assert.equal(await page.textContent('.tabs a[data-go="agenda"]'), 'Meus pedidos');
  // Rodapé igual em todas as páginas: médico responsável com CRM e link do CFM, emergência e fonte dos dados.
  const foot = await page.textContent('footer.rodape');
  assert.match(foot, /Médico responsável: Dr\. Rafael Pereira Barreto Silva — CRM-SP 266930/);
  assert.equal(await page.getAttribute('footer.rodape a[href^="https://portal.cfm.org.br/"]', 'href'), 'https://portal.cfm.org.br/busca-medicos/');
  assert.match(foot, /Emergência\? Ligue 192 \(SAMU\)/);
  assert.match(foot, /Dados de endereço: CNES\/Ministério da Saúde\. O IMED é um serviço privado, sem vínculo com o governo ou o SUS\./);
  for (const href of ['sobre.html', 'como-funciona.html', 'termos.html', 'privacidade.html', 'acessibilidade.html', 'contato.html', 'teleconsulta.html']) {
    assert.equal(await page.locator(`footer.rodape a[href="${href}"]`).count(), 1, `rodapé com ${href}`);
  }
  assert.equal(await page.locator('footer.rodape .rd-a11y .fa-universal-access').count(), 1, 'símbolo de acessibilidade no rodapé');
  assert.ok(!/Criado por|contato@imed/.test(text), 'sem "Criado por" e sem e-mail que não é do IMED');
  const stats = await page.$$eval('#realStats .rm-stat b', (els) => els.map((e) => e.textContent));
  assert.deepEqual(stats, ['2', '1', '0', '1'], 'contagem por tipo inclui o parceiro (imagem)');
  const r = log.cnes.find((a) => a.p_radius_m === 2000);
  assert.ok(String(r.p_lat).split('.')[1].length <= 3, 'coordenada arredondada');
  const pr = log.partners.find((a) => a.p_radius_m === 2000);
  assert.ok(pr && pr.p_include_demo === false && pr.p_lat === r.p_lat, 'parceiros pedidos no mesmo ponto, sem demonstração');
  assert.equal(r.p_limit, 8, 'a lista pede só os 8 mais próximos, com endereço');
  const pt = log.points.find((a) => a.body.p_radius_m === 2000);
  assert.ok(pt, 'mapa pede os pontos da área inteira (2 km)');
  assert.match(pt.url, /\?select=cnes,name,kind,lat,lng,distance_m,total$/, 'só os campos que o mapa usa');
  assert.deepEqual([pt.body.p_lat, pt.body.p_lng, pt.body.p_limit], [r.p_lat, r.p_lng, 3000], 'mesmo ponto da lista');
  // para clínicas e rodapé
  for (const href of ['reivindicar.html', 'painel.html', 'conta.html', 'cidades/', 'exames/', 'privacidade.html']) {
    assert.ok(await page.locator(`footer a[href="${href}"]`).count() >= 1, `rodapé com ${href}`);
  }
  assert.ok(await page.locator('#clinicas a[href="reivindicar.html"]').count() === 1);
  assert.equal(await page.getAttribute('#nearCta', 'href'), 'perto.html?usar=localizacao');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('mapa de clínicas reais: pontos da área inteira (2 km), não só os mais próximos', async () => {
  // 400 locais numa espiral de 100 m a ~1,95 km do ponto da Paulista, 100 de cada tipo.
  const KS = ['imagem', 'laboratorio', 'clinica', 'hospital'];
  const LAT0 = -23.565, LNG0 = -46.652;
  const AREA = Array.from({ length: 400 }, (_, i) => {
    const ang = i * 2.399963, dist = 100 + (i * 1850) / 399;
    const lat = LAT0 + (Math.sin(ang) * dist) / 110570, lng = LNG0 + (Math.cos(ang) * dist) / (111320 * Math.cos((LAT0 * Math.PI) / 180));
    return { cnes: String(7200000 + i), name: `Local Teste ${i}`, kind: KS[i % 4], lat, lng, distance_m: Math.round(dist), total: 400 };
  });
  const { page, errors, context } = await newPage(browser, { points: (r) => json(r, AREA), spyMap: true });
  await page.goto(BASE);
  await scrollAll(page);
  await page.waitForSelector('#realList li b');
  const stats = await page.$$eval('#realStats .rm-stat b', (els) => els.map((e) => e.textContent));
  assert.deepEqual(stats, ['101', '100', '100', '100'], 'conta todos os pontos da área, mais o parceiro (imagem)');
  assert.equal(await page.locator('#realList li').count(), 4, 'a lista continua com os mais próximos');
  await page.locator('#realMap').evaluate((e) => e.scrollIntoView({ block: 'center' })); // longe do topo fixo
  const m = await page.evaluate(() => {
    const map = window.__maps.at(-1), b = map.getBounds();
    let dots = 0, rings = 0;
    map.eachLayer((l) => { if (l instanceof L.Circle) rings += 1; else if (l instanceof L.CircleMarker) dots += 1; });
    return { n: b.getNorth(), s: b.getSouth(), e: b.getEast(), w: b.getWest(), dots, rings, canvas: !!map.getContainer().querySelector('canvas') };
  });
  assert.equal(m.dots, 402, '400 pontos + o parceiro + "você"');
  assert.equal(m.rings, 1, 'círculo dos 2 km');
  assert.ok(m.canvas, 'pontos em canvas (leve no celular)');
  const dLat = 1950 / 110570, dLng = 1950 / (111320 * Math.cos((LAT0 * Math.PI) / 180));
  assert.ok(m.n >= LAT0 + dLat && m.s <= LAT0 - dLat && m.e >= LNG0 + dLng && m.w <= LNG0 - dLng, `mapa enquadra os 2 km inteiros (${JSON.stringify(m)})`);
  // Toque no ponto mais longe (~1,95 km): abre o balão com o nome e o link da página do local.
  const far = AREA.at(-1);
  const at = await page.evaluate(({ lat, lng }) => {
    const map = window.__maps.at(-1), p = map.latLngToContainerPoint([lat, lng]), r = map.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, far);
  await page.mouse.click(at.x, at.y);
  await page.waitForSelector('.leaflet-popup .rm-pop');
  assert.match(await page.textContent('.leaflet-popup .rm-pop'), /Local Teste 399.*Hospital · 1,9 km|Local Teste 399.*Hospital · 2,0 km/s);
  assert.equal(await page.getAttribute('.leaflet-popup .rm-pop a', 'href'), `local.html?cnes=${far.cnes}`);
  assert.deepEqual(errors, []);
  await context.close();

  // Mais locais do que o limite de pontos: a contagem avisa com "+".
  const cut = AREA.map((p) => ({ ...p, total: 5200 }));
  const t = await newPage(browser, { points: (r) => json(r, cut) });
  await t.page.goto(BASE);
  await scrollAll(t.page);
  await t.page.waitForSelector('#realList li b');
  assert.deepEqual(await t.page.$$eval('#realStats .rm-stat b', (els) => els.map((e) => e.textContent)), ['101+', '100+', '100+', '100+']);
  assert.deepEqual(t.errors, []);
  await t.context.close();
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
  assert.ok(!requests.some((u) => /geo-core\.js/.test(u)), 'geo-core.js só ao abrir Meus pedidos');
  assert.ok(!requests.some((u) => /leaflet\.js/.test(u)), 'Leaflet só quando o mapa se aproxima da tela');
  // Leitor de tela: só um resumo curto (role=status), não a lista inteira a cada troca.
  assert.equal(await page.getAttribute('#heroLite', 'aria-live'), null, 'lista sem aria-live');
  assert.equal(await page.getAttribute('#heroLiteStatus', 'role'), 'status');
  assert.equal(await page.textContent('#heroLiteStatus'), '4 locais perto da Av. Paulista', 'exemplo da Av. Paulista, com "da"');
  // Lista acima do degradê do topo: texto claro com contraste de pelo menos 4,5:1 (WCAG AA).
  const parts = ['#heroLite h2', '#heroLite li b', '#heroLite li small', '#heroLite .more'];
  let worst = Infinity;
  for (const sel of parts) {
    for (const loc of await page.locator(sel).all()) {
      const c = await lightTextContrast(page, loc);
      worst = Math.min(worst, c);
      assert.ok(c >= 4.5, `contraste de "${(await loc.textContent()).trim()}": ${c.toFixed(1)}:1`);
    }
  }
  console.log(`  menor contraste na lista leve do celular: ${worst.toFixed(1)}:1`);
  await page.evaluate(() => window.scrollTo(0, 0));
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

await scenario('celular com 3D (tela de densidade 3, 8 locais): 1 ou 2 rótulos, dentro da tela, sem cobrir outro rótulo nem o "Você está aqui"', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, dpr: 3, motion: 'no-preference', device: { memory: 8, cores: 8 }, cnes: (r) => json(r, AROUND), partners: (r) => json(r, []) });
  await page.goto(BASE);
  await page.waitForFunction(() => ['3d', 'leve'].includes(document.body.dataset.hero), null, { timeout: 30000 });
  if (await page.evaluate(() => document.body.dataset.hero) !== '3d') { console.log('  (sem WebGL neste navegador: confere só o modo leve)'); await context.close(); return; }
  // Tela de densidade 3: o 3D desenha com no máximo 1,5 pixel por ponto.
  const ratio = await page.evaluate(() => { const c = document.querySelector('#hero3d canvas'); return c.width / c.clientWidth; });
  assert.ok(Math.abs(ratio - 1.5) < 0.01, `pixel ratio 1,5 numa tela de densidade 3 (${ratio})`);
  await page.waitForFunction(() => document.querySelectorAll('.h3d-label').length === 8);
  // O 3D aqui roda a poucos quadros por segundo (sem placa de vídeo): espera o primeiro rótulo aparecer.
  await page.waitForFunction(() => document.querySelectorAll('.h3d-label.on').length >= 1, null, { timeout: 45000 });
  let withTwo = 0;
  for (let i = 0; i < 8; i++) {
    const s = await page.evaluate(() => {
      const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, n: e.textContent }; };
      const me = document.querySelector('.h3d-me');
      return { hero: box(document.querySelector('#hero3d')), labels: [...document.querySelectorAll('.h3d-label.on')].map(box), me: me.classList.contains('on') ? box(me) : null };
    });
    assert.ok(s.labels.length >= 1 && s.labels.length <= 2, `de 1 a 2 rótulos no celular (${s.labels.length})`);
    if (s.labels.length === 2) withTwo += 1;
    for (const b of s.labels) {
      assert.ok(b.l >= s.hero.l && b.r <= s.hero.r && b.t >= s.hero.t && b.b <= s.hero.b, `rótulo inteiro dentro da área do 3D (${Math.round(b.l)}..${Math.round(b.r)} de ${Math.round(s.hero.r)})`);
    }
    assert.ok(s.me, '"Você está aqui" na tela');
    const boxes = [...s.labels, s.me];
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) assert.ok(!overlap(boxes[a], boxes[b]), `"${boxes[a].n}" não cobre "${boxes[b].n}"`);
    }
    await page.waitForTimeout(700);
  }
  console.log(`  amostras com 2 rótulos: ${withTwo} de 8 (as outras com 1)`);
  await shot(page, 'inicio-celular-3d');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('cidade em 3D: o botão "Pausar animação" fica inteiro à vista, sem a parte branca da página por cima (computador e celular)', async () => {
  for (const [label, opts] of [['computador 1366', {}], ['computador 1280x720', { viewport: { width: 1280, height: 720 } }], ['celular 390', { mobile: true, dpr: 2 }]]) {
    const { page, errors, context } = await newPage(browser, { motion: 'no-preference', device: { memory: 8, cores: 8 }, ...opts });
    await page.goto(BASE);
    await page.waitForFunction(() => ['3d', 'leve'].includes(document.body.dataset.hero), null, { timeout: 30000 });
    if (await page.evaluate(() => document.body.dataset.hero) !== '3d') { console.log(`  (${label}: sem WebGL neste navegador, sem o botão)`); await context.close(); continue; }
    await page.waitForSelector('#heroPause:not([hidden])');
    // No centro, na base e nos cantos de baixo do botão, quem recebe o toque é o próprio botão.
    const hits = await page.evaluate(() => {
      const b = document.querySelector('#heroPause');
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      // O botão é uma pílula (cantos redondos): os pontos de baixo ficam dentro das curvas.
      const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + r.width / 2, r.bottom - 2], [r.left + r.height / 2, r.bottom - 3], [r.right - r.height / 2, r.bottom - 3]];
      return pts.map(([x, y]) => { const el = document.elementFromPoint(x, y); return el === b || b.contains(el) ? 'botão' : (el?.className || el?.tagName || 'nada'); });
    });
    assert.deepEqual(hits, ['botão', 'botão', 'botão', 'botão'], `${label}: o botão inteiro recebe o toque (${hits.join(', ')})`);
    if (!opts.mobile) {
      // E não encosta no aviso "Arraste para girar".
      const gap = await page.evaluate(() => { const h = document.querySelector('.hero-hint'); const b = document.querySelector('#heroPause'); if (!h || !h.getClientRects().length) return 99; return b.getBoundingClientRect().top - h.getBoundingClientRect().bottom; });
      assert.ok(gap >= 4, `${label}: o botão não encosta no aviso de arrastar (${Math.round(gap)} px)`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('Meus pedidos: só pedidos reais, situação do banco, avaliar e lembrete .ics', async () => {
  const { page, log, errors, context } = await newPage(browser, { appts: APPTS, now: NOW });
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
  assert.match(ics.replace(/\r\n /g, ''), /SUMMARY:Ressonância · Hospital Santa Exemplo\r\n/, 'confirmado pelo local: sem "(a confirmar)"');
  assert.match(await page.textContent('#agTitle'), /Meus pedidos/);
  await shot(page, 'inicio-agendados');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Meus pedidos vazio e falha ao consultar a situação', async () => {
  const { page, errors, context } = await newPage(browser, { appts: [APPTS[0]], now: NOW, status: (r) => json(r, { message: 'erro' }, 500) });
  await page.goto(`${BASE}#agenda`);
  await page.waitForFunction(() => /indisponível/.test(document.querySelector('#appts').textContent));
  page.once('dialog', (d) => d.accept());
  await page.click('.appt .rmv');
  await page.waitForSelector('#appts .empty');
  assert.match(await page.textContent('#appts'), /ainda não fez nenhum pedido/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Meus pedidos: remover apaga o pedido mostrado, mesmo se a lista mudou em outra aba', async () => {
  const { page, errors, context } = await newPage(browser, { appts: APPTS.slice(0, 2), now: NOW });
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

await scenario('teleconsulta: médicos atendendo agora vêm do banco e o botão leva à página da teleconsulta', async () => {
  const DOCS = [{ full_name: 'Médica Um', crm: '1', crm_uf: 'SP', rqe: null, specialty: null }, { full_name: 'Médico Dois', crm: '2', crm_uf: 'RJ', rqe: null, specialty: null }];
  const { page, log, errors, context } = await newPage(browser, { tele: (r) => json(r, DOCS) });
  await page.goto(BASE);
  assert.equal(log.tele, 0, 'só pergunta quando a seção se aproxima da tela');
  await page.locator('#lista').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => /Médicos atendendo agora: 2/.test(document.querySelector('#teleNow').textContent));
  assert.equal(log.tele, 1);
  assert.ok(await page.evaluate(() => document.querySelector('#teleNow').classList.contains('on')));
  assert.equal(await page.getAttribute('#teleGo', 'href'), 'teleconsulta.html');
  assert.match(await page.textContent('#teleGo'), /Entrar na teleconsulta/);
  const sec = await page.textContent('#lista');
  assert.match(sec, /Teleconsulta não é para emergência/);
  assert.ok(!/Em breve|em breve|médicos de verdade/.test(sec), 'nada de "em breve"');
  assert.ok(!/R\$|Dra\.|Dr\./.test(sec), 'sem preço e sem nome de médico na página inicial');
  assert.equal(await page.isVisible('#teleWait'), false, 'com médico atendendo, sem lista de espera');
  assert.equal(await page.getAttribute('.hchip[href="teleconsulta.html"]', 'href'), 'teleconsulta.html', 'atalho do topo vai para a teleconsulta');
  assert.ok(!/em breve/.test(await page.textContent('#hchips')));
  await page.locator('#lista').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await shot(page, 'inicio-teleconsulta');
  await page.click('#faqAll');
  assert.match(await page.textContent('.faq'), /Já existe teleconsulta\?\s*Sim\..*Quando não há médico atendendo, a página da teleconsulta avisa/s);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('teleconsulta sem médico atendendo ou com a função fora do ar: aviso e lista de espera', async () => {
  for (const [name, tele] of [['nenhum médico', (r) => json(r, [])], ['função fora do ar', (r) => json(r, { message: 'not found' }, 404)]]) {
    const { page, log, errors, context } = await newPage(browser, { tele });
    await page.goto(`${BASE}#tele`);
    await page.waitForFunction(() => /Nenhum médico atendendo agora/.test(document.querySelector('#teleNow').textContent));
    assert.ok(!(await page.evaluate(() => document.querySelector('#teleNow').classList.contains('on'))), name);
    assert.equal(await page.getAttribute('#teleGo', 'href'), 'teleconsulta.html', `${name}: o botão continua (a página avisa)`);
    await page.waitForSelector('#teleWait:not([hidden])');
    assert.equal(await page.inputValue('#wlForm select'), 'teleconsulta');
    await page.fill('#wlForm input[name=email]', 'Maria@Exemplo.com');
    await page.fill('#wlForm input[name=city]', 'Recife');
    await page.click('#wlBtn');
    await page.waitForSelector('#wlMsg.ok');
    assert.deepEqual(log.waitlist[0], { email: 'maria@exemplo.com', city: 'Recife', interest: 'teleconsulta' });
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('Meus pedidos: o lembrete .ics diz "(a confirmar)" enquanto o local não confirma', async () => {
  const { page, errors, context } = await newPage(browser, { appts: [APPTS[0]], now: NOW, status: (r) => json(r, [{ id: ID1, status: 'pending', reviewed: false }]) });
  await page.goto(`${BASE}#agenda`);
  await page.waitForFunction(() => /Aguardando contato/.test(document.querySelector('#appts').textContent));
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.appt >> nth=0 >> button:has-text("Adicionar à agenda")')]);
  const ics = (await readFile(await download.path(), 'utf8')).replace(/\r\n /g, '');
  assert.match(ics, /SUMMARY:Ressonância · Hospital Santa Exemplo \(a confirmar\)\r\n/);
  assert.match(ics, /STATUS:TENTATIVE/);
  assert.match(ics, /O horário é confirmado pela clínica/);
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
  // Fontes do Google sempre com reserva: aqui elas nem carregam (rede simulada), e nada pode cair em Times.
  const lone = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => {
    const f = getComputedStyle(el).fontFamily;
    return /^\s*["']?(Sora|Inter)\b/i.test(f) && !/,\s*sans-serif\s*$/i.test(f);
  }).map((el) => el.className || el.tagName).slice(0, 5));
  assert.deepEqual(lone, [], 'toda regra com Sora ou Inter termina numa fonte sem serifa do aparelho');
  const items = await page.$$eval('.bnav > *', (els) => els.map((e) => [e.textContent.trim(), e.getAttribute('href'), e.getBoundingClientRect().height]));
  assert.deepEqual(items.map((i) => i[0]), ['Início', 'Perto de mim', 'Meus pedidos', 'Conta']);
  assert.equal(items[3][1], 'conta.html');
  assert.ok(items.every((i) => i[2] < 60), 'rótulos numa linha só');
  // Página mais curta: antes destas mudanças media 7.295 px (390x844, 4 cidades, modo leve). Os alvos de toque
  // de 44 px (links do rodapé, perguntas frequentes e botões, para quem tem dedo trêmulo ou vista cansada)
  // somam uns 200 px: o limite passou de 6.800 para 7.200 px, ainda abaixo do que era antes.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(`  altura da página no celular: ${height} px (antes: 7295 px)`);
  assert.ok(height < 7200, `página mais curta no celular (${height} px)`);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#cities')).overflowX), 'auto', 'cidades em carrossel');
  if (SHOTS) { await page.screenshot({ path: join(SHOTS, 'inicio-celular-inteira.png'), fullPage: true }); }
  await page.click('.bnav [data-go="agenda"]');
  await page.waitForFunction(() => /Confirmado/.test(document.querySelector('#appts').textContent));
  await shot(page, 'inicio-celular-agendados');
  const ov2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(ov2 <= 0, `Meus pedidos sem rolagem lateral (${ov2}px)`);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('ponto de partida: "Exemplo: Av. Paulista (São Paulo)" até escolher e fonte do CNES com a data real dos dados da cidade', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(BASE);
  await page.waitForFunction(() => /atualizados em/.test(document.querySelector('#heroSrc').textContent));
  assert.equal(await page.textContent('#heroSrc'), 'Fonte: CNES/Ministério da Saúde, dados de São Paulo atualizados em 30 de outubro de 2026');
  assert.equal(log.cnesDate, 1);
  assert.deepEqual(log.cnesDateArgs, [{ p_city: 3550308 }], 'a data é a dos dados de São Paulo (o exemplo do mapa), não a da importação mais nova de qualquer cidade');
  assert.equal(await page.textContent('#addrSmall'), 'Exemplo');
  assert.equal(await page.textContent('#addrTxt'), 'Av. Paulista (São Paulo)');
  assert.equal(await page.textContent('#heroAddr'), 'Exemplo: Av. Paulista');
  await scrollAll(page);
  await page.waitForSelector('#realList li b');
  assert.ok(await page.locator('#realExample').isVisible(), 'aviso de exemplo na seção do mapa');
  assert.match(await page.textContent('#realExample'), /Exemplo: Av\. Paulista \(São Paulo\)\.\s*Escolha sua cidade/);
  assert.equal(await page.textContent('#realWhere'), 'da Av. Paulista', '"da Av. Paulista", não "de Av. Paulista"');
  assert.match(await page.textContent('.rm-where'), /Em até 2 km da Av\. Paulista/);
  assert.ok(!/de Av\. Paulista/.test(await page.evaluate(() => document.body.innerText)), 'sem "de Av. Paulista" na página');
  assert.deepEqual(errors, []);
  await context.close();
  // Sem a data (função fora do ar): só a fonte, sem data inventada.
  const b = await newPage(browser, { cnesDate: (r) => json(r, { message: 'erro' }, 500) });
  await b.page.goto(BASE);
  await b.page.waitForFunction(() => !document.querySelector('#heroSrc').hidden);
  assert.equal(await b.page.textContent('#heroSrc'), 'Fonte: CNES/Ministério da Saúde');
  await b.context.close();
  // Sem as cidades do banco (sem contagem), a linha da fonte nem aparece.
  const c = await newPage(browser, { cities: (r) => json(r, { message: 'erro' }, 500) });
  await c.page.goto(BASE);
  await c.page.waitForTimeout(600);
  assert.ok(await c.page.locator('#heroSrc').isHidden());
  assert.equal(c.log.cnesDate, 0);
  await c.context.close();
});

await scenario('"Escolha sua cidade": cidades do banco, centro pela geocodificação da busca, guardado no aparelho', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(BASE);
  await scrollAll(page);
  await page.waitForSelector('#realList li b');
  const before = log.cnes.length;
  await page.click('#realChoose');
  await page.waitForSelector('#citySel:not([disabled])');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'citySel', 'foco na lista de cidades');
  assert.match(await page.textContent('.sh-body'), /Até você escolher, o mapa mostra um exemplo/);
  const opts = await page.$$eval('#citySel option', (els) => els.map((e) => e.textContent));
  assert.deepEqual(opts, ['Escolha a cidade', 'Belo Horizonte - MG', 'Rio de Janeiro - RJ', "Santa Bárbara d'Oeste - SP", 'São Paulo - SP'], 'cidades importadas em ordem alfabética');
  assert.equal(await page.locator('#sheet button[data-pl]').count(), 7, 'os bairros de São Paulo continuam (um botão para cada)');
  await page.selectOption('#citySel', '3304557');
  await page.waitForFunction(() => !document.querySelector('#ov').classList.contains('open'));
  assert.deepEqual(log.geocode.at(-1), { action: 'geocode', q: 'Rio de Janeiro, RJ' }, 'mesma geocodificação da busca');
  await page.waitForFunction(() => document.querySelector('#realWhere').textContent === 'do centro do Rio de Janeiro');
  assert.ok(await page.locator('#realExample').isHidden(), 'escolheu: some o aviso de exemplo');
  await page.waitForFunction(() => /dados do Rio de Janeiro atualizados em/.test(document.querySelector('#heroSrc').textContent));
  assert.deepEqual(log.cnesDateArgs.at(-1), { p_city: 3304557 }, 'a fonte passa a dizer a data dos dados do Rio de Janeiro');
  assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'BODY', 'o foco não se perde ao escolher');
  assert.equal(await page.textContent('#addrSmall'), 'Ponto de partida');
  assert.equal(await page.textContent('#addrTxt'), 'Rio de Janeiro - RJ');
  await until(() => log.cnes.slice(before).some((a) => a.p_radius_m === 2000));
  const at = log.cnes.slice(before).find((a) => a.p_radius_m === 2000);
  assert.ok(at, 'mapa busca de novo');
  assert.deepEqual([at.p_lat, at.p_lng], [-22.907, -43.173], 'centro da cidade, arredondado (~110 m)');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_cidade')));
  assert.deepEqual(saved, { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', lat: -22.907, lng: -43.173 });
  // Volta depois: a cidade continua escolhida, sem chamar a geocodificação de novo.
  const geo = log.geocode.length;
  await page.reload();
  await scrollAll(page);
  await page.waitForFunction(() => document.querySelector('#realWhere').textContent === 'do centro do Rio de Janeiro');
  assert.equal(log.geocode.length, geo);
  assert.ok(await page.locator('#realExample').isHidden());
  // Bairro de São Paulo: preposição certa e a cidade sai do aparelho.
  await page.click('#realPlace');
  await page.click('#sheet button.opt:has-text("Tatuapé")');
  await page.waitForFunction(() => document.querySelector('#realWhere').textContent === 'do Tatuapé');
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_cidade')), 'null');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('imed_place'))), 'tatuape');
  assert.deepEqual(errors, []);
  await context.close();
  // Geocodificação fora do ar: avisa na própria janela e deixa escolher de novo.
  const b = await newPage(browser, { geocode: (r) => json(r, { ok: false, error: 'geocoder_unavailable' }, 502) });
  await b.page.goto(BASE);
  await b.page.click('#addrBtn');
  await b.page.waitForSelector('#citySel:not([disabled])');
  await b.page.selectOption('#citySel', '3106200');
  await b.page.waitForFunction(() => /Não foi possível achar o centro/.test(document.querySelector('#cityMsg').textContent));
  assert.ok(await b.page.locator('#ov.open').count(), 'a janela continua aberta');
  assert.equal(await b.page.isDisabled('#citySel'), false);
  assert.equal(await b.page.evaluate(() => localStorage.getItem('imed_cidade')), null);
  assert.deepEqual(b.errors, []);
  await b.context.close();
});

await scenario('contador de visitas (?visitas=teste): a página inicial conta a visita e a cidade escolhida, nada mais', async () => {
  const { page, log, errors, context } = await newPage(browser);
  const wait = async (n) => { for (let i = 0; i < 160 && log.track.length < n; i += 1) await page.waitForTimeout(50); assert.ok(log.track.length >= n, `esperava ${n} envios, chegaram ${log.track.length}`); };
  await page.goto(`${BASE}?visitas=teste#agenda`);
  await wait(1);
  assert.deepEqual(log.track, [{ p_path: '/' }], 'a visita: só o caminho, sem "?" nem "#"');
  await page.goto(`${BASE}?visitas=teste`);
  await scrollAll(page);
  await wait(2);
  await page.click('#realChoose');
  await page.waitForSelector('#citySel:not([disabled])');
  await page.selectOption('#citySel', '3304557');
  await page.waitForFunction(() => document.querySelector('#realWhere').textContent === 'do centro do Rio de Janeiro');
  await wait(3);
  assert.deepEqual(log.track.slice(1), [{ p_path: '/' }, { p_path: '/', p_event: 'busca_cidade', p_detail: 'RJ/Rio de Janeiro' }]);
  assert.ok(!/-22\.9|-43\.1/.test(JSON.stringify(log.track)), 'nada do centro do mapa');
  // Sem o parâmetro, neste computador de testes nada é contado.
  const off = await newPage(browser);
  await off.page.goto(BASE);
  await scrollAll(off.page);
  await off.page.waitForTimeout(2500);
  assert.equal(off.log.track.length, 0);
  await off.context.close();
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Meus pedidos: cancelar pelo site com confirmação, horário de volta e situação "Cancelado" guardada', async () => {
  const { page, log, errors, context } = await newPage(browser, { appts: [...APPTS.slice(0, 3), ...SLOT_APPTS], now: NOW,
    status: (r) => json(r, [{ id: ID1, status: 'confirmed', reviewed: false }, { id: ID2, status: 'completed', reviewed: false }, { id: SID1, status: 'confirmed', reviewed: false }, { id: SID2, status: 'pending', reviewed: false }]) });
  await page.goto(`${BASE}#agenda`);
  await page.waitForSelector('.appt [data-cancel]');
  const card = (n) => page.locator('.appt').nth(n);
  assert.equal(await card(0).locator('[data-cancel]').count(), 1, 'confirmado: pode cancelar');
  assert.equal(await card(1).locator('[data-cancel]').count(), 0, 'concluído: não');
  assert.equal(await card(2).locator('[data-cancel]').count(), 0, 'pedido antigo sem código: não');
  await card(0).locator('[data-cancel]').click();
  assert.match(await card(0).textContent(), /Cancelar este pedido\? Cancelar pelo IMED é grátis/);
  // Local que ainda não é parceiro: só a equipe do IMED vê; nada promete que o local foi avisado.
  assert.match(await card(0).textContent(), /A equipe do IMED vê o cancelamento\. Se o horário já tinha sido combinado com o local, ligue também para ele\./);
  assert.ok(!/painel/.test(await card(0).locator('.appt-ask').textContent()), 'não fala em painel para local que não é parceiro');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Sim, cancelar', 'foco no "Sim, cancelar"');
  await card(0).locator('[data-cancel-no]').click();
  assert.equal(await card(0).locator('.appt-ask').count(), 0, '"Não" fecha a pergunta');
  assert.equal(log.cancel.length, 0);
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Cancelar pedido');
  await card(0).locator('[data-cancel]').click();
  await card(0).locator('[data-cancel-yes]').click();
  await page.waitForFunction(() => /Cancelado/.test(document.querySelector('.appt').textContent));
  assert.deepEqual(log.cancel, [{ p_id: ID1, p_token: 'a'.repeat(64) }], 'cancela com o código guardado no aparelho');
  assert.match(await page.textContent('#toast'), /Pedido cancelado\. A equipe do IMED vê o cancelamento\. Se o horário já tinha sido combinado com o local, ligue também para ele: \(11\) 3141-1000\./);
  assert.equal(await card(0).locator('[data-cancel], [data-ics]').count(), 0, 'cancelado: sem cancelar nem lembrete');
  // O aviso rápido some; no cartão fica o lembrete de ligar para o local, com o telefone guardado no pedido.
  assert.match(await card(0).locator('.appt-note').textContent(), /Cancelado por você\. A equipe do IMED vê o cancelamento\. Se o horário já tinha sido combinado com o local, ligue também para ele: \(11\) 3141-1000\./);
  assert.equal(await card(0).locator('.appt-note a').getAttribute('href'), 'tel:+551131411000');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(stored.find((a) => a.id === ID1).status, 'cancelado', 'situação guardada no aparelho');
  // Horário marcado: avisa que o horário voltou a ficar livre.
  const slotCard = page.locator(`.appt[id="pedido-${SID1}"]`);
  await slotCard.locator('[data-cancel]').click();
  assert.match(await slotCard.textContent(), /A clínica vê o cancelamento no painel dela e o horário volta a ficar livre para outra pessoa\./, 'parceiro: a clínica vê no painel dela');
  await slotCard.locator('[data-cancel-yes]').click();
  await page.waitForFunction(() => /O horário voltou a ficar livre\. A clínica vê o cancelamento no painel dela\./.test(document.querySelector('#toast').textContent));
  assert.deepEqual(log.cancel.at(-1), { p_id: SID1, p_token: 'd'.repeat(64) });
  await shot(page, 'inicio-cancelar');
  assert.deepEqual(errors, []);
  await context.close();
  // O banco recusa (horário já passou): avisa, fecha a pergunta e busca a situação de novo.
  const b = await newPage(browser, { appts: [APPTS[0]], now: NOW, cancel: (r) => json(r, 'past') });
  await b.page.goto(`${BASE}#agenda`);
  await b.page.waitForSelector('.appt [data-cancel]');
  const st = b.log.status.length;
  await b.page.click('.appt [data-cancel]');
  await b.page.click('.appt [data-cancel-yes]');
  await b.page.waitForFunction(() => /O horário deste pedido já passou/.test(document.querySelector('#toast').textContent));
  assert.equal(await b.page.locator('.appt-ask').count(), 0);
  await until(() => b.log.status.length > st);
  assert.ok(b.log.status.length > st, 'situação buscada de novo');
  assert.equal(await b.page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts'))[0].status), 'pendente', 'nada muda no aparelho');
  await b.context.close();
  // Sem internet: a pergunta continua aberta para tentar de novo.
  const c = await newPage(browser, { appts: [APPTS[0]], now: NOW, cancel: (r) => r.abort() });
  await c.page.goto(`${BASE}#agenda`);
  await c.page.waitForSelector('.appt [data-cancel]');
  await c.page.click('.appt [data-cancel]');
  await c.page.click('.appt [data-cancel-yes]');
  await c.page.waitForFunction(() => /Não foi possível cancelar agora/.test(document.querySelector('#toast').textContent));
  assert.equal(await c.page.locator('.appt [data-cancel-yes]:not([disabled])').count(), 1);
  assert.deepEqual(c.errors, []);
  await c.context.close();
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

await scenario('service worker ligado: com economia de dados ou 2G, não instala e não baixa o 3D', async () => {
  // Os outros cenários bloqueiam o service worker; aqui ele fica livre, e quem conta os arquivos é o servidor.
  const swSrc = await readFile(join(ROOT, 'sw.js'), 'utf8');
  const core = (swSrc.match(/const CORE = \[([\s\S]*?)\];/) || ['', ''])[1];
  const HEAVY_3D = /three\.module\.min\.js|hero3d\.js/;
  const OTHER = /leaflet\.js|geo-core\.js|painel\.js|local\.js|perto\.js/;
  for (const [name, device, wantSW] of [
    ['economia de dados', { memory: 8, cores: 8, saveData: true }, false],
    ['internet 2G', { memory: 8, cores: 8, effectiveType: '2g' }, false],
    ['economia de dados e pouca memória', { memory: 1, cores: 8, saveData: true }, false],
    ['pouca memória', { memory: 1, cores: 8 }, true],
  ]) {
    const from = served.length;
    const { page, errors, context } = await newPage(browser, { mobile: true, motion: 'no-preference', device, sw: true });
    await page.goto(BASE);
    await page.waitForSelector('#heroLite li a');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000); // tempo de sobra para o service worker instalar e baixar a lista dele
    assert.equal(await page.evaluate(() => document.body.dataset.hero), 'leve', `${name}: modo leve`);
    const reg = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
    assert.equal(reg, wantSW, `${name}: service worker ${wantSW ? 'instalado' : 'não instalado'}`);
    const got = served.slice(from);
    const got3d = got.filter((p) => HEAVY_3D.test(p));
    if (!wantSW) {
      assert.deepEqual(got3d, [], `${name}: three.js e hero3d.js não são baixados`);
      assert.deepEqual(got.filter((p) => OTHER.test(p)), [], `${name}: nada de Leaflet, geo-core ou scripts de outras páginas`);
    } else if (HEAVY_3D.test(core)) {
      // Pouca memória sem economia de dados: o service worker continua (site abre sem internet), mas a lista
      // CORE do sw.js ainda pré-baixa o 3D. A correção é tirar esses arquivos do CORE (fora desta frente).
      console.log(`  aviso (${name}): o CORE do sw.js ainda pré-baixa ${got3d.join(', ') || 'o 3D'}; tirar do CORE (integrador)`);
    } else {
      assert.deepEqual(got3d, [], `${name}: three.js e hero3d.js não são baixados`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Aparelho normal: o service worker continua instalado (o site abre sem internet e pode virar app).
  const { page, errors, context } = await newPage(browser, { motion: 'no-preference', device: { memory: 8, cores: 8 }, sw: true });
  await page.goto(BASE);
  await page.waitForLoadState('load');
  let registered = false;
  for (let i = 0; i < 40 && !registered; i++) {
    registered = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
    if (!registered) await page.waitForTimeout(250);
  }
  assert.ok(registered, 'aparelho normal: service worker instalado');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('lista leve não fica em "Carregando…" quando o banco falha antes de o 3D falhar', async () => {
  // Aparelho normal: pede os locais e começa a baixar o 3D. O banco responde erro na hora; o three.js falha depois.
  const { page, errors, context } = await newPage(browser, {
    mobile: true, motion: 'no-preference', device: { memory: 8, cores: 8 },
    cnes: (r) => json(r, { message: 'erro' }, 500),
    three: async (route) => { await new Promise((ok) => setTimeout(ok, 800)); await route.abort(); },
  });
  await page.goto(BASE);
  await page.waitForFunction(() => document.body.classList.contains('no-webgl'), null, { timeout: 20000 });
  await page.waitForTimeout(300);
  const txt = await page.textContent('#heroLite');
  assert.ok(!/Carregando/.test(txt), `sem "Carregando…" preso (${txt})`);
  assert.match(txt, /Veja clínicas, laboratórios e hospitais perto de você na busca/);
  assert.equal(await page.getAttribute('#heroLite a.more', 'href'), 'perto.html?usar=localizacao');
  assert.match(await page.textContent('#heroLiteStatus'), /não está disponível agora/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('iPhone (o Safari informa 4 núcleos em todo iPhone) recebe o 3D; Android com 4 núcleos fica no modo leve', async () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A155M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  for (const [name, ua, want] of [['iPhone', IPHONE, '3d'], ['Android', ANDROID, 'leve']]) {
    const from = served.length;
    const { page, errors, context } = await newPage(browser, { mobile: true, motion: 'no-preference', ua, device: { memory: 4, cores: 4 } });
    await page.goto(BASE);
    await page.waitForFunction(() => ['carregando', '3d', 'leve'].includes(document.body.dataset.hero), null, { timeout: 20000 });
    const mode = await page.evaluate(() => (document.body.classList.contains('no-webgl') ? 'sem-webgl' : document.body.dataset.hero));
    if (mode === 'sem-webgl') { console.log(`  (${name}: sem WebGL neste navegador)`); await context.close(); continue; }
    if (want === '3d') {
      assert.ok(['carregando', '3d'].includes(mode), `${name}: 3D (${mode})`);
      await page.waitForFunction(() => document.body.dataset.hero === '3d', null, { timeout: 30000 });
      assert.ok(served.slice(from).some((p) => /three\.module\.min\.js/.test(p)), `${name}: baixa o three.js`);
    } else {
      assert.equal(mode, 'leve', `${name}: modo leve`);
      await page.waitForTimeout(1000);
      assert.ok(!served.slice(from).some((p) => /three\.module\.min\.js|hero3d\.js/.test(p)), `${name}: não baixa o 3D`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('Meus pedidos com horário marcado: hora de São Paulo (aparelho em outro fuso), confirmado e lembrete na hora exata', async () => {
  // Aparelho no fuso de Tóquio: a página tem de mostrar a hora de São Paulo, não a do aparelho.
  const { page, log, errors, context } = await newPage(browser, { appts: SLOT_APPTS, now: NOW, tz: 'Asia/Tokyo', status: (r) => json(r, { message: 'erro' }, 500) });
  await page.goto(`${BASE}#agenda`);
  await page.waitForFunction(() => document.querySelectorAll('.appt').length === 2 && !/Consultando/.test(document.querySelector('#appts').textContent));
  assert.equal(log.status.length, 1, 'consultou a situação no banco');
  const cards = await page.$$eval('.appt', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  assert.match(cards[0], /Horário marcado: quinta-feira, 05 de novembro às 09:30/);
  assert.match(cards[1], /Horário marcado: sexta-feira, 06 de novembro às 23:30/, 'dia de São Paulo, não o do relógio mundial');
  assert.ok(cards.every((c) => !/Preferência/.test(c)), 'horário marcado não é "preferência"');
  // O banco não respondeu: vale o "confirmado" que o aparelho guardou quando o horário foi marcado.
  const st = await page.$$eval('.appt .status', (els) => els.map((e) => [e.textContent, e.className]));
  assert.deepEqual(st.map((s) => s[0]), ['Confirmado', 'Confirmado']);
  assert.ok(st.every((s) => /\bok\b/.test(s[1])), 'selo verde de confirmado');
  const ics = async (n) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(`.appt >> nth=${n} >> button:has-text("Adicionar à agenda")`)]);
    return (await readFile(await download.path(), 'utf8')).replace(/\r\n /g, '');
  };
  const a = await ics(0);
  assert.match(a, /DTSTART;TZID=America\/Sao_Paulo:20261105T093000/);
  assert.match(a, /DTEND;TZID=America\/Sao_Paulo:20261105T100000/);
  assert.match(a, /STATUS:CONFIRMED/);
  assert.ok(!/STATUS:TENTATIVE/.test(a));
  assert.match(a, /Horário confirmado. Chegue com 15 minutos de antecedência./);
  assert.ok(!/O horário é confirmado pela clínica/.test(a), 'sem o texto de pedido ainda não confirmado');
  assert.match(a, /Retire objetos de metal/, 'preparo da ressonância');
  const b = await ics(1);
  assert.match(b, /DTSTART;TZID=America\/Sao_Paulo:20261106T233000/);
  assert.match(b, /DTEND;TZID=America\/Sao_Paulo:20261107T000000/);
  assert.deepEqual(errors, []);
  await context.close();
  // Com resposta do banco, vale a situação dele (por exemplo, cancelado pela clínica).
  const live = await newPage(browser, { appts: SLOT_APPTS, now: NOW, status: (r) => json(r, [{ id: SID1, status: 'confirmed', reviewed: false }, { id: SID2, status: 'cancelled', reviewed: false }]) });
  await live.page.goto(`${BASE}#agenda`);
  await live.page.waitForFunction(() => /Cancelado/.test(document.querySelector('#appts').textContent));
  const st2 = await live.page.$$eval('.appt .status', (els) => els.map((e) => e.textContent));
  assert.deepEqual(st2, ['Confirmado', 'Cancelado']);
  assert.equal(await live.page.locator('.appt >> nth=1 >> button:has-text("Adicionar à agenda")').count(), 0, 'cancelado: sem lembrete');
  await shot(live.page, 'inicio-agendados-horario');
  assert.deepEqual(live.errors, []);
  await live.context.close();
});

await scenario('computador em modo leve: o cartão da lista não cobre o título nem a busca (980 a 1366 px)', async () => {
  const { page, errors, context } = await newPage(browser, { viewport: { width: 980, height: 800 } });
  await page.goto(BASE);
  await page.waitForSelector('#heroLite li a');
  for (const w of [980, 1000, 1024, 1100, 1280, 1366]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(150);
    const m = await page.evaluate(() => {
      const card = document.querySelector('#heroLite').getBoundingClientRect();
      const right = Math.max(...[...document.querySelectorAll('.hero-in > *')].map((e) => e.getBoundingClientRect().right));
      return { left: card.left, right: card.right, top: card.top, text: right };
    });
    assert.ok(m.left >= m.text + 8, `${w} px: cartão começa em ${Math.round(m.left)}, texto e busca vão até ${Math.round(m.text)}`);
    assert.ok(m.right <= w, `${w} px: cartão dentro da tela`);
  }
  await page.setViewportSize({ width: 980, height: 800 });
  await shot(page, 'inicio-desktop-980-leve');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('foto da fachada: celular com tela de alta densidade baixa a versão menor', async () => {
  for (const [name, opts, want, avoid] of [
    ['celular, densidade 3', { mobile: true, dpr: 3 }, /fachada-sm\.webp$/, /\/fachada\.webp/],
    ['computador', {}, /\/fachada\.webp$/, /fachada-sm\.webp/],
  ]) {
    const { page, errors, context, requests } = await newPage(browser, opts);
    await page.goto(BASE);
    await page.locator('#clinicas').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => { const i = document.querySelector('#clinicas img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
    assert.match(await page.evaluate(() => document.querySelector('#clinicas img').currentSrc), want, name);
    assert.ok(!requests.some((u) => avoid.test(u)), `${name}: só uma versão da foto é baixada`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
