// Área da clínica: pedidos dos pacientes, dados, horários, convênios, exames e preços.
// Para a equipe do IMED (is_imed_admin): pedidos de cadastro e pedidos feitos ao IMED.
// Dados de pacientes ficam só na memória da página (nada vai para o localStorage).
import {
  auth, $, $$, esc, EXAMS, PERIODS, examName, kindName, ROLES, CLAIM_STATUS, statusLabel, onlyDigits, maskPhone,
  isValidEmail, hideDoc, maskDoc, fmtPhone, fmtDate, fmtDateTime, parsePrice, centsToInput, friendlyError, loading,
  note, finishLogin, renderAuth, toast, telHref, EXPIRED,
} from './clinica.js';
import * as T from './confianca.js';
import * as V from './estatisticas.js';

const STATUSES = ['pending', 'contacted', 'confirmed', 'completed', 'cancelled'];
const ACTIONS = ['contacted', 'confirmed', 'completed', 'cancelled'];
const DAYS = [['seg', 'Segunda'], ['ter', 'Terça'], ['qua', 'Quarta'], ['qui', 'Quinta'], ['sex', 'Sexta'], ['sab', 'Sábado'], ['dom', 'Domingo']];
export const COMMON_INSURANCES = ['Amil', 'Bradesco Saúde', 'SulAmérica', 'Unimed', 'Hapvida', 'NotreDame Intermédica', 'Porto Seguro', 'Prevent Senior', 'Cassi', 'Golden Cross'];
const EXAM_CODES = ['rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab'];
const BASE_COLS = 'id,created_at,exam_code,preferred_date,preferred_period,patient_name,patient_phone,patient_email,notes,status';
// Colunas da migração de confiança (pedido para outra pessoa e quem cancelou). Se o banco ainda não as tiver,
// a lista é buscada de novo sem elas (loadList).
export const TRUST_COLS = ',for_other,other_name,relationship,other_minor,guardian_consent,other_consent,cancelled_at,cancelled_by';
const REQ_COLS = `${BASE_COLS},slot_start${TRUST_COLS}`;
const IMED_COLS = `${BASE_COLS},place_source,place_ref,place_name,place_address,place_phone${TRUST_COLS}`;
const CANCELLED_BY = { patient: 'pelo paciente, no site', clinic: 'pela clínica', imed: 'pela equipe do IMED' };
// Respostas de set_request_status que não são "ok", em linguagem simples.
const STATUS_ERR = {
  forbidden: 'Sua conta não pode mudar este pedido.',
  not_found: 'Este pedido não existe mais.',
  invalid_status: 'Situação inválida. Atualize a lista e tente de novo.',
  cancelled_by_patient: 'O próprio paciente cancelou este pedido. Para remarcar, é preciso um novo pedido.',
  slot_taken: 'Este horário já foi reservado por outro paciente depois do cancelamento. Combine outro horário com a pessoa, num novo pedido.',
};

const state = { admin: false, clinics: [], memberIds: [], clinicId: null, tab: null, lists: {}, filter: { pedidos: '', concierge: '', when: '' }, agenda: null };
const app = () => $('#app');
const clinic = () => state.clinics.find((c) => c.id === state.clinicId) || null;
const uuidOk = (v) => /^[0-9a-f-]{36}$/i.test(String(v));

// ---------- datas no fuso de São Paulo ----------
// Tudo o que é dia e hora aparece e é montado no horário de São Paulo (o Brasil não tem horário de verão desde 2019).
const TZ = 'America/Sao_Paulo';
const SP_OFFSET = '-03:00';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const spDay = (d) => dayFmt.format(new Date(d));
export const spTime = (d) => timeFmt.format(new Date(d));
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const spIso = (day, time = '00:00') => `${day}T${time}:00${SP_OFFSET}`;
const fmtSlot = (iso) => `${fmtDate(spDay(iso))} às ${spTime(iso)}`;
const slotOf = (r) => (r.slot_start && !Number.isNaN(Date.parse(r.slot_start)) ? r.slot_start : null);

// Dia do exame: o horário marcado pela agenda ou a data preferida do pedido.
const PERIOD_TIME = { manha: '08:00', tarde: '13:00', noite: '18:00' };
export const apptDay = (r) => (slotOf(r) ? spDay(r.slot_start) : /^\d{4}-\d{2}-\d{2}$/.test(r.preferred_date || '') ? r.preferred_date : '');
const apptTime = (r) => (slotOf(r) ? Date.parse(r.slot_start) : apptDay(r) ? Date.parse(spIso(r.preferred_date, PERIOD_TIME[r.preferred_period] || '12:00')) : NaN);
// Próximos primeiro (do mais perto ao mais longe); depois os de dias que já passaram (do mais recente ao mais antigo).
export function sortByAppointment(rows, today) {
  const up = (r) => { const d = apptDay(r); return !!d && d >= today; };
  return [...rows].sort((a, b) => {
    const ua = up(a); const ub = up(b);
    if (ua !== ub) return ua ? -1 : 1;
    const ta = apptTime(a); const tb = apptTime(b);
    const na = Number.isNaN(ta); const nb = Number.isNaN(tb);
    if (na !== nb) return na ? 1 : -1;
    if (!na && ta !== tb) return ua ? ta - tb : tb - ta;
    return String(b.created_at).localeCompare(String(a.created_at));
  });
}
const WHEN = { '': 'Qualquer data', hoje: 'Hoje', semana: 'Próximos 7 dias' };
export const inWhen = (r, when, today) => {
  if (!when) return true;
  const d = apptDay(r);
  if (!d) return false;
  return when === 'hoje' ? d === today : d >= today && d <= addDays(today, 6);
};

// ---------- entrada ----------
function renderAccount() {
  renderAuth($('#authBox'), {
    back: () => `${location.origin}${location.pathname}`,
    intro: 'Entre com o <b>mesmo e-mail usado no pedido de cadastro</b> da clínica. Enviamos um link de entrada; não precisa de senha.',
    onSignOut: () => { state.clinics = []; state.lists = {}; state.agenda = null; app().innerHTML = ''; renderAccount(); toast('Você saiu da sua conta.'); },
  });
}

// A renovação da entrada falhou e auth.js apagou a sessão: volta para o quadro de entrada.
function lost() {
  if (auth.user()) return false;
  state.clinics = []; state.lists = {}; state.admin = false; state.agenda = null;
  app().innerHTML = '';
  $('#flash').innerHTML = note(esc(EXPIRED), 'warn');
  renderAccount();
  $('#loginEmail')?.focus();
  return true;
}

async function loadAll() {
  app().innerHTML = `<section class="cl-card">${loading('Carregando sua área…')}</section>`;
  try {
    const [admin, members] = await Promise.all([
      auth.rpc('is_imed_admin').then((v) => v === true).catch(() => false),
      auth.select('clinic_members?select=clinic_id,role'),
    ]);
    state.admin = admin;
    const ids = [...new Set((members || []).map((m) => m.clinic_id).filter(uuidOk))];
    // A equipe do IMED também abre qualquer clínica (agenda, pedidos, dados): o banco libera para is_imed_admin.
    const [mine, all] = await Promise.all([
      ids.length ? auth.select(`clinics?select=*&id=in.(${ids.join(',')})&order=name`) : [],
      admin ? auth.select('clinics?select=*&order=name&limit=500') : [],
    ]);
    const seen = new Set();
    state.memberIds = ids;
    state.clinics = [...(mine || []), ...(all || [])].filter((c) => c && uuidOk(c.id) && !seen.has(c.id) && seen.add(c.id));
  } catch (err) {
    if (lost()) return;
    app().innerHTML = `<section class="cl-card">${note(esc(friendlyError(err, 'Não foi possível carregar sua área agora. Tente de novo em instantes.')), 'err')}
      <div class="cl-actions"><button class="btn btn-ghost" type="button" id="retry">Tentar de novo</button></div></section>`;
    $('#retry').onclick = loadAll;
    return;
  }
  if (!state.clinics.length && !state.admin) {
    app().innerHTML = `<section class="cl-card" aria-labelledby="noneTitle"><h2 id="noneTitle">Nenhuma clínica nesta conta</h2>
      <p class="cl-help">Esta conta ainda não cuida de nenhuma clínica no IMED. Se você é responsável por uma clínica, laboratório ou hospital, peça para assumir o cadastro: a equipe do IMED confere os dados e responde pelo contato informado.</p>
      <p class="cl-help">Já fez o pedido? Confira se entrou com o mesmo e-mail usado nele.</p>
      <div class="cl-actions"><a class="btn btn-coral" href="reivindicar.html" id="goClaim">Assumir o cadastro da minha clínica</a></div></section>`;
    return;
  }
  // Começa pela primeira clínica da própria conta; a equipe do IMED sem clínica começa nas abas da equipe.
  const own = state.clinics.filter((c) => state.memberIds.includes(c.id));
  state.clinicId = state.clinics.some((c) => c.id === state.clinicId) ? state.clinicId : own[0]?.id ?? null;
  renderShell();
}

// ---------- abas ----------
function tabs() {
  const t = [];
  if (clinic()) t.push(['pedidos', 'Pedidos'], ['agenda', 'Agenda'], ['dados', 'Dados da clínica'], ['exames', 'Exames e preços']);
  if (state.admin) t.push(['cadastros', 'Pedidos de cadastro'], ['concierge', 'Pedidos ao IMED'], ['mensagens', 'Mensagens'], ['avisos', 'Avisos de erro'], ['visitas', 'Visitas']);
  return t;
}

function clinicNotes(c) {
  if (!c) return '';
  return `${c.status !== 'published' ? note('Este cadastro ainda é um rascunho e não aparece na busca. A equipe do IMED publica depois de conferir.', 'warn') : ''}
      ${c.status === 'published' && !c.accepts_online_booking ? note('Pedidos pelo site estão desligados. Ligue em “Dados da clínica” para receber pedidos.', 'warn') : ''}`;
}

function renderShell() {
  const c = clinic();
  const list = tabs();
  if (!list.some(([id]) => id === state.tab)) state.tab = list[0][0];
  const opt = (x) => `<option value="${esc(x.id)}"${x.id === state.clinicId ? ' selected' : ''}>${esc(x.name)}${x.status !== 'published' ? ' (rascunho)' : ''}</option>`;
  const own = state.clinics.filter((x) => state.memberIds.includes(x.id));
  const others = state.clinics.filter((x) => !state.memberIds.includes(x.id));
  let picker = '';
  if (state.admin && others.length) {
    picker = `<label class="cl-lbl sr" for="clinicPick">Clínica</label><select id="clinicPick" class="cl-pick">
      <option value=""${state.clinicId ? '' : ' selected'}>Equipe do IMED (sem clínica)</option>
      ${own.length ? `<optgroup label="Minhas clínicas">${own.map(opt).join('')}</optgroup>` : ''}
      <optgroup label="Todas as clínicas (equipe do IMED)">${others.map(opt).join('')}</optgroup></select>`;
  } else if (state.clinics.length > 1) {
    picker = `<label class="cl-lbl sr" for="clinicPick">Clínica</label><select id="clinicPick" class="cl-pick">${state.clinics.map(opt).join('')}</select>`;
  }
  const asAdmin = c && state.admin && !state.memberIds.includes(c.id);
  app().innerHTML = `<section class="cl-card" aria-labelledby="clinicTitle">
      <div class="cl-bar">
        <div><h2 id="clinicTitle">${c ? esc(c.name) : 'Equipe do IMED'}</h2>
          ${c ? `<p class="cl-help" style="margin:4px 0 0">${esc([kindName(c.kind), c.city && `${c.city} - ${c.state}`, c.cnes && `CNES ${c.cnes}`].filter(Boolean).join(' · '))}</p>` : '<p class="cl-help" style="margin:4px 0 0">Você entrou como equipe do IMED.</p>'}
        </div>
        ${picker}
      </div>
      ${asAdmin ? note('Você está vendo esta clínica como equipe do IMED. As mudanças valem para a clínica.', 'info') : ''}
      <div id="clinicNotes">${clinicNotes(c)}</div>
    </section>
    <div class="cl-tabs" role="tablist" aria-label="Seções da área da clínica">
      ${list.map(([id, label]) => `<button class="cl-tab" role="tab" type="button" id="tab-${id}" aria-controls="panel" aria-selected="${id === state.tab}" tabindex="${id === state.tab ? 0 : -1}" data-tab="${id}">${esc(label)}</button>`).join('')}
    </div>
    <section class="cl-card cl-panel" role="tabpanel" id="panel" aria-labelledby="tab-${state.tab}" tabindex="0"></section>`;
  const pick = $('#clinicPick');
  if (pick) pick.onchange = () => { state.clinicId = pick.value || null; state.lists = {}; state.agenda = null; renderShell(); $('#clinicPick')?.focus(); };
  const tl = $('[role="tablist"]');
  tl.addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) selectTab(b.dataset.tab, true); });
  tl.addEventListener('keydown', (e) => {
    const all = $$('[role="tab"]', tl);
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    const k = (j + all.length) % all.length;
    selectTab(all[k].dataset.tab, true);
  });
  renderTab();
}

