// Mapa 3D do topo (assets/js/hero3d.js) nos testes de ponta a ponta, sem internet: a lista de ladrilhos (TileJSON) do
// OpenFreeMap e ladrilhos vetoriais (MVT) montados aqui, com quarteirões, ruas, uma praça e prédios de alturas
// variadas. É desenho de teste (não são dados do OpenStreetMap).
// Uso num teste e2e (não é um teste: o nome não começa com "e2e-"):
//   await simularMapa(context)                       ladrilhos simulados (o mapa abre)
//   await simularMapa(context, { falha: true })      sem resposta do OpenFreeMap (a página cai na versão leve)
//   await simularMapa(context, { log: [] })          guarda cada endereço pedido ao OpenFreeMap
export const OFM = 'https://tiles.openfreemap.org/';
const CORS = { 'Access-Control-Allow-Origin': '*' };
export const TILEJSON = {
  tilejson: '3.0.0', name: 'OpenFreeMap (simulado nos testes)', minzoom: 0, maxzoom: 14,
  tiles: [`${OFM}planet/teste/{z}/{x}/{y}.pbf`],
  attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
  vector_layers: ['building', 'transportation', 'water', 'park', 'landuse', 'landcover', 'waterway'].map((id) => ({ id, fields: {} })),
};

export async function simularMapa(context, { falha = false, log = null } = {}) {
  await context.route(`${OFM}**`, (route) => {
    const u = route.request().url();
    log?.push(u);
    if (falha) return route.abort('internetdisconnected');
    if (u === `${OFM}planet`) return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(TILEJSON) });
    const m = u.match(/\/planet\/teste\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (m) return route.fulfill({ status: 200, contentType: 'application/x-protobuf', headers: CORS, body: ladrilho(+m[1], +m[2], +m[3]) });
    return route.fulfill({ status: 404, headers: CORS, body: '' });
  });
}

/* ---------- MVT (Mapbox Vector Tile 2.1) mínimo ---------- */
const EXT = 4096;
function varint(out, v) { while (v > 127) { out.push((v & 127) | 128); v = Math.floor(v / 128); } out.push(v); }
const zz = (n) => (n << 1) ^ (n >> 31);
function campo(out, n, tipo) { varint(out, (n << 3) | tipo); }
function bytes(out, n, b) { campo(out, n, 2); varint(out, b.length); for (const x of b) out.push(x); }
function texto(out, n, s) { bytes(out, n, [...Buffer.from(s, 'utf8')]); }
function empacotado(out, n, valores) { const b = []; for (const v of valores) varint(b, v); bytes(out, n, b); }
const cmd = (id, n) => (id & 7) | (n << 3);

// Geometria: anéis (polígono, sentido horário em coordenadas do ladrilho) ou linhas.
function geometria(partes, fechar) {
  const g = []; let cx = 0, cy = 0;
  for (const pts of partes) {
    g.push(cmd(1, 1), zz(pts[0][0] - cx), zz(pts[0][1] - cy)); cx = pts[0][0]; cy = pts[0][1];
    g.push(cmd(2, pts.length - 1));
    for (const [x, y] of pts.slice(1)) { g.push(zz(x - cx), zz(y - cy)); cx = x; cy = y; }
    if (fechar) g.push(cmd(7, 1));
  }
  return g;
}
const ret = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function camada(nome, feicoes) {
  const chaves = [], valores = [], ix = new Map();
  const tag = (k, v) => {
    let ik = chaves.indexOf(k); if (ik < 0) { ik = chaves.length; chaves.push(k); }
    const kv = `${typeof v}:${v}`;
    if (!ix.has(kv)) { ix.set(kv, valores.length); valores.push(v); }
    return [ik, ix.get(kv)];
  };
  const out = [];
  texto(out, 1, nome);
  for (const f of feicoes) {
    const fb = [];
    empacotado(fb, 2, Object.entries(f.props).flatMap(([k, v]) => tag(k, v)));
    campo(fb, 3, 0); varint(fb, f.tipo);
    empacotado(fb, 4, geometria(f.partes, f.tipo === 3));
    bytes(out, 2, fb);
  }
  for (const k of chaves) texto(out, 3, k);
  for (const v of valores) {
    const vb = [];
    if (typeof v === 'string') texto(vb, 1, v); else { campo(vb, 5, 0); varint(vb, v); }
    bytes(out, 4, vb);
  }
  campo(out, 5, 0); varint(out, EXT);
  campo(out, 15, 0); varint(out, 2);
  return out;
}

// Um ladrilho de z14: 12 × 12 quarteirões com ruas, uma praça, um lago e 2 a 4 prédios por quarteirão, de 4 a 120 m
// (alturas que se repetem de forma fixa, para os testes darem sempre o mesmo resultado).
const cache = new Map();
export function ladrilho(z, x, y) {
  const chave = `${z}/${x}/${y}`;
  if (cache.has(chave)) return cache.get(chave);
  const N = 12, P = EXT / N, R = 22; // R: meia largura da rua
  const semente = (i, j, k) => { let h = (x * 73856093) ^ (y * 19349663) ^ (i * 83492791) ^ (j * 2654435761) ^ (k * 97); h = Math.imul(h ^ (h >>> 15), 2246822507); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
  const predios = [], ruas = [], parque = [], agua = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x0 = i * P + R, y0 = j * P + R, x1 = (i + 1) * P - R, y1 = (j + 1) * P - R;
      if ((i + j * 5) % 23 === 7) { parque.push({ tipo: 3, props: { class: 'park' }, partes: [ret(x0, y0, x1, y1)] }); continue; }
      if (i === 9 && j === 2) { agua.push({ tipo: 3, props: { class: 'lake' }, partes: [ret(x0, y0, x1, y1)] }); continue; }
      const meio = (x0 + x1) / 2, gap = 10;
      const lotes = semente(i, j, 0) < .5
        ? [ret(x0, y0, meio - gap, y1), ret(meio + gap, y0, x1, y1)]
        : [ret(x0, y0, meio - gap, (y0 + y1) / 2 - gap), ret(meio + gap, y0, x1, (y0 + y1) / 2 - gap), ret(x0, (y0 + y1) / 2 + gap, meio - gap, y1), ret(meio + gap, (y0 + y1) / 2 + gap, x1, y1)];
      lotes.forEach((lote, k) => {
        const s = semente(i, j, k + 1);
        const h = s > .9 ? 60 + Math.round(s * 60) : s > .6 ? 20 + Math.round(s * 30) : 4 + Math.round(s * 12);
        predios.push({ tipo: 3, props: { render_height: h, render_min_height: 0 }, partes: [lote] });
      });
    }
  }
  for (let k = 0; k <= N; k++) {
    const c = k * P, classe = k % 4 === 0 ? 'primary' : k % 2 === 0 ? 'secondary' : 'minor';
    ruas.push({ tipo: 2, props: { class: classe }, partes: [[[c, -64], [c, EXT + 64]]] });
    ruas.push({ tipo: 2, props: { class: classe }, partes: [[[-64, c], [EXT + 64, c]]] });
  }
  const uso = [{ tipo: 3, props: { class: 'residential' }, partes: [ret(-64, -64, EXT + 64, EXT + 64)] }];
  const corpo = Buffer.from([
    ...bytesCamada('landuse', uso), ...bytesCamada('park', parque), ...bytesCamada('water', agua),
    ...bytesCamada('transportation', ruas), ...bytesCamada('building', predios),
  ]);
  cache.set(chave, corpo);
  return corpo;
}
function bytesCamada(nome, feicoes) { const out = []; bytes(out, 3, camada(nome, feicoes)); return out; }
