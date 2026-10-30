// Teste de ponta a ponta de "Minha conta" (conta.html) e das páginas por cidade (cidades/**),
// num navegador de verdade (Playwright), com o Supabase (login, banco e funções) simulado.
// Rodar com: node tests/e2e-conta.mjs   (precisa do pacote "playwright" instalado)
// Opcional: SHOTS=pasta node tests/e2e-conta.mjs  salva capturas de tela nessa pasta.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const REST = `${SUPA}/rest/v1/`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

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
const PORT = Number(process.env.E2E_PORT) || 8769; // E2E_PORT: outra porta para rodar em paralelo
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;

// ---------- dados simulados ----------
const ID = {
  d1: '11111111-1111-4111-8111-111111111111', // aparelho, concluído, sem avaliação
  d2: '22222222-2222-4222-8222-222222222222', // aparelho e conta (não pode duplicar)
  d4: '44444444-4444-4444-8444-444444444444', // aparelho, concluído; servidor diz que já foi avaliado
  a2: '55555555-5555-4555-8555-555555555555', // só na conta, concluído (servidor responde not_completed)
  a3: '66666666-6666-4666-8666-666666666666', // só na conta, cancelado
};
const TOK = { d1: 'a'.repeat(64), d2: 'b'.repeat(64), d4: 'c'.repeat(64) };
const DEVICE = [
  { type: 'pedido', code: 'IMED-11111111', id: ID.d1, token: TOK.d1, place_key: 'cnes:2077485', name: 'Hospital Santa Exemplo', exam: 'rm', items: ['Ressonância'], date: '2026-11-12', period: 'manha', status: 'pendente', created: '2026-10-29T12:00:00.000Z' },
  { type: 'pedido', code: 'IMED-22222222', id: ID.d2, token: TOK.d2, place_key: 'imed:x', name: 'Imagem Paulista', exam: 'tc', items: ['Tomografia'], date: '2026-11-20', period: 'tarde', status: 'pendente', created: '2026-10-28T12:00:00.000Z' },
  { type: 'pedido', code: 'IMED-44444444', id: ID.d4, token: TOK.d4, place_key: 'osm:node/1', name: 'Laboratório Vida', exam: 'lab', items: ['Exames de laboratório'], date: '2026-11-05', period: 'qualquer', status: 'pendente', created: '2026-10-27T12:00:00.000Z' },
  { type: 'pedido', code: 'IMED-OLD12345', name: 'Clínica Antiga', items: ['Raio-X'], date: '2026-10-01', period: 'noite', status: 'pendente', created: '2026-09-20T12:00:00.000Z' },
];
const LIVE = { [ID.d1]: { status: 'completed', reviewed: false }, [ID.d2]: { status: 'pending', reviewed: false }, [ID.d4]: { status: 'completed', reviewed: false } };
const ACCOUNT = [
  { id: ID.a2, created_at: '2026-10-29T15:00:00Z', place_name: 'Centro de Imagem Conta', place_source: 'cnes', place_ref: 'cnes:1', clinic_id: null, exam_code: 'usg', preferred_date: '2026-11-03', preferred_period: 'manha', status: 'completed' },
  { id: ID.d2, created_at: '2026-10-28T12:00:00Z', place_name: 'Imagem Paulista', place_source: 'imed', place_ref: null, clinic_id: 'x', exam_code: 'tc', preferred_date: '2026-11-20', preferred_period: 'tarde', status: 'confirmed' },
  { id: ID.a3, created_at: '2026-10-10T12:00:00Z', place_name: 'Clínica Cancelada', place_source: 'osm', place_ref: 'osm:n/2', clinic_id: null, exam_code: 'consulta', preferred_date: '2026-10-20', preferred_period: 'noite', status: 'cancelled' },
];
// Pedido de outro paciente que o RLS libera para membro de clínica/admin: nunca pode aparecer em "Meus pedidos".
const OTHER_ID = '77777777-7777-4777-8777-777777777777';
const OTHER = { id: OTHER_ID, user_id: 'user-outro', created_at: '2026-10-30T09:00:00Z', place_name: 'Clínica de Terceiro', place_source: 'imed', place_ref: null, clinic_id: 'x', exam_code: 'rm', preferred_date: '2026-11-05', preferred_period: 'manha', status: 'completed' };
const REVIEW_REPLY = { [ID.d1]: 'ok', [ID.d4]: 'already_reviewed', [ID.a2]: 'not_completed' };
const USER = { id: 'user-ana', email: 'ana@exemplo.com' };

