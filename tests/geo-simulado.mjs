// Simulador da permissão e da localização do navegador para os testes de ponta a ponta (Playwright): troca
// navigator.permissions.query({name:'geolocation'}) e navigator.geolocation antes de qualquer script da página.
// Sem ele, o Chromium dos testes recusa a localização em ~6 ms sem mostrar o pedido (cai sempre em "naoapareceu").
// Usado no e2e-inicio, no e2e-a11y e no e2e-velocidade. Não é um teste: não roda sozinho.
//
// Uso:
//   import { simularGeo, PAULISTA } from './geo-simulado.mjs';
//   const geo = await simularGeo(context, { estado: 'prompt', resposta: 'permitir', atraso: 1000, pos: PAULISTA });
//   const page = await context.newPage(); await page.goto(...);
//   await geo.contagem(page)          → { estado, chamadas, pedidos }
//   await geo.mudar(page, 'granted')  → a pessoa mudou a permissão nas configurações (dispara "change")
//   await geo.responder(page, 'negar', { atraso: 0 }) → muda a resposta das próximas chamadas
//
// Opções (todas opcionais):
//   estado: 'prompt' (padrão), 'granted' ou 'denied' — a permissão ao abrir;
//   resposta: o que acontece em cada getCurrentPosition (depois de "atraso" ms):
//     'permitir' (padrão): com 'prompt', a pessoa permite (o estado vira 'granted' e dispara change) e a posição chega;
//     'negar': com 'prompt', a pessoa nega (vira 'denied', dispara change) e vem o erro 1;
//     'fechar': com 'prompt', a pessoa fecha a pergunta: erro 1 e o estado continua 'prompt' (com atraso 0 é o que o
//               Chromium dos testes faz sozinho; com 1.500 ms parece a pessoa fechando);
//     'demorar' e 'indisponivel': a pessoa permite (com 'prompt', vira 'granted') e vem o erro 3 ou o erro 2;
//     'nunca': ninguém responde (a chamada fica aberta até a permissão mudar nas configurações).
//     Com 'granted', 'permitir', 'negar' e 'fechar' entregam a posição (não há pergunta). Com 'denied', sempre erro 1
//     na hora, sem pergunta e sem atraso.
//   atraso: ms até a resposta (padrão 0). Usa o setTimeout da página, então segue o page.clock quando instalado.
//   pos: {lat, lng} entregue (padrão PAULISTA, que arredonda para -23.565, -46.652); precisao: accuracy em metros (25).
//   suporte: false tira o navigator.geolocation ('geolocation' in navigator fica false).
//   semPermissionsApi: true tira o navigator.permissions; 'erro' faz o query da localização falhar (TypeError).
//
// Na página:
//   window.__geo = { estado, resposta, atraso, chamadas, pedidos, abertas, log } — chamadas: getCurrentPosition e
//     watchPosition; pedidos: chamadas feitas com o estado em 'prompt' (quando o navegador mostraria a pergunta);
//     abertas: chamadas sem resposta; log: [{ estado, opcoes }] de cada chamada (só nesta página).
//   window.__geoMudar(estado): muda a permissão como nas configurações do navegador (dispara change; as chamadas
//     abertas recebem a resposta: 'granted' → posição; 'denied' → erro 1).
//   window.__geoResposta(resposta, { atraso, pos }): muda a resposta das próximas chamadas.
// Estado, resposta, atraso e contadores ficam no sessionStorage da aba (chave "__geo_simulado"): continuam depois de
// recarregar ou de abrir outra página na mesma aba. A posição nunca vai para o armazenamento (os testes conferem que
// nenhuma coordenada fica no aparelho): uma pos trocada pelo __geoResposta vale só até recarregar.
// Instale uma vez por contexto (ou por página: simularGeo(page, ...) também funciona); a 1ª instalação vale.

export const PAULISTA = Object.freeze({ lat: -23.56512, lng: -46.65234 });
export const ESTADOS = Object.freeze(['prompt', 'granted', 'denied']);
export const RESPOSTAS = Object.freeze(['permitir', 'negar', 'fechar', 'demorar', 'indisponivel', 'nunca']);
export const CHAVE = '__geo_simulado';

const posOk = (p) => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

