// Testes das partes puras do mapa 3D do topo (assets/js/hero3d.js): estilo (claro e escuro), área dos ladrilhos e
// sombras longas; e a regra da página (CSP, créditos do mapa, biblioteca servida pelo próprio site).
// Rodar com: node --test tests/hero3d.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estilo, area, sombras, FONTE } from '../assets/js/hero3d.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const PAULISTA = { lat: -23.565, lng: -46.652 };
const m = (o, dLat, dLng) => [o.lng + dLng, o.lat + dLat];

test('estilo: só ladrilhos do OpenFreeMap (sem fontes nem ícones de fora), prédios em 3D com a altura da camada', () => {
  for (const tema of ['claro', 'escuro']) {
    const s = estilo(tema, area(PAULISTA, 1000));
    assert.equal(s.version, 8);
    assert.equal(s.glyphs, undefined, `${tema}: sem fontes (letras) do OpenFreeMap`);
    assert.equal(s.sprite, undefined, `${tema}: sem ícones do OpenFreeMap`);
    assert.equal(s.sources.omt.url, FONTE);
    assert.equal(FONTE, 'https://tiles.openfreemap.org/planet');
    assert.equal(s.sources.omt.minzoom, 14, 'só os ladrilhos completos (z14), onde estão os prédios');
    assert.ok(Array.isArray(s.sources.omt.bounds), 'área limitada em volta do ponto');
    // Nenhum outro endereço de internet no estilo.
    const urls = JSON.stringify(s).match(/https?:\/\/[^"]+/g) || [];
    assert.deepEqual([...new Set(urls)], [FONTE], `${tema}: só o OpenFreeMap`);
    const ids = s.layers.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length, 'ids únicos');
    const predios = s.layers.find((l) => l.id === 'predios');
    assert.equal(predios.type, 'fill-extrusion');
    assert.equal(predios['source-layer'], 'building');
    assert.deepEqual(predios.filter, ['!', ['has', 'hide_3d']], 'partes escondidas do OpenMapTiles ficam de fora');
    assert.deepEqual(predios.paint['fill-extrusion-height'], ['coalesce', ['get', 'render_height'], 0], 'altura da camada (sem altura no OSM: a padrão da camada)');
    assert.deepEqual(predios.paint['fill-extrusion-base'], ['coalesce', ['get', 'render_min_height'], 0]);
    assert.equal(ids[ids.length - 1], 'predios', 'prédios por cima de tudo');
    assert.ok(ids.indexOf('sombras') < ids.indexOf('predios') && ids.indexOf('contato') < ids.indexOf('predios'), 'sombras no chão');
    assert.ok(s.light && s.light.anchor === 'map', 'luz presa ao mapa (o sol não gira com a câmera)');
    // Toda camada de ladrilho usa uma camada que existe no OpenMapTiles.
    const OMT = new Set(['building', 'transportation', 'water', 'waterway', 'park', 'landuse', 'landcover']);
    for (const l of s.layers.filter((x) => x.source === 'omt')) assert.ok(OMT.has(l['source-layer']), `${l.id}: ${l['source-layer']}`);
    // Nenhuma camada de letras (o mapa não baixa fontes).
    assert.ok(!s.layers.some((l) => l.type === 'symbol'));
  }
  assert.notDeepEqual(estilo('claro').layers.find((l) => l.id === 'terra').paint, estilo('escuro').layers.find((l) => l.id === 'terra').paint, 'claro e escuro diferentes');
});

test('área dos ladrilhos: quadrado de ~raio metros em volta do ponto', () => {
  const [w, s, e, n] = area(PAULISTA, 1000);
  assert.ok(Math.abs((n - s) / 2 * 110574 - 1000) < 5, 'altura');
  assert.ok(Math.abs((e - w) / 2 * 111320 * Math.cos(PAULISTA.lat * Math.PI / 180) - 1000) < 5, 'largura');
  assert.ok(w < PAULISTA.lng && e > PAULISTA.lng && s < PAULISTA.lat && n > PAULISTA.lat);
});

test('sombras longas: só prédios altos, do lado oposto ao sol, do tamanho da altura; sem repetir', () => {
  const lado = 20 / 110574; // ~20 m
  const quadrado = (o) => [[m(o, 0, 0), m(o, 0, lado), m(o, -lado, lado), m(o, -lado, 0), m(o, 0, 0)]];
  const f = (h, h0 = 0, extra = {}) => ({ properties: { render_height: h, render_min_height: h0, ...extra }, geometry: { type: 'Polygon', coordinates: quadrado(PAULISTA) } });
  const fc = sombras([f(40), f(40), f(5), f(30, 0, { hide_3d: true }), { properties: { render_height: 50 }, geometry: { type: 'Point', coordinates: [0, 0] } }], PAULISTA);
  assert.equal(fc.features.length, 1, 'o prédio repetido (em dois ladrilhos) conta uma vez; baixo, escondido e ponto ficam de fora');
  const anel = fc.features[0].geometry.coordinates[0];
  assert.deepEqual(anel[0], anel[anel.length - 1], 'anel fechado');
  // O ponto mais longe da sombra fica a ~altura × tan(polar) metros do prédio.
  const kx = 111320 * Math.cos(PAULISTA.lat * Math.PI / 180), ky = 110574;
  const dist = Math.max(...anel.map(([x, y]) => Math.hypot((x - PAULISTA.lng) * kx, (y - PAULISTA.lat) * ky)));
  assert.ok(dist > 40 && dist < 120, `comprimento da sombra (${dist.toFixed(0)} m)`);
  // Parte suspensa (render_min_height): a sombra começa longe do pé.
  const alta = sombras([f(60, 40)], PAULISTA).features[0].geometry.coordinates[0];
  const perto = Math.min(...alta.map(([x, y]) => Math.hypot((x - PAULISTA.lng) * kx, (y - PAULISTA.lat) * ky)));
  assert.ok(perto > 20, `sombra da parte suspensa longe do pé (${perto.toFixed(0)} m)`);
  // Limite: ficam as dos prédios mais perto do ponto.
  const muitos = Array.from({ length: 30 }, (_, i) => ({ properties: { render_height: 20 + i }, geometry: { type: 'Polygon', coordinates: quadrado({ lat: PAULISTA.lat + i * .001, lng: PAULISTA.lng }) } }));
  const poucos = sombras(muitos, PAULISTA, 5).features;
  assert.equal(poucos.length, 5);
  assert.ok(poucos.every((g) => Math.abs(g.geometry.coordinates[0][0][1] - PAULISTA.lat) < .006), 'os mais perto do ponto');
});

test('página: CSP abre só o OpenFreeMap no connect-src, biblioteca do próprio site, créditos do mapa', () => {
  const html = read('index.html');
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1];
  assert.match(csp, /script-src 'self';/, 'scripts só do próprio site');
  assert.ok(!/unsafe-eval/.test(csp), "sem 'unsafe-eval'");
  assert.match(csp, /connect-src 'self' https:\/\/pyoqiecupxhdzigjudyd\.supabase\.co https:\/\/tiles\.openfreemap\.org;/);
  assert.ok(!/worker-src/.test(csp), "o trabalhador do mapa é do próprio site: vale o script-src 'self' (sem blob:)");
  // Créditos: OpenStreetMap (link da página de direitos), OpenMapTiles e OpenFreeMap.
  const cred = html.match(/<p class="h3d-attrib" id="heroAttrib" hidden>([\s\S]*?)<\/p>/)[1];
  assert.match(cred, /href="https:\/\/www\.openstreetmap\.org\/copyright"/);
  assert.match(cred, /OpenMapTiles/);
  assert.match(cred, /OpenFreeMap/);
  // A biblioteca está no repositório, na versão registrada, com a licença; o three.js saiu.
  for (const f of ['maplibre-gl.js', 'maplibre-gl-worker.js', 'LICENSE.txt', 'LEIA-ME.md']) assert.ok(existsSync(join(ROOT, 'assets/vendor/maplibre', f)), f);
  assert.match(read('assets/vendor/maplibre/LEIA-ME.md'), /# MapLibre GL JS 6\.16\.0/);
  assert.match(read('assets/vendor/maplibre/maplibre-gl.js').slice(0, 300), /MapLibre GL JS[\s\S]*v6\.16\.0/);
  assert.match(read('assets/js/hero3d.js'), /const MAPLIBRE = '6\.16\.0'/);
  assert.ok(!existsSync(join(ROOT, 'assets/vendor/three.module.min.js')), 'three.js removido');
  assert.ok(statSync(join(ROOT, 'assets/vendor/maplibre/maplibre-gl.js')).size < 1.3e6);
  // Fora do pré-cache do service worker (aparelho fraco não baixa).
  const core = read('sw.js').match(/const CORE = \[([\s\S]*?)\];/)[1];
  assert.ok(!/maplibre|hero3d/.test(core));
});