// 130 estabelecimentos de "São Paulo" (simulados), em ordem alfabética, com tipos variados.
const KINDS = ['clinica', 'laboratorio', 'imagem', 'hospital'];
const ESTAB = Array.from({ length: 130 }, (_, i) => ({
  cnes: String(2000000 + i), name: `Estabelecimento ${String(i + 1).padStart(3, '0')}${i === 7 ? ' Cardio Vida' : ''}`, kind: KINDS[i % 4],
  address_line: `Rua Exemplo, ${i + 10}`, neighborhood: 'Bela Vista', cep: '01310100', phone: i % 3 === 0 ? '(11) 3141-1000' : (i === 1 ? '3141-2000 ramal 5' : null),
  shift: i % 5 === 0 ? 'Manhã e tarde' : null, open_24h: i % 4 === 3, sus: i % 2 === 0, services: [], lat: -23.56 + i / 10000, lng: -46.65,
}));

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*' } });
const preflight = (route) => route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });

async function newPage(browser, { mobile = false, seed = DEVICE, timezoneId = 'America/Sao_Paulo' } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId,
    serviceWorkers: 'block', acceptDownloads: true,
  });
  await context.addInitScript((list) => {
    try {
      localStorage.setItem('imed_lgpd', '1');
      if (list && !sessionStorage.getItem('semeado')) { localStorage.setItem('imed_appts', JSON.stringify(list)); sessionStorage.setItem('semeado', '1'); }
    } catch { /* ignora */ }
  }, seed);
  const log = { otp: [], status: [], select: [], review: [], city: [], logout: 0 };
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route(`${SUPA}/auth/v1/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return preflight(route);
    const u = new URL(req.url());
    if (u.pathname === '/auth/v1/otp') { log.otp.push({ body: JSON.parse(req.postData()), redirect: u.searchParams.get('redirect_to') }); return json(route, {}); }
    if (u.pathname === '/auth/v1/user') return req.headers().authorization === 'Bearer tok-ana' ? json(route, USER) : json(route, { msg: 'invalid' }, 401);
    if (u.pathname === '/auth/v1/logout') { log.logout++; return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } }); }
    return json(route, { msg: 'não simulado' }, 404);
  });
  await context.route(`${REST}rpc/request_status`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    const b = JSON.parse(route.request().postData());
    log.status.push(b);
    const out = b.p_ids.map((id, i) => ({ id, ok: LIVE[id] && b.p_tokens[i] === TOK[Object.keys(ID).find((k) => ID[k] === id)] }))
      .filter((x) => x.ok).map(({ id }) => ({ id, ...LIVE[id] }));
    return json(route, out);
  });
  await context.route(`${REST}appointment_requests**`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.select.push({ url: route.request().url(), auth: route.request().headers().authorization });
    if (route.request().headers().authorization !== 'Bearer tok-ana') return json(route, []);
    // Simula o RLS: sem filtro por user_id, a Ana (membro de clínica) também recebe o pedido de outro paciente.
    const f = new URL(route.request().url()).searchParams.get('user_id');
    const mine = ACCOUNT.map((r) => ({ ...r, user_id: USER.id }));
    return json(route, f === `eq.${USER.id}` ? mine : [OTHER, ...mine]);
  });
  await context.route(`${REST}rpc/submit_review`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    const b = JSON.parse(route.request().postData());
    log.review.push(b);
    return json(route, REVIEW_REPLY[b.p_request] ?? 'not_found');
  });
  await context.route(`${REST}rpc/city_establishments`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    const b = JSON.parse(route.request().postData());
    log.city.push(b);
    if (log.cityDelay) await new Promise((r) => setTimeout(r, log.cityDelay));
    const all = ESTAB.filter((e) => !b.p_kind || e.kind === b.p_kind);
    return json(route, all.slice(b.p_offset, b.p_offset + b.p_limit).map((e) => ({ ...e, total: all.length })));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, log, errors };
}

const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); } };
const noOverflow = async (page) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(o <= 0, `sem rolagem lateral (${o}px)`);
};
const results = [];
async function scenario(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 5).join('\n  ')}`); }
}
const login = `${BASE}conta.html#access_token=tok-ana&refresh_token=ref-ana&expires_in=3600&token_type=bearer&type=magiclink`;

