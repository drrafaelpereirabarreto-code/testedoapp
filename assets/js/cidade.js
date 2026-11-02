// Lista de estabelecimentos das páginas por cidade (cidades/<uf>/<cidade>/...).
// Carrega do banco, 60 por vez, pela função city_establishments (só dados do cadastro oficial CNES).
// Abas trocam o tipo (nova consulta ao banco); a busca por nome filtra só o que já foi carregado.
const C = window.IMED_CONFIG || {};
const PAGE = 60;
const KINDS = {
  imagem: { n: 'Diagnóstico por imagem', icon: 'fa-x-ray' },
  laboratorio: { n: 'Laboratório', icon: 'fa-flask' },
  clinica: { n: 'Clínica', icon: 'fa-stethoscope' },
  hospital: { n: 'Hospital', icon: 'fa-hospital' },
};

const listEl = document.getElementById('cdList');
const moreBtn = document.getElementById('cdMore');
const countEl = document.getElementById('cdCount');
const qEl = document.getElementById('cdQ');
const tabs = [...document.querySelectorAll('.cd-tab')];

const city = Number(listEl?.dataset.city);
const base = listEl?.dataset.base ?? '';
const cityCode6 = String(city).slice(0, 6);
// Cada tipo (ou "todos") guarda o que já veio do banco.
const state = new Map();
let kind = listEl?.dataset.kind || '';
let busy = false;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = (n) => Number(n).toLocaleString('pt-BR');
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const cep = (v) => (/^\d{8}$/.test(v ?? '') ? `${v.slice(0, 5)}-${v.slice(5)}` : (v || ''));
const telHref = (phone) => {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  return d.length >= 10 && d.length <= 11 ? `tel:+55${d}` : null;
};
const mapHref = (r) => (Number.isFinite(r.lat) && Number.isFinite(r.lng)
  ? `https://www.openstreetmap.org/?mlat=${r.lat.toFixed(6)}&mlon=${r.lng.toFixed(6)}#map=18/${r.lat.toFixed(6)}/${r.lng.toFixed(6)}`
  : null);
const cnesHref = (code) => (/^\d{7}$/.test(code ?? '') && /^\d{6}$/.test(cityCode6)
  ? `https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/${cityCode6}${code}` : null);

