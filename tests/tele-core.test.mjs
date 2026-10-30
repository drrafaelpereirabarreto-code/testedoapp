// Testes das regras da teleconsulta (assets/js/tele-core.js): catálogo de exames, validações iguais às do
// banco, idade e datas de São Paulo, erros, documento para imprimir, vídeo (WebRTC simulado) e consulta periódica.
// Rodar com: node --test tests/tele-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../assets/js/tele-core.js';

const TODAY = '2026-10-30';
const base = {
  who: 'me', requester: '', relationship: '', name: 'Maria  da   Silva', birth: '1980-05-17', phone: '(11) 98765-4321',
  reason: 'Tosse há 5 dias', alerts: [], none: true, guardian: false, consent: true,
};

test('catálogo: 90 exames, grupos certos, ids únicos e códigos da busca válidos', () => {
  assert.deepEqual(T.CATALOG.map((g) => g.label), ['Sangue', 'Urina e fezes', 'Imagem', 'Coração', 'Outros']);
  const items = T.CATALOG.flatMap((g) => g.items);
  assert.equal(items.length, 90);
  assert.equal(new Set(items.map((i) => i.id)).size, 90, 'ids únicos');
  for (const it of items) {
    assert.ok(it.s === null || Object.hasOwn(T.SEARCH, it.s), `${it.id}: código ${it.s}`);
    assert.ok(it.name.length >= 2 && it.name.length <= 120, it.id);
    assert.ok(!Object.hasOwn(it, 'aka') || Array.isArray(it.aka));
  }
  assert.deepEqual(Object.keys(T.SEARCH).sort(), ['dens', 'eco', 'ecg', 'lab', 'mamo', 'rm', 'rx', 'tc', 'usg'].sort());
  assert.ok(T.CATALOG[0].items.every((i) => i.s === 'lab'), 'sangue é laboratório');
  assert.equal(T.catalogItem('rx_joelho').obs, 'Lado: direito, esquerdo ou ambos');
  assert.equal(T.catalogItem('holter').s, null);
  assert.equal(T.catalogItem('nao-existe'), null);
  assert.equal(T.OTHER_EXAM.id, 'outro');
});

test('busca no catálogo sem acento e por outros nomes', () => {
  const names = (q) => T.searchCatalog(q).map((i) => i.id);
  assert.deepEqual(names('TIREOIDE'), ['tsh', 'usg_tireoide']);
  assert.deepEqual(names('tireóide'), ['tsh', 'usg_tireoide']);
  assert.deepEqual(names('eas'), ['urina_tipo1']);
  assert.ok(names('raio-x torax').includes('rx_torax'));
  assert.ok(names('ultrassom abdome').includes('usg_abdome_total'));
  assert.ok(names('glicada').includes('hba1c'));
  assert.ok(names('preventivo').includes('papanicolau'));
  assert.equal(names('').length, 90, 'sem busca: todos');
  assert.deepEqual(names('xyzzy'), []);
  assert.equal(T.searchCatalog('hemograma')[0].group, 'Sangue');
});

test('exames no formato do banco: limites, sem repetir e no máximo 60', () => {
  assert.deepEqual(T.examFromCatalog('rx_torax', '  PA e perfil  '), { code: 'rx_torax', name: 'Raio-X de tórax (PA e perfil)', group: 'Imagem', search: 'rx', note: 'PA e perfil' });
  assert.equal(T.examFromCatalog('x'), null);
  assert.deepEqual(T.freeExam('  Cintilografia   óssea ', '', 'zz'), { code: 'outro', name: 'Cintilografia óssea', group: 'Outros exames', search: null, note: null });
  assert.equal(T.freeExam('   '), null);
  assert.equal(T.freeExam('Eco de carótidas', 'bilateral', 'usg').search, 'usg');
  const long = T.freeExam('A'.repeat(300), 'B'.repeat(400));
  assert.equal(long.name.length, 120);
  assert.equal(long.note.length, 200);
  const list = [T.examFromCatalog('hemograma'), T.examFromCatalog('hemograma', 'outra'), T.freeExam('Teste X'), T.freeExam('teste x'), { name: '' }, { name: 'Y', search: 'bad', extra: 1 }];
  const out = T.examsPayload(list);
  assert.deepEqual(out.map((e) => e.name), ['Hemograma completo', 'Teste X', 'Y']);
  assert.deepEqual(Object.keys(out[2]).sort(), ['code', 'group', 'name', 'note', 'search']);
  assert.equal(out[2].search, null);
  const many = Array.from({ length: 70 }, (_, i) => T.freeExam(`Exame ${i}`));
  assert.equal(T.examsPayload(many).length, 60);
});

