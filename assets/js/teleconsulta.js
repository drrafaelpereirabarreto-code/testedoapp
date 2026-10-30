// Teleconsulta (paciente): quem atende agora, pedido com termo de consentimento, fila com a posição real,
// vídeo direto com o médico (WebRTC), plano B (telefone e mensagens), exames pedidos e resumo.
// Sem conta: o aparelho guarda {id, token} em localStorage 'imed_tele' (o banco só tem o SHA-256 do token).
// Regras e textos: tele-core.js. Contrato do banco: supabase/migrations/20261030070000_teleconsulta.sql.
import * as A from './auth.js';
import * as T from './tele-core.js';

T.ensureCompat();
const C = window.IMED_CONFIG || {};
const TELE = C.tele || {};
const ICE = T.iceServersFrom(C);
const PLAN_B_MS = Number(TELE.planBMs) > 0 ? Number(TELE.planBMs) : 25000; // vídeo sem conectar: plano B
const GATHER_MS = Number(TELE.gatherMs) > 0 ? Number(TELE.gatherMs) : 4000;
const SLOW_MS = Number(TELE.slowMs) > 0 ? Number(TELE.slowMs) : 60000;     // resumo: o médico ainda pode complementar
const SITE = C.siteUrl || new URL('./', location.href).href;
const DAY = 24 * 3600e3;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = T.esc;
const store = (() => { try { return window.localStorage; } catch { return null; } })();
const within24 = (t) => { const x = Date.parse(t || ''); return Number.isFinite(x) && Date.now() - x < DAY; };

const S = {
  cur: null, row: null, rowAt: 0, view: null, hist: false,
  msgs: [], lastMsg: 0, shownMsg: 0,
  local: null, mediaTried: false, flow: null,
  peer: null, answered: 0, failedVersion: 0, answering: false,
  connected: false, planBTimer: 0, dropTimer: 0, left: false, phoneAt: null,
  docKey: null, formOpen: false, sending: false, touched: false, wake: null, flipping: false, endKey: '',
};
const P = () => ({ p_id: S.cur.id, p_token: S.cur.token });

/* ======================= telas ======================= */
const VIEWS = { start: '#vStart', wait: '#vWait', call: '#vCall', end: '#vEnd', gone: '#vGone' };
const TITLES = {
  start: 'Teleconsulta | IMED', wait: 'Na fila · Teleconsulta | IMED', call: 'Em consulta · Teleconsulta | IMED',
  end: 'Consulta encerrada · Teleconsulta | IMED', gone: 'Teleconsulta | IMED',
};
function show(v) {
  const first = S.view == null;
  if (S.view === v) return;
  S.view = v;
  document.body.dataset.view = v;
  $('#boot')?.remove();
  for (const [k, sel] of Object.entries(VIEWS)) $(sel).hidden = k !== v;
  $('#prepCard').hidden = !(v === 'start' || v === 'wait');
  $('#histCard').hidden = v !== 'start' || !T.readHistory(store).length;
  document.title = TITLES[v];
  if (v === 'start') docsPoll.start(); else docsPoll.stop();
  if (v !== 'start' && v !== 'wait') stopTest();
  keepAwake(v === 'wait' || v === 'call');
  if (!first) $(`${VIEWS[v]} h2[tabindex]`)?.focus();
}
let flashTimer = 0;
function flash(text, kind = 'info') {
  const f = $('#flash');
  f.textContent = text;
  f.className = `tl-flash ${kind}`;
  f.hidden = !text;
  clearTimeout(flashTimer);
  if (text) flashTimer = setTimeout(() => { f.hidden = true; }, 12000);
}
let toastTimer = 0;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
}
const setNet = (bad) => { $('#netNote').hidden = !bad; };

// Tela ligada na fila e na chamada: com a tela apagada o celular congela a página e o paciente não ouve o médico
// chamar (Wake Lock: Chrome Android 84+, Safari iOS 16.4+; sem suporte, o texto da fila pede para deixar ligada).
async function keepAwake(on) {
  if (!on) {
    const w = S.wake;
    S.wake = null;
    try { await w?.release(); } catch { /* já liberada */ }
    return;
  }
  if (S.wake || document.hidden || !navigator.wakeLock?.request) return;
  try {
    const w = await navigator.wakeLock.request('screen');
    if (!(S.view === 'wait' || S.view === 'call')) { w.release().catch(() => {}); return; }
    S.wake = w;
    w.addEventListener?.('release', () => { if (S.wake === w) S.wake = null; });
  } catch { S.wake = null; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(S.view === 'wait' || S.view === 'call'); });

/* ======================= quem atende agora ======================= */
const cfmLink = '<a class="link" href="https://portal.cfm.org.br/busca-medicos/" target="_blank" rel="noopener">conferir no CFM<span class="sr"> (abre em outra aba)</span></a>';
function doctorCard(d, { cfm = true } = {}) {
  if (!d) return '';
  const spec = T.doctorSpecialty(d);
  return `<span class="tl-doc-ic" aria-hidden="true"><i class="fa-solid fa-user-doctor"></i></span>
    <div><b class="tl-doc-name">${esc(d.full_name)}</b><span>${esc(T.doctorCrm(d))}${spec ? ` · ${esc(spec)}` : ''}</span>
    ${cfm ? `<small>Médico com identidade e CRM conferidos pela equipe do IMED · ${cfmLink}</small>` : ''}</div>`;
}
async function loadDocs() {
  let rows = null;
  try { rows = await A.rpc('tele_doctors_online'); } catch { rows = null; }
  renderDocs(Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : null);
}
const docsPoll = T.createPoller({ run: loadDocs, interval: 30000 });
function renderDocs(rows) {
  // Só mexe na tela (e no leitor de tela: #docs é aria-live) quando a lista muda.
  const key = rows ? JSON.stringify(rows) : 'erro';
  if (key === S.docKey) return;
  S.docKey = key;
  const box = $('#docs');
  if (!rows) {
    S.docCount = null;
    box.innerHTML = '<p class="tl-muted">Não foi possível verificar agora quem está atendendo. Você pode fazer o pedido: se houver médico, ele atende pela ordem da fila.</p>';
    $('#noDoc').hidden = true;
    openForm(false);
    return;
  }
  S.docCount = rows.length;
  if (!rows.length) {
    box.innerHTML = '<p class="tl-off"><i class="fa-solid fa-user-clock" aria-hidden="true"></i><b>Nenhum médico atendendo agora.</b></p>';
    $('#noDoc').hidden = false;
    // Esconde o pedido só se a pessoa ainda não começou a preencher (o médico pode ter saído no meio).
    const pristine = !$('#fName').value && !$('#fReason').value && !$('#fPhone').value;
    if (!S.formOpen && pristine) $('#formCard').hidden = true;
    return;
  }
  const n = rows.length >= 50 ? '50 ou mais médicos atendendo agora' : rows.length === 1 ? '1 médico atendendo agora' : `${rows.length} médicos atendendo agora`;
  box.innerHTML = `<p class="tl-on"><span class="tl-dot" aria-hidden="true"></span><b>${n}</b></p>
    <ul class="tl-doclist">${rows.map((d) => `<li class="tl-doctor">${doctorCard(d, { cfm: false })}</li>`).join('')}</ul>
    <p class="tl-muted">Você é atendido pelo primeiro médico livre, na ordem da fila. O nome e o CRM de quem atender aparecem antes do vídeo. Pode ${cfmLink}.</p>
    <a class="btn btn-coral tl-cta" href="#formCard" id="ctaForm"><i class="fa-solid fa-video" aria-hidden="true"></i>Pedir teleconsulta</a>`;
  $('#noDoc').hidden = true;
  openForm(false);
}
function openForm(focus) {
  S.formOpen = S.formOpen || focus;
  $('#formCard').hidden = false;
  if (focus) $('#formTitle').focus();
}

