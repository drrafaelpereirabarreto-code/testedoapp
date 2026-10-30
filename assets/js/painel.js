// Área da clínica: pedidos dos pacientes, dados, horários, convênios, exames e preços.
// Para a equipe do IMED (is_imed_admin): pedidos de cadastro e pedidos feitos ao IMED.
// Dados de pacientes ficam só na memória da página (nada vai para o localStorage).
import {
  auth, $, $$, esc, EXAMS, PERIODS, examName, kindName, ROLES, CLAIM_STATUS, statusLabel, onlyDigits, maskPhone,
  isValidEmail, hideDoc, maskDoc, fmtPhone, fmtDate, fmtDateTime, parsePrice, centsToInput, friendlyError, loading,
  note, finishLogin, renderAuth, toast, telHref, EXPIRED,
} from './clinica.js';

const STATUSES = ['pending', 'contacted', 'confirmed', 'completed', 'cancelled'];
const ACTIONS = ['contacted', 'confirmed', 'completed', 'cancelled'];
const DAYS = [['seg', 'Segunda'], ['ter', 'Terça'], ['qua', 'Quarta'], ['qui', 'Quinta'], ['sex', 'Sexta'], ['sab', 'Sábado'], ['dom', 'Domingo']];
export const COMMON_INSURANCES = ['Amil', 'Bradesco Saúde', 'SulAmérica', 'Unimed', 'Hapvida', 'NotreDame Intermédica', 'Porto Seguro', 'Prevent Senior', 'Cassi', 'Golden Cross'];
const EXAM_CODES = ['rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab'];
const REQ_COLS = 'id,created_at,exam_code,preferred_date,preferred_period,patient_name,patient_phone,patient_email,notes,status';
const IMED_COLS = `${REQ_COLS},place_source,place_ref,place_name,place_address,place_phone`;

const state = { admin: false, clinics: [], clinicId: null, tab: null, lists: {}, filter: { pedidos: '', concierge: '' } };
const app = () => $('#app');
const clinic = () => state.clinics.find((c) => c.id === state.clinicId) || null;
const uuidOk = (v) => /^[0-9a-f-]{36}$/i.test(String(v));

// ---------- entrada ----------
function renderAccount() {
  renderAuth($('#authBox'), {
    back: () => `${location.origin}${location.pathname}`,
    intro: 'Entre com o <b>mesmo e-mail usado no pedido de cadastro</b> da clínica. Enviamos um link de entrada; não precisa de senha.',
    onSignOut: () => { state.clinics = []; state.lists = {}; app().innerHTML = ''; renderAccount(); toast('Você saiu da sua conta.'); },
  });
}

// A renovação da entrada falhou e auth.js apagou a sessão: volta para o quadro de entrada.
function lost() {
  if (auth.user()) return false;
  state.clinics = []; state.lists = {}; state.admin = false;
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
    state.clinics = ids.length ? (await auth.select(`clinics?select=*&id=in.(${ids.join(',')})&order=name`)) || [] : [];
  } catch (err) {
    if (lost()) return;
    app().innerHTML = `<section class="cl-card">${note(esc(friendlyError(err, 'Não foi possível carregar sua área agora. Tente de novo em instantes.')), 'err')}
      <div class="cl-actions"><button class="btn btn-ghost" type="button" id="retry">Tentar de novo</button></div></section>`;
    $('#retry').onclick = loadAll;
    return;
  }
  if (!state.clinics.length && !state.admin) {
    app().innerHTML = `<section class="cl-card" aria-labelledby="noneTitle"><h2 id="noneTitle">Nenhuma clínica nesta conta</h2>
      <p class="cl-help">Esta conta ainda não cuida de nenhuma clínica no IMED. Se você é responsável por uma clínica, laboratório ou hospital, peça para assumir o cadastro: a equipe do IMED confere e libera o acesso em até 2 dias úteis.</p>
      <p class="cl-help">Já fez o pedido? Confira se entrou com o mesmo e-mail usado nele.</p>
      <div class="cl-actions"><a class="btn btn-coral" href="reivindicar.html" id="goClaim">Assumir o cadastro da minha clínica</a></div></section>`;
    return;
  }
  state.clinicId = state.clinics.some((c) => c.id === state.clinicId) ? state.clinicId : state.clinics[0]?.id ?? null;
  renderShell();
}

