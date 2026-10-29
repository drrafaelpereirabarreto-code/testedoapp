// Testes da função de busca. Rodar com: node --experimental-strip-types --test supabase/functions/clinicas-proximas/lib.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampRadius, geocode, haversine, isCep, isValidCoord, parseGoogle, roundCoord, searchGoogle, type Fetch } from './lib.ts';

const PAULISTA = { lat: -23.565, lng: -46.652 };
const UA = 'IMED-test';
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const photon = (props: Record<string, string>, lng: number, lat: number) =>
  ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { countrycode: 'BR', ...props }, geometry: { type: 'Point', coordinates: [lng, lat] } }] });

test('busca no Google Places com a chave só no cabeçalho do servidor', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fake: Fetch = async (url, init) => {
    calls.push({ url, init });
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers['X-Goog-Api-Key'], 'CHAVE');
    assert.match(headers['X-Goog-FieldMask'], /places\.nationalPhoneNumber/);
    if (url.endsWith(':searchText')) {
      return reply({ places: [
        { id: 'a', displayName: { text: 'Lumen Diagnóstico' }, location: { latitude: -23.566, longitude: -46.653 }, types: ['doctor'], businessStatus: 'OPERATIONAL', regularOpeningHours: { weekdayDescriptions: ['segunda-feira: 07:00–19:00'] } },
      ] });
    }
    return reply({ places: [
      { id: 'a', displayName: { text: 'Lumen Diagnóstico' }, location: { latitude: -23.566, longitude: -46.653 }, types: ['doctor'] },
      { id: 'c', displayName: { text: 'Laboratório Vida' }, location: { latitude: -23.567, longitude: -46.654 }, types: ['medical_lab'], nationalPhoneNumber: '(11) 3333-4444' },
      { id: 'd', displayName: { text: 'Hospital Fechado' }, location: { latitude: -23.567, longitude: -46.654 }, types: ['hospital'], businessStatus: 'CLOSED_PERMANENTLY' },
      { id: 'e', displayName: { text: 'Clínica Longe Demais' }, location: { latitude: -23.7, longitude: -46.9 }, types: ['doctor'] },
    ] });
  };
  const places = await searchGoogle(fake, 'CHAVE', PAULISTA, 3000);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => !c.url.includes('CHAVE')), 'a chave não pode ir na URL');
  assert.deepEqual(places.map((p) => p.id), ['google:a', 'google:c']);
  assert.equal(places[0].hint, 'imagem', 'veio da busca por diagnóstico por imagem');
  assert.deepEqual(places[0].hours, ['segunda-feira: 07:00–19:00']);
  assert.deepEqual(places[1].types, ['medical_lab']);
  assert.equal(places[1].phone, '(11) 3333-4444');
  assert.equal(places[1].hours, null, 'sem horário informado, não inventa');
});

test('ignora estabelecimentos do Google sem nome ou localização', () => {
  assert.equal(parseGoogle([{ id: 'x', displayName: { text: 'Sem local' } }], PAULISTA, null).length, 0);
  assert.equal(parseGoogle([{ id: 'y', location: { latitude: -23.5, longitude: -46.6 } }], PAULISTA, null).length, 0);
});

