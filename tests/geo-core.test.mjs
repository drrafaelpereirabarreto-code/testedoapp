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

test('parceiro leva convênios e código CNES; filtros de SUS e convênio', () => {
  const imed = G.normalizeImedRow({ ...imedRow, insurances: [' Bradesco Saúde ', 'SulAmérica', 'bradesco saude', ''], cnes: '1234567' }, PAULISTA);
  assert.deepEqual(imed.insurances, ['Bradesco Saúde', 'SulAmérica']);
  assert.equal(imed.cnes, '1234567');
  assert.deepEqual(G.normalizeImedRow(imedRow, PAULISTA).insurances, [], 'sem convênio informado, lista vazia');
  const outra = G.normalizeImedRow({ ...imedRow, id: '33333333-3333-4333-8333-333333333333', name: 'Outra', insurances: ['Amil'] }, PAULISTA);
  const base = { cnes: '1', name: 'UBS', kind: 'clinica', lat: -23.566, lng: -46.653, location_source: 'cnes', services: [], specialties: [] };
  const sus = G.normalizeCnes({ ...base, sus: true }, PAULISTA);
  const semSus = G.normalizeCnes({ ...base, cnes: '2', name: 'Privada', sus: false }, PAULISTA);
  const all = [imed, outra, sus, semSus];
  const f = (o) => G.filterPlaces(all, { ...G.DEFAULT_FILTERS, ...o }).map((p) => p.name);
  assert.equal(G.DEFAULT_FILTERS.sus, false);
  assert.equal(G.DEFAULT_FILTERS.insurance, '');
  assert.deepEqual(f({ sus: true }), ['UBS'], 'parceiros não informam SUS e ficam de fora');
  assert.deepEqual(f({ insurance: 'bradesco saúde' }), ['Centro de Imagem Perto'], 'compara sem diferenciar maiúsculas');
  assert.deepEqual(f({ insurance: 'Amil' }), ['Outra']);
  assert.deepEqual(f({ insurance: 'Unimed' }), []);
  assert.deepEqual(G.insuranceOptions(all), ['Amil', 'Bradesco Saúde', 'SulAmérica']);
  assert.equal(G.activeFilterCount({ ...G.DEFAULT_FILTERS, sus: true, insurance: 'Amil' }), 2);
  assert.equal(G.activeFilterCount(G.DEFAULT_FILTERS), 0);
});

test('faixa de preço só com preços informados por parceiros', () => {
  const a = G.normalizeImedRow(imedRow, PAULISTA); // rm 450, tc sem preço
  const b = G.normalizeImedRow({ ...imedRow, id: '44444444-4444-4444-8444-444444444444', exams: [{ code: 'rm', price_cents: 89990 }] }, PAULISTA);
  const demo = G.normalizeImedRow({ ...imedRow, id: '55555555-5555-4555-8555-555555555555', is_demo: true, exams: [{ code: 'rm', price_cents: 100 }] }, PAULISTA);
  const cnes = G.normalizeCnes({ cnes: '9', name: 'X', kind: 'imagem', lat: -23.566, lng: -46.653, services: ['rm'], specialties: [] }, PAULISTA);
  assert.deepEqual(G.priceRange([a, b, demo, cnes], 'rm'), { min: 45000, max: 89990, count: 2 });
  assert.deepEqual(G.priceRange([a], 'rm'), { min: 45000, max: 45000, count: 1 });
  assert.equal(G.priceRange([a, b, cnes], 'tc'), null, 'sem preço informado não há faixa');
  assert.equal(G.priceRange([], 'rm'), null);
});

test('ordena por nota sem inventar avaliação', () => {
  const list = [{ id: 'a', name: 'A', distance_m: 100 }, { id: 'b', name: 'B', distance_m: 200 }, { id: 'c', name: 'C', distance_m: 300 }, { id: 'd', name: 'D', distance_m: 50 }];
  const ratings = new Map([['b', { rating: 4.2, reviews: 3 }], ['c', { rating: 4.8, reviews: 10 }], ['a', { rating: 4.2, reviews: 7 }]]);
  assert.deepEqual(G.sortPlaces(list, 'rating', '', ratings).map((p) => p.id), ['c', 'a', 'b', 'd']);
  assert.equal(G.formatRating(4.6), '4,6');
  assert.equal(G.formatRating('5'), '5,0');
});

