// Teste de ponta a ponta da frente TELECONSULTA: perguntas frequentes antes do pedido e o caminho do médico até a
// plataforma de atendimento, num navegador de verdade (Playwright), com o Supabase simulado EM MEMÓRIA (a mesma
// montagem de tests/e2e-tele.mjs: servidor da pasta do site e as funções do contrato de
// supabase/migrations/*_teleconsulta.sql que estas páginas usam).
// - teleconsulta.html: perguntas curtas ANTES do pedido (para que serve, quando não usar, receitas que não saem pelo
//   IMED e atestado), com as mesmas frases do termo (seções 2, 4 e 7), do aviso da área do médico (medico.html) e de
//   assets/js/tele-docs.js (BLOCK_TEXT e a regra do início do atestado, a mesma do banco). A receita feita fora do IMED
//   só "se o médico achar que você precisa" (sem promessa). Sem navegador, o primeiro cenário confere as fontes.
// - termo: o pedido manda a versão do termo publicado (TCLE_VERSION, de tele-core.js), que o banco aceita (a lista
//   da migração mais nova); o teste não fixa o número da versão.
// - teleconsulta.html: cartão "É médico? Cadastre-se para atender pelo IMED" no fim do início (depois de tudo o que é
//   do paciente e fora do formulário), com "Como funciona" (para-medicos.html), "Fazer meu cadastro" (medico.html) e
//   a "situação do IMED hoje" (inscrição no CRM ainda em confirmação); some na fila e no pedido retirado; "Sou médico"
//   no topo.
// - celular de 360 px (medido contra a largura configurada): sem rolagem lateral e alvos de 44 px.
// - para-medicos.html: "Fazer minha inscrição", "Área do médico" (topo e o link novo do rodapé) e a parte "Como entrar
//   na plataforma de atendimento" (sem número de exemplo; os dados do paciente aparecem na fila, na consulta e nas
//   consultas anteriores, nunca no painel) levam à entrada pelo e-mail da área do médico.
// - acessibilidade: axe-core (WCAG A/AA) nas partes novas, quando o axe-core estiver instalado (no GitHub, está).
// Rodapé das duas páginas (tests/rodape.test.mjs não confere no disco estas duas, que não estão em OBRIGATORIAS): com o
// rodapé novo já aplicado no site (index.html com ele) ou no GitHub (variável CI), as páginas são servidas como estão
// no disco e rodapé desatualizado reprova. Antes disso (scripts/rodape.mjs mudou e ninguém rodou
// node scripts/aplicar-rodape.mjs ainda), o servidor do teste aplica o rodapé atual na hora e avisa.
// Rodar com: node tests/e2e-teleconsulta-faq.mjs   (precisa do pacote "playwright" instalado)
// Opcional: SHOTS=pasta (capturas de tela, para mostrar o teste), E2E_PORT (porta; padrão 4851), ONLY="trecho" (só os
// cenários com esse trecho no nome), AXE_PATH=<pasta do axe-core>.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as D from '../assets/js/tele-docs.js';
import { TCLE_VERSION } from '../assets/js/tele-core.js';
import { aplicar, temMarcadores } from '../scripts/aplicar-rodape.mjs';
import { GRUPOS } from '../scripts/rodape.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
// Rodapé (ver o começo do arquivo): página sem os marcadores ou com o rodapé diferente do modelo (scripts/rodape.mjs).
const PAGINAS_RODAPE = ['teleconsulta.html', 'para-medicos.html'];
const rodapeVelho = (f) => { const h = read(f); return !temMarcadores(h) || aplicar(h, '') !== h; };
const RODAPE_ESTRITO = !!process.env.CI || !rodapeVelho('index.html');
// Só antes de o rodapé novo entrar no site: estas páginas servidas com o rodapé atual (o HTML que aplicar-rodape grava).
const RODAPE_NA_HORA = new Set(RODAPE_ESTRITO ? [] : PAGINAS_RODAPE.filter(rodapeVelho).map((f) => `/${f}`));
if (RODAPE_NA_HORA.size) {
  console.log(`aviso - rodapé antigo no disco (${[...RODAPE_NA_HORA].map((p) => p.slice(1)).join(', ')} e o resto do site): o teste serve com o rodapé atual aplicado na hora. Antes de publicar, rode node scripts/aplicar-rodape.mjs.`);
}

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  try {
    let body = await readFile(file);
    if (RODAPE_NA_HORA.has(path)) body = aplicar(body.toString('utf8'), '');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('não encontrado');
  }
});
const PORT = Number(process.env.E2E_PORT) || 4851; // E2E_PORT: outra porta para rodar em paralelo
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

/* ======================= banco simulado (contrato da teleconsulta, lado do paciente) ======================= */
// Regra do banco como está na migração mais nova que a tem (supabase/migrations, da mais nova para a mais velha): a
// última ocorrência no arquivo, ou null. re precisa da flag g.
function regraDoBanco(re) {
  const dir = join(ROOT, 'supabase/migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort().reverse()) {
    const all = [...readFileSync(join(dir, f), 'utf8').matchAll(re)];
    if (all.length) return { arquivo: f, m: all.at(-1) };
  }
  return null;
}
// Versões do termo que o banco aceita no pedido (tele_request: "v_version not in (...)"), sem fixar o número aqui.
const VERSOES_BANCO = (() => {
  const r = regraDoBanco(/v_version not in \(([^)]*)\)/g);
  return r ? [...r.m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
})();
const USERS = {
  'tok-doc': { id: 'u-doc', email: 'carla@exemplo.com' },
};
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
class PgErr extends Error { constructor(message, details = null) { super(message); this.details = details; } }
const GUARDIANS = ['Mãe', 'Pai', 'Responsável legal (tutor ou guardião)'];
const DOCTOR_FNS = new Set(['tele_doctor_me', 'tele_doctor_register', 'tele_set_available', 'tele_queue', 'tele_accept', 'tele_dismiss', 'tele_painel_medico']);
const todaySP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function age(birth) {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ty, tm, td] = todaySP().split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
const iso = (t = Date.now()) => new Date(t).toISOString();
const DAY = 86400e3;
const ACTIVE = ['waiting', 'accepted', 'in_call'];

