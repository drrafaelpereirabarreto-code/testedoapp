// Teste de ponta a ponta do prontuário (iMed Medical Workspace, fase 2) na área do médico (medico.html), num navegador
// de verdade (Playwright), com o Supabase simulado EM MEMÓRIA: as funções da teleconsulta que a consulta usa e as do
// prontuário (contrato de supabase/migrations/*_prontuario.sql: ws_registro_*, ws_adendo_criar, cat_cid_buscar).
// Confere: 3 colunas no computador (divisória pelo teclado, coluna recolhida) sem parar nem recriar o vídeo; no celular
// (390 e 360 px) os botões "Mostrar" sem derrubar o vídeo e sem rolagem lateral; rascunho salvo no servidor e de volta
// depois de recarregar; sinais vitais com a origem; CID-10 pelo teclado; SOAP <-> texto livre sem perda; conflito de
// versão; finalizar com confirmação; adendo; linha do tempo com filtros; tema escuro; banco sem as funções novas (a
// teleconsulta segue igual); axe na consulta aberta (se o axe-core estiver instalado ou em AXE_PATH).
// Rodar com: node tests/e2e-prontuario.mjs   (E2E_PORT muda a porta; ONLY="trecho" roda só alguns cenários)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comChaves, vigiarChaves } from './regra-chaves.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ONLY = process.env.ONLY || '';
const SHOTS = process.env.SHOTS || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  try { res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); } catch { res.writeHead(404).end(); }
});
const PORT = Number(process.env.E2E_PORT) || 8781;
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;

function findAxe() {
  const tries = [];
  if (process.env.AXE_PATH) {
    const p = resolve(process.env.AXE_PATH);
    tries.push(() => require.resolve(p));
    tries.push(() => createRequire(join(p, 'noop.js')).resolve('axe-core'));
  }
  tries.push(() => require.resolve('axe-core'));
  for (const t of tries) {
    try { const f = t(); if (f && existsSync(f)) { const min = join(dirname(f), 'axe.min.js'); return existsSync(min) ? min : f; } } catch { /* próximo */ }
  }
  return null;
}
const AXE = findAxe();

/* ======================= banco simulado ======================= */
const USERS = { 'tok-doc': { id: 'u-doc', email: 'carla@exemplo.com' }, 'tok-doc2': { id: 'u-doc2', email: 'davi@exemplo.com' } };
class PgErr extends Error {}
const iso = (t = Date.now()) => new Date(t).toISOString();
const DAY = 86400e3;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Amostra do arquivo oficial (DATASUS CID10CSV), só para o teste.
const CID = [
  { codigo: 'J02', descricao: 'Faringite aguda', categoria: true, restr_sexo: null },
  { codigo: 'J020', descricao: 'Faringite estreptocócica', categoria: false, restr_sexo: null },
  { codigo: 'J029', descricao: 'Faringite aguda não especificada', categoria: false, restr_sexo: null },
  { codigo: 'J069', descricao: 'Infecção aguda das vias aéreas superiores não especificada', categoria: false, restr_sexo: null },
  { codigo: 'N40', descricao: 'Hiperplasia da próstata', categoria: true, restr_sexo: 'M' },
];
const UNID = { pa_sistolica: 'mmHg', pa_diastolica: 'mmHg', fc: 'bpm', fr: 'irpm', temperatura: '°C', spo2: '%', peso: 'kg', altura: 'cm', glicemia_capilar: 'mg/dL' };

