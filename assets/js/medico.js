// Área do médico (teleconsulta): entrar pelo link do e-mail, cadastro (identidade e CRM conferidos pela equipe do
// IMED), aviso regulatório, "Disponível para atender" (renovado a cada minuto), fila, vídeo (o médico faz a oferta),
// plano B (telefone e mensagens), pedido de exames, orientações, prontuário, histórico e, para a equipe do IMED,
// a conferência e a aprovação dos médicos. Dados de pacientes ficam só na memória da página (nada vai para o
// localStorage).
import * as A from './auth.js';
import * as T from './tele-core.js';

T.ensureCompat();
const C = window.IMED_CONFIG || {};
const TELE = C.tele || {};
const ICE = T.iceServersFrom(C);
const PLAN_B_MS = Number(TELE.planBMs) > 0 ? Number(TELE.planBMs) : 25000;
const GATHER_MS = Number(TELE.gatherMs) > 0 ? Number(TELE.gatherMs) : 4000;
const HEARTBEAT_MS = 60000; // tele_set_available vale 90 s
const NOTICE_KEY = 'imed_medico_aviso';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = T.esc;
const within24 = (t) => !!t && Date.now() - new Date(t).getTime() < 24 * 3600e3;

const S = {
  me: null, admin: false, duty: false, available: false, hb: 0,
  queue: [], queueSig: '', seenIds: null, c: null, mode: 'live',
  peer: null, local: null, mediaTried: false, version: 0, applied: null, connected: false, offering: false, flow: null,
  planBTimer: 0, dropTimer: 0, flipping: false,
  msgs: [], lastMsg: 0, shownMsg: 0, sending: false,
  exams: [], sent: '[]', sentInd: '', otherN: 0,
  hist: [],
};

/* ======================= avisos ======================= */
let flashTimer = 0;
function flash(text, kind = 'info') {
  const f = $('#flash');
  f.textContent = text;
  f.className = `tl-flash ${kind}`;
  f.hidden = !text;
  clearTimeout(flashTimer);
  if (text) flashTimer = setTimeout(() => { f.hidden = true; }, 15000);
}
let toastTimer = 0;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
}
// Bipe curto (a página já teve toque do médico: o navegador deixa tocar) e, se ele permitiu, uma notificação sem
// dados do paciente (a tela do computador ou do celular pode estar à vista de outras pessoas).
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    ctx.resume?.().catch(() => {});
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 660; g.gain.value = 0.07;
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.25);
    o.onended = () => ctx.close().catch(() => {});
  } catch { /* sem som */ }
}
function notify(text) {
  if (!document.hidden) return;
  beep();
  try { if (window.Notification?.permission === 'granted') new Notification('IMED · Teleconsulta', { body: text, tag: 'imed-tele', renotify: true }); } catch { /* sem notificação */ }
}
// A entrada expirou (auth.js apagou a sessão): volta para o quadro de entrada.
function lostSession(err) {
  const { code } = T.errorInfo(err);
  if ((code === 'sem_permissao' || code === 'sem_login') && !A.user()) {
    resetAll();
    renderAuth();
    flash('Sua entrada expirou. Peça um novo link abaixo.', 'warn');
    return true;
  }
  return false;
}

/* ======================= entrada ======================= */
function renderAuth() {
  const box = $('#authBox');
  const u = A.user();
  if (u) {
    box.innerHTML = `<div class="md-who"><span><i class="fa-solid fa-circle-user" aria-hidden="true"></i>Você entrou como <b>${esc(u.email)}</b></span>
      <button class="btn btn-ghost btn-sm" type="button" id="outBtn">Sair</button></div>`;
    $('#outBtn').addEventListener('click', signOut);
    return;
  }
  box.innerHTML = `<form class="md-login" id="loginForm" novalidate>
      <p>Entre com o seu e-mail. Mandamos um link de entrada; não precisa de senha. Use sempre o mesmo e-mail.</p>
      <div class="fld"><label for="loginEmail">Seu e-mail</label>
        <div class="md-loginrow"><input id="loginEmail" type="email" autocomplete="email" inputmode="email" maxlength="254" required aria-describedby="loginMsg" placeholder="voce@exemplo.com">
        <button class="btn btn-coral" type="submit" id="loginBtn">Receber link</button></div></div>
      <p class="tl-msg" id="loginMsg" aria-live="polite"></p>
    </form>`;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim();
    const msg = $('#loginMsg');
    msg.className = 'tl-msg';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Digite um e-mail válido, como voce@exemplo.com.'; msg.classList.add('err'); $('#loginEmail').focus(); return; }
    const btn = $('#loginBtn');
    btn.disabled = true;
    msg.textContent = 'Enviando…';
    try {
      await A.signIn(email, `${location.origin}${location.pathname}`);
      msg.innerHTML = `Enviamos um link para <b>${esc(email.toLowerCase())}</b>. Abra no mesmo aparelho e navegador para continuar.`;
      msg.classList.add('ok');
    } catch (err) {
      msg.textContent = err?.status === 429 ? 'Muitos pedidos de link em pouco tempo. Espere um minuto e tente de novo.' : 'Não foi possível enviar o link agora. Confira o e-mail e tente de novo.';
      msg.classList.add('err');
    } finally {
      btn.disabled = false;
    }
  });
}
async function signOut() {
  if (S.c && S.mode === 'live' && ['accepted', 'in_call'].includes(S.c.status)) { toast('Encerre a consulta antes de sair.'); return; }
  await setAvailable(false);
  await A.signOut();
  resetAll();
  renderAuth();
  flash('Você saiu da sua conta.', 'ok');
}
function resetAll() {
  stopDuty();
  closeConsult(true);
  S.me = null; S.admin = false; S.hist = []; S.queueSig = ''; S.seenIds = null;
  for (const id of ['#meCard', '#regCard', '#noticeCard', '#dutyCard', '#consult', '#histCard', '#adminCard']) $(id).hidden = true;
  $('#admin').innerHTML = ''; $('#hist').innerHTML = ''; $('#queue').innerHTML = '';
}

/* ======================= cadastro ======================= */
async function loadMe() {
  let rows;
  try { rows = await A.rpc('tele_doctor_me'); } catch (err) {
    if (lostSession(err)) return;
    $('#meCard').hidden = false;
    $('#meBox').innerHTML = `<p class="bk-err show">${esc(T.errorText(T.errorInfo(err).code))}</p><button class="btn btn-ghost btn-sm" type="button" id="meRetry">Tentar de novo</button>`;
    $('#meRetry').addEventListener('click', loadMe);
    return;
  }
  const me = Array.isArray(rows) ? rows[0] : rows;
  S.admin = !!me?.is_admin;
  S.me = me && me.id ? me : null;
  renderMe();
  if (S.admin) loadAdmin();
  else $('#adminCard').hidden = true;
  if (S.me) loadHistory();
  if (S.me?.status === 'approved') {
    if (noticeAccepted()) startDuty(); else showNotice();
  } else {
    stopDuty();
    $('#noticeCard').hidden = true;
  }
}
const STATUS_TEXT = {
  pending: ['tl-chip warn', 'Em análise', 'A equipe do IMED vai conferir o seu CRM no CFM e a sua identidade: por chamada de vídeo (documento com foto e carteira do CRM) ou por um documento assinado com o seu certificado ICP-Brasil. A fila de pacientes aparece aqui quando o cadastro for aprovado.'],
  approved: ['tl-chip ok', 'Aprovado', 'Você pode atender. Mudar nome, CRM, UF, RQE ou especialidade manda o cadastro de novo para análise.'],
  rejected: ['tl-chip err', 'Recusado', 'Confira os dados e envie de novo, se for o caso.'],
  suspended: ['tl-chip err', 'Suspenso', 'Você não pode atender agora. Fale com o IMED. Enquanto isso, abaixo aparecem só as consultas das últimas 24 horas (para terminar o registro), sem o celular dos pacientes.'],
};
function renderMe() {
  const me = S.me;
  if (!me) {
    $('#meCard').hidden = true;
    fillReg(null);
    $('#regCard').hidden = false;
    $('#regCancel').hidden = true;
    $('#regBtn').textContent = 'Enviar para análise';
    return;
  }
  $('#regCard').hidden = true;
  $('#meCard').hidden = false;
  const [cls, label, help] = STATUS_TEXT[me.status] || ['tl-chip', me.status, ''];
  const spec = T.doctorSpecialty(me);
  const due = me.status === 'approved' ? T.recheckDue(me.checked_at) : null;
  $('#meBox').innerHTML = `<div class="md-me"><div><b>${esc(me.full_name)}</b><span>${esc(T.doctorCrm(me))}${spec ? ` · ${esc(spec)}` : ''}</span>
      ${me.phone ? `<small>Celular: ${esc(T.fmtPhone(me.phone))}</small>` : ''}</div><span class="${cls}">${esc(label)}</span></div>
    <p class="tl-muted">${esc(help)}</p>
    ${due ? `<p class="tl-small">Identidade e CRM conferidos pela equipe do IMED em ${esc(T.fmtDateTime(me.checked_at))}. Nova conferência até ${esc(T.fmtDate(due.slice(0, 10)))} (sem ela, o cadastro é suspenso).</p>` : ''}
    ${me.review_note ? `<p class="md-note"><b>Observação da equipe do IMED:</b> ${esc(me.review_note)}</p>` : ''}
    <div class="tl-row"><button class="btn btn-ghost btn-sm" type="button" id="editBtn"><i class="fa-solid fa-pen" aria-hidden="true"></i>${me.status === 'rejected' ? 'Corrigir e enviar de novo' : 'Editar cadastro'}</button></div>`;
  $('#editBtn').addEventListener('click', () => {
    fillReg(me);
    $('#regCard').hidden = false;
    $('#regCancel').hidden = false;
    $('#regBtn').textContent = me.status === 'approved' ? 'Salvar' : 'Enviar para análise';
    $('#regTitle').focus();
  });
}
const REG = { full_name: ['#rName', '#erName'], crm: ['#rCrm', '#erCrm'], crm_uf: ['#rUf', '#erUf'], rqe: ['#rRqe', '#erRqe'], specialty: ['#rSpec', '#erSpec'], phone: ['#rPhone', '#erPhone'] };
function fillReg(me) {
  $('#rName').value = me?.full_name || '';
  $('#rCrm').value = me?.crm || '';
  $('#rUf').value = me?.crm_uf || '';
  $('#rRqe').value = me?.rqe || '';
  $('#rSpec').value = me?.specialty || '';
  $('#rPhone').value = me?.phone ? T.fmtPhone(me.phone) : '';
  showRegErrors({});
}
function showRegErrors(errors) {
  for (const [k, [inp, out]] of Object.entries(REG)) {
    const msg = errors[k] || '';
    $(out).textContent = msg;
    $(inp).setAttribute('aria-invalid', msg ? 'true' : 'false');
    $(inp).closest('.fld').classList.toggle('bad', !!msg);
  }
}
function setupReg() {
  $('#rUf').insertAdjacentHTML('beforeend', T.UFS.map((u) => `<option>${u}</option>`).join(''));
  $('#rPhone').addEventListener('input', (e) => { const d = T.onlyDigits(e.target.value); if (d.length <= 11 && !e.target.value.trim().startsWith('+')) e.target.value = T.maskPhone(d); });
  $('#regCancel').addEventListener('click', () => { $('#regCard').hidden = true; $('#editBtn')?.focus(); });
  $('#regForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#regErr');
    err.classList.remove('show');
    const r = T.validateDoctor({ full_name: $('#rName').value, crm: $('#rCrm').value, crm_uf: $('#rUf').value, rqe: $('#rRqe').value, specialty: $('#rSpec').value, phone: $('#rPhone').value });
    showRegErrors(r.errors);
    if (!r.ok) { const k = Object.keys(REG).find((x) => r.errors[x]); $(REG[k][0]).focus(); return; }
    const btn = $('#regBtn');
    btn.disabled = true;
    try {
      const status = await A.rpc('tele_doctor_register', r.args);
      flash(status === 'approved' ? 'Cadastro salvo.' : status === 'suspended' ? 'Dados salvos. O cadastro continua suspenso.' : 'Cadastro enviado. A equipe do IMED vai conferir o seu CRM no CFM e a sua identidade, e combinar com você como.', 'ok');
      await loadMe();
      $('#meTitle').focus();
    } catch (ex) {
      if (lostSession(ex)) return;
      const { code, details } = T.errorInfo(ex);
      if (code === 'dados_invalidos' && T.DOCTOR_FIELD[details]) { showRegErrors({ [T.DOCTOR_FIELD[details]]: T.errorText(code, details) }); $(REG[T.DOCTOR_FIELD[details]][0]).focus(); }
      else { err.textContent = T.errorText(code, details); err.classList.add('show'); }
    } finally {
      btn.disabled = false;
    }
  });
}