test('rótulos da situação do pedido', () => {
  assert.equal(G.statusLabel('pending'), 'Aguardando contato');
  assert.equal(G.statusLabel('pendente'), 'Aguardando contato');
  assert.equal(G.statusLabel('contacted'), 'Em contato');
  assert.equal(G.statusLabel('confirmed'), 'Confirmado');
  assert.equal(G.statusLabel('cancelled'), 'Cancelado');
  assert.equal(G.statusLabel('completed'), 'Concluído');
  assert.equal(G.statusLabel('xyz'), '');
});

test('preparo resumido para todos os exames', () => {
  for (const code of ['rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab', 'consulta', 'outro']) {
    assert.ok(typeof G.PREP[code] === 'string' && G.PREP[code].length > 10, code);
  }
});

test('pedido com campos extras (código de avaliação)', () => {
  const imed = G.normalizeImedRow(imedRow, PAULISTA);
  const v = { exam: 'rm', date: '2026-11-03', period: 'tarde', name: 'Ana', phone: '11987654321', email: '', notes: '', consent: true };
  const hash = 'a'.repeat(64);
  assert.equal(G.bookingRow(imed, v, 'x', { review_token_hash: hash }).review_token_hash, hash);
  assert.ok(!('review_token_hash' in G.bookingRow(imed, v, 'x')));
});

test('arquivo de agenda (.ics) válido, com fuso, lembrete e escapes', () => {
  const now = Date.UTC(2026, 9, 30, 12, 0, 0);
  const ics = G.icsFile({ id: 'abc-123', title: 'Exame: Ressonância — Clínica A, B; C', date: '2026-11-03', period: 'manha', description: 'Linha 1\nRetire metais; leve exames, se tiver.', url: 'https://imed.example/' }, now);
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'todas as quebras são CRLF');
  const lines = ics.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines.at(-2), 'END:VCALENDAR');
  assert.ok(lines.includes('BEGIN:VEVENT') && lines.includes('END:VEVENT'));
  assert.ok(lines.includes('VERSION:2.0'));
  assert.ok(lines.includes('DTSTART;TZID=America/Sao_Paulo:20261103T080000'));
  assert.ok(lines.includes('DTEND;TZID=America/Sao_Paulo:20261103T120000'));
  assert.ok(lines.includes('BEGIN:VTIMEZONE') && lines.includes('TZID:America/Sao_Paulo'));
  assert.ok(lines.includes('DTSTAMP:20261030T120000Z'));
  assert.ok(lines.includes('UID:abc-123@imed'));
  assert.ok(lines.includes('BEGIN:VALARM') && lines.includes('TRIGGER:-P1D') && lines.includes('END:VALARM'));
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:Exame: Ressonância — Clínica A\\, B\\; C\r\n'), 'vírgula e ponto e vírgula escapados no título');
  assert.ok(unfolded.includes('DESCRIPTION:Linha 1\\nRetire metais\\; leve exames\\, se tiver.\r\n'), 'escapes na descrição');
  assert.doesNotMatch(unfolded, /B; C/);
  assert.doesNotMatch(unfolded, /metais; leve/);
  assert.ok(lines.every((l) => new TextEncoder().encode(l).length <= 75), 'linhas dobradas em até 75 bytes');
  const tarde = G.icsFile({ id: 'x', title: 'T', date: '2026-11-03', period: 'tarde' }, now);
  assert.match(tarde, /DTSTART;TZID=America\/Sao_Paulo:20261103T130000\r\nDTEND;TZID=America\/Sao_Paulo:20261103T180000/);
  const noite = G.icsFile({ id: 'x', title: 'T', date: '2026-11-03', period: 'noite' }, now);
  assert.match(noite, /T180000\r\nDTEND;TZID=America\/Sao_Paulo:20261103T210000/);
  const dia = G.icsFile({ id: 'x', title: 'T', date: '2026-12-31', period: 'qualquer' }, now);
  assert.match(dia, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.ok(!dia.includes('VTIMEZONE'));
  assert.match(dia, /TRIGGER:-P1D/);
  assert.throws(() => G.icsFile({ id: 'x', title: 'T', date: '03/11/2026', period: 'manha' }));
});

