// Mapa 3D do topo da página: um bairro no fim de tarde, com ruas, calçadas, prédios com janelas
// acesas, carros, árvores e postes, as clínicas com pino e o caminho pelas ruas até o paciente.
import * as THREE from '../vendor/three.module.min.js';

const P = 2.6;            // distância entre ruas (unidades)
const BLOCK = 2.0;        // tamanho da quadra
const ROAD = P - BLOCK;   // largura da rua
const WALK = .12;         // largura da calçada
const CITY_R = 23;        // raio da cidade
const KM_UNITS = 2.6;     // 1 km perto do centro
const FLOOR_TILE = 1.5;   // a textura de fachada cobre 1,5 x 1,5 unidade (8 andares x 8 janelas)

const ease = {
  outCubic: t => 1 - Math.pow(1 - t, 3),
  outBounce: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375; return n * (t -= 2.625 / d) * t + .984375; }
};
const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ---------------- texturas ---------------- */
function canvasTex(c, repeat = false, aniso = 8) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const makeCanvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };

// Céu do fim de tarde, usado como reflexo nos vidros.
function makeEnv(renderer) {
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 48, 24), pos = geo.attributes.position, cols = [];
  const top = new THREE.Color(0x0d2a44), mid = new THREE.Color(0x4a6f93), low = new THREE.Color(0xf2a36b), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y > .12) c.lerpColors(mid, top, Math.min(1, (y - .12) / .7)); else c.lerpColors(low, mid, clamp01((y + .1) / .22));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })));
  const sunDisk = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd2a0).multiplyScalar(3) }));
  sunDisk.position.set(-8, 1.2, 5.5); sunDisk.lookAt(0, 0, 0); s.add(sunDisk);
  const pm = new THREE.PMREMGenerator(renderer), tex = pm.fromScene(s, .02).texture; pm.dispose();
  return tex;
}

function glowTexture(inner, outer) {
  const [c, g] = makeCanvas(128), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(.22, inner.replace(/[\d.]+\)$/, '.6)')); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return canvasTex(c, false, 1);
}

// Fachadas: cada estilo tem a cor (map) e as janelas acesas (emissiveMap). 8 andares x 8 janelas.
function facadeTextures(style, seed) {
  const S = 256, N = 8, cell = S / N, rand = rng(seed);
  const [c, g] = makeCanvas(S), [e, ge] = makeCanvas(S);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  const warm = ['#ffd9a0', '#ffe7c2', '#ffcf86', '#fff1d8', '#cfe6ff'];
  const lit = (x, y, w, h, p) => { if (rand() < p) { ge.fillStyle = warm[Math.floor(rand() * warm.length)]; ge.globalAlpha = .55 + rand() * .45; ge.fillRect(x, y, w, h); ge.globalAlpha = 1; return true; } return false; };
  if (style === 'glass') {
    for (let j = 0; j < N; j++) {
      const floorP = rand() < .35 ? .75 : .12;          // escritórios: andares inteiros acesos
      for (let i = 0; i < N; i++) {
        const x = i * cell, y = j * cell, gr = g.createLinearGradient(x, y, x + cell, y + cell);
        gr.addColorStop(0, '#2f5b72'); gr.addColorStop(1, rand() < .5 ? '#1b3a4b' : '#24485c');
        g.fillStyle = gr; g.fillRect(x, y, cell, cell);
        lit(x + 2, y + 3, cell - 4, cell - 7, floorP);
      }
      g.fillStyle = '#9fb3bd'; g.fillRect(0, j * cell + cell - 3, S, 3);      // laje
    }
    g.fillStyle = 'rgba(190,210,220,.55)'; for (let i = 0; i <= N; i++) g.fillRect(i * cell - 1, 0, 2, S); // montantes
  } else {
    const wall = style === 'brick' ? '#9b5d46' : rand() < .5 ? '#cdc4b5' : '#b9bfc0';
    g.fillStyle = wall; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 2600; k++) { g.fillStyle = `rgba(${rand() < .5 ? '0,0,0' : '255,255,255'},${rand() * .06})`; g.fillRect(rand() * S, rand() * S, 2 + rand() * 4, 1 + rand() * 2); }
    if (style === 'brick') { g.strokeStyle = 'rgba(60,30,20,.25)'; g.lineWidth = 1; for (let y = 0; y < S; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); } }
    const mx = style === 'brick' ? 9 : 6, my = 7;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = i * cell + mx, y = j * cell + my - 2, w = cell - mx * 2, h = cell - my * 2;
      g.fillStyle = '#1f2a33'; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(140,170,190,.35)'; g.fillRect(x, y, w, h * .35);
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x - 2, y + h, w + 4, 2);                          // peitoril
      if (lit(x, y, w, h, .22)) { g.fillStyle = 'rgba(255,214,160,.55)'; g.fillRect(x, y, w, h); }
      if (style === 'concrete' && rand() < .25) { g.fillStyle = 'rgba(40,40,40,.35)'; g.fillRect(x - 3, y + h + 2, w + 6, 3); } // varanda
    }
  }
  return { map: canvasTex(c, true), emissive: canvasTex(e, true) };
}

