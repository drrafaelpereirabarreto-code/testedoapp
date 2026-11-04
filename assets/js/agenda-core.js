// Regras puras do painel da agenda da clínica (iMed Agenda, fase 4.1: equipe e cadastros). Sem tela e sem rede:
// testadas em tests/agenda-core.test.mjs. A tela fica em agenda-config.js; o banco confere tudo de novo (estas regras
// só evitam ida e volta e explicam o erro em linguagem simples).
import { EXAMS } from './geo-core.js';

export const EXAM_CODES = ['rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab'];
export const examLabel = (code) => EXAMS[code]?.n || code || '';

// ---------- papéis e permissões ----------
export const ROLES = ['owner', 'manager', 'reception', 'professional', 'finance'];
export const ROLE_LABEL = {
  owner: 'Dono(a)', manager: 'Gestor(a)', reception: 'Recepção', professional: 'Profissional', finance: 'Financeiro', staff: 'Recepção',
};
export const ROLE_HELP = {
  owner: 'Faz tudo, inclusive mudar a equipe inteira e a integração com outro sistema.',
  manager: 'Faz tudo na clínica, menos mexer em quem é dono(a) e na integração.',
  reception: 'Vê os pedidos e cuida dos agendamentos e bloqueios. Não muda preços nem a configuração.',
  professional: 'Vê só a própria agenda, sem o telefone dos pacientes.',
  finance: 'Vê só os números do financeiro, sem o nome dos pacientes.',
};
// Espelho de agenda.role_permissions (migração da fundação, parte 5). Só serve quando o banco ainda não responde
// agenda_me (troca de versão): o que vale é sempre a lista que o banco devolve.
const ALL = ['pedidos.ver', 'agenda.ver', 'agenda.pacientes', 'agenda.marcar', 'agenda.cancelar', 'agenda.remarcar', 'agenda.atender',
  'agenda.bloquear', 'agenda.configurar', 'precos.editar', 'clinica.editar', 'financeiro.ver', 'auditoria.ver', 'conflitos.resolver'];
const RECEPCAO = ['pedidos.ver', 'agenda.ver', 'agenda.pacientes', 'agenda.marcar', 'agenda.cancelar', 'agenda.remarcar', 'agenda.atender',
  'agenda.bloquear', 'conflitos.resolver'];
const scope = (list, s = 'clinica') => Object.fromEntries(list.map((p) => [p, s]));
export const ROLE_PERMS = {
  owner: { ...scope(ALL), 'equipe.gerenciar': 'clinica', 'integracao.gerenciar': 'clinica' },
  manager: { ...scope(ALL), 'equipe.gerenciar': 'sem_donos' },
  reception: scope(RECEPCAO),
  staff: scope(RECEPCAO),
  professional: scope(['agenda.ver', 'agenda.pacientes', 'agenda.atender'], 'propria'),
  finance: scope(['financeiro.ver']),
};
export const permsOf = (role) => ({ ...(ROLE_PERMS[role] || {}) });
export const can = (perms, p) => !!perms && Object.prototype.hasOwnProperty.call(perms, p);

// Abas da clínica pelo que a pessoa pode fazer. A equipe do IMED (admin) vê todas.
export const TAB_LABEL = { pedidos: 'Pedidos', agenda: 'Agenda', dados: 'Dados da clínica', exames: 'Exames e preços', equipe: 'Equipe' };
export function clinicTabs(perms, admin = false) {
  const p = admin ? { ...ROLE_PERMS.owner } : perms || {};
  const t = [];
  if (can(p, 'pedidos.ver')) t.push('pedidos');
  if (can(p, 'agenda.configurar') || can(p, 'agenda.bloquear')) t.push('agenda');
  if (can(p, 'clinica.editar')) t.push('dados');
  if (can(p, 'precos.editar')) t.push('exames');
  if (can(p, 'equipe.gerenciar')) t.push('equipe');
  return t;
}

