// Teste de ponta a ponta da teleconsulta (teleconsulta.html e medico.html) num navegador de verdade (Playwright),
// com o Supabase simulado EM MEMÓRIA (as funções do contrato de supabase/migrations/20261030070000_teleconsulta.sql)
// e duas páginas no mesmo Chromium (paciente e médico). O vídeo conecta de verdade (câmera e microfone falsos do
// Chromium, conexão direta só pela máquina: iceServers vazio).
// Rodar com: node tests/e2e-tele.mjs   (precisa do pacote "playwright" instalado)
// Opcional: SHOTS=pasta node tests/e2e-tele.mjs  salva capturas de tela nessa pasta. E2E_PORT muda a porta.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
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
const PORT = Number(process.env.E2E_PORT) || 8772; // E2E_PORT: outra porta para rodar em paralelo
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;

/* ======================= banco simulado (contrato da teleconsulta) ======================= */
const USERS = {
  'tok-doc': { id: 'u-doc', email: 'carla@exemplo.com' },
  'tok-admin': { id: 'u-admin', email: 'rafael@exemplo.com' },
  'tok-new': { id: 'u-new', email: 'bia@exemplo.com' },
  'tok-doc2': { id: 'u-doc2', email: 'davi@exemplo.com' },
};
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
class PgErr extends Error { constructor(message, details = null) { super(message); this.details = details; } }
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const DOCTOR_FNS = new Set(['tele_doctor_me', 'tele_doctor_register', 'tele_set_available', 'tele_queue', 'tele_accept', 'tele_offer', 'tele_doctor_status',
  'tele_set_exams', 'tele_end', 'tele_doctor_send', 'tele_doctor_messages', 'tele_history', 'tele_admin_doctors', 'tele_admin_set_doctor']);
const todaySP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function age(birth) {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ty, tm, td] = todaySP().split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
const iso = (t = Date.now()) => new Date(t).toISOString();

