// Testes das regras dos recursos de confiança (assets/js/confianca.js) e do pedido para outra pessoa
// (assets/js/geo-core.js). Rodar com: node --test tests/confianca.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as T from '../assets/js/confianca.js';
import * as G from '../assets/js/geo-core.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NOW = Date.parse('2026-10-30T12:00:00Z');

test('cancelar: só pedido ativo e com horário ainda no futuro (ou sem horário)', () => {
  for (const st of ['pending', 'contacted', 'confirmed']) assert.equal(T.canCancel(st, null, NOW), true, st);
  for (const st of ['cancelled', 'completed', '', null, undefined, 'pendente', 'confirmado']) assert.equal(T.canCancel(st, null, NOW), false, String(st));
  assert.equal(T.canCancel('confirmed', '2026-10-31T12:30:00.000Z', NOW), true, 'horário amanhã');
  assert.equal(T.canCancel('confirmed', '2026-10-30T11:59:00.000Z', NOW), false, 'horário que já passou');
  assert.equal(T.canCancel('confirmed', 'nada', NOW), false, 'horário inválido');
  assert.match(T.cancelDoneText('2026-10-31T12:30:00.000Z'), /Pedido cancelado\. O horário voltou a ficar livre\./);
  assert.ok(!/livre/.test(T.cancelDoneText(null)), 'sem horário, não fala de horário livre');
  assert.match(T.CANCEL_CONFIRM, /Cancelar pelo IMED é grátis/);
  for (const k of ['already_cancelled', 'not_cancellable', 'past', 'forbidden', 'not_found', 'error']) assert.ok(T.CANCEL_MSG[k], k);
});

test('Fale com o IMED: assuntos (com os direitos da LGPD) e assunto pelo endereço', () => {
  const keys = T.CONTACT_SUBJECTS.map(([k]) => k);
  assert.deepEqual(keys, ['duvida', 'cancelamento', 'dados_acesso', 'dados_correcao', 'dados_exclusao', 'clinica', 'outro']);
  // Os mesmos valores aceitos pelo banco (send_contact e o check da tabela contact_messages).
  const sql = readFileSync(`${ROOT}supabase/migrations/20261030072000_confianca.sql`, 'utf8');
  for (const k of keys) assert.ok(sql.includes(`'${k}'`), `banco aceita ${k}`);
  assert.equal(T.subjectFromParam('correcao'), 'dados_correcao');
  assert.equal(T.subjectFromParam('exclusao'), 'dados_exclusao');
  assert.equal(T.subjectFromParam('acesso'), 'dados_acesso');
  assert.equal(T.subjectFromParam('cancelamento'), 'cancelamento');
  assert.equal(T.subjectFromParam('dados_exclusao'), 'dados_exclusao');
  assert.equal(T.subjectFromParam('<script>'), '');
  assert.equal(T.subjectFromParam(null), '');
  assert.equal(T.isLgpdSubject('dados_correcao'), true);
  assert.equal(T.isLgpdSubject('duvida'), false);
  // Os botões de "Meus dados" da conta abrem o assunto certo.
  const conta = readFileSync(`${ROOT}conta.html`, 'utf8');
  assert.match(conta, /href="contato\.html\?assunto=correcao"/);
  assert.match(conta, /href="contato\.html\?assunto=exclusao"/);
  // A página tem as mesmas opções.
  const page = readFileSync(`${ROOT}contato.html`, 'utf8');
  for (const k of keys) assert.ok(page.includes(`<option value="${k}">`), `contato.html: ${k}`);
});