/* ======================= aviso regulatório ======================= */
const noticeStoreKey = () => `${NOTICE_KEY}:${A.user()?.id || ''}`;
function noticeAccepted() { try { return localStorage.getItem(noticeStoreKey()) === T.NOTICE_VERSION; } catch { return false; } }
function showNotice() {
  $('#noticeCard').hidden = false;
  $('#dutyCard').hidden = true;
}
function setupNotice() {
  $('#noticeBtn').addEventListener('click', () => {
    if (!$('#noticeOk').checked) { $('#noticeErr').textContent = 'Para atender, marque que leu e entendeu o aviso.'; $('#noticeErr').classList.add('show'); $('#noticeOk').focus(); return; }
    $('#noticeErr').classList.remove('show');
    try { localStorage.setItem(noticeStoreKey(), T.NOTICE_VERSION); } catch { /* fica só nesta visita */ }
    $('#noticeCard').hidden = true;
    startDuty();
    $('#dutyTitle').focus();
  });
}

/* ======================= disponível + fila ======================= */
const queuePoll = T.createPoller({ run: loadQueue, interval: 5000, hiddenInterval: 30000 });
const AVAIL_KEY = 'imed_medico_disponivel';
const rememberAvail = (on) => { try { if (on) sessionStorage.setItem(AVAIL_KEY, '1'); else sessionStorage.removeItem(AVAIL_KEY); } catch { /* sem armazenamento */ } };
const wasAvail = () => { try { return sessionStorage.getItem(AVAIL_KEY) === '1'; } catch { return false; } };
function startDuty() {
  S.duty = true;
  $('#dutyCard').hidden = !!S.c;
  queuePoll.start();
  // Recarregou a página com "Disponível" ligado (nesta aba): liga de novo.
  if (wasAvail() && !S.available) setAvailable(true);
}
function stopDuty() {
  S.duty = false;
  queuePoll.stop();
  if (S.available) setAvailable(false);
  $('#dutyCard').hidden = true;
}
async function setAvailable(on, fromClick = false) {
  clearInterval(S.hb);
  S.hb = 0;
  const btn = $('#availBtn');
  if (!on) {
    const was = S.available;
    S.available = false;
    rememberAvail(false);
    renderAvail();
    if (was) { try { await A.rpc('tele_set_available', { p_on: false }); } catch { /* vence sozinho em 90 s */ } }
    return;
  }
  // Pedido de notificação junto do toque em "Disponível" (o navegador só pergunta depois de um toque).
  if (fromClick) { try { if (window.Notification?.permission === 'default') Notification.requestPermission().catch(() => {}); } catch { /* sem notificação */ } }
  btn.disabled = true;
  try {
    await A.rpc('tele_set_available', { p_on: true });
    S.available = true;
    rememberAvail(true);
    S.hb = setInterval(heartbeat, HEARTBEAT_MS);
  } catch (err) {
    S.available = false;
    rememberAvail(false);
    if (!lostSession(err)) {
      const { code } = T.errorInfo(err);
      toast(T.errorText(code));
      if (code === 'nao_aprovado' || code === 'sem_cadastro') loadMe();
    }
  } finally {
    btn.disabled = false;
    renderAvail();
  }
}
async function heartbeat() {
  if (!S.available) return;
  try { await A.rpc('tele_set_available', { p_on: true }); } catch (err) {
    if (lostSession(err)) return;
    const { code } = T.errorInfo(err);
    if (code === 'nao_aprovado' || code === 'sem_cadastro') { S.available = false; clearInterval(S.hb); renderAvail(); toast(T.errorText(code)); loadMe(); }
  }
}
function renderAvail() {
  const b = $('#availBtn');
  b.setAttribute('aria-checked', String(S.available));
  b.classList.toggle('on', S.available);
  $('#availNote').textContent = S.available
    ? 'Ligado: os pacientes veem que há médico atendendo, com o seu nome e CRM. Ao sair desta página, você deixa de aparecer.'
    : 'Desligado: os pacientes veem “Nenhum médico atendendo agora”. Ao sair desta página, você deixa de aparecer.';
  S.queueSig = '';
  renderQueue();
}
// Ao fechar a página: desliga o "disponível" (se não der, vence sozinho em 90 s).
function offOnLeave() {
  if (!S.available) return;
  const s = A.session();
  if (!s?.access_token) return;
  try {
    fetch(`${C.supabaseUrl}/rest/v1/rpc/tele_set_available`, {
      method: 'POST', keepalive: true,
      headers: { apikey: C.supabaseAnonKey, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_on: false }),
    }).catch(() => {});
  } catch { /* ignora */ }
}
async function loadQueue() {
  if (!S.duty) return;
  let rows;
  try { rows = await A.rpc('tele_queue'); } catch (err) {
    if (lostSession(err)) return;
    const { code } = T.errorInfo(err);
    if (code === 'nao_aprovado' || code === 'sem_cadastro') { stopDuty(); loadMe(); return; }
    $('#queueAt').textContent = 'Sem resposta do servidor. Tentando de novo…';
    return;
  }
  S.queue = Array.isArray(rows) ? rows : [];
  queuePoll.setInterval(S.c ? 15000 : 5000);
  announceQueue();
  renderQueue();
  $('#queueAt').textContent = `Atualizada às ${T.fmtTime(new Date().toISOString())}.`;
  const waiting = S.queue.filter((q) => q.status === 'waiting').length;
  document.title = `${waiting ? `(${waiting}) ` : ''}Área do médico | IMED`;
  // Consulta própria em andamento (por exemplo, depois de recarregar a página): volta para ela.
  const mine = S.queue.find((q) => q.status === 'accepted' || q.status === 'in_call');
  if (mine && !S.c) resumeConsult(mine.id);
}
// Paciente novo na fila: aviso curto para o leitor de tela (a lista em si não é "ao vivo") e, com a aba escondida,
// bipe e notificação (sem o nome do paciente).
function announceQueue() {
  const waiting = S.queue.filter((q) => q.status === 'waiting');
  const first = S.seenIds == null;
  const fresh = first ? [] : waiting.filter((q) => !S.seenIds.has(q.id));
  S.seenIds = new Set(waiting.map((q) => q.id));
  if (!fresh.length) return;
  const q = fresh[0];
  const age = T.ageLabel(q.age_years);
  $('#queueLive').textContent = fresh.length === 1
    ? `Novo paciente na fila: ${q.patient_name}${age ? `, ${age}` : ''}.`
    : `${fresh.length} novos pacientes na fila.`;
  if (S.available && !S.c) notify(fresh.length === 1 ? 'Novo paciente na fila da teleconsulta.' : `${fresh.length} novos pacientes na fila da teleconsulta.`);
}
function queueItem(q) {
  const own = q.status !== 'waiting';
  const who = q.for_other ? `<span class="md-qtag">Pedido por responsável${q.relationship ? ` (${esc(q.relationship)})` : ''}</span>` : '';
  const seen = own ? null : T.seenText(q.seen_seconds);
  return `<li class="md-q${own ? ' own' : ''}" data-q="${esc(q.id)}">
    <div class="md-qmain"><b>${esc(q.patient_name)}</b><span>${esc(T.ageLabel(q.age_years))}${q.age_years != null && q.age_years < 18 ? ' · menor de idade' : ''}</span>${who}
      <p class="md-qreason">${esc(q.reason)}</p>
      <small>${own ? esc(T.STATUS_DOCTOR[q.status] || '') : `Esperando há ${esc(String(Math.max(0, Number(q.wait_minutes) || 0)))} min`}</small>
      ${seen ? `<small class="md-seen${seen.ok ? ' ok' : ''}">${esc(seen.ok ? 'Página aberta no aparelho do paciente.' : seen.text)}</small>` : ''}</div>
    <div class="md-qacts">${own
      ? `<button class="btn btn-primary btn-sm" type="button" data-resume="${esc(q.id)}">Voltar para a consulta</button>`
      : `<button class="btn btn-coral btn-sm" type="button" data-accept="${esc(q.id)}"${S.c ? ' disabled' : ''}>Atender<span class="sr"> ${esc(q.patient_name)}</span></button>
         <button class="btn btn-ghost btn-sm" type="button" data-dismiss="${esc(q.id)}">Tirar da fila<span class="sr"> ${esc(q.patient_name)}</span></button>`}</div>
    ${own ? '' : `<div class="tl-confirm" data-dismissbox="${esc(q.id)}" role="group" aria-label="Tirar ${esc(q.patient_name)} da fila" hidden>
      <p>Tirar este pedido da fila? Use só para pedido falso ou repetido: o paciente vê que um médico retirou o pedido.</p>
      <div class="tl-row"><button class="btn btn-coral btn-sm" type="button" data-dismissyes="${esc(q.id)}">Sim, tirar da fila</button><button class="btn btn-ghost btn-sm" type="button" data-dismissno="${esc(q.id)}">Voltar</button></div></div>`}
  </li>`;
}
// Só refaz a lista quando algo mudou (e devolve o foco ao mesmo botão), para não atrapalhar quem usa teclado ou
// leitor de tela.
function renderQueue() {
  const list = $('#queue');
  const sig = JSON.stringify([!!S.c, S.available, S.queue.map((q) => [q.id, q.status, q.patient_name, q.age_years, q.reason, q.for_other, q.relationship, q.wait_minutes, q.status === 'waiting' ? T.seenText(q.seen_seconds).text : ''])]);
  if (sig === S.queueSig) return;
  S.queueSig = sig;
  const a = document.activeElement;
  const keep = a && list.contains(a) ? ['data-accept', 'data-resume', 'data-dismiss', 'data-dismissyes', 'data-dismissno'].find((k) => a.hasAttribute(k)) : null;
  const keepVal = keep ? a.getAttribute(keep) : null;
  const open = $$('[data-dismissbox]:not([hidden])', list).map((b) => b.dataset.dismissbox);
  list.innerHTML = S.queue.length
    ? S.queue.map(queueItem).join('')
    : `<li class="md-qempty"><i class="fa-solid fa-mug-hot" aria-hidden="true"></i>Ninguém na fila agora.${S.available ? '' : ' Ligue “Disponível para atender” para os pacientes saberem que há médico atendendo.'}</li>`;
  for (const id of open) { const b = list.querySelector(`[data-dismissbox="${CSS.escape(id)}"]`); if (b) b.hidden = false; }
  if (keep) list.querySelector(`[${keep}="${CSS.escape(keepVal)}"]`)?.focus();
}
async function accept(id, btn) {
  if (S.c) return;
  if (btn) btn.disabled = true;
  try {
    const rows = await A.rpc('tele_accept', { p_id: id });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error('vazio');
    await openConsult(row, 'live');
  } catch (err) {
    if (lostSession(err)) return;
    const { code } = T.errorInfo(err);
    toast(T.errorText(code));
    if (code === 'consulta_ativa') queuePoll.now();
    else loadQueue();
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function dismiss(id, btn) {
  btn.disabled = true;
  try {
    await A.rpc('tele_dismiss', { p_id: id });
    toast('Pedido retirado da fila.');
    $('#queueLive').textContent = 'Pedido retirado da fila.';
  } catch (err) {
    if (lostSession(err)) return;
    const { code } = T.errorInfo(err);
    toast(code === 'estado_invalido' ? 'Este pedido não está mais esperando.' : T.errorText(code));
  } finally {
    btn.disabled = false;
    await loadQueue();
    $('#dutyTitle').focus();
  }
}
async function resumeConsult(id) {
  if (S.c) return;
  let rows;
  try { rows = await A.rpc('tele_doctor_status', { p_id: id }); } catch (err) { lostSession(err); return; }
  const st = Array.isArray(rows) ? rows[0] : null;
  if (!st || S.c) return;
  await openConsult(st, ['accepted', 'in_call'].includes(st.status) ? 'live' : 'ended');
  toast('Você voltou para a consulta em andamento.');
}

/* ======================= consulta ======================= */
// Com a aba escondida (por exemplo, emitindo o pedido assinado em outra aba), a consulta continua sendo
// acompanhada: resposta do paciente, reconexão e mensagens não esperam o médico voltar.
const consultPoll = T.createPoller({ run: pollConsult, interval: 3000, hiddenInterval: 4000 });
async function openConsult(row, mode) {
  S.c = { id: row.id, status: row.status || 'accepted', data: row };
  S.mode = mode;
  S.msgs = []; S.lastMsg = 0; S.shownMsg = 0; S.version = 0; S.applied = null; S.connected = false; S.flow = null;
  S.exams = []; S.sent = '[]'; S.sentInd = '';
  $('#dutyCard').hidden = true; $('#histCard').hidden = true; $('#adminCard').hidden = true;
  $('#meCard').hidden = true; $('#regCard').hidden = true;
  $('#cRecord').hidden = false; $('#cExams').hidden = false;
  $('#consult').hidden = false;
  document.body.dataset.view = 'consult';
  $('#cTitle').textContent = mode === 'live' ? `Consulta com ${row.patient_name}` : `Complementar a consulta de ${row.patient_name}`;
  renderPatient(row);
  $('#exSearch').value = ''; filterCatalog('');
  $('#exInd').value = ''; $('#cGuide').value = ''; $('#cNotes').value = '';
  $('#exMsg').textContent = ''; $('#cEndErr').classList.remove('show'); $('#cEndConfirm').hidden = true;
  $('#cExNote').hidden = true; $('#cSeen').textContent = '';
  renderChosen(); renderMsgs(true);
  setLive(mode === 'live');
  $('#cTitle').focus();
  // Dados atuais (exames, orientações, situação).
  try {
    const rows = await A.rpc('tele_doctor_status', { p_id: row.id });
    const st = Array.isArray(rows) ? rows[0] : null;
    if (st && S.c?.id === row.id) {
      S.c.data = { ...row, ...st };
      S.c.status = st.status;
      renderPatient(S.c.data);
      loadExams(st.exams, st.indication);
      $('#cGuide').value = st.guidance || '';
      if (mode === 'ended') showOldNotes(st.notes);
      if (mode === 'ended' && (st.status === 'expired' || st.status === 'cancelled')) {
        // Aceita e depois expirou ou cancelou: o registro é o primeiro (não um adendo); os exames vão junto.
        S.mode = 'closed';
        $('#cNotesLbl').textContent = 'Registro da consulta (prontuário)';
        $('#cEnd span').textContent = 'Registrar e encerrar';
        $('#cOldNotes').hidden = true;
        $('#cExNote').hidden = false;
        $('#cTitle').textContent = `Registrar a consulta de ${st.patient_name}`;
        setState(st.status === 'expired'
          ? 'A consulta expirou sem vídeo. Registre o atendimento (por telefone ou mensagem) até 24 horas depois do aceite.'
          : 'O paciente desistiu da consulta. Se vocês chegaram a conversar, registre o atendimento até 24 horas depois do aceite.');
      } else if (mode === 'ended' && !st.notes) {
        $('#cNotesLbl').textContent = 'Registro da consulta (prontuário)';
      }
    }
  } catch (err) { if (lostSession(err)) return; }
  consultPoll.stop();
  if (mode === 'live') { consultPoll.start(); startVideo(); } else pollMessages();
}
function setLive(live) {
  $('#cVideoCard').hidden = !live;
  $('#cChatForm').hidden = !live;
  $('#cPlanB').hidden = true;
  $('#cBack').hidden = live;
  $('#cNotesLbl').textContent = live ? 'Registro da consulta (prontuário)' : 'Adendo ao registro (entra no fim, com data e hora)';
  $('#cEnd span').textContent = live ? 'Encerrar consulta' : 'Salvar complemento';
  $('#cOldNotes').hidden = live;
  $('#cPhoneNote').hidden = !live;
  setState(live ? 'Preparando o vídeo…' : 'Consulta encerrada. Você pode complementar até 24 horas depois do encerramento.');
}
function showOldNotes(notes) {
  const box = $('#cOldNotes');
  box.hidden = false;
  box.innerHTML = `<h4>Registro já salvo</h4>${notes ? `<p class="tl-pre">${esc(notes)}</p>` : '<p class="tl-muted">Sem registro.</p>'}`;
}
function renderPatient(r) {
  const limited = r.access === 'limited';
  const tel = limited ? null : T.telHref(r.patient_phone);
  const phone = T.fmtPhone(r.patient_phone);
  const age = r.age_years ?? T.ageOn(r.patient_birthdate, T.todaySP());
  const rows = [
    ['Nome', esc(r.patient_name)],
    ['Nascimento', `${esc(T.fmtDate(r.patient_birthdate))}${age != null ? ` (${esc(T.ageLabel(age))})` : ''}`],
    ['Celular', limited ? 'Oculto: o seu cadastro não está aprovado agora' : tel ? `<a class="link" href="${esc(tel)}" data-call>${esc(phone)}</a>` : esc(phone || 'Não informado')],
    ['Motivo', `<span class="tl-pre">${esc(r.reason)}</span>`],
  ];
  if (r.for_other) {
    rows.push(['Pedido por', `${esc(r.requester_name || '')}${r.relationship ? ` (${esc(r.relationship)})` : ''}`]);
    if (age != null && age < 18) rows.push(['Responsável', r.guardian_consent ? 'Declarou ser o responsável legal e estar presente' : 'Sem declaração do responsável']);
    else if (r.patient_agrees != null) rows.push(['Concordância', r.patient_agrees ? 'Quem pediu declarou que o paciente está presente e concorda (ou que é o representante legal). Confirme com o paciente.' : 'Sem declaração de quem pediu: confirme com o paciente se ele concorda.']);
  }
  if (r.consent_version) rows.push(['Termo (TCLE)', `Versão ${esc(r.consent_version)}${r.consent_at ? `, aceito em ${esc(T.fmtDateTime(r.consent_at))}` : ''}`]);
  if (r.created_at) rows.push(['Pedido', esc(T.fmtDateTime(r.created_at))]);
  $('#cPatBox').innerHTML = `<dl class="md-dl">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${tel ? `<a class="btn btn-ghost btn-sm" href="${esc(tel)}" data-call><i class="fa-solid fa-phone" aria-hidden="true"></i>Ligar para ${esc(phone)}</a>` : ''}
    <p class="tl-small">Confirme o nome e a data de nascimento no início da chamada e, se possível, peça um documento com foto na câmera (sem gravar).</p>`;
  const call = $('#cCallBtn');
  if (tel) { call.href = tel; call.querySelector('span').textContent = `Ligar para ${phone}`; call.hidden = false; } else call.hidden = true;
}
function setState(t) { const el = $('#cState'); if (el.textContent !== t) el.textContent = t; }
// A página do paciente está aberta? Ajuda a decidir entre esperar o vídeo e ligar.
function renderSeen(st) {
  const el = $('#cSeen');
  const live = S.mode === 'live' && ['accepted', 'in_call'].includes(st.status);
  const t = live && !S.connected ? T.seenText(st.patient_seen_seconds).text : '';
  if (el.textContent !== t) el.textContent = t;
}
async function pollConsult() {
  if (!S.c) { consultPoll.stop(); return; }
  const id = S.c.id;
  let rows;
  try { rows = await A.rpc('tele_doctor_status', { p_id: id }); } catch (err) { lostSession(err); return; }
  if (!S.c || S.c.id !== id) return;
  const st = Array.isArray(rows) ? rows[0] : null;
  if (!st) { closeConsult(); toast('A consulta não está mais disponível.'); backToQueue(); return; }
  const prev = S.c.status;
  S.c.status = st.status;
  S.c.data = { ...S.c.data, ...st };
  if (S.mode === 'live') {
    renderSeen(st);
    if (st.status === 'accepted' || st.status === 'in_call') {
      // Outra aba deste aparelho estava com o vídeo e foi fechada: esta assume sozinha.
      if (S.lockId !== S.c.id && !S.offering) {
        const ok = await claimConsult(S.c.id);
        if (ok && S.c?.id === id && S.mode === 'live') startVideo();
      } else if (!S.offering && S.peer && S.version && Number(st.answer_version) === S.version && st.answer_sdp) {
        // Enquanto prepara uma oferta nova (S.offering), nenhuma resposta é aplicada: ela seria da oferta antiga.
        if (!S.applied) await applyAnswer(st.answer_sdp);
        else if (st.answer_sdp !== S.applied && !S.loopBlocked) {
          // O paciente recarregou a página ou voltou ao vídeo: respondeu de novo à mesma oferta. Nova conexão,
          // no máximo 3 vezes por minuto (depois, só pelo botão "Tentar o vídeo de novo").
          reconnect('O paciente voltou. Reconectando o vídeo…');
        }
      }
    } else if (prev !== st.status) {
      onClosedRemotely(st);
    }
  }
  await pollMessages();
}
function onClosedRemotely(st) {
  stopVideo();
  consultPoll.stop();
  $('#cVideoCard').hidden = true;
  $('#cChatForm').hidden = true;
  $('#cPhoneNote').hidden = true;
  $('#cBack').hidden = false;
  if (st.status === 'cancelled') {
    S.mode = 'closed';
    $('#cEnd span').textContent = 'Registrar e encerrar';
    $('#cExNote').hidden = false;
    setState('O paciente desistiu da consulta antes de começar. Se vocês chegaram a conversar, registre o atendimento (até 24 horas); se não, volte para a fila.');
    flash('O paciente desistiu da consulta antes de começar.', 'warn');
  } else if (st.status === 'expired') {
    // Expirou (o atendimento não começou em 30 min): o registro e os exames escolhidos ainda vão (até 24 h).
    S.mode = 'closed';
    $('#cEnd span').textContent = 'Registrar e encerrar';
    $('#cExNote').hidden = false;
    setState('A consulta expirou porque o atendimento não começou em 30 minutos. Registre o que houve e encerre: os exames escolhidos vão junto.');
  } else if (st.status === 'ended') {
    S.mode = 'ended';
    setLive(false);
    showOldNotes(st.notes);
    if (!st.notes) $('#cNotesLbl').textContent = 'Registro da consulta (prontuário)';
    if (st.closed_by === 'patient') {
      setState('O paciente encerrou a consulta. Registre o atendimento e, se precisar, mande orientações e exames (até 24 horas).');
      flash('O paciente encerrou a consulta.', 'warn');
      notify('O paciente encerrou a consulta.');
    } else {
      setState('A consulta foi encerrada automaticamente (mais de 3 horas). Você pode complementar até 24 horas.');
    }
  }
}
function backToQueue() {
  $('#consult').hidden = true;
  $('#cRecord').hidden = false; $('#cExams').hidden = false;
  $('#meCard').hidden = !S.me;
  if (S.me?.status === 'approved' && S.duty) { $('#dutyCard').hidden = false; S.queueSig = ''; loadQueue(); }
  if (S.me) { $('#histCard').hidden = false; loadHistory(); }
  if (S.admin) { $('#adminCard').hidden = false; loadAdmin(); }
  $(S.duty ? '#dutyTitle' : '#meTitle')?.focus();
}
function closeConsult(silent = false) {
  consultPoll.stop();
  stopVideo();
  S.c = null;
  delete document.body.dataset.view;
  S.msgs = []; S.lastMsg = 0; S.shownMsg = 0; S.exams = [];
  $('#cPatBox').innerHTML = ''; $('#cMsgs').innerHTML = ''; $('#cNotes').value = ''; $('#cGuide').value = ''; $('#exInd').value = '';
  $('#cOldNotes').innerHTML = '';
  removeEventListener('beforeunload', warnUnsaved);
  if (!silent) { S.queueSig = ''; renderQueue(); }
}
function warnUnsaved(e) { e.preventDefault(); e.returnValue = ''; }
// Plano B: ligar ou continuar por mensagem conta como início do atendimento (a consulta não expira em 30 min e o
// paciente vê que o médico está ligando).
async function markStarted(phone) {
  if (!S.c || S.mode !== 'live' || !['accepted', 'in_call'].includes(S.c.status)) return;
  try {
    const at = await A.rpc('tele_mark_started', { p_id: S.c.id, p_phone: !!phone });
    if (S.c?.data && at) S.c.data.started_at = S.c.data.started_at || at;
  } catch (err) { lostSession(err); }
}

/* ======================= vídeo ======================= */
function mediaHelp(e) {
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return 'O navegador bloqueou a câmera e o microfone. Libere no cadeado ao lado do endereço do site e toque em “Tentar o vídeo de novo”. Enquanto isso, ligue para o paciente.';
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'Não encontramos câmera nem microfone neste aparelho. Ligue para o paciente.';
  if (e?.name === 'NotReadableError') return 'A câmera ou o microfone estão em uso por outro programa (Zoom, Teams, WhatsApp). Feche-o e toque em “Tentar o vídeo de novo”.';
  return 'Não foi possível ligar a câmera e o microfone. Toque em “Tentar o vídeo de novo” ou ligue para o paciente.';
}
let mediaPromise = null;
function ensureMedia() {
  if (S.mediaTried) return mediaPromise || Promise.resolve(S.local);
  S.mediaTried = true;
  mediaPromise = (async () => {
    const md = navigator.mediaDevices;
    let note = '';
    if (!md?.getUserMedia) note = 'Este navegador não libera câmera e microfone.';
    else {
      try { S.local = await md.getUserMedia({ audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 } } }); } catch (e1) {
        try { S.local = await md.getUserMedia({ audio: true }); note = 'Sem câmera: o paciente vai ouvir você, mas não vai ver.'; } catch { S.local = null; note = mediaHelp(e1); }
      }
    }
    // A consulta acabou enquanto o navegador pedia a câmera: desliga na hora.
    if (!S.c || S.mode !== 'live') { const st = S.local; S.local = null; S.mediaTried = false; st?.getTracks().forEach((t) => t.stop()); return null; }
    renderMedia(note);
    return S.local;
  })();
  return mediaPromise;
}
function forgetMedia() {
  S.local?.getTracks().forEach((t) => t.stop());
  S.local = null; S.mediaTried = false; mediaPromise = null;
  $('#cLocal').srcObject = null;
}
async function renderMedia(note) {
  const lv = $('#cLocal');
  lv.srcObject = S.local;
  lv.hidden = !S.local?.getVideoTracks().length;
  if (S.local) lv.play?.().catch(() => {});
  $('#cMedia').textContent = note || '';
  $('#cMedia').hidden = !note;
  $('#cMic').disabled = !S.local?.getAudioTracks().length;
  $('#cCam').disabled = !S.local?.getVideoTracks().length;
  setToggle('#cMic', true, 'Desligar microfone', 'Ligar microfone', 'fa-microphone', 'fa-microphone-slash');
  setToggle('#cCam', true, 'Desligar câmera', 'Ligar câmera', 'fa-video', 'fa-video-slash');
  let cams = 0;
  try { cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length; } catch { cams = 0; }
  $('#cFlip').hidden = !(S.local?.getVideoTracks().length && cams > 1);
}
// Só uma aba (ou janela) deste aparelho cuida do vídeo da consulta (Web Locks; sem suporte, segue normalmente).
let lockRelease = null;
let lockPending = null;
function claimConsult(id) {
  if (S.lockId === id) return Promise.resolve(true);
  if (lockPending) return lockPending;
  if (!navigator.locks?.request) { S.lockId = id; return Promise.resolve(true); }
  lockPending = new Promise((resolve) => {
    navigator.locks.request(`imed_medico_${id}`, { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return undefined; }
      resolve(true);
      return new Promise((r) => { lockRelease = r; });
    }).catch(() => resolve(true));
  }).then((ok) => {
    lockPending = null;
    if (S.c?.id !== id) { if (ok) { lockRelease?.(); lockRelease = null; } return false; }
    if (ok) S.lockId = id;
    return ok;
  });
  return lockPending;
}
function releaseConsult() { lockRelease?.(); lockRelease = null; S.lockId = null; }
function setRetryBusy(busy) { for (const b of [$('#cRetry'), $('#cRetry2')]) b.disabled = busy; }
async function startVideo({ manual = false } = {}) {
  if (!S.c || S.mode !== 'live' || S.offering) return;
  if (manual) {
    S.reoffers = []; S.loopBlocked = false;
    // Liberou a câmera no cadeado ou fechou o programa que a usava: pede de novo o que falta.
    if (!S.local?.getAudioTracks().length || !S.local?.getVideoTracks().length) forgetMedia();
  }
  S.offering = true;
  setRetryBusy(true);
  const id = S.c.id;
  try {
    if (!(await claimConsult(id))) {
      $('#cStage').hidden = true; $('#cCtrls').hidden = true;
      setState('Esta consulta está aberta em outra aba ou janela deste aparelho. Continue por lá. Se você fechou a outra aba, esta assume sozinha em alguns segundos.');
      return;
    }
    $('#cStage').hidden = false; $('#cCtrls').hidden = false;
    $('#cPlanB').hidden = true;
    stageMsg('Aguardando o paciente entrar no vídeo…');
    setState('Preparando o vídeo…');
    // Esquece a oferta antiga ANTES de trocar a conexão: uma resposta atrasada a ela não pode cair na nova.
    S.version = 0; S.applied = null; S.connected = false; S.flow = null;
    await ensureMedia();
    closePeer();
    let peer;
    let sdp;
    try {
      peer = T.createPeer({ iceServers: ICE, gatherMs: GATHER_MS, onTrack: onRemote, onState: (s) => onPeer(peer, s) });
      S.peer = peer;
      sdp = await peer.offer(S.local);
    } catch {
      closePeer();
      showPlanB('Este navegador não conseguiu preparar o vídeo.');
      return;
    }
    if (S.peer !== peer || !S.c || S.c.id !== id) return;
    const v = await A.rpc('tele_offer', { p_id: id, p_sdp: sdp });
    if (S.peer !== peer) return;
    S.version = Number(v) || 0;
    S.applied = null;
    S.connected = false;
    setState('Chamando o paciente para o vídeo…');
    armPlanB();
    consultPoll.setInterval(1500);
    consultPoll.now();
  } catch (err) {
    if (lostSession(err)) return;
    const { code } = T.errorInfo(err);
    closePeer();
    if (code === 'estado_invalido' || code === 'nao_encontrado') consultPoll.now();
    else showPlanB(T.errorText(code));
  } finally {
    S.offering = false;
    setRetryBusy(false);
  }
}
// Nova oferta sem o médico precisar tocar em nada (o paciente voltou, ou a conexão caiu), no máximo 3 por minuto.
function reconnect(text) {
  if (!S.c || S.mode !== 'live' || S.offering || S.loopBlocked) return;
  const now = Date.now();
  S.reoffers = (S.reoffers || []).filter((t) => now - t < 60000);
  if (S.reoffers.length >= 3) {
    S.loopBlocked = true;
    showPlanB('O vídeo recomeçou várias vezes. Ligue para o paciente ou toque em “Tentar o vídeo de novo”.');
    return;
  }
  S.reoffers.push(now);
  setState(text);
  startVideo();
}
async function applyAnswer(sdp) {
  const peer = S.peer;
  // Só aplica numa conexão que está esperando resposta (uma resposta de outra oferta derrubaria a conexão nova).
  if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
  try {
    await peer.applyAnswer(sdp);
    if (S.peer !== peer) return;
    S.applied = sdp;
    S.flow = peer.flow();
    setState('Conectando ao paciente…');
  } catch {
    if (S.peer !== peer) return;
    S.applied = sdp;
    showPlanB('Não foi possível conectar o vídeo.');
  }
}
function armPlanB() {
  clearTimeout(S.planBTimer);
  S.planBTimer = setTimeout(() => { if (!S.connected && S.c && S.mode === 'live') showPlanB(); }, PLAN_B_MS);
}
const PLANB_LEAD = '<b>O vídeo não conectou.</b> Ligue para o paciente ou continue pelas mensagens. O paciente foi avisado de que você pode ligar.';
function showPlanB(reason, lead = PLANB_LEAD) {
  $('#cPlanBLead').innerHTML = lead;
  $('#cPlanB').hidden = false;
  setState(reason || 'O vídeo não conectou. Ligue para o paciente ou use as mensagens.');
  consultPoll.setInterval(3000);
}
function stageMsg(t) { $('#cStageText').textContent = t; $('#cStageMsg').hidden = !t; }
// Conectou: confere o que o paciente manda de fato. Sem microfone (bloqueado no aparelho dele), a conexão "sobe",
// mas o médico não ouve nada: abre o plano B.
function onConnected() {
  const f = S.flow;
  if (f?.known && !f.recvAudio) {
    const lead = f.recvVideo
      ? '<b>O paciente está sem microfone.</b> Você vê, mas não ouve: o microfone está bloqueado ou desligado no aparelho dele. Ligue para ele ou escreva nas mensagens.'
      : '<b>O paciente está sem microfone e câmera</b> (bloqueados no aparelho dele). Ligue para ele ou escreva nas mensagens.';
    showPlanB(f.recvVideo ? 'O paciente está sem microfone: ligue para ele.' : 'O paciente está sem microfone e câmera: ligue para ele.', lead);
    return;
  }
  $('#cPlanB').hidden = true;
  if (f?.known && !f.sendAudio) setState('Conectado, mas o paciente não ouve você: o seu microfone está bloqueado ou desligado. Libere no cadeado e toque em “Tentar o vídeo de novo”.');
  else if (f?.known && !f.recvVideo) setState('Conectado só com áudio: o paciente está sem câmera.');
  else setState('Vídeo conectado.');
}
function onPeer(peer, s) {
  if (!peer || peer !== S.peer) return;
  if (s === 'connected') {
    S.connected = true;
    clearTimeout(S.planBTimer); clearTimeout(S.dropTimer);
    stageMsg('');
    $('#cSeen').textContent = '';
    onConnected();
    consultPoll.setInterval(4000);
  } else if (s === 'connecting') {
    setState('Conectando ao paciente…');
  } else if (s === 'disconnected') {
    S.connected = false;
    setState('A conexão do vídeo caiu. Tentando reconectar…');
    clearTimeout(S.dropTimer);
    S.dropTimer = setTimeout(() => { if (!S.connected && S.peer === peer) { stageMsg('O vídeo caiu.'); reconnect('O vídeo caiu. Reconectando…'); } }, 8000);
    consultPoll.setInterval(1500);
  } else if (s === 'failed') {
    S.connected = false;
    stageMsg('O vídeo caiu.');
    reconnect('O vídeo caiu. Reconectando…');
  }
}
function onRemote(stream) {
  const v = $('#cRemote');
  if (!stream) return;
  if (v.srcObject !== stream) v.srcObject = stream;
  if (v.paused) v.play().catch((e) => { if (e?.name === 'NotAllowedError') $('#cUnmute').hidden = false; });
}
function closePeer() {
  if (S.peer) { S.peer.close(); S.peer = null; }
  const v = $('#cRemote');
  if (v.srcObject) v.srcObject = null;
}
function stopVideo() {
  clearTimeout(S.planBTimer); clearTimeout(S.dropTimer);
  releaseConsult();
  S.reoffers = []; S.loopBlocked = false;
  closePeer();
  forgetMedia();
  S.connected = false; S.version = 0; S.applied = null; S.flow = null;
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
  if (kind === 'audio') setToggle('#cMic', on, 'Desligar microfone', 'Ligar microfone', 'fa-microphone', 'fa-microphone-slash');
  else setToggle('#cCam', on, 'Desligar câmera', 'Ligar câmera', 'fa-video', 'fa-video-slash');
}
async function flipCamera() {
  const md = navigator.mediaDevices;
  if (!S.local || !md || S.flipping) return;
  S.flipping = true;
  $('#cFlip').disabled = true;
  try {
    const cams = (await md.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    if (cams.length < 2) return;
    const cur = S.local.getVideoTracks()[0];
    const curId = cur?.getSettings?.().deviceId;
    const next = cams[(cams.findIndex((d) => d.deviceId === curId) + 1) % cams.length];
    cur?.stop();
    let track = null;
    try { track = (await md.getUserMedia({ video: { deviceId: { exact: next.deviceId } } })).getVideoTracks()[0]; } catch {
      try { track = (await md.getUserMedia({ video: true })).getVideoTracks()[0]; } catch { track = null; }
    }
    if (!S.local) { track?.stop(); return; }
    if (cur) S.local.removeTrack(cur);
    if (!track) { toast('Não foi possível trocar a câmera.'); return; }
    S.local.addTrack(track);
    try { await S.peer?.replaceVideo(track); } catch { /* a próxima conexão usa a câmera nova */ }
    $('#cLocal').srcObject = S.local;
  } finally {
    S.flipping = false;
    $('#cFlip').disabled = false;
  }
}

/* ======================= mensagens ======================= */
async function pollMessages() {
  if (!S.c) return;
  const id = S.c.id;
  try {
    const rows = await A.rpc('tele_doctor_messages', { p_id: id, p_after: S.lastMsg });
    if (!S.c || S.c.id !== id) return;
    if (Array.isArray(rows) && rows.length) {
      const before = S.msgs.length;
      S.msgs = T.mergeMessages(S.msgs, rows);
      S.lastMsg = T.lastId(S.msgs);
      renderMsgs();
      if (before > 0 && S.msgs.slice(before).some((m) => m.sender === 'patient')) { toast('Nova mensagem do paciente.'); notify('Nova mensagem do paciente na teleconsulta.'); }
    }
  } catch { /* próxima consulta */ }
}
function msgHtml(m) {
  const mine = m.sender === 'doctor';
  return `<li class="tl-bub ${mine ? 'me' : 'doc'}"><span class="tl-bub-who">${mine ? 'Você' : 'Paciente'} · ${esc(T.fmtTime(m.created_at))}</span><p>${esc(m.body)}</p></li>`;
}
// A lista (role=log) recebe só as mensagens novas: o leitor de tela lê cada uma uma vez.
function renderMsgs(reset = false) {
  const list = $('#cMsgs');
  if (reset || !S.shownMsg || !S.msgs.length) {
    list.innerHTML = S.msgs.length ? S.msgs.map(msgHtml).join('') : '<li class="tl-bub-empty">Nenhuma mensagem ainda.</li>';
    S.shownMsg = T.lastId(S.msgs);
    list.scrollTop = list.scrollHeight;
    return;
  }
  const fresh = S.msgs.filter((m) => Number(m.id) > S.shownMsg);
  if (!fresh.length) return;
  const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.insertAdjacentHTML('beforeend', fresh.map(msgHtml).join(''));
  S.shownMsg = T.lastId(S.msgs);
  if (atEnd || fresh[fresh.length - 1].sender === 'doctor') list.scrollTop = list.scrollHeight;
}
function setupChat() {
  const form = $('#cChatForm');
  const text = $('#cChatText');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = text.value.trim();
    $('#cChatErr').textContent = '';
    if (!body || S.sending || !S.c) return;
    if (body.length > 1000) { $('#cChatErr').textContent = 'A mensagem pode ter até 1.000 caracteres.'; return; }
    S.sending = true;
    $('#cChatBtn').disabled = true;
    try {
      await A.rpc('tele_doctor_send', { p_id: S.c.id, p_body: body });
      text.value = '';
      await pollMessages();
    } catch (err) {
      if (lostSession(err)) return;
      const { code, details } = T.errorInfo(err);
      $('#cChatErr').textContent = code === 'estado_invalido' ? 'A consulta não está mais em andamento.' : T.errorText(code, details);
    } finally {
      S.sending = false;
      $('#cChatBtn').disabled = false;
    }
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); T.submitForm(form, $('#cChatBtn')); }
  });
}

