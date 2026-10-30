// Teste de ponta a ponta da frente MÉDICOS num navegador de verdade (Playwright):
// - para-medicos.html ("Atenda pelo IMED"): abre; o fluxograma é uma lista numerada acessível, com os 7 passos em
//   ordem ("Passo N" no título de cada um), os três caminhos depois da conferência e as setas só de desenho; cita a
//   Res. CFM 2.314/2022 e a LGPD; não promete ganho nem pacientes e não mostra preço; "Fazer minha inscrição" leva a
//   medico.html; rodapé com o médico responsável e "Para médicos"; sem rolagem lateral em 390 px; sem erro no console;
// - medico.html: etapas do cadastro (Conta criada → Cadastro enviado → Conferência do CRM → Aprovado → Disponível)
//   certas para quem ainda não tem cadastro, em análise, aprovado (e disponível), recusado e suspenso, com o que fazer;
//   e a INSCRIÇÃO COMPLETA do médico (e-mail, cadastro, conferência e aprovação pela equipe do IMED, aviso e
//   "Disponível para atender"), com capturas de tela de cada passo para mostrar o fluxo;
// - ligações: página inicial ("É médico? Atenda pelo IMED"), rodapé (scripts/rodape.mjs), sitemap.xml e topo da área
//   do médico;
// - acessibilidade: auditoria do axe-core (WCAG A/AA) na página nova e nas etapas, quando o axe-core estiver instalado.
// O banco e a entrada pelo link do e-mail são simulados EM MEMÓRIA (context.route), com as mesmas regras de
// supabase/migrations/*_teleconsulta.sql usadas aqui (como em tests/e2e-tele.mjs).
// Rodar: node tests/e2e-medicos.mjs   (precisa do pacote "playwright")
// Opcional: SHOTS=pasta salva as capturas de tela (medicos-01 ... para mostrar o fluxo); E2E_PORT muda a porta
//           (padrão 4771); ONLY="trecho" roda só os cenários com esse trecho no nome; AXE_PATH=<pasta do axe-core>.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { GRUPOS, rodapeHtml } from '../scripts/rodape.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

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
const PORT = Number(process.env.E2E_PORT) || 4771; // E2E_PORT: outra porta para rodar em paralelo
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

/* ======================= axe-core (fora do site; opcional) ======================= */
function findAxe() {
  const tries = [];
  if (process.env.AXE_PATH) {
    const p = resolve(process.env.AXE_PATH);
    tries.push(() => require.resolve(p)); // arquivo axe.js / axe.min.js ou a pasta do pacote
    tries.push(() => createRequire(join(p, 'noop.js')).resolve('axe-core')); // pasta com node_modules/axe-core
  }
  tries.push(() => require.resolve('axe-core')); // node_modules do projeto (no GitHub, o workflow instala)
  for (const t of tries) {
    try {
      const f = t();
      if (f && existsSync(f)) { const min = join(dirname(f), 'axe.min.js'); return existsSync(min) ? min : f; }
    } catch { /* tenta o próximo */ }
  }
  return null;
}
const AXE = findAxe();
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/* ======================= banco simulado (cadastro e conferência do médico) ======================= */
const USERS = {
  'tok-new': { id: 'u-new', email: 'bia@exemplo.com' },
  'tok-pend': { id: 'u-pend', email: 'pedro@exemplo.com' },
  'tok-ok': { id: 'u-ok', email: 'carla@exemplo.com' },
  'tok-rej': { id: 'u-rej', email: 'rui@exemplo.com' },
  'tok-sus': { id: 'u-sus', email: 'sara@exemplo.com' },
  'tok-admin': { id: 'u-admin', email: 'equipe@exemplo.com' },
};
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const DOCTOR_FNS = new Set(['tele_doctor_me', 'tele_doctor_register', 'tele_set_available', 'tele_queue', 'tele_history', 'tele_doctor_profile', 'tele_doc_pending',
  'tele_admin_doctors', 'tele_admin_save_checks', 'tele_admin_set_doctor']);
const DAY = 86400e3;
const iso = (t = Date.now()) => new Date(t).toISOString();
const digits = (v) => String(v ?? '').replace(/\D/g, '');
class PgErr extends Error { constructor(message, details = null) { super(message); this.details = details; } }