test('Fale com o IMED: e-mail ou celular num campo só, validação e argumentos da função', () => {
  assert.deepEqual(T.parseReplyContact(' Ana@Exemplo.com '), { email: 'ana@exemplo.com' });
  assert.deepEqual(T.parseReplyContact('(11) 98765-4321'), { phone: '11987654321' });
  assert.deepEqual(T.parseReplyContact('+55 11 98765-4321'), { phone: '11987654321' });
  assert.deepEqual(T.parseReplyContact('11 3333-4444'), { phone: '1133334444' });
  for (const bad of ['', 'ana@', '123', '(01) 98765-4321', '1198765432a1'.replace('a', '')]) {
    if (bad === '11987654321') continue;
    assert.equal(T.parseReplyContact(bad), null, bad);
  }
  const ok = { subject: 'duvida', name: ' Ana  Souza ', contact: 'ana@exemplo.com', message: 'Como funciona o pedido?', code: '' };
  assert.deepEqual(T.validateContact(ok), {});
  const bad = T.validateContact({ subject: 'x', name: 'A', contact: 'oi', message: 'oi', code: 'x'.repeat(41) });
  assert.deepEqual(Object.keys(bad).sort(), ['code', 'contact', 'message', 'name', 'subject']);
  assert.ok(T.validateContact({ ...ok, message: 'a'.repeat(2001) }).message, 'até 2000 caracteres');
  assert.deepEqual(T.contactArgs({ ...ok, contact: '(11) 98765-4321', code: ' IMED-1A2B3C4D ' }), {
    p_subject: 'duvida', p_name: 'Ana Souza', p_contact: '11987654321', p_message: 'Como funciona o pedido?', p_request_code: 'IMED-1A2B3C4D',
  });
  assert.equal(T.contactArgs(ok).p_request_code, null);
  // Erros do banco (exceção P0001).
  assert.match(T.contactError({ data: { code: 'P0001', message: 'limite' } }).text, /várias mensagens em pouco tempo/);
  assert.deepEqual(T.contactError({ data: { code: 'P0001', message: 'dados_invalidos', details: 'contato' } }).field, 'contact');
  assert.equal(T.contactError(new Error('rede')).field, undefined);
  assert.equal(T.isProtocol('IMED-20261030-AB2C'), true);
  assert.equal(T.isProtocol('IMED-1A2B3C4D'), false);
});

test('"Algo errado aqui?": tipos, validação e argumentos (cadastro oficial ou parceiro)', () => {
  assert.deepEqual(T.REPORT_KINDS.map(([k]) => k), ['telefone', 'fechado', 'endereco', 'exame', 'outro']);
  assert.deepEqual(T.validateReport({ kind: 'telefone', note: '' }), {});
  assert.ok(T.validateReport({ kind: '', note: '' }).kind);
  assert.ok(T.validateReport({ kind: 'outro', note: 'a'.repeat(301) }).note);
  assert.deepEqual(T.reportArgs({ source: 'cnes', id: 'cnes:2077485' }, { kind: 'fechado', note: '  fechou   em   setembro ' }),
    { p_cnes: '2077485', p_clinic: null, p_kind: 'fechado', p_note: 'fechou em setembro' });
  const id = 'bbbbbbbb-0000-4000-8000-000000000011';
  assert.deepEqual(T.reportArgs({ source: 'imed', id: `imed:${id}`, clinic_id: id }, { kind: 'exame', note: '' }),
    { p_cnes: null, p_clinic: id, p_kind: 'exame', p_note: null });
  assert.equal(T.reportKindLabel('endereco'), 'O endereço mudou');
});

test('Meus dados: arquivo com a conta, os pedidos e o aparelho, sem o código secreto dos pedidos', () => {
  const device = [{ type: 'pedido', id: 'x', token: 'a'.repeat(64), name: 'Hospital', status: 'pendente' }, null, 'lixo'];
  const out = T.dataExport({ email: 'ana@exemplo.com', userId: 'u1', requests: [{ id: 'r1' }], claims: [{ id: 'k1' }], device, now: NOW });
  assert.equal(out.servico, 'IMED');
  assert.equal(out.gerado_em, '2026-10-30T12:00:00.000Z');
  assert.deepEqual(out.conta, { email: 'ana@exemplo.com', id: 'u1' });
  assert.deepEqual(out.pedidos_da_conta, [{ id: 'r1' }]);
  assert.deepEqual(out.pedidos_de_cadastro_de_clinica, [{ id: 'k1' }]);
  assert.deepEqual(out.pedidos_deste_aparelho, [{ type: 'pedido', id: 'x', name: 'Hospital', status: 'pendente' }]);
  assert.ok(!JSON.stringify(out).includes('a'.repeat(64)), 'sem o token');
  assert.equal(T.dataExport({ device: [] }).conta, null);
  assert.equal(T.dataExportName(NOW), 'imed-meus-dados-2026-10-30.json');
});