/* ======================= lista de espera (igual à página inicial) ======================= */
function setupWaitlist() {
  const f = $('#wlForm');
  const msg = $('#wlMsg');
  const btn = $('#wlBtn');
  const say = (t, cls) => { msg.textContent = t; msg.className = `tl-msg ${cls}`; };
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#wlEmail').value.trim().toLowerCase();
    const city = $('#wlCity').value.trim();
    const bad = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254;
    $('#wlEmail').setAttribute('aria-invalid', String(bad));
    if (bad) { say('Digite um e-mail válido.', 'err'); $('#wlEmail').focus(); return; }
    const ok = () => { f.reset(); say('Pronto! Você está na lista e vai receber os avisos da teleconsulta no seu e-mail.', 'ok'); btn.disabled = false; };
    if (f.elements.namedItem('website').value) { ok(); return; }
    btn.disabled = true;
    say('Enviando…', '');
    const row = { email, city: city || null, interest: $('#wlNews').checked ? 'ambos' : 'teleconsulta' };
    (window.imedInsert ? window.imedInsert('app_waitlist', row) : Promise.reject(new Error('db.js'))).then(ok).catch(() => {
      say('Não foi possível enviar agora. Verifique sua internet e tente de novo.', 'err');
      btn.disabled = false;
    });
  });
  $('#anywayBtn').addEventListener('click', () => openForm(true));
}

/* ======================= formulário ======================= */
const FIELDS = {
  requester: ['#fReq', '#eReq'], relationship: ['#fRel', '#eRel'], agrees: ['#fAgrees', '#eAgrees'], name: ['#fName', '#eName'], birth: ['#fBirth', '#eBirth'],
  phone: ['#fPhone', '#ePhone'], reason: ['#fReason', '#eReason'], alerts: ['#fNone', '#eAlerts'], minor: ['#whoOther', '#eMinor'],
  guardian: ['#fGuardian', '#eGuardian'], consent: ['#fConsent', '#eConsent'],
};
const FOCUS_ORDER = ['requester', 'relationship', 'name', 'birth', 'phone', 'minor', 'guardian', 'agrees', 'reason', 'alerts', 'consent'];
function readForm() {
  const f = $('#reqForm');
  return {
    who: f.elements.namedItem('who').value,
    requester: $('#fReq').value, relationship: $('#fRel').value, agrees: $('#fAgrees').checked,
    name: $('#fName').value, birth: $('#fBirth').value, phone: $('#fPhone').value, reason: $('#fReason').value,
    alerts: $$('input[name="alert"]:checked', f).map((i) => i.value), none: $('#fNone').checked,
    guardian: $('#fGuardian').checked, consent: $('#fConsent').checked,
  };
}
function showErrors(errors, only = null) {
  for (const [k, [inp, out]] of Object.entries(FIELDS)) {
    if (only && !only.includes(k)) continue;
    const msg = k === 'alerts' && errors.alerts === 'emergencia' ? '' : (errors[k] || '');
    $(out).textContent = msg;
    const el = $(inp);
    if (el) {
      el.setAttribute('aria-invalid', msg ? 'true' : 'false');
      el.closest('.fld, .consent, fieldset')?.classList.toggle('bad', !!msg);
    }
  }
}
// Mostra o quadro do menor de idade, o aceite do responsável e a concordância do paciente adulto conforme a data de
// nascimento. Para menor, só a mãe, o pai ou o responsável legal podem pedir (as outras opções ficam desativadas).
function updateMinor() {
  const v = readForm();
  const r = T.validateRequest(v);
  const box = $('#minorBox');
  box.hidden = !r.minor;
  $('#guardianBox').hidden = !(r.minor && v.who === 'other');
  $('#agreesBox').hidden = !(v.who === 'other' && !r.minor);
  const rel = $('#fRel');
  for (const o of rel.options) if (o.value) o.disabled = r.minor && !T.GUARDIAN_RELATIONSHIPS.includes(o.value);
  if (r.minor && rel.value && !T.GUARDIAN_RELATIONSHIPS.includes(rel.value)) rel.value = '';
  $('#hRel').hidden = !r.minor;
  if (!r.minor) { $('#eMinor').textContent = ''; $('#eGuardian').textContent = ''; }
  else if (v.who === 'other') $('#eMinor').textContent = '';
  return r;
}
function showSos(ids) {
  const box = $('#sosBox');
  const cvv = T.alertNeedsCvv(ids);
  box.hidden = !ids.length;
  $('#sosCvv').hidden = !cvv;
  $('#sosCvvBtn').hidden = !cvv;
  $('#goBtn').disabled = !!ids.length;
  return !!ids.length;
}
function setupForm() {
  const f = $('#reqForm');
  $('#fRel').insertAdjacentHTML('beforeend', T.RELATIONSHIPS.map((r) => `<option>${esc(r)}</option>`).join(''));
  $('#alertList').innerHTML = T.ALERTS.map((a) => `<li><label class="tl-check"><input type="checkbox" name="alert" value="${esc(a.id)}"><span>${esc(a.label)}</span></label></li>`).join('');
  $('#fBirth').max = T.todaySP();
  f.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'who') { $('#otherBox').hidden = t.value !== 'other'; updateMinor(); }
    if (t.id === 'fBirth') updateMinor();
    if (t.name === 'alert') {
      if (t.checked) $('#fNone').checked = false;
      const ids = readForm().alerts;
      if (showSos(ids) && t.checked) $('#sosBox').scrollIntoView({ block: 'nearest' });
      showErrors({}, ['alerts']);
    }
    if (t.id === 'fNone' && t.checked) {
      $$('input[name="alert"]', f).forEach((i) => { i.checked = false; });
      showSos([]);
      showErrors({}, ['alerts']);
    }
  });
  $('#fBirth').addEventListener('input', updateMinor);
  $('#fPhone').addEventListener('input', (e) => {
    const el = e.target;
    const d = T.onlyDigits(el.value);
    if (!el.value.trim().startsWith('+') && d.length <= 11) el.value = T.maskPhone(d);
  });
  $('#fReason').addEventListener('input', () => { $('#reasonCount').textContent = String($('#fReason').value.length); });
  f.addEventListener('submit', submit);
}
// Pede a fila. O código do aparelho é guardado ANTES de pedir: se a resposta se perder (3G, tempo esgotado), o novo
// envio usa o mesmo código e o banco devolve a mesma consulta, em vez de dizer que o celular já está na fila.
async function request(args) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let pend = T.readPending(store);
    if (!pend) { pend = { token: T.newToken(), at: new Date().toISOString() }; T.writePending(store, pend); }
    try {
      const id = await A.rpc('tele_request', { ...args, p_token_hash: await T.sha256Hex(pend.token) });
      if (!T.isUuid(id)) throw new Error('resposta inesperada');
      return { id: String(id), token: pend.token };
    } catch (ex) {
      const { code, details } = T.errorInfo(ex);
      // Código de uma consulta que já terminou: troca o código e tenta uma vez de novo.
      if (code === 'dados_invalidos' && details === 'token' && attempt === 0) { T.writePending(store, null); continue; }
      throw ex;
    }
  }
  throw new Error('sem resposta');
}
async function submit(e) {
  e.preventDefault();
  const btn = $('#goBtn');
  const err = $('#formErr');
  err.classList.remove('show');
  const v = readForm();
  const r = updateMinor();
  if (r.errors.alerts === 'emergencia') { showSos(v.alerts); $('#sosBox').focus(); return; }
  showErrors(r.errors);
  if (!r.ok) {
    err.textContent = 'Confira os campos marcados.';
    err.classList.add('show');
    const k = FOCUS_ORDER.find((x) => r.errors[x]);
    if (k) $(FIELDS[k][0])?.focus();
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Entrando na fila…';
  try {
    const got = await request(r.args);
    S.cur = { id: got.id, token: got.token, at: new Date().toISOString() };
    T.writeCurrent(store, S.cur);
    T.writePending(store, null);
    $('#reqForm').reset();
    $('#otherBox').hidden = true;
    $('#minorBox').hidden = true;
    $('#agreesBox').hidden = true;
    $('#reasonCount').textContent = '0';
    showSos([]);
    flash('', 'info');
    begin();
  } catch (ex) {
    const { code, details } = T.errorInfo(ex);
    if (code === 'emergencia') { showSos(v.alerts.length ? v.alerts : ['peito']); $('#sosBox').focus(); }
    else if ((code === 'dados_invalidos' || code === 'sem_consentimento') && T.PATIENT_FIELD[details]) {
      const k = T.PATIENT_FIELD[details];
      showErrors({ [k]: T.errorText(code, details) }, [k]);
      $(FIELDS[k][0])?.focus();
    } else if (code === 'menor_sem_responsavel') { $('#minorBox').hidden = false; showErrors({ minor: T.errorText(code) }, ['minor']); }
    else if (code === 'sem_consentimento') { showErrors({ consent: T.errorText(code) }, ['consent']); $('#fConsent').focus(); }
    else { err.textContent = T.errorText(code, details); err.classList.add('show'); }
  } finally {
    btn.disabled = !!readForm().alerts.length;
    btn.innerHTML = '<i class="fa-solid fa-video" aria-hidden="true"></i>Entrar na fila';
  }
}

/* ======================= consulta: situação ======================= */
// Na fila e na chamada a página continua consultando com a aba escondida (no computador os timers seguem; no
// celular, a tela ligada mantém a página viva). No resumo, consulta devagar (o médico ainda pode complementar).
const statusPoll = T.createPoller({ run: pollStatus, interval: 3000, hiddenInterval: 10000 });
function begin() {
  S.msgs = []; S.lastMsg = 0; S.row = null; S.answered = 0; S.failedVersion = 0; S.left = false; S.connected = false; S.phoneAt = null; S.endKey = '';
  renderMsgs(true);
  statusPoll.stop();
  statusPoll.setInterval(3000);
  statusPoll.setHidden(10000);
  statusPoll.start();
}
async function pollStatus() {
  if (!S.cur) { statusPoll.stop(); return; }
  const cur = S.cur;
  let rows;
  try { rows = await A.rpc('tele_status', P()); } catch { setNet(true); return; }
  setNet(false);
  if (S.cur !== cur) return;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) { lostConsult(); return; }
  S.rowAt = Date.now();
  await onStatus(row);
  if (['accepted', 'in_call', 'ended'].includes(row.status) || row.accepted_at) await pollMessages();
}
function lostConsult() {
  statusPoll.stop();
  finishCall();
  if (!S.hist) T.writeCurrent(store, null);
  else T.removeHistory(store, S.cur.id);
  S.cur = null; S.hist = false;
  show('start');
  flash('Não encontramos a sua teleconsulta neste aparelho. Se precisar, faça um novo pedido.', 'warn');
}
async function onStatus(row) {
  const prev = S.row?.status;
  S.row = row;
  switch (row.status) {
    case 'waiting':
      renderWait(row);
      show('wait');
      statusPoll.setInterval(3000);
      statusPoll.setHidden(10000);
      break;
    case 'accepted':
    case 'in_call':
      if (S.view !== 'call') enterCall(prev === 'waiting');
      renderCall(row);
      statusPoll.setInterval(S.connected ? 4000 : 2000);
      statusPoll.setHidden(4000);
      handleOffer(row);
      break;
    case 'ended':
      if (S.view === 'call') finishCall();
      if (!S.hist) T.archive(store, S.cur, { doctor: row.doctor?.full_name || null });
      renderEnd(row);
      show('end');
      slowOrStop(row.ended_at || row.started_at || row.accepted_at);
      break;
    default:
      if (S.view === 'call') finishCall();
      // Aceita e depois expirou/cancelou: o médico ainda pode registrar orientações e exames (até 24 h).
      if (row.accepted_at && !S.hist) T.archive(store, S.cur, { doctor: row.doctor?.full_name || null });
      renderGone(row);
      show('gone');
      if (row.accepted_at) slowOrStop(row.accepted_at); else statusPoll.stop();
  }
}
// Continua consultando a cada minuto (pausado com a aba escondida) enquanto o médico ainda pode complementar.
function slowOrStop(since) {
  if (within24(since)) { statusPoll.setInterval(SLOW_MS); statusPoll.setHidden(null); } else statusPoll.stop();
}