// Confere e completa as opções (erro de digitação no teste quebra logo, com a mensagem certa).
export function opcoesGeo({ estado = 'prompt', resposta = 'permitir', atraso = 0, pos = PAULISTA, precisao = 25, suporte = true, semPermissionsApi = false } = {}) {
  if (!ESTADOS.includes(estado)) throw new Error(`simularGeo: estado "${estado}" (use ${ESTADOS.join(', ')})`);
  if (!RESPOSTAS.includes(resposta)) throw new Error(`simularGeo: resposta "${resposta}" (use ${RESPOSTAS.join(', ')})`);
  if (!(Number.isFinite(atraso) && atraso >= 0)) throw new Error(`simularGeo: atraso "${atraso}" (ms, 0 ou mais)`);
  if (!posOk(pos)) throw new Error('simularGeo: pos precisa de lat e lng');
  if (!(Number.isFinite(precisao) && precisao > 0)) throw new Error('simularGeo: precisao em metros');
  if (![true, false, 'erro'].includes(semPermissionsApi)) throw new Error("simularGeo: semPermissionsApi é true, false ou 'erro'");
  return { estado, resposta, atraso, pos: { lat: pos.lat, lng: pos.lng }, precisao, suporte: suporte !== false, semPermissionsApi };
}

// Roda dentro da página, antes dos scripts dela (addInitScript): nada de fora desta função existe lá.
function instalarGeo(cfg) {
  if (window.__geo) return;
  const CHAVE = '__geo_simulado';
  const ESTADOS = ['prompt', 'granted', 'denied'];
  const RESPOSTAS = ['permitir', 'negar', 'fechar', 'demorar', 'indisponivel', 'nunca'];
  const MSG = { 1: 'User denied Geolocation', 2: 'Position update is unavailable', 3: 'Timeout expired' };
  let salvo = null;
  try { salvo = JSON.parse(sessionStorage.getItem(CHAVE) || 'null'); } catch { salvo = null; }
  const st = {
    estado: ESTADOS.includes(salvo?.estado) ? salvo.estado : cfg.estado,
    resposta: RESPOSTAS.includes(salvo?.resposta) ? salvo.resposta : cfg.resposta,
    atraso: Number.isFinite(salvo?.atraso) && salvo.atraso >= 0 ? salvo.atraso : cfg.atraso,
    chamadas: Number.isInteger(salvo?.chamadas) ? salvo.chamadas : 0,
    pedidos: Number.isInteger(salvo?.pedidos) ? salvo.pedidos : 0,
  };
  let pos = cfg.pos;
  const abertas = []; // chamadas com resposta 'nunca', à espera de uma mudança nas configurações
  const geo = { log: [] };
  const espelho = () => Object.assign(geo, st, { abertas: abertas.length });
  espelho();
  window.__geo = geo;
  function salvar() {
    espelho();
    try { sessionStorage.setItem(CHAVE, JSON.stringify(st)); } catch { /* sem armazenamento */ }
  }

  const vivos = new Set();
  class StatusGeo extends EventTarget {
    constructor() { super(); this.onchange = null; }
    get name() { return 'geolocation'; }
    get state() { return st.estado; }
  }
  const posicao = () => ({
    coords: { latitude: pos.lat, longitude: pos.lng, accuracy: cfg.precisao, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    timestamp: Date.now(),
  });
  const erro = (code) => ({ code, message: MSG[code], PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  const entregar = (ok) => ok(posicao());
  const falhar = (fail, code) => { if (typeof fail === 'function') fail(erro(code)); };

  function mudar(novo) {
    if (!ESTADOS.includes(novo)) throw new TypeError(`__geoMudar: estado "${novo}"`);
    if (novo === st.estado) return st.estado;
    st.estado = novo;
    salvar();
    for (const s of vivos) {
      const ev = new Event('change');
      s.dispatchEvent(ev);
      if (typeof s.onchange === 'function') {
        try { s.onchange.call(s, ev); } catch (e) { queueMicrotask(() => { throw e; }); }
      }
    }
    // A mudança responde as chamadas que ninguém respondeu ('nunca').
    if (novo !== 'prompt' && abertas.length) {
      const lista = abertas.splice(0);
      espelho();
      for (const [ok, fail] of lista) setTimeout(() => (novo === 'granted' ? entregar(ok) : falhar(fail, 1)), 0);
    }
    return st.estado;
  }
  window.__geoMudar = mudar;
  window.__geoResposta = (resposta, extra = {}) => {
    if (!RESPOSTAS.includes(resposta)) throw new TypeError(`__geoResposta: resposta "${resposta}"`);
    st.resposta = resposta;
    if (extra && Number.isFinite(extra.atraso) && extra.atraso >= 0) st.atraso = extra.atraso;
    if (extra?.pos && Number.isFinite(extra.pos.lat) && Number.isFinite(extra.pos.lng)) pos = { lat: extra.pos.lat, lng: extra.pos.lng };
    salvar();
    return { resposta: st.resposta, atraso: st.atraso };
  };

  if (cfg.semPermissionsApi === true) {
    try { delete Navigator.prototype.permissions; } catch { /* ignora */ }
  } else if (window.Permissions?.prototype?.query) {
    const original = Permissions.prototype.query;
    Permissions.prototype.query = function query(desc) {
      if (desc && desc.name === 'geolocation') {
        if (cfg.semPermissionsApi === 'erro') return Promise.reject(new TypeError("Failed to execute 'query' on 'Permissions': simulado"));
        const s = new StatusGeo();
        vivos.add(s);
        return Promise.resolve(s);
      }
      return original.call(this, desc);
    };
  }

  if (!cfg.suporte) {
    try { delete Navigator.prototype.geolocation; } catch { /* ignora */ }
    return;
  }
  const G = window.Geolocation?.prototype;
  if (!G) return;
  let watchId = 0;
  G.getCurrentPosition = function getCurrentPosition(ok, fail, opcoes) {
    if (typeof ok !== 'function') throw new TypeError("Failed to execute 'getCurrentPosition' on 'Geolocation': parameter 1 is not of type 'Function'.");
    const antes = st.estado, resposta = st.resposta;
    st.chamadas += 1;
    if (antes === 'prompt') st.pedidos += 1;
    geo.log.push({ estado: antes, opcoes: opcoes && typeof opcoes === 'object' ? { enableHighAccuracy: opcoes.enableHighAccuracy, timeout: opcoes.timeout, maximumAge: opcoes.maximumAge } : null });
    salvar();
    if (antes === 'denied') { setTimeout(() => falhar(fail, 1), 0); return; }
    if (resposta === 'nunca') { abertas.push([ok, fail]); espelho(); return; }
    setTimeout(() => {
      // Responde com o estado de agora: a permissão pode ter mudado nas configurações enquanto esperava.
      const agora = st.estado;
      if (agora === 'denied') return falhar(fail, 1);
      if (agora === 'prompt') {
        if (resposta === 'fechar') return falhar(fail, 1);
        if (resposta === 'negar') { mudar('denied'); return falhar(fail, 1); }
        mudar('granted'); // permitir, demorar e indisponivel: a pessoa permitiu
      }
      if (resposta === 'demorar') return falhar(fail, 3);
      if (resposta === 'indisponivel') return falhar(fail, 2);
      return entregar(ok);
    }, st.atraso);
  };
  G.watchPosition = function watchPosition(ok, fail, opcoes) {
    this.getCurrentPosition(ok, fail, opcoes);
    watchId += 1;
    return watchId;
  };
  G.clearWatch = function clearWatch() {};
}

// Lê os contadores da página: { estado, resposta, atraso, chamadas, pedidos, abertas, log } (null sem o simulador).
export const lerGeo = (page) => page.evaluate(() => (window.__geo ? JSON.parse(JSON.stringify(window.__geo)) : null));
export const contagemGeo = (page) => page.evaluate(() => {
  const g = window.__geo;
  return g ? { estado: g.estado, chamadas: g.chamadas, pedidos: g.pedidos } : null;
});
export function mudarGeo(page, estado) {
  if (!ESTADOS.includes(estado)) throw new Error(`mudarGeo: estado "${estado}" (use ${ESTADOS.join(', ')})`);
  return page.evaluate((e) => window.__geoMudar(e), estado);
}
export function responderGeo(page, resposta, extra = {}) {
  if (!RESPOSTAS.includes(resposta)) throw new Error(`responderGeo: resposta "${resposta}" (use ${RESPOSTAS.join(', ')})`);
  return page.evaluate(([r, x]) => window.__geoResposta(r, x), [resposta, extra]);
}

// Instala o simulador num BrowserContext (ou numa Page) do Playwright. Chame antes de abrir a página.
export async function simularGeo(context, opcoes = {}) {
  const cfg = opcoesGeo(opcoes);
  await context.addInitScript(instalarGeo, cfg);
  return {
    opcoes: cfg,
    ler: lerGeo,
    contagem: contagemGeo,
    mudar: mudarGeo,
    responder: responderGeo,
  };
}