function makeDb({ semProntuario = false } = {}) {
  const db = { doctors: new Map(), consults: new Map(), evos: new Map(), versoes: [], adendos: [], trilha: [], calls: [], semProntuario };
  db.addDoctor = (d) => { const row = { id: randomUUID(), rqe: null, specialty: null, phone: null, status: 'approved', review_note: null, reviewed_at: null, available_until: null, created_at: iso(Date.now() - DAY), updated_at: iso(), checked_at: iso(Date.now() - DAY), ...d }; db.doctors.set(row.id, row); return row; };
  db.addConsult = (c) => {
    const row = { id: randomUUID(), status: 'waiting', patient_name: 'Paciente Teste', patient_birthdate: '1980-05-17', patient_phone: '11987654321', for_other: false, requester_name: null, relationship: null,
      guardian_consent: false, patient_agrees: false, reason: 'Dor de garganta há 3 dias', consent_version: '2026-10-30.2', consent_at: iso(), doctor_id: null, accepted_at: null, started_at: null,
      ended_at: null, closed_by: null, offer_sdp: null, offer_version: 0, answer_sdp: null, answer_version: 0, exams: [], indication: null, exams_version: 0, guidance: null, notes: null, created_at: iso(), ...c };
    db.consults.set(row.id, row);
    return row;
  };
  db.called = (fn) => db.calls.filter((c) => c.fn === fn);
  return db;
}
const docOf = (db, uid) => [...db.doctors.values()].find((d) => d.user_id === uid) || null;
function me(db, uid) { const d = docOf(db, uid); if (!uid || !d) throw new PgErr('sem_cadastro'); if (d.status !== 'approved') throw new PgErr('nao_aprovado'); return d; }
const inWindow = (c) => ['accepted', 'in_call'].includes(c.status) || (c.status === 'ended' && Date.now() - Date.parse(c.ended_at) < DAY);
const age = (b) => { const [y, m, d] = b.split('-').map(Number); const n = new Date(); return n.getFullYear() - y - (n.getMonth() + 1 < m || (n.getMonth() + 1 === m && n.getDate() < d) ? 1 : 0); };
const statusRow = (c) => ({ id: c.id, status: c.status, offer_version: c.offer_version, answer_version: c.answer_version, answer_sdp: null, created_at: c.created_at, accepted_at: c.accepted_at,
  started_at: c.started_at, ended_at: c.ended_at, patient_name: c.patient_name, patient_birthdate: c.patient_birthdate, age_years: age(c.patient_birthdate), patient_phone: c.patient_phone,
  reason: c.reason, for_other: false, requester_name: null, relationship: null, guardian_consent: false, patient_agrees: false, consent_version: c.consent_version, consent_at: c.consent_at,
  exams: c.exams, indication: c.indication, guidance: c.guidance, notes: c.notes, doctor: null, closed_by: c.closed_by, phone_call_at: null, patient_seen_seconds: null, exams_version: c.exams_version, exams_at: null, access: 'own' });

// Acesso ao prontuário: só o médico da consulta (como private.ws_acesso); a trilha guarda o negado.
function acesso(db, uid, id, fn) {
  const c = db.consults.get(id);
  const d = docOf(db, uid);
  if (!c || !d || c.doctor_id !== d.id || d.status !== 'approved') { db.trilha.push({ fn, resultado: 'negado' }); return { erro: 'forbidden' }; }
  db.trilha.push({ fn, resultado: 'permitido' });
  return { c, d, podeEditar: inWindow(c) };
}
const evoJson = (e) => e && ({ ...e, medidas: e.medidas || [], diagnosticos: e.diagnosticos || [] });