// Quem pode convidar ou mudar para este papel: o dono, todos; o gestor, todos menos dono (o banco confere de novo).
export const rolesICanGive = (perms, admin = false) => {
  if (admin) return [...ROLES];
  const s = perms?.['equipe.gerenciar'];
  return s === 'clinica' ? [...ROLES] : s === 'sem_donos' ? ROLES.filter((r) => r !== 'owner') : [];
};
export const canManageMember = (perms, admin, memberRole) => rolesICanGive(perms, admin).includes(memberRole === 'staff' ? 'reception' : memberRole);

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function inviteErrors(email, role, allowed = ROLES) {
  const e = {};
  const v = String(email || '').trim().toLowerCase();
  if (v.length < 6 || v.length > 254 || !EMAIL_RE.test(v)) e.email = 'Digite um e-mail válido, como nome@clinica.com.br.';
  if (!ROLES.includes(role)) e.role = 'Escolha o papel da pessoa.';
  else if (!allowed.includes(role)) e.role = 'Sua conta não pode dar este papel.';
  return e;
}

// ---------- modalidade ----------
export const MODES = ['pedido', 'nativa', 'manual', 'externa'];
export const MODE_LABEL = {
  pedido: 'Pedido (a clínica liga para combinar)',
  nativa: 'Agenda no IMED',
  manual: 'Agenda no IMED, com registro manual',
  externa: 'Sistema da própria clínica',
};
export const MODE_HELP = {
  pedido: 'O paciente envia um pedido e a clínica (ou o IMED) liga para combinar o horário. É o jeito de hoje.',
  nativa: 'A agenda da clínica fica no IMED: tudo o que for marcado, por telefone, balcão ou site, entra aqui.',
  manual: 'A clínica usa outro caderno ou sistema, mas registra cada agendamento no IMED antes de confirmar ao paciente.',
  externa: 'Ligação com o sistema de agenda da clínica. Ainda não disponível: depende de cada sistema.',
};
export const COMMITMENT_TEXT = 'Nós nos comprometemos a registrar no painel do IMED todo agendamento feito por telefone, balcão ou outro sistema, antes de confirmar ao paciente.';

// ---------- fuso ----------
export const TIMEZONES = [
  ['America/Sao_Paulo', 'Horário de Brasília (SP, RJ, MG, ES, PR, SC, RS, GO, DF)'],
  ['America/Bahia', 'Horário de Brasília (Bahia)'],
  ['America/Fortaleza', 'Horário de Brasília (CE, RN, PB, PI, MA)'],
  ['America/Recife', 'Horário de Brasília (Pernambuco)'],
  ['America/Maceio', 'Horário de Brasília (Alagoas e Sergipe)'],
  ['America/Belem', 'Horário de Brasília (Pará leste e Amapá)'],
  ['America/Araguaina', 'Horário de Brasília (Tocantins)'],
  ['America/Santarem', 'Horário de Brasília (Pará oeste)'],
  ['America/Cuiaba', 'Uma hora a menos que Brasília (Mato Grosso)'],
  ['America/Campo_Grande', 'Uma hora a menos que Brasília (Mato Grosso do Sul)'],
  ['America/Manaus', 'Uma hora a menos que Brasília (Amazonas)'],
  ['America/Porto_Velho', 'Uma hora a menos que Brasília (Rondônia)'],
  ['America/Boa_Vista', 'Uma hora a menos que Brasília (Roraima)'],
  ['America/Rio_Branco', 'Duas horas a menos que Brasília (Acre)'],
  ['America/Eirunepe', 'Duas horas a menos que Brasília (oeste do Amazonas)'],
  ['America/Noronha', 'Uma hora a mais que Brasília (Fernando de Noronha)'],
];
export const tzLabel = (tz) => TIMEZONES.find(([k]) => k === tz)?.[1] || tz || '';

