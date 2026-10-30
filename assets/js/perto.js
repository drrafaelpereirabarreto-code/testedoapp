// Página "Clínicas perto de você".
// Fluxo: a pessoa permite a localização (ou digita CEP, cidade ou endereço) → o site busca no banco do
// IMED, já ordenados por distância, as clínicas parceiras e os estabelecimentos reais do cadastro oficial
// (CNES) → lista e mapa com filtros → detalhes → pedido de agendamento gravado no banco.
// Se a cidade ainda não está no banco, o servidor começa a importá-la do CNES e, enquanto isso, a página
// completa a lista com o mapa público (OpenStreetMap) e busca de novo em alguns segundos.
// Privacidade: as coordenadas são arredondadas (~110 m) assim que chegam, ficam só na memória
// desta página e nunca são gravadas no aparelho nem no banco.
import * as G from './geo-core.js';

const CFG = window.IMED_CONFIG;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const params = new URLSearchParams(location.search);
const desktop = matchMedia('(min-width: 900px)');
const kmLabel = (m) => `${m / 1000} km`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const S = {
  phase: 'intro', // intro | locating | geo-error | loading | results
  geoError: null,
  origin: null, // { lat, lng } arredondado
  originLabel: '',
  originKind: null, // gps | busca | mapa
  precision: null,
  fetchedRadius: 0,
  provider: null, // google | osm (informado pelo servidor)
  imed: [],
  cnes: [], // estabelecimentos reais do cadastro oficial (CNES), já no banco do IMED
  places: [], // estabelecimentos do mapa (Google Places ou OpenStreetMap)
  imedState: 'idle', // idle | loading | ok | error
  cnesState: 'idle',
  placesState: 'idle',
  coverage: null, // { status: done | loading | unavailable, city, uf }
  retries: 0,
  retryTimer: 0,
  fnDown: false,
  truncated: false,
  cnesTruncated: false,
  f: { ...G.DEFAULT_FILTERS },
  selected: null,
  demo: params.get('demo') === '1',
  seq: 0,
  ctrl: null,
};
const osmCache = new Map();

/* ======================= serviços ======================= */
function linkedSignal(parent, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Tempo esgotado', 'TimeoutError')), ms);
  const stop = () => ctrl.abort(parent.reason);
  if (parent) {
    if (parent.aborted) stop();
    else parent.addEventListener('abort', stop, { once: true });
  }
  return { signal: ctrl.signal, done() { clearTimeout(timer); parent?.removeEventListener('abort', stop); } };
}

const authHeaders = () => ({ 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey, Authorization: `Bearer ${CFG.supabaseAnonKey}` });

async function callFn(body, parent, ms = 20000) {
  const t = linkedSignal(parent, ms);
  try {
    const res = await fetch(`${CFG.functionsUrl}/clinicas-proximas`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body), signal: t.signal });
    let data = null;
    try { data = await res.json(); } catch { /* resposta sem JSON */ }
    if (!res.ok || !data?.ok) throw Object.assign(new Error(data?.error || `http ${res.status}`), { status: res.status, code: data?.error });
    return data;
  } finally {
    t.done();
  }
}

// Plano B quando a função do servidor não responde: as mesmas buscas direto no banco.
async function rpc(fn, args, parent) {
  const t = linkedSignal(parent, 12000);
  try {
    const res = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, { method: 'POST', headers: authHeaders(), signal: t.signal, body: JSON.stringify(args) });
    if (!res.ok) throw new Error(`banco ${res.status}`);
    return await res.json();
  } finally {
    t.done();
  }
}
const rpcNearby = (origin, radius, parent) =>
  rpc('nearby_clinics', { p_lat: origin.lat, p_lng: origin.lng, p_radius_m: radius, p_include_demo: S.demo, p_limit: 100 }, parent);
const rpcEstablishments = (origin, radius, parent) =>
  rpc('nearby_establishments', { p_lat: origin.lat, p_lng: origin.lng, p_radius_m: radius, p_limit: CNES_LIMIT }, parent);
const CNES_LIMIT = 250;
const RETRY_MS = 9000;