/* ======================= fila ======================= */
function renderWait(row) {
  const pos = Number(row.position);
  $('#posNum').textContent = Number.isInteger(pos) && pos > 0 ? `${pos}º` : '…';
  const pt = T.positionText(pos);
  if ($('#posText').textContent !== pt) $('#posText').textContent = pt;
  const n = Number(row.doctors_online) || 0;
  const t0 = Date.parse(row.created_at);
  const until = Number.isFinite(t0) ? T.fmtTime(new Date(t0 + 2 * 3600e3).toISOString()) : '';
  const html = n > 0
    ? `<i class="fa-solid fa-circle tl-dot-on" aria-hidden="true"></i>${n === 1 ? 'Há 1 médico atendendo agora.' : `Há ${n} médicos atendendo agora.`}`
    : `<i class="fa-solid fa-user-clock" aria-hidden="true"></i>Nenhum médico atendendo agora. Você continua na fila${until ? ` até as ${esc(until)}` : ''}; se ninguém atender até lá, o pedido expira.`;
  if ($('#waitDocs').innerHTML !== html) $('#waitDocs').innerHTML = html;
  $('#waitSince').textContent = row.created_at ? `Pedido feito às ${T.fmtTime(row.created_at)}. Código: ${T.consultCode(S.cur.id)}.` : '';
}
function setupWait() {
  $('#leaveBtn').addEventListener('click', () => { $('#leaveConfirm').hidden = false; $('#leaveYes').focus(); });
  $('#leaveNo').addEventListener('click', () => { $('#leaveConfirm').hidden = true; $('#leaveBtn').focus(); });
  $('#leaveYes').addEventListener('click', () => cancelConsult('Você saiu da fila.'));
  $('#giveUpBtn').addEventListener('click', () => { $('#giveUpConfirm').hidden = false; $('#giveUpYes').focus(); });
  $('#giveUpNo').addEventListener('click', () => { $('#giveUpConfirm').hidden = true; $('#giveUpBtn').focus(); });
  $('#giveUpYes').addEventListener('click', () => {
    if ($('#giveUpBox').dataset.mode === 'end') endConsult(); else cancelConsult('Você desistiu da consulta.');
  });
}
async function cancelConsult(text) {
  const btns = [$('#leaveYes'), $('#giveUpYes')];
  btns.forEach((b) => { b.disabled = true; });
  try {
    await A.rpc('tele_cancel', P());
    statusPoll.stop();
    finishCall();
    // Aceita antes de desistir: guarda no aparelho (se o médico registrar algo, aparece em "Suas teleconsultas").
    if (S.row?.accepted_at) T.archive(store, S.cur, { doctor: S.row.doctor?.full_name || null });
    T.writeCurrent(store, null);
    S.cur = null; S.row = null;
    $('#leaveConfirm').hidden = true; $('#giveUpConfirm').hidden = true;
    renderHist();
    show('start');
    flash(`${text} Se precisar, faça um novo pedido.`, 'ok');
  } catch (ex) {
    const { code } = T.errorInfo(ex);
    toast(code === 'estado_invalido' ? 'A consulta já começou. Para sair, use “Encerrar a consulta”.' : T.errorText(code));
    $('#leaveConfirm').hidden = true; $('#giveUpConfirm').hidden = true;
    statusPoll.now();
  } finally {
    btns.forEach((b) => { b.disabled = false; });
  }
}
// Encerrar a consulta já começada (direito do paciente: termo, item 3). O médico ainda registra em até 24 h.
async function endConsult() {
  const b = $('#giveUpYes');
  b.disabled = true;
  try {
    await A.rpc('tele_patient_end', P());
    $('#giveUpConfirm').hidden = true;
    statusPoll.now();
  } catch (ex) {
    const { code } = T.errorInfo(ex);
    toast(code === 'estado_invalido' ? 'A consulta mudou de situação. Confira e tente de novo.' : T.errorText(code));
    $('#giveUpConfirm').hidden = true;
    statusPoll.now();
  } finally {
    b.disabled = false;
  }
}