function makeDb() {
  const db = { doctors: new Map(), admins: new Set(['u-admin']), checks: [], calls: [], otp: [] };
  db.addDoctor = (d) => {
    const row = { id: randomUUID(), rqe: null, specialty: null, phone: null, status: 'approved', review_note: null, reviewed_at: null, reviewed_by: null,
      checked_at: iso(Date.now() - DAY), available_until: null, created_at: iso(Date.now() - DAY), updated_at: iso(), ...d };
    db.doctors.set(row.id, row);
    return row;
  };
  db.called = (fn) => db.calls.filter((c) => c.fn === fn);
  return db;
}
// Um médico em cada situação (para os cenários das etapas).
function seedDb() {
  const db = makeDb();
  db.addDoctor({ user_id: 'u-pend', full_name: 'Pedro Lima', crm: '55443', crm_uf: 'RJ', status: 'pending', checked_at: null });
  db.addDoctor({ user_id: 'u-ok', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', rqe: '7788', specialty: 'Clínica médica' });
  db.addDoctor({ user_id: 'u-rej', full_name: 'Rui Prado', crm: '11223', crm_uf: 'MG', status: 'rejected', checked_at: null, review_note: 'O número do CRM não confere com o nome na busca do CFM. Confira e envie de novo.' });
  db.addDoctor({ user_id: 'u-sus', full_name: 'Sara Nunes', crm: '99887', crm_uf: 'BA', status: 'suspended', review_note: 'A conferência anual do cadastro venceu.' });
  return db;
}
const docOf = (db, uid) => [...db.doctors.values()].find((d) => d.user_id === uid) || null;
function me(db, uid, needApproved) {
  if (!uid) throw new PgErr('sem_login');
  const d = docOf(db, uid);
  if (!d) throw new PgErr('sem_cadastro');
  if (needApproved && d.status !== 'approved') throw new PgErr('nao_aprovado');
  return d;
}
// O que falta na última conferência para aprovar (como private.tele_check_missing).
function checkMissing(c, d) {
  if (!c) return 'conferencia';
  if (['full_name', 'crm', 'crm_uf', 'rqe', 'specialty'].some((k) => (c[k] ?? null) !== (d[k] ?? null))) return 'dados';
  if (!c.cfm_active) return 'cfm';
  if (d.rqe && !c.rqe_checked) return 'rqe';
  if (!((c.id_video && c.crm_card) || c.icp_signature)) return 'identidade';
  return null;
}
const lastCheck = (db, d) => [...db.checks].reverse().find((c) => c.doctor_id === d.id) || null;
const emailOf = (uid) => Object.values(USERS).find((u) => u.id === uid)?.email || null;

const RPC = {
  tele_doctor_me(db, a, uid) {
    const d = docOf(db, uid);
    const f = ['id', 'full_name', 'crm', 'crm_uf', 'rqe', 'specialty', 'phone', 'status', 'review_note', 'reviewed_at', 'available_until', 'created_at', 'updated_at', 'checked_at'];
    return [{ ...Object.fromEntries(f.map((k) => [k, d ? d[k] : null])), is_admin: db.admins.has(uid) }];
  },
  tele_doctor_register(db, a, uid) {
    if (!uid) throw new PgErr('sem_login');
    const name = String(a.p_full_name ?? '').replace(/\s+/g, ' ').trim();
    const crm = digits(a.p_crm).replace(/^0+/, '');
    const uf = String(a.p_crm_uf ?? '').trim().toUpperCase();
    const rqe = digits(a.p_rqe).replace(/^0+/, '') || null;
    const spec = String(a.p_specialty ?? '').replace(/\s+/g, ' ').trim() || null;
    let phone = digits(a.p_phone) || null;
    if (name.length < 5 || name.length > 120 || !/\S \S/.test(name)) throw new PgErr('dados_invalidos', 'nome');
    if (!/^[1-9][0-9]{0,9}$/.test(crm)) throw new PgErr('dados_invalidos', 'crm');
    if (!UFS.includes(uf)) throw new PgErr('dados_invalidos', 'uf');
    if ((spec === null) !== (rqe === null) || (spec && (spec.length < 2 || spec.length > 80))) throw new PgErr('dados_invalidos', 'especialidade');
    if (phone) { if ((phone.length === 12 || phone.length === 13) && phone.startsWith('55')) phone = phone.slice(2); if (!/^[1-9][1-9][0-9]{8,9}$/.test(phone)) throw new PgErr('dados_invalidos', 'telefone'); }
    const mine = docOf(db, uid);
    if (!mine) { db.addDoctor({ user_id: uid, full_name: name, crm, crm_uf: uf, rqe, specialty: spec, phone, status: 'pending', checked_at: null, created_at: iso() }); return 'pending'; }
    const changed = [mine.full_name, mine.crm, mine.crm_uf, mine.rqe, mine.specialty].join('|') !== [name, crm, uf, rqe, spec].join('|');
    const st = mine.status === 'rejected' ? 'pending' : mine.status === 'approved' && changed ? 'pending' : mine.status;
    Object.assign(mine, { full_name: name, crm, crm_uf: uf, rqe, specialty: spec, phone, review_note: st === 'pending' && mine.status !== 'pending' ? null : mine.review_note,
      status: st, available_until: st === 'approved' ? mine.available_until : null, updated_at: iso() });
    return st;
  },
  tele_set_available(db, a, uid) {
    if (a.p_on) { const d = me(db, uid, true); d.available_until = iso(Date.now() + 90e3); return d.available_until; }
    if (!uid) throw new PgErr('sem_login');
    const d = docOf(db, uid); if (d) d.available_until = null;
    return null;
  },
  tele_queue(db, a, uid) { me(db, uid, true); return []; },
  tele_history(db, a, uid) { return docOf(db, uid) ? [] : []; },
  tele_doctor_profile(db, a, uid) { me(db, uid, false); return [{ prof_address: null, prof_contact: null }]; },
  tele_doc_pending(db, a, uid) { me(db, uid, true); return []; },
  tele_admin_doctors(db, a, uid) {
    if (!db.admins.has(uid)) throw new PgErr('so_admin');
    const list = [...db.doctors.values()];
    const pend = list.filter((d) => d.status === 'pending').sort((x, y) => x.created_at.localeCompare(y.created_at));
    const rest = list.filter((d) => d.status !== 'pending').sort((x, y) => y.created_at.localeCompare(x.created_at));
    return [...pend, ...rest].map((d) => {
      const lc = lastCheck(db, d);
      return { ...d, email: emailOf(d.user_id), consultations: 0, last_check: lc ? { ...lc, missing: checkMissing(lc, d) } : null,
        crm_duplicates: list.filter((o) => o !== d && o.crm === d.crm && o.crm_uf === d.crm_uf && o.status !== 'rejected').length };
    });
  },
  tele_admin_save_checks(db, a, uid) {
    if (!db.admins.has(uid)) throw new PgErr('so_admin');
    const d = db.doctors.get(a.p_doctor);
    if (!d) throw new PgErr('nao_encontrado');
    const k = a.p_checks || {};
    const note = String(k.note ?? '').trim() || null;
    if (note && note.length > 300) throw new PgErr('dados_invalidos', 'nota');
    const c = { id: db.checks.length + 1, doctor_id: d.id, full_name: d.full_name, crm: d.crm, crm_uf: d.crm_uf, rqe: d.rqe, specialty: d.specialty,
      cfm_active: k.cfm_active === true, rqe_checked: !!d.rqe && k.rqe_checked === true, id_video: k.id_video === true, crm_card: k.crm_card === true,
      icp_signature: k.icp_signature === true, note, checked_by: emailOf(uid), checked_at: iso() };
    db.checks.push(c);
    return checkMissing(c, d) ? 'incompleta' : 'completa';
  },
  tele_admin_set_doctor(db, a, uid) {
    if (!db.admins.has(uid)) throw new PgErr('so_admin');
    if (!['approved', 'rejected', 'suspended'].includes(a.p_status)) throw new PgErr('dados_invalidos', 'status');
    const d = db.doctors.get(a.p_doctor);
    if (!d) throw new PgErr('nao_encontrado');
    let lc = null;
    if (a.p_status === 'approved') {
      lc = lastCheck(db, d);
      const miss = checkMissing(lc, d) || (Date.now() - Date.parse(lc.checked_at) > 30 * DAY ? 'antiga' : null);
      if (miss) throw new PgErr('conferencia_incompleta', miss);
    }
    Object.assign(d, { status: a.p_status, reviewed_at: iso(), reviewed_by: emailOf(uid), review_note: String(a.p_note ?? '').trim().slice(0, 300) || null,
      available_until: a.p_status === 'approved' ? d.available_until : null, checked_at: lc ? lc.checked_at : d.checked_at, updated_at: iso() });
    return d.status;
  },
};

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body), headers: cors });