test('conferência antes de aprovar: as quatro obrigatórias e o que vai para o banco', () => {
  assert.deepEqual(T.CLAIM_CHECKS.map(([k]) => k), ['cnes_active', 'cnpj_active', 'phone_confirmed', 'crm_active']);
  assert.equal(T.checksComplete({ cnes_active: true, cnpj_active: true, phone_confirmed: true, crm_active: true }), true);
  assert.equal(T.checksComplete({ cnes_active: true, cnpj_active: true, phone_confirmed: true, crm_active: false }), false);
  assert.equal(T.checksComplete(null), false);
  const v = { cnes_active: true, cnpj_active: true, phone_confirmed: false, crm_active: true, note: '  CRM 123456-SP  ' };
  assert.deepEqual(T.checksPayload((k) => v[k]), { cnes_active: true, cnpj_active: true, phone_confirmed: false, crm_active: true, note: 'CRM 123456-SP' });
  assert.ok(!('note' in T.checksPayload((k) => (k === 'note' ? '' : true))));
});

test('datas: "Verificado em dd/mm/aaaa" e "atualizado em 30 de outubro de 2026" no fuso de São Paulo', () => {
  assert.equal(T.dateBR('2026-10-30T02:30:00Z'), '29/10/2026', '23:30 em São Paulo ainda é dia 29');
  assert.equal(T.dateBR('2026-10-30T12:00:00Z'), '30/10/2026');
  assert.equal(T.dateBR(null), '');
  assert.equal(T.dateBR('nada'), '');
  assert.equal(T.dayLong('2026-10-30'), '30 de outubro de 2026');
  assert.equal(T.dayLong('30/10/2026'), '');
  assert.equal(T.deCidade('Rio de Janeiro'), 'do Rio de Janeiro');
  assert.equal(T.deCidade('Belo Horizonte'), 'de Belo Horizonte');
});

test('pedido para outra pessoa: validação, menor de 18 anos e colunas novas só quando é para outra pessoa', () => {
  const base = { exam: 'rm', date: '2026-11-03', period: 'manha', name: 'Ana Souza', phone: '(11) 98765-4321', email: '', notes: '', consent: true };
  assert.deepEqual(G.validateBooking({ ...base, forOther: false }, '2026-10-28', '2027-01-26'), {});
  const other = { ...base, forOther: true, otherName: ' João  Souza ', relationship: 'Filho ou filha', otherMinor: false, guardianConsent: false };
  assert.deepEqual(G.validateBooking(other, '2026-10-28', '2027-01-26'), {});
  assert.deepEqual(Object.keys(G.validateBooking({ ...other, otherName: ' ', relationship: 'Vizinho' }, '2026-10-28', '2027-01-26')).sort(), ['otherName', 'relationship']);
  assert.ok(G.validateBooking({ ...other, otherMinor: true }, '2026-10-28', '2027-01-26').guardian, 'menor sem a autorização do responsável');
  assert.deepEqual(G.validateBooking({ ...other, otherMinor: true, guardianConsent: true }, '2026-10-28', '2027-01-26'), {});
  // Ordem dos erros igual à do formulário: os de outra pessoa vêm antes do nome de quem pede.
  const order = Object.keys(G.validateBooking({ ...other, name: '', otherName: '' }, '2026-10-28', '2027-01-26'));
  assert.ok(order.indexOf('otherName') < order.indexOf('name'));
  const place = { source: 'cnes', id: 'cnes:2077485', name: 'Hospital', address: null, phone: null, clinic_id: null };
  const mine = G.bookingRow(place, { ...base, forOther: false }, 'id1');
  for (const k of ['for_other', 'other_name', 'relationship', 'other_minor', 'guardian_consent']) assert.ok(!(k in mine), `pedido comum sem ${k}`);
  const row = G.bookingRow(place, { ...other, otherMinor: true, guardianConsent: true }, 'id2');
  assert.equal(row.for_other, true);
  assert.equal(row.other_name, 'João Souza');
  assert.equal(row.relationship, 'Filho ou filha');
  assert.equal(row.other_minor, true);
  assert.equal(row.guardian_consent, true);
  assert.equal(row.patient_name, 'Ana Souza', 'quem pede continua em patient_name');
  assert.equal(G.bookingRow(place, { ...other, guardianConsent: true }, 'id3').guardian_consent, false, 'adulto: sem autorização de responsável');
  // Mesmas opções de parentesco no formulário; os campos ficam escondidos até escolher "Outra pessoa".
  const html = G.forWhomHTML();
  for (const r of G.RELATIONSHIPS) assert.ok(html.includes(`<option value="${r}">`), r);
  assert.match(html, /name="para" value="mim" checked/);
  assert.match(html, /data-other hidden/);
  assert.match(html, /data-guardian hidden/);
  assert.match(html, /LGPD, art\. 14/);
});
