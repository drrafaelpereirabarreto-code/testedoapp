// Regras puras do painel da agenda (assets/js/agenda-core.js; iMed Agenda, fase 4.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as A from '../assets/js/agenda-core.js';

const ler = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('papéis: permissões espelham agenda.role_permissions da migração', () => {
  const sql = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => /agenda_base_parte_5/.test(f)).map((f) => ler(`supabase/migrations/${f}`)).join('\n');
  const linhas = [...sql.matchAll(/\('(owner|manager|reception|staff|professional|finance)', '([a-z.]+)', '([a-z_]+)'\)/g)];
  assert.ok(linhas.length > 40);
  const doBanco = {};
  for (const [, r, p, s] of linhas) (doBanco[r] ||= {})[p] = s;
  for (const r of Object.keys(doBanco)) assert.deepEqual(A.permsOf(r), doBanco[r], `papel ${r}`);
  assert.deepEqual(A.permsOf('desconhecido'), {});
});

test('abas por permissão', () => {
  assert.deepEqual(A.clinicTabs(A.permsOf('owner')), ['pedidos', 'agenda', 'dados', 'exames', 'equipe']);
  assert.deepEqual(A.clinicTabs(A.permsOf('manager')), ['pedidos', 'agenda', 'dados', 'exames', 'equipe']);
  assert.deepEqual(A.clinicTabs(A.permsOf('reception')), ['pedidos', 'agenda']);
  assert.deepEqual(A.clinicTabs(A.permsOf('staff')), ['pedidos', 'agenda']);
  assert.deepEqual(A.clinicTabs(A.permsOf('professional')), []);
  assert.deepEqual(A.clinicTabs(A.permsOf('finance')), []);
  assert.deepEqual(A.clinicTabs(undefined, true), ['pedidos', 'agenda', 'dados', 'exames', 'equipe'], 'equipe do IMED vê tudo');
  assert.deepEqual(A.clinicTabs(undefined), []);
});

test('quem pode dar cada papel', () => {
  assert.deepEqual(A.rolesICanGive(A.permsOf('owner')), A.ROLES);
  assert.deepEqual(A.rolesICanGive(A.permsOf('manager')), ['manager', 'reception', 'professional', 'finance']);
  assert.deepEqual(A.rolesICanGive(A.permsOf('reception')), []);
  assert.deepEqual(A.rolesICanGive({}, true), A.ROLES);
  assert.equal(A.canManageMember(A.permsOf('manager'), false, 'owner'), false, 'o gestor não mexe em dono');
  assert.equal(A.canManageMember(A.permsOf('manager'), false, 'staff'), true, 'staff antigo = recepção');
});

test('convite: e-mail e papel', () => {
  assert.deepEqual(A.inviteErrors('nome@clinica.test', 'reception'), {});
  assert.match(A.inviteErrors('sem-arroba', 'reception').email, /e-mail válido/);
  assert.match(A.inviteErrors('a@b.c', 'reception').email, /e-mail válido/, 'menos de 6 letras');
  assert.match(A.inviteErrors('nome@clinica.test', '').role, /Escolha/);
  assert.match(A.inviteErrors('nome@clinica.test', 'owner', ['reception']).role, /não pode dar/);
});

test('fusos: os mesmos do CHECK de clinics.timezone', () => {
  const sql = ler(`supabase/migrations/${readdirSync(new URL('../supabase/migrations/', import.meta.url)).find((f) => /agenda_base_parte_1/.test(f))}`);
  const lista = sql.match(/clinics_timezone_ck check \(timezone in \(([\s\S]*?)\)\)/)[1].match(/'[^']+'/g).map((x) => x.slice(1, -1)).sort();
  assert.deepEqual(A.TIMEZONES.map(([k]) => k).sort(), lista);
  assert.match(A.tzLabel('America/Manaus'), /Uma hora a menos/);
  assert.equal(A.tzLabel('Europe/Lisbon'), 'Europe/Lisbon');
});