/* ======================= chamada ======================= */
function enterCall(fromQueue) {
  show('call');
  S.left = false; S.connected = false; S.flow = null;
  $('#leftBox').hidden = true; $('#stage').hidden = false; $('#ctrls').hidden = false;
  stageMsg('Aguardando o vídeo do médico…');
  $('#planB').hidden = true;
  $('#phoneNote').hidden = true;
  $('#retryBtn').hidden = true;
  setState('O médico aceitou a sua consulta. Preparando o vídeo…');
  if (fromQueue) { document.title = 'Médico chamando! · Teleconsulta | IMED'; ring(); }
  armPlanB();
  claimCall().then((ok) => { if (ok) ensureMedia(); });
}
// Só uma aba (ou janela) deste aparelho cuida do vídeo: duas abas respondendo ao médico fariam a conexão
// recomeçar sem parar. As outras mostram um aviso (Web Locks; sem suporte, segue normalmente).
let lockRelease = null;
let lockPending = null;
function claimCall() {
  const id = S.cur?.id;
  if (!id) return Promise.resolve(false);
  if (S.lock === true && S.lockId === id) return Promise.resolve(true);
  if (lockPending) return lockPending; // um pedido de cada vez: senão a página disputaria com ela mesma
  if (!navigator.locks?.request) { S.lock = true; S.lockId = id; return Promise.resolve(true); }
  lockPending = new Promise((resolve) => {
    navigator.locks.request(`imed_tele_${id}`, { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return undefined; }
      resolve(true);
      return new Promise((r) => { lockRelease = r; });
    }).catch(() => resolve(true));
  }).then((ok) => {
    lockPending = null;
    if (S.cur?.id !== id) { if (ok) { lockRelease?.(); lockRelease = null; } return false; }
    S.lock = ok;
    S.lockId = ok ? id : null;
    $('#otherTab').hidden = ok;
    if (!ok) { $('#stage').hidden = true; $('#ctrls').hidden = true; $('#giveUpBox').hidden = true; setState('Esta consulta está aberta em outra aba ou janela deste aparelho.'); }
    else if (!S.left) { $('#stage').hidden = false; $('#ctrls').hidden = false; }
    return ok;
  });
  return lockPending;
}
function releaseCall() {
  lockRelease?.();
  lockRelease = null;
  S.lock = undefined;
  S.lockId = null;
  $('#otherTab').hidden = true;
}
// Avisa que o médico chamou: vibra e toca um bipe (só depois de a pessoa ter tocado na página). Com a aba
// escondida, repete por até 30 s para chamar a atenção.
function beep() {
  try { navigator.vibrate?.([300, 120, 300]); } catch { /* sem vibração */ }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    ctx.resume?.().catch(() => {});
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.35);
    o.onended = () => ctx.close().catch(() => {});
  } catch { /* sem som */ }
}
function ring() {
  if (!(navigator.userActivation ? navigator.userActivation.hasBeenActive : S.touched)) return;
  beep();
  let n = 0;
  const again = () => {
    if (n++ >= 10 || S.view !== 'call' || S.connected || !document.hidden) return;
    beep();
    setTimeout(again, 3000);
  };
  setTimeout(again, 3000);
}
function setState(t) { const el = $('#callState'); if (el.textContent !== t) el.textContent = t; }
function stageMsg(t) { $('#stageText').textContent = t; $('#stageMsg').hidden = !t; }
let docKey = '';
function renderCall(row) {
  const key = JSON.stringify(row.doctor || null);
  if (key !== docKey) { docKey = key; $('#callDoctor').innerHTML = doctorCard(row.doctor); }
  renderExit(row);
  const exams = Array.isArray(row.exams) && row.exams.length;
  const box = $('#callExams');
  const html = exams ? examsHtml(row, 'callExamsTitle', { newTab: true }) : '';
  if (box.dataset.html !== html) {
    const isNew = !box.dataset.html && !!html;
    box.dataset.html = html;
    box.innerHTML = html;
    box.hidden = !html;
    if (isNew) toast('O médico enviou o pedido de exames.');
  }
  // O médico tocou em "Ligar": mostra o plano B com a hora da ligação (pode vir de um número desconhecido).
  if (row.phone_call_at && row.phone_call_at !== S.phoneAt) {
    const first = !S.phoneAt;
    S.phoneAt = row.phone_call_at;
    $('#phoneNote').textContent = `O médico ligou para o seu celular às ${T.fmtTime(row.phone_call_at)}. Atenda: a ligação pode vir de um número que você não conhece.`;
    $('#phoneNote').hidden = false;
    if (!S.connected && !S.left && S.lock !== false) showPlanB();
    if (first) toast('O médico está ligando para o seu celular.');
  }
  const planB = !$('#planB').hidden;
  if (!row.offer_sdp && !S.connected && !S.left && S.lock !== false && !planB) setState('O médico aceitou a sua consulta. Aguarde: ele vai iniciar o vídeo.');
}
// "Desistir" antes de o atendimento começar; "Encerrar a consulta" depois (vídeo, ligação ou mensagem do médico).
function renderExit(row) {
  const mode = S.lock === false ? null : T.patientExit(row);
  const box = $('#giveUpBox');
  box.hidden = !mode;
  if (!mode || box.dataset.mode === mode) return;
  box.dataset.mode = mode;
  const end = mode === 'end';
  $('#giveUpBtn').textContent = end ? 'Encerrar a consulta' : 'Desistir da consulta';
  $('#giveUpQ').textContent = end
    ? 'Encerrar a consulta? O vídeo é desligado e o médico é avisado. Ele ainda pode mandar orientações e exames por até 24 horas.'
    : 'Desistir desta consulta? O médico será avisado.';
  $('#giveUpYes').textContent = end ? 'Sim, encerrar' : 'Sim, desistir';
  $('#giveUpConfirm').hidden = true;
}
function armPlanB() {
  clearTimeout(S.planBTimer);
  S.planBTimer = setTimeout(() => { if (!S.connected && S.view === 'call' && !S.left && S.lock !== false) showPlanB(); }, PLAN_B_MS);
}
function showPlanB() {
  $('#planB').hidden = false;
  if (!S.left) setState('O vídeo não conectou. O médico pode ligar para o seu celular ou escrever nas mensagens.');
  $('#retryBtn').hidden = false;
}
async function handleOffer(row) {
  const v = Number(row.offer_version) || 0;
  if (S.answering || S.left || !row.offer_sdp || !v || v === S.answered || v === S.failedVersion) return;
  S.answering = true;
  try {
    if (!(await claimCall())) return;
    setState('Conectando o vídeo…');
    await ensureMedia();
    closePeer();
    let peer;
    let sdp;
    try {
      peer = T.createPeer({ iceServers: ICE, gatherMs: GATHER_MS, onTrack: onRemote, onState: (s) => onPeer(peer, s) });
      S.peer = peer;
      sdp = await peer.answer(row.offer_sdp, S.local);
      S.flow = peer.flow();
    } catch {
      S.failedVersion = v;
      closePeer();
      showPlanB();
      return;
    }
    if (S.peer !== peer) return;
    if (S.left) { closePeer(); return; }
    try {
      await A.rpc('tele_answer', { ...P(), p_sdp: sdp, p_version: v });
      S.answered = v;
      armPlanB();
    } catch (ex) {
      const { code } = T.errorInfo(ex);
      closePeer();
      if (code === 'versao_antiga' || code === 'estado_invalido') statusPoll.now();
    }
  } finally {
    S.answering = false;
  }
}
// Conectou: diz a verdade sobre o que passa (sem microfone, o médico não ouve; sem câmera, só áudio).
function connectedText() {
  const f = S.flow;
  if (f?.known && !f.sendAudio) return 'Conectado, mas o médico não ouve você: o microfone está bloqueado ou desligado neste aparelho.';
  if (f?.known && !f.recvAudio) return 'Conectado, mas o médico está sem microfone: ele vai escrever nas mensagens ou ligar para você.';
  if (f?.known && !f.recvVideo) return 'Conectado só com áudio: o médico está sem câmera.';
  return 'Vídeo conectado.';
}
function onPeer(peer, s) {
  if (!peer || peer !== S.peer) return;
  if (s === 'connected') {
    S.connected = true;
    clearTimeout(S.planBTimer); clearTimeout(S.dropTimer);
    stageMsg('');
    document.title = TITLES.call;
    const noMic = S.flow?.known && !S.flow.sendAudio;
    $('#planB').hidden = true;
    if (noMic) {
      $('#mediaNote').textContent = 'Para o médico ouvir você: toque no cadeado ao lado do endereço do site, permita o microfone e toque em “Tentar o vídeo de novo”. Ou espere: o médico pode ligar para o seu celular.';
      $('#mediaNote').hidden = false;
    }
    $('#retryBtn').hidden = !noMic;
    setState(connectedText());
    if (S.row) renderExit(S.row);
    statusPoll.setInterval(4000);
  } else if (s === 'connecting') {
    setState('Conectando o vídeo…');
  } else if (s === 'disconnected') {
    S.connected = false;
    setState('A conexão do vídeo caiu. Tentando reconectar…');
    clearTimeout(S.dropTimer);
    S.dropTimer = setTimeout(() => { if (!S.connected) { stageMsg('O vídeo caiu.'); showPlanB(); } }, 8000);
    statusPoll.setInterval(2000);
  } else if (s === 'failed') {
    S.connected = false;
    stageMsg('O vídeo caiu.');
    showPlanB();
    statusPoll.setInterval(2000);
  }
}
function onRemote(stream) {
  const v = $('#remoteVideo');
  if (!stream) return;
  if (v.srcObject !== stream) v.srcObject = stream;
  if (v.paused) v.play().then(() => { $('#unmuteBtn').hidden = true; }).catch(() => { $('#unmuteBtn').hidden = false; });
}
function closePeer() {
  if (S.peer) { S.peer.close(); S.peer = null; }
  const v = $('#remoteVideo');
  if (v.srcObject) v.srcObject = null;
}
function stopLocal() {
  S.local?.getTracks().forEach((t) => t.stop());
  S.local = null;
  S.mediaTried = false;
  mediaPromise = null;
  $('#localVideo').srcObject = null;
}
function finishCall() {
  clearTimeout(S.planBTimer); clearTimeout(S.dropTimer);
  closePeer();
  stopLocal();
  releaseCall();
  S.connected = false; S.answered = 0; S.failedVersion = 0; S.flow = null;
  docKey = '';
  const box = $('#callExams');
  box.dataset.html = ''; box.innerHTML = ''; box.hidden = true;
  delete $('#giveUpBox').dataset.mode;
}
// Tentar o vídeo de novo (o vídeo caiu, ou a pessoa liberou o microfone no cadeado): pede a câmera e o microfone de
// novo se faltarem e responde outra vez à oferta atual; o médico refaz a conexão.
async function retryVideo() {
  if (S.left || S.lock === false) return;
  const b = $('#retryBtn');
  b.disabled = true;
  try {
    const hasAudio = !!S.local?.getAudioTracks().length;
    const hasVideo = !!S.local?.getVideoTracks().length;
    if (!hasAudio || !hasVideo) stopLocal();
    closePeer();
    S.answered = 0; S.failedVersion = 0; S.connected = false;
    $('#planB').hidden = true;
    $('#mediaNote').hidden = true;
    stageMsg('Aguardando o vídeo do médico…');
    setState('Conectando o vídeo de novo…');
    armPlanB();
    await ensureMedia();
    statusPoll.now();
  } finally {
    b.disabled = false;
  }
}

