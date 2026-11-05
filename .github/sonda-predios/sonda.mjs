// Sonda temporária (apagar do ramo no fim): mede fontes de prédios para o mapa 3D.
// Para cada fonte: CORS, pedido parcial (Range), cache, tamanho; e quantos prédios num raio de 500 m.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { PMTiles, FetchSource } = await import('pmtiles');
const { VectorTile } = require('@mapbox/vector-tile');
const Pbf = require('pbf');

const ORIGIN = 'https://drrafaelpereirabarreto-code.github.io';
const LUGARES = [
  { nome: 'São Paulo, Av. Paulista (controle)', lat: -23.5614, lon: -46.6559 },
  { nome: 'Campinas centro', lat: -22.9056, lon: -47.0608 },
  { nome: 'Copacabana (Rio)', lat: -22.9711, lon: -43.1863 },
  { nome: 'Feira de Santana centro (BA)', lat: -12.2664, lon: -38.9663 },
  { nome: 'Juiz de Fora, São Mateus (MG)', lat: -21.7745, lon: -43.3540 },
];
const RAIO = 500;
const out = { quando: new Date().toISOString(), cabecalhos: {}, fontes: {}, lugares: [] };
const log = (...a) => console.log(...a);

async function cabec(nome, url, extra = {}) {
  const r = { url };
  try {
    const g = await fetch(url, { headers: { Origin: ORIGIN, Range: 'bytes=0-16383', ...extra } });
    r.get = {
      status: g.status,
      acao: g.headers.get('access-control-allow-origin'),
      expose: g.headers.get('access-control-expose-headers'),
      contentRange: g.headers.get('content-range'),
      contentLength: g.headers.get('content-length'),
      cacheControl: g.headers.get('cache-control'),
      etag: g.headers.get('etag'),
      lastModified: g.headers.get('last-modified'),
      server: g.headers.get('server'),
      tipo: g.headers.get('content-type'),
    };
    await g.arrayBuffer().catch(() => {});
    const o = await fetch(url, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' } });
    r.preflight = { status: o.status, acao: o.headers.get('access-control-allow-origin'), allowHeaders: o.headers.get('access-control-allow-headers'), allowMethods: o.headers.get('access-control-allow-methods') };
  } catch (e) { r.erro = String(e); }
  out.cabecalhos[nome] = r;
  log('CABEC', nome, JSON.stringify(r));
  return r;
}

async function texto(url) {
  try { const r = await fetch(url); const t = await r.text(); return { status: r.status, t }; } catch (e) { return { status: 0, t: String(e) }; }
}

// ---------- geometria ----------
const R = 6378137;
function lonlatParaTile(lon, lat, z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return [x, y];
}
function tileParaLonlat(x, y, z) {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return [lon, lat];
}
function dist(lat1, lon1, lat2, lon2) {
  const toR = Math.PI / 180;
  const dlat = (lat2 - lat1) * toR, dlon = (lon2 - lon1) * toR;
  const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dlon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function tilesDoRaio(lat, lon, z, raio) {
  const dLat = raio / 111320, dLon = raio / (111320 * Math.cos((lat * Math.PI) / 180));
  const [x0, y0] = lonlatParaTile(lon - dLon, lat + dLat, z);
  const [x1, y1] = lonlatParaTile(lon + dLon, lat - dLat, z);
  const t = [];
  for (let x = Math.floor(x0); x <= Math.floor(x1); x++) for (let y = Math.floor(y0); y <= Math.floor(y1); y++) t.push([x, y]);
  return t;
}
function pontoNoPoligono(px, py, anel) {
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const xi = anel[i][0], yi = anel[i][1], xj = anel[j][0], yj = anel[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
function areaAnel(a) { let s = 0; for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += (a[j][0] - a[i][0]) * (a[j][1] + a[i][1]); return s / 2; }

// Lê um ladrilho MVT e devolve os prédios (anéis externos em lon/lat, centróide, propriedades), sem repetir os da borda.
function predios(buf, z, x, y, camadas) {
  const vt = new VectorTile(new Pbf(new Uint8Array(buf)));
  const nomes = Object.keys(vt.layers);
  const lista = [];
  for (const nome of nomes) {
    if (camadas && !camadas(nome)) continue;
    const L = vt.layers[nome];
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i);
      if (f.type !== 3) continue;
      const geom = f.loadGeometry();
      // um prédio por anel externo (o ladrilho pode juntar prédios vizinhos num só objeto)
      let sinal = 0;
      const ll = (p) => tileParaLonlat(x + p.x / L.extent, y + p.y / L.extent, z);
      for (const anel of geom) {
        const a = areaAnel(anel.map((p) => [p.x, p.y]));
        if (!a) continue;
        if (!sinal) sinal = Math.sign(a);
        if (Math.sign(a) !== sinal) continue; // buraco
        let cx = 0, cy = 0; for (const p of anel) { cx += p.x; cy += p.y; } cx /= anel.length; cy /= anel.length;
        if (cx < 0 || cy < 0 || cx >= L.extent || cy >= L.extent) continue; // fica no ladrilho vizinho
        const c = ll({ x: cx, y: cy });
        lista.push({ camada: nome, c, anel: anel.map(ll), props: f.properties });
      }
    }
  }
  return { nomes, lista };
}

// ---------- fontes PMTiles ----------
class Medida {
  constructor(url) { this.src = new FetchSource(url); this.bytes = 0; this.pedidos = 0; this.ultimo = 0; }
  getKey() { return this.src.getKey(); }
  async getBytes(off, len, signal, etag) {
    const r = await this.src.getBytes(off, len, signal, etag);
    this.bytes += r.data.byteLength; this.pedidos++; this.ultimo = r.data.byteLength; return r;
  }
}
async function abrirPm(nome, url) {
  const m = new Medida(url);
  const p = new PMTiles(m);
  const f = { url, ok: false };
  try {
    const h = await p.getHeader();
    f.header = { minZoom: h.minZoom, maxZoom: h.maxZoom, tileType: h.tileType, tileCompression: h.tileCompression, numAddressedTiles: h.numAddressedTiles, minLon: h.minLon, minLat: h.minLat, maxLon: h.maxLon, maxLat: h.maxLat, etag: h.etag };
    const md = await p.getMetadata();
    f.metadata = JSON.parse(JSON.stringify(md, (k, v) => (typeof v === 'string' && v.length > 600 ? v.slice(0, 600) + '…' : v)));
    if (f.metadata?.vector_layers) f.metadata.vector_layers = f.metadata.vector_layers.slice(0, 8).map((l) => ({ id: l.id, minzoom: l.minzoom, maxzoom: l.maxzoom, fields: l.fields }));
    f.bytesAbrir = m.bytes; f.pedidosAbrir = m.pedidos;
    f.ok = true;
  } catch (e) { f.erro = String(e); }
  out.fontes[nome] = f;
  log('FONTE', nome, JSON.stringify(f).slice(0, 3000));
  return f.ok ? { p, m, f } : null;
}
async function tilePm(fonte, z, x, y) {
  const antes = fonte.m.bytes, pedAntes = fonte.m.pedidos;
  const r = await fonte.p.getZxy(z, x, y);
  return { buf: r?.data || null, rede: fonte.m.ultimo, redeTotal: fonte.m.bytes - antes, pedidos: fonte.m.pedidos - pedAntes, bruto: r?.data?.byteLength || 0 };
}

// ---------- OpenFreeMap ----------
async function openfreemap() {
  const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
  out.fontes.openfreemap = { tilejson: { tiles: tj.tiles, maxzoom: tj.maxzoom, attribution: tj.attribution, vector_layers: (tj.vector_layers || []).filter((l) => l.id === 'building') } };
  log('OFM', JSON.stringify(out.fontes.openfreemap));
  const url = tj.tiles[0];
  await cabec('openfreemap-tile', url.replace('{z}', 14).replace('{x}', 6066).replace('{y}', 9300));
  return url;
}
async function tileOfm(tpl, z, x, y) {
  const r = await fetch(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y), { headers: { 'Accept-Encoding': 'gzip' } });
  const buf = await r.arrayBuffer();
  // o fetch do Node descomprime; o tamanho pela rede vem do content-length quando há
  return { buf, rede: Number(r.headers.get('content-length')) || null, bruto: buf.byteLength, enc: r.headers.get('content-encoding'), status: r.status };
}

// ---------- descobrir versões ----------
async function descobrir() {
  const d = {};
  const lst = await texto('https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&prefix=tiles/&delimiter=/');
  d.overtureExtras = { status: lst.status, prefixos: [...lst.t.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)].map((m) => m[1]) };
  const lstb = await texto('https://overturemaps-tiles-us-west-2-beta.s3.amazonaws.com/?list-type=2&delimiter=/');
  d.overtureBeta = { status: lstb.status, prefixos: [...lstb.t.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)].map((m) => m[1]).slice(-8), trecho: lstb.t.slice(0, 300) };
  const stac = await texto('https://stac.overturemaps.org/catalog.json');
  d.stac = { status: stac.status, trecho: stac.t.slice(0, 1500) };
  for (const u of [
    'https://data.source.coop/vida/google-microsoft-osm-open-buildings/?list-type=2&prefix=pmtiles/&delimiter=/',
    'https://data.source.coop/vida/google-microsoft-osm-open-buildings/pmtiles/?list-type=2&delimiter=/',
    'https://data.source.coop/vida/google-microsoft-open-buildings/?list-type=2&prefix=pmtiles/&delimiter=/',
  ]) { const t = await texto(u); d['vida ' + u] = { status: t.status, trecho: t.t.slice(0, 1500) }; }
  for (const u of [
    'https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv',
    'https://bfppub.blob.core.windows.net/global-buildings/dataset-links.csv',
  ]) {
    const t = await texto(u);
    const linhas = t.t.split('\n');
    const br = linhas.filter((l) => /^Brazil,/i.test(l));
    d['ms ' + u] = { status: t.status, linhas: linhas.length, cabecalho: linhas[0], brasil: br.length, exemplo: br.slice(0, 2) };
    if (br.length) await cabec('microsoft-arquivo-brasil', br[0].split(',')[2]);
  }
  const gcs = await texto('https://storage.googleapis.com/storage/v1/b/open-buildings-data/o?delimiter=/&prefix=');
  d.googleRaiz = { status: gcs.status, trecho: gcs.t.slice(0, 1500) };
  const gcs3 = await texto('https://storage.googleapis.com/storage/v1/b/open-buildings-data/o?delimiter=/&prefix=v3/');
  d.googleV3 = { status: gcs3.status, trecho: gcs3.t.slice(0, 1500) };
  const gcs3p = await texto('https://storage.googleapis.com/storage/v1/b/open-buildings-data/o?prefix=v3/polygons_s2_level_4_gzip/&maxResults=3');
  d.googleV3Pol = { status: gcs3p.status, trecho: gcs3p.t.slice(0, 1200) };
  try { const j = JSON.parse(gcs3p.t); if (j.items?.[0]) await cabec('google-v3-csv', j.items[0].mediaLink.replace('https://storage.googleapis.com/download/storage/v1/b/open-buildings-data/o/', 'https://storage.googleapis.com/open-buildings-data/').replace(/\?.*$/, '').replace(/%2F/g, '/')); } catch {}
  const gt = await texto('https://storage.googleapis.com/storage/v1/b/open-buildings-temporal-data/o?delimiter=/&prefix=');
  d.googleTemporal = { status: gt.status, trecho: gt.t.slice(0, 800) };
  out.descoberta = d;
  log('DESCOBERTA', JSON.stringify(d, null, 1).slice(0, 12000));
  return d;
}

