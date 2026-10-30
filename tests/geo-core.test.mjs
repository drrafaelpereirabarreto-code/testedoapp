// Testes das regras de busca usadas no site. Rodar com: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../assets/js/geo-core.js';

const PAULISTA = { lat: -23.565, lng: -46.652 };

const imedRow = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Centro de Imagem Perto', kind: 'imagem', description: null,
  address_line: 'Av. Paulista, 1000', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: '01310-100',
  lat: -23.5655, lng: -46.6525, distance_m: 70, phone: '1130000000', whatsapp: '5511987654321', email: null, website: 'imagem.com.br',
  specialties: ['Radiologia'], opening_hours: { seg: '07:00–19:00' }, accepts_online_booking: true, is_demo: false,
  exams: [{ code: 'rm', price_cents: 45000 }, { code: 'tc', price_cents: null }],
};

test('classifica estabelecimentos do OpenStreetMap', () => {
  assert.equal(G.classifyOsm({ name: 'Delboni Medicina Diagnóstica', healthcare: 'clinic' })?.kind, 'imagem');
  assert.equal(G.classifyOsm({ name: 'Laboratório Central', amenity: 'clinic' })?.kind, 'laboratorio');
  assert.equal(G.classifyOsm({ name: 'Hospital Sírio-Libanês', amenity: 'hospital' })?.kind, 'hospital');
  assert.equal(G.classifyOsm({ name: 'Clínica Odontológica Sorriso', amenity: 'clinic' }), null);
  assert.equal(G.classifyOsm({ name: 'Consultório', healthcare: 'clinic', 'healthcare:speciality': 'dentist' }), null);
  const cardio = G.classifyOsm({ name: 'Instituto do Coração', healthcare: 'clinic', 'healthcare:speciality': 'cardiology;general' });
  assert.equal(cardio?.kind, 'clinica');
  assert.deepEqual(cardio?.specialties, ['Cardiologia', 'Clínico geral']);
  assert.deepEqual(G.classifyOsm({ name: 'Centro de Ressonância e Tomografia', healthcare: 'radiology' })?.services, ['rm', 'tc']);
});

test('reconhece exames pelo nome', () => {
  assert.deepEqual(G.examsFromText('Clínica de Ultrassom e Mamografia', 'imagem'), ['usg', 'mamo']);
  assert.deepEqual(G.examsFromText('Raio-X 24h', 'imagem'), ['rx']);
  assert.deepEqual(G.examsFromText('Fleury', 'laboratorio'), ['lab']);
  assert.deepEqual(G.examsFromText('Clínica São Paulo', 'clinica'), []);
});

test('traduz horários do OpenStreetMap sem inventar nada', () => {
  assert.equal(G.formatOsmHours('Mo-Fr 07:00-19:00; Sa 07:00-12:00'), 'seg–sex 07:00–19:00 · sáb 07:00–12:00');
  assert.equal(G.formatOsmHours('24/7'), 'Aberto 24 horas');
  assert.equal(G.formatOsmHours('Su off'), 'dom fechado');
});

test('consulta do Overpass usa um retângulo em volta do raio', () => {
  const q = G.overpassQuery(PAULISTA, 2000);
  const [s, w, n, e] = q.match(/\[bbox:([^\]]+)\]/)[1].split(',').map(Number);
  assert.ok(s < PAULISTA.lat && n > PAULISTA.lat && w < PAULISTA.lng && e > PAULISTA.lng);
  assert.ok(Math.abs((n - s) * 111320 - 4000) < 5, 'altura de 4 km');
  assert.match(q, /healthcare/);
  assert.match(q, /out center tags 1000/);
});