function makeDb() {
  const db = { doctors: new Map(), consults: new Map(), messages: [], seq: 0, admins: new Set(['u-admin']), calls: [], waitlist: [], otp: [], t: 0 };
  db.addDoctor = (d) => { const row = { id: randomUUID(), rqe: null, specialty: null, phone: null, status: 'approved', review_note: null, reviewed_at: null, reviewed_by: null, available_until: null, created_at: iso(Date.now() - 86400e3), updated_at: iso(), ...d }; db.doctors.set(row.id, row); return row; };
  db.addConsult = (c) => {
    const row = { id: randomUUID(), status: 'waiting', patient_birthdate: '1980-01-01', patient_phone: '11987654321', for_other: false, requester_name: null, relationship: null,
      guardian_consent: false, reason: 'Teste', consent_version: '2026-10-30', consent_at: iso(), doctor_id: null, doctor_info: null, accepted_at: null, started_at: null,
      ended_at: null, offer_sdp: null, offer_version: 0, answer_sdp: null, answer_version: 0, exams: [], indication: null, guidance: null, notes: null, created_at: iso(Date.now() + (db.t++)), ...c };
    db.consults.set(row.id, row);
    return row;
  };
  db.called = (fn) => db.calls.filter((c) => c.fn === fn);
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
const byToken = (db, id, token) => { const c = db.consults.get(id); return c && c.token_hash === sha(token ?? '') ? c : null; };
const docInfo = (d) => ({ full_name: d.full_name, crm: d.crm, crm_uf: d.crm_uf, rqe: d.rqe, specialty: d.rqe ? d.specialty : null });
const onlineCount = (db) => [...db.doctors.values()].filter((d) => d.status === 'approved' && d.available_until && Date.parse(d.available_until) > Date.now()).length;
const blank = (v) => String(v ?? '').trim() === '';
const digits = (v) => String(v ?? '').replace(/\D/g, '');
function sdpOk(s) { if (s == null || s.length > 30000 || !s.startsWith('v=0')) throw new PgErr('dados_invalidos', 'sdp'); }
function msgs(db, id, after) { return db.messages.filter((m) => m.consultation_id === id && m.id > Number(after || 0)).slice(0, 200).map(({ id: mid, sender, body, created_at }) => ({ id: mid, sender, body, created_at })); }
function addMsg(db, c, sender, body) {
  const b = String(body ?? '').trim();
  if (b.length < 1 || b.length > 1000) throw new PgErr('dados_invalidos', 'mensagem');
  if (db.messages.filter((m) => m.consultation_id === c.id).length >= 500) throw new PgErr('limite_mensagens');
  const m = { id: ++db.seq, consultation_id: c.id, sender, body: b, created_at: iso() };
  db.messages.push(m);
  return m.id;
}

const RPC = {
  tele_doctors_online(db) {
    return [...db.doctors.values()].filter((d) => d.status === 'approved' && d.available_until && Date.parse(d.available_until) > Date.now())
      .sort((a, b) => a.full_name.localeCompare(b.full_name)).slice(0, 50).map(docInfo);
  },
  tele_request(db, a) {
    if ((a.p_alert_flags || []).some((f) => !blank(f))) throw new PgErr('emergencia');
    const ver = String(a.p_consent_version ?? '').trim();
    if (a.p_consent !== true || !ver || ver.length > 40) throw new PgErr('sem_consentimento');
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
    if (ag < 18 && !(other && a.p_guardian_consent)) throw new PgErr('menor_sem_responsavel');
    let req = null; let rel = null;
    if (other) {
      req = String(a.p_requester_name ?? '').replace(/\s+/g, ' ').trim();
      rel = String(a.p_relationship ?? '').replace(/\s+/g, ' ').trim();
      if (req.length < 3 || req.length > 120) throw new PgErr('dados_invalidos', 'responsavel');
      if (rel.length < 2 || rel.length > 60) throw new PgErr('dados_invalidos', 'parentesco');
    }
    const active = [...db.consults.values()].some((c) => c.patient_phone === phone && ['waiting', 'accepted', 'in_call'].includes(c.status));
    if (active) throw new PgErr('ja_na_fila');
    if ([...db.consults.values()].filter((c) => c.status === 'waiting').length >= 30) throw new PgErr('fila_cheia');
    const c = db.addConsult({ token_hash: hash, patient_name: name, patient_birthdate: a.p_birthdate, patient_phone: phone, for_other: other, requester_name: req, relationship: rel,
      guardian_consent: other && !!a.p_guardian_consent, reason, consent_version: ver, consent_at: iso() });
    return c.id;
  },
  tele_status(db, a) {
    const c = byToken(db, a.p_id, a.p_token);
    if (!c) return [];
    const live = ['accepted', 'in_call'].includes(c.status);
    const pos = c.status === 'waiting' ? [...db.consults.values()].filter((w) => w.status === 'waiting' && (w.created_at < c.created_at || (w.created_at === c.created_at && w.id < c.id))).length + 1 : null;
    return [{ status: c.status, position: pos, doctors_online: onlineCount(db), doctor: c.doctor_info, offer_sdp: live ? c.offer_sdp : null, offer_version: c.offer_version,
      answer_version: c.answer_version, exams: c.exams, indication: c.indication, guidance: c.guidance, created_at: c.created_at, accepted_at: c.accepted_at,
      started_at: c.started_at, ended_at: c.ended_at, patient_name: c.patient_name, patient_birthdate: c.patient_birthdate }];
  },
  tele_answer(db, a) {
    const c = byToken(db, a.p_id, a.p_token);
    if (!c) throw new PgErr('nao_encontrado');
    if (!['accepted', 'in_call'].includes(c.status) || !c.offer_sdp) throw new PgErr('estado_invalido');
    if (a.p_version !== c.offer_version) throw new PgErr('versao_antiga');
    sdpOk(a.p_sdp);
    Object.assign(c, { answer_sdp: a.p_sdp, answer_version: a.p_version, status: 'in_call', started_at: c.started_at || iso() });
    return null;
  },
  tele_cancel(db, a) {
    const c = byToken(db, a.p_id, a.p_token);
    if (!c) throw new PgErr('nao_encontrado');
    if (['ended', 'cancelled', 'expired'].includes(c.status)) return null;
    if (!['waiting', 'accepted'].includes(c.status)) throw new PgErr('estado_invalido');
    Object.assign(c, { status: 'cancelled', offer_sdp: null, answer_sdp: null });
    return null;
  },
  tele_patient_send(db, a) {
    const c = byToken(db, a.p_id, a.p_token);
    if (!c) throw new PgErr('nao_encontrado');
    if (!['accepted', 'in_call'].includes(c.status)) throw new PgErr('estado_invalido');
    return addMsg(db, c, 'patient', a.p_body);
  },
  tele_patient_messages(db, a) { const c = byToken(db, a.p_id, a.p_token); return c ? msgs(db, c.id, a.p_after) : []; },

  tele_doctor_me(db, a, uid) {
    const d = docOf(db, uid);
    const f = ['id', 'full_name', 'crm', 'crm_uf', 'rqe', 'specialty', 'phone', 'status', 'review_note', 'reviewed_at', 'available_until', 'created_at', 'updated_at'];
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
    if ([...db.doctors.values()].some((d) => d !== mine && d.crm === crm && d.crm_uf === uf && d.status !== 'rejected')) throw new PgErr('crm_em_uso');
    if (!mine) { db.addDoctor({ user_id: uid, full_name: name, crm, crm_uf: uf, rqe, specialty: spec, phone, status: 'pending', created_at: iso() }); return 'pending'; }
    const changed = [mine.full_name, mine.crm, mine.crm_uf, mine.rqe, mine.specialty].join('|') !== [name, crm, uf, rqe, spec].join('|');
    const st = mine.status === 'rejected' ? 'pending' : mine.status === 'approved' && changed ? 'pending' : mine.status;
    Object.assign(mine, { full_name: name, crm, crm_uf: uf, rqe, specialty: spec, phone, review_note: st === 'pending' && mine.status !== 'pending' ? null : mine.review_note, status: st, available_until: st === 'approved' ? mine.available_until : null, updated_at: iso() });
    return st;
  },
  tele_set_available(db, a, uid) {
    if (a.p_on) { const d = me(db, uid, true); d.available_until = iso(Date.now() + 90e3); return d.available_until; }
    if (!uid) throw new PgErr('sem_login');
    const d = docOf(db, uid); if (d) d.available_until = null;
    return null;
  },
  tele_queue(db, a, uid) {
    const d = me(db, uid, true);
    const all = [...db.consults.values()];
    const own = all.filter((c) => c.doctor_id === d.id && ['accepted', 'in_call'].includes(c.status));
    const wait = all.filter((c) => c.status === 'waiting').sort((x, y) => x.created_at.localeCompare(y.created_at));
    return [...own, ...wait].slice(0, 100).map((c) => ({ id: c.id, status: c.status, patient_name: c.patient_name, age_years: age(c.patient_birthdate), reason: c.reason, for_other: c.for_other,
      relationship: c.relationship, wait_minutes: Math.floor((Date.now() - Date.parse(c.created_at)) / 60000), created_at: c.created_at, accepted_at: c.accepted_at }));
  },
  tele_accept(db, a, uid) {
    const d = me(db, uid, true);
    if ([...db.consults.values()].some((c) => c.doctor_id === d.id && ['accepted', 'in_call'].includes(c.status))) throw new PgErr('consulta_ativa');
    const c = db.consults.get(a.p_id);
    if (!c) throw new PgErr('nao_encontrado');
    if (c.status !== 'waiting') throw new PgErr(['accepted', 'in_call', 'ended'].includes(c.status) ? 'ja_atendida' : 'indisponivel');
    Object.assign(c, { status: 'accepted', doctor_id: d.id, accepted_at: iso(), doctor_info: docInfo(d) });
    const { token_hash, ...rest } = c; // eslint-disable-line no-unused-vars
    return [{ id: c.id, patient_name: c.patient_name, patient_birthdate: c.patient_birthdate, age_years: age(c.patient_birthdate), patient_phone: c.patient_phone, reason: c.reason,
      for_other: c.for_other, requester_name: c.requester_name, relationship: c.relationship, guardian_consent: c.guardian_consent, consent_version: c.consent_version,
      consent_at: c.consent_at, created_at: c.created_at, accepted_at: c.accepted_at }];
  },
  tele_offer(db, a, uid) {
    const d = me(db, uid, true);
    const c = db.consults.get(a.p_id);
    if (!c || c.doctor_id !== d.id) throw new PgErr('nao_encontrado');
    if (!['accepted', 'in_call'].includes(c.status)) throw new PgErr('estado_invalido');
    sdpOk(a.p_sdp);
    Object.assign(c, { offer_sdp: a.p_sdp, offer_version: c.offer_version + 1, answer_sdp: null });
    return c.offer_version;
  },
  tele_doctor_status(db, a, uid) {
    const c = db.consults.get(a.p_id);
    const d = docOf(db, uid);
    if (!c || !uid || !((d && c.doctor_id === d.id) || db.admins.has(uid))) return [];
    return [{ id: c.id, status: c.status, offer_version: c.offer_version, answer_version: c.answer_version, answer_sdp: ['accepted', 'in_call'].includes(c.status) ? c.answer_sdp : null,
      created_at: c.created_at, accepted_at: c.accepted_at, started_at: c.started_at, ended_at: c.ended_at, patient_name: c.patient_name, patient_birthdate: c.patient_birthdate,
      age_years: age(c.patient_birthdate), patient_phone: c.patient_phone, reason: c.reason, for_other: c.for_other, requester_name: c.requester_name, relationship: c.relationship,
      guardian_consent: c.guardian_consent, consent_version: c.consent_version, consent_at: c.consent_at, exams: c.exams, indication: c.indication, guidance: c.guidance,
      notes: c.notes, doctor: c.doctor_info }];
  },
  tele_set_exams(db, a, uid) {
    const d = me(db, uid, true);
    const c = db.consults.get(a.p_id);
    if (!c || c.doctor_id !== d.id) throw new PgErr('nao_encontrado');
    if (c.status === 'ended') { if (Date.now() - Date.parse(c.ended_at) > 24 * 3600e3) throw new PgErr('prazo_encerrado'); } else if (!['accepted', 'in_call'].includes(c.status)) throw new PgErr('estado_invalido');
    const ex = a.p_exams;
    if (!Array.isArray(ex) || ex.length > 60) throw new PgErr('dados_invalidos', 'exames');
    for (const e of ex) {
      const ok = e && typeof e === 'object' && typeof e.name === 'string' && e.name.trim().length >= 1 && e.name.trim().length <= 120 && String(e.note ?? '').length <= 200
        && String(e.code ?? '').length <= 60 && String(e.group ?? '').length <= 60 && String(e.search ?? '').length <= 20;
      if (!ok) throw new PgErr('dados_invalidos', 'exames');
    }
    const ind = String(a.p_indication ?? '').trim() || null;
    if (ind && ind.length > 1000) throw new PgErr('dados_invalidos', 'indicacao');
    const nz = (v) => (String(v ?? '').trim() || null);
    c.exams = ex.map((e) => ({ code: nz(e.code), name: e.name.trim(), group: nz(e.group), search: ['rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab'].includes(e.search) ? e.search : null, note: nz(e.note) }));
    c.indication = ind;
    return c.exams.length;
  },
  tele_end(db, a, uid) {
    const d = me(db, uid, false);
    const notes = String(a.p_notes ?? '').trim() || null;
    const guid = String(a.p_guidance ?? '').trim() || null;
    if (notes && notes.length > 20000) throw new PgErr('dados_invalidos', 'notas');
    if (guid && guid.length > 4000) throw new PgErr('dados_invalidos', 'orientacoes');
    const c = db.consults.get(a.p_id);
    if (!c || c.doctor_id !== d.id) throw new PgErr('nao_encontrado');
    if (c.status === 'ended') {
      if (Date.now() - Date.parse(c.ended_at) > 24 * 3600e3) throw new PgErr('prazo_encerrado');
      if (notes && notes !== c.notes) c.notes = c.notes ? `${c.notes}\n\n[Adendo 30/10/2026 12:00] ${notes}` : notes;
      if (guid) c.guidance = guid;
      return null;
    }
    if (!(['accepted', 'in_call'].includes(c.status) || (c.status === 'expired' && c.accepted_at))) throw new PgErr('estado_invalido');
    Object.assign(c, { status: 'ended', ended_at: iso(), offer_sdp: null, answer_sdp: null, notes, guidance: guid });
    return null;
  },
  tele_doctor_send(db, a, uid) {
    const d = me(db, uid, true);
    const c = db.consults.get(a.p_id);
    if (!c || c.doctor_id !== d.id) throw new PgErr('nao_encontrado');
    if (!['accepted', 'in_call'].includes(c.status)) throw new PgErr('estado_invalido');
    const id = addMsg(db, c, 'doctor', a.p_body);
    if (!c.started_at) c.started_at = iso();
    return id;
  },
  tele_doctor_messages(db, a, uid) {
    const c = db.consults.get(a.p_id);
    const d = docOf(db, uid);
    if (!c || !uid || !((d && c.doctor_id === d.id) || db.admins.has(uid))) return [];
    return msgs(db, c.id, a.p_after);
  },
  tele_history(db, a, uid) {
    const d = docOf(db, uid);
    if (!d) return [];
    return [...db.consults.values()].filter((c) => c.doctor_id === d.id && ['ended', 'cancelled', 'expired'].includes(c.status))
      .sort((x, y) => String(y.ended_at || y.accepted_at).localeCompare(String(x.ended_at || x.accepted_at))).slice(0, 100)
      .map((c) => ({ id: c.id, status: c.status, patient_name: c.patient_name, patient_birthdate: c.patient_birthdate, patient_phone: c.patient_phone, reason: c.reason, for_other: c.for_other,
        requester_name: c.requester_name, relationship: c.relationship, created_at: c.created_at, accepted_at: c.accepted_at, started_at: c.started_at, ended_at: c.ended_at,
        exams: c.exams, indication: c.indication, guidance: c.guidance, notes: c.notes }));
  },
  tele_admin_doctors(db, a, uid) {
    if (!db.admins.has(uid)) throw new PgErr('so_admin');
    const emails = Object.fromEntries(Object.values(USERS).map((u) => [u.id, u.email]));
    const list = [...db.doctors.values()];
    const pend = list.filter((d) => d.status === 'pending').sort((x, y) => x.created_at.localeCompare(y.created_at));
    const rest = list.filter((d) => d.status !== 'pending').sort((x, y) => y.created_at.localeCompare(x.created_at));
    return [...pend, ...rest].map((d) => ({ ...d, email: emails[d.user_id] || null, consultations: [...db.consults.values()].filter((c) => c.doctor_id === d.id).length }));
  },
  tele_admin_set_doctor(db, a, uid) {
    if (!db.admins.has(uid)) throw new PgErr('so_admin');
    if (!['approved', 'rejected', 'suspended'].includes(a.p_status)) throw new PgErr('dados_invalidos', 'status');
    const d = db.doctors.get(a.p_doctor);
    if (!d) throw new PgErr('nao_encontrado');
    Object.assign(d, { status: a.p_status, reviewed_at: iso(), reviewed_by: Object.values(USERS).find((u) => u.id === uid).email, review_note: String(a.p_note ?? '').trim().slice(0, 300) || null,
      available_until: a.p_status === 'approved' ? d.available_until : null, updated_at: iso() });
    return d.status;
  },
};

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body), headers: cors });