/* ======================= páginas ======================= */
// csp: false liga o bypassCSP (só para injetar o axe-core; nos outros cenários a CSP da página vale).
async function newPage(browser, db, { mobile = false, csp = true } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block', reducedMotion: 'reduce', bypassCSP: !csp,
  });
  // Aviso de privacidade já aceito (não cobre a página nas capturas).
  await context.addInitScript(() => { try { localStorage.setItem('imed_lgpd', '1'); } catch { /* ignora */ } });
  await context.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    const auth = (req.headers().authorization || '').replace(/^Bearer /, '');
    if (u.pathname === '/auth/v1/user') return USERS[auth] ? json(route, USERS[auth]) : json(route, { msg: 'invalid' }, 401);
    if (u.pathname === '/auth/v1/otp') { db.otp.push({ body: JSON.parse(req.postData() || '{}'), redirect: u.searchParams.get('redirect_to') }); return json(route, {}); }
    if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    const m = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (!m || !RPC[m[1]]) return json(route, { message: 'não simulado' }, 404);
    const fn = m[1];
    const args = JSON.parse(req.postData() || '{}');
    const uid = USERS[auth]?.id || null;
    db.calls.push({ fn, args, uid, at: Date.now() });
    if (DOCTOR_FNS.has(fn) && !uid) return json(route, { code: '42501', message: `permission denied for function ${fn}` }, 401);
    try {
      const out = RPC[fn](db, args, uid);
      return out === null ? route.fulfill({ status: 204, body: '', headers: cors }) : json(route, out);
    } catch (e) {
      if (e instanceof PgErr) return json(route, { code: 'P0001', message: e.message, details: e.details, hint: null }, 400);
      return json(route, { message: String(e) }, 500);
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  return { context, page, errors };
}
const loginUrl = (tok) => `${BASE}medico.html#access_token=${tok}&refresh_token=r-${tok}&expires_in=3600&token_type=bearer&type=magiclink`;
// Capturas de tela (só com SHOTS): a página inteira, ou só um pedaço (com o topo parado, para não cobrir o pedaço).
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); } };
const shotEl = async (page, sel, name) => {
  if (!SHOTS) return;
  await page.addStyleTag({ content: '.g-top,.pt-top{position:static!important}' });
  await page.waitForTimeout(300);
  await page.locator(sel).screenshot({ path: join(SHOTS, `${name}.png`) });
};
// Rolagem lateral de verdade: com isMobile, o Chromium aumenta window.innerWidth até a largura do conteúdo, então a
// conta é com a largura visível do documento (clientWidth). Lista também os elementos que passam da borda.
const overflow = (page) => page.evaluate(() => {
  const cw = document.documentElement.clientWidth;
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (/(hidden|auto|scroll|clip)/.test(getComputedStyle(p).overflowX)) return true; } return false; };
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || cs.position === 'fixed' || cs.display === 'none' || el.classList.contains('sr') || el.classList.contains('rd-sr') || clipped(el)) continue;
    if (r.right > cw + 1) bad.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`);
  }
  return { px: document.documentElement.scrollWidth - cw, bad: bad.slice(0, 5) };
});
const noOverflow = async (page, where) => { const o = await overflow(page); assert.ok(o.px <= 0 && !o.bad.length, `${where}: sem rolagem lateral (${o.px}px; ${o.bad.join(', ')})`); };
const results = [];
async function scenario(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const t0 = Date.now();
  try { await fn(); results.push(['ok', name]); console.log(`ok - ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 6).join('\n  ')}`); }
}
const visible = (page, sel, timeout = 15000) => page.waitForSelector(sel, { state: 'visible', timeout });
const text = async (page, sel) => (await page.locator(sel).innerText()).replace(/\s+/g, ' ').trim();

/* ---------- etapas do cadastro (medico.html) ---------- */
const STEPS = ['Conta criada', 'Cadastro enviado', 'Conferência do CRM', 'Aprovado', 'Disponível'];
// Lê o indicador de etapas: rótulos, etapa atual (aria-current="step"), concluídas, com problema e o que fazer.
const steps = (page, sel) => page.$eval(sel, (box) => {
  const lis = [...box.querySelectorAll('.md-stepper > li')];
  const name = (li) => li.querySelector('.md-sl').firstChild.textContent.trim();
  const list = box.querySelector('.md-stepper');
  return {
    shown: !box.hidden && box.getBoundingClientRect().height > 0,
    tag: list?.tagName, label: list?.getAttribute('aria-label') || '',
    labels: lis.map(name),
    current: lis.filter((li) => li.getAttribute('aria-current') === 'step').map(name),
    done: lis.filter((li) => li.classList.contains('done')).map(name),
    doneSr: lis.filter((li) => li.classList.contains('done')).every((li) => /\(concluída\)/.test(li.textContent)),
    bad: lis.filter((li) => li.classList.contains('bad')).map((li) => `${name(li)}: ${li.querySelector('small')?.textContent.trim()}`),
    on: lis.some((li) => li.classList.contains('on')),
    msg: (box.querySelector('.md-stepmsg')?.textContent || '').replace(/\s+/g, ' ').trim(),
    contact: box.querySelector('.md-stepmsg a')?.getAttribute('href') || null,
    help: box.querySelector('.md-stephelp a')?.getAttribute('href') || null,
    helpText: (box.querySelector('.md-stephelp a')?.textContent || '').trim(),
  };
});
// Espera a etapa atual virar `label` no quadro `sel`.
const waitStep = (page, sel, label) => page.waitForFunction(([s, l]) => {
  const li = document.querySelector(`${s} .md-stepper > li[aria-current="step"]`);
  return !!li && li.querySelector('.md-sl').firstChild.textContent.trim() === l;
}, [sel, label], { timeout: 15000 });
// Confere o indicador inteiro de uma vez.
async function expectSteps(page, sel, { current, bad = null, on = false, msg }) {
  await waitStep(page, sel, current);
  const s = await steps(page, sel);
  const at = STEPS.indexOf(current);
  assert.ok(s.shown, `${sel}: etapas à vista`);
  assert.equal(s.tag, 'OL', 'lista numerada');
  assert.equal(s.label, 'Etapas do seu cadastro de médico');
  assert.deepEqual(s.labels, STEPS, 'as cinco etapas, em ordem');
  assert.deepEqual(s.current, [current], 'uma etapa atual só (aria-current="step")');
  assert.deepEqual(s.done, STEPS.slice(0, at), 'as anteriores aparecem como concluídas');
  assert.ok(s.doneSr, 'concluídas com "(concluída)" para o leitor de tela');
  assert.deepEqual(s.bad, bad ? [`${current}: Situação: ${bad}`] : [], 'etapa com problema');
  assert.equal(s.on, on, 'disponível agora');
  assert.match(s.msg, msg);
  assert.equal(s.help, 'para-medicos.html#fluxo');
  assert.equal(s.helpText, 'Como funciona para o médico');
  return s;
}

/* ---------- auditoria do axe-core ---------- */
async function runAxe(page, include = null) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async ([tags, inc]) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(inc ? { include: inc } : document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  }, [AXE_TAGS, include]);
}

const browser = await chromium.launch();

/* ======================= cenários ======================= */
const FLOW = [
  'Passo 1 Crie sua conta pelo e-mail',
  'Passo 2 Preencha o cadastro',
  'Passo 3 A equipe do IMED confere o CRM no portal do CFM',
  'Passo 4 Resultado da conferência',
  'Passo 5 Leia o aviso e fique disponível quando quiser',
  'Passo 6 Atenda os pacientes da fila',
  'Passo 7 Assine os documentos com ICP-Brasil',
];

await scenario('para-medicos.html: abre, fluxograma acessível com os passos em ordem e o botão leva à inscrição', async () => {
  const db = makeDb();
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(`${BASE}para-medicos.html`);
  assert.match(await page.title(), /^Para médicos: atenda por teleconsulta \| IMED$/);
  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(await text(page, 'h1'), 'Atenda pelo IMED');
  // Títulos sem pular nível (h1 → h2 → h3).
  const levels = await page.$$eval('main h1, main h2, main h3', (hs) => hs.map((h) => Number(h.tagName[1])));
  levels.forEach((l, i) => { if (i) assert.ok(l <= levels[i - 1] + 1, `título nível ${l} depois de ${levels[i - 1]}`); });

  // Fluxograma: lista numerada com nome, 7 passos em ordem, cada um com o título "Passo N ...".
  const flow = page.getByRole('list', { name: 'Fluxograma: da inscrição ao atendimento, em 7 passos' });
  assert.equal(await flow.count(), 1, 'fluxograma é uma lista com nome');
  assert.equal(await flow.evaluate((el) => el.tagName), 'OL', 'lista numerada (a ordem conta)');
  assert.equal(await flow.locator(':scope > li').count(), 7);
  const titles = (await flow.getByRole('heading', { level: 3 }).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  assert.deepEqual(titles, FLOW, 'os passos, na ordem da inscrição até o atendimento');
  // Na tela, um passo embaixo do outro, na mesma ordem.
  const tops = await flow.locator(':scope > li > .pm-box').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  tops.forEach((t, i) => { if (i) assert.ok(t > tops[i - 1], 'passos em ordem na tela'); });
  // Os três caminhos depois da conferência, com a volta para o passo 3 e a continuação para o passo 5.
  const branches = page.getByRole('list', { name: 'Os três caminhos depois da conferência' });
  const opts = (await branches.getByRole('listitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  assert.deepEqual(opts.map((t) => t.split(/(?<=correção|Recusado|Aprovado)/)[0]), ['Pedimos correção', 'Recusado', 'Aprovado']);
  assert.match(opts[0], /Corrija e envie de novo\. Volta para a conferência \(passo 3\)/);
  assert.equal(await branches.locator('a[href="#passo-3"]').count(), 1, 'link para o passo 3');
  assert.match(opts[2], /Siga para o passo 5/);
  assert.equal(await branches.locator('a[href="contato.html"]').count(), 1, 'recusado: fale com o IMED');
  // Setas e ícones são só desenho: ficam no CSS ou escondidos do leitor de tela.
  assert.equal(await flow.locator('.pm-ic[aria-hidden="true"]').count(), 7);
  assert.equal(await page.getAttribute('.pm-term', 'aria-hidden'), 'true');
  const arrows = await flow.locator(':scope > li').evaluateAll((els) => els.map((e) => [getComputedStyle(e, '::before').content, getComputedStyle(e, '::after').content]));
  assert.ok(arrows.every(([b, a]) => b === '""' && a === '""'), 'setas desenhadas no CSS (sem texto)');
  assert.ok(!/[→↓⟶➜]/.test(await text(page, '#fluxograma')), 'sem setas no texto');
  // Conteúdo pedido e regras citadas, sem promessa nem preço.
  const main = await text(page, 'main');
  for (const re of [/CRM ativo/, /RQE para anunciar especialidade/, /câmera/, /Certificado digital ICP-Brasil/, /Resolução CFM 2\.314\/2022/, /LGPD, Lei 13\.709\/2018/,
    /não promete número de pacientes, ganhos nem resultados/]) assert.match(main, re);
  assert.ok(!/R\$|\d+ ?%|ganhe|garantimos|renda extra|faturamento|\d+ pacientes por/i.test(main), 'sem preço, porcentagem nem promessa de ganho');
  assert.ok(!/[Dd]iretor técnico|[Rr]esponsável técnico médico/.test(main), 'sem título ainda não confirmado');
  assert.ok(await page.locator('main a[href="contato.html"]').count() >= 2, 'condições: Fale com o IMED');
  for (const a of await page.$$eval('.toc a', (as) => as.map((x) => x.getAttribute('href')))) assert.equal(await page.locator(a).count(), 1, `âncora ${a}`);
  // Rodapé padrão: médico responsável e o link novo "Para médicos".
  const foot = await text(page, 'footer.rodape');
  assert.match(foot, /Médico responsável: Dr\. Rafael Pereira Barreto Silva — CRM-SP 266930/);
  assert.match(foot, /Emergência\? Ligue 192 \(SAMU\)/);
  assert.equal(await page.locator('footer.rodape a[href="para-medicos.html"]', { hasText: 'Para médicos' }).count(), 1);
  await shot(page, 'medicos-01-pagina-para-medicos');
  await shotEl(page, '#fluxograma', 'medicos-02-fluxograma');
  // "Fazer minha inscrição" leva à área do médico (entrada pelo e-mail).
  const go = page.locator('#pmGo');
  assert.match(await go.innerText(), /Fazer minha inscrição/);
  assert.equal(await go.getAttribute('href'), 'medico.html');
  assert.equal(await page.locator('main a.btn[href="medico.html"]', { hasText: 'Fazer minha inscrição' }).count(), 2, 'no começo e no fim da página');
  await go.click();
  await page.waitForURL(`${BASE}medico.html`);
  await visible(page, '#loginEmail');
  assert.deepEqual(errors, [], 'sem erro no console');
  await context.close();
});

await scenario('para-medicos.html no celular (390 px): sem rolagem lateral, passos um embaixo do outro e alvos de 44 px', async () => {
  const db = makeDb();
  const { page, errors, context } = await newPage(browser, db, { mobile: true });
  await page.goto(`${BASE}para-medicos.html`);
  await visible(page, '#fluxograma');
  await noOverflow(page, 'para-medicos.html no celular');
  const boxes = await page.locator('#fluxograma > li > .pm-box, #fluxograma .pm-branches > li').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top }; }));
  assert.ok(boxes.every((b) => b.l >= 0 && b.r <= 390), 'caixas do fluxograma dentro da tela');
  boxes.forEach((b, i) => { if (i) assert.ok(b.t > boxes[i - 1].t, 'um embaixo do outro'); });
  const small = await page.locator('main a.btn, main summary').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => e.textContent.trim()));
  assert.deepEqual(small, [], 'botões e perguntas com pelo menos 44 px de altura');
  await page.click('details:has(summary:text("Tem custo"))');
  assert.match(await text(page, '.pm-faq details[open]'), /não há cobrança nem pagamento pelo site/);
  await shot(page, 'medicos-03-para-medicos-celular');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('inscrição do médico: e-mail, cadastro, conferência e aprovação pela equipe, aviso e "Disponível"', async () => {
  const db = makeDb();
  const doc = await newPage(browser, db);
  const { page } = doc;
  // 1) Conta pelo e-mail: o link de entrada volta para a área do médico.
  await page.goto(`${BASE}medico.html`);
  assert.equal(await page.getAttribute('.md-howto a', 'href'), 'para-medicos.html', 'topo: "Como funciona para o médico"');
  await visible(page, '#loginEmail');
  await page.fill('#loginEmail', 'Bia@Exemplo.com');
  await page.click('#loginBtn');
  await page.waitForSelector('#loginMsg.ok');
  assert.equal(db.otp[0].body.email, 'bia@exemplo.com');
  assert.equal(db.otp[0].redirect, `${BASE}medico.html`);
  await shot(page, 'medicos-04-entrar-com-email');
  await page.goto('about:blank');
  await page.goto(loginUrl('tok-new'));
  // 2) Ainda sem cadastro: as etapas aparecem no formulário, com "Cadastro enviado" como etapa atual.
  await visible(page, '#regCard');
  assert.equal(await page.isVisible('#meCard'), false);
  await expectSteps(page, '#regSteps', { current: 'Cadastro enviado', msg: /preencha o cadastro abaixo e toque em “Enviar para análise”/ });
  assert.equal(await page.isHidden('#meSteps'), true);
  await shot(page, 'medicos-05-cadastro-com-as-etapas');
  await page.fill('#rName', 'Beatriz  Souza');
  await page.fill('#rCrm', '0098765');
  await page.selectOption('#rUf', 'PE');
  await page.fill('#rRqe', '4321');
  await page.fill('#rSpec', 'Pediatria');
  await page.fill('#rPhone', '81999998888');
  await shot(page, 'medicos-06-cadastro-preenchido');
  await page.click('#regBtn');
  // 3) Enviado: em análise, com a etapa "Conferência do CRM".
  await visible(page, '#meCard');
  assert.deepEqual(db.called('tele_doctor_register')[0].args, { p_full_name: 'Beatriz Souza', p_crm: '98765', p_crm_uf: 'PE', p_rqe: '4321', p_specialty: 'Pediatria', p_phone: '81999998888' });
  await expectSteps(page, '#meSteps', { current: 'Conferência do CRM', msg: /a equipe do IMED confere o seu CRM no portal do CFM/ });
  assert.equal(await page.isHidden('#regSteps'), true, 'as etapas ficam só no quadro do cadastro');
  assert.match(await text(page, '#meBox'), /Beatriz Souza.*CRM-PE 98765 · Pediatria · RQE 4321.*Em análise/);
  assert.match(await text(page, '#flash'), /Cadastro enviado/);
  assert.equal(await page.isVisible('#dutyCard'), false, 'em análise não vê a fila');
  await shot(page, 'medicos-07-em-analise');
  await shotEl(page, '#meCard', 'medicos-07b-etapas-em-analise');

  // 4) A equipe do IMED confere (CFM, RQE e identidade) e aprova.
  const id = docOf(db, 'u-new').id;
  const adm = await newPage(browser, db);
  await adm.page.goto(loginUrl('tok-admin'));
  await visible(adm.page, '#adminCard');
  const card = adm.page.locator(`[data-doc="${id}"]`);
  await card.waitFor();
  assert.match(await card.innerText(), /Beatriz Souza[\s\S]*Em análise/);
  for (const k of ['cfm_active', 'rqe_checked', 'id_video', 'crm_card']) await card.locator(`[data-check="${k}"]`).check();
  await card.locator(`[data-checknote="${id}"]`).fill('Vídeo com documento e carteira do CRM em 30/10');
  await card.locator(`#note-${id}`).fill('CRM e RQE conferidos no CFM em 30/10.');
  await shot(adm.page, 'medicos-08-equipe-confere');
  await card.locator('[data-set="approved"]').click();
  await adm.page.waitForFunction((d) => /Aprovado/.test(document.querySelector(`[data-doc="${d}"]`)?.innerText || ''), id);
  assert.equal(db.doctors.get(id).status, 'approved');
  assert.deepEqual(adm.errors, []);
  await adm.context.close();

  // 5) Aprovado: lê o aviso e liga "Disponível para atender".
  await page.reload();
  await visible(page, '#noticeCard');
  await expectSteps(page, '#meSteps', { current: 'Aprovado', msg: /leia o aviso “Antes de ficar disponível” e marque que entendeu/ });
  assert.match(await text(page, '#meBox'), /Aprovado.*CRM e RQE conferidos no CFM em 30\/10\./);
  await shot(page, 'medicos-09-aprovado-le-o-aviso');
  await page.check('#noticeOk');
  await page.click('#noticeBtn');
  await visible(page, '#dutyCard');
  await expectSteps(page, '#meSteps', { current: 'Aprovado', msg: /ligue “Disponível para atender”, no quadro “Fila de pacientes”/ });
  await page.click('#availBtn');
  await page.waitForSelector('#availBtn[aria-checked="true"]');
  await expectSteps(page, '#meSteps', { current: 'Disponível', on: true, msg: /Você está disponível: os pacientes veem o seu nome e CRM/ });
  assert.ok(Date.parse(docOf(db, 'u-new').available_until) > Date.now(), 'o banco sabe que está atendendo');
  await shot(page, 'medicos-10-disponivel');
  await shotEl(page, '#meCard', 'medicos-10b-etapas-disponivel');
  // Desligou: volta para "Aprovado".
  await page.click('#availBtn');
  await page.waitForSelector('#availBtn[aria-checked="false"]');
  await expectSteps(page, '#meSteps', { current: 'Aprovado', msg: /ligue “Disponível para atender”/ });
  assert.deepEqual(doc.errors, []);
  await doc.context.close();
});