/* ======================= câmera e microfone ======================= */
function mediaHelp(e) {
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return 'O navegador bloqueou a câmera e o microfone. Para liberar, toque no cadeado ao lado do endereço do site, permita câmera e microfone e toque em “Tentar o vídeo de novo”. Enquanto isso, o médico pode ligar para o seu celular.';
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'Não encontramos câmera nem microfone neste aparelho. O médico pode ligar para o seu celular.';
  if (e?.name === 'NotReadableError') return 'A câmera ou o microfone estão em uso por outro aplicativo (WhatsApp, Zoom, outra aba). Feche-o e toque em “Tentar o vídeo de novo”.';
  return 'Não foi possível ligar a câmera e o microfone. O médico pode ligar para o seu celular.';
}
let mediaPromise = null;
function ensureMedia() {
  if (S.mediaTried) return mediaPromise || Promise.resolve(S.local);
  S.mediaTried = true;
  mediaPromise = (async () => {
    stopTest();
    const md = navigator.mediaDevices;
    let note = '';
    if (!md?.getUserMedia) note = 'Este navegador não libera câmera e microfone. O médico pode ligar para o seu celular.';
    else {
      try {
        S.local = await md.getUserMedia({ audio: true, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
      } catch (e1) {
        try {
          S.local = await md.getUserMedia({ audio: true });
          note = 'Sem câmera: o médico vai ouvir você, mas não vai ver a sua imagem.';
        } catch {
          S.local = null;
          note = mediaHelp(e1);
        }
      }
    }
    if (S.view !== 'call' || S.left) { const s = S.local; S.local = null; S.mediaTried = false; s?.getTracks().forEach((t) => t.stop()); return null; }
    renderMedia(note);
    return S.local;
  })();
  return mediaPromise;
}
async function renderMedia(note) {
  const lv = $('#localVideo');
  lv.srcObject = S.local;
  lv.hidden = !S.local?.getVideoTracks().length;
  if (S.local) lv.play?.().catch(() => {});
  $('#mediaNote').textContent = note || '';
  $('#mediaNote').hidden = !note;
  const hasA = !!S.local?.getAudioTracks().length;
  const hasV = !!S.local?.getVideoTracks().length;
  $('#micBtn').disabled = !hasA;
  $('#camBtn').disabled = !hasV;
  setToggle('#micBtn', true, 'Desligar microfone', 'Ligar microfone', 'fa-microphone', 'fa-microphone-slash');
  setToggle('#camBtn', true, 'Desligar câmera', 'Ligar câmera', 'fa-video', 'fa-video-slash');
  if (!hasA) $('#retryBtn').hidden = false;
  let cams = 0;
  try { cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length; } catch { cams = 0; }
  $('#flipBtn').hidden = !(hasV && cams > 1);
}
function setToggle(sel, on, onText, offText, onIcon, offIcon) {
  const b = $(sel);
  b.classList.toggle('off', !on);
  b.querySelector('span').textContent = on ? onText : offText;
  b.querySelector('i').className = `fa-solid ${on ? onIcon : offIcon}`;
}
function toggleTrack(kind) {
  const tracks = S.local?.getTracks().filter((t) => t.kind === kind) || [];
  if (!tracks.length) return;
  const on = !tracks[0].enabled;
  tracks.forEach((t) => { t.enabled = on; });
  if (kind === 'audio') setToggle('#micBtn', on, 'Desligar microfone', 'Ligar microfone', 'fa-microphone', 'fa-microphone-slash');
  else setToggle('#camBtn', on, 'Desligar câmera', 'Ligar câmera', 'fa-video', 'fa-video-slash');
  toast(kind === 'audio' ? (on ? 'Microfone ligado.' : 'Microfone desligado: o médico não ouve você.') : (on ? 'Câmera ligada.' : 'Câmera desligada: o médico não vê você.'));
}
async function flipCamera() {
  const md = navigator.mediaDevices;
  if (!S.local || !md || S.flipping) return;
  S.flipping = true;
  $('#flipBtn').disabled = true;
  try {
    const cams = (await md.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    if (cams.length < 2) return;
    const cur = S.local.getVideoTracks()[0];
    const curId = cur?.getSettings?.().deviceId;
    const next = cams[(cams.findIndex((d) => d.deviceId === curId) + 1) % cams.length];
    cur?.stop();
    let track;
    try {
      track = (await md.getUserMedia({ video: { deviceId: { exact: next.deviceId } } })).getVideoTracks()[0];
    } catch {
      try { track = (await md.getUserMedia({ video: curId ? { deviceId: { exact: curId } } : true })).getVideoTracks()[0]; } catch { track = null; }
    }
    if (!S.local) { track?.stop(); return; }
    if (cur) S.local.removeTrack(cur);
    if (!track) { toast('Não foi possível trocar a câmera.'); renderMedia('Câmera desligada.'); return; }
    S.local.addTrack(track);
    try { await S.peer?.replaceVideo(track); } catch { /* a próxima conexão já usa a câmera nova */ }
    $('#localVideo').srcObject = S.local;
  } finally {
    S.flipping = false;
    $('#flipBtn').disabled = false;
  }
}
function setupCall() {
  $('#micBtn').addEventListener('click', () => toggleTrack('audio'));
  $('#camBtn').addEventListener('click', () => toggleTrack('video'));
  $('#flipBtn').addEventListener('click', flipCamera);
  $('#retryBtn').addEventListener('click', retryVideo);
  $('#unmuteBtn').addEventListener('click', () => { $('#remoteVideo').play().then(() => { $('#unmuteBtn').hidden = true; }).catch(() => {}); });
  $('#hangBtn').addEventListener('click', () => {
    S.left = true;
    clearTimeout(S.planBTimer); clearTimeout(S.dropTimer);
    closePeer();
    stopLocal();
    S.connected = false;
    $('#stage').hidden = true; $('#ctrls').hidden = true; $('#planB').hidden = true; $('#mediaNote').hidden = true;
    $('#leftBox').hidden = false;
    setState('Você saiu do vídeo.');
    $('#rejoinBtn').focus();
  });
  $('#rejoinBtn').addEventListener('click', () => {
    S.left = false; S.answered = 0; S.failedVersion = 0;
    $('#leftBox').hidden = true; $('#stage').hidden = false; $('#ctrls').hidden = false;
    stageMsg('Aguardando o vídeo do médico…');
    setState('Voltando ao vídeo…');
    armPlanB();
    ensureMedia();
    statusPoll.now();
  });
  // Pede ao médico uma nova conexão quando a pessoa volta: responde de novo à oferta atual (veja medico.js).
  addEventListener('pagehide', () => { closePeer(); S.local?.getTracks().forEach((t) => t.stop()); });
  // Voltou pelo "Voltar" e o navegador restaurou a página da memória (bfcache): o vídeo já foi fechado no pagehide.
  addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
}

/* ======================= mensagens ======================= */
async function pollMessages() {
  if (!S.cur) return;
  const cur = S.cur;
  try {
    const rows = await A.rpc('tele_patient_messages', { ...P(), p_after: S.lastMsg });
    if (S.cur !== cur) return;
    if (Array.isArray(rows) && rows.length) {
      const before = S.msgs.length;
      S.msgs = T.mergeMessages(S.msgs, rows);
      S.lastMsg = T.lastId(S.msgs);
      renderMsgs();
      const fresh = S.msgs.slice(before).filter((m) => m.sender === 'doctor');
      if (fresh.length && before > 0 && S.view === 'call') toast('Nova mensagem do médico.');
    }
  } catch { /* tenta de novo na próxima consulta */ }
}
function msgHtml(m) {
  const mine = m.sender === 'patient';
  return `<li class="tl-bub ${mine ? 'me' : 'doc'}"><span class="tl-bub-who">${mine ? 'Você' : 'Médico'} · ${esc(T.fmtTime(m.created_at))}</span><p>${esc(m.body)}</p></li>`;
}
// A lista (role=log) recebe só as mensagens novas: o leitor de tela lê cada uma uma vez.
function renderMsgs(reset = false) {
  const list = $('#chatList');
  if (reset || !S.shownMsg || !S.msgs.length) {
    list.innerHTML = S.msgs.length ? S.msgs.map(msgHtml).join('') : '<li class="tl-bub-empty">Nenhuma mensagem ainda.</li>';
    S.shownMsg = T.lastId(S.msgs);
    list.scrollTop = list.scrollHeight;
  } else {
    const fresh = S.msgs.filter((m) => Number(m.id) > S.shownMsg);
    if (fresh.length) {
      const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      list.insertAdjacentHTML('beforeend', fresh.map(msgHtml).join(''));
      S.shownMsg = T.lastId(S.msgs);
      if (atEnd || fresh[fresh.length - 1].sender === 'patient') list.scrollTop = list.scrollHeight;
    }
  }
  $('#endChatList').innerHTML = S.msgs.map(msgHtml).join('');
  $('#endChatN').textContent = String(S.msgs.length);
  $('#endChat').hidden = !S.msgs.length;
}
function setupChat() {
  const form = $('#chatForm');
  const text = $('#chatText');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = text.value.trim();
    $('#chatErr').textContent = '';
    if (!body || S.sending || !S.cur) return;
    if (body.length > 1000) { $('#chatErr').textContent = 'A mensagem pode ter até 1.000 caracteres.'; return; }
    S.sending = true;
    $('#chatBtn').disabled = true;
    try {
      await A.rpc('tele_patient_send', { ...P(), p_body: body });
      text.value = '';
      await pollMessages();
    } catch (ex) {
      const { code, details } = T.errorInfo(ex);
      $('#chatErr').textContent = code === 'estado_invalido' ? 'A consulta não está mais em andamento.' : T.errorText(code, details);
      if (code === 'estado_invalido') statusPoll.now();
    } finally {
      S.sending = false;
      $('#chatBtn').disabled = false;
    }
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); T.submitForm(form, $('#chatBtn')); }
  });
}