function roofTexture() {
  const [c, g] = makeCanvas(128), rand = rng(11);
  g.fillStyle = '#6a7176'; g.fillRect(0, 0, 128, 128);
  for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${rand() < .5 ? '0,0,0' : '255,255,255'},${rand() * .08})`; g.fillRect(rand() * 128, rand() * 128, 2, 2); }
  g.strokeStyle = '#959ca1'; g.lineWidth = 8; g.strokeRect(4, 4, 120, 120);
  return canvasTex(c, false, 4);
}

// Chão: asfalto com faixas, calçadas, faixas de pedestre, lotes e praças.
function groundTexture(parkSet, size) {
  const units = 64, px = size / units, rand = rng(5);
  const [c, g] = makeCanvas(size);
  const toPx = u => (u + units / 2) * px;
  g.fillStyle = '#2a3035'; g.fillRect(0, 0, size, size);                                        // asfalto
  for (let k = 0; k < size * 14; k++) { g.fillStyle = `rgba(${rand() < .5 ? '0,0,0' : '255,255,255'},${rand() * .05})`; g.fillRect(rand() * size, rand() * size, 1.5, 1.5); }
  const n = Math.ceil(units / 2 / P) + 1;
  for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
    const cx = (i + .5) * P, cz = (j + .5) * P;
    const x0 = toPx(cx - BLOCK / 2), z0 = toPx(cz - BLOCK / 2), b = BLOCK * px, w = WALK * px;
    g.fillStyle = '#7d8380'; g.fillRect(x0, z0, b, b);                                          // calçada
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x0, z0 + b - 2, b, 2); g.fillRect(x0 + b - 2, z0, 2, b);
    const park = parkSet.has(`${i},${j}`);
    g.fillStyle = park ? '#2e5a34' : '#575e5d'; g.fillRect(x0 + w, z0 + w, b - 2 * w, b - 2 * w);
    if (park) {
      g.strokeStyle = '#a49a83'; g.lineWidth = px * .07;
      g.beginPath(); g.moveTo(x0 + w, z0 + w); g.lineTo(x0 + b - w, z0 + b - w); g.moveTo(x0 + b - w, z0 + w); g.lineTo(x0 + w, z0 + b - w); g.stroke();
      g.beginPath(); g.arc(x0 + b / 2, z0 + b / 2, px * .28, 0, Math.PI * 2); g.fillStyle = '#a49a83'; g.fill();
      for (let k = 0; k < 250; k++) { g.fillStyle = `rgba(${rand() < .5 ? '20,60,25' : '90,130,70'},.35)`; g.fillRect(x0 + w + rand() * (b - 2 * w), z0 + w + rand() * (b - 2 * w), 3, 3); }
    }
  }
  // faixas
  for (let k = -n; k <= n; k++) {
    const u = toPx(k * P), main = k === 0;
    for (const vertical of [true, false]) {
      const line = (off, color, dash, width) => {
        g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash);
        g.beginPath();
        if (vertical) { g.moveTo(u + off, 0); g.lineTo(u + off, size); } else { g.moveTo(0, u + off); g.lineTo(size, u + off); }
        g.stroke(); g.setLineDash([]);
      };
      if (main) { line(-1.6, '#e2b23f', [], 1.6); line(1.6, '#e2b23f', [], 1.6); }
      else line(0, 'rgba(230,230,220,.7)', [px * .22, px * .22], 1.4);
    }
  }
  // faixas de pedestre nos cruzamentos do centro
  g.fillStyle = 'rgba(235,235,228,.8)';
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    if (Math.hypot(i * P, j * P) > 16) continue;
    const x = toPx(i * P), z = toPx(j * P), half = ROAD / 2 * px, st = px * .045;
    for (const s of [-1, 1]) for (let k = -3; k <= 3; k++) {
      g.fillRect(x + k * st * 2 - st / 2, z + s * (half + px * .06) - px * .05, st, px * .1);
      g.fillRect(x + s * (half + px * .06) - px * .05, z + k * st * 2 - st / 2, px * .1, st);
    }
  }
  return { tex: canvasTex(c, false, 16), units };
}

function clinicFacade() {
  const S = 256, [c, g] = makeCanvas(S), [e, ge] = makeCanvas(S), rand = rng(21);
  g.fillStyle = '#eef3f3'; g.fillRect(0, 0, S, S);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  for (let j = 0; j < 6; j++) {
    const y = j * (S / 6) + 8, h = S / 6 - 18;
    const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#5f8ea3'); gr.addColorStop(1, '#2d5568');
    g.fillStyle = gr; g.fillRect(6, y, S - 12, h);
    ge.fillStyle = '#e9f6ff'; ge.globalAlpha = .45 + rand() * .4; ge.fillRect(6, y, S - 12, h); ge.globalAlpha = 1;
    g.fillStyle = 'rgba(255,255,255,.7)'; for (let i = 1; i < 6; i++) g.fillRect(i * (S / 6) - 1, y, 2, h);
  }
  return { map: canvasTex(c, true), emissive: canvasTex(e, true) };
}

/* ---------------- geometria ---------------- */
function mergeGeos(list) {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    if (!parts[0].attributes[name]) continue;
    const arrs = parts.map(g => g.attributes[name].array), merged = new Float32Array(arrs.reduce((a, b) => a + b.length, 0));
    let o = 0; for (const a of arrs) { merged.set(a, o); o += a.length; }
    out.setAttribute(name, new THREE.BufferAttribute(merged, parts[0].attributes[name].itemSize));
  }
  return out;
}
const tinted = (geo, v) => { const n = geo.attributes.position.count; geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(v), 3)); return geo; };

// Prédios que "brotam" do chão: a altura cresce com o tempo de cada um (aDelay). aHide some com o prédio.
const growUniforms = { uTime: { value: 0 } };
function growing(mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = growUniforms.uTime;
    sh.vertexShader = 'attribute float aDelay;\nattribute float aHide;\nuniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float gp = clamp((uTime - aDelay) / .75, 0., 1.);
      float gq = gp - 1.;
      float gs = gp >= 1. ? 1. : 1. + 2.6 * gq * gq * gq + 1.6 * gq * gq;
      transformed.y *= max(gs, .0001);
      transformed *= 1. - aHide;`);
  };
  return mat;
}