// ---------- números e textos ----------
export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const toMin = (t) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(t || ''));
  if (!m) return NaN;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return NaN;
  return h * 60 + mi;
};
export const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export function fmtMinutes(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  if (v < 60) return `${v} min`;
  const h = Math.floor(v / 60); const m = v % 60;
  if (v % 1440 === 0) return `${v / 1440} ${v === 1440 ? 'dia' : 'dias'}`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
export const KIND_LABEL = { equipamento: 'Aparelho', sala: 'Sala', profissional: 'Profissional', chegadas: 'Vagas por horário' };
export const KIND_PLURAL = { equipamento: 'aparelhos', sala: 'salas', profissional: 'profissionais', chegadas: 'vagas por horário' };
export const KINDS = ['equipamento', 'sala', 'profissional'];
export const COUNCILS = ['CRM', 'CRBM', 'CRF', 'CRBio', 'CRO', 'COREN', 'CRTR', 'outro'];

// Inteiro dentro dos limites (ou null quando vazio e opcional).
export function intIn(v, min, max, { mult = 1, optional = false } = {}) {
  const s = String(v ?? '').trim();
  if (!s) return optional ? { ok: true, value: null } : { ok: false };
  if (!/^\d+$/.test(s)) return { ok: false };
  const n = Number(s);
  return n >= min && n <= max && n % mult === 0 ? { ok: true, value: n } : { ok: false };
}

// ---------- configuração rápida ----------
// input: { timezone, confirmTz, days: [0..6], open, close, pauseFrom, pauseTo, exams: [{ exam_code, name, duration, count, kind }] }
// Cada exame: "quantos aparelhos (ou salas) e quanto dura". Cria recursos e procedimentos de verdade.
export function quickErrors(input) {
  const e = {};
  if (!TIMEZONES.some(([k]) => k === input.timezone)) e.timezone = 'Escolha o fuso da clínica.';
  if (!input.confirmTz) e.confirmTz = 'Confirme o fuso: os horários dos pacientes dependem dele.';
  if (!Array.isArray(input.days) || !input.days.length) e.days = 'Marque pelo menos um dia de atendimento.';
  const o = toMin(input.open); const c = toMin(input.close);
  if (Number.isNaN(o)) e.open = 'Escolha a hora em que a clínica abre.';
  else if (o % 5) e.open = 'Use horários de 5 em 5 minutos.';
  if (Number.isNaN(c)) e.close = 'Escolha a hora em que a clínica fecha.';
  else if (c % 5) e.close = 'Use horários de 5 em 5 minutos.';
  else if (!e.open && c <= o) e.close = 'A hora de fechar precisa ser depois da hora de abrir.';
  const pf = String(input.pauseFrom || ''); const pt = String(input.pauseTo || '');
  if (pf || pt) {
    const a = toMin(pf); const b = toMin(pt);
    if (Number.isNaN(a) || Number.isNaN(b)) e.pause = 'Preencha o começo e o fim da pausa, ou deixe os dois em branco.';
    else if (a % 5 || b % 5) e.pause = 'Use horários de 5 em 5 minutos.';
    else if (b <= a) e.pause = 'O fim da pausa precisa ser depois do começo.';
    else if (!e.open && !e.close && (a <= o || b >= c)) e.pause = 'A pausa precisa ficar dentro do horário de atendimento.';
  }
  const ex = Array.isArray(input.exams) ? input.exams : [];
  if (!ex.length) e.exams = 'Inclua pelo menos um exame.';
  const names = new Set();
  ex.forEach((x, i) => {
    const k = `ex${i}`;
    const name = String(x.name || '').trim();
    if (!EXAM_CODES.includes(x.exam_code)) e[`${k}code`] = 'Escolha o tipo de exame.';
    if (name.length < 2 || name.length > 120) e[`${k}name`] = 'Dê um nome ao exame (de 2 a 120 letras).';
    else if (names.has(name.toLowerCase())) e[`${k}name`] = 'Já existe um exame com este nome. Use nomes diferentes.';
    names.add(name.toLowerCase());
    if (!intIn(x.duration, 5, 480, { mult: 5 }).ok) e[`${k}dur`] = 'Informe quanto dura o exame, de 5 a 480 minutos, de 5 em 5.';
    if (!intIn(x.count, 1, 20).ok) e[`${k}count`] = 'Informe quantos (de 1 a 20).';
    if (!['equipamento', 'sala', 'profissional'].includes(x.kind)) e[`${k}kind`] = 'Escolha se o exame usa aparelho, sala ou profissional.';
  });
  return e;
}

// O plano que a tela manda ao banco, na ordem: unidade, recursos, procedimentos (com os recursos criados) e regras.
export function quickPlan(input) {
  const resources = [];
  const procedures = [];
  input.exams.forEach((x, i) => {
    const n = Number(x.count);
    const base = String(x.name).trim();
    const keys = [];
    for (let j = 1; j <= n; j++) {
      const key = `e${i}r${j}`;
      const label = `${KIND_LABEL[x.kind]} de ${base}`.slice(0, 76);
      resources.push({ key, kind: x.kind, name: n > 1 ? `${label} ${j}` : label });
      keys.push(key);
    }
    procedures.push({ exam_code: x.exam_code, name: base, duration_min: Number(x.duration), kind: x.kind, resourceKeys: keys });
  });
  const days = [...new Set(input.days.map(Number))].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  const rules = days.map((weekday) => ({ weekday, start: input.open, end: input.close, kind: 'abre' }));
  if (input.pauseFrom && input.pauseTo) days.forEach((weekday) => rules.push({ weekday, start: input.pauseFrom, end: input.pauseTo, kind: 'pausa', label: 'Pausa' }));
  return { unit: { timezone: input.timezone, confirm_timezone: true }, resources, procedures, rules };
}

// Requisito do procedimento com os ids dos recursos criados.
export const requirementFor = (kind, ids) => [{ resource_kind: kind, options: ids.map((resource_id) => ({ resource_id })) }];

// ---------- horários de funcionamento (regras da unidade) ----------
// Semana na tela: { [weekday]: { open: [{start,end}], pause: [{start,end,label}] } }. Regras com validade ou só para
// alguns exames (feitas por outro caminho) ficam guardadas em "keep" e voltam iguais ao salvar.
export function weekFromRules(rules) {
  const week = Object.fromEntries(WEEK_ORDER.map((d) => [d, { open: [], pause: [] }]));
  const keep = [];
  for (const r of rules || []) {
    if (r.resource_id) continue;
    const special = r.valid_from || r.valid_to || (Array.isArray(r.procedure_ids) && r.procedure_ids.length);
    if (special || !week[r.weekday]) { keep.push(r); continue; }
    week[r.weekday][r.kind === 'pausa' ? 'pause' : 'open'].push({ start: r.start, end: r.end, ...(r.kind === 'pausa' ? { label: r.label || '' } : {}) });
  }
  for (const d of WEEK_ORDER) for (const k of ['open', 'pause']) week[d][k].sort((a, b) => toMin(a.start) - toMin(b.start));
  return { week, keep };
}

export function weekErrors(week) {
  const e = {};
  let total = 0;
  for (const d of WEEK_ORDER) {
    for (const k of ['open', 'pause']) {
      const list = week[d]?.[k] || [];
      total += list.length;
      list.forEach((x, i) => {
        const s = toMin(x.start); const f = toMin(x.end);
        const key = `${d}-${k}-${i}`;
        if (Number.isNaN(s) || Number.isNaN(f)) e[key] = 'Preencha o começo e o fim.';
        else if (s % 5 || f % 5) e[key] = 'Use horários de 5 em 5 minutos.';
        else if (f <= s) e[key] = 'O fim precisa ser depois do começo.';
        else {
          const j = list.findIndex((y, n) => n < i && toMin(y.start) < f && s < toMin(y.end));
          if (j >= 0) e[key] = `Cruza com ${list[j].start} às ${list[j].end}. Junte os dois ou mude o horário.`;
        }
      });
    }
    if ((week[d]?.pause || []).length && !(week[d]?.open || []).length) e[`${d}-pause-0`] ||= 'Pausa num dia sem horário de atendimento.';
  }
  if (total > 200) e._all = 'Use até 200 linhas de horário.';
  return e;
}

export function rulesFromWeek(week, keep = []) {
  const out = [];
  for (const d of [0, 1, 2, 3, 4, 5, 6]) {
    for (const x of week[d]?.open || []) out.push({ weekday: d, start: x.start, end: x.end, kind: 'abre' });
    for (const x of week[d]?.pause || []) out.push({ weekday: d, start: x.start, end: x.end, kind: 'pausa', ...(String(x.label || '').trim() ? { label: String(x.label).trim().slice(0, 60) } : {}) });
  }
  for (const r of keep) {
    const o = { weekday: r.weekday, start: r.start, end: r.end, kind: r.kind };
    if (r.valid_from) o.valid_from = r.valid_from;
    if (r.valid_to) o.valid_to = r.valid_to;
    if (r.label) o.label = r.label;
    if (r.procedure_ids?.length) o.procedure_ids = r.procedure_ids;
    out.push(o);
  }
  return out;
}

export const copyMonday = (week) => {
  const w = structuredClone(week);
  for (const d of [2, 3, 4, 5]) w[d] = structuredClone(week[1]);
  return w;
};

export function weekSummary(week) {
  const parts = [];
  for (const d of WEEK_ORDER) {
    const o = week[d]?.open || [];
    if (!o.length) continue;
    parts.push(`${WEEKDAYS[d]}: ${o.map((x) => `${x.start} às ${x.end}`).join(' e ')}`);
  }
  return parts.length ? parts.join('; ') : 'Nenhum horário de atendimento';
}

// ---------- recursos e procedimentos ----------
export function resourceErrors(r, { isNew = true } = {}) {
  const e = {};
  const name = String(r.name || '').trim();
  if (isNew && !KINDS.includes(r.kind)) e.kind = 'Escolha o tipo.';
  if (name.length < 2 || name.length > 80) e.name = 'Dê um nome (de 2 a 80 letras), como “Ultrassom da sala 2”.';
  if (!intIn(r.capacity, 1, 50).ok) e.capacity = 'De 1 a 50 pacientes ao mesmo tempo.';
  if (!intIn(r.setup_min, 0, 240, { mult: 5 }).ok) e.setup_min = 'De 0 a 240 minutos, de 5 em 5.';
  if (!intIn(r.cleanup_min, 0, 240, { mult: 5 }).ok) e.cleanup_min = 'De 0 a 240 minutos, de 5 em 5.';
  if (r.council_number && String(r.council_number).trim().length > 20) e.council_number = 'Até 20 caracteres.';
  return e;
}
export function resourcePayload(r, { isNew = true } = {}) {
  const o = {
    name: String(r.name).trim(), capacity: Number(r.capacity), setup_min: Number(r.setup_min || 0), cleanup_min: Number(r.cleanup_min || 0),
    active: r.active !== false,
  };
  if (isNew) o.kind = r.kind; else o.id = r.id;
  if (r.kind === 'profissional' || r.member_user_id || r.council) {
    o.member_user_id = r.member_user_id || null;
    o.council = r.council || null;
    o.council_number = String(r.council_number || '').trim() || null;
  }
  return o;
}

// Preço digitado ("350,00", "R$ 1.200") → centavos (null = sob consulta; NaN = inválido).
export function priceCents(v) {
  const s = String(v ?? '').replace(/R\$|\s/g, '');
  if (!s) return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return NaN;
  const n = Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100);
  return n >= 100 && n <= 10000000 ? n : NaN;
}
export const centsText = (c) => (c == null ? 'sob consulta' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100));

