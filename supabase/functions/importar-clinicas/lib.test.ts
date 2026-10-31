// Testes do importador do CNES. Rodar com: node --experimental-strip-types --test supabase/functions/importar-clinicas/lib.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptedKeys, addressQuery, cityFromReverse, classify, cleanPhone, hasKey, keyHeaders, mapCnesRows, nameKey, namedKeys,
  pickAddressResult, PUBLISHABLE_VARS, publishableKey, SECRET_VARS, secretKey, shiftInfo, titleCase, validLocations, type CnesRow,
} from './lib.ts';

const base = (o: Partial<CnesRow>): CnesRow => ({
  codigo_cnes: 1234567, nome_fantasia: 'LAB TESTE', nome_razao_social: 'LAB TESTE LTDA', codigo_tipo_unidade: 39,
  endereco_estabelecimento: 'AV ANGELICA', numero_estabelecimento: '916', bairro_estabelecimento: 'SANTA CECILIA',
  codigo_cep_estabelecimento: '01227000', numero_telefone_estabelecimento: '1122931180',
  latitude_estabelecimento_decimo_grau: -23.54079965, longitude_estabelecimento_decimo_grau: -46.656027148,
  descricao_turno_atendimento: 'ATENDIMENTOS NOS TURNOS DA MANHA E A TARDE', estabelecimento_faz_atendimento_ambulatorial_sus: 'NAO',
  codigo_motivo_desabilitacao_estabelecimento: null, data_atualizacao: '2025-09-03', ...o,
});

test('nomes do CNES em maiúsculas ficam legíveis', () => {
  assert.equal(titleCase('HOSPITAL SAMARITANO PAULISTA'), 'Hospital Samaritano Paulista');
  assert.equal(titleCase('HC DA FMUSP HOSPITAL DAS CLINICAS SAO PAULO'), 'HC da FMUSP Hospital das Clínicas São Paulo');
  assert.equal(titleCase('CDI VILA MARIANA LTDA'), 'CDI Vila Mariana LTDA');
  assert.equal(titleCase('RUA DR OVIDIO PIRES DE CAMPOS'), 'Rua Dr Ovídio Pires de Campos');
  assert.equal(titleCase('LABORATORIO DE ANALISES (SAUDE)'), 'Laboratório de Análises (Saúde)');
  assert.equal(titleCase('HOSPITAL DE CAMPANHA ANHEMBI P 38'), 'Hospital de Campanha Anhembi P 38');
  assert.equal(titleCase('  '), null);
});

test('classifica pelo tipo do CNES e pelo nome', () => {
  assert.equal(classify(5, 'HOSPITAL OSWALDO CRUZ'), 'hospital');
  assert.equal(classify(39, 'CENTRO DE DIAGNOSTICO POR IMAGEM'), 'imagem');
  assert.equal(classify(39, 'QUALITY LAB ANALISES CLINICAS'), 'laboratorio');
  assert.equal(classify(39, 'LIFE CONCIERGE'), 'laboratorio');
  assert.equal(classify(39, 'CENTRO DE HEMODIALISE'), 'clinica');
  assert.equal(classify(36, 'CLINICA DE FISIOTERAPIA MOVIMENTO'), null, 'terapias sem médico ficam de fora');
  assert.equal(classify(36, 'CENTRO INTEGRADO DE IMPLANTE'), null);
  assert.equal(classify(36, 'CLINICA OHR PSIQUIATRIA'), 'clinica', 'psiquiatria é médica');
  assert.equal(classify(36, 'ON MED'), 'clinica');
  assert.equal(classify(36, 'GRANADA ODONTOLOGIA'), null);
  assert.equal(classify(7, 'HOSPITAL ODONTOLOGICO'), null);
});

test('turno de atendimento sem inventar horário', () => {
  assert.deepEqual(shiftInfo('ATENDIMENTOS NOS TURNOS DA MANHA E A TARDE'), { shift: 'Manhã e tarde', open_24h: false });
  assert.deepEqual(shiftInfo('ATENDIMENTO NOS TURNOS DA MANHA, TARDE E NOITE'), { shift: 'Manhã, tarde e noite', open_24h: false });
  assert.deepEqual(shiftInfo('ATENDIMENTO CONTINUO DE 24 HORAS/DIA (PLANTAO:INCLUI SABADOS, DOMINGOS E FERIADOS)'), { shift: 'Aberto 24 horas', open_24h: true });
  assert.deepEqual(shiftInfo('ATENDIMENTO SOMENTE PELA MANHA'), { shift: 'Somente manhã', open_24h: false });
  assert.deepEqual(shiftInfo(null), { shift: null, open_24h: false });
});

test('telefones do CNES', () => {
  assert.equal(cleanPhone('1122931180'), '(11) 2293-1180');
  assert.equal(cleanPhone('(11)3087-5456'), '(11) 3087-5456');
  assert.equal(cleanPhone('11987654321'), '(11) 98765-4321');
  assert.equal(cleanPhone('31458111'), '3145-8111');
  assert.equal(cleanPhone('5511987654321'), '(11) 98765-4321');
  assert.equal(cleanPhone('08007071234'), '0800 707 1234');
  assert.equal(cleanPhone('0000000000'), null);
  assert.equal(cleanPhone('123'), null);
});