const RPC = {
  tele_doctor_me(db, a, uid) { const d = docOf(db, uid); return [{ ...(d || {}), is_admin: false }]; },
  tele_set_available(db, a, uid) { const d = me(db, uid); d.available_until = a.p_on ? iso(Date.now() + 90e3) : null; return d.available_until; },
  tele_queue(db, a, uid) {
    const d = me(db, uid);
    return [...db.consults.values()].filter((c) => c.status === 'waiting' || (c.doctor_id === d.id && ['accepted', 'in_call'].includes(c.status)))
      .map((c) => ({ id: c.id, status: c.status, patient_name: c.patient_name, age_years: age(c.patient_birthdate), reason: c.reason, for_other: false, relationship: null, wait_minutes: 1, created_at: c.created_at, accepted_at: c.accepted_at, seen_seconds: null }));
  },
  tele_accept(db, a, uid) {
    const d = me(db, uid);
    const c = db.consults.get(a.p_id);
    Object.assign(c, { status: 'accepted', doctor_id: d.id, accepted_at: iso() });
    return [statusRow(c)];
  },
  tele_doctor_status(db, a, uid) { const c = db.consults.get(a.p_id); const d = docOf(db, uid); return c && d && c.doctor_id === d.id ? [statusRow(c)] : []; },
  tele_offer(db, a, uid) { me(db, uid); const c = db.consults.get(a.p_id); c.offer_version += 1; c.offer_sdp = a.p_sdp; return c.offer_version; },
  tele_mark_started(db, a) { const c = db.consults.get(a.p_id); c.started_at ||= iso(); return c.started_at; },
  tele_doctor_messages() { return []; },
  tele_doctor_send(db, a) { return db.calls.length + Number(!!a); },
  tele_history(db, a, uid) {
    const d = docOf(db, uid);
    return [...db.consults.values()].filter((c) => d && c.doctor_id === d.id && c.status === 'ended').map((c) => ({ ...statusRow(c), exams_version: 0 }));
  },
  tele_end(db, a) { const c = db.consults.get(a.p_id); Object.assign(c, { status: 'ended', ended_at: iso(), notes: a.p_notes, guidance: a.p_guidance, closed_by: 'doctor' }); return null; },
  tele_doc_pending() { return []; },
  tele_doc_list() { return []; },
  tele_doctor_profile() { return []; },
  tele_doc_patient_data() { return []; },

  ws_registro_abrir(db, a, uid) {
    const x = acesso(db, uid, a.p_consulta, 'ws_registro_abrir');
    if (x.erro) return x;
    const e = db.evos.get(a.p_consulta) || null;
    return { acesso: 'own', pode_editar: x.podeEditar && (!e || e.situacao === 'rascunho'), pode_adendo: !!e && e.situacao === 'finalizada',
      assinatura: 'registro não assinado digitalmente', evolucao: evoJson(e), adendos: db.adendos.filter((d) => d.consulta === a.p_consulta) };
  },
  ws_registro_salvar(db, a, uid) {
    const x = acesso(db, uid, a.p_consulta, 'ws_registro_salvar');
    if (x.erro) return x;
    if (!x.podeEditar) return { erro: 'prazo_encerrado' };
    const k = Object.keys(a.p_conteudo || {}).find((key) => !['modo', 'anamnese', 'exame', 'diagnosticos', 'conduta', 'soap', 'livre', 'nao_classificado'].includes(key));
    if (k) return { erro: 'dados_invalidos', campo: k };
    if ((a.p_conteudo.diagnosticos || []).some((d) => d.cid && !CID.some((c) => c.codigo === d.cid))) return { erro: 'dados_invalidos', campo: 'cid_desconhecido' };
    if ((a.p_conteudo.exame?.medidas || []).some((m) => m.como_obtido === 'contado_pelo_medico_no_video' && m.tipo !== 'fr')) return { erro: 'dados_invalidos', campo: 'medida.1.como_obtido' };
    let e = db.evos.get(a.p_consulta);
    if (!e) {
      if (a.p_versao !== 0) return { erro: 'versao_conflito', versao: 0, conteudo: null };
      e = { id: randomUUID(), tipo: 'evolucao', situacao: 'rascunho', versao: 1, conteudo: a.p_conteudo, salvo_em: iso(), criado_em: iso() };
      db.evos.set(a.p_consulta, e);
      db.versoes.push({ consulta: a.p_consulta, versao: 1, conteudo: a.p_conteudo, salvo_em: iso() });
      return { ok: true, id: e.id, versao: 1, salvo_em: e.salvo_em };
    }
    if (e.situacao !== 'rascunho') return { erro: 'ja_finalizado' };
    if (e.versao !== a.p_versao) return { erro: 'versao_conflito', versao: e.versao, conteudo: e.conteudo, salvo_em: e.salvo_em };
    Object.assign(e, { conteudo: a.p_conteudo, versao: e.versao + 1, salvo_em: iso() });
    db.versoes.push({ consulta: a.p_consulta, versao: e.versao, conteudo: a.p_conteudo, salvo_em: iso() });
    return { ok: true, id: e.id, versao: e.versao, salvo_em: e.salvo_em };
  },
  ws_registro_finalizar(db, a, uid) {
    const x = acesso(db, uid, a.p_consulta, 'ws_registro_finalizar');
    if (x.erro) return x;
    const e = db.evos.get(a.p_consulta);
    if (!e) return { erro: 'vazio' };
    if (e.situacao !== 'rascunho') return { erro: 'ja_finalizado' };
    if (e.versao !== a.p_versao) return { erro: 'versao_conflito', versao: e.versao, conteudo: e.conteudo };
    Object.assign(e, { situacao: 'finalizada', finalizada_em: iso(), hash: sha(JSON.stringify(e.conteudo)), medico: { nome: x.d.full_name, crm: x.d.crm, crm_uf: x.d.crm_uf },
      medidas: (e.conteudo.exame?.medidas || []).map((m) => ({ ...m, unidade: UNID[m.tipo] })), diagnosticos: (e.conteudo.diagnosticos || []).map((d) => ({ ...d })) });
    return { ok: true, evolucao: evoJson(e) };
  },
  ws_adendo_criar(db, a, uid) {
    const x = acesso(db, uid, a.p_consulta, 'ws_adendo_criar');
    if (x.erro) return x;
    const t = String(a.p_texto || '').trim();
    if (t.length < 3) return { erro: 'dados_invalidos', campo: 'texto' };
    const e = db.evos.get(a.p_consulta);
    if (!e || e.situacao === 'rascunho') return { erro: 'nao_finalizado' };
    const ad = { consulta: a.p_consulta, id: randomUUID(), texto: t, finalizada_em: iso(), hash: sha(t), medico: { nome: x.d.full_name } };
    db.adendos.push(ad);
    return { ok: true, id: ad.id, finalizada_em: ad.finalizada_em, hash: ad.hash };
  },
  ws_registro_historico(db, a, uid) {
    const x = acesso(db, uid, a.p_consulta, 'ws_registro_historico');
    if (x.erro) return x;
    const e = db.evos.get(a.p_consulta);
    const ev = db.versoes.filter((v) => v.consulta === a.p_consulta).map((v) => ({ tipo: 'versao', em: v.salvo_em, versao: v.versao, modo: v.conteudo.modo || 'soap' }));
    if (e?.situacao === 'finalizada') {
      ev.push({ tipo: 'finalizado', em: e.finalizada_em, medico: e.medico.nome });
      for (const d of e.diagnosticos) ev.push({ tipo: 'diagnostico', em: e.finalizada_em, ...d });
    }
    for (const ad of db.adendos.filter((d) => d.consulta === a.p_consulta)) ev.push({ tipo: 'adendo', em: ad.finalizada_em, texto: ad.texto, medico: ad.medico.nome });
    return { eventos: ev.sort((p, q) => q.em.localeCompare(p.em)), outras_consultas: 'O histórico de outras consultas do mesmo paciente depende do cadastro do paciente e do termo novo (fase 2.2).' };
  },
  ws_registro_versao(db, a, uid) {
    const x = acesso(db, uid, a.p_consulta, 'ws_registro_versao');
    if (x.erro) return x;
    const v = db.versoes.find((y) => y.consulta === a.p_consulta && y.versao === a.p_versao);
    return v ? { versao: v.versao, conteudo: v.conteudo, salvo_em: v.salvo_em } : { erro: 'nao_encontrado' };
  },
  cat_cid_buscar(db, a, uid) {
    if (!docOf(db, uid)) return { erro: 'forbidden' };
    const q = fold(a.p_q).trim();
    if (q.length < 2) return { itens: [] };
    if (/^[a-z][0-9]{1,2}(\.?[0-9x])?$/.test(q)) { const c = q.replace('.', '').toUpperCase(); return { itens: CID.filter((x) => x.codigo.startsWith(c)) }; }
    const ws = q.split(' ').filter((w) => w.length >= 2);
    return { itens: CID.filter((x) => ws.every((w) => fold(`${x.codigo} ${x.descricao}`).includes(w))), fonte: 'Amostra do teste' };
  },
};

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body), headers: cors });