await scenario('etapas certas para em análise, aprovado, recusado (e corrigido) e suspenso, com o que fazer', async () => {
  const db = seedDb();
  // Em análise.
  let p = await newPage(browser, db);
  await p.page.goto(loginUrl('tok-pend'));
  await visible(p.page, '#meCard');
  await expectSteps(p.page, '#meSteps', { current: 'Conferência do CRM', msg: /confere o seu CRM no portal do CFM/ });
  assert.equal(await p.page.isVisible('#regCard'), false);
  assert.deepEqual(p.errors, []);
  await p.context.close();

  // Aprovado, ainda sem ler o aviso.
  p = await newPage(browser, db);
  await p.page.goto(loginUrl('tok-ok'));
  await visible(p.page, '#noticeCard');
  await expectSteps(p.page, '#meSteps', { current: 'Aprovado', msg: /leia o aviso/ });
  assert.deepEqual(p.errors, []);
  await p.context.close();

  // Recusado: etapa da conferência com problema, observação da equipe e o que fazer; corrigido, volta para a conferência.
  p = await newPage(browser, db);
  await p.page.goto(loginUrl('tok-rej'));
  await visible(p.page, '#meCard');
  const rej = await expectSteps(p.page, '#meSteps', { current: 'Conferência do CRM', bad: 'Recusado', msg: /O cadastro foi recusado\. Leia a observação da equipe, se houver, toque em “Corrigir e enviar de novo”.*Dúvidas\? fale com o IMED\./ });
  assert.equal(rej.contact, 'contato.html');
  assert.match(await text(p.page, '#meBox'), /Recusado.*O número do CRM não confere com o nome na busca do CFM/);
  assert.equal(await p.page.isVisible('#dutyCard'), false);
  await shot(p.page, 'medicos-11-recusado');
  await p.page.click('#editBtn');
  await visible(p.page, '#regCard');
  assert.equal(await p.page.isHidden('#regSteps'), true, 'editando: as etapas continuam só no quadro do cadastro');
  assert.equal(await p.page.inputValue('#rCrm'), '11223');
  await p.page.fill('#rCrm', '11224');
  await p.page.click('#regBtn');
  await expectSteps(p.page, '#meSteps', { current: 'Conferência do CRM', msg: /confere o seu CRM/ });
  assert.equal(docOf(db, 'u-rej').status, 'pending', 'reenviado: volta para a conferência');
  assert.match(await text(p.page, '#meBox'), /Em análise/);
  await shot(p.page, 'medicos-12-corrigido-volta-para-a-conferencia');
  assert.deepEqual(p.errors, []);
  await p.context.close();

  // Suspenso: etapa "Aprovado" com problema; sem fila e sem aviso.
  p = await newPage(browser, db);
  await p.page.goto(loginUrl('tok-sus'));
  await visible(p.page, '#meCard');
  const sus = await expectSteps(p.page, '#meSteps', { current: 'Aprovado', bad: 'Suspenso', msg: /Você não pode atender agora\. Veja a observação da equipe, se houver, e fale com o IMED para saber o que fazer\./ });
  assert.equal(sus.contact, 'contato.html');
  assert.match(await text(p.page, '#meBox'), /Suspenso.*A conferência anual do cadastro venceu/);
  await p.page.waitForTimeout(400);
  assert.equal(await p.page.isVisible('#dutyCard'), false);
  assert.equal(await p.page.isVisible('#noticeCard'), false);
  await shot(p.page, 'medicos-13-suspenso');
  assert.deepEqual(p.errors, []);
  await p.context.close();
});