/* ======================= exames e documento ======================= */
// Durante a chamada, os links abrem em outra aba: sair desta página desligaria o vídeo.
function examsHtml(row, titleId, { newTab = false } = {}) {
  const groups = T.groupExams(row.exams);
  if (!groups.length) return '';
  const someWithout = row.exams.some((e) => !T.examLinks(e).near);
  const tgt = newTab ? ' target="_blank" rel="noopener"' : '';
  const tab = newTab ? '<span class="sr"> (abre em outra aba)</span>' : '';
  const items = (g) => g.items.map((e) => {
    const l = T.examLinks(e);
    const links = [
      l.near ? `<a class="btn btn-ghost btn-sm" href="${esc(l.near)}"${tgt}><i class="fa-solid fa-location-dot" aria-hidden="true"></i>Onde fazer perto de você<span class="sr">: ${esc(e.name)}</span>${tab}</a>` : '',
      l.guide ? `<a class="link" href="${esc(l.guide)}"${tgt}>Como se preparar<span class="sr">: ${esc(e.name)}</span>${tab}</a>` : '',
    ].join('');
    return `<li><div class="tl-exname"><b>${esc(e.name)}</b>${e.note ? `<small>${esc(e.note)}</small>` : ''}</div>${links ? `<div class="tl-exlinks">${links}</div>` : ''}</li>`;
  }).join('');
  const ver = Number(row.exams_version) > 1 && row.exams_at ? `<p class="tl-upd"><i class="fa-solid fa-rotate" aria-hidden="true"></i>Pedido atualizado pelo médico em ${esc(T.fmtDateTime(row.exams_at))}. Use esta versão.</p>` : '';
  return `<h2 id="${titleId}">Exames pedidos pelo médico</h2>${ver}
    ${row.indication ? `<p class="tl-ind"><b>Indicação clínica:</b> <span class="tl-pre">${esc(row.indication)}</span></p>` : ''}
    ${groups.map((g) => `<h3>${esc(g.label)}</h3><ul class="tl-exlist">${items(g)}</ul>`).join('')}
    ${someWithout ? `<p class="tl-muted">Para os exames sem o botão, <a class="link" href="perto.html"${tgt}>procure clínicas e hospitais perto de você${tab}</a> e confirme por telefone se fazem o exame.</p>` : ''}
    <p class="tl-warn"><i class="fa-solid fa-signature" aria-hidden="true"></i><span><b>Sem assinatura digital ICP-Brasil.</b> Para valer como documento médico, o pedido precisa da assinatura digital do médico. O IMED ainda não assina pelo médico: pergunte a ele como você vai receber o pedido assinado. Alguns locais podem não aceitar esta lista.</span></p>
    <div class="tl-row"><button class="btn btn-primary" type="button" data-print><i class="fa-solid fa-print" aria-hidden="true"></i>Imprimir ou salvar em PDF</button></div>`;
}
// Folha "Solicitação de exames" (só ela sai na impressão). Sem exames na tela, imprime a página normal.
function fillDoc() {
  const r = S.row;
  const ok = !!(r && S.cur && Array.isArray(r.exams) && r.exams.length && (S.view === 'call' || S.view === 'end'));
  $('#printDoc').innerHTML = ok ? T.requestDocHtml({
    id: S.cur.id, patient_name: r.patient_name, patient_birthdate: r.patient_birthdate, doctor: r.doctor,
    exams: r.exams, indication: r.indication, at: r.started_at || r.accepted_at || r.created_at,
    version: r.exams_version, updatedAt: r.exams_at, site: SITE,
  }) : '';
  document.body.classList.toggle('tl-has-doc', ok);
  return ok;
}
// Antes de imprimir, busca a versão mais nova do pedido (o médico pode ter complementado), sem esperar mais de 2,5 s.
async function printDoc() {
  if (S.cur && Date.now() - S.rowAt > 5000) {
    await Promise.race([pollStatus().catch(() => {}), new Promise((r) => { setTimeout(r, 2500); })]);
  }
  if (fillDoc()) window.print();
}

