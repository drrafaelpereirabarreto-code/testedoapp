// "Minha conta": pedidos de agendamento (deste aparelho e da conta), situação ao vivo, lembrete na agenda
// (.ics) e avaliação do atendimento. Login por link no e-mail (assets/js/auth.js).
// Contrato do aparelho: localStorage 'imed_appts' (mais novo primeiro), gravado pela busca (perto.js).
import * as A from './auth.js';

const CFG = window.IMED_CONFIG || {};
const SITE = CFG.siteUrl || new URL('./', location.href).href;
const BACK_KEY = 'imed_conta_voltar';

// Funções da busca (geo-core.js). Se alguma não existir (versão antiga), usa a versão mínima daqui.
let G = {};
try { G = await import('./geo-core.js'); } catch { G = {}; }
const STATUS_PT = { pending: 'Aguardando contato', pendente: 'Aguardando contato', contacted: 'Em contato', confirmed: 'Confirmado', confirmado: 'Confirmado', cancelled: 'Cancelado', completed: 'Concluído' };
const F = {
  EXAMS: { rx: { n: 'Raio-X' }, usg: { n: 'Ultrassom' }, tc: { n: 'Tomografia' }, rm: { n: 'Ressonância' }, mamo: { n: 'Mamografia' }, dens: { n: 'Densitometria' }, ecg: { n: 'Eletrocardiograma' }, eco: { n: 'Ecocardiograma' }, lab: { n: 'Exames de laboratório' } },
  PERIODS: { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite', qualquer: 'Qualquer horário' },
  PREP: {},
  statusLabel: (s) => STATUS_PT[s] ?? '',
  protocolFromId: (id) => `IMED-${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
  icsFile({ id, title, date, period, description = '', url = '' }) {
    const e = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const day = date.replace(/-/g, '');
    const [y, m, d] = date.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10).replace(/-/g, '');
    const h = { manha: ['08', '12'], tarde: ['13', '18'], noite: ['18', '21'] }[period];
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//IMED//Pedidos//PT-BR', 'BEGIN:VEVENT', `UID:${e(id)}@imed`, `DTSTAMP:${stamp}`,
      ...(h ? [`DTSTART;TZID=America/Sao_Paulo:${day}T${h[0]}0000`, `DTEND;TZID=America/Sao_Paulo:${day}T${h[1]}0000`] : [`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next}`]),
      `SUMMARY:${e(title)}`, ...(description ? [`DESCRIPTION:${e(description)}`] : []), ...(url ? [`URL:${url}`] : []),
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(title)}`, 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
  },
};
const g = (name) => G[name] ?? F[name];
const usingFallback = ['icsFile', 'PREP', 'statusLabel'].filter((n) => !G[n]);
if (usingFallback.length) console.warn('conta.js: usando versão local de', usingFallback.join(', '));

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));
const examName = (code) => g('EXAMS')[code]?.n ?? (code === 'consulta' ? 'Consulta' : code === 'outro' ? 'Outro atendimento' : null);
const periodName = (p) => g('PERIODS')[p] ?? null;
// Horário marcado (reserva com agenda), sempre no fuso de São Paulo.
const SP_SLOT = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function slotLong(iso) {
  const d = new Date(iso ?? '');
  if (!iso || Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(SP_SLOT.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.day} de ${p.month} de ${p.year} às ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}
const slotFuture = (iso) => { const t = new Date(iso ?? '').getTime(); return Number.isFinite(t) && t > Date.now(); };
function dateLong(iso) {
  if (!isDate(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
}
function flash(msg, kind = 'ok') {
  const f = $('flash');
  f.textContent = msg;
  f.className = `ct-flash ${kind}`;
  f.hidden = !msg;
}

// ---------- pedidos ----------
function readDevice() {
  try {
    const list = JSON.parse(localStorage.getItem('imed_appts') || '[]');
    return Array.isArray(list) ? list.filter((a) => a && typeof a === 'object' && (a.type === 'pedido' || a.id) && a.name) : [];
  } catch { return []; }
}

const state = { orders: [], logged: false, liveError: false, accountError: false, opened: null };

async function loadOrders() {
  const device = readDevice();
  const withToken = device.filter((a) => isUuid(a.id) && typeof a.token === 'string' && a.token);
  const live = new Map();
  state.liveError = false;
  state.accountError = false;
  const jobs = [];
  if (withToken.length) {
    const sl = withToken.slice(0, 30);
    jobs.push(A.rpc('request_status', { p_ids: sl.map((a) => a.id), p_tokens: sl.map((a) => a.token) })
      .then((rows) => { for (const r of rows || []) live.set(r.id, r); })
      .catch(() => { state.liveError = true; }));
  }
  let account = [];
  // Só os pedidos da própria conta: o RLS também libera pedidos de clínicas das quais a pessoa
  // é membro (e todos, para admin), que não podem aparecer aqui como se fossem dela.
  const uid = A.user()?.id;
  if (state.logged && uid) {
    jobs.push(A.select(`appointment_requests?select=id,user_id,created_at,place_name,place_source,place_ref,clinic_id,exam_code,preferred_date,preferred_period,slot_start,status&user_id=eq.${encodeURIComponent(uid)}&order=created_at.desc&limit=50`)
      .then((rows) => { account = Array.isArray(rows) ? rows.filter((r) => r.user_id === uid) : []; })
      .catch((err) => { state.accountError = true; if (err.status === 401) state.expired = true; }));
  }
  await Promise.all(jobs);

  const byId = new Map();
  const out = [];
  for (const a of device) {
    const l = isUuid(a.id) ? live.get(a.id) : null;
    const o = {
      id: isUuid(a.id) ? a.id : null, token: a.token || '', code: a.code || (isUuid(a.id) ? g('protocolFromId')(a.id) : null),
      place: a.name, exam: a.exam || null, items: Array.isArray(a.items) ? a.items : [], date: a.date, period: a.period,
      slot: a.slot || null, deviceStatus: a.status || null,
      created: a.created || null, status: l ? l.status : null, reviewed: l ? !!l.reviewed : null,
      fromDevice: true, hasToken: !!(isUuid(a.id) && a.token), fromAccount: false,
    };
    out.push(o);
    if (o.id) byId.set(o.id, o);
  }
  for (const r of account) {
    const o = byId.get(r.id);
    if (o) {
      o.fromAccount = true;
      o.status = r.status || o.status;
      o.exam = o.exam || r.exam_code;
      o.slot = o.slot || r.slot_start || null;
      continue;
    }
    const n = {
      id: r.id, token: '', code: g('protocolFromId')(r.id), place: r.place_name, exam: r.exam_code, items: [],
      date: r.preferred_date, period: r.preferred_period, slot: r.slot_start || null, created: r.created_at, status: r.status, reviewed: null,
      fromDevice: false, hasToken: false, fromAccount: true,
    };
    out.push(n);
    byId.set(n.id, n);
  }
  out.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  state.orders = out;
}

function statusHtml(o) {
  if (o.status) return `<span class="ct-st st-${esc(o.status)}">${esc(g('statusLabel')(o.status) || o.status)}</span>`;
  // Reserva com horário: o banco já gravou como confirmada. Sem a situação ao vivo, mostra o que o aparelho guardou.
  if (o.slot && o.deviceStatus === 'confirmado') return '<span class="ct-st st-confirmed">Confirmado</span>';
  if (o.hasToken && state.liveError) return '<span class="ct-st st-unknown">Situação indisponível agora</span>';
  if (!o.id || !o.hasToken) return '<span class="ct-st st-unknown">Situação: confirme com o local</span>';
  return '<span class="ct-st st-unknown">Situação indisponível</span>';
}

const canReview = (o) => o.id && o.status === 'completed' && o.reviewed !== true;

function orderHtml(o, i) {
  const exam = examName(o.exam) || o.items.filter(Boolean).join(', ') || null;
  const slot = slotLong(o.slot);
  const when = slot ? null : dateLong(o.date);
  const per = slot ? null : periodName(o.period);
  const rows = [
    exam ? `<div><dt>Exame</dt><dd>${esc(exam)}</dd></div>` : '',
    slot ? `<div><dt>Horário marcado</dt><dd>${esc(slot)}</dd></div>` : '',
    when ? `<div><dt>Data preferida</dt><dd>${esc(when)}</dd></div>` : '',
    per ? `<div><dt>Período</dt><dd>${esc(per)}</dd></div>` : '',
    o.code ? `<div><dt>Protocolo</dt><dd class="ct-code">${esc(o.code)}</dd></div>` : '',
  ].join('');
  const where = o.fromAccount && o.fromDevice ? 'Na conta e neste aparelho' : o.fromAccount ? 'Na sua conta' : 'Neste aparelho';
  const rid = o.id ? esc(o.id) : '';
  return `<article class="ct-order" ${o.id ? `id="pedido-${rid}"` : ''} tabindex="-1" aria-labelledby="ot-${i}">
    <div class="ct-order-h">
      <h3 id="ot-${i}">${esc(o.place)}</h3>
      ${statusHtml(o)}
    </div>
    <dl class="ct-dl">${rows}</dl>
    <p class="ct-where">${where}</p>
    <div class="ct-actions">
      ${(o.slot ? slotFuture(o.slot) && o.status !== 'cancelled' : isDate(o.date)) ? `<button type="button" class="btn btn-ghost btn-sm" data-ics="${i}"><i class="fa-solid fa-calendar-plus" aria-hidden="true"></i>Adicionar à agenda</button>` : ''}
      ${canReview(o) ? `<button type="button" class="btn btn-coral btn-sm" data-review="${rid}" aria-expanded="false" aria-controls="rv-${rid}"><i class="fa-solid fa-star" aria-hidden="true"></i>Avaliar</button>` : ''}
      ${o.id && o.reviewed === true ? '<span class="ct-done"><i class="fa-solid fa-circle-check" aria-hidden="true"></i>Você já avaliou</span>' : ''}
    </div>
    ${canReview(o) ? reviewForm(o) : ''}
  </article>`;
}

function reviewForm(o) {
  const id = esc(o.id);
  const stars = [1, 2, 3, 4, 5].map((n) => `<input class="sr" type="radio" name="rating-${id}" id="r-${id}-${n}" value="${n}"><label for="r-${id}-${n}"><i class="fa-solid fa-star" aria-hidden="true"></i><span class="sr">${n} ${n === 1 ? 'estrela' : 'estrelas'}</span></label>`).join('');
  return `<form class="ct-rev" id="rv-${id}" data-id="${id}" novalidate hidden>
    <fieldset>
      <legend>Que nota você dá para o atendimento?</legend>
      <div class="ct-stars" data-v="0">${stars}</div>
      <p class="ct-stars-txt" aria-hidden="true"></p>
    </fieldset>
    <label class="ct-fld" for="c-${id}"><span>Comentário (opcional)</span>
      <textarea id="c-${id}" name="comment" maxlength="500" rows="3" placeholder="Como foi o atendimento? Evite colocar dados pessoais." aria-describedby="cc-${id}"></textarea>
      <small class="ct-muted" id="cc-${id}">0 de 500 caracteres</small>
    </label>
    <p class="ct-muted ct-small">Sua avaliação aparece no site com seu primeiro nome.</p>
    <button class="btn btn-coral" type="submit">Enviar avaliação</button>
    <p class="ct-msg" role="alert" hidden></p>
  </form>`;
}

function renderOrders() {
  $('ordersTitle').textContent = state.logged ? 'Meus pedidos' : 'Pedidos deste aparelho';
  const box = $('orders');
  const hint = [];
  if (state.logged) hint.push('Pedidos da sua conta e deste aparelho.');
  if (state.accountError) hint.push(state.expired ? 'Sua entrada venceu: entre de novo para ver os pedidos da conta.' : 'Não foi possível carregar os pedidos da conta agora.');
  if (state.liveError) hint.push('Não foi possível ver a situação dos pedidos agora. Tente de novo em instantes.');
  $('ordersHint').textContent = hint.join(' ');
  $('ordersHint').hidden = !hint.length;
  if (!state.orders.length) {
    box.innerHTML = `<div class="ct-empty"><i class="fa-regular fa-calendar" aria-hidden="true"></i><p>${state.logged ? 'Você ainda não tem pedidos.' : 'Nenhum pedido feito neste aparelho.'}</p><a class="btn btn-primary btn-sm" href="perto.html">Buscar clínicas perto de mim</a></div>`;
  } else {
    box.innerHTML = state.orders.map(orderHtml).join('');
  }
  $('clearBtn').disabled = !readDevice().length;
}

function downloadIcs(o) {
  const exam = examName(o.exam) || o.items.filter(Boolean).join(', ') || 'Atendimento';
  const guide = G.EXAMS?.[o.exam]?.slug;
  const prep = g('PREP')[o.exam];
  const title = o.exam === 'consulta' || o.exam === 'outro' || !G.EXAMS?.[o.exam] ? `${exam} — ${o.place}` : `Exame: ${exam} — ${o.place}`;
  const description = [
    `Pedido ${o.code || ''} · ${o.place}`,
    prep ? `Preparo: ${prep}` : '',
    o.slot ? 'Horário confirmado. Chegue com 15 minutos de antecedência.' : 'O horário só fica garantido depois da confirmação do local.',
    guide ? `Guia do exame: ${SITE}exames/${guide}.html#preparo` : '',
    o.id ? `Acompanhe: ${SITE}conta.html#pedido-${o.id}` : `IMED: ${SITE}`,
  ].filter(Boolean).join('\n');
  let ics;
  try { ics = g('icsFile')({ id: o.id || o.code, title, date: o.date, period: o.period, slot: o.slot || null, description, url: o.id ? `${SITE}conta.html#pedido-${o.id}` : SITE }); }
  catch { toast('Não foi possível criar o lembrete deste pedido.'); return; }
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `imed-${String(o.code || 'pedido').toLowerCase()}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Lembrete baixado. Abra o arquivo para pôr na agenda.');
}

function openReview(id, focus = true) {
  const form = document.getElementById(`rv-${id}`);
  const btn = document.querySelector(`[data-review="${CSS.escape(id)}"]`);
  if (!form) return false;
  form.hidden = false;
  btn?.setAttribute('aria-expanded', 'true');
  if (focus) form.querySelector('input[type=radio]')?.focus();
  return true;
}

const REVIEW_MSG = {
  invalid_rating: 'Escolha uma nota de 1 a 5 estrelas.',
  comment_too_long: 'O comentário pode ter até 500 caracteres.',
  not_found: 'Não encontramos este pedido. Ele pode ter sido apagado.',
  forbidden: 'Não conseguimos confirmar que este pedido é seu. Entre com a conta usada no pedido ou use o aparelho em que ele foi feito.',
  not_completed: 'Só dá para avaliar depois que o local marcar o atendimento como concluído.',
  already_reviewed: 'Este pedido já foi avaliado. Obrigado!',
};

async function submitReview(form) {
  const id = form.dataset.id;
  const o = state.orders.find((x) => x.id === id);
  const msg = form.querySelector('.ct-msg');
  const btn = form.querySelector('button[type=submit]');
  const rating = Number(form.querySelector('input[type=radio]:checked')?.value || 0);
  const comment = form.querySelector('textarea').value.trim();
  const show = (text, ok = false) => { msg.textContent = text; msg.hidden = !text; msg.classList.toggle('ok', ok); };
  if (rating < 1 || rating > 5) { show(REVIEW_MSG.invalid_rating); form.querySelector('input[type=radio]').focus(); return; }
  if (comment.length > 500) { show(REVIEW_MSG.comment_too_long); return; }
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  show('');
  let res;
  try {
    res = await A.rpc('submit_review', { p_request: id, p_token: o?.token || '', p_rating: rating, p_comment: comment || null });
  } catch {
    btn.disabled = false;
    btn.textContent = 'Enviar avaliação';
    show('Não foi possível enviar agora. Confira a internet e tente de novo.');
    return;
  }
  btn.disabled = false;
  btn.textContent = 'Enviar avaliação';
  if (res === 'ok' || res === 'already_reviewed') {
    if (o) o.reviewed = true;
    const art = form.closest('.ct-order');
    art.querySelector('[data-review]')?.remove();
    const thanks = document.createElement('p');
    thanks.className = 'ct-thanks';
    thanks.setAttribute('role', 'status');
    thanks.tabIndex = -1;
    thanks.innerHTML = res === 'ok'
      ? '<i class="fa-solid fa-heart" aria-hidden="true"></i>Obrigado pela avaliação! Ela ajuda outras pessoas a escolher onde fazer seus exames.'
      : `<i class="fa-solid fa-circle-check" aria-hidden="true"></i>${REVIEW_MSG.already_reviewed}`;
    form.replaceWith(thanks);
    thanks.focus();
    return;
  }
  show(REVIEW_MSG[res] || 'Não foi possível enviar a avaliação. Tente de novo mais tarde.');
}

function bindOrders() {
  const box = $('orders');
  box.addEventListener('click', (e) => {
    const ics = e.target.closest('[data-ics]');
    if (ics) {
      const o = state.orders[Number(ics.dataset.ics)];
      if (o) downloadIcs(o);
      return;
    }
    const rv = e.target.closest('[data-review]');
    if (rv) {
      const form = document.getElementById(`rv-${rv.dataset.review}`);
      if (form && !form.hidden) { form.hidden = true; rv.setAttribute('aria-expanded', 'false'); rv.focus(); } else openReview(rv.dataset.review);
    }
  });
  box.addEventListener('change', (e) => {
    if (e.target.matches('.ct-stars input')) {
      const wrap = e.target.closest('.ct-stars');
      const v = Number(e.target.value);
      wrap.dataset.v = String(v);
      const txt = wrap.parentElement.querySelector('.ct-stars-txt');
      txt.textContent = ['', 'Ruim', 'Regular', 'Bom', 'Muito bom', 'Excelente'][v];
    }
  });
  box.addEventListener('input', (e) => {
    if (e.target.matches('.ct-rev textarea')) {
      const n = e.target.value.length;
      e.target.parentElement.querySelector('small').textContent = `${n} de 500 caracteres`;
    }
  });
  box.addEventListener('submit', (e) => {
    if (e.target.matches('.ct-rev')) { e.preventDefault(); submitReview(e.target); }
  });
}

// Abre o pedido do endereço (#pedido-<id>) e o formulário de avaliação, se der para avaliar.
function openFromHash() {
  const m = location.hash.match(/^#pedido-([0-9a-f-]{36})$/i);
  if (!m) return;
  const id = m[1].toLowerCase();
  const el = document.getElementById(`pedido-${id}`);
  if (!el) {
    flash(state.logged
      ? 'Não encontramos este pedido na sua conta nem neste aparelho. Ele pode ter sido feito em outro aparelho sem entrar na conta.'
      : 'Não encontramos este pedido neste aparelho. Se você fez o pedido com a conta, entre com seu e-mail abaixo.', 'warn');
    return;
  }
  el.classList.add('ct-target');
  el.scrollIntoView({ block: 'start' });
  if (!openReview(id)) el.focus();
  const o = state.orders.find((x) => x.id === id);
  if (o && o.id && o.status && o.status !== 'completed') flash('Você poderá avaliar este pedido quando o atendimento for concluído.', 'info');
}

// ---------- conta ----------
function renderAccount() {
  const u = A.user();
  state.logged = !!u;
  $('signedOut').hidden = state.logged;
  $('signedIn').hidden = !state.logged;
  if (u) $('meEmail').textContent = u.email || 'sua conta';
}

function bindAccount() {
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('email').value.trim();
    const msg = $('loginMsg');
    const btn = $('loginBtn');
    const show = (t, ok = false) => { msg.textContent = t; msg.hidden = !t; msg.classList.toggle('ok', ok); };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { show('Digite um e-mail válido, por exemplo voce@exemplo.com.'); $('email').focus(); return; }
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      if (/^#pedido-/.test(location.hash)) { try { localStorage.setItem(BACK_KEY, location.hash); } catch { /* ignora */ } }
      await A.signIn(email, location.href.split('#')[0]);
      show(`Enviamos um link para ${email}. Abra o e-mail e toque no link para entrar. Pode levar alguns minutos; confira também a caixa de spam.`, true);
    } catch (err) {
      show(err.code === 'invalid_email' ? 'Digite um e-mail válido.'
        : err.status === 429 ? 'Muitas tentativas seguidas. Espere um minuto e tente de novo.'
          : 'Não foi possível enviar o link agora. Confira a internet e tente de novo.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Receber link de entrada';
    }
  });
  $('logoutBtn').addEventListener('click', async () => {
    await A.signOut();
    renderAccount();
    flash('Você saiu da conta. Os pedidos deste aparelho continuam aqui.', 'info');
    await refresh();
  });
  $('clearBtn').addEventListener('click', () => { $('clearConfirm').hidden = false; $('clearYes').focus(); });
  $('clearNo').addEventListener('click', () => { $('clearConfirm').hidden = true; $('clearBtn').focus(); });
  $('clearYes').addEventListener('click', async () => {
    try { localStorage.removeItem('imed_appts'); } catch { /* ignora */ }
    $('clearConfirm').hidden = true;
    toast('Pedidos deste aparelho apagados.');
    await refresh();
    $('ordersTitle').setAttribute('tabindex', '-1');
    $('ordersTitle').focus();
  });
}

async function refresh() {
  $('orders').innerHTML = '<div class="ct-skel" aria-hidden="true"></div>';
  $('orders').setAttribute('aria-busy', 'true');
  await loadOrders();
  $('orders').removeAttribute('aria-busy');
  if (state.expired) { state.expired = false; await A.signOut(); renderAccount(); }
  renderOrders();
}

async function init() {
  bindAccount();
  bindOrders();
  const r = await A.handleRedirect();
  if (r?.status === 'ok') {
    flash('Pronto, você entrou. Seus pedidos aparecem abaixo.', 'ok');
    let back = null;
    try { back = localStorage.getItem(BACK_KEY); localStorage.removeItem(BACK_KEY); } catch { /* ignora */ }
    if (back && /^#pedido-[0-9a-f-]{36}$/i.test(back)) history.replaceState(history.state, '', location.pathname + location.search + back);
  } else if (r?.status === 'error') {
    flash(r.message, 'warn');
  }
  renderAccount();
  // Confere se a sessão ainda vale (renova se preciso).
  if (state.logged && !(await A.token())) { renderAccount(); flash('Sua entrada venceu. Entre de novo com seu e-mail.', 'warn'); }
  await refresh();
  openFromHash();
  addEventListener('hashchange', openFromHash);
}

init();