test('horários no fuso de São Paulo: dia, hora, período e agrupamento', () => {
  assert.deepEqual(G.spDateTime('2026-11-05T12:30:00Z'), { date: '2026-11-05', time: '09:30' });
  assert.deepEqual(G.spDateTime('2026-11-06T01:00:00Z'), { date: '2026-11-05', time: '22:00' }, 'vira o dia pelo fuso de SP, não pelo UTC');
  assert.equal(G.spDateTime('xx'), null);
  assert.equal(G.spDateTime(null), null);
  assert.equal(G.periodOfTime('08:00'), 'manha');
  assert.equal(G.periodOfTime('12:00'), 'tarde');
  assert.equal(G.periodOfTime('18:30'), 'noite');
  const g = G.groupSlots([
    { slot_start: '2026-11-05T13:00:00Z' }, { slot_start: '2026-11-05T12:30:00+00:00' }, { slot_start: '2026-11-05T12:30:00Z' },
    { slot_start: '2026-11-06T11:00:00Z' }, { slot_start: 'quebrado' }, null,
  ]);
  assert.deepEqual([...g.keys()], ['2026-11-05', '2026-11-06']);
  assert.deepEqual(g.get('2026-11-05').map((s) => s.time), ['09:30', '10:00'], 'em ordem e sem repetir');
  assert.equal(g.get('2026-11-05')[0].iso, '2026-11-05T12:30:00.000Z');
  assert.deepEqual(G.dayTab('2026-11-05'), { wd: 'qui', day: '05/11' });
  assert.match(G.formatSlot('2026-11-05T12:30:00Z'), /^quinta-feira, 05 de novembro às 09:30$/);
  const now = Date.parse('2026-10-30T15:00:00Z');
  const days = G.nextDays(14, now);
  assert.equal(days.length, 14);
  assert.equal(days[0], '2026-10-30');
  assert.equal(days[13], '2026-11-12');
});

test('pedido com horário marcado: validação, linha do banco e resumo no aparelho', () => {
  const imed = G.normalizeImedRow(imedRow, PAULISTA);
  const v = { exam: 'rm', slot: '2026-11-05T17:30:00Z', name: 'Ana', phone: '(11) 98765-4321', consent: true };
  assert.deepEqual(G.validateBooking(v, '2026-10-30', '2027-01-28'), {}, 'com horário, data e período não são pedidos');
  assert.ok(G.validateBooking({ ...v, slot: 'nada' }, '2026-10-30', '2027-01-28').slot);
  assert.ok(G.validateBooking({ ...v, slot: '2026-10-01T12:00:00Z' }, '2026-10-30', '2027-01-28').slot, 'horário no passado');
  assert.ok(G.validateBooking({ ...v, slot: '' }, '2026-10-30', '2027-01-28').date, 'sem horário volta a pedir data');
  const row = G.bookingRow(imed, v, 'id1');
  assert.equal(row.slot_start, '2026-11-05T17:30:00.000Z');
  assert.equal(row.preferred_date, '2026-11-05');
  assert.equal(row.preferred_period, 'tarde', '14:30 em São Paulo');
  assert.equal(row.clinic_id, imedRow.id);
  assert.equal(row.consent, true);
  assert.ok(!('status' in row), 'quem confirma é o banco');
  assert.ok(!('slot_start' in G.bookingRow(imed, { ...v, slot: undefined, date: '2026-11-05', period: 'manha' }, 'id2')));
  const a = G.localAppt(imed, v, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'tok', Date.parse('2026-10-30T12:00:00Z'));
  assert.equal(a.status, 'confirmado');
  assert.equal(a.slot, '2026-11-05T17:30:00.000Z');
  assert.equal(a.date, '2026-11-05');
  assert.equal(a.period, 'tarde');
  assert.equal(a.code, 'IMED-AAAAAAAA');
  assert.deepEqual(a.items, ['Ressonância']);
  const b = G.localAppt(imed, { exam: 'consulta', date: '2026-11-05', period: 'manha' }, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'tok');
  assert.equal(b.status, 'pendente');
  assert.ok(!('slot' in b));
  assert.equal(G.statusLabel('confirmado'), 'Confirmado');
  assert.ok(G.isSlotTaken({ status: 409 }));
  assert.ok(G.isSlotTaken({ status: 400, data: { code: '23P01' } }));
  assert.ok(G.isSlotTaken({ code: '23505' }));
  assert.ok(!G.isSlotTaken({ status: 400, data: { code: '22023' } }));
});

