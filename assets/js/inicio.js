// Página inicial do IMED. Só mostra o que vem do banco (Supabase) ou do cadastro oficial (CNES):
// nada de preço, nota, horário ou número inventado. Sem dado, a página mostra um texto neutro.
// Carregado depois de config.js, db.js e data.js (EXAMS e PLACES).

const C = window.IMED_CONFIG || {};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// iPhone e iPad (todos os navegadores do iOS usam o motor do Safari, o WebKit).
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ico = (k) => `assets/img/ico-${k}.webp`;
const fmtInt = (n) => Number(n).toLocaleString('pt-BR');
const fmtDist = (m) => (m < 1000 ? Math.max(10, Math.round(m / 10) * 10) + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km');
const round3 = (v) => Math.round(v * 1000) / 1000;

const store = {
  get(k, d) { try { const v = localStorage.getItem('imed_' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('imed_' + k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
};

// Favoritos de clínicas fictícias da versão antiga: ninguém mais lê essa chave.
try { localStorage.removeItem('imed_fav'); } catch { /* sem armazenamento */ }

const S = { view: 'inicio', place: store.get('place', 'paulista'), here: null, hl: null };
if (!PLACES[S.place]) S.place = 'paulista';
const origin = () => S.here || PLACES[S.place];
const placeName = () => (S.here ? 'sua localização' : PLACES[S.place].n);

const KINDS = {
  imagem: { n: 'Diagnóstico por imagem', plural: 'Imagem', color: '#0E7C9C', h: 2.3 },
  laboratorio: { n: 'Laboratório', plural: 'Laboratórios', color: '#6C4BD8', h: 1.8 },
  clinica: { n: 'Clínica', plural: 'Clínicas', color: '#1E9E5A', h: 1.5 },
  hospital: { n: 'Hospital', plural: 'Hospitais', color: '#E8512F', h: 2.9 },
};
const kindOf = (k) => KINDS[k] || KINDS.clinica;
// Página de cada local: parceiro pelo id, estabelecimento do CNES pelo código de 7 dígitos.
function localUrl(r, hash = '') {
  if (r.partner && r.id) return `local.html?id=${encodeURIComponent(r.id)}${hash}`;
  if (/^\d{7}$/.test(String(r.cnes || ''))) return `local.html?cnes=${r.cnes}${hash}`;
  return '';
}

function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800); }

// Chamada a uma função do banco com a chave pública (anon).
async function rpc(fn, args = {}) {
  if (!C.supabaseUrl || !C.supabaseAnonKey) throw new Error('config ausente');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${C.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST', signal: ctrl.signal,
      headers: { apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

/* ======================= NAVEGAÇÃO ======================= */
function setHash(h) { try { history.replaceState(history.state, '', location.pathname + location.search + (h || '')); } catch { /* ignora */ } }
function go(v) {
  S.view = v;
  document.querySelectorAll('[data-view]').forEach((s) => { const off = s.dataset.view !== v; s.classList.toggle('hide', off); s.hidden = off; });
  // "Pular para o conteúdo" leva ao <main> da visão aberta.
  const skip = $('.skip'); if (skip) skip.setAttribute('href', v === 'agenda' ? '#agendaMain' : '#conteudo');
  document.querySelectorAll('.tab[data-go], .bnav [data-go]').forEach((t) => {
    const on = t.dataset.go === v;
    t.classList.toggle('on', on);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  if (v === 'agenda') { renderAppts(); setHash('#agenda'); } else if (location.hash === '#agenda') setHash('');
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  headerState();
}
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (!g || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault(); closeSheet(); go(g.dataset.go);
});
function headerState() {
  const h = $('#hero');
  const at = S.view === 'inicio' && h && window.scrollY < h.offsetHeight - 90;
  document.body.classList.toggle('at-hero', !!at);
}
addEventListener('scroll', headerState, { passive: true });

/* ======================= TOPO ======================= */
const examUrl = (k) => `perto.html?exame=${encodeURIComponent(k)}`;
function renderHeroChips() {
  const chips = ['rm', 'usg', 'rx', 'mamo', 'lab'];
  $('#hchips').innerHTML = chips.map((k) => `<a class="hchip" href="${examUrl(k)}">${k === 'lab' ? '<i class="fa-solid fa-flask" aria-hidden="true"></i>' : `<img src="${ico(k)}" alt="">`}${esc(EXAMS[k].n)}</a>`).join('')
    + '<a class="hchip" href="#lista" data-tele><i class="fa-solid fa-video" aria-hidden="true"></i>Teleconsulta (em breve)</a>';
}

let sugIdx = -1, sugItems = [];
function showSug() {
  const box = $('#heroSug'), q = norm($('#heroQ').value.trim());
  sugItems = Object.entries(EXAMS).filter(([, e]) => !q || norm(e.n + ' ' + e.full).includes(q));
  sugIdx = -1;
  box.innerHTML = sugItems.length
    ? '<h6>Exames</h6>' + sugItems.map(([k, e], i) => `<a class="sug" role="option" id="sug-${i}" href="${examUrl(k)}">${k === 'lab' ? '<span class="lg" style="background:#6C4BD8"><i class="fa-solid fa-flask"></i></span>' : `<img src="${ico(k)}" alt="">`}<span><b>${esc(e.full)}</b><small>Ver lugares perto de você</small></span></a>`).join('')
    : '<p style="padding:14px;color:var(--muted)">Nenhum exame com esse nome. Toque em Buscar para ver todos os lugares perto de você.</p>';
  box.hidden = false;
  $('#heroQ').setAttribute('aria-expanded', 'true');
}
function hideSug() { $('#heroSug').hidden = true; $('#heroQ').setAttribute('aria-expanded', 'false'); $('#heroQ').removeAttribute('aria-activedescendant'); }
$('#heroQ').addEventListener('focus', showSug);
$('#heroQ').addEventListener('input', showSug);
$('#heroQ').addEventListener('keydown', (e) => {
  const opts = [...document.querySelectorAll('#heroSug .sug')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (!opts.length) return;
    sugIdx = (sugIdx + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
    opts.forEach((b, i) => { b.classList.toggle('act', i === sugIdx); b.setAttribute('aria-selected', String(i === sugIdx)); });
    $('#heroQ').setAttribute('aria-activedescendant', opts[sugIdx].id);
  }
  if (e.key === 'Escape') hideSug();
});
$('#heroSug').addEventListener('mousedown', (e) => e.preventDefault());
$('#heroQ').addEventListener('blur', () => setTimeout(hideSug, 150));
$('#heroForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (sugIdx >= 0 && sugItems[sugIdx]) { location.href = examUrl(sugItems[sugIdx][0]); return; }
  const v = norm($('#heroQ').value.trim());
  const hit = v && Object.entries(EXAMS).find(([, x]) => norm(x.n + ' ' + x.full).includes(v));
  location.href = hit ? examUrl(hit[0]) : 'perto.html?usar=localizacao';
});
$('#heroLoc').onclick = () => openPlace();

// Pílula do topo com números reais das cidades importadas do CNES.
let citiesP = null;
const loadCities = () => (citiesP ||= rpc('imported_cities').then((rows) => (Array.isArray(rows) ? rows : [])));
function renderPill(rows) {
  const valid = rows.filter((r) => Number(r.total) > 0);
  if (!valid.length) return;
  const total = valid.reduce((s, r) => s + Number(r.total), 0);
  const where = valid.length === 1 ? `em ${valid[0].name}` : `em ${fmtInt(valid.length)} cidades`;
  $('#livePill').textContent = `${fmtInt(total)} estabelecimentos oficiais ${where}`;
}

/* ======================= O QUE VOCÊ PRECISA ======================= */
function renderCats() {
  $('#cats').innerHTML = Object.entries(EXAMS).map(([k, e]) => `<a class="cat" href="${examUrl(k)}">${k === 'lab' ? '<span class="ic-lab" aria-hidden="true"><i class="fa-solid fa-flask"></i></span>' : `<img src="${ico(k)}" alt="" loading="lazy">`}<b>${esc(e.n)}</b><small>Ver perto de você<i class="fa-solid fa-arrow-right" aria-hidden="true"></i></small></a>`).join('');
}

/* ======================= CIDADES ======================= */
// Mesma regra de scripts/gerar-cidades.mjs (slugify), que cria as pastas cidades/<uf>/<slug>/.
const citySlug = (name) => norm(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const cityUrl = (r) => `cidades/${String(r.uf).toLowerCase()}/${citySlug(r.name)}/`;
function renderCities(rows) {
  const list = rows.filter((r) => r.name && r.uf && Number(r.total) > 0).sort((a, b) => Number(b.total) - Number(a.total)).slice(0, 24);
  if (!list.length) return;
  $('#cities').innerHTML = list.map((r) => `<a class="city" href="${esc(cityUrl(r))}"><i class="fa-solid fa-location-dot" aria-hidden="true"></i><span><b>${esc(r.name)}</b><small>${fmtInt(r.total)} estabelecimentos</small></span><span class="uf">${esc(r.uf)}</span></a>`).join('');
}

/* ======================= JANELAS (sheets) ======================= */
const ov = $('#ov'), sheet = $('#sheet');
let lastFocus = null;
function openSheet(html, cls = '', label = 'Detalhes') {
  lastFocus = document.activeElement;
  sheet.className = 'sheet ' + cls; sheet.innerHTML = html; sheet.setAttribute('aria-label', label);
  ov.classList.add('open'); ov.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; sheet.scrollTop = 0;
  const f = sheet.querySelector('[data-close]'); if (f) f.focus();
}
function closeSheet() {
  if (!ov.classList.contains('open')) return;
  ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; S.hl = null;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}
ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
const head = (t) => `<div class="sh-head"><h3>${t}</h3><button class="x" type="button" data-close aria-label="Fechar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>`;

function setPlaceLabels() {
  $('#addrTxt').textContent = S.here ? 'Minha localização' : PLACES[S.place].n;
  $('#heroAddr').textContent = S.here ? 'Minha localização' : PLACES[S.place].s;
}
function placeChanged() {
  setPlaceLabels();
  heroList = []; heroLoaded = false; if (window.HERO) window.HERO.setOrigin();
  if (heroLite) renderHeroLite();
  if (heroWanted) loadHeroPlaces();
  if (realStarted) renderRealMap();
}
function openPlace() {
  openSheet(head('Ponto de partida do mapa') + `<div class="sh-body">
    <a class="upload" href="perto.html?usar=localizacao"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i><span><b>Buscar perto de mim</b><br>Abre a busca completa, com filtros e pedido de agendamento.</span></a>
    <button class="upload" id="geo" type="button"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i><span><b>Usar minha localização aqui</b><br>Mostra nesta página os locais perto de onde você está.</span></button>
    <fieldset style="border:0"><legend class="lbl">Ou escolha um bairro de São Paulo</legend>
    ${Object.entries(PLACES).map(([k, p]) => `<label class="opt"><input type="radio" name="pl" value="${k}" ${!S.here && S.place === k ? 'checked' : ''}>${esc(p.n)}<small>São Paulo, SP</small></label>`).join('')}
    </fieldset>
  </div>`, 'sm', 'Ponto de partida do mapa');
  sheet.querySelectorAll('input[name=pl]').forEach((i) => { i.onchange = () => { S.here = null; S.place = i.value; store.set('place', S.place); closeSheet(); placeChanged(); }; });
  $('#geo').onclick = () => {
    if (!navigator.geolocation) return toast('Seu navegador não permite localização');
    toast('Buscando sua localização…');
    navigator.geolocation.getCurrentPosition((p) => {
      // Só a região (~110 m): a posição exata não sai do aparelho.
      S.here = { lat: round3(p.coords.latitude), lng: round3(p.coords.longitude) };
      closeSheet(); placeChanged(); toast('Mapa atualizado');
    }, () => toast('Não foi possível obter a localização'), { timeout: 10000 });
  };
}
$('#addrBtn').onclick = openPlace;

/* ======================= CLÍNICAS REAIS (CNES) ======================= */
let realMap = null, realLayer = null, realSeq = 0, realStarted = false;
const REAL_RADIUS = 2000, REAL_POINTS = 3000;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (loadLeaflet.p) return loadLeaflet.p;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'assets/vendor/leaflet/leaflet.css'; document.head.appendChild(css);
  return (loadLeaflet.p = new Promise((ok, fail) => { const sc = document.createElement('script'); sc.src = 'assets/vendor/leaflet/leaflet.js'; sc.onload = ok; sc.onerror = fail; document.head.appendChild(sc); }));
}
// Locais perto da origem: estabelecimentos do CNES + parceiros publicados do IMED.
// nearby_establishments deixa de fora quem já virou parceiro, por isso as duas chamadas.
// Se a dos parceiros falhar, mostra só o CNES; se a do CNES falhar, é erro (sem mapa).
async function nearbyAll(o, radius, limit) {
  const at = { p_lat: round3(o.lat), p_lng: round3(o.lng), p_radius_m: radius };
  const [est, par] = await Promise.all([
    rpc('nearby_establishments', { ...at, p_limit: limit }),
    rpc('nearby_clinics', { ...at, p_include_demo: false, p_limit: Math.min(limit, 100) }).catch(() => []),
  ]);
  const ok = (r) => r && r.name && Number.isFinite(r.lat) && Number.isFinite(r.lng);
  const partners = (Array.isArray(par) ? par : []).filter(ok).map((r) => ({ ...r, uf: r.uf || r.state, key: 'imed:' + r.id, partner: true }));
  const cnes = (Array.isArray(est) ? est : []).filter(ok).map((r) => ({ ...r, key: 'cnes:' + r.cnes, partner: false }));
  return { rows: [...partners, ...cnes].sort((a, b) => a.distance_m - b.distance_m), full: cnes.length >= limit };
}
// Mapa de clínicas reais, com três chamadas no mesmo ponto:
// - establishment_points: um ponto leve para cada estabelecimento do CNES na área toda (mapa e contagem);
// - nearby_establishments: os 8 mais próximos, com endereço e contato (a lista);
// - nearby_clinics: os parceiros publicados do IMED (as duas do CNES deixam de fora quem já virou parceiro).
// Se a dos parceiros falhar, mostra só o CNES; se uma do CNES falhar, é erro (sem mapa).
async function areaPlaces(o) {
  const at = { p_lat: round3(o.lat), p_lng: round3(o.lng), p_radius_m: REAL_RADIUS };
  const [pts, est, par] = await Promise.all([
    rpc('establishment_points?select=cnes,name,kind,lat,lng,distance_m,total', { ...at, p_limit: REAL_POINTS }),
    rpc('nearby_establishments', { ...at, p_limit: 8 }),
    rpc('nearby_clinics', { ...at, p_include_demo: false, p_limit: 100 }).catch(() => []),
  ]);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const ok = (r) => r && r.name && Number.isFinite(r.lat) && Number.isFinite(r.lng);
  const partners = arr(par).filter(ok).map((r) => ({ ...r, uf: r.uf || r.state, key: 'imed:' + r.id, partner: true }));
  const near = arr(est).filter(ok).map((r) => ({ ...r, key: 'cnes:' + r.cnes, partner: false }));
  // Os mais próximos já vêm com endereço e telefone: o balão do mapa usa esses dados.
  const full = new Map(near.map((r) => [r.cnes, r]));
  const points = arr(pts).filter(ok).map((r) => full.get(r.cnes) || { ...r, key: 'cnes:' + r.cnes, partner: false });
  return {
    partners, points,
    list: [...partners, ...near].sort((a, b) => a.distance_m - b.distance_m).slice(0, 8),
    more: Number(arr(pts)[0]?.total) > arr(pts).length, // a área tem mais pontos do que o limite
  };
}
function realPopup(r) {
  const k = kindOf(r.kind);
  const pop = document.createElement('div'); pop.className = 'rm-pop';
  const add = (tag, text) => { if (!text) return; const el = document.createElement(tag); el.textContent = text; pop.appendChild(el); };
  add('b', r.name); add('div', (r.partner ? 'Parceiro do IMED · ' : '') + k.n + ' · ' + fmtDist(r.distance_m)); add('div', [r.address_line, r.neighborhood].filter(Boolean).join(' · ')); add('div', r.phone); add('div', r.open_24h ? 'Aberto 24 horas' : r.shift);
  const url = localUrl(r);
  if (url) { const a = document.createElement('a'); a.href = url; a.textContent = 'Ver página do local'; pop.appendChild(a); }
  return pop;
}
async function renderRealMap() {
  const box = $('#realMap'); if (!box) return;
  const seq = ++realSeq, o = origin();
  $('#realWhere').textContent = S.here ? 'sua localização' : PLACES[S.place].n;
  try {
    await loadLeaflet();
    // Coordenadas arredondadas (~110 m): o banco só precisa da região.
    const { partners, points, list, more } = await areaPlaces(o);
    if (seq !== realSeq) return;
    if (!realMap) {
      // Canvas: em bairro movimentado são mais de mil pontos, e um elemento por ponto pesaria no celular.
      box.innerHTML = ''; realMap = L.map(box, { scrollWheelZoom: false, preferCanvas: true, zoomSnap: 0.5 });
      L.tileLayer(C.map.tiles, { maxZoom: C.map.maxZoom, attribution: C.map.attribution }).addTo(realMap);
      realLayer = L.layerGroup().addTo(realMap);
    }
    realLayer.clearLayers();
    // O círculo de 2 km e o mapa enquadrado nele: aparece a área toda, não só os mais próximos.
    L.circle([o.lat, o.lng], { radius: REAL_RADIUS, color: '#0E7C9C', weight: 1.5, opacity: 0.7, dashArray: '6 6', fill: false, interactive: false }).addTo(realLayer);
    points.forEach((r) => L.circleMarker([r.lat, r.lng], { radius: 4.5, color: '#fff', weight: 1, fillColor: kindOf(r.kind).color, fillOpacity: 0.9 }).bindPopup(() => realPopup(r)).addTo(realLayer));
    partners.forEach((r) => L.circleMarker([r.lat, r.lng], { radius: 8, color: '#FF6B4A', weight: 3, fillColor: kindOf(r.kind).color, fillOpacity: 0.95 }).bindPopup(() => realPopup(r)).addTo(realLayer));
    L.circleMarker([o.lat, o.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#FF6B4A', fillOpacity: 1 }).bindTooltip(S.here ? 'Você (aproximado)' : PLACES[S.place].n).addTo(realLayer);
    realMap.fitBounds(L.latLng(o.lat, o.lng).toBounds(REAL_RADIUS * 2), { padding: [10, 10] });
    const count = (kk) => partners.filter((r) => r.kind === kk).length + points.filter((r) => r.kind === kk).length;
    $('#realStats').innerHTML = Object.entries(KINDS).map(([kk, k]) => `<div class="rm-stat"><b>${fmtInt(count(kk))}${more ? '+' : ''}</b><span><i style="background:${k.color}"></i>${k.plural}</span></div>`).join('');
    $('#realList').innerHTML = list.length
      ? list.map((r) => {
        const k = kindOf(r.kind), url = localUrl(r);
        const inner = `<span class="dot" style="background:${k.color}"></span><span style="min-width:0"><b>${esc(r.name)}</b><small>${r.partner ? 'Parceiro do IMED · ' : ''}${esc(k.n)}${r.neighborhood ? ' · ' + esc(r.neighborhood) : ''}</small></span><span class="d">${fmtDist(r.distance_m)}</span>`;
        return `<li>${url ? `<a href="${esc(url)}">${inner}</a>` : inner}</li>`;
      }).join('')
      : '<li>Ainda não temos o cadastro oficial desta região. Toque em <b style="display:inline">Ver todas perto de mim</b> para buscar.</li>';
  } catch {
    if (seq !== realSeq) return;
    // O aviso substitui o mapa: o próximo "Tentar de novo" cria outro.
    if (realMap) { realMap.remove(); realMap = null; realLayer = null; }
    box.innerHTML = '<div class="rm-wait">Não foi possível carregar o mapa agora.<button class="btn btn-ghost" type="button" id="realRetry">Tentar de novo</button></div>';
    $('#realRetry').onclick = renderRealMap;
  }
}
(function () {
  const sec = $('#reais'); if (!sec) return;
  $('#realPlace').onclick = () => openPlace();
  const start = () => { if (realStarted) return; realStarted = true; renderRealMap(); };
  if (!('IntersectionObserver' in window)) return start();
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '300px' });
  io.observe(sec);
})();

/* ======================= MAPA 3D ======================= */
// Estabelecimentos reais do CNES perto da origem. Enquanto carrega (ou se falhar), o 3D mostra só a cidade.
let heroList = [], heroSeq = 0, heroWanted = false, heroLite = false, heroLoaded = false;
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'para', '-', '&']);
function initials(name) {
  const w = String(name).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((x) => x && !STOP.has(x.toLowerCase()));
  if (!w.length) return '+';
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
}
// Prefere variedade: alterna entre os tipos, do mais perto para o mais longe.
function pickVaried(rows, max = 14) {
  const byKind = {};
  [...rows].sort((a, b) => a.distance_m - b.distance_m).forEach((r) => { (byKind[r.kind] ||= []).push(r); });
  const order = ['imagem', 'laboratorio', 'hospital', 'clinica', ...Object.keys(byKind).filter((k) => !KINDS[k])];
  const out = [];
  while (out.length < max && order.some((k) => byKind[k]?.length)) {
    for (const k of order) { if (out.length >= max) break; const r = byKind[k]?.shift(); if (r) out.push(r); }
  }
  return out.sort((a, b) => a.distance_m - b.distance_m);
}
async function loadHeroPlaces() {
  heroWanted = true;
  const seq = ++heroSeq, o = origin();
  try {
    const { rows } = await nearbyAll(o, 3000, 80);
    if (seq !== heroSeq) return;
    heroLoaded = true;
    // Parceiros primeiro (têm exames informados); o resto com variedade de tipos.
    const partners = rows.filter((r) => r.partner).slice(0, 6);
    heroList = [...partners, ...pickVaried(rows.filter((r) => !r.partner), 14 - partners.length)].sort((a, b) => a.distance_m - b.distance_m).map((r) => {
      const k = kindOf(r.kind);
      return { id: r.key, n: r.name, ini: initials(r.name), c: k.color, lat: r.lat, lng: r.lng, open: true, r: 4.5, sup: false, kind: r.kind, h: k.h, row: r };
    });
    if (window.HERO) window.HERO.setOrigin();
    if (heroLite) renderHeroLite();
  } catch {
    // Sem dados: o 3D continua só com a cidade; no modo leve, um texto neutro com link para a busca.
    // Marca como carregado mesmo fora do modo leve: se o 3D falhar depois, a lista não fica em "Carregando…".
    if (seq === heroSeq) { heroLoaded = true; if (heroLite) renderHeroLite(); }
  }
}
// O leitor de tela ouve só este resumo (role=status), não a lista inteira a cada troca.
function liteStatus(text) { const s = $('#heroLiteStatus'); if (s && s.textContent !== text) s.textContent = text; }
// Modo leve (aparelho simples, economia de dados ou "reduzir movimento"): sem 3D, só a ilustração
// de fundo e a lista dos mesmos locais reais perto do ponto escolhido.
function renderHeroLite() {
  const box = $('#heroLite'); if (!box) return;
  const list = heroList.slice(0, innerWidth < 700 ? 4 : 5);
  const where = placeName();
  const title = `<h2><i class="fa-solid fa-location-dot" aria-hidden="true"></i>Perto de ${esc(where)}</h2>`;
  if (!list.length) {
    box.innerHTML = title + (heroLoaded ? '<p>Veja clínicas, laboratórios e hospitais perto de você na busca.</p>' : '<p>Carregando os locais perto daqui…</p>')
      + '<a class="more" href="perto.html?usar=localizacao">Buscar perto de mim <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>';
    liteStatus(heroLoaded ? 'A lista de locais não está disponível agora. Use a busca perto de você.' : `Carregando os locais perto de ${where}…`);
    return;
  }
  liteStatus(`${list.length} ${list.length === 1 ? 'local' : 'locais'} perto de ${where}`);
  box.innerHTML = title + '<ol>' + list.map((c) => {
    const r = c.row, k = kindOf(r.kind), url = localUrl(r) || 'perto.html';
    return `<li><a href="${esc(url)}"><span class="dot" style="background:${k.color}"></span><span style="min-width:0"><b>${esc(r.name)}</b><small>${r.partner ? 'Parceiro do IMED · ' : ''}${esc(k.n)} · ${fmtDist(r.distance_m)}</small></span></a></li>`;
  }).join('') + '</ol><a class="more" href="perto.html?usar=localizacao">Ver todos perto de mim <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>';
}
function openPlaceDetail(id) {
  const c = heroList.find((x) => x.id === id); if (!c) return;
  const r = c.row, k = kindOf(r.kind);
  S.hl = id;
  const addr = [r.address_line, r.neighborhood, [r.city, r.uf].filter(Boolean).join(' - ')].filter(Boolean).join(' · ');
  const tel = String(r.phone || '').replace(/\D/g, '');
  const extra = [r.open_24h ? 'Aberto 24 horas' : r.shift, r.sus ? 'Atende pelo SUS' : ''].filter(Boolean).join(' · ');
  const exams = r.partner && Array.isArray(r.exams) ? [...new Set(r.exams.map((e) => e && EXAMS[e.code]?.n).filter(Boolean))] : [];
  const page = localUrl(r);
  openSheet(head(esc(r.name)) + `<div class="sh-body">
    <span class="place-kind"><span style="background:${k.color}"></span>${r.partner ? 'Parceiro do IMED · ' : ''}${esc(k.n)} · ${fmtDist(r.distance_m)} de ${esc(placeName())}</span>
    <div class="place-info">
      ${addr ? `<div><i class="fa-solid fa-location-dot" aria-hidden="true"></i>${esc(addr)}</div>` : ''}
      ${tel.length >= 10 ? `<div><i class="fa-solid fa-phone" aria-hidden="true"></i><a href="tel:+55${tel}">${esc(r.phone)}</a></div>` : ''}
      ${extra ? `<div><i class="fa-regular fa-clock" aria-hidden="true"></i>${esc(extra)}</div>` : ''}
      ${exams.length ? `<div><i class="fa-solid fa-notes-medical" aria-hidden="true"></i>Exames informados pela clínica: ${esc(exams.join(', '))}</div>` : ''}
    </div>
    <p class="note">${r.partner ? 'Dados informados pela clínica parceira' : 'Fonte: CNES/DataSUS'}${r.cnes ? ` (CNES ${esc(r.cnes)})` : ''}. Confirme horários e valores com o local.</p>
    <div class="place-act">
      ${page ? `<a class="btn btn-coral" href="${esc(localUrl(r, '#agendar'))}"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i>Pedir agendamento</a>
      <a class="btn btn-ghost" href="${esc(page)}"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>Ver página do local</a>` : '<a class="btn btn-coral" href="perto.html"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i>Abrir a busca</a>'}
      ${!r.partner && r.cnes ? `<a class="btn btn-ghost" href="reivindicar.html?cnes=${encodeURIComponent(r.cnes)}"><i class="fa-solid fa-hospital-user" aria-hidden="true"></i>É sua clínica? Assuma o cadastro</a>` : ''}
    </div>
  </div>`, 'sm', r.name);
}
window.HERO = null;
const API = {
  clinics: () => heroList,
  origin,
  highlighted: () => S.hl,
  onPick: (id) => openPlaceDetail(id),
  meta: (c) => `${c.row.partner ? 'Parceiro · ' : ''}${kindOf(c.kind).n} · ${fmtDist(c.row.distance_m)}`,
};
// Aparelho simples, economia de dados ou "reduzir movimento": não baixa o 3D (three.js tem ~650 KB).
function liteReason() {
  if (reduceMotion) return 'movimento';
  const n = navigator, con = n.connection || {};
  if (con.saveData) return 'economia';
  if (/(^|-)2g$/.test(con.effectiveType || '')) return 'rede';
  if (typeof n.deviceMemory === 'number' && n.deviceMemory <= 2) return 'memoria';
  const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 700;
  // No iPhone o número de núcleos não serve: o Safari (WebKit) informa 4 em qualquer aparelho com menos
  // de 8 núcleos, então todo iPhone pareceria fraco. Lá a regra dos núcleos não vale.
  if (phone && !isIOS && n.hardwareConcurrency && n.hardwareConcurrency <= 4) return 'processador';
  return '';
}
const LITE = liteReason();
// Economia de dados ligada ou internet 2G: a pessoa quer gastar pouca internet.
const SAVE_DATA = LITE === 'economia' || LITE === 'rede';
function goLite(why) {
  heroLite = true;
  document.body.classList.add('lite');
  document.body.dataset.hero = 'leve';
  if (why === 'webgl') document.body.classList.add('no-webgl');
  renderHeroLite();
  if (!heroWanted) loadHeroPlaces();
}
// Espera o navegador ficar livre (depois de mostrar o topo) e o topo estar na tela.
const whenIdle = (fn) => { if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 3000 }); else setTimeout(fn, 1200); };
function whenVisible(el, fn) {
  if (!('IntersectionObserver' in window)) return fn();
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } });
  io.observe(el);
}
function startHero() {
  const el = $('#hero3d');
  if (LITE) { goLite(LITE); return; }
  document.body.dataset.hero = 'espera';
  // Primeiro o conteúdo aparece (dois quadros); depois, com o navegador livre e o topo na tela, baixa o 3D.
  requestAnimationFrame(() => requestAnimationFrame(() => whenIdle(() => whenVisible(el, load3D))));
  function load3D() {
    let ok = false;
    try { const c = document.createElement('canvas'); ok = !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { ok = false; }
    if (!ok) { goLite('webgl'); return; }
    document.body.dataset.hero = 'carregando';
    loadHeroPlaces();
    const fontsReady = document.fonts && document.fonts.load ? Promise.race([document.fonts.load('800 46px Sora'), new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
    fontsReady.then(() => import('./hero3d.js')).then((m) => { window.HERO = m.initHero3D(el, API); document.body.dataset.hero = '3d'; })
      .catch((err) => { console.warn('Mapa 3D indisponível', err); goLite('webgl'); });
  }
}

/* ======================= AGENDADOS ======================= */
// Contrato: localStorage 'imed_appts' (mais novo primeiro, até 30). Só pedidos reais (type 'pedido').
const PERIOD = { manha: 'manhã', tarde: 'tarde', noite: 'noite', qualquer: 'qualquer horário' };
const STATUS_FALLBACK = { pending: 'Aguardando contato', pendente: 'Aguardando contato', contacted: 'Em contato', confirmed: 'Confirmado', cancelled: 'Cancelado', completed: 'Concluído' };
let geoCore = null, geoCoreSync = null;
const loadGeoCore = () => (geoCore ||= import('./geo-core.js').catch(() => ({})));
function readAppts() {
  let list;
  try { list = JSON.parse(localStorage.getItem('imed_appts') || '[]'); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  const real = list.filter((a) => a && a.type === 'pedido' && a.name);
  // Descarta os agendamentos fictícios da versão antiga (type 'exame' ou 'tele').
  if (real.length !== list.length) { try { localStorage.setItem('imed_appts', JSON.stringify(real.slice(0, 30))); } catch { /* ignora */ } }
  return real.slice(0, 30);
}
// Identifica um pedido sem depender da posição na lista.
const apptKey = (a) => String(a.id || a.code || a.created || [a.name, a.date, a.period].join('|'));
const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const isoDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
function fmtDate(d) {
  if (!isoDate(d)) return d ? String(d) : '';
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}
// Horário marcado (slot, ISO) no fuso de São Paulo, qualquer que seja o fuso do aparelho:
// { date: 'AAAA-MM-DD', time: 'HH:MM' }; inválido → null. Mesma regra de geo-core.js (spDateTime),
// repetida aqui para não baixar o geo-core.js só para desenhar o cartão.
const SP_PARTS = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function slotAt(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(SP_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
let liveStatus = {}, statusState = 'idle';
async function fetchStatus(list) {
  const withTok = list.filter((a) => a.id && a.token);
  if (!withTok.length) return;
  statusState = 'loading';
  try {
    const rows = await rpc('request_status', { p_ids: withTok.map((a) => a.id), p_tokens: withTok.map((a) => a.token) });
    liveStatus = {};
    (Array.isArray(rows) ? rows : []).forEach((r) => { liveStatus[r.id] = r; });
    statusState = 'ok';
  } catch { statusState = 'fail'; }
  if (S.view === 'agenda') drawAppts(readAppts());
}
function renderAppts() {
  // geo-core.js só é baixado quando a pessoa abre Agendados.
  if (!geoCoreSync) loadGeoCore().then((m) => { geoCoreSync = m; if (S.view === 'agenda') drawAppts(readAppts()); });
  const list = readAppts();
  statusState = 'loading';
  drawAppts(list);
  fetchStatus(list);
}
function drawAppts(list) {
  const box = $('#appts');
  if (!list.length) {
    box.innerHTML = '<div class="empty"><i class="fa-regular fa-calendar" aria-hidden="true"></i>Você ainda não fez nenhum pedido de agendamento neste aparelho.<br><a class="btn btn-primary" style="margin-top:14px" href="perto.html?usar=localizacao">Encontrar um lugar perto de mim</a></div>';
    return;
  }
  const label = (s) => (geoCoreSync?.statusLabel?.(s)) || STATUS_FALLBACK[s] || '';
  box.innerHTML = list.map((a) => {
    const key = apptKey(a);
    const live = a.id && liveStatus[a.id];
    // Com horário marcado (agenda da clínica parceira), o pedido já nasce confirmado no banco.
    const at = a.slot ? slotAt(a.slot) : null;
    let st, cls;
    if (live) { st = label(live.status); cls = { confirmed: 'ok', completed: 'ok', cancelled: 'no' }[live.status] || ''; }
    else if (a.id && a.token && statusState === 'loading') { st = 'Consultando…'; cls = 'muted'; }
    // Sem resposta do banco: vale o que o aparelho guardou quando o horário foi marcado.
    else if (a.status === 'confirmado') { st = 'Confirmado'; cls = 'ok'; }
    else if (a.id && a.token && statusState === 'fail') { st = 'Situação indisponível agora'; cls = 'muted'; }
    else { st = 'Pedido enviado'; cls = 'muted'; }
    const when = at
      ? `Horário marcado: ${esc(fmtDate(at.date))} às ${esc(at.time)}`
      : [fmtDate(a.date) ? `Preferência: ${esc(fmtDate(a.date))}` : '', PERIOD[a.period] ? esc(PERIOD[a.period]) : (a.time ? esc(a.time) : '')].filter(Boolean).join(' · ');
    const items = Array.isArray(a.items) ? a.items : [];
    const review = live && live.status === 'completed' && !live.reviewed ? `<a class="btn btn-coral" href="conta.html#pedido-${encodeURIComponent(a.id)}"><i class="fa-solid fa-star-half-stroke" aria-hidden="true"></i>Avaliar</a>` : '';
    // Lembrete só para o que ainda vai acontecer: horário marcado no futuro ou dia de hoje em diante.
    const ahead = at ? Date.parse(a.slot) > Date.now() : isoDate(a.date) && a.date >= todayIso();
    const cal = ahead && !(live && ['cancelled', 'completed'].includes(live.status)) ? `<button class="btn btn-ghost" type="button" data-ics="${esc(key)}"><i class="fa-regular fa-calendar-plus" aria-hidden="true"></i>Adicionar à agenda</button>` : '';
    return `<article class="appt" ${a.id ? `id="pedido-${esc(a.id)}"` : ''}>
      <span class="lg" aria-hidden="true"><i class="fa-solid fa-calendar-check"></i></span>
      <div style="flex:1;min-width:0">
        <b>${esc(a.name)}</b>
        ${items.length ? `<p>${items.map(esc).join(' + ')}</p>` : ''}
        ${when ? `<p><i class="fa-regular fa-calendar" aria-hidden="true"></i> ${when}</p>` : ''}
        ${a.code ? `<p style="font-size:12px">Protocolo ${esc(a.code)}</p>` : ''}
        ${review || cal ? `<div class="appt-act">${review}${cal}</div>` : ''}
      </div>
      <div class="side"><span class="status ${cls}">${esc(st)}</span><button class="rmv" type="button" data-rm="${esc(key)}">Remover da lista</button></div>
    </article>`;
  }).join('');
  box.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => {
    if (!confirm('Remover este pedido da lista deste aparelho? Para cancelar o pedido, fale com o IMED pelo contato@imed.com.br.')) return;
    // Pelo pedido mostrado, não pela posição: a lista pode ter mudado em outra aba.
    const all = readAppts().filter((x) => apptKey(x) !== b.dataset.rm);
    try { localStorage.setItem('imed_appts', JSON.stringify(all)); } catch { /* ignora */ }
    drawAppts(all); toast('Pedido removido da lista');
  }; });
  box.querySelectorAll('[data-ics]').forEach((b) => { b.onclick = () => { const a = readAppts().find((x) => apptKey(x) === b.dataset.ics); if (a) downloadIcs(a); else drawAppts(readAppts()); }; });
}
async function downloadIcs(a) {
  const m = await loadGeoCore();
  if (!m.icsFile) { toast('Não foi possível criar o lembrete agora.'); return; }
  const items = Array.isArray(a.items) && a.items.length ? a.items.join(', ') : 'Atendimento';
  const prep = (m.PREP && (m.PREP[a.exam] || m.PREP.outro)) || '';
  const site = C.siteUrl || location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  // Horário marcado: evento na hora exata e já confirmado (STATUS:CONFIRMED); sem horário, a faixa do período.
  const slot = a.slot && slotAt(a.slot) ? a.slot : null;
  const head = slot
    ? [`Agendamento ${a.code || ''}`.trim(), 'no IMED. Horário confirmado. Chegue com 15 minutos de antecedência.'].join(' ')
    : [`Pedido de agendamento ${a.code || ''}`.trim(), 'no IMED. O horário é confirmado pela clínica.'].join(' ');
  const desc = [head, prep ? `Preparo: ${prep}` : ''].filter(Boolean).join('\n');
  let txt;
  try { txt = m.icsFile({ id: a.id || a.code, title: `${items} · ${a.name}`, date: a.date, period: a.period, slot, description: desc, url: a.id ? `${site}conta.html#pedido-${a.id}` : site }); }
  catch { toast('Não foi possível criar o lembrete agora.'); return; }
  const url = URL.createObjectURL(new Blob([txt], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `imed-${(a.code || 'pedido').toLowerCase()}.ics`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Lembrete baixado. Abra o arquivo para pôr na agenda.');
}

/* ======================= TELECONSULTA (lista de espera) ======================= */
function goTele() {
  if (S.view !== 'inicio') go('inicio');
  const f = $('#wlForm'); if (f) f.interest.value = 'teleconsulta';
  setTimeout(() => { $('#lista').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); }, 60);
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-tele]')) { e.preventDefault(); goTele(); } });
(function () {
  const f = $('#wlForm'); if (!f) return;
  const msg = $('#wlMsg'), btn = $('#wlBtn');
  const say = (t, cls) => { msg.textContent = t; msg.className = 'wl-msg show ' + cls; };
  if (store.get('wl', false)) say('Você já está na lista. Avisaremos no seu e-mail.', 'ok');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = f.email.value.trim().toLowerCase(), city = f.city.value.trim();
    const bad = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    f.email.classList.toggle('bad', bad);
    f.email.setAttribute('aria-invalid', String(bad));
    if (bad) { say('Digite um e-mail válido.', 'err'); f.email.focus(); return; }
    const ok = () => { store.set('wl', true); f.reset(); say('Pronto! Você está na lista e vai receber um aviso quando abrir.', 'ok'); btn.disabled = false; btn.innerHTML = 'Quero ser avisado <i class="fa-solid fa-bell" aria-hidden="true"></i>'; };
    if (f.website.value) { ok(); return; }
    btn.disabled = true; btn.textContent = 'Enviando…';
    window.imedInsert('app_waitlist', { email, city: city || null, interest: f.interest.value }).then(ok).catch(() => {
      say('Não foi possível enviar agora. Verifique sua internet e tente de novo.', 'err');
      btn.disabled = false; btn.innerHTML = 'Tentar de novo <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>';
    });
  });
})();

/* ======================= PERGUNTAS: VER TODAS ======================= */
(function () {
  const b = $('#faqAll'), more = $('#faqMore'); if (!b || !more) return;
  b.onclick = () => {
    more.hidden = false; b.remove();
    const first = more.querySelector('summary'); if (first) first.focus();
  };
})();

/* ======================= WHATSAPP ======================= */
(function () {
  const digits = String(C.whatsapp || '').replace(/\D/g, '');
  const a = $('#waFab');
  if (!a || digits.length < 10) { if (a) a.remove(); return; }
  a.href = `https://wa.me/${digits}?text=${encodeURIComponent('Olá! Vim pelo site do IMED e quero ajuda para marcar um exame.')}`;
  a.setAttribute('aria-label', 'Falar com o IMED pelo WhatsApp (abre em outra aba)');
  a.classList.remove('hide');
})();

/* ======================= LINKS DIRETOS ======================= */
function route() {
  const h = decodeURIComponent(location.hash || '');
  let m;
  if (h === '#agenda') { go('agenda'); return; }
  if (h === '#tele' || h === '#lista') { goTele(); return; }
  if (h === '#perto') { location.replace('perto.html?usar=localizacao'); return; }
  if (h === '#perfil') { location.replace('conta.html'); return; }
  if ((m = h.match(/^#exame-(\w+)$/)) && EXAMS[m[1]]) { location.replace(examUrl(m[1])); return; }
  if (h === '#lojas' || h === '#pedido' || /^#clinica-/.test(h)) { setHash(''); setTimeout(() => $('#reais').scrollIntoView(), 60); }
}
addEventListener('hashchange', route);

/* ======================= APP INSTALÁVEL ======================= */
let installEvt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const showInstall = (on) => document.querySelectorAll('.install-auto').forEach((b) => b.classList.toggle('hide', !on));
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (!isStandalone()) showInstall(true); });
addEventListener('appinstalled', () => { installEvt = null; showInstall(false); toast('App IMED instalado!'); });
if (isIOS && !isStandalone()) showInstall(true);
if (isStandalone()) document.querySelectorAll('[data-install]').forEach((b) => b.classList.add('hide'));
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-install]')) return;
  if (installEvt) { installEvt.prompt(); installEvt.userChoice.finally(() => { installEvt = null; showInstall(false); }); return; }
  openSheet(head('Instalar o app IMED') + `<div class="sh-body inst">
    <div class="inst-app"><img src="assets/icons/icon-192.png" alt=""><div><b>IMED</b><small>Clínicas e exames perto de você</small></div></div>
    <h4><i class="fa-brands fa-apple" aria-hidden="true"></i> iPhone (Safari)</h4>
    <ol><li>Toque em <b>Compartilhar</b> na barra do Safari.</li><li>Escolha <b>Adicionar à Tela de Início</b>.</li><li>Toque em <b>Adicionar</b>.</li></ol>
    <h4><i class="fa-brands fa-android" aria-hidden="true"></i> Android (Chrome)</h4>
    <ol><li>Toque no menu <b>⋮</b> do Chrome.</li><li>Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li></ol>
    <p class="note">O app abre em tela cheia e as telas que você já visitou abrem mais rápido.</p>
  </div>`, 'sm', 'Instalar o app IMED');
});
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // Quando sai uma versão nova do site, recarrega uma vez sozinho para mostrá-la.
  const hadSW = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadSW && !reloaded) { reloaded = true; location.reload(); } });
  // Com economia de dados ou internet 2G, não instala o service worker: ao instalar (e a cada versão nova),
  // ele baixa de uma vez os arquivos de todas as páginas, inclusive o 3D que o modo leve não usa.
  if (!SAVE_DATA) addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {}));
}

/* ======================= APARECER AO ROLAR ======================= */
const rvIO = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); rvIO.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.rv').forEach((el) => rvIO.observe(el));

/* ======================= INÍCIO ======================= */
setPlaceLabels(); renderHeroChips(); renderCats(); headerState();
loadCities().then((rows) => { renderPill(rows); renderCities(rows); }).catch(() => { /* sem número: texto neutro */ });
startHero();
route();