await scenario('área do médico no celular (390 px): etapas em pé, sem rolagem lateral e link de ajuda com 44 px', async () => {
  const db = seedDb();
  for (const [tok, sel, current] of [['tok-new', '#regSteps', 'Cadastro enviado'], ['tok-pend', '#meSteps', 'Conferência do CRM'], ['tok-rej', '#meSteps', 'Conferência do CRM'], ['tok-sus', '#meSteps', 'Aprovado'], ['tok-ok', '#meSteps', 'Disponível']]) {
    const { page, errors, context } = await newPage(browser, db, { mobile: true });
    await page.goto(loginUrl(tok));
    if (tok === 'tok-ok') {
      await visible(page, '#noticeCard');
      await page.check('#noticeOk');
      await page.click('#noticeBtn');
      await visible(page, '#dutyCard');
      await page.click('#availBtn');
      await page.waitForSelector('#availBtn[aria-checked="true"]');
    }
    await waitStep(page, sel, current);
    await noOverflow(page, `${tok} no celular`);
    const lis = await page.locator(`${sel} .md-stepper > li`).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: r.top, r: r.right }; }));
    assert.equal(lis.length, 5);
    lis.forEach((li, i) => { if (i) { assert.ok(li.t > lis[i - 1].t, `${tok}: etapas uma embaixo da outra`); assert.equal(li.l, lis[0].l); } });
    assert.ok(lis.every((li) => li.r <= 390), `${tok}: etapas dentro da tela`);
    const h = await page.locator(`${sel} .md-stephelp a`).evaluate((a) => a.getBoundingClientRect().height);
    assert.ok(h >= 43.5, `${tok}: link de ajuda com ${h} px`);
    if (tok === 'tok-rej') await shot(page, 'medicos-14-celular-recusado');
    if (tok === 'tok-ok') await shot(page, 'medicos-15-celular-disponivel');
    assert.deepEqual(errors, [], tok);
    await context.close();
  }
});

