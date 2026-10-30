// Tela "Clínicas perto de você" da página inicial (#reais), com jeito de aplicativo:
// - pedido de localização ao abrir (uma vez por aba, nunca depois de 2 recusas), com o aviso do motivo (#geoAviso)
//   e o acompanhamento da permissão (PermissionStatus change);
// - estados sem lista (aguardando, negada, não apareceu...), com a escolha da cidade e os atalhos;
// - lista dos 10 locais reais mais perto (CNES + parceiros publicados), com abas por tipo;
// - mapa: lado a lado no computador (preso ao rolar) e em tela cheia no celular (o Leaflet só vem no toque);
// - seletor de cidade (busca com setas, recentes e cidades com mais locais), na janela #ov/#sheet.
// As regras e os textos vêm de inicio-core.js (testado no Node). A posição chega arredondada (round3, ~110 m) e fica
// só na memória desta página (S.here): nunca vai para o localStorage, o sessionStorage, o endereço da página, o
// contador de visitas ou um cache. No aparelho ficam só a cidade escolhida, as 3 últimas cidades, as recusas (até 2)
// e, até fechar a aba, o aviso de que a localização já foi pedida (sem a posição).
// Só dado real: nada de preço, nota, horário ou contagem inventada.
import {
  GEO_OPCOES, ESPERA_PEDIDO_MS, ESPERA_SILENCIO_MS, RAIOS, LISTA_CELULAR, PONTOS_SELECT, CHAVES, TIPOS, TEXTOS, LINKS,
  BOTOES, N_ATALHOS, tipoValido, aproximar, metrosEntre, textoDistancia, ehAproximado, textoFicaA, textoAteVoce,
  distanciaNosItens, proximoRaio, cityUrl, dobra, cidadeGuardada, mesmaCidade, lerRecentes, comRecente, centroGuardado,
  matchCities, cidadesComMaisLocais, textoLocais, textoContagemCidades, cityOfRows, argsLista, argsParceiros, argsPontos,
  chaveCache, totalDe, totalDaArea, montarLista, linhaTipo, selos, legendaTipos, textoLegenda, tituloMapa,
  rotuloPontoOrigem, sufixoOrigem, textoMostrarMais, estadoTela, textoResumo, verTodos, rotulosOrigem, textoRegiao,
  textoProcurandoCentro, textoToastCidade, textoNearCta, permissaoDe, lerRecusas, contaRecusas, geoPlan, geoErro,
  acaoToque, aoMudarPermissao, estadoGeoSeletor, round3, codigoMunicipio,
} from './inicio-core.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const lista = (v) => (Array.isArray(v) ? v : []);
const corDe = (k) => (tipoValido(k) ? TIPOS[k] : TIPOS.clinica).cor;
const visivel = (e) => !!e && e.getClientRects().length > 0;