async function fetchOverpass(origin, radius, parent) {
  const key = `${origin.lat},${origin.lng},${radius}`;
  if (osmCache.has(key)) return osmCache.get(key);
  const body = 'data=' + encodeURIComponent(G.overpassQuery(origin, radius));
  let last = new Error('overpass indisponível');
  for (const url of CFG.overpass) {
    const t = linkedSignal(parent, 25000);
    try {
      const res = await fetch(url, { method: 'POST', body, signal: t.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!res.ok) throw new Error(`overpass ${res.status}`);
      const json = await res.json();
      osmCache.set(key, json);
      return json;
    } catch (err) {
      if (parent?.aborted) throw err;
      last = err;
    } finally {
      t.done();
    }
  }
  throw last;
}

/* ======================= busca ======================= */
// refresh = nova busca automática no mesmo ponto, enquanto a cidade é importada do CNES:
// mantém o que já está na tela e não move o mapa.
async function runSearch(origin, label, kind, precision = null, refresh = false) {
  S.ctrl?.abort();
  clearTimeout(S.retryTimer);
  const ctrl = (S.ctrl = new AbortController());
  const seq = ++S.seq;
  const radius = S.f.radius;
  if (!refresh) {
    Object.assign(S, {
      phase: 'loading', origin, originLabel: label, originKind: kind, precision, fetchedRadius: radius,
      imed: [], cnes: [], places: [], imedState: 'loading', cnesState: 'loading', placesState: 'idle', coverage: null,
      retries: 0, fnDown: false, truncated: false, cnesTruncated: false, selected: null,
    });
    userMoved = false;
    hideAreaBtn();
    drawOrigin();
    moveMap(() => map.fitBounds(L.latLng(origin.lat, origin.lng).toBounds(radius * 2)));
    render();
  }

  let r = null;
  try {
    r = await callFn({ action: 'search', lat: origin.lat, lng: origin.lng, radius_m: radius, include_demo: S.demo }, ctrl.signal);
  } catch {
    if (ctrl.signal.aborted || seq !== S.seq) return;
  }
  if (seq !== S.seq) return;
  if (r) {
    S.fnDown = false;
    S.provider = r.provider;
    S.imed = (r.imed ?? []).map((row) => G.normalizeImedRow(row, origin));
    S.imedState = r.warnings?.includes('imed_unavailable') ? 'error' : 'ok';
    S.cnes = (r.cnes ?? []).map((row) => G.normalizeCnes(row, origin));
    S.cnesState = r.warnings?.includes('cnes_unavailable') ? 'error' : 'ok';
    S.cnesTruncated = (r.cnes ?? []).length >= CNES_LIMIT;
    S.coverage = r.coverage ?? null;
    if (r.provider === 'google') {
      S.places = (r.places ?? []).map((p) => G.normalizeGoogle(p, origin)).filter(Boolean);
      S.placesState = r.warnings?.includes('places_unavailable') ? 'error' : 'ok';
    }
  } else {
    // A função do servidor não respondeu: o banco é consultado direto.
    S.fnDown = true;
    const [imedRes, cnesRes] = await Promise.allSettled([rpcNearby(origin, radius, ctrl.signal), rpcEstablishments(origin, radius, ctrl.signal)]);
    if (ctrl.signal.aborted || seq !== S.seq) return;
    S.imed = imedRes.status === 'fulfilled' ? imedRes.value.map((row) => G.normalizeImedRow(row, origin)) : [];
    S.imedState = imedRes.status === 'fulfilled' ? 'ok' : 'error';
    S.cnes = cnesRes.status === 'fulfilled' ? cnesRes.value.map((row) => G.normalizeCnes(row, origin)) : [];
    S.cnesState = cnesRes.status === 'fulfilled' ? 'ok' : 'error';
    S.cnesTruncated = S.cnes.length >= CNES_LIMIT;
    S.coverage = { status: S.cnes.length ? 'done' : 'unavailable', city: null, uf: null };
  }
  // Com a cidade no banco, o cadastro oficial basta; sem ela, o mapa público completa a lista.
  const google = S.provider === 'google' && !S.fnDown;
  const needOsm = !google && S.coverage?.status !== 'done';
  if (!google && !needOsm) { S.places = []; S.placesState = 'idle'; S.truncated = false; }
  S.phase = 'results';
  render(!refresh || !userMoved);
  if (S.coverage?.status === 'loading' && S.retries < 4) {
    S.retryTimer = setTimeout(() => {
      if (seq !== S.seq) return;
      S.retries += 1;
      runSearch(origin, label, kind, precision, true);
    }, RETRY_MS);
  }
  if (needOsm) await loadOsm(origin, radius, ctrl.signal, seq);
}

async function loadOsm(origin, radius, signal, seq) {
  S.placesState = 'loading';
  if (S.phase === 'results') render();
  try {
    const json = await fetchOverpass(origin, radius, signal);
    if (seq !== S.seq) return;
    S.places = G.parseOverpass(json, origin, radius);
    S.truncated = (json.elements?.length ?? 0) >= 1000;
    S.placesState = 'ok';
  } catch {
    if (signal.aborted || seq !== S.seq) return;
    S.placesState = 'error';
  }
  if (S.phase === 'results') render(true);
}

function retryPlaces() {
  if (!S.origin) return;
  if (S.provider === 'google' && !S.fnDown) return runSearch(S.origin, S.originLabel, S.originKind, S.precision);
  const ctrl = S.ctrl ?? new AbortController();
  loadOsm(S.origin, S.fetchedRadius, ctrl.signal, S.seq);
}

const retrySearch = () => S.origin && runSearch(S.origin, S.originLabel, S.originKind, S.precision);

/* ======================= localização ======================= */
async function permissionState() {
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch {
    return 'unknown';
  }
}

function locate() {
  if (!('geolocation' in navigator) || !window.isSecureContext) return geoFail('unsupported');
  const keep = S.phase === 'results';
  if (!keep) { S.phase = 'locating'; render(); }
  setQMsg('');
  $('#locBtn').setAttribute('aria-busy', 'true');
  navigator.geolocation.getCurrentPosition((pos) => {
    $('#locBtn').removeAttribute('aria-busy');
    // Só a posição arredondada segue adiante; a precisa não é guardada em lugar nenhum.
    const o = { lat: G.roundCoord(pos.coords.latitude), lng: G.roundCoord(pos.coords.longitude) };
    $('#q').value = '';
    runSearch(o, 'sua localização', 'gps');
  }, (err) => {
    $('#locBtn').removeAttribute('aria-busy');
    geoFail(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable');
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
}

const GEO_MSG = {
  denied: ['Você não liberou a localização', 'Tudo bem. Digite seu CEP, cidade ou endereço acima para ver o que tem por perto. Se quiser liberar depois, toque no cadeado ao lado do endereço do site e permita a localização.'],
  unavailable: ['Não conseguimos descobrir onde você está', 'Verifique se a localização do aparelho está ligada ou digite seu CEP, cidade ou endereço acima.'],
  timeout: ['A localização demorou para responder', 'Tente de novo em um lugar com sinal melhor ou digite seu CEP, cidade ou endereço acima.'],
  unsupported: ['Seu navegador não oferece localização', 'Digite seu CEP, cidade ou endereço acima para ver as clínicas por perto.'],
};

function geoFail(code) {
  if (S.phase === 'results') {
    setQMsg(`${GEO_MSG[code][0]}. ${GEO_MSG[code][1]}`);
    return;
  }
  S.phase = 'geo-error';
  S.geoError = code;
  render();
}

/* ======================= busca por CEP, cidade ou endereço ======================= */
let geoCtrl = null;
async function onSearchSubmit(e) {
  e.preventDefault();
  const q = $('#q').value.replace(/\s+/g, ' ').trim();
  const digits = q.replace(/\D/g, '');
  if (q.length < 3) return setQMsg('Digite um CEP, uma cidade ou um endereço.', true);
  if (/^[\d\s.-]+$/.test(q) && digits.length !== 8) return setQMsg('O CEP tem 8 números, por exemplo 01310-100.', true);
  setQMsg('');
  geoCtrl?.abort();
  geoCtrl = new AbortController();
  const btn = $('#goBtn');
  btn.disabled = true;
  btn.textContent = 'Buscando…';
  try {
    const g = await callFn({ action: 'geocode', q }, geoCtrl.signal, 15000);
    const o = { lat: G.roundCoord(g.lat), lng: G.roundCoord(g.lng) };
    if (g.precision === 'cidade' || g.precision === 'estado') setQMsg(`Mostrando a partir do centro de ${g.label}. Para resultados mais perto de você, use o CEP ou o endereço.`, false, true);
    runSearch(o, g.label, 'busca', g.precision);
    if (!desktop.matches) $('#count').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (err.code === 'not_found') setQMsg('Não encontramos esse endereço. Confira o CEP ou tente com cidade e bairro.', true);
    else if (err.status === 429) setQMsg('Muitas buscas seguidas. Espere um minuto e tente de novo.', true);
    else setQMsg('Não foi possível localizar o endereço agora. Verifique sua internet e tente de novo.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar';
  }
}

function setQMsg(text, isError = false, info = false) {
  const el = $('#qMsg');
  el.hidden = !text;
  el.textContent = text;
  el.classList.toggle('info', !!info && !isError);
  if (text && isError) $('#q').focus({ preventScroll: true });
}

/* ======================= mapa ======================= */
let map, markersLayer, originLayer, programmatic = false, programmaticTimer = 0, userMoved = false;
const markerById = new Map();
const PIN = '<svg viewBox="0 0 32 42" aria-hidden="true"><path d="M16 40.5s12.5-13.6 12.5-23.6C28.5 9.6 22.9 4 16 4S3.5 9.6 3.5 16.9c0 10 12.5 23.6 12.5 23.6z"/></svg>';

function initMap() {
  map = L.map('map', { zoomControl: false, minZoom: 4, maxZoom: CFG.map.maxZoom }).setView([-15.8, -47.9], 4);
  L.control.zoom({ position: 'topright', zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  L.tileLayer(CFG.map.tiles, { maxZoom: CFG.map.maxZoom, attribution: CFG.map.attribution }).addTo(map);
  originLayer = L.layerGroup().addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  map.on('dragstart', () => { userMoved = true; });
  map.on('zoomstart', () => { if (!programmatic) userMoved = true; });
  map.on('moveend', onMapMove);
}

function moveMap(fn) {
  programmatic = true;
  clearTimeout(programmaticTimer);
  programmaticTimer = setTimeout(() => { programmatic = false; }, 900);
  fn();
}

function pinIcon(p) {
  const cls = `mk k-${p.kind}${p.source === 'imed' ? ' mk-imed' : ''}${p.id === S.selected ? ' on' : ''}`;
  return L.divIcon({ className: 'mk-wrap', iconSize: [32, 42], iconAnchor: [16, 41], html: `<span class="${cls}">${PIN}<i class="fa-solid ${G.KINDS[p.kind].icon}"></i></span>` });
}

function drawMarkers(list) {
  markersLayer.clearLayers();
  markerById.clear();
  for (const p of list) {
    const m = L.marker([p.lat, p.lng], {
      icon: pinIcon(p), title: `${p.name} · ${G.formatDistance(p.distance_m)}`, alt: p.name, keyboard: true,
      riseOnHover: true, zIndexOffset: p.id === S.selected ? 1000 : p.source === 'imed' ? 500 : 0,
    });
    m.on('click', () => openDetails(p.id));
    m.addTo(markersLayer);
    markerById.set(p.id, m);
  }
}

function drawOrigin() {
  originLayer.clearLayers();
  if (!S.origin) return;
  const gps = S.originKind === 'gps';
  L.circle([S.origin.lat, S.origin.lng], { radius: S.f.radius, color: '#0E7C9C', weight: 1.5, opacity: 0.5, fillColor: '#2EE6D6', fillOpacity: 0.06, interactive: false }).addTo(originLayer);
  L.marker([S.origin.lat, S.origin.lng], {
    icon: L.divIcon({ className: 'mk-wrap', iconSize: [20, 20], iconAnchor: [10, 10], html: `<span class="me${gps ? '' : ' pin'}"></span>` }),
    keyboard: false, zIndexOffset: -100,
  }).bindTooltip(gps ? 'Você está aqui (aproximado)' : 'Ponto da busca', { direction: 'top', className: 'me-tip', offset: [0, -10] }).addTo(originLayer);
}

function fitMap(list) {
  if (!S.origin || userMoved) return;
  const near = list.slice(0, 25);
  moveMap(() => {
    if (near.length) {
      map.fitBounds(L.latLngBounds([[S.origin.lat, S.origin.lng], ...near.map((p) => [p.lat, p.lng])]), { padding: [56, 56], maxZoom: 16 });
    } else {
      map.fitBounds(L.latLng(S.origin.lat, S.origin.lng).toBounds(S.f.radius * 2));
    }
  });
}

function setSelected(id) {
  const prev = S.selected;
  S.selected = id;
  for (const pid of [prev, id]) {
    if (!pid) continue;
    const m = markerById.get(pid);
    m?.getElement()?.querySelector('.mk')?.classList.toggle('on', pid === id);
    m?.setZIndexOffset(pid === id ? 1000 : pid.startsWith('imed:') ? 500 : 0);
  }
  $$('.pc.on').forEach((c) => c.classList.remove('on'));
  if (id) $(`.pc[data-id="${CSS.escape(id)}"]`)?.classList.add('on');
}

function onMapMove() {
  if (programmatic) { programmatic = false; return; }
  if (!S.origin || S.phase !== 'results' || !userMoved) return;
  const c = map.getCenter();
  const far = G.haversine(S.origin, { lat: c.lat, lng: c.lng }) > Math.max(400, S.f.radius * 0.3);
  $('#areaBtn').classList.toggle('hide', !far);
}

function hideAreaBtn() { $('#areaBtn').classList.add('hide'); }

function searchMapArea() {
  const c = map.getCenter();
  const b = map.getBounds();
  const half = Math.min(map.distance(c, [b.getNorth(), c.lng]), map.distance(c, [c.lat, b.getEast()]));
  S.f.radius = G.RADII.find((r) => r >= half) ?? G.RADII[G.RADII.length - 1];
  $('#q').value = '';
  setQMsg('');
  runSearch({ lat: G.roundCoord(c.lat), lng: G.roundCoord(c.lng) }, 'a área do mapa', 'mapa');
}

function setMapView(on) {
  document.body.classList.toggle('show-map', on);
  const t = $('#viewToggle');
  t.setAttribute('aria-pressed', String(on));
  t.innerHTML = on ? '<i class="fa-solid fa-list" aria-hidden="true"></i><span>Ver lista</span>' : '<i class="fa-solid fa-map" aria-hidden="true"></i><span>Ver mapa</span>';
  if (on) setTimeout(() => map.invalidateSize(), 60);
}

/* ======================= lista ======================= */
// Parceiros IMED primeiro na junção: o mesmo lugar no cadastro oficial ou no mapa não aparece duas vezes.
const allPlaces = () => G.mergePlaces(G.mergePlaces(S.imed, S.cnes), S.places);
const placeById = (id) => [S.imed, S.cnes, S.places].map((l) => l.find((p) => p.id === id)).find(Boolean);
const SOURCE_LABEL = { osm: 'OpenStreetMap', google: 'Google Maps' };
const distanceText = (p) => `${p.approx ? '~' : ''}${G.formatDistance(p.distance_m)}`;
const allFailed = () => S.imedState === 'error' && S.cnesState !== 'ok' && S.placesState === 'error';

function badgesHTML(p) {
  const b = [];
  if (p.source === 'imed') {
    b.push('<span class="bd bd-imed"><i class="fa-solid fa-circle-check" aria-hidden="true"></i>Parceiro IMED</span>');
    if (p.is_demo) b.push('<span class="bd bd-demo">Demonstração</span>');
    if (p.accepts_online_booking) b.push('<span class="bd bd-ok">Agenda pelo IMED</span>');
  } else if (p.source === 'cnes') {
    b.push('<span class="bd bd-cnes"><i class="fa-solid fa-building-circle-check" aria-hidden="true"></i>Cadastro oficial</span>');
    if (p.hours?.[0] === 'Aberto 24 horas') b.push('<span class="bd bd-ok">24 horas</span>');
    if (p.sus) b.push('<span class="bd bd-sus">Atende SUS</span>');
  } else {
    b.push(`<span class="bd">${SOURCE_LABEL[p.source] ?? 'Mapa'}</span>`);
  }
  return b.join('');
}

function priceHTML(p) {
  if (p.source !== 'imed') return '';
  const v = S.f.exam ? G.priceFor(p, S.f.exam) : G.minPrice(p);
  if (v == null) return '<span class="pc-price muted">Preço sob consulta</span>';
  return `<span class="pc-price">${S.f.exam ? `${esc(G.EXAMS[S.f.exam].n)}: ` : 'a partir de '}${G.formatPrice(v)}</span>`;
}

function contactLinksHTML(p) {
  const out = [];
  const tel = p.phone && G.telHref(p.phone);
  if (tel) out.push(`<a href="${esc(tel)}"><i class="fa-solid fa-phone" aria-hidden="true"></i>${esc(p.phone)}</a>`);
  if (p.whatsapp) out.push(`<a class="wa" href="${esc(G.whatsappHref(p.whatsapp))}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i>WhatsApp</a>`);
  if (!tel && p.website) out.push(`<a href="${esc(p.website)}" target="_blank" rel="noopener nofollow"><i class="fa-solid fa-globe" aria-hidden="true"></i>Site</a>`);
  return out.length ? `<div class="pc-contact">${out.join('')}</div>` : '';
}

function cardHTML(p) {
  const k = G.KINDS[p.kind];
  const svc = p.services.slice(0, 4).map((c) => `<span class="svc">${esc(G.EXAMS[c]?.n ?? c)}</span>`).join('')
    + (p.services.length > 4 ? `<span class="svc more">+${p.services.length - 4}</span>` : '');
  return `<article class="pc${p.source === 'imed' ? ' imed' : ''}${p.id === S.selected ? ' on' : ''}" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.name)}, ${distanceText(p)}. Ver detalhes">
    <span class="pc-ic k-${p.kind}" aria-hidden="true"><i class="fa-solid ${k.icon}"></i></span>
    <div class="pc-main">
      <div class="pc-badges">${badgesHTML(p)}</div>
      <h3>${esc(p.name)}</h3>
      <p class="pc-addr">${esc(p.address || 'Endereço não informado no mapa')}</p>
      ${svc ? `<div class="pc-svc">${svc}</div>` : ''}
      <div class="pc-meta"><span class="pc-dist"><i class="fa-solid fa-location-dot" aria-hidden="true"></i>${distanceText(p)}</span><span>${k.n}</span>${priceHTML(p)}${p.source === 'cnes' && p.hours ? `<span>${esc(p.hours[0])}</span>` : ''}</div>
      ${contactLinksHTML(p)}
    </div>
    <i class="fa-solid fa-chevron-right pc-go" aria-hidden="true"></i>
  </article>`;
}

const SKELETON = '<div class="sk" aria-hidden="true"><i></i><div><b></b><span></span><span></span></div></div>';

function stateHTML(icon, title, text, actions = '', warn = false, extra = '') {
  return `<div class="st"><div class="ic${warn ? ' warn' : ''}"><i class="fa-solid ${icon}" aria-hidden="true"></i></div><h2>${title}</h2><p>${text}</p>${extra}${actions ? `<div class="acts">${actions}</div>` : ''}</div>`;
}

const BTN_LOCATE = '<button class="btn btn-coral" type="button" data-act="locate"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i>Usar minha localização</button>';
const BTN_TYPE = '<button class="btn btn-ghost" type="button" data-act="type">Digitar endereço</button>';

function introHTML() {
  const demo = S.demo ? '<button class="btn btn-ghost" type="button" data-act="demo-sp">Testar na Av. Paulista</button>' : '';
  return stateHTML('fa-location-crosshairs', 'Veja o que tem perto de você',
    'Para mostrar distâncias reais, o IMED pede permissão para usar a localização do seu aparelho. Se preferir, digite seu CEP, cidade ou endereço.',
    BTN_LOCATE + BTN_TYPE + demo, false,
    `<ul>
      <li><i class="fa-solid fa-check" aria-hidden="true"></i>Usada só para esta busca, com precisão de cerca de 100 metros.</li>
      <li><i class="fa-solid fa-check" aria-hidden="true"></i>Não guardamos sua localização no aparelho nem no banco.</li>
      <li><i class="fa-solid fa-check" aria-hidden="true"></i>Você pode revogar a permissão quando quiser no navegador.</li>
    </ul><p class="src"><a class="link" href="privacidade.html">Como tratamos seus dados</a></p>`);
}

function emptyHTML(all) {
  if (S.placesState === 'loading') return '';
  if (all.length && G.activeFilterCount(S.f)) {
    const priceNote = S.f.price ? '<p class="src">Preços só aparecem para clínicas parceiras que informaram valores ao IMED. Nenhum valor é estimado.</p>' : '';
    return stateHTML('fa-filter', 'Nada com esses filtros', `Há ${plural(all.length, 'estabelecimento', 'estabelecimentos')} na região, mas nenhum combina com os filtros escolhidos.`,
      '<button class="btn btn-primary" type="button" data-act="clear">Limpar filtros</button>', false, priceNote);
  }
  const next = G.RADII.find((r) => r > S.f.radius);
  return stateHTML('fa-map-location-dot', `Nenhum estabelecimento em até ${kmLabel(S.f.radius)}`,
    'Não encontramos clínicas, laboratórios ou centros de diagnóstico mapeados nesta distância.',
    (next ? `<button class="btn btn-primary" type="button" data-act="radius" data-radius="${next}">Buscar em até ${kmLabel(next)}</button>` : '') + BTN_TYPE);
}

function bannersHTML() {
  const b = [];
  if (S.demo) b.push('<div class="bn demo"><i class="fa-solid fa-flask" aria-hidden="true"></i><span>Modo demonstração: inclui as clínicas fictícias do IMED em São Paulo, sem preço e sem horário. <a class="link" href="perto.html">Sair</a></span></div>');
  if (S.phase !== 'results') return b.join('');
  const failed = allFailed();
  if (S.coverage?.status === 'loading') {
    const city = S.coverage.city ? ` de ${esc(S.coverage.city)}` : ' desta cidade';
    b.push(`<div class="bn"><span class="spin" aria-hidden="true"></span><span>Estamos trazendo o cadastro oficial de clínicas${city} (Ministério da Saúde). Enquanto isso, mostramos o mapa público. A lista se completa sozinha em instantes.</span></div>`);
  }
  if (!failed && S.imedState === 'error') b.push('<div class="bn warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>Não conseguimos carregar as clínicas parceiras do IMED agora.<button type="button" data-act="retry">Tentar de novo</button></span></div>');
  if (!failed && S.cnesState === 'error') b.push('<div class="bn warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>O cadastro oficial de clínicas não respondeu agora.<button type="button" data-act="retry">Tentar de novo</button></span></div>');
  if (!failed && S.placesState === 'error') b.push(`<div class="bn warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>Os estabelecimentos do mapa (${S.provider === 'google' && !S.fnDown ? 'Google Maps' : 'OpenStreetMap'}) não carregaram agora.<button type="button" data-act="retry-places">Tentar de novo</button></span></div>`);
  if (S.truncated || S.cnesTruncated) b.push('<div class="bn"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>Região com muitos estabelecimentos: mostrando os mais próximos. Diminua a distância ou use os filtros para ver outros.</span></div>');
  return b.join('');
}

function countHTML(shown) {
  if (S.phase !== 'results' || allFailed()) return '';
  const nImed = shown.filter((p) => p.source === 'imed').length;
  const where = S.originKind === 'gps' ? 'da sua localização (aproximada)' : `de <b>${esc(S.originLabel)}</b>`;
  return `<b>${plural(shown.length, 'resultado', 'resultados')}</b> em até ${kmLabel(S.f.radius)} ${where}${nImed ? ` · ${plural(nImed, 'parceiro', 'parceiros')} IMED` : ''}`;
}

function renderFilters(all) {
  const ids = { kind: 'fKind', exam: 'fExam', specialty: 'fSpec', radius: 'fDist', price: 'fPrice', sort: 'fSort' };
  const specs = G.specialtyOptions(all);
  if (S.f.specialty && !specs.includes(S.f.specialty)) specs.unshift(S.f.specialty);
  $('#fSpec').innerHTML = '<option value="">Especialidade</option>' + specs.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  for (const [key, id] of Object.entries(ids)) {
    const el = $(`#${id}`);
    el.value = String(S.f[key]);
    el.parentElement.classList.toggle('on', String(S.f[key]) !== String(G.DEFAULT_FILTERS[key]));
  }
  $('#fImed').setAttribute('aria-pressed', String(S.f.onlyImed));
  $('#fClear').hidden = !G.activeFilterCount(S.f);
}

function render(fit = false) {
  const all = S.phase === 'results' ? allPlaces() : [];
  renderFilters(all);
  $('#banners').innerHTML = bannersHTML();
  $('#viewToggle').classList.toggle('hide', !S.origin);
  $('#mapLoad').classList.toggle('hide', !(S.phase === 'loading' || S.placesState === 'loading'));
  const list = $('#list');
  list.setAttribute('aria-busy', String(S.phase === 'loading' || S.phase === 'locating'));
  let shown = [];

  if (S.phase === 'intro') list.innerHTML = introHTML();
  else if (S.phase === 'locating') {
    list.innerHTML = stateHTML('fa-location-crosshairs', 'Aguardando sua permissão…',
      'Se o navegador perguntar, toque em <b>Permitir</b>. A localização é usada só para esta busca.',
      '<button class="btn btn-ghost" type="button" data-act="type">Prefiro digitar o endereço</button>').replace('class="ic"', 'class="ic pulse"');
  } else if (S.phase === 'geo-error') {
    const [t, d] = GEO_MSG[S.geoError] ?? GEO_MSG.unavailable;
    const again = S.geoError === 'unsupported' ? '' : '<button class="btn btn-primary" type="button" data-act="locate">Tentar de novo</button>';
    list.innerHTML = stateHTML('fa-location-pin-lock', t, d, again + '<button class="btn btn-ghost" type="button" data-act="type">Digitar endereço</button>', true);
  } else if (S.phase === 'loading') {
    list.innerHTML = SKELETON.repeat(5);
  } else if (allFailed()) {
    list.innerHTML = stateHTML('fa-plug-circle-xmark', 'Não foi possível buscar agora',
      'Os serviços de busca não responderam. Verifique sua internet e tente de novo em instantes.',
      '<button class="btn btn-primary" type="button" data-act="retry">Tentar de novo</button>', true);
  } else {
    shown = G.sortPlaces(G.filterPlaces(all, S.f), S.f.sort, S.f.exam);
    let html = shown.length ? shown.map(cardHTML).join('') : emptyHTML(all);
    if (S.placesState === 'loading') html += '<div class="pt-more" role="status"><span class="spin" aria-hidden="true"></span>Carregando estabelecimentos do mapa…</div>';
    if (S.f.exam && !S.f.onlyImed && (S.cnes.length || S.places.length)) html += '<p class="pt-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>Para quem ainda não é parceiro do IMED, o exame é reconhecido pelo nome do estabelecimento. Confirme com o local.</p>';
    if (!S.demo && S.imedState === 'ok' && !S.imed.length && S.placesState !== 'loading') {
      const fonte = S.cnes.length ? 'do cadastro oficial do Ministério da Saúde (CNES)' : 'de mapas públicos';
      html += `<p class="pt-note"><i class="fa-solid fa-handshake" aria-hidden="true"></i>Ainda não há clínicas parceiras do IMED nesta região. Os resultados vêm ${fonte}. Tem uma clínica? <a class="link" href="parceiros.html">Seja parceira</a>.</p>`;
    }
    list.innerHTML = html;
  }
  $('#count').innerHTML = countHTML(shown);
  drawMarkers(shown);
  if (fit) fitMap(shown);
}

/* ======================= painel: detalhes ======================= */
let lastFocus = null;
const head = (title) => `<div class="sh-head"><h2 id="shTitle">${title}</h2><button class="x" type="button" data-close aria-label="Fechar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>`;

function openSheet(html) {
  if (!$('#ov').classList.contains('open')) lastFocus = document.activeElement;
  const sh = $('#sheet');
  sh.innerHTML = html;
  sh.scrollTop = 0;
  $('#ov').classList.add('open');
  $('#ov').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => ($('[data-close]', sh) ?? sh).focus(), 40);
}

function closeSheet() {
  if (!$('#ov').classList.contains('open')) return;
  $('#ov').classList.remove('open');
  $('#ov').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = document.body.classList.contains('show-map') ? 'hidden' : '';
  lastFocus?.focus?.({ preventScroll: true });
}

function servicesHTML(p) {
  if (!p.services.length) {
    const text = p.source === 'imed' ? 'A clínica ainda não informou os exames que faz.'
      : p.source === 'cnes' ? 'O cadastro oficial não lista os exames de cada local. Confirme com o estabelecimento ou peça ao IMED para verificar.'
      : 'O mapa não informa os serviços deste local. Confirme com o estabelecimento ou peça ao IMED para verificar.';
    return `<p>${text}</p>`;
  }
  const items = p.services.map((c) => {
    const ex = G.EXAMS[c];
    const guide = ex?.slug ? `<a href="exames/${ex.slug}.html#preparo" target="_blank" rel="noopener">preparo</a>` : '';
    let right = '';
    if (p.source === 'imed') {
      const v = G.priceFor(p, c);
      right = v != null ? `<span>${G.formatPrice(v)}</span>` : '<span class="muted">Preço sob consulta</span>';
    }
    return `<li><b>${esc(ex?.n ?? c)}${guide}</b>${right}</li>`;
  }).join('');
  const src = p.source === 'imed'
    ? 'Exames e preços informados pela clínica ao IMED. Sem preço informado, o valor é passado pela clínica.'
    : 'Serviços identificados pelo nome do estabelecimento. Confirme com ele.';
  return `<ul class="dt-svc">${items}</ul><p class="src">${src}</p>`;
}

function hoursHTML(p) {
  if (!p.hours) return '<p>Horário não informado. Confirme com o estabelecimento antes de ir.</p>';
  const src = {
    clinica: 'Informado pela clínica.', osm: 'Fonte: OpenStreetMap. Pode estar desatualizado.', google: 'Fonte: Google Maps.',
    cnes: 'Turno informado ao cadastro oficial (CNES), não é o horário exato. Confirme antes de ir.',
  }[p.hours_source] ?? '';
  return `<ul class="dt-hours">${p.hours.map((h) => `<li>${esc(h)}</li>`).join('')}</ul><p class="src">${src}</p>`;
}

function contactHTML(p) {
  const rows = [];
  const tel = p.phone && G.telHref(p.phone);
  if (tel) rows.push(`<li><i class="fa-solid fa-phone" aria-hidden="true"></i><a href="${esc(tel)}">${esc(p.phone)}</a></li>`);
  if (p.whatsapp) rows.push(`<li><i class="fa-brands fa-whatsapp" aria-hidden="true"></i><a href="${esc(G.whatsappHref(p.whatsapp))}" target="_blank" rel="noopener">WhatsApp</a></li>`);
  if (p.email && G.isValidEmail(p.email)) rows.push(`<li><i class="fa-solid fa-envelope" aria-hidden="true"></i><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></li>`);
  if (p.website) rows.push(`<li><i class="fa-solid fa-globe" aria-hidden="true"></i><a href="${esc(p.website)}" target="_blank" rel="noopener nofollow">${esc(new URL(p.website).hostname.replace(/^www\./, ''))}</a></li>`);
  return rows.length ? `<ul class="dt-contact">${rows.join('')}</ul>` : '<p>O estabelecimento não informou telefone nem site. Você pode pedir ao IMED para agendar por você.</p>';
}

function openDetails(id) {
  const p = placeById(id);
  if (!p) return;
  setSelected(id);
  const k = G.KINDS[p.kind];
  const tel = p.phone && G.telHref(p.phone);
  const acts = [`<a href="${esc(G.directionsUrl(p))}" target="_blank" rel="noopener"><i class="fa-solid fa-route" aria-hidden="true"></i>Como chegar</a>`];
  if (tel) acts.push(`<a href="${esc(tel)}"><i class="fa-solid fa-phone" aria-hidden="true"></i>Ligar</a>`);
  if (p.whatsapp) acts.push(`<a class="wa" href="${esc(G.whatsappHref(p.whatsapp, 'Olá! Encontrei vocês pelo IMED e gostaria de agendar um exame.'))}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i>WhatsApp</a>`);
  if (p.website) acts.push(`<a href="${esc(p.website)}" target="_blank" rel="noopener nofollow"><i class="fa-solid fa-globe" aria-hidden="true"></i>Site</a>`);
  if (p.maps_url) {
    const where = p.source === 'cnes' ? 'Ver no CNES' : `Ver no ${SOURCE_LABEL[p.source] ?? 'mapa'}`;
    acts.push(`<a href="${esc(p.maps_url)}" target="_blank" rel="noopener"><i class="fa-solid ${p.source === 'cnes' ? 'fa-building-circle-check' : 'fa-map-location-dot'}" aria-hidden="true"></i>${where}</a>`);
  }

  let cta = '';
  if (p.source === 'imed' && p.accepts_online_booking) {
    cta = `<button class="btn btn-coral" type="button" data-book="${esc(p.id)}"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i>Solicitar agendamento</button>`;
  } else if (p.source === 'imed') {
    cta = tel ? `<a class="btn btn-primary" href="${esc(tel)}"><i class="fa-solid fa-phone" aria-hidden="true"></i>Ligar para agendar</a>` : '';
  } else {
    cta = `<button class="btn btn-coral" type="button" data-book="${esc(p.id)}"><i class="fa-solid fa-headset" aria-hidden="true"></i>Pedir ao IMED para agendar</button>`;
  }

  const note = p.source === 'imed'
    ? (p.is_demo
      ? '<p class="note demo"><i class="fa-solid fa-flask" aria-hidden="true"></i>Clínica de demonstração do IMED: nome e endereço fictícios, sem preço e sem horário. Serve para testar o fluxo de ponta a ponta.</p>'
      : '<p class="note"><i class="fa-solid fa-circle-check" aria-hidden="true"></i>Clínica parceira do IMED. Os dados são informados pela própria clínica.</p>')
    : p.source === 'cnes'
      ? `<p class="note"><i class="fa-solid fa-building-circle-check" aria-hidden="true"></i>Dados do Cadastro Nacional de Estabelecimentos de Saúde (CNES), do Ministério da Saúde${p.updated_at ? `, atualizados em ${esc(new Date(`${p.updated_at}T12:00:00`).toLocaleDateString('pt-BR'))}` : ''}.${p.approx ? ' A localização no mapa é aproximada, pelo endereço.' : ''} Este estabelecimento ainda não é parceiro do IMED: confirme horários, exames e valores diretamente com ele.</p>`
      : `<p class="note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>Dados do ${p.source === 'osm' ? 'OpenStreetMap, mantidos por voluntários' : 'Google Maps'}. Este estabelecimento ainda não é parceiro do IMED: confirme preços e horários diretamente com ele.</p>`;

  openSheet(head(esc(p.name)) + `<div class="sh-body">
    <div class="dt-top"><span class="pc-ic k-${p.kind}" aria-hidden="true"><i class="fa-solid ${k.icon}"></i></span>
      <div style="min-width:0"><div class="pc-badges">${badgesHTML(p)}</div><h3>${esc(p.name)}</h3>
      <p>${esc(k.n)} · <b>${distanceText(p)}</b> ${S.originKind === 'gps' ? 'de você (aproximado)' : 'do ponto da busca'}</p>
      <p>${esc(p.address || 'Endereço não informado no mapa')}${p.cep ? ` · CEP ${esc(p.cep)}` : ''}</p></div></div>
    <div class="dt-acts">${acts.join('')}</div>
    ${p.description ? `<div class="dt-sec"><h4><i class="fa-solid fa-circle-info" aria-hidden="true"></i>Sobre</h4><p>${esc(p.description)}</p></div>` : ''}
    <div class="dt-sec"><h4><i class="fa-solid fa-notes-medical" aria-hidden="true"></i>Serviços</h4>${servicesHTML(p)}</div>
    ${p.specialties.length ? `<div class="dt-sec"><h4><i class="fa-solid fa-user-doctor" aria-hidden="true"></i>Especialidades</h4><div class="dt-chips">${p.specialties.map((s) => `<span class="svc">${esc(s)}</span>`).join('')}</div></div>` : ''}
    <div class="dt-sec"><h4><i class="fa-regular fa-clock" aria-hidden="true"></i>Horário de funcionamento</h4>${hoursHTML(p)}</div>
    <div class="dt-sec"><h4><i class="fa-solid fa-address-book" aria-hidden="true"></i>Contato</h4>${contactHTML(p)}</div>
    ${note}
  </div>${cta ? `<div class="sh-foot">${cta}</div>` : ''}`);
}

/* ======================= painel: pedido de agendamento ======================= */
function openBooking(id) {
  const p = placeById(id);
  if (!p) return;
  const imed = p.source === 'imed';
  const codes = imed ? p.services.filter((c) => G.EXAMS[c]) : Object.keys(G.EXAMS);
  const pre = S.f.exam && codes.includes(S.f.exam) ? S.f.exam : '';
  const opt = (v, label) => `<option value="${v}"${v === pre ? ' selected' : ''}>${esc(label)}</option>`;
  const examOpts = codes.map((c) => {
    const v = imed ? G.priceFor(p, c) : null;
    return opt(c, G.EXAMS[c].n + (v != null ? ` · ${G.formatPrice(v)}` : ''));
  }).join('') + opt('consulta', 'Consulta') + opt('outro', 'Outro (descrevo nas observações)');
  const min = G.spDate(0), max = G.spDate(G.BOOKING_DAYS);
  const k = G.KINDS[p.kind];
  const how = imed
    ? 'A clínica recebe seu pedido pelo IMED e confirma o horário com você.'
    : 'Este local ainda não é parceiro do IMED. Nossa equipe fala com ele e confirma o horário com você.';

  openSheet(head(imed ? 'Solicitar agendamento' : 'Pedir ao IMED para agendar') + `<form class="sh-body" id="bookForm" novalidate>
    <div class="bk-place"><span class="pc-ic k-${p.kind}" aria-hidden="true"><i class="fa-solid ${k.icon}"></i></span><div style="min-width:0"><b>${esc(p.name)}</b><small>${esc(p.address || k.n)}</small></div></div>
    <p class="src" style="margin-top:10px">${how}</p>
    <div class="fld" data-f="exam"><label for="bkExam">Exame ou atendimento</label>
      <select id="bkExam" name="exame" required><option value="">Escolha</option>${examOpts}</select><span class="err" id="e-exam"></span></div>
    <div class="fld" data-f="date"><label for="bkDate">Data que prefere <small class="h">(até ${G.BOOKING_DAYS} dias)</small></label>
      <input id="bkDate" name="data" type="date" min="${min}" max="${max}" required><span class="err" id="e-date"></span></div>
    <fieldset class="fld" data-f="period"><legend>Período</legend>
      <div class="seg">${Object.entries(G.PERIODS).map(([v, l]) => `<label><input type="radio" name="periodo" value="${v}"${v === 'qualquer' ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <span class="err" id="e-period"></span></fieldset>
    <div class="fld" data-f="name"><label for="bkName">Nome completo</label>
      <input id="bkName" name="nome" autocomplete="name" maxlength="120" required><span class="err" id="e-name"></span></div>
    <div class="row2">
      <div class="fld" data-f="phone"><label for="bkPhone">Celular com DDD</label>
        <input id="bkPhone" name="celular" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(11) 98765-4321" maxlength="16" required><span class="err" id="e-phone"></span></div>
      <div class="fld" data-f="email"><label for="bkEmail">E-mail <small class="h">(opcional)</small></label>
        <input id="bkEmail" name="email" type="email" autocomplete="email" maxlength="254"><span class="err" id="e-email"></span></div>
    </div>
    <div class="fld" data-f="notes"><label for="bkNotes">Observações <small class="h">(opcional)</small></label>
      <textarea id="bkNotes" name="obs" maxlength="500" placeholder="Ex.: convênio, melhor horário para ligar. Não precisa enviar resultados de exames."></textarea><span class="err" id="e-notes"></span></div>
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <label class="consent" data-f="consent"><input type="checkbox" name="consent"><span>Autorizo o IMED a usar estes dados, incluindo o exame escolhido, para encaminhar meu pedido ao estabelecimento e entrar em contato comigo sobre este agendamento. <a href="privacidade.html" target="_blank" rel="noopener">Política de privacidade</a></span></label>
    <span class="err" id="e-consent" style="display:block;color:var(--coral-d);font-size:13px;font-weight:600;margin-top:6px"></span>
    <p class="bk-err" id="bkErr" role="alert"></p>
    ${p.is_demo ? '<p class="note demo"><i class="fa-solid fa-flask" aria-hidden="true"></i>Clínica de demonstração: o pedido fica registrado só como teste.</p>' : ''}
    <div class="sh-foot" style="margin:18px -20px -24px"><button class="btn btn-coral" type="submit" id="bkBtn"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i>Enviar pedido</button>
      <p class="src" style="text-align:center;margin:0">O horário só fica garantido depois da confirmação.</p></div>
  </form>`);

  const form = $('#bookForm');
  const phone = $('#bkPhone');
  phone.addEventListener('input', () => { phone.value = G.maskPhone(phone.value); });
  // Ao corrigir um campo, o aviso de erro dele some.
  const clearError = (e) => {
    const box = e.target.closest('[data-f]');
    if (!box?.classList.contains('bad')) return;
    box.classList.remove('bad');
    const msg = $(`#e-${box.dataset.f}`, form);
    if (msg) msg.textContent = '';
  };
  form.addEventListener('input', clearError);
  form.addEventListener('change', clearError);
  form.addEventListener('submit', (e) => submitBooking(e, p));
}

function showErrors(form, errs) {
  for (const f of ['exam', 'date', 'period', 'name', 'phone', 'email', 'notes', 'consent']) {
    const box = $(`[data-f="${f}"]`, form);
    box?.classList.toggle('bad', !!errs[f]);
    const msg = $(`#e-${f}`, form);
    if (msg) msg.textContent = errs[f] ?? '';
  }
  const first = Object.keys(errs)[0];
  if (first) {
    const box = $(`[data-f="${first}"]`, form);
    $('input,select,textarea', box)?.focus();
    box?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

async function submitBooking(e, p) {
  e.preventDefault();
  const form = e.currentTarget;
  const fd = new FormData(form);
  const v = {
    exam: fd.get('exame') || '', date: fd.get('data') || '', period: fd.get('periodo') || '', name: fd.get('nome') || '',
    phone: fd.get('celular') || '', email: fd.get('email') || '', notes: fd.get('obs') || '', consent: fd.get('consent') === 'on',
  };
  const errs = G.validateBooking(v);
  showErrors(form, errs);
  const errBox = $('#bkErr', form);
  errBox.classList.remove('show');
  if (Object.keys(errs).length) return;
  const id = crypto.randomUUID();
  if (fd.get('website')) return bookingDone(p, v, id);
  const btn = $('#bkBtn', form);
  btn.disabled = true;
  btn.innerHTML = '<span class="spin" aria-hidden="true"></span>Enviando…';
  try {
    await window.imedInsert('appointment_requests', G.bookingRow(p, v, id));
    saveLocal(p, v, id);
    bookingDone(p, v, id);
  } catch (err) {
    const tel = p.phone && G.telHref(p.phone);
    errBox.innerHTML = (/http 4\d\d/.test(err.message)
      ? 'O pedido não foi aceito. Confira a data e os dados e tente de novo.'
      : 'Não foi possível enviar agora. Verifique sua internet e tente de novo.')
      + (tel ? ` Se preferir, <a class="link" href="${esc(tel)}">ligue para o estabelecimento</a>.` : '');
    errBox.classList.add('show');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Tentar de novo';
  }
}

// Guarda no aparelho só o resumo do pedido, para aparecer em "Agendados" na página inicial.
function saveLocal(p, v, id) {
  try {
    const list = JSON.parse(localStorage.getItem('imed_appts') || '[]');
    const color = { imagem: '#0E7C9C', laboratorio: '#6C4BD8', clinica: '#1E9E5A', hospital: '#E8512F' }[p.kind];
    list.unshift({
      code: G.protocolFromId(id), type: 'pedido', status: 'pendente', name: p.name, ini: '', c: color, img: null,
      items: [examLabel(v.exam)], date: G.formatDateLong(v.date), time: G.PERIODS[v.period].toLowerCase(), total: null,
    });
    localStorage.setItem('imed_appts', JSON.stringify(list.slice(0, 30)));
  } catch { /* armazenamento indisponível: o pedido já foi enviado */ }
}

const examLabel = (c) => G.EXAMS[c]?.n ?? (c === 'consulta' ? 'Consulta' : 'Outro atendimento');

function bookingDone(p, v, id) {
  const imed = p.source === 'imed';
  const guide = G.EXAMS[v.exam]?.slug;
  const d = G.onlyDigits(v.phone);
  openSheet(head('Pedido enviado') + `<div class="sh-body ok">
    <div class="ic"><i class="fa-solid fa-check" aria-hidden="true"></i></div>
    <h3>Recebemos seu pedido!</h3>
    <p><b>${esc(p.name)}</b><br>${esc(examLabel(v.exam))} · ${esc(G.formatDateLong(v.date))} · ${esc(G.PERIODS[v.period])}</p>
    <span class="code">${G.protocolFromId(id)}</span>
    <ol>
      <li>${imed ? 'A clínica recebe o pedido pelo IMED.' : 'A equipe do IMED fala com o estabelecimento.'}</li>
      <li>Você recebe a confirmação do horário no celular terminado em ${esc(d.slice(-4))}.</li>
      <li>No dia, leve documento com foto e o pedido médico.</li>
    </ol>
    <p class="note" style="text-align:left"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>O horário só fica garantido depois da confirmação.${p.is_demo ? ' Clínica de demonstração: pedido registrado só como teste.' : ''}</p>
    <div style="display:grid;gap:10px;margin-top:18px">
      ${guide ? `<a class="btn btn-primary" href="exames/${guide}.html#preparo">Como se preparar</a>` : ''}
      <a class="btn btn-ghost" href="./#agenda">Ver meus pedidos</a>
      <button class="btn btn-ghost" type="button" data-close>Voltar aos resultados</button>
    </div>
  </div>`);
}

/* ======================= eventos ======================= */
function bind() {
  $('#searchForm').addEventListener('submit', onSearchSubmit);
  $('#locBtn').addEventListener('click', locate);
  $('#areaBtn').addEventListener('click', searchMapArea);
  $('#viewToggle').addEventListener('click', () => setMapView(!document.body.classList.contains('show-map')));

  const ids = { kind: 'fKind', exam: 'fExam', specialty: 'fSpec', radius: 'fDist', price: 'fPrice', sort: 'fSort' };
  for (const [key, id] of Object.entries(ids)) {
    $(`#${id}`).addEventListener('change', (e) => {
      S.f[key] = key === 'radius' ? Number(e.target.value) : e.target.value;
      if (key === 'radius') {
        if (S.origin && S.f.radius > S.fetchedRadius) return retrySearch();
        drawOrigin();
        userMoved = false;
      }
      render(key === 'radius');
    });
  }
  $('#fImed').addEventListener('click', () => { S.f.onlyImed = !S.f.onlyImed; render(); });
  $('#fClear').addEventListener('click', () => { S.f = { ...G.DEFAULT_FILTERS, radius: S.f.radius, sort: S.f.sort }; render(); });

  $('#list').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (act) return onAction(act);
    if (e.target.closest('a')) return;
    const card = e.target.closest('.pc[data-id]');
    if (card) openDetails(card.dataset.id);
  });
  $('#banners').addEventListener('click', (e) => { const act = e.target.closest('[data-act]'); if (act) onAction(act); });
  $('#list').addEventListener('keydown', (e) => {
    const card = e.target.closest?.('.pc[data-id]');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetails(card.dataset.id); }
  });
  $('#list').addEventListener('mouseover', (e) => {
    const card = e.target.closest('.pc[data-id]');
    const m = card && markerById.get(card.dataset.id);
    $$('.mk.hot').forEach((x) => x.classList.remove('hot', 'on'));
    if (m && card.dataset.id !== S.selected) m.getElement()?.querySelector('.mk')?.classList.add('hot', 'on');
  });
  $('#list').addEventListener('mouseleave', () => $$('.mk.hot').forEach((x) => x.classList.remove('hot', 'on')));

  const ov = $('#ov');
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-close]')) return closeSheet();
    const b = e.target.closest('[data-book]');
    if (b) openBooking(b.dataset.book);
  });
  document.addEventListener('keydown', (e) => {
    if (!ov.classList.contains('open')) return;
    if (e.key === 'Escape') return closeSheet();
    if (e.key === 'Tab') {
      const f = $$('a[href],button:not([disabled]),input:not([type=hidden]):not(.hp),select,textarea', $('#sheet')).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

function onAction(el) {
  const a = el.dataset.act;
  if (a === 'locate') locate();
  else if (a === 'type') { $('#q').focus(); $('#q').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  else if (a === 'retry') retrySearch();
  else if (a === 'retry-places') retryPlaces();
  else if (a === 'clear') { S.f = { ...G.DEFAULT_FILTERS, radius: S.f.radius, sort: S.f.sort }; render(); }
  else if (a === 'radius') { S.f.radius = Number(el.dataset.radius); retrySearch(); }
  else if (a === 'demo-sp') runSearch({ lat: -23.565, lng: -46.652 }, 'Av. Paulista, São Paulo - SP', 'busca', 'endereco');
}

/* ======================= início ======================= */
async function init() {
  initMap();
  bind();
  render();
  const wantsLocation = params.get('usar') === 'localizacao';
  if (wantsLocation) {
    params.delete('usar');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  }
  const state = await permissionState();
  // Só pede a localização quando a pessoa tocou em "Encontrar clínicas perto de mim"
  // ou quando ela já tinha permitido antes; senão, mostra a explicação e espera o toque.
  if (state === 'denied' && wantsLocation) geoFail('denied');
  else if (wantsLocation || state === 'granted') locate();
}

init();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
