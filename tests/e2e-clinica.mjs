// Teste de ponta a ponta das páginas da clínica (reivindicar.html e painel.html) num navegador de
// verdade (Playwright), com o Supabase (login, banco e funções) simulado.
// Rodar com: node tests/e2e-clinica.mjs   (precisa do pacote "playwright" instalado)
// Opcional: SHOTS=pasta node tests/e2e-clinica.mjs  salva capturas de tela nessa pasta.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const PORT = Number(process.env.E2E_PORT) || 8768; // E2E_PORT: outra porta para rodar em paralelo
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
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

// ---------- dados simulados ----------
const USER_ID = 'uuuuuuuu-0000-4000-8000-000000000001';
const C1 = 'cccccccc-0000-4000-8000-000000000001';
const SP = 3550308;
const ESTABLISHMENTS = [
  { cnes: '2077485', name: 'Hospital Santa Exemplo', kind: 'hospital', address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César', cep: '01409001', city_ibge: SP },
  { cnes: '6543210', name: 'Laboratório Análise Paulista', kind: 'laboratorio', address_line: 'Alameda Santos, 200', neighborhood: 'Bela Vista', cep: '01418000', city_ibge: SP },
  { cnes: '1112223', name: 'Clínica Santa <b>Luz</b>', kind: 'clinica', address_line: 'Rua Augusta, 10', neighborhood: 'Consolação', cep: null, city_ibge: SP },
];
const MUNICIPALITIES = [{ ibge: SP, name: 'São Paulo', uf: 'SP', cnes_code: 355030 }, { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', cnes_code: 330455 }];
const CITIES = [
  { ibge: SP, name: 'São Paulo', uf: 'SP', total: 3, imagem: 0, laboratorio: 1, clinica: 1, hospital: 1 },
  { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', total: 0, imagem: 0, laboratorio: 0, clinica: 0, hospital: 0 },
];
const CLINIC = {
  id: C1, name: 'Imagem Paulista', kind: 'imagem', description: null, address_line: 'Av. Paulista, 1500', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: '01310-200',
  phone: null, whatsapp: null, email: null, website: null, specialties: ['Radiologia'], opening_hours: null, accepts_online_booking: true, status: 'published', is_demo: false, insurances: ['Amil', 'Plano Antigo'], cnes: '7654321',
};
const REQUESTS = [
  { id: 'rrrrrrrr-0000-4000-8000-000000000001', clinic_id: C1, created_at: '2026-10-29T13:05:00Z', exam_code: 'rm', preferred_date: '2026-11-05', preferred_period: 'manha', patient_name: 'Maria Souza', patient_phone: '11987654321', patient_email: 'maria@exemplo.com', notes: 'Tenho claustrofobia <img src=x onerror="window.__xss=1">', status: 'pending' },
  { id: 'rrrrrrrr-0000-4000-8000-000000000002', clinic_id: C1, created_at: '2026-10-28T18:00:00Z', exam_code: 'tc', preferred_date: '2026-11-03', preferred_period: 'qualquer', patient_name: 'João Lima', patient_phone: '1133334444', patient_email: null, notes: null, status: 'confirmed' },
];
const IMED_REQUESTS = [
  { id: 'rrrrrrrr-0000-4000-8000-000000000010', clinic_id: null, created_at: '2026-10-29T15:00:00Z', exam_code: 'usg', preferred_date: '2026-11-06', preferred_period: 'tarde', patient_name: 'Ana Prado', patient_phone: '21998887777', patient_email: null, notes: null, status: 'pending', place_source: 'cnes', place_ref: 'cnes:2077485', place_name: 'Hospital Santa Exemplo', place_address: 'Rua Peixoto Gomide, 625', place_phone: '(11) 3141-1000' },
];
const CLAIMS = [
  { id: 'kkkkkkkk-0000-4000-8000-000000000001', created_at: '2026-10-29T10:00:00Z', cnes: '2077485', user_id: 'x', email: 'dono@hospital.com.br', claimant_name: 'Carlos Dono', role: 'proprietario', document: '52998224725', crm: '123456-SP', phone: '11987650000', message: 'Sou o dono <script>alert(1)</script>', status: 'pending', decided_at: null, decision_note: null, clinic_id: null },
  { id: 'kkkkkkkk-0000-4000-8000-000000000002', created_at: '2026-10-29T11:00:00Z', cnes: '6543210', user_id: 'y', email: 'ger@lab.com.br', claimant_name: 'Paula Gerente', role: 'gestor', document: '11222333000181', crm: null, phone: '1130002000', message: null, status: 'pending', decided_at: null, decision_note: null, clinic_id: null },
  { id: 'kkkkkkkk-0000-4000-8000-000000000003', created_at: '2026-10-20T11:00:00Z', cnes: '1112223', user_id: 'z', email: 'a@b.com', claimant_name: 'Velho Pedido', role: 'outro', document: '52998224725', crm: null, phone: '1130002000', message: null, status: 'rejected', decided_at: '2026-10-21T11:00:00Z', decision_note: 'Sem vínculo', clinic_id: null },
];

const clone = (x) => JSON.parse(JSON.stringify(x));
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });

// Filtros do PostgREST usados pelas páginas: eq, neq, in, is.null, ilike.
function applyFilters(rows, q) {
  let out = rows;
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    if (op === 'eq') out = out.filter((r) => String(r[k]) === val);
    else if (op === 'neq') out = out.filter((r) => String(r[k]) !== val);
    else if (op === 'is' && val === 'null') out = out.filter((r) => r[k] == null);
    else if (op === 'gte') out = out.filter((r) => { const a = Date.parse(r[k]); const b = Date.parse(val); return Number.isNaN(a) || Number.isNaN(b) ? String(r[k]) >= val : a >= b; });
    else if (op === 'lte') out = out.filter((r) => { const a = Date.parse(r[k]); const b = Date.parse(val); return Number.isNaN(a) || Number.isNaN(b) ? String(r[k]) <= val : a <= b; });
    else if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(','); out = out.filter((r) => set.includes(String(r[k]))); }
    else if (op === 'ilike') { const t = val.replace(/^\*|\*$/g, '').toLowerCase(); out = out.filter((r) => String(r[k]).toLowerCase().includes(t)); }
  }
  const lim = Number(q.get('limit') || 0);
  return lim ? out.slice(0, lim) : out;
}

// now: data e hora fixas no navegador (para "hoje", "próximos 7 dias" e bloqueios).
// tz: fuso do aparelho (a página tem de mostrar e montar tudo no horário de São Paulo mesmo assim).
async function newPage(browser, { mobile = false, logged = false, email = 'dono@clinica.com.br', db: dbOpts = {}, now = null, tz = 'America/Sao_Paulo' } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: tz, serviceWorkers: 'block',
  });
  if (now) await context.clock.setFixedTime(new Date(now));
  const nowMs = now ? Date.parse(now) : Date.now();
  const db = {
    admin: false, members: [], clinics: [], exams: [], requests: [], claims: [], claimInsert: null, failUpdate: false,
    schedules: [], blocks: [], slots: [], scheduleResult: 'ok', blockResult: 'ok', removeResult: null,
    ...clone({ ...dbOpts, claimInsert: undefined }), claimInsert: dbOpts.claimInsert ?? null,
  };
  const log = [];
  await context.addInitScript(([s]) => {
    try {
      localStorage.setItem('imed_lgpd', '1');
      if (s && !sessionStorage.getItem('__seeded')) { localStorage.setItem('imed_session', JSON.stringify(s)); sessionStorage.setItem('__seeded', '1'); }
    } catch { /* */ }
  }, [logged ? { access_token: 'tok-init', refresh_token: 'ref', expires_at: Math.floor(nowMs / 1000) + 3600, user: { id: USER_ID, email } } : null]);
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const path = url.pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const entry = { method: req.method(), path, q: url.search, query: url.searchParams, body, auth: req.headers().authorization };
    log.push(entry);
    const q = url.searchParams;
    if (path === '/auth/v1/otp') return json(route, {});
    if (path === '/auth/v1/user') return json(route, { id: USER_ID, email });
    if (path === '/auth/v1/token' && db.failRefresh) return json(route, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' }, 400);
    if (path === '/auth/v1/token') return json(route, { access_token: 'tok-new', refresh_token: 'ref2', expires_in: 3600, user: { id: USER_ID, email } });
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });
    const rest = path.replace('/rest/v1/', '');
    const anon = !/^Bearer tok-/.test(entry.auth || '');
    // Sem a conta (chave pública), o banco recusa o que exige login.
    if (anon && (['clinic_members', 'rpc/set_request_status', 'rpc/update_my_clinic'].includes(rest) || (rest === 'establishment_claims' && req.method() === 'POST'))) {
      return json(route, { code: '42501', message: `permission denied for ${rest}` }, 401);
    }
    const delay = (db.delays || []).find((d) => rest === d.path && url.search.includes(d.match));
    if (delay) await new Promise((r) => setTimeout(r, delay.ms));
    switch (rest) {
      case 'establishments': return json(route, applyFilters(ESTABLISHMENTS, q));
      case 'municipalities': return json(route, applyFilters(MUNICIPALITIES, q));
      case 'rpc/imported_cities': return json(route, CITIES);
      case 'rpc/is_imed_admin': return json(route, db.admin);
      case 'clinic_members': return json(route, db.members);
      case 'clinics': return json(route, applyFilters(db.clinics, q));
      case 'clinic_exams': return json(route, applyFilters(db.exams, q));
      case 'appointment_requests': return json(route, applyFilters(db.requests, q));
      case 'establishment_claims':
        if (req.method() === 'POST') {
          if (db.claimInsert) return json(route, db.claimInsert.body, db.claimInsert.status);
          db.claims.unshift({ id: 'kkkkkkkk-0000-4000-8000-0000000000aa', created_at: new Date().toISOString(), status: 'pending', decision_note: null, ...body });
          return route.fulfill({ status: 201, body: '', headers: CORS });
        }
        return json(route, applyFilters(db.claims, q));
      case 'rpc/set_request_status': {
        const r = db.requests.find((x) => x.id === body.p_id);
        if (r) r.status = body.p_status;
        return json(route, r ? 'ok' : 'not_found');
      }
      case 'rpc/update_my_clinic':
        if (db.failUpdate) return json(route, { code: '23514', message: 'new row for relation "clinics" violates check constraint "clinics_website_check"' }, 400);
        return json(route, 'ok');
      case 'rpc/set_my_clinic_exams': return json(route, 'ok');
      case 'clinic_schedules': return json(route, applyFilters(db.schedules, q));
      case 'clinic_blocks': return json(route, applyFilters(db.blocks, q).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)));
      case 'rpc/available_slots': return json(route, db.slots.filter((x) => !x.exam || x.exam === body.p_exam).map((x) => ({ slot_start: x.slot_start })));
      case 'rpc/set_my_schedule': return json(route, db.scheduleResult);
      case 'rpc/add_my_block':
        if (db.blockResult !== 'ok') return json(route, db.blockResult);
        db.blocks.push({ id: `bbbbbbbb-0000-4000-8000-${String(100 + db.blocks.length).padStart(12, '0')}`, clinic_id: body.p_clinic, starts_at: body.p_starts, ends_at: body.p_ends, reason: body.p_reason, created_at: new Date().toISOString() });
        return json(route, 'ok');
      case 'rpc/remove_my_block': {
        if (db.removeResult) return json(route, db.removeResult);
        const i = db.blocks.findIndex((x) => x.id === body.p_block);
        if (i < 0) return json(route, 'not_found');
        db.blocks.splice(i, 1);
        return json(route, 'ok');
      }
      case 'rpc/approve_claim': {
        const c = db.claims.find((x) => x.id === body.p_claim);
        c.status = 'approved'; c.decided_at = new Date().toISOString();
        return json(route, C1);
      }
      case 'rpc/reject_claim': {
        const c = db.claims.find((x) => x.id === body.p_claim);
        c.status = 'rejected'; c.decided_at = new Date().toISOString(); c.decision_note = body.p_note;
        return route.fulfill({ status: 204, headers: CORS });
      }
      default:
        return json(route, { message: `não simulado: ${rest}` }, 404);
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push(`diálogo inesperado: ${d.message()}`); d.dismiss(); });
  return { context, page, log, db, errors };
}