test('horas e minutos', () => {
  assert.equal(A.toMin('07:30'), 450);
  assert.equal(A.toMin('24:00'), 1440);
  assert.ok(Number.isNaN(A.toMin('24:05')));
  assert.ok(Number.isNaN(A.toMin('7:30')));
  assert.equal(A.fromMin(450), '07:30');
  assert.equal(A.fmtMinutes(20), '20 min');
  assert.equal(A.fmtMinutes(90), '1 h 30 min');
  assert.equal(A.fmtMinutes(120), '2 h');
  assert.equal(A.fmtMinutes(2880), '2 dias');
  assert.deepEqual(A.intIn('15', 5, 480, { mult: 5 }), { ok: true, value: 15 });
  assert.equal(A.intIn('17', 5, 480, { mult: 5 }).ok, false);
  assert.equal(A.intIn('', 0, 24).ok, false);
  assert.deepEqual(A.intIn('', 0, 24, { optional: true }), { ok: true, value: null });
  assert.equal(A.intIn('1.5', 0, 24).ok, false);
});

const QUICK = () => ({ timezone: 'America/Sao_Paulo', confirmTz: true, days: [1, 2, 3, 4, 5], open: '07:00', close: '18:00', pauseFrom: '12:00', pauseTo: '13:00',
  exams: [{ exam_code: 'usg', name: 'Ultrassom', kind: 'equipamento', count: '2', duration: '20' }, { exam_code: 'rx', name: 'Raio-X', kind: 'sala', count: '1', duration: '15' }] });

test('configuração rápida: erros', () => {
  assert.deepEqual(A.quickErrors(QUICK()), {});
  const e = A.quickErrors({ timezone: 'UTC', confirmTz: false, days: [], open: '', close: '', pauseFrom: '12:00', pauseTo: '', exams: [] });
  assert.deepEqual(Object.keys(e).sort(), ['close', 'confirmTz', 'days', 'exams', 'open', 'pause', 'timezone']);
  assert.match(A.quickErrors({ ...QUICK(), close: '06:00' }).close, /depois da hora de abrir/);
  assert.match(A.quickErrors({ ...QUICK(), open: '07:03' }).open, /5 em 5/);
  assert.match(A.quickErrors({ ...QUICK(), pauseFrom: '06:00', pauseTo: '07:30' }).pause, /dentro do horário/);
  assert.match(A.quickErrors({ ...QUICK(), pauseTo: '11:00' }).pause, /depois do começo/);
  const ex = QUICK();
  ex.exams[1] = { exam_code: '', name: 'ultrassom', kind: 'x', count: '0', duration: '7' };
  const e2 = A.quickErrors(ex);
  assert.match(e2.ex1code, /tipo de exame/);
  assert.match(e2.ex1name, /Já existe um exame com este nome/);
  assert.match(e2.ex1kind, /aparelho, sala ou profissional/);
  assert.match(e2.ex1count, /de 1 a 20/);
  assert.match(e2.ex1dur, /de 5 em 5/);
});

