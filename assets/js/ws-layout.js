// Layout da consulta (iMed Medical Workspace, fase 2): no computador, divisórias arrastáveis (WAI-ARIA window
// splitter: role="separator", setas, Home/End) e colunas recolhíveis; no celular, botões "Mostrar" que escolhem o que
// aparece embaixo do vídeo. Só mexe em atributos e variáveis CSS: os <video> (#cRemote, #cLocal) nunca mudam de lugar
// nem são recriados. Preferência (só larguras e colunas recolhidas) em localStorage 'imed_ws_layout'.

const KEY = 'imed_ws_layout';
const PASSO = 16;
const CENTRO_MIN = 360;
const $ = (s, r = document) => r.querySelector(s);

const ler = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
const gravar = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* sem armazenamento */ } };

let pronto = false;
const L = { pac: null, fer: null, pacFechado: false, ferFechado: false };

function grade() { return $('#wsGrid'); }
function lados() {
  return {
    pac: { split: $('#wsSplitPac'), btn: $('#wsPacBtn'), body: $('#wsPacBody'), attr: 'pac', nome: 'do paciente', min: 200, max: 480, padrao: 280 },
    fer: { split: $('#wsSplitFer'), btn: $('#wsFerBtn'), body: $('#wsFerBody'), attr: 'fer', nome: 'de ferramentas', min: 280, max: 640, padrao: 400 },
  };
}

// Largura máxima que ainda deixa o centro com pelo menos CENTRO_MIN.
function limite(lado) {
  const g = grade();
  const s = lados()[lado];
  const total = g?.getBoundingClientRect().width || 0;
  const outro = lado === 'pac' ? (L.ferFechado ? 52 : L.fer ?? lados().fer.padrao) : (L.pacFechado ? 52 : L.pac ?? lados().pac.padrao);
  const cabe = total ? Math.floor(total - outro - 28 - CENTRO_MIN) : s.max;
  return Math.max(s.min, Math.min(s.max, cabe));
}

function aplicar(lado, px, salvar = true) {
  const s = lados()[lado];
  const v = Math.round(Math.max(s.min, Math.min(limite(lado), px)));
  L[lado] = v;
  grade()?.style.setProperty(`--ws-${lado}`, `${v}px`);
  s.split?.setAttribute('aria-valuenow', String(v));
  s.split?.setAttribute('aria-valuetext', `${v} pixels`);
  s.split?.setAttribute('aria-valuemax', String(limite(lado)));
  if (salvar) gravar({ ...L });
}

function recolher(lado, fechado, salvar = true) {
  const s = lados()[lado];
  L[`${lado}Fechado`] = fechado;
  const g = grade();
  if (fechado) g?.setAttribute(`data-${s.attr}`, 'fechado'); else g?.removeAttribute(`data-${s.attr}`);
  if (s.btn) {
    s.btn.setAttribute('aria-expanded', String(!fechado));
    s.btn.querySelector('span').textContent = `${fechado ? 'Abrir' : 'Recolher'} a coluna ${s.nome}`;
  }
  if (s.split) s.split.tabIndex = fechado ? -1 : 0;
  if (!fechado && L[lado] != null) grade()?.style.setProperty(`--ws-${lado}`, `${L[lado]}px`);
  if (fechado) grade()?.style.removeProperty(`--ws-${lado}`);
  if (salvar) gravar({ ...L });
}

function arrastar(lado, e) {
  const s = lados()[lado];
  if (e.button !== 0 || L[`${lado}Fechado`]) return;
  e.preventDefault();
  s.split.setPointerCapture?.(e.pointerId);
  s.split.classList.add('ativo');
  const r = grade().getBoundingClientRect();
  const mover = (ev) => aplicar(lado, lado === 'pac' ? ev.clientX - r.left : r.right - ev.clientX, false);
  const soltar = () => {
    s.split.classList.remove('ativo');
    s.split.removeEventListener('pointermove', mover);
    s.split.removeEventListener('pointerup', soltar);
    s.split.removeEventListener('pointercancel', soltar);
    gravar({ ...L });
  };
  s.split.addEventListener('pointermove', mover);
  s.split.addEventListener('pointerup', soltar);
  s.split.addEventListener('pointercancel', soltar);
}

function teclas(lado, e) {
  const s = lados()[lado];
  const atual = L[lado] ?? s.padrao;
  const mais = lado === 'pac' ? 'ArrowRight' : 'ArrowLeft';
  const menos = lado === 'pac' ? 'ArrowLeft' : 'ArrowRight';
  let novo = null;
  if (e.key === mais) novo = atual + PASSO;
  else if (e.key === menos) novo = atual - PASSO;
  else if (e.key === 'Home') novo = s.min;
  else if (e.key === 'End') novo = limite(lado);
  else if (e.key === 'Enter') { recolher(lado, true); s.btn?.focus(); e.preventDefault(); return; }
  if (novo == null) return;
  e.preventDefault();
  aplicar(lado, novo);
}

function mostrar(qual) {
  const g = grade();
  if (!g) return;
  g.dataset.wsMostra = qual;
  for (const b of g.querySelectorAll('[data-ws-mostra]')) {
    if (b === g) continue;
    b.setAttribute('aria-pressed', String(b.dataset.wsMostra === qual));
  }
}

export function iniciarLayout() {
  if (pronto || !grade()) return;
  pronto = true;
  const salvo = ler();
  const ss = lados();
  for (const lado of ['pac', 'fer']) {
    const s = ss[lado];
    if (Number.isFinite(salvo[lado])) L[lado] = salvo[lado];
    s.split?.addEventListener('pointerdown', (e) => arrastar(lado, e));
    s.split?.addEventListener('keydown', (e) => teclas(lado, e));
    s.split?.addEventListener('dblclick', () => recolher(lado, true));
    s.btn?.addEventListener('click', () => recolher(lado, !L[`${lado}Fechado`]));
    recolher(lado, !!salvo[`${lado}Fechado`], false);
    if (L[lado] != null && !L[`${lado}Fechado`]) aplicar(lado, L[lado], false);
  }
  $('#wsAbas')?.addEventListener('click', (e) => { const b = e.target.closest('[data-ws-mostra]'); if (b) mostrar(b.dataset.wsMostra); });
  // A janela mudou de tamanho: as larguras salvas continuam dentro do que cabe.
  addEventListener('resize', () => { for (const lado of ['pac', 'fer']) if (L[lado] != null && !L[`${lado}Fechado`]) aplicar(lado, L[lado], false); });
}

// Cada consulta aberta começa mostrando tudo (no celular).
export function novaConsulta() { mostrar('tudo'); }