// ---------- principal ----------
const d = await descobrir();
await cabec('overture-stac', 'https://stac.overturemaps.org/catalog.json');
{ const t = await texto('https://storage.googleapis.com/storage/v1/b/open-buildings-temporal-data/o?delimiter=/&prefix=v1/');
  const t2 = await texto('https://storage.googleapis.com/storage/v1/b/open-buildings-temporal-data/o?prefix=v1/&maxResults=5');
  log('GTEMP', t.t.slice(0, 1500), t2.t.replace(/\s+/g, ' ').slice(0, 2500)); }
await abrirPm('vida-global-goog_msft_osm', 'https://data.source.coop/vida/google-microsoft-osm-open-buildings/pmtiles/goog_msft_osm.pmtiles');
const ofmTpl = await openfreemap();

const candidatos = {};
const rel = (d.overtureExtras.prefixos || []).map((p) => p.replace(/^tiles\//, '').replace(/\/$/, '')).filter((p) => /^\d{4}-\d{2}-\d{2}/.test(p)).sort();
log('OVERTURE releases', rel.join(' '));
const ultimas = rel.slice(-2).reverse();
if (!ultimas.length) ultimas.push('2026-10-21.0', '2026-09-23.1');
for (const r of ultimas) {
  const u = `https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/${r}/buildings.pmtiles`;
  await cabec('overture-' + r, u);
  if (!candidatos.overture) { const f = await abrirPm('overture-' + r, u); if (f) candidatos.overture = f; }
}
for (const [nome, u] of [
  ['vida-osm-BRA', 'https://data.source.coop/vida/google-microsoft-osm-open-buildings/pmtiles/by_country/country_iso=BRA/BRA.pmtiles'],
  ['vida-BRA', 'https://data.source.coop/vida/google-microsoft-open-buildings/pmtiles/by_country/country_iso=BRA/BRA.pmtiles'],
]) {
  await cabec(nome, u);
  const f = await abrirPm(nome, u);
  if (f) candidatos[nome] = f;
}

for (const L of LUGARES) {
  const res = { lugar: L.nome, lat: L.lat, lon: L.lon, raio: RAIO, fontes: {} };
  // OSM pelo OpenFreeMap (z14)
  const osm = [];
  const tOsm = [];
  for (const [x, y] of tilesDoRaio(L.lat, L.lon, 14, RAIO)) {
    const t = await tileOfm(ofmTpl, 14, x, y);
    tOsm.push({ x, y, status: t.status, redeBytes: t.rede, brutoBytes: t.bruto, enc: t.enc });
    if (t.status === 200) {
      osm.push(...predios(t.buf, 14, x, y, (n) => n === 'building').lista);
      const vt = new VectorTile(new Pbf(new Uint8Array(t.buf)));
      const cont = {}; for (const n of Object.keys(vt.layers)) cont[n] = vt.layers[n].length;
      const B = vt.layers.building; let tipos = {}, perto = 0, ext = B?.extent;
      if (B) for (let i = 0; i < B.length; i++) { const f = B.feature(i); tipos[f.type] = (tipos[f.type] || 0) + 1;
        const g = f.loadGeometry(); const p0 = g[0][0]; const ll = tileParaLonlat(x + p0.x / B.extent, y + p0.y / B.extent, 14);
        if (dist(L.lat, L.lon, ll[1], ll[0]) <= RAIO) perto++; }
      tOsm[tOsm.length - 1].camadas = cont; tOsm[tOsm.length - 1].tiposBuilding = tipos; tOsm[tOsm.length - 1].primeiroPontoPerto = perto; tOsm[tOsm.length - 1].extent = ext;
    }
  }
  const osmR = osm.filter((b) => dist(L.lat, L.lon, b.c[1], b.c[0]) <= RAIO);
  const alt = osmR.filter((b) => b.props.render_height != null && Number(b.props.render_height) !== 5).length;
  res.fontes.osm_openfreemap = { ladrilhos: tOsm, predios: osmR.length, comAlturaDiferenteDoPadrao: alt, exemploProps: osmR[0]?.props };
  log('LUGAR', L.nome, 'OSM', osmR.length, 'alt', alt, JSON.stringify(tOsm));

  const pares = Object.entries(candidatos).map(([n, f]) => [n, f, Math.min(14, f.f.header.maxZoom)]);
  if (candidatos['vida-BRA']) pares.push(['vida-BRA-z15', candidatos['vida-BRA'], 15]);
  for (const [nome, f, z] of pares) {
    const t0 = Date.now();
    const lista = [], tl = [];
    for (const [x, y] of tilesDoRaio(L.lat, L.lon, z, RAIO)) {
      try {
        const t = await tilePm(f, z, x, y);
        tl.push({ z, x, y, redeBytes: t.rede, redeTotal: t.redeTotal, pedidos: t.pedidos, brutoBytes: t.bruto });
        if (t.buf) lista.push(...predios(t.buf, z, x, y).lista);
      } catch (e) { tl.push({ z, x, y, erro: String(e) }); }
    }
    const dentro = lista.filter((b) => dist(L.lat, L.lon, b.c[1], b.c[0]) <= RAIO);
    // quanto já está no OSM: centro do prédio candidato cai dentro de um prédio do OSM
    let sobreOsm = 0;
    const osmBox = osmR.concat(osm).map((b) => { const xs = b.anel.map((p) => p[0]), ys = b.anel.map((p) => p[1]); return { b, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; });
    let mlTotal = 0, mlSobreOsm = 0;
    for (const b of dentro) {
      const [px, py] = b.c;
      const g = b.props['@geometry_source'] ?? b.props.bf_source;
      const ml = b.camada !== 'building_part' && g !== 'OpenStreetMap' && g !== 'osm';
      const em = osmBox.some((o) => px >= o.x0 && px <= o.x1 && py >= o.y0 && py <= o.y1 && pontoNoPoligono(px, py, o.b.anel));
      if (ml) { mlTotal++; if (em) mlSobreOsm++; }
      if (em && false) continue;
      if (osmBox.some((o) => px >= o.x0 && px <= o.x1 && py >= o.y0 && py <= o.y1 && pontoNoPoligono(px, py, o.b.anel))) sobreOsm++;
    }
    const contagem = {};
    const chaves = new Set();
    for (const b of dentro) {
      for (const k of Object.keys(b.props)) chaves.add(k);
      for (const k of Object.keys(b.props)) if (/source|dataset|fonte/i.test(k)) { const v = String(b.props[k]).slice(0, 80); contagem[k + '=' + v] = (contagem[k + '=' + v] || 0) + 1; }
    }
    const geo = {}, hs = {}, porCamada = {};
    for (const b of dentro) { porCamada[b.camada] = (porCamada[b.camada] || 0) + 1; if (b.camada === 'building_part') continue;
      const g = b.props['@geometry_source'] ?? b.props.bf_source ?? '?'; geo[g] = (geo[g] || 0) + 1;
      const h = b.props['@height_source'] ?? (b.props.height != null ? 'sem rótulo' : 'sem altura'); hs[h] = (hs[h] || 0) + 1; }
    const comAltura = dentro.filter((b) => { const h = b.props.height ?? b.props.render_height; return h != null && Number(h) > 0; }).length;
    const comAndares = dentro.filter((b) => b.props.num_floors != null || b.props['building:levels'] != null).length;
    const camadas = [...new Set(dentro.map((b) => b.camada))];
    res.fontes[nome] = { ms: Date.now() - t0, zoom: z, ladrilhos: tl, predios: dentro.length, mlTotal, mlSobreOsm, centroDentroDePredioOsm: sobreOsm, semCorrespondenteNoOsm: dentro.length - sobreOsm, comAltura, comAndares, camadas, porCamada, geometria: geo, alturaFonte: hs, chaves: [...chaves], exemploProps: dentro.slice(0, 2).map((b) => b.props) };
    log('LUGAR', L.nome, nome, JSON.stringify(res.fontes[nome]).slice(0, 2500));
  }
  out.lugares.push(res);
}
writeFileSync('sonda-predios.json', JSON.stringify(out, null, 1));
log('=== RESUMO ===');
for (const l of out.lugares) {
  log(l.lugar, Object.entries(l.fontes).map(([k, v]) => `${k}: ${v.predios} prédios` + (v.semCorrespondenteNoOsm != null ? ` (${v.semCorrespondenteNoOsm} fora do OSM, ${v.comAltura} com altura)` : ` (${v.comAlturaDiferenteDoPadrao} com altura própria)`)).join(' | '));
}