/* ======================= exames ======================= */
function renderCatalog() {
  $('#exCatalog').innerHTML = T.CATALOG.map((g) => `<details class="md-group" data-group="${esc(g.id)}">
      <summary>${esc(g.label)} <span class="md-gcount">(${g.items.length})</span></summary>
      <ul>${g.items.map((it) => `<li data-item="${esc(it.id)}"><label class="tl-check"><input type="checkbox" data-ex="${esc(it.id)}"><span>${esc(it.name)}</span></label></li>`).join('')}</ul>
    </details>`).join('') + '<p class="tl-muted md-nohit" id="exNone" hidden>Nenhum exame encontrado. Use “Outro exame”, logo abaixo.</p>';
  $('#exOtherType').insertAdjacentHTML('beforeend', Object.entries(T.SEARCH).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join(''));
}
function filterCatalog(q) {
  const query = T.fold(q);
  const hits = new Set(query ? T.searchCatalog(q).map((it) => it.id) : []);
  let n = 0;
  for (const g of $$('#exCatalog .md-group')) {
    let any = false;
    for (const li of $$('li[data-item]', g)) {
      const show = !query || hits.has(li.dataset.item);
      li.hidden = !show;
      if (show) any = true;
    }
    g.hidden = !any;
    if (query) g.open = any;
    if (any && query) n += $$('li[data-item]:not([hidden])', g).length;
  }
  $('#exNone').hidden = !query || n > 0;
  $('#exHits').textContent = query ? (n ? `${n} ${n === 1 ? 'exame encontrado' : 'exames encontrados'}` : 'Nenhum exame encontrado') : '';
}
function loadExams(list, indication) {
  S.exams = (Array.isArray(list) ? list : []).map((e) => ({ ...e, key: e.code && e.code !== T.OTHER_EXAM.id ? e.code : `outro:${++S.otherN}` }));
  S.sent = JSON.stringify(T.examsPayload(S.exams));
  $('#exInd').value = indication || '';
  S.sentInd = (indication || '').trim();
  syncChecks();
  renderChosen();
}
const examsDirty = () => JSON.stringify(T.examsPayload(S.exams)) !== S.sent || $('#exInd').value.trim() !== S.sentInd;
function syncChecks() {
  const keys = new Set(S.exams.map((e) => e.key));
  $$('#exCatalog input[data-ex]').forEach((i) => { i.checked = keys.has(i.dataset.ex); });
}
function renderChosen() {
  $('#exCount').textContent = String(S.exams.length);
  $('#exChosen').innerHTML = S.exams.length
    ? S.exams.map((e, i) => {
      const obs = T.catalogItem(e.code)?.obs;
      return `<li data-key="${esc(e.key)}"><div class="md-chosen-h"><b>${esc(e.name)}</b><small>${esc(e.group || '')}${e.search ? ` · busca: ${esc(T.SEARCH[e.search] || e.search)}` : ''}</small>
        <button class="md-x" type="button" data-remove="${esc(e.key)}" aria-label="Tirar ${esc(e.name)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
        <label class="sr" for="exNote${i}">Observação para ${esc(e.name)}</label>
        <input id="exNote${i}" class="md-exnote" data-note="${esc(e.key)}" maxlength="200" value="${esc(e.note || '')}" placeholder="${esc(obs ? `${obs} (opcional)` : 'Observação (opcional)')}"></li>`;
    }).join('')
    : '<li class="md-chosen-empty">Nenhum exame escolhido. Marque no catálogo acima ou escreva em “Outro exame”.</li>';
  updateExMsg();
}
function updateExMsg() {
  const m = $('#exMsg');
  if (!S.c) return;
  if (examsDirty()) { m.textContent = S.sent === '[]' && !S.sentInd ? 'Ainda não enviado ao paciente.' : 'Há mudanças ainda não enviadas ao paciente.'; m.className = 'tl-msg warn'; }
}
function toggleExam(id, on) {
  if (on) {
    if (S.exams.some((e) => e.key === id)) return;
    if (S.exams.length >= 60) { toast('O pedido pode ter até 60 exames.'); syncChecks(); return; }
    const e = T.examFromCatalog(id);
    if (e) S.exams.push({ ...e, key: id });
  } else {
    S.exams = S.exams.filter((e) => e.key !== id);
  }
  renderChosen();
}
async function sendExams({ quiet = false } = {}) {
  if (!S.c) return false;
  const payload = T.examsPayload(S.exams);
  const ind = $('#exInd').value.trim();
  const btn = $('#exSend');
  btn.disabled = true;
  try {
    const n = await A.rpc('tele_set_exams', { p_id: S.c.id, p_exams: payload, p_indication: ind || null });
    S.sent = JSON.stringify(payload);
    S.sentInd = ind;
    const m = $('#exMsg');
    m.className = 'tl-msg ok';
    m.textContent = `${Number(n) === 1 ? '1 exame enviado' : `${Number(n) || 0} exames enviados`} ao paciente às ${T.fmtTime(new Date().toISOString())}.`;
    if (!quiet) toast('Pedido de exames enviado ao paciente.');
    return true;
  } catch (err) {
    if (lostSession(err)) return false;
    const { code, details } = T.errorInfo(err);
    $('#exMsg').className = 'tl-msg err';
    $('#exMsg').textContent = code === 'estado_invalido' && S.mode === 'closed'
      ? 'Os exames vão junto quando você registrar a consulta (botão “Registrar e encerrar”).'
      : T.errorText(code, details);
    return false;
  } finally {
    btn.disabled = false;
  }
}
function setupExams() {
  renderCatalog();
  $('#exSearch').addEventListener('input', (e) => filterCatalog(e.target.value));
  $('#exCatalog').addEventListener('change', (e) => { const i = e.target.closest('input[data-ex]'); if (i) toggleExam(i.dataset.ex, i.checked); });
  $('#exChosen').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    S.exams = S.exams.filter((x) => x.key !== b.dataset.remove);
    syncChecks();
    renderChosen();
    $('#exSearch').focus();
  });
  $('#exChosen').addEventListener('input', (e) => {
    const i = e.target.closest('[data-note]');
    if (!i) return;
    const ex = S.exams.find((x) => x.key === i.dataset.note);
    if (ex) ex.note = i.value;
    updateExMsg();
  });
  $('#exInd').addEventListener('input', updateExMsg);
  $('#exOtherAdd').addEventListener('click', () => {
    const name = $('#exOther').value;
    const e = T.freeExam(name, '', $('#exOtherType').value || null);
    $('#exOtherErr').textContent = '';
    if (!e) { $('#exOtherErr').textContent = 'Escreva o nome do exame.'; $('#exOther').focus(); return; }
    if (S.exams.length >= 60) { $('#exOtherErr').textContent = 'O pedido pode ter até 60 exames.'; return; }
    S.exams.push({ ...e, key: `outro:${++S.otherN}` });
    $('#exOther').value = ''; $('#exOtherType').value = '';
    renderChosen();
    toast(`${e.name}: adicionado.`);
  });
  $('#exOther').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#exOtherAdd').click(); } });
  $('#exSend').addEventListener('click', () => {
    if (!S.exams.length && S.sent === '[]') { $('#exMsg').className = 'tl-msg err'; $('#exMsg').textContent = 'Escolha pelo menos um exame.'; return; }
    sendExams();
  });
}