test('.ics com hora exata do horário marcado', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const ics = G.icsFile({ id: 'abc', title: 'Exame: RM', slot: '2026-11-05T12:30:00Z', minutes: 45 }, now);
  assert.match(ics, /DTSTART;TZID=America\/Sao_Paulo:20261105T093000\r\n/);
  assert.match(ics, /DTEND;TZID=America\/Sao_Paulo:20261105T101500\r\n/);
  assert.match(ics, /STATUS:CONFIRMED/);
  assert.match(ics, /BEGIN:VTIMEZONE/);
  const late = G.icsFile({ id: 'x', title: 'T', slot: '2026-11-06T02:45:00Z' }, now);
  assert.match(late, /DTSTART;TZID=America\/Sao_Paulo:20261105T234500/);
  assert.match(late, /DTEND;TZID=America\/Sao_Paulo:20261106T001500/, 'termina no dia seguinte');
  assert.throws(() => G.icsFile({ id: 'x', title: 'T', slot: 'amanhã' }));
  const imed = G.normalizeImedRow(imedRow, PAULISTA);
  const full = G.bookingIcs(imed, { exam: 'rm', slot: '2026-11-05T12:30:00Z' }, 'aaaaaaaa-0000-4000-8000-000000000000', 'https://imed.example/', now);
  assert.match(full, /DTSTART;TZID=America\/Sao_Paulo:20261105T093000/);
  assert.match(full.replace(/\r\n /g, ''), /Agendamento IMED-AAAAAAAA/);
  const pedido = G.bookingIcs(imed, { exam: 'rm', date: '2026-11-05', period: 'manha' }, 'aaaaaaaa-0000-4000-8000-000000000000', 'https://imed.example/', now);
  assert.match(pedido, /STATUS:TENTATIVE/);
  assert.match(pedido, /T080000/);
});