/* ======================= páginas ======================= */
async function newPage(browser, db, { mobile = false, planBMs = 25000, rtcFail = false, failRpc = null } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block', permissions: ['camera', 'microphone'],
  });
  await context.addInitScript(() => {
    try { localStorage.setItem('imed_lgpd', '1'); } catch { /* ignora */ }
    window.__printed = 0;
    window.print = () => { window.__printed += 1; };
  });
  if (rtcFail) {
    // RTCPeerConnection que não consegue responder: o vídeo nunca sobe neste aparelho.
    await context.addInitScript(() => {
      const Orig = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Orig { createAnswer() { return Promise.reject(new DOMException('falha simulada', 'OperationError')); } };
    });
  }
  // Configuração do site com a teleconsulta só pela máquina (sem STUN) e plano B mais rápido.
  await context.route(`${BASE}assets/js/config.js`, async (route) => {
    const src = await readFile(join(ROOT, 'assets/js/config.js'), 'utf8');
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: `${src}\nwindow.IMED_CONFIG.tele = ${JSON.stringify({ iceServers: [], planBMs, gatherMs: 1500 })};\n` });
  });
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    const auth = (req.headers().authorization || '').replace(/^Bearer /, '');
    if (u.pathname === '/auth/v1/user') return USERS[auth] ? json(route, USERS[auth]) : json(route, { msg: 'invalid' }, 401);
    if (u.pathname === '/auth/v1/otp') { db.otp.push({ body: JSON.parse(req.postData() || '{}'), redirect: u.searchParams.get('redirect_to') }); return json(route, {}); }
    if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname === '/rest/v1/app_waitlist') { db.waitlist.push({ body: JSON.parse(req.postData() || '{}'), auth }); return route.fulfill({ status: 201, body: '', headers: cors }); }
    const m = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (!m || !RPC[m[1]]) return json(route, { message: 'não simulado' }, 404);
    const fn = m[1];
    const args = JSON.parse(req.postData() || '{}');
    const uid = USERS[auth]?.id || null;
    db.calls.push({ fn, args, uid });
    if (failRpc && failRpc(fn, args)) return json(route, { code: 'XX000', message: 'falha simulada' }, 500);
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
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); } };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const noOverflow = async (page, where) => { const o = await overflow(page); assert.ok(o <= 0, `${where}: sem rolagem lateral (${o}px)`); };
const results = [];
async function scenario(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push(['ok', name]); console.log(`ok - ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 6).join('\n  ')}`); }
}
const visible = (page, sel, timeout = 15000) => page.waitForSelector(sel, { state: 'visible', timeout });
const text = (page, sel) => page.locator(sel).innerText();
const BIRTH_ADULT = '1980-05-17';
const birthYearsAgo = (n) => { const [y, m, d] = todaySP().split('-'); return `${Number(y) - n}-${m}-${d === '29' && m === '02' ? '28' : d}`; };

// Preenche o pedido do paciente (sem enviar).
async function fillRequest(page, { name = 'Ana Teste', birth = BIRTH_ADULT, phone = '11987654321', reason = 'Dor de garganta há 3 dias', none = true, consent = true } = {}) {
  await page.fill('#fName', name);
  await page.fill('#fBirth', birth);
  await page.fill('#fPhone', phone);
  await page.fill('#fReason', reason);
  if (none) await page.check('#fNone');
  if (consent) await page.check('#fConsent');
}
// Médico aprovado entra, aceita o aviso e fica disponível.
async function doctorOnDuty(page, tok = 'tok-doc') {
  await page.goto(loginUrl(tok));
  await visible(page, '#noticeCard');
  await page.click('#noticeBtn');
  assert.match(await text(page, '#noticeErr'), /marque que leu/);
  await page.check('#noticeOk');
  await page.click('#noticeBtn');
  await visible(page, '#dutyCard');
  await page.click('#availBtn');
  await page.waitForSelector('#availBtn[aria-checked="true"]');
}
const videoReady = (page, sel) => page.waitForFunction((s) => { const v = document.querySelector(s); return v && v.videoWidth > 0 && v.readyState >= 2; }, sel, { timeout: 30000 });

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns'],
});