/* ======================= orientações, registro e encerramento ======================= */
const TEMPLATE = 'Motivo:\nHistória:\nAntecedentes e remédios em uso:\nO que foi possível observar por vídeo:\nHipóteses:\nConduta e orientações:\nExames pedidos:\nEncaminhamento (presencial, especialista ou emergência):\nModalidade: vídeo / telefone / mensagens\n';
function setupRecord() {
  $('#cTpl').addEventListener('click', () => {
    const t = $('#cNotes');
    t.value = t.value.trim() ? `${t.value.replace(/\s+$/, '')}\n\n${TEMPLATE}` : TEMPLATE;
    t.focus();
    watchUnsaved();
  });
  $('#cPhoneNote').addEventListener('click', () => {
    const t = $('#cNotes');
    const line = `A consulta continuou por telefone ou mensagem (vídeo sem conexão) às ${T.fmtTime(new Date().toISOString())}.`;
    t.value = t.value.trim() ? `${t.value.replace(/\s+$/, '')}\n${line}` : line;
    toast('Anotado no registro.');
    watchUnsaved();
    markStarted(false);
  });
  $('#cCallBtn').addEventListener('click', () => markStarted(true));
  $('#cPatBox').addEventListener('click', (e) => { if (e.target.closest('[data-call]')) markStarted(true); });
  $('#cRetry').addEventListener('click', () => startVideo({ manual: true }));
  $('#cRetry2').addEventListener('click', () => startVideo({ manual: true }));
  $('#cMic').addEventListener('click', () => toggleTrack('audio'));
  $('#cCam').addEventListener('click', () => toggleTrack('video'));
  $('#cFlip').addEventListener('click', flipCamera);
  $('#cUnmute').addEventListener('click', () => { $('#cRemote').play().catch(() => {}); });
  $('#cRemote').addEventListener('playing', () => { $('#cUnmute').hidden = true; });
  $('#cBack').addEventListener('click', () => { closeConsult(); backToQueue(); });
  $('#cNotes').addEventListener('input', watchUnsaved);
  $('#cGuide').addEventListener('input', watchUnsaved);
  $('#cEnd').addEventListener('click', () => {
    $('#cEndErr').classList.remove('show');
    if (S.mode !== 'live') { finish(); return; }
    $('#cEndConfirm').hidden = false;
    $('#cEndYes').focus();
  });
  $('#cEndNo').addEventListener('click', () => { $('#cEndConfirm').hidden = true; $('#cEnd').focus(); });
  $('#cEndYes').addEventListener('click', finish);
}
function watchUnsaved() {
  if (S.c) { removeEventListener('beforeunload', warnUnsaved); addEventListener('beforeunload', warnUnsaved); }
}
// Encerrar (ou registrar) nunca fica preso pelos exames: com a consulta em andamento, os exames vão antes (o
// paciente vê tudo junto); se a consulta já saiu do ar (expirou, o paciente desistiu ou encerrou), o registro vai
// primeiro e os exames depois (o banco aceita até 24 h depois de encerrar).
async function finish() {
  if (!S.c) return;
  const err = $('#cEndErr');
  const notes = $('#cNotes').value;
  const guide = $('#cGuide').value;
  if (notes.length > 20000) { err.textContent = 'O registro pode ter até 20.000 caracteres.'; err.classList.add('show'); return; }
  const btns = [$('#cEndYes'), $('#cEnd')];
  btns.forEach((b) => { b.disabled = true; });
  try {
    const needExams = examsDirty() && (S.exams.length || S.sent !== '[]');
    let examsOk = !needExams;
    if (needExams && ['accepted', 'in_call'].includes(S.c.status)) examsOk = await sendExams({ quiet: true });
    await A.rpc('tele_end', { p_id: S.c.id, p_notes: notes.trim() || null, p_guidance: guide.trim() || null });
    if (!examsOk) { S.c.status = 'ended'; examsOk = await sendExams({ quiet: true }); }
    const wasLive = S.mode === 'live';
    const name = S.c.data?.patient_name || '';
    closeConsult();
    backToQueue();
    if (!examsOk) flash('O registro foi salvo, mas os exames não foram enviados. Abra a consulta em “Suas consultas anteriores” e envie de novo (até 24 horas).', 'warn');
    else flash(wasLive ? `Consulta com ${name} encerrada. O paciente já vê as orientações e os exames.` : 'Registro salvo. O paciente vê as orientações e os exames.', 'ok');
  } catch (ex) {
    if (lostSession(ex)) return;
    const { code, details } = T.errorInfo(ex);
    err.textContent = T.errorText(code, details);
    err.classList.add('show');
  } finally {
    btns.forEach((b) => { b.disabled = false; });
    $('#cEndConfirm').hidden = true;
  }
}