test('lê o Overpass, remove repetidos e quem está fora do raio, e ordena por distância', () => {
  const places = G.parseOverpass({
    elements: [
      { type: 'way', id: 2, center: { lat: -23.57, lon: -46.66 }, tags: { name: 'Lab Longe', healthcare: 'laboratory', phone: '+55 11 3000-0000;+55 11 3000-0001', opening_hours: 'Mo-Fr 06:00-18:00' } },
      { type: 'node', id: 1, lat: -23.5655, lon: -46.6525, tags: { name: 'Centro de Imagem Perto', healthcare: 'radiology', 'addr:street': 'Av. Paulista', 'addr:housenumber': '1000', 'addr:suburb': 'Bela Vista', website: 'imagem.com.br', 'contact:whatsapp': '(11) 98765-4321' } },
      { type: 'node', id: 3, lat: -23.5655, lon: -46.6525, tags: { name: 'Centro de Imagem Perto', healthcare: 'radiology' } },
      { type: 'node', id: 4, lat: -23.566, lon: -46.653, tags: { healthcare: 'clinic' } },
      { type: 'node', id: 5, lat: -23.566, lon: -46.653, tags: { name: 'Pet Clínica Veterinária', amenity: 'clinic' } },
      { type: 'node', id: 6, lat: -23.70, lon: -46.90, tags: { name: 'Hospital Longe Demais', amenity: 'hospital' } },
    ],
  }, PAULISTA, 3000);
  assert.deepEqual(places.map((p) => p.name), ['Centro de Imagem Perto', 'Lab Longe']);
  assert.equal(places[0].address, 'Av. Paulista, 1000 · Bela Vista');
  assert.equal(places[0].website, 'https://imagem.com.br/');
  assert.equal(places[0].whatsapp, '5511987654321');
  assert.equal(places[0].maps_url, 'https://www.openstreetmap.org/node/1');
  assert.equal(places[1].phone, '+55 11 3000-0000');
  assert.deepEqual(places[1].hours, ['seg–sex 06:00–18:00']);
  assert.equal(places[1].hours_source, 'osm');
  assert.equal(places[1].prices, null, 'estabelecimentos do mapa não têm preço');
});

test('classifica o Google no site e descarta dentistas', () => {
  const lab = G.normalizeGoogle({ id: 'google:c', name: 'Laboratório Vida', types: ['medical_lab'], hint: null, lat: -23.567, lng: -46.654, phone: '(11) 3333-4444', hours: null }, PAULISTA);
  assert.equal(lab.kind, 'laboratorio');
  assert.deepEqual(lab.services, ['lab']);
  assert.equal(lab.hours, null);
  const img = G.normalizeGoogle({ id: 'google:a', name: 'Lumen', types: ['doctor'], hint: 'imagem', lat: -23.566, lng: -46.653, hours: ['segunda-feira: 07:00–19:00'] }, PAULISTA);
  assert.equal(img.kind, 'imagem');
  assert.equal(img.hours_source, 'google');
  assert.equal(G.normalizeGoogle({ id: 'google:b', name: 'Radiologia Odontológica', types: ['dentist'], lat: -23.5, lng: -46.6 }, PAULISTA), null);
});

test('clínica do banco sem inventar preço nem horário', () => {
  const c = G.normalizeImedRow(imedRow, PAULISTA);
  assert.equal(c.source, 'imed');
  assert.equal(c.address, 'Av. Paulista, 1000 · Bela Vista · São Paulo - SP');
  assert.deepEqual(c.prices, { rm: 45000, tc: null });
  assert.deepEqual(c.services, ['rm', 'tc']);
  assert.deepEqual(c.hours, ['Segunda: 07:00–19:00']);
  assert.equal(c.website, 'https://imagem.com.br/');
  const semHorario = G.normalizeImedRow({ ...imedRow, opening_hours: null }, PAULISTA);
  assert.equal(semHorario.hours, null);
  assert.equal(semHorario.hours_source, null);
});

test('estabelecimento do CNES com turno oficial, sem preço e com link da ficha', () => {
  const row = {
    cnes: '2077485', name: 'Hospital Exemplo', kind: 'hospital', cnes_type: 5, address_line: 'Rua A, 10',
    neighborhood: 'Centro', cep: '01310100', city: 'São Paulo', uf: 'SP', city_code: '355030',
    lat: -23.56, lng: -46.65, location_source: 'cnes', phone: '(11) 3333-4444', shift: null, open_24h: true,
    sus: true, services: ['rx'], specialties: ['Cardiologia'], cnes_updated_at: '2026-09-01',
  };
  const c = G.normalizeCnes(row, PAULISTA);
  assert.equal(c.id, 'cnes:2077485');
  assert.equal(c.source, 'cnes');
  assert.equal(c.address, 'Rua A, 10 · Centro · São Paulo - SP');
  assert.equal(c.cep, '01310-100');
  assert.deepEqual(c.hours, ['Aberto 24 horas']);
  assert.equal(c.hours_source, 'cnes');
  assert.equal(c.prices, null);
  assert.equal(c.maps_url, 'https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/3550302077485');
  assert.equal(c.sus, true);
  assert.equal(c.approx, false);
  const outro = G.normalizeCnes({ ...row, kind: 'xyz', open_24h: false, shift: null, cep: '123', location_source: 'endereco', city_code: null }, PAULISTA);
  assert.equal(outro.kind, 'clinica');
  assert.equal(outro.hours, null);
  assert.equal(outro.cep, null);
  assert.equal(outro.approx, true);
  assert.equal(outro.maps_url, null);
  assert.deepEqual(G.normalizeCnes({ ...row, open_24h: false, shift: 'Manhã e tarde' }, PAULISTA).hours, ['Manhã e tarde']);
});