test('converte CEP em coordenadas pelo ViaCEP e Photon', async () => {
  const urls: string[] = [];
  const fake: Fetch = async (url) => {
    urls.push(url);
    if (url.includes('viacep')) return reply({ logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' });
    return reply(photon({ name: 'Avenida Paulista', type: 'street', city: 'São Paulo', state: 'São Paulo' }, -46.6559, -23.5614));
  };
  const g = await geocode(fake, '01310-100', '', UA);
  assert.deepEqual(g, { lat: -23.5614, lng: -46.6559, label: 'Avenida Paulista, Bela Vista, São Paulo - SP', precision: 'cep', provider: 'osm' });
  assert.ok(urls[0].includes('viacep.com.br/ws/01310100/json'));
  assert.ok(urls[1].startsWith('https://photon.komoot.io/api/?q=Avenida%20Paulista%2C%20Bela%20Vista%2C%20S%C3%A3o%20Paulo%2C%20SP'));
});

test('não troca a rua pelo centro da cidade: cai para o bairro', async () => {
  let n = 0;
  const fake: Fetch = async (url) => {
    if (url.includes('viacep')) return reply({ logradouro: 'Rua Nova Sem Mapa', bairro: 'Moema', localidade: 'São Paulo', uf: 'SP' });
    n += 1;
    if (n === 1) return reply(photon({ name: 'São Paulo', type: 'city', state: 'São Paulo' }, -46.63, -23.55));
    return reply(photon({ name: 'Moema', type: 'district', city: 'São Paulo', state: 'São Paulo' }, -46.664, -23.601));
  };
  const g = await geocode(fake, '04077000', '', UA);
  assert.equal(g?.precision, 'bairro');
  assert.equal(g?.label, 'Moema, São Paulo - SP');
  assert.equal(g?.lat, -23.601);
});

test('ViaCEP fora do ar: usa a BrasilAPI e as coordenadas dela', async () => {
  const fake: Fetch = async (url) => {
    if (url.includes('viacep')) throw new TypeError('fetch failed');
    assert.ok(url.includes('brasilapi.com.br/api/cep/v2/01310100'));
    return reply({ cep: '01310100', state: 'SP', city: 'São Paulo', neighborhood: 'Bela Vista', street: 'Avenida Paulista', location: { type: 'Point', coordinates: { longitude: '-46.6544', latitude: '-23.5632' } } });
  };
  const g = await geocode(fake, '01310100', '', UA);
  assert.deepEqual(g, { lat: -23.5632, lng: -46.6544, label: 'Avenida Paulista, Bela Vista, São Paulo - SP', precision: 'cep', provider: 'brasilapi' });
});

test('CEP inexistente não vira localização (nem pela BrasilAPI)', async () => {
  const urls: string[] = [];
  const fake: Fetch = async (url) => {
    urls.push(url);
    return url.includes('viacep') ? reply({ erro: 'true' }) : reply({ city: 'Outra cidade', state: 'PR' });
  };
  assert.equal(await geocode(fake, '99999-999', '', UA), null);
  assert.equal(urls.length, 1, 'não consulta a BrasilAPI quando o ViaCEP diz que o CEP não existe');
  const down: Fetch = async (url) => (url.includes('viacep') ? reply({}, 503) : reply({ message: 'CEP não encontrado' }, 404));
  assert.equal(await geocode(down, '99999-999', '', UA), null);
});

test('cidade pelo Photon, só no Brasil', async () => {
  const fake: Fetch = async (url, init) => {
    assert.match(url, /bbox=-74\.1,-33\.9,-34\.7,5\.4/);
    assert.equal((init?.headers as Record<string, string>)['User-Agent'], UA);
    return reply({ features: [
      { properties: { name: 'Campinas', countrycode: 'US', type: 'city' }, geometry: { coordinates: [-80, 30] } },
      { properties: { name: 'Campinas', countrycode: 'BR', type: 'city', state: 'São Paulo' }, geometry: { coordinates: [-47.06, -22.9] } },
    ] });
  };
  assert.deepEqual(await geocode(fake, 'Campinas', '', UA), { lat: -22.9, lng: -47.06, label: 'Campinas - SP', precision: 'cidade', provider: 'osm' });
});

test('endereço com número pelo Photon', async () => {
  const fake: Fetch = async () => reply(photon({ name: 'Rua Augusta', street: 'Rua Augusta', housenumber: '500', type: 'house', district: 'Consolação', city: 'São Paulo', state: 'São Paulo' }, -46.65, -23.55));
  const g = await geocode(fake, 'Rua Augusta 500, São Paulo', '', UA);
  assert.equal(g?.label, 'Rua Augusta, 500, Consolação, São Paulo - SP');
  assert.equal(g?.precision, 'endereco');
});

test('cidade pelo Google Geocoding quando há chave', async () => {
  const fake: Fetch = async (url) => {
    assert.match(url, /maps\.googleapis\.com\/maps\/api\/geocode\/json/);
    assert.match(url, /components=country:BR/);
    return reply({ status: 'OK', results: [{ formatted_address: 'Campinas - SP, Brasil', types: ['locality', 'political'], geometry: { location: { lat: -22.9, lng: -47.06 } } }] });
  };
  assert.deepEqual(await geocode(fake, 'Campinas', 'CHAVE', UA), { lat: -22.9, lng: -47.06, label: 'Campinas - SP', precision: 'cidade', provider: 'google' });
});

test('endereço não encontrado e geocodificador fora do ar', async () => {
  assert.equal(await geocode(async () => reply({ features: [] }), 'Rua que não existe 999999', '', UA), null);
  await assert.rejects(geocode(async () => reply({}, 503), 'Campinas', '', UA), /photon 503/);
  await assert.rejects(geocode(async () => reply({ status: 'REQUEST_DENIED' }), 'Campinas', 'CHAVE', UA), /REQUEST_DENIED/);
});

test('valida e arredonda coordenadas e raio', () => {
  assert.equal(isValidCoord(-23.5, -46.6), true);
  assert.equal(isValidCoord(123, 0), false);
  assert.equal(isValidCoord(Number.NaN, 0), false);
  assert.equal(roundCoord(-23.5650123456), -23.565);
  assert.equal(clampRadius(100), 500);
  assert.equal(clampRadius(999999), 20000);
  assert.equal(clampRadius('abc'), 5000);
  assert.equal(isCep('01310-100'), true);
  assert.equal(isCep('Campinas'), false);
  assert.ok(Math.abs(haversine(PAULISTA, { lat: -23.5614, lng: -46.6559 }) - 563) < 5);
});