/* ======================= cenários ======================= */
await scenario('sem médico atendendo: texto honesto, lista de espera e fila "mesmo assim"', async () => {
  const db = makeDb();
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(`${BASE}teleconsulta.html`);
  await visible(page, '#noDoc');
  assert.match(await text(page, '#docs'), /Nenhum médico atendendo agora/);
  assert.equal(await page.isVisible('#formCard'), false, 'sem médico, o pedido fica escondido');
  assert.match(await text(page, '.tl-sos'), /Emergência\? Ligue 192 \(SAMU\)/);
  assert.equal(await page.getAttribute('.tl-sos a', 'href'), 'tel:192');
  await page.fill('#wlEmail', 'nao-e-email');
  await page.click('#wlBtn');
  assert.match(await text(page, '#wlMsg'), /e-mail válido/);
  await page.fill('#wlEmail', 'Maria@Exemplo.com');
  await page.fill('#wlCity', 'Recife');
  await page.click('#wlBtn');
  await page.waitForSelector('#wlMsg.ok');
  assert.deepEqual(db.waitlist.map((w) => w.body), [{ email: 'maria@exemplo.com', city: 'Recife', interest: 'teleconsulta' }]);
  assert.ok(db.waitlist[0].auth.startsWith('eyJ'), 'lista de espera com a chave pública (como na página inicial)');
  await shot(page, 'tele-01-sem-medico');
  await page.click('#anywayBtn');
  await visible(page, '#formCard');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'formTitle');
  assert.equal(db.called('tele_request').length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('médico novo: cadastro fica em análise e não vê a fila', async () => {
  const db = makeDb();
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(`${BASE}medico.html`);
  await visible(page, '#loginEmail');
  await page.fill('#loginEmail', 'Bia@Exemplo.com');
  await page.click('#loginBtn');
  await page.waitForSelector('#loginMsg.ok');
  assert.equal(db.otp[0].body.email, 'bia@exemplo.com');
  assert.equal(db.otp[0].redirect, `${BASE}medico.html`);
  // O link do e-mail abre a página de novo (navegação nova, não só troca de #).
  await page.goto('about:blank');
  await page.goto(loginUrl('tok-new'));
  await visible(page, '#regCard');
  assert.match(await text(page, '#authBox'), /bia@exemplo\.com/);
  await page.fill('#rName', 'Bia');
  await page.fill('#rCrm', '0');
  await page.fill('#rSpec', 'Pediatria');
  await page.click('#regBtn');
  assert.match(await text(page, '#erName'), /nome completo/);
  assert.match(await text(page, '#erCrm'), /CRM/);
  assert.match(await text(page, '#erUf'), /estado/);
  assert.match(await text(page, '#erRqe'), /RQE/);
  assert.equal(db.called('tele_doctor_register').length, 0);
  await page.fill('#rName', 'Beatriz  Souza');
  await page.fill('#rCrm', '0098765');
  await page.selectOption('#rUf', 'PE');
  await page.fill('#rRqe', '4321');
  await page.fill('#rPhone', '81999998888');
  await page.click('#regBtn');
  await visible(page, '#meCard');
  assert.deepEqual(db.called('tele_doctor_register')[0].args, { p_full_name: 'Beatriz Souza', p_crm: '98765', p_crm_uf: 'PE', p_rqe: '4321', p_specialty: 'Pediatria', p_phone: '81999998888' });
  assert.match(await text(page, '#meBox'), /Beatriz Souza/);
  assert.match(await text(page, '#meBox'), /CRM-PE 98765 · Pediatria · RQE 4321/);
  assert.match(await text(page, '#meBox'), /Em análise/);
  await page.waitForTimeout(600);
  assert.equal(await page.isVisible('#dutyCard'), false, 'pendente não vê a fila');
  assert.equal(await page.isVisible('#noticeCard'), false);
  assert.equal(db.called('tele_queue').length, 0, 'pendente nem pede a fila');
  assert.equal(await page.isVisible('#adminCard'), false, 'médico comum não vê a área da equipe');
  await shot(page, 'tele-02-medico-pendente');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('equipe do IMED aprova o médico (com link do CFM) e ele passa a ver a fila', async () => {
  const db = makeDb();
  const pend = db.addDoctor({ user_id: 'u-new', full_name: 'Beatriz Souza', crm: '98765', crm_uf: 'PE', status: 'pending', created_at: iso() });
  db.addDoctor({ user_id: 'u-admin', full_name: 'Rafael Pereira Barreto Silva', crm: '266930', crm_uf: 'SP' });
  db.addConsult({ token_hash: sha('x'), patient_name: 'Paciente Esperando', reason: 'Febre' });
  const adm = await newPage(browser, db);
  await adm.page.goto(loginUrl('tok-admin'));
  await visible(adm.page, '#adminCard');
  await adm.page.waitForSelector(`[data-doc="${pend.id}"]`);
  const card = adm.page.locator(`[data-doc="${pend.id}"]`);
  assert.match(await card.innerText(), /Beatriz Souza/);
  assert.match(await card.innerText(), /CRM-PE 98765/);
  assert.match(await card.innerText(), /bia@exemplo\.com/);
  assert.match(await card.innerText(), /Em análise/);
  assert.match(await card.innerText(), /CRM 98765\/PE/);
  assert.equal(await card.locator('a[href="https://portal.cfm.org.br/busca-medicos/"]').count(), 1, 'link para conferir no CFM');
  assert.match(await text(adm.page, '#admin'), /1 cadastro esperando análise/);
  await card.locator(`#note-${pend.id}`).fill('CRM conferido no CFM em 30/10');
  await card.locator('[data-set="approved"]').click();
  await adm.page.waitForFunction((id) => /Aprovado/.test(document.querySelector(`[data-doc="${id}"]`)?.innerText || ''), pend.id);
  assert.deepEqual(db.called('tele_admin_set_doctor')[0].args, { p_doctor: pend.id, p_status: 'approved', p_note: 'CRM conferido no CFM em 30/10' });
  assert.equal(db.doctors.get(pend.id).status, 'approved');
  await shot(adm.page, 'tele-03-admin');
  assert.deepEqual(adm.errors, []);
  await adm.context.close();

  const doc = await newPage(browser, db);
  await doc.page.goto(loginUrl('tok-new'));
  await visible(doc.page, '#noticeCard');
  assert.match(await text(doc.page, '#meBox'), /Aprovado/);
  assert.match(await text(doc.page, '#meBox'), /CRM conferido no CFM/);
  assert.match(await text(doc.page, '#noticeCard'), /ICP-Brasil/);
  assert.match(await text(doc.page, '#noticeCard'), /NGS2/);
  assert.match(await text(doc.page, '#noticeCard'), /ainda está sendo confirmada/);
  await doc.page.check('#noticeOk');
  await doc.page.click('#noticeBtn');
  await doc.page.waitForSelector('#queue .md-q');
  assert.match(await text(doc.page, '#queue'), /Paciente Esperando/);
  assert.equal(await doc.page.locator('#queue [data-accept]').count(), 1);
  // O aceite do aviso fica neste aparelho: ao voltar, vai direto para a fila.
  await doc.page.reload();
  await visible(doc.page, '#dutyCard');
  assert.equal(await doc.page.isVisible('#noticeCard'), false);
  assert.deepEqual(doc.errors, []);
  await doc.context.close();
});

await scenario('consulta completa: fila, vídeo nos dois lados, mensagens, exames, encerramento e documento', async () => {
  const db = makeDb();
  const carla = db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', rqe: '7788', specialty: 'Clínica médica', phone: '11911112222' });
  const doc = await newPage(browser, db);
  await doctorOnDuty(doc.page);
  assert.ok(db.called('tele_set_available').some((c) => c.args.p_on === true));
  assert.ok(Date.parse(carla.available_until) > Date.now());
  assert.match(await text(doc.page, '#queue'), /Ninguém na fila agora/);

  const pat = await newPage(browser, db);
  await pat.page.goto(`${BASE}teleconsulta.html`);
  await pat.page.waitForSelector('#docs .tl-doclist');
  assert.match(await text(pat.page, '#docs'), /1 médico atendendo agora/);
  assert.match(await text(pat.page, '#docs'), /Carla Mendes/);
  assert.match(await text(pat.page, '#docs'), /CRM-SP 123456 · Clínica médica · RQE 7788/);
  await visible(pat.page, '#formCard');
  await shot(pat.page, 'tele-04-paciente-inicio');
  await fillRequest(pat.page, { name: 'Ana <b>Negrito</b> Silva', reason: 'Tosse <img src=x onerror="window.__xss=1"> há 5 dias' });
  await pat.page.click('#goBtn');
  await visible(pat.page, '#vWait');
  assert.equal(await text(pat.page, '#posNum'), '1º');
  assert.match(await text(pat.page, '#posText'), /Você é o próximo da fila/);
  assert.match(await text(pat.page, '#waitDocs'), /Há 1 médico atendendo agora/);
  const req = db.called('tele_request')[0].args;
  assert.equal(req.p_patient_name, 'Ana <b>Negrito</b> Silva');
  assert.equal(req.p_consent, true);
  assert.equal(req.p_consent_version, '2026-10-30');
  assert.deepEqual(req.p_alert_flags, []);
  assert.match(req.p_token_hash, /^[0-9a-f]{64}$/);
  const saved = await pat.page.evaluate(() => JSON.parse(localStorage.getItem('imed_tele')));
  assert.match(saved.token, /^[0-9a-f]{64}$/);
  assert.equal(sha(saved.token), req.p_token_hash, 'o banco recebe só o SHA-256 do código');
  const consult = db.consults.get(saved.id);
  assert.ok(consult, 'consulta criada com o id guardado no aparelho');
  await shot(pat.page, 'tele-05-paciente-fila');

  // Médico vê o paciente na fila (texto escapado) e atende.
  await doc.page.waitForSelector('#queue [data-accept]', { timeout: 15000 });
  assert.match(await text(doc.page, '#queue'), /Ana <b>Negrito<\/b> Silva/);
  assert.equal(await doc.page.evaluate(() => [...document.querySelectorAll('#queue b')].some((b) => b.textContent === 'Negrito')), false, 'nome com HTML não vira negrito');
  assert.equal(await doc.page.locator('#queue img').count(), 0, 'motivo com HTML não vira imagem');
  await shot(doc.page, 'tele-06-medico-fila');
  await doc.page.click('#queue [data-accept]');
  await visible(doc.page, '#consult');
  assert.match(await text(doc.page, '#cTitle'), /Consulta com Ana <b>Negrito<\/b> Silva/);
  assert.match(await text(doc.page, '#cPatBox'), /\(11\) 98765-4321/);
  assert.equal(await doc.page.locator('#cPatBox a[href="tel:+5511987654321"]').count(), 2, 'telefone com botão de ligar');
  assert.match(await text(doc.page, '#cPatBox'), /Versão 2026-10-30/);

  // Vídeo conecta de verdade nos dois lados.
  await visible(pat.page, '#vCall', 20000);
  assert.match(await text(pat.page, '#callDoctor'), /Carla Mendes/);
  assert.match(await text(pat.page, '#callDoctor'), /CRM-SP 123456/);
  await videoReady(pat.page, '#remoteVideo');
  await videoReady(doc.page, '#cRemote');
  await pat.page.waitForFunction(() => /Vídeo conectado/.test(document.querySelector('#callState').textContent));
  await doc.page.waitForFunction(() => /Vídeo conectado/.test(document.querySelector('#cState').textContent));
  assert.ok(await pat.page.evaluate(() => document.querySelector('#localVideo').videoWidth > 0), 'paciente vê a própria imagem');
  assert.equal(consult.status, 'in_call');
  assert.equal(consult.offer_version, 1);
  assert.equal(consult.answer_version, 1);
  assert.equal(await pat.page.isVisible('#planB'), false);
  assert.equal(await doc.page.isVisible('#cPlanB'), false);
  // Microfone: desliga e liga.
  await pat.page.click('#micBtn');
  assert.match(await text(pat.page, '#micBtn'), /Ligar microfone/);
  assert.equal(await pat.page.evaluate(() => document.querySelector('#localVideo').srcObject.getAudioTracks()[0].enabled), false);
  await pat.page.click('#micBtn');
  assert.match(await text(pat.page, '#micBtn'), /Desligar microfone/);
  await shot(pat.page, 'tele-07-paciente-video');

  // Mensagens nos dois sentidos.
  await pat.page.fill('#chatText', 'Olá, doutora. Estou ouvindo bem.');
  await pat.page.click('#chatBtn');
  await doc.page.waitForFunction(() => /Estou ouvindo bem/.test(document.querySelector('#cMsgs').textContent), null, { timeout: 15000 });
  await doc.page.fill('#cChatText', 'Ótimo! Vou pedir alguns exames.');
  await doc.page.press('#cChatText', 'Enter');
  await pat.page.waitForFunction(() => /Vou pedir alguns exames/.test(document.querySelector('#chatList').textContent), null, { timeout: 15000 });
  assert.match(await text(pat.page, '#chatList'), /Médico/);
  await doc.page.waitForSelector('#cMsgs .tl-bub.me');
  for (const [pg, sel] of [[doc.page, '#cMsgs .tl-bub.me'], [doc.page, '#cMsgs .tl-bub.doc'], [pat.page, '#chatList .tl-bub.me'], [pat.page, '#chatList .tl-bub.doc']]) {
    const w = await pg.$eval(sel, (e) => e.getBoundingClientRect().width);
    assert.ok(w > 120, `bolha de mensagem com largura de texto (${sel}: ${w}px)`);
  }

  // Exames: busca no catálogo, observação, outro exame e indicação.
  await doc.page.fill('#exSearch', 'hemograma');
  await doc.page.check('#exCatalog input[data-ex="hemograma"]');
  await doc.page.fill('#exSearch', 'TORAX');
  assert.match(await text(doc.page, '#exHits'), /exame/);
  await doc.page.check('#exCatalog input[data-ex="rx_torax"]');
  await doc.page.fill('#exSearch', 'eletrocardiograma');
  await doc.page.check('#exCatalog input[data-ex="ecg"]');
  await doc.page.fill('#exSearch', 'xyzzy');
  await visible(doc.page, '#exNone');
  await doc.page.fill('#exSearch', '');
  await doc.page.fill('[data-note="rx_torax"]', 'PA e perfil');
  await doc.page.fill('#exOther', 'Cintilografia óssea');
  await doc.page.click('#exOtherAdd');
  assert.equal(await text(doc.page, '#exCount'), '4');
  assert.match(await text(doc.page, '#exMsg'), /Ainda não enviado/);
  await doc.page.fill('#exInd', 'Tosse persistente, investigar.');
  await shot(doc.page, 'tele-08-medico-exames');
  await doc.page.click('#exSend');
  await doc.page.waitForSelector('#exMsg.ok');
  assert.match(await text(doc.page, '#exMsg'), /4 exames enviados/);
  assert.deepEqual(consult.exams.map((e) => [e.code, e.search, e.note]), [['hemograma', 'lab', null], ['rx_torax', 'rx', 'PA e perfil'], ['ecg', 'ecg', null], ['outro', null, null]]);
  assert.equal(consult.indication, 'Tosse persistente, investigar.');

  // Paciente vê os exames com "Onde fazer perto de você".
  await visible(pat.page, '#callExams', 15000);
  const hrefs = await pat.page.locator('#callExams a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  for (const h of ['perto.html?exame=lab', 'perto.html?exame=rx', 'perto.html?exame=ecg', 'exames/raio-x.html#preparo', 'exames/eletrocardiograma.html#preparo', 'perto.html']) {
    assert.ok(hrefs.includes(h), `link ${h}`);
  }
  assert.match(await text(pat.page, '#callExams'), /Cintilografia óssea/);
  assert.match(await text(pat.page, '#callExams'), /PA e perfil/);
  assert.match(await text(pat.page, '#callExams'), /ICP-Brasil/);
  await shot(pat.page, 'tele-09-paciente-exames');

  // Orientações, prontuário e encerramento.
  await doc.page.fill('#cGuide', 'Beber bastante água.\nVoltar se tiver febre alta.');
  await doc.page.click('#cTpl');
  assert.match(await doc.page.inputValue('#cNotes'), /^Motivo:/);
  await doc.page.fill('#cNotes', 'Motivo: tosse.\nConduta: exames e retorno.');
  await doc.page.click('#cEnd');
  await visible(doc.page, '#cEndConfirm');
  await doc.page.click('#cEndYes');
  await visible(doc.page, '#dutyCard');
  assert.match(await text(doc.page, '#flash'), /encerrada/);
  assert.deepEqual(db.called('tele_end')[0].args, { p_id: consult.id, p_notes: 'Motivo: tosse.\nConduta: exames e retorno.', p_guidance: 'Beber bastante água.\nVoltar se tiver febre alta.' });
  assert.equal(consult.status, 'ended');
  assert.equal(consult.offer_sdp, null);
  assert.equal(consult.answer_sdp, null);
  assert.equal(await doc.page.evaluate(() => document.querySelector('#cRemote').srcObject), null, 'vídeo desligado no médico');

  // Resumo do paciente e documento para imprimir.
  await visible(pat.page, '#vEnd', 15000);
  assert.match(await text(pat.page, '#endDoctor'), /Carla Mendes/);
  assert.match(await text(pat.page, '#endDoctor'), /CRM-SP 123456/);
  assert.match(await text(pat.page, '#endGuide'), /Beber bastante água/);
  assert.match(await text(pat.page, '#endExams'), /Hemograma completo/);
  assert.equal(await pat.page.evaluate(() => document.querySelector('#remoteVideo').srcObject), null, 'vídeo desligado no paciente');
  assert.equal(await pat.page.evaluate(() => document.querySelector('#localVideo').srcObject), null, 'câmera desligada no paciente');
  await shot(pat.page, 'tele-10-paciente-resumo');
  await pat.page.click('#endExams [data-print]');
  assert.equal(await pat.page.evaluate(() => window.__printed), 1);
  const docText = await text(pat.page, '#printDoc');
  for (const s of ['Solicitação de exames', 'Emitida em teleconsulta (telemedicina)', 'Ana <b>Negrito</b> Silva', '17/05/1980', 'Carla Mendes', 'CRM-SP 123456', 'Clínica médica · RQE 7788',
    'Tosse persistente, investigar.', 'Hemograma completo', 'Raio-X de tórax (PA e perfil) — PA e perfil', 'Cintilografia óssea', 'ICP-Brasil']) {
    assert.ok(docText.includes(s), `documento: ${s}`);
  }
  assert.equal(await pat.page.evaluate(() => [...document.querySelectorAll('#printDoc b')].some((b) => b.textContent === 'Negrito')), false, 'nome escapado no documento');
  await pat.page.emulateMedia({ media: 'print' });
  assert.equal(await pat.page.isVisible('#printDoc'), true, 'só a folha aparece na impressão');
  assert.equal(await pat.page.isVisible('main'), false);
  await shot(pat.page, 'tele-11-documento-impressao');
  await pat.page.emulateMedia({ media: 'screen' });
  assert.equal(await pat.page.evaluate(() => window.__xss), undefined, 'nenhum HTML do paciente rodou');

  // Recarregar a página mostra o resumo de novo; "Nova teleconsulta" guarda no histórico do aparelho.
  await pat.page.reload();
  await visible(pat.page, '#vEnd');
  await pat.page.click('#newBtn');
  await visible(pat.page, '#vStart');
  assert.equal(await pat.page.evaluate(() => localStorage.getItem('imed_tele')), null);
  await visible(pat.page, '#histCard');
  assert.match(await text(pat.page, '#histList'), /Carla Mendes/);
  await pat.page.click('#histList [data-hist]');
  await visible(pat.page, '#vEnd');
  assert.match(await text(pat.page, '#endExams'), /Cintilografia óssea/);
  await pat.page.click('#backBtn');
  await visible(pat.page, '#vStart');

  // Histórico do médico com o registro.
  await doc.page.waitForSelector('#hist .md-h');
  assert.match(await text(doc.page, '#hist'), /Ana <b>Negrito<\/b> Silva/);
  await doc.page.click('#hist summary');
  assert.match(await text(doc.page, '#hist'), /Conduta: exames e retorno/);
  // Complemento em até 24 h: adendo ao registro.
  await doc.page.click('#hist [data-amend]');
  await visible(doc.page, '#consult');
  assert.match(await text(doc.page, '#cTitle'), /Complementar/);
  assert.equal(await doc.page.isVisible('#cVideoCard'), false, 'sem vídeo no complemento');
  assert.match(await text(doc.page, '#cOldNotes'), /Conduta: exames e retorno/);
  await doc.page.fill('#cNotes', 'Paciente ligou de volta: sem febre.');
  await doc.page.click('#cEnd');
  await visible(doc.page, '#dutyCard');
  assert.equal(db.called('tele_end').at(-1).args.p_notes, 'Paciente ligou de volta: sem febre.');
  assert.match(consult.notes, /\[Adendo .*\] Paciente ligou de volta: sem febre\./);

  // Desligar "disponível" ao sair.
  await doc.page.click('#availBtn');
  await doc.page.waitForSelector('#availBtn[aria-checked="false"]');
  assert.equal(carla.available_until, null);
  assert.deepEqual(pat.errors, []);
  assert.deepEqual(doc.errors, []);
  await pat.context.close();
  await doc.context.close();
});

const waitFor = async (fn, ms = 20000, what = 'condição') => {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error(`tempo esgotado esperando: ${what}`); await new Promise((r) => setTimeout(r, 100)); }
};
await scenario('recarregar no meio da chamada: paciente e médico voltam ao vídeo; outra aba não atrapalha', async () => {
  const db = makeDb();
  const carla = db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP' });
  const doc = await newPage(browser, db);
  await doctorOnDuty(doc.page);
  const pat = await newPage(browser, db);
  await pat.page.goto(`${BASE}teleconsulta.html`);
  await visible(pat.page, '#formCard');
  await fillRequest(pat.page, { name: 'Paciente Recarrega' });
  await pat.page.click('#goBtn');
  await visible(pat.page, '#vWait');
  await doc.page.waitForSelector('#queue [data-accept]', { timeout: 15000 });
  await doc.page.click('#queue [data-accept]');
  await videoReady(pat.page, '#remoteVideo');
  await videoReady(doc.page, '#cRemote');
  const c = [...db.consults.values()][0];
  assert.equal(c.offer_version, 1);

  // O paciente recarrega: responde de novo, o médico refaz a oferta e o vídeo volta.
  await pat.page.reload();
  await visible(pat.page, '#vCall', 15000);
  await waitFor(() => c.offer_version >= 2, 20000, 'nova oferta depois de o paciente recarregar');
  await videoReady(pat.page, '#remoteVideo');
  await pat.page.waitForFunction(() => /Vídeo conectado/.test(document.querySelector('#callState').textContent), null, { timeout: 20000 });
  await doc.page.waitForFunction(() => /Vídeo conectado/.test(document.querySelector('#cState').textContent), null, { timeout: 20000 });
  await videoReady(doc.page, '#cRemote');

  // Outra aba com a mesma consulta: avisa e não mexe no vídeo.
  const tab2 = await pat.context.newPage();
  const tabErrors = [];
  tab2.on('pageerror', (e) => tabErrors.push(e.message));
  tab2.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) tabErrors.push(m.text()); });
  await tab2.goto(`${BASE}teleconsulta.html`);
  await visible(tab2, '#otherTab', 15000);
  assert.equal(await tab2.isVisible('#stage'), false);
  const v = c.offer_version;
  await tab2.waitForTimeout(5000);
  assert.equal(c.offer_version, v, 'a segunda aba não faz o vídeo recomeçar');
  assert.equal(await tab2.isVisible('#planB'), false);
  await tab2.close();
  assert.deepEqual(tabErrors, []);

  // O médico recarrega: continua disponível, volta para a consulta e o vídeo volta.
  await doc.page.reload();
  // Durante a consulta a fila (com o botão) fica escondida; o botão continua ligado.
  await doc.page.waitForSelector('#availBtn[aria-checked="true"]', { state: 'attached', timeout: 15000 });
  await visible(doc.page, '#consult', 20000);
  await waitFor(() => c.offer_version >= v + 1, 20000, 'nova oferta depois de o médico recarregar');
  await videoReady(doc.page, '#cRemote');
  await doc.page.waitForFunction(() => /Vídeo conectado/.test(document.querySelector('#cState').textContent), null, { timeout: 20000 });
  await pat.page.waitForFunction(() => /Vídeo conectado/.test(document.querySelector('#callState').textContent), null, { timeout: 20000 });
  assert.ok(Date.parse(carla.available_until) > Date.now(), 'disponível de novo depois de recarregar');
  assert.ok(c.offer_version <= v + 2, `sem recomeçar sem parar (versão ${c.offer_version})`);
  await doc.page.click('#cEnd');
  await doc.page.click('#cEndYes');
  await visible(pat.page, '#vEnd', 15000);
  assert.deepEqual(pat.errors, []);
  assert.deepEqual(doc.errors, []);
  await pat.context.close();
  await doc.context.close();
});