/* ======================= histórico ======================= */
async function loadHistory() {
  let rows;
  try { rows = await A.rpc('tele_history'); } catch (err) { if (lostSession(err)) return; rows = null; }
  $('#histNote').hidden = !S.me || S.me.status === 'approved';
  if (!Array.isArray(rows)) { $('#hist').innerHTML = '<li class="tl-muted">Não foi possível carregar as consultas anteriores.</li>'; $('#histCard').hidden = !!S.c; return; }
  S.hist = rows;
  $('#histCard').hidden = !!S.c;
  $('#hist').innerHTML = rows.length ? rows.map((h) => {
    const canEdit = h.status === 'ended' && within24(h.ended_at);
    // Aceita e depois expirada ou cancelada (por exemplo, atendida só por telefone): ainda dá para registrar em 24 h.
    const canRegister = (h.status === 'expired' || h.status === 'cancelled') && within24(h.accepted_at);
    const ex = Array.isArray(h.exams) ? h.exams : [];
    const label = `${T.STATUS_DOCTOR[h.status] || h.status}${h.status === 'ended' && h.closed_by === 'patient' ? ' pelo paciente' : ''}`;
    return `<li class="md-h"><details><summary><span><b>${esc(h.patient_name)}</b> · ${esc(T.fmtDateTime(h.accepted_at || h.created_at))}</span><span class="tl-chip ${h.status === 'ended' ? 'ok' : 'err'}">${esc(label)}</span></summary>
      <dl class="md-dl">
        <div><dt>Nascimento</dt><dd>${esc(T.fmtDate(h.patient_birthdate))}</dd></div>
        <div><dt>Celular</dt><dd>${h.patient_phone ? esc(T.fmtPhone(h.patient_phone)) : 'Oculto'}</dd></div>
        <div><dt>Motivo</dt><dd class="tl-pre">${esc(h.reason)}</dd></div>
        ${h.for_other ? `<div><dt>Pedido por</dt><dd>${esc(h.requester_name || '')}${h.relationship ? ` (${esc(h.relationship)})` : ''}</dd></div>` : ''}
        ${h.ended_at ? `<div><dt>Encerrada</dt><dd>${esc(T.fmtDateTime(h.ended_at))}</dd></div>` : ''}
        <div><dt>Exames</dt><dd>${ex.length ? esc(ex.map((e) => e.name + (e.note ? ` (${e.note})` : '')).join('; ')) : 'Nenhum'}${Number(h.exams_version) > 1 ? ` <small>(versão ${esc(String(h.exams_version))}; as anteriores ficam guardadas)</small>` : ''}</dd></div>
        ${h.indication ? `<div><dt>Indicação</dt><dd class="tl-pre">${esc(h.indication)}</dd></div>` : ''}
        <div><dt>Orientações</dt><dd class="tl-pre">${h.guidance ? esc(h.guidance) : 'Nenhuma'}</dd></div>
        <div><dt>Registro</dt><dd class="tl-pre">${h.notes ? esc(h.notes) : 'Sem registro'}</dd></div>
      </dl>
      ${canEdit ? `<button class="btn btn-ghost btn-sm" type="button" data-amend="${esc(h.id)}"><i class="fa-solid fa-pen" aria-hidden="true"></i>Complementar (até 24 h)</button>` : ''}
      ${canRegister ? `<button class="btn btn-ghost btn-sm" type="button" data-amend="${esc(h.id)}"><i class="fa-solid fa-file-medical" aria-hidden="true"></i>Registrar o atendimento (até 24 h)</button>` : ''}
      </details></li>`;
  }).join('') : '<li class="tl-muted">Nenhuma consulta ainda.</li>';
}
function amend(id) {
  const h = S.hist.find((x) => x.id === id);
  if (!h || S.c) return;
  openConsult(h, 'ended');
}