test('configuração rápida: plano (recursos, procedimentos e regras)', () => {
  const p = A.quickPlan(QUICK());
  assert.deepEqual(p.unit, { timezone: 'America/Sao_Paulo', confirm_timezone: true });
  assert.deepEqual(p.resources, [
    { key: 'e0r1', kind: 'equipamento', name: 'Aparelho de Ultrassom 1' }, { key: 'e0r2', kind: 'equipamento', name: 'Aparelho de Ultrassom 2' },
    { key: 'e1r1', kind: 'sala', name: 'Sala de Raio-X' }]);
  assert.deepEqual(p.procedures, [{ exam_code: 'usg', name: 'Ultrassom', duration_min: 20, kind: 'equipamento', resourceKeys: ['e0r1', 'e0r2'] },
    { exam_code: 'rx', name: 'Raio-X', duration_min: 15, kind: 'sala', resourceKeys: ['e1r1'] }]);
  assert.equal(p.rules.length, 10);
  assert.deepEqual(p.rules[0], { weekday: 1, start: '07:00', end: '18:00', kind: 'abre' });
  assert.deepEqual(p.rules[9], { weekday: 5, start: '12:00', end: '13:00', kind: 'pausa', label: 'Pausa' });
  assert.equal(A.quickPlan({ ...QUICK(), pauseFrom: '', pauseTo: '' }).rules.length, 5);
  assert.deepEqual(A.requirementFor('sala', ['a', 'b']), [{ resource_kind: 'sala', options: [{ resource_id: 'a' }, { resource_id: 'b' }] }]);
  // nomes dentro do limite do banco (2 a 80)
  const longo = A.quickPlan({ ...QUICK(), exams: [{ exam_code: 'rm', name: 'R'.repeat(120), kind: 'equipamento', count: '12', duration: '30' }] });
  for (const r of longo.resources) assert.ok(r.name.length <= 80, r.name);
});

test('semana: das regras para a tela e de volta, com as especiais guardadas', () => {
  const rules = [
    { resource_id: null, weekday: 1, start: '13:00', end: '18:00', kind: 'abre', valid_from: null, valid_to: null, label: null, procedure_ids: [] },
    { resource_id: null, weekday: 1, start: '08:00', end: '12:00', kind: 'abre', valid_from: null, valid_to: null, label: null, procedure_ids: [] },
    { resource_id: null, weekday: 1, start: '10:00', end: '10:15', kind: 'pausa', valid_from: null, valid_to: null, label: 'Café', procedure_ids: [] },
    { resource_id: null, weekday: 6, start: '08:00', end: '12:00', kind: 'abre', valid_from: '2026-12-01', valid_to: null, label: null, procedure_ids: [] },
    { resource_id: 'r1', weekday: 2, start: '08:00', end: '09:00', kind: 'abre', valid_from: null, valid_to: null, label: null, procedure_ids: [] },
  ];
  const { week, keep } = A.weekFromRules(rules);
  assert.deepEqual(week[1].open, [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '18:00' }]);
  assert.deepEqual(week[1].pause, [{ start: '10:00', end: '10:15', label: 'Café' }]);
  assert.equal(keep.length, 1, 'a regra com validade fica guardada; a do recurso não é da unidade');
  const back = A.rulesFromWeek(week, keep);
  assert.deepEqual(back, [
    { weekday: 1, start: '08:00', end: '12:00', kind: 'abre' }, { weekday: 1, start: '13:00', end: '18:00', kind: 'abre' },
    { weekday: 1, start: '10:00', end: '10:15', kind: 'pausa', label: 'Café' },
    { weekday: 6, start: '08:00', end: '12:00', kind: 'abre', valid_from: '2026-12-01' }]);
  assert.equal(A.weekSummary(week), 'Segunda: 08:00 às 12:00 e 13:00 às 18:00');
  assert.equal(A.weekSummary(A.weekFromRules([]).week), 'Nenhum horário de atendimento');
  const c = A.copyMonday(week);
  for (const d of [2, 3, 4, 5]) assert.deepEqual(c[d], week[1]);
  assert.deepEqual(c[0], week[0]);
  c[2].open.push({ start: '19:00', end: '20:00' });
  assert.equal(c[3].open.length, 2, 'cópias independentes');
});

test('semana: erros de horário', () => {
  const { week } = A.weekFromRules([]);
  week[1].open = [{ start: '08:00', end: '12:00' }, { start: '11:00', end: '14:00' }, { start: '', end: '' }, { start: '15:00', end: '14:00' }, { start: '16:02', end: '17:00' }];
  week[2].pause = [{ start: '10:00', end: '10:30' }];
  const e = A.weekErrors(week);
  assert.match(e['1-open-1'], /Cruza com 08:00 às 12:00/);
  assert.match(e['1-open-2'], /Preencha/);
  assert.match(e['1-open-3'], /depois do começo/);
  assert.match(e['1-open-4'], /5 em 5/);
  assert.match(e['2-pause-0'], /dia sem horário/);
  assert.equal(e['1-open-0'], undefined);
});

