// Decodificador mínimo de MVT: conta prédios (camada building) em volta de um ponto.
import { readFileSync, existsSync } from 'node:fs';
function reader(buf) {
  let p = 0;
  const varint = () => { let r = 0n, s = 0n, b; do { b = buf[p++]; r |= BigInt(b & 0x7f) << s; s += 7n; } while (b & 0x80); return r; };
  return {
    get pos() { return p; }, set pos(v) { p = v; }, end: buf.length, buf,
    varint: () => Number(varint()), varintBig: varint,
    bytes() { const n = Number(varint()); const s = buf.subarray(p, p + n); p += n; return s; },
    skip(wt) { if (wt === 0) varint(); else if (wt === 1) p += 8; else if (wt === 2) { const n = Number(varint()); p += n; } else if (wt === 5) p += 4; },
  };
}
function fields(buf, cb) { const r = reader(buf); while (r.pos < r.end) { const k = r.varint(); const f = k >> 3, wt = k & 7; cb(f, wt, r); } }
function packed(buf) { const r = reader(buf); const out = []; while (r.pos < r.end) out.push(r.varint()); return out; }
function value(buf) { let v = null; fields(buf, (f, wt, r) => {
  if (f === 1) v = new TextDecoder().decode(r.bytes());
  else if (f === 2) { v = r.buf.readFloatLE(r.pos); r.pos += 4; }
  else if (f === 3) { v = r.buf.readDoubleLE(r.pos); r.pos += 8; }
  else if (f === 4 || f === 5) v = Number(r.varintBig());
  else if (f === 6) { const n = r.varintBig(); v = Number((n >> 1n) ^ -(n & 1n)); }
  else if (f === 7) v = !!r.varint(); else r.skip(wt); }); return v; }
export function decode(buf) {
  const layers = {};
  fields(buf, (f, wt, r) => {
    if (f !== 3) return r.skip(wt);
    const L = { name: '', keys: [], values: [], feats: [], extent: 4096 };
    fields(r.bytes(), (f2, wt2, r2) => {
      if (f2 === 1) L.name = new TextDecoder().decode(r2.bytes());
      else if (f2 === 2) { const F = { tags: [], type: 0, geom: [] }; fields(r2.bytes(), (f3, wt3, r3) => {
        if (f3 === 2) F.tags = packed(r3.bytes()); else if (f3 === 3) F.type = r3.varint(); else if (f3 === 4) F.geom = packed(r3.bytes()); else r3.skip(wt3); }); L.feats.push(F); }
      else if (f2 === 3) L.keys.push(new TextDecoder().decode(r2.bytes()));
      else if (f2 === 4) L.values.push(value(r2.bytes()));
      else if (f2 === 5) L.extent = r2.varint();
      else r2.skip(wt2);
    });
    layers[L.name] = L;
  });
  return layers;
}
function rings(geom) {
  const out = []; let x = 0, y = 0, i = 0, cur = null;
  while (i < geom.length) { const c = geom[i++]; const id = c & 7, n = c >> 3;
    if (id === 7) { if (cur) out.push(cur); cur = null; continue; }
    for (let k = 0; k < n; k++) { const dx = (geom[i] >> 1) ^ -(geom[i] & 1), dy = (geom[i + 1] >> 1) ^ -(geom[i + 1] & 1); i += 2; x += dx; y += dy;
      if (id === 1) { if (cur) out.push(cur); cur = [[x, y]]; } else cur.push([x, y]); } }
  if (cur) out.push(cur); return out;
}
const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; } return a / 2; };
// tile → lng/lat
const t2lng = (x, z) => (x / 2 ** z) * 360 - 180;
const t2lat = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return (180 / Math.PI) * Math.atan(Math.sinh(n)); };
export function analisar(dir, z, tiles, centro, raio) {
  const kx = 111320 * Math.cos(centro.lat * Math.PI / 180), ky = 110574;
  let oculto = 0, n = 0, padrao = 0, comAltura = 0, alt = [], areaTot = 0, faltando = 0, layerNames = new Set();
  for (const [x, y] of tiles) {
    const f = `${dir}/z${z}_${x}_${y}.pbf`; if (!existsSync(f)) { faltando++; continue; }
    const L = decode(readFileSync(f)); Object.keys(L).forEach((k) => layerNames.add(k));
    const B = L.building; if (!B) continue;
    const ext = B.extent;
    for (const F of B.feats) {
      const p = {}; for (let i = 0; i < F.tags.length; i += 2) p[B.keys[F.tags[i]]] = B.values[F.tags[i + 1]];
      if (p.hide_3d) { oculto++; continue; }
      const h = Number(p.render_height) || 0;
      const mx = (360 / 2 ** z / ext) * kx, my = (Math.abs(t2lat(y, z) - t2lat(y + 1, z)) / ext) * ky;
      for (const r of rings(F.geom)) {
        const a = area(r); if (a <= 0) continue; // só anéis externos (furos têm área negativa)
        const [cx, cy] = r.reduce((s, q) => [s[0] + q[0] / r.length, s[1] + q[1] / r.length], [0, 0]);
        if (cx < 0 || cy < 0 || cx > ext || cy > ext) continue; // parte do buffer do ladrilho vizinho
        const lng = t2lng(x + cx / ext, z), lat = t2lat(y + cy / ext, z);
        const d = Math.hypot((lng - centro.lng) * kx, (lat - centro.lat) * ky);
        if (d > raio) continue;
        n++; alt.push(h);
        if (h === 5) padrao++; else comAltura++;
        areaTot += a * mx * my;
      }
    }
  }
  alt.sort((a, b) => a - b);
  const q = (f) => alt.length ? alt[Math.floor(f * (alt.length - 1))] : 0;
  return { n, altura5m: padrao, outraAltura: comAltura, pctPadrao: n ? Math.round(100 * padrao / n) : 0, mediana: q(.5), p90: q(.9), max: alt.at(-1) || 0,
    acima9m: alt.filter((h) => h >= 9).length, coberturaPct: +(100 * Math.abs(areaTot) / (Math.PI * raio * raio)).toFixed(1), faltando, partesOcultas: oculto};
}