/* ======================= equipe do IMED ======================= */
async function loadAdmin() {
  $('#adminCard').hidden = !!S.c;
  let rows;
  try { rows = await A.rpc('tele_admin_doctors'); } catch (err) {
    if (lostSession(err)) return;
    const { code } = T.errorInfo(err);
    if (code === 'so_admin') { S.admin = false; $('#adminCard').hidden = true; return; }
    $('#admin').innerHTML = `<p class="bk-err show">${esc(T.errorText(code))}</p>`;
    return;
  }
  const list = Array.isArray(rows) ? rows : [];
  const pend = list.filter((d) => d.status === 'pending').length;
  $('#admin').innerHTML = list.length
    ? `<p class="tl-small">${pend ? `${pend} ${pend === 1 ? 'cadastro esperando' : 'cadastros esperando'} análise.` : 'Nenhum cadastro esperando análise.'}</p>
      <ul class="md-admin">${list.map(adminItem).join('')}</ul>`
    : '<p class="tl-muted">Nenhum médico cadastrado ainda.</p>';
}
// Última conferência ainda serve para marcar a lista? Só se os dados do médico não mudaram e ela tem até 30 dias.
const checkReusable = (lc) => !!lc && lc.missing !== 'dados' && Date.now() - new Date(lc.checked_at).getTime() < T.CHECK_VALID_DAYS * 86400e3;
function lastCheckText(lc) {
  if (!lc) return 'Ainda sem conferência.';
  const when = `Última conferência: ${T.fmtDateTime(lc.checked_at)}${lc.checked_by ? ` por ${lc.checked_by}` : ''}`;
  if (lc.missing) return `${when}. Incompleta: ${T.errorText('conferencia_incompleta', lc.missing)}`;
  return checkReusable(lc) ? `${when}. Completa.` : `${when}. Completa, mas com mais de ${T.CHECK_VALID_DAYS} dias: para aprovar, confira de novo.`;
}
function adminItem(d) {
  const [cls, label] = STATUS_TEXT[d.status] || ['tl-chip', d.status];
  const spec = T.doctorSpecialty(d);
  const acts = {
    pending: [['approved', 'Aprovar', 'btn-coral'], ['rejected', 'Recusar', 'btn-ghost']],
    approved: [['suspended', 'Suspender', 'btn-ghost'], ['rejected', 'Recusar (solta o CRM)', 'btn-ghost']],
    suspended: [['approved', 'Reativar', 'btn-coral'], ['rejected', 'Recusar (solta o CRM)', 'btn-ghost']],
    rejected: [['approved', 'Aprovar', 'btn-ghost']],
  }[d.status] || [];
  const online = d.available_until && new Date(d.available_until).getTime() > Date.now();
  const lc = d.last_check || null;
  const reuse = checkReusable(lc);
  const due = d.status === 'approved' ? T.recheckDue(d.checked_at) : null;
  const items = T.CHECK_ITEMS.filter((it) => it.group !== 'rqe' || d.rqe);
  const id = esc(d.id);
  return `<li class="md-adm" data-doc="${id}">
    <div class="md-adm-h"><div><b>${esc(d.full_name)}</b><span>${esc(T.doctorCrm(d))}${spec ? ` · ${esc(spec)}` : ''}</span></div><span class="${cls}">${esc(label)}</span></div>
    ${Number(d.crm_duplicates) > 0 ? `<p class="md-dup"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>Há ${Number(d.crm_duplicates) === 1 ? 'outro cadastro' : `${Number(d.crm_duplicates)} outros cadastros`} com o mesmo CRM/UF. Só um pode ser o médico verdadeiro: confira a identidade e recuse o outro.</p>` : ''}
    <dl class="md-dl">
      <div><dt>E-mail</dt><dd>${esc(d.email || '')}</dd></div>
      ${d.phone ? `<div><dt>Celular</dt><dd>${esc(T.fmtPhone(d.phone))} <small>(informado no cadastro)</small></dd></div>` : ''}
      <div><dt>Cadastro</dt><dd>${esc(T.fmtDateTime(d.created_at))}</dd></div>
      <div><dt>Consultas</dt><dd>${esc(String(Number(d.consultations) || 0))}${online ? ' · atendendo agora' : ''}</dd></div>
      ${d.reviewed_at ? `<div><dt>Última análise</dt><dd>${esc(T.fmtDateTime(d.reviewed_at))}${d.reviewed_by ? ` por ${esc(d.reviewed_by)}` : ''}</dd></div>` : ''}
      ${due ? `<div><dt>Conferência</dt><dd>${esc(T.fmtDateTime(d.checked_at))}; vale até ${esc(T.fmtDate(due.slice(0, 10)))}</dd></div>` : ''}
      ${d.review_note ? `<div><dt>Observação</dt><dd>${esc(d.review_note)}</dd></div>` : ''}
    </dl>
    <fieldset class="md-checks"><legend>Conferência antes de aprovar</legend>
      <p class="tl-small">1) Na <a class="link" href="${T.CFM_URL}" target="_blank" rel="noopener">busca de médicos do CFM<span class="sr"> (abre em outra aba)</span></a>, busque <b>CRM ${esc(d.crm)}/${esc(d.crm_uf)}</b>${d.rqe ? ` e confira o <b>RQE ${esc(d.rqe)}</b>` : ''}. 2) Prove a identidade: chamada de vídeo com documento oficial com foto e carteira do CRM (compare o rosto), ou documento assinado com o certificado ICP-Brasil do médico, validado em validar.iti.gov.br. Combine o contato por um canal que não veio deste cadastro (por exemplo, o telefone do consultório ou do hospital onde o médico atende). Não grave a chamada nem guarde cópia dos documentos.</p>
      ${items.map((it) => `<label class="tl-check"><input type="checkbox" data-check="${esc(it.id)}" data-for="${id}"${reuse && lc[it.id] ? ' checked' : ''}><span>${esc(it.label)}</span></label>`).join('')}
      <div class="fld"><label for="cknote-${id}">Observação interna da conferência <small class="h">(opcional, até 300 caracteres; o médico não vê)</small></label><input id="cknote-${id}" maxlength="300" data-checknote="${id}" value="${esc(reuse ? lc.note || '' : '')}"></div>
      <p class="tl-small" data-checkstatus="${id}" role="status">${esc(lastCheckText(lc))}</p>
      <div class="tl-row"><button class="btn btn-ghost btn-sm" type="button" data-savecheck="${id}">Salvar conferência<span class="sr"> de ${esc(d.full_name)}</span></button></div>
    </fieldset>
    ${acts.length ? `<div class="fld"><label for="note-${id}">Observação para o médico <small class="h">(opcional, até 300 caracteres)</small></label><input id="note-${id}" maxlength="300" data-note-for="${id}"></div>
    <div class="tl-row">${acts.map(([st, txt, c]) => `<button class="btn ${c} btn-sm" type="button" data-set="${st}" data-id="${id}">${txt}<span class="sr"> ${esc(d.full_name)}</span></button>`).join('')}</div>` : ''}
  </li>`;
}
async function saveChecks(id) {
  const box = $(`[data-doc="${CSS.escape(id)}"]`);
  if (!box) return null;
  const checks = Object.fromEntries($$('[data-check]', box).map((i) => [i.dataset.check, i.checked]));
  checks.note = $(`[data-checknote="${CSS.escape(id)}"]`, box)?.value.trim() || '';
  try {
    const r = await A.rpc('tele_admin_save_checks', { p_doctor: id, p_checks: checks });
    const st = $(`[data-checkstatus="${CSS.escape(id)}"]`, box);
    if (st) st.textContent = r === 'completa' ? `Conferência salva às ${T.fmtTime(new Date().toISOString())}: completa.` : `Conferência salva às ${T.fmtTime(new Date().toISOString())}: ainda incompleta.`;
    return r;
  } catch (err) {
    if (lostSession(err)) return null;
    const { code, details } = T.errorInfo(err);
    toast(T.errorText(code, details));
    return null;
  }
}
async function setDoctor(id, status, btn) {
  const note = $(`[data-note-for="${CSS.escape(id)}"]`)?.value || '';
  btn.disabled = true;
  try {
    // Aprovar (ou reativar) grava antes a conferência marcada na tela; o banco recusa se estiver incompleta.
    if (status === 'approved' && !(await saveChecks(id))) { btn.disabled = false; return; }
    const st = await A.rpc('tele_admin_set_doctor', { p_doctor: id, p_status: status, p_note: note.trim() || null });
    toast(`Situação do médico: ${T.DOCTOR_REVIEW[st] || st}.`);
    await loadAdmin();
    if (S.me?.id === id) loadMe();
  } catch (err) {
    if (lostSession(err)) return;
    const { code, details } = T.errorInfo(err);
    const box = $(`[data-checkstatus="${CSS.escape(id)}"]`);
    if (code === 'conferencia_incompleta' && box) box.textContent = T.errorText(code, details);
    toast(T.errorText(code, details));
    btn.disabled = false;
  }
}