test('recurso: erros e o que vai ao banco', () => {
  assert.deepEqual(A.resourceErrors({ kind: 'sala', name: 'Sala 1', capacity: '1', setup_min: '0', cleanup_min: '10' }), {});
  const e = A.resourceErrors({ kind: 'x', name: 'S', capacity: '0', setup_min: '3', cleanup_min: '300', council_number: '1'.repeat(21) });
  assert.deepEqual(Object.keys(e).sort(), ['capacity', 'cleanup_min', 'council_number', 'kind', 'name', 'setup_min']);
  assert.equal(A.resourceErrors({ name: 'Sala 1', capacity: '1', setup_min: '0', cleanup_min: '0' }, { isNew: false }).kind, undefined);
  assert.deepEqual(A.resourcePayload({ kind: 'sala', name: ' Sala 1 ', capacity: '2', setup_min: '5', cleanup_min: '' }),
    { name: 'Sala 1', capacity: 2, setup_min: 5, cleanup_min: 0, active: true, kind: 'sala' });
  assert.deepEqual(A.resourcePayload({ id: 'r1', kind: 'profissional', name: 'Dra. Teste', capacity: '1', setup_min: '0', cleanup_min: '0', council: 'CRM', council_number: ' 12 ', active: false }, { isNew: false }),
    { name: 'Dra. Teste', capacity: 1, setup_min: 0, cleanup_min: 0, active: false, id: 'r1', member_user_id: null, council: 'CRM', council_number: '12' });
});

test('preço: centavos, sob consulta e conferência L11', () => {
  assert.equal(A.priceCents(''), null);
  assert.equal(A.priceCents('180'), 18000);
  assert.equal(A.priceCents('180,5'), 18050);
  assert.equal(A.priceCents('R$ 1.200,00'), 120000);
  assert.ok(Number.isNaN(A.priceCents('0,50')), 'abaixo de R$ 1');
  assert.ok(Number.isNaN(A.priceCents('abc')));
  assert.ok(Number.isNaN(A.priceCents('1,234')));
  assert.equal(A.centsText(null), 'sob consulta');
  assert.match(A.centsText(18000), /R\$\s?180,00/);
  assert.equal(A.priceNeedsCheck('rx', 900000), true);
  assert.equal(A.priceNeedsCheck('rm', 900000), false);
  assert.equal(A.priceNeedsCheck('rx', null), false);
  // os limites são os mesmos do painel antigo (Exames e preços)
  const painel = ler('assets/js/painel.js');
  const m = painel.match(/export const PRICE_CHECK_CENTS = (\{[^}]+\})/);
  assert.deepEqual(A.PRICE_CHECK_CENTS, Function(`return ${m[1]}`)());
});