test('exames agrupados na ordem do catálogo e links de busca e preparo', () => {
  const ex = [T.freeExam('Outro A'), T.examFromCatalog('ecg'), T.examFromCatalog('hemograma'), T.examFromCatalog('rx_torax')];
  assert.deepEqual(T.groupExams(ex).map((g) => g.label), ['Sangue', 'Imagem', 'Coração', 'Outros exames']);
  assert.deepEqual(T.groupExams(null), []);
  assert.deepEqual(T.examLinks({ search: 'lab' }), { near: 'perto.html?exame=lab', guide: null });
  assert.deepEqual(T.examLinks({ search: 'rx' }), { near: 'perto.html?exame=rx', guide: 'exames/raio-x.html#preparo' });
  assert.deepEqual(T.examLinks({ search: 'rm' }, '../'), { near: '../perto.html?exame=rm', guide: '../exames/ressonancia-magnetica.html#preparo' });
  assert.deepEqual(T.examLinks({ search: null }), { near: null, guide: null });
  assert.deepEqual(T.examLinks({ search: 'javascript:alert(1)' }), { near: null, guide: null });
});

test('datas: hoje em São Paulo, idade em anos completos e formatos', () => {
  assert.equal(T.todaySP(new Date('2026-10-31T02:30:00Z')), '2026-10-30', '23h30 em São Paulo ainda é dia 30');
  assert.equal(T.todaySP(new Date('2026-10-31T03:30:00Z')), '2026-10-31');
  assert.equal(T.ageOn('2008-10-30', TODAY), 18, 'faz 18 hoje');
  assert.equal(T.ageOn('2008-10-31', TODAY), 17, 'faz 18 amanhã');
  assert.equal(T.ageOn('2026-10-30', TODAY), 0);
  assert.equal(T.ageOn('2024-02-29', '2025-02-28'), 0);
  assert.equal(T.ageOn('2024-02-29', '2025-03-01'), 1);
  assert.equal(T.ageOn('2026-02-30', TODAY), null, 'data que não existe');
  assert.equal(T.isIsoDate('2026-13-01'), false);
  assert.equal(T.ageLabel(0), 'menos de 1 ano');
  assert.equal(T.ageLabel(1), '1 ano');
  assert.equal(T.ageLabel(46), '46 anos');
  assert.equal(T.fmtDate('1980-05-17'), '17/05/1980');
  assert.equal(T.fmtDate('x'), '');
  assert.equal(T.fmtDateTime('2026-10-30T17:05:00Z'), '30/10/2026 às 14:05');
  assert.equal(T.fmtTime('2026-10-30T03:00:00Z'), '00:00');
  assert.equal(T.fmtDateTime(null), '');
});