/* ======================= resumo e fim ======================= */
function renderEnd(row) {
  $('#endUpdated').textContent = within24(row.ended_at || row.started_at || row.accepted_at) && !S.hist
    ? `Atualizado às ${T.fmtTime(new Date().toISOString())}. Até 24 horas depois de encerrar, o médico ainda pode complementar: esta página mostra a versão mais nova.`
    : '';
  // Só refaz o resumo quando algo mudou (não perde o foco de quem está lendo).
  const key = JSON.stringify([row.doctor, row.guidance, row.exams, row.indication, row.exams_version, row.ended_at, S.hist]);
  if (key === S.endKey) return;
  S.endKey = key;
  $('#endDoctor').innerHTML = doctorCard(row.doctor);
  const start = row.started_at || row.accepted_at;
  const who = row.closed_by === 'patient' ? ' por você' : '';
  $('#endWhen').textContent = start ? `Consulta em ${T.fmtDateTime(start)}${row.ended_at ? `, encerrada${who} às ${T.fmtTime(row.ended_at)}` : ''}. Código: ${T.consultCode(S.cur.id)}.` : '';
  $('#endGuide').innerHTML = row.guidance
    ? `<div class="tl-guide"><h3>Orientações do médico</h3><p class="tl-pre">${esc(row.guidance)}</p></div>`
    : `<p class="tl-muted">${within24(row.ended_at) ? 'O médico ainda não deixou orientações por escrito. Se ele registrar, elas aparecem aqui.' : 'O médico não deixou orientações por escrito.'}</p>`;
  const ex = examsHtml(row, 'endExamsTitle');
  $('#endExams').innerHTML = ex || '<h2 id="endExamsTitle">Exames</h2><p class="tl-muted">Nenhum exame foi pedido nesta consulta.</p>';
  $('#newBtn').hidden = S.hist;
  $('#backBtn').hidden = !S.hist;
  $('#forgetConfirm').hidden = true;
  $('#endTitle').textContent = S.hist ? 'Teleconsulta anterior' : 'Consulta encerrada';
}
function renderGone(row) {
  const accepted = !!row.accepted_at;
  let t;
  if (row.status === 'cancelled') {
    if (!accepted && row.closed_by === 'doctor') t = ['Pedido retirado da fila', 'Um médico retirou este pedido da fila. Se você ainda precisa de atendimento, faça um novo pedido ou procure atendimento presencial.'];
    else if (accepted) t = ['Consulta cancelada', 'Você desistiu desta consulta. Se o médico registrar alguma orientação, ela aparece aqui (até 24 horas depois do aceite).'];
    else t = ['Consulta cancelada', 'Esta teleconsulta foi cancelada.'];
  } else if (accepted) {
    t = ['Consulta expirada', 'O vídeo não começou a tempo e a consulta expirou. Se você falou com o médico por telefone ou mensagem, as orientações e os exames aparecem aqui quando ele registrar (até 24 horas depois). Se ainda precisar de atendimento, faça um novo pedido.'];
  } else {
    t = ['Pedido expirado', 'Nenhum médico atendeu em 2 horas e o pedido expirou. Desculpe a espera. Se ainda precisar, faça um novo pedido ou procure atendimento presencial.'];
  }
  $('#goneTitle').textContent = t[0];
  $('#goneText').textContent = t[1];
}
function newConsult() {
  statusPoll.stop();
  finishCall();
  if (!S.hist) T.writeCurrent(store, null);
  S.cur = null; S.row = null; S.hist = false; S.msgs = []; S.lastMsg = 0; S.endKey = '';
  renderMsgs(true);
  $('#printDoc').innerHTML = '';
  document.body.classList.remove('tl-has-doc');
  show('start');
  renderHist();
}
function renderHist() {
  const list = T.readHistory(store);
  $('#histList').innerHTML = list.map((h) => {
    const label = `${h.doctor || 'Teleconsulta'}${h.at ? ` · ${T.fmtDateTime(h.at)}` : ''}`;
    return `<li><span><b>${esc(h.doctor || 'Teleconsulta')}</b>${h.at ? ` · ${esc(T.fmtDateTime(h.at))}` : ''}</span>
    <span class="tl-hist-acts"><button class="btn btn-ghost btn-sm" type="button" data-hist="${esc(h.id)}">Ver exames e orientações</button>
    <button class="btn btn-ghost btn-sm" type="button" data-forget="${esc(h.id)}">Apagar deste aparelho<span class="sr">: ${esc(label)}</span></button></span></li>`;
  }).join('');
  $('#histCard').hidden = S.view !== 'start' || !list.length;
  $('#histClearConfirm').hidden = true;
}
function openHist(id) {
  const h = T.readHistory(store).find((x) => x.id === id);
  if (!h) return;
  statusPoll.stop();
  S.cur = h; S.hist = true; S.msgs = []; S.lastMsg = 0; S.row = null; S.endKey = '';
  renderMsgs(true);
  statusPoll.setInterval(3000);
  statusPoll.setHidden(10000);
  statusPoll.start();
}
// Apaga do aparelho (aparelho compartilhado): some da lista e o código desta consulta deixa de ficar guardado aqui.
function forget(id) {
  T.removeHistory(store, id);
  if (T.readCurrent(store)?.id === id) T.writeCurrent(store, null);
}
function setupHistory() {
  $('#histClear').addEventListener('click', () => { $('#histClearConfirm').hidden = false; $('#histClearYes').focus(); });
  $('#histClearNo').addEventListener('click', () => { $('#histClearConfirm').hidden = true; $('#histClear').focus(); });
  $('#histClearYes').addEventListener('click', () => {
    T.clearHistory(store);
    renderHist();
    flash('As teleconsultas foram apagadas deste aparelho.', 'ok');
  });
  $('#forgetBtn').addEventListener('click', () => { $('#forgetConfirm').hidden = false; $('#forgetYes').focus(); });
  $('#forgetNo').addEventListener('click', () => { $('#forgetConfirm').hidden = true; $('#forgetBtn').focus(); });
  $('#forgetYes').addEventListener('click', () => {
    if (S.cur) forget(S.cur.id);
    S.hist = false;
    newConsult();
    flash('A consulta foi apagada deste aparelho.', 'ok');
  });
}