/* ======================= início ======================= */
function setup() {
  setupReg();
  setupNotice();
  setupExams();
  setupRecord();
  setupChat();
  $('#availBtn').addEventListener('click', () => setAvailable(!S.available, true));
  // offOnLeave desliga no servidor; a lembrança da aba (sessionStorage) fica para religar ao recarregar.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-accept]');
    if (a) { accept(a.dataset.accept, a); return; }
    const r = e.target.closest('[data-resume]');
    if (r) { resumeConsult(r.dataset.resume); return; }
    const dm = e.target.closest('[data-dismiss]');
    if (dm) { const b = $(`[data-dismissbox="${CSS.escape(dm.dataset.dismiss)}"]`); if (b) { b.hidden = false; b.querySelector('[data-dismissyes]')?.focus(); } return; }
    const dn = e.target.closest('[data-dismissno]');
    if (dn) { const b = $(`[data-dismissbox="${CSS.escape(dn.dataset.dismissno)}"]`); if (b) b.hidden = true; $(`[data-dismiss="${CSS.escape(dn.dataset.dismissno)}"]`)?.focus(); return; }
    const dy = e.target.closest('[data-dismissyes]');
    if (dy) { dismiss(dy.dataset.dismissyes, dy); return; }
    const m = e.target.closest('[data-amend]');
    if (m) { amend(m.dataset.amend); return; }
    const sc = e.target.closest('[data-savecheck]');
    if (sc) { sc.disabled = true; saveChecks(sc.dataset.savecheck).finally(() => { sc.disabled = false; }); return; }
    const s = e.target.closest('[data-set]');
    if (s) setDoctor(s.dataset.id, s.dataset.set, s);
  });
  addEventListener('pagehide', () => { offOnLeave(); S.local?.getTracks().forEach((t) => t.stop()); S.peer?.close(); });
}

setup();
const back = await A.handleRedirect();
if (back?.status === 'ok') flash('Pronto, você entrou.', 'ok');
else if (back?.status === 'error') flash(back.message, 'warn');
renderAuth();
if (A.user()) {
  if (await A.token()) loadMe();
  else { renderAuth(); flash('Sua entrada expirou. Peça um novo link abaixo.', 'warn'); }
}