test('telefone: como o banco aceita, com máscara e link de ligação', () => {
  assert.equal(T.normPhone('+55 (11) 98765-4321'), '11987654321');
  assert.equal(T.normPhone('5511987654321'), '11987654321');
  assert.equal(T.normPhone('(11) 3141-1000'), '1131411000');
  assert.ok(T.isPhone('11987654321'));
  assert.ok(T.isPhone('1131411000'));
  assert.ok(!T.isPhone('0119876543'), 'DDD não começa com 0');
  assert.ok(!T.isPhone('987654321'), 'sem DDD');
  assert.equal(T.fmtPhone('11987654321'), '(11) 98765-4321');
  assert.equal(T.fmtPhone('1131411000'), '(11) 3141-1000');
  assert.equal(T.telHref('(11) 98765-4321'), 'tel:+5511987654321');
  assert.equal(T.telHref('123'), null);
  assert.equal(T.maskPhone('1198765'), '(11) 9876-5', 'enquanto digita, como em geo-core');
  assert.equal(T.maskPhone('11987654321'), '(11) 98765-4321');
});

test('pedido do paciente: argumentos de tele_request quando está tudo certo', () => {
  const r = T.validateRequest(base, TODAY);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.args, {
    p_patient_name: 'Maria da Silva', p_birthdate: '1980-05-17', p_phone: '11987654321', p_reason: 'Tosse há 5 dias', p_alert_flags: [],
    p_for_other: false, p_requester_name: null, p_relationship: null, p_guardian_consent: false, p_consent: true, p_consent_version: '2026-10-30',
  });
  assert.equal(r.age, 46);
  assert.equal(T.TCLE_VERSION.length <= 40, true);
});

test('pedido do paciente: campos inválidos aparecem todos de uma vez', () => {
  const r = T.validateRequest({ ...base, name: 'Al', birth: '', phone: '123', reason: ' a ', none: false, consent: false }, TODAY);
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['alerts', 'birth', 'consent', 'name', 'phone', 'reason']);
  assert.match(T.validateRequest({ ...base, birth: '2027-01-01' }, TODAY).errors.birth, /futuro/);
  assert.match(T.validateRequest({ ...base, birth: '1890-01-01' }, TODAY).errors.birth, /ano/);
  assert.match(T.validateRequest({ ...base, reason: 'x'.repeat(1001) }, TODAY).errors.reason, /1\.000/);
  const other = T.validateRequest({ ...base, who: 'other', requester: 'Jo', relationship: '' }, TODAY);
  assert.deepEqual(Object.keys(other.errors).sort(), ['relationship', 'requester']);
});

test('pedido do paciente: sinal de alerta bloqueia e o de se machucar mostra o CVV', () => {
  const r = T.validateRequest({ ...base, alerts: ['peito', 'inventado'] }, TODAY);
  assert.equal(r.errors.alerts, 'emergencia');
  assert.deepEqual(r.args.p_alert_flags, ['peito']);
  assert.equal(T.alertNeedsCvv(['peito']), false);
  assert.equal(T.alertNeedsCvv(['machucar']), true);
  assert.ok(T.ALERTS.length >= 8);
  assert.equal(new Set(T.ALERTS.map((a) => a.id)).size, T.ALERTS.length);
});

test('pedido do paciente: menor de 18 anos só com o responsável', () => {
  const kid = { ...base, birth: '2016-03-10' };
  const a = T.validateRequest(kid, TODAY);
  assert.equal(a.minor, true);
  assert.match(a.errors.minor, /responsável/);
  const b = T.validateRequest({ ...kid, who: 'other', requester: 'Ana Souza', relationship: 'Mãe' }, TODAY);
  assert.match(b.errors.guardian, /responsável legal/);
  const c = T.validateRequest({ ...kid, who: 'other', requester: 'Ana Souza', relationship: 'Mãe', guardian: true }, TODAY);
  assert.equal(c.ok, true, JSON.stringify(c.errors));
  assert.equal(c.args.p_for_other, true);
  assert.equal(c.args.p_guardian_consent, true);
  assert.equal(c.args.p_requester_name, 'Ana Souza');
  assert.equal(T.validateRequest({ ...base, birth: '2008-10-30' }, TODAY).minor, false, '18 anos hoje');
  const adultOther = T.validateRequest({ ...base, who: 'other', requester: 'Ana Souza', relationship: 'Filho ou filha', guardian: true }, TODAY);
  assert.equal(adultOther.args.p_guardian_consent, false, 'adulto: sem aceite de responsável');
});