// groups: [{ resource_kind, options: [resource_id] }]
export function procedureErrors(p, resources = []) {
  const e = {};
  const name = String(p.name || '').trim();
  if (!EXAM_CODES.includes(p.exam_code)) e.exam_code = 'Escolha o tipo de exame.';
  if (name.length < 2 || name.length > 120) e.name = 'Dê um nome ao exame (de 2 a 120 letras).';
  if (!intIn(p.duration_min, 5, 480, { mult: 5 }).ok) e.duration_min = 'Informe quanto dura, de 5 a 480 minutos, de 5 em 5.';
  const price = priceCents(p.price);
  if (Number.isNaN(price)) e.price = 'Preço inválido. Use só números, como 180,00, ou deixe em branco para “sob consulta”.';
  if (!intIn(p.fasting_hours, 0, 24, { optional: true }).ok) e.fasting_hours = 'De 0 a 24 horas, ou em branco.';
  if (String(p.patient_prep_text || '').length > 600) e.patient_prep_text = 'Use até 600 letras.';
  const groups = Array.isArray(p.groups) ? p.groups : [];
  if (!groups.length) e.groups = 'Escolha o que o exame usa (aparelho, sala ou profissional).';
  if (groups.length > 5) e.groups = 'Use até 5 grupos.';
  const used = new Set();
  groups.forEach((g, i) => {
    const ok = (g.options || []).filter((id) => resources.some((r) => r.id === id && r.kind === g.resource_kind));
    if (!ok.length) e[`g${i}`] = `Marque pelo menos um ${KIND_LABEL[g.resource_kind]?.toLowerCase() || 'item'} deste grupo.`;
    for (const id of g.options || []) { if (used.has(id)) e[`g${i}`] = 'O mesmo item não pode estar em dois grupos.'; used.add(id); }
  });
  return e;
}
export function procedurePayload(p, { isNew = true, priceConfirmed = false } = {}) {
  const o = {
    exam_code: p.exam_code, name: String(p.name).trim(), duration_min: Number(p.duration_min), price_cents: priceCents(p.price),
    patient_prep_text: String(p.patient_prep_text || '').trim() || null,
    fasting_hours: String(p.fasting_hours ?? '').trim() === '' ? null : Number(p.fasting_hours),
    online_booking: p.online_booking !== false, active: p.active !== false,
    requirements: (p.groups || []).map((g) => ({ resource_kind: g.resource_kind, options: g.options.map((resource_id) => ({ resource_id })) })),
  };
  if (!isNew) o.id = p.id;
  if (priceConfirmed && o.price_cents != null) o.price_confirmed = true;
  return o;
}
// Preço acima do limite largo do exame (o mesmo do painel antigo, L11): pede confirmação antes de salvar.
export const PRICE_CHECK_CENTS = { rx: 500000, usg: 500000, tc: 1000000, rm: 2000000, mamo: 500000, dens: 500000, ecg: 500000, eco: 500000, lab: 500000 };
export const priceNeedsCheck = (code, cents) => Number.isFinite(cents) && cents > (PRICE_CHECK_CENTS[code] ?? Infinity);