test('não repete no mapa uma clínica que já é parceira IMED', () => {
  const ours = [G.normalizeImedRow(imedRow, PAULISTA)];
  const map = G.parseOverpass({ elements: [
    { type: 'node', id: 1, lat: -23.5656, lon: -46.6526, tags: { name: 'Centro de Imagem Perto', healthcare: 'radiology' } },
    { type: 'node', id: 2, lat: -23.5700, lon: -46.6600, tags: { name: 'Outra Clínica', amenity: 'clinic' } },
  ] }, PAULISTA);
  assert.deepEqual(G.mergePlaces(ours, map).map((p) => p.id), ['imed:11111111-1111-4111-8111-111111111111', 'osm:n2']);
});

test('filtra por tipo, exame, especialidade, distância e preço informado', () => {
  const imed = G.normalizeImedRow(imedRow, PAULISTA);
  const semPreco = G.normalizeImedRow({ ...imedRow, id: '22222222-2222-4222-8222-222222222222', name: 'Outra IMED', exams: [{ code: 'rm', price_cents: null }] }, PAULISTA);
  const [lab] = G.parseOverpass({ elements: [{ type: 'node', id: 9, lat: -23.58, lon: -46.65, tags: { name: 'Laboratório X', healthcare: 'laboratory' } }] }, PAULISTA);
  const all = [imed, semPreco, lab];
  const f = (o) => G.filterPlaces(all, { ...G.DEFAULT_FILTERS, ...o }).map((p) => p.name);
  assert.deepEqual(f({}), ['Centro de Imagem Perto', 'Outra IMED', 'Laboratório X']);
  assert.deepEqual(f({ kind: 'laboratorio' }), ['Laboratório X']);
  assert.deepEqual(f({ exam: 'rm' }), ['Centro de Imagem Perto', 'Outra IMED']);
  assert.deepEqual(f({ specialty: 'Radiologia' }), ['Centro de Imagem Perto', 'Outra IMED']);
  assert.deepEqual(f({ radius: 1000 }), ['Centro de Imagem Perto', 'Outra IMED']);
  assert.deepEqual(f({ onlyImed: true }), ['Centro de Imagem Perto', 'Outra IMED']);
  assert.deepEqual(f({ price: '300a600' }), ['Centro de Imagem Perto'], 'só quem informou preço');
  assert.deepEqual(f({ price: 'ate100' }), []);
  assert.deepEqual(f({ exam: 'tc', price: '300a600' }), [], 'tomografia sem preço informado');
  assert.equal(G.activeFilterCount({ ...G.DEFAULT_FILTERS, exam: 'rm', onlyImed: true }), 2);
});

test('ordena por distância, nome e preço (sem preço por último)', () => {
  const a = { name: 'B', distance_m: 300, prices: { rm: 50000 } };
  const b = { name: 'A', distance_m: 100, prices: null };
  const c = { name: 'C', distance_m: 200, prices: { rm: 30000 } };
  assert.deepEqual(G.sortPlaces([a, b, c], 'dist').map((p) => p.name), ['A', 'C', 'B']);
  assert.deepEqual(G.sortPlaces([a, b, c], 'name').map((p) => p.name), ['A', 'B', 'C']);
  assert.deepEqual(G.sortPlaces([a, b, c], 'price', 'rm').map((p) => p.name), ['C', 'B', 'A']);
});