async function fetchPage(k, offset) {
  const res = await fetch(`${C.supabaseUrl}/rest/v1/rpc/city_establishments`, {
    method: 'POST',
    headers: C.supabaseHeaders(null, { 'Content-Type': 'application/json' }), // visitante: só a chave publishable
    body: JSON.stringify({ p_city: city, p_kind: k || null, p_limit: PAGE, p_offset: offset }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

function item(r) {
  const k = KINDS[r.kind];
  const tel = telHref(r.phone);
  const map = mapHref(r);
  const ficha = cnesHref(r.cnes);
  const addr = [r.address_line, r.neighborhood].filter(Boolean).join(' · ');
  const tags = [
    r.open_24h ? '<span class="cd-tag">Aberto 24 horas</span>' : (r.shift ? `<span class="cd-tag">Turno: ${esc(r.shift)}</span>` : ''),
    r.sus ? '<span class="cd-tag sus"><i class="fa-solid fa-hand-holding-medical" aria-hidden="true"></i> Atende SUS</span>' : '',
  ].filter(Boolean).join('');
  return `<article class="cd-item">
    ${k ? `<span class="cd-kind"><i class="fa-solid ${k.icon}" aria-hidden="true"></i>${k.n}</span>` : ''}
    <h3>${esc(r.name)}</h3>
    ${addr ? `<p><i class="fa-solid fa-location-dot" aria-hidden="true"></i>${esc(addr)}${r.cep ? ` · CEP ${esc(cep(r.cep))}` : ''}</p>` : (r.cep ? `<p>CEP ${esc(cep(r.cep))}</p>` : '')}
    ${tel ? `<p><i class="fa-solid fa-phone" aria-hidden="true"></i><a class="tel" href="${tel}">${esc(r.phone)}</a></p>`
    : (String(r.phone ?? '').trim() ? `<p><i class="fa-solid fa-phone" aria-hidden="true"></i>${esc(String(r.phone).trim())}</p>` : '')}
    ${tags ? `<div class="cd-tags">${tags}</div>` : ''}
    <div class="cd-links">
      ${map ? `<a href="${map}" target="_blank" rel="noopener">Ver no mapa<span class="sr"> (abre em nova aba)</span></a>` : ''}
      ${ficha ? `<a href="${ficha}" target="_blank" rel="noopener">Ficha oficial (CNES)<span class="sr"> (abre em nova aba)</span></a>` : ''}
      ${r.cnes ? `<a class="claim" href="${base}reivindicar.html?cnes=${encodeURIComponent(r.cnes)}">É o responsável? Assuma o cadastro</a>` : ''}
    </div>
  </article>`;
}

function render() {
  const s = state.get(kind);
  if (!s) return;
  const q = fold(qEl?.value);
  const shown = q ? s.rows.filter((r) => fold(r.name).includes(q)) : s.rows;
  if (s.error && !s.rows.length) {
    listEl.innerHTML = '<p class="cd-msg err" role="alert">Não foi possível carregar a lista agora. Confira a internet e <button type="button" class="link" id="cdRetry">tente de novo</button>.</p>';
    document.getElementById('cdRetry')?.addEventListener('click', () => loadMore());
  } else if (!s.rows.length && s.done) {
    listEl.innerHTML = '<p class="cd-msg">Nenhum estabelecimento deste tipo nesta cidade.</p>';
  } else if (!shown.length) {
    listEl.innerHTML = `<p class="cd-msg">Nenhum nome com “${esc(qEl.value.trim())}” entre os ${fmt(s.rows.length)} já carregados.${s.done ? '' : ' Use “Carregar mais” para buscar em mais locais.'}</p>`;
  } else {
    listEl.innerHTML = shown.map(item).join('');
  }
  const total = s.total ?? s.rows.length;
  countEl.textContent = !s.rows.length ? '' : (q
    ? `${fmt(shown.length)} de ${fmt(s.rows.length)} carregados com “${qEl.value.trim()}”.`
    : `Mostrando ${fmt(s.rows.length)} de ${fmt(total)}, em ordem alfabética.`);
  moreBtn.hidden = s.done;
  if (s.error && s.rows.length) countEl.textContent += ' Não foi possível carregar mais agora; tente de novo.';
}

async function loadMore() {
  if (busy) return;
  let s = state.get(kind);
  if (!s) { s = { rows: [], total: null, done: false, error: false }; state.set(kind, s); }
  if (s.done) return render();
  busy = true;
  const k = kind;
  moreBtn.disabled = true;
  moreBtn.textContent = 'Carregando…';
  if (!s.rows.length) { listEl.setAttribute('aria-busy', 'true'); listEl.innerHTML = '<div class="cd-skel"></div><div class="cd-skel"></div><div class="cd-skel"></div>'; }
  try {
    const rows = await fetchPage(k, s.rows.length);
    s.rows.push(...rows);
    if (rows.length) s.total = Number(rows[0].total) || s.total;
    s.done = rows.length < PAGE || (s.total != null && s.rows.length >= s.total);
    s.error = false;
  } catch {
    s.error = true;
  } finally {
    busy = false;
    moreBtn.disabled = false;
    moreBtn.textContent = 'Carregar mais';
    listEl.removeAttribute('aria-busy');
  }
  // Se a pessoa trocou de aba enquanto carregava, segue para o tipo escolhido.
  const now = state.get(kind);
  if (k === kind || now?.rows.length || now?.done) render();
  else await loadMore();
}

if (listEl && city) {
  moreBtn.addEventListener('click', () => {
    const k0 = kind;
    const before = state.get(kind)?.rows.length ?? 0;
    loadMore().then(() => {
      if (kind !== k0) return;
      // Leva o foco para o primeiro item novo, para quem navega pelo teclado.
      const items = listEl.querySelectorAll('.cd-item');
      if (!qEl?.value && items[before]) { items[before].setAttribute('tabindex', '-1'); items[before].focus({ preventScroll: false }); }
    });
  });
  tabs.forEach((t) => t.addEventListener('click', () => {
    if (t.dataset.kind === kind) return;
    kind = t.dataset.kind;
    tabs.forEach((x) => x.setAttribute('aria-pressed', String(x === t)));
    const s = state.get(kind);
    if (s?.rows.length || s?.done) render();
    else if (busy) {
      // Uma carga ainda está em andamento: mostra que o novo tipo está vindo; loadMore() segue para ele ao terminar.
      listEl.setAttribute('aria-busy', 'true');
      listEl.innerHTML = '<div class="cd-skel"></div><div class="cd-skel"></div><div class="cd-skel"></div>';
      countEl.textContent = '';
      moreBtn.hidden = true;
    } else loadMore();
  }));
  let timer;
  qEl?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 150); });
  loadMore();
}