function makeDb() {
  const db = { doctors: new Map(), consults: new Map(), messages: [], calls: [], waitlist: [], t: 0 };
  db.addDoctor = (d) => { const row = { id: randomUUID(), rqe: null, specialty: null, phone: null, status: 'approved', review_note: null, checked_at: iso(Date.now() - DAY), available_until: null, created_at: iso(Date.now() - DAY), updated_at: iso(), ...d }; db.doctors.set(row.id, row); return row; };
  db.addConsult = (c) => {
    const row = { id: randomUUID(), status: 'waiting', patient_birthdate: '1980-01-01', patient_phone: '11987654321', for_other: false, requester_name: null, relationship: null,
      guardian_consent: false, patient_agrees: false, reason: 'Teste', consent_version: TCLE_VERSION, consent_at: iso(), doctor_id: null, doctor_info: null, accepted_at: null, started_at: null,
      ended_at: null, closed_by: null, phone_call_at: null, patient_seen_at: null, offer_sdp: null, offer_version: 0, answer_sdp: null, answer_version: 0,
      exams: [], indication: null, exams_version: 0, exams_at: null, guidance: null, guidance_at: null, created_at: iso(Date.now() + (db.t++)), ...c };
    db.consults.set(row.id, row);
    return row;
  };
  db.called = (fn) => db.calls.filter((c) => c.fn === fn);
  return db;
}
// Médico aprovado e "Disponível para atender" (o paciente vê o pedido aberto).
const onDuty = (db) => db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', available_until: iso(Date.now() + 3600e3) });
const byToken = (db, id, token) => { const c = db.consults.get(id); return c && c.token_hash === sha(token ?? '') ? c : null; };
const docInfo = (d) => ({ full_name: d.full_name, crm: d.crm, crm_uf: d.crm_uf, rqe: d.rqe, specialty: d.rqe ? d.specialty : null });
const online = (db) => [...db.doctors.values()].filter((d) => d.status === 'approved' && d.available_until && Date.parse(d.available_until) > Date.now());
const blank = (v) => String(v ?? '').trim() === '';
const digits = (v) => String(v ?? '').replace(/\D/g, '');

const RPC = {
  tele_doctors_online(db) {
    return online(db).sort((a, b) => a.full_name.localeCompare(b.full_name)).slice(0, 50).map(docInfo);
  },
  tele_request(db, a) {
    if ((a.p_alert_flags || []).some((f) => !blank(f))) throw new PgErr('emergencia');
    const ver = String(a.p_consent_version ?? '').trim();
    // Versões do termo aceitas pelo banco (tele_request), lidas da migração mais nova.
    if (a.p_consent !== true || !VERSOES_BANCO.includes(ver)) throw new PgErr('sem_consentimento');
    const name = String(a.p_patient_name ?? '').replace(/\s+/g, ' ').trim();
    if (name.length < 3 || name.length > 120) throw new PgErr('dados_invalidos', 'nome');
    if (!a.p_birthdate || a.p_birthdate > todaySP()) throw new PgErr('dados_invalidos', 'nascimento');
    const ag = age(a.p_birthdate);
    if (ag > 120) throw new PgErr('dados_invalidos', 'nascimento');
    let phone = digits(a.p_phone);
    if ((phone.length === 12 || phone.length === 13) && phone.startsWith('55')) phone = phone.slice(2);
    if (!/^[1-9][1-9][0-9]{8,9}$/.test(phone)) throw new PgErr('dados_invalidos', 'telefone');
    const reason = String(a.p_reason ?? '').trim();
    if (reason.length < 3 || reason.length > 1000) throw new PgErr('dados_invalidos', 'motivo');
    const hash = String(a.p_token_hash ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new PgErr('dados_invalidos', 'token');
    const other = !!a.p_for_other;
    const minor = ag < 18;
    if (minor && !(other && a.p_guardian_consent)) throw new PgErr('menor_sem_responsavel');
    let req = null; let rel = null;
    if (other) {
      req = String(a.p_requester_name ?? '').replace(/\s+/g, ' ').trim();
      rel = String(a.p_relationship ?? '').replace(/\s+/g, ' ').trim();
      if (req.length < 3 || req.length > 120) throw new PgErr('dados_invalidos', 'responsavel');
      if (rel.length < 2 || rel.length > 60) throw new PgErr('dados_invalidos', 'parentesco');
      if (minor && !GUARDIANS.includes(rel)) throw new PgErr('menor_sem_responsavel');
      if (!minor && a.p_patient_agrees !== true) throw new PgErr('sem_consentimento', 'paciente');
    }
    const same = [...db.consults.values()].find((c) => c.token_hash === hash);
    if (same) { if (ACTIVE.includes(same.status)) return same.id; throw new PgErr('dados_invalidos', 'token'); }
    const all = [...db.consults.values()];
    if (all.some((c) => c.patient_phone === phone && ACTIVE.includes(c.status))
      || all.filter((c) => c.patient_phone === phone && Date.now() - Date.parse(c.created_at) < DAY).length >= 5) throw new PgErr('telefone_indisponivel');
    const c = db.addConsult({ token_hash: hash, patient_name: name, patient_birthdate: a.p_birthdate, patient_phone: phone, for_other: other, requester_name: req, relationship: rel,
      guardian_consent: other && minor && !!a.p_guardian_consent, patient_agrees: other && !minor && a.p_patient_agrees === true, reason, consent_version: ver, consent_at: iso() });
    return c.id;
  },
  tele_status(db, a) {
    const c = byToken(db, a.p_id, a.p_token);
    if (!c) return [];
    const live = ['accepted', 'in_call'].includes(c.status);
    if (ACTIVE.includes(c.status)) c.patient_seen_at = iso();
    const pos = c.status === 'waiting' ? [...db.consults.values()].filter((w) => w.status === 'waiting' && (w.created_at < c.created_at || (w.created_at === c.created_at && w.id < c.id))).length + 1 : null;
    return [{ status: c.status, position: pos, doctors_online: online(db).length, doctor: c.doctor_info, offer_sdp: live ? c.offer_sdp : null, offer_version: c.offer_version,
      answer_version: c.answer_version, exams: c.exams, indication: c.indication, guidance: c.guidance, created_at: c.created_at, accepted_at: c.accepted_at,
      started_at: c.started_at, ended_at: c.ended_at, patient_name: c.patient_name, patient_birthdate: c.patient_birthdate,
      closed_by: c.closed_by, phone_call_at: c.phone_call_at, exams_version: c.exams_version, exams_at: c.exams_at, guidance_at: c.guidance_at }];
  },
  tele_cancel(db, a) {
    const c = byToken(db, a.p_id, a.p_token);
    if (!c) throw new PgErr('nao_encontrado');
    if (['ended', 'cancelled', 'expired'].includes(c.status)) return null;
    if (!(c.status === 'waiting' || (c.status === 'accepted' && !c.started_at))) throw new PgErr('estado_invalido');
    Object.assign(c, { status: 'cancelled', closed_by: 'patient', offer_sdp: null, answer_sdp: null });
    return null;
  },
  tele_patient_messages(db, a) {
    const c = byToken(db, a.p_id, a.p_token);
    return c ? db.messages.filter((m) => m.consultation_id === c.id && m.id > Number(a.p_after || 0)) : [];
  },
  // Área do médico sem ninguém entrar: só a tela de entrada pelo e-mail.
  tele_doctor_me(db, a, uid) {
    const d = [...db.doctors.values()].find((x) => x.user_id === uid) || null;
    const f = ['id', 'full_name', 'crm', 'crm_uf', 'rqe', 'specialty', 'phone', 'status', 'review_note', 'reviewed_at', 'available_until', 'created_at', 'updated_at', 'checked_at'];
    return [{ ...Object.fromEntries(f.map((k) => [k, d ? d[k] : null])), is_admin: false }];
  },
};

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body), headers: cors });