test('cadastro do médico: mesmas regras de tele_doctor_register', () => {
  const ok = T.validateDoctor({ full_name: ' Ana  Lima ', crm: '00123.456', crm_uf: 'sp', rqe: '', specialty: '', phone: '' });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.deepEqual(ok.args, { p_full_name: 'Ana Lima', p_crm: '123456', p_crm_uf: 'SP', p_rqe: null, p_specialty: null, p_phone: null });
  const spec = T.validateDoctor({ full_name: 'Ana Lima', crm: '1', crm_uf: 'RJ', rqe: '0045', specialty: 'Cardiologia', phone: '+55 21 99999-8888' });
  assert.deepEqual(spec.args, { p_full_name: 'Ana Lima', p_crm: '1', p_crm_uf: 'RJ', p_rqe: '45', p_specialty: 'Cardiologia', p_phone: '21999998888' });
  const bad = T.validateDoctor({ full_name: 'Ana', crm: '000', crm_uf: 'XX', rqe: '', specialty: 'Pediatria', phone: '123' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['crm', 'crm_uf', 'full_name', 'phone', 'rqe']);
  assert.ok(T.validateDoctor({ full_name: 'Ana Lima', crm: '1', crm_uf: 'SP', rqe: '12', specialty: '' }).errors.specialty);
  assert.equal(T.UFS.length, 27);
});

test('identificação do médico: especialidade só com RQE', () => {
  const d = { full_name: 'Ana Lima', crm: '123456', crm_uf: 'sp', rqe: '789', specialty: 'Cardiologia' };
  assert.equal(T.doctorCrm(d), 'CRM-SP 123456');
  assert.equal(T.doctorSpecialty(d), 'Cardiologia · RQE 789');
  assert.equal(T.doctorSpecialty({ ...d, rqe: null }), '');
  assert.equal(T.doctorLine(d), 'Ana Lima · CRM-SP 123456 · Cardiologia · RQE 789');
  assert.equal(T.doctorCrm(null), '');
});

test('erros do banco viram código e texto simples', () => {
  const pg = (message, details = null, status = 400) => Object.assign(new Error(message), { status, data: { code: 'P0001', message, details } });
  assert.deepEqual(T.errorInfo(pg('emergencia')), { code: 'emergencia', details: null });
  assert.deepEqual(T.errorInfo(pg('dados_invalidos', 'telefone')), { code: 'dados_invalidos', details: 'telefone' });
  assert.equal(T.errorInfo(Object.assign(new Error('permission denied for function tele_queue'), { status: 401, data: { code: '42501' } })).code, 'sem_permissao');
  assert.equal(T.errorInfo(new TypeError('Failed to fetch')).code, 'rede');
  assert.equal(T.errorInfo(Object.assign(new Error('x'), { name: 'TimeoutError' })).code, 'rede');
  assert.equal(T.errorInfo(Object.assign(new Error('boom'), { status: 500, data: { message: 'boom' } })).code, 'erro');
  assert.match(T.errorText('emergencia'), /192/);
  assert.match(T.errorText('dados_invalidos', 'telefone'), /celular/);
  assert.match(T.errorText('fila_cheia'), /fila está cheia/);
  assert.match(T.errorText('ja_atendida'), /Outro médico/);
  assert.match(T.errorText('qualquer'), /Tente de novo/);
  assert.equal(T.PATIENT_FIELD.telefone, 'phone');
  assert.equal(T.DOCTOR_FIELD.uf, 'crm_uf');
});

test('fila: posição em linguagem simples, código da consulta e situações', () => {
  assert.equal(T.positionText(1), 'Você é o próximo da fila.');
  assert.equal(T.positionText(2), 'Há 1 pessoa na sua frente.');
  assert.equal(T.positionText(5), 'Há 4 pessoas na sua frente.');
  assert.equal(T.positionText(null), 'Você está na fila.');
  assert.equal(T.consultCode('0b1c2d3e-4f50-4617-8899-aabbccddeeff'), 'TELE-0B1C2D3E');
  for (const s of ['waiting', 'accepted', 'in_call', 'ended', 'cancelled', 'expired']) assert.ok(T.STATUS_PATIENT[s] && T.STATUS_DOCTOR[s], s);
});

test('código secreto: 64 hexadecimais e SHA-256 igual ao do banco', async () => {
  const t = T.newToken();
  assert.match(t, /^[0-9a-f]{64}$/);
  assert.notEqual(T.newToken(), t);
  assert.equal(await T.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('aparelho: consulta atual e histórico em localStorage', () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const e = { id: '0b1c2d3e-4f50-4617-8899-aabbccddeeff', token: 'a'.repeat(64), at: '2026-10-30T12:00:00Z' };
  assert.equal(T.readCurrent(storage), null);
  T.writeCurrent(storage, e);
  assert.deepEqual(T.readCurrent(storage), e);
  assert.deepEqual(JSON.parse(mem.get('imed_tele')), e, 'chave imed_tele');
  mem.set('imed_tele', JSON.stringify({ id: 'x', token: 'y' }));
  assert.equal(T.readCurrent(storage), null, 'entrada inválida é ignorada');
  mem.set('imed_tele', '{quebrado');
  assert.equal(T.readCurrent(storage), null);
  T.writeCurrent(storage, null);
  assert.equal(mem.has('imed_tele'), false);
  for (let i = 0; i < 12; i++) T.archive(storage, { ...e, id: `0b1c2d3e-4f50-4617-8899-aabbccddee${String(i).padStart(2, '0')}` }, { doctor: `Dr ${i}` });
  T.archive(storage, { ...e, id: '0b1c2d3e-4f50-4617-8899-aabbccddee05' }, { doctor: 'de novo' });
  const h = T.readHistory(storage);
  assert.equal(h.length, 10);
  assert.equal(h[0].doctor, 'de novo', 'mais nova primeiro, sem repetir');
  T.removeHistory(storage, h[0].id);
  assert.equal(T.readHistory(storage).length, 9);
  assert.deepEqual(T.readHistory({ getItem() { throw new Error('bloqueado'); } }), []);
  assert.equal(T.readCurrent(null), null);
});

test('mensagens: junta sem repetir e na ordem', () => {
  const a = [{ id: 2, body: 'b' }, { id: 1, body: 'a' }];
  const m = T.mergeMessages(a, [{ id: 3, body: 'c' }, { id: 2, body: 'b2' }]);
  assert.deepEqual(m.map((x) => x.id), [1, 2, 3]);
  assert.equal(m[1].body, 'b2');
  assert.equal(T.lastId(m), 3);
  assert.equal(T.lastId([]), 0);
});

test('documento "Solicitação de exames": dados mínimos, aviso honesto e HTML escapado', () => {
  const html = T.requestDocHtml({
    id: '0b1c2d3e-4f50-4617-8899-aabbccddeeff', patient_name: '<b>Ana</b> & Cia', patient_birthdate: '1990-01-15',
    doctor: { full_name: 'Carlos <i>Souza</i>', crm: '123456', crm_uf: 'SP', rqe: '789', specialty: 'Clínica médica' },
    exams: [T.examFromCatalog('hemograma'), T.examFromCatalog('glicemia'), T.examFromCatalog('rx_torax', 'PA <script>')],
    indication: 'Tosse <persistente>', at: '2026-10-30T17:05:00Z', printedAt: new Date('2026-10-30T17:30:00Z'), site: 'https://exemplo/',
  });
  assert.ok(!html.includes('<b>Ana</b>') && html.includes('&lt;b&gt;Ana&lt;/b&gt; &amp; Cia'));
  assert.ok(!html.includes('<script>') && html.includes('PA &lt;script&gt;'));
  assert.ok(html.includes('Carlos &lt;i&gt;Souza&lt;/i&gt;'));
  for (const s of ['Solicitação de exames', 'Emitida em teleconsulta (telemedicina)', '15/01/1990 (36 anos)', '30/10/2026 às 14:05',
    'CRM-SP 123456', 'Clínica médica · RQE 789', 'TELE-0B1C2D3E', 'Tosse &lt;persistente&gt;', 'ICP-Brasil', 'Gerado pelo IMED em 30/10/2026 às 14:30']) {
    assert.ok(html.includes(s), s);
  }
  assert.match(html, /<h3>Sangue<\/h3><ol start="1">.*Hemograma completo.*Glicemia de jejum.*<\/ol><h3>Imagem<\/h3><ol start="3">/s);
  const noSpec = T.requestDocHtml({ id: 'x', patient_name: 'A', patient_birthdate: 'x', doctor: { full_name: 'B C', crm: '1', crm_uf: 'RJ', rqe: null, specialty: 'Não pode' }, exams: [], at: 'bad' });
  assert.ok(!noSpec.includes('Não pode'), 'especialidade sem RQE não aparece');
  assert.ok(noSpec.includes('Nenhum exame'));
});

/* ======================= WebRTC simulado ======================= */
class FakePC {
  constructor(cfg) {
    this.cfg = cfg; this.listeners = {}; this.log = []; this.iceGatheringState = 'new'; this.connectionState = 'new'; this.iceConnectionState = 'new';
    this.localDescription = null; this.senders = [];
    FakePC.last = this;
  }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  emit(t, e = {}) { for (const f of [...(this.listeners[t] || [])]) f(e); }
  addTrack(track) { this.log.push(`addTrack:${track.kind}`); }
  addTransceiver(kind, init) { this.log.push(`addTransceiver:${kind}:${init.direction}`); }
  async createOffer() { this.log.push('createOffer'); return { type: 'offer', sdp: 'v=0 oferta' }; }
  async createAnswer() { this.log.push('createAnswer'); return { type: 'answer', sdp: 'v=0 resposta' }; }
  async setLocalDescription(d) {
    this.log.push(`setLocal:${d.type}`);
    this.localDescription = { type: d.type, sdp: `${d.sdp} +candidatos` };
    if (FakePC.gather) setTimeout(() => { this.iceGatheringState = 'complete'; this.emit('icegatheringstatechange'); }, 5);
  }
  async setRemoteDescription(d) { this.log.push(`setRemote:${d.type}`); }
  getTransceivers() { return [{ sender: { track: { kind: 'video' }, replaceTrack: async (t) => { this.log.push(`replace:${t.id}`); } }, receiver: { track: { kind: 'video' } } }]; }
  close() { this.log.push('close'); this.connectionState = 'closed'; }
}
const stream = (...kinds) => ({ getTracks: () => kinds.map((kind) => ({ kind })) });

test('vídeo: o médico oferta com câmera e microfone e espera juntar os candidatos', async () => {
  FakePC.gather = true;
  const states = [];
  const p = T.createPeer({ RTCPeerConnection: FakePC, iceServers: [], onState: (s) => states.push(s) });
  assert.deepEqual(FakePC.last.cfg, { iceServers: [] });
  const sdp = await p.offer(stream('audio', 'video'));
  assert.equal(sdp, 'v=0 oferta +candidatos');
  assert.deepEqual(FakePC.last.log, ['addTrack:audio', 'addTrack:video', 'createOffer', 'setLocal:offer']);
  const pc = FakePC.last;
  pc.iceConnectionState = 'checking'; pc.emit('iceconnectionstatechange');
  pc.connectionState = 'connected'; pc.emit('connectionstatechange');
  pc.emit('iceconnectionstatechange');
  pc.connectionState = 'failed'; pc.emit('connectionstatechange');
  assert.deepEqual(states, ['connecting', 'connected', 'failed'], 'sem repetir a mesma situação');
  await p.applyAnswer('v=0 x');
  assert.equal(pc.log.at(-1), 'setRemote:answer');
  await p.replaceVideo({ id: 'nova' });
  assert.equal(pc.log.at(-1), 'replace:nova');
  p.close(); p.close();
  assert.equal(pc.log.filter((x) => x === 'close').length, 1);
  assert.equal(p.closed, true);
});

test('vídeo: sem câmera, a oferta ainda pede para receber áudio e vídeo', async () => {
  FakePC.gather = true;
  const p = T.createPeer({ RTCPeerConnection: FakePC, iceServers: [] });
  await p.offer(stream('audio'));
  assert.deepEqual(FakePC.last.log.slice(0, 2), ['addTrack:audio', 'addTransceiver:video:recvonly']);
  const q = T.createPeer({ RTCPeerConnection: FakePC });
  await q.offer(null);
  assert.deepEqual(FakePC.last.log.slice(0, 2), ['addTransceiver:audio:recvonly', 'addTransceiver:video:recvonly']);
  assert.deepEqual(FakePC.last.cfg.iceServers, T.ICE_DEFAULT, 'STUN padrão');
});

test('vídeo: o paciente responde (oferta antes dos próprios microfone e câmera)', async () => {
  FakePC.gather = true;
  let remote = null;
  const p = T.createPeer({ RTCPeerConnection: FakePC, iceServers: [], onTrack: (s) => { remote = s; } });
  const sdp = await p.answer('v=0 oferta', stream('audio', 'video'));
  assert.equal(sdp, 'v=0 resposta +candidatos');
  assert.deepEqual(FakePC.last.log, ['setRemote:offer', 'addTrack:audio', 'addTrack:video', 'createAnswer', 'setLocal:answer']);
  const s = { id: 'remoto' };
  FakePC.last.emit('track', { streams: [s], track: { kind: 'video' } });
  assert.equal(remote, s);
  assert.equal(p.remote, s);
});

test('vídeo: sem o fim da coleta de candidatos, segue depois do tempo limite', async () => {
  FakePC.gather = false;
  const p = T.createPeer({ RTCPeerConnection: FakePC, iceServers: [], gatherMs: 30 });
  const t0 = Date.now();
  const sdp = await p.offer(stream('audio', 'video'));
  assert.ok(Date.now() - t0 >= 25, 'esperou o tempo limite');
  assert.equal(sdp, 'v=0 oferta +candidatos');
  // Candidato nulo também encerra a espera.
  const pc = new FakePC({});
  const w = T.waitIceGathering(pc, 5000);
  pc.emit('icecandidate', { candidate: null });
  assert.equal(await w, true);
  assert.equal(await T.waitIceGathering({ iceGatheringState: 'complete' }, 10), true);
});

test('vídeo: navegador sem WebRTC, situação da conexão e servidores ICE da configuração', () => {
  assert.throws(() => T.createPeer({ RTCPeerConnection: undefined }), /vídeo/);
  assert.equal(T.peerState({ connectionState: 'new', iceConnectionState: 'checking' }), 'connecting');
  assert.equal(T.peerState({ iceConnectionState: 'completed' }), 'connected');
  assert.equal(T.peerState({ connectionState: 'disconnected' }), 'disconnected');
  assert.equal(T.peerState({}), 'new');
  assert.deepEqual(T.iceServersFrom({}), T.ICE_DEFAULT);
  assert.deepEqual(T.iceServersFrom({ tele: { iceServers: [] } }), []);
  const turn = [{ urls: 'turn:turn.exemplo:3478', username: 'u', credential: 'c' }];
  assert.deepEqual(T.iceServersFrom({ tele: { iceServers: turn } }), turn);
  assert.deepEqual(T.ICE_DEFAULT.map((s) => s.urls), ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']);
});

/* ======================= consulta periódica ======================= */
function fakeTimers() {
  let now = 0; let seq = 0; const q = new Map();
  return {
    setTimeout(fn, ms) { const id = ++seq; q.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { q.delete(id); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...q.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        q.delete(next[0]); now = next[1].at; next[1].fn();
        await flush();
      }
      now = end;
    },
    get pending() { return q.size; },
  };
}
const flush = () => new Promise((r) => setImmediate(r));
function fakeDoc() {
  const l = new Set();
  return { hidden: false, addEventListener: (t, f) => l.add(f), removeEventListener: (t, f) => l.delete(f), fire() { l.forEach((f) => f()); }, get n() { return l.size; } };
}

test('consulta periódica: intervalo, pausa com a aba escondida e volta na hora', async () => {
  const timers = fakeTimers();
  const doc = fakeDoc();
  let n = 0;
  const p = T.createPoller({ run: async () => { n += 1; }, interval: 1000, doc, timers });
  assert.equal(n, 0, 'só começa no start');
  p.start(); await flush();
  assert.equal(n, 1, 'roda na hora');
  await timers.advance(999); assert.equal(n, 1);
  await timers.advance(1); assert.equal(n, 2);
  doc.hidden = true;
  await timers.advance(1000); assert.equal(n, 3, 'a consulta já agendada roda');
  await timers.advance(10000); assert.equal(n, 3, 'escondida: pausa');
  assert.equal(timers.pending, 0);
  doc.hidden = false; doc.fire(); await flush();
  assert.equal(n, 4, 'voltou para a aba: consulta na hora');
  p.setInterval(500);
  await timers.advance(500); assert.equal(n, 5, 'novo intervalo');
  p.stop();
  await timers.advance(5000); assert.equal(n, 5, 'parada');
  doc.fire(); await flush(); assert.equal(n, 5, 'parada não volta sozinha');
  p.destroy();
  assert.equal(doc.n, 0);
});

test('consulta periódica: mais lenta escondida, sem sobrepor e now() refaz depois', async () => {
  const timers = fakeTimers();
  const doc = fakeDoc();
  let n = 0; let open = 0; let max = 0; let release;
  const p = T.createPoller({
    run: async () => { n += 1; open += 1; max = Math.max(max, open); if (n === 2) await new Promise((r) => { release = r; }); open -= 1; },
    interval: 1000, hiddenInterval: 5000, doc, timers,
  });
  p.start(); await flush();
  await timers.advance(1000); // segunda chamada fica presa
  assert.equal(n, 2);
  p.now(); p.now(); await flush();
  assert.equal(n, 2, 'não sobrepõe');
  release(); await flush(); await flush();
  assert.equal(n, 3, 'refaz uma vez depois da que estava presa');
  assert.equal(max, 1);
  doc.hidden = true;
  await timers.advance(1000); assert.equal(n, 4);
  await timers.advance(4999); assert.equal(n, 4);
  await timers.advance(1); assert.equal(n, 5, 'escondida: a cada 5 s');
  p.destroy();
  // Erro numa chamada não para a consulta.
  let k = 0;
  const q = T.createPoller({ run: async () => { k += 1; if (k === 1) throw new Error('falhou'); }, interval: 100, doc: fakeDoc(), timers });
  q.start(); await flush();
  await timers.advance(100); assert.equal(k, 2);
  q.destroy();
});

test('textos fixos: termo e aviso na versão de hoje, sem preço e sem médico inventado', () => {
  assert.equal(T.TCLE_VERSION, '2026-10-30');
  assert.equal(T.NOTICE_VERSION, '2026-10-30');
  assert.equal(T.CFM_URL, 'https://portal.cfm.org.br/busca-medicos/');
  assert.equal(T.STORE_KEY, 'imed_tele');
  assert.ok(T.RELATIONSHIPS.includes('Mãe') && T.RELATIONSHIPS.every((r) => r.length >= 2 && r.length <= 60));
});