test('descarta coordenadas de enfeite, imprecisas e fora da cidade', () => {
  const pts = [
    { lat: -23.5407996, lng: -46.6560271 }, { lat: -23.5611, lng: -46.6559 }, { lat: -23.5895, lng: -46.6341 },
    { lat: -23.6012, lng: -46.6641 }, { lat: -23.5456, lng: -46.6391 }, { lat: -23.5701, lng: -46.6622 },
    { lat: -23.548, lng: -46.636 }, { lat: -23.548, lng: -46.636 }, { lat: -23.548, lng: -46.636 },
    { lat: -23.4767768, lng: -47.5081115 },
    { lat: -23.5, lng: -46.6 },
    { lat: null, lng: null },
    { lat: 40.7, lng: -74.0 },
  ];
  const { ok } = validLocations(pts);
  assert.deepEqual(ok, [true, true, true, true, true, true, false, false, false, false, false, false, false]);
});

test('mesmo prédio com coordenada precisa não é tratado como enfeite', () => {
  const same = { lat: -23.5651234, lng: -46.6521234 };
  const { ok } = validLocations([same, same, same, same, { lat: -23.5712, lng: -46.6623 }]);
  assert.deepEqual(ok, [true, true, true, true, true]);
});

test('converte as linhas e deixa de fora desativados e odontologia', () => {
  const { rows } = mapCnesRows([
    base({ codigo_cnes: 9642072, nome_fantasia: 'QUALITY LAB', nome_razao_social: 'QUALITY LAB ANALISES CLINICAS LTDA' }),
    base({ codigo_cnes: 1111111, nome_fantasia: 'HOSPITAL FECHADO', codigo_tipo_unidade: 5, codigo_motivo_desabilitacao_estabelecimento: '04' }),
    base({ codigo_cnes: 2222222, nome_fantasia: 'GRANADA ODONTOLOGIA', codigo_tipo_unidade: 36 }),
    base({ codigo_cnes: 2078015, nome_fantasia: 'CENTRO DE RESSONANCIA E TOMOGRAFIA', codigo_tipo_unidade: 39, numero_estabelecimento: 'S/N', descricao_turno_atendimento: 'ATENDIMENTO CONTINUO DE 24 HORAS/DIA', estabelecimento_faz_atendimento_ambulatorial_sus: 'SIM', latitude_estabelecimento_decimo_grau: null, longitude_estabelecimento_decimo_grau: null }),
  ]);
  assert.deepEqual(rows.map((r) => r.cnes), ['9642072', '2078015']);
  const lab = rows[0];
  assert.equal(lab.name, 'Quality Lab');
  assert.equal(lab.legal_name, 'Quality Lab Análises Clínicas LTDA');
  assert.equal(lab.kind, 'laboratorio');
  assert.deepEqual(lab.services, ['lab']);
  assert.equal(lab.address_line, 'Av Angélica, 916');
  assert.equal(lab.neighborhood, 'Santa Cecília');
  assert.equal(lab.cep, '01227000');
  assert.equal(lab.phone, '(11) 2293-1180');
  assert.equal(lab.shift, 'Manhã e tarde');
  assert.equal(lab.sus, false);
  assert.equal(lab.lat, -23.54079965);
  const img = rows[1];
  assert.equal(img.kind, 'imagem');
  assert.deepEqual(img.services, ['rm', 'tc']);
  assert.equal(img.address_line, 'Av Angélica', 'sem número quando é S/N');
  assert.equal(img.open_24h, true);
  assert.equal(img.sus, true);
  assert.equal(img.lat, null, 'sem coordenada: vai ser localizado pelo endereço');
  assert.ok(rows.every((r) => !('price' in r) && !('hours' in r)), 'nada de preço ou horário inventado');
});

test('cidade e estado pela busca reversa', () => {
  assert.deepEqual(cityFromReverse({ features: [{ properties: { countrycode: 'BR', city: 'São Paulo', state: 'São Paulo' } }] }), { city: 'São Paulo', uf: 'SP' });
  assert.deepEqual(cityFromReverse({ features: [{ properties: { countrycode: 'BR', county: 'Brasília', state: 'Distrito Federal' } }] }), { city: 'Brasília', uf: 'DF' });
  assert.equal(cityFromReverse({ features: [{ properties: { countrycode: 'AR', city: 'Buenos Aires', state: 'Buenos Aires' } }] }), null);
  assert.equal(nameKey("Santa Bárbara d'Oeste"), 'santa barbara d oeste');
});