test('formata distância e preço', () => {
  assert.equal(G.formatDistance(63), '60 m');
  assert.equal(G.formatDistance(4), '10 m');
  assert.equal(G.formatDistance(1234), '1,2 km');
  assert.equal(G.formatDistance(15300), '15 km');
  assert.equal(G.formatPrice(45000).replace(/\s/g, ' '), 'R$ 450');
  assert.equal(G.formatPrice(12990).replace(/\s/g, ' '), 'R$ 129,90');
});

test('valida o pedido de agendamento', () => {
  const ok = { exam: 'rm', date: '2026-11-03', period: 'manha', name: 'Ana Souza', phone: '(11) 98765-4321', email: '', notes: '', consent: true };
  assert.deepEqual(G.validateBooking(ok, '2026-10-28', '2027-01-26'), {});
  const bad = G.validateBooking({ ...ok, date: '2026-10-01', phone: '1234', email: 'x@', consent: false, name: ' ' }, '2026-10-28', '2027-01-26');
  assert.deepEqual(Object.keys(bad).sort(), ['consent', 'date', 'email', 'name', 'phone']);
  assert.ok(G.validateBooking({ ...ok, date: '2027-03-01' }, '2026-10-28', '2027-01-26').date);
  assert.equal(G.isValidPhone('11987654321'), true);
  assert.equal(G.isValidPhone('1133334444'), true);
  assert.equal(G.isValidPhone('0198765432'), false);
  assert.equal(G.maskPhone('11987654321'), '(11) 98765-4321');
  assert.equal(G.maskPhone('1133334444'), '(11) 3333-4444');
});

test('monta o pedido no formato do banco', () => {
  const imed = G.normalizeImedRow(imedRow, PAULISTA);
  const v = { exam: 'rm', date: '2026-11-03', period: 'tarde', name: '  Ana   Souza ', phone: '(11) 98765-4321', email: ' Ana@Email.com ', notes: '', consent: true };
  const row = G.bookingRow(imed, v, 'abc');
  assert.equal(row.clinic_id, imedRow.id);
  assert.equal(row.place_source, 'imed');
  assert.equal(row.place_ref, null);
  assert.equal(row.patient_name, 'Ana Souza');
  assert.equal(row.patient_phone, '11987654321');
  assert.equal(row.patient_email, 'ana@email.com');
  assert.equal(row.notes, null);
  assert.equal(row.consent, true);
  assert.ok(!('status' in row), 'o status é sempre definido pelo banco');
  const [osm] = G.parseOverpass({ elements: [{ type: 'node', id: 7, lat: -23.566, lon: -46.653, tags: { name: 'Clínica do Mapa', amenity: 'clinic', phone: '+55 11 3000-0000' } }] }, PAULISTA);
  const row2 = G.bookingRow(osm, v, 'def');
  assert.equal(row2.clinic_id, null);
  assert.equal(row2.place_source, 'osm');
  assert.equal(row2.place_ref, 'osm:n7');
  assert.equal(row2.place_phone, '+55 11 3000-0000');
});

test('links de contato seguros', () => {
  assert.equal(G.telHref('(11) 3333-4444'), 'tel:+551133334444');
  assert.equal(G.telHref('+55 11 3333-4444'), 'tel:+551133334444');
  assert.equal(G.telHref('0800 123 4567'), 'tel:08001234567');
  assert.equal(G.safeUrl('javascript:alert(1)'), null);
  assert.equal(G.safeUrl('www.clinica.com.br'), 'https://www.clinica.com.br/');
  assert.equal(G.whatsappHref('5511987654321', 'Olá'), 'https://wa.me/5511987654321?text=Ol%C3%A1');
  assert.equal(G.protocolFromId('3f2a9c1e-0000-4000-8000-000000000000'), 'IMED-3F2A9C1E');
});

test('datas no fuso de São Paulo', () => {
  const noon = Date.UTC(2026, 9, 28, 15, 0);
  assert.equal(G.spDate(0, noon), '2026-10-28');
  assert.equal(G.spDate(90, noon), '2027-01-26');
  assert.equal(G.spDate(0, Date.UTC(2026, 9, 29, 2, 30)), '2026-10-28', '23h30 em São Paulo ainda é dia 28');
  assert.equal(G.roundCoord(-23.5651234), -23.565);
});