await scenario('sinais de alerta bloqueiam a fila (192 e, se for o caso, CVV 188)', async () => {
  const db = makeDb();
  db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', available_until: iso(Date.now() + 3600e3) });
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(`${BASE}teleconsulta.html`);
  await visible(page, '#formCard');
  await fillRequest(page, { none: false });
  await page.check('input[name="alert"][value="peito"]');
  await visible(page, '#sosBox');
  assert.match(await text(page, '#sosBox'), /192 \(SAMU\)/);
  assert.equal(await page.isVisible('#sosCvv'), false);
  assert.equal(await page.isDisabled('#goBtn'), true, 'não dá para entrar na fila');
  await page.check('input[name="alert"][value="machucar"]');
  await visible(page, '#sosCvv');
  assert.match(await text(page, '#sosBox'), /188 \(CVV\)/);
  assert.equal(await page.getAttribute('#sosCvvBtn', 'href'), 'tel:188');
  await shot(page, 'tele-12-alerta');
  await page.locator('#goBtn').dispatchEvent('click');
  await page.evaluate(() => document.querySelector('#reqForm').requestSubmit());
  assert.equal(db.called('tele_request').length, 0, 'pedido não enviado');
  // "Nenhum destes" desmarca os sinais e libera o envio.
  await page.check('#fNone');
  assert.equal(await page.isVisible('#sosBox'), false);
  assert.equal(await page.isChecked('input[name="alert"][value="peito"]'), false);
  assert.equal(await page.isDisabled('#goBtn'), false);
  // Sem responder sobre os sinais: pede a resposta.
  await page.uncheck('#fNone');
  await page.click('#goBtn');
  assert.match(await text(page, '#eAlerts'), /Responda/);
  // O banco também recusa (se o envio for forçado com sinal marcado).
  await page.check('#fNone');
  await page.route(`${SUPA}/rest/v1/rpc/tele_request`, (route) => route.fulfill({ status: 400, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ code: 'P0001', message: 'emergencia', details: null }) }));
  await page.click('#goBtn');
  await visible(page, '#sosBox');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('menor de 18 anos: só com o responsável presente', async () => {
  const db = makeDb();
  db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', available_until: iso(Date.now() + 3600e3) });
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(`${BASE}teleconsulta.html`);
  await visible(page, '#formCard');
  await fillRequest(page, { name: 'Pedro Criança', birth: birthYearsAgo(10), phone: '21988887777' });
  await visible(page, '#minorBox');
  await page.click('#goBtn');
  assert.match(await text(page, '#eMinor'), /menos de 18 anos/);
  assert.equal(db.called('tele_request').length, 0);
  await page.click('label:has(#whoOther) span');
  await visible(page, '#otherBox');
  await visible(page, '#guardianBox');
  await page.fill('#fReq', 'Joana Mãe');
  await page.selectOption('#fRel', 'Mãe');
  await page.click('#goBtn');
  assert.match(await text(page, '#eGuardian'), /responsável legal/);
  assert.equal(db.called('tele_request').length, 0);
  await shot(page, 'tele-13-menor');
  await page.check('#fGuardian');
  await page.click('#goBtn');
  await visible(page, '#vWait');
  const a = db.called('tele_request')[0].args;
  assert.equal(a.p_for_other, true);
  assert.equal(a.p_guardian_consent, true);
  assert.equal(a.p_requester_name, 'Joana Mãe');
  assert.equal(a.p_relationship, 'Mãe');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('sair da fila, outra pessoa sobe de posição e recarregar a página retoma', async () => {
  const db = makeDb();
  db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', available_until: iso(Date.now() + 3600e3) });
  const p1 = await newPage(browser, db);
  await p1.page.goto(`${BASE}teleconsulta.html`);
  await visible(p1.page, '#formCard');
  await fillRequest(p1.page, { name: 'Primeira Pessoa', phone: '11911111111' });
  await p1.page.click('#goBtn');
  await visible(p1.page, '#vWait');
  const p2 = await newPage(browser, db);
  await p2.page.goto(`${BASE}teleconsulta.html`);
  await visible(p2.page, '#formCard');
  await fillRequest(p2.page, { name: 'Segunda Pessoa', phone: '11922222222' });
  await p2.page.click('#goBtn');
  await visible(p2.page, '#vWait');
  assert.equal(await text(p2.page, '#posNum'), '2º');
  assert.match(await text(p2.page, '#posText'), /Há 1 pessoa na sua frente/);
  // Mesmo telefone não entra duas vezes.
  const p3 = await newPage(browser, db);
  await p3.page.goto(`${BASE}teleconsulta.html`);
  await visible(p3.page, '#formCard');
  await fillRequest(p3.page, { name: 'Primeira De Novo', phone: '(11) 91111-1111' });
  await p3.page.click('#goBtn');
  await p3.page.waitForSelector('#formErr.show');
  assert.match(await text(p3.page, '#formErr'), /já tem uma teleconsulta/);
  await p3.context.close();
  // Recarregar retoma a fila.
  await p1.page.reload();
  await visible(p1.page, '#vWait');
  assert.equal(await text(p1.page, '#posNum'), '1º');
  // Sair da fila.
  await p1.page.click('#leaveBtn');
  await visible(p1.page, '#leaveConfirm');
  await p1.page.click('#leaveYes');
  await visible(p1.page, '#vStart');
  assert.match(await text(p1.page, '#flash'), /Você saiu da fila/);
  assert.equal(db.called('tele_cancel').length, 1);
  assert.equal(await p1.page.evaluate(() => localStorage.getItem('imed_tele')), null);
  assert.equal([...db.consults.values()].find((c) => c.patient_name === 'Primeira Pessoa').status, 'cancelled');
  await p2.page.waitForFunction(() => document.querySelector('#posNum').textContent === '1º', null, { timeout: 10000 });
  assert.deepEqual(p1.errors, []);
  assert.deepEqual(p2.errors, []);
  await p1.context.close();
  await p2.context.close();
});

await scenario('plano B: médico aceita mas não manda o vídeo — paciente é avisado da ligação', async () => {
  const db = makeDb();
  const carla = db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', available_until: iso(Date.now() + 3600e3) });
  const { page, errors, context } = await newPage(browser, db, { planBMs: 2500 });
  await page.goto(`${BASE}teleconsulta.html`);
  await visible(page, '#formCard');
  await fillRequest(page, { name: 'Paciente Sem Video' });
  await page.click('#goBtn');
  await visible(page, '#vWait');
  const c = [...db.consults.values()][0];
  Object.assign(c, { status: 'accepted', doctor_id: carla.id, accepted_at: iso(), doctor_info: { full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', rqe: null, specialty: null } });
  await visible(page, '#vCall', 10000);
  assert.match(await text(page, '#callDoctor'), /Carla Mendes/);
  assert.match(await text(page, '#callState'), /ele vai iniciar o vídeo/);
  await visible(page, '#planB', 10000);
  assert.match(await text(page, '#planB'), /O médico vai ligar para o celular que você informou/);
  assert.equal(await page.isVisible('#giveUpBox'), true, 'antes do vídeo, ainda dá para desistir');
  await shot(page, 'tele-14-planoB-paciente');
  // Mensagem do médico chega mesmo sem vídeo.
  db.messages.push({ id: ++db.seq, consultation_id: c.id, sender: 'doctor', body: 'Vou ligar para você agora.', created_at: iso() });
  await page.waitForFunction(() => /Vou ligar para você agora/.test(document.querySelector('#chatList').textContent), null, { timeout: 10000 });
  // Desistir da consulta antes do vídeo.
  await page.click('#giveUpBtn');
  await page.click('#giveUpYes');
  await visible(page, '#vStart');
  assert.equal(c.status, 'cancelled');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('plano B: vídeo que não conecta — médico vê o telefone e conversa por mensagem', async () => {
  const db = makeDb();
  db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP' });
  const doc = await newPage(browser, db, { planBMs: 4000 });
  await doctorOnDuty(doc.page);
  const pat = await newPage(browser, db, { planBMs: 4000, rtcFail: true });
  await pat.page.goto(`${BASE}teleconsulta.html`);
  await visible(pat.page, '#formCard');
  await fillRequest(pat.page, { name: 'Paciente Rede Ruim', phone: '31977776666' });
  await pat.page.click('#goBtn');
  await visible(pat.page, '#vWait');
  await doc.page.waitForSelector('#queue [data-accept]', { timeout: 15000 });
  await doc.page.click('#queue [data-accept]');
  await visible(pat.page, '#vCall', 15000);
  await visible(pat.page, '#planB', 15000);
  await visible(doc.page, '#cPlanB', 20000);
  assert.equal(await doc.page.getAttribute('#cCallBtn', 'href'), 'tel:+5531977776666');
  assert.match(await text(doc.page, '#cCallBtn'), /Ligar para \(31\) 97777-6666/);
  assert.match(await text(doc.page, '#cPlanB'), /o paciente pode ver o seu número/);
  await shot(doc.page, 'tele-15-planoB-medico');
  await doc.page.click('#cPhoneNote');
  assert.match(await doc.page.inputValue('#cNotes'), /continuou por telefone ou mensagem/);
  await doc.page.fill('#cChatText', 'O vídeo não conectou. Vou ligar para o seu celular.');
  await doc.page.click('#cChatBtn');
  await pat.page.waitForFunction(() => /Vou ligar para o seu celular/.test(document.querySelector('#chatList').textContent), null, { timeout: 15000 });
  const c = [...db.consults.values()][0];
  assert.ok(c.started_at, 'mensagem do médico marca o início (a consulta não expira)');
  // Tentar de novo cria uma nova oferta (versão 2).
  await doc.page.click('#cRetry2');
  await doc.page.waitForFunction(() => /Chamando o paciente/.test(document.querySelector('#cState').textContent), null, { timeout: 10000 });
  assert.equal(c.offer_version, 2);
  await visible(doc.page, '#cPlanB', 15000);
  await doc.page.click('#cEnd');
  await doc.page.click('#cEndYes');
  await visible(doc.page, '#dutyCard');
  await visible(pat.page, '#vEnd', 15000);
  assert.equal(c.status, 'ended');
  assert.deepEqual(doc.errors, []);
  assert.deepEqual(pat.errors, []);
  await pat.context.close();
  await doc.context.close();
});

await scenario('consulta aceita que expirou (atendida só por telefone): o médico ainda registra em 24 h', async () => {
  const db = makeDb();
  const carla = db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP' });
  const c = db.addConsult({ token_hash: sha('z'), patient_name: 'Paciente Por Telefone', status: 'expired', doctor_id: carla.id, accepted_at: iso(Date.now() - 40 * 60e3), doctor_info: { full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', rqe: null, specialty: null } });
  const doc = await newPage(browser, db);
  await doctorOnDuty(doc.page);
  await doc.page.waitForSelector('#hist [data-amend]', { state: 'attached' });
  assert.match(await text(doc.page, '#hist'), /Paciente Por Telefone/);
  assert.match(await text(doc.page, '#hist'), /Expirada/);
  await doc.page.click('#hist summary');
  await doc.page.click('#hist [data-amend]');
  await visible(doc.page, '#consult');
  assert.match(await text(doc.page, '#cTitle'), /Registrar a consulta de Paciente Por Telefone/);
  assert.equal(await doc.page.isVisible('#cExams'), false, 'expirada: sem pedido de exames');
  assert.match(await text(doc.page, '#cEnd'), /Registrar e encerrar/);
  await doc.page.fill('#cNotes', 'Atendida por telefone: orientada a procurar a UBS.');
  await doc.page.click('#cEnd');
  await visible(doc.page, '#dutyCard');
  assert.deepEqual(db.called('tele_end')[0].args, { p_id: c.id, p_notes: 'Atendida por telefone: orientada a procurar a UBS.', p_guidance: null });
  assert.equal(c.status, 'ended');
  assert.deepEqual(doc.errors, []);
  await doc.context.close();
});

await scenario('textos de quem usa o site sempre escapados (nome de médico, paciente e motivo)', async () => {
  const db = makeDb();
  db.addDoctor({ user_id: 'u-doc', full_name: 'Dra. <img src=x onerror="window.__xss=1"> Evil', crm: '111', crm_uf: 'RJ', rqe: '9', specialty: '<i>Cardio</i>', available_until: iso(Date.now() + 3600e3) });
  db.addDoctor({ user_id: 'u-admin', full_name: 'Rafael Pereira Barreto Silva', crm: '266930', crm_uf: 'SP' });
  db.addDoctor({ user_id: 'u-doc2', full_name: '<script>window.__xss=2</script> Davi', crm: '222', crm_uf: 'MG', status: 'pending', created_at: iso() });
  db.addConsult({ token_hash: sha('y'), patient_name: '<svg onload="window.__xss=3">', reason: '<b>forte</b>', for_other: true, requester_name: 'X', relationship: '<u>Mãe</u>' });
  const pat = await newPage(browser, db);
  await pat.page.goto(`${BASE}teleconsulta.html`);
  await pat.page.waitForSelector('#docs .tl-doclist');
  assert.match(await text(pat.page, '#docs'), /Dra\. <img src=x onerror="window\.__xss=1"> Evil/);
  assert.match(await text(pat.page, '#docs'), /<i>Cardio<\/i> · RQE 9/);
  assert.equal(await pat.page.locator('#docs img, #docs i:has-text("Cardio")').count(), 0);
  const adm = await newPage(browser, db);
  await adm.page.goto(loginUrl('tok-admin'));
  await adm.page.waitForSelector('#admin .md-adm');
  assert.match(await text(adm.page, '#admin'), /<script>window\.__xss=2<\/script> Davi/);
  await adm.page.check('#noticeOk');
  await adm.page.click('#noticeBtn');
  await adm.page.waitForSelector('#queue .md-q');
  assert.match(await text(adm.page, '#queue'), /<svg onload="window\.__xss=3">/);
  assert.match(await text(adm.page, '#queue'), /<b>forte<\/b>/);
  assert.match(await text(adm.page, '#queue'), /<u>Mãe<\/u>/);
  assert.equal(await adm.page.locator('#queue svg, #queue u, #admin script').count(), 0);
  assert.equal(await pat.page.evaluate(() => window.__xss), undefined);
  assert.equal(await adm.page.evaluate(() => window.__xss), undefined);
  assert.deepEqual(pat.errors, []);
  assert.deepEqual(adm.errors, []);
  await pat.context.close();
  await adm.context.close();
});

await scenario('celular (390 px): as duas páginas sem rolagem lateral, com vídeo', async () => {
  const db = makeDb();
  db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes Albuquerque de Souza', crm: '1234567890', crm_uf: 'SP', rqe: '778899', specialty: 'Medicina de família e comunidade' });
  db.addDoctor({ user_id: 'u-admin', full_name: 'Rafael Pereira Barreto Silva', crm: '266930', crm_uf: 'SP' });
  db.addDoctor({ user_id: 'u-new', full_name: 'Beatriz Souza', crm: '98765', crm_uf: 'PE', status: 'pending', created_at: iso() });
  const doc = await newPage(browser, db, { mobile: true });
  await doctorOnDuty(doc.page);
  await noOverflow(doc.page, 'médico: fila');
  const pat = await newPage(browser, db, { mobile: true });
  await pat.page.goto(`${BASE}teleconsulta.html`);
  await visible(pat.page, '#formCard');
  await noOverflow(pat.page, 'paciente: início');
  await pat.page.click('#testBtn');
  await videoReady(pat.page, '#testVideo');
  await pat.page.waitForSelector('#testMsg.ok');
  await noOverflow(pat.page, 'paciente: teste de câmera');
  await shot(pat.page, 'tele-16-celular-inicio');
  await pat.page.click('#testStop');
  await fillRequest(pat.page, { name: 'Paciente Com Nome Bem Comprido Para Testar Quebra', phone: '11955554444', reason: 'Dor nas costas há duas semanas, piora quando fico sentado muito tempo no trabalho.' });
  await pat.page.click('#goBtn');
  await visible(pat.page, '#vWait');
  await noOverflow(pat.page, 'paciente: fila');
  await shot(pat.page, 'tele-17-celular-fila');
  await doc.page.waitForSelector('#queue [data-accept]', { timeout: 15000 });
  await noOverflow(doc.page, 'médico: fila com paciente');
  await doc.page.click('#queue [data-accept]');
  await visible(pat.page, '#vCall', 15000);
  await videoReady(pat.page, '#remoteVideo');
  await videoReady(doc.page, '#cRemote');
  await noOverflow(pat.page, 'paciente: chamada');
  await noOverflow(doc.page, 'médico: chamada');
  await doc.page.fill('#exSearch', 'ultrassom');
  await doc.page.check('#exCatalog input[data-ex="usg_abdome_total"]');
  await doc.page.click('#exSend');
  await doc.page.waitForSelector('#exMsg.ok');
  await visible(pat.page, '#callExams', 15000);
  await noOverflow(doc.page, 'médico: exames');
  await noOverflow(pat.page, 'paciente: exames');
  await shot(pat.page, 'tele-18-celular-chamada');
  await shot(doc.page, 'tele-19-celular-medico');
  await doc.page.click('#cEnd');
  await doc.page.click('#cEndYes');
  await visible(pat.page, '#vEnd', 15000);
  await noOverflow(pat.page, 'paciente: resumo');
  const adm = await newPage(browser, db, { mobile: true });
  await adm.page.goto(loginUrl('tok-admin'));
  await adm.page.waitForSelector('#admin .md-adm');
  await noOverflow(adm.page, 'equipe: médicos');
  const term = await newPage(browser, db, { mobile: true });
  await term.page.goto(`${BASE}termo-teleconsulta.html`);
  await noOverflow(term.page, 'termo');
  assert.match(await text(term.page, 'main'), /versão 2026-10-30/);
  for (const t of [pat, doc, adm, term]) { assert.deepEqual(t.errors, []); await t.context.close(); }
});

await scenario('termo da teleconsulta: versão igual à enviada, dados, STUN, responsável e contato', async () => {
  const db = makeDb();
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(`${BASE}termo-teleconsulta.html`);
  const body = await text(page, 'main');
  assert.equal(await text(page, '#tcleVersion'), '2026-10-30');
  for (const s of [/Teleconsulta não é para emergência/, /192/, /188/, /não grava a chamada/, /Google e da Cloudflare/, /endereço de internet \(IP\)/,
    /no mínimo 20 anos/, /ICP-Brasil/, /Menores de 18 anos/, /Dr\. Rafael Pereira Barreto Silva/, /CRM-SP 266930/, /Fale com o IMED/, /não cobra nada pelo site nesta fase/]) {
    assert.match(body, s);
  }
  assert.ok(!/grátis para sempre|responsável técnico|contato@imed/i.test(body));
  assert.equal(await page.locator('a[href="contato.html"]').count() >= 2, true);
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