test('localiza pelo endereço só dentro do município certo', () => {
  const json = { features: [
    { properties: { countrycode: 'BR', state: 'São Paulo', city: 'Campinas', type: 'street' }, geometry: { coordinates: [-47.06, -22.9] as [number, number] } },
    { properties: { countrycode: 'BR', state: 'São Paulo', city: 'São Paulo', type: 'city' }, geometry: { coordinates: [-46.63, -23.55] as [number, number] } },
    { properties: { countrycode: 'BR', state: 'São Paulo', city: 'São Paulo', type: 'house' }, geometry: { coordinates: [-46.656, -23.5408] as [number, number] } },
  ] };
  assert.deepEqual(pickAddressResult(json, 'sao paulo', 'SP'), { lat: -23.5408, lng: -46.656 });
  assert.equal(pickAddressResult({ features: [json.features[0]] }, 'sao paulo', 'SP'), null);
  assert.equal(addressQuery({ address_line: 'Av Angelica, 916', neighborhood: 'Santa Cecilia' }, 'São Paulo', 'SP'), 'Av Angelica, 916, Santa Cecilia, São Paulo, SP');
  assert.equal(addressQuery({ address_line: null, neighborhood: 'Centro' }, 'São Paulo', 'SP'), null);
});

/* ---------------- chaves do Supabase: quem pode chamar o importador e como ele chama o banco ---------------- */
// Valores de mentira (nenhuma chave de verdade nos testes). A antiga é um token (JWT) no formato "a.b.c".
const SEC = 'sb_secret_falsa_1';
const SEC2 = 'sb_secret_falsa_2';
const PUB = 'sb_publishable_falsa_1';
const ANTIGA_SERVICO = 'cabecalho-falso.servico-falso.assinatura-falsa';
const envDe = (vars: Record<string, string>) => (name: string): string | undefined => vars[name];

test('chaves: a secreta vem de SUPABASE_SECRET_KEYS (JSON por nome), com volta para a service_role antiga', () => {
  const ambos = envDe({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: SEC }), SUPABASE_SERVICE_ROLE_KEY: ANTIGA_SERVICO });
  assert.deepEqual(secretKey(ambos), { key: SEC, legacy: false }, 'a nova ganha');
  assert.deepEqual(keyHeaders(secretKey(ambos)), { apikey: SEC }, 'nova: só no apikey, nunca em Bearer');
  const antiga = envDe({ SUPABASE_SERVICE_ROLE_KEY: ANTIGA_SERVICO });
  assert.deepEqual(secretKey(antiga), { key: ANTIGA_SERVICO, legacy: true }, 'sem a nova (ausente): a antiga');
  assert.deepEqual(keyHeaders(secretKey(antiga)), { apikey: ANTIGA_SERVICO, Authorization: `Bearer ${ANTIGA_SERVICO}` }, 'antiga: como antes');
  assert.deepEqual(secretKey(envDe({ SUPABASE_SECRET_KEYS: 'não é JSON', SUPABASE_SERVICE_ROLE_KEY: ANTIGA_SERVICO })), { key: ANTIGA_SERVICO, legacy: true }, 'JSON quebrado: a antiga');
  assert.equal(secretKey(envDe({})), null, 'nenhuma: null');
  assert.deepEqual(namedKeys(JSON.stringify({ default: SEC, fila: SEC2 })), { default: SEC, fila: SEC2 });
  assert.deepEqual(publishableKey(envDe({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUB }) })), { key: PUB, legacy: false });
});

test('chaves: o importador aceita a secreta no apikey, a service_role antiga (Bearer) e mais nada', () => {
  const keys = acceptedKeys(envDe({
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: SEC, fila: SEC2 }), SUPABASE_SERVICE_ROLE_KEY: ANTIGA_SERVICO,
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUB }),
  }), SECRET_VARS);
  assert.deepEqual(keys, [SEC, SEC2, ANTIGA_SERVICO], 'as secretas de qualquer nome e a antiga; a publishable não entra');
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(hasKey(h({ apikey: SEC }), keys), true, 'clinicas-proximas nova');
  assert.equal(hasKey(h({ apikey: SEC2 }), keys), true, 'outra chave secreta do projeto');
  assert.equal(hasKey(h({ Authorization: `Bearer ${ANTIGA_SERVICO}` }), keys), true, 'clinicas-proximas antiga (até ser publicada de novo)');
  assert.equal(hasKey(h({ apikey: ANTIGA_SERVICO, Authorization: `Bearer ${ANTIGA_SERVICO}` }), keys), true, 'nova, na volta para a antiga');
  assert.equal(hasKey(h({ Authorization: `Bearer ${SEC}` }), keys), false, 'secreta nova em Bearer não vale');
  assert.equal(hasKey(h({ apikey: PUB }), keys), false, 'chave pública não chama o importador');
  assert.equal(hasKey(h({ apikey: SEC + 'x' }), keys), false);
  assert.equal(hasKey(h({}), keys), false);
  assert.deepEqual(acceptedKeys(envDe({}), SECRET_VARS), [], 'sem chave no ambiente: só o token interno da fila (x-imed-token) passa');
  assert.deepEqual(acceptedKeys(envDe({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUB }) }), PUBLISHABLE_VARS), [PUB]);
});