async function newPage(browser, db, { width = 1440, height = 900, mobile = false, dark = false, offline = null } = {}) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block', permissions: ['camera', 'microphone'], bypassCSP: true, ...(dark ? { colorScheme: 'dark' } : {}),
  });
  await context.addInitScript(() => { try { localStorage.setItem('imed_lgpd', '1'); } catch { /* ignora */ } });
  await context.route(`${BASE}assets/js/config.js`, async (route) => {
    const src = await readFile(join(ROOT, 'assets/js/config.js'), 'utf8');
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: `${src}\nwindow.IMED_CONFIG.tele = ${JSON.stringify({ iceServers: [], planBMs: 600000, gatherMs: 1500 })};\n` });
  });
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    const auth = (req.headers().authorization || '').replace(/^Bearer /, '');
    if (u.pathname === '/auth/v1/user') return USERS[auth] ? json(route, USERS[auth]) : json(route, { msg: 'invalid' }, 401);
    const m = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    const fn = m?.[1];
    if (!fn || !RPC[fn] || (db.semProntuario && (fn.startsWith('ws_') || fn === 'cat_cid_buscar'))) {
      return json(route, { code: 'PGRST202', message: `Could not find the function public.${fn}` }, 404);
    }
    if (offline && offline(fn)) return route.abort('internetdisconnected');
    const args = JSON.parse(req.postData() || '{}');
    const uid = USERS[auth]?.id || null;
    db.calls.push({ fn, args, uid });
    try {
      const out = RPC[fn](db, args, uid);
      return out === null ? route.fulfill({ status: 204, body: '', headers: cors }) : json(route, out);
    } catch (e) {
      if (e instanceof PgErr) return json(route, { code: 'P0001', message: e.message }, 400);
      return json(route, { message: String(e) }, 500);
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource|net::ERR_INTERNET_DISCONNECTED/.test(msg.text())) errors.push(msg.text()); });
  return { context, page, errors };
}

const loginUrl = (tok) => `${BASE}medico.html#access_token=${tok}&refresh_token=r-${tok}&expires_in=3600&token_type=bearer&type=magiclink`;
const visible = (page, sel, timeout = 15000) => page.waitForSelector(sel, { state: 'visible', timeout });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };
const waitFor = async (fn, ms = 15000, what = 'condição') => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error(`tempo esgotado esperando: ${what}`); await new Promise((r) => setTimeout(r, 100)); } };

