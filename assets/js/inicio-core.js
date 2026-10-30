// Regras puras da tela "Clínicas perto de você" da página inicial: o plano ao abrir (pedido de localização), a leitura
// dos erros do navegador, a busca do seletor de cidade, a região da pessoa, as distâncias, o raio da busca, os
// parâmetros das chamadas ao banco e os textos da tela. Não mexe na página nem no aparelho (sem DOM e sem
// armazenamento), então também roda no Node: tests/inicio-core.test.mjs.
// A posição da pessoa chega aqui arredondada (round3, cerca de 110 m) e nada daqui a grava. Só dado real: nenhum
// texto daqui inventa número, preço, nota ou horário.

/* ======================= constantes ======================= */
// Pedido de localização: precisão baixa basta (a posição é arredondada), até 15 s, e serve uma posição de até 5 min.
export const GEO_OPCOES = Object.freeze({ enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
// Erro 1 (sem permissão) em menos de 800 ms: o navegador recusou sem mostrar a pergunta.
export const RAPIDO_MS = 800;
// O 3D e a lista leve esperam a resposta: até 8 s com o pedido aberto, até 3 s com a permissão já dada.
export const ESPERA_PEDIDO_MS = 8000;
export const ESPERA_SILENCIO_MS = 3000;
// Depois de 2 recusas neste aparelho, o site não pede mais sozinho.
export const MAX_RECUSAS = 2;
// Raio da lista: 2 km; com menos de 3 locais na aba, 10 km e depois 50 km.
export const RAIOS = Object.freeze([2000, 10000, 50000]);
export const MIN_LOCAIS = 3;
export const LIMITE_LISTA = 10; // itens por aba
export const LISTA_CELULAR = 6; // o celular mostra 6 e o botão "Mostrar mais"
export const LIMITE_PARCEIROS = 100;
export const LIMITE_PONTOS = 3000;
export const PONTOS_SELECT = 'cnes,name,kind,lat,lng,distance_m,total';
// No modo cidade, a distância até a pessoa só aparece nos itens quando o centro fica a até 50 km dela.
export const PERTO_KM = 50;
// "Sua região" só é afirmada com o local mais perto a até 3 km e 3 dos 5 mais perto na mesma cidade.
export const REGIAO_M = 3000;
const REGIAO_AMOSTRA = 5, REGIAO_VOTOS = 3;
export const MAX_CIDADES = 50; // opções da busca do seletor
export const N_ATALHOS = 12; // "Cidades com mais locais"
export const MAX_RECENTES = 3;
// Chaves do aparelho. Nenhuma guarda a posição, a região descoberta ou a lista.
export const CHAVES = Object.freeze({
  cidade: 'imed_cidade', recentes: 'imed_cidades_recentes', recusas: 'imed_geo_recusas', pedido: 'imed_geo_pedido', antiga: 'imed_place',
});
export const UFS = Object.freeze(['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR',
  'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']);
const UF_SET = new Set(UFS);
export const ufValida = (uf) => typeof uf === 'string' && UF_SET.has(uf);

// Tipos de local, na ordem das abas e da legenda. Cores escuras: o número branco do círculo tem contraste de pelo
// menos 4,5:1. f: feminino; um/varios: nome no singular e no plural (para os textos).
export const TIPOS = Object.freeze({
  imagem: Object.freeze({ n: 'Diagnóstico por imagem', aba: 'Imagem', cor: '#0E7C9C', f: false, um: 'local de diagnóstico por imagem', varios: 'locais de diagnóstico por imagem' }),
  laboratorio: Object.freeze({ n: 'Laboratório', aba: 'Laboratórios', cor: '#6C4BD8', f: false, um: 'laboratório', varios: 'laboratórios' }),
  clinica: Object.freeze({ n: 'Clínica', aba: 'Clínicas', cor: '#137A44', f: true, um: 'clínica', varios: 'clínicas' }),
  hospital: Object.freeze({ n: 'Hospital', aba: 'Hospitais', cor: '#BF3B20', f: false, um: 'hospital', varios: 'hospitais' }),
});
export const ORDEM_TIPOS = Object.freeze(['imagem', 'laboratorio', 'clinica', 'hospital']);
// Abas da tela: [tipo, rótulo]; '' é "Todos".
export const ABAS = Object.freeze([['', 'Todos'], ...ORDEM_TIPOS.map((k) => [k, TIPOS[k].aba])]);
// (Object.hasOwn só existe do iOS 15.4 em diante; a página inicial abre em todo iPhone com iOS 15.)
export const tipoValido = (t) => typeof t === 'string' && Object.prototype.hasOwnProperty.call(TIPOS, t);
const TODOS = Object.freeze({ f: false, um: 'local', varios: 'locais' });
const nomeDoTipo = (t) => (tipoValido(t) ? TIPOS[t] : TODOS);

/* ======================= números e posição ======================= */
const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const KM = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
// 6548 → "6.548".
export const fmtInt = (n) => INT.format(n);
// Raio da busca: 2000 → "2 km", 10000 → "10 km". (Distância de um local: fmtDist.)
export const fmtKm = (m) => `${KM.format(m / 1000)} km`;
// Número que veio do banco como número ou texto; outra coisa vira NaN.
const numero = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

// Três casas decimais (cerca de 110 m): a mesma conta do geo-core (roundCoord).
export const round3 = (v) => Math.round(v * 1000) / 1000;
export const posValida = (p) => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
// Posição do navegador (GeolocationPosition, suas coords ou {lat, lng}) → {lat, lng} arredondados, ou null.
export function aproximar(p) {
  const c = p?.coords ?? p;
  const lat = typeof c?.latitude === 'number' ? c.latitude : c?.lat;
  const lng = typeof c?.longitude === 'number' ? c.longitude : c?.lng;
  const o = { lat, lng };
  return posValida(o) ? { lat: round3(lat), lng: round3(lng) } : null;
}

/* ======================= distâncias ======================= */
// Distância em metros na esfera: exatamente a conta do geo-core (haversine), para os números baterem com a busca.
export function metrosEntre(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// A mesma distância em km (sem arredondar). Para escrever, use fmtDist(metrosEntre(a, b)).
export const kmEntre = (a, b) => metrosEntre(a, b) / 1000;
// Igual ao geo-core.formatDistance: "420 m", "1,2 km", "12 km".
export function fmtDist(m) {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}
// Distância do local até a origem: a do banco (a mesma conta que decide o raio); sem ela, a conta na esfera.
export function distanciaDe(r, origem = null) {
  const n = numero(r?.distance_m);
  if (Number.isFinite(n) && n >= 0) return Math.round(n);
  return posValida(origem) && Number.isFinite(r?.lat) && Number.isFinite(r?.lng) ? Math.round(metrosEntre(origem, r)) : null;
}
// Local do CNES com a posição achada pelo endereço (não pelo cadastro): a distância leva "~".
export const ehAproximado = (r) => r?.partner !== true && r?.location_source === 'endereco';
export const textoDistancia = (m, aprox = false) => `${aprox ? '~' : ''}${fmtDist(m)}`;
// "fica a 84 km de você" (recentes do seletor) e "Campinas fica a 84 km de você." (linha da cidade).
export const textoFicaA = (m) => `fica a ${fmtDist(m)} de você`;
export const textoFica = (nome, m) => `${nome} ${textoFicaA(m)}.`;
// Linha a mais de cada item no modo cidade: "a 9 km de você".
export const textoAteVoce = (m, aprox = false) => `a ${textoDistancia(m, aprox)} de você`;
// No modo cidade, os itens mostram a distância até a pessoa só com o centro a até 50 km dela.
export const distanciaNosItens = (here, cidade) => posValida(here) && posValida(cidade) && kmEntre(here, cidade) <= PERTO_KM;

/* ======================= raio da busca ======================= */
// Próximo raio da lista: 2000 → 10000 → 50000 → null. Com 3 locais ou mais na aba, não amplia (null).
export function proximoRaio(raio, encontrados = 0) {
  if (Number(encontrados) >= MIN_LOCAIS) return null;
  const r = Number(raio);
  return RAIOS.find((x) => x > r) ?? null;
}

/* ======================= cidades ======================= */
// Cidades que levam "do" (do Rio de Janeiro); as outras, "de". Mesma regra de confianca.js.
const DO_CIDADE = new Set(['Rio de Janeiro', 'Rio Grande', 'Recife', 'Crato', 'Guarujá']);
export const deCidade = (name) => `${DO_CIDADE.has(String(name)) ? 'do' : 'de'} ${name}`;
// Mesma regra de scripts/gerar-cidades.mjs (slugify), que cria as pastas cidades/<uf>/<slug>/.
export const citySlug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const cityUrl = (c) => `cidades/${String(c.uf).toLowerCase()}/${citySlug(c.name)}/`;
// Texto para comparar nomes: sem acento e minúsculo; apóstrofo, hífen e pontuação viram espaço.
export const dobra = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

const digitos = (v) => (typeof v === 'number' ? (Number.isSafeInteger(v) ? String(v) : '') : typeof v === 'string' ? v.trim() : '');
// Código do município com 6 dígitos (o city_code do CNES), dele mesmo ou do IBGE de 7 dígitos (o último é o dígito
// verificador): 3550308 → 355030, '355030' → 355030. Número ou texto; outra coisa → null.
export function codigoMunicipio(v) {
  const s = digitos(v);
  if (/^[1-9]\d{6}$/.test(s)) return Math.floor(Number(s) / 10);
  if (/^[1-9]\d{5}$/.test(s)) return Number(s);
  return null;
}
const ibge7 = (v) => { const s = digitos(v); return /^[1-9]\d{6}$/.test(s) ? Number(s) : null; };

// Cidade guardada no aparelho (imed_cidade, recentes): vale só com nome, UF de verdade (2 letras) e centro com lat/lng
// finitos. Devolve {ibge, name, uf, lat, lng} (ibge null se faltar; centro com 3 casas) ou null. Aceita o texto JSON.
export function cidadeGuardada(v) {
  let c = v;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch { return null; } }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const name = typeof c.name === 'string' ? c.name.trim() : '';
  if (!name || name.length > 100 || !ufValida(c.uf) || !posValida({ lat: c.lat, lng: c.lng })) return null;
  return { ibge: ibge7(c.ibge), name, uf: c.uf, lat: round3(c.lat), lng: round3(c.lng) };
}
// Mesma cidade: pelo código do município (IBGE de 7 dígitos ou city_code de 6); sem ele, pelo nome e pela UF.
export function mesmaCidade(a, b) {
  if (!a || !b) return false;
  const ca = codigoMunicipio(a.ibge) ?? codigoMunicipio(a.code), cb = codigoMunicipio(b.ibge) ?? codigoMunicipio(b.code);
  if (ca != null && cb != null) return ca === cb;
  return !!dobra(a.name) && dobra(a.name) === dobra(b.name) && String(a.uf ?? '').toUpperCase() === String(b.uf ?? '').toUpperCase();
}
// Recentes (imed_cidades_recentes): até 3 cidades válidas, sem repetir, a mais nova primeiro.
export function lerRecentes(v) {
  let lista = v;
  if (typeof lista === 'string') { try { lista = JSON.parse(lista); } catch { return []; } }
  const out = [];
  for (const x of Array.isArray(lista) ? lista : []) {
    const c = cidadeGuardada(x);
    if (c && !out.some((y) => mesmaCidade(y, c))) out.push(c);
    if (out.length >= MAX_RECENTES) break;
  }
  return out;
}
export function comRecente(lista, cidade) {
  const c = cidadeGuardada(cidade), atual = lerRecentes(lista);
  return c ? [c, ...atual.filter((x) => !mesmaCidade(x, c))].slice(0, MAX_RECENTES) : atual;
}
// Centro já guardado da cidade escolhida (nas recentes ou na imed_cidade): evita geocodificar de novo.
// fontes: listas de cidades ou cidades soltas, já lidas do aparelho.
export function centroGuardado(escolha, ...fontes) {
  for (const f of fontes) {
    for (const x of Array.isArray(f) ? f : [f]) {
      const c = cidadeGuardada(x);
      if (c && mesmaCidade(c, escolha)) return c;
    }
  }
  return null;
}

// Cidade que pode aparecer no seletor: nome, UF de verdade e pelo menos um local no cadastro (imported_cities).
const listavel = (r) => !!r && typeof r === 'object' && typeof r.name === 'string' && r.name.trim() !== '' && ufValida(r.uf) && numero(r.total) > 0;
const ordemCidade = (a, b) => numero(b.total) - numero(a.total) || a.name.localeCompare(b.name, 'pt-BR') || a.uf.localeCompare(b.uf);
const NOMES = new WeakMap();
function nomesDe(r) {
  let n = NOMES.get(r);
  if (!n) { const s = dobra(r.name); n = { s, c: s.replace(/ /g, '') }; NOMES.set(r, n); }
  return n;
}
// 0: o nome começa com o texto; 1: uma palavra começa com o texto; 2: o nome contém o texto. Também compara sem os
// espaços ("jiparana", "barbara doeste"; no "contém", só com 4 letras ou mais, para "sp" não achar "dos Pinhais").
// Texto vazio (só a UF foi digitada, como "sp"): 1,5, depois dos nomes que começam com o texto.
function nivel(r, q) {
  if (!q) return 1.5;
  const { s, c } = nomesDe(r), qc = q.replace(/ /g, '');
  if (s.startsWith(q) || c.startsWith(qc)) return 0;
  if (` ${s}`.includes(` ${q}`)) return 1;
  if (s.includes(q) || (qc.length >= 4 && c.includes(qc))) return 2;
  return Infinity;
}
// Busca da cidade no seletor. Ignora acento, maiúscula, apóstrofo, hífen e pontuação. "Campinas - SP" e
// "campinas sp" filtram pela UF (o último pedaço de 2 letras que for UF da lista); o texto inteiro também vale como
// nome, para "porto al" continuar achando Porto Alegre enquanto a pessoa digita. Ordem: nível (acima), mais locais,
// nome (pt-BR). Só cidades com total > 0 e UF válida. Devolve {lista: até max linhas (as originais), total achado}.
export function matchCities(rows, q, max = MAX_CIDADES) {
  const texto = dobra(q);
  if (!texto) return { lista: [], total: 0 };
  const validas = (Array.isArray(rows) ? rows : []).filter(listavel);
  const ufs = new Set(validas.map((r) => r.uf));
  const partes = texto.split(' ');
  let uf = '', resto = texto;
  for (let i = partes.length - 1; i >= 0; i -= 1) {
    if (partes[i].length === 2 && ufs.has(partes[i].toUpperCase())) {
      uf = partes[i].toUpperCase();
      resto = partes.filter((_, j) => j !== i).join(' ');
      break;
    }
  }
  const achadas = [];
  for (const r of validas) {
    const n = Math.min(nivel(r, texto), uf && r.uf === uf ? nivel(r, resto) : Infinity);
    if (n !== Infinity) achadas.push([n, r]);
  }
  achadas.sort(([na, a], [nb, b]) => na - nb || ordemCidade(a, b));
  const lim = Math.max(0, Math.floor(Number(max)) || 0);
  return { lista: achadas.slice(0, lim).map(([, r]) => r), total: achadas.length };
}
// Atalhos "Cidades com mais locais": as 12 com mais locais no cadastro, ordenadas no aparelho.
export const cidadesComMaisLocais = (rows, n = N_ATALHOS) => (Array.isArray(rows) ? rows : []).filter(listavel).sort(ordemCidade).slice(0, n);
// "6.548 locais", "1 local"; com oficial: "1.120 locais no cadastro oficial".
export const textoLocais = (n, oficial = false) => `${fmtInt(n)} ${Number(n) === 1 ? 'local' : 'locais'}${oficial ? ' no cadastro oficial' : ''}`;
// Contagem da busca (#cityHint).
export function textoContagemCidades(total, mostradas = Math.min(Number(total) || 0, MAX_CIDADES)) {
  const t = Math.max(0, Math.floor(Number(total)) || 0);
  if (!t) return 'Nenhuma cidade com esse nome no IMED ainda.';
  if (t > mostradas) return `Mostrando ${fmtInt(mostradas)} de ${fmtInt(t)}. Continue digitando.`;
  return t === 1 ? '1 cidade encontrada' : `${fmtInt(t)} cidades encontradas`;
}

// Região da pessoa ("Sua região: São Paulo - SP") pelas linhas do CNES da lista (nearby_establishments, com city, uf e
// city_code). Só afirma com o local mais perto a até 3 km e 3 dos 5 mais perto na mesma cidade; com menos de 3 linhas,
// null. Parceiros não contam. cidades (imported_cities, opcional) dá o IBGE de 7 dígitos: floor(ibge/10) = city_code.
// Devolve {code, ibge (ou null), name, uf} ou null.
export function cityOfRows(rows, cidades = null) {
  const perto = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const code = r && r.partner !== true ? codigoMunicipio(r.city_code) : null, d = numero(r?.distance_m);
    if (code != null && Number.isFinite(d) && d >= 0) perto.push({ r, d, code });
  }
  perto.sort((a, b) => a.d - b.d);
  const cinco = perto.slice(0, REGIAO_AMOSTRA);
  if (cinco.length < REGIAO_VOTOS || cinco[0].d > REGIAO_M) return null;
  const votos = new Map();
  for (const x of cinco) votos.set(x.code, (votos.get(x.code) || 0) + 1);
  const code = [...votos].find(([, n]) => n >= REGIAO_VOTOS)?.[0];
  if (code == null) return null;
  const doBanco = (Array.isArray(cidades) ? cidades : []).find((c) => c && codigoMunicipio(c.ibge) === code && ibge7(c.ibge) != null);
  if (doBanco && typeof doBanco.name === 'string' && doBanco.name.trim() && ufValida(doBanco.uf)) {
    return { code, ibge: ibge7(doBanco.ibge), name: doBanco.name.trim(), uf: doBanco.uf };
  }
  const linha = cinco.find((x) => x.code === code && typeof x.r.city === 'string' && x.r.city.trim() && ufValida(String(x.r.uf ?? '').toUpperCase()));
  return linha ? { code, ibge: null, name: linha.r.city.trim(), uf: String(linha.r.uf).toUpperCase() } : null;
}

/* ======================= chamadas ao banco ======================= */
// Sempre com a posição arredondada. p_kind só quando há aba.
const ponto = (o) => ({ p_lat: round3(o.lat), p_lng: round3(o.lng) });
export const argsLista = (origem, raio = RAIOS[0], tipo = '') => ({ ...ponto(origem), p_radius_m: raio, p_limit: LIMITE_LISTA, ...(tipoValido(tipo) ? { p_kind: tipo } : {}) });
export const argsParceiros = (origem, raio = RAIOS[0]) => ({ ...ponto(origem), p_radius_m: raio, p_include_demo: false, p_limit: LIMITE_PARCEIROS });
export const argsPontos = (origem, raio = RAIOS[0]) => ({ ...ponto(origem), p_radius_m: raio, p_limit: LIMITE_PONTOS });
// Chave do cache em memória: 'lat,lng|tipo|raio' (listas) ou 'lat,lng|raio' (parceiros e pontos).
export const chaveCache = (origem, ...partes) => [`${round3(origem.lat)},${round3(origem.lng)}`, ...partes].join('|');
// Total da área que o banco repete em cada linha (coluna total). Sem ele: null.
export function totalDe(rows) {
  const n = numero(Array.isArray(rows) ? rows[0]?.total : undefined);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/* ======================= lista e mapa ======================= */
const temPosicao = (r) => !!r && typeof r.name === 'string' && r.name.trim() !== '' && Number.isFinite(r.lat) && Number.isFinite(r.lng);
// Lista da aba: CNES + parceiros publicados, misturados só pela distância (empate: parceiro, depois o nome), até 10.
// Parceiros ganham key 'imed:<id>' e partner true; CNES, key 'cnes:<cnes>' e partner false.
export function montarLista(cnes, parceiros = [], { tipo = '', limite = LIMITE_LISTA, origem = null } = {}) {
  const doTipo = (r) => !tipoValido(tipo) || r.kind === tipo;
  const par = (Array.isArray(parceiros) ? parceiros : []).filter((r) => temPosicao(r) && doTipo(r))
    .map((r) => ({ ...r, uf: r.uf || r.state, key: `imed:${r.id}`, partner: true, distance_m: distanciaDe(r, origem) }));
  const est = (Array.isArray(cnes) ? cnes : []).filter((r) => temPosicao(r) && doTipo(r))
    .map((r) => ({ ...r, key: `cnes:${r.cnes}`, partner: false, distance_m: distanciaDe(r, origem) }));
  return [...par, ...est].sort((a, b) => {
    const da = a.distance_m ?? Infinity, db = b.distance_m ?? Infinity;
    if (da !== db) return da < db ? -1 : 1;
    if (a.partner !== b.partner) return a.partner ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR');
  }).slice(0, limite);
}
// Linha pequena do item: "Parceiro do IMED · Diagnóstico por imagem · Bela Vista".
export const linhaTipo = (r) => `${r?.partner ? 'Parceiro do IMED · ' : ''}${(tipoValido(r?.kind) ? TIPOS[r.kind] : TIPOS.clinica).n}${r?.neighborhood ? ` · ${r.neighborhood}` : ''}`;
// Selos, só quando o dado existe: "Aberto 24 horas" e "Atende SUS" (SUS só do CNES).
export const selos = (r) => [r?.open_24h === true ? 'Aberto 24 horas' : '', r?.sus === true && r?.partner !== true ? 'Atende SUS' : ''].filter(Boolean);
// Legenda do mapa (#realStats): os 4 números reais por tipo (pontos + parceiros), com "+" quando o total da área
// passa dos pontos recebidos.
export function legendaTipos(pontos, parceiros = [], total = null) {
  const pts = Array.isArray(pontos) ? pontos : [], par = Array.isArray(parceiros) ? parceiros : [];
  const t = numero(total), mais = Number.isFinite(t) && t > pts.length;
  return ORDEM_TIPOS.map((k) => {
    const n = pts.filter((r) => r?.kind === k).length + par.filter((r) => r?.kind === k).length;
    return { tipo: k, nome: TIPOS[k].aba, n, texto: `${fmtInt(n)}${mais ? '+' : ''}` };
  });
}
export const textoLegenda = (raio = RAIOS[0]) => `Em até ${fmtKm(raio)}`;
// Título da janela do mapa no celular: "Mapa · São Paulo - SP · Laboratórios".
export const tituloMapa = (onde, tipo = '') => `Mapa · ${onde}${tipoValido(tipo) ? ` · ${TIPOS[tipo].aba}` : ''}`;
export const rotuloPontoOrigem = (modo, cidade = null) => (modo === 'cidade' && cidade?.name ? `Centro ${deCidade(cidade.name)}` : 'Você (aproximado)');
// Final escondido da distância para o leitor de tela: " de você" ou " do centro de Campinas".
export const sufixoOrigem = (modo, cidade = null) => (modo === 'cidade' && cidade?.name ? ` do centro ${deCidade(cidade.name)}` : ' de você');
export const textoMostrarMais = (n) => `Mostrar mais ${fmtInt(n)}`;

/* ======================= textos ======================= */
// "Como liberar": o passo a passo de cada aparelho (computador, Android e iPhone).
const AJUDA_PASSOS = 'Para liberar: no computador, clique no ícone ao lado do endereço do site (cadeado ou ajustes) e permita a Localização. No Android, toque nesse ícone > Permissões > Localização. No iPhone, toque em aA ao lado do endereço > Ajustes do Site > Localização > Permitir.';
export const TEXTOS = Object.freeze({
  kicker: 'Cadastro oficial · Ministério da Saúde',
  titulo: 'Clínicas perto de você',
  subtitulo: 'Clínicas, laboratórios, centros de imagem e hospitais do cadastro oficial (CNES) e as clínicas parceiras do IMED, do mais perto para o mais longe.',
  buscaCompleta: 'Busca completa',
  todasCidades: 'Todas as cidades',
  fonte: 'Endereços do CNES, base pública do Ministério da Saúde. O IMED é um serviço privado, sem vínculo com o governo ou o SUS. Valores e horários são confirmados com o local.',
  trocar: 'Trocar',
  trocarEscondido: ': trocar a cidade',
  usarLocalizacao: 'Usar minha localização',
  bloqueadaComoLiberar: 'Localização bloqueada: como liberar',
  grupoAbas: 'Tipo de local',
  verNoMapa: 'Ver no mapa',
  voltarLista: 'Voltar para a lista',
  verTodosTipos: 'Ver todos os tipos',
  mostrarMapa: 'Mostrar o mapa',
  tentar: 'Tentar de novo',
  aviso: 'Para mostrar as clínicas mais perto, o IMED pede a sua localização. Usamos só a região aproximada, sem o ponto exato, e não gravamos.',
  avisoNaoApareceu: 'Não apareceu a pergunta? Toque no ícone de localização ao lado do endereço do site ou escolha a cidade.',
  avisoPrefiro: 'Prefiro escolher a cidade',
  avisoSaibaMais: 'Saiba mais',
  avisoFechar: 'Fechar aviso',
  statusPediu: 'O IMED pediu sua localização para mostrar as clínicas mais perto.',
  // "Pronto!" vai junto do resumo da 1ª lista (#pvSum), numa frase só para o leitor de tela.
  statusPronto: 'Pronto!',
  statusSem: 'Sem a sua localização. Escolha a cidade para ver os locais.',
  comoLiberar: 'Como liberar',
  semInternet: 'Você está sem internet. Quando a conexão voltar, tente de novo.',
  verMais: 'Ver mais na busca completa, com filtros',
  atalhos: 'Cidades com mais locais',
  mapaDescricao: 'Mapa com os locais do cadastro oficial perto do ponto escolhido. Os números são os mesmos da lista; pelo teclado ou leitor de tela, use a lista.',
  mapaSemOrigem: 'O mapa aparece quando você permite a localização ou escolhe a cidade.',
  mapaFalhou: 'O mapa não carregou. A lista continua funcionando.',
  mapaEconomia: 'Para gastar menos internet, o mapa não abre sozinho.',
  nearCta: 'Encontrar clínicas perto de mim',
  nearCtaPadrao: 'Clínicas, laboratórios e hospitais reais, no mapa',
  seletorTitulo: 'Escolha a cidade',
  seletorGeo: 'Usar minha localização atual',
  // O ícone ao lado do endereço é o cadeado em alguns navegadores e o de ajustes no Chrome (desde 2023).
  seletorAjuda: `${AJUDA_PASSOS} Depois, toque em Usar minha localização.`, // na tela de toque; textoAjuda(false): "clique"
  seletorRotulo: 'Cidade',
  seletorExemplo: 'Digite o nome da cidade',
  seletorDica: 'Use as setas para escolher e Enter para confirmar.',
  seletorLista: 'Cidades com o cadastro oficial no IMED',
  seletorRecentes: 'Recentes',
  seletorMaisLocais: 'Cidades com mais locais',
  seletorNaoAchou: 'Não achou sua cidade? Busque pelo CEP ou endereço',
  seletorCarregando: 'Carregando as cidades…',
  seletorErroLista: 'Não foi possível carregar a lista de cidades agora.',
  seletorErroCentro: 'Não foi possível achar o centro desta cidade agora. Tente de novo ou use a busca completa.',
});
// Endereços usados pela tela.
export const LINKS = Object.freeze({
  buscaCompleta: 'perto.html', pertoDeMim: 'perto.html?usar=localizacao', cidades: 'cidades/', privacidade: 'privacidade.html#localizacao', naoAchou: 'perto.html',
});
// Botões dos cartões de estado. "tentar": de novo a localização (demorou, indisponível) ou a lista (erro).
export const BOTOES = Object.freeze({
  prefiro: 'Prefiro escolher a cidade', escolher: 'Escolher minha cidade', usar: 'Usar minha localização', tentar: 'Tentar de novo',
  busca: 'Abrir a busca completa', outra: 'Escolher outra cidade',
});
const PEDIR_DE_NOVO = 'Veja se a localização do aparelho está ligada e tente de novo, ou escolha a cidade.';
// Verbo do aparelho: "toque" (tela de toque) ou "clique" (mouse).
export const verbo = (toque = true) => (toque ? 'toque' : 'clique');
const maiuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// O ícone ao lado do endereço do site: o cadeado em alguns navegadores, o de ajustes no Chrome (desde 2023).
const ICONE_SITE = 'no ícone ao lado do endereço do site (cadeado ou ajustes)';
const SEM_INTERNET = 'Você está sem internet';
// A ajuda do "Como liberar" com o verbo do aparelho no fim: "Depois, clique em Usar minha localização." no computador.
export const textoAjuda = (toque = true) => `${AJUDA_PASSOS} Depois, ${verbo(toque)} em Usar minha localização.`;
// Cartão de cada estado sem lista (#reais[data-estado]): título, texto, botões (chaves de BOTOES), se mostra os
// atalhos das cidades e se mostra o "Como liberar" (a ajuda de cada aparelho). "sem-suporte" é uma frase só.
// o: { toque (tela de toque ou mouse), offline (aparelho sem internet), vencido (pedido sem resposta há 8 s),
// porToque (o pedido aberto veio do botão "Usar minha localização": ele continua no cartão, com o foco) }.
const ESTADOS = {
  // Depois de 8 s sem resposta, um toque pede de novo (no Firefox, fechar a pergunta não responde nada).
  aguardando: (o) => ['Aguardando sua permissão…', `Se o navegador perguntar, ${verbo(o.toque)} em Permitir.`, o.vencido || o.porToque ? ['usar', 'prefiro'] : ['prefiro'], false, false],
  buscando: () => ['Buscando sua localização…', '', [], false, false],
  onde: () => ['Onde você está?', 'Use sua localização ou escolha a cidade para ver as clínicas mais perto.', ['usar', 'escolher'], true, false],
  negada: (o) => ['A localização está desligada para o IMED', `Tudo bem: escolha a sua cidade. Para usar a localização depois, ${verbo(o.toque)} ${ICONE_SITE} e permita a localização.`, ['escolher'], true, true],
  fechou: () => ['Sem a localização, escolha a cidade', 'Você pode permitir a localização quando quiser.', ['usar', 'escolher'], true, false],
  naoapareceu: (o) => ['O navegador não mostrou o pedido de localização', `Para liberar, ${verbo(o.toque)} ${ICONE_SITE} e permita a localização. Ou escolha a cidade.`, ['usar', 'escolher'], true, true],
  demorou: (o) => (o.offline ? [SEM_INTERNET, `Quando a conexão voltar, ${verbo(o.toque)} em Tentar de novo.`, ['tentar', 'escolher'], true, false]
    : ['A localização demorou para responder', PEDIR_DE_NOVO, ['tentar', 'escolher'], true, false]),
  indisponivel: (o) => (o.offline ? [SEM_INTERNET, `Quando a conexão voltar, ${verbo(o.toque)} em Tentar de novo.`, ['tentar', 'escolher'], true, false]
    : ['Não conseguimos descobrir onde você está', PEDIR_DE_NOVO, ['tentar', 'escolher'], true, false]),
  'sem-suporte': () => ['', 'Seu navegador não informa a localização. Escolha a cidade para ver os locais.', ['escolher'], true, false],
  vazio: () => ['Ainda não temos o cadastro oficial desta região', 'Na busca completa, o IMED começa a trazer os dados do CNES da sua cidade e mostra o mapa público.', ['busca', 'outra'], false, false],
  // Sem internet ou com o banco fora do ar: cada caso com o seu texto (nada de "verifique sua internet" com a
  // internet funcionando).
  erro: (o) => (o.offline ? [SEM_INTERNET, `Os locais aparecem quando a conexão voltar: ${verbo(o.toque)} em Tentar de novo.`, ['tentar'], false, false]
    : ['Não foi possível carregar os locais agora.', 'O IMED não respondeu agora. Tente de novo em instantes.', ['tentar'], false, false]),
};
export const TELAS = Object.freeze(['lista', ...Object.keys(ESTADOS)]);
export function estadoTela(tela, { toque = true, offline = false, vencido = false, porToque = false } = {}) {
  const f = Object.prototype.hasOwnProperty.call(ESTADOS, tela) ? ESTADOS[tela] : null;
  if (!f) return null;
  const e = f({ toque: toque !== false, offline: offline === true, vencido: vencido === true, porToque: porToque === true });
  return { titulo: e[0], texto: e[1], botoes: [...e[2]], atalhos: e[3], ajuda: e[4] };
}
// "Não apareceu a pergunta? Toque no ícone de localização…" (no computador, "Clique").
export const textoNaoApareceu = (toque = true) => `Não apareceu a pergunta? ${maiuscula(verbo(toque))} no ícone de localização ao lado do endereço do site ou escolha a cidade.`;
// Aviso curto quando a localização falha com a cidade escolhida (a lista continua na cidade).
export function textoFalhaNaCidade(tela, nome) {
  const resto = `A lista continua perto do centro ${deCidade(nome)}.`;
  if (tela === 'negada' || tela === 'naoapareceu') return `A localização está bloqueada no navegador. ${resto}`;
  if (tela === 'demorou') return `A localização demorou para responder. ${resto}`;
  if (tela === 'indisponivel') return `Não conseguimos descobrir onde você está. ${resto}`;
  return `A localização não foi permitida. ${resto}`;
}

// Resumo da lista (#pvSum), com gênero e número certos:
// "Os 10 mais perto de você", "As 10 clínicas mais perto do centro de Campinas", "O hospital mais perto de você",
// "Nenhum hospital em até 2 km. Os mais perto, em até 10 km:", "Poucas clínicas em até 2 km. As mais perto, em até
// 10 km:" e, sem nada: "Nenhum laboratório do cadastro oficial em até 50 km daqui."
// n: itens da lista; raio: raio final; primeiro: quantos havia no 1º raio (2 km); modo 'perto' ou 'cidade'.
export function textoResumo({ tipo = '', n = 0, raio = RAIOS[0], primeiro = n, modo = 'perto', cidade = null } = {}) {
  const w = nomeDoTipo(tipo), t = tipoValido(tipo), f = w.f;
  const N = Math.max(0, Math.floor(Number(n)) || 0);
  const R = Number(raio) > 0 ? Number(raio) : RAIOS[0];
  const naCidade = modo === 'cidade' && !!cidade?.name;
  if (!N) return `${f ? 'Nenhuma' : 'Nenhum'} ${w.um} do cadastro oficial em até ${fmtKm(R)} ${naCidade ? `do centro ${deCidade(cidade.name)}` : 'daqui'}.`;
  if (R > RAIOS[0]) {
    const antes = Math.max(0, Math.floor(Number(primeiro)) || 0);
    const ini = antes ? `${f ? 'Poucas' : 'Poucos'} ${w.varios}` : `${f ? 'Nenhuma' : 'Nenhum'} ${w.um}`;
    return `${ini} em até ${fmtKm(RAIOS[0])}. ${N === 1 ? (f ? 'A' : 'O') : f ? 'As' : 'Os'} mais perto, em até ${fmtKm(R)}:`;
  }
  const de = naCidade ? `do centro ${deCidade(cidade.name)}` : 'de você';
  if (N === 1) return `${f ? 'A' : 'O'} ${w.um} mais perto ${de}`;
  return `${f ? 'As' : 'Os'} ${fmtInt(N)}${t ? ` ${w.varios}` : ''} mais perto ${de}`;
}

// Link "Ver mais" (#pvAll). Perto: "Ver mais na busca completa, com filtros", sem número, raio nem tipo: a busca
// completa abre com a própria distância e todos os tipos, então a página inicial não promete um número que a
// próxima não mostra. Cidade: "Ver todos os locais de Campinas, por tipo" (só com a página da cidade no ar, HEAD
// 200); sem a página, null (o link fixo "Todas as cidades" já está logo abaixo, sem repetir).
export function verTodos({ modo = 'perto', cidade = null, temPagina = false } = {}) {
  if (modo === 'cidade') {
    if (temPagina && cidade?.name && ufValida(cidade.uf)) return { texto: `Ver todos os locais ${deCidade(cidade.name)}, por tipo`, href: cityUrl(cidade) };
    return null;
  }
  return { texto: TEXTOS.verMais, href: LINKS.pertoDeMim };
}

// Rótulos da origem em uso, para o topo e a linha da cidade:
// pequeno/principal: #addrSmall/#addrTxt; busca: #heroAddr; rotulo: acima do #cityBtn; botao: nome no #cityBtn;
// trocar: mostra "Trocar" (e o texto escondido); linha: #cityLine.
// modo 'perto' (com a posição) ou 'cidade'; regiao: a região afirmada (cityOfRows); buscando: pedido aberto;
// permitida: a permissão já foi dada (aí o topo diz "Procurando…"; antes da resposta, "Aguardando permissão…", para
// não parecer que o site já localiza sem a permissão).
export function rotulosOrigem({ modo = null, regiao = null, cidade = null, here = null, buscando = false, permitida = false } = {}) {
  const nomeUf = (c) => `${c.name} - ${c.uf}`;
  if (modo === 'cidade' && cidade?.name) {
    const longe = posValida(here) && posValida(cidade) ? ` ${textoFica(cidade.name, metrosEntre(here, cidade))}` : '';
    return { pequeno: 'Cidade escolhida', principal: nomeUf(cidade), busca: cidade.name, rotulo: 'Cidade escolhida', botao: nomeUf(cidade), trocar: true, linha: `Distâncias medidas do centro ${deCidade(cidade.name)}.${longe}` };
  }
  if (modo === 'perto') {
    const linha = 'Distâncias medidas da sua localização aproximada.';
    if (regiao?.name && regiao?.uf) return { pequeno: 'Sua região', principal: nomeUf(regiao), busca: regiao.name, rotulo: 'Sua região', botao: nomeUf(regiao), trocar: true, linha };
    return { pequeno: 'Perto de você', principal: 'Sua localização', busca: 'Sua localização', rotulo: 'Perto de você', botao: 'Sua localização', trocar: true, linha };
  }
  if (buscando) return { pequeno: 'Sua localização', principal: permitida ? 'Procurando…' : 'Aguardando permissão…', busca: 'Sua localização', rotulo: 'Onde você está?', botao: 'Escolher cidade', trocar: false, linha: '' };
  return { pequeno: 'Onde você está?', principal: 'Escolher cidade', busca: 'Escolher cidade', rotulo: 'Onde você está?', botao: 'Escolher cidade', trocar: false, linha: '' };
}
export const textoRegiao = (regiao) => `Sua região: ${regiao.name} - ${regiao.uf}`;
// Título da tela (#reaisTitle): com a cidade escolhida, a lista é perto do centro dela, não da pessoa.
export const tituloTela = (modo, cidade = null) => (modo === 'cidade' && cidade?.name ? `Clínicas perto do centro ${deCidade(cidade.name)}` : TEXTOS.titulo);
export const textoProcurandoCentro = (nome) => `Procurando o centro ${deCidade(nome)}…`;
export const textoToastCidade = (nome) => `Mostrando os locais perto do centro ${deCidade(nome)}`;

// Texto pequeno do #nearCta: o local mais perto de verdade, ou o texto padrão.
export function textoNearCta({ modo = null, cidade = null, item = null } = {}) {
  const ok = item && typeof item.name === 'string' && item.name.trim() && (modo === 'perto' || (modo === 'cidade' && cidade?.name));
  if (!ok) return TEXTOS.nearCtaPadrao;
  const m = numero(item.distance_m), d = Number.isFinite(m) ? `, a ${textoDistancia(m, ehAproximado(item))}` : '';
  return modo === 'cidade' ? `Mais perto do centro ${deCidade(cidade.name)}: ${item.name}${d}` : `Mais perto: ${item.name}${d}`;
}

// Lista leve do 3D (#heroLite): título em 1 linha e o resumo para o leitor de tela.
// modo: 'perto', 'cidade', 'exemplo' (Av. Paulista) ou null (esperando a resposta do pedido).
export function textoLeve({ modo = null, cidade = null, n = null } = {}) {
  let titulo, onde;
  if (modo === 'perto') [titulo, onde] = ['Perto da sua localização', 'perto da sua localização'];
  else if (modo === 'cidade' && cidade?.name) [titulo, onde] = [`Perto do centro ${deCidade(cidade.name)}`, `perto do centro ${deCidade(cidade.name)}`];
  else if (modo === 'exemplo') [titulo, onde] = ['Exemplo: perto da Av. Paulista', 'perto da Av. Paulista, em São Paulo (exemplo)'];
  else return { titulo: 'Perto de você', status: 'Aguardando sua localização…' };
  const k = Math.floor(Number(n));
  return { titulo, status: k > 0 ? `${textoLocais(k)} ${onde}` : null };
}

/* ======================= localização: plano ao abrir, erros e toques ======================= */
const PERMISSOES = new Set(['prompt', 'granted', 'denied']);
// Estado da permissão: 'prompt', 'granted', 'denied' ou 'unknown' (sem permissions.query ou com erro; vale como 'prompt').
export const permissaoDe = (v) => (PERMISSOES.has(v) ? v : 'unknown');
// Recusas guardadas (imed_geo_recusas): inteiro de 0 a 2; outra coisa vale 0.
export function lerRecusas(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(MAX_RECUSAS, Math.max(0, Math.floor(n))) : 0;
}
// Telas que contam como "não" ao pedido (no automático e no toque).
export const TELAS_RECUSA = Object.freeze(['negada', 'fechou', 'naoapareceu']);
// Recusas depois de uma resposta: 'permitiu' zera; recusa soma 1 (até 2); o resto não muda. 'sem-resposta': a
// pessoa saiu da página (ou escondeu a aba) com o pedido automático aberto, sem responder; também conta, para o
// site não perguntar sozinho em toda visita quem nem vê a pergunta (no Chrome, ela pode aparecer só como um ícone).
export function contaRecusas(atual, resultado) {
  if (resultado === 'permitiu') return 0;
  const n = lerRecusas(atual);
  return TELAS_RECUSA.includes(resultado) || resultado === 'sem-resposta' ? Math.min(MAX_RECUSAS, n + 1) : n;
}

// Endereços (#) em que o pedido pode sair sozinho; os outros (#agenda, #tele, #lista, #cidade...) esperam o toque.
const ROTAS_PEDIR = new Set(['', '#', '#reais', '#lojas', '#pedido']);
export const hashPermitePedido = (h) => { const s = String(h ?? ''); return ROTAS_PEDIR.has(s) || s.startsWith('#clinica-'); };
// #cidade e #cidades abrem o seletor.
export const hashAbreSeletor = (h) => h === '#cidade' || h === '#cidades';
const TELA_DO_PLANO = Object.freeze({ cidade: 'lista', silencioso: 'buscando', pedir: 'aguardando', esperar: 'onde', bloqueada: 'negada', 'sem-suporte': 'sem-suporte' });

// Plano ao abrir a página inicial. Entradas (lidas pela página, sem pedir nada):
// cidade: imed_cidade (objeto ou texto JSON); permissao: navigator.permissions.query (ou 'unknown');
// suporte: 'geolocation' in navigator && isSecureContext; hash: location.hash;
// pedidoNaAba: sessionStorage imed_geo_pedido === '1'; recusas: imed_geo_recusas.
// Devolve {plano, cidade, permissao, posicao, seletor, tela}:
// plano: 'cidade' | 'silencioso' | 'pedir' | 'esperar' | 'bloqueada' | 'sem-suporte';
// posicao: como chamar getCurrentPosition ao abrir: 'pedido' (com o aviso), 'silencio' (sem aviso) ou 'nenhuma';
// seletor: abrir o seletor (#cidade, #cidades); tela: o data-estado inicial da tela.
export function geoPlan({ cidade = null, permissao = 'unknown', suporte = true, hash = '', pedidoNaAba = false, recusas = 0 } = {}) {
  const c = cidadeGuardada(cidade), p = permissaoDe(permissao), sup = suporte === true;
  let plano;
  if (c) plano = 'cidade';
  else if (!sup) plano = 'sem-suporte';
  else if (p === 'denied') plano = 'bloqueada';
  else if (p === 'granted') plano = 'silencioso';
  else if (hashPermitePedido(hash) && !(pedidoNaAba === true || pedidoNaAba === '1') && lerRecusas(recusas) < MAX_RECUSAS) plano = 'pedir';
  else plano = 'esperar';
  const posicao = plano === 'pedir' ? 'pedido' : plano === 'silencioso' || (plano === 'cidade' && sup && p === 'granted') ? 'silencio' : 'nenhuma';
  return { plano, cidade: c, permissao: p, posicao, seletor: hashAbreSeletor(hash), tela: TELA_DO_PLANO[plano] };
}

// Tela depois do erro do getCurrentPosition. codigo: 1 (sem permissão), 2 (indisponível) ou 3 (tempo esgotado);
// permissao: o estado logo depois do erro; ms: tempo desde o pedido.
// 1 com 'denied' → 'negada'; 1 com 'prompt'/'unknown' em menos de 800 ms → 'naoapareceu' (o navegador recusou sem
// perguntar); 1 depois disso → 'fechou'; 1 com 'granted' (o sistema do aparelho bloqueou) e 2 → 'indisponivel';
// 3 → 'demorou'.
export function geoErro(codigo, permissao, ms = Infinity) {
  const c = Number(codigo);
  if (c === 3) return 'demorou';
  if (c !== 1) return 'indisponivel';
  const p = permissaoDe(permissao);
  if (p === 'denied') return 'negada';
  if (p === 'granted') return 'indisponivel';
  return Number(ms) < RAPIDO_MS ? 'naoapareceu' : 'fechou';
}

// Toque em "Usar minha localização", "Tentar de novo" ou no #nearCta sem origem:
// 'sem-suporte' (nada a fazer), 'ajuda' (bloqueada: só a ajuda, sem chamar o navegador), 'aguardar' (pedido aberto:
// "Aguardando permissão…", sem chamar de novo) ou 'chamar' (uma chamada por toque). vencido: o pedido aberto está
// sem resposta há 8 s (a pergunta pode ter sido fechada sem resposta, como no Firefox, ou aparecer só como um
// ícone, como no Chrome): aí o toque pede de novo.
export function acaoToque({ suporte = true, permissao = 'unknown', pendente = false, vencido = false } = {}) {
  if (suporte !== true) return 'sem-suporte';
  if (permissaoDe(permissao) === 'denied') return 'ajuda';
  return pendente && vencido !== true ? 'aguardar' : 'chamar';
}

// Mudança da permissão com a página aberta (PermissionStatus change):
// 'localizar' (virou 'granted' sem origem: localiza em silêncio e mostra a lista), 'distancia' (virou 'granted' no
// modo cidade: a posição serve só para "fica a X km de você"), 'esquecer' (virou 'denied' com origem: apaga a
// posição da memória; no modo perto, mostra 'negada'), 'negada' (virou 'denied' sem origem), 'onde' (voltou a
// "perguntar" com a tela de bloqueada: "Onde você está?", com o botão de usar a localização) ou 'nada'.
// pendente: há um pedido aberto (a resposta dele resolve); tela: o data-estado da tela.
export function aoMudarPermissao(nova, { modo = null, pendente = false, tela = '' } = {}) {
  const p = permissaoDe(nova);
  if (p === 'granted') return pendente || modo === 'perto' ? 'nada' : modo === 'cidade' ? 'distancia' : 'localizar';
  if (p === 'denied') return modo === 'perto' || modo === 'cidade' ? 'esquecer' : pendente ? 'nada' : 'negada';
  if (!modo && !pendente && tela === 'negada') return 'onde';
  return 'nada';
}

// Estado do botão "Usar minha localização atual" do seletor (#cityGeoState).
// ativa: a posição é conhecida; regiao: a região afirmada; aguardando: pedido aberto.
export function estadoGeoSeletor({ suporte = true, permissao = 'unknown', aguardando = false, ativa = false, regiao = null } = {}) {
  if (suporte !== true) return { texto: 'Não disponível neste navegador', desabilitado: true, ajuda: false };
  const p = permissaoDe(permissao);
  if (p === 'denied') return { texto: 'Bloqueada no navegador: veja como liberar', desabilitado: false, ajuda: true };
  if (aguardando) return { texto: 'Aguardando permissão…', desabilitado: false, ajuda: false };
  if (ativa || p === 'granted') {
    return { texto: ativa && regiao?.name && ufValida(regiao.uf) ? `Ativa · ${regiao.name} - ${regiao.uf}` : 'Ativa', desabilitado: false, ajuda: false };
  }
  return { texto: 'Toque para permitir', desabilitado: false, ajuda: false };
}