/* ======================= páginas ======================= */
// width: largura do celular (padrão 360, a menor que o site atende); csp: false liga o bypassCSP (só para injetar o
// axe-core; nos outros cenários a CSP da página vale).
async function newPage(browser, db, { mobile = false, width = 360, csp = true } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width, height: 800 } : { width: 1280, height: 900 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block', permissions: ['camera', 'microphone'], reducedMotion: 'reduce', bypassCSP: !csp,
  });
  // Aviso de privacidade já aceito (não cobre a página nas capturas).
  await context.addInitScript(() => { try { localStorage.setItem('imed_lgpd', '1'); } catch { /* ignora */ } });
  // Configuração do site com a teleconsulta só pela máquina (sem STUN), como em tests/e2e-tele.mjs.
  await context.route(`${BASE}assets/js/config.js`, async (route) => {
    const src = await readFile(join(ROOT, 'assets/js/config.js'), 'utf8');
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: `${src}\nwindow.IMED_CONFIG.tele = ${JSON.stringify({ iceServers: [], planBMs: 25000, gatherMs: 1500, slowMs: 60000 })};\n` });
  });
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    const auth = (req.headers().authorization || '').replace(/^Bearer /, '');
    if (u.pathname === '/auth/v1/user') return USERS[auth] ? json(route, USERS[auth]) : json(route, { msg: 'invalid' }, 401);
    if (u.pathname === '/auth/v1/otp' || u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname === '/rest/v1/app_waitlist') { db.waitlist.push({ body: JSON.parse(req.postData() || '{}'), auth }); return route.fulfill({ status: 201, body: '', headers: cors }); }
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
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); } };
// Rolagem lateral medida contra a largura CONFIGURADA (width): a página não pode ficar mais larga que ela, e nenhum
// elemento visível (fora os escondidos de propósito e os que ficam dentro de uma caixa que corta) passa da borda.
const overflow = (page, width) => page.evaluate((W) => {
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (/(hidden|auto|scroll|clip)/.test(getComputedStyle(p).overflowX)) return true; } return false; };
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || cs.position === 'fixed' || cs.display === 'none' || el.classList.contains('sr') || el.classList.contains('hp') || clipped(el)) continue;
    if (r.right > W + 1 || r.left < -1) bad.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`);
  }
  return { cw: document.documentElement.clientWidth, px: document.documentElement.scrollWidth - W, bad: bad.slice(0, 5) };
}, width);
async function noOverflow(page, width, where) {
  const o = await overflow(page, width);
  assert.equal(o.cw, width, `${where}: a página tem a largura configurada (${width} px)`);
  assert.ok(o.px <= 0 && !o.bad.length, `${where}: sem rolagem lateral (${o.px}px; ${o.bad.join(', ')})`);
}
const results = [];
async function scenario(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const t0 = Date.now();
  try { await fn(); results.push(['ok', name]); console.log(`ok - ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 6).join('\n  ')}`); }
}
const visible = (page, sel, timeout = 15000) => page.waitForSelector(sel, { state: 'visible', timeout });
const text = (page, sel) => page.locator(sel).innerText();
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const BIRTH_ADULT = '1980-05-17';

// Preenche o pedido do paciente (sem enviar).
async function fillRequest(page, { name = 'Ana Teste', birth = BIRTH_ADULT, phone = '11987654321', reason = 'Dor de garganta há 3 dias' } = {}) {
  await page.fill('#fName', name);
  await page.fill('#fBirth', birth);
  await page.fill('#fPhone', phone);
  await page.fill('#fReason', reason);
  await page.check('#fNone');
  await page.check('#fConsent');
}
// Abre todas as perguntas (toque em cada uma).
async function openAll(page) {
  for (const s of await page.locator('#faqCard summary').all()) await s.click();
}
// Resposta de uma pergunta (o texto do details aberto, sem a pergunta).
const answer = (page, q) => page.locator('#faqCard details', { has: page.locator('summary', { hasText: q }) }).locator('.tl-faq-a').innerText().then(norm);
// Auditoria do axe-core (só violações sérias e críticas), em toda a página ou só nas partes pedidas.
async function runAxe(page, include = null) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async ([tags, inc]) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(inc ? { include: inc } : document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  }, [AXE_TAGS, include]);
}

/* ======================= textos que as perguntas repetem ======================= */
const QUESTIONS = ['Para que serve a teleconsulta?', 'Quando não usar a teleconsulta?', 'Que receitas não saem pela teleconsulta do IMED?', 'Vou receber atestado?'];
// Texto como o leitor vê: sem as marcações e sem o espaço que elas deixam antes da pontuação.
const plain = (html) => norm(html.replace(/<[^>]+>/g, ' ')).replace(/ ([.,:;?)])/g, '$1').replace(/\( /g, '(');
const mainOf = (html) => (html.match(/<main[\s\S]*?<\/main>/) || [html])[0];
// O termo como o paciente lê, o aviso da área do médico (medico.html) e as perguntas como estão no arquivo.
const termo = plain(mainOf(read('termo-teleconsulta.html')));
const avisoMedico = plain(mainOf(read('medico.html')));
const faqArquivo = plain(read('teleconsulta.html').match(/<section class="tl-card" id="faqCard"[\s\S]*?<\/section>/)[0]);
// Frases iguais às do termo: seção 2 (limites), seção 4 (CVV) e seção 7 (documentos médicos).
const TERMO_FRASES = [
  'o médico não consegue fazer o exame físico completo.',
  'Por isso ele pode pedir exames, indicar consulta presencial ou encerrar a teleconsulta se achar que ela não é segura para o seu caso.',
  'A teleconsulta não substitui o acompanhamento presencial, principalmente em doenças crônicas.',
  'Pensando em se machucar ou em tirar a própria vida? Ligue 188 (CVV, ligação grátis, 24 horas). Se houver perigo agora, ligue 192.',
  'pedido de exames, receita simples (de remédio que não fica retido na farmácia), atestado, declaração de comparecimento, encaminhamento, relatório médico e orientações.',
  'Só vale o arquivo PDF com a assinatura digital do médico, no padrão ICP-Brasil.',
  // Só a lista: depois dela, o termo segue com "o médico faz em outra plataforma" (sem o "se"); as perguntas, com RX_SE.
  'Receita de antibiótico, de canetas GLP-1 (como semaglutida e tirzepatida), de remédio controlado e as receitas azul e amarela não saem pelo IMED',
  'O CID (código da doença) só entra no atestado ou no relatório se você pedir e autorizar.',
];
const RX_LISTA = TERMO_FRASES.find((s) => s.startsWith('Receita de antibiótico'));
// Receita feita fora do IMED só se o médico achar que o paciente precisa: sem promessa de receita por fora.
const RX_SE = 'Se o médico achar que você precisa de um desses remédios, ele faz a receita em outra plataforma oficial ou em papel e combina com você como vai entregar.';
// Frases iguais às do aviso da área do médico (assets/js/tele-docs.js, BLOCK_TEXT.sncr): por que essas receitas não saem.
const DOCS_FRASES = [
  'A Anvisa está passando a versão eletrônica dessas receitas para o sistema dela (SNCR), e a farmácia pode recusar a que não sair de uma plataforma ligada a ele.',
  'O IMED não é ligado ao SNCR.',
];
// Atestado: regras que o termo ainda não traz (ponto para a revisão do advogado), conferidas com o aviso da área do
// médico (medico.html), com a tela de emitir (tele-docs.js) e com o banco (cenário "fontes das perguntas").
const ATESTADO_FRASES = [
  'O atestado nunca sai com data anterior à consulta: o afastamento não pode começar antes dela.',
  'Atestado ocupacional (ASO) não pode ser feito por teleconsulta.',
];

/* ======================= cenários sem navegador (só leem arquivos) ======================= */
await scenario('fontes das perguntas (sem navegador): o termo, a área do médico, tele-docs.js e o banco dizem o mesmo que as perguntas', async () => {
  // Termo (seções 2, 4 e 7): as mesmas frases no termo e nas perguntas.
  for (const s of TERMO_FRASES) {
    assert.ok(termo.includes(s), `o termo mudou? Atualize a pergunta frequente: ${s}`);
    assert.ok(faqArquivo.includes(s), `pergunta frequente com a frase do termo: ${s}`);
  }
  // Receitas: a lista e, logo depois, "Se o médico achar que você precisa" (nunca "não saem pelo IMED: o médico faz").
  assert.ok(faqArquivo.includes(`${RX_LISTA}. ${RX_SE}`), 'receita por fora só se o médico achar que o paciente precisa');
  assert.ok(!faqArquivo.includes(`${RX_LISTA}:`), 'sem a promessa de receita feita por fora');
  // Por que não saem: as frases do aviso da área do médico (tele-docs.js), com os mesmos tipos de receita.
  for (const s of DOCS_FRASES) {
    assert.ok(D.BLOCK_TEXT.sncr.includes(s), `tele-docs.js mudou? Atualize a pergunta frequente: ${s}`);
    assert.ok(faqArquivo.includes(s), `pergunta frequente com a frase de tele-docs.js: ${s}`);
  }
  for (const w of ['antibiótico', 'GLP-1', 'controlado', 'SNCR']) assert.ok(D.BLOCK_TEXT.sncr.includes(w), `BLOCK_TEXT.sncr: ${w}`);
  for (const w of ['azul', 'amarela']) assert.ok(D.BLOCK_TEXT.notificacao.includes(w), `BLOCK_TEXT.notificacao: ${w}`);
  // Atestado: as duas regras nas perguntas.
  for (const s of ATESTADO_FRASES) assert.ok(faqArquivo.includes(s), `pergunta frequente: ${s}`);
  // ASO: o mesmo texto do aviso da área do médico.
  assert.ok(avisoMedico.includes('Atestado ocupacional (ASO) não pode ser feito por teleconsulta.'), 'medico.html mudou? ASO');
  // Nunca antes da consulta: o aviso da área do médico, a tela de emitir (tele-docs.js) e o banco dizem o mesmo.
  assert.ok(avisoMedico.includes('o atestado não pode começar antes da consulta.'), 'medico.html mudou? início do atestado');
  assert.match(D.docErrorText({ code: 'dados_invalidos', details: 'inicio' }), /nunca antes da consulta/);
  const consult = { started_at: '2026-10-30T15:00:00Z' }; // consulta às 12h de 30/10 em São Paulo
  assert.ok(D.validateDoc('atestado', { dias: '1', inicio: '2026-10-29' }, { consult }).errors.inicio, 'tele-docs.js: afastamento antes da consulta é recusado');
  assert.equal(D.validateDoc('atestado', { dias: '1', inicio: '2026-10-30' }, { consult }).errors.inicio, undefined, 'tele-docs.js: no dia da consulta, pode');
  const regra = regraDoBanco(/if v_ini not between v_day and v_day \+ 7 then perform private\.tele_bad\('inicio'\); end if;/g);
  assert.ok(regra, 'banco: o afastamento começa no dia da consulta ou até 7 dias depois, nunca antes (tele_doc_create)');
  // Versão do termo: a que o pedido manda (TCLE_VERSION, de tele-core.js) é a do termo publicado, e o banco aceita.
  assert.equal(read('termo-teleconsulta.html').match(/<b id="tcleVersion">([^<]+)<\/b>/)?.[1], TCLE_VERSION, 'termo publicado com a versão de TCLE_VERSION');
  assert.ok(VERSOES_BANCO.includes(TCLE_VERSION), `o banco aceita a versão do termo (${TCLE_VERSION}; aceitas: ${VERSOES_BANCO.join(', ') || 'nenhuma achada'})`);
  // "Mais detalhes" leva à seção 7 do termo.
  assert.match(read('termo-teleconsulta.html'), /<h2 id="documentos">7\. Documentos médicos<\/h2>/);
});

await scenario('rodapé no disco: teleconsulta.html e para-medicos.html com o rodapé atual (o de node scripts/aplicar-rodape.mjs)', async () => {
  if (!RODAPE_ESTRITO) {
    console.log('  aviso - o rodapé novo ainda não foi aplicado no site: conferência no disco adiada (os outros cenários usam o rodapé aplicado na hora).');
    return;
  }
  for (const f of PAGINAS_RODAPE) assert.ok(!rodapeVelho(f), `${f}: rodapé desatualizado no disco (rode node scripts/aplicar-rodape.mjs)`);
});

const browser = await chromium.launch();

/* ======================= cenários no navegador ======================= */
await scenario('perguntas frequentes antes do pedido: para que serve, quando não usar, receitas e atestado (frases do termo e dos documentos)', async () => {
  const db = makeDb();
  onDuty(db);
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(`${BASE}teleconsulta.html`);
  await visible(page, '#formCard');
  await visible(page, '#faqCard');
  // Lugar: depois de "Como funciona" e antes do pedido, fora do formulário (na ordem da leitura e na tela).
  const pos = await page.evaluate(() => {
    const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const [how, faq, form] = ['#howCard', '#faqCard', '#formCard'].map((s) => document.querySelector(s));
    const top = (el) => el.getBoundingClientRect().top;
    return { dom: after(how, faq) && after(faq, form), tela: top(how) < top(faq) && top(faq) < top(form), noFormulario: !!faq.closest('form, #formCard') || !!form.querySelector('.tl-faq') };
  });
  assert.deepEqual(pos, { dom: true, tela: true, noFormulario: false });
  assert.equal(await page.getByRole('region', { name: 'Perguntas frequentes', exact: true }).count(), 1);
  assert.equal(await page.getByRole('heading', { level: 2, name: 'Perguntas frequentes', exact: true }).count(), 1);
  assert.equal(norm(await text(page, '#faqCard > .tl-muted')), 'Antes de pedir: para que serve a teleconsulta e o que não sai por ela.');
  // Perguntas curtas, todas fechadas ao abrir a página (o pedido continua perto).
  assert.deepEqual((await page.locator('#faqCard summary').allInnerTexts()).map(norm), QUESTIONS);
  assert.equal(await page.locator('#faqCard details[open]').count(), 0, 'perguntas fechadas ao abrir');
  // O nome de cada pergunta é só a pergunta (a seta é desenho, sem texto para o leitor de tela).
  assert.deepEqual(await page.$$eval('#faqCard summary', (ss) => ss.map((s) => getComputedStyle(s, '::after').content)), QUESTIONS.map(() => '""'));
  // Teclado: Enter abre e fecha (details/summary do navegador, sem script).
  const first = page.locator('#faqCard summary').first();
  await first.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#faqCard details').first().evaluate((d) => d.open), true, 'Enter abre');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#faqCard details').first().evaluate((d) => d.open), false, 'Enter fecha');
  await openAll(page);
  assert.equal(await page.locator('#faqCard details[open]').count(), QUESTIONS.length);

  // A página mostra as frases conferidas com as fontes no cenário "fontes das perguntas" (termo, área do médico,
  // tele-docs.js e banco): um texto só para as telas do paciente e do médico.
  const faq = norm(await text(page, '#faqCard'));
  for (const s of [...TERMO_FRASES, RX_SE, ...DOCS_FRASES, ...ATESTADO_FRASES]) assert.ok(faq.includes(s), `a pergunta frequente mostra: ${s}`);
  // Receitas que não saem pelo IMED: antibiótico, canetas GLP-1, controlado, azul e amarela (as mesmas de BLOCK_TEXT);
  // a receita feita fora do IMED só se o médico achar que você precisa (sem promessa).
  const rx = await answer(page, 'Que receitas');
  for (const w of ['antibiótico', 'canetas GLP-1', 'remédio controlado', 'azul e amarela', 'SNCR']) assert.ok(rx.includes(w), `receitas: ${w}`);
  assert.ok(rx.startsWith(`${RX_LISTA}. ${RX_SE}`), `receitas: a lista e "Se o médico achar que você precisa" (${rx.slice(0, 80)}…)`);
  // Atestado: só se o médico achar necessário, nunca com data anterior à consulta, e ASO não sai por teleconsulta.
  const at = await answer(page, 'Vou receber atestado?');
  assert.match(at, /^Só se o médico achar necessário, depois de avaliar você\./);
  assert.match(at, /O atestado nunca sai com data anterior à consulta: o afastamento não pode começar antes dela\./);
  assert.match(at, /Atestado ocupacional \(ASO\) não pode ser feito por teleconsulta\./);
  // Quando não usar: emergência (192, com o botão de ligar), pensando em se machucar (188, CVV, como no termo, seção 4)
  // e quando precisa de exame físico.
  const nao = await answer(page, 'Quando não usar');
  assert.match(nao, /^Em emergência: ligue 192 \(SAMU\) ou vá ao pronto-socorro\. Pensando em se machucar ou em tirar a própria vida\? Ligue 188 \(CVV, ligação grátis, 24 horas\)\. Se houver perigo agora, ligue 192\. Quando precisa de exame físico:/);
  const sos = page.locator('#faqCard a[href="tel:192"]');
  assert.equal(await sos.count(), 1);
  assert.equal(norm(await sos.innerText()), '192 (SAMU)');
  const cvv = page.locator('#faqCard a[href="tel:188"]');
  assert.equal(await cvv.count(), 1);
  assert.equal(norm(await cvv.innerText()), '188');
  assert.match(await answer(page, 'Para que serve'), /^Para conversar por vídeo com um médico sobre um problema de saúde que não é de emergência\. Se o médico achar necessário/);
  // Termo completo: abre em outra aba (o pedido preenchido não se perde).
  const more = page.locator('#faqCard a[href="termo-teleconsulta.html#documentos"]');
  assert.equal(await more.getAttribute('target'), '_blank');
  assert.equal(await more.getAttribute('rel'), 'noopener');
  assert.match(norm(await more.innerText()), /termo da teleconsulta \(abre em outra aba\)/);
  // Nada de número inventado: as perguntas não trazem contagem, preço nem prazo de atendimento.
  assert.ok(!/R\$|\d+ ?%|\d+ (médicos|pacientes|minutos|min\b)/.test(faq), 'sem contagem, preço nem prazo');
  await shot(page, 'tele-faq-01-perguntas-abertas');

  // As perguntas abertas não atrapalham o pedido: preenche, envia e entra na fila. O pedido manda a versão do termo
  // publicado (TCLE_VERSION; o cenário "fontes das perguntas" confere o termo e o banco).
  await fillRequest(page);
  await page.click('#goBtn');
  await visible(page, '#vWait');
  const req = db.called('tele_request');
  assert.equal(req.length, 1);
  assert.equal(req[0].args.p_consent_version, TCLE_VERSION);
  // Na fila, as perguntas e o cartão do médico saem da tela.
  assert.equal(await page.isVisible('#faqCard'), false, 'na fila, sem as perguntas');
  assert.equal(await page.isVisible('#mdJoin'), false, 'na fila, sem o cartão do médico');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('cartão "É médico?" no fim do início, fora do pedido: "Como funciona", "Fazer meu cadastro" e a situação do IMED hoje; "Sou médico" no topo; some na fila', async () => {
  const db = makeDb(); // ninguém atendendo agora: o pedido fica fechado e o cartão continua no fim
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(`${BASE}teleconsulta.html`);
  await visible(page, '#noDoc');
  await visible(page, '#mdJoin');
  const card = page.getByRole('region', { name: 'É médico? Cadastre-se para atender pelo IMED', exact: true });
  assert.equal(await card.count(), 1);
  assert.equal(await card.getAttribute('id'), 'mdJoin');
  // Depois de tudo o que é do paciente (início, pedido, "Prepare-se", histórico e o texto do termo), fora do pedido.
  const pos = await page.evaluate(() => {
    const el = document.querySelector('#mdJoin');
    const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      depois: ['#vStart', '#faqCard', '#formCard', '#reqForm', '#prepCard', '#histCard', '#vEnd', '.tl-legal'].every((s) => after(document.querySelector(s), el)),
      dentro: !!el.closest('form, .tl-view, .tl-card:not(#mdJoin)'),
      ultimo: el === document.querySelector('main .tl-main').lastElementChild,
      abaixo: el.getBoundingClientRect().top > document.querySelector('#prepCard').getBoundingClientRect().bottom,
      aoVivo: !!el.closest('[aria-live]') || !!el.querySelector('[aria-live]'),
    };
  });
  assert.deepEqual(pos, { depois: true, dentro: false, ultimo: true, abaixo: true, aoVivo: false });
  // Dois caminhos: "Como funciona" (para-medicos.html) e "Fazer meu cadastro" (medico.html); e, no texto, a situação do
  // IMED hoje (inscrição no CRM ainda em confirmação), porque "Fazer meu cadastro" pula a página Para médicos.
  const how = card.getByRole('link', { name: 'Como funciona para o médico', exact: true });
  const join = card.getByRole('link', { name: 'Fazer meu cadastro', exact: true });
  const sit = card.getByRole('link', { name: 'situação do IMED hoje', exact: true });
  assert.equal(await card.getByRole('link').count(), 3);
  assert.equal(await how.getAttribute('href'), 'para-medicos.html');
  assert.equal(await join.getAttribute('href'), 'medico.html');
  assert.equal(await sit.getAttribute('href'), 'para-medicos.html#situacao');
  assert.equal(await how.evaluate((a) => a.firstChild.textContent), 'Como funciona', 'na tela: "Como funciona" (o resto só para o leitor de tela)');
  assert.match(norm(await card.innerText()), /Médico com CRM ativo se cadastra pelo site\. Depois que a equipe do IMED confere o CRM e a identidade, você pode atender por vídeo os pacientes da fila, na área do médico\. Antes, veja a situação do IMED hoje\./);
  assert.ok(!/\d/.test(norm(await card.innerText())), 'sem número (nem de médicos, nem de pacientes)');
  // Topo: "Sou médico" leva à área do médico.
  const top = page.locator('header.pt-top a.pt-partner');
  assert.equal(norm(await top.innerText()), 'Sou médico');
  assert.equal(await top.getAttribute('href'), 'medico.html');
  assert.ok(await top.isVisible());
  await page.locator('#mdJoin').scrollIntoViewIfNeeded();
  await shot(page, 'tele-faq-02-cartao-medico');
  assert.deepEqual(errors, [], 'teleconsulta.html sem erro');

  // "Como funciona" abre a página Para médicos; "situação do IMED hoje", a parte da página que diz que a inscrição no
  // CRM ainda está sendo confirmada; "Fazer meu cadastro", a entrada pelo e-mail da área do médico.
  await how.click();
  await page.waitForURL(`${BASE}para-medicos.html`);
  assert.equal(norm(await text(page, 'h1')), 'Atenda pelo IMED');
  await page.goBack();
  await visible(page, '#mdJoin');
  await page.locator('#mdJoin').getByRole('link', { name: 'situação do IMED hoje', exact: true }).click();
  await page.waitForURL(`${BASE}para-medicos.html#situacao`);
  await visible(page, '#situacao');
  assert.equal(norm(await text(page, '#pmSit')), 'Situação do IMED hoje');
  assert.match(norm(await text(page, '#situacao')), /A inscrição do IMED no CRM como empresa de telemedicina ainda está sendo confirmada\./);
  await shot(page, 'tele-faq-06-situacao-do-imed');
  await page.goBack();
  await visible(page, '#mdJoin');
  await page.locator('#mdJoin').getByRole('link', { name: 'Fazer meu cadastro', exact: true }).click();
  await page.waitForURL(`${BASE}medico.html`);
  await visible(page, '#loginEmail');

  // Na fila (pedido "mesmo assim") o cartão some; pedido retirado da fila pelo médico, também; pedido novo, volta.
  await page.goto(`${BASE}teleconsulta.html`);
  await visible(page, '#anywayBtn');
  errors.length = 0;
  await page.click('#anywayBtn');
  await fillRequest(page, { name: 'Paciente Cartão' });
  await page.click('#goBtn');
  await visible(page, '#vWait');
  assert.equal(await page.isVisible('#mdJoin'), false, 'na fila: sem o cartão');
  const c = [...db.consults.values()].find((x) => x.patient_name === 'Paciente Cartão');
  Object.assign(c, { status: 'cancelled', closed_by: 'doctor' });
  await visible(page, '#vGone', 15000);
  assert.equal(norm(await text(page, '#goneTitle')), 'Pedido retirado da fila');
  assert.equal(await page.isVisible('#mdJoin'), false, 'pedido retirado: sem o cartão');
  await page.click('#newBtn2');
  await visible(page, '#vStart');
  await visible(page, '#mdJoin');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (360 px): perguntas abertas e cartão do médico sem rolagem lateral, com alvos de 44 px', async () => {
  for (const withDoctor of [true, false]) {
    const db = makeDb();
    if (withDoctor) onDuty(db);
    const { page, errors, context } = await newPage(browser, db, { mobile: true, width: 360 });
    await page.goto(`${BASE}teleconsulta.html`);
    await visible(page, withDoctor ? '#formCard' : '#noDoc');
    await visible(page, '#mdJoin');
    const where = withDoctor ? 'com médico atendendo' : 'sem médico atendendo';
    await noOverflow(page, 360, `início ${where} (perguntas fechadas)`);
    await openAll(page);
    await noOverflow(page, 360, `início ${where} (perguntas abertas)`);
    // Perguntas, botões do cartão e "Sou médico": 44 px ou mais, dentro da tela.
    const sizes = await page.$$eval('#faqCard summary, #mdJoin a.btn, header.pt-top a.pt-partner', (els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      return { t: e.textContent.replace(/\s+/g, ' ').trim(), w: r.width, h: r.height, l: r.left, r: r.right };
    }));
    assert.equal(sizes.length, QUESTIONS.length + 3);
    for (const s of sizes) {
      assert.ok(s.h >= 44 && s.w >= 44, `${s.t}: ${Math.round(s.w)}x${Math.round(s.h)} (mínimo 44 px)`);
      assert.ok(s.l >= 0 && s.r <= 360, `${s.t}: dentro da tela (${Math.round(s.l)} a ${Math.round(s.r)})`);
    }
    // Letra das respostas sem zoom (15 px ou mais).
    assert.ok((await page.$$eval('#faqCard .tl-faq-a p', (ps) => ps.map((p) => parseFloat(getComputedStyle(p).fontSize)))).every((f) => f >= 15));
    await shot(page, `tele-faq-03-celular-360-${withDoctor ? 'com-medico' : 'sem-medico'}`);
    assert.deepEqual(errors, [], where);
    await context.close();
  }
});