export function initHero3D(el, api) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = el.clientWidth, H = el.clientHeight;
  // Celular: menos pixels por ponto (no máximo 1,5) e sombras mais leves.
  const small = Math.min(screen.width, screen.height) < 700 || W < 700;
  const labelsEl = el.querySelector('.h3d-labels');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 1.75));
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = small ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'h3d-canvas'; renderer.domElement.setAttribute('aria-hidden', 'true');
  el.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0b2230, .013);
  scene.environment = makeEnv(renderer);

  const camera = new THREE.PerspectiveCamera(32, W / H, .1, 200);

  // luzes: sol baixo e quente do fim de tarde, céu azul preenchendo as sombras
  scene.add(new THREE.HemisphereLight(0x9cc3e6, 0x2a2018, .7));
  const sun = new THREE.DirectionalLight(0xffc08a, 2.1);
  sun.position.set(-16, 11, 10); sun.castShadow = true;
  sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .02;
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 70 });
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x7fa6d9, .45); fill.position.set(12, 8, -10); scene.add(fill);

  // quadras: praças e lotes
  const rand = rng(7);
  const lots = [], parks = [], parkSet = new Set();
  const nB = Math.ceil(CITY_R / P) + 1;
  for (let i = -nB; i < nB; i++) for (let j = -nB; j < nB; j++) {
    const cx = (i + .5) * P, cz = (j + .5) * P, d = Math.hypot(cx, cz);
    if (d > CITY_R) continue;
    if (rand() < .07 && d > 3) { parks.push([cx, cz]); parkSet.add(`${i},${j}`); continue; }
    const r = rand(), gap = .1, half = BLOCK / 2 - WALK;
    const inner = BLOCK - 2 * WALK;
    let cells;
    if (r < .25) cells = [[0, 0, inner, inner]];
    else if (r < .6) cells = rand() < .5 ? [[-half / 2, 0, half - gap / 2, inner], [half / 2, 0, half - gap / 2, inner]] : [[0, -half / 2, inner, half - gap / 2], [0, half / 2, inner, half - gap / 2]];
    else cells = [[-half / 2, -half / 2], [half / 2, -half / 2], [-half / 2, half / 2], [half / 2, half / 2]].map(([x, z]) => [x, z, half - gap / 2, half - gap / 2]);
    for (const [ox, oz, w, dd] of cells) {
      const tower = d > 4 && d < 10 && rand() > .85;
      const h = tower ? 1.9 + rand() * 1.8 : .3 + Math.pow(rand(), 1.8) * (d < 4 ? .8 : d < 11 ? 1.4 : .9);
      const inset = .04 + rand() * .08;
      const style = h > 2 ? (rand() < .8 ? 'glass' : 'concrete') : h < .7 && rand() < .5 ? 'brick' : rand() < .25 ? 'glass' : 'concrete';
      lots.push({ x: cx + ox, z: cz + oz, w: Math.max(.3, w - inset), d: Math.max(.3, dd - inset), h, style, dist: Math.hypot(cx + ox, cz + oz) });
    }
  }

  // chão
  const gt = groundTexture(parkSet, small ? 2048 : 4096);
  gt.tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gt.units, gt.units), new THREE.MeshStandardMaterial({ map: gt.tex, roughness: .92, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const far = new THREE.Mesh(new THREE.CircleGeometry(140, 64), new THREE.MeshStandardMaterial({ color: 0x1c2328, roughness: 1 }));
  far.rotation.x = -Math.PI / 2; far.position.y = -.02; scene.add(far);

  // prédios: uma geometria só, com um material por estilo de fachada
  const STYLES = ['glass', 'concrete', 'brick'];
  const groups = [...STYLES, 'roof', 'detail'].map(() => ({ pos: [], nor: [], uv: [], col: [], delay: [], lot: [] }));
  const quad = (G, a, b, c, d, n, uvs, tint, delay, li) => {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      G.pos.push(...[a, b, c, d][k]); G.nor.push(...n); G.uv.push(...uvs[k]); G.col.push(tint, tint, tint); G.delay.push(delay); G.lot.push(li);
    }
  };
  const box = (G, x, z, w, d, y0, h, tint, delay, li, uo, top) => {
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y0 + h;
    const side = (len) => [[uo, y0], [uo + len, y0], [uo + len, y1], [uo, y1]].map(([u, v]) => [u / FLOOR_TILE, v / FLOOR_TILE]);
    quad(G, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], side(w), tint, delay, li);
    quad(G, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], side(w), tint, delay, li);
    quad(G, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], side(d), tint, delay, li);
    quad(G, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], side(d), tint, delay, li);
    quad(top ?? G, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], tint, delay, li);
  };
  lots.forEach((l, li) => {
    const delay = reduce ? 0 : l.dist / CITY_R * .95 + rand() * .3;
    const tint = .82 + rand() * .3;
    const uo = Math.floor(rand() * 8) / 8;
    box(groups[STYLES.indexOf(l.style)], l.x, l.z, l.w, l.d, 0, l.h, tint, delay, li, uo, groups[3]);
    // casa de máquinas e ar-condicionado no telhado
    if (l.h > .6 && rand() < .6) {
      const n = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const bw = .1 + rand() * Math.min(.3, l.w * .35), bd = .1 + rand() * Math.min(.3, l.d * .35);
        box(groups[4], l.x + (rand() - .5) * (l.w - bw - .1), l.z + (rand() - .5) * (l.d - bd - .1), bw, bd, l.h, .05 + rand() * .12, .7 + rand() * .3, delay, li, 0);
      }
    }
  });
  const cityGeo = new THREE.BufferGeometry();
  const flat = key => groups.flatMap(G => G[key]);
  cityGeo.setAttribute('position', new THREE.Float32BufferAttribute(flat('pos'), 3));
  cityGeo.setAttribute('normal', new THREE.Float32BufferAttribute(flat('nor'), 3));
  cityGeo.setAttribute('uv', new THREE.Float32BufferAttribute(flat('uv'), 2));
  cityGeo.setAttribute('color', new THREE.Float32BufferAttribute(flat('col'), 3));
  cityGeo.setAttribute('aDelay', new THREE.Float32BufferAttribute(flat('delay'), 1));
  const lotOfVertex = flat('lot');
  const hideAttr = new THREE.Float32BufferAttribute(new Float32Array(lotOfVertex.length), 1);
  cityGeo.setAttribute('aHide', hideAttr);
  let start = 0;
  groups.forEach((G, i) => { cityGeo.addGroup(start, G.delay.length, i); start += G.delay.length; });
  const facadeMat = (style, seed) => {
    const t = facadeTextures(style, seed);
    return growing(new THREE.MeshStandardMaterial({
      map: t.map, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 1.35, vertexColors: true,
      roughness: style === 'glass' ? .18 : style === 'brick' ? .9 : .82, metalness: style === 'glass' ? .55 : 0, envMapIntensity: style === 'glass' ? 1.3 : .5
    }));
  };
  const cityMats = [facadeMat('glass', 3), facadeMat('concrete', 4), facadeMat('brick', 5),
    growing(new THREE.MeshStandardMaterial({ map: roofTexture(), vertexColors: true, roughness: .95 })),
    growing(new THREE.MeshStandardMaterial({ color: 0x9aa1a5, vertexColors: true, roughness: .7, metalness: .2 }))];
  const city = new THREE.Mesh(cityGeo, cityMats);
  city.castShadow = true; city.receiveShadow = true;
  city.customDepthMaterial = growing(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
  city.frustumCulled = false;
  scene.add(city);

  // árvores: praças e canteiros das avenidas
  const treeSpots = [];
  parks.forEach(([x, z]) => { for (let k = 0; k < 10; k++) treeSpots.push([x + (rand() - .5) * 1.5, z + (rand() - .5) * 1.5, .8 + rand() * .6]); });
  for (let u = -18; u <= 18; u += .65) {
    if (Math.abs(((u % P) + P) % P - P / 2) > BLOCK / 2 - .2 || Math.abs(u) < 1) continue;
    for (const s of [-1, 1]) { treeSpots.push([u, s * (ROAD / 2 + WALK / 2), .45 + rand() * .15]); treeSpots.push([s * (ROAD / 2 + WALK / 2), u, .45 + rand() * .15]); }
  }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(.025, .035, .2, 6).translate(0, .1, 0), new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 }), treeSpots.length);
  const canopy = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.19, 1).translate(0, .32, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .95, flatShading: true }), treeSpots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), col = new THREE.Color(), yAxis = new THREE.Vector3(0, 1, 0);
  treeSpots.forEach(([x, z, sc], i) => {
    q.setFromAxisAngle(yAxis, rand() * 6.28);
    m4.compose(v3.set(x, 0, z), q, s3.set(sc, sc * (.9 + rand() * .3), sc)); trunk.setMatrixAt(i, m4); canopy.setMatrixAt(i, m4);
    col.setHSL(.27 + rand() * .08, .45 + rand() * .2, .2 + rand() * .1); canopy.setColorAt(i, col);
  });
  q.identity();
  trunk.castShadow = canopy.castShadow = true; canopy.receiveShadow = true;
  scene.add(trunk, canopy);

  // postes: luz quente nas esquinas
  const lampPos = [];
  for (let i = -9; i <= 9; i++) for (let j = -9; j <= 9; j++) {
    if (Math.hypot(i * P, j * P) > CITY_R - 1) continue;
    const o = ROAD / 2 + WALK * .5;
    lampPos.push(i * P + o, .32, j * P + o, i * P - o, .32, j * P - o);
  }
  const lampGeo = new THREE.BufferGeometry(); lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
  scene.add(new THREE.Points(lampGeo, new THREE.PointsMaterial({ size: .55, map: glowTexture('rgba(255,200,130,1)', 'rgba(255,200,130,0)'), transparent: true, opacity: .85, depthWrite: false, blending: THREE.AdditiveBlending })));
  const poleGeo = new THREE.CylinderGeometry(.012, .012, .32, 4).translate(0, .16, 0);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x30363a, roughness: .6 }), lampPos.length / 3);
  for (let i = 0; i < lampPos.length / 3; i++) { m4.makeTranslation(lampPos[i * 3], 0, lampPos[i * 3 + 2]); poles.setMatrixAt(i, m4); }
  scene.add(poles);

  // carros nas ruas, mão dupla, com farol e lanterna
  const carGeo = mergeGeos([
    tinted(new THREE.BoxGeometry(.36, .08, .17).translate(0, .07, 0), 1),
    tinted(new THREE.BoxGeometry(.19, .07, .15).translate(-.02, .145, 0), .16),
  ]);
  const lanes = [];
  for (let k = 0; k < (small ? 12 : 22); k++) {
    const idx = Math.round((rand() - .5) * 2 * (rand() < .5 ? 2 : 7));
    lanes.push({ axis: rand() < .5 ? 'x' : 'z', s: idx * P, dir: rand() < .5 ? 1 : -1, speed: .7 + rand() * .9, n: 2 + Math.floor(rand() * 4), ph: rand() });
  }
  const L = 24, cars = [];
  lanes.forEach(ln => { for (let k = 0; k < ln.n; k++) cars.push({ ln, p0: ln.ph * 2 * L + k * (2 * L / ln.n) + rand() * .5 }); });
  const carMesh = new THREE.InstancedMesh(carGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .35, metalness: .55, envMapIntensity: 1 }), cars.length);
  const PAINT = [0xf2f2f0, 0xc9ccce, 0x1c1f22, 0x8e959a, 0x2d4766, 0x8a1f1f, 0xf2f2f0, 0x5c6266];
  cars.forEach((c, i) => carMesh.setColorAt(i, col.set(PAINT[Math.floor(rand() * PAINT.length)])));
  carMesh.castShadow = true; scene.add(carMesh);
  const headPos = new Float32Array(cars.length * 3), tailPos = new Float32Array(cars.length * 3);
  const headGeo = new THREE.BufferGeometry(); headGeo.setAttribute('position', new THREE.BufferAttribute(headPos, 3));
  const tailGeo = new THREE.BufferGeometry(); tailGeo.setAttribute('position', new THREE.BufferAttribute(tailPos, 3));
  scene.add(new THREE.Points(headGeo, new THREE.PointsMaterial({ size: .28, map: glowTexture('rgba(255,244,214,1)', 'rgba(255,244,214,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  scene.add(new THREE.Points(tailGeo, new THREE.PointsMaterial({ size: .2, map: glowTexture('rgba(255,50,40,1)', 'rgba(255,50,40,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  const fwd = new THREE.Vector3();
  function updateCars(time) {
    cars.forEach((c, i) => {
      const { ln } = c;
      const p = ((c.p0 + time * ln.speed) % (2 * L)) - L, along = p * ln.dir;
      const lane = ln.dir * .14;
      const x = ln.axis === 'x' ? along : ln.s - lane, z = ln.axis === 'x' ? ln.s + lane : along;
      const sc = Math.min(smooth(L, L - 2, Math.abs(along)), smooth(.9, 1.6, Math.hypot(x, z)));
      const yaw = ln.axis === 'x' ? (ln.dir > 0 ? 0 : Math.PI) : (ln.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      q.setFromAxisAngle(yAxis, yaw);
      m4.compose(v3.set(x, 0, z), q, s3.setScalar(Math.max(sc, .0001))); carMesh.setMatrixAt(i, m4);
      fwd.set(1, 0, 0).applyQuaternion(q);
      const hide = sc < .5 ? -50 : 0;
      headPos.set([x + fwd.x * .19, .08 + hide, z + fwd.z * .19], i * 3);
      tailPos.set([x - fwd.x * .19, .08 + hide, z - fwd.z * .19], i * 3);
    });
    q.identity();
    carMesh.instanceMatrix.needsUpdate = true; headGeo.attributes.position.needsUpdate = true; tailGeo.attributes.position.needsUpdate = true;
  }

  // você está aqui
  const me = new THREE.Group(); scene.add(me);
  const meBase = new THREE.Mesh(new THREE.CylinderGeometry(.42, .46, .06, 48), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .3, clearcoat: 1 }));
  meBase.position.y = .03; meBase.castShadow = true; me.add(meBase);
  const meDot = new THREE.Mesh(new THREE.SphereGeometry(.28, 32, 24), new THREE.MeshPhysicalMaterial({ color: 0xff6b4a, emissive: 0xff6b4a, emissiveIntensity: .45, roughness: .25, clearcoat: 1 }));
  meDot.position.y = .34; meDot.castShadow = true; me.add(meDot);
  const meGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,107,74,1)', 'rgba(255,107,74,0)'), transparent: true, opacity: .7, depthWrite: false, blending: THREE.AdditiveBlending }));
  meGlow.scale.setScalar(2.2); meGlow.position.y = .32; me.add(meGlow);
  const meRings = [0, 1].map(i => {
    const r = new THREE.Mesh(new THREE.RingGeometry(.5, .56, 64), new THREE.MeshBasicMaterial({ color: 0xff8a6e, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    r.rotation.x = -Math.PI / 2; r.position.y = .02; r.userData.phase = i / 2; me.add(r); return r;
  });
  const meLabel = document.createElement('div'); meLabel.className = 'h3d-me'; meLabel.textContent = 'Você está aqui'; labelsEl.appendChild(meLabel);

  // clínicas (recriadas quando a origem muda)
  let clinicObjs = [], origin = api.origin();
  const pinProfile = [[0, 0], [.05, .1], [.14, .28], [.23, .48], [.29, .66], [.3, .8], [.27, .94], [.2, 1.04], [.1, 1.1], [0, 1.12]].map(p => new THREE.Vector2(p[0], p[1]));
  const pinGeo = new THREE.LatheGeometry(pinProfile, 40);
  const raycastTargets = [];
  const clinicTex = clinicFacade();
  const roofTex = roofTexture();
  const routeVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
  const routeFrag = `
    uniform float uTime; uniform vec3 uColor; uniform float uPhase; uniform float uOpacity; varying vec2 vUv;
    void main(){
      float head = fract(uTime * .22 + uPhase);
      float d = vUv.x - head;
      float trail = smoothstep(-.2, 0., d) * (1. - smoothstep(0., .015, d));
      float a = (.35 + trail * .65) * uOpacity;
      a *= smoothstep(0., .03, vUv.x);
      gl_FragColor = vec4(mix(uColor, vec3(1.), trail * .5), a);
      #include <colorspace_fragment>
    }`;

  function toXZ(lat, lng) {
    const dxKm = (lng - origin.lng) * 111.32 * Math.cos(origin.lat * Math.PI / 180);
    const dzKm = -(lat - origin.lat) * 110.57;
    const km = Math.hypot(dxKm, dzKm) || 1e-6;
    let r = km < 3 ? km * KM_UNITS : 3 * KM_UNITS + (km - 3) * 1.55;
    r = Math.min(r, 16.5);
    return [dxKm / km * r, dzKm / km * r];
  }
  function snap(x, z, used) {
    let bi = Math.round(x / P - .5), bj = Math.round(z / P - .5);
    const key = (a, b) => a + ',' + b;
    if (used.has(key(bi, bj))) {
      const opts = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
      for (const [a, b] of opts) if (!used.has(key(bi + a, bj + b))) { bi += a; bj += b; break; }
    }
    used.add(key(bi, bj));
    return [(bi + .5) * P, (bj + .5) * P];
  }

  function hideLotsNear(points) {
    lots.forEach(l => { l.hidden = points.some(([x, z]) => Math.abs(l.x - x) < BLOCK / 2 && Math.abs(l.z - z) < BLOCK / 2); });
    for (let i = 0; i < lotOfVertex.length; i++) hideAttr.array[i] = lots[lotOfVertex[i]].hidden ? 1 : 0;
    hideAttr.needsUpdate = true;
  }

  // Caminho pelas ruas: anda pela avenida, vira na rua da clínica e para na calçada em frente.
  function routeCurve(x, z) {
    const sx = x - Math.sign(x) * P / 2, y = .05;
    const front = sx + Math.sign(x) * (ROAD / 2 + WALK * .5);
    const pts = [[0, 0], [sx, 0], [sx, z], [front, z]].map(([a, b]) => new THREE.Vector3(a, y, b));
    const path = new THREE.CurvePath();
    for (let i = 0; i < pts.length - 1; i++) if (pts[i].distanceTo(pts[i + 1]) > .01) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    return path;
  }

  function buildClinics(intro) {
    clinicObjs.forEach(o => { scene.remove(o.group); scene.remove(o.route); o.dispose(); });
    clinicObjs = []; raycastTargets.length = 0;
    const used = new Set();
    for (const [x, z] of parks) used.add(`${Math.round(x / P - .5)},${Math.round(z / P - .5)}`);
    used.add('-1,-1'); used.add('0,0'); used.add('-1,0'); used.add('0,-1');
    const spots = [];
    api.clinics().forEach((c, idx) => {
      const [x0, z0] = toXZ(c.lat, c.lng);
      const [x, z] = snap(x0, z0, used);
      spots.push([x, z]);
      const color = new THREE.Color(c.c);
      // altura do prédio: a página pode mandar (c.h); senão, um padrão fixo (não depende de nota)
      const h = typeof c.h === 'number' ? c.h : 1.8;
      const group = new THREE.Group(); group.position.set(x, 0, z); scene.add(group);

      const fm = clinicTex.map.clone(), fe = clinicTex.emissive.clone();
      fm.repeat.set(1, h / 1.4); fe.repeat.set(1, h / 1.4); fm.needsUpdate = fe.needsUpdate = true;
      const sideMat = new THREE.MeshStandardMaterial({ map: fm, emissiveMap: fe, emissive: 0xffffff, emissiveIntensity: 1, roughness: .3, metalness: .2, envMapIntensity: 1 });
      const topMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: .9 });
      const bld = new THREE.Mesh(new THREE.BoxGeometry(1.5, h, 1.5).translate(0, h / 2, 0), [sideMat, sideMat, topMat, topMat, sideMat, sideMat]);
      bld.castShadow = true; bld.receiveShadow = true; group.add(bld);
      // faixa com a cor da clínica no alto, como um letreiro
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.54, .14, 1.54), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .7, roughness: .4 }));
      band.position.y = h - .14; group.add(band);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.08, 1.16, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = .03; group.add(ring);

      const pin = new THREE.Group(); pin.position.y = h + .7; group.add(pin);
      const pinMesh = new THREE.Mesh(pinGeo, new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: .3, roughness: .22, clearcoat: 1, clearcoatRoughness: .1 }));
      pinMesh.castShadow = true; pinMesh.userData.id = c.id; pin.add(pinMesh);
      const badgeC = makeCanvas(128);
      { const [cv, g] = badgeC; g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.fillStyle = c.c; g.font = '800 46px Sora, Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(c.ini, 64, 68); }
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(badgeC[0], false, 4), depthWrite: false }));
      badge.scale.setScalar(.42); pin.add(badge);
      raycastTargets.push(pinMesh, bld); bld.userData.id = c.id;

      const route = new THREE.Mesh(new THREE.TubeGeometry(routeCurve(x, z), 160, .045, 6), new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: color.clone().lerp(new THREE.Color(0xffffff), .15) }, uPhase: { value: idx * .137 }, uOpacity: { value: 0 } },
        vertexShader: routeVert, fragmentShader: routeFrag, transparent: true, depthWrite: false
      }));
      scene.add(route);

      const label = document.createElement('button');
      label.className = 'h3d-label'; label.type = 'button';
      // escondido até aparecer na tela: fora do Tab e dos leitores de tela
      label.tabIndex = -1; label.setAttribute('aria-hidden', 'true');
      // nomes vêm do cadastro oficial: monta o rótulo com textContent, nunca como HTML
      const lg = document.createElement('span'); lg.className = 'lg'; lg.style.background = c.c; lg.textContent = c.ini;
      const tx = document.createElement('span'); tx.className = 'tx';
      const nb = document.createElement('b'); nb.textContent = c.n;
      const sm = document.createElement('small'); sm.textContent = api.meta(c);
      tx.append(nb, sm); label.append(lg, tx);
      label.setAttribute('aria-label', `${c.n}, ${api.meta(c)}`);
      label.addEventListener('click', () => api.onPick(c.id));
      labelsEl.appendChild(label);

      clinicObjs.push({
        id: c.id, c, group, bld, band, ring, pin, pinMesh, badge, route, label, h, sideMat,
        t0: intro ? 1.25 + idx * .07 : -10, hover: 0, sx: 0, sy: 0,
        dispose() {
          bld.geometry.dispose(); sideMat.dispose(); topMat.dispose(); fm.dispose(); fe.dispose();
          [band, ring, pinMesh, route].forEach(m => { m.geometry !== pinGeo && m.geometry.dispose(); m.material.dispose(); });
          badge.material.map.dispose(); badge.material.dispose(); label.remove();
        }
      });
    });
    hideLotsNear(spots);
    pickLabels();
  }

  let labelIds = new Set();
  const maxLabels = () => (W < 700 ? 2 : 4);
  function pickLabels() {
    const n = maxLabels();
    labelIds = new Set(clinicObjs.filter(o => o.c.open !== false).sort((a, b) => a.group.position.length() - b.group.position.length()).slice(0, n).map(o => o.id));
  }

  // câmera
  const target = new THREE.Vector3(0, .4, 0);
  const cam = { az: -.62, el: .72, r: 46 };
  const PIN = 1.75;
  const intro = { az: -1.45, el: 1.18, r: 64 };
  let drag = null, azVel = 0, userAz = 0, px = 0, py = 0, spx = 0, spy = 0;
  function frame() {
    camera.aspect = W / H;
    const wide = W >= 980;
    if (wide) camera.setViewOffset(W * 1.42, H * 1.06, 0, 0, W, H); else camera.clearViewOffset();
    cam.r = wide ? 46 : 38 * Math.min(1.35, Math.max(1, 1.1 / camera.aspect));
    intro.r = cam.r * 1.6;
    camera.updateProjectionMatrix();
  }
  frame();

  // interação
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  let hoverId = null;
  const isFine = matchMedia('(pointer: fine)').matches;
  let wasDrag = false;
  const pick = (cx, cy) => {
    const r = el.getBoundingClientRect();
    mouse.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height * 2 - 1)); ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(raycastTargets, false)[0];
    return hit ? hit.object.userData.id : null;
  };
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect();
    px = (e.clientX - r.left) / r.width * 2 - 1; py = (e.clientY - r.top) / r.height * 2 - 1;
    if (drag) { const dx = e.clientX - drag.x; drag.x = e.clientX; drag.moved += Math.abs(dx); azVel = -dx * .0045; userAz += azVel; return; }
    if (!isFine) return;
    hoverId = pick(e.clientX, e.clientY);
    el.style.cursor = hoverId ? 'pointer' : 'grab';
  });
  el.addEventListener('pointerleave', () => { hoverId = null; px = py = 0; drag = null; });
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('.h3d-label,a,button,input')) return;
    drag = { x: e.clientX, moved: 0 }; el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointerup', e => { wasDrag = !!drag && drag.moved > 5; drag = null; try { el.releasePointerCapture(e.pointerId); } catch (err) { } });
  el.addEventListener('click', e => {
    if (e.target.closest('.h3d-label,a,button,input')) return;
    if (wasDrag) { wasDrag = false; return; }
    const id = pick(e.clientX, e.clientY); if (id) api.onPick(id);
  });

  // loop
  let running = true, last = performance.now(), t = reduce ? 10 : 0;
  const vProj = new THREE.Vector3(), camDir = new THREE.Vector3(), head = new THREE.Vector3();

  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!reduce) t += dt;
    growUniforms.uTime.value = t;

    // câmera: entrada + giro lento + paralaxe
    const k = reduce ? 1 : ease.outCubic(clamp01(t / 2.8));
    spx += (px - spx) * .05; spy += (py - spy) * .05;
    if (!drag) { userAz += azVel; azVel *= .94; }
    const az = intro.az + (cam.az - intro.az) * k + (reduce ? 0 : t * .022) + userAz + spx * .16;
    const elv = intro.el + (cam.el - intro.el) * k - spy * .05;
    const r = intro.r + (cam.r - intro.r) * k;
    camera.position.set(target.x + Math.cos(elv) * Math.sin(az) * r, target.y + Math.sin(elv) * r, target.z + Math.cos(elv) * Math.cos(az) * r);
    camera.lookAt(target);

    // você
    meRings.forEach(rg => { const p = (t * .45 + rg.userData.phase) % 1; rg.scale.setScalar(1 + p * 2.4); rg.material.opacity = (1 - p) * .65; });
    meDot.position.y = .34 + Math.sin(t * 2.2) * .03;

    updateCars(t);

    // clínicas
    camDir.copy(camera.position);
    clinicObjs.forEach((o, i) => {
      const p = clamp01((t - o.t0) / .9);
      const isHover = hoverId === o.id || api.highlighted() === o.id;
      o.hover += ((isHover ? 1 : 0) - o.hover) * .15;
      const drop = p >= 1 ? 0 : (1 - ease.outBounce(p)) * 3.5;
      o.pin.position.y = o.h + .7 + drop + Math.sin(t * 1.7 + i) * .08 + o.hover * .35;
      o.pin.scale.setScalar(Math.max(.0001, PIN * (p <= 0 ? 0 : Math.min(1, p * 3)) * (1 + o.hover * .3)));
      o.pin.rotation.y = t * .6 + i;
      head.set(0, .8, 0);
      o.badge.position.copy(head).add(o.pin.worldToLocal(camDir.clone()).sub(head).normalize().multiplyScalar(.31));
      o.route.material.uniforms.uTime.value = t;
      o.route.material.uniforms.uOpacity.value = clamp01((t - o.t0 - .7) / 1.2) * ((o.c.open !== false ? .6 : .25) + o.hover * .4);
      o.ring.material.opacity = o.hover * .8;
      o.band.material.emissiveIntensity = .7 + o.hover * .6;
    });

    renderer.render(scene, camera);
    placeLabels(t);
  }

  function placeLabels(time) {
    vProj.set(0, 1, 0).project(camera);
    meLabel.style.transform = `translate3d(${((vProj.x * .5 + .5) * W).toFixed(1)}px,${((-vProj.y * .5 + .5) * H).toFixed(1)}px,0) translate(-50%,-100%)`;
    meLabel.classList.toggle('on', time > .9);
    const shown = [];
    clinicObjs.forEach(o => {
      vProj.set(0, 1.15, 0); o.pin.localToWorld(vProj); vProj.project(camera);
      const x = (vProj.x * .5 + .5) * W, y = (-vProj.y * .5 + .5) * H;
      const want = (labelIds.has(o.id) || hoverId === o.id || api.highlighted() === o.id) && time > o.t0 + 1 && vProj.z < 1 && x > 40 && x < W - 40 && y > 70 && y < H - 10;
      o.sx = x; o.sy = y;
      if (want) shown.push(o);
    });
    // Rótulo inteiro dentro da tela: empurra para dentro (a seta continua apontando o pino).
    shown.forEach(o => {
      if (!o.lw) { o.lw = o.label.offsetWidth || 180; o.lh = o.label.offsetHeight || 48; }
      const half = Math.min(o.lw, W - 12) / 2;
      o.cx = Math.min(Math.max(o.sx, half + 6), W - half - 6);
    });
    // evita sobreposição (caixa real de cada rótulo): o mais próximo da câmera ganha; no celular, no máximo 2
    shown.sort((a, b) => (b.id === hoverId) - (a.id === hoverId) || (b.id === api.highlighted()) - (a.id === api.highlighted()) || a.group.position.distanceTo(camera.position) - b.group.position.distanceTo(camera.position));
    const kept = [], max = maxLabels();
    shown.forEach(o => {
      if (kept.length >= max) return;
      if (kept.every(k => Math.abs(k.cx - o.cx) > (k.lw + o.lw) / 2 + 8 || Math.abs(k.sy - o.sy) > Math.max(k.lh, o.lh) + 8)) kept.push(o);
    });
    clinicObjs.forEach(o => {
      const vis = kept.includes(o);
      const cx = vis ? o.cx : o.sx;
      o.label.style.setProperty('--ax', `${(o.sx - cx).toFixed(1)}px`);
      o.label.style.transform = `translate3d(${cx.toFixed(1)}px,${o.sy.toFixed(1)}px,0) translate(-50%,calc(-100% - 22px))`;
      o.label.classList.toggle('on', vis);
      o.label.classList.toggle('hot', hoverId === o.id);
      if (o.vis !== vis) {
        o.vis = vis;
        o.label.tabIndex = vis ? 0 : -1;
        if (vis) o.label.removeAttribute('aria-hidden'); else o.label.setAttribute('aria-hidden', 'true');
      }
    });
  }

  buildClinics(!reduce);
  requestAnimationFrame(now => { last = now; tick(now); });

  const ro = new ResizeObserver(() => {
    W = el.clientWidth; H = el.clientHeight; if (!W || !H) return;
    renderer.setSize(W, H); frame(); pickLabels(); clinicObjs.forEach(o => { o.lw = 0; });
  });
  ro.observe(el);
  const io = new IntersectionObserver(([e]) => { const was = running; running = e.isIntersecting && !document.hidden; if (running && !was) { last = performance.now(); requestAnimationFrame(tick); } });
  io.observe(el);
  document.addEventListener('visibilitychange', () => { const was = running; running = !document.hidden && el.getBoundingClientRect().bottom > 0; if (running && !was) { last = performance.now(); requestAnimationFrame(tick); } });

  el.classList.add('h3d-ready');
  return {
    setOrigin() { origin = api.origin(); buildClinics(false); },
    refreshLabels() { clinicObjs.forEach(o => { const s = o.label.querySelector('small'); if (s) s.textContent = api.meta(o.c); o.lw = 0; }); }
  };
}