test('página de cada local: referências, consultas e conversão das linhas do banco', () => {
  assert.deepEqual(G.parseLocalRef('cnes:2077485'), { source: 'cnes', key: '2077485' });
  assert.deepEqual(G.parseLocalRef('imed:AAAAAAAA-0000-4000-8000-000000000001'), { source: 'imed', key: 'aaaaaaaa-0000-4000-8000-000000000001' });
  assert.equal(G.parseLocalRef('cnes:123'), null);
  assert.equal(G.parseLocalRef('imed:1 or 1=1'), null);
  assert.equal(G.parseLocalRef('osm:n1'), null);
  const paths = G.localPaths({ source: 'cnes', key: '2077485' });
  assert.match(paths.main, /^establishments\?select=.*location.*municipalities\(name,uf,cnes_code\)&cnes=eq\.2077485$/);
  assert.equal(paths.partner, 'clinics?select=id&cnes=eq.2077485&status=eq.published');
  assert.match(G.localPaths({ source: 'imed', key: imedRow.id }).main, /clinic_exams\(exam_code,price_cents,price_updated_at\)&id=eq\..*&status=eq\.published$/);

  assert.deepEqual(G.pointFromGeo({ type: 'Point', coordinates: [-46.66, -23.56] }), { lat: -23.56, lng: -46.66 });
  assert.deepEqual(G.pointFromGeo('{"type":"Point","coordinates":[-46.66,-23.56]}'), { lat: -23.56, lng: -46.66 });
  assert.deepEqual(G.pointFromGeo('0101000020E61000003D0AD7A3705D47C0B81E85EB51C837C0'), { lat: -23.7825, lng: -46.73 }, 'EWKB em hexadecimal');
  assert.equal(G.pointFromGeo(null), null);
  assert.equal(G.pointFromGeo('qualquer coisa'), null);
  assert.equal(G.pointFromGeo({ type: 'Point', coordinates: [0, 0] }), null);

  const est = G.establishmentToPlace({
    cnes: '2077485', name: 'Hospital Santa Exemplo', legal_name: 'Assoc. Exemplo', kind: 'hospital', address_line: 'Rua Peixoto Gomide, 625',
    neighborhood: 'Cerqueira César', cep: '01409001', phone: '(11) 3141-1000', shift: 'Manhã e tarde', open_24h: false, sus: true,
    services: ['rm'], specialties: ['Cardiologia'], cnes_updated_at: '2026-09-15', location_source: 'cnes',
    location: { type: 'Point', coordinates: [-46.6602, -23.5598] }, city_ibge: 3550308, municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 },
  });
  assert.equal(est.id, 'cnes:2077485');
  assert.equal(est.address, 'Rua Peixoto Gomide, 625 · Cerqueira César · São Paulo - SP');
  assert.equal(est.cep, '01409-001');
  assert.deepEqual([est.lat, est.lng], [-23.5598, -46.6602]);
  assert.equal(est.distance_m, null);
  assert.deepEqual(est.hours, ['Manhã e tarde']);
  assert.equal(est.sus, true);
  assert.equal(G.localUrl(est), 'local.html?cnes=2077485');
  assert.equal(G.localTitle(est), 'Hospital Santa Exemplo em São Paulo - SP | IMED');
  assert.match(G.localDescription(est), /^Hospital em São Paulo - SP\. Endereço, telefone, exames \(Ressonância\) e como agendar pelo IMED\. Atende SUS\.$/);
  const noGeo = G.establishmentToPlace({ cnes: '1234567', name: 'Sem Local', kind: 'clinica', location: null, municipalities: null });
  assert.equal(noGeo.lat, null);
  assert.equal(G.localTitle(noGeo), 'Sem Local | IMED');

  const cl = G.clinicToPlace({
    ...imedRow, lat: undefined, lng: undefined, exams: undefined, location: { type: 'Point', coordinates: [-46.6525, -23.5655] },
    clinic_exams: [{ exam_code: 'tc', price_cents: null }, { exam_code: 'rm', price_cents: 45000, price_updated_at: '2026-10-01' }, { exam_code: 'xyz' }],
  });
  assert.equal(cl.id, `imed:${imedRow.id}`);
  assert.deepEqual(cl.services, ['rm', 'tc']);
  assert.equal(G.priceFor(cl, 'rm'), 45000);
  assert.equal(G.priceFor(cl, 'tc'), null);
  assert.deepEqual(cl.priceDates, { rm: '2026-10-01' });
  assert.equal(G.localUrl(cl), `local.html?id=${imedRow.id}`);
  assert.equal(G.localUrl({ source: 'osm', id: 'osm:n1' }), null);

  const ld = G.localJsonLd(est, 'https://x/local.html?cnes=2077485');
  assert.equal(ld['@type'], 'Hospital');
  assert.equal(ld.address.postalCode, '01409-001');
  assert.equal(ld.address.streetAddress, 'Rua Peixoto Gomide, 625');
  assert.deepEqual(ld.geo, { '@type': 'GeoCoordinates', latitude: -23.5598, longitude: -46.6602 });
  assert.ok(!('aggregateRating' in ld), 'sem avaliação, sem nota');
  assert.ok(!('aggregateRating' in G.localJsonLd(est, 'u', { rating: 4, reviews: 0 })));
  assert.deepEqual(G.localJsonLd(est, 'u', { rating: 4.6, reviews: 12 }).aggregateRating, { '@type': 'AggregateRating', ratingValue: 4.6, reviewCount: 12, bestRating: 5, worstRating: 1 });
  assert.equal(G.localJsonLd(cl, 'u')['@type'], 'DiagnosticLab');
  assert.equal(G.localJsonLd(cl, 'u').address.streetAddress, 'Av. Paulista, 1000, Bela Vista');
  assert.ok(!('geo' in G.localJsonLd(noGeo, 'u')));
});

test('área inteira: distâncias até 50 km e contagem no formato do Brasil', () => {
  assert.deepEqual(G.RADII, [1000, 2000, 5000, 10000, 20000, 50000]);
  assert.equal(G.DEFAULT_FILTERS.radius, 5000, '5 km continua sendo o padrão');
  assert.equal(G.formatCount(3158), '3.158');
  assert.equal(G.formatCount(3000), '3.000');
  assert.equal(G.formatCount(999), '999');
  assert.equal(G.formatCount(0), '0');
});