/* ======================= teste de câmera e microfone ======================= */
const test = { stream: null, ctx: null, raf: 0, run: 0, busy: false };
async function startTest() {
  if (test.busy || test.stream) return;
  const msg = $('#testMsg');
  msg.className = 'tl-msg';
  if (!navigator.mediaDevices?.getUserMedia) { msg.textContent = 'Este navegador não libera câmera e microfone. Tente outro navegador, como Chrome ou Safari atualizados.'; msg.classList.add('err'); return; }
  const run = ++test.run;
  test.busy = true;
  $('#testBtn').disabled = true;
  msg.textContent = 'Permita a câmera e o microfone quando o navegador perguntar…';
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch (e) {
    if (run === test.run) {
      msg.textContent = mediaHelp(e).replace(' Enquanto isso, o médico pode ligar para o seu celular.', '').replace(' O médico pode ligar para o seu celular.', '').replace(' e toque em “Tentar o vídeo de novo”', ' e tente de novo');
      msg.classList.add('err');
    }
    return;
  } finally {
    test.busy = false;
    $('#testBtn').disabled = false;
  }
  // O teste foi parado (ou a consulta começou) enquanto o navegador pedia a permissão: desliga na hora.
  if (run !== test.run) { stream.getTracks().forEach((t) => t.stop()); return; }
  test.stream = stream;
  const v = $('#testVideo');
  v.srcObject = test.stream;
  v.play?.().catch(() => {});
  $('#testBox').hidden = false;
  $('#testStop').hidden = false;
  $('#testBtn').hidden = true;
  const hasV = test.stream.getVideoTracks().length > 0;
  msg.textContent = `${hasV ? 'Câmera funcionando: você deve ver a sua imagem.' : 'Não encontramos câmera.'} Fale alguma coisa e veja se a barra do microfone mexe.`;
  msg.classList.add('ok');
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    test.ctx = new Ctx();
    const an = test.ctx.createAnalyser();
    an.fftSize = 256;
    test.ctx.createMediaStreamSource(test.stream).connect(an);
    const data = new Uint8Array(an.frequencyBinCount);
    const bar = $('#meterBar');
    const loop = () => {
      if (!test.stream) return;
      an.getByteTimeDomainData(data);
      let peak = 0;
      for (const x of data) peak = Math.max(peak, Math.abs(x - 128));
      bar.style.width = `${Math.min(100, Math.round((peak / 64) * 100))}%`;
      test.raf = requestAnimationFrame(loop);
    };
    loop();
  } catch { /* sem medidor */ }
}
function stopTest() {
  test.run += 1;
  cancelAnimationFrame(test.raf);
  test.stream?.getTracks().forEach((t) => t.stop());
  test.ctx?.close().catch(() => {});
  test.stream = null; test.ctx = null;
  const v = $('#testVideo');
  if (v) v.srcObject = null;
  if ($('#testBox')) { $('#testBox').hidden = true; $('#testStop').hidden = true; $('#testBtn').hidden = false; }
}

/* ======================= início ======================= */
function setup() {
  setupWaitlist();
  setupForm();
  setupWait();
  setupCall();
  setupChat();
  setupHistory();
  $('#testBtn').addEventListener('click', startTest);
  $('#testStop').addEventListener('click', () => { stopTest(); $('#testMsg').textContent = 'Teste encerrado.'; });
  $('#newBtn').addEventListener('click', newConsult);
  $('#newBtn2').addEventListener('click', newConsult);
  $('#backBtn').addEventListener('click', newConsult);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-print]')) { e.preventDefault(); printDoc(); return; }
    const h = e.target.closest('[data-hist]');
    if (h) { e.preventDefault(); openHist(h.dataset.hist); return; }
    const f = e.target.closest('[data-forget]');
    if (f) { e.preventDefault(); forget(f.dataset.forget); renderHist(); toast('Consulta apagada deste aparelho.'); ($('#histList [data-hist]') || $('#formTitle'))?.focus(); return; }
    const cta = e.target.closest('#ctaForm');
    if (cta) { e.preventDefault(); openForm(true); $('#formCard').scrollIntoView({ block: 'start' }); }
  });
  // Sem navigator.userActivation (Safari antigo): lembra que a pessoa já tocou na página (o bipe só toca depois).
  const touched = () => { S.touched = true; };
  addEventListener('pointerdown', touched, { capture: true, once: true });
  addEventListener('keydown', touched, { capture: true, once: true });
  addEventListener('beforeprint', fillDoc);
  addEventListener('afterprint', () => document.body.classList.remove('tl-has-doc'));
}

setup();
S.cur = T.readCurrent(store);
renderHist();
if (S.cur) {
  // Volta para a consulta deste aparelho (fila, chamada ou resumo). Sem resposta do servidor, mostra o início
  // (a consulta continua guardada e a página entra nela quando o servidor responder).
  statusPoll.start();
  setTimeout(() => { if (S.view == null) show('start'); }, 8000);
} else {
  show('start');
  if (T.readPending(store)) flash('O seu último pedido pode não ter chegado. Preencha e toque em “Entrar na fila” de novo: se ele chegou, você volta para o mesmo lugar na fila.', 'warn');
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}));
}