// ---------- unidade ----------
export const STEP_OPTIONS = [5, 10, 15, 20, 30, 60];
export function unitErrors(u) {
  const e = {};
  if (!STEP_OPTIONS.includes(Number(u.step_min))) e.step_min = 'Escolha de quanto em quanto tempo os horários começam.';
  if (!intIn(u.min_notice_h, 0, 168).ok) e.min_notice_h = 'De 0 a 168 horas.';
  if (!intIn(u.max_advance_days, 1, 365).ok) e.max_advance_days = 'De 1 a 365 dias.';
  if (u.holidays_checked_until && !/^\d{4}-\d{2}-\d{2}$/.test(u.holidays_checked_until)) e.holidays_checked_until = 'Data inválida.';
  return e;
}
export const unitPayload = (u) => ({
  step_min: Number(u.step_min), min_notice_min: Number(u.min_notice_h) * 60, max_advance_days: Number(u.max_advance_days),
  holidays_checked_until: u.holidays_checked_until || null, closes_on_holidays: !!u.closes_on_holidays,
});

// ---------- respostas do banco em linguagem simples ----------
export const STATUS_TEXT = {
  forbidden: 'Sua conta não pode fazer isto nesta clínica.',
  not_found: 'Não encontramos este item. Atualize a página.',
  invalid: 'Algum dado não está no formato aceito. Confira os campos.',
  agenda_not_started: 'A agenda desta clínica ainda não foi ativada. Use a configuração rápida primeiro.',
  old_schedule_exists: 'Esta clínica ainda tem horários do editor antigo. Fale com o IMED para apagá-los antes de ativar a agenda nova.',
  online_active: 'Com a marcação pelo site ligada, isto não pode mudar. Fale com o IMED.',
  has_appointments: 'Há pacientes marcados que dependem disto. Remarque ou cancele esses agendamentos antes.',
  duplicate_name: 'Já existe um item com este nome. Use outro nome.',
  default_exists: 'Já existe um exame padrão deste tipo.',
  resource_in_two_groups: 'O mesmo item não pode estar em dois grupos do exame.',
  invalid_option: 'Algum item escolhido não serve para este grupo. Confira o tipo.',
  invalid_period: 'O período não é válido: confira o começo e o fim.',
  overlapping_rules: 'Dois horários do mesmo dia se cruzam. Junte os dois ou mude o horário.',
  invalid_reference: 'Algum item escolhido não existe mais. Atualize a página.',
  timezone_not_confirmed: 'Confirme o fuso da clínica antes de mudar a modalidade.',
  commitment_required: 'Para a modalidade com registro manual, marque o compromisso.',
  invalid_role: 'Escolha um papel válido.',
  invalid_email: 'Digite um e-mail válido.',
  already_member: 'Esta pessoa já faz parte da equipe.',
  last_owner: 'A clínica precisa ter pelo menos um(a) dono(a). Faça outra pessoa dona antes.',
  not_open: 'Este convite não está mais aberto.',
  expired: 'Este convite venceu. Peça um novo para a clínica.',
};
export const statusText = (s, fallback = 'Não foi possível salvar agora. Tente de novo em instantes.') => STATUS_TEXT[s] || fallback;
export const affectsText = (items) => {
  const n = Array.isArray(items) ? items.length : 0;
  return n === 1 ? '1 agendamento futuro deixaria de caber nesta mudança.' : `${n} agendamentos futuros deixariam de caber nesta mudança.`;
};
