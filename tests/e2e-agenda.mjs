// Teste de ponta a ponta da agenda da recepção (iMed Agenda, fase 4.2), num navegador de verdade (Playwright), com o
// Supabase simulado: um banco de mentira, em memória, que responde às funções da agenda como o banco de verdade (a
// mesma forma de resposta e os mesmos códigos). Relógio fixo (quarta-feira, 04/11/2026, 10:00 em São Paulo), 1024 e
// 390 px, teclado, confirmações na própria tela (diálogo do navegador reprova), cores sempre com texto, tema escuro.
// Nomes com <b>…</b> provam que todo texto do banco é escapado. Nenhuma leitura direta de appointment_requests,
// clinic_blocks ou clinic_schedules pode acontecer (a 4.2 fecha essa leitura).
// Rodar: node tests/e2e-agenda.mjs   (SHOTS=pasta salva capturas; E2E_PORT muda a porta)
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comChaves, vigiarChaves } from './regra-chaves.mjs';
import { ROLE_PERMS } from '../assets/js/agenda-core.js';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const PORT = Number(process.env.E2E_PORT) || 8782;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  try { res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); } catch { res.writeHead(404).end('não encontrado'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

// ---------- dados simulados (nomes e e-mails de teste; nenhum dado real) ----------
const NOW = '2026-11-04T13:00:00Z'; // quarta-feira, 10:00 em São Paulo
const USER = 'uuuuuuuu-0000-4000-8000-000000000001';
const C1 = 'cccccccc-0000-4000-8000-000000000001';
const USG = 'rrrrrrrr-0000-4000-8000-000000000001';
const SALA = 'rrrrrrrr-0000-4000-8000-000000000002';
const DRA = 'rrrrrrrr-0000-4000-8000-000000000003';
const P_USG = 'pppppppp-0000-4000-8000-000000000001';
const P_ECO = 'pppppppp-0000-4000-8000-000000000002';
const CLINIC = { id: C1, name: 'Clínica Teste da Agenda', kind: 'imagem', address_line: 'Rua de Teste, 1', city: 'São Paulo', state: 'SP', cnes: '7654321',
  phone: null, whatsapp: null, email: null, website: null, specialties: [], opening_hours: null, accepts_online_booking: true, status: 'published', is_demo: false,
  insurances: [], timezone: 'America/Sao_Paulo', agenda_mode: 'nativa' };
const UNIT = { step_min: 15, min_notice_min: 120, max_advance_days: 90, checkin_before_min: 120, no_show_after_min: 15, patient_cancel_until_min: 0,
  patient_reschedule_until_min: 120, holidays_checked_until: '2026-12-31', closes_on_holidays: true };
const RESOURCES = () => [
  { id: USG, kind: 'equipamento', name: 'Aparelho de Ultrassom <b>1</b>', capacity: 1, active: true, member: null },
  { id: SALA, kind: 'sala', name: 'Sala 2', capacity: 1, active: true, member: null },
  { id: DRA, kind: 'profissional', name: 'Dra. Teste', capacity: 1, active: true, member: USER },
];
const PROCEDURES = () => [
  { id: P_USG, exam_code: 'usg', name: 'Ultrassom de abdome <b>total</b>', duration_min: 30, price_cents: 18000, online_booking: true, prep_text: 'Jejum de 8 horas.', fasting_hours: 8,
    min_notice_min: 120, groups: [{ group_no: 1, resource_kind: 'equipamento', resource_ids: [USG] }] },
  { id: P_ECO, exam_code: 'eco', name: 'Ecocardiograma', duration_min: 20, price_cents: null, online_booking: true, prep_text: null, fasting_hours: null,
    min_notice_min: 120, groups: [{ group_no: 1, resource_kind: 'profissional', resource_ids: [DRA] }] },
];
const sp = (day, hhmm) => new Date(`${day}T${hhmm}:00-03:00`).toISOString();
const HOJE = '2026-11-04';
const AMANHA = '2026-11-05';
let seq = 0;
const nid = (p) => `${p}-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const clone = (x) => JSON.parse(JSON.stringify(x));
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });
const jsonOut = json;
const short = (n) => { const w = String(n || '').trim().split(/\s+/); return w.length > 1 ? `${w[0]} ${w.at(-1)[0]}.` : w[0]; };

// Um agendamento (cabeçalho + itens) como o banco guarda.
function booking({ name = 'Maria Souza Lima', phone = '11988887777', proc = P_USG, start, status = 'confirmed', channel = 'imed_app', res = [USG], forOther = false, otherName = null, notes = null }) {
  const p = PROCEDURES().find((x) => x.id === proc);
  const id = nid('aaaaaaaa');
  const ends = new Date(Date.parse(start) + p.duration_min * 60000).toISOString();
  return {
    id, clinic_id: C1, status, version: 1, channel, patient_name: name, patient_phone: phone, patient_email: null, notes, for_other: forOther, other_name: otherName,
    relationship: forOther ? 'Filha' : null, other_minor: false, uses_resources: true, created_at: '2026-11-01T12:00:00Z', slot_start: start, slot_end: ends,
    preferred_date: start.slice(0, 10), preferred_period: 'manha', hold_expires_at: null, cancel_reason: null, cancelled_by: null, cancelled_at: null,
    items: [{ id: nid('iiiiiiii'), seq: 1, procedure_id: proc, procedure: p.name, exam_code: p.exam_code, starts_at: start, ends_at: ends, status, version: 1, price_cents: p.price_cents, resources: [...res] }],
  };
}

// role: papel da pessoa na clínica (null = sem vínculo); admin: equipe do IMED.
async function newPage(browser, { mobile = false, width = 1024, role = 'reception', admin = false, now = NOW, theme = null, tz = 'America/Sao_Paulo', missing = [], db: o = {} } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width, height: 900 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block', colorScheme: theme === 'dark' ? 'dark' : 'light' });
  await context.clock.setFixedTime(new Date(now));
  const db = {
    role, admin, now: Date.parse(now), tz, version: 7, unit: { ...UNIT }, resources: RESOURCES(), procedures: PROCEDURES(), requests: [], busy: [], blocks: [], conflicts: [],
    history: {}, keys: {}, accessLog: 0, deskSlots: null, desk: null, failNet: {}, once: {}, missing: new Set(missing), directReads: [], ...o,
  };
  const log = [];
  await context.addInitScript(([s, t]) => {
    try {
      localStorage.setItem('imed_lgpd', '1');
      if (t) localStorage.setItem('imed_tema', t);
      if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('imed_session', JSON.stringify(s)); sessionStorage.setItem('__seeded', '1'); }
    } catch { /* */ }
  }, [{ access_token: 'tok-init', refresh_token: 'ref', expires_at: Math.floor(Date.parse(now) / 1000) + 3600, user: { id: USER, email: 'recepcao@exemplo.test' } }, theme === 'dark' ? 'escuro' : null]);
  const perms = () => (db.role ? ROLE_PERMS[db.role] : {});
  const scope = () => (db.role && perms()['agenda.ver'] ? perms()['agenda.ver'] : db.admin ? 'central' : null);
  const own = () => db.resources.filter((r) => r.member === USER).map((r) => r.id);
  const visibleItem = (it) => scope() !== 'propria' || it.resources.some((r) => own().includes(r));
  const hist = (req, from, to, reason = null) => { (db.history[req.id] ||= []).push({ at: new Date(db.now).toISOString(), item_seq: 1, from, to, actor_kind: 'clinica', actor_role: db.role || 'imed_admin', origin: db.admin && !db.role ? 'central' : 'painel', reason_code: reason, request_version: req.version }); };
  const touch = () => { db.version += 1; };
  const reqOf = (id) => db.requests.find((r) => r.id === id);
  const inRange = (x, ini, fim) => Date.parse(x.starts_at ?? x.slot_start) < fim && Date.parse(x.ends_at ?? x.slot_end) > ini;
  const dayStart = (day) => Date.parse(new Date(`${day}T00:00:00-03:00`).toISOString());
  const occupied = (resId, ini, fim, ignore = null) => db.requests.some((r) => r.items.some((it) => it.id !== ignore && ['confirmed', 'checked_in', 'in_service', 'hold', 'reschedule_requested'].includes(it.status) && it.resources.includes(resId) && Date.parse(it.starts_at) < fim && Date.parse(it.ends_at) > ini))
    || db.busy.some((b) => b.resources.includes(resId) && Date.parse(b.starts_at) < fim && Date.parse(b.ends_at) > ini)
    || db.blocks.some((b) => (!b.resource_id || b.resource_id === resId) && Date.parse(b.starts_at) < fim && Date.parse(b.ends_at) > ini);
  const freeSlots = (proc, day, ignore = null) => {
    if (db.deskSlots) return db.deskSlots;
    const p = db.procedures.find((x) => x.id === proc);
    const res = p.groups[0].resource_ids[0];
    const out = [];
    for (let m = 7 * 60; m + p.duration_min <= 19 * 60; m += 30) {
      const ini = dayStart(day) + m * 60000; const fim = ini + p.duration_min * 60000;
      if (ini < db.now) continue;
      if (!occupied(res, ini, fim, ignore)) out.push({ start: new Date(ini).toISOString(), end: new Date(fim).toISOString() });
    }
    return out;
  };
  const transition = (req, item, to, reason) => {
    const ini = Date.parse(item.starts_at);
    const u = db.unit;
    const from = item.status;
    const ok = { 'confirmed>checked_in': () => db.now >= ini - u.checkin_before_min * 60000 || 'too_early', 'checked_in>in_service': () => true, 'in_service>completed': () => true,
      'confirmed>completed': () => db.now >= ini || 'too_early', 'confirmed>no_show': () => db.now >= ini + u.no_show_after_min * 60000 || 'too_early',
      'no_show>checked_in': () => (scope() === 'propria' ? 'transition_not_allowed' : !reason ? 'reason_required' : true),
      'reschedule_requested>confirmed': () => (occupied(item.resources[0] || USG, ini, Date.parse(item.ends_at), item.id) ? 'slot_taken' : true) };
    const f = ok[`${from}>${to}`];
    if (!f) return { status: 'transition_not_allowed', from };
    const v = f();
    if (v !== true) return { status: v, ...(v === 'transition_not_allowed' ? { from } : {}) };
    item.status = to; item.version += 1;
    if (to === 'confirmed' && !item.resources.length) item.resources = [USG];
    req.status = to; req.version += 1;
    hist(req, from, to, reason);
    touch();
    return { status: 'ok', request_status: to, version: req.version };
  };
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const rest = url.pathname.replace('/rest/v1/', '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    log.push({ path: rest, method: req.method(), body, q: url.searchParams });
    const fn = rest.replace('rpc/', '');
    // resposta perdida: o banco grava, mas a resposta não chega (erro de rede depois de gravar)
    const perdida = db.lostReply?.[fn] > 0;
    if (perdida) db.lostReply[fn] -= 1;
    const json = (r, b, s = 200) => (perdida ? r.abort('failed') : jsonOut(r, b, s));
    if (['appointment_requests', 'clinic_blocks', 'clinic_schedules'].includes(rest)) db.directReads.push(rest);
    if (db.failNet[fn] > 0) { db.failNet[fn] -= 1; return route.abort('failed'); }
    if (db.missing.has(fn)) return json(route, { code: 'PGRST202', message: `Could not find the function public.${fn}` }, 404);
    if (db.once[fn]) { const r = db.once[fn]; delete db.once[fn]; return json(route, r); }
    if (db.delay?.[fn]) await new Promise((r) => setTimeout(r, db.delay[fn])); // resposta lenta (sair da aba antes dela)
    const pr = perms();
    switch (rest) {
      case 'rpc/is_imed_admin': return json(route, db.admin);
      case 'rpc/agenda_me': return json(route, { status: 'ok', user_id: USER, clinics: db.role ? [{ clinic_id: C1, name: CLINIC.name, role: db.role, timezone: db.tz, agenda_mode: 'nativa', agenda_active: true, online: false, permissions: pr }] : [], imed: { admin: db.admin, permissions: [] } });
      case 'rpc/agenda_my_invites': return json(route, { status: 'ok', invites: [] });
      case 'clinics': return json(route, db.role || db.admin ? [{ ...CLINIC, timezone: db.tz }] : []);
      case 'clinic_exams': return json(route, []);
      case 'appointment_requests': case 'clinic_blocks': case 'clinic_schedules': return json(route, { code: '42501', message: 'permission denied' }, 403);
      case 'rpc/agenda_catalog': {
        const s = scope();
        if (!s) return json(route, { status: 'forbidden' });
        const res = s === 'propria' ? db.resources.filter((r) => own().includes(r.id)) : db.resources;
        const procs = s === 'propria' ? db.procedures.filter((p) => p.groups.some((g) => g.resource_ids.some((x) => own().includes(x)))) : db.procedures;
        const c = (perm) => (s === 'central' ? true : pr[perm] === 'clinica');
        return json(route, { status: 'ok', scope: s, clinic_id: C1, timezone: db.tz, agenda_mode: 'nativa', active: true, online: false,
          can: { marcar: c('agenda.marcar'), remarcar: c('agenda.remarcar'), cancelar: c('agenda.cancelar'), bloquear: c('agenda.bloquear'), atender: s === 'central' || !!pr['agenda.atender'], pacientes: s !== 'central' && !!pr['agenda.pacientes'], conflitos: c('conflitos.resolver') },
          unit: db.unit, national_holidays_until: db.national ?? '2027-12-31',
          resources: res.map(({ member, ...r }) => ({ ...r, mine: member === USER })), procedures: procs });
      }
      case 'rpc/agenda_view': {
        const s = scope();
        if (!s) return json(route, { status: 'forbidden' });
        const ini = dayStart(body.p_from); const fim = ini + body.p_days * 86400000;
        const items = db.requests.flatMap((r) => r.items.map((it) => ({ ...it, request_id: r.id, request_version: r.version, channel: r.channel, hold_expires_at: r.hold_expires_at,
          patient: s === 'central' ? null : short(r.for_other ? r.other_name : r.patient_name) })))
          .filter((it) => inRange(it, ini, fim) && it.status !== 'expired' && visibleItem(it))
          .map((it) => ({ ...it, resources: ['cancelled'].includes(it.status) ? [] : it.resources }));
        if (s !== 'central' && items.length) db.accessLog += 1;
        return json(route, { status: 'ok', version: db.version, timezone: db.tz, from: new Date(ini).toISOString(), to: new Date(fim).toISOString(), scope: s, patients: s !== 'central',
          resources: (s === 'propria' ? db.resources.filter((r) => own().includes(r.id)) : db.resources).map(({ member, ...r }) => r),
          items, busy: s === 'propria' ? [] : db.busy.filter((b) => inRange(b, ini, fim)), blocks: db.blocks.filter((b) => inRange(b, ini, fim)).map((b) => ({ ...b, reason: s === 'clinica' ? b.reason : null })) });
      }
      case 'rpc/agenda_free': {
        const ini = dayStart(body.p_from); const fim = ini + body.p_days * 86400000;
        const res = (scope() === 'propria' ? db.resources.filter((r) => own().includes(r.id)) : db.resources).map((r) => {
          const free = [];
          for (let d = 0; d < body.p_days; d++) {
            let a = null;
            for (let m = 7 * 60; m <= 19 * 60; m += 5) {
              const t = ini + d * 86400000 + m * 60000;
              const livre = m < 19 * 60 && !occupied(r.id, t, t + 5 * 60000);
              if (livre && a == null) a = t;
              if (!livre && a != null) { free.push([new Date(a).toISOString(), new Date(t).toISOString()]); a = null; }
            }
          }
          return { id: r.id, free };
        }).filter((r) => r.free.length);
        const unitOpen = Array.from({ length: body.p_days }, (_, d) => [new Date(ini + d * 86400000 + 7 * 3600000).toISOString(), new Date(ini + d * 86400000 + 19 * 3600000).toISOString()]);
        return json(route, { status: 'ok', scope: scope(), timezone: db.tz, from: new Date(ini).toISOString(), to: new Date(fim).toISOString(), holidays_checked_until: db.unit.holidays_checked_until,
          national_holidays_until: db.national ?? '2027-12-31', closes_on_holidays: true, unit_open: unitOpen, resources: res, holidays: [] });
      }
      case 'rpc/agenda_month': {
        const ini = `${body.p_month.slice(0, 7)}-01`;
        const days = [];
        for (let d = new Date(`${ini}T12:00:00Z`); d.toISOString().slice(0, 7) === ini.slice(0, 7); d.setUTCDate(d.getUTCDate() + 1)) {
          const day = d.toISOString().slice(0, 10); const a = dayStart(day); const z = a + 86400000;
          const its = db.requests.flatMap((r) => r.items).filter((it) => inRange(it, a, z));
          days.push({ day, ativos: its.filter((i) => ['confirmed', 'checked_in', 'in_service', 'reschedule_requested'].includes(i.status)).length, concluidos: its.filter((i) => i.status === 'completed').length,
            faltas: its.filter((i) => i.status === 'no_show').length, cancelados: its.filter((i) => i.status === 'cancelled').length, bloqueios: db.blocks.filter((b) => inRange(b, a, z)).length });
        }
        return json(route, { status: 'ok', timezone: db.tz, month: ini, days });
      }
      case 'rpc/agenda_version': return json(route, { status: 'ok', version: db.version, changed_at: NOW });
      case 'rpc/agenda_conflicts': return json(route, scope() === 'propria' ? { status: 'forbidden' } : { status: 'ok', conflicts: db.conflicts.filter((k) => ['aberto', 'em_andamento'].includes(k.status)) });
      case 'rpc/agenda_conflict_resolve': {
        const k = db.conflicts.find((x) => x.id === body.p_id);
        if (!k) return json(route, { status: 'not_found' });
        k.status = body.p_status; k.resolution_code = body.p_code; touch();
        return json(route, { status: 'ok' });
      }
      case 'rpc/agenda_search': {
        if (scope() === 'central') return json(route, { status: 'forbidden' });
        const q = String(body.p_q || '').trim();
        if (q.length < 3) return json(route, { status: 'too_short' });
        db.accessLog += 1;
        const results = db.requests.filter((r) => `${r.patient_name} ${r.other_name || ''}`.toLowerCase().includes(q.toLowerCase()) && r.items.some(visibleItem))
          .map((r) => ({ id: r.id, status: r.status, slot_start: r.slot_start, agenda: r.uses_resources, preferred_date: r.preferred_date, exam_code: r.items[0]?.exam_code || 'usg', version: r.version,
            name: r.for_other ? r.other_name : r.patient_name, phone_end: scope() === 'clinica' ? r.patient_phone.slice(-4) : null }));
        return json(route, { status: 'ok', results });
      }
      case 'rpc/agenda_request_detail': {
        const r = reqOf(body.p_id);
        if (!r) return json(route, { status: 'not_found' });
        let s = scope();
        if (s === 'central' && !body.p_justification) return json(route, { status: 'justification_required' });
        db.accessLog += 1; db.lastJust = body.p_justification;
        const full = s === 'clinica' || s === 'central';
        return json(route, { status: 'ok', scope: s, id: r.id, clinic_id: C1, request_status: r.status, version: r.version, agenda: r.uses_resources, channel: r.channel, created_at: r.created_at,
          exam_code: r.items[0]?.exam_code || r.exam_code, preferred_date: r.preferred_date, preferred_period: r.preferred_period, slot_start: r.slot_start, slot_end: r.slot_end,
          hold_expires_at: r.hold_expires_at, cancel_reason: r.cancel_reason, cancelled_by: r.cancelled_by, cancelled_at: r.cancelled_at, anonymized: false,
          patient: { name: r.patient_name, phone: full ? r.patient_phone : null, email: full ? r.patient_email : null, for_other: r.for_other, other_name: r.other_name, relationship: r.relationship, other_minor: r.other_minor, notes: full ? r.notes : null },
          items: r.items.map((it) => ({ ...it, resources: it.resources.map((id) => { const x = db.resources.find((y) => y.id === id); return { id, name: x.name, kind: x.kind }; }) })), notes: [] });
      }
      case 'rpc/agenda_history': return json(route, { status: 'ok', history: db.history[body.p_id] || [] });
      case 'rpc/agenda_desk_slots': {
        if (!(pr['agenda.marcar'] === 'clinica' || scope() === 'central')) return json(route, { status: 'forbidden' });
        db.lastSlots = body;
        if (db.desk) return json(route, db.desk);
        return json(route, { status: 'ok', timezone: db.tz, from: body.p_from, to: body.p_to || body.p_from, slots: freeSlots(body.p_procedure, body.p_from, body.p_item), holidays_checked_until: db.unit.holidays_checked_until, national_holidays_until: db.national ?? '2027-12-31' });
      }
      case 'rpc/agenda_desk_book': {
        if (db.keys[body.p_key]) return json(route, { ...db.keys[body.p_key], replay: true });
        const it = body.p_items[0];
        if (!freeSlots(it.procedure_id, it.starts_at.slice(0, 10)).some((s) => s.start === it.starts_at) && !db.deskSlots) return json(route, { status: 'slot_taken', seq: 1, alternatives: [] });
        const p = body.p_patient;
        const b = booking({ name: p.name, phone: p.phone, proc: it.procedure_id, start: it.starts_at, channel: body.p_channel, res: db.procedures.find((x) => x.id === it.procedure_id).groups[0].resource_ids });
        db.requests.push(b); touch();
        const r = { status: 'ok', id: b.id, request_status: 'confirmed', slot_start: b.slot_start, slot_end: b.slot_end, hold_expires_at: null, items: [{ seq: 1, procedure_id: it.procedure_id, starts_at: b.slot_start, ends_at: b.slot_end }] };
        db.keys[body.p_key] = r;
        return json(route, r);
      }
      case 'rpc/agenda_desk_busy': {
        const id = nid('bbbbbbbb');
        db.busy.push({ id, starts_at: body.p_starts, ends_at: body.p_ends, reason_code: body.p_reason, resources: [body.p_resource] }); touch();
        return json(route, { status: 'ok', id });
      }
      case 'rpc/agenda_desk_busy_remove': db.busy = db.busy.filter((b) => b.id !== body.p_id); touch(); return json(route, { status: 'ok' });
      case 'rpc/agenda_attend': case 'rpc/agenda_set_status': {
        const r = reqOf(body.p_id);
        if (!r) return json(route, { status: 'not_found' });
        if (fn === 'agenda_set_status' && scope() === 'propria') return json(route, { status: 'forbidden' });
        if (body.p_version != null && body.p_version !== r.version) return json(route, { status: 'version_conflict', version: r.version });
        const item = r.items.find((x) => x.id === body.p_item) || r.items[0];
        if (scope() === 'propria' && !item.resources.some((x) => own().includes(x))) return json(route, { status: 'forbidden' });
        return json(route, transition(r, item, body.p_status, body.p_reason));
      }
      case 'rpc/agenda_cancel': {
        const r = reqOf(body.p_id);
        if (!r) return json(route, { status: 'not_found' });
        if (!body.p_reason) return json(route, { status: 'reason_required' });
        if (body.p_version != null && body.p_version !== r.version) return json(route, { status: 'version_conflict', version: r.version });
        r.status = 'cancelled'; r.cancel_reason = body.p_reason; r.version += 1; r.items.forEach((i) => { i.status = 'cancelled'; i.resources = []; }); touch();
        return json(route, { status: 'ok' });
      }
      case 'rpc/agenda_reschedule': {
        const r = reqOf(body.p_id);
        if (db.keys[body.p_key]) return json(route, { ...db.keys[body.p_key], replay: true });
        if (body.p_version != null && body.p_version !== r.version) return json(route, { status: 'version_conflict', version: r.version });
        const it = r.items.find((x) => x.seq === body.p_items[0].seq);
        const dur = Date.parse(it.ends_at) - Date.parse(it.starts_at);
        it.starts_at = body.p_items[0].starts_at; it.ends_at = new Date(Date.parse(it.starts_at) + dur).toISOString(); it.status = 'confirmed';
        it.resources = it.resources.length ? it.resources : db.procedures.find((p) => p.id === it.procedure_id).groups[0].resource_ids;
        r.status = 'confirmed'; r.slot_start = it.starts_at; r.version += 1; touch();
        const out = { status: 'ok', id: r.id, request_status: 'confirmed', items: [{ seq: it.seq, starts_at: it.starts_at, ends_at: it.ends_at }] };
        db.keys[body.p_key] = out;
        return json(route, out);
      }
      case 'rpc/agenda_blocks': return json(route, { status: 'ok', scope: scope(), timezone: db.tz, from: HOJE, to: '2027-12-09', can_edit: pr['agenda.bloquear'] === 'clinica' || scope() === 'central',
        blocks: db.blocks.map((b) => ({ ...b, resource_name: b.resource_id ? db.resources.find((r) => r.id === b.resource_id).name : null, resource_kind: null, reason: scope() === 'clinica' ? b.reason : null, created_at: NOW })) });
      case 'rpc/agenda_block_add': case 'rpc/agenda_block_force': {
        db.lastBlock = body;
        const ini = Date.parse(body.p_starts); const fim = Date.parse(body.p_ends);
        const hitRes = (resIds) => (body.p_resource ? resIds.includes(body.p_resource) : true);
        // agenda_block_force (4.2): o período conta a partir de agora e o que JÁ COMEÇOU não é atingido (nem impede);
        // agenda_block_add (3.2) olha o período inteiro, como o banco de verdade.
        const forcar = fn === 'agenda_block_force';
        const desde = forcar ? Math.max(ini, db.now) : ini;
        const futuro = (x) => !forcar || Date.parse(x.starts_at) > db.now;
        const ativo = (it) => ['hold', 'awaiting_payment', 'confirmed', 'checked_in', 'in_service', 'reschedule_requested'].includes(it.status) && it.resources.length;
        const hits = [
          ...db.requests.flatMap((r) => r.items.filter((it) => ativo(it) && hitRes(it.resources) && Date.parse(it.starts_at) < fim && Date.parse(it.ends_at) > desde && futuro(it))
            .map((it) => ({ kind: 'agendamento', item_id: it.id, request_id: r.id, busy_id: null, seq: it.seq, status: it.status, request_version: r.version, starts_at: it.starts_at, ends_at: it.ends_at,
              procedure_id: it.procedure_id, procedure: it.procedure, channel: r.channel, patient: scope() === 'clinica' ? short(r.patient_name) : null, can_move: ['confirmed', 'reschedule_requested'].includes(it.status) }))),
          ...db.busy.filter((b) => hitRes(b.resources) && Date.parse(b.starts_at) < fim && Date.parse(b.ends_at) > desde && futuro(b))
            .map((b) => ({ kind: 'ocupado', item_id: null, request_id: null, busy_id: b.id, seq: null, status: null, request_version: null, starts_at: b.starts_at, ends_at: b.ends_at, procedure_id: null, procedure: null, channel: null, patient: null, can_move: true })),
        ];
        const code = `c${hits.map((h) => `${h.item_id || h.busy_id}:${h.status}:${h.request_version}`).join('|').length}${hits.length}`.padEnd(64, '0');
        if (fn === 'agenda_block_add') {
          if (hits.length) return json(route, { status: 'has_appointments', items: hits.filter((h) => h.kind === 'agendamento').map((h) => ({ item_id: h.item_id, request_id: h.request_id, starts_at: h.starts_at })), busy: hits.filter((h) => h.kind === 'ocupado').length });
          const id = nid('kkkkkkkk');
          db.blocks.push({ id, resource_id: body.p_resource, kind: body.p_kind, starts_at: body.p_starts, ends_at: body.p_ends, reason: body.p_reason }); touch();
          return json(route, { status: 'ok', id });
        }
        if (!body.p_confirm) return json(route, { status: 'confirm_required', items: hits, confirm: code });
        // o mesmo bloqueio (alvo, início, fim e tipo) já gravado: não grava outro (reenvio depois de erro de rede)
        const igual = db.blocks.find((b) => (b.resource_id || null) === (body.p_resource || null) && b.kind === body.p_kind && Date.parse(b.starts_at) === ini && Date.parse(b.ends_at) === fim);
        if (igual) return json(route, { status: 'ok', id: igual.id, moved: 0, busy_removed: 0, replay: true });
        if (body.p_confirm !== code) return json(route, { status: 'affected_changed', items: hits, confirm: code });
        if (hits.some((h) => !h.can_move)) return json(route, { status: 'cannot_move', items: hits });
        const id = nid('kkkkkkkk');
        let moved = 0; let removed = 0;
        for (const h of hits) {
          if (h.kind === 'ocupado') { db.busy = db.busy.filter((b) => b.id !== h.busy_id); removed++; continue; }
          const r = reqOf(h.request_id); const it = r.items.find((x) => x.id === h.item_id);
          it.status = 'reschedule_requested'; it.resources = []; r.status = 'reschedule_requested'; r.version += 1; moved++;
          db.conflicts.push({ id: nid('ffffffff'), kind: 'bloqueio_sobre_agendamento', request_id: r.id, item_id: it.id, starts_at: it.starts_at, procedure_id: it.procedure_id, details: { starts_at: it.starts_at, procedure_id: it.procedure_id, block_id: id }, status: 'aberto', created_at: NOW });
        }
        db.blocks.push({ id, resource_id: body.p_resource, kind: body.p_kind, starts_at: body.p_starts, ends_at: body.p_ends, reason: body.p_reason }); touch();
        return json(route, { status: 'ok', id, moved, busy_removed: removed });
      }
      case 'rpc/agenda_block_remove': db.blocks = db.blocks.filter((b) => b.id !== body.p_block); touch(); return json(route, { status: 'ok' });
      case 'rpc/agenda_requests': {
        const s = pr['pedidos.ver'] === 'clinica' ? 'clinica' : db.admin ? 'central' : null;
        if (!s) return json(route, { status: 'forbidden' });
        if (s === 'central' && !body.p_justification) return json(route, { status: 'justification_required' });
        return json(route, { status: 'ok', scope: s, timezone: db.tz, today: HOJE, requests: db.requests.map((r) => ({ ...r, items: undefined })) });
      }
      case 'rpc/set_request_status': return json(route, 'ok');
      case 'rpc/agenda_config': return json(route, { status: 'forbidden' });
      default: return json(route, { message: `não simulado: ${rest}` }, 404);
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push(`diálogo inesperado: ${d.message()}`); d.dismiss(); });
  return { context, page, log, db, errors };
}

const calls = (log, fn) => log.filter((e) => e.path === `rpc/${fn}`);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };
const noOverflow = async (page) => {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  const vw = page.viewportSize().width;
  assert.ok(sw <= vw, `sem rolagem lateral (conteúdo ${sw}px, aparelho ${vw}px)`);
};
const focusId = (page) => page.evaluate(() => document.activeElement?.id || '');
// Nome falado de cada botão: o texto dele sem o que é só para os olhos (aria-hidden), como o leitor de tela lê.
// Botão com texto à vista não pode ter aria-label (o nome falado tem de conter o que está escrito; o axe confere).
const nomesFalados = (page, sel) => page.$$eval(sel, (els) => els.map((el) => {
  const c = el.cloneNode(true);
  c.querySelectorAll('[aria-hidden="true"]').forEach((x) => x.remove());
  return `${el.getAttribute('aria-label') ?? ''}|${c.textContent.replace(/\s+/g, ' ').trim()}`;
}));
const focusText = (page) => page.evaluate(() => (document.activeElement?.textContent || '').trim());
const abrirAgenda = async (page) => {
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-agenda');
  if (await page.getAttribute('#tab-agenda', 'aria-selected') !== 'true') await page.click('#tab-agenda');
  await page.waitForSelector('#agMain .ag-lista, #agMain .ag-grade, #agMain .ag-vazio, #agMain .ag-mes, #agMain .ag-mlista');
};
// Toda marca colorida da agenda tem o texto da situação (no próprio texto ou no aria-label).
async function coresComTexto(page) {
  const sem = await page.$$eval('.ag-ev', (els) => els.filter((e) => {
    const t = `${e.textContent || ''} ${e.getAttribute('aria-label') || ''}`;
    return !/(Confirmado|Paciente presente|Presente|Em atendimento|Concluído|Não compareceu|Faltou|Cancelado|Remarcação|Remarcar|Reserva|Pagamento|Bloqueado|Manutenção|Folga|Feriado|Ocupado|Aguardando|Em contato)/.test(t);
  }).map((e) => e.outerHTML.slice(0, 120)));
  assert.deepEqual(sem, [], 'toda marca colorida tem o texto da situação');
}
const semLeituraDireta = (db) => assert.deepEqual(db.directReads, [], 'nenhuma leitura direta de pedidos, bloqueios ou horários');

const results = [];
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
async function scenario(name, fn) {
  const t = new Promise((_, f) => { const x = setTimeout(() => f(new Error(`passou de ${LIMITE_MS / 1000} s: ${name}`)), LIMITE_MS); x.unref?.(); });
  try { await Promise.race([comChaves(fn), t]); results.push(['ok', name]); console.log(`ok  ${name}`); } catch (e) { results.push(['FALHOU', name]); console.log(`FALHOU  ${name}\n   ${e.stack}`); }
}
const browser = vigiarChaves(await chromium.launch());

// Agendamentos de hoje e amanhã usados em vários cenários.
const dia1 = () => [
  booking({ name: 'Maria <b>Souza</b> Lima', start: sp(HOJE, '09:00'), channel: 'imed_app' }),
  booking({ name: 'João Pedro Teste', phone: '11977776666', start: sp(HOJE, '10:00'), status: 'checked_in', channel: 'clinica_telefone' }),
  booking({ name: 'Ana Clara Rocha', phone: '1133334444', start: sp(HOJE, '11:00'), status: 'confirmed', channel: 'clinica_balcao', proc: P_ECO, res: [DRA] }),
  booking({ name: 'Pedro Cancelado Silva', start: sp(HOJE, '14:00'), status: 'cancelled', channel: 'clinica_outro' }),
];

await scenario('recepção, 1024 px: abas, Hoje com cada item, cores com texto, legenda e nenhuma leitura direta', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: dia1(), busy: [{ id: 'bbbbbbbb-0000-4000-8000-000000000901', starts_at: sp(HOJE, '15:00'), ends_at: sp(HOJE, '16:00'), reason_code: 'agenda_propria', resources: [USG] }] } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-agenda');
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Pedidos|Agenda');
  assert.equal(await page.getAttribute('#tab-agenda', 'aria-selected'), 'true', 'a agenda ativa abre na aba Agenda');
  await page.waitForSelector('#agMain .ag-lista');
  assert.match(await page.textContent('#agTitulo'), /Hoje, quarta-feira, 4 de novembro/);
  assert.equal(await page.getAttribute('[data-view="hoje"]', 'aria-pressed'), 'true');
  const itens = await nomesFalados(page, '#agMain [data-act="abrir"]');
  assert.equal(itens.length, 3, 'cancelado só com "Mostrar cancelados"');
  assert.equal(itens[0], '|09:00 às 09:30, Maria L., Ultrassom de abdome <b>total</b> · Aparelho de Ultrassom <b>1</b> · Site do IMED, Confirmado', 'sem aria-label; o texto à vista e o escondido, na ordem');
  assert.equal(await page.$$eval('#agMain b', (b) => b.filter((x) => /total|Souza|^1$/.test(x.textContent)).length), 0, 'nomes vindos do banco são escapados (sem <b> de verdade)');
  assert.match(await page.textContent('#agMain'), /Paciente presente/);
  assert.match(await page.textContent('#agMain'), /Ocupado \(agenda própria\)/);
  await coresComTexto(page);
  // legenda: 6 tons, todos com texto
  const leg = await page.$$eval('#agLegenda li', (l) => l.map((x) => [x.className, x.textContent.trim()]));
  assert.equal(new Set(leg.map(([c]) => c)).size, 6);
  assert.ok(leg.every(([, t]) => t.length > 2));
  // mostrar cancelados
  await page.check('#agFCancel');
  assert.equal(await page.locator('#agMain [data-act="abrir"]').count(), 4);
  assert.match(await page.textContent('#agMain'), /Cancelado/);
  assert.equal(calls(log, 'agenda_catalog').length, 1);
  semLeituraDireta(db);
  await shot(page, 'ag-01-hoje');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('teclado: troca de visão com aria-pressed, abre o detalhe (foco no título) e Esc devolve o foco ao item', async () => {
  const { page, db, errors, context } = await newPage(browser, { db: { requests: dia1() } });
  await abrirAgenda(page);
  await page.focus('[data-view="hoje"]');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.view), 'dia');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#agMain .ag-grade');
  assert.equal(await page.getAttribute('[data-view="dia"]', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('[data-view="hoje"]', 'aria-pressed'), 'false');
  // item da grade: Enter abre o detalhe
  const sel = `#agMain [data-act="abrir"][data-item="${db.requests[0].items[0].id}"]`;
  await page.focus(sel);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#agDet:not([hidden]) .ag-dl');
  assert.equal(await focusId(page), 'agDetT');
  assert.match(await page.textContent('#agDetT'), /Maria <b>Souza<\/b> Lima/);
  assert.match(await page.textContent('#agDet'), /\(11\) 98888-7777/);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#agDet[hidden]', { state: 'attached' });
  assert.equal(await page.evaluate((s) => document.activeElement === document.querySelector(s), sel), true, 'o foco volta ao item');
  // Espaço também abre
  await page.keyboard.press(' ');
  await page.waitForSelector('#agDet:not([hidden]) .ag-dl');
  await page.click('#agDetFechar');
  assert.ok(db.accessLog >= 2, 'cada abertura do detalhe é uma leitura registrada');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Chegou: desligado antes da janela (06:59), às 10:00 marca, vira "Paciente presente" e o foco vai para "Em atendimento"', async () => {
  {
    const { page, errors, context } = await newPage(browser, { now: '2026-11-04T09:59:00Z', db: { requests: [booking({ start: sp(HOJE, '09:00') })] } });
    await abrirAgenda(page);
    const b = page.locator('#agMain [data-act="atender"][data-k="chegou"]');
    assert.equal(await b.isDisabled(), true);
    assert.match(await page.textContent('#agMain .ag-acoes'), /Chegada a partir das 07:00/);
    assert.deepEqual(errors, []);
    await context.close();
  }
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: [booking({ start: sp(HOJE, '10:30') })] } });
  await abrirAgenda(page);
  const r = db.requests[0];
  await page.click('#agMain [data-act="atender"][data-k="chegou"]');
  await page.waitForFunction(() => /Paciente presente/.test(document.querySelector('#agMain').textContent));
  const c = calls(log, 'agenda_attend').at(-1).body;
  assert.deepEqual(c, { p_id: r.id, p_status: 'checked_in', p_version: 1, p_item: r.items[0].id });
  assert.equal(await focusText(page), 'Em atendimento');
  assert.match(await page.textContent('#agMsg'), /Paciente presente/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Não compareceu: antes da tolerância desligado; depois, confirmação na tela; "Desfazer falta" pede o motivo', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { now: '2026-11-04T12:14:00Z', db: { requests: [booking({ start: sp(HOJE, '09:00') })] } });
  await abrirAgenda(page);
  assert.equal(await page.locator('[data-act="atender"][data-k="faltou"]').isDisabled(), true);
  assert.match(await page.textContent('#agMain'), /Disponível a partir das 09:15/);
  await context.clock.setFixedTime(new Date('2026-11-04T12:16:00Z'));
  db.now = Date.parse('2026-11-04T12:16:00Z');
  await page.click('[data-act="atualizar"]');
  await page.waitForFunction(() => !document.querySelector('[data-act="atender"][data-k="faltou"]')?.disabled);
  await page.click('[data-act="atender"][data-k="faltou"]');
  assert.equal(await focusId(page), 'agAskSim');
  assert.match(await page.textContent('#agAskT'), /Marcar que Maria L\. não compareceu \(04\/11, 09:00\)\?/);
  assert.equal(calls(log, 'agenda_attend').length, 0, 'nada antes de confirmar');
  await page.click('[data-act="voltar-ask"]');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.k), 'faltou', 'Voltar devolve o foco');
  await page.click('[data-act="atender"][data-k="faltou"]');
  await page.click('#agAskSim');
  await page.waitForFunction(() => /Não compareceu/.test(document.querySelector('#agMain .ag-st')?.textContent || ''));
  assert.match(await page.getAttribute('#agMain .ag-li', 'class'), /ag-tom-cinza/);
  // desfazer falta: sem motivo, erro e foco no campo
  await page.click('[data-act="atender"][data-k="desfazer"]');
  assert.equal(await focusId(page), 'agAskMotivo');
  await page.click('#agAskSim');
  assert.match(await page.textContent('#agAskMotivoErr'), /Escolha o motivo/);
  assert.equal(await focusId(page), 'agAskMotivo');
  await page.selectOption('#agAskMotivo', 'chegou_atrasado');
  await page.click('#agAskSim');
  await page.waitForFunction(() => /Paciente presente/.test(document.querySelector('#agMain').textContent));
  assert.equal(calls(log, 'agenda_attend').at(-1).body.p_reason, 'chegou_atrasado');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('version_conflict: mensagem clara e a agenda é lida de novo', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: [booking({ start: sp(HOJE, '10:30') })] } });
  await abrirAgenda(page);
  const antes = calls(log, 'agenda_view').length;
  db.once.agenda_attend = { status: 'version_conflict', version: 7 };
  await page.click('[data-act="atender"][data-k="chegou"]');
  await page.waitForFunction(() => /Outra pessoa mudou este agendamento/.test(document.querySelector('#agMsg').textContent));
  assert.ok(calls(log, 'agenda_view').length > antes, 'leu a agenda de novo');
  assert.equal(await page.getAttribute('#agMsg [role=alert]', 'role'), 'alert');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('novo agendamento pelo telefone: exame, dia, horário, paciente, aviso; erros com foco; o item aparece', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: dia1() } });
  await abrirAgenda(page);
  await page.click('#agNovo');
  assert.equal(await focusId(page), 'bkT');
  await page.selectOption('#bkProc', P_USG);
  assert.match(await page.textContent('#bkProcInfo'), /Jejum de 8 horas/);
  await page.click('#bkVer');
  await page.waitForSelector('input[name="bkSlot"]');
  assert.deepEqual(calls(log, 'agenda_desk_slots').at(-1).body, { p_clinic: C1, p_procedure: P_USG, p_from: HOJE });
  assert.match(await page.textContent('#bkSlots'), /Manhã/);
  await page.check(`input[name="bkSlot"][value="${sp(HOJE, '10:30')}"]`);
  await page.fill('#bkNome', 'Beatriz <b>Nova</b> Teste');
  await page.fill('#bkFone', '(11) 96666-5555');
  // sem o aviso: erro no campo e foco nele
  await page.click('#bkOk');
  assert.match(await page.textContent('#bkConsentErr'), /foi avisada/);
  assert.equal(await focusId(page), 'bkConsent');
  assert.equal(calls(log, 'agenda_desk_book').length, 0);
  await page.check('#bkConsent');
  await page.click('#bkOk');
  await page.waitForSelector('#bkFeito');
  const c = calls(log, 'agenda_desk_book').at(-1).body;
  assert.equal(c.p_clinic, C1);
  assert.deepEqual(c.p_items, [{ procedure_id: P_USG, starts_at: '2026-11-04T13:30:00.000Z' }]);
  assert.equal(c.p_channel, 'clinica_telefone');
  assert.match(c.p_key, /^[0-9a-f-]{36}$/);
  assert.deepEqual(c.p_patient, { name: 'Beatriz <b>Nova</b> Teste', phone: '11966665555', consent: true, for_other: false });
  assert.match(await page.textContent('#bkFeito'), /Agendado: Beatriz T\., Ultrassom de abdome <b>total<\/b>, qua\., 04\/11 às 10:30\./);
  assert.equal(await focusId(page), 'bkFeito');
  await page.waitForFunction(() => /Beatriz T\./.test(document.querySelector('#agMain').textContent));
  assert.equal(db.requests.length, 5);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('reenvio: a 1ª chamada falha na rede e a 2ª passa com a MESMA chave; um agendamento só', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { db: { failNet: { agenda_desk_book: 1 } } });
  await abrirAgenda(page);
  await page.click('#agNovo');
  await page.selectOption('#bkProc', P_USG);
  await page.click('#bkVer');
  await page.waitForSelector('input[name="bkSlot"]');
  await page.check(`input[name="bkSlot"][value="${sp(HOJE, '11:00')}"]`);
  await page.fill('#bkNome', 'Paciente Teste Um');
  await page.fill('#bkFone', '11955554444');
  await page.check('#bkConsent');
  await page.click('#bkOk');
  await page.waitForFunction(() => /Não foi possível falar com o servidor/.test(document.querySelector('#bkMsg')?.textContent || ''));
  await page.click('#bkOk');
  await page.waitForSelector('#bkFeito');
  const k = log.filter((e) => e.path === 'rpc/agenda_desk_book').map((e) => e.body.p_key);
  assert.equal(k.length, 2);
  assert.equal(k[0], k[1], 'a mesma chave nas duas tentativas');
  assert.equal(db.requests.length, 1, 'um agendamento só');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('slot_taken: até 5 horários como botões; escolher manda de novo com OUTRA chave', async () => {
  const { page, db, log, errors, context } = await newPage(browser);
  await abrirAgenda(page);
  await page.click('#agNovo');
  await page.selectOption('#bkProc', P_USG);
  await page.click('#bkVer');
  await page.waitForSelector('input[name="bkSlot"]');
  await page.check(`input[name="bkSlot"][value="${sp(HOJE, '11:00')}"]`);
  await page.fill('#bkNome', 'Paciente Teste Dois');
  await page.fill('#bkFone', '11955553333');
  await page.check('#bkConsent');
  db.once.agenda_desk_book = { status: 'slot_taken', seq: 1, alternatives: [sp(HOJE, '11:30'), sp(HOJE, '12:00'), sp(HOJE, '12:30'), sp(HOJE, '13:00'), sp(HOJE, '13:30'), sp(HOJE, '14:00')] };
  await page.click('#bkOk');
  await page.waitForSelector('[data-act="bk-alt"]');
  assert.equal(await page.locator('[data-act="bk-alt"]').count(), 5);
  assert.match(await page.textContent('#bkAltT'), /acabou de ser ocupado/);
  assert.equal(await focusText(page), 'Marcar às 11:30');
  await page.click('[data-act="bk-alt"] >> nth=1');
  await page.waitForSelector('#bkFeito');
  const k = log.filter((e) => e.path === 'rpc/agenda_desk_book');
  assert.notEqual(k[0].body.p_key, k[1].body.p_key, 'outra chave');
  assert.equal(k[1].body.p_items[0].starts_at, '2026-11-04T15:00:00.000Z');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('sem horário por feriados: o texto explica (feriados nacionais e os da cidade)', async () => {
  const { page, db, errors, context } = await newPage(browser, { db: { desk: { status: 'ok', timezone: 'America/Sao_Paulo', from: HOJE, to: HOJE, slots: [], holidays_checked_until: '2026-12-31', national_holidays_until: null } } });
  await abrirAgenda(page);
  await page.click('#agNovo');
  await page.selectOption('#bkProc', P_USG);
  await page.click('#bkVer');
  await page.waitForSelector('#bkSemHorario');
  assert.match(await page.textContent('#bkSemHorario'), /o IMED ainda não lançou os feriados nacionais/);
  db.desk = { ...db.desk, holidays_checked_until: null, national_holidays_until: '2026-12-31' };
  await page.click('#bkVer');
  await page.waitForFunction(() => /falta informar até quando a clínica conferiu os feriados/.test(document.querySelector('#bkSemHorario')?.textContent || ''));
  assert.match(await page.textContent('#bkSemHorario'), /Peça ao dono ou gestor/);
  db.desk = { ...db.desk, holidays_checked_until: '2026-11-03', national_holidays_until: '2026-12-31' };
  await page.click('#bkVer');
  await page.waitForFunction(() => /só foram conferidos até 03\/11\/2026/.test(document.querySelector('#bkSemHorario')?.textContent || ''));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('só ocupar: 14:00–15:00 vai com o fuso certo, aparece em vermelho com texto; liberar com confirmação', async () => {
  const { page, db, log, errors, context } = await newPage(browser);
  await abrirAgenda(page);
  await page.click('#agOcupar');
  assert.equal(await focusId(page), 'ocT');
  await page.selectOption('#ocRec', USG);
  await page.fill('#ocIni', '14:00');
  await page.fill('#ocFim', '15:00');
  await page.selectOption('#ocMotivo', 'agenda_propria');
  await page.click('#ocOk');
  await page.waitForFunction(() => /Ocupado \(agenda própria\)/.test(document.querySelector('#agMain').textContent));
  const c = calls(log, 'agenda_desk_busy').at(-1).body;
  assert.deepEqual(c, { p_clinic: C1, p_starts: '2026-11-04T17:00:00.000Z', p_ends: '2026-11-04T18:00:00.000Z', p_resource: USG, p_procedure: null, p_reason: 'agenda_propria' });
  assert.match(await page.getAttribute('#agMain [data-act="ocupado"]', 'class') + await page.evaluate(() => document.querySelector('#agMain [data-act="ocupado"]').closest('li').className), /ag-tom-vermelho/);
  await page.click('#agMain [data-act="ocupado"]');
  await page.click('#agLiberar');
  assert.equal(await focusId(page), 'agLiberarSim');
  await page.click('#agLiberarSim');
  await page.waitForFunction(() => !/Ocupado \(agenda própria\)/.test(document.querySelector('#agMain').textContent));
  assert.equal(calls(log, 'agenda_desk_busy_remove').length, 1);
  assert.equal(db.busy.length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('cancelar: sem motivo dá erro; com motivo, confirmação e o item some', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: [booking({ name: 'Carla Dias Teste', start: sp(HOJE, '16:00') })] } });
  await abrirAgenda(page);
  const r = db.requests[0];
  await page.click('#agMain [data-act="abrir"]');
  await page.waitForSelector('[data-act="cancelar"]');
  await page.click('[data-act="cancelar"]');
  assert.equal(await focusId(page), 'cnMotivo');
  await page.click('#cnOk');
  assert.match(await page.textContent('#cnMotivoErr'), /Escolha o motivo/);
  assert.equal(await focusId(page), 'cnMotivo');
  await page.selectOption('#cnMotivo', 'paciente_desistiu');
  await page.click('#cnOk');
  assert.equal(await focusId(page), 'cnSim');
  assert.match(await page.textContent('#cnAskT'), /Cancelar o agendamento de Carla T\. \(qua\., 04\/11 às 16:00\)\?/);
  await page.click('#cnSim');
  await page.waitForFunction(() => /cancelado/.test(document.querySelector('#agMsg').textContent));
  assert.deepEqual(calls(log, 'agenda_cancel').at(-1).body, { p_id: r.id, p_reason: 'paciente_desistiu', p_version: 1 });
  assert.match(await page.textContent('#agMain'), /Nenhum agendamento hoje/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('remarcar: dia, horários com p_request e p_item, confirmação "Mudar de … para …?" e agenda_reschedule', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: [booking({ name: 'Rui Mota Teste', start: sp(HOJE, '16:00') })] } });
  await abrirAgenda(page);
  const r = db.requests[0];
  await page.click('#agMain [data-act="abrir"]');
  await page.click('[data-act="remarcar"]');
  assert.equal(await focusId(page), 'rmT');
  await page.fill('#rmDia', AMANHA);
  await page.click('#rmVer');
  await page.waitForSelector('input[name="rmSlot"]');
  assert.deepEqual(calls(log, 'agenda_desk_slots').at(-1).body, { p_clinic: C1, p_procedure: P_USG, p_from: AMANHA, p_to: null, p_request: r.id, p_item: r.items[0].id });
  await page.check(`input[name="rmSlot"][value="${sp(AMANHA, '10:00')}"]`);
  assert.match(await page.textContent('#rmAskT'), /Mudar de qua\., 04\/11 às 16:00 para qui\., 05\/11 às 10:00\?/);
  await page.click('#rmOk');
  await page.waitForFunction(() => /Remarcado/.test(document.querySelector('#agMsg').textContent));
  const c = calls(log, 'agenda_reschedule').at(-1).body;
  assert.deepEqual({ ...c, p_key: 'x' }, { p_id: r.id, p_items: [{ seq: 1, starts_at: '2026-11-05T13:00:00.000Z' }], p_key: 'x', p_version: 1 });
  assert.match(c.p_key, /^[0-9a-f-]{36}$/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('bloquear com afetados: lista com nomes curtos, "Bloquear mesmo assim", Para remarcar e remarcar resolve o conflito', async () => {
  const reqs = [booking({ name: 'Maria Souza Lima', start: sp(AMANHA, '09:00') }), booking({ name: 'Otávio Reis Teste', phone: '11944443333', start: sp(AMANHA, '10:00'), channel: 'clinica_telefone' })];
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: reqs, busy: [{ id: 'bbbbbbbb-0000-4000-8000-000000000902', starts_at: sp(AMANHA, '11:00'), ends_at: sp(AMANHA, '11:30'), reason_code: 'agenda_propria', resources: [USG] }] } });
  await abrirAgenda(page);
  await page.click('#agBloquear');
  assert.equal(await focusId(page), 'blFormT');
  await page.selectOption('#blAlvo', USG);
  await page.selectOption('#blTipo', 'manutencao');
  await page.check('input[name="blModo"][value="part"]');
  await page.fill('#blFrom', AMANHA);
  await page.fill('#blStart', '08:00');
  await page.fill('#blEnd', '12:00');
  await page.fill('#blMotivo', 'Troca da sonda');
  await page.click('#blOk');
  await page.waitForSelector('#blAfet .ag-afet');
  assert.equal(await focusId(page), 'blAfetT');
  assert.match(await page.textContent('#blAfetT'), /atinge 2 agendamentos e 1 horário “só ocupar”/);
  assert.match(await page.textContent('#blAfet'), /Maria L\./);
  assert.match(await page.textContent('#blAfet'), /Para remarcar/);
  const prev = calls(log, 'agenda_block_force').at(-1).body;
  assert.equal(prev.p_confirm, null);
  assert.equal(prev.p_starts, '2026-11-05T11:00:00.000Z');
  await page.click('#blForcar');
  await page.waitForSelector('#agRemT');
  assert.match(await page.textContent('#agMsg'), /Bloqueio salvo\. 2 pacientes foram para a lista Para remarcar/);
  assert.equal(await focusId(page), 'agRemT');
  assert.match(await page.textContent('#agRemT'), /Para remarcar \(2\)/);
  assert.match(await page.textContent('#agRem'), /Horário bloqueado pela clínica/);
  // remarcar o primeiro → resolve o conflito
  await page.click('[data-act="conf-remarcar"] >> nth=0');
  await page.waitForSelector('#rmT');
  await page.fill('#rmDia', AMANHA);
  db.deskSlots = [{ start: sp(AMANHA, '15:00'), end: sp(AMANHA, '15:30') }];
  await page.click('#rmVer');
  await page.check('input[name="rmSlot"]');
  await page.click('#rmOk');
  await page.waitForFunction(() => /Remarcado/.test(document.querySelector('#agMsg').textContent));
  const k = calls(log, 'agenda_conflict_resolve').at(-1).body;
  assert.equal(k.p_status, 'resolvido');
  assert.equal(k.p_code, 'remarcado');
  assert.match(await page.textContent('#agRemT'), /Para remarcar \(1\)/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('affected_changed troca a lista (foco no título) e cannot_move não oferece "mesmo assim"', async () => {
  const reqs = [booking({ start: sp(AMANHA, '09:00') })];
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: reqs } });
  await abrirAgenda(page);
  await page.click('[data-view="bloqueios"]');
  await page.waitForSelector('#blForm');
  await page.fill('#blFrom', AMANHA);
  await page.click('#blOk');
  await page.waitForSelector('#blForcar');
  db.requests.push(booking({ name: 'Nova Pessoa Teste', start: sp(AMANHA, '13:00') }));
  await page.click('#blForcar');
  await page.waitForFunction(() => /A agenda mudou enquanto você conferia/.test(document.querySelector('#blAfet').textContent));
  assert.equal(await focusId(page), 'blAfetT');
  assert.match(await page.textContent('#blAfetT'), /atinge 2 agendamentos/);
  db.requests[0].items[0].status = 'checked_in';
  await page.click('#blForcar');
  await page.waitForFunction(() => /já presente, em atendimento/.test(document.querySelector('#blAfet').textContent));
  assert.equal(await page.locator('#blForcar').count(), 0, 'sem botão de forçar');
  await page.click('#blNao');
  assert.equal(await focusId(page), 'blFrom');
  assert.equal(calls(log, 'agenda_block_force').filter((c) => c.body.p_confirm).length, 2);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('bloqueio: mudar o período, o alvo ou o modo depois da prévia tira a lista e o "mesmo assim"; grava o que está na tela', async () => {
  const reqs = [booking({ name: 'Maria Souza Lima', start: sp(AMANHA, '09:00') }), booking({ name: 'Otávio Reis Teste', phone: '11944443333', start: sp(AMANHA, '10:00') })];
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: reqs } });
  await abrirAgenda(page);
  await page.click('#agBloquear');
  await page.selectOption('#blAlvo', USG);
  await page.check('input[name="blModo"][value="part"]');
  await page.fill('#blFrom', AMANHA);
  await page.fill('#blStart', '08:00');
  await page.fill('#blEnd', '12:00');
  await page.click('#blOk');
  await page.waitForSelector('#blForcar');
  assert.match(await page.textContent('#blAfetT'), /Bloqueio de qui\., 05\/11, das 08:00 às 12:00 em Aparelho de Ultrassom <b>1<\/b>: atinge 2 agendamentos\./, 'o título diz o período e o alvo');
  // muda o fim para poupar o das 10:00: a lista e o botão somem, com o aviso
  await page.fill('#blEnd', '09:30');
  assert.equal(await page.locator('#blForcar').count(), 0, 'sem "mesmo assim" depois de mudar');
  assert.match(await page.textContent('#blAfet'), /Você mudou o bloqueio/);
  await page.click('#blOk');
  await page.waitForSelector('#blForcar');
  assert.match(await page.textContent('#blAfetT'), /das 08:00 às 09:30 em .*: atinge 1 agendamento\./);
  // o motivo não muda quem é atingido: a lista fica
  await page.fill('#blMotivo', 'Troca da sonda');
  assert.equal(await page.locator('#blForcar').count(), 1, 'o motivo não tira a lista');
  // valor trocado sem evento (preenchimento automático): o "mesmo assim" confere o formulário e refaz a prévia
  const gravados = () => calls(log, 'agenda_block_force').filter((c) => c.body.p_confirm).length;
  await page.evaluate(() => { document.querySelector('#blEnd').value = '11:00'; });
  await page.click('#blForcar');
  await page.waitForFunction(() => /das 08:00 às 11:00/.test(document.querySelector('#blAfetT')?.textContent || ''));
  assert.equal(gravados(), 0, 'nada gravado com o período da prévia velha');
  assert.equal(await focusId(page), 'blAfetT');
  // trocar o alvo e trocar o modo também tiram a lista
  await page.selectOption('#blAlvo', '');
  assert.equal(await page.locator('#blForcar').count(), 0, 'trocar o alvo tira a lista');
  await page.selectOption('#blAlvo', USG);
  await page.click('#blOk');
  await page.waitForSelector('#blForcar');
  await page.check('input[name="blModo"][value="day"]');
  assert.equal(await page.locator('#blForcar').count(), 0, 'trocar o modo tira a lista');
  await page.check('input[name="blModo"][value="part"]');
  await page.fill('#blEnd', '09:30');
  await page.click('#blOk');
  await page.waitForSelector('#blForcar');
  await page.click('#blForcar');
  await page.waitForSelector('#agRemT');
  const f = calls(log, 'agenda_block_force').filter((c) => c.body.p_confirm).at(-1).body;
  assert.deepEqual([f.p_resource, f.p_starts, f.p_ends, f.p_kind, f.p_reason], [USG, '2026-11-05T11:00:00.000Z', '2026-11-05T12:30:00.000Z', 'bloqueio', 'Troca da sonda'], 'grava o que está na tela');
  assert.equal(gravados(), 1);
  assert.deepEqual(db.requests.map((r) => r.items[0].status), ['reschedule_requested', 'confirmed'], 'o das 10:00 não foi atingido');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('bloqueio de hoje, dia inteiro: começa agora; quem já começou não é atingido nem impede; só ele no período → bloqueia direto', async () => {
  // quarta, 10:00: Maria às 09:00 (ninguém marcou "Concluído"), João 09:45–10:15 em atendimento, Rui às 11:00
  const dia = () => [booking({ name: 'Maria Souza Lima', start: sp(HOJE, '09:00') }), booking({ name: 'João Pedro Teste', start: sp(HOJE, '09:45'), status: 'in_service' })];
  {
    const { page, db, log, errors, context } = await newPage(browser, { db: { requests: [...dia(), booking({ name: 'Rui Mota Teste', start: sp(HOJE, '11:00') })] } });
    await abrirAgenda(page);
    await page.click('#agBloquear');
    await page.selectOption('#blAlvo', USG);
    await page.fill('#blFrom', HOJE);
    assert.match(await page.textContent('#blHoje'), /Hoje o bloqueio começa agora \(10:00\): o que já começou não é atingido/);
    await page.click('#blOk');
    await page.waitForSelector('#blForcar');
    assert.equal(calls(log, 'agenda_block_add').at(-1).body.p_starts, '2026-11-04T13:00:00.000Z', 'começa agora (10:00), não às 00:00');
    assert.match(await page.textContent('#blAfetT'), /Bloqueio de qua\., 04\/11, das 10:00 até o fim do dia em .*: atinge 1 agendamento\./);
    assert.match(await page.textContent('#blAfet'), /Rui T\./);
    assert.doesNotMatch(await page.textContent('#blAfet'), /Maria|João/, 'quem já começou não aparece');
    await page.click('#blForcar');
    await page.waitForSelector('#agRemT');
    assert.deepEqual(db.requests.map((r) => r.items[0].status), ['confirmed', 'in_service', 'reschedule_requested']);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // só quem já começou está no período: não há quem avisar, bloqueia sem perguntar
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: dia() } });
  await abrirAgenda(page);
  await page.click('#agBloquear');
  await page.selectOption('#blAlvo', USG);
  await page.fill('#blFrom', HOJE);
  await page.click('#blOk');
  await page.waitForFunction(() => /Bloqueio salvo/.test(document.querySelector('#agMsg').textContent));
  assert.equal(calls(log, 'agenda_block_add').at(-1).body.p_starts, '2026-11-04T13:00:00.000Z');
  assert.equal(calls(log, 'agenda_block_force').filter((c) => c.body.p_confirm).length, 1, 'gravou com o código da prévia vazia');
  assert.equal(db.blocks.length, 1);
  assert.deepEqual(db.requests.map((r) => r.items[0].status), ['confirmed', 'in_service'], 'ninguém foi para remarcar');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('bloqueio sem resposta do servidor: confere se já foi salvo e não grava outro (Bloquear e "mesmo assim")', async () => {
  {
    // "Bloquear": grava, a resposta se perde e a conferência também falha; ao tentar de novo, acha o bloqueio
    const { page, db, log, errors, context } = await newPage(browser, { db: { lostReply: { agenda_block_add: 1 } } });
    await abrirAgenda(page);
    await page.click('[data-view="bloqueios"]');
    await page.waitForSelector('#blForm');
    await page.fill('#blFrom', AMANHA);
    db.failNet.agenda_blocks = 1;
    await page.click('#blOk');
    await page.waitForFunction(() => /O bloqueio pode já ter sido salvo/.test(document.querySelector('#agMsg').textContent));
    assert.equal(db.blocks.length, 1, 'gravou (só a resposta se perdeu)');
    await page.click('#blOk');
    await page.waitForFunction(() => /Este bloqueio já tinha sido salvo/.test(document.querySelector('#agMsg').textContent));
    assert.equal(db.blocks.length, 1, 'não gravou outro');
    assert.equal(calls(log, 'agenda_block_add').length, 1, 'nem chamou de novo');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // "mesmo assim": grava (o paciente vai para remarcar), a resposta se perde; a tela acha o bloqueio e mostra a lista
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: [booking({ start: sp(AMANHA, '09:00') })] } });
  await abrirAgenda(page);
  await page.click('#agBloquear');
  await page.fill('#blFrom', AMANHA);
  await page.click('#blOk');
  await page.waitForSelector('#blForcar');
  db.lostReply = { agenda_block_force: 1 };
  await page.click('#blForcar');
  await page.waitForFunction(() => /Este bloqueio já tinha sido salvo\. Se havia pacientes no período, eles estão na lista Para remarcar/.test(document.querySelector('#agMsg').textContent));
  assert.equal(db.blocks.length, 1);
  assert.equal(calls(log, 'agenda_block_force').filter((c) => c.body.p_confirm).length, 1);
  assert.match(await page.textContent('#agRemT'), /Para remarcar \(1\)/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('balcão sem resposta do servidor: aviso e agenda relida; a mesma chave no mesmo horário depois de "Ver horários"; o reenvio mostra o que o banco gravou', async () => {
  const slots = [{ start: sp(HOJE, '11:00'), end: sp(HOJE, '11:30') }, { start: sp(HOJE, '11:30'), end: sp(HOJE, '12:00') }]; // aparelho com 2 vagas
  const { page, db, log, errors, context } = await newPage(browser, { db: { lostReply: { agenda_desk_book: 1 }, deskSlots: slots } });
  await abrirAgenda(page);
  await page.click('#agNovo');
  await page.selectOption('#bkProc', P_USG);
  await page.click('#bkVer');
  await page.waitForSelector('input[name="bkSlot"]');
  await page.check(`input[name="bkSlot"][value="${sp(HOJE, '11:00')}"]`);
  await page.fill('#bkNome', 'Paciente Teste Um');
  await page.fill('#bkFone', '11955554444');
  await page.check('#bkConsent');
  const vistas = calls(log, 'agenda_view').length;
  await page.click('#bkOk');
  await page.waitForFunction(() => /O agendamento pode já ter sido gravado/.test(document.querySelector('#bkMsg')?.textContent || ''));
  assert.ok(calls(log, 'agenda_view').length > vistas, 'relê a agenda');
  assert.equal(db.requests.length, 1, 'gravou (só a resposta se perdeu)');
  await page.waitForFunction(() => /Paciente U\./.test(document.querySelector('#agMain').textContent));
  // "Ver horários" de novo e o MESMO horário, com outro nome digitado: a mesma chave, nada duplicado
  await page.click('#bkVer');
  await page.waitForSelector('input[name="bkSlot"]');
  await page.check(`input[name="bkSlot"][value="${sp(HOJE, '11:00')}"]`);
  await page.fill('#bkNome', 'Outro Nome Digitado');
  await page.click('#bkOk');
  await page.waitForSelector('#bkFeito');
  const k = calls(log, 'agenda_desk_book').map((c) => c.body.p_key);
  assert.equal(k.length, 2);
  assert.equal(k[0], k[1], 'a mesma chave para o mesmo exame e horário');
  assert.equal(db.requests.length, 1, 'um agendamento só');
  assert.match(await page.textContent('#bkFeito'), /já tinha sido registrado: Ultrassom de abdome <b>total<\/b>, qua\., 04\/11 às 11:00\. Abra o agendamento para conferir o paciente\./);
  assert.doesNotMatch(await page.textContent('#bkFeito'), /Outro/, 'não mostra o nome digitado agora');
  await page.click('#bkVerAg');
  await page.waitForSelector('#agDet .ag-dl');
  assert.match(await page.textContent('#agDetT'), /Paciente Teste Um/, 'o gravado');
  await page.click('#agDetFechar');
  assert.equal(await focusId(page), 'bkVerAg', 'o foco volta ao botão');
  // depois de uma resposta, outro horário vai com outra chave
  await page.click('#agForms [data-act="novo"]');
  await page.selectOption('#bkProc', P_USG);
  await page.click('#bkVer');
  await page.waitForSelector('input[name="bkSlot"]');
  await page.check(`input[name="bkSlot"][value="${sp(HOJE, '11:30')}"]`);
  await page.fill('#bkNome', 'Paciente Teste Dois');
  await page.fill('#bkFone', '11955553333');
  await page.check('#bkConsent');
  await page.click('#bkOk');
  await page.waitForSelector('#bkFeito');
  assert.notEqual(calls(log, 'agenda_desk_book').at(-1).body.p_key, k[0]);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('exame, aparelho ou sala desativado por outra pessoa: o texto certo, o catálogo relido e o seletor sem ele', async () => {
  const { page, db, log, errors, context } = await newPage(browser);
  await abrirAgenda(page);
  // "só ocupar" no aparelho que acabou de ser desativado
  await page.click('#agOcupar');
  await page.selectOption('#ocRec', USG);
  await page.fill('#ocIni', '14:00');
  await page.fill('#ocFim', '15:00');
  db.resources = db.resources.filter((r) => r.id !== USG);
  db.once.agenda_desk_busy = { status: 'not_found' };
  const cats = calls(log, 'agenda_catalog').length;
  await page.click('#ocOk');
  await page.waitForFunction(() => /não está mais ativo/.test(document.querySelector('#ocRecErr')?.textContent || ''));
  assert.ok(calls(log, 'agenda_catalog').length > cats, 'relê o catálogo');
  assert.equal(await page.locator(`#ocRec option[value="${USG}"]`).count(), 0, 'o aparelho saiu do seletor');
  assert.equal(await focusId(page), 'ocRec');
  assert.doesNotMatch(await page.textContent('#agRoot'), /agendamento não existe mais/);
  // balcão com o exame desativado
  await page.click('#agForms [data-act="fechar-form"]');
  await page.click('#agNovo');
  await page.selectOption('#bkProc', P_ECO);
  db.procedures = db.procedures.filter((x) => x.id !== P_ECO);
  db.once.agenda_desk_slots = { status: 'not_found' };
  await page.click('#bkVer');
  await page.waitForFunction(() => /O exame escolhido não está mais ativo/.test(document.querySelector('#bkProcErr')?.textContent || ''));
  assert.equal(await page.locator(`#bkProc option[value="${P_ECO}"]`).count(), 0, 'o exame saiu do seletor');
  assert.equal(await focusId(page), 'bkProc');
  // bloqueio de uma sala que foi desativada: "Escolha de novo" (nunca vira "A clínica inteira" sozinho)
  await page.click('#agForms [data-act="fechar-form"]');
  await page.click('#agBloquear');
  await page.selectOption('#blAlvo', SALA);
  await page.fill('#blFrom', AMANHA);
  db.resources = db.resources.filter((r) => r.id !== SALA);
  db.once.agenda_block_add = { status: 'not_found' };
  await page.click('#blOk');
  await page.waitForFunction(() => /não está mais ativo/.test(document.querySelector('#blAlvoErr')?.textContent || ''));
  assert.equal(await page.$eval('#blAlvo', (s) => s.selectedOptions[0].textContent), 'Escolha de novo');
  assert.equal(await focusId(page), 'blAlvo');
  const n = calls(log, 'agenda_block_add').length;
  await page.click('#blOk');
  assert.equal(calls(log, 'agenda_block_add').length, n, 'sem escolher de novo, não manda nada');
  assert.equal(db.blocks.length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('profissional: só a aba Agenda, só a coluna dele, sem marcar/bloquear/cancelar; detalhe sem telefone; Chegou chama agenda_attend', async () => {
  const reqs = [booking({ name: 'Ana Clara Rocha', start: sp(HOJE, '10:30'), proc: P_ECO, res: [DRA] }), booking({ start: sp(HOJE, '11:00') })];
  const { page, log, errors, context } = await newPage(browser, { role: 'professional', db: { requests: reqs } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-agenda');
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Agenda');
  await page.waitForSelector('#agMain .ag-lista');
  assert.equal(await page.locator('#agMain [data-act="abrir"]').count(), 1, 'só o exame dele');
  for (const s of ['#agNovo', '#agOcupar', '#agBloquear', '[data-view="bloqueios"]']) assert.equal(await page.locator(s).count(), 0, s);
  await page.click('[data-view="dia"]');
  await page.waitForSelector('#agMain .ag-grade');
  assert.equal(await page.locator('.ag-cab-col').count(), 1, 'uma coluna: a dele');
  await page.click('[data-view="hoje"]');
  await page.waitForSelector('#agMain [data-act="atender"]');
  await page.click('#agMain [data-act="atender"][data-k="chegou"]');
  await page.waitForFunction(() => /Paciente presente/.test(document.querySelector('#agMain').textContent));
  assert.equal(calls(log, 'agenda_attend').length, 1);
  assert.equal(calls(log, 'agenda_set_status').length, 0);
  await page.click('#agMain [data-act="abrir"]');
  await page.waitForSelector('#agDet .ag-dl');
  assert.doesNotMatch(await page.textContent('#agDet'), /3333-4444|Telefone/);
  assert.equal(await page.locator('#agDet [data-act="cancelar"], #agDet [data-act="remarcar"]').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
  // sem recurso ligado
  const s2 = await newPage(browser, { role: 'professional', db: { resources: RESOURCES().map((r) => ({ ...r, member: null })) } });
  await s2.page.goto(`${BASE}painel.html`);
  await s2.page.waitForSelector('#agTop .cl-note');
  assert.match(await s2.page.textContent('#agTop'), /Nenhum aparelho, sala ou profissional está ligado à sua conta/);
  assert.deepEqual(s2.errors, []);
  await s2.context.close();
});

await scenario('equipe do IMED: grade sem nomes; detalhe e pedidos pedem o motivo (fica registrado)', async () => {
  const { page, log, errors, context } = await newPage(browser, { role: null, admin: true, db: { requests: dia1() } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#clinicPick');
  await page.selectOption('#clinicPick', C1);
  await page.waitForSelector('#tab-agenda');
  await page.click('#tab-agenda');
  await page.waitForSelector('#agMain .ag-lista');
  assert.doesNotMatch(await page.textContent('#agMain'), /Maria|João/);
  assert.match(await page.textContent('#agMain'), /Paciente/);
  assert.equal(await page.locator('#agBusca').count(), 0, 'a equipe do IMED não busca paciente');
  await page.click('#agMain [data-act="abrir"] >> nth=0');
  await page.waitForSelector('#agJust');
  await page.click('#agJustOk');
  assert.match(await page.textContent('#agJustErr'), /Escolha o motivo/);
  await page.selectOption('#agJust', 'suporte_clinica');
  await page.click('#agJustOk');
  await page.waitForSelector('#agDet .ag-dl');
  assert.equal(calls(log, 'agenda_request_detail').at(-1).body.p_justification, 'suporte_clinica');
  await page.click('#tab-pedidos');
  await page.waitForSelector('#rqJust');
  assert.deepEqual(calls(log, 'agenda_requests').at(-1).body, { p_clinic: C1, p_when: null, p_justification: null });
  await page.selectOption('#rqJust', 'auditoria');
  await page.click('#rqJustOk');
  await page.waitForSelector('.rq-list');
  assert.deepEqual(calls(log, 'agenda_requests').at(-1).body, { p_clinic: C1, p_when: null, p_justification: 'auditoria' });
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (390 px): Hoje, Dia e Semana em lista; botões de 44 px; sem rolagem lateral; detalhe com "Voltar à agenda"', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, db: { requests: dia1() } });
  await abrirAgenda(page);
  for (const v of ['hoje', 'dia', 'semana', 'mes', 'bloqueios']) {
    await page.click(`[data-view="${v}"]`);
    await page.waitForSelector(v === 'mes' ? '#agMain .ag-mlista, #agMain .cl-help' : v === 'bloqueios' ? '#blForm' : '#agMain .ag-lista, #agMain .ag-wdia');
    assert.equal(await page.locator('#agMain .ag-grade').count(), 0, `${v}: sem grade no celular`);
    await noOverflow(page);
  }
  await page.click('[data-view="hoje"]');
  await page.waitForSelector('#agMain .ag-lista');
  const pequenos = await page.$$eval('.ag button, .ag .btn, .ag select, .ag input[type=date], .ag input[type=text], .ag summary', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.outerHTML.slice(0, 80)));
  assert.deepEqual(pequenos, [], 'alvos de toque com pelo menos 44 px');
  const letra = await page.$$eval('.ag input:not([type=checkbox]):not([type=radio]), .ag select', (els) => els.filter((e) => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.outerHTML.slice(0, 80)));
  assert.deepEqual(letra, [], 'letra de 16 px nos campos');
  await page.click('#agMain [data-act="abrir"] >> nth=0');
  await page.waitForSelector('#agDet .ag-dl');
  assert.match(await page.textContent('#agDetFechar'), /Voltar à agenda/);
  assert.equal(await page.isVisible('#agMain'), false, 'o detalhe ocupa a área da lista');
  await noOverflow(page);
  await shot(page, 'ag-17-celular-detalhe');
  await page.click('#agDetFechar');
  await page.waitForSelector('#agMain .ag-lista');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('fuso: clínica em Manaus vista de São Paulo: horários 1 h antes, aviso e bloqueio de dia inteiro com o fuso da clínica', async () => {
  const reqs = [booking({ start: sp(HOJE, '10:30') })];
  const { page, log, errors, context } = await newPage(browser, { tz: 'America/Manaus', db: { requests: reqs } });
  await abrirAgenda(page);
  assert.match(await page.textContent('#agTop .ag-tz'), /Horários no fuso da clínica \(uma hora a menos que Brasília\)/);
  assert.match((await nomesFalados(page, '#agMain [data-act="abrir"]'))[0], /^\|09:30 às 10:00, /);
  await page.click('[data-view="bloqueios"]');
  await page.waitForSelector('#blForm');
  await page.fill('#blFrom', AMANHA);
  await page.click('#blOk');
  await page.waitForFunction(() => /Bloqueio salvo/.test(document.querySelector('#agMsg').textContent));
  const c = calls(log, 'agenda_block_add').at(-1).body;
  assert.equal(c.p_starts, '2026-11-05T04:00:00.000Z');
  assert.equal(c.p_ends, '2026-11-06T04:00:00.000Z');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('banco sem as funções novas: a grade aparece sem "Livre", com a nota; sem "Novo agendamento"; nenhum erro', async () => {
  const { page, errors, context } = await newPage(browser, { missing: ['agenda_catalog', 'agenda_free', 'agenda_desk_slots', 'agenda_blocks', 'agenda_block_force', 'agenda_attend'], db: { requests: dia1() } });
  await abrirAgenda(page);
  assert.match(await page.textContent('#agTop'), /Esta parte da agenda ainda não está disponível/);
  assert.equal(await page.locator('#agNovo').count(), 0);
  await page.click('[data-view="dia"]');
  await page.waitForSelector('#agMain .ag-grade');
  assert.equal(await page.locator('.ag-livre').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('tema escuro: a mesma tela, legenda legível e cores pelos tokens', async () => {
  const { page, errors, context } = await newPage(browser, { theme: 'dark', db: { requests: dia1() } });
  await abrirAgenda(page);
  const cores = await page.$$eval('#agLegenda li', (l) => l.map((x) => [getComputedStyle(x).backgroundColor, getComputedStyle(x).color]));
  assert.ok(cores.every(([bg, fg]) => bg !== fg));
  const fundo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.notEqual(fundo, 'rgb(244, 248, 250)', 'fundo escuro');
  await page.click('[data-view="dia"]');
  await page.waitForSelector('#agMain .ag-grade');
  await shot(page, 'ag-20-escuro');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('mês e semana (computador): números do banco, clicar abre o dia; busca rápida com mínimo de 3 letras', async () => {
  const { page, log, errors, context } = await newPage(browser, { db: { requests: dia1() } });
  await abrirAgenda(page);
  await page.click('[data-view="mes"]');
  await page.waitForSelector('#agMain .ag-mes');
  assert.match((await nomesFalados(page, `[data-act="abrir-dia"][data-dia="${HOJE}"]`))[0], /^\|quarta-feira, 4 de novembro, (3 marcados · 1 concluído|3 marcados)/);
  await page.click(`[data-act="abrir-dia"][data-dia="${HOJE}"]`);
  await page.waitForSelector('#agMain .ag-grade');
  assert.equal(await page.getAttribute('[data-view="dia"]', 'aria-pressed'), 'true');
  await page.click('[data-view="semana"]');
  await page.waitForSelector('#agMain .ag-semana');
  assert.equal(calls(log, 'agenda_view').at(-1).body.p_from, '2026-11-02', 'a semana começa na segunda');
  await coresComTexto(page);
  await page.fill('#agBuscaQ', 'Ma');
  await page.click('#agBuscaOk');
  assert.match(await page.textContent('#agBuscaErr'), /pelo menos 3 letras/);
  assert.equal(calls(log, 'agenda_search').length, 0);
  await page.fill('#agBuscaQ', 'souza');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#agBuscaRes [data-act="abrir"]');
  assert.match(await page.textContent('#agBuscaRes'), /final do telefone 7777/);
  await page.click('#agBuscaRes [data-act="abrir"]');
  await page.waitForSelector('#agDet .ag-dl');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('sair da aba Agenda antes da resposta (bloqueio e chegada) não dá erro; ao voltar, a agenda já mostra o que mudou', async () => {
  const { page, db, errors, context } = await newPage(browser, { db: { requests: dia1(), delay: { agenda_block_add: 700, agenda_attend: 700 } } });
  await abrirAgenda(page);
  // bloqueio salvo e troca de aba antes da resposta
  await page.click('[data-view="bloqueios"]');
  await page.waitForSelector('#blForm');
  await page.fill('#blFrom', AMANHA);
  await page.click('#blOk');
  await page.click('#tab-pedidos');
  await page.waitForFunction(() => /Bloqueio salvo/.test(document.querySelector('#toast')?.textContent || ''));
  assert.equal(db.blocks.length, 1);
  assert.equal(await page.getAttribute('#tab-pedidos', 'aria-selected'), 'true', 'continua na aba escolhida');
  assert.equal(await page.locator('#agRoot').count(), 0, 'a agenda não desenha por cima da outra aba');
  await page.click('#tab-agenda');
  await page.waitForSelector('#agMain .ag-blsec');
  assert.match(await page.textContent('#agMain .ag-blsec'), /05\/11/);
  // chegada marcada e troca de aba antes da resposta
  await page.click('[data-view="hoje"]');
  await page.waitForSelector('#agMain .ag-lista');
  const ana = db.requests.find((r) => r.patient_name === 'Ana Clara Rocha');
  await page.click(`[data-act="atender"][data-k="chegou"][data-item="${ana.items[0].id}"][data-w="l"]`);
  await page.click('#tab-pedidos');
  await page.waitForFunction(() => /Paciente presente/.test(document.querySelector('#toast')?.textContent || ''));
  await page.click('#tab-agenda');
  await page.waitForSelector('#agMain .ag-lista');
  assert.match(await page.textContent(`#agi-${ana.items[0].id}`), /Paciente presente/);
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const falhas = results.filter(([r]) => r !== 'ok');
console.log(`\n${results.length - falhas.length}/${results.length} cenários ok`);
if (falhas.length) process.exit(1);