const REQUEST_TABS = ['pedidos', 'concierge'];
// Pedidos da clínica: uma lista guardada por clínica e por filtro “Quando” (hoje e 7 dias vêm do banco pela data do exame).
const listKey = (tab) => (tab === 'pedidos' ? `pedidos:${state.clinicId}:${state.filter.when || 'todas'}` : tab);

function selectTab(id, focus) {
  // Ao voltar para uma lista de pedidos, busca de novo para mostrar os pedidos novos.
  if (id !== state.tab && REQUEST_TABS.includes(id)) delete state.lists[listKey(id)];
  state.tab = id;
  $$('[role="tab"]').forEach((b) => {
    const on = b.dataset.tab === id;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  $('#panel').setAttribute('aria-labelledby', `tab-${id}`);
  renderTab();
}

function renderTab() {
  const p = $('#panel');
  p.onclick = null; p.oninput = null; p.onchange = null;
  ({ pedidos: tabRequests, agenda: tabAgenda, dados: tabData, exames: tabExams, cadastros: tabClaims, concierge: tabConcierge, mensagens: tabMessages, avisos: tabReports, visitas: tabVisits })[state.tab](p);
}

// ---------- pedidos (clínica e IMED) ----------
// WhatsApp só para celular (11 dígitos, com 9 depois do DDD).
const waHref = (phone) => { const d = onlyDigits(phone); return /^[1-9]{2}9\d{8}$/.test(d) ? `https://wa.me/55${d}` : ''; };

function requestCard(r, withPlace) {
  const tel = telHref(r.patient_phone);
  const wa = waHref(r.patient_phone);
  const placeTel = telHref(r.place_phone);
  const slot = slotOf(r);
  const other = r.for_other === true;
  const rows = [
    withPlace ? ['Local', `${esc(r.place_name)}${r.place_address ? `<br><small>${esc(r.place_address)}</small>` : ''}`] : null,
    withPlace ? ['Telefone do local', r.place_phone ? (placeTel ? `<a href="${placeTel}">${esc(r.place_phone)}</a>` : esc(r.place_phone)) : 'Não informado'] : null,
    ['Exame', esc(examName(r.exam_code))],
    slot ? ['Horário marcado', `<b>${esc(fmtSlot(slot))}</b>`] : null,
    slot ? null : ['Data preferida', esc(fmtDate(r.preferred_date) || r.preferred_date)],
    slot ? null : ['Período', esc(PERIODS[r.preferred_period] || r.preferred_period || '')],
    other ? ['O exame é para', `<b>${esc(r.other_name)}</b> (${esc(r.relationship)})${r.other_minor ? '<br><small class="rq-minor"><i class="fa-solid fa-child" aria-hidden="true"></i>Menor de 18 anos · autorização do responsável legal registrada no pedido</small>' : r.other_consent ? '<br><small>Quem pediu confirmou que a pessoa sabe do pedido e concordou (ou que é o representante legal dela)</small>' : ''}`] : null,
    [other ? 'Quem pediu' : 'Paciente', esc(r.patient_name)],
    r.status === 'cancelled' && CANCELLED_BY[r.cancelled_by] ? ['Cancelado', `${esc(CANCELLED_BY[r.cancelled_by])}${r.cancelled_at ? ` em ${esc(fmtDateTime(r.cancelled_at))}` : ''}`] : null,
    ['Telefone', `<span class="rq-contact">${tel ? `<a href="${tel}">${esc(fmtPhone(r.patient_phone))}</a>` : esc(r.patient_phone)}${wa ? ` <a href="${wa}" target="_blank" rel="noopener">WhatsApp<span class="sr"> de ${esc(r.patient_name)} (abre em nova aba)</span></a>` : ''}</span>`],
    r.patient_email ? ['E-mail', `<a href="mailto:${esc(r.patient_email)}">${esc(r.patient_email)}</a>`] : null,
    r.notes ? ['Observações', esc(r.notes)] : null,
  ].filter(Boolean);
  const hints = [r.status === 'completed' ? '' : '“Concluído” libera a avaliação do paciente', slot && r.status !== 'cancelled' ? '“Cancelado” libera o horário para outro paciente' : ''].filter(Boolean);
  // Cancelado pelo próprio paciente: ninguém reabre pelo painel (o paciente veria "Confirmado" de novo depois de
  // cancelar). Para remarcar, é preciso um novo pedido. O banco também recusa (cancelled_by_patient).
  const byPatient = r.status === 'cancelled' && r.cancelled_by === 'patient';
  return `<li class="rq${slot ? ' rq-has-slot' : ''}" id="rq-${esc(r.id)}">
      <div class="rq-hd"><div><h3>${esc(examName(r.exam_code))} · ${esc(other ? r.other_name : r.patient_name)}</h3><small>Pedido em ${esc(fmtDateTime(r.created_at))}</small>
        ${slot ? `<p class="rq-slot"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i>${r.status === 'confirmed' ? 'Agendado pelo site (confirmado)' : 'Horário escolhido pelo paciente no site'}</p>` : ''}</div>
        <span class="rq-st st-${esc(r.status)}">${esc(statusLabel(r.status) || r.status)}</span></div>
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      ${byPatient ? `<p class="cl-note rq-locked"><i class="fa-solid fa-lock" aria-hidden="true"></i> Cancelado pelo paciente: para remarcar, é preciso um novo pedido.</p>` : `<div class="rq-act" role="group" aria-label="Mudar a situação do pedido de ${esc(r.patient_name)}">
        <span class="lbl">Mudar situação${hints.length ? ` · ${hints.join(' · ')}` : ''}:</span>
        ${ACTIONS.map((s) => `<button class="btn btn-ghost btn-sm" type="button" data-id="${esc(r.id)}" data-st="${s}" aria-pressed="${r.status === s}"${r.status === s ? ' disabled' : ''}>${esc(statusLabel(s))}</button>`).join('')}
      </div>`}
    </li>`;
}

// key: 'pedidos' ou 'concierge' (filtro e ids); cache: chave em state.lists (por clínica nos pedidos).
// Na clínica, a lista vem pela data do exame (horário marcado ou data preferida) e tem o filtro “Quando”.
function renderRequestList(p, key, intro, withPlace, cache) {
  const rows = state.lists[cache] || [];
  const again = () => renderRequestList(p, key, intro, withPlace, cache);
  const f = state.filter[key];
  const byDate = key === 'pedidos';
  const when = byDate ? state.filter.when : '';
  const today = spDay(Date.now());
  const view = () => {
    const base = byDate ? sortByAppointment(rows, today) : rows;
    return base.filter((r) => (!f || r.status === f) && inWhen(r, when, today));
  };
  const shown = view();
  const counts = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
  // Sem contagem nas opções: só a lista aberta tem o número certo (o “Todos (n)” ao lado).
  const whenSel = byDate ? `<label class="cl-lbl" for="flt-when" style="margin:0">Quando</label>
      <select id="flt-when">${Object.entries(WHEN).map(([v, n]) => `<option value="${v}"${when === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>` : '';
  p.innerHTML = `<p class="cl-help">${intro}</p>
    <div class="cl-filter"><label class="cl-lbl" for="flt-${key}" style="margin:0">Mostrar</label>
      <select id="flt-${key}"><option value="">Todos (${rows.length})</option>${STATUSES.map((s) => `<option value="${s}"${f === s ? ' selected' : ''}>${esc(statusLabel(s))} (${counts[s]})</option>`).join('')}</select>
      ${whenSel}
      <button class="btn btn-ghost btn-sm" type="button" id="rf-${key}"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Atualizar lista</button></div>
    ${!rows.length ? `<p class="cl-help">${when ? `Nenhum pedido para ${when === 'hoje' ? 'hoje' : 'os próximos 7 dias'}.` : 'Nenhum pedido ainda. Quando um paciente pedir agendamento, ele aparece aqui.'}</p>`
      : !shown.length ? `<p class="cl-help">${when ? 'Nenhum pedido para esse período com esse filtro.' : 'Nenhum pedido com essa situação.'}</p>`
        : `<ul class="rq-list">${shown.map((r) => requestCard(r, withPlace)).join('')}</ul>`}
    <div id="rqMsg" aria-live="polite"></div>`;
  $(`#flt-${key}`).onchange = (e) => { state.filter[key] = e.target.value; again(); $(`#flt-${key}`).focus(); };
  // Trocar o “Quando” busca de novo no banco (a lista guardada pode ter ficado velha).
  if (byDate) $('#flt-when').onchange = (e) => { state.filter.when = e.target.value; delete state.lists[listKey('pedidos')]; state.refocus = '#flt-when'; renderTab(); };
  $(`#rf-${key}`).onclick = () => { delete state.lists[cache]; state.refocus = `#rf-${key}`; renderTab(); };
  p.onclick = async (e) => {
    const b = e.target.closest('[data-st]');
    if (!b) return;
    const r = rows.find((x) => x.id === b.dataset.id);
    if (!r) return;
    $$('[data-st]', b.parentElement).forEach((x) => { x.disabled = true; });
    try {
      const res = await auth.rpc('set_request_status', { p_id: r.id, p_status: b.dataset.st });
      if (res !== 'ok') throw Object.assign(new Error(res), { result: res });
      // Próximo pedido visível, para o foco não se perder se este sair do filtro.
      const visible = view().map((x) => x.id);
      const after = visible.slice(visible.indexOf(r.id) + 1).concat(visible.slice(0, visible.indexOf(r.id)).reverse());
      r.status = b.dataset.st;
      const text = `Situação do pedido de ${r.patient_name || 'paciente'} mudada para “${statusLabel(r.status)}”.`;
      toast(text);
      again();
      const msgBox = $('#rqMsg', p);
      msgBox.innerHTML = `<p class="cl-note ok">${esc(text)}${f && f !== r.status ? ' Ele saiu desta lista por causa do filtro.' : ''}</p>`;
      const target = $(`#rq-${CSS.escape(r.id)} [data-st]:not([disabled])`, p)
        || after.map((id) => $(`#rq-${CSS.escape(id)} [data-st]:not([disabled])`, p)).find(Boolean)
        || $(`#flt-${key}`, p);
      target.focus();
    } catch (err) {
      if (lost()) return;
      const m = STATUS_ERR[err.result] || (err?.data?.code === '23505' ? STATUS_ERR.slot_taken : friendlyError(err, 'Não foi possível mudar a situação agora. Tente de novo.'));
      if (err.result === 'cancelled_by_patient') { r.status = 'cancelled'; r.cancelled_by = 'patient'; }
      again();
      $('#rqMsg', p).innerHTML = note(esc(m), 'err');
    }
  };
}

async function loadList(p, tab, path, render) {
  const key = listKey(tab);
  const done = () => {
    render();
    if (state.refocus) { $(state.refocus, p)?.focus(); state.refocus = null; }
  };
  if (state.lists[key]) { done(); return; }
  p.innerHTML = loading('Carregando pedidos…');
  // A resposta só vale se a pessoa ainda estiver na mesma aba e na mesma clínica (e no mesmo painel).
  const same = () => state.tab === tab && listKey(tab) === key && p.isConnected;
  try {
    let rows;
    try { rows = (await auth.select(path)) || []; } catch (err) {
      // Banco ainda sem as colunas novas (migração de confiança não aplicada): busca sem elas.
      if (err?.data?.code !== '42703' || !path.includes(TRUST_COLS)) throw err;
      rows = (await auth.select(path.replace(TRUST_COLS, ''))) || [];
    }
    if (!same()) return;
    state.lists[key] = rows;
    done();
  } catch (err) {
    if (lost()) return;
    if (!same()) return;
    state.refocus = null;
    p.innerHTML = `${note(esc(friendlyError(err, 'Não foi possível carregar os pedidos agora.')), 'err')}<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="retryTab">Tentar de novo</button></div>`;
    $('#retryTab').onclick = () => renderTab();
  }
}

// Consulta dos pedidos da clínica. “Hoje” e “Próximos 7 dias” filtram no banco pela data do exame:
// o gatilho preenche preferred_date a partir do horário marcado, então vale para os dois tipos de pedido.
export function requestsPath(clinicId, when, today) {
  const base = `appointment_requests?select=${REQ_COLS}&clinic_id=eq.${clinicId}`;
  if (when === 'hoje') return `${base}&preferred_date=eq.${today}&order=slot_start,created_at.desc&limit=200`;
  if (when === 'semana') return `${base}&preferred_date=gte.${today}&preferred_date=lte.${addDays(today, 6)}&order=preferred_date,slot_start,created_at.desc&limit=200`;
  return `${base}&order=created_at.desc&limit=100`;
}

function tabRequests(p) {
  const c = clinic();
  const intro = 'Pedidos de agendamento feitos pelos pacientes no IMED. Os marcados num horário da sua agenda já chegam confirmados. Nos outros, ligue ou chame no WhatsApp para combinar o horário. Atualize a situação: o paciente acompanha pela conta dele.';
  const key = listKey('pedidos');
  loadList(p, 'pedidos', requestsPath(c.id, state.filter.when, spDay(Date.now())), () => renderRequestList(p, 'pedidos', intro, false, key));
}

function tabConcierge(p) {
  const intro = 'Pedidos feitos ao IMED para locais que ainda não são parceiros. A equipe liga para o local, combina com o paciente e atualiza a situação.';
  loadList(p, 'concierge', `appointment_requests?select=${IMED_COLS}&clinic_id=is.null&order=created_at.desc&limit=100`, () => renderRequestList(p, 'concierge', intro, true, 'concierge'));
}

// ---------- agenda com horário ----------
// A clínica define faixas de atendimento por dia da semana (e por exame), bloqueios (feriado, folga,
// manutenção) e confere os próximos horários livres, que são os mesmos que o paciente vê.
const WD = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WORKDAYS = [2, 3, 4, 5]; // terça a sexta, copiados da segunda
const SLOT_OPTIONS = [10, 15, 20, 30, 45, 60];
const PREVIEW_DAYS = 7;
const PREVIEW_MAX = 30;
const naDia = (wd) => `${wd === 0 || wd === 6 ? 'no' : 'na'} ${WD[wd].toLowerCase()}`;
const toMin = (t) => { const m = /^(\d{2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
let agUid = 0;
const newRow = (wd, o = {}) => ({ k: `r${++agUid}`, wd, start: '', end: '', slot: 30, mode: 'all', exams: [], ...o });

// Linha de clinic_schedules → faixa editável.
export function rowFromDb(x) {
  const codes = Array.isArray(x.exam_codes) ? x.exam_codes : [];
  return newRow(Number(x.weekday), {
    start: String(x.start_time || '').slice(0, 5), end: String(x.end_time || '').slice(0, 5),
    slot: Number(x.slot_minutes) || 30, mode: codes.length ? 'some' : 'all', exams: codes.filter((c) => EXAM_CODES.includes(c)),
  });
}

// Tira das faixas os exames que a clínica não marca mais em “Exames e preços” e guarda quais saíram (r.dropped),
// para avisar na faixa. Devolve true se alguma faixa “só alguns” perdeu exame.
export function dropMissingExams(rows, offered) {
  let any = false;
  for (const r of rows) {
    const gone = r.exams.filter((code) => !offered.includes(code));
    if (!gone.length) continue;
    r.exams = r.exams.filter((code) => offered.includes(code));
    if (r.mode !== 'some') continue;
    r.dropped = [...new Set([...(r.dropped || []), ...gone])];
    any = true;
  }
  return any;
}

const sharesExam = (a, b) => a.mode === 'all' || b.mode === 'all' || a.exams.some((c) => b.exams.includes(c));

// Erros por faixa ({ [k]: texto }); _all para erro geral.
export function validateSchedule(rows) {
  const errs = {};
  const ok = [];
  for (const r of rows) {
    const s = toMin(r.start);
    const e = toMin(r.end);
    if (Number.isNaN(s) || Number.isNaN(e)) errs[r.k] = 'Preencha o início e o fim.';
    else if (e <= s) errs[r.k] = 'O fim precisa ser depois do início.';
    else if (!(r.slot >= 5 && r.slot <= 240)) errs[r.k] = 'Escolha a duração de cada horário.';
    else if (e - s < r.slot) errs[r.k] = `A faixa precisa ter pelo menos ${r.slot} minutos (a duração de um horário).`;
    else if (r.mode === 'some' && !r.exams.length) errs[r.k] = 'Marque pelo menos um exame ou escolha “Todos os exames”.';
    else ok.push(r);
  }
  // Duas faixas do mesmo dia não podem se cruzar para o mesmo exame (o mesmo horário sairia duas vezes).
  for (const wd of WD_ORDER) {
    const day = ok.filter((r) => r.wd === wd).sort((a, b) => toMin(a.start) - toMin(b.start));
    for (let j = 1; j < day.length; j++) {
      const b = day[j];
      const a = day.slice(0, j).find((x) => toMin(x.start) < toMin(b.end) && toMin(b.start) < toMin(x.end) && sharesExam(x, b));
      if (a) errs[b.k] = `Esta faixa se cruza com a de ${a.start} às ${a.end} para o mesmo exame. Mude o horário ou os exames.`;
    }
  }
  if (rows.length > 100) errs._all = 'Use até 100 faixas na semana.';
  return errs;
}

// O que vai para set_my_schedule.
export const scheduleRows = (rows) => [...rows]
  .sort((a, b) => a.wd - b.wd || toMin(a.start) - toMin(b.start))
  .map((r) => ({ weekday: r.wd, start: r.start, end: r.end, slot_minutes: r.slot, exams: r.mode === 'all' ? [] : EXAM_CODES.filter((c) => r.exams.includes(c)) }));

// Bloqueio digitado (dias inteiros ou algumas horas de um dia) → início e fim com o fuso de São Paulo.
export function blockRange({ kind, from, to, start, end }, now = Date.now()) {
  const errs = {};
  const D = /^\d{4}-\d{2}-\d{2}$/;
  const T = /^\d{2}:\d{2}$/;
  let starts = null;
  let ends = null;
  if (!D.test(from || '')) errs.bFrom = 'Escolha o dia.';
  if (kind === 'part') {
    if (!T.test(start || '')) errs.bStart = 'Escolha o horário de início.';
    if (!T.test(end || '')) errs.bEnd = 'Escolha o horário de fim.';
    else if (!errs.bStart && toMin(end) <= toMin(start)) errs.bEnd = 'O fim precisa ser depois do início.';
    if (!Object.keys(errs).length) { starts = spIso(from, start); ends = spIso(from, end); }
  } else if (!errs.bFrom) {
    const last = to || from;
    if (!D.test(last)) errs.bTo = 'Escolha o último dia.';
    else if (last < from) errs.bTo = 'O último dia precisa ser igual ou depois do primeiro.';
    else if (last > addDays(from, 365)) errs.bTo = 'Use até um ano em cada bloqueio.';
    else { starts = spIso(from); ends = spIso(addDays(last, 1)); }
  }
  if (ends && Date.parse(ends) <= now) { errs[kind === 'part' ? 'bEnd' : to ? 'bTo' : 'bFrom'] = 'Esse período já passou.'; starts = ends = null; }
  return { errs, starts, ends };
}

// Bloqueio em texto simples, no horário de São Paulo.
export function blockWhen(b) {
  const d1 = spDay(b.starts_at); const t1 = spTime(b.starts_at);
  const d2 = spDay(b.ends_at); const t2 = spTime(b.ends_at);
  if (t1 === '00:00' && t2 === '00:00') {
    const last = addDays(d2, -1);
    return last <= d1 ? `${fmtDate(d1)} (dia inteiro)` : `${fmtDate(d1)} até ${fmtDate(last)} (dias inteiros)`;
  }
  if (d1 === d2) return `${fmtDate(d1)}, das ${t1} às ${t2}`;
  return `${fmtDateTime(b.starts_at)} até ${fmtDateTime(b.ends_at)}`;
}

async function tabAgenda(p) {
  const c = clinic();
  const cid = c.id;
  const same = () => state.tab === 'agenda' && state.clinicId === cid && p.isConnected;
  // Mudanças ainda não salvas continuam ao trocar de aba (e voltar).
  const draft = state.agenda?.clinicId === cid && state.agenda.dirty ? state.agenda : null;
  p.innerHTML = loading('Carregando a agenda…');
  const exKey = `exames:${cid}`;
  try {
    const [sched, blocks, exams] = await Promise.all([
      draft ? null : auth.select(`clinic_schedules?select=*&clinic_id=eq.${cid}&order=weekday,start_time`),
      auth.select(`clinic_blocks?select=*&clinic_id=eq.${cid}&ends_at=gte.${new Date().toISOString()}&order=starts_at`),
      state.lists[exKey] || auth.select(`clinic_exams?select=exam_code,price_cents&clinic_id=eq.${cid}`),
    ]);
    if (!same()) return;
    state.lists[exKey] = exams || [];
    const offered = EXAM_CODES.filter((code) => state.lists[exKey].some((x) => x.exam_code === code));
    const rows = draft ? draft.rows : (sched || []).map(rowFromDb);
    // Só os exames que a clínica faz hoje (marcados em “Exames e preços”). O que saiu de lá é tirado da faixa
    // com um aviso nela, e a agenda fica com mudanças a salvar, para a clínica revisar.
    const dropped = dropMissingExams(rows, offered);
    const pv = draft && offered.includes(draft.previewExam) ? draft.previewExam : offered[0] || '';
    state.agenda = { clinicId: cid, rows, dirty: !!draft || dropped, errs: draft?.errs || {}, offered, blocks: blocks || [], previewExam: pv, pvSeq: 0 };
  } catch (err) {
    if (lost() || !same()) return;
    p.innerHTML = `${note(esc(friendlyError(err, 'Não foi possível carregar a agenda agora.')), 'err')}<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="retryTab">Tentar de novo</button></div>`;
    $('#retryTab').onclick = () => renderTab();
    return;
  }
  renderAgenda(p);
}

function agendaNote(c) {
  if (c.status !== 'published' || !c.accepts_online_booking) {
    return note(`A agenda só aparece para os pacientes quando <b>“Aceito pedidos de agendamento pelo site”</b> estiver ligado em <button class="link" type="button" data-go="dados">Dados da clínica</button>${c.status !== 'published' ? ' e o cadastro estiver publicado pela equipe do IMED' : ''}.`, 'warn');
  }
  return note('Os pacientes veem os horários livres e marcam direto pelo site. O pedido chega na aba “Pedidos” já confirmado.', 'info');
}

function rowHtml(r) {
  const a = state.agenda;
  const k = r.k;
  const err = a.errs[k] || '';
  const inv = err ? ' aria-invalid="true"' : '';
  const opts = [...new Set([...SLOT_OPTIONS, r.slot])].sort((x, y) => x - y);
  const exams = a.offered.map((code) => `<label class="cl-check"><input type="checkbox" data-f="ex" value="${code}" id="ag-x-${k}-${code}"${r.exams.includes(code) ? ' checked' : ''}><span>${esc(EXAMS[code].n)}</span></label>`).join('');
  return `<li class="ag-row${err ? ' bad' : ''}" data-k="${k}">
      <div class="ag-times">
        <div><label class="cl-lbl" for="ag-s-${k}">Início</label><input type="time" id="ag-s-${k}" data-f="start" value="${esc(r.start)}" step="300" aria-describedby="ag-e-${k}"${inv}></div>
        <div><label class="cl-lbl" for="ag-f-${k}">Fim</label><input type="time" id="ag-f-${k}" data-f="end" value="${esc(r.end)}" step="300" aria-describedby="ag-e-${k}"${inv}></div>
        <div><label class="cl-lbl" for="ag-d-${k}">Cada horário</label><select id="ag-d-${k}" data-f="slot">${opts.map((m) => `<option value="${m}"${m === r.slot ? ' selected' : ''}>${m} min</option>`).join('')}</select></div>
        <button class="btn btn-danger btn-sm ag-rm" type="button" data-rm="${k}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i> Remover<span class="sr"> esta faixa ${naDia(r.wd)}${r.start ? `, ${esc(r.start)} às ${esc(r.end)}` : ''}</span></button>
      </div>
      <fieldset class="ag-ex"><legend>Exames nesta faixa</legend>
        <div class="ag-mode">
          <label class="cl-check"><input type="radio" name="ag-m-${k}" value="all" data-f="mode"${r.mode === 'all' ? ' checked' : ''}><span>Todos os exames</span></label>
          <label class="cl-check"><input type="radio" name="ag-m-${k}" value="some" data-f="mode"${r.mode === 'some' ? ' checked' : ''}><span>Só alguns</span></label>
        </div>
        <div class="ag-exl"${r.mode === 'all' ? ' hidden' : ''}>${exams || '<span class="cl-hint">Nenhum exame marcado em “Exames e preços”.</span>'}</div>
      </fieldset>
      ${r.dropped?.length ? `<div class="ag-drop">${note(esc(`${listNames(r.dropped)} ${r.dropped.length === 1 ? 'saiu' : 'saíram'} de “Exames e preços” e ${r.dropped.length === 1 ? 'foi tirada' : 'foram tirados'} desta faixa. ${r.exams.length ? 'Confira e salve a agenda.' : 'Marque outro exame, escolha “Todos os exames” ou remova a faixa, e salve a agenda.'}`), 'warn')}</div>` : ''}
      <p class="cl-err" id="ag-e-${k}">${esc(err)}</p>
    </li>`;
}

const listNames = (codes) => {
  const n = codes.map((code) => examName(code) || code);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} e ${n.at(-1)}` : n[0];
};

function dayHtml(wd) {
  const rows = state.agenda.rows.filter((r) => r.wd === wd);
  return `<section class="ag-day${rows.length ? '' : ' closed'}" id="agday-${wd}" aria-labelledby="agd-${wd}">
      <div class="ag-dh"><h4 id="agd-${wd}">${WD[wd]}</h4><span class="ag-sub">${rows.length ? `${rows.length} ${rows.length === 1 ? 'faixa' : 'faixas'}` : 'Sem horários pelo site'}</span>
        <button class="btn btn-ghost btn-sm" type="button" data-add="${wd}"><i class="fa-solid fa-plus" aria-hidden="true"></i> Adicionar faixa<span class="sr"> ${naDia(wd)}</span></button></div>
      ${rows.length ? `<ul class="ag-rows">${rows.map(rowHtml).join('')}</ul>` : ''}
    </section>`;
}

function blocksHtml() {
  const list = state.agenda.blocks;
  if (!list.length) return '<p class="cl-help">Nenhum bloqueio marcado.</p>';
  return `<ul class="cl-list ag-blocks">${list.map((b) => `<li id="blk-${esc(b.id)}"><span><b>${esc(blockWhen(b))}</b>${b.reason ? `<small>${esc(b.reason)}</small>` : ''}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-unblock="${esc(b.id)}">Remover<span class="sr"> o bloqueio de ${esc(blockWhen(b))}</span></button></li>`).join('')}</ul>`;
}

function renderAgenda(p) {
  const c = clinic();
  const a = state.agenda;
  const today = spDay(Date.now());
  const dateField = (id, label, hint = '') => `<div class="cl-field" id="${id}Box"><label class="cl-lbl" for="${id}">${label}</label>
      <input id="${id}" type="date" min="${today}" aria-describedby="${id}Err${hint ? ` ${id}Hint` : ''}">${hint ? `<span class="cl-hint" id="${id}Hint">${hint}</span>` : ''}<span class="cl-err" id="${id}Err"></span></div>`;
  const timeField = (id, label) => `<div class="cl-field"><label class="cl-lbl" for="${id}">${label}</label>
      <input id="${id}" type="time" step="300" aria-describedby="${id}Err"><span class="cl-err" id="${id}Err"></span></div>`;
  p.innerHTML = `<div id="agNote">${agendaNote(c)}</div>
    <h3 class="ag-h" id="agWeekTitle">Horários de atendimento da semana</h3>
    <p class="cl-help">Crie uma ou mais faixas em cada dia, por exemplo 08:00 às 12:00 com um horário a cada 30 minutos. Dias sem faixa não têm horários pelo site. Horários com menos de 2 horas de antecedência não aparecem para o paciente.</p>
    ${a.offered.length ? '' : note('Nenhum exame marcado em <button class="link" type="button" data-go="exames">Exames e preços</button>. Marque os exames que a clínica faz para escolher quais entram em cada faixa.', 'warn')}
    <form id="agForm" novalidate aria-labelledby="agWeekTitle">
      <div class="cl-actions ag-tools"><button class="btn btn-ghost btn-sm" type="button" id="agCopy"><i class="fa-regular fa-copy" aria-hidden="true"></i> Copiar segunda para os dias úteis</button></div>
      <div id="agCopyMsg" class="cl-msg" aria-live="polite"></div>
      <div id="agWeek" class="ag-week">${WD_ORDER.map(dayHtml).join('')}</div>
      <div id="agSum" aria-live="polite"></div>
      <div class="cl-actions"><button class="btn btn-coral" type="submit" id="agSave">Salvar agenda</button><span class="ag-dirty" id="agDirty" aria-live="polite">${a.dirty ? 'Há mudanças ainda não salvas.' : ''}</span></div>
      <div id="agMsg" aria-live="polite"></div>
    </form>

    <h3 class="ag-h" id="blkTitle">Bloqueios</h3>
    <p class="cl-help">Feriados, folgas, manutenção do aparelho: nesses períodos nenhum horário aparece para o paciente. Bloquear não cancela pedidos já marcados; confira a aba “Pedidos”.</p>
    <div id="agBlocks">${blocksHtml()}</div>
    <div id="unblockMsg" aria-live="polite"></div>
    <form id="blkForm" class="ag-blk" novalidate aria-labelledby="blkNew">
      <h4 id="blkNew">Novo bloqueio</h4>
      <fieldset class="cl-fs"><legend class="sr">Tipo de bloqueio</legend>
        <div class="ag-mode">
          <label class="cl-check"><input type="radio" name="blkKind" value="day" checked><span>Dia inteiro (um ou mais dias)</span></label>
          <label class="cl-check"><input type="radio" name="blkKind" value="part"><span>Só algumas horas de um dia</span></label>
        </div>
      </fieldset>
      <div class="cl-grid">
        ${dateField('bFrom', 'Primeiro dia')}
        ${dateField('bTo', 'Último dia', 'Em branco: só o primeiro dia.')}
        <div class="ag-part full" id="bPart" hidden>${timeField('bStart', 'Das')}${timeField('bEnd', 'Às')}</div>
        <div class="cl-field full"><label class="cl-lbl" for="bReason">Motivo <small>(opcional, só a clínica vê)</small></label>
          <input id="bReason" type="text" maxlength="120" autocomplete="off" placeholder="Ex.: feriado, manutenção do aparelho"></div>
      </div>
      <div class="cl-actions"><button class="btn btn-primary" type="submit" id="bSave">Bloquear</button></div>
      <div id="bMsg" aria-live="polite"></div>
    </form>

    <h3 class="ag-h" id="pvTitle">Próximos horários livres</h3>
    <p class="cl-help">Confira aqui o que o paciente vê nos próximos ${PREVIEW_DAYS} dias, já com os bloqueios e os horários marcados. Mostra a agenda salva.</p>
    <div class="cl-filter">
      ${a.offered.length ? `<label class="cl-lbl" for="pvExam" style="margin:0">Exame</label><select id="pvExam">${a.offered.map((code) => `<option value="${code}"${code === a.previewExam ? ' selected' : ''}>${esc(EXAMS[code].n)}</option>`).join('')}</select>` : ''}
      <button class="btn btn-ghost btn-sm" type="button" id="pvRefresh"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Atualizar horários</button>
    </div>
    <div id="pvBox" aria-live="polite"></div>`;

  const markDirty = () => { a.dirty = true; $('#agDirty').textContent = 'Há mudanças ainda não salvas.'; $('#agMsg').innerHTML = ''; };
  const rowOf = (el) => a.rows.find((r) => r.k === el.closest('.ag-row')?.dataset.k);
  const onEdit = (e) => {
    const t = e.target;
    const r = t.dataset?.f ? rowOf(t) : null;
    if (!r) return;
    if (t.dataset.f === 'start' || t.dataset.f === 'end') r[t.dataset.f] = t.value;
    else if (t.dataset.f === 'slot') r.slot = Number(t.value);
    else if (t.dataset.f === 'mode') {
      r.mode = t.value;
      $('.ag-exl', t.closest('.ag-row')).hidden = r.mode === 'all';
    } else if (t.dataset.f === 'ex') r.exams = $$('input[data-f="ex"]:checked', t.closest('.ag-row')).map((x) => x.value);
    markDirty();
  };
  p.oninput = onEdit;
  p.onchange = (e) => {
    if (e.target.id === 'pvExam') { a.previewExam = e.target.value; loadPreview(); return; }
    if (e.target.name === 'blkKind') {
      const part = e.target.value === 'part';
      $('#bPart').hidden = !part;
      $('#bToBox').hidden = part;
      $('label[for="bFrom"]').textContent = part ? 'Dia' : 'Primeiro dia';
      return;
    }
  };
  const redrawDay = (wd) => { $(`#agday-${wd}`).outerHTML = dayHtml(wd); };
  p.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.go) { selectTab(b.dataset.go, true); return; }
    if (b.dataset.add) {
      const wd = Number(b.dataset.add);
      const same = a.rows.filter((r) => r.wd === wd);
      const last = same.at(-1);
      let start = '08:00'; let end = '12:00';
      if (last) {
        const s = Number.isNaN(toMin(last.end)) ? NaN : toMin(last.end) + 60;
        if (Number.isNaN(s) || s + 60 > 24 * 60 - 1) { start = ''; end = ''; } else { start = fromMin(s); end = fromMin(Math.min(s + 240, 23 * 60 + 55)); }
      }
      const r = newRow(wd, { start, end, slot: last?.slot || 30 });
      a.rows.push(r);
      redrawDay(wd);
      markDirty();
      $(`#ag-s-${r.k}`).focus();
      return;
    }
    if (b.dataset.rm) {
      const r = a.rows.find((x) => x.k === b.dataset.rm);
      a.rows = a.rows.filter((x) => x !== r);
      delete a.errs[r.k];
      redrawDay(r.wd);
      markDirty();
      $(`#agday-${r.wd} [data-add]`).focus();
      return;
    }
    if (b.id === 'agCopy') {
      const mon = a.rows.filter((r) => r.wd === 1);
      const msg = $('#agCopyMsg');
      msg.className = 'cl-msg';
      if (!mon.length) { msg.textContent = 'Segunda ainda não tem faixas. Adicione uma faixa na segunda primeiro.'; msg.classList.add('err'); return; }
      const replaced = a.rows.some((r) => WORKDAYS.includes(r.wd));
      a.rows = a.rows.filter((r) => !WORKDAYS.includes(r.wd))
        .concat(WORKDAYS.flatMap((wd) => mon.map((r) => newRow(wd, { start: r.start, end: r.end, slot: r.slot, mode: r.mode, exams: [...r.exams] }))));
      Object.keys(a.errs).forEach((k) => { if (k !== '_all' && !a.rows.some((r) => r.k === k)) delete a.errs[k]; });
      WORKDAYS.forEach(redrawDay);
      markDirty();
      msg.textContent = `Pronto: terça a sexta agora têm os mesmos horários de segunda${replaced ? ' (as faixas que havia nesses dias foram trocadas)' : ''}. Falta salvar.`;
      msg.classList.add('ok');
      return;
    }
    if (b.dataset.unblock) { removeBlock(b); return; }
    if (b.id === 'pvRefresh') loadPreview();
  };
  $('#agForm').onsubmit = saveAgenda;
  $('#blkForm').onsubmit = saveBlock;
  loadPreview();
}

async function saveAgenda(e) {
  e.preventDefault();
  const c = clinic();
  const a = state.agenda;
  a.errs = validateSchedule(a.rows);
  WD_ORDER.forEach((wd) => { $(`#agday-${wd}`).outerHTML = dayHtml(wd); });
  $('#agMsg').innerHTML = '';
  const bad = Object.keys(a.errs).filter((k) => k !== '_all');
  if (bad.length || a.errs._all) {
    $('#agSum').innerHTML = note(esc(a.errs._all || (bad.length === 1 ? 'Confira a faixa marcada em vermelho.' : `Confira as ${bad.length} faixas marcadas em vermelho.`)), 'err');
    $('.ag-row.bad input[data-f="start"]')?.focus();
    return;
  }
  $('#agSum').innerHTML = '';
  const btn = $('#agSave');
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  const rows = scheduleRows(a.rows);
  const sent = JSON.stringify(rows);
  try {
    const res = await auth.rpc('set_my_schedule', { p_clinic: c.id, p_rows: rows });
    if (res !== 'ok') throw Object.assign(new Error(res), { result: res });
    // A pessoa pode ter mexido nos campos (ou trocado de aba e voltado) enquanto salvava:
    // só fica “salvo” se a agenda na tela for igual à que foi enviada.
    const cur = state.agenda?.clinicId === a.clinicId ? state.agenda : null;
    if (cur) {
      cur.dirty = JSON.stringify(scheduleRows(cur.rows)) !== sent;
      if (!cur.dirty) {
        const days = new Set(cur.rows.filter((r) => r.dropped?.length).map((r) => r.wd));
        cur.rows.forEach((r) => { delete r.dropped; });
        days.forEach((wd) => { const el = $(`#agday-${wd}`); if (el && state.agenda === cur) el.outerHTML = dayHtml(wd); });
      }
      const d = $('#agDirty');
      if (d && state.agenda === cur) d.textContent = cur.dirty ? 'Há mudanças ainda não salvas.' : '';
    }
    const live = c.status === 'published' && c.accepts_online_booking;
    const okText = !rows.length ? 'Agenda salva sem horários. Os pacientes voltam a fazer o pedido sem horário, e a clínica liga para combinar.'
      : live ? 'Agenda salva. Os horários livres já aparecem para os pacientes.' : 'Agenda salva. Os horários aparecem para os pacientes quando “Aceito pedidos de agendamento pelo site” estiver ligado.';
    const box = $('#agMsg');
    if (box && state.agenda === cur) box.innerHTML = note(`${okText}${cur?.dirty ? ' As mudanças feitas enquanto salvava ainda não foram salvas.' : ''}`, 'ok');
    toast('Agenda salva.');
    loadPreview();
  } catch (err) {
    if (lost()) return;
    const m = err.result === 'forbidden' ? 'Sua conta não pode mudar a agenda desta clínica.' : friendlyError(err, 'Não foi possível salvar a agenda agora. Tente de novo em instantes.');
    const box = $('#agMsg');
    if (box && state.agenda?.clinicId === a.clinicId) box.innerHTML = note(esc(m), 'err');
    else toast(m);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar agenda';
    if (btn.isConnected && (!document.activeElement || document.activeElement === document.body)) btn.focus();
  }
}

// Busca de novo os bloqueios da clínica; vale para a agenda aberta agora, se for a mesma clínica.
async function refreshBlocks(clinicId) {
  const rows = (await auth.select(`clinic_blocks?select=*&clinic_id=eq.${clinicId}&ends_at=gte.${new Date().toISOString()}&order=starts_at`)) || [];
  const cur = state.agenda;
  if (cur?.clinicId !== clinicId) return;
  cur.blocks = rows;
  const box = $('#agBlocks');
  if (box) box.innerHTML = blocksHtml();
}
const agendaOf = (clinicId) => (state.agenda?.clinicId === clinicId ? state.agenda : null);

async function saveBlock(e) {
  e.preventDefault();
  const c = clinic();
  const a = state.agenda;
  const kind = $('input[name="blkKind"]:checked').value;
  const { errs, starts, ends } = blockRange({ kind, from: $('#bFrom').value, to: kind === 'part' ? '' : $('#bTo').value, start: $('#bStart').value, end: $('#bEnd').value });
  let first = null;
  for (const id of ['bFrom', 'bTo', 'bStart', 'bEnd']) {
    const el = $(`#${id}`);
    $(`#${id}Err`).textContent = errs[id] || '';
    if (errs[id]) { el.setAttribute('aria-invalid', 'true'); first ||= el; } else el.removeAttribute('aria-invalid');
  }
  $('#bMsg').innerHTML = '';
  if (first) { first.focus(); return; }
  const btn = $('#bSave');
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  try {
    const reason = $('#bReason').value.trim().replace(/\s+/g, ' ').slice(0, 120);
    const res = await auth.rpc('add_my_block', { p_clinic: c.id, p_starts: starts, p_ends: ends, p_reason: reason || null });
    if (res !== 'ok') throw Object.assign(new Error(res), { result: res });
    // A pessoa pode ter saído da aba enquanto salvava: só mexe no formulário se ele ainda estiver na tela.
    const form = $('#blkForm');
    if (form && state.agenda === a) {
      form.reset();
      $('#bPart').hidden = true; $('#bToBox').hidden = false; $('label[for="bFrom"]').textContent = 'Primeiro dia';
    }
    await refreshBlocks(a.clinicId).catch(() => {});
    const box = $('#bMsg');
    if (box && state.agenda === a) box.innerHTML = note('Bloqueio salvo. Nesse período nenhum horário aparece para os pacientes.', 'ok');
    toast('Bloqueio salvo.');
    if (agendaOf(a.clinicId)) loadPreview();
  } catch (err) {
    if (lost()) return;
    const m = err.result === 'forbidden' ? 'Sua conta não pode bloquear horários desta clínica.' : friendlyError(err, 'Não foi possível salvar o bloqueio agora. Tente de novo em instantes.');
    const box = $('#bMsg');
    if (box && state.agenda === a) box.innerHTML = note(esc(m), 'err');
    else toast(m);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Bloquear';
    if (btn.isConnected && (!document.activeElement || document.activeElement === document.body)) btn.focus();
  }
}

async function removeBlock(b) {
  const a = state.agenda;
  const id = b.dataset.unblock;
  const blk = a.blocks.find((x) => x.id === id);
  if (!blk) return;
  const ids = a.blocks.map((x) => x.id);
  const next = ids[ids.indexOf(id) + 1] || ids[ids.indexOf(id) - 1];
  b.disabled = true;
  const msg = $('#unblockMsg');
  msg.innerHTML = '';
  try {
    const res = await auth.rpc('remove_my_block', { p_block: id });
    if (res !== 'ok' && res !== 'not_found') throw Object.assign(new Error(res), { result: res });
    const text = `Bloqueio de ${blockWhen(blk)} removido.`;
    toast('Bloqueio removido.');
    // A agenda aberta agora pode ser outra (a pessoa saiu da aba e voltou): tira o bloqueio dela também.
    const cur = agendaOf(a.clinicId);
    if (cur) cur.blocks = cur.blocks.filter((x) => x.id !== id);
    if (a !== cur) a.blocks = a.blocks.filter((x) => x.id !== id);
    const list = $('#agBlocks');
    if (!list || !cur) return;
    list.innerHTML = blocksHtml();
    if (msg.isConnected) msg.innerHTML = note(esc(text), 'ok');
    ($(`#agBlocks [data-unblock="${CSS.escape(next || '')}"]`) || $('#bFrom'))?.focus();
    loadPreview();
  } catch (err) {
    if (lost()) return;
    b.disabled = false;
    const m = err.result === 'forbidden' ? 'Sua conta não pode remover bloqueios desta clínica.' : friendlyError(err, 'Não foi possível remover o bloqueio agora. Tente de novo.');
    if (msg.isConnected) msg.innerHTML = note(esc(m), 'err');
    else toast(m);
  }
}

async function loadPreview() {
  const box = $('#pvBox');
  const a = state.agenda;
  if (!box || !a) return;
  const seq = ++a.pvSeq;
  const exam = a.previewExam || null;
  box.innerHTML = loading('Buscando horários livres…');
  try {
    const rows = (await auth.rpc('available_slots', { p_clinic: a.clinicId, p_exam: exam, p_from: null, p_days: PREVIEW_DAYS })) || [];
    if (state.agenda !== a || seq !== a.pvSeq || !box.isConnected) return;
    box.innerHTML = previewHtml(Array.isArray(rows) ? rows : [], exam);
  } catch (err) {
    if (lost() || state.agenda !== a || seq !== a.pvSeq || !box.isConnected) return;
    box.innerHTML = note(esc(friendlyError(err, 'Não foi possível buscar os horários livres agora.')), 'err');
  }
}

function previewHtml(rows, exam) {
  const c = clinic();
  const list = rows.map((r) => r?.slot_start).filter((x) => x && !Number.isNaN(Date.parse(x)));
  if (!list.length) {
    const why = c.status !== 'published' || !c.accepts_online_booking
      ? 'Com “Aceito pedidos de agendamento pelo site” desligado ou o cadastro em rascunho, nenhum horário aparece.'
      : 'Confira se a agenda está salva, se há faixas para este exame e se não há bloqueios nesses dias.';
    return `<p class="cl-help">Nenhum horário livre nos próximos ${PREVIEW_DAYS} dias${exam ? ` para ${esc(examName(exam))}` : ''}. ${why}</p>`;
  }
  const top = list.slice(0, PREVIEW_MAX);
  const groups = [];
  for (const t of top) {
    const d = spDay(t);
    if (groups.at(-1)?.[0] !== d) groups.push([d, []]);
    groups.at(-1)[1].push(t);
  }
  const head = list.length > PREVIEW_MAX ? `Mostrando os ${PREVIEW_MAX} primeiros de ${list.length} horários livres.` : `${list.length} ${list.length === 1 ? 'horário livre' : 'horários livres'}.`;
  return `<p class="cl-help">${head}</p>
    <div class="ag-pv">${groups.map(([d, ts]) => `<div class="ag-pv-day"><h4>${esc(fmtDate(d))}</h4><ul class="ag-slots">${ts.map((t) => `<li>${esc(spTime(t))}</li>`).join('')}</ul></div>`).join('')}</div>`;
}

// ---------- dados da clínica ----------
function field(id, label, value, { type = 'text', hint = '', max = 200, extra = '', full = false } = {}) {
  return `<div class="cl-field${full ? ' full' : ''}"><label class="cl-lbl" for="${id}">${label}</label>
    <input id="${id}" type="${type}" maxlength="${max}" value="${esc(value ?? '')}" aria-describedby="${id}Err${hint ? ` ${id}Hint` : ''}" ${extra}>
    ${hint ? `<span class="cl-hint" id="${id}Hint">${hint}</span>` : ''}<span class="cl-err" id="${id}Err"></span></div>`;
}

function tabData(p) {
  const c = clinic();
  const hours = c.opening_hours && typeof c.opening_hours === 'object' ? c.opening_hours : {};
  const ins = c.insurances || [];
  const others = ins.filter((x) => !COMMON_INSURANCES.includes(x));
  p.innerHTML = `<form id="dataForm" novalidate>
    <p class="cl-help">Estes dados aparecem para os pacientes na busca do IMED. Deixe em branco o que não quiser mostrar.</p>
    <div class="cl-grid">
      ${field('dPhone', 'Telefone', c.phone, { type: 'tel', max: 25, hint: 'Como os pacientes devem ligar. Ex.: (11) 3222-1000', extra: 'inputmode="tel" autocomplete="off"' })}
      ${field('dWa', 'WhatsApp', c.whatsapp, { type: 'tel', max: 20, hint: 'Com 55 e DDD, só números. Ex.: 5511987654321', extra: 'inputmode="numeric" autocomplete="off"' })}
      ${field('dEmail', 'E-mail', c.email, { type: 'email', max: 254, extra: 'inputmode="email" autocomplete="off"' })}
      ${field('dSite', 'Site', c.website, { type: 'url', max: 300, hint: 'Começa com https://', extra: 'inputmode="url" autocomplete="off" placeholder="https://"' })}
      <div class="cl-field full"><label class="cl-lbl" for="dDesc">Descrição</label>
        <textarea id="dDesc" maxlength="1000" aria-describedby="dDescCount dDescErr">${esc(c.description || '')}</textarea>
        <span class="cl-hint" id="dDescCount">${(c.description || '').length} de 1000 caracteres</span><span class="cl-err" id="dDescErr"></span></div>
      <fieldset class="cl-fs full"><legend>Horário de atendimento</legend>
        <p class="cl-help">Escreva como quiser, por exemplo 07:00–19:00. Deixe em branco os dias fechados ou sem horário definido.</p>
        <div class="hours">${DAYS.map(([k, n]) => `<label>${n}<input id="h-${k}" type="text" maxlength="40" value="${esc(hours[k] ?? '')}" autocomplete="off"></label>`).join('')}</div>
      </fieldset>
      <div class="cl-field full"><label class="cl-check"><input id="dOnline" type="checkbox"${c.accepts_online_booking ? ' checked' : ''}><span><b>Aceito pedidos de agendamento pelo site.</b> Os pedidos aparecem na aba “Pedidos”. Com a aba “Agenda” montada, o paciente escolhe um horário livre; sem agenda, a clínica entra em contato para combinar.</span></label></div>
      <div class="cl-field full"><label class="cl-lbl" for="dSpec">Especialidades</label>
        <input id="dSpec" type="text" maxlength="1500" value="${esc((c.specialties || []).join(', '))}" aria-describedby="dSpecHint dSpecErr" autocomplete="off">
        <span class="cl-hint" id="dSpecHint">Separe por vírgula. Até 30. Ex.: Cardiologia, Radiologia</span><span class="cl-err" id="dSpecErr"></span></div>
      <fieldset class="cl-fs full"><legend>Convênios aceitos</legend>
        <p class="cl-help">Marque só os convênios que a clínica aceita de fato.</p>
        <div class="ins">${COMMON_INSURANCES.map((n, i) => `<label class="cl-check"><input type="checkbox" name="ins" id="ins-${i}" value="${esc(n)}"${ins.includes(n) ? ' checked' : ''}><span>${esc(n)}</span></label>`).join('')}</div>
        <label class="cl-lbl" for="dInsOther" style="margin-top:12px">Outros convênios <small>(separe por vírgula)</small></label>
        <input id="dInsOther" type="text" maxlength="1500" value="${esc(others.join(', '))}" autocomplete="off">
      </fieldset>
    </div>
    <div class="cl-actions"><button class="btn btn-coral" type="submit" id="dSave">Salvar dados</button></div>
    <div id="dMsg" aria-live="polite"></div>
  </form>`;
  $('#dDesc').oninput = (e) => { $('#dDescCount').textContent = `${e.target.value.length} de 1000 caracteres`; };
  $('#dataForm').onsubmit = saveData;
}

const splitList = (v) => [...new Set(String(v || '').split(/[,;\n]/).map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean))];

export function collectClinicData(get) {
  const errs = {};
  const phone = get('dPhone').trim();
  if (phone && (phone.length < 8 || phone.length > 25 || onlyDigits(phone).length < 8)) errs.dPhone = 'Telefone inválido. Ex.: (11) 3222-1000';
  const wa = onlyDigits(get('dWa'));
  if (wa && !/^55\d{10,11}$/.test(wa)) errs.dWa = 'Use 55 + DDD + número, só dígitos (12 ou 13 números).';
  const email = get('dEmail').trim().toLowerCase();
  if (email && !isValidEmail(email)) errs.dEmail = 'E-mail inválido.';
  let site = get('dSite').trim();
  if (site && !/^https?:\/\//i.test(site)) site = `https://${site}`;
  if (site && !/^https?:\/\/[^\s/.]+\.[^\s]+$/i.test(site)) errs.dSite = 'Endereço inválido. Ex.: https://www.suaclinica.com.br';
  const description = get('dDesc').trim();
  if (description.length > 1000) errs.dDesc = 'Use até 1000 caracteres.';
  const opening = {};
  for (const [k] of DAYS) { const v = get(`h-${k}`).trim().slice(0, 40); if (v) opening[k] = v; }
  const specialties = splitList(get('dSpec')).map((x) => x.slice(0, 60));
  if (specialties.length > 30) errs.dSpec = 'Informe até 30 especialidades.';
  const insurances = [...new Set([...get('ins'), ...splitList(get('dInsOther')).map((x) => x.slice(0, 60))])];
  const p = {
    phone: phone || null,
    whatsapp: wa || null,
    email: email || null,
    website: site || null,
    description: description || null,
    opening_hours: Object.keys(opening).length ? opening : null,
    accepts_online_booking: !!get('dOnline'),
    specialties,
    insurances,
  };
  return { p, errs };
}

async function saveData(e) {
  e.preventDefault();
  const c = clinic();
  const get = (id) => {
    if (id === 'ins') return $$('input[name="ins"]:checked').map((x) => x.value);
    const el = $(`#${id}`);
    return el.type === 'checkbox' ? el.checked : el.value;
  };
  const { p, errs } = collectClinicData(get);
  let first = null;
  for (const id of ['dPhone', 'dWa', 'dEmail', 'dSite', 'dDesc', 'dSpec']) {
    const el = $(`#${id}`);
    $(`#${id}Err`).textContent = errs[id] || '';
    if (errs[id]) { el.setAttribute('aria-invalid', 'true'); first ||= el; } else el.removeAttribute('aria-invalid');
  }
  $('#dMsg').innerHTML = '';
  if (first) { first.focus(); return; }
  const btn = $('#dSave');
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  try {
    const res = await auth.rpc('update_my_clinic', { p_clinic: c.id, p });
    if (res !== 'ok') throw Object.assign(new Error(res), { result: res });
    Object.assign(c, p);
    $('#clinicNotes').innerHTML = clinicNotes(c);
    $('#dMsg').innerHTML = note(c.status === 'published' ? 'Dados salvos. Já aparecem para os pacientes na busca.' : 'Dados salvos. Vão aparecer na busca quando o cadastro for publicado.', 'ok');
    toast('Dados salvos.');
  } catch (err) {
    if (lost()) return;
    const m = err.result === 'forbidden' ? 'Sua conta não pode mudar os dados desta clínica.' : friendlyError(err, 'Não foi possível salvar agora. Tente de novo em instantes.');
    $('#dMsg').innerHTML = note(esc(m), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar dados';
    // O botão desligado perde o foco: devolve para quem usa teclado.
    if (btn.isConnected && (!document.activeElement || document.activeElement === document.body)) btn.focus();
  }
}

// ---------- exames e preços ----------
async function tabExams(p) {
  const c = clinic();
  const key = `exames:${c.id}`;
  if (!state.lists[key]) {
    p.innerHTML = loading('Carregando exames…');
    try {
      const rows = (await auth.select(`clinic_exams?select=exam_code,price_cents&clinic_id=eq.${c.id}`)) || [];
      if (state.clinicId !== c.id || !p.isConnected) return;
      state.lists[key] = rows;
    } catch (err) {
      if (lost() || state.clinicId !== c.id || !p.isConnected) return;
      p.innerHTML = `${note(esc(friendlyError(err, 'Não foi possível carregar os exames agora.')), 'err')}<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="retryTab">Tentar de novo</button></div>`;
      $('#retryTab').onclick = () => renderTab();
      return;
    }
    if (state.tab !== 'exames') return;
  }
  const have = Object.fromEntries(state.lists[key].map((x) => [x.exam_code, x.price_cents]));
  p.innerHTML = `<form id="examForm" novalidate>
    <p class="cl-help">Marque os exames que a clínica faz. O preço é opcional: em branco, aparece “sob consulta”. Use o preço particular, à vista.</p>
    <ul class="ex-list">${EXAM_CODES.map((code) => {
      const on = code in have;
      return `<li class="ex${on ? ' on' : ''}" data-code="${code}">
        <label class="cl-check"><input type="checkbox" id="ex-${code}"${on ? ' checked' : ''}><span><b>${esc(EXAMS[code].n)}</b></span></label>
        <div><label class="sr" for="pr-${code}">Preço de ${esc(EXAMS[code].n)} em reais</label>
          <div class="ex-price"><span aria-hidden="true">R$</span><input id="pr-${code}" type="text" inputmode="decimal" maxlength="12" placeholder="sob consulta" value="${on ? esc(centsToInput(have[code])) : ''}"${on ? '' : ' disabled'} aria-describedby="pr-${code}Err"></div>
          <span class="cl-err" id="pr-${code}Err"></span></div>
      </li>`;
    }).join('')}</ul>
    <div class="cl-actions"><button class="btn btn-coral" type="submit" id="exSave">Salvar exames e preços</button></div>
    <div id="exMsg" aria-live="polite"></div>
  </form>`;
  EXAM_CODES.forEach((code) => {
    $(`#ex-${code}`).onchange = (e) => {
      const inp = $(`#pr-${code}`);
      inp.disabled = !e.target.checked;
      e.target.closest('.ex').classList.toggle('on', e.target.checked);
      if (e.target.checked) inp.focus();
    };
  });
  $('#examForm').onsubmit = (e) => saveExams(e, key);
}

export function collectExams(get) {
  const list = [];
  const errs = {};
  for (const code of EXAM_CODES) {
    const { on, price } = get(code);
    if (!on) continue;
    const cents = parsePrice(price);
    if (cents !== null && (Number.isNaN(cents) || cents < 100 || cents > 10000000)) { errs[code] = 'Preço inválido. Use um valor entre R$ 1 e R$ 100.000, como 250 ou 250,00.'; continue; }
    list.push({ code, price_cents: cents });
  }
  return { list, errs };
}

async function saveExams(e, key) {
  e.preventDefault();
  const c = clinic();
  const { list, errs } = collectExams((code) => ({ on: $(`#ex-${code}`).checked, price: $(`#pr-${code}`).value }));
  let first = null;
  for (const code of EXAM_CODES) {
    const inp = $(`#pr-${code}`);
    $(`#pr-${code}Err`).textContent = errs[code] || '';
    if (errs[code]) { inp.setAttribute('aria-invalid', 'true'); first ||= inp; } else inp.removeAttribute('aria-invalid');
  }
  $('#exMsg').innerHTML = '';
  if (first) { first.focus(); return; }
  const btn = $('#exSave');
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  try {
    const res = await auth.rpc('set_my_clinic_exams', { p_clinic: c.id, p_exams: list });
    if (res !== 'ok') throw Object.assign(new Error(res), { result: res });
    state.lists[key] = list.map((x) => ({ exam_code: x.code, price_cents: x.price_cents }));
    list.forEach((x) => { $(`#pr-${x.code}`).value = centsToInput(x.price_cents); });
    $('#exMsg').innerHTML = note(list.length ? 'Exames e preços salvos.' : 'Salvo. Nenhum exame marcado.', 'ok');
    toast('Exames e preços salvos.');
  } catch (err) {
    if (lost()) return;
    const m = err.result === 'forbidden' ? 'Sua conta não pode mudar os exames desta clínica.' : friendlyError(err, 'Não foi possível salvar agora. Tente de novo em instantes.');
    $('#exMsg').innerHTML = note(esc(m), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar exames e preços';
    // O botão desligado perde o foco: devolve para quem usa teclado.
    if (btn.isConnected && (!document.activeElement || document.activeElement === document.body)) btn.focus();
  }
}

// ---------- equipe do IMED: pedidos de cadastro ----------
const cnesFicha = (cityCode, cnes) => (cityCode && /^\d{7}$/.test(cnes) ? `https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/${String(cityCode).padStart(6, '0')}${cnes}` : '');
const CK_NEED = 'Para aprovar, marque as quatro conferências e informe o conselho e o número do registro.';
const CK_READY = 'Conferência completa: pode aprovar.';
// Onde conferir o registro: o CFM tem a busca de médicos; os outros conselhos, no site do conselho regional.
function councilLink(council) {
  const url = T.COUNCIL_LINKS?.[council];
  if (url) return `<a href="${esc(url)}" target="_blank" rel="noopener">Busca de médicos do CFM<span class="sr"> (abre em nova aba)</span></a>`;
  return council ? 'Confira o registro no site do conselho regional da profissão, com o nome e o número.' : 'Escolha o conselho para ver onde conferir.';
}

async function tabClaims(p) {
  p.innerHTML = loading('Carregando pedidos de cadastro…');
  let pending; let decided; let est = {}; let mun = {};
  try {
    [pending, decided] = await Promise.all([
      auth.select('establishment_claims?select=*&status=eq.pending&order=created_at'),
      auth.select('establishment_claims?select=*&status=neq.pending&order=decided_at.desc.nullslast&limit=20'),
    ]);
    const codes = [...new Set([...pending, ...decided].map((r) => r.cnes).filter((c) => /^\d{7}$/.test(c)))];
    if (codes.length) {
      const rows = (await auth.select(`establishments?select=cnes,name,kind,address_line,neighborhood,cep,phone,city_ibge&cnes=in.(${codes.join(',')})`)) || [];
      est = Object.fromEntries(rows.map((r) => [r.cnes, r]));
      const ibges = [...new Set(rows.map((r) => Number(r.city_ibge)).filter(Boolean))];
      if (ibges.length) {
        const ms = (await auth.select(`municipalities?select=ibge,name,uf,cnes_code&ibge=in.(${ibges.join(',')})`)) || [];
        mun = Object.fromEntries(ms.map((m) => [m.ibge, m]));
      }
    }
  } catch (err) {
    if (lost()) return;
    p.innerHTML = `${note(esc(friendlyError(err, 'Não foi possível carregar os pedidos de cadastro agora.')), 'err')}<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="retryTab">Tentar de novo</button></div>`;
    $('#retryTab').onclick = () => renderTab();
    return;
  }
  // Conferência já salva de cada pedido em análise (claim_checks). Sem resposta: começa em branco.
  let checks = {};
  if (pending.length) {
    try {
      const ids = pending.map((r) => String(r.id)).filter((v) => /^[\w-]{1,64}$/.test(v));
      const rows = ids.length ? (await auth.select(`claim_checks?select=*&claim_id=in.(${ids.join(',')})`)) || [] : [];
      checks = Object.fromEntries(rows.map((c) => [c.claim_id, c]));
    } catch { checks = {}; }
  }
  if (state.tab !== 'cadastros' || !p.isConnected) return;
  const placeOf = (r) => {
    const e = est[r.cnes];
    const m = e ? mun[e.city_ibge] : null;
    return { e, m, link: cnesFicha(m?.cnes_code, r.cnes) };
  };
  const checkHtml = (r, e, link) => {
    const ck = checks[r.id] || null;
    const id = esc(r.id);
    const cnesTel = e?.phone ? (telHref(e.phone) ? `<a href="${telHref(e.phone)}">${esc(e.phone)}</a>` : esc(e.phone)) : 'não informado no CNES';
    const extra = {
      cnes_active: link ? '' : ' Sem link do CNES: confira pelo código no site do CNES.',
      cnpj_active: ' <a href="https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp" target="_blank" rel="noopener">Consulta de CNPJ da Receita<span class="sr"> (abre em nova aba)</span></a>',
      phone_confirmed: ` Telefone do CNES: ${cnesTel}.`,
      council_active: '',
    };
    const council = ck?.council && T.isCouncil(ck.council) ? ck.council : '';
    const councilBox = `<div class="ck-council">
        <div><label class="cl-lbl" for="ckc-${id}">Conselho do profissional responsável</label>
          <select id="ckc-${id}" data-ck="council"><option value="">Escolha o conselho</option>${T.COUNCILS.map(([v, n]) => `<option value="${v}"${council === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div><label class="cl-lbl" for="ckr-${id}">Número do registro, com a UF</label>
          <input id="ckr-${id}" type="text" data-ck="council_number" maxlength="30" autocomplete="off" placeholder="Ex.: 123456-SP" value="${esc(ck?.council_number || '')}"></div>
        <p class="cl-hint" data-ck-link>${councilLink(council)}</p>
      </div>`;
    return `<fieldset class="ck" data-claim="${id}"><legend>Conferência antes de aprovar <small>(obrigatória, fica gravada com a data)</small></legend>
        ${T.CLAIM_CHECKS.map(([k, title, help]) => `<label class="cl-check ck-item"><input type="checkbox" data-ck="${k}"${ck?.[k] ? ' checked' : ''}><span><b>${esc(title)}</b><small>${esc(help)}${extra[k]}</small></span></label>`).join('')}
        ${councilBox}
        <label class="cl-lbl" for="ckn-${id}" style="margin-top:10px">Observação da conferência <small>(opcional, só a equipe vê; ex.: registro conferido no site do conselho em 30/10)</small></label>
        <input id="ckn-${id}" type="text" data-ck="note" maxlength="300" autocomplete="off" value="${esc(ck?.note || '')}">
        <p class="cl-hint" data-ck-saved>${ck ? `Conferência salva em ${esc(fmtDateTime(ck.checked_at))}.` : 'Conferência ainda não salva.'}</p>
        <div class="cl-row"><button class="btn btn-ghost btn-sm" type="button" data-save-checks="${id}">Salvar conferência</button></div>
      </fieldset>`;
  };
  const card = (r) => {
    const { e, m, link } = placeOf(r);
    const tel = telHref(r.phone);
    const complete = T.checksComplete(checks[r.id]);
    return `<li class="rq" id="cl-${esc(r.id)}">
      <div class="rq-hd"><div><h3>${esc(e?.name || 'Estabelecimento não encontrado no mapa')}</h3>
        <small>CNES ${esc(r.cnes)}${e ? ` · ${esc(kindName(e.kind))}` : ''} · pedido em ${esc(fmtDateTime(r.created_at))}</small></div>
        <span class="rq-st st-pending">${esc(CLAIM_STATUS[r.status])}</span></div>
      <dl>
        ${e ? `<dt>Endereço</dt><dd>${esc([e.address_line, e.neighborhood, m && `${m.name} - ${m.uf}`].filter(Boolean).join(' · '))}</dd>` : ''}
        <dt>Conferir</dt><dd>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">Ficha no CNES<span class="sr"> (abre em nova aba)</span></a>` : 'Sem link do CNES'}</dd>
        <dt>Solicitante</dt><dd>${esc(r.claimant_name)}</dd>
        <dt>Cargo</dt><dd>${esc(ROLES[r.role] || r.role)}</dd>
        <dt>${onlyDigits(r.document).length === 14 ? 'CNPJ' : 'CPF'}</dt><dd><span data-doc="${esc(r.id)}">${esc(hideDoc(r.document))}</span> <button class="link" type="button" data-show="${esc(r.id)}" aria-expanded="false">Mostrar</button></dd>
        <dt>Registro informado</dt><dd>${r.crm ? esc(r.crm) : 'Não informado'}</dd>
        <dt>Celular</dt><dd>${tel ? `<a href="${tel}">${esc(fmtPhone(r.phone))}</a>` : esc(r.phone)}</dd>
        <dt>E-mail</dt><dd>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : 'Não informado'}</dd>
        ${r.message ? `<dt>Mensagem</dt><dd>${esc(r.message)}</dd>` : ''}
      </dl>
      ${checkHtml(r, e, link)}
      <div class="rq-act" role="group" aria-label="Decidir o pedido de ${esc(r.claimant_name)}">
        <button class="btn btn-primary btn-sm" type="button" data-approve="${esc(r.id)}"${complete ? '' : ' disabled'} aria-describedby="cka-${esc(r.id)}">Aprovar</button>
        <span class="cl-hint ck-need" id="cka-${esc(r.id)}">${complete ? CK_READY : CK_NEED}</span>
        <button class="btn btn-danger btn-sm" type="button" data-reject="${esc(r.id)}" aria-expanded="false" aria-controls="rj-${esc(r.id)}">Recusar</button>
        <div class="rq-more" id="rj-${esc(r.id)}" hidden style="width:100%">
          <label class="cl-lbl" for="note-${esc(r.id)}">Motivo da recusa <small>(a pessoa vê este texto)</small></label>
          <textarea id="note-${esc(r.id)}" maxlength="300"></textarea>
          <div class="cl-row"><button class="btn btn-danger btn-sm" type="button" data-confirm-reject="${esc(r.id)}">Confirmar recusa</button></div>
        </div>
        <div class="cl-msg" data-msg="${esc(r.id)}" aria-live="polite" style="width:100%"></div>
      </div>
    </li>`;
  };
  const cls = { approved: 'bd-ok', rejected: 'bd-err' };
  p.innerHTML = `<p class="cl-help">Antes de aprovar, faça a conferência de cada pedido: CNES ativo, CNPJ ativo, ligação para o telefone oficial do CNES confirmando quem pediu e registro ativo do profissional responsável pelo local no conselho da profissão dele (CRM, CRF, CRBM, CRO…). Ela fica gravada com a data, que aparece na página do parceiro como “Verificado pelo IMED em”. Ao aprovar, o estabelecimento vira clínica parceira e a pessoa passa a cuidar do cadastro.</p>
    <h3 style="font-size:16px;margin:4px 0 10px">Aguardando decisão (${pending.length})</h3>
    ${pending.length ? `<ul class="rq-list">${pending.map(card).join('')}</ul>` : '<p class="cl-help">Nenhum pedido aguardando.</p>'}
    <h3 style="font-size:16px;margin:22px 0 10px">Decididos recentemente</h3>
    ${decided.length ? `<ul class="cl-list">${decided.map((r) => `<li><span><b>${esc(est[r.cnes]?.name || `CNES ${r.cnes}`)}</b>
        <small>${esc(r.claimant_name)}${r.decided_at ? ` · ${esc(fmtDateTime(r.decided_at))}` : ''}</small>${r.decision_note ? `<small>Motivo: ${esc(r.decision_note)}</small>` : ''}</span>
        <span class="bd ${cls[r.status] || ''}">${esc(CLAIM_STATUS[r.status] || r.status)}</span></li>`).join('')}</ul>` : '<p class="cl-help">Nenhum ainda.</p>'}`;
  // Marcar ou desmarcar uma conferência (ou trocar o conselho e o número) libera ou trava o "Aprovar".
  const refreshApprove = (box) => {
    const id = box.dataset.claim;
    const ok = T.checksComplete(payloadOf(id));
    $(`#cl-${CSS.escape(id)} [data-approve]`, p).disabled = !ok;
    $(`#cka-${CSS.escape(id)}`, p).textContent = ok ? CK_READY : CK_NEED;
  };
  p.onchange = (ev) => {
    const box = ev.target.closest('fieldset.ck');
    if (!box) return;
    if (ev.target.dataset.ck === 'council') $('[data-ck-link]', box).innerHTML = councilLink(ev.target.value);
    refreshApprove(box);
  };
  p.oninput = (ev) => {
    const box = ev.target.closest('fieldset.ck');
    if (box && ev.target.dataset.ck === 'council_number') refreshApprove(box);
  };
  const payloadOf = (id) => {
    const box = $(`fieldset.ck[data-claim="${CSS.escape(id)}"]`, p);
    return T.checksPayload((k) => {
      const el = $(`[data-ck="${k}"]`, box);
      return el?.type === 'checkbox' ? el.checked : el?.value ?? '';
    });
  };
  const saveChecks = async (id) => {
    const res = await auth.rpc('save_claim_checks', { p_claim: id, p_checks: payloadOf(id) });
    if (res !== 'ok') throw Object.assign(new Error(res), { result: res });
  };
  p.onclick = async (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    const msg = (id) => $(`[data-msg="${CSS.escape(id)}"]`, p);
    if (t.dataset.saveChecks) {
      const id = t.dataset.saveChecks;
      t.disabled = true;
      msg(id).className = 'cl-msg';
      msg(id).textContent = 'Salvando a conferência…';
      try {
        await saveChecks(id);
        msg(id).textContent = 'Conferência salva.';
        msg(id).classList.add('ok');
        const saved = $(`fieldset.ck[data-claim="${CSS.escape(id)}"] [data-ck-saved]`, p);
        if (saved) saved.textContent = `Conferência salva em ${fmtDateTime(new Date().toISOString())}.`;
        toast('Conferência salva.');
      } catch (err) {
        if (lost()) return;
        msg(id).textContent = err.result === 'already_decided' ? 'Este pedido já foi decidido.' : err.result === 'forbidden' ? 'Só a equipe do IMED faz a conferência.' : friendlyError(err, 'Não foi possível salvar a conferência agora. Tente de novo.');
        msg(id).classList.add('err');
      } finally { t.disabled = false; }
      return;
    }
    if (t.dataset.show) {
      const r = pending.find((x) => x.id === t.dataset.show);
      const span = $(`[data-doc="${CSS.escape(r.id)}"]`, p);
      const open = t.getAttribute('aria-expanded') === 'true';
      span.textContent = open ? hideDoc(r.document) : maskDoc(r.document);
      t.setAttribute('aria-expanded', String(!open));
      t.textContent = open ? 'Mostrar' : 'Esconder';
    } else if (t.dataset.reject) {
      const box = $(`#rj-${CSS.escape(t.dataset.reject)}`, p);
      box.hidden = !box.hidden;
      t.setAttribute('aria-expanded', String(!box.hidden));
      if (!box.hidden) $('textarea', box).focus();
    } else if (t.dataset.approve || t.dataset.confirmReject) {
      const id = t.dataset.approve || t.dataset.confirmReject;
      const btns = $$(`#cl-${CSS.escape(id)} button`, p);
      btns.forEach((b) => { b.disabled = true; });
      msg(id).className = 'cl-msg';
      msg(id).textContent = 'Salvando…';
      try {
        if (t.dataset.approve) {
          // Primeiro grava a conferência (com a data); o banco só aprova com as quatro marcadas.
          await saveChecks(id);
          await auth.rpc('approve_claim', { p_claim: id });
          toast('Pedido aprovado. A clínica já aparece como parceira, com a data da conferência.');
        } else {
          const noteText = $(`#note-${CSS.escape(id)}`, p).value.trim().slice(0, 300);
          await auth.rpc('reject_claim', { p_claim: id, p_note: noteText || null });
          toast('Pedido recusado.');
        }
        tabClaims(p);
      } catch (err) {
        if (lost()) return;
        btns.forEach((b) => { b.disabled = false; });
        const ok = T.checksComplete(payloadOf(id));
        const ap = $(`#cl-${CSS.escape(id)} [data-approve]`, p);
        if (ap) ap.disabled = !ok;
        if (err.result === 'already_decided') { msg(id).textContent = 'Este pedido já foi decidido.'; msg(id).classList.add('err'); return; }
        const dbMsg = err?.data?.code === '22023' ? err.data.message : '';
        msg(id).textContent = dbMsg || friendlyError(err, 'Não foi possível salvar a decisão agora. Tente de novo.');
        msg(id).classList.add('err');
      }
    }
  };
}

// ---------- equipe do IMED: mensagens do Fale com o IMED ----------
const SUBJECT = Object.fromEntries(T.CONTACT_SUBJECTS.map(([k, l]) => [k, l]));
const MSG_FILTER = { open: 'Em aberto', answered: 'Respondidas', '': 'Todas' };
// WhatsApp só para celular (11 dígitos, com 9 depois do DDD).
const waPhone = (d) => (/^[1-9]{2}9\d{8}$/.test(d || '') ? `https://wa.me/55${d}` : '');

async function adminList(p, tab, path, render) {
  p.innerHTML = loading('Carregando…');
  const same = () => state.tab === tab && p.isConnected;
  try {
    const rows = (await auth.select(path)) || [];
    if (!same()) return;
    render(rows);
    if (state.refocus) { $(state.refocus, p)?.focus(); state.refocus = null; }
  } catch (err) {
    if (lost() || !same()) return;
    state.refocus = null;
    p.innerHTML = `${note(esc(friendlyError(err, 'Não foi possível carregar agora. Tente de novo em instantes.')), 'err')}<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="retryTab">Tentar de novo</button></div>`;
    $('#retryTab').onclick = () => renderTab();
  }
}

function tabMessages(p) {
  const f = state.filter.msg ?? 'open';
  const path = `contact_messages?select=*&order=created_at.desc&limit=200${f ? `&status=eq.${f}` : ''}`;
  adminList(p, 'mensagens', path, (rows) => {
    const item = (r) => {
      const tel = r.reply_phone ? telHref(r.reply_phone) : '';
      const wa = waPhone(r.reply_phone);
      const reply = r.reply_email ? `<a href="mailto:${esc(r.reply_email)}?subject=${encodeURIComponent(`IMED · protocolo ${r.protocol}`)}">${esc(r.reply_email)}</a>`
        : `${tel ? `<a href="${tel}">${esc(fmtPhone(r.reply_phone))}</a>` : esc(r.reply_phone)}${wa ? ` <a href="${wa}" target="_blank" rel="noopener">WhatsApp<span class="sr"> (abre em nova aba)</span></a>` : ''}`;
      const answered = r.status === 'answered';
      return `<li class="rq" id="msg-${esc(r.id)}">
        <div class="rq-hd"><div><h3>${esc(SUBJECT[r.subject] || r.subject)}${r.flagged ? '<span class="bd-warn">Pode ser robô</span>' : ''}</h3><small>Protocolo ${esc(r.protocol)} · ${esc(fmtDateTime(r.created_at))}</small></div>
          <span class="rq-st ${answered ? 'st-completed' : 'st-pending'}">${answered ? 'Respondida' : 'Em aberto'}</span></div>
        ${r.flagged ? note('Chegou numa hora com muitas mensagens de todo mundo (100 ou mais): pode ser robô. Confira antes de responder.', 'warn') : ''}
        ${T.isLgpdSubject(r.subject) ? note('Pedido sobre dados pessoais (LGPD): confirme que quem pede é o dono dos dados antes de mostrar, corrigir ou apagar qualquer coisa.', 'warn') : ''}
        <dl>
          <dt>Nome</dt><dd>${esc(r.name)}</dd>
          <dt>Responder por</dt><dd><span class="rq-contact">${reply}</span></dd>
          ${r.account_email ? `<dt>Conta no IMED</dt><dd>${esc(r.account_email)} <small>(estava logado ao enviar)</small></dd>` : ''}
          ${r.request_code ? `<dt>Protocolo do pedido</dt><dd>${esc(r.request_code)}</dd>` : ''}
          <dt>Mensagem</dt><dd class="msg-body">${esc(r.message)}</dd>
          ${answered && r.answered_at ? `<dt>Respondida em</dt><dd>${esc(fmtDateTime(r.answered_at))}</dd>` : ''}
        </dl>
        <div class="rq-act"><button class="btn btn-ghost btn-sm" type="button" data-msg-status="${answered ? 'open' : 'answered'}" data-id="${esc(r.id)}">${answered ? 'Voltar para em aberto' : 'Marcar como respondida'}<span class="sr"> a mensagem ${esc(r.protocol)}</span></button></div>
      </li>`;
    };
    p.innerHTML = `<p class="cl-help">Mensagens do <a class="link" href="contato.html">Fale com o IMED</a>. Responda pelo contato que a pessoa deixou, citando o protocolo, e marque como respondida.</p>
      <div class="cl-filter"><label class="cl-lbl" for="flt-msg" style="margin:0">Mostrar</label>
        <select id="flt-msg">${Object.entries(MSG_FILTER).map(([v, n]) => `<option value="${v}"${f === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" type="button" id="rf-msg"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Atualizar lista</button></div>
      ${rows.length ? `<ul class="rq-list">${rows.map(item).join('')}</ul>` : `<p class="cl-help">${f === 'open' ? 'Nenhuma mensagem em aberto.' : 'Nenhuma mensagem.'}</p>`}
      <div id="msgMsg" aria-live="polite"></div>`;
    $('#flt-msg').onchange = (e) => { state.filter.msg = e.target.value; state.refocus = '#flt-msg'; renderTab(); };
    $('#rf-msg').onclick = () => { state.refocus = '#rf-msg'; renderTab(); };
    p.onclick = async (e) => {
      const b = e.target.closest('[data-msg-status]');
      if (!b) return;
      b.disabled = true;
      try {
        const res = await auth.rpc('set_contact_status', { p_id: b.dataset.id, p_status: b.dataset.msgStatus });
        if (res !== 'ok') throw Object.assign(new Error(res), { result: res });
        const r = rows.find((x) => x.id === b.dataset.id);
        toast(b.dataset.msgStatus === 'answered' ? `Mensagem ${r?.protocol || ''} marcada como respondida.` : 'Mensagem de volta para em aberto.');
        state.refocus = '#flt-msg';
        renderTab();
      } catch (err) {
        if (lost()) return;
        b.disabled = false;
        $('#msgMsg', p).innerHTML = note(esc(err.result === 'forbidden' ? 'Só a equipe do IMED cuida das mensagens.' : err.result === 'not_found' ? 'Esta mensagem não existe mais.' : friendlyError(err, 'Não foi possível salvar agora. Tente de novo.')), 'err');
      }
    };
  });
}

// ---------- equipe do IMED: avisos "Algo errado aqui?" ----------
const REPORT_FILTER = { open: 'Em aberto', resolved: 'Resolvidos', '': 'Todos' };
function tabReports(p) {
  const f = state.filter.rep ?? 'open';
  const path = `place_reports?select=*,establishments(name,address_line,neighborhood,phone,municipalities(name,uf,cnes_code)),clinics(name,city,state,cnes)&order=created_at.desc&limit=200${f ? `&status=eq.${f}` : ''}`;
  adminList(p, 'avisos', path, (rows) => {
    const item = (r) => {
      const est = r.establishments || null;
      const cli = r.clinics || null;
      const m = est?.municipalities || null;
      const name = cli?.name || est?.name || (r.cnes ? `CNES ${r.cnes}` : 'Local');
      const where = cli ? [cli.city, cli.state].filter(Boolean).join(' - ') : [est?.address_line, est?.neighborhood, m && `${m.name} - ${m.uf}`].filter(Boolean).join(' · ');
      const page = r.clinic_id ? `local.html?id=${encodeURIComponent(r.clinic_id)}` : `local.html?cnes=${encodeURIComponent(r.cnes)}`;
      const ficha = r.cnes ? cnesFicha(m?.cnes_code, r.cnes) : '';
      const done = r.status === 'resolved';
      // O mesmo problema do mesmo local vira um aviso só, com o número de vezes e até 5 textos diferentes a mais.
      const times = Number.isInteger(r.repeats) && r.repeats > 0 ? r.repeats : 1;
      const notes = [r.note, ...(Array.isArray(r.more_notes) ? r.more_notes : [])].filter((x) => typeof x === 'string' && x.trim());
      return `<li class="rq" id="rep-${esc(r.id)}">
        <div class="rq-hd"><div><h3>${esc(T.reportKindLabel(r.kind))}${times > 1 ? `<span class="bd-warn">Avisado ${times} vezes</span>` : ''}</h3><small>${esc(name)} · ${esc(fmtDateTime(r.created_at))}${times > 1 && r.last_at ? ` · último aviso em ${esc(fmtDateTime(r.last_at))}` : ''}</small></div>
          <span class="rq-st ${done ? 'st-completed' : 'st-pending'}">${done ? 'Resolvido' : 'Em aberto'}</span></div>
        <dl>
          <dt>Local</dt><dd><a href="${esc(page)}" target="_blank" rel="noopener">${esc(name)}<span class="sr"> (abre em nova aba)</span></a>${where ? `<br><small>${esc(where)}</small>` : ''}</dd>
          <dt>Origem</dt><dd>${r.clinic_id ? 'Parceiro do IMED (a clínica corrige pela área dela)' : `Cadastro oficial (CNES ${esc(r.cnes)})${ficha ? ` · <a href="${esc(ficha)}" target="_blank" rel="noopener">Ficha no CNES<span class="sr"> (abre em nova aba)</span></a>` : ''}`}</dd>
          ${est?.phone && !r.clinic_id ? `<dt>Telefone no CNES</dt><dd>${esc(est.phone)}</dd>` : ''}
          ${notes.length ? `<dt>${notes.length > 1 ? 'O que escreveram' : 'O que a pessoa escreveu'}</dt><dd class="msg-body">${notes.map(esc).join('\n—\n')}</dd>` : ''}
          ${done && r.resolved_at ? `<dt>Resolvido em</dt><dd>${esc(fmtDateTime(r.resolved_at))}</dd>` : ''}
        </dl>
        <div class="rq-act"><button class="btn btn-ghost btn-sm" type="button" data-rep-status="${done ? 'open' : 'resolved'}" data-id="${esc(r.id)}">${done ? 'Reabrir' : 'Marcar como resolvido'}<span class="sr"> o aviso sobre ${esc(name)}</span></button></div>
      </li>`;
    };
    p.innerHTML = `<p class="cl-help">Avisos de dados errados enviados pelos visitantes na página de cada local. Confira com o local. No cadastro oficial, a correção é feita pelo próprio estabelecimento no CNES; nos parceiros, pela clínica na área dela.</p>
      <div class="cl-filter"><label class="cl-lbl" for="flt-rep" style="margin:0">Mostrar</label>
        <select id="flt-rep">${Object.entries(REPORT_FILTER).map(([v, n]) => `<option value="${v}"${f === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" type="button" id="rf-rep"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Atualizar lista</button></div>
      ${rows.length ? `<ul class="rq-list">${rows.map(item).join('')}</ul>` : `<p class="cl-help">${f === 'open' ? 'Nenhum aviso em aberto.' : 'Nenhum aviso.'}</p>`}
      <div id="repMsg" aria-live="polite"></div>`;
    $('#flt-rep').onchange = (e) => { state.filter.rep = e.target.value; state.refocus = '#flt-rep'; renderTab(); };
    $('#rf-rep').onclick = () => { state.refocus = '#rf-rep'; renderTab(); };
    p.onclick = async (e) => {
      const b = e.target.closest('[data-rep-status]');
      if (!b) return;
      b.disabled = true;
      try {
        const res = await auth.rpc('set_place_report_status', { p_id: b.dataset.id, p_status: b.dataset.repStatus });
        if (res !== 'ok') throw Object.assign(new Error(res), { result: res });
        toast(b.dataset.repStatus === 'resolved' ? 'Aviso marcado como resolvido.' : 'Aviso reaberto.');
        state.refocus = '#flt-rep';
        renderTab();
      } catch (err) {
        if (lost()) return;
        b.disabled = false;
        $('#repMsg', p).innerHTML = note(esc(err.result === 'forbidden' ? 'Só a equipe do IMED cuida dos avisos.' : err.result === 'not_found' ? 'Este aviso não existe mais.' : friendlyError(err, 'Não foi possível salvar agora. Tente de novo.')), 'err');
      }
    };
  });
}

// ---------- equipe do IMED: contador de visitas próprio (sem cookies e sem dados pessoais) ----------
// Banco ainda sem a função admin_stats (migração 20261030143839_visitas): o PostgREST responde 404 (PGRST202).
const noStatsFn = (err) => err?.status === 404 || err?.data?.code === 'PGRST202' || err?.data?.code === '42883';

async function tabVisits(p) {
  const days = state.filter.vis ?? 7;
  const same = () => state.tab === 'visitas' && p.isConnected && (state.filter.vis ?? 7) === days;
  let body = $('#vsBody', p);
  if (body) {
    // Trocou o período ou atualizou: os números de antes ficam (mais claros) até os novos chegarem.
    body.classList.add('vs-busy');
    body.setAttribute('aria-busy', 'true');
  } else {
    p.innerHTML = `<p class="cl-help">Contagem própria do IMED, <b>sem cookies e sem dados pessoais</b>: cada página aberta soma 1 no dia, e as buscas somam o exame, o tipo de local e a cidade, cada um separado. O banco não guarda IP, aparelho nem quem visitou. Não entram robôs, testes e quem liga “Não rastrear” ou o Controle Global de Privacidade no navegador. Os pedidos de agendamento e as teleconsultas não vêm do contador: são o número real, das próprias tabelas do IMED. <a class="link" href="privacidade.html#cookies">Veja na política de privacidade</a>.</p>
      <div class="cl-filter"><label class="cl-lbl" for="flt-vis" style="margin:0">Período</label>
        <select id="flt-vis">${V.PERIODS.map(([v, n]) => `<option value="${v}"${days === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" type="button" id="rf-vis"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Atualizar</button></div>
      <div id="vsBody" class="vs-root" aria-busy="true">${loading('Carregando os números…')}</div>`;
    body = $('#vsBody', p);
    $('#flt-vis', p).onchange = (e) => { state.filter.vis = Number(e.target.value) === 30 ? 30 : 7; renderTab(); };
    $('#rf-vis', p).onclick = () => renderTab();
  }
  const done = () => { body.classList.remove('vs-busy'); body.removeAttribute('aria-busy'); };
  try {
    const raw = await auth.rpc('admin_stats', { p_days: days });
    if (!same()) return;
    body.innerHTML = V.statsHtml(V.normalizeStats(raw, days));
    done();
  } catch (err) {
    if (lost() || !same()) return;
    body.innerHTML = noStatsFn(err)
      ? note('O contador de visitas ainda não está ligado no banco. Os números aparecem aqui depois que a atualização do banco for aplicada.', 'warn')
      : `${note(esc(friendlyError(err, 'Não foi possível carregar os números agora. Tente de novo em instantes.')), 'err')}<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="retryVis">Tentar de novo</button></div>`;
    done();
    const retry = $('#retryVis', p);
    if (retry) retry.onclick = () => renderTab();
  }
}

// ---------- início ----------
async function init() {
  const flash = await finishLogin();
  if (flash) $('#flash').innerHTML = note(esc(flash.text), flash.kind);
  renderAccount();
  if (auth.user()) loadAll();
}
init();