const browser = await chromium.launch();

await scenario('sem login: pedidos deste aparelho com situação ao vivo e envio do link de entrada', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector('.ct-order');
  assert.equal(await page.isVisible('#signedOut'), true);
  assert.equal(await page.isVisible('#signedIn'), false);
  assert.equal(await page.textContent('#ordersTitle'), 'Pedidos deste aparelho');
  assert.equal(log.status.length, 1);
  assert.deepEqual(log.status[0].p_ids, [ID.d1, ID.d2, ID.d4]);
  assert.deepEqual(log.status[0].p_tokens, [TOK.d1, TOK.d2, TOK.d4]);
  assert.equal(log.select.length, 0, 'sem login não lê pedidos da conta');
  assert.equal(await page.locator('.ct-order').count(), 4);
  const d1 = page.locator(`#pedido-${ID.d1}`);
  assert.equal(await d1.locator('.ct-st').textContent(), 'Concluído');
  assert.match(await d1.textContent(), /Ressonância/);
  assert.match(await d1.textContent(), /IMED-11111111/);
  assert.match(await d1.textContent(), /quinta-feira, 12 de novembro de 2026/);
  assert.match(await d1.textContent(), /Manhã/);
  assert.equal(await d1.locator('[data-review]').count(), 1);
  assert.equal(await page.locator(`#pedido-${ID.d2} .ct-st`).textContent(), 'Aguardando contato');
  assert.equal(await page.locator(`#pedido-${ID.d2} [data-review]`).count(), 0);
  const old = page.locator('.ct-order', { hasText: 'Clínica Antiga' });
  assert.match(await old.locator('.ct-st').textContent(), /confirme com o local/);
  assert.match(await old.textContent(), /IMED-OLD12345/);
  await shot(page, 'conta-01-sem-login');

  await page.fill('#email', 'nao-e-email');
  await page.click('#loginBtn');
  assert.match(await page.textContent('#loginMsg'), /e-mail válido/);
  await page.fill('#email', 'Ana@Exemplo.com');
  await page.click('#loginBtn');
  await page.waitForSelector('#loginMsg.ok');
  assert.match(await page.textContent('#loginMsg'), /Enviamos um link para Ana@Exemplo\.com/);
  assert.equal(log.otp[0].body.email, 'ana@exemplo.com');
  assert.equal(log.otp[0].redirect, `${BASE}conta.html`);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('adicionar à agenda baixa um .ics com data, período, preparo e lembrete', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector(`#pedido-${ID.d1} [data-ics]`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`#pedido-${ID.d1} [data-ics]`)]);
  assert.equal(dl.suggestedFilename(), 'imed-imed-11111111.ics');
  const ics = await readFile(await dl.path(), 'utf8');
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;TZID=America\/Sao_Paulo:20261112T080000/);
  assert.match(ics, /DTEND;TZID=America\/Sao_Paulo:20261112T120000/);
  assert.match(ics, /SUMMARY:Exame: Ressonância — Hospital Santa Exemplo/);
  assert.match(ics.replace(/\r\n /g, ''), /Preparo: Retire objetos de metal/);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  // "Qualquer horário" vira evento de dia inteiro.
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click(`#pedido-${ID.d4} [data-ics]`)]);
  const ics2 = await readFile(await dl2.path(), 'utf8');
  assert.match(ics2, /DTSTART;VALUE=DATE:20261105/);
  assert.match(ics2, /DTEND;VALUE=DATE:20261106/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('reserva com horário: mostra o horário marcado em São Paulo, "Confirmado" e .ics com a hora exata', async () => {
  const SLOT_ID = '88888888-8888-4888-8888-888888888888';
  const seed = [{ type: 'pedido', code: 'IMED-88888888', id: SLOT_ID, token: 'd'.repeat(64), place_key: 'imed:x', name: 'Imagem Paulista', exam: 'rm', items: ['Ressonância'], date: '2026-11-05', period: 'manha', slot: '2026-11-05T12:30:00.000Z', status: 'confirmado', created: '2026-10-30T10:00:00Z' }];
  // Aparelho no fuso de Tóquio: o horário mostrado precisa continuar sendo o de São Paulo (09:30).
  const { page, errors, context } = await newPage(browser, { seed, timezoneId: 'Asia/Tokyo' });
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector(`#pedido-${SLOT_ID}`);
  const card = await page.textContent(`#pedido-${SLOT_ID}`);
  assert.match(card, /Horário marcado/);
  assert.match(card, /5 de novembro de 2026 às 09:30/);
  assert.match(card, /Confirmado/, 'sem a situação ao vivo, mostra o que o aparelho guardou');
  assert.ok(!/Data preferida|Período/.test(card), 'com horário marcado não mostra data preferida nem período');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`#pedido-${SLOT_ID} [data-ics]`)]);
  const ics = (await readFile(await dl.path(), 'utf8')).replace(/\r\n /g, '');
  assert.match(ics, /DTSTART;TZID=America\/Sao_Paulo:20261105T093000/);
  assert.match(ics, /Horário confirmado\. Chegue com 15 minutos de antecedência\./);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('login pelo link (#access_token): pedidos da conta + aparelho, sem duplicar, e sair', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(login);
  await page.waitForSelector('#signedIn:not([hidden])');
  await page.waitForSelector('.ct-order');
  assert.equal(new URL(page.url()).hash, '', 'o token sai do endereço');
  assert.equal(await page.textContent('#meEmail'), 'ana@exemplo.com');
  assert.match(await page.textContent('#flash'), /você entrou/);
  assert.equal(await page.textContent('#ordersTitle'), 'Meus pedidos');
  assert.equal(log.select.length, 1);
  assert.equal(log.select[0].auth, 'Bearer tok-ana');
  const selUrl = new URL(log.select[0].url);
  assert.equal(selUrl.searchParams.get('select'), 'id,user_id,created_at,place_name,place_source,place_ref,clinic_id,exam_code,preferred_date,preferred_period,slot_start,status');
  assert.equal(selUrl.searchParams.get('user_id'), `eq.${USER.id}`, 'filtra pela conta');
  assert.equal(selUrl.searchParams.get('order'), 'created_at.desc');
  assert.equal(selUrl.searchParams.get('limit'), '50');
  assert.equal(await page.locator(`#pedido-${OTHER_ID}`).count(), 0, 'pedido de outro paciente não aparece');
  assert.doesNotMatch(await page.textContent('main'), /Clínica de Terceiro/);
  const ids = await page.$$eval('.ct-order', (els) => els.map((e) => e.id));
  assert.equal(ids.length, 6, 'quatro do aparelho + duas só da conta');
  assert.equal(ids.filter((x) => x === `pedido-${ID.d2}`).length, 1, 'pedido que está nos dois aparece uma vez');
  assert.equal(ids[0], `pedido-${ID.a2}`, 'mais novo primeiro');
  assert.equal(await page.locator(`#pedido-${ID.d2} .ct-st`).textContent(), 'Confirmado', 'situação da conta');
  assert.match(await page.locator(`#pedido-${ID.d2} .ct-where`).textContent(), /Na conta e neste aparelho/);
  assert.equal(await page.locator(`#pedido-${ID.a3} .ct-st`).textContent(), 'Cancelado');
  assert.match(await page.locator(`#pedido-${ID.a3}`).textContent(), /Consulta/);
  assert.match(await page.locator(`#pedido-${ID.a2}`).textContent(), /IMED-55555555/);
  await shot(page, 'conta-02-logado');
  await page.click('#logoutBtn');
  await page.waitForSelector('#signedOut:not([hidden])');
  assert.equal(log.logout, 1);
  assert.equal(await page.textContent('#ordersTitle'), 'Pedidos deste aparelho');
  await page.waitForFunction(() => document.querySelectorAll('.ct-order').length === 4);
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_session')), null);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('avaliar pelo link #pedido-<id>: estrelas acessíveis, comentário e agradecimento', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}conta.html#pedido-${ID.d1}`);
  await page.waitForSelector(`#rv-${ID.d1}:not([hidden])`);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('type'));
  assert.equal(focused, 'radio', 'foco vai para as estrelas');
  assert.equal(await page.locator(`#rv-${ID.d1} input[type=radio]`).count(), 5);
  assert.equal(await page.locator(`#rv-${ID.d1}`).getByLabel('4 estrelas').count(), 1);
  // Enviar sem nota pede a nota e não chama o banco.
  await page.click(`#rv-${ID.d1} button[type=submit]`);
  assert.match(await page.textContent(`#rv-${ID.d1} .ct-msg`), /de 1 a 5 estrelas/);
  assert.equal(log.review.length, 0);
  // Teclado: setas mudam a nota.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator(`#rv-${ID.d1} .ct-stars`).getAttribute('data-v'), '4');
  await page.fill(`#rv-${ID.d1} textarea`, '  Atendimento rápido e equipe atenciosa.  ');
  assert.match(await page.textContent(`#rv-${ID.d1} small`), /42 de 500/);
  await shot(page, 'conta-03-avaliar');
  await page.click(`#rv-${ID.d1} button[type=submit]`);
  await page.waitForSelector(`#pedido-${ID.d1} .ct-thanks`);
  assert.deepEqual(log.review[0], { p_request: ID.d1, p_token: TOK.d1, p_rating: 4, p_comment: 'Atendimento rápido e equipe atenciosa.' });
  assert.match(await page.textContent(`#pedido-${ID.d1} .ct-thanks`), /Obrigado pela avaliação/);
  assert.equal(await page.locator(`#pedido-${ID.d1} [data-review]`).count(), 0);
  // Já avaliado (servidor): mensagem clara.
  await page.click(`#pedido-${ID.d4} [data-review]`);
  await page.click(`#rv-${ID.d4} label[for="r-${ID.d4}-5"]`);
  await page.click(`#rv-${ID.d4} button[type=submit]`);
  await page.waitForSelector(`#pedido-${ID.d4} .ct-thanks`);
  assert.match(await page.textContent(`#pedido-${ID.d4} .ct-thanks`), /já foi avaliado/);
  assert.deepEqual(log.review[1], { p_request: ID.d4, p_token: TOK.d4, p_rating: 5, p_comment: null });
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pedido da conta: avaliação sem código do aparelho e mensagem de "ainda não concluído"', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(login);
  await page.waitForSelector(`#pedido-${ID.a2} [data-review]`);
  await page.click(`#pedido-${ID.a2} [data-review]`);
  assert.equal(await page.getAttribute(`#pedido-${ID.a2} [data-review]`, 'aria-expanded'), 'true');
  await page.click(`#rv-${ID.a2} label[for="r-${ID.a2}-2"]`);
  await page.click(`#rv-${ID.a2} button[type=submit]`);
  await page.waitForFunction((id) => !document.querySelector(`#rv-${id} .ct-msg`).hidden, ID.a2);
  assert.deepEqual(log.review[0], { p_request: ID.a2, p_token: '', p_rating: 2, p_comment: null });
  assert.match(await page.textContent(`#rv-${ID.a2} .ct-msg`), /depois que o local marcar o atendimento como concluído/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('apagar pedidos deste aparelho pede confirmação e limpa a lista', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector('.ct-order');
  await page.click('#clearBtn');
  assert.equal(await page.isVisible('#clearConfirm'), true);
  await page.click('#clearNo');
  assert.equal(await page.isVisible('#clearConfirm'), false);
  assert.ok(await page.evaluate(() => localStorage.getItem('imed_appts')));
  await page.click('#clearBtn');
  await page.click('#clearYes');
  await page.waitForSelector('.ct-empty');
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_appts')), null);
  assert.equal(await page.isDisabled('#clearBtn'), true);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('página da cidade: lista do banco, carregar mais, abas por tipo, busca e reivindicar', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}cidades/sp/sao-paulo/`);
  await page.waitForSelector('.cd-item');
  assert.match(await page.title(), /^6\.548 clínicas, laboratórios e hospitais em São Paulo - SP \| IMED$/);
  assert.deepEqual(log.city[0], { p_city: 3550308, p_kind: null, p_limit: 60, p_offset: 0 });
  assert.equal(await page.locator('.cd-item').count(), 60);
  assert.match(await page.textContent('#cdCount'), /Mostrando 60 de 130/);
  const first = page.locator('.cd-item').first();
  assert.match(await first.textContent(), /Estabelecimento 001/);
  assert.match(await first.textContent(), /Rua Exemplo, 10 · Bela Vista · CEP 01310-100/);
  assert.equal(await first.locator('a.tel').getAttribute('href'), 'tel:+551131411000');
  const second = page.locator('.cd-item').nth(1);
  assert.match(await second.textContent(), /3141-2000 ramal 5/, 'telefone que não vira link continua aparecendo');
  assert.equal(await second.locator('a.tel').count(), 0);
  assert.match(await first.textContent(), /Atende SUS/);
  assert.match(await first.textContent(), /Turno: Manhã e tarde/);
  const claim = first.locator('a.claim');
  assert.equal(await claim.getAttribute('href'), '../../../reivindicar.html?cnes=2000000');
  assert.equal(await claim.evaluate((a) => a.href), `${BASE}reivindicar.html?cnes=2000000`);
  assert.match(await first.locator('a', { hasText: 'Ver no mapa' }).getAttribute('href'), /^https:\/\/www\.openstreetmap\.org\/\?mlat=-23\.560000&mlon=-46\.650000/);
  assert.equal(await first.locator('a', { hasText: 'Ficha oficial' }).getAttribute('href'), 'https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/3550302000000');
  assert.equal(await page.evaluate(() => new URL(document.querySelector('.cd-hero .btn-coral').href).pathname), '/perto.html');
  await shot(page, 'cidade-01-sao-paulo');

  await page.click('#cdMore');
  await page.waitForFunction(() => document.querySelectorAll('.cd-item').length === 120);
  assert.deepEqual(log.city[1], { p_city: 3550308, p_kind: null, p_limit: 60, p_offset: 60 });
  await page.click('#cdMore');
  await page.waitForFunction(() => document.querySelectorAll('.cd-item').length === 130);
  assert.equal(await page.isHidden('#cdMore'), true, 'acabou a lista: some o botão');

  await page.fill('#cdQ', 'cardio');
  await page.waitForFunction(() => document.querySelectorAll('.cd-item').length === 1);
  assert.match(await page.textContent('.cd-item h3'), /Cardio Vida/);
  assert.match(await page.textContent('#cdCount'), /1 de 130 carregados/);
  await page.fill('#cdQ', '');

  await page.click('.cd-tab[data-kind="hospital"]');
  await page.waitForFunction(() => document.querySelectorAll('.cd-item').length === 32);
  assert.deepEqual(log.city.at(-1), { p_city: 3550308, p_kind: 'hospital', p_limit: 60, p_offset: 0 });
  assert.equal(await page.getAttribute('.cd-tab[data-kind="hospital"]', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('.cd-tab[data-kind=""]', 'aria-pressed'), 'false');
  const kinds = await page.$$eval('.cd-kind', (els) => [...new Set(els.map((e) => e.textContent.trim()))]);
  assert.deepEqual(kinds, ['Hospital']);
  const calls = log.city.length;
  await page.click('.cd-tab[data-kind=""]');
  await page.waitForFunction(() => document.querySelectorAll('.cd-item').length === 130);
  assert.equal(log.city.length, calls, 'volta para "Todos" sem buscar de novo');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('página da cidade: trocar de aba durante a carga não é ignorado', async () => {
  const { page, log, errors, context } = await newPage(browser);
  log.cityDelay = 600;
  await page.goto(`${BASE}cidades/sp/sao-paulo/`);
  await page.waitForFunction(() => document.querySelector('#cdList')?.getAttribute('aria-busy') === 'true');
  await page.click('.cd-tab[data-kind="laboratorio"]');
  assert.equal(await page.getAttribute('.cd-tab[data-kind="laboratorio"]', 'aria-pressed'), 'true', 'aba marcada na hora');
  assert.equal(await page.getAttribute('.cd-tab[data-kind=""]', 'aria-pressed'), 'false');
  await page.waitForFunction(() => document.querySelectorAll('.cd-item').length === 33);
  assert.deepEqual(log.city.map((c) => c.p_kind), [null, 'laboratorio']);
  const kinds = await page.$$eval('.cd-kind', (els) => [...new Set(els.map((e) => e.textContent.trim()))]);
  assert.deepEqual(kinds, ['Laboratório']);
  assert.equal(await page.getAttribute('#cdList', 'aria-busy'), null);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('página por tipo, índice das cidades e celular (390 px) sem rolagem lateral', async () => {
  const { page, log, errors, context } = await newPage(browser, { mobile: true });
  await page.goto(`${BASE}cidades/sp/sao-paulo/hospitais.html`);
  await page.waitForSelector('.cd-item');
  assert.deepEqual(log.city[0], { p_city: 3550308, p_kind: 'hospital', p_limit: 60, p_offset: 0 });
  assert.match(await page.title(), /^289 hospitais em São Paulo - SP/);
  await noOverflow(page);
  await shot(page, 'cidade-02-celular-hospitais');
  await page.goto(`${BASE}cidades/`);
  assert.equal(await page.locator('.cd-state h2', { hasText: 'Distrito Federal' }).count(), 1);
  await page.click('a:has-text("Campinas")');
  await page.waitForSelector('.cd-item');
  assert.equal(new URL(page.url()).pathname, '/cidades/sp/campinas/');
  assert.equal(log.city.at(-1).p_city, 3509502);
  await noOverflow(page);
  await page.goto(`${BASE}cidades/`);
  await noOverflow(page);
  await shot(page, 'cidade-03-celular-indice');
  await page.goto(`${BASE}conta.html#pedido-${ID.d1}`);
  await page.waitForSelector(`#rv-${ID.d1}:not([hidden])`);
  await noOverflow(page);
  await shot(page, 'conta-04-celular-avaliar');
  await page.goto('about:blank');
  await page.goto(login);
  await page.waitForSelector('#signedIn:not([hidden])');
  await page.waitForSelector('.ct-order');
  await noOverflow(page);
  await shot(page, 'conta-05-celular-logado');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pedido que não está no aparelho: aviso para entrar na conta', async () => {
  const { page, errors, context } = await newPage(browser, { seed: [] });
  await page.goto(`${BASE}conta.html#pedido-${ID.a2}`);
  await page.waitForSelector('#flash:not([hidden])');
  assert.match(await page.textContent('#flash'), /entre com seu e-mail/);
  assert.equal(await page.locator('.ct-empty').count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
