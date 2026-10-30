// Teleconsulta (paciente): quem atende agora, pedido com termo de consentimento, fila com a posição real,
// vídeo direto com o médico (WebRTC), plano B (telefone e mensagens), exames pedidos e resumo.
// Sem conta: o aparelho guarda {id, token} em localStorage 'imed_tele' (o banco só tem o SHA-256 do token).
// Regras e textos: tele-core.js. Contrato do banco: supabase/migrations/20261030070000_teleconsulta.sql.
import * as A from './auth.js';
import * as T from './tele-core.js';

const C = window.IMED_CONFIG || {};
const TELE = C.tele || {};
const ICE = T.iceServersFrom(C);
const PLAN_B_MS = Number(TELE.planBMs) > 0 ? Number(TELE.planBMs) : 25000; // vídeo sem conectar: plano B
const GATHER_MS = Number(TELE.gatherMs) > 0 ? Number(TELE.gatherMs) : 4000;
const SITE = C.siteUrl || new URL('./', location.href).href;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = T.esc;
const store = (() => { try { return window.localStorage; } catch { return null; } })();

const S = {
  cur: null, row: null, view: null, hist: false,
  msgs: [], lastMsg: 0,
  local: null, mediaTried: false,
  peer: null, answered: 0, failedVersion: 0, answering: false,
  connected: false, planBTimer: 0, dropTimer: 0, left: false,
  docCount: null, formOpen: false, sending: false,
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

/* ======================= quem atende agora ======================= */
const cfmLink = '<a class="link" href="https://portal.cfm.org.br/busca-medicos/" target="_blank" rel="noopener">conferir no CFM<span class="sr"> (abre em outra aba)</span></a>';
function doctorCard(d, { cfm = true } = {}) {
  if (!d) return '';
  const spec = T.doctorSpecialty(d);
  return `<span class="tl-doc-ic" aria-hidden="true"><i class="fa-solid fa-user-doctor"></i></span>
    <div><b class="tl-doc-name">${esc(d.full_name)}</b><span>${esc(T.doctorCrm(d))}${spec ? ` · ${esc(spec)}` : ''}</span>
    ${cfm ? `<small>Médico com cadastro aprovado pelo IMED · ${cfmLink}</small>` : ''}</div>`;
}
async function loadDocs() {
  let rows = null;
  try { rows = await A.rpc('tele_doctors_online'); } catch { rows = null; }
  renderDocs(Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : null);
}
const docsPoll = T.createPoller({ run: loadDocs, interval: 30000 });
function renderDocs(rows) {
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
  requester: ['#fReq', '#eReq'], relationship: ['#fRel', '#eRel'], name: ['#fName', '#eName'], birth: ['#fBirth', '#eBirth'],
  phone: ['#fPhone', '#ePhone'], reason: ['#fReason', '#eReason'], alerts: ['#fNone', '#eAlerts'], minor: ['#whoOther', '#eMinor'],
  guardian: ['#fGuardian', '#eGuardian'], consent: ['#fConsent', '#eConsent'],
};
const FOCUS_ORDER = ['requester', 'relationship', 'name', 'birth', 'phone', 'minor', 'guardian', 'reason', 'alerts', 'consent'];
function readForm() {
  const f = $('#reqForm');
  return {
    who: f.elements.namedItem('who').value,
    requester: $('#fReq').value, relationship: $('#fRel').value,
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
// Mostra o quadro do menor de idade e o aceite do responsável conforme a data de nascimento.
function updateMinor() {
  const v = readForm();
  const r = T.validateRequest(v);
  const box = $('#minorBox');
  box.hidden = !r.minor;
  $('#guardianBox').hidden = !(r.minor && v.who === 'other');
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
    const token = T.newToken();
    const id = await A.rpc('tele_request', { ...r.args, p_token_hash: await T.sha256Hex(token) });
    if (!T.isUuid(id)) throw new Error('resposta inesperada');
    S.cur = { id: String(id), token, at: new Date().toISOString() };
    T.writeCurrent(store, S.cur);
    $('#reqForm').reset();
    $('#otherBox').hidden = true;
    $('#minorBox').hidden = true;
    $('#reasonCount').textContent = '0';
    showSos([]);
    begin();
  } catch (ex) {
    const { code, details } = T.errorInfo(ex);
    if (code === 'emergencia') { showSos(v.alerts.length ? v.alerts : ['peito']); $('#sosBox').focus(); }
    else if (code === 'dados_invalidos' && T.PATIENT_FIELD[details]) {
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
const statusPoll = T.createPoller({ run: pollStatus, interval: 3000 });
function begin() {
  S.msgs = []; S.lastMsg = 0; S.row = null; S.answered = 0; S.failedVersion = 0; S.left = false; S.connected = false;
  renderMsgs();
  statusPoll.stop();
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
  await onStatus(row);
  if (['accepted', 'in_call', 'ended'].includes(row.status)) await pollMessages();
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
      break;
    case 'accepted':
    case 'in_call':
      if (S.view !== 'call') enterCall(prev === 'waiting');
      renderCall(row);
      statusPoll.setInterval(S.connected ? 4000 : 2000);
      handleOffer(row);
      break;
    case 'ended':
      statusPoll.stop();
      finishCall();
      renderEnd(row);
      show('end');
      if (!S.hist) T.archive(store, S.cur, { doctor: row.doctor?.full_name || null });
      break;
    default:
      statusPoll.stop();
      finishCall();
      renderGone(row);
      show('gone');
  }
}

/* ======================= fila ======================= */
function renderWait(row) {
  const pos = Number(row.position);
  $('#posNum').textContent = Number.isInteger(pos) && pos > 0 ? `${pos}º` : '…';
  $('#posText').textContent = T.positionText(pos);
  const n = Number(row.doctors_online) || 0;
  const t0 = Date.parse(row.created_at);
  const until = Number.isFinite(t0) ? T.fmtTime(new Date(t0 + 2 * 3600e3).toISOString()) : '';
  $('#waitDocs').innerHTML = n > 0
    ? `<i class="fa-solid fa-circle tl-dot-on" aria-hidden="true"></i>${n === 1 ? 'Há 1 médico atendendo agora.' : `Há ${n} médicos atendendo agora.`}`
    : `<i class="fa-solid fa-user-clock" aria-hidden="true"></i>Nenhum médico atendendo agora. Você continua na fila${until ? ` até as ${esc(until)}` : ''}; se ninguém atender até lá, o pedido expira.`;
  $('#waitSince').textContent = row.created_at ? `Pedido feito às ${T.fmtTime(row.created_at)}. Código: ${T.consultCode(S.cur.id)}.` : '';
}
function setupWait() {
  $('#leaveBtn').addEventListener('click', () => { $('#leaveConfirm').hidden = false; $('#leaveYes').focus(); });
  $('#leaveNo').addEventListener('click', () => { $('#leaveConfirm').hidden = true; $('#leaveBtn').focus(); });
  $('#leaveYes').addEventListener('click', () => cancelConsult('Você saiu da fila.'));
  $('#giveUpBtn').addEventListener('click', () => { $('#giveUpConfirm').hidden = false; $('#giveUpYes').focus(); });
  $('#giveUpNo').addEventListener('click', () => { $('#giveUpConfirm').hidden = true; $('#giveUpBtn').focus(); });
  $('#giveUpYes').addEventListener('click', () => cancelConsult('Você desistiu da consulta.'));
}
async function cancelConsult(text) {
  const btns = [$('#leaveYes'), $('#giveUpYes')];
  btns.forEach((b) => { b.disabled = true; });
  try {
    await A.rpc('tele_cancel', P());
    statusPoll.stop();
    finishCall();
    T.writeCurrent(store, null);
    S.cur = null; S.row = null;
    $('#leaveConfirm').hidden = true; $('#giveUpConfirm').hidden = true;
    show('start');
    flash(`${text} Se precisar, faça um novo pedido.`, 'ok');
  } catch (ex) {
    const { code } = T.errorInfo(ex);
    toast(code === 'estado_invalido' ? 'A consulta já começou: para encerrar, avise o médico pelas mensagens.' : T.errorText(code));
    statusPoll.now();
  } finally {
    btns.forEach((b) => { b.disabled = false; });
  }
}

/* ======================= chamada ======================= */
function enterCall(fromQueue) {
  show('call');
  S.left = false; S.connected = false;
  $('#leftBox').hidden = true; $('#stage').hidden = false; $('#ctrls').hidden = false;
  $('#stageMsg').hidden = false;
  $('#planB').hidden = true;
  setState('O médico aceitou a sua consulta. Preparando o vídeo…');
  if (fromQueue) ring();
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
    if (!ok) { $('#stage').hidden = true; $('#ctrls').hidden = true; setState('Esta consulta está aberta em outra aba ou janela deste aparelho.'); }
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
// Avisa que o médico chamou: vibra e toca um bipe (só depois de a pessoa ter tocado na página).
function ring() {
  if (!navigator.userActivation?.hasBeenActive) return;
  try { navigator.vibrate?.([300, 120, 300]); } catch { /* sem vibração */ }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.35);
    o.onended = () => ctx.close().catch(() => {});
  } catch { /* sem som */ }
}
const setState = (t) => { $('#callState').textContent = t; };
let docKey = '';
function renderCall(row) {
  const key = JSON.stringify(row.doctor || null);
  if (key !== docKey) { docKey = key; $('#callDoctor').innerHTML = doctorCard(row.doctor); }
  $('#giveUpBox').hidden = row.status !== 'accepted' || S.connected;
  const exams = Array.isArray(row.exams) && row.exams.length;
  const box = $('#callExams');
  const html = exams ? examsHtml(row, 'callExamsTitle') : '';
  if (box.dataset.html !== html) {
    const isNew = !box.dataset.html && !!html;
    box.dataset.html = html;
    box.innerHTML = html;
    box.hidden = !html;
    if (isNew) toast('O médico enviou o pedido de exames.');
  }
  if (!row.offer_sdp && !S.connected && !S.left && S.lock !== false) setState('O médico aceitou a sua consulta. Aguarde: ele vai iniciar o vídeo.');
}
function armPlanB() {
  clearTimeout(S.planBTimer);
  S.planBTimer = setTimeout(() => { if (!S.connected && S.view === 'call' && !S.left && S.lock !== false) showPlanB(); }, PLAN_B_MS);
}
function showPlanB() {
  $('#planB').hidden = false;
  if (!S.left) setState('O vídeo não conectou. O médico pode ligar para o seu celular ou escrever nas mensagens.');
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
function onPeer(peer, s) {
  if (!peer || peer !== S.peer) return;
  if (s === 'connected') {
    S.connected = true;
    clearTimeout(S.planBTimer); clearTimeout(S.dropTimer);
    $('#planB').hidden = true;
    $('#stageMsg').hidden = true;
    $('#giveUpBox').hidden = true;
    setState('Vídeo conectado.');
    statusPoll.setInterval(4000);
  } else if (s === 'connecting') {
    setState('Conectando o vídeo…');
  } else if (s === 'disconnected') {
    S.connected = false;
    setState('A conexão do vídeo caiu. Tentando reconectar…');
    clearTimeout(S.dropTimer);
    S.dropTimer = setTimeout(() => { if (!S.connected) showPlanB(); }, 8000);
    statusPoll.setInterval(2000);
  } else if (s === 'failed') {
    S.connected = false;
    $('#stageMsg').hidden = false;
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
  $('#localVideo').srcObject = null;
}
function finishCall() {
  clearTimeout(S.planBTimer); clearTimeout(S.dropTimer);
  closePeer();
  stopLocal();
  releaseCall();
  S.connected = false; S.answered = 0; S.failedVersion = 0;
  docKey = '';
  const box = $('#callExams');
  box.dataset.html = ''; box.innerHTML = ''; box.hidden = true;
}

/* ======================= câmera e microfone ======================= */
function mediaHelp(e) {
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return 'O navegador bloqueou a câmera e o microfone. Para liberar, toque no cadeado ao lado do endereço do site, permita câmera e microfone e recarregue a página. Enquanto isso, o médico pode ligar para o seu celular.';
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'Não encontramos câmera nem microfone neste aparelho. O médico pode ligar para o seu celular.';
  if (e?.name === 'NotReadableError') return 'A câmera ou o microfone estão em uso por outro aplicativo. Feche o outro aplicativo e recarregue a página.';
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
  if (!S.local || !md) return;
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
  if (cur) S.local.removeTrack(cur);
  if (!track) { toast('Não foi possível trocar a câmera.'); renderMedia('Câmera desligada.'); return; }
  S.local.addTrack(track);
  try { await S.peer?.replaceVideo(track); } catch { /* a próxima conexão já usa a câmera nova */ }
  $('#localVideo').srcObject = S.local;
}
function setupCall() {
  $('#micBtn').addEventListener('click', () => toggleTrack('audio'));
  $('#camBtn').addEventListener('click', () => toggleTrack('video'));
  $('#flipBtn').addEventListener('click', flipCamera);
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
    $('#leftBox').hidden = true; $('#stage').hidden = false; $('#ctrls').hidden = false; $('#stageMsg').hidden = false;
    setState('Voltando ao vídeo…');
    armPlanB();
    ensureMedia();
    statusPoll.now();
  });
  // Pede ao médico uma nova conexão quando a pessoa volta: responde de novo à oferta atual (veja medico.js).
  addEventListener('pagehide', () => { closePeer(); S.local?.getTracks().forEach((t) => t.stop()); });
}

/* ======================= mensagens ======================= */
async function pollMessages() {
  if (!S.cur) return;
  try {
    const rows = await A.rpc('tele_patient_messages', { ...P(), p_after: S.lastMsg });
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
function renderMsgs() {
  const list = $('#chatList');
  const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.innerHTML = S.msgs.length ? S.msgs.map(msgHtml).join('') : '<li class="tl-bub-empty">Nenhuma mensagem ainda.</li>';
  if (atEnd || S.msgs.at(-1)?.sender === 'patient') list.scrollTop = list.scrollHeight;
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
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
}

/* ======================= exames e documento ======================= */
function examsHtml(row, titleId) {
  const groups = T.groupExams(row.exams);
  if (!groups.length) return '';
  const someWithout = row.exams.some((e) => !T.examLinks(e).near);
  const items = (g) => g.items.map((e) => {
    const l = T.examLinks(e);
    const links = [
      l.near ? `<a class="btn btn-ghost btn-sm" href="${esc(l.near)}"><i class="fa-solid fa-location-dot" aria-hidden="true"></i>Onde fazer perto de você<span class="sr">: ${esc(e.name)}</span></a>` : '',
      l.guide ? `<a class="link" href="${esc(l.guide)}">Como se preparar<span class="sr">: ${esc(e.name)}</span></a>` : '',
    ].join('');
    return `<li><div class="tl-exname"><b>${esc(e.name)}</b>${e.note ? `<small>${esc(e.note)}</small>` : ''}</div>${links ? `<div class="tl-exlinks">${links}</div>` : ''}</li>`;
  }).join('');
  return `<h2 id="${titleId}">Exames pedidos pelo médico</h2>
    ${row.indication ? `<p class="tl-ind"><b>Indicação clínica:</b> <span class="tl-pre">${esc(row.indication)}</span></p>` : ''}
    ${groups.map((g) => `<h3>${esc(g.label)}</h3><ul class="tl-exlist">${items(g)}</ul>`).join('')}
    ${someWithout ? '<p class="tl-muted">Para os exames sem o botão, <a class="link" href="perto.html">procure clínicas e hospitais perto de você</a> e confirme por telefone se fazem o exame.</p>' : ''}
    <p class="tl-warn"><i class="fa-solid fa-signature" aria-hidden="true"></i><span><b>Sem assinatura digital ICP-Brasil.</b> Para valer como documento médico, o pedido precisa da assinatura digital do médico. O IMED ainda não assina pelo médico: pergunte a ele como você vai receber o pedido assinado. Alguns locais podem não aceitar esta lista.</span></p>
    <div class="tl-row"><button class="btn btn-primary" type="button" data-print><i class="fa-solid fa-print" aria-hidden="true"></i>Imprimir ou salvar em PDF</button></div>`;
}
// Folha "Solicitação de exames" (só ela sai na impressão). Sem exames na tela, imprime a página normal.
function fillDoc() {
  const r = S.row;
  const ok = !!(r && S.cur && Array.isArray(r.exams) && r.exams.length && (S.view === 'call' || S.view === 'end'));
  $('#printDoc').innerHTML = ok ? T.requestDocHtml({
    id: S.cur.id, patient_name: r.patient_name, patient_birthdate: r.patient_birthdate, doctor: r.doctor,
    exams: r.exams, indication: r.indication, at: r.started_at || r.accepted_at || r.created_at, site: SITE,
  }) : '';
  return ok;
}
function printDoc() { if (fillDoc()) window.print(); }

/* ======================= resumo e fim ======================= */
function renderEnd(row) {
  $('#endDoctor').innerHTML = doctorCard(row.doctor);
  const start = row.started_at || row.accepted_at;
  $('#endWhen').textContent = start ? `Consulta em ${T.fmtDateTime(start)}${row.ended_at ? `, encerrada às ${T.fmtTime(row.ended_at)}` : ''}. Código: ${T.consultCode(S.cur.id)}.` : '';
  $('#endGuide').innerHTML = row.guidance
    ? `<div class="tl-guide"><h3>Orientações do médico</h3><p class="tl-pre">${esc(row.guidance)}</p></div>`
    : '<p class="tl-muted">O médico não deixou orientações por escrito.</p>';
  const ex = examsHtml(row, 'endExamsTitle');
  $('#endExams').innerHTML = ex || '<h2 id="endExamsTitle">Exames</h2><p class="tl-muted">Nenhum exame foi pedido nesta consulta.</p>';
  $('#newBtn').hidden = S.hist;
  $('#backBtn').hidden = !S.hist;
  $('#endTitle').textContent = S.hist ? 'Teleconsulta anterior' : 'Consulta encerrada';
}
function renderGone(row) {
  const accepted = !!row.accepted_at;
  const t = row.status === 'cancelled'
    ? ['Consulta cancelada', 'Esta teleconsulta foi cancelada.']
    : accepted
      ? ['Consulta expirada', 'O vídeo não começou a tempo e a consulta expirou. Se ainda precisar, faça um novo pedido.']
      : ['Pedido expirado', 'Nenhum médico atendeu em 2 horas e o pedido expirou. Desculpe a espera. Se ainda precisar, faça um novo pedido ou procure atendimento presencial.'];
  $('#goneTitle').textContent = t[0];
  $('#goneText').textContent = t[1];
}
function newConsult() {
  statusPoll.stop();
  finishCall();
  if (!S.hist) T.writeCurrent(store, null);
  S.cur = null; S.row = null; S.hist = false; S.msgs = []; S.lastMsg = 0;
  renderMsgs();
  renderHist();
  $('#printDoc').innerHTML = '';
  show('start');
}
function renderHist() {
  const list = T.readHistory(store);
  $('#histList').innerHTML = list.map((h) => `<li><span><b>${esc(h.doctor || 'Teleconsulta')}</b>${h.at ? ` · ${esc(T.fmtDateTime(h.at))}` : ''}</span>
    <button class="btn btn-ghost btn-sm" type="button" data-hist="${esc(h.id)}">Ver exames e orientações</button></li>`).join('');
  $('#histCard').hidden = S.view !== 'start' || !list.length;
}
async function openHist(id) {
  const h = T.readHistory(store).find((x) => x.id === id);
  if (!h) return;
  S.cur = h; S.hist = true; S.msgs = []; S.lastMsg = 0; S.row = null;
  await pollStatus();
}

/* ======================= teste de câmera e microfone ======================= */
const test = { stream: null, ctx: null, raf: 0 };
async function startTest() {
  const msg = $('#testMsg');
  msg.className = 'tl-msg';
  if (!navigator.mediaDevices?.getUserMedia) { msg.textContent = 'Este navegador não libera câmera e microfone. Tente outro navegador, como Chrome ou Safari atualizados.'; msg.classList.add('err'); return; }
  msg.textContent = 'Permita a câmera e o microfone quando o navegador perguntar…';
  try {
    test.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch (e) {
    msg.textContent = mediaHelp(e).replace(' Enquanto isso, o médico pode ligar para o seu celular.', '').replace(' O médico pode ligar para o seu celular.', '');
    msg.classList.add('err');
    return;
  }
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
  $('#testBtn').addEventListener('click', startTest);
  $('#testStop').addEventListener('click', () => { stopTest(); $('#testMsg').textContent = 'Teste encerrado.'; });
  $('#newBtn').addEventListener('click', newConsult);
  $('#newBtn2').addEventListener('click', newConsult);
  $('#backBtn').addEventListener('click', newConsult);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-print]')) { e.preventDefault(); printDoc(); return; }
    const h = e.target.closest('[data-hist]');
    if (h) { e.preventDefault(); openHist(h.dataset.hist); return; }
    const cta = e.target.closest('#ctaForm');
    if (cta) { e.preventDefault(); openForm(true); $('#formCard').scrollIntoView({ block: 'start' }); }
  });
  addEventListener('beforeprint', fillDoc);
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
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}));
}