test('área inteira: filtros do banco, chave e parâmetros das funções', () => {
  const o = { lat: -23.561, lng: -46.657 };
  const f = (x) => ({ ...G.DEFAULT_FILTERS, ...x });
  assert.deepEqual(G.areaArgs(o, f({})), { p_lat: -23.561, p_lng: -46.657, p_radius_m: 5000 }, 'sem filtro, sem p_kind/p_exam/p_sus');
  assert.deepEqual(G.areaArgs(o, f({ kind: 'hospital', exam: 'rm', sus: true, radius: 50000 })),
    { p_lat: -23.561, p_lng: -46.657, p_radius_m: 50000, p_kind: 'hospital', p_exam: 'rm', p_sus: true });
  assert.ok(!('p_sus' in G.areaArgs(o, f({ sus: false }))), 'SUS desligado não vira p_sus=false');
  assert.deepEqual(G.areaArgs(o, f({ kind: 'toString', exam: '__proto__' })), { p_lat: -23.561, p_lng: -46.657, p_radius_m: 5000 }, 'valores desconhecidos são ignorados');
  assert.equal(G.hasAreaFilter(f({})), false);
  assert.equal(G.hasAreaFilter(f({ specialty: 'Cardiologia', price: 'ate100', insurance: 'Amil', onlyImed: true })), false, 'esses filtros ficam no navegador');
  assert.equal(G.hasAreaFilter(f({ sus: true })), true);
  assert.equal(G.areaKey(f({})), '5000|||0');
  assert.equal(G.areaKey(f({ kind: 'imagem', sus: true, radius: 2000 })), '2000|imagem||1');
  assert.notEqual(G.areaKey(f({ exam: 'rm' })), G.areaKey(f({ exam: 'tc' })));
  assert.equal(G.areaKey(f({ specialty: 'Cardiologia', sort: 'name' })), G.areaKey(f({})), 'especialidade e ordem não mudam a consulta');
  assert.equal(G.onlyPartnerFilter(f({})), false);
  assert.equal(G.onlyPartnerFilter(f({ price: 'ate100' })), true);
  assert.equal(G.onlyPartnerFilter(f({ insurance: 'Amil' })), true);
  assert.equal(G.onlyPartnerFilter(f({ onlyImed: true })), true);
});

test('área inteira: total vindo do banco e pontos do mapa', () => {
  assert.equal(G.rowsTotal([{ cnes: '1', total: 3158 }, { cnes: '2', total: 3158 }]), 3158);
  assert.equal(G.rowsTotal([{ cnes: '1', total: '42' }]), 42);
  assert.equal(G.rowsTotal([]), null, 'sem linhas, total desconhecido');
  assert.equal(G.rowsTotal([{ cnes: '1' }]), null, 'sem a coluna, total desconhecido');
  assert.equal(G.rowsTotal(null), null);
  const { points, total } = G.normalizePoints([
    { cnes: '2077485', kind: 'hospital', lat: -23.5598, lng: -46.6602, total: 4 },
    { cnes: '2077485', kind: 'hospital', lat: -23.5598, lng: -46.6602, total: 4 },
    { cnes: '6543210', kind: 'desconhecido', lat: '-23.5655', lng: '-46.652', total: 4 },
    { cnes: '12', kind: 'clinica', lat: -23.5, lng: -46.6, total: 4 },
    { cnes: '7654321', kind: 'clinica', lat: null, lng: -46.6, total: 4 },
  ]);
  assert.equal(total, 4, 'o total é o do banco, mesmo com linhas descartadas');
  assert.deepEqual(points, [
    { cnes: '2077485', kind: 'hospital', lat: -23.5598, lng: -46.6602 },
    { cnes: '6543210', kind: 'clinica', lat: -23.5655, lng: -46.652 },
  ], 'sem repetir, sem código inválido e sem posição vazia');
  assert.deepEqual(G.normalizePoints('erro'), { points: [], total: null });
  assert.equal(G.POINT_FIELDS, 'cnes,kind,lat,lng,total');
});

test('área inteira: detalhe de um ponto do mapa sem pedir a localização', () => {
  const path = G.pointDetailPath('2077485');
  assert.match(path, /^establishments\?select=.+&cnes=eq\.2077485$/);
  const cols = new URLSearchParams(path.split('?')[1]).get('select').split(',');
  assert.ok(!cols.includes('location'), 'a posição já veio no ponto');
  assert.ok(cols.includes('municipalities(name') && cols.includes('sus'));
  assert.equal(G.pointDetailPath('20774&cnes=eq.1'), null, 'só código CNES válido');
  const p = G.pointToPlace({
    cnes: '2077485', name: 'Hospital Santa Exemplo', kind: 'hospital', address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César',
    cep: '01409001', phone: '(11) 3141-1000', shift: null, open_24h: true, sus: true, services: ['rm'], specialties: [], cnes_updated_at: '2026-09-15',
    location_source: 'cnes', municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 },
  }, { cnes: '2077485', kind: 'hospital', lat: -23.5598, lng: -46.6602 }, PAULISTA);
  assert.equal(p.id, 'cnes:2077485');
  assert.equal(p.source, 'cnes');
  assert.equal(p.address, 'Rua Peixoto Gomide, 625 · Cerqueira César · São Paulo - SP');
  assert.equal(p.cep, '01409-001');
  assert.deepEqual([p.lat, p.lng], [-23.5598, -46.6602]);
  assert.equal(p.distance_m, Math.round(G.haversine(PAULISTA, { lat: -23.5598, lng: -46.6602 })));
  assert.equal(p.maps_url, 'https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/3550302077485');
  assert.deepEqual(p.hours, ['Aberto 24 horas']);
  assert.equal(p.sus, true);
  assert.equal(p.prices, null, 'sem preço inventado');
  const bare = G.pointToPlace({ name: 'Sem Município', kind: 'clinica', municipalities: null }, { cnes: '1234567', lat: -23.5, lng: -46.6 }, PAULISTA);
  assert.equal(bare.id, 'cnes:1234567');
  assert.equal(bare.maps_url, null);
});