test('procedimento: erros e o que vai ao banco', () => {
  const res = [{ id: 'r1', kind: 'equipamento' }, { id: 'r2', kind: 'sala' }];
  const ok = { exam_code: 'usg', name: 'Ultrassom', duration_min: '20', price: '', fasting_hours: '', patient_prep_text: '', groups: [{ resource_kind: 'equipamento', options: ['r1'] }] };
  assert.deepEqual(A.procedureErrors(ok, res), {});
  const e = A.procedureErrors({ exam_code: 'x', name: '', duration_min: '3', price: 'abc', fasting_hours: '30', patient_prep_text: 'a'.repeat(601), groups: [] }, res);
  assert.deepEqual(Object.keys(e).sort(), ['duration_min', 'exam_code', 'fasting_hours', 'groups', 'name', 'patient_prep_text', 'price']);
  assert.match(A.procedureErrors({ ...ok, groups: [{ resource_kind: 'sala', options: ['r1'] }] }, res).g0, /Marque pelo menos um sala/);
  assert.match(A.procedureErrors({ ...ok, groups: [{ resource_kind: 'equipamento', options: ['r1'] }, { resource_kind: 'equipamento', options: ['r1'] }] }, res).g1, /dois grupos/);
  assert.deepEqual(A.procedurePayload({ ...ok, price: '350,00', fasting_hours: '4', patient_prep_text: ' Beber água ' }, { priceConfirmed: true }), {
    exam_code: 'usg', name: 'Ultrassom', duration_min: 20, price_cents: 35000, patient_prep_text: 'Beber água', fasting_hours: 4, online_booking: true, active: true,
    requirements: [{ resource_kind: 'equipamento', options: [{ resource_id: 'r1' }] }], price_confirmed: true });
  const p2 = A.procedurePayload({ ...ok, id: 'p1', online_booking: false }, { isNew: false, priceConfirmed: true });
  assert.equal(p2.id, 'p1');
  assert.equal(p2.price_cents, null);
  assert.equal(p2.price_confirmed, undefined, 'sem preço não confirma nada');
  assert.equal(p2.online_booking, false);
  assert.equal(p2.fasting_hours, null);
});

test('unidade: erros e o que vai ao banco', () => {
  const ok = { step_min: '10', min_notice_h: '2', max_advance_days: '60', holidays_checked_until: '2026-12-31', closes_on_holidays: true };
  assert.deepEqual(A.unitErrors(ok), {});
  assert.deepEqual(Object.keys(A.unitErrors({ step_min: '7', min_notice_h: '200', max_advance_days: '0', holidays_checked_until: '31/12' })).sort(),
    ['holidays_checked_until', 'max_advance_days', 'min_notice_h', 'step_min']);
  assert.deepEqual(A.unitPayload(ok), { step_min: 10, min_notice_min: 120, max_advance_days: 60, holidays_checked_until: '2026-12-31', closes_on_holidays: true });
  assert.equal(A.unitPayload({ ...ok, holidays_checked_until: '' }).holidays_checked_until, null);
});

test('respostas do banco em linguagem simples', () => {
  // toda resposta que as funções da 3.2, 3.4 e 4.1 dão tem texto
  const sql = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => /agenda_(motor|painel|config)/.test(f)).map((f) => ler(`supabase/migrations/${f}`)).join('\n');
  const cods = new Set([...sql.matchAll(/jsonb_build_object\('status', '([a-z_]+)'/g)].map((m) => m[1]));
  for (const c of ['duplicate_name', 'default_exists', 'resource_in_two_groups', 'has_appointments', 'invalid_reference']) cods.add(c); // de private.agenda_err
  for (const c of ['ok', 'affects_appointments']) cods.delete(c);
  const sem = [...cods].filter((c) => !A.STATUS_TEXT[c]);
  // estas não são usadas pelo painel da 4.1 (dia, conflitos, feriados da equipe do IMED)
  const fora = ['invalid_status', 'too_short', 'justification_required', 'reason_required', 'already_closed'];
  assert.deepEqual(sem.filter((c) => !fora.includes(c)), [], `respostas sem texto: ${sem.join(', ')}`);
  assert.equal(A.statusText('nunca_visto', 'padrão'), 'padrão');
  assert.equal(A.affectsText([1]), '1 agendamento futuro deixaria de caber nesta mudança.');
  assert.equal(A.affectsText([1, 2]), '2 agendamentos futuros deixariam de caber nesta mudança.');
});

test('nada inventado: sem horário nem preço de exemplo nos textos da tela', () => {
  const js = ler('assets/js/agenda-config.js');
  assert.doesNotMatch(js, /placeholder=/, 'campos sem exemplo que pareça dado real');
  assert.doesNotMatch(js, /R\$\s?\d/, 'nenhum preço escrito no código da tela');
  assert.match(js, /decisão 17/, 'anotação do MFA pendente');
});