// ---------- abas ----------
function tabs() {
  const t = [];
  if (clinic()) t.push(['pedidos', 'Pedidos'], ['dados', 'Dados da clínica'], ['exames', 'Exames e preços']);
  if (state.admin) t.push(['cadastros', 'Pedidos de cadastro'], ['concierge', 'Pedidos ao IMED']);
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
  const picker = state.clinics.length > 1
    ? `<label class="cl-lbl sr" for="clinicPick">Clínica</label><select id="clinicPick" class="cl-pick">${state.clinics.map((x) => `<option value="${esc(x.id)}"${x.id === state.clinicId ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
    : '';
  app().innerHTML = `<section class="cl-card" aria-labelledby="clinicTitle">
      <div class="cl-bar">
        <div><h2 id="clinicTitle">${c ? esc(c.name) : 'Equipe do IMED'}</h2>
          ${c ? `<p class="cl-help" style="margin:4px 0 0">${esc([kindName(c.kind), c.city && `${c.city} - ${c.state}`, c.cnes && `CNES ${c.cnes}`].filter(Boolean).join(' · '))}</p>` : '<p class="cl-help" style="margin:4px 0 0">Você entrou como equipe do IMED.</p>'}
        </div>
        ${picker}
      </div>
      <div id="clinicNotes">${clinicNotes(c)}</div>
    </section>
    <div class="cl-tabs" role="tablist" aria-label="Seções da área da clínica">
      ${list.map(([id, label]) => `<button class="cl-tab" role="tab" type="button" id="tab-${id}" aria-controls="panel" aria-selected="${id === state.tab}" tabindex="${id === state.tab ? 0 : -1}" data-tab="${id}">${esc(label)}</button>`).join('')}
    </div>
    <section class="cl-card cl-panel" role="tabpanel" id="panel" aria-labelledby="tab-${state.tab}" tabindex="0"></section>`;
  const pick = $('#clinicPick');
  if (pick) pick.onchange = () => { state.clinicId = pick.value; state.lists = {}; renderShell(); };
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
const listKey = (tab) => (tab === 'pedidos' ? `pedidos:${state.clinicId}` : tab);

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
  p.onclick = null;
  ({ pedidos: tabRequests, dados: tabData, exames: tabExams, cadastros: tabClaims, concierge: tabConcierge })[state.tab](p);
}

// ---------- pedidos (clínica e IMED) ----------
// WhatsApp só para celular (11 dígitos, com 9 depois do DDD).
const waHref = (phone) => { const d = onlyDigits(phone); return /^[1-9]{2}9\d{8}$/.test(d) ? `https://wa.me/55${d}` : ''; };

function requestCard(r, withPlace) {
  const tel = telHref(r.patient_phone);
  const wa = waHref(r.patient_phone);
  const placeTel = telHref(r.place_phone);
  const rows = [
    withPlace ? ['Local', `${esc(r.place_name)}${r.place_address ? `<br><small>${esc(r.place_address)}</small>` : ''}`] : null,
    withPlace ? ['Telefone do local', r.place_phone ? (placeTel ? `<a href="${placeTel}">${esc(r.place_phone)}</a>` : esc(r.place_phone)) : 'Não informado'] : null,
    ['Exame', esc(examName(r.exam_code))],
    ['Data preferida', esc(fmtDate(r.preferred_date) || r.preferred_date)],
    ['Período', esc(PERIODS[r.preferred_period] || r.preferred_period || '')],
    ['Paciente', esc(r.patient_name)],
    ['Telefone', `<span class="rq-contact">${tel ? `<a href="${tel}">${esc(fmtPhone(r.patient_phone))}</a>` : esc(r.patient_phone)}${wa ? ` <a href="${wa}" target="_blank" rel="noopener">WhatsApp<span class="sr"> de ${esc(r.patient_name)} (abre em nova aba)</span></a>` : ''}</span>`],
    r.patient_email ? ['E-mail', `<a href="mailto:${esc(r.patient_email)}">${esc(r.patient_email)}</a>`] : null,
    r.notes ? ['Observações', esc(r.notes)] : null,
  ].filter(Boolean);
  return `<li class="rq" id="rq-${esc(r.id)}">
      <div class="rq-hd"><div><h3>${esc(examName(r.exam_code))} · ${esc(r.patient_name)}</h3><small>Pedido em ${esc(fmtDateTime(r.created_at))}</small></div>
        <span class="rq-st st-${esc(r.status)}">${esc(statusLabel(r.status) || r.status)}</span></div>
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <div class="rq-act" role="group" aria-label="Mudar a situação do pedido de ${esc(r.patient_name)}">
        <span class="lbl">Mudar situação${r.status === 'completed' ? '' : ' · “Concluído” libera a avaliação do paciente'}:</span>
        ${ACTIONS.map((s) => `<button class="btn btn-ghost btn-sm" type="button" data-id="${esc(r.id)}" data-st="${s}" aria-pressed="${r.status === s}"${r.status === s ? ' disabled' : ''}>${esc(statusLabel(s))}</button>`).join('')}
      </div>
    </li>`;
}

// key: 'pedidos' ou 'concierge' (filtro e ids); cache: chave em state.lists (por clínica nos pedidos).
function renderRequestList(p, key, intro, withPlace, cache) {
  const rows = state.lists[cache] || [];
  const again = () => renderRequestList(p, key, intro, withPlace, cache);
  const f = state.filter[key];
  const shown = f ? rows.filter((r) => r.status === f) : rows;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
  p.innerHTML = `<p class="cl-help">${intro}</p>
    <div class="cl-filter"><label class="cl-lbl" for="flt-${key}" style="margin:0">Mostrar</label>
      <select id="flt-${key}"><option value="">Todos (${rows.length})</option>${STATUSES.map((s) => `<option value="${s}"${f === s ? ' selected' : ''}>${esc(statusLabel(s))} (${counts[s]})</option>`).join('')}</select>
      <button class="btn btn-ghost btn-sm" type="button" id="rf-${key}"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Atualizar lista</button></div>
    ${!rows.length ? '<p class="cl-help">Nenhum pedido ainda. Quando um paciente pedir agendamento, ele aparece aqui.</p>'
      : !shown.length ? '<p class="cl-help">Nenhum pedido com essa situação.</p>'
        : `<ul class="rq-list">${shown.map((r) => requestCard(r, withPlace)).join('')}</ul>`}
    <div id="rqMsg" aria-live="polite"></div>`;
  $(`#flt-${key}`).onchange = (e) => { state.filter[key] = e.target.value; again(); $(`#flt-${key}`).focus(); };
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
      const visible = (f ? rows.filter((x) => x.status === f) : rows).map((x) => x.id);
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
      const m = err.result === 'forbidden' ? 'Sua conta não pode mudar este pedido.' : err.result === 'not_found' ? 'Este pedido não existe mais.' : friendlyError(err, 'Não foi possível mudar a situação agora. Tente de novo.');
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
    const rows = (await auth.select(path)) || [];
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

function tabRequests(p) {
  const c = clinic();
  const intro = 'Pedidos de agendamento feitos pelos pacientes no IMED. Ligue ou chame no WhatsApp para combinar o horário e atualize a situação: o paciente acompanha pela conta dele.';
  loadList(p, 'pedidos', `appointment_requests?select=${REQ_COLS}&clinic_id=eq.${c.id}&order=created_at.desc&limit=100`, () => renderRequestList(p, 'pedidos', intro, false, `pedidos:${c.id}`));
}

function tabConcierge(p) {
  const intro = 'Pedidos feitos ao IMED para locais que ainda não são parceiros. A equipe liga para o local, combina com o paciente e atualiza a situação.';
  loadList(p, 'concierge', `appointment_requests?select=${IMED_COLS}&clinic_id=is.null&order=created_at.desc&limit=100`, () => renderRequestList(p, 'concierge', intro, true, 'concierge'));
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
      <div class="cl-field full"><label class="cl-check"><input id="dOnline" type="checkbox"${c.accepts_online_booking ? ' checked' : ''}><span><b>Aceito pedidos de agendamento pelo site.</b> Os pedidos aparecem na aba “Pedidos” e a clínica entra em contato com o paciente.</span></label></div>
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
      const rows = (await auth.select(`establishments?select=cnes,name,kind,address_line,neighborhood,cep,city_ibge&cnes=in.(${codes.join(',')})`)) || [];
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
  if (state.tab !== 'cadastros' || !p.isConnected) return;
  const placeOf = (r) => {
    const e = est[r.cnes];
    const m = e ? mun[e.city_ibge] : null;
    return { e, m, link: cnesFicha(m?.cnes_code, r.cnes) };
  };
  const card = (r) => {
    const { e, m, link } = placeOf(r);
    const tel = telHref(r.phone);
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
        <dt>CRM</dt><dd>${r.crm ? esc(r.crm) : 'Não informado'}</dd>
        <dt>Celular</dt><dd>${tel ? `<a href="${tel}">${esc(fmtPhone(r.phone))}</a>` : esc(r.phone)}</dd>
        <dt>E-mail</dt><dd>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : 'Não informado'}</dd>
        ${r.message ? `<dt>Mensagem</dt><dd>${esc(r.message)}</dd>` : ''}
      </dl>
      <div class="rq-act" role="group" aria-label="Decidir o pedido de ${esc(r.claimant_name)}">
        <button class="btn btn-primary btn-sm" type="button" data-approve="${esc(r.id)}">Aprovar</button>
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
  p.innerHTML = `<p class="cl-help">Confira os dados na ficha do CNES antes de aprovar. Ao aprovar, o estabelecimento vira clínica parceira e a pessoa passa a cuidar do cadastro.</p>
    <h3 style="font-size:16px;margin:4px 0 10px">Aguardando decisão (${pending.length})</h3>
    ${pending.length ? `<ul class="rq-list">${pending.map(card).join('')}</ul>` : '<p class="cl-help">Nenhum pedido aguardando.</p>'}
    <h3 style="font-size:16px;margin:22px 0 10px">Decididos recentemente</h3>
    ${decided.length ? `<ul class="cl-list">${decided.map((r) => `<li><span><b>${esc(est[r.cnes]?.name || `CNES ${r.cnes}`)}</b>
        <small>${esc(r.claimant_name)}${r.decided_at ? ` · ${esc(fmtDateTime(r.decided_at))}` : ''}</small>${r.decision_note ? `<small>Motivo: ${esc(r.decision_note)}</small>` : ''}</span>
        <span class="bd ${cls[r.status] || ''}">${esc(CLAIM_STATUS[r.status] || r.status)}</span></li>`).join('')}</ul>` : '<p class="cl-help">Nenhum ainda.</p>'}`;
  p.onclick = async (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    const msg = (id) => $(`[data-msg="${CSS.escape(id)}"]`, p);
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
          await auth.rpc('approve_claim', { p_claim: id });
          toast('Pedido aprovado. A clínica já aparece como parceira.');
        } else {
          const noteText = $(`#note-${CSS.escape(id)}`, p).value.trim().slice(0, 300);
          await auth.rpc('reject_claim', { p_claim: id, p_note: noteText || null });
          toast('Pedido recusado.');
        }
        tabClaims(p);
      } catch (err) {
        if (lost()) return;
        btns.forEach((b) => { b.disabled = false; });
        const dbMsg = err?.data?.code === '22023' ? err.data.message : '';
        msg(id).textContent = dbMsg || friendlyError(err, 'Não foi possível salvar a decisão agora. Tente de novo.');
        msg(id).classList.add('err');
      }
    }
  };
}

// ---------- início ----------
async function init() {
  const flash = await finishLogin();
  if (flash) $('#flash').innerHTML = note(esc(flash.text), flash.kind);
  renderAccount();
  if (auth.user()) loadAll();
}
init();