await scenario('ligações: página inicial, rodapé, sitemap e topo da área do médico levam a para-medicos.html', async () => {
  // Página inicial: link discreto na seção da teleconsulta.
  const idx = read('index.html');
  const sec = idx.slice(idx.indexOf('<section class="sec rv" id="lista"'), idx.indexOf('</section>', idx.indexOf('id="lista"')));
  assert.match(sec, /<p class="tele-doc"><a href="para-medicos\.html"><i class="fa-solid fa-user-doctor" aria-hidden="true"><\/i>É médico\? Atenda pelo IMED<\/a><\/p>/);
  // Rodapé (modelo): "Para médicos" no grupo de clínicas e médicos.
  const grupo = GRUPOS.find(([, links]) => links.some(([, p]) => p === 'para-medicos.html'));
  assert.equal(grupo?.[0], 'Clínicas e médicos');
  assert.ok(rodapeHtml('').includes('<li><a href="para-medicos.html">Para médicos</a></li>'));
  assert.ok(rodapeHtml('../').includes('<li><a href="../para-medicos.html">Para médicos</a></li>'));
  // Sitemap e topo da área do médico.
  assert.equal((read('sitemap.xml').match(/<loc>https:\/\/drrafaelpereirabarreto-code\.github\.io\/testedoapp\/para-medicos\.html<\/loc>/g) || []).length, 1);
  assert.match(read('medico.html'), /<p class="md-howto"><a href="para-medicos\.html">/);
  // No celular, o link da página inicial aparece e tem 44 px de altura (fácil de tocar).
  const db = makeDb();
  const { page, context } = await newPage(browser, db, { mobile: true });
  await context.route(`${SUPA}/**`, (route) => json(route, []));
  await page.goto(BASE);
  const link = page.locator('#lista a[href="para-medicos.html"]');
  await link.scrollIntoViewIfNeeded();
  await link.waitFor({ state: 'visible' });
  assert.equal((await link.innerText()).trim(), 'É médico? Atenda pelo IMED');
  const box = await link.boundingBox();
  assert.ok(box.height >= 43.5 && box.x >= 0 && box.x + box.width <= 390, `link com 44 px e dentro da tela (${JSON.stringify(box)})`);
  await link.click();
  await page.waitForURL(`${BASE}para-medicos.html`);
  await context.close();
});

await scenario('acessibilidade (axe-core): página nova, etapas e link de ajuda sem problema grave', async () => {
  if (!AXE) { console.log('  aviso - axe-core não encontrado: auditoria pulada (instale o axe-core ou passe AXE_PATH).'); return; }
  const db = seedDb();
  for (const mobile of [false, true]) {
    const { page, context } = await newPage(browser, db, { mobile, csp: false });
    await page.goto(`${BASE}para-medicos.html`);
    await page.click('details:has(summary:text("O que quer dizer cada situação"))');
    assert.deepEqual(await runAxe(page), [], `para-medicos.html (${mobile ? 'celular' : 'computador'})`);
    await context.close();
  }
  for (const [tok, sel] of [['tok-new', '#regSteps'], ['tok-pend', '#meSteps'], ['tok-rej', '#meSteps'], ['tok-sus', '#meSteps']]) {
    const { page, context } = await newPage(browser, db, { csp: false });
    await page.goto(loginUrl(tok));
    await visible(page, `${sel} .md-stepper`);
    assert.deepEqual(await runAxe(page, [[sel], ['.md-howto']]), [], `medico.html ${tok}`);
    await context.close();
  }
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
