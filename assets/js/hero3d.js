// Mapa 3D do topo da página: cidade em miniatura, pinos das clínicas e rotas até o paciente.
import * as THREE from '../vendor/three.module.min.js';

const P = 2.6;            // distância entre ruas (unidades)
const BLOCK = 2.0;        // tamanho da quadra
const CITY_R = 19;        // raio da cidade
const KM_UNITS = 2.6;     // 1 km perto do centro

const ease = {
  outCubic: t => 1 - Math.pow(1 - t, 3),
  outBack: t => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  outBounce: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375; return n * (t -= 2.625 / d) * t + .984375; }
};
const clamp01 = v => Math.min(1, Math.max(0, v));

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function makeEnv(renderer) {
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16), pos = geo.attributes.position, cols = [];
  const a = new THREE.Color(0x07202a), b = new THREE.Color(0xa8eef7), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { c.lerpColors(a, b, (pos.getY(i) / 10 + 1) / 2); cols.push(c.r, c.g, c.b); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })));
  const panel = (x, y, z, w, h, k, col = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
  };
  panel(-4, 7, 3, 6, 2.5, 4); panel(6, 3, -3, 3, 4, 2, 0xbff6ff); panel(-6, 2, -5, 3, 3, 1.4, 0xffd6c8);
  const pm = new THREE.PMREMGenerator(renderer), tex = pm.fromScene(s, .03).texture; pm.dispose();
  return tex;
}