// Médico aprovado entra, aceita o aviso, fica disponível e aceita o paciente que está na fila.
async function abrirConsulta(page, db) {
  await page.goto(loginUrl('tok-doc'));
  await visible(page, '#noticeCard');
  await page.check('#noticeOk');
  await page.click('#noticeBtn');
  await visible(page, '#dutyCard');
  await page.click('#availBtn');
  await page.waitForSelector('#availBtn[aria-checked="true"]');
  await page.click('[data-accept]');
  await visible(page, '#consult');
  await visible(page, '#wsAbasReg', 20000);
  assert.ok(db.called('ws_registro_abrir').length >= 1);
}
// Vídeo local (câmera falsa) tocando, e o mesmo elemento de antes.
const marcarVideo = (page) => page.evaluate(() => { window.__v = document.querySelector('#cLocal'); window.__r = document.querySelector('#cRemote'); });
async function videoVivo(page, onde) {
  await page.waitForFunction(() => { const v = document.querySelector('#cLocal'); return v && v.readyState >= 2 && !v.paused; }, null, { timeout: 20000 });
  const t1 = await page.evaluate(() => document.querySelector('#cLocal').currentTime);
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({ mesmo: window.__v === document.querySelector('#cLocal') && window.__r === document.querySelector('#cRemote'), pausado: document.querySelector('#cLocal').paused, t: document.querySelector('#cLocal').currentTime }));
  assert.ok(r.mesmo, `${onde}: os <video> são os mesmos (nunca recriados)`);
  assert.equal(r.pausado, false, `${onde}: o vídeo não parou`);
  assert.ok(r.t > t1, `${onde}: o vídeo continua andando`);
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function salvo(page, db, n) { await waitFor(() => db.called('ws_registro_salvar').length >= n, 15000, `salvamento nº ${n}`); await page.waitForFunction(() => /Rascunho salvo/.test(document.querySelector('#wsSalvo')?.textContent || ''), null, { timeout: 15000 }); }
async function axeConsulta(page, onde) {
  if (!AXE) { console.log(`aviso - axe-core não encontrado: axe pulado (${onde})`); return; }
  await page.addScriptTag({ path: AXE });
  const v = await page.evaluate(async () => {
    const r = await window.axe.run(document.querySelector('#consult'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
    return r.violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => `${x.id}: ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  });
  assert.deepEqual(v, [], `${onde}: axe sem violação grave`);
}

const results = [];
async function scenario(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const t0 = Date.now();
  try { await comChaves(fn); results.push(['ok', name]); console.log(`ok - ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 6).join('\n  ')}`); }
}

const browser = vigiarChaves(await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }));

/* ======================= cenários ======================= */
await scenario('computador: 3 colunas, divisória e coluna recolhida sem parar o vídeo; rascunho volta depois de recarregar', async () => {
  const db = makeDb();
  db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Souza Lima', crm: '123456', crm_uf: 'SP' });
  const c = db.addConsult({});
  const { page, errors, context } = await newPage(browser, db);
  await abrirConsulta(page, db);
  await marcarVideo(page);
  await videoVivo(page, 'consulta aberta');
  // Três colunas, da esquerda para a direita: paciente | vídeo e prontuário | ferramentas.
  const caixas = await page.evaluate(() => ['#wsPac', '#wsCons', '#wsFer'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; }));
  assert.ok(caixas[0][0] < caixas[1][0] && caixas[1][0] < caixas[2][0], `colunas em ordem: ${JSON.stringify(caixas)}`);
  assert.ok(caixas.every(([, w]) => w > 150), 'as três colunas aparecem');
  assert.equal(await page.evaluate(() => !!document.querySelector('#wsCons #cRemote') && !!document.querySelector('#wsFer #cChat') && !!document.querySelector('#wsPac #cPatient')), true);
  assert.equal(await page.isVisible('#wsAbas'), false, 'sem os botões do celular no computador');
  // Divisória pelo teclado (WAI-ARIA window splitter).
  const antes = Number(await page.getAttribute('#wsSplitPac', 'aria-valuenow'));
  await page.focus('#wsSplitPac');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(Number(await page.getAttribute('#wsSplitPac', 'aria-valuenow')), antes + 32);
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('imed_ws_layout'))).pac, antes + 32, 'largura lembrada');
  // Recolher e abrir a coluna de ferramentas.
  await page.click('#wsFerBtn');
  assert.equal(await page.getAttribute('#wsFerBtn', 'aria-expanded'), 'false');
  assert.equal(await page.isVisible('#cChat'), false);
  await videoVivo(page, 'coluna recolhida');
  await page.click('#wsFerBtn');
  assert.equal(await page.getAttribute('#wsFerBtn', 'aria-expanded'), 'true');
  await visible(page, '#cChat');
  await videoVivo(page, 'coluna aberta de novo');
  // Anamnese: salvo no servidor sozinho.
  await page.fill('#wsF-anamnese-queixa', 'Dor de garganta há 3 dias');
  await salvo(page, db, 1);
  assert.equal(db.evos.get(c.id).conteudo.anamnese.queixa, 'Dor de garganta há 3 dias');
  assert.equal(db.evos.get(c.id).conteudo.exame, undefined, 'nenhum sinal vital preenchido sozinho');
  await axeConsulta(page, 'consulta no computador');
  await shot(page, 'prontuario-computador');
  // Recarregar a página: a área do médico volta sozinha para a consulta e o rascunho vem do servidor.
  await page.reload();
  await visible(page, '#consult', 20000);
  await page.waitForFunction(() => document.querySelector('#wsF-anamnese-queixa'), null, { timeout: 20000 });
  assert.equal(await page.inputValue('#wsF-anamnese-queixa'), 'Dor de garganta há 3 dias', 'rascunho de volta depois de recarregar');
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('imed_ws_layout'))).pac, antes + 32);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('registro: sinais vitais com origem, CID-10 pelo teclado, SOAP <-> texto livre, conflito, finalizar, adendo e linha do tempo', async () => {
  const db = makeDb();
  db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Souza Lima', crm: '123456', crm_uf: 'SP' });
  const c = db.addConsult({});
  const { page, errors, context } = await newPage(browser, db);
  await abrirConsulta(page, db);
  // Exame físico: o médico não "conta" a frequência cardíaca pelo vídeo; a respiratória, sim.
  await page.click('#wsTab-exame');
  await page.selectOption('#wsMedTipo', 'fc');
  assert.equal(await page.locator('#wsMedOrigem option[value="medico_video"]').count(), 0, 'contagem pelo médico só aparece para a frequência respiratória');
  await page.click('[data-ws="med-add"]');
  assert.match(await page.textContent('#wsMedErr'), /Digite o valor medido/);
  await page.selectOption('#wsMedTipo', 'fr');
  await page.fill('#wsMedValor', '18');
  await page.selectOption('#wsMedOrigem', 'medico_video');
  await page.click('[data-ws="med-add"]');
  await page.selectOption('#wsMedTipo', 'temperatura');
  await page.fill('#wsMedValor', '38,2');
  await page.selectOption('#wsMedOrigem', 'paciente_relato');
  await page.click('[data-ws="med-add"]');
  const meds = await page.locator('#wsMeds .ws-med').allTextContents();
  assert.equal(meds.length, 2);
  assert.match(meds[0], /Frequência respiratória: 18 irpm.*Observado pelo médico no vídeo/);
  assert.match(meds[1], /Temperatura: 38,2 °C.*Medido pelo paciente \(informado por ele\)/);
  // Aparelho na câmera: pede a hora.
  await page.selectOption('#wsMedTipo', 'spo2');
  await page.fill('#wsMedValor', '97');
  await page.selectOption('#wsMedOrigem', 'paciente_camera');
  await visible(page, '#wsMedHora');
  await page.click('[data-ws="med-add"]');
  assert.match(await page.textContent('#wsMedErr'), /hora da medida/);
  // Diagnóstico: busca na CID-10, escolhe pelo teclado.
  await page.click('#wsTab-diagnostico');
  await page.fill('#wsCidQ', 'faringite');
  await page.waitForSelector('#wsCidLista [role="option"]');
  assert.equal(await page.getAttribute('#wsCidQ', 'aria-expanded'), 'true');
  await page.press('#wsCidQ', 'ArrowDown');
  await page.press('#wsCidQ', 'ArrowDown');
  assert.equal(await page.getAttribute('#wsCidQ', 'aria-activedescendant'), 'wsCidOp1');
  await page.press('#wsCidQ', 'Enter');
  await page.waitForSelector('#wsDiags .ws-diag');
  assert.match(await page.textContent('#wsDiags'), /J02\.0 Faringite estreptocócica/);
  assert.equal(await page.inputValue('#wsDpapel0'), 'hipotese', 'entra como hipótese: o médico decide o papel');
  await page.selectOption('#wsDsituacao0', 'descartado');
  await page.fill('#wsCidQ', 'j06.9');
  await page.waitForSelector('#wsCidOp0');
  await page.click('#wsCidOp0');
  await page.selectOption('#wsDpapel1', 'principal');
  // Evolução: SOAP -> texto livre -> SOAP sem perder nada.
  await page.click('#wsTab-evolucao');
  await page.fill('#wsF-soap-s', 'Dor ao engolir');
  await page.fill('#wsF-soap-a', 'Provável IVAS');
  await page.check('input[name="wsModo"][value="livre"]');
  assert.equal(await page.inputValue('#wsF-livre'), 'S: Dor ao engolir\n\nA: Provável IVAS');
  await page.check('input[name="wsModo"][value="soap"]');
  assert.equal(await page.inputValue('#wsF-soap-s'), 'Dor ao engolir');
  assert.equal(await page.inputValue('#wsF-soap-a'), 'Provável IVAS');
  await page.click('#wsTab-conduta');
  await page.fill('#wsF-conduta', 'Sintomáticos; retorno se piorar');
  await salvo(page, db, 1);
  await waitFor(() => db.evos.get(c.id)?.conteudo?.conduta === 'Sintomáticos; retorno se piorar', 15000, 'conduta salva');
  const e = db.evos.get(c.id);
  assert.deepEqual(e.conteudo.exame.medidas.map((m) => `${m.tipo} ${m.valor} ${m.quem_mediu} ${m.como_obtido}`), ['fr 18 medico contado_pelo_medico_no_video', 'temperatura 38.2 paciente relato']);
  assert.deepEqual(e.conteudo.diagnosticos.map((d) => `${d.cid} ${d.papel} ${d.situacao}`), ['J020 hipotese descartado', 'J069 principal suspeito']);
  assert.equal(e.conteudo.livre, 'S: Dor ao engolir\n\nA: Provável IVAS', 'o texto livre também ficou guardado');
  // Outra aba salvou antes: aviso de conflito, nada sobrescrito calado.
  Object.assign(e, { versao: e.versao + 1, conteudo: { ...e.conteudo, conduta: 'Escrito em outra aba' } });
  await page.fill('#wsF-conduta', 'Sintomáticos; retorno se piorar em 48 h');
  await visible(page, '#wsConflito');
  assert.match(await page.textContent('#wsConflito'), /salvo em outra aba ou aparelho/);
  assert.equal(db.evos.get(c.id).conteudo.conduta, 'Escrito em outra aba');
  await page.click('[data-ws="conflito-manter"]');
  await waitFor(() => db.evos.get(c.id).conteudo.conduta === 'Sintomáticos; retorno se piorar em 48 h', 15000, 'conflito resolvido mantendo o desta tela');
  // Pré-visualização.
  await page.click('#wsTab-previa');
  const prev = await page.textContent('#wsP-previa');
  assert.match(prev, /Queixa principal|Frequência respiratória: 18 irpm/);
  assert.match(prev, /J06\.9 Infecção aguda das vias aéreas superiores não especificada \(Principal, suspeito\)/);
  assert.match(prev, /Registro não assinado digitalmente/);
  // Finalizar com confirmação.
  await page.click('[data-ws="finalizar"]');
  await visible(page, '#wsFinConfirm');
  assert.match(await page.textContent('#wsFinConfirm'), /2 sinais vitais e 2 diagnósticos/);
  await page.click('[data-ws="fin-nao"]');
  assert.equal(db.called('ws_registro_finalizar').length, 0, 'voltar não finaliza');
  await page.click('[data-ws="finalizar"]');
  await page.click('[data-ws="fin-sim"]');
  await visible(page, '.ws-fim');
  assert.equal(db.evos.get(c.id).situacao, 'finalizada');
  assert.equal(await page.locator('#wsF-conduta').count(), 0, 'finalizado: sem campos para editar');
  assert.match(await page.textContent('#wsSalvo'), /Finalizado em/);
  // Adendo.
  await page.fill('#wsAdendo', 'Paciente retornou o contato: sem febre.');
  await page.click('[data-ws="adendo"]');
  await page.click('[data-ws="adendo-sim"]');
  await page.waitForSelector('.ws-adendo');
  assert.match(await page.textContent('.ws-adendos'), /Paciente retornou o contato: sem febre\./);
  // Linha do tempo com filtros.
  await page.waitForSelector('[data-ws-filtro="diagnostico"]');
  await page.waitForFunction(() => /Adendos \(1\)/.test(document.querySelector('#wsFiltros').textContent));
  await page.click('[data-ws-filtro="diagnostico"]');
  assert.equal(await page.getAttribute('[data-ws-filtro="diagnostico"]', 'aria-pressed'), 'true');
  const itens = await page.locator('#wsTempo li').allTextContents();
  assert.equal(itens.length, 2);
  assert.ok(itens.every((t) => /J0[26]\./.test(t)), itens.join(' | '));
  await page.click('[data-ws-filtro="versao"]');
  await page.click('#wsTempo [data-ws-versao]');
  await page.waitForSelector('#wsTempo .ws-prev');
  assert.match(await page.textContent('#wsTempoNota'), /outras consultas do mesmo paciente/);
  await axeConsulta(page, 'prontuário finalizado');
  await shot(page, 'prontuario-finalizado');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('sem conexão: o rascunho fica no aparelho e é salvo quando a rede volta', async () => {
  const db = makeDb();
  db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Souza Lima', crm: '123456', crm_uf: 'SP' });
  const c = db.addConsult({});
  let caiu = true;
  const { page, errors, context } = await newPage(browser, db, { offline: (fn) => caiu && fn === 'ws_registro_salvar' });
  await abrirConsulta(page, db);
  await page.fill('#wsF-anamnese-hda', 'Começou com febre');
  await page.waitForFunction(() => /Sem conexão/.test(document.querySelector('#wsSalvo').textContent), null, { timeout: 15000 });
  const guardado = await page.evaluate((id) => JSON.parse(sessionStorage.getItem(`imed_ws_rasc:${id}`)), c.id);
  assert.equal(guardado.c.anamnese.hda, 'Começou com febre');
  caiu = false;
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await waitFor(() => db.evos.get(c.id)?.conteudo?.anamnese?.hda === 'Começou com febre', 15000, 'salvo quando a rede voltou');
  await page.waitForFunction(() => /Rascunho salvo/.test(document.querySelector('#wsSalvo').textContent));
  assert.deepEqual(errors, []);
  await context.close();
});

for (const width of [390, 360]) {
  await scenario(`celular ${width} px: botões "Mostrar" sem derrubar o vídeo e sem rolagem lateral`, async () => {
    const db = makeDb();
    db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Souza Lima', crm: '123456', crm_uf: 'SP' });
    db.addConsult({});
    const { page, errors, context } = await newPage(browser, db, { width, height: 800, mobile: true });
    await abrirConsulta(page, db);
    await marcarVideo(page);
    await videoVivo(page, 'celular');
    assert.equal(await page.isVisible('#wsSplitPac'), false, 'sem divisória no celular');
    await visible(page, '#wsAbas');
    assert.ok(await overflow(page) <= 0, 'sem rolagem lateral (tudo)');
    // O vídeo vem primeiro.
    const topo = await page.evaluate(() => ['#cVideoCard', '#wsAbas', '#cPatient'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)));
    assert.ok(topo[0] < topo[1] && topo[1] < topo[2], `vídeo, botões e paciente nessa ordem: ${topo}`);
    for (const [qual, sel, some] of [['reg', '#wsReg', '#cPatient'], ['msg', '#cChat', '#wsReg'], ['fer', '#cDocs', '#cChat'], ['pac', '#cPatient', '#cDocs']]) {
      await page.click(`[data-ws-mostra="${qual}"]`);
      assert.equal(await page.getAttribute(`[data-ws-mostra="${qual}"]`, 'aria-pressed'), 'true');
      await visible(page, sel);
      assert.equal(await page.isVisible(some), false, `${qual}: ${some} escondido`);
      assert.equal(await page.isVisible('#cVideoCard'), true, `${qual}: o vídeo continua na tela`);
      assert.ok(await overflow(page) <= 0, `${qual}: sem rolagem lateral`);
      await videoVivo(page, `mostrar ${qual}`);
    }
    await page.click('[data-ws-mostra="reg"]');
    await page.click('#wsTab-exame');
    assert.ok(await overflow(page) <= 0, 'exame físico sem rolagem lateral');
    await shot(page, `prontuario-celular-${width}`);
    await page.click('[data-ws-mostra="tudo"]');
    assert.equal(await page.isVisible('#cPatient') && await page.isVisible('#cChat') && await page.isVisible('#wsReg'), true, 'tudo de volta');
    assert.deepEqual(errors, []);
    await context.close();
  });
}

await scenario('tema escuro: prontuário com as cores do tema (sem fundo branco fixo)', async () => {
  const db = makeDb();
  db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Souza Lima', crm: '123456', crm_uf: 'SP' });
  db.addConsult({});
  const { page, errors, context } = await newPage(browser, db, { dark: true });
  await abrirConsulta(page, db);
  const cores = await page.evaluate(() => ['#wsReg', '#wsHist', '#wsF-anamnese-queixa', '.ws-recolher'].map((s) => getComputedStyle(document.querySelector(s)).backgroundColor));
  assert.ok(cores.every((c) => c !== 'rgb(255, 255, 255)'), `fundos escuros: ${cores.join(', ')}`);
  await axeConsulta(page, 'tema escuro');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('banco sem as funções do prontuário: aviso e a teleconsulta segue igual', async () => {
  const db = makeDb({ semProntuario: true });
  db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Souza Lima', crm: '123456', crm_uf: 'SP' });
  db.addConsult({});
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(loginUrl('tok-doc'));
  await visible(page, '#noticeCard');
  await page.check('#noticeOk');
  await page.click('#noticeBtn');
  await page.click('#availBtn');
  await page.click('[data-accept]');
  await visible(page, '#consult');
  await page.waitForFunction(() => /ainda não está disponível/.test(document.querySelector('#wsRegBox').textContent), null, { timeout: 15000 });
  await marcarVideo(page);
  await videoVivo(page, 'sem prontuário');
  await page.fill('#cNotes', 'Registro no campo de sempre');
  await page.click('#cEnd');
  await page.click('#cEndYes');
  await waitFor(() => db.called('tele_end').length === 1, 15000, 'encerrar');
  assert.equal(db.called('tele_end')[0].args.p_notes, 'Registro no campo de sempre');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('outro médico: o prontuário não abre e a trilha guarda o negado', async () => {
  const db = makeDb();
  db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Souza Lima', crm: '123456', crm_uf: 'SP' });
  const outro = db.addDoctor({ user_id: 'u-doc2', full_name: 'Davi Prado Ramos', crm: '654321', crm_uf: 'SP' });
  const c = db.addConsult({ status: 'in_call', doctor_id: outro.id, accepted_at: iso(), started_at: iso() });
  assert.deepEqual(RPC.ws_registro_abrir(db, { p_consulta: c.id }, 'u-doc'), { erro: 'forbidden' });
  assert.deepEqual(db.trilha.at(-1), { fn: 'ws_registro_abrir', resultado: 'negado' });
});

await browser.close();
server.close();
const bad = results.filter(([r]) => r !== 'ok');
console.log(`\n${results.length - bad.length}/${results.length} cenários ok`);
process.exit(bad.length ? 1 : 0);