// Armazenamento do aparelho: pode faltar (modo privado, bloqueado). Só as chaves de CHAVES, nunca a posição.
const local = {
  ler(k) { try { return localStorage.getItem(k); } catch { return null; } },
  gravar(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
  apagar(k) { try { localStorage.removeItem(k); } catch { /* sem armazenamento */ } },
};
const sessao = {
  ler(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  gravar(k, v) { try { sessionStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
};

// Página de cada local: parceiro pelo id, estabelecimento do CNES pelo código de 7 dígitos.
function urlLocal(r) {
  if (r.partner && r.id) return `local.html?id=${encodeURIComponent(r.id)}`;
  if (/^\d{7}$/.test(String(r.cnes || ''))) return `local.html?cnes=${r.cnes}`;
  return '';
}

const ICONE_BOTAO = { prefiro: 'fa-location-dot', escolher: 'fa-magnifying-glass', usar: 'fa-location-crosshairs', tentar: 'fa-rotate-right', busca: 'fa-map-location-dot', outra: 'fa-location-dot' };
const ESQUELETO = '<li class="ph" aria-hidden="true"><span class="pv-ph"><span class="pv-n"></span><span class="pv-txt"><i></i><i></i></span></span></li>'.repeat(LISTA_CELULAR);
// Atalhos no cartão dos estados (o seletor mostra N_ATALHOS).
const ATALHOS_CARTAO = 8;

// ctx (do inicio.js): rpc(fn, args, {signal}), geocode(q), toast(texto), openSheet(html, cls, rótulo, {foco}),
// closeSheet(), head(título), loadLeaflet(), loadCities(deNovo), mapa (tiles), economia
// (economia de dados ou 2G), reduzir ("reduzir movimento") e aoMudarOrigem() (o topo, o 3D e a fonte acompanham).
export function iniciarPerto(ctx) {
  const sec = $('#reais');
  const reduzir = !!ctx.reduzir;
  const DESK = matchMedia('(min-width: 900px)');
  // O # do endereço ao abrir (o inicio.js limpa alguns depois).
  const hashInicial = decodeURIComponent(location.hash || '');

  const S = {
    modo: null, // 'perto' (localização) | 'cidade' (cidade escolhida) | null (sem origem)
    here: null, // posição arredondada, só na memória
    regiao: null, regiaoFeita: false, // região da pessoa (cityOfRows), só na memória
    city: null, // {ibge, name, uf, lat, lng}
    tipo: '', raio: RAIOS[0], raioTodos: RAIOS[0], primeiro: 0, total: null, itens: [],
    lista1: false, maisPerto: null, temPagina: false,
    tela: 'carregando',
    esperaTopo: true, // o 3D e a lista leve esperam a resposta do pedido
    naoApareceu: false,
    cidades: null, cidadesErro: false,
    geo: { suporte: false, permissao: 'unknown', status: null, pendente: false },
  };
  let seq = 0; // muda a cada origem: descarta respostas velhas
  let listaSeq = 0;
  let ctrl = new AbortController();
  const cache = { listas: new Map(), parceiros: new Map(), pontos: new Map() };
  const paginas = new Map(); // HEAD das páginas das cidades (endereço → Promise<boolean>)
  let tTopo = 0;

  const avisar = () => { try { ctx.aoMudarOrigem?.(); } catch (e) { console.warn(e); } };
  const origem = () => (S.modo === 'perto' ? S.here : S.modo === 'cidade' ? S.city : null);

  const el = sec ? {
    estado: $('#pvEstado'), sum: $('#pvSum'), lista: $('#realList'), mais: $('#pvMore'), todos: $('#pvAll'), tipos: $('#pvTipos'),
    abas: $('#pvTabs'), mapOpen: $('#mapOpen'), mapa: $('#pvMapa'), mapMsg: $('#pvMapMsg'), mapTitle: $('#mapTitle'), stats: $('#realStats'),
    rot: $('#cityRot'), cityBtn: $('#cityBtn'), cityName: $('#cityName'), trocar: $('#cityTrocar'), linha: $('#cityLine'),
    useGeo: $('#useGeoBtn'), ajuda: $('#pvGeoHelp'), aviso: $('#geoAviso'), avisoMais: $('#geoAvisoMais'), status: $('#geoStatus'),
  } : null;

  /* ======================= cidades do banco (imported_cities) ======================= */
  function cidades(deNovo = false) {
    return ctx.loadCities(deNovo).then((rows) => { S.cidades = lista(rows); S.cidadesErro = false; return S.cidades; })
      .catch((e) => { S.cidadesErro = true; throw e; });
  }

  /* ======================= rótulos (topo e linha da cidade) ======================= */
  function rotulos() {
    const r = rotulosOrigem({ modo: S.modo, regiao: S.regiao, cidade: S.city, here: S.here, buscando: S.geo.pendente && !S.modo });
    const set = (sel, t) => { const e = $(sel); if (e && e.textContent !== t) e.textContent = t; };
    set('#addrSmall', r.pequeno); set('#addrTxt', r.principal); set('#heroAddr', r.busca);
    if (!el) return;
    set('#cityRot', r.rotulo); set('#cityName', r.botao);
    el.trocar.hidden = !r.trocar;
    el.linha.textContent = r.linha;
    el.linha.hidden = !r.linha;
    // "Usar minha localização" na linha da cidade: só no modo cidade (e se o navegador tem localização).
    const bloqueada = S.geo.permissao === 'denied';
    el.useGeo.hidden = !(S.modo === 'cidade' && S.geo.suporte);
    el.useGeo.querySelector('span').textContent = S.geo.pendente ? 'Aguardando permissão…' : bloqueada ? TEXTOS.bloqueadaComoLiberar : TEXTOS.usarLocalizacao;
    if (!bloqueada || el.useGeo.hidden) el.ajuda.hidden = true;
    // Bloqueada: o botão abre e fecha a ajuda (como liberar), sem chamar o navegador.
    if (bloqueada) el.useGeo.setAttribute('aria-expanded', String(!el.ajuda.hidden)); else el.useGeo.removeAttribute('aria-expanded');
    estadoSeletorGeo();
  }
  function nearCta() {
    const s = $('#nearCta small');
    if (s) { const t = textoNearCta({ modo: S.modo, cidade: S.city, item: S.maisPerto }); if (s.textContent !== t) s.textContent = t; }
  }
  // Leitor de tela: o que aconteceu com o pedido (status escondido, separado do aviso).
  function falar(t) {
    if (!el?.status) return;
    if (el.status.textContent === t) el.status.textContent = '';
    setTimeout(() => { el.status.textContent = t; }, 30);
  }

  /* ======================= aviso no alto (#geoAviso) ======================= */
  const raiz = document.documentElement;
  function ajustarPadding() {
    if (!el || el.aviso.hidden) return;
    // WCAG 2.4.11: o que recebe o foco pelo Tab não fica escondido atrás do aviso fixo.
    raiz.style.scrollPaddingTop = `${Math.round(el.aviso.getBoundingClientRect().bottom + 16)}px`;
  }
  function mostrarAviso() {
    if (!el) return;
    el.avisoMais.hidden = !S.naoApareceu;
    el.aviso.hidden = false; // sem mover o foco
    ajustarPadding();
    addEventListener('resize', ajustarPadding);
    falar(TEXTOS.statusPediu);
  }
  function esconderAviso() {
    if (!el || el.aviso.hidden) return;
    el.aviso.hidden = true;
    raiz.style.removeProperty('scroll-padding-top');
    removeEventListener('resize', ajustarPadding);
  }

  /* ======================= estados da tela (#reais[data-estado]) ======================= */
  function botao(k, primeiro) {
    if (k === 'busca') {
      const href = S.modo === 'perto' ? LINKS.pertoDeMim : LINKS.buscaCompleta;
      return `<a class="btn ${primeiro ? 'btn-coral' : 'btn-ghost'}" href="${href}"><i class="fa-solid ${ICONE_BOTAO[k]}" aria-hidden="true"></i>${esc(BOTOES[k])}</a>`;
    }
    const geo = k === 'usar' || (k === 'tentar' && S.tela !== 'erro');
    const esperando = geo && S.geo.pendente;
    return `<button class="btn ${primeiro ? 'btn-coral' : 'btn-ghost'}" type="button" data-bt="${k}"${esperando ? ' aria-disabled="true"' : ''}><i class="fa-solid ${ICONE_BOTAO[k]}" aria-hidden="true"></i>${esc(esperando ? 'Aguardando permissão…' : BOTOES[k])}</button>`;
  }
  function htmlAtalhos(n = ATALHOS_CARTAO) {
    if (!S.cidades) return '';
    const at = cidadesComMaisLocais(S.cidades, n);
    if (!at.length) return '';
    return `<div class="pv-atalhos"><h4 id="pvAtTit">${esc(TEXTOS.atalhos)}</h4><div class="pv-agrid" role="group" aria-labelledby="pvAtTit">${at.map((c) => `<button type="button" class="pv-at" data-at="${esc(c.ibge)}"><b>${esc(c.name)} - ${esc(c.uf)}</b><small>${esc(textoLocais(c.total))}</small></button>`).join('')}</div></div>`;
  }
  // Botão do cartão com o foco (data-bt ou data-at): o cartão é redesenhado e o foco volta para o mesmo botão.
  function focoNoCartao() {
    const a = document.activeElement;
    if (!a || !el.estado.contains(a)) return null;
    return a.dataset.bt ? `[data-bt="${a.dataset.bt}"]` : a.dataset.at ? `[data-at="${a.dataset.at}"]` : '';
  }
  function desenharEstado() {
    const foco = focoNoCartao();
    desenharCartao();
    if (foco == null) return;
    const novo = foco && !el.estado.hidden ? el.estado.querySelector(foco) : null;
    // O botão sumiu (a lista chegou, por exemplo): o foco vai para o botão da cidade da mesma tela.
    if (novo) novo.focus({ preventScroll: true }); else if (visivel(el.cityBtn)) el.cityBtn.focus({ preventScroll: true });
  }
  function desenharCartao() {
    const e = estadoTela(S.tela);
    if (!e) { el.estado.hidden = true; el.estado.innerHTML = ''; return; }
    const mais = S.tela === 'aguardando' && S.naoApareceu ? `<p class="pv-nao">${esc(TEXTOS.avisoNaoApareceu)}</p>` : '';
    el.estado.innerHTML = `<div class="pv-ecard">${e.titulo ? `<h3>${esc(e.titulo)}</h3>` : ''}${e.texto ? `<p>${esc(e.texto)}</p>` : ''}${mais}`
      + `${e.botoes.length ? `<div class="pv-ebts">${e.botoes.map((k, i) => botao(k, i === 0)).join('')}</div>` : ''}${S.tela === 'buscando' ? '<span class="rm-spin" aria-hidden="true"></span>' : ''}</div>`
      + (e.atalhos ? htmlAtalhos() : '') + '<p class="pv-emsg" id="pvEMsg"></p>';
    el.estado.hidden = false;
  }
  function setTela(t) {
    if (!el) return;
    S.tela = t;
    sec.dataset.estado = t;
    const comLista = t === 'lista' || t === 'carregando';
    el.lista.setAttribute('aria-busy', String(t === 'carregando'));
    if (t === 'carregando') {
      el.lista.classList.remove('todos');
      el.lista.innerHTML = ESQUELETO;
      el.sum.textContent = '';
      el.mais.hidden = true; el.todos.hidden = true; el.tipos.hidden = true; el.mapOpen.hidden = true;
    }
    if (!comLista) {
      el.lista.innerHTML = ''; el.mais.hidden = true; el.todos.hidden = true; el.tipos.hidden = true; el.mapOpen.hidden = true;
      // vazio e erro: o resumo diz o que houve (o leitor de tela ouve pelo role=status).
      el.sum.textContent = t === 'vazio' || t === 'erro' ? estadoTela(t).titulo : '';
    }
    desenharEstado();
    mapaSemOrigem();
    if (!comLista && cheio) fecharMapaCheio();
  }

  /* ======================= chamadas ao banco (cache só na memória) ======================= */
  function buscarLista(o, raio, tipo, signal) {
    const k = chaveCache(o, tipo, raio);
    if (!cache.listas.has(k)) {
      const p = ctx.rpc('nearby_establishments', argsLista(o, raio, tipo), { signal }).then(lista);
      cache.listas.set(k, p);
      p.catch(() => { if (cache.listas.get(k) === p) cache.listas.delete(k); });
    }
    return cache.listas.get(k);
  }
  // Parceiros: uma chamada por origem e raio; a aba filtra no aparelho. Se falhar, a lista mostra só o CNES.
  function buscarParceiros(o, raio, signal) {
    const k = chaveCache(o, raio);
    if (!cache.parceiros.has(k)) {
      cache.parceiros.set(k, ctx.rpc('nearby_clinics', argsParceiros(o, raio), { signal }).then(lista).catch(() => []));
    }
    return cache.parceiros.get(k);
  }
  function buscarPontos(o, raio, signal) {
    const k = chaveCache(o, raio);
    if (!cache.pontos.has(k)) {
      const p = ctx.rpc(`establishment_points?select=${PONTOS_SELECT}`, argsPontos(o, raio), { signal }).then(lista);
      cache.pontos.set(k, p);
      p.catch(() => { if (cache.pontos.get(k) === p) cache.pontos.delete(k); });
    }
    return cache.pontos.get(k);
  }

  /* ======================= origem ======================= */
  function soltarTopo() { if (S.esperaTopo) { S.esperaTopo = false; clearTimeout(tTopo); } }
  function esperarTopo(ms) {
    S.esperaTopo = true;
    clearTimeout(tTopo);
    tTopo = setTimeout(() => {
      if (!S.esperaTopo) return;
      S.esperaTopo = false;
      // Pedido sem resposta: "Não apareceu a pergunta?" (o Chrome pode mostrar o pedido só como um ícone).
      if (S.geo.pendente && S.pedidoAuto && !S.modo) {
        S.naoApareceu = true;
        if (el && !el.aviso.hidden) { el.avisoMais.hidden = false; ajustarPadding(); }
        if (S.tela === 'aguardando') desenharEstado();
      }
      avisar();
    }, ms);
  }
  // A origem mudou (localização, cidade ou nenhuma): zera abas, caches e mapa e busca a lista de novo.
  function mudarOrigem() {
    seq += 1;
    ctrl.abort();
    ctrl = new AbortController();
    cache.listas.clear(); cache.parceiros.clear(); cache.pontos.clear();
    S.tipo = ''; S.raio = RAIOS[0]; S.raioTodos = RAIOS[0]; S.itens = []; S.total = null; S.lista1 = false; S.maisPerto = null;
    S.temPagina = false;
    if (S.modo) soltarTopo();
    marcarAbas();
    limparMapa();
    rotulos(); nearCta();
    if (S.modo) {
      setTela('carregando');
      carregarLista();
      if (S.modo === 'cidade') verificarPagina();
    }
    avisar();
  }
  function irPerto(p) {
    const nova = !S.here || S.here.lat !== p.lat || S.here.lng !== p.lng;
    S.here = p;
    if (nova) { S.regiao = null; S.regiaoFeita = false; }
    S.modo = 'perto'; S.city = null;
    // A pessoa passou a usar a localização: a cidade escolhida sai do aparelho (as recentes continuam).
    local.apagar(CHAVES.cidade);
    esconderAviso();
    mudarOrigem();
  }
  function aplicarCidade(c) {
    S.city = c; S.modo = 'cidade';
    local.gravar(CHAVES.cidade, JSON.stringify(c));
    local.gravar(CHAVES.recentes, JSON.stringify(comRecente(local.ler(CHAVES.recentes), c)));
    // Contador próprio: só "UF/Cidade", nunca a posição.
    try { window.IMED_TRACK?.('busca_cidade', `${c.uf}/${c.name}`); } catch { /* contador fora do ar */ }
    esconderAviso();
    mudarOrigem();
    if (seletorAberto()) ctx.closeSheet(); // o foco volta para quem abriu, já com o nome novo
    ctx.toast(textoToastCidade(c.name));
  }
  // Sem origem: a posição esquecida (permissão retirada) ou nunca conseguida.
  function semOrigem(tela) {
    S.modo = null;
    seq += 1; ctrl.abort(); ctrl = new AbortController();
    limparMapa();
    soltarTopo();
    rotulos(); nearCta();
    setTela(tela);
    avisar();
  }

  /* ======================= lista ======================= */
  async function carregarLista() {
    const o = origem();
    if (!o || !el) return;
    const meu = seq, minha = ++listaSeq, tipo = S.tipo, { signal } = ctrl;
    if (S.tela !== 'lista') setTela('carregando');
    else el.lista.setAttribute('aria-busy', 'true');
    try {
      let raio = RAIOS[0], primeiro = null, itens = [], cnes = [], par = [];
      for (;;) {
        [cnes, par] = await Promise.all([buscarLista(o, raio, tipo, signal), buscarParceiros(o, raio, signal)]);
        if (meu !== seq || minha !== listaSeq) return;
        itens = montarLista(cnes, par, { tipo, origem: o });
        if (primeiro == null) primeiro = itens.length;
        const prox = proximoRaio(raio, itens.length);
        if (!prox) break;
        raio = prox;
      }
      S.itens = itens; S.raio = raio; S.primeiro = primeiro;
      S.total = totalDaArea(cnes, par, tipo);
      if (!tipo) S.raioTodos = raio;
      if (!itens.length && !tipo) { setTela('vazio'); primeiraLista(cnes, meu); return; }
      setTela('lista');
      desenharLista();
      primeiraLista(cnes, meu);
      if (M.mapa && M.dados) aplicarMapa(false);
    } catch (err) {
      if (meu !== seq || minha !== listaSeq) return;
      setTela('erro');
    }
  }
  // Depois da 1ª lista de cada origem: o local mais perto (#nearCta), a região da pessoa e o mapa.
  function primeiraLista(cnes, meu) {
    if (S.lista1) return;
    S.lista1 = true;
    S.maisPerto = S.itens[0] || null;
    nearCta();
    if (S.modo === 'perto' && !S.regiaoFeita) {
      const pronto = (cid) => {
        if (meu !== seq || S.modo !== 'perto') return;
        S.regiao = cityOfRows(cnes, cid);
        S.regiaoFeita = true;
        rotulos(); avisar();
      };
      cidades().then(pronto, () => pronto(null));
    }
    avisar();
    talvezMapa();
  }
  function desenharLista() {
    const itens = S.itens;
    // Item com o foco (pelo número): volta para ele depois de redesenhar.
    const ativo = document.activeElement, focoI = ativo && el.lista.contains(ativo) ? ativo.closest('[data-i]')?.dataset.i : null;
    const ate = S.modo === 'cidade' && distanciaNosItens(S.here, S.city);
    const suf = sufixoOrigem(S.modo, S.city);
    el.lista.classList.remove('todos');
    el.lista.innerHTML = itens.map((r, i) => {
      const aprox = ehAproximado(r);
      // A distância não é <b>: o nome é o único <b> do item.
      const d = r.distance_m != null ? `<span class="pv-km">${esc(textoDistancia(r.distance_m, aprox))}</span><span class="sr">${esc(suf)}</span>` : '';
      const voce = ate && Number.isFinite(r.lat) && Number.isFinite(r.lng) ? `<small>${esc(textoAteVoce(metrosEntre(S.here, r), aprox))}</small>` : '';
      const sl = selos(r);
      const corpo = `<span class="pv-n" style="background:${corDe(r.kind)}" aria-hidden="true">${i + 1}</span>`
        + `<span class="pv-txt"><b>${esc(r.name)}</b><small>${esc(linhaTipo(r))}</small>${sl.length ? `<span class="pv-selos">${sl.map((s) => `<span>${esc(s)}</span>`).join('')}</span>` : ''}</span>`
        + `<span class="pv-d">${d}${voce}</span>`;
      const url = urlLocal(r);
      return `<li${i >= LISTA_CELULAR ? ' class="pv-extra"' : ''}>${url ? `<a href="${esc(url)}" data-i="${i}">${corpo}</a>` : `<span class="pv-item" data-i="${i}">${corpo}</span>`}</li>`;
    }).join('');
    el.lista.setAttribute('aria-busy', 'false');
    el.sum.textContent = textoResumo({ tipo: S.tipo, n: itens.length, raio: S.raio, primeiro: S.primeiro, modo: S.modo, cidade: S.city });
    const resto = itens.length - LISTA_CELULAR;
    el.mais.hidden = resto <= 0;
    if (resto > 0) el.mais.textContent = textoMostrarMais(resto);
    el.tipos.hidden = itens.length > 0 || !S.tipo;
    el.mapOpen.hidden = !itens.length;
    desenharVerTodos();
    if (focoI != null) el.lista.querySelector(`[data-i="${focoI}"]`)?.focus({ preventScroll: true });
  }
  function desenharVerTodos() {
    if (!el || !S.modo) return;
    const v = verTodos({ modo: S.modo, total: S.total, raio: S.raio, tipo: S.tipo, cidade: S.city, temPagina: S.temPagina });
    el.todos.querySelector('span').textContent = v.texto;
    el.todos.setAttribute('href', v.href);
    el.todos.hidden = S.tela !== 'lista';
  }
  // A página da cidade (cidades/<uf>/<slug>/) só aparece se existe no site: cidade importada depois da última
  // geração das páginas não ganha link quebrado.
  function verificarPagina() {
    const c = S.city, meu = seq;
    if (!c) return;
    const url = cityUrl(c);
    if (!paginas.has(url)) paginas.set(url, fetch(url, { method: 'HEAD' }).then((r) => r.ok).catch(() => false));
    paginas.get(url).then((ok) => { if (meu === seq) { S.temPagina = ok; desenharVerTodos(); } });
  }
  function marcarAbas() {
    el?.abas.querySelectorAll('button[data-tipo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tipo === S.tipo)));
  }

  /* ======================= localização ======================= */
  function permissaoAgora() { return S.geo.status ? permissaoDe(S.geo.status.state) : S.geo.permissao; }
  function registrar(resultado) {
    const antes = lerRecusas(local.ler(CHAVES.recusas)), depois = contaRecusas(antes, resultado);
    if (depois === antes) return;
    if (depois) local.gravar(CHAVES.recusas, String(depois)); else local.apagar(CHAVES.recusas);
  }
  // motivo: 'pedido' (ao abrir, com o aviso), 'silencio' (permissão já dada), 'toque' (botão) ou 'distancia'
  // (modo cidade: a posição serve só para "fica a X km de você"). fim(resultado): 'ok' ou a tela do erro.
  function localizar(motivo, fim) {
    if (!S.geo.suporte || S.geo.pendente) return false;
    S.geo.pendente = true;
    S.pedidoAuto = motivo === 'pedido';
    const t0 = performance.now();
    rotulos();
    if (S.tela !== 'lista') desenharEstado();
    const pronto = (pos) => {
      if (!S.geo.pendente) return;
      S.geo.pendente = false;
      const p = aproximar(pos);
      if (!p) { falhou({ code: 2 }); return; }
      if (S.geo.permissao !== 'denied') S.geo.permissao = 'granted';
      registrar('permitiu');
      if (motivo === 'pedido') falar(TEXTOS.statusPronto);
      esconderAviso();
      if (S.modo === 'cidade' && motivo !== 'toque') {
        // Cidade escolhida com o pedido aberto (ou posição em silêncio no modo cidade): só a distância.
        S.here = p;
        rotulos(); if (S.tela === 'lista') desenharLista();
        estadoSeletorGeo();
      } else irPerto(p);
      fim?.('ok');
    };
    const falhou = (err) => {
      if (!S.geo.pendente) return;
      S.geo.pendente = false;
      const perm = permissaoAgora();
      if (perm === 'denied') S.geo.permissao = 'denied';
      const tela = geoErro(err?.code, perm, performance.now() - t0);
      if (motivo !== 'distancia') registrar(tela);
      if (motivo === 'pedido' || motivo === 'toque') falar(TEXTOS.statusSem);
      esconderAviso();
      if (S.modo) {
        // Já há origem (cidade escolhida enquanto esperava): a lista continua; só os botões mudam.
        rotulos();
        if (motivo === 'toque') {
          if (tela === 'negada' || tela === 'naoapareceu') mostrarAjudaLinha(true);
          else ctx.toast(estadoTela(tela)?.titulo || TEXTOS.statusSem);
        }
      } else {
        soltarTopo();
        rotulos();
        setTela(tela);
        avisar();
      }
      fim?.(tela);
    };
    try {
      navigator.geolocation.getCurrentPosition(pronto, falhou, GEO_OPCOES);
    } catch {
      falhou({ code: 2 });
    }
    return true;
  }
  // Toques em "Usar minha localização", "Tentar de novo" e no #nearCta sem origem.
  function tocarLocalizar(fim) {
    const a = acaoToque({ suporte: S.geo.suporte, permissao: S.geo.permissao, pendente: S.geo.pendente });
    if (a === 'chamar') localizar('toque', fim);
    else if (a === 'ajuda') { if (!S.modo) setTela('negada'); else mostrarAjudaLinha(true); }
    return a;
  }
  function mostrarAjudaLinha(on) {
    if (!el) return;
    el.ajuda.hidden = !on;
    if (S.geo.permissao === 'denied') el.useGeo.setAttribute('aria-expanded', String(on));
  }
  // A permissão mudou com a página aberta (configurações do navegador).
  function aoMudarPerm() {
    const nova = permissaoDe(S.geo.status?.state);
    S.geo.permissao = nova;
    const acao = aoMudarPermissao(nova, { modo: S.modo, pendente: S.geo.pendente });
    if (acao === 'localizar') { setTela('buscando'); localizar('silencio'); }
    else if (acao === 'distancia') localizar('distancia');
    else if (acao === 'esquecer') {
      S.here = null; S.regiao = null; S.regiaoFeita = false;
      if (S.modo === 'perto') semOrigem('negada');
      else { rotulos(); if (S.tela === 'lista') desenharLista(); }
    } else if (acao === 'negada') setTela('negada');
    else if (!S.modo && S.tela !== 'lista') desenharEstado();
    rotulos();
  }
  async function lerPermissao() {
    try {
      if (!navigator.permissions?.query) return 'unknown';
      const st = await Promise.race([
        navigator.permissions.query({ name: 'geolocation' }),
        new Promise((_, nao) => setTimeout(() => nao(new Error('tempo')), 1500)),
      ]);
      S.geo.status = st;
      if (typeof st.addEventListener === 'function') st.addEventListener('change', aoMudarPerm);
      else st.onchange = aoMudarPerm;
      return permissaoDe(st.state);
    } catch {
      return 'unknown';
    }
  }
  // Pedido ao abrir (plano "pedir"): espera a aba ficar visível, mostra o aviso, grava que já pediu nesta aba e,
  // dois quadros depois, chama o navegador uma única vez.
  function pedirAoAbrir() {
    const vai = () => {
      if (S.modo) return; // a pessoa já escolheu a cidade
      mostrarAviso();
      sessao.gravar(CHAVES.pedido, '1');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (S.modo) { esconderAviso(); return; }
        esperarTopo(ESPERA_PEDIDO_MS);
        localizar('pedido');
      }));
    };
    if (document.visibilityState === 'hidden') {
      const f = () => { if (document.visibilityState !== 'hidden') { document.removeEventListener('visibilitychange', f); vai(); } };
      document.addEventListener('visibilitychange', f);
    } else vai();
  }

  /* ======================= mapa ======================= */
  const M = { mapa: null, base: null, pontos: null, pinos: null, marcas: [], dados: null, dadosSeq: -1, carregando: -1, perto: false, quer: false };
  function mapaMsg(html) {
    if (!el) return;
    el.mapMsg.innerHTML = html;
    el.mapMsg.hidden = !html;
  }
  // Coluna do mapa sem mapa: o desenho do topo, com a frase quando ainda não há origem.
  function mapaSemOrigem() {
    if (!el) return;
    const tem = !!origem() && M.mapa && M.dadosSeq === seq;
    el.mapa.classList.toggle('sem-mapa', !tem);
    el.mapa.classList.toggle('sem-origem', !origem());
    if (!origem()) mapaMsg(`<p>${esc(TEXTOS.mapaSemOrigem)}</p>`);
    else if (!tem && ctx.economia && DESK.matches && !M.quer && S.tela === 'lista') {
      mapaMsg(`<p>${esc(TEXTOS.mapaEconomia)}</p><button class="btn btn-primary" type="button" id="mapShow"><i class="fa-solid fa-map" aria-hidden="true"></i>${esc(TEXTOS.mostrarMapa)}</button>`);
    } else if (!tem && S.tela === 'lista' && M.carregando === seq) mapaMsg('<p class="pv-mwait"><span class="rm-spin" aria-hidden="true"></span>Carregando o mapa…</p>');
    else if (!tem) mapaMsg('');
  }
  function limparMapa() {
    M.dados = null; M.dadosSeq = -1; M.quer = false;
    if (M.mapa) { M.base.clearLayers(); M.pontos.clearLayers(); M.pinos.clearLayers(); M.marcas = []; }
    if (el) el.stats.innerHTML = '';
    mapaSemOrigem();
  }
  // Computador: o mapa vem quando a tela chega a 100 px da vista e depois da 1ª lista (com economia de dados, só
  // no toque em "Mostrar o mapa"). Celular: só no toque em "Ver no mapa".
  function talvezMapa() {
    if (!origem() || !S.lista1 || S.tela !== 'lista') { mapaSemOrigem(); return; }
    if (cheio || (DESK.matches && M.perto && (!ctx.economia || M.quer))) desenharMapa();
    else mapaSemOrigem();
  }
  async function desenharMapa() {
    const o = origem();
    if (!o || !S.lista1) return;
    const meu = seq;
    if (M.dados && M.dadosSeq === meu) { aplicarMapa(false); return; }
    if (M.carregando === meu) return;
    M.carregando = meu;
    mapaSemOrigem();
    try {
      await ctx.loadLeaflet();
      const raio = S.raioTodos || RAIOS[0];
      const [pts, par] = await Promise.all([buscarPontos(o, raio, ctrl.signal), buscarParceiros(o, raio, ctrl.signal)]);
      if (meu !== seq) return;
      M.dados = { pts, par, raio, total: totalDe(pts), origem: o };
      M.dadosSeq = meu;
      aplicarMapa(true);
    } catch {
      if (meu !== seq) return;
      if (M.mapa) { M.base.clearLayers(); M.pontos.clearLayers(); M.pinos.clearLayers(); }
      el.mapa.classList.add('sem-mapa');
      mapaMsg(`<p>${esc(TEXTOS.mapaFalhou)}</p><button class="btn btn-ghost" type="button" id="mapRetry"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>${esc(TEXTOS.tentar)}</button>`);
    } finally {
      if (M.carregando === meu) M.carregando = -1;
    }
  }
  function aplicarMapa(nova) {
    const L = window.L;
    if (!L || !M.dados) return;
    const { pts, par, raio, total, origem: o } = M.dados;
    if (!M.mapa) {
      // Canvas: em bairro movimentado são milhares de pontos. A roda do mouse não aproxima (a página rola).
      M.mapa = L.map($('#realMap'), { scrollWheelZoom: false, preferCanvas: true, zoomSnap: 0.5, zoomAnimation: !reduzir, fadeAnimation: !reduzir, markerZoomAnimation: !reduzir });
      L.tileLayer(ctx.mapa.tiles, { maxZoom: ctx.mapa.maxZoom, attribution: ctx.mapa.attribution }).addTo(M.mapa);
      M.base = L.layerGroup().addTo(M.mapa);
      M.pontos = L.layerGroup().addTo(M.mapa);
      M.pinos = L.layerGroup().addTo(M.mapa);
    }
    el.mapa.classList.remove('sem-mapa', 'sem-origem');
    mapaMsg('');
    if (nova) {
      M.base.clearLayers();
      // O círculo tracejado do raio dos pontos.
      L.circle([o.lat, o.lng], { radius: raio, color: '#0E7C9C', weight: 1.5, opacity: 0.7, dashArray: '6 6', fill: false, interactive: false }).addTo(M.base);
      const leg = legendaTipos(pts, par, total);
      el.stats.innerHTML = `<p class="pv-leg">${esc(textoLegenda(raio))}</p><div class="rm-stats">${leg.map((x) => `<div class="rm-stat"><b>${esc(x.texto)}</b><span><i style="background:${TIPOS[x.tipo].cor}"></i>${esc(x.nome)}</span></div>`).join('')}</div>`;
    }
    desenharPontos();
    desenharPinos();
    enquadrar();
    if (cheio) M.mapa.invalidateSize();
  }
  function desenharPontos() {
    const L = window.L, { pts, par, origem: o } = M.dados, tipo = S.tipo;
    const doTipo = (r) => !tipo || r.kind === tipo;
    const ok = (r) => r && r.name && Number.isFinite(r.lat) && Number.isFinite(r.lng);
    // Os locais da lista já vêm com endereço e telefone: o balão do mapa usa esses dados.
    const cheios = new Map(S.itens.filter((r) => !r.partner).map((r) => [String(r.cnes), r]));
    M.pontos.clearLayers();
    // Pontos de todos os locais da área (filtrados pela aba no aparelho, sem nova chamada).
    pts.filter((r) => ok(r) && doTipo(r)).forEach((r) => {
      const row = cheios.get(String(r.cnes)) || { ...r, partner: false };
      L.circleMarker([r.lat, r.lng], { radius: 4.5, color: '#fff', weight: 1, fillColor: corDe(r.kind), fillOpacity: 0.9 }).bindPopup(() => balao(row)).addTo(M.pontos);
    });
    // Parceiros: maiores, com borda coral.
    par.filter((r) => ok(r) && doTipo(r)).forEach((r) => {
      const row = { ...r, partner: true };
      L.circleMarker([r.lat, r.lng], { radius: 8, color: '#FF6B4A', weight: 3, fillColor: corDe(r.kind), fillOpacity: 0.95 }).bindPopup(() => balao(row)).addTo(M.pontos);
    });
    // O ponto de partida por cima: "Você (aproximado)" ou "Centro de Campinas".
    L.circleMarker([o.lat, o.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#FF6B4A', fillOpacity: 1 }).bindTooltip(rotuloPontoOrigem(S.modo, S.city)).addTo(M.pontos);
  }
  // Pinos numerados de 1 a 10, iguais aos da lista (fora do Tab: pelo teclado, a lista faz o mesmo).
  function desenharPinos() {
    const L = window.L;
    M.pinos.clearLayers();
    M.marcas = S.itens.map((r, i) => {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return null;
      const icon = L.divIcon({ className: 'pv-pin-w', html: `<span class="pv-pin" style="background:${corDe(r.kind)}" aria-hidden="true">${i + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
      const m = L.marker([r.lat, r.lng], { icon, keyboard: false, zIndexOffset: 1000 + (20 - i) * 10 }).bindPopup(() => balao(r));
      m.on('click', () => marcarItem(i));
      return m.addTo(M.pinos);
    });
  }
  function enquadrar() {
    const L = window.L, { raio, origem: o } = M.dados;
    const fora = S.raio > raio && S.itens.length;
    if (fora) {
      // A aba precisou ir além do círculo: enquadra a origem e os pinos.
      M.mapa.fitBounds(L.latLngBounds([[o.lat, o.lng], ...S.itens.filter((r) => Number.isFinite(r.lat)).map((r) => [r.lat, r.lng])]), { padding: [24, 24], animate: false });
    } else {
      M.mapa.fitBounds(L.latLng(o.lat, o.lng).toBounds(raio * 2), { padding: [10, 10], animate: false });
    }
  }
  function balao(r) {
    const pop = document.createElement('div');
    pop.className = 'rm-pop';
    const add = (tag, text) => { if (!text) return; const e = document.createElement(tag); e.textContent = text; pop.appendChild(e); };
    const d = Number(r.distance_m);
    add('b', r.name);
    add('div', `${r.partner ? 'Parceiro do IMED · ' : ''}${(tipoValido(r.kind) ? TIPOS[r.kind] : TIPOS.clinica).n}${Number.isFinite(d) ? ` · ${textoDistancia(d, ehAproximado(r))}` : ''}`);
    add('div', [r.address_line, r.neighborhood].filter(Boolean).join(' · '));
    add('div', r.phone);
    add('div', r.open_24h ? 'Aberto 24 horas' : r.shift);
    const url = urlLocal(r);
    if (url) { const a = document.createElement('a'); a.href = url; a.textContent = 'Ver página do local'; pop.appendChild(a); }
    return pop;
  }
  // Item da lista ↔ pino do mapa.
  function acender(i, on) {
    const m = M.marcas[i];
    if (!m || !M.mapa) return;
    m.getElement()?.querySelector('.pv-pin')?.classList.toggle('on', on);
    m.setZIndexOffset(on ? 5000 : 1000 + (20 - i) * 10);
    // O mapa só se move se o pino estiver fora da vista.
    if (on && visivel($('#realMap')) && !M.mapa.getBounds().contains(m.getLatLng())) M.mapa.panTo(m.getLatLng(), { animate: !reduzir });
  }
  function marcarItem(i) {
    el.lista.querySelectorAll('[data-i].on').forEach((x) => x.classList.remove('on'));
    const a = el.lista.querySelector(`[data-i="${i}"]`);
    if (!a) return;
    a.classList.add('on');
    if (!cheio && visivel(a)) a.closest('li').scrollIntoView({ block: 'nearest', behavior: reduzir ? 'auto' : 'smooth' });
  }

  /* ======================= mapa em tela cheia (celular) ======================= */
  let cheio = false;
  function focaveis(box) {
    return [...box.querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex]')]
      .filter((x) => x.tabIndex >= 0 && visivel(x));
  }
  function abrirMapaCheio() {
    if (!el || cheio || !S.itens.length) return;
    cheio = true;
    const box = el.mapa;
    el.mapTitle.textContent = tituloMapa(rotulosOrigem({ modo: S.modo, regiao: S.regiao, cidade: S.city, here: S.here }).botao, S.tipo);
    box.classList.add('cheio');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'mapTitle');
    document.body.classList.add('mapa-cheio');
    // O "voltar" do Android fecha o mapa (sem mudar o endereço da página).
    try { history.pushState({ imedMapa: 1 }, ''); } catch { /* sem histórico */ }
    $('#mapClose').focus();
    if (M.mapa && M.dadosSeq === seq) { M.mapa.invalidateSize(); aplicarMapa(false); } else desenharMapa();
  }
  function fecharMapaCheio(peloHistorico = false) {
    if (!cheio) return;
    cheio = false;
    const box = el.mapa;
    box.classList.remove('cheio');
    box.removeAttribute('role'); box.removeAttribute('aria-modal'); box.removeAttribute('aria-labelledby');
    document.body.classList.remove('mapa-cheio');
    if (!peloHistorico && history.state && history.state.imedMapa) history.back();
    if (visivel(el.mapOpen)) el.mapOpen.focus({ preventScroll: true });
    else $('#reaisTitle')?.focus({ preventScroll: true });
  }

  /* ======================= seletor de cidade ======================= */
  let sel = null;
  const seletorAberto = () => !!sel && $('#ov')?.classList.contains('open') && !!document.getElementById('cityQ');
  function htmlSeletor() {
    return `${ctx.head(esc(TEXTOS.seletorTitulo))}<div class="sh-body cid-body">
      <button class="cid-geo" id="cityGeo" type="button" aria-controls="cityGeoHelp"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i><span><b>${esc(TEXTOS.seletorGeo)}</b><small id="cityGeoState"></small></span></button>
      <p class="cid-ajuda" id="cityGeoHelp" hidden>${esc(TEXTOS.seletorAjuda)}</p>
      <div class="cid-campo">
        <label for="cityQ">${esc(TEXTOS.seletorRotulo)}</label>
        <input id="cityQ" type="text" role="combobox" aria-autocomplete="list" aria-controls="cityList" aria-expanded="false" aria-describedby="cityDica" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="${esc(TEXTOS.seletorExemplo)}">
        <p class="cid-dica" id="cityDica">${esc(TEXTOS.seletorDica)}</p>
        <p class="cid-hint" id="cityHint" role="status"></p>
      </div>
      <ul class="cid-lista" id="cityList" role="listbox" aria-label="${esc(TEXTOS.seletorLista)}" hidden></ul>
      <div class="cid-idle" id="cityIdle"></div>
      <p class="cid-foot"><a href="${LINKS.naoAchou}">${esc(TEXTOS.seletorNaoAchou)}</a><a href="${LINKS.cidades}">${esc(TEXTOS.todasCidades)}</a></p>
    </div>`;
  }
  function estadoSeletorGeo() {
    const b = document.getElementById('cityGeo');
    if (!b) return;
    const e = estadoGeoSeletor({ suporte: S.geo.suporte, permissao: S.geo.permissao, aguardando: S.geo.pendente, ativa: !!S.here, regiao: S.regiao });
    $('#cityGeoState').textContent = e.texto;
    b.disabled = e.desabilitado;
    if (e.ajuda) b.setAttribute('aria-expanded', String(!$('#cityGeoHelp').hidden)); else b.removeAttribute('aria-expanded');
  }
  function htmlIdle() {
    let h = '';
    if (S.here && S.regiao) {
      h += `<div class="cid-grupo"><button class="cid-op cid-reg" type="button" data-reg><i class="fa-solid fa-location-dot" aria-hidden="true"></i><b>${esc(textoRegiao(S.regiao))}</b></button></div>`;
    }
    const rec = lerRecentes(local.ler(CHAVES.recentes));
    if (rec.length) {
      h += `<div class="cid-grupo"><h4 id="cidRec">${esc(TEXTOS.seletorRecentes)}</h4><div class="cid-grade" role="group" aria-labelledby="cidRec">${rec.map((c, i) => `<button class="cid-op" type="button" data-rec="${i}"><b>${esc(c.name)} - ${esc(c.uf)}</b>${S.here ? `<small>${esc(textoFicaA(metrosEntre(S.here, c)))}</small>` : ''}</button>`).join('')}</div></div>`;
    }
    if (S.cidades) {
      const at = cidadesComMaisLocais(S.cidades, N_ATALHOS);
      if (at.length) h += `<div class="cid-grupo"><h4 id="cidMais">${esc(TEXTOS.seletorMaisLocais)}</h4><div class="cid-grade" role="group" aria-labelledby="cidMais">${at.map((c) => `<button class="cid-op" type="button" data-ibge="${esc(c.ibge)}"><b>${esc(c.name)} - ${esc(c.uf)}</b><small>${esc(textoLocais(c.total, true))}</small></button>`).join('')}</div></div>`;
    } else if (S.cidadesErro) {
      h += `<div class="cid-grupo cid-erro"><p>${esc(TEXTOS.seletorErroLista)}</p><button class="btn btn-ghost" type="button" data-recarregar><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>${esc(TEXTOS.tentar)}</button></div>`;
    } else {
      h += `<p class="cid-load"><span class="rm-spin" aria-hidden="true"></span>${esc(TEXTOS.seletorCarregando)}</p>`;
    }
    return h;
  }
  function abrirSeletor() {
    esconderAviso();
    sel = { tk: {}, lista: [], ativo: -1, th: 0 };
    ctx.openSheet(htmlSeletor(), 'sm cid', TEXTOS.seletorTitulo, { foco: '#cityQ' });
    const meu = sel;
    const q = $('#cityQ'), ul = $('#cityList'), idle = $('#cityIdle'), hint = $('#cityHint');
    const dica = (t) => { if (hint.textContent !== t) hint.textContent = t; };
    const vivo = () => sel === meu && seletorAberto();
    function desenharIdle() {
      const tinha = idle.contains(document.activeElement);
      idle.innerHTML = htmlIdle();
      if (tinha && vivo()) (idle.querySelector('.cid-op, [data-recarregar]') || q).focus();
    }
    function fecharLista() {
      ul.hidden = true; ul.innerHTML = '';
      q.setAttribute('aria-expanded', 'false'); q.removeAttribute('aria-activedescendant');
      meu.lista = []; meu.ativo = -1;
    }
    function buscar() {
      clearTimeout(meu.th);
      if (!dobra(q.value)) { fecharLista(); idle.hidden = false; dica(''); return; }
      idle.hidden = true;
      if (!S.cidades) {
        fecharLista();
        dica(S.cidadesErro ? TEXTOS.seletorErroLista : TEXTOS.seletorCarregando);
        if (S.cidadesErro) idle.hidden = false;
        return;
      }
      const { lista: achadas, total } = matchCities(S.cidades, q.value);
      meu.lista = achadas; meu.ativo = -1;
      ul.innerHTML = achadas.map((r, i) => `<li role="option" id="cityOpt-${codigoMunicipio(r.ibge) != null ? esc(r.ibge) : `x${i}`}" aria-selected="false" data-i="${i}"><b>${esc(r.name)} - ${esc(r.uf)}</b><small>${esc(textoLocais(r.total, true))}</small></li>`).join('');
      ul.hidden = !achadas.length;
      q.setAttribute('aria-expanded', String(!!achadas.length));
      q.removeAttribute('aria-activedescendant');
      // A contagem é anunciada 300 ms depois da última tecla (não a cada letra).
      meu.th = setTimeout(() => { if (vivo()) dica(textoContagemCidades(total, achadas.length)); }, 300);
    }
    function marcarAtivo() {
      const opts = [...ul.querySelectorAll('[role=option]')];
      opts.forEach((li, i) => li.setAttribute('aria-selected', String(i === meu.ativo)));
      const li = opts[meu.ativo];
      if (li) { q.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
    }
    const ui = {
      procurando(nome) { q.disabled = true; dica(textoProcurandoCentro(nome)); },
      erro(msg) {
        if (!vivo()) { ctx.toast(msg); return; }
        q.disabled = false; dica(msg); q.focus();
      },
    };
    function escolher(r) { if (r) escolherCidade(r, ui); }
    q.addEventListener('input', buscar);
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!meu.lista.length) return;
        e.preventDefault();
        const n = meu.lista.length, desce = e.key === 'ArrowDown';
        meu.ativo = meu.ativo < 0 ? (desce ? 0 : n - 1) : (meu.ativo + (desce ? 1 : -1) + n) % n;
        marcarAtivo();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (meu.lista.length) escolher(meu.lista[meu.ativo >= 0 ? meu.ativo : 0]);
      } else if (e.key === 'Escape' && q.value) {
        // Esc com texto limpa o campo (a janela continua aberta); com o campo vazio, a janela fecha.
        e.preventDefault(); e.stopPropagation();
        q.value = ''; buscar();
      }
    });
    ul.addEventListener('mousedown', (e) => e.preventDefault()); // o campo não perde o foco
    ul.addEventListener('click', (e) => { const li = e.target.closest('[role=option]'); if (li) escolher(meu.lista[Number(li.dataset.i)]); });
    idle.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-reg')) { if (S.here && S.modo !== 'perto') irPerto(S.here); ctx.closeSheet(); return; }
      if (b.hasAttribute('data-recarregar')) {
        S.cidadesErro = false; desenharIdle();
        cidades(true).then(() => { if (vivo()) { desenharIdle(); if (q.value) buscar(); } }, () => { if (vivo()) desenharIdle(); });
        return;
      }
      if (b.dataset.rec != null) { escolher(lerRecentes(local.ler(CHAVES.recentes))[Number(b.dataset.rec)]); return; }
      if (b.dataset.ibge != null) escolher((S.cidades || []).find((c) => String(c.ibge) === b.dataset.ibge));
    });
    const geoBtn = $('#cityGeo');
    geoBtn.addEventListener('click', () => {
      const a = acaoToque({ suporte: S.geo.suporte, permissao: S.geo.permissao, pendente: S.geo.pendente });
      if (a === 'ajuda') { const h = $('#cityGeoHelp'); h.hidden = !h.hidden; estadoSeletorGeo(); return; }
      if (a !== 'chamar') return;
      localizar('toque', (res) => {
        if (!vivo()) return;
        if (res === 'ok') { ctx.closeSheet(); return; }
        if (res === 'negada' || res === 'naoapareceu') $('#cityGeoHelp').hidden = false;
        estadoSeletorGeo();
      });
      estadoSeletorGeo();
    });
    desenharIdle();
    estadoSeletorGeo();
    if (!S.cidades && !S.cidadesErro) {
      cidades().then(() => { if (vivo()) { desenharIdle(); if (q.value) buscar(); } }, () => { if (vivo()) { desenharIdle(); if (q.value) buscar(); } });
    }
  }
  // Escolha de uma cidade (seletor, atalhos ou recentes). r: linha do imported_cities ou cidade guardada.
  async function escolherCidade(r, ui) {
    if (!r || !r.name) return;
    // A cidade da região, com a posição conhecida: volta para perto de você, sem geocodificar.
    if (S.here && S.regiao && mesmaCidade(r, S.regiao)) {
      if (S.modo !== 'perto') irPerto(S.here);
      if (seletorAberto()) ctx.closeSheet();
      return;
    }
    const ibge = codigoMunicipio(r.ibge) != null && String(r.ibge).length === 7 ? Number(r.ibge) : null;
    // Centro já guardado (recentes ou a cidade escolhida antes): sem geocodificar.
    const salvo = centroGuardado(r, lerRecentes(local.ler(CHAVES.recentes)), local.ler(CHAVES.cidade)) || cidadeGuardada(r);
    if (salvo) { aplicarCidade({ ...salvo, ibge: ibge ?? salvo.ibge }); return; }
    ui.procurando(r.name);
    try {
      const g = await ctx.geocode(`${r.name}, ${r.uf}`);
      const c = cidadeGuardada({ ibge, name: String(r.name), uf: String(r.uf), lat: round3(g.lat), lng: round3(g.lng) });
      if (!c) throw new Error('centro');
      aplicarCidade({ ...c, ibge });
    } catch {
      ui.erro(TEXTOS.seletorErroCentro); // nada é guardado
    }
  }

  /* ======================= eventos da tela ======================= */
  function ligar() {
    el.cityBtn.addEventListener('click', abrirSeletor);
    el.useGeo.addEventListener('click', () => {
      if (S.geo.permissao === 'denied') { mostrarAjudaLinha(el.ajuda.hidden); return; }
      tocarLocalizar();
    });
    el.abas.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tipo]');
      if (!b || b.dataset.tipo === S.tipo) return;
      S.tipo = b.dataset.tipo;
      marcarAbas();
      if (tipoValido(S.tipo)) { try { window.IMED_TRACK?.('busca_tipo', S.tipo); } catch { /* contador fora do ar */ } }
      carregarLista();
    });
    el.tipos.addEventListener('click', () => { S.tipo = ''; marcarAbas(); carregarLista(); el.abas.querySelector('button[data-tipo=""]')?.focus(); });
    el.mais.addEventListener('click', () => {
      el.lista.classList.add('todos');
      el.mais.hidden = true;
      el.lista.querySelectorAll('li')[LISTA_CELULAR]?.querySelector('a,[data-i]')?.focus();
    });
    el.estado.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.at != null) {
        const c = (S.cidades || []).find((x) => String(x.ibge) === b.dataset.at);
        const bts = [...el.estado.querySelectorAll('.pv-at')];
        const msg = (t) => { el.sum.textContent = t; const v = $('#pvEMsg'); if (v) v.textContent = t; };
        escolherCidade(c, {
          procurando(nome) { bts.forEach((x) => { x.disabled = true; }); msg(textoProcurandoCentro(nome)); },
          erro(m) { bts.forEach((x) => { x.disabled = false; }); msg(m); if (document.contains(b)) b.focus(); },
        });
        return;
      }
      const k = b.dataset.bt;
      if (k === 'prefiro' || k === 'escolher' || k === 'outra') abrirSeletor();
      else if (k === 'usar') tocarLocalizar();
      else if (k === 'tentar') { if (S.tela === 'erro') carregarLista(); else tocarLocalizar(); }
    });
    // Aviso no alto.
    $('#geoAvisoX')?.addEventListener('click', esconderAviso);
    // Mouse ou foco no item acende o pino do mesmo número.
    const idx = (e) => { const a = e.target.closest('[data-i]'); return a ? Number(a.dataset.i) : -1; };
    el.lista.addEventListener('mouseover', (e) => { const i = idx(e); if (i >= 0) acender(i, true); });
    el.lista.addEventListener('mouseout', (e) => { const i = idx(e); if (i >= 0 && !e.relatedTarget?.closest?.(`[data-i="${i}"]`)) acender(i, false); });
    el.lista.addEventListener('focusin', (e) => { const i = idx(e); if (i >= 0) acender(i, true); });
    el.lista.addEventListener('focusout', (e) => { const i = idx(e); if (i >= 0) acender(i, false); });
    // Mapa.
    el.mapOpen.addEventListener('click', abrirMapaCheio);
    $('#mapClose').addEventListener('click', () => fecharMapaCheio());
    el.mapMsg.addEventListener('click', (e) => {
      if (e.target.closest('#mapShow')) { M.quer = true; desenharMapa(); }
      else if (e.target.closest('#mapRetry')) desenharMapa();
    });
    addEventListener('popstate', () => { if (cheio) fecharMapaCheio(true); });
    document.addEventListener('keydown', (e) => {
      if (!cheio) return;
      if (e.key === 'Escape') { e.preventDefault(); fecharMapaCheio(); return; }
      if (e.key !== 'Tab') return;
      // Foco preso na janela do mapa.
      const f = focaveis(el.mapa);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      if (!el.mapa.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    const mudouLargura = () => { if (DESK.matches && cheio) fecharMapaCheio(); talvezMapa(); };
    if (DESK.addEventListener) DESK.addEventListener('change', mudouLargura); else DESK.addListener?.(mudouLargura);
    // Computador: o mapa vem quando a tela chega a 100 px da vista.
    if ('IntersectionObserver' in window) {
      // Depois que a tela chegou perto uma vez, vale (o mapa não some ao rolar para longe).
      const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { M.perto = true; io.disconnect(); talvezMapa(); } }, { rootMargin: '100px' });
      io.observe(sec);
    } else { M.perto = true; }
  }

  /* ======================= #nearCta ======================= */
  function cliqueNearCta(e) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault();
    if (!sec) return;
    // Rola até a tela sem mudar o endereço e põe o foco no título.
    sec.scrollIntoView({ behavior: reduzir ? 'auto' : 'smooth', block: 'start' });
    $('#reaisTitle')?.focus({ preventScroll: true });
    // Sem origem e sem bloqueio: este toque pede a localização.
    if (!origem() && S.geo.permissao !== 'denied') tocarLocalizar();
  }

  /* ======================= início ======================= */
  async function iniciar() {
    await null; // depois que iniciarPerto devolve a API: o aviso de origem usa a API
    local.apagar(CHAVES.antiga); // ponto de partida antigo (bairros de São Paulo)
    S.geo.suporte = 'geolocation' in navigator && window.isSecureContext !== false;
    const cidadeSalva = local.ler(CHAVES.cidade);
    const pedidoNaAba = sessao.ler(CHAVES.pedido) === '1';
    const recusas = local.ler(CHAVES.recusas);
    // Plano com cidade guardada não depende da permissão: abre direto, sem esperar.
    const rapido = geoPlan({ cidade: cidadeSalva, suporte: S.geo.suporte, hash: hashInicial });
    if (rapido.plano === 'cidade') { S.city = rapido.cidade; S.modo = 'cidade'; mudarOrigem(); }
    S.geo.permissao = S.geo.suporte ? await lerPermissao() : 'unknown';
    const plano = geoPlan({ cidade: cidadeSalva, permissao: S.geo.permissao, suporte: S.geo.suporte, hash: hashInicial, pedidoNaAba, recusas });
    S.plano = plano.plano;
    rotulos();
    switch (plano.plano) {
      case 'cidade':
        if (plano.posicao === 'silencio') localizar('distancia');
        break;
      case 'silencioso':
        setTela('buscando');
        esperarTopo(ESPERA_SILENCIO_MS);
        localizar('silencio');
        break;
      case 'pedir':
        setTela('aguardando');
        pedirAoAbrir();
        break;
      default:
        // esperar, bloqueada e sem-suporte: o 3D usa o exemplo na hora.
        soltarTopo();
        setTela(plano.tela);
        avisar();
    }
    // Atalhos das cidades nos cartões (e o seletor) assim que o banco responder.
    cidades().then(() => { if (!S.modo && estadoTela(S.tela)?.atalhos) desenharEstado(); }, () => {});
  }

  if (el) {
    ligar();
    $('#nearCta')?.addEventListener('click', cliqueNearCta);
    document.addEventListener('click', (e) => { if (e.target.closest('[data-city-open]')) { e.preventDefault(); abrirSeletor(); } });
    iniciar();
  }

  return {
    abrirSeletor,
    // Origem do topo (3D, lista leve, rótulos e fonte): 'perto', 'cidade', 'exemplo' ou null (esperando o pedido).
    topo() {
      if (S.modo === 'perto') return { modo: 'perto', lat: S.here.lat, lng: S.here.lng, regiao: S.regiao, regiaoFeita: S.regiaoFeita };
      if (S.modo === 'cidade') return { modo: 'cidade', lat: S.city.lat, lng: S.city.lng, cidade: S.city };
      return S.esperaTopo ? { modo: null } : { modo: 'exemplo' };
    },
    estado: () => ({ modo: S.modo, tela: S.tela, tipo: S.tipo, plano: S.plano, permissao: S.geo.permissao, pendente: S.geo.pendente }),
    rolarParaTela() { sec?.scrollIntoView(); },
  };
}