test('área inteira: distância do banco (elipsoide), para quem está na borda do raio não sumir da lista', () => {
  const o = { lat: -23.561, lng: -46.657 };
  // ~4.997 m ao norte pelo banco; a conta na esfera daria ~5.017 m (fora dos 5 km).
  const edge = { cnes: '7000001', name: 'Laboratório da Borda', kind: 'laboratorio', lat: o.lat + 0.04512, lng: o.lng, services: [], specialties: [] };
  assert.ok(G.haversine(o, edge) > 5000, 'na esfera passaria de 5 km');
  const c = G.normalizeCnes({ ...edge, distance_m: 4997 }, o);
  assert.equal(c.distance_m, 4997, 'usa a distância que veio do banco');
  assert.equal(G.filterPlaces([c], { ...G.DEFAULT_FILTERS }).length, 1, 'continua dentro dos 5 km, como o banco contou');
  assert.equal(G.normalizeCnes({ ...edge, distance_m: '4997' }, o).distance_m, 4997, 'número em texto também vale');
  for (const d of [undefined, null, '', ' ', 'abc', -1, NaN, true]) {
    assert.equal(G.normalizeCnes({ ...edge, distance_m: d }, o).distance_m, Math.round(G.haversine(o, edge)), `sem distância válida (${String(d)}), calcula`);
  }
  const imed = G.normalizeImedRow({ ...imedRow, distance_m: 4999 }, o);
  assert.equal(imed.distance_m, 4999, 'parceiro também usa a distância do banco');
  assert.equal(G.normalizeImedRow({ ...imedRow, distance_m: undefined }, PAULISTA).distance_m, Math.round(G.haversine(PAULISTA, imedRow)));
  assert.equal(G.rowDistance({ lat: o.lat, lng: o.lng, distance_m: 0 }, o), 0, 'zero é distância válida');
});

test('área inteira: páginas de 50 e texto do botão "Ver mais"', () => {
  // Os 250 que vieram com a busca: as primeiras páginas não precisam ir ao banco.
  assert.deepEqual(G.pagerState({ view: 50, loaded: 250, served: 250, exhausted: false }, 3158), { visible: 50, next: 50, more: true, fetch: false });
  // Acabaram os já baixados: a próxima página vem do banco.
  assert.deepEqual(G.pagerState({ view: 250, loaded: 250, served: 250, exhausted: false }, 3158), { visible: 250, next: 50, more: true, fetch: true });
  // Últimos da área.
  assert.deepEqual(G.pagerState({ view: 3150, loaded: 3150, served: 3150, exhausted: false }, 3158), { visible: 3150, next: 8, more: true, fetch: true });
  assert.equal(G.pagerState({ view: 3200, loaded: 3158, served: 3158, exhausted: false }, 3158).more, false, 'tudo na tela');
  assert.equal(G.pagerState({ view: 50, loaded: 40, served: 40, exhausted: true }, null).more, false, 'o banco não tem mais');
  assert.deepEqual(G.pagerState({ view: 250, loaded: 250, served: 250, exhausted: false }, null), { visible: 250, next: 50, more: true, fetch: true }, 'sem total, tenta mais uma página');
  assert.deepEqual(G.pagerState({ view: 50, loaded: 60, served: 60, exhausted: true }, 60), { visible: 50, next: 10, more: true, fetch: false });
  assert.equal(G.moreLabel(50, 3158), 'Ver mais 50 (de 3.158)');
  assert.equal(G.moreLabel(8, null), 'Ver mais 8');
});