const calls = (log, path, method) => log.filter((e) => e.path.endsWith(path) && (!method || e.method === method));
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };
const noOverflow = async (page) => {
  // No celular a janela visual pode crescer junto com o conteúdo: compara com a largura do aparelho.
  const [w, sw] = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
  const vw = page.viewportSize().width;
  assert.ok(w <= vw && sw <= vw, `sem rolagem lateral (janela ${w}px, conteúdo ${sw}px, aparelho ${vw}px)`);
};

const results = [];
async function scenario(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log(`ok  ${name}`); } catch (e) { results.push(['FALHOU', name]); console.log(`FALHOU  ${name}\n   ${e.stack}`); }
}

const browser = await chromium.launch();

await scenario('reivindicar com ?cnes=: mostra o local, pede login, valida CPF/CNPJ e envia só dígitos', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}reivindicar.html?cnes=2077485`);
  await page.waitForSelector('.cl-place h3');
  assert.equal(await page.textContent('.cl-place h3'), 'Hospital Santa Exemplo');
  assert.match(await page.textContent('.cl-place'), /Hospital · CNES 2077485/);
  assert.match(await page.textContent('.cl-place'), /São Paulo - SP · 01409-001/);
  assert.ok(calls(log, '/establishments')[0].q.includes('cnes=eq.2077485'));
  assert.ok(await page.isVisible('#s2'));
  assert.ok(await page.isHidden('#s3'), 'formulário só depois de entrar');
  assert.ok(await page.isHidden('#findForm'));
  // login
  await page.fill('#loginEmail', 'errado@');
  await page.click('#authBox button[type=submit]');
  assert.match(await page.textContent('#loginMsg'), /e-mail válido/);
  assert.equal(calls(log, '/auth/v1/otp').length, 0);
  await page.fill('#loginEmail', 'Dono@Clinica.com.br');
  await page.click('#authBox button[type=submit]');
  await page.waitForSelector('#loginMsg.ok');
  assert.match(await page.textContent('#loginMsg'), /Enviamos um link para dono@clinica\.com\.br\. Abra no mesmo aparelho/);
  const otp = calls(log, '/auth/v1/otp')[0];
  assert.deepEqual(otp.body, { email: 'dono@clinica.com.br', create_user: true });
  assert.equal(otp.query.get('redirect_to'), `${BASE}reivindicar.html?cnes=2077485`);
  await shot(page, '01-reivindicar-login');
  // volta do link (vindo de fora, como pelo e-mail)
  await page.goto('about:blank');
  await page.goto(`${BASE}reivindicar.html?cnes=2077485#access_token=tok-link&refresh_token=ref-link&expires_in=3600&token_type=bearer`);
  await page.waitForSelector('#s3:not([hidden])');
  assert.match(await page.textContent('#flash'), /Pronto, você entrou/);
  assert.equal(new URL(page.url()).hash, '', 'endereço limpo');
  assert.match(await page.textContent('#authBox'), /Você entrou como dono@clinica\.com\.br/);
  assert.equal(calls(log, '/auth/v1/user')[0].auth, 'Bearer tok-link');
  await page.waitForSelector('#mineBox .cl-help');
  assert.match(await page.textContent('#mineBox'), /ainda não fez nenhum pedido/);
  // validações
  await page.click('#claimBtn');
  assert.match(await page.textContent('#cNameErr'), /nome completo/);
  assert.match(await page.textContent('#cRoleErr'), /cargo/);
  assert.match(await page.textContent('#cDocErr'), /inválido/);
  assert.match(await page.textContent('#cPhoneErr'), /Celular inválido/);
  assert.match(await page.textContent('#cAgreeErr'), /Marque/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cName');
  await page.fill('#cName', 'Carlos  da Silva');
  await page.selectOption('#cRole', 'responsavel_tecnico');
  await page.type('#cDoc', '11111111111');
  assert.equal(await page.inputValue('#cDoc'), '111.111.111-11');
  await page.type('#cPhone', '11987654321');
  assert.equal(await page.inputValue('#cPhone'), '(11) 98765-4321');
  await page.check('#cAgree');
  await page.click('#claimBtn');
  assert.match(await page.textContent('#cDocErr'), /CPF ou CNPJ inválido/);
  await page.fill('#cDoc', '');
  await page.type('#cDoc', '11222333000180');
  assert.equal(await page.inputValue('#cDoc'), '11.222.333/0001-80');
  await page.click('#claimBtn');
  assert.match(await page.textContent('#cDocErr'), /CPF ou CNPJ inválido/, 'CNPJ com dígito errado');
  assert.equal(calls(log, '/establishment_claims', 'POST').length, 0);
  await page.fill('#cDoc', '');
  await page.type('#cDoc', '529.982.247-25');
  await page.fill('#cCrm', ' 123456-SP ');
  await page.fill('#cMsg', 'Sou o responsável técnico.');
  assert.equal(await page.textContent('#cMsgCount'), '26 de 500 caracteres');
  await shot(page, '02-reivindicar-formulario');
  await page.click('#claimBtn');
  await page.waitForSelector('#claimDone .cl-note.ok');
  const ins = calls(log, '/establishment_claims', 'POST');
  assert.equal(ins.length, 1);
  assert.deepEqual(ins[0].body, { cnes: '2077485', claimant_name: 'Carlos da Silva', role: 'responsavel_tecnico', document: '52998224725', crm: '123456-SP', phone: '11987654321', message: 'Sou o responsável técnico.' });
  assert.equal(ins[0].auth, 'Bearer tok-link');
  assert.match(await page.textContent('#claimDone'), /Pedido enviado\. A equipe do IMED confere os dados e responde por e-mail em até 2 dias úteis\./);
  assert.equal(await page.getAttribute('#claimDone a.btn', 'href'), 'painel.html');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'claimDone');
  assert.ok(await page.isHidden('#s3'));
  await page.waitForSelector('#mineBox .cl-list li');
  assert.match(await page.textContent('#mineBox'), /Hospital Santa Exemplo/);
  assert.match(await page.textContent('#mineBox'), /Em análise/);
  const mine = calls(log, '/establishment_claims', 'GET').at(-1);
  assert.equal(mine.query.get('select'), 'id,cnes,status,created_at,decision_note');
  assert.equal(mine.query.get('order'), 'created_at.desc');
  await shot(page, '03-reivindicar-enviado');
  // segundo pedido (ex.: a mesma pessoa cuida de um laboratório) sem recarregar a página
  assert.equal(await page.textContent('#changePlace'), 'Pedir outro estabelecimento');
  await page.click('#changePlace');
  await page.waitForSelector('#city option[value="3550308"]', { state: 'attached' });
  await page.fill('#cityFilter', 'paulo');
  await page.fill('#term', 'análise');
  await page.click('#findBtn');
  await page.click('#results button:has-text("Laboratório Análise Paulista")');
  await page.waitForSelector('#s3:not([hidden])');
  assert.ok(await page.isHidden('#claimDone'));
  assert.equal(await page.inputValue('#cName'), '', 'formulário limpo para o novo local');
  assert.equal(await page.inputValue('#cDoc'), '');
  assert.equal(await page.isChecked('#cAgree'), false);
  assert.equal(await page.textContent('#cMsgCount'), '0 de 500 caracteres');
  await page.fill('#cName', 'Carlos da Silva');
  await page.selectOption('#cRole', 'gestor');
  await page.type('#cDoc', '11222333000181');
  await page.type('#cPhone', '11987654321');
  await page.check('#cAgree');
  await page.click('#claimBtn');
  await page.waitForSelector('#claimDone:not([hidden]) .cl-note.ok');
  const ins2 = calls(log, '/establishment_claims', 'POST');
  assert.equal(ins2.length, 2);
  assert.deepEqual(ins2[1].body, { cnes: '6543210', claimant_name: 'Carlos da Silva', role: 'gestor', document: '11222333000181', crm: null, phone: '11987654321', message: null });
  await page.waitForFunction(() => document.querySelectorAll('#mineBox .cl-list li').length === 2);
  // CNPJ válido também passa na validação
  const okCnpj = await page.evaluate(async () => (await import('./assets/js/clinica.js')).isValidCnpj('11.222.333/0001-81'));
  assert.equal(okCnpj, true);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('reivindicar sem ?cnes=: busca por cidade e nome, escolhe e segue', async () => {
  const { page, log, errors, context } = await newPage(browser, { logged: true });
  await page.goto(`${BASE}reivindicar.html`);
  await page.waitForSelector('#city option[value="3550308"]', { state: 'attached' });
  assert.ok(await page.isHidden('#s3'));
  assert.ok(await page.isVisible('#mine'), 'logado vê os próprios pedidos');
  await page.fill('#term', 'santa');
  await page.click('#findBtn');
  assert.match(await page.textContent('#findMsg'), /Escolha a cidade/);
  await page.fill('#cityFilter', 'sao');
  assert.equal(await page.inputValue('#city'), String(SP), 'filtro sem acento acha São Paulo');
  assert.equal(await page.$$eval('#city option', (o) => o.length), 2);
  await page.fill('#term', 'sa');
  await page.click('#findBtn');
  assert.match(await page.textContent('#findMsg'), /3 letras/);
  await page.fill('#term', 'Sa*nta,()');
  await page.click('#findBtn');
  await page.waitForFunction(() => /Nada encontrado/.test(document.querySelector('#findMsg').textContent));
  const q = calls(log, '/establishments').at(-1);
  assert.equal(q.query.get('city_ibge'), `eq.${SP}`);
  assert.equal(q.query.get('name'), 'ilike.*Sa nta*');
  // busca de novo com o termo limpo
  await page.fill('#term', 'santa');
  await page.click('#findBtn');
  await page.waitForFunction(() => document.querySelectorAll('#results li').length === 2);
  const q2 = calls(log, '/establishments').at(-1);
  assert.equal(q2.query.get('name'), 'ilike.*santa*');
  assert.equal(q2.query.get('order'), 'name');
  assert.equal(q2.query.get('limit'), '20');
  assert.equal(await page.locator('#results b', { hasText: 'Clínica Santa <b>Luz</b>' }).count(), 1, 'nome escapado');
  await shot(page, '04-reivindicar-busca');
  await page.click('#results button:has-text("Hospital Santa Exemplo")');
  await page.waitForSelector('#s3:not([hidden])');
  assert.equal(new URL(page.url()).search, '?cnes=2077485');
  assert.equal(await page.textContent('.cl-place h3'), 'Hospital Santa Exemplo');
  assert.ok(await page.isHidden('#findForm'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cName');
  await page.click('#changePlace');
  assert.ok(await page.isVisible('#findForm'));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pedido duplicado (409/23505) e local já parceiro mostram mensagens claras', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, db: { claimInsert: { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "establishment_claims_pending_uq"' } } } });
  await page.goto(`${BASE}reivindicar.html?cnes=6543210`);
  await page.waitForSelector('#s3:not([hidden])');
  await page.fill('#cName', 'Paula Gerente');
  await page.selectOption('#cRole', 'gestor');
  await page.type('#cDoc', '11222333000181');
  await page.type('#cPhone', '1130002000');
  await page.check('#cAgree');
  await page.click('#claimBtn');
  await page.waitForSelector('#claimMsg .cl-note.err');
  assert.match(await page.textContent('#claimMsg'), /já tem um pedido em análise para este estabelecimento/);
  assert.equal(calls(log, '/establishment_claims', 'POST')[0].body.document, '11222333000181');
  assert.equal(calls(log, '/establishment_claims', 'POST')[0].body.crm, null);
  assert.equal(calls(log, '/establishment_claims', 'POST')[0].body.message, null);
  db.claimInsert = { status: 400, body: { code: '22023', message: 'Este estabelecimento já é parceiro do IMED' } };
  await page.click('#claimBtn');
  await page.waitForFunction(() => /já é parceiro/.test(document.querySelector('#claimMsg').textContent));
  db.claimInsert = { status: 500, body: { message: 'erro' } };
  await page.click('#claimBtn');
  await page.waitForFunction(() => /tente de novo/.test(document.querySelector('#claimMsg').textContent));
  assert.ok(await page.isEnabled('#claimBtn'));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('reivindicar com CNES inexistente mostra aviso e a busca', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}reivindicar.html?cnes=9999999`);
  await page.waitForSelector('#placeBox .cl-note.warn');
  assert.match(await page.textContent('#placeBox'), /Não encontramos o código CNES 9999999/);
  assert.ok(await page.isVisible('#findForm'));
  assert.ok(await page.isHidden('#s2'));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('painel: sem login pede o mesmo e-mail; sem clínicas leva a reivindicar', async () => {
  let { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#loginEmail');
  assert.match(await page.textContent('#authBox'), /mesmo e-mail usado no pedido de cadastro/);
  assert.equal(await page.textContent('#app'), '');
  assert.deepEqual(errors, []);
  await context.close();
  ({ page, errors, context } = await newPage(browser, { logged: true }));
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#goClaim');
  assert.match(await page.textContent('#app'), /Nenhuma clínica nesta conta/);
  await shot(page, '05-painel-sem-clinica');
  await page.click('#goClaim');
  await page.waitForURL(/reivindicar\.html$/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('painel com clínica: pedidos, situação, dados e exames com preços', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, db: {
    members: [{ clinic_id: C1, role: 'owner' }], clinics: [CLINIC], requests: [...REQUESTS, ...IMED_REQUESTS],
    exams: [{ clinic_id: C1, exam_code: 'rm', price_cents: 45000 }, { clinic_id: C1, exam_code: 'rx', price_cents: null }],
  } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  assert.equal(await page.textContent('#clinicTitle'), 'Imagem Paulista');
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Pedidos|Agenda|Dados da clínica|Exames e preços');
  const cl = calls(log, '/clinics')[0];
  assert.equal(cl.query.get('id'), `in.(${C1})`);
  const rq = calls(log, '/appointment_requests')[0];
  assert.equal(rq.query.get('clinic_id'), `eq.${C1}`);
  assert.equal(rq.query.get('select'), 'id,created_at,exam_code,preferred_date,preferred_period,patient_name,patient_phone,patient_email,notes,status,slot_start');
  assert.equal(rq.query.get('order'), 'created_at.desc');
  assert.equal(rq.query.get('limit'), '100');
  assert.equal(await page.locator('.rq').count(), 2);
  // pela data do exame: João (03/11) antes de Maria (05/11)
  assert.deepEqual(await page.$$eval('.rq h3', (h) => h.map((x) => x.textContent)), ['Tomografia · João Lima', 'Ressonância · Maria Souza']);
  const first = page.locator(`#rq-${REQUESTS[0].id}`);
  assert.match(await first.textContent(), /Ressonância · Maria Souza/);
  assert.match(await first.textContent(), /Manhã/);
  assert.match(await first.textContent(), /Aguardando contato/);
  assert.equal(await first.locator('a[href^="tel:"]').getAttribute('href'), 'tel:+5511987654321');
  assert.equal(await first.locator('a[href^="https://wa.me"]').getAttribute('href'), 'https://wa.me/5511987654321');
  assert.match(await first.textContent(), /Tenho claustrofobia <img src=x/);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'HTML escapado');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => /Maria|claustro/.test(localStorage.getItem(k))).length), 0, 'nada do paciente no localStorage');
  await shot(page, '06-painel-pedidos');
  await first.locator('button[data-st="contacted"]').click();
  await page.waitForFunction((id) => /Em contato/.test(document.querySelector(`#rq-${id} .rq-st`).textContent), REQUESTS[0].id);
  assert.deepEqual(calls(log, '/rpc/set_request_status')[0].body, { p_id: REQUESTS[0].id, p_status: 'contacted' });
  assert.equal(await page.locator(`#rq-${REQUESTS[0].id} button[data-st="contacted"]`).getAttribute('aria-pressed'), 'true');
  await page.selectOption('#flt-pedidos', 'confirmed');
  assert.equal(await page.locator('.rq').count(), 1);
  assert.match(await page.textContent('.rq'), /João Lima/);
  assert.equal(await page.locator('.rq a[href^="https://wa.me"]').count(), 0, 'telefone fixo não tem WhatsApp');
  await page.locator('.rq button[data-st="completed"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.rq').length === 0);
  assert.deepEqual(calls(log, '/rpc/set_request_status')[1].body, { p_id: REQUESTS[1].id, p_status: 'completed' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'flt-pedidos', 'foco vai para o filtro quando o cartão sai da lista');
  assert.match(await page.textContent('#rqMsg'), /João Lima mudada para “Concluído”\. Ele saiu desta lista/);
  // filtro "Aguardando contato" com dois pedidos: o foco vai para o próximo cartão
  db.requests.push({ ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000003', patient_name: 'Bia Nova', status: 'pending', created_at: '2026-10-29T12:00:00Z' },
    { ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000004', patient_name: 'Caio Novo', status: 'pending', created_at: '2026-10-29T11:00:00Z' });
  await page.selectOption('#flt-pedidos', 'pending');
  assert.equal(await page.locator('.rq').count(), 0, 'lista ainda é a guardada');
  await page.click('#rf-pedidos');
  await page.waitForFunction(() => document.querySelectorAll('.rq').length === 2);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'rf-pedidos', 'foco volta para “Atualizar lista”');
  assert.equal(calls(log, '/appointment_requests').length, 2);
  await page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000003 button[data-st="contacted"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.rq').length === 1);
  assert.equal(await page.evaluate(() => document.activeElement.closest('.rq')?.id), 'rq-rrrrrrrr-0000-4000-8000-000000000004');
  await page.selectOption('#flt-pedidos', '');
  assert.equal(await page.locator('#clinicNotes .cl-note').count(), 0);
  // abas pelo teclado
  await page.focus('#tab-pedidos');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getAttribute('#tab-agenda', 'aria-selected'), 'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getAttribute('#tab-dados', 'aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-dados');
  assert.equal(await page.getAttribute('#panel', 'aria-labelledby'), 'tab-dados');
  await page.waitForSelector('#dataForm');
  // dados da clínica
  assert.equal(await page.isChecked('#dOnline'), true);
  assert.equal(await page.inputValue('#dSpec'), 'Radiologia');
  assert.equal(await page.isChecked('input[name=ins][value="Amil"]'), true);
  assert.equal(await page.inputValue('#dInsOther'), 'Plano Antigo');
  await page.fill('#dWa', '11 98765');
  await page.click('#dSave');
  assert.match(await page.textContent('#dWaErr'), /55 \+ DDD/);
  assert.equal(calls(log, '/rpc/update_my_clinic').length, 0);
  await page.fill('#dPhone', '(11) 3222-1000');
  await page.fill('#dWa', '+55 (11) 98765-4321');
  await page.fill('#dEmail', 'Contato@ImagemPaulista.com.br');
  await page.fill('#dSite', 'www.imagempaulista.com.br');
  await page.fill('#dDesc', 'Centro de diagnóstico por imagem.');
  await page.fill('#h-seg', '07:00–19:00');
  await page.fill('#h-sab', ' 08:00–12:00 ');
  await page.fill('#dSpec', 'Radiologia, Cardiologia, , radiologia');
  await page.check('input[name=ins][value="Unimed"]');
  await page.fill('#dInsOther', 'Plano Local; Outro Plano');
  await shot(page, '07-painel-dados');
  await page.click('#dSave');
  await page.waitForSelector('#dMsg .cl-note.ok');
  const up = calls(log, '/rpc/update_my_clinic')[0].body;
  assert.deepEqual(up, { p_clinic: C1, p: {
    phone: '(11) 3222-1000', whatsapp: '5511987654321', email: 'contato@imagempaulista.com.br', website: 'https://www.imagempaulista.com.br',
    description: 'Centro de diagnóstico por imagem.', opening_hours: { seg: '07:00–19:00', sab: '08:00–12:00' }, accepts_online_booking: true,
    specialties: ['Radiologia', 'Cardiologia', 'radiologia'], insurances: ['Amil', 'Unimed', 'Plano Local', 'Outro Plano'],
  } });
  // sem horários e sem pedidos online
  await page.fill('#h-seg', '');
  await page.fill('#h-sab', '');
  await page.uncheck('#dOnline');
  await page.uncheck('input[name=ins][value="Amil"]');
  await page.uncheck('input[name=ins][value="Unimed"]');
  await page.fill('#dInsOther', '');
  db.failUpdate = true;
  await page.click('#dSave');
  await page.waitForSelector('#dMsg .cl-note.err');
  assert.match(await page.textContent('#dMsg'), /Algum dado não está no formato aceito/);
  const up2 = calls(log, '/rpc/update_my_clinic')[1].body.p;
  assert.equal(up2.opening_hours, null);
  assert.equal(up2.accepts_online_booking, false);
  assert.deepEqual(up2.insurances, []);
  // salvo de novo, o aviso do topo acompanha "Aceito pedidos pelo site"
  db.failUpdate = false;
  await page.click('#dSave');
  await page.waitForSelector('#dMsg .cl-note.ok');
  assert.match(await page.textContent('#dMsg'), /Já aparecem para os pacientes na busca/);
  assert.match(await page.textContent('#clinicNotes'), /Pedidos pelo site estão desligados/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dSave', 'foco fica no formulário');
  await page.check('#dOnline');
  await page.click('#dSave');
  await page.waitForFunction(() => !document.querySelector('#clinicNotes .cl-note'));
  // ao voltar para a aba Pedidos, a lista é buscada de novo
  const before = calls(log, '/appointment_requests').length;
  await page.click('#tab-pedidos');
  await page.waitForSelector('.rq');
  assert.equal(calls(log, '/appointment_requests').length, before + 1);
  // exames e preços
  await page.click('#tab-exames');
  await page.waitForSelector('#examForm');
  assert.equal(await page.inputValue('#pr-rm'), '450,00');
  assert.equal(await page.isChecked('#ex-rx'), true);
  assert.equal(await page.inputValue('#pr-rx'), '');
  assert.equal(await page.isDisabled('#pr-tc'), true);
  await page.check('#ex-tc');
  await page.fill('#pr-tc', '0,50');
  await page.click('#exSave');
  assert.match(await page.textContent('#pr-tcErr'), /Preço inválido/);
  assert.equal(calls(log, '/rpc/set_my_clinic_exams').length, 0);
  await page.fill('#pr-tc', '1.234,56');
  await page.uncheck('#ex-rx');
  await page.check('#ex-usg');
  await page.check('#ex-lab');
  await page.fill('#pr-lab', '35');
  await shot(page, '08-painel-exames');
  await page.click('#exSave');
  await page.waitForSelector('#exMsg .cl-note.ok');
  assert.deepEqual(calls(log, '/rpc/set_my_clinic_exams')[0].body, { p_clinic: C1, p_exams: [
    { code: 'usg', price_cents: null }, { code: 'tc', price_cents: 123456 }, { code: 'rm', price_cents: 45000 }, { code: 'lab', price_cents: 3500 },
  ] });
  assert.equal(await page.inputValue('#pr-lab'), '35,00');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('equipe do IMED: aprova e recusa pedidos de cadastro e cuida dos pedidos ao IMED', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, email: 'equipe@imed.com.br', db: { admin: true, claims: CLAIMS, requests: [...REQUESTS, ...IMED_REQUESTS] } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#cl-kkkkkkkk-0000-4000-8000-000000000001');
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Pedidos de cadastro|Pedidos ao IMED');
  assert.equal(await page.textContent('#clinicTitle'), 'Equipe do IMED');
  const pend = calls(log, '/establishment_claims').find((e) => e.query.get('status') === 'eq.pending');
  assert.equal(pend.query.get('select'), '*');
  assert.equal(pend.query.get('order'), 'created_at');
  const c1 = page.locator('#cl-kkkkkkkk-0000-4000-8000-000000000001');
  assert.match(await c1.textContent(), /Hospital Santa Exemplo/);
  assert.match(await c1.textContent(), /Carlos Dono/);
  assert.match(await c1.textContent(), /Proprietário\(a\)/);
  assert.match(await c1.textContent(), /529\.•••\.•••-25/);
  assert.doesNotMatch(await c1.textContent(), /52998224725|529\.982\.247-25/);
  assert.match(await c1.textContent(), /123456-SP/);
  assert.match(await c1.textContent(), /dono@hospital\.com\.br/);
  assert.match(await c1.textContent(), /Sou o dono <script>alert\(1\)<\/script>/);
  assert.equal(await c1.locator('a:has-text("Ficha no CNES")').getAttribute('href'), 'https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/3550302077485');
  const c2 = page.locator('#cl-kkkkkkkk-0000-4000-8000-000000000002');
  assert.match(await c2.textContent(), /CNPJ/);
  assert.match(await c2.textContent(), /11\.•••\.•••\/0001-81/);
  await c1.locator('[data-show]').click();
  assert.match(await c1.textContent(), /529\.982\.247-25/);
  assert.match(await page.textContent('#panel'), /Velho Pedido/);
  assert.match(await page.textContent('#panel'), /Motivo: Sem vínculo/);
  await shot(page, '09-painel-admin-cadastros');
  await c1.locator('[data-approve]').click();
  await page.waitForFunction(() => !document.querySelector('#panel .cl-state') && !document.querySelector('#cl-kkkkkkkk-0000-4000-8000-000000000001'));
  assert.deepEqual(calls(log, '/rpc/approve_claim')[0].body, { p_claim: CLAIMS[0].id });
  await c2.locator('[data-reject]').click();
  assert.equal(await c2.locator('[data-reject]').getAttribute('aria-expanded'), 'true');
  await page.fill('#note-kkkkkkkk-0000-4000-8000-000000000002', 'Documento não confere com o CNES');
  await c2.locator('[data-confirm-reject]').click();
  await page.waitForFunction(() => !document.querySelector('#panel .cl-state') && !document.querySelector('#cl-kkkkkkkk-0000-4000-8000-000000000002'));
  assert.deepEqual(calls(log, '/rpc/reject_claim')[0].body, { p_claim: CLAIMS[1].id, p_note: 'Documento não confere com o CNES' });
  assert.match(await page.textContent('#panel'), /Nenhum pedido aguardando/);
  assert.match(await page.textContent('#panel'), /Aprovado/);
  assert.match(await page.textContent('#panel'), /Motivo: Documento não confere com o CNES/);
  // pedidos ao IMED
  await page.click('#tab-concierge');
  await page.waitForSelector('.rq');
  const cq = calls(log, '/appointment_requests').at(-1);
  assert.equal(cq.query.get('clinic_id'), 'is.null');
  assert.match(cq.query.get('select'), /place_name/);
  assert.equal(await page.locator('.rq').count(), 1);
  assert.match(await page.textContent('.rq'), /Hospital Santa Exemplo/);
  assert.match(await page.textContent('.rq'), /Ana Prado/);
  assert.equal(await page.locator('.rq a[href="tel:+551131411000"]').count(), 1);
  await page.click('.rq button[data-st="confirmed"]');
  await page.waitForFunction(() => /Confirmado/.test(document.querySelector('.rq .rq-st').textContent));
  assert.deepEqual(calls(log, '/rpc/set_request_status')[0].body, { p_id: IMED_REQUESTS[0].id, p_status: 'confirmed' });
  await shot(page, '10-painel-admin-concierge');
  // telefones de locais do OSM (já com +55) e 0800; lista atualizada pelo botão
  db.requests.push({ ...IMED_REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000011', place_name: 'Local OSM', place_phone: '+55 11 3141-1000', created_at: '2026-10-29T16:00:00Z' },
    { ...IMED_REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000012', place_name: 'Central 0800', place_phone: '0800 123 4567', created_at: '2026-10-29T17:00:00Z' });
  await page.click('#rf-concierge');
  await page.waitForFunction(() => document.querySelectorAll('.rq').length === 3);
  assert.equal(await page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000011 a[href^="tel:"]').first().getAttribute('href'), 'tel:+551131411000');
  assert.equal(await page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000012 a[href^="tel:"]').first().getAttribute('href'), 'tel:08001234567');
  assert.equal(await page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000011 a[href^="tel:"]').nth(1).getAttribute('href'), 'tel:+5521998887777', 'telefone do paciente');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('painel com duas clínicas: resposta atrasada da primeira não aparece na segunda; rascunho', async () => {
  const C2 = 'cccccccc-0000-4000-8000-000000000002';
  const { page, log, errors, context } = await newPage(browser, { logged: true, db: {
    members: [{ clinic_id: C1, role: 'owner' }, { clinic_id: C2, role: 'owner' }],
    clinics: [CLINIC, { ...CLINIC, id: C2, name: 'Rascunho Clínica', status: 'draft' }],
    requests: [...REQUESTS, { ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000020', clinic_id: C2, patient_name: 'Paciente da Segunda' }],
    delays: [{ path: 'appointment_requests', match: `clinic_id=eq.${C1}`, ms: 900 }],
  } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#clinicPick');
  assert.equal(await page.textContent('#clinicTitle'), 'Imagem Paulista');
  await page.selectOption('#clinicPick', C2);
  await page.waitForSelector('.rq');
  await page.waitForTimeout(1200);
  assert.equal(calls(log, '/appointment_requests').length, 2);
  assert.equal(await page.textContent('#clinicTitle'), 'Rascunho Clínica');
  assert.equal(await page.locator('.rq').count(), 1);
  assert.match(await page.textContent('.rq'), /Paciente da Segunda/);
  await page.selectOption('#flt-pedidos', 'pending');
  assert.equal(await page.locator('.rq').count(), 1, 'cache por clínica');
  assert.match(await page.textContent('.rq'), /Paciente da Segunda/);
  // rascunho: mensagem de salvo não promete aparecer na busca
  await page.click('#tab-dados');
  await page.waitForSelector('#dataForm');
  await page.click('#dSave');
  await page.waitForSelector('#dMsg .cl-note.ok');
  assert.match(await page.textContent('#dMsg'), /Vão aparecer na busca quando o cadastro for publicado/);
  assert.match(await page.textContent('#clinicNotes'), /rascunho/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('entrada vencida sem renovação: mostra de novo o pedido de link', async () => {
  // reivindicar
  let { page, errors, context, db } = await newPage(browser, { logged: true });
  await page.goto(`${BASE}reivindicar.html?cnes=6543210`);
  await page.waitForSelector('#s3:not([hidden])');
  await page.fill('#cName', 'Paula Gerente');
  await page.selectOption('#cRole', 'gestor');
  await page.type('#cDoc', '11222333000181');
  await page.type('#cPhone', '1130002000');
  await page.check('#cAgree');
  db.failRefresh = true;
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('imed_session')); s.expires_at = 1; localStorage.setItem('imed_session', JSON.stringify(s)); });
  await page.click('#claimBtn');
  await page.waitForSelector('#loginEmail');
  assert.match(await page.textContent('#flash'), /Sua entrada expirou\. Peça um novo link abaixo\./);
  assert.doesNotMatch(await page.textContent('#authBox'), /Você entrou como/);
  assert.ok(await page.isHidden('#s3'));
  assert.ok(await page.isVisible('#s2'));
  assert.deepEqual(errors, []);
  await context.close();
  // painel
  ({ page, errors, context, db } = await newPage(browser, { logged: true, db: { members: [{ clinic_id: C1, role: 'owner' }], clinics: [CLINIC], requests: [...REQUESTS] } }));
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  db.failRefresh = true;
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('imed_session')); s.expires_at = 1; localStorage.setItem('imed_session', JSON.stringify(s)); });
  await page.locator('.rq').first().locator('button[data-st="contacted"]').click();
  await page.waitForSelector('#loginEmail');
  assert.match(await page.textContent('#flash'), /Sua entrada expirou\. Peça um novo link abaixo\./);
  assert.equal(await page.textContent('#app'), '');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'loginEmail');
  assert.deepEqual(errors, []);
  await context.close();
});

// ---------- agenda com horário ----------
const NOW = '2026-10-30T12:00:00-03:00'; // sexta-feira, meio-dia em São Paulo
const AG_EXAMS = [{ clinic_id: C1, exam_code: 'rm', price_cents: 45000 }, { clinic_id: C1, exam_code: 'tc', price_cents: null }, { clinic_id: C1, exam_code: 'usg', price_cents: 18000 }];
const AG_SCHEDULES = [
  { id: 's1', clinic_id: C1, weekday: 1, start_time: '08:00:00', end_time: '12:00:00', slot_minutes: 30, exam_codes: [] },
  { id: 's2', clinic_id: C1, weekday: 1, start_time: '13:00:00', end_time: '17:00:00', slot_minutes: 20, exam_codes: ['rm', 'mamo'] },
  { id: 's3', clinic_id: C1, weekday: 6, start_time: '08:00:00', end_time: '12:00:00', slot_minutes: 15, exam_codes: ['tc'] },
  { id: 's4', clinic_id: 'cccccccc-0000-4000-8000-000000000009', weekday: 3, start_time: '08:00:00', end_time: '09:00:00', slot_minutes: 30, exam_codes: [] },
];
const B1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const B2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const AG_BLOCKS = [
  { id: B1, clinic_id: C1, starts_at: '2026-11-02T03:00:00+00:00', ends_at: '2026-11-03T03:00:00+00:00', reason: 'Finados <b>feriado</b>' },
  { id: B2, clinic_id: C1, starts_at: '2026-11-10T11:00:00+00:00', ends_at: '2026-11-10T15:00:00+00:00', reason: null },
  { id: 'bbbbbbbb-0000-4000-8000-000000000003', clinic_id: C1, starts_at: '2026-10-01T03:00:00+00:00', ends_at: '2026-10-02T03:00:00+00:00', reason: 'Antigo' },
];
// 20 horários na terça 03/11 (08:00 em diante, de 20 em 20 min) e 15 na quarta 04/11, para ultrassom.
const AG_SLOTS = [
  ...Array.from({ length: 20 }, (_, i) => ({ exam: 'usg', slot_start: new Date(Date.parse('2026-11-03T11:00:00Z') + i * 20 * 60000).toISOString() })),
  ...Array.from({ length: 15 }, (_, i) => ({ exam: 'usg', slot_start: new Date(Date.parse('2026-11-04T11:00:00Z') + i * 20 * 60000).toISOString() })),
];
const agendaDb = (extra = {}) => ({ members: [{ clinic_id: C1, role: 'owner' }], clinics: [CLINIC], exams: AG_EXAMS, schedules: AG_SCHEDULES, blocks: AG_BLOCKS, slots: AG_SLOTS, requests: REQUESTS, ...extra });
// Troca o filtro "Quando" e espera a lista nova chegar do banco.
async function pickWhen(page, v) {
  await page.selectOption('#flt-when', v);
  await page.waitForFunction(() => !document.querySelector('#panel .cl-state') && document.querySelector('#flt-when'));
}
const rowsOf = (page, wd) => page.$$eval(`#agday-${wd} .ag-row`, (rs) => rs.map((r) => ({
  start: r.querySelector('[data-f=start]').value, end: r.querySelector('[data-f=end]').value, slot: r.querySelector('[data-f=slot]').value,
  mode: r.querySelector('[data-f=mode]:checked').value, exams: [...r.querySelectorAll('[data-f=ex]:checked')].map((x) => x.value),
})));

await scenario('agenda: carrega, adiciona faixa, copia segunda para os dias úteis, valida sobreposição e salva o JSON certo', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, now: NOW, db: agendaDb() });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  await page.click('#tab-agenda');
  await page.waitForSelector('#agWeek');
  const sq = calls(log, '/clinic_schedules')[0];
  assert.equal(sq.query.get('select'), '*');
  assert.equal(sq.query.get('clinic_id'), `eq.${C1}`);
  assert.equal(sq.query.get('order'), 'weekday,start_time');
  const bq = calls(log, '/clinic_blocks')[0];
  assert.equal(bq.query.get('clinic_id'), `eq.${C1}`);
  assert.equal(bq.query.get('ends_at'), 'gte.2026-10-30T15:00:00.000Z', 'só bloqueios que ainda não acabaram');
  assert.equal(bq.query.get('order'), 'starts_at');
  assert.match(await page.textContent('#agNote'), /pacientes veem os horários livres e marcam direto/);
  // dias na ordem segunda → domingo; faixas carregadas
  assert.deepEqual(await page.$$eval('.ag-day h4', (h) => h.map((x) => x.textContent)), ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']);
  assert.deepEqual(await rowsOf(page, 1), [
    { start: '08:00', end: '12:00', slot: '30', mode: 'all', exams: [] },
    { start: '13:00', end: '17:00', slot: '20', mode: 'some', exams: ['rm'] },
  ]);
  assert.deepEqual(await rowsOf(page, 6), [{ start: '08:00', end: '12:00', slot: '15', mode: 'some', exams: ['tc'] }]);
  assert.match(await page.textContent('#agday-0'), /Sem horários pelo site/);
  // só os exames que a clínica faz (mamografia não está em "Exames e preços"): sai da faixa com aviso
  assert.deepEqual(await page.$$eval('#agday-1 .ag-row:nth-child(2) [data-f=ex]', (x) => x.map((i) => i.value)), ['usg', 'tc', 'rm']);
  assert.match(await page.textContent('#agday-1 .ag-row:nth-child(2) .ag-drop'), /Mamografia saiu de “Exames e preços” e foi tirada desta faixa\. Confira e salve a agenda\./);
  assert.equal(await page.locator('.ag-drop').count(), 1);
  assert.match(await page.textContent('#agDirty'), /mudanças ainda não salvas/, 'aviso de revisar e salvar');
  assert.ok(await page.isHidden('#agday-1 .ag-row:nth-child(1) .ag-exl'), '“Todos os exames” esconde a lista');
  // bloqueios no horário de São Paulo, texto escapado; o antigo não aparece
  const blocks = await page.$$eval('#agBlocks li', (li) => li.map((x) => x.querySelector('b').textContent));
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /02\/11\/2026 \(dia inteiro\)$/);
  assert.match(blocks[1], /10\/11\/2026, das 08:00 às 12:00$/);
  assert.match(await page.textContent('#agBlocks'), /Finados <b>feriado<\/b>/);
  // prévia: primeiro exame da clínica, 7 dias, até 30 horários por dia
  await page.waitForSelector('#pvBox .ag-pv');
  assert.deepEqual(calls(log, '/rpc/available_slots')[0].body, { p_clinic: C1, p_exam: 'usg', p_from: null, p_days: 7 });
  assert.match(await page.textContent('#pvBox'), /Mostrando os 30 primeiros de 35 horários livres/);
  assert.equal(await page.locator('#pvBox .ag-slots li').count(), 30);
  assert.deepEqual(await page.$$eval('#pvBox h4', (h) => h.map((x) => x.textContent.replace(/^\D+/, ''))), ['03/11/2026', '04/11/2026']);
  assert.equal(await page.textContent('#pvBox .ag-slots li'), '08:00');
  await page.selectOption('#pvExam', 'rm');
  await page.waitForFunction(() => /Nenhum horário livre nos próximos 7 dias para Ressonância/.test(document.querySelector('#pvBox').textContent));
  assert.equal(calls(log, '/rpc/available_slots').at(-1).body.p_exam, 'rm');
  await shot(page, '15-painel-agenda');
  // adicionar faixa na terça
  await page.click('#agday-2 [data-add]');
  assert.deepEqual(await rowsOf(page, 2), [{ start: '08:00', end: '12:00', slot: '30', mode: 'all', exams: [] }]);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.f), 'start', 'foco no início da faixa nova');
  assert.match(await page.textContent('#agDirty'), /mudanças ainda não salvas/);
  // copiar segunda para terça a sexta (troca a faixa que havia na terça)
  await page.click('#agCopy');
  assert.match(await page.textContent('#agCopyMsg'), /terça a sexta agora têm os mesmos horários de segunda \(as faixas que havia nesses dias foram trocadas\)/);
  for (const wd of [2, 3, 4, 5]) assert.deepEqual(await rowsOf(page, wd), await rowsOf(page, 1), `dia ${wd} igual à segunda`);
  // terceira faixa na segunda: começa 1 h depois da última e herda a duração
  await page.click('#agday-1 [data-add]');
  assert.deepEqual((await rowsOf(page, 1))[2], { start: '18:00', end: '22:00', slot: '20', mode: 'all', exams: [] });
  const third = page.locator('#agday-1 .ag-row').nth(2);
  await third.locator('[data-f=start]').fill('11:00');
  await third.locator('[data-f=end]').fill('12:30');
  // domingo com fim antes do início
  await page.click('#agday-0 [data-add]');
  const sun = page.locator('#agday-0 .ag-row').first();
  await sun.locator('[data-f=start]').fill('10:00');
  await sun.locator('[data-f=end]').fill('09:00');
  await page.click('#agSave');
  assert.equal(calls(log, '/rpc/set_my_schedule').length, 0, 'não salva com erro');
  assert.match(await page.textContent('#agSum'), /Confira as 2 faixas marcadas em vermelho/);
  assert.match(await page.locator('#agday-1 .ag-row').nth(2).locator('.cl-err').textContent(), /se cruza com a de 08:00 às 12:00 para o mesmo exame/);
  assert.match(await page.textContent('#agday-0 .cl-err'), /O fim precisa ser depois do início/);
  assert.equal(await page.evaluate(() => document.activeElement.closest('.ag-day')?.id), 'agday-1', 'foco na primeira faixa com erro');
  assert.equal(await page.locator('#agday-1 .ag-row').nth(2).locator('[data-f=start]').getAttribute('aria-invalid'), 'true');
  await shot(page, '16-painel-agenda-erros');
  // mesma hora, exame diferente: pode (14:00–15:00 só tomografia cruza 13:00–17:00 só ressonância)
  const t2 = page.locator('#agday-1 .ag-row').nth(2);
  await t2.locator('[data-f=start]').fill('14:00');
  await t2.locator('[data-f=end]').fill('15:00');
  await t2.locator('[data-f=mode][value=some]').check();
  assert.ok(await t2.locator('.ag-exl').isVisible());
  await page.click('#agSave');
  assert.match(await page.locator('#agday-1 .ag-row').nth(2).locator('.cl-err').textContent(), /Marque pelo menos um exame/);
  await page.locator('#agday-1 .ag-row').nth(2).locator('[data-f=ex][value=tc]').check();
  // menos tempo que um horário
  await page.locator('#agday-0 .ag-row [data-f=end]').fill('10:10');
  await page.selectOption('#agday-0 .ag-row [data-f=slot]', '15');
  await page.click('#agSave');
  assert.match(await page.textContent('#agday-0 .cl-err'), /pelo menos 15 minutos/);
  assert.match(await page.textContent('#agSum'), /Confira a faixa marcada em vermelho/);
  // remove a faixa de domingo: o foco vai para "Adicionar faixa" do domingo
  await page.click('#agday-0 [data-rm]');
  assert.equal(await page.locator('#agday-0 .ag-row').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.add), '0');
  await page.click('#agSave');
  await page.waitForSelector('#agMsg .cl-note.ok');
  const two = (wd) => [
    { weekday: wd, start: '08:00', end: '12:00', slot_minutes: 30, exams: [] },
    { weekday: wd, start: '13:00', end: '17:00', slot_minutes: 20, exams: ['rm'] },
  ];
  assert.deepEqual(calls(log, '/rpc/set_my_schedule')[0].body, { p_clinic: C1, p_rows: [
    two(1)[0], two(1)[1], { weekday: 1, start: '14:00', end: '15:00', slot_minutes: 20, exams: ['tc'] },
    ...two(2), ...two(3), ...two(4), ...two(5),
    { weekday: 6, start: '08:00', end: '12:00', slot_minutes: 15, exams: ['tc'] },
  ] });
  assert.match(await page.textContent('#agMsg'), /Agenda salva\. Os horários livres já aparecem para os pacientes/);
  assert.equal(await page.textContent('#agDirty'), '');
  assert.equal(await page.locator('.ag-drop').count(), 0, 'aviso de exame tirado some depois de salvar');
  assert.equal(await page.textContent('#agSum'), '');
  for (let i = 0; i < 50 && calls(log, '/rpc/available_slots').length < 3; i++) await page.waitForTimeout(50);
  assert.equal(calls(log, '/rpc/available_slots').length, 3, 'prévia atualizada depois de salvar');
  // mudanças não salvas continuam ao trocar de aba e voltar
  await page.click('#agday-0 [data-add]');
  await page.click('#tab-dados');
  await page.waitForSelector('#dataForm');
  await page.click('#tab-agenda');
  await page.waitForSelector('#agWeek');
  assert.equal(await page.locator('#agday-0 .ag-row').count(), 1);
  assert.match(await page.textContent('#agDirty'), /não salvas/);
  assert.equal(calls(log, '/clinic_schedules').length, 1, 'não busca de novo por cima do rascunho');
  // erro do servidor
  db.scheduleResult = 'forbidden';
  await page.click('#agday-0 [data-rm]');
  await page.click('#agSave');
  await page.waitForSelector('#agMsg .cl-note.err');
  assert.match(await page.textContent('#agMsg'), /Sua conta não pode mudar a agenda desta clínica/);
  assert.ok(await page.isEnabled('#agSave'));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('agenda: aviso com pedidos online desligados e sem exames; atalho para Dados da clínica', async () => {
  const { page, log, errors, context } = await newPage(browser, { logged: true, now: NOW, db: agendaDb({ clinics: [{ ...CLINIC, accepts_online_booking: false }], exams: [], blocks: [], slots: [],
    schedules: [{ id: 's9', clinic_id: C1, weekday: 2, start_time: '08:00:00', end_time: '10:00:00', slot_minutes: 30, exam_codes: ['mamo', 'dens'] }] }) });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  await page.click('#tab-agenda');
  await page.waitForSelector('#agWeek');
  assert.match(await page.textContent('#agNote'), /A agenda só aparece para os pacientes quando “Aceito pedidos de agendamento pelo site” estiver ligado/);
  assert.match(await page.textContent('#panel'), /Nenhum exame marcado em Exames e preços/);
  assert.equal(await page.locator('#pvExam').count(), 0);
  await page.waitForSelector('#pvBox .cl-help');
  assert.equal(calls(log, '/rpc/available_slots')[0].body.p_exam, null);
  assert.match(await page.textContent('#pvBox'), /desligado ou o cadastro em rascunho/);
  // faixa salva só com exames que saíram de "Exames e preços": aviso na faixa e não salva sem revisar
  assert.match(await page.textContent('#agday-2 .ag-drop'), /Mamografia e Densitometria saíram de “Exames e preços” e foram tirados desta faixa\. Marque outro exame, escolha “Todos os exames” ou remova a faixa/);
  assert.match(await page.textContent('#agDirty'), /não salvas/);
  await page.click('#agSave');
  assert.match(await page.textContent('#agday-2 .cl-err'), /Marque pelo menos um exame/);
  assert.equal(calls(log, '/rpc/set_my_schedule').length, 0);
  await page.click('#agday-2 [data-rm]');
  // copiar sem faixas na segunda
  await page.click('#agCopy');
  assert.match(await page.textContent('#agCopyMsg'), /Segunda ainda não tem faixas/);
  // sem nenhuma faixa: salva lista vazia
  await page.click('#agSave');
  await page.waitForSelector('#agMsg .cl-note.ok');
  assert.deepEqual(calls(log, '/rpc/set_my_schedule')[0].body, { p_clinic: C1, p_rows: [] });
  assert.match(await page.textContent('#agMsg'), /Agenda salva sem horários/);
  await page.click('#agNote [data-go="dados"]');
  await page.waitForSelector('#dataForm');
  assert.equal(await page.getAttribute('#tab-dados', 'aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-dados');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('agenda no celular (390px): bloqueios com fuso -03:00, validação, remover e sem rolagem lateral', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { mobile: true, logged: true, now: NOW, db: agendaDb() });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  await page.click('#tab-agenda');
  await page.waitForSelector('#pvBox .ag-pv');
  await noOverflow(page);
  await shot(page, '17-celular-agenda');
  // sem dia
  await page.click('#bSave');
  assert.match(await page.textContent('#bFromErr'), /Escolha o dia/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'bFrom');
  // dia no passado
  await page.fill('#bFrom', '2026-10-29');
  await page.click('#bSave');
  assert.match(await page.textContent('#bFromErr'), /Esse período já passou/);
  // último dia antes do primeiro
  await page.fill('#bFrom', '2026-12-25');
  await page.fill('#bTo', '2026-12-24');
  await page.click('#bSave');
  assert.match(await page.textContent('#bToErr'), /igual ou depois do primeiro/);
  assert.equal(calls(log, '/rpc/add_my_block').length, 0);
  // dias inteiros: 24 e 25/12 → de 24/12 00:00 até 26/12 00:00, horário de São Paulo
  await page.fill('#bFrom', '2026-12-24');
  await page.fill('#bTo', '2026-12-25');
  await page.fill('#bReason', '  Natal   e  recesso ');
  await page.click('#bSave');
  await page.waitForSelector('#bMsg .cl-note.ok');
  assert.deepEqual(calls(log, '/rpc/add_my_block')[0].body, { p_clinic: C1, p_starts: '2026-12-24T00:00:00-03:00', p_ends: '2026-12-26T00:00:00-03:00', p_reason: 'Natal e recesso' });
  assert.match(await page.textContent('#agBlocks'), /24\/12\/2026 até .*25\/12\/2026 \(dias inteiros\)/);
  assert.match(await page.textContent('#agBlocks'), /Natal e recesso/);
  assert.equal(await page.inputValue('#bFrom'), '', 'formulário limpo');
  assert.ok(calls(log, '/clinic_blocks').length >= 2, 'lista buscada de novo');
  // só algumas horas de um dia
  await page.check('input[name=blkKind][value=part]');
  assert.ok(await page.isVisible('#bPart'));
  assert.ok(await page.isHidden('#bToBox'));
  assert.equal(await page.textContent('label[for=bFrom]'), 'Dia');
  await page.fill('#bFrom', '2026-11-05');
  await page.fill('#bStart', '12:00');
  await page.fill('#bEnd', '11:00');
  await page.click('#bSave');
  assert.match(await page.textContent('#bEndErr'), /O fim precisa ser depois do início/);
  await page.fill('#bStart', '14:00');
  await page.fill('#bEnd', '16:30');
  await noOverflow(page);
  await shot(page, '18-celular-agenda-bloqueio');
  await page.click('#bSave');
  await page.waitForFunction(() => document.querySelectorAll('#agBlocks li').length === 4);
  assert.deepEqual(calls(log, '/rpc/add_my_block')[1].body, { p_clinic: C1, p_starts: '2026-11-05T14:00:00-03:00', p_ends: '2026-11-05T16:30:00-03:00', p_reason: null });
  assert.match(await page.textContent('#agBlocks'), /05\/11\/2026, das 14:00 às 16:30/);
  assert.ok(await page.isHidden('#bPart'), 'volta para “dia inteiro” depois de salvar');
  // remover: o foco vai para o próximo da lista
  await page.click(`[data-unblock="${B1}"]`);
  await page.waitForSelector('#unblockMsg .cl-note.ok');
  assert.deepEqual(calls(log, '/rpc/remove_my_block')[0].body, { p_block: B1 });
  assert.equal(await page.locator(`#blk-${B1}`).count(), 0);
  assert.match(await page.textContent('#unblockMsg'), /02\/11\/2026 \(dia inteiro\) removido/);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.unblock), db.blocks.find((b) => b.starts_at === '2026-11-05T14:00:00-03:00').id, 'próximo pela data (05/11)');
  // sem permissão
  db.removeResult = 'forbidden';
  await page.click(`[data-unblock="${B2}"]`);
  await page.waitForSelector('#unblockMsg .cl-note.err');
  assert.match(await page.textContent('#unblockMsg'), /não pode remover bloqueios/);
  assert.equal(await page.locator(`#blk-${B2}`).count(), 1);
  assert.ok(await page.isEnabled(`[data-unblock="${B2}"]`));
  // faixa com "só alguns" exames no celular
  await page.locator('#agday-1 .ag-row').nth(1).scrollIntoViewIfNeeded();
  await noOverflow(page);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pedidos com horário marcado: destaque, ordem pela data e filtros Hoje e Próximos 7 dias', async () => {
  const mk = (n, o) => ({ ...REQUESTS[0], id: `rrrrrrrr-0000-4000-8000-0000000003${n}`, notes: null, patient_email: null, ...o });
  const rows = [
    mk('01', { patient_name: 'Paciente Longe', preferred_date: '2026-11-20', preferred_period: 'tarde', status: 'pending', created_at: '2026-10-29T10:00:00Z' }),
    mk('02', { patient_name: 'Paciente Passado', preferred_date: '2026-10-20', status: 'completed', created_at: '2026-10-10T10:00:00Z' }),
    mk('03', { patient_name: 'Paciente Semana', exam_code: 'usg', slot_start: '2026-11-04T12:00:00+00:00', preferred_date: '2026-11-04', preferred_period: 'manha', status: 'confirmed', created_at: '2026-10-29T09:00:00Z' }),
    mk('04', { patient_name: 'Paciente Hoje', slot_start: '2026-10-30T17:30:00+00:00', preferred_date: '2026-10-30', preferred_period: 'tarde', status: 'confirmed', created_at: '2026-10-28T09:00:00Z' }),
    mk('05', { patient_name: 'Paciente Cancelou', slot_start: '2026-11-01T13:00:00+00:00', preferred_date: '2026-11-01', preferred_period: 'manha', status: 'cancelled', created_at: '2026-10-27T09:00:00Z' }),
  ];
  const { page, log, errors, context } = await newPage(browser, { logged: true, now: NOW, db: { members: [{ clinic_id: C1, role: 'owner' }], clinics: [CLINIC], requests: rows } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  assert.match(calls(log, '/appointment_requests')[0].query.get('select'), /,slot_start$/);
  const names = () => page.$$eval('.rq h3', (h) => h.map((x) => x.textContent.split(' · ')[1]));
  assert.deepEqual(await names(), ['Paciente Hoje', 'Paciente Cancelou', 'Paciente Semana', 'Paciente Longe', 'Paciente Passado']);
  const hoje = page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000304');
  assert.match(await hoje.locator('.rq-slot').textContent(), /Agendado pelo site \(confirmado\)/);
  assert.match(await hoje.textContent(), /Horário marcado.*30\/10\/2026 às 14:30/);
  assert.doesNotMatch(await hoje.textContent(), /Data preferida|Período/);
  assert.match(await hoje.locator('.rq-act .lbl').textContent(), /“Cancelado” libera o horário para outro paciente/);
  assert.match(await page.textContent('#rq-rrrrrrrr-0000-4000-8000-000000000303'), /04\/11\/2026 às 09:00/);
  assert.match(await page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000305 .rq-slot').textContent(), /Horário escolhido pelo paciente no site/);
  const longe = page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000301');
  assert.equal(await longe.locator('.rq-slot').count(), 0);
  assert.match(await longe.textContent(), /Data preferida.*20\/11\/2026/);
  await shot(page, '19-painel-pedidos-horario');
  // filtros: "Hoje" e "Próximos 7 dias" buscam no banco pela data do exame
  assert.deepEqual(await page.$$eval('#flt-when option', (o) => o.map((x) => x.textContent)), ['Qualquer data', 'Hoje', 'Próximos 7 dias']);
  await pickWhen(page, 'hoje');
  const qh = calls(log, '/appointment_requests').at(-1).query;
  assert.deepEqual(qh.getAll('preferred_date'), ['eq.2026-10-30']);
  assert.equal(qh.get('clinic_id'), `eq.${C1}`);
  assert.equal(qh.get('limit'), '200');
  assert.match(qh.get('select'), /,slot_start$/);
  assert.deepEqual(await names(), ['Paciente Hoje']);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'flt-when');
  await pickWhen(page, 'semana');
  const qs = calls(log, '/appointment_requests').at(-1).query;
  assert.deepEqual(qs.getAll('preferred_date'), ['gte.2026-10-30', 'lte.2026-11-05']);
  assert.equal(qs.get('order'), 'preferred_date,slot_start,created_at.desc');
  assert.deepEqual(await names(), ['Paciente Hoje', 'Paciente Cancelou', 'Paciente Semana']);
  await page.selectOption('#flt-pedidos', 'confirmed');
  assert.deepEqual(await names(), ['Paciente Hoje', 'Paciente Semana']);
  await page.selectOption('#flt-pedidos', 'pending');
  assert.match(await page.textContent('#panel'), /Nenhum pedido para esse período com esse filtro/);
  // situação muda e a lista continua na ordem certa
  await page.selectOption('#flt-pedidos', '');
  await page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000303 button[data-st="completed"]').click();
  await page.waitForFunction(() => /Concluído/.test(document.querySelector('#rq-rrrrrrrr-0000-4000-8000-000000000303 .rq-st').textContent));
  assert.deepEqual(await names(), ['Paciente Hoje', 'Paciente Cancelou', 'Paciente Semana']);
  await pickWhen(page, '');
  assert.equal(await page.locator('.rq').count(), 5);
  assert.equal(calls(log, '/appointment_requests').at(-1).query.get('limit'), '100');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pedidos: "Hoje" acha o paciente de hoje mesmo com mais de 100 pedidos mais novos', async () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ ...REQUESTS[0], id: `rrrrrrrr-0000-4000-8000-0000000005${String(i).padStart(2, '0')}`, notes: null, patient_name: `Paciente ${i}`, preferred_date: '2026-11-25', created_at: '2026-10-29T20:00:00Z' }));
  const old = { ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000499', notes: null, patient_name: 'Paciente Antiga de Hoje', slot_start: '2026-10-30T19:00:00+00:00', preferred_date: '2026-10-30', preferred_period: 'tarde', status: 'confirmed', created_at: '2026-10-01T09:00:00Z' };
  const { page, log, errors, context } = await newPage(browser, { logged: true, now: NOW, db: { members: [{ clinic_id: C1, role: 'owner' }], clinics: [CLINIC], requests: [...many, old] } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  assert.equal(await page.locator('.rq').count(), 100);
  assert.equal(await page.locator(`#rq-${old.id}`).count(), 0, 'fica de fora dos 100 mais novos');
  await pickWhen(page, 'hoje');
  assert.equal(await page.locator('.rq').count(), 1);
  assert.match(await page.textContent(`#rq-${old.id}`), /Paciente Antiga de Hoje.*Horário marcado.*30\/10\/2026 às 16:00/s);
  assert.match(await page.textContent('#flt-pedidos option'), /Todos \(1\)/);
  // dia sem pedidos
  await pickWhen(page, '');
  await page.waitForSelector('.rq');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('fuso: aparelho em Tóquio às 23:30 de São Paulo (já 31/10 em UTC) usa o dia de São Paulo', async () => {
  const LATE = '2026-10-30T23:30:00-03:00';
  const reqs = [
    { ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000601', notes: null, patient_name: 'Paciente Noite', exam_code: 'usg', slot_start: '2026-10-31T02:00:00+00:00', preferred_date: '2026-10-30', preferred_period: 'noite', status: 'confirmed', created_at: '2026-10-29T10:00:00Z' },
    { ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000602', notes: null, patient_name: 'Paciente Amanhã', exam_code: 'usg', slot_start: '2026-10-31T13:00:00+00:00', preferred_date: '2026-10-31', preferred_period: 'manha', status: 'confirmed', created_at: '2026-10-29T11:00:00Z' },
  ];
  const blocks = [{ id: B1, clinic_id: C1, starts_at: '2026-10-31T03:00:00+00:00', ends_at: '2026-11-01T03:00:00+00:00', reason: 'Sábado' }];
  const slots = ['2026-10-31T04:00:00Z', '2026-10-31T13:00:00Z', '2026-11-01T02:30:00Z', '2026-11-01T11:00:00Z'].map((t) => ({ exam: 'usg', slot_start: t }));
  const { page, log, errors, context } = await newPage(browser, { logged: true, now: LATE, tz: 'Asia/Tokyo', db: agendaDb({ requests: reqs, blocks, slots }) });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  assert.equal(await page.evaluate(() => new Date().getDate()), 31, 'no aparelho já é dia 31');
  assert.match(await page.textContent('#rq-rrrrrrrr-0000-4000-8000-000000000601'), /Horário marcado.*30\/10\/2026 às 23:00/s);
  await pickWhen(page, 'hoje');
  assert.deepEqual(calls(log, '/appointment_requests').at(-1).query.getAll('preferred_date'), ['eq.2026-10-30']);
  assert.deepEqual(await page.$$eval('.rq h3', (h) => h.map((x) => x.textContent.split(' · ')[1])), ['Paciente Noite']);
  await pickWhen(page, 'semana');
  assert.deepEqual(calls(log, '/appointment_requests').at(-1).query.getAll('preferred_date'), ['gte.2026-10-30', 'lte.2026-11-05']);
  // agenda
  await page.click('#tab-agenda');
  await page.waitForSelector('#pvBox .ag-pv');
  assert.equal(calls(log, '/clinic_blocks')[0].query.get('ends_at'), 'gte.2026-10-31T02:30:00.000Z');
  assert.match(await page.textContent('#agBlocks b'), /31\/10\/2026 \(dia inteiro\)$/);
  assert.equal(await page.getAttribute('#bFrom', 'min'), '2026-10-30');
  assert.equal(await page.getAttribute('#bTo', 'min'), '2026-10-30');
  // prévia agrupada pelo dia de São Paulo
  assert.deepEqual(await page.$$eval('#pvBox h4', (h) => h.map((x) => x.textContent.replace(/^\D+/, ''))), ['31/10/2026', '01/11/2026']);
  assert.deepEqual(await page.$$eval('#pvBox .ag-pv-day', (d) => d.map((x) => [...x.querySelectorAll('li')].map((l) => l.textContent))), [['01:00', '10:00', '23:30'], ['08:00']]);
  // bloqueio do dia inteiro de hoje (30/10 em São Paulo) ainda vale
  await page.fill('#bFrom', '2026-10-30');
  await page.click('#bSave');
  await page.waitForSelector('#bMsg .cl-note.ok');
  assert.deepEqual(calls(log, '/rpc/add_my_block')[0].body, { p_clinic: C1, p_starts: '2026-10-30T00:00:00-03:00', p_ends: '2026-10-31T00:00:00-03:00', p_reason: null });
  assert.match(await page.textContent('#agBlocks'), /30\/10\/2026 \(dia inteiro\)/);
  // algumas horas que já passaram em São Paulo
  await page.check('input[name=blkKind][value=part]');
  await page.fill('#bFrom', '2026-10-30');
  await page.fill('#bStart', '20:00');
  await page.fill('#bEnd', '23:00');
  await page.click('#bSave');
  assert.match(await page.textContent('#bEndErr'), /Esse período já passou/);
  assert.equal(calls(log, '/rpc/add_my_block').length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('agenda: mudança feita enquanto salva continua marcada; sair da aba durante o salvamento não dá erro', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, now: NOW, db: agendaDb({ exams: [...AG_EXAMS, { clinic_id: C1, exam_code: 'mamo', price_cents: null }] }) });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  await page.click('#tab-agenda');
  await page.waitForSelector('#agWeek');
  assert.equal(await page.locator('.ag-drop').count(), 0, 'sem aviso quando o exame continua em Exames e preços');
  assert.equal(await page.textContent('#agDirty'), '');
  // edição durante o salvamento
  db.delays = [{ path: 'rpc/set_my_schedule', match: '', ms: 700 }];
  await page.locator('#agday-6 .ag-row [data-f=end]').fill('11:00');
  await page.click('#agSave');
  await page.waitForFunction(() => document.querySelector('#agSave').disabled);
  await page.locator('#agday-6 .ag-row [data-f=end]').fill('11:30');
  await page.waitForSelector('#agMsg .cl-note.ok');
  assert.equal(calls(log, '/rpc/set_my_schedule')[0].body.p_rows.at(-1).end, '11:00');
  assert.match(await page.textContent('#agDirty'), /mudanças ainda não salvas/);
  assert.match(await page.textContent('#agMsg'), /As mudanças feitas enquanto salvava ainda não foram salvas/);
  await page.click('#agSave');
  await page.waitForFunction(() => document.querySelector('#agDirty').textContent === '' && !document.querySelector('#agSave').disabled);
  assert.equal(calls(log, '/rpc/set_my_schedule')[1].body.p_rows.at(-1).end, '11:30');
  // salvar a agenda e sair da aba antes da resposta
  const clearToast = () => page.evaluate(() => { document.querySelector('#toast').textContent = ''; });
  await clearToast();
  await page.locator('#agday-6 .ag-row [data-f=end]').fill('12:00');
  await page.click('#agSave');
  await page.click('#tab-dados');
  await page.waitForSelector('#dataForm');
  await page.waitForFunction(() => /Agenda salva/.test(document.querySelector('#toast').textContent));
  assert.equal(calls(log, '/rpc/set_my_schedule').length, 3);
  await page.click('#tab-agenda');
  await page.waitForSelector('#agWeek');
  assert.equal(await page.textContent('#agDirty'), '', 'a agenda salva não fica marcada como pendente');
  // salvar, sair e voltar antes da resposta: o aviso de pendente some quando a resposta chega
  await clearToast();
  await page.locator('#agday-6 .ag-row [data-f=end]').fill('11:45');
  await page.click('#agSave');
  await page.click('#tab-dados');
  await page.waitForSelector('#dataForm');
  await page.click('#tab-agenda');
  await page.waitForSelector('#agWeek');
  assert.match(await page.textContent('#agDirty'), /não salvas/, 'rascunho enquanto o salvamento não volta');
  await page.waitForFunction(() => /Agenda salva/.test(document.querySelector('#toast').textContent));
  await page.waitForFunction(() => document.querySelector('#agDirty').textContent === '');
  assert.equal(calls(log, '/rpc/set_my_schedule')[3].body.p_rows.at(-1).end, '11:45');
  // bloqueio salvo e sair da aba antes da resposta
  db.delays = [{ path: 'rpc/add_my_block', match: '', ms: 600 }, { path: 'rpc/remove_my_block', match: '', ms: 600 }];
  await page.fill('#bFrom', '2026-12-24');
  await page.click('#bSave');
  await page.click('#tab-exames');
  await page.waitForSelector('#examForm');
  await page.waitForFunction(() => /Bloqueio salvo/.test(document.querySelector('#toast').textContent));
  assert.equal(calls(log, '/rpc/add_my_block').length, 1);
  // remover bloqueio e sair da aba antes da resposta
  await page.click('#tab-agenda');
  await page.waitForSelector('#agBlocks li');
  const n = await page.locator('#agBlocks li').count();
  await page.click(`[data-unblock="${B1}"]`);
  await page.click('#tab-dados');
  await page.waitForSelector('#dataForm');
  await page.waitForFunction(() => /Bloqueio removido/.test(document.querySelector('#toast').textContent));
  await page.click('#tab-agenda');
  await page.waitForSelector('#agBlocks li');
  assert.equal(await page.locator(`#blk-${B1}`).count(), 0);
  assert.equal(await page.locator('#agBlocks li').count(), n - 1);
  // remover, sair e voltar antes da resposta: a lista aberta de novo também perde o bloqueio
  await page.click(`[data-unblock="${B2}"]`);
  await page.click('#tab-dados');
  await page.waitForSelector('#dataForm');
  await page.click('#tab-agenda');
  await page.waitForSelector(`#blk-${B2}`);
  await page.waitForFunction((id) => !document.querySelector(`#blk-${id}`), B2);
  assert.equal(await page.locator(`#blk-${B2}`).count(), 0, 'a lista aberta de novo também perde o bloqueio removido');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('equipe do IMED sem vínculo abre a agenda de qualquer clínica', async () => {
  const C2 = 'cccccccc-0000-4000-8000-000000000002';
  const { page, log, errors, context } = await newPage(browser, { logged: true, email: 'equipe@imed.com.br', now: NOW, db: agendaDb({
    admin: true, members: [], clinics: [CLINIC, { ...CLINIC, id: C2, name: 'Outra <i>Clínica</i>', status: 'draft' }], claims: CLAIMS,
  }) });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#cl-kkkkkkkk-0000-4000-8000-000000000001');
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Pedidos de cadastro|Pedidos ao IMED');
  assert.equal(await page.textContent('#clinicTitle'), 'Equipe do IMED');
  const all = calls(log, '/clinics').find((e) => !e.query.get('id'));
  assert.equal(all.query.get('limit'), '500');
  assert.equal(all.query.get('order'), 'name');
  assert.equal(await page.inputValue('#clinicPick'), '');
  assert.deepEqual(await page.$$eval('#clinicPick option', (o) => o.map((x) => x.textContent)), ['Equipe do IMED (sem clínica)', 'Imagem Paulista', 'Outra <i>Clínica</i> (rascunho)']);
  await page.selectOption('#clinicPick', C1);
  await page.waitForSelector('.rq');
  assert.equal(await page.textContent('#clinicTitle'), 'Imagem Paulista');
  assert.match(await page.textContent('#app'), /Você está vendo esta clínica como equipe do IMED/);
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Pedidos|Agenda|Dados da clínica|Exames e preços|Pedidos de cadastro|Pedidos ao IMED');
  await page.click('#tab-agenda');
  await page.waitForSelector('#agWeek');
  assert.equal(calls(log, '/clinic_schedules')[0].query.get('clinic_id'), `eq.${C1}`);
  await page.click('#agSave');
  await page.waitForSelector('#agMsg .cl-note.ok');
  assert.equal(calls(log, '/rpc/set_my_schedule')[0].body.p_clinic, C1);
  // de volta às abas da equipe
  await page.selectOption('#clinicPick', '');
  await page.waitForSelector('#cl-kkkkkkkk-0000-4000-8000-000000000001');
  assert.equal(await page.textContent('#clinicTitle'), 'Equipe do IMED');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (390px): reivindicar e painel sem rolagem lateral', async () => {
  let { page, errors, context } = await newPage(browser, { mobile: true, logged: true });
  await page.goto(`${BASE}reivindicar.html?cnes=2077485`);
  await page.waitForSelector('#s3:not([hidden])');
  await noOverflow(page);
  await shot(page, '11-celular-reivindicar');
  await page.goto(`${BASE}reivindicar.html`);
  await page.waitForSelector('#city option[value="3550308"]', { state: 'attached' });
  await page.fill('#cityFilter', 'paulo');
  await page.fill('#term', 'santa');
  await page.click('#findBtn');
  await page.waitForSelector('#results li');
  await noOverflow(page);
  await shot(page, '12-celular-busca');
  assert.deepEqual(errors, []);
  await context.close();
  ({ page, errors, context } = await newPage(browser, { mobile: true, logged: true, db: {
    admin: true, members: [{ clinic_id: C1, role: 'owner' }, { clinic_id: 'cccccccc-0000-4000-8000-000000000002', role: 'staff' }], clinics: [CLINIC, { ...CLINIC, id: 'cccccccc-0000-4000-8000-000000000002', name: 'Segunda Clínica com Nome Bem Comprido Para Testar', status: 'draft' }],
    requests: [...REQUESTS, ...IMED_REQUESTS], claims: CLAIMS,
    exams: [{ clinic_id: C1, exam_code: 'rm', price_cents: 45000 }],
  } }));
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  assert.equal(await page.locator('[role=tab]').count(), 6);
  await noOverflow(page);
  await shot(page, '13-celular-painel-pedidos');
  for (const t of ['agenda', 'dados', 'exames', 'cadastros', 'concierge']) {
    await page.click(`#tab-${t}`);
    await page.waitForFunction(() => !document.querySelector('#panel .cl-state'));
    await noOverflow(page);
    await shot(page, `14-celular-painel-${t}`);
  }
  await page.selectOption('#clinicPick', 'cccccccc-0000-4000-8000-000000000002');
  await page.waitForSelector('.cl-note.warn');
  assert.match(await page.textContent('#app'), /rascunho/);
  await noOverflow(page);
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