await scenario('para-medicos.html: "Fazer minha inscrição" e "Área do médico" (topo e rodapé) levam à plataforma; "Como entrar" sem número de exemplo', async () => {
  const db = makeDb();
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(`${BASE}para-medicos.html`);
  // Começo: a inscrição e, para quem já se inscreveu, a Área do médico (a plataforma de atendimento do IMED).
  assert.equal(await page.getAttribute('#pmGo', 'href'), 'medico.html');
  assert.match(norm(await text(page, '#pmGo')), /^Fazer minha inscrição$/);
  const small = page.locator('main .pm-small');
  assert.equal(norm(await small.innerText()), 'Já se inscreveu? Entre na Área do médico, a plataforma de atendimento do IMED, com o mesmo e-mail. Veja como entrar.');
  assert.equal(norm(await small.locator('a[href="medico.html"]').innerText()), 'Área do médico');
  assert.equal(await small.locator('a[href="#plataforma"]').count(), 1);
  // Topo: o botão "Área do médico".
  const topBtn = page.locator('header.g-top a[href="medico.html"]');
  assert.equal(norm(await topBtn.innerText()), 'Área do médico');
  assert.ok(await topBtn.isVisible());
  // Sumário e a parte "Como entrar na plataforma de atendimento", entre o passo a passo e os documentos.
  assert.equal(norm(await page.locator('.toc a[href="#plataforma"]').innerText()), 'Como entrar na plataforma de atendimento');
  const h = page.getByRole('heading', { level: 2, name: 'Como entrar na plataforma de atendimento', exact: true });
  assert.equal(await h.count(), 1);
  assert.equal(await h.getAttribute('id'), 'plataforma');
  assert.ok(await page.evaluate(() => {
    const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return after(document.querySelector('#fluxograma'), document.querySelector('#plataforma')) && after(document.querySelector('#plataforma'), document.querySelector('#documentos'));
  }), 'depois do passo a passo e antes de "Documentos e assinatura"');
  const part = await page.evaluate(() => {
    let t = '';
    for (let el = document.querySelector('#plataforma').nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) t += ` ${el.innerText}`;
    return t.replace(/\s+/g, ' ').trim();
  });
  for (const re of [/^A plataforma de atendimento fica dentro do IMED, na Área do médico\./,
    /Primeira vez: toque em “Fazer minha inscrição”, digite o seu e-mail e abra o link que chegar, no mesmo aparelho e navegador\. Não tem senha\./,
    /Já tem cadastro: toque em “Área do médico”, no topo desta página ou no rodapé do site, e entre com o mesmo e-mail\./,
    // os nomes do painel são os da área do médico (medico.html)
    /Painel “Agora na plataforma”: com o cadastro aprovado/, /pacientes aguardando atendimento, há quanto tempo o primeiro da fila espera, pacientes em atendimento com você, atendimentos hoje com você, documentos para assinar e médicos disponíveis agora\./,
    // LGPD: o painel só conta; os dados de cada paciente aparecem na fila e, depois de aceitar, na consulta (com o
    // celular) e nas consultas anteriores (assets/js/medico.js), nunca no painel
    /Só números no painel: ele não mostra nenhum dado de paciente\. O nome, a idade e o motivo de cada pedido aparecem na fila de pacientes, que abre depois do aviso “Antes de ficar disponível”\. Depois que você aceita, os dados do paciente, com o celular, aparecem na consulta e em “Suas consultas anteriores”\. No painel, nunca\./]) assert.match(part, re);
  assert.ok(!/aparecem só na fila/.test(part), 'não diz que os dados aparecem "só na fila" (a consulta e o histórico também mostram)');
  assert.ok(!/\d/.test(part), `sem número de exemplo: ${part.match(/.{0,30}\d.{0,30}/)?.[0]}`);
  const medicoHtml = read('medico.html');
  for (const t of ['Plataforma de atendimento', 'Agora na plataforma', 'Antes de ficar disponível', 'Fila de pacientes', 'Suas consultas anteriores']) {
    assert.ok(medicoHtml.includes(t), `medico.html ainda chama assim: ${t}`);
  }
  // Rodapé: o link novo "Área do médico" (modelo scripts/rodape.mjs, logo depois de "Para médicos").
  const grupo = GRUPOS.find(([t]) => t === 'Clínicas e médicos');
  assert.deepEqual(grupo?.[1].find(([, p]) => p === 'medico.html'), ['Área do médico', 'medico.html'], 'rodapé: "Área do médico"');
  const foot = page.locator('footer.rodape a[href="medico.html"]');
  assert.equal(await foot.count(), 1);
  assert.equal(norm(await foot.innerText()), 'Área do médico');
  assert.equal(await page.locator('footer.rodape a[href="para-medicos.html"]', { hasText: 'Para médicos' }).count(), 1);
  // "Fazer minha inscrição" continua no começo e no fim (o botão novo é outro: "Entrar na Área do médico").
  assert.equal(await page.locator('main a.btn[href="medico.html"]', { hasText: 'Fazer minha inscrição' }).count(), 2);
  assert.equal(norm(await text(page, '#pmEntrar')), 'Entrar na Área do médico');
  await page.locator('#plataforma').scrollIntoViewIfNeeded();
  await shot(page, 'tele-faq-04-para-medicos-como-entrar');
  assert.deepEqual(errors, [], 'para-medicos.html sem erro');
  // Os quatro caminhos levam à entrada pelo e-mail da área do médico.
  for (const sel of ['#pmGo', '.pm-small a[href="medico.html"]', '#pmEntrar', 'footer.rodape a[href="medico.html"]']) {
    await page.goto(`${BASE}para-medicos.html`);
    await page.locator(sel).click();
    await page.waitForURL(`${BASE}medico.html`);
    await visible(page, '#loginEmail');
  }
  await context.close();

  // Celular (360 px): sem rolagem lateral; o botão novo e o do topo com 44 px.
  const m = await newPage(browser, makeDb(), { mobile: true, width: 360 });
  await m.page.goto(`${BASE}para-medicos.html`);
  await visible(m.page, '#plataforma');
  await noOverflow(m.page, 360, 'para-medicos.html no celular');
  const sizes = await m.page.$$eval('#pmEntrar, header.g-top a.btn', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), h: r.height, w: r.width, r: r.right }; }));
  assert.equal(sizes.length, 2);
  for (const s of sizes) assert.ok(s.h >= 44 && s.w >= 44 && s.r <= 360, `${s.t}: ${Math.round(s.w)}x${Math.round(s.h)}`);
  await m.page.locator('#plataforma').scrollIntoViewIfNeeded();
  await shot(m.page, 'tele-faq-05-para-medicos-celular');
  assert.deepEqual(m.errors, []);
  await m.context.close();
});

await scenario('acessibilidade (axe-core): perguntas, cartão do médico, topo e "Como entrar na plataforma" sem problema grave', async () => {
  if (!AXE) { console.log('  aviso - axe-core não encontrado: auditoria pulada (instale o axe-core ou passe AXE_PATH).'); return; }
  for (const mobile of [false, true]) {
    const db = makeDb();
    onDuty(db);
    const { page, errors, context } = await newPage(browser, db, { mobile, width: 360, csp: false });
    await page.goto(`${BASE}teleconsulta.html`);
    await visible(page, '#formCard');
    await visible(page, '#mdJoin');
    await openAll(page);
    assert.deepEqual(await runAxe(page, [['#faqCard'], ['#mdJoin'], ['header.pt-top']]), [], `teleconsulta.html (${mobile ? 'celular' : 'computador'})`);
    await page.goto(`${BASE}para-medicos.html`);
    await visible(page, '#plataforma');
    assert.deepEqual(await runAxe(page), [], `para-medicos.html (${mobile ? 'celular' : 'computador'})`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