function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(.25, inner.replace(/[\d.]+\)$/, '.55)')); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function groundTexture() {
  const size = 2048, units = 56, px = size / units;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const bg = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  bg.addColorStop(0, '#0e3443'); bg.addColorStop(.6, '#0a2836'); bg.addColorStop(1, '#071d27');
  g.fillStyle = bg; g.fillRect(0, 0, size, size);
  const toPx = u => (u + units / 2) * px;
  for (let u = -Math.floor(units / 2 / P) * P; u <= units / 2; u += P) {
    const main = Math.abs(u) < .01;
    g.strokeStyle = main ? 'rgba(127,240,228,.20)' : 'rgba(120,214,230,.085)';
    g.lineWidth = (P - BLOCK) * px * (main ? 1.15 : .9);
    g.beginPath(); g.moveTo(toPx(u), 0); g.lineTo(toPx(u), size); g.stroke();
    g.beginPath(); g.moveTo(0, toPx(u)); g.lineTo(size, toPx(u)); g.stroke();
    g.strokeStyle = 'rgba(200,250,255,.06)'; g.lineWidth = 1.2; g.setLineDash([10, 14]);
    g.beginPath(); g.moveTo(toPx(u), 0); g.lineTo(toPx(u), size); g.stroke();
    g.beginPath(); g.moveTo(0, toPx(u)); g.lineTo(size, toPx(u)); g.stroke();
    g.setLineDash([]);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { tex: t, units };
}

function badgeTexture(text, color) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
  g.fillStyle = color; g.font = '800 46px Sora, Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

const arcVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const arcFrag = `
uniform float uTime; uniform vec3 uColor; uniform float uPhase; uniform float uOpacity; varying vec2 vUv;
void main(){
  float head = fract(uTime * .26 + uPhase);
  float d = vUv.x - head;
  float trail = smoothstep(-.24, 0., d) * (1. - smoothstep(0., .012, d));
  float a = (.14 + trail * .95) * uOpacity;
  a *= smoothstep(0., .05, vUv.x) * (1. - smoothstep(.95, 1., vUv.x));
  vec3 col = mix(vec3(.62, 1., .96), uColor, .45) * (.75 + trail * .9);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;
const beamFrag = `
uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
void main(){ float a = pow(1. - vUv.y, 1.8) * .32 * uOpacity; gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;
const trafficFrag = `
uniform float uTime; uniform float uDir; uniform vec3 uColor; varying vec2 vUv;
void main(){
  float x = vUv.x * 60. - uTime * 1.6 * uDir;
  float dash = smoothstep(.0, .05, fract(x)) * (1. - smoothstep(.12, .2, fract(x)));
  float fade = 1. - smoothstep(.18, .5, abs(vUv.x - .5));
  gl_FragColor = vec4(uColor, dash * fade * .55);
  #include <colorspace_fragment>
}`;

export function initHero3D(el, api) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const labelsEl = el.querySelector('.h3d-labels');
  let W = el.clientWidth, H = el.clientHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'h3d-canvas';
  el.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x061c26, .015);
  scene.environment = makeEnv(renderer);

  const camera = new THREE.PerspectiveCamera(32, W / H, .1, 200);

  // luzes
  scene.add(new THREE.HemisphereLight(0x9fe8ff, 0x061a23, .55));
  const sun = new THREE.DirectionalLight(0xfff4e8, 1.45);
  sun.position.set(-10, 16, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .02;
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 60 });
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x2ee6d6, .55); rim.position.set(12, 6, -10); scene.add(rim);

  // chão
  const gt = groundTexture();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gt.units, gt.units), new THREE.MeshStandardMaterial({ map: gt.tex, roughness: .95, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const far = new THREE.Mesh(new THREE.CircleGeometry(120, 64), new THREE.MeshStandardMaterial({ color: 0x061c26, roughness: 1 }));
  far.rotation.x = -Math.PI / 2; far.position.y = -.02; scene.add(far);

  // trânsito animado nas avenidas principais
  const traffic = [];
  [[0, .14, 1, 0x7ff0e4], [0, -.14, -1, 0xffb3a1]].forEach(([, off, dir, col]) => {
    for (const axis of ['x', 'z']) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(48, .05), new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uDir: { value: dir }, uColor: { value: new THREE.Color(col) } },
        vertexShader: arcVert, fragmentShader: trafficFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      m.rotation.x = -Math.PI / 2; m.position.y = .015;
      if (axis === 'x') m.position.z = off; else { m.rotation.z = Math.PI / 2; m.position.x = off; }
      scene.add(m); traffic.push(m);
    }
  });

  // prédios (instanciados)
  const rand = rng(7);
  const lots = [], parks = [];
  const nB = Math.ceil(CITY_R / P) + 1;
  for (let i = -nB; i < nB; i++) for (let j = -nB; j < nB; j++) {
    const cx = (i + .5) * P, cz = (j + .5) * P, d = Math.hypot(cx, cz);
    if (d > CITY_R) continue;
    if (rand() < .07 && d > 3) { parks.push([cx, cz]); continue; }
    const r = rand(), g = .12, half = BLOCK / 2;
    let cells;
    if (r < .3) cells = [[0, 0, BLOCK, BLOCK]];
    else if (r < .62) cells = rand() < .5 ? [[-half / 2, 0, half - g / 2, BLOCK], [half / 2, 0, half - g / 2, BLOCK]] : [[0, -half / 2, BLOCK, half - g / 2], [0, half / 2, BLOCK, half - g / 2]];
    else cells = [[-half / 2, -half / 2], [half / 2, -half / 2], [-half / 2, half / 2], [half / 2, half / 2]].map(([x, z]) => [x, z, half - g / 2, half - g / 2]);
    for (const [ox, oz, w, dd] of cells) {
      const tower = d < 8 && rand() > .8;
      const h = tower ? 1.7 + rand() * 1.7 : .3 + Math.pow(rand(), 2) * (d < 10 ? 1.45 : 1.0);
      const inset = .06 + rand() * .1;
      lots.push({ x: cx + ox, z: cz + oz, w: Math.max(.3, w - inset), d: Math.max(.3, dd - inset), h, dist: Math.hypot(cx + ox, cz + oz), delay: 0 });
    }
  }
  const bGeo = new THREE.BoxGeometry(1, 1, 1); bGeo.translate(0, .5, 0);
  {
    const cols = [], pos = bGeo.attributes.position, lo = new THREE.Color(0x08212b), hi = new THREE.Color(0x2c6779), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) { c.lerpColors(lo, hi, Math.pow(pos.getY(i), .8)); cols.push(c.r, c.g, c.b); }
    bGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  }
  const bMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: .05, envMapIntensity: .55 });
  const city = new THREE.InstancedMesh(bGeo, bMat, lots.length);
  city.castShadow = true; city.receiveShadow = true;
  const tint = new THREE.Color();
  lots.forEach((l, i) => { l.delay = reduce ? 0 : l.dist / CITY_R * .95 + rand() * .3; tint.setHSL(.53, .2, .85 + rand() * .2); city.setColorAt(i, tint); });
  scene.add(city);

  // parques
  const treeGeo = new THREE.SphereGeometry(.22, 12, 8);
  const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ color: 0x1f7a63, roughness: .9 }), parks.length * 7);
  const parkMat = new THREE.MeshStandardMaterial({ color: 0x0f3b35, roughness: 1 });
  let ti = 0; const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  parks.forEach(([x, z]) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(BLOCK, .04, BLOCK), parkMat); p.position.set(x, .02, z); p.receiveShadow = true; scene.add(p);
    for (let k = 0; k < 7; k++) { const sc = .7 + rand() * .7; m4.compose(v3.set(x + (rand() - .5) * 1.5, .2 * sc, z + (rand() - .5) * 1.5), q, s3.set(sc, sc, sc)); trees.setMatrixAt(ti++, m4); }
  });
  trees.count = ti; trees.castShadow = true; scene.add(trees);

  // partículas
  const pCount = 260, pPos = new Float32Array(pCount * 3);
  for (let i = 0; i < pCount; i++) { const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 18; pPos[i * 3] = Math.cos(a) * r; pPos[i * 3 + 1] = rand() * 9; pPos[i * 3 + 2] = Math.sin(a) * r; }
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const dots = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: .09, map: glowTexture('rgba(127,240,228,1)', 'rgba(127,240,228,0)'), color: 0xffffff, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(dots);

  // você está aqui
  const me = new THREE.Group(); scene.add(me);
  const meBase = new THREE.Mesh(new THREE.CylinderGeometry(.62, .68, .1, 48), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .3, clearcoat: 1 }));
  meBase.position.y = .04; meBase.castShadow = true; me.add(meBase);
  const meDot = new THREE.Mesh(new THREE.SphereGeometry(.36, 32, 24), new THREE.MeshPhysicalMaterial({ color: 0xff6b4a, emissive: 0xff6b4a, emissiveIntensity: .55, roughness: .25, clearcoat: 1 }));
  meDot.position.y = .42; meDot.castShadow = true; me.add(meDot);
  const meGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,107,74,1)', 'rgba(255,107,74,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  meGlow.scale.setScalar(4); meGlow.position.y = .4; me.add(meGlow);
  const meRings = [0, 1, 2].map(i => {
    const r = new THREE.Mesh(new THREE.RingGeometry(.7, .78, 64), new THREE.MeshBasicMaterial({ color: 0xff8a6e, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    r.rotation.x = -Math.PI / 2; r.position.y = .03; r.userData.phase = i / 3; me.add(r); return r;
  });

  const meLabel = document.createElement('div'); meLabel.className = 'h3d-me'; meLabel.textContent = 'Você está aqui'; labelsEl.appendChild(meLabel);

  // clínicas (recriadas quando a origem muda)
  let clinicObjs = [], origin = api.origin();
  const pinProfile = [[0, 0], [.05, .1], [.14, .28], [.23, .48], [.29, .66], [.3, .8], [.27, .94], [.2, 1.04], [.1, 1.1], [0, 1.12]].map(p => new THREE.Vector2(p[0], p[1]));
  const pinGeo = new THREE.LatheGeometry(pinProfile, 40);
  const raycastTargets = [];

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
    if (used.has(key(bi, bj)) || (bi === -1 || bi === 0) && (bj === -1 || bj === 0) && Math.hypot(x, z) < 1) {
      const opts = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
      for (const [a, b] of opts) if (!used.has(key(bi + a, bj + b))) { bi += a; bj += b; break; }
    }
    used.add(key(bi, bj));
    return [(bi + .5) * P, (bj + .5) * P];
  }

  function hideLotsNear(points) {
    lots.forEach(l => { l.hidden = points.some(([x, z]) => Math.abs(l.x - x) < BLOCK / 2 + .05 && Math.abs(l.z - z) < BLOCK / 2 + .05); });
    needCityUpdate = true;
  }

  function buildClinics(intro) {
    clinicObjs.forEach(o => { scene.remove(o.group); scene.remove(o.arc); o.dispose(); });
    clinicObjs = []; raycastTargets.length = 0;
    const used = new Set();
    const list = api.clinics();
    const spots = [];
    list.forEach((c, idx) => {
      const [x0, z0] = toXZ(c.lat, c.lng);
      const [x, z] = snap(x0, z0, used);
      spots.push([x, z]);
      const color = new THREE.Color(c.c);
      const h = 1.3 + (c.r - 4) * 1.4 + (c.sup ? .5 : 0);
      const group = new THREE.Group(); group.position.set(x, 0, z); scene.add(group);

      const bld = new THREE.Mesh(new THREE.BoxGeometry(1.5, h, 1.5).translate(0, h / 2, 0), new THREE.MeshPhysicalMaterial({ color: 0xeaf6f9, roughness: .35, clearcoat: .6, emissive: color, emissiveIntensity: .12, envMapIntensity: 1 }));
      bld.castShadow = true; bld.receiveShadow = true; group.add(bld);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.52, .06, 1.52), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .6 }));
      roof.position.y = h; group.add(roof);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.28, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = .03; group.add(ring);
      const ripple = ring.clone(); ripple.material = ring.material.clone(); group.add(ripple);

      const beam = new THREE.Mesh(new THREE.CylinderGeometry(.06, .34, 4.2, 24, 1, true).translate(0, 2.1, 0), new THREE.ShaderMaterial({
        uniforms: { uColor: { value: color.clone().lerp(new THREE.Color(0xffffff), .25) }, uOpacity: { value: 0 } },
        vertexShader: arcVert, fragmentShader: beamFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      }));
      beam.position.y = h; group.add(beam);

      const pin = new THREE.Group(); pin.position.y = h + .7; group.add(pin);
      const pinMesh = new THREE.Mesh(pinGeo, new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: .35, roughness: .22, clearcoat: 1, clearcoatRoughness: .1 }));
      pinMesh.castShadow = true; pinMesh.userData.id = c.id; pin.add(pinMesh);
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(c.ini, c.c), depthWrite: false }));
      badge.scale.setScalar(.42); pin.add(badge);
      raycastTargets.push(pinMesh, bld); bld.userData.id = c.id;

      const start = new THREE.Vector3(0, .45, 0), end = new THREE.Vector3(x, h + .05, z);
      const mid = start.clone().add(end).multiplyScalar(.5); mid.y += 1.6 + start.distanceTo(end) * .22;
      const arc = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, mid, end), 80, .032, 8), new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: color }, uPhase: { value: idx * .137 }, uOpacity: { value: 0 } },
        vertexShader: arcVert, fragmentShader: arcFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      scene.add(arc);

      const label = document.createElement('button');
      label.className = 'h3d-label'; label.type = 'button';
      label.innerHTML = `<span class="lg" style="background:${c.c}">${c.ini}</span><span class="tx"><b>${c.n}</b><small>${api.meta(c)}</small></span>`;
      label.addEventListener('click', () => api.onPick(c.id));
      labelsEl.appendChild(label);

      clinicObjs.push({
        id: c.id, c, group, bld, roof, ring, ripple, beam, pin, pinMesh, badge, arc, label, h,
        t0: intro ? 1.25 + idx * .07 : -10, hover: 0, show: false, sx: 0, sy: 0, onScreen: false,
        dispose() { [bld, roof, ring, ripple, beam, pinMesh, arc].forEach(m => { m.geometry !== pinGeo && m.geometry.dispose(); m.material.dispose(); }); badge.material.map.dispose(); badge.material.dispose(); label.remove(); }
      });
    });
    hideLotsNear(spots);
    pickLabels();
  }

  let labelIds = new Set();
  function pickLabels() {
    const n = W < 700 ? 2 : 4;
    labelIds = new Set(clinicObjs.filter(o => o.c.open).sort((a, b) => a.group.position.length() - b.group.position.length()).slice(0, n).map(o => o.id));
  }

  // câmera
  const target = new THREE.Vector3(0, .4, 0);
  const cam = { az: -.62, el: .8, r: 48 };
  const PIN = 1.75;
  const intro = { az: -1.45, el: 1.18, r: 64 };
  let drag = null, azVel = 0, userAz = 0, px = 0, py = 0, spx = 0, spy = 0;
  function frame() {
    const aspect = W / H;
    camera.aspect = aspect;
    const wide = W >= 980;
    if (wide) camera.setViewOffset(W * 1.42, H * 1.06, 0, 0, W, H); else camera.clearViewOffset();
    cam.r = wide ? 48 : 46 * Math.min(1.45, Math.max(1, 1.25 / aspect));
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
  let running = true, needCityUpdate = true, last = performance.now(), t = reduce ? 10 : 0;
  const clock = { start: performance.now() };
  const vProj = new THREE.Vector3(), camDir = new THREE.Vector3();

  function updateCity(time) {
    let animating = false;
    lots.forEach((l, i) => {
      const p = l.hidden ? 0 : clamp01((time - l.delay) / .75);
      if (p < 1 && !l.hidden) animating = true;
      const sy = Math.max(.0001, l.h * (p >= 1 ? 1 : ease.outBack(p)));
      m4.compose(v3.set(l.x, 0, l.z), q, s3.set(l.hidden ? .0001 : l.w, l.hidden ? .0001 : sy, l.hidden ? .0001 : l.d));
      city.setMatrixAt(i, m4);
    });
    city.instanceMatrix.needsUpdate = true;
    return animating;
  }

  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!reduce) t += dt;
    if (needCityUpdate) needCityUpdate = updateCity(t);

    // câmera: entrada + giro lento + paralaxe
    const k = reduce ? 1 : ease.outCubic(clamp01(t / 2.8));
    spx += (px - spx) * .05; spy += (py - spy) * .05;
    if (!drag) { userAz += azVel; azVel *= .94; }
    const az = intro.az + (cam.az - intro.az) * k + (reduce ? 0 : t * .028) + userAz + spx * .16;
    const elv = intro.el + (cam.el - intro.el) * k - spy * .05;
    const r = intro.r + (cam.r - intro.r) * k;
    camera.position.set(target.x + Math.cos(elv) * Math.sin(az) * r, target.y + Math.sin(elv) * r, target.z + Math.cos(elv) * Math.cos(az) * r);
    camera.lookAt(target);

    // você
    meRings.forEach(rg => { const p = (t * .45 + rg.userData.phase) % 1; rg.scale.setScalar(1 + p * 3.2); rg.material.opacity = (1 - p) * .7; });
    meDot.position.y = .42 + Math.sin(t * 2.2) * .04;

    // trânsito e partículas
    traffic.forEach(m => m.material.uniforms.uTime.value = t);
    const pa = pGeo.attributes.position;
    if (!reduce) { for (let i = 0; i < pCount; i++) { let y = pa.getY(i) + dt * .25; if (y > 9) y = 0; pa.setY(i, y); } pa.needsUpdate = true; }

    // clínicas
    camDir.copy(camera.position);
    clinicObjs.forEach((o, i) => {
      const p = clamp01((t - o.t0) / .9);
      const isHover = hoverId === o.id || api.highlighted() === o.id;
      o.hover += ((isHover ? 1 : 0) - o.hover) * .15;
      const drop = p >= 1 ? 0 : (1 - ease.outBounce(p)) * 3.5;
      o.pin.position.y = o.h + .7 + drop + Math.sin(t * 1.7 + i) * .1 + o.hover * .35;
      const s = PIN * (p <= 0 ? 0 : Math.min(1, p * 3)) * (1 + o.hover * .3);
      o.pin.scale.setScalar(Math.max(.0001, s));
      o.pin.rotation.y = t * .6 + i;
      // selo sempre de frente para a câmera
      const head = new THREE.Vector3(0, .8, 0);
      o.badge.position.copy(head).add(o.pin.worldToLocal(camDir.clone()).sub(head).normalize().multiplyScalar(.31));
      o.beam.material.uniforms.uOpacity.value = clamp01((t - o.t0 - .5) / 1) * (.55 + o.hover * .9);
      o.arc.material.uniforms.uTime.value = t;
      o.arc.material.uniforms.uOpacity.value = clamp01((t - o.t0 - .7) / 1.2) * (o.c.open ? .9 : .35) * (1 + o.hover * 1.2);
      const rp = (t * .35 + i * .21) % 1; o.ripple.scale.setScalar(1 + rp * 1.4); o.ripple.material.opacity = (1 - rp) * .55;
      o.ring.material.opacity = .5 + o.hover * .5;
      o.bld.material.emissiveIntensity = .12 + o.hover * .25;
    });

    renderer.render(scene, camera);
    placeLabels(t);
  }

  function placeLabels(time) {
    vProj.set(0, 1.25, 0).project(camera);
    meLabel.style.transform = `translate3d(${((vProj.x * .5 + .5) * W).toFixed(1)}px,${((-vProj.y * .5 + .5) * H).toFixed(1)}px,0) translate(-50%,-100%)`;
    meLabel.classList.toggle('on', time > .9);
    const shown = [];
    clinicObjs.forEach(o => {
      vProj.set(0, 1.15, 0); o.pin.localToWorld(vProj); vProj.project(camera);
      const x = (vProj.x * .5 + .5) * W, y = (-vProj.y * .5 + .5) * H;
      const want = (labelIds.has(o.id) || hoverId === o.id || api.highlighted() === o.id) && time > o.t0 + 1 && vProj.z < 1 && x > 40 && x < W - 40 && y > 70 && y < H - 10;
      o.sx = x; o.sy = y; o.want = want;
      if (want) shown.push(o);
    });
    // evita sobreposição: o mais próximo da câmera ganha
    shown.sort((a, b) => (b.id === hoverId) - (a.id === hoverId) || a.group.position.distanceTo(camera.position) - b.group.position.distanceTo(camera.position));
    const kept = [];
    shown.forEach(o => { if (kept.every(k => Math.abs(k.sx - o.sx) > 190 || Math.abs(k.sy - o.sy) > 58)) kept.push(o); });
    clinicObjs.forEach(o => {
      const vis = kept.includes(o);
      o.label.style.transform = `translate3d(${o.sx.toFixed(1)}px,${o.sy.toFixed(1)}px,0) translate(-50%,calc(-100% - 22px))`;
      o.label.classList.toggle('on', vis);
      o.label.classList.toggle('hot', hoverId === o.id);
      o.label.tabIndex = vis ? 0 : -1;
    });
  }

  buildClinics(!reduce);
  requestAnimationFrame(now => { last = now; tick(now); });

  const ro = new ResizeObserver(() => {
    W = el.clientWidth; H = el.clientHeight; if (!W || !H) return;
    renderer.setSize(W, H); frame(); pickLabels();
  });
  ro.observe(el);
  const io = new IntersectionObserver(([e]) => { const was = running; running = e.isIntersecting && !document.hidden; if (running && !was) { last = performance.now(); requestAnimationFrame(tick); } });
  io.observe(el);
  document.addEventListener('visibilitychange', () => { const was = running; running = !document.hidden && el.getBoundingClientRect().bottom > 0; if (running && !was) { last = performance.now(); requestAnimationFrame(tick); } });

  el.classList.add('h3d-ready');
  return {
    setOrigin() { origin = api.origin(); buildClinics(false); },
    refreshLabels() { clinicObjs.forEach(o => { const s = o.label.querySelector('small'); if (s) s.textContent = api.meta(o.c); }); }
  };
}
