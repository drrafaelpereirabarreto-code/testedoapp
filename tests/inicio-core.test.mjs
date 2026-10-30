// Testes das regras puras da tela "Clínicas perto de você" da página inicial (assets/js/inicio-core.js): plano ao
// abrir (pedido de localização), erros, recusas, cidade guardada, busca de cidade, região, distâncias, raio,
// chamadas ao banco e textos. Rodar com: node --test tests/inicio-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as I from '../assets/js/inicio-core.js';
import * as G from '../assets/js/geo-core.js';
import { deCidade as deCidadeConfianca } from '../assets/js/confianca.js';
import { slugify, cityDir, UF_NAMES } from '../scripts/gerar-cidades.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CIDADES = JSON.parse(readFileSync(join(ROOT, 'scripts/cidades.json'), 'utf8'));
const SRC = readFileSync(join(ROOT, 'assets/js/inicio-core.js'), 'utf8');

// Av. Paulista (o padrão "permitida na Paulista" do simulador, já arredondado), centros do Rio e de São Paulo.
const PAULISTA = { lat: -23.565, lng: -46.652 };
const RIO = { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', lat: -22.907, lng: -43.173 };
const SP_CENTRO = { ibge: 3550308, name: 'São Paulo', uf: 'SP', lat: -23.55, lng: -46.633 };
const SP_REGIAO = { code: 355030, ibge: 3550308, name: 'São Paulo', uf: 'SP' };
const CAMPINAS = { ibge: 3509502, name: 'Campinas', uf: 'SP', lat: -22.906, lng: -47.061 };

// Linhas como as do banco simulado do e2e-inicio (nearby_establishments e nearby_clinics).
const PARCEIRO = { id: '33333333-3333-4333-8333-333333333333', name: 'Clínica Parceira Paulista', kind: 'imagem', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', lat: -23.5614, lng: -46.6559, distance_m: 300, cnes: '9999999' };
const CNES_ROWS = [
  { cnes: '2077485', name: 'Hospital Santa Exemplo', kind: 'hospital', neighborhood: 'Cerqueira César', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5598, lng: -46.6602, distance_m: 420, location_source: 'cnes', open_24h: true, sus: false, total: 3 },
  { cnes: '6543210', name: 'Laboratório Análise Paulista', kind: 'laboratorio', neighborhood: 'Bela Vista', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5655, lng: -46.652, distance_m: 640, location_source: 'endereco', open_24h: false, sus: true, total: 3 },
  { cnes: '7000001', name: 'Centro de Imagem <b>Teste</b>', kind: 'imagem', neighborhood: 'Consolação', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.556, lng: -46.657, distance_m: 900, location_source: 'cnes', open_24h: false, sus: false, total: 3 },
];

/* ======================= plano ao abrir ======================= */
test('constantes: opções do pedido, raios, chaves do aparelho e abas', () => {
  assert.deepEqual({ ...I.GEO_OPCOES }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  assert.ok(Object.isFrozen(I.GEO_OPCOES) && Object.isFrozen(I.RAIOS) && Object.isFrozen(I.TEXTOS));
  assert.deepEqual([...I.RAIOS], [2000, 10000, 50000]);
  assert.deepEqual([I.RAPIDO_MS, I.ESPERA_PEDIDO_MS, I.ESPERA_SILENCIO_MS, I.MAX_RECUSAS, I.MIN_LOCAIS], [800, 8000, 3000, 2, 3]);
  assert.deepEqual([I.LIMITE_LISTA, I.LISTA_CELULAR, I.LIMITE_PARCEIROS, I.LIMITE_PONTOS, I.MAX_CIDADES, I.N_ATALHOS, I.MAX_RECENTES], [10, 6, 100, 3000, 50, 12, 3]);
  assert.deepEqual({ ...I.CHAVES }, { cidade: 'imed_cidade', recentes: 'imed_cidades_recentes', recusas: 'imed_geo_recusas', pedido: 'imed_geo_pedido', antiga: 'imed_place' });
  assert.deepEqual(I.ABAS.map(([, r]) => r), ['Todos', 'Imagem', 'Laboratórios', 'Clínicas', 'Hospitais']);
  assert.deepEqual(I.ABAS.map(([k]) => k), ['', 'imagem', 'laboratorio', 'clinica', 'hospital']);
  // Os mesmos tipos e nomes da busca completa (geo-core), na mesma ordem.
  assert.deepEqual([...I.ORDEM_TIPOS], Object.keys(G.KINDS));
  for (const k of I.ORDEM_TIPOS) assert.equal(I.TIPOS[k].n, G.KINDS[k].n);
  // As 27 UFs, as mesmas do gerador das páginas de cidade.
  assert.deepEqual([...I.UFS].sort(), Object.keys(UF_NAMES).sort());
  assert.ok(I.ufValida('SP') && !I.ufValida('sp') && !I.ufValida('XX') && !I.ufValida(undefined));
});

test('geoPlan: cidade escolhida antes abre direto nela; com "granted", também a posição em silêncio', () => {
  for (const permissao of ['prompt', 'unknown', 'denied', undefined]) {
    const p = I.geoPlan({ cidade: RIO, permissao });
    assert.equal(p.plano, 'cidade', String(permissao));
    assert.equal(p.posicao, 'nenhuma', `${permissao}: sem pedido e sem aviso`);
    assert.equal(p.tela, 'lista');
    assert.deepEqual(p.cidade, RIO);
  }
  const g = I.geoPlan({ cidade: RIO, permissao: 'granted' });
  assert.deepEqual([g.plano, g.posicao, g.permissao], ['cidade', 'silencio', 'granted']);
  // Sem suporte, a cidade vale do mesmo jeito (sem chamar o navegador).
  assert.deepEqual([I.geoPlan({ cidade: RIO, permissao: 'granted', suporte: false }).plano, I.geoPlan({ cidade: RIO, permissao: 'granted', suporte: false }).posicao], ['cidade', 'nenhuma']);
  // Recusas, pedido na aba e endereço não mudam a cidade; #cidade ainda abre o seletor.
  assert.equal(I.geoPlan({ cidade: RIO, recusas: 2, pedidoNaAba: true, hash: '#agenda' }).plano, 'cidade');
  assert.deepEqual([I.geoPlan({ cidade: RIO, hash: '#cidade' }).plano, I.geoPlan({ cidade: RIO, hash: '#cidade' }).seletor], ['cidade', true]);
  // O texto JSON do localStorage também serve.
  assert.deepEqual(I.geoPlan({ cidade: JSON.stringify(RIO), permissao: 'prompt' }).cidade, RIO);
});

test('cidade guardada inválida não vale (nome, UF de 2 letras e lat/lng finitos)', () => {
  const ruins = [
    null, undefined, 42, 'Rio', '{quebrado', '[]', [], [RIO], {}, JSON.stringify({ ...RIO, uf: 'rj' }),
    { ...RIO, name: '' }, { ...RIO, name: '   ' }, { ...RIO, name: 7 }, { ...RIO, name: 'x'.repeat(101) },
    { ...RIO, uf: 'rj' }, { ...RIO, uf: 'XX' }, { ...RIO, uf: 'RJA' }, { ...RIO, uf: undefined },
    { ...RIO, lat: '-22.907' }, { ...RIO, lng: NaN }, { ...RIO, lat: Infinity }, { ...RIO, lat: 95 }, { ...RIO, lng: -181 },
    { ...RIO, lng: undefined }, { ...RIO, lat: null },
  ];
  for (const v of ruins) {
    assert.equal(I.cidadeGuardada(v), null, JSON.stringify(v));
    const p = I.geoPlan({ cidade: v, permissao: 'prompt' });
    assert.deepEqual([p.plano, p.cidade], ['pedir', null], `${JSON.stringify(v)}: cai no pedido`);
  }
  // Formato de hoje, com o centro arredondado (3 casas); sem ibge, a cidade vale e o ibge fica null.
  assert.deepEqual(I.cidadeGuardada({ ibge: '3304557', name: ' Rio de Janeiro ', uf: 'RJ', lat: -22.90712, lng: -43.17289 }), RIO);
  assert.deepEqual(I.cidadeGuardada({ name: 'Rio de Janeiro', uf: 'RJ', lat: -22.907, lng: -43.173 }), { ...RIO, ibge: null });
  assert.equal(I.cidadeGuardada({ ...RIO, ibge: 'abc' }).ibge, null);
  // Campos a mais (como uma posição) não passam adiante.
  assert.deepEqual(Object.keys(I.cidadeGuardada({ ...RIO, here: { lat: 1, lng: 2 } })), ['ibge', 'name', 'uf', 'lat', 'lng']);
});

test('geoPlan: permissão "granted" → silencioso; "denied" → bloqueada; "prompt"/"unknown" → pedir', () => {
  assert.deepEqual(I.geoPlan({ permissao: 'granted' }), { plano: 'silencioso', cidade: null, permissao: 'granted', posicao: 'silencio', seletor: false, tela: 'buscando' });
  assert.deepEqual(I.geoPlan({ permissao: 'denied' }), { plano: 'bloqueada', cidade: null, permissao: 'denied', posicao: 'nenhuma', seletor: false, tela: 'negada' });
  assert.deepEqual(I.geoPlan({ permissao: 'prompt' }), { plano: 'pedir', cidade: null, permissao: 'prompt', posicao: 'pedido', seletor: false, tela: 'aguardando' });
  // Sem permissions.query (ou com erro): 'unknown', tratado como 'prompt'.
  for (const permissao of ['unknown', undefined, null, 'xyz', 'GRANTED']) {
    const p = I.geoPlan({ permissao });
    assert.deepEqual([p.plano, p.permissao, p.posicao], ['pedir', 'unknown', 'pedido'], String(permissao));
  }
  assert.equal(I.geoPlan().plano, 'pedir', 'sem nada: 1ª visita');
  // Com a permissão dada, o endereço não importa: nenhum pedido aparece.
  assert.equal(I.geoPlan({ permissao: 'granted', hash: '#agenda' }).plano, 'silencioso');
  assert.equal(I.geoPlan({ permissao: 'granted', recusas: 2, pedidoNaAba: true }).plano, 'silencioso');
  assert.deepEqual([I.geoPlan({ permissao: 'denied', hash: '#cidades' }).plano, I.geoPlan({ permissao: 'denied', hash: '#cidades' }).seletor], ['bloqueada', true]);
});

test('geoPlan: pedido já feito nesta aba ou 2 recusas → esperar (sem pedido automático)', () => {
  for (const pedidoNaAba of [true, '1']) {
    assert.deepEqual(I.geoPlan({ permissao: 'prompt', pedidoNaAba }), { plano: 'esperar', cidade: null, permissao: 'prompt', posicao: 'nenhuma', seletor: false, tela: 'onde' });
  }
  assert.equal(I.geoPlan({ permissao: 'prompt', pedidoNaAba: '0' }).plano, 'pedir');
  for (const recusas of [2, '2', 3, '7']) assert.equal(I.geoPlan({ permissao: 'unknown', recusas }).plano, 'esperar', String(recusas));
  for (const recusas of [0, 1, '1', 'abc', -3, null]) assert.equal(I.geoPlan({ permissao: 'prompt', recusas }).plano, 'pedir', String(recusas));
});

test('geoPlan: #agenda, #tele, #lista, #cidade e #cidades esperam; #reais, #lojas, #pedido e #clinica-x pedem', () => {
  for (const hash of ['#agenda', '#tele', '#lista', '#cidade', '#cidades', '#faq', '#conteudo', '#clinica']) {
    assert.equal(I.geoPlan({ permissao: 'prompt', hash }).plano, 'esperar', hash);
  }
  for (const hash of ['', '#', '#reais', '#lojas', '#pedido', '#clinica-x', '#clinica-12345']) {
    assert.equal(I.geoPlan({ permissao: 'prompt', hash }).plano, 'pedir', hash || '(sem #)');
  }
  assert.equal(I.geoPlan({ permissao: 'prompt', hash: '#cidade' }).seletor, true);
  assert.equal(I.geoPlan({ permissao: 'prompt', hash: '#cidades' }).seletor, true);
  assert.equal(I.geoPlan({ permissao: 'prompt', hash: '#reais' }).seletor, false);
  assert.ok(I.hashPermitePedido(undefined) && !I.hashAbreSeletor(undefined));
});

test('geoPlan: sem suporte (sem navigator.geolocation ou sem https) → sem-suporte', () => {
  for (const permissao of ['prompt', 'granted', 'denied', 'unknown']) {
    assert.deepEqual(I.geoPlan({ permissao, suporte: false }), { plano: 'sem-suporte', cidade: null, permissao, posicao: 'nenhuma', seletor: false, tela: 'sem-suporte' });
  }
  assert.equal(I.geoPlan({ suporte: 'sim' }).plano, 'sem-suporte', 'só true vale como suporte');
  assert.equal(I.geoPlan({ suporte: false, hash: '#cidade' }).seletor, true);
});

/* ======================= erros, recusas e mudanças da permissão ======================= */
test('geoErro: código 1 com "denied" → negada; com "prompt" em 300 ms → naoapareceu; em 2 s → fechou; 2 → indisponivel; 3 → demorou', () => {
  assert.equal(I.geoErro(1, 'denied', 300), 'negada');
  assert.equal(I.geoErro(1, 'denied', 5000), 'negada');
  assert.equal(I.geoErro(1, 'prompt', 300), 'naoapareceu');
  assert.equal(I.geoErro(1, 'prompt', 6), 'naoapareceu', 'o Chromium dos testes responde em ~6 ms');
  assert.equal(I.geoErro(1, 'prompt', 799), 'naoapareceu');
  assert.equal(I.geoErro(1, 'prompt', 800), 'fechou');
  assert.equal(I.geoErro(1, 'prompt', 2000), 'fechou');
  assert.equal(I.geoErro(1, 'prompt'), 'fechou', 'sem o tempo: fechou');
  assert.equal(I.geoErro(1, 'unknown', 300), 'naoapareceu', "'unknown' vale como 'prompt'");
  assert.equal(I.geoErro(1, undefined, 1500), 'fechou');
  assert.equal(I.geoErro(1, 'granted', 300), 'indisponivel', 'permitido no site, bloqueado no aparelho');
  assert.equal(I.geoErro(2, 'granted', 300), 'indisponivel');
  assert.equal(I.geoErro(2, 'prompt', 300), 'indisponivel');
  assert.equal(I.geoErro(3, 'granted', 15000), 'demorou');
  assert.equal(I.geoErro('3', 'prompt', 10), 'demorou');
  assert.equal(I.geoErro(0, 'prompt', 10), 'indisponivel');
  assert.equal(I.geoErro(undefined), 'indisponivel');
});

test('recusas: de 0 a 2 no aparelho; recusa soma, permitir zera, demora e indisponível não contam', () => {
  const casos = [[undefined, 0], [null, 0], ['', 0], ['1', 1], [1, 1], ['2', 2], [2, 2], [3, 2], ['7', 2], [-1, 0], ['-1', 0], [1.7, 1], ['abc', 0], [NaN, 0], [' 1 ', 1], [{}, 0]];
  for (const [v, n] of casos) assert.equal(I.lerRecusas(v), n, JSON.stringify(v));
  assert.equal(I.contaRecusas(0, 'negada'), 1);
  assert.equal(I.contaRecusas(1, 'fechou'), 2);
  assert.equal(I.contaRecusas(2, 'naoapareceu'), 2, 'no máximo 2');
  assert.equal(I.contaRecusas('1', 'negada'), 2);
  assert.equal(I.contaRecusas(2, 'permitiu'), 0);
  assert.equal(I.contaRecusas(1, 'demorou'), 1);
  assert.equal(I.contaRecusas(1, 'indisponivel'), 1);
  assert.equal(I.contaRecusas('x', 'negada'), 1);
  assert.deepEqual([...I.TELAS_RECUSA], ['negada', 'fechou', 'naoapareceu']);
});

test('toques: bloqueada só mostra a ajuda; pedido aberto não chama de novo; nos outros casos, 1 chamada por toque', () => {
  assert.equal(I.acaoToque({ suporte: false }), 'sem-suporte');
  assert.equal(I.acaoToque({ permissao: 'denied' }), 'ajuda');
  assert.equal(I.acaoToque({ permissao: 'denied', pendente: true }), 'ajuda');
  assert.equal(I.acaoToque({ permissao: 'prompt', pendente: true }), 'aguardar');
  for (const permissao of ['prompt', 'granted', 'unknown', undefined]) assert.equal(I.acaoToque({ permissao }), 'chamar', String(permissao));
  assert.equal(I.acaoToque(), 'chamar');
});

test('mudança da permissão com a página aberta', () => {
  assert.equal(I.aoMudarPermissao('granted'), 'localizar', 'sem cidade: localiza em silêncio e mostra a lista');
  assert.equal(I.aoMudarPermissao('granted', { modo: 'cidade' }), 'distancia', 'com cidade: só "fica a X km de você"');
  assert.equal(I.aoMudarPermissao('granted', { modo: 'perto' }), 'nada');
  assert.equal(I.aoMudarPermissao('granted', { pendente: true }), 'nada', 'a resposta do pedido aberto resolve');
  assert.equal(I.aoMudarPermissao('denied', { modo: 'perto' }), 'esquecer', 'apaga a posição e mostra "negada"');
  assert.equal(I.aoMudarPermissao('denied', { modo: 'cidade' }), 'esquecer');
  assert.equal(I.aoMudarPermissao('denied'), 'negada');
  assert.equal(I.aoMudarPermissao('denied', { pendente: true }), 'nada');
  assert.equal(I.aoMudarPermissao('prompt', { modo: 'perto' }), 'nada');
  assert.equal(I.aoMudarPermissao('xyz'), 'nada');
});

test('seletor: estado do botão "Usar minha localização atual"', () => {
  assert.deepEqual(I.estadoGeoSeletor({ suporte: false, permissao: 'granted' }), { texto: 'Não disponível neste navegador', desabilitado: true, ajuda: false });
  assert.deepEqual(I.estadoGeoSeletor({ permissao: 'denied' }), { texto: 'Bloqueada no navegador: veja como liberar', desabilitado: false, ajuda: true });
  assert.equal(I.estadoGeoSeletor({ permissao: 'prompt', aguardando: true }).texto, 'Aguardando permissão…');
  assert.equal(I.estadoGeoSeletor({ permissao: 'granted', ativa: true, regiao: SP_REGIAO }).texto, 'Ativa · São Paulo - SP');
  assert.equal(I.estadoGeoSeletor({ permissao: 'granted', ativa: true }).texto, 'Ativa');
  assert.equal(I.estadoGeoSeletor({ permissao: 'granted' }).texto, 'Ativa');
  assert.equal(I.estadoGeoSeletor({ permissao: 'granted', regiao: SP_REGIAO }).texto, 'Ativa', 'região sem a posição não aparece');
  assert.equal(I.estadoGeoSeletor({ permissao: 'prompt' }).texto, 'Toque para permitir');
  assert.equal(I.estadoGeoSeletor().texto, 'Toque para permitir');
});

/* ======================= cidades: guardada, recentes, busca e atalhos ======================= */
test('recentes: até 3 cidades válidas, sem repetir, a mais nova primeiro; centro guardado evita geocodificar', () => {
  const BH = { ibge: 3106200, name: 'Belo Horizonte', uf: 'MG', lat: -19.917, lng: -43.934 };
  assert.deepEqual(I.lerRecentes([RIO, { name: 'x' }, RIO, null, CAMPINAS, BH, SP_CENTRO]), [RIO, CAMPINAS, BH]);
  assert.deepEqual(I.lerRecentes(JSON.stringify([RIO])), [RIO]);
  for (const v of [null, undefined, 'x', '{}', {}, 3]) assert.deepEqual(I.lerRecentes(v), []);
  let r = I.comRecente([], RIO);
  r = I.comRecente(r, CAMPINAS);
  r = I.comRecente(r, BH);
  assert.deepEqual(r.map((c) => c.name), ['Belo Horizonte', 'Campinas', 'Rio de Janeiro']);
  r = I.comRecente(r, RIO);
  assert.deepEqual(r.map((c) => c.name), ['Rio de Janeiro', 'Belo Horizonte', 'Campinas'], 'sem repetir: o Rio sobe');
  r = I.comRecente(r, SP_CENTRO);
  assert.deepEqual(r.map((c) => c.name), ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte'], 'no máximo 3');
  // Mesma cidade sem ibge (formato antigo): pelo nome e pela UF, sem acento e sem caixa.
  r = I.comRecente([{ name: 'Sao Paulo', uf: 'SP', lat: -23.55, lng: -46.633 }, RIO], SP_CENTRO);
  assert.deepEqual(r.map((c) => c.name), ['São Paulo', 'Rio de Janeiro']);
  assert.deepEqual(I.comRecente([RIO], { name: 'sem centro', uf: 'SP' }), [RIO], 'cidade inválida não entra');
  // Centro já guardado: nas recentes ou na imed_cidade (pelo ibge da imported_cities).
  assert.deepEqual(I.centroGuardado({ ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', total: 4709 }, [CAMPINAS, RIO], null), RIO);
  assert.deepEqual(I.centroGuardado({ ibge: 3509502, name: 'Campinas', uf: 'SP' }, [], CAMPINAS), CAMPINAS);
  assert.equal(I.centroGuardado({ ibge: 3106200, name: 'Belo Horizonte', uf: 'MG' }, [CAMPINAS, RIO], SP_CENTRO), null);
  assert.equal(I.centroGuardado({ ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ' }, [{ ...RIO, lat: 'x' }]), null, 'centro inválido não serve');
});

test('mesma cidade: código de 6 dígitos (número ou texto) ↔ IBGE 3550308', () => {
  for (const [v, n] of [[3550308, 355030], ['3550308', 355030], [355030, 355030], ['355030', 355030], [' 355030 ', 355030], [3304557, 330455]]) {
    assert.equal(I.codigoMunicipio(v), n, JSON.stringify(v));
  }
  for (const v of [35503, '0355030', 3550308.5, 35503080, null, undefined, 'abc', '', {}, NaN]) assert.equal(I.codigoMunicipio(v), null, JSON.stringify(v));
  assert.ok(I.mesmaCidade({ ibge: 3550308 }, { code: 355030 }));
  assert.ok(I.mesmaCidade({ ibge: 3550308 }, { code: '355030' }));
  assert.ok(I.mesmaCidade({ ibge: '3550308', name: 'São Paulo' }, { ibge: 3550308 }));
  assert.ok(I.mesmaCidade(SP_REGIAO, SP_CENTRO));
  assert.ok(!I.mesmaCidade(SP_REGIAO, RIO));
  assert.ok(I.mesmaCidade({ name: "Santa Bárbara d'Oeste", uf: 'SP' }, { name: 'santa barbara d oeste', uf: 'sp' }), 'sem código: nome e UF');
  assert.ok(!I.mesmaCidade({ name: 'Campinas', uf: 'SP' }, { name: 'Campinas', uf: 'RS' }));
  assert.ok(!I.mesmaCidade(null, RIO) && !I.mesmaCidade({}, {}));
});

test('busca de cidade: ignora acento, caixa, apóstrofo, hífen e pontuação', () => {
  for (const q of ['sao', 'São', 'SAO', 'são p', 'Sao Paulo', 'são-paulo', 'saopaulo']) {
    assert.equal(I.matchCities(CIDADES, q).lista[0]?.name, 'São Paulo', q);
  }
  for (const q of ['barbara d oeste', 'santa barb', "Bárbara D'Oeste", 'BARBARA', 'barbara doeste', 'santa-barbara', 'santa bárbara d’oeste']) {
    assert.equal(I.matchCities(CIDADES, q).lista[0]?.name, "Santa Bárbara d'Oeste", q);
  }
  assert.equal(I.matchCities(CIDADES, 'ji parana').lista[0]?.name, 'Ji-Paraná');
  assert.equal(I.matchCities(CIDADES, 'jiparana').lista[0]?.name, 'Ji-Paraná');
  // Devolve as linhas originais (com o ibge e o total reais), sem mexer nelas.
  const sp = CIDADES.find((c) => c.ibge === 3550308);
  assert.equal(I.matchCities(CIDADES, 'sao').lista[0], sp);
  assert.deepEqual(Object.keys(sp), ['ibge', 'name', 'uf', 'total', 'imagem', 'laboratorio', 'clinica', 'hospital']);
});

test('busca de cidade: "Campinas - SP" e "campinas sp" filtram pela UF', () => {
  const rows = [...CIDADES, { ibge: 4303509, name: 'Campinas do Sul', uf: 'RS', total: 5 }];
  assert.deepEqual(I.matchCities(rows, 'campinas').lista.map((c) => `${c.name} - ${c.uf}`), ['Campinas - SP', 'Campinas do Sul - RS']);
  for (const q of ['campinas sp', 'Campinas - SP', 'CAMPINAS/SP', 'campinas, sp', 'sp campinas']) {
    assert.deepEqual(I.matchCities(rows, q).lista.map((c) => `${c.name} - ${c.uf}`), ['Campinas - SP'], q);
  }
  assert.deepEqual(I.matchCities(rows, 'campinas rs').lista.map((c) => c.name), ['Campinas do Sul']);
  assert.deepEqual(I.matchCities(rows, 'campinas do sul - RS').lista.map((c) => c.name), ['Campinas do Sul']);
  assert.deepEqual(I.matchCities(rows, 'rio de janeiro rj').lista.map((c) => c.name), ['Rio de Janeiro']);
  // UF que não está na lista não filtra: o texto inteiro vale como nome (e aqui não acha nada).
  const semAc = rows.filter((c) => c.uf !== 'AC');
  assert.deepEqual(I.matchCities(semAc, 'campinas ac'), { lista: [], total: 0 });
  // Enquanto a pessoa digita, "porto al" ("al" também é UF) continua achando Porto Alegre.
  assert.equal(I.matchCities(CIDADES, 'porto al').lista[0]?.name, 'Porto Alegre');
  // Só a UF: as cidades dela, das com mais locais para as com menos.
  const soSp = I.matchCities(CIDADES, 'sp');
  assert.deepEqual(soSp.lista.slice(0, 3).map((c) => c.name), ['São Paulo', 'Santo André', 'Campinas']);
  assert.ok(soSp.lista.slice(0, CIDADES.filter((c) => c.uf === 'SP').length).every((c) => c.uf === 'SP'));
});

test('busca de cidade: começo do nome, depois começo de palavra, depois contém; no empate, mais locais e o nome', () => {
  const rows = [
    { ibge: 1, name: 'Campo Belo', uf: 'MG', total: 10 }, { ibge: 2, name: 'Bom Campo', uf: 'SP', total: 500 },
    { ibge: 3, name: 'Ocampo', uf: 'BA', total: 1000 }, { ibge: 4, name: 'Campos', uf: 'RJ', total: 20 },
    { ibge: 5, name: 'Campo Alegre', uf: 'AL', total: 10 }, { ibge: 6, name: 'Campo Alegre', uf: 'GO', total: 10 },
  ];
  assert.deepEqual(I.matchCities(rows, 'campo').lista.map((c) => `${c.name}/${c.uf}`),
    ['Campos/RJ', 'Campo Alegre/AL', 'Campo Alegre/GO', 'Campo Belo/MG', 'Bom Campo/SP', 'Ocampo/BA']);
  // "sao" no começo do nome vem antes de "sao" no começo de uma palavra, mesmo com menos locais.
  const sao = I.matchCities([{ name: 'Bom Jesus de São Paulo', uf: 'SP', total: 9000 }, { name: 'São Lourenço', uf: 'MG', total: 3 }], 'sao');
  assert.deepEqual(sao.lista.map((c) => c.name), ['São Lourenço', 'Bom Jesus de São Paulo']);
  // Pedaço no meio da palavra só com 4 letras ou mais sem os espaços (sp não acha "dos Pinhais").
  assert.ok(!I.matchCities(CIDADES, 'sp').lista.some((c) => c.name === 'São José dos Pinhais'));
  assert.ok(I.matchCities(CIDADES, 'pinhais').lista.some((c) => c.name === 'São José dos Pinhais'));
});

test('busca de cidade: no máximo 50, com o total achado; só total > 0 e UF válida; campo vazio → nada', () => {
  const s = I.matchCities(CIDADES, 's');
  assert.equal(s.lista.length, 50);
  assert.ok(s.total > 50, `${s.total}`);
  assert.equal(I.matchCities(CIDADES, 's', 5).lista.length, 5);
  assert.equal(I.matchCities(CIDADES, 's', 5).total, s.total);
  const rows = [
    { name: 'Cidade Zero', uf: 'SP', total: 0 }, { name: 'Cidade Errada', uf: 'XX', total: 10 }, { name: 'Cidade Minúscula', uf: 'sp', total: 10 },
    { name: '', uf: 'SP', total: 10 }, { name: 'Cidade Sem Total', uf: 'MG' }, null, 'Cidade Texto', 7, { name: 'Cidade Boa', uf: 'MG', total: '7' },
  ];
  assert.deepEqual(I.matchCities(rows, 'cidade'), { lista: [rows[8]], total: 1 });
  for (const q of ['', '   ', '--', "'", null, undefined]) assert.deepEqual(I.matchCities(CIDADES, q), { lista: [], total: 0 }, JSON.stringify(q));
  for (const rowsRuins of [null, undefined, 'x', {}]) assert.deepEqual(I.matchCities(rowsRuins, 'sao'), { lista: [], total: 0 });
  assert.deepEqual(I.matchCities(CIDADES, 'cidade que nao existe'), { lista: [], total: 0 });
});

test('atalhos "Cidades com mais locais": 12, ordenadas pelo total real', () => {
  const top = I.cidadesComMaisLocais(CIDADES);
  assert.equal(top.length, 12);
  const esperado = CIDADES.filter((c) => c.total > 0).sort((a, b) => b.total - a.total).slice(0, 12);
  assert.deepEqual(top.map((c) => c.ibge), esperado.map((c) => c.ibge));
  assert.equal(top[0].name, 'São Paulo');
  for (let i = 1; i < top.length; i += 1) assert.ok(top[i - 1].total >= top[i].total);
  assert.deepEqual(I.cidadesComMaisLocais([{ name: 'B', uf: 'SP', total: 5 }, { name: 'A', uf: 'SP', total: 5 }, { name: 'C', uf: 'XX', total: 9 }, { name: 'D', uf: 'RJ', total: 0 }], 12).map((c) => c.name), ['A', 'B']);
  assert.deepEqual(I.cidadesComMaisLocais(null), []);
  assert.equal(I.textoLocais(6548), '6.548 locais');
  assert.equal(I.textoLocais(1), '1 local');
  assert.equal(I.textoLocais(1120, true), '1.120 locais no cadastro oficial');
  assert.equal(I.textoLocais(150, true), '150 locais no cadastro oficial');
});

test('contagem da busca (#cityHint)', () => {
  assert.equal(I.textoContagemCidades(12), '12 cidades encontradas');
  assert.equal(I.textoContagemCidades(1), '1 cidade encontrada');
  assert.equal(I.textoContagemCidades(120), 'Mostrando 50 de 120. Continue digitando.');
  assert.equal(I.textoContagemCidades(1200, 50), 'Mostrando 50 de 1.200. Continue digitando.');
  assert.equal(I.textoContagemCidades(50), '50 cidades encontradas');
  assert.equal(I.textoContagemCidades(0), 'Nenhuma cidade com esse nome no IMED ainda.');
  assert.equal(I.textoContagemCidades(undefined), 'Nenhuma cidade com esse nome no IMED ainda.');
});

/* ======================= região da pessoa ======================= */
test('cityOfRows: afirma a região com o mais perto a até 3 km e 3 dos 5 mais perto na mesma cidade', () => {
  const linha = (d, code = '355030', extra = {}) => ({ cnes: String(7000000 + d), name: `Local ${d}`, kind: 'clinica', city: 'São Paulo', uf: 'SP', city_code: code, distance_m: d, ...extra });
  const cidades = [{ ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', total: 4709 }, { ibge: 3550308, name: 'São Paulo', uf: 'SP', total: 6548 }];
  // Os dados do e2e-inicio: 3 linhas do CNES em São Paulo e o parceiro (que não conta).
  assert.deepEqual(I.cityOfRows([{ ...PARCEIRO, partner: true }, ...CNES_ROWS], cidades), SP_REGIAO);
  assert.deepEqual(I.cityOfRows(CNES_ROWS.map((r) => ({ ...r, city_code: 355030 })), cidades), SP_REGIAO, 'código como número');
  assert.deepEqual(I.cityOfRows(CNES_ROWS.map((r) => ({ ...r, city_code: '3550308' })), cidades), SP_REGIAO, 'IBGE de 7 dígitos');
  // Sem a lista de cidades (imported_cities fora do ar): nome e UF das linhas, sem o ibge.
  assert.deepEqual(I.cityOfRows(CNES_ROWS), { code: 355030, ibge: null, name: 'São Paulo', uf: 'SP' });
  assert.deepEqual(I.cityOfRows(CNES_ROWS, [{ ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ' }]), { code: 355030, ibge: null, name: 'São Paulo', uf: 'SP' });
  // O mais perto a até 3 km.
  assert.equal(I.cityOfRows([linha(3001), linha(3100), linha(3200)]), null);
  assert.equal(I.cityOfRows([linha(3000), linha(3100), linha(3200)])?.code, 355030);
  // 3 dos 5 mais perto.
  const outra = (d) => linha(d, '330455', { city: 'Rio de Janeiro', uf: 'RJ' });
  assert.equal(I.cityOfRows([linha(100), outra(200), linha(300), outra(400), linha(500)])?.code, 355030);
  assert.equal(I.cityOfRows([linha(100), outra(200), linha(300), outra(400), linha(900, '310620', { city: 'Belo Horizonte', uf: 'MG' })]), null, '2 de 5');
  assert.equal(I.cityOfRows([outra(100), linha(200), linha(300), linha(400), outra(500)])?.name, 'São Paulo', 'o mais perto pode ser da divisa');
  // Só os 5 mais perto contam (fora de ordem na entrada).
  const bh = (d) => linha(d, '310620', { city: 'Belo Horizonte', uf: 'MG' });
  assert.equal(I.cityOfRows([linha(900), linha(800), linha(700), linha(100), outra(200), linha(250), outra(260), bh(300)]), null, 'SP tem 2 dos 5 mais perto');
  assert.equal(I.cityOfRows([linha(900), outra(800), outra(700), outra(100), outra(200), linha(250), bh(260), bh(300)]), null, 'o Rio tem 4 de 8, mas só 2 dos 5');
  assert.equal(I.cityOfRows([outra(260), linha(900), outra(100), bh(300), outra(200)])?.code, 330455, 'fora de ordem');
  assert.equal(I.cityOfRows([linha(900), outra(100), linha(300), linha(400), linha(500)])?.code, 355030);
  // Menos de 3 linhas: null. Parceiros não contam, nem com city_code.
  assert.equal(I.cityOfRows([linha(100), linha(200)]), null);
  assert.equal(I.cityOfRows([linha(100), linha(200), { ...linha(150), partner: true }]), null);
  assert.equal(I.cityOfRows([linha(100), linha(200), { ...PARCEIRO, partner: true }, { ...PARCEIRO, partner: true }]), null);
  // Distância como texto vale; sem distância ou sem código, a linha não conta.
  assert.equal(I.cityOfRows([linha('100'), linha('200'), linha('300')])?.code, 355030);
  assert.equal(I.cityOfRows([linha(100), linha(200), linha(undefined)]), null);
  assert.equal(I.cityOfRows([linha(100), linha(200), linha(300, null)]), null);
  // Linhas sem nome de cidade e sem a lista: não afirma.
  assert.equal(I.cityOfRows([linha(100, '355030', { city: null }), linha(200, '355030', { city: '' }), linha(300, '355030', { city: null })]), null);
  for (const v of [null, undefined, 'x', {}, []]) assert.equal(I.cityOfRows(v), null);
});

/* ======================= distâncias e raio ======================= */
test('distâncias: Paulista → centro do Rio = "363 km"; mesma conta e mesmo texto do geo-core', () => {
  assert.equal(I.fmtDist(I.kmEntre(PAULISTA, RIO) * 1000), '363 km');
  assert.equal(I.fmtDist(I.metrosEntre(PAULISTA, RIO)), '363 km');
  assert.equal(I.textoFica('Rio de Janeiro', I.metrosEntre(PAULISTA, RIO)), 'Rio de Janeiro fica a 363 km de você.');
  assert.equal(I.textoFicaA(84000), 'fica a 84 km de você');
  assert.ok(Math.abs(I.kmEntre(PAULISTA, RIO) - 362.91) < 0.01);
  for (const m of [5, 15, 420, 999, 1000, 1234, 9999, 10000, 12345, 50000]) assert.equal(I.fmtDist(m), G.formatDistance(m), String(m));
  // Sorteio fixo: a mesma conta (haversine) e o mesmo texto para qualquer par de pontos e qualquer distância.
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 500; i += 1) {
    const a = { lat: -34 + rnd() * 39, lng: -74 + rnd() * 40 }, b = { lat: a.lat + (rnd() - 0.5) * 2, lng: a.lng + (rnd() - 0.5) * 2 };
    assert.equal(I.metrosEntre(a, b), G.haversine(a, b));
    const m = rnd() * 60000;
    assert.equal(I.fmtDist(m), G.formatDistance(m), String(m));
  }
  // Modo cidade, com a pessoa na Paulista e o centro de São Paulo: a linha "a … de você" igual à conta do geo-core.
  const itens = [{ lat: -23.5598, lng: -46.6602 }, { lat: -23.5655, lng: -46.652 }, { lat: -23.6, lng: -46.7 }, { lat: -23.4, lng: -46.5 }];
  for (const it of itens) assert.equal(I.textoAteVoce(I.metrosEntre(PAULISTA, it)), `a ${G.formatDistance(G.haversine(PAULISTA, it))} de você`);
  assert.equal(I.textoAteVoce(9000), 'a 9,0 km de você');
  assert.equal(I.textoAteVoce(12345), 'a 12 km de você');
  assert.equal(I.textoAteVoce(640, true), 'a ~640 m de você');
  // Distância nos itens só com o centro a até 50 km da pessoa.
  assert.ok(I.distanciaNosItens(PAULISTA, SP_CENTRO), 'centro de SP a ~2,6 km');
  assert.ok(!I.distanciaNosItens(PAULISTA, RIO), 'Rio a 363 km');
  assert.ok(I.distanciaNosItens({ lat: 0, lng: 0 }, { lat: 0.449, lng: 0 }), '49,9 km');
  assert.ok(!I.distanciaNosItens({ lat: 0, lng: 0 }, { lat: 0.4505, lng: 0 }), '50,1 km');
  assert.ok(!I.distanciaNosItens(null, SP_CENTRO) && !I.distanciaNosItens(PAULISTA, null));
});

test('distância de cada local: a do banco; "~" quando a posição veio do endereço', () => {
  assert.equal(I.textoDistancia(420), '420 m');
  assert.equal(I.textoDistancia(640, true), '~640 m');
  assert.equal(I.textoDistancia(1234), '1,2 km');
  assert.equal(I.textoDistancia(12345), '12 km');
  assert.equal(I.distanciaDe({ distance_m: 419.6 }), 420);
  assert.equal(I.distanciaDe({ distance_m: '640' }), 640);
  const p = { lat: -23.5614, lng: -46.6559 };
  assert.equal(I.distanciaDe(p, PAULISTA), Math.round(G.haversine(PAULISTA, p)), 'sem a do banco: a conta na esfera');
  assert.equal(I.distanciaDe({ distance_m: null, ...p }, PAULISTA), Math.round(G.haversine(PAULISTA, p)));
  assert.equal(I.distanciaDe(p), null, 'sem origem e sem a do banco: sem distância');
  assert.equal(I.distanciaDe({ distance_m: -5 }), null);
  assert.ok(I.ehAproximado(CNES_ROWS[1]) && !I.ehAproximado(CNES_ROWS[0]));
  assert.ok(!I.ehAproximado({ ...PARCEIRO, partner: true, location_source: 'endereco' }), 'parceiro: endereço informado pela clínica');
});

test('posição arredondada (round3, cerca de 110 m), igual ao geo-core', () => {
  for (const v of [-23.56512, -46.65234, -23.5655, 0.0004, -0.0005, 12.3456789, -8.0476, 179.9999]) assert.equal(I.round3(v), G.roundCoord(v, 3), String(v));
  assert.deepEqual(I.aproximar({ coords: { latitude: -23.56512, longitude: -46.65234, accuracy: 30 }, timestamp: 1 }), PAULISTA);
  assert.deepEqual(I.aproximar({ latitude: -23.56512, longitude: -46.65234 }), PAULISTA);
  assert.deepEqual(I.aproximar({ lat: -8.04756, lng: -34.87712 }), { lat: -8.048, lng: -34.877 });
  for (const v of [null, undefined, {}, { coords: {} }, { coords: { latitude: '1', longitude: 2 } }, { lat: 91, lng: 0 }, { lat: 0, lng: NaN }]) {
    assert.equal(I.aproximar(v), null, JSON.stringify(v));
  }
});

test('proximoRaio: 2000 → 10000 → 50000 → null; com 3 locais ou mais, não amplia', () => {
  assert.equal(I.proximoRaio(2000), 10000);
  assert.equal(I.proximoRaio(10000), 50000);
  assert.equal(I.proximoRaio(50000), null);
  assert.equal(I.proximoRaio(2000, 2), 10000);
  assert.equal(I.proximoRaio(10000, 0), 50000);
  assert.equal(I.proximoRaio(2000, 3), null);
  assert.equal(I.proximoRaio(10000, 10), null);
  assert.equal(I.proximoRaio(5000), 10000);
  assert.equal(I.proximoRaio(NaN), null);
  // No máximo 3 chamadas por aba e origem.
  const raios = [];
  for (let r = I.RAIOS[0]; r != null; r = I.proximoRaio(r, 0)) raios.push(r);
  assert.deepEqual(raios, [2000, 10000, 50000]);
});

/* ======================= nomes de cidade, endereços e chamadas ======================= */
test('deCidade igual ao confianca.deCidade; citySlug igual ao slugify do gerar-cidades (318 cidades)', () => {
  assert.equal(CIDADES.length, 318);
  for (const c of CIDADES) {
    assert.equal(I.deCidade(c.name), deCidadeConfianca(c.name), c.name);
    assert.equal(I.citySlug(c.name), slugify(c.name), c.name);
    assert.equal(I.cityUrl(c), cityDir(c), c.name);
  }
  for (const n of ['Rio de Janeiro', 'Rio Grande', 'Recife', 'Crato', 'Guarujá', 'Campinas', 'São Paulo', 'Rio Branco']) {
    assert.equal(I.deCidade(n), deCidadeConfianca(n), n);
  }
  assert.equal(I.deCidade('Rio de Janeiro'), 'do Rio de Janeiro');
  assert.equal(I.deCidade('Campinas'), 'de Campinas');
  assert.equal(I.citySlug("Santa Bárbara d'Oeste"), 'santa-barbara-d-oeste');
  assert.equal(I.cityUrl({ name: 'São Paulo', uf: 'SP' }), 'cidades/sp/sao-paulo/');
});

test('chamadas ao banco: posição com no máximo 3 casas, raio, limite e tipo só com aba', () => {
  const pessoa = { lat: -23.56512, lng: -46.65234 };
  assert.deepEqual(I.argsLista(pessoa), { p_lat: -23.565, p_lng: -46.652, p_radius_m: 2000, p_limit: 10 });
  assert.deepEqual(I.argsLista(pessoa, 10000, 'laboratorio'), { p_lat: -23.565, p_lng: -46.652, p_radius_m: 10000, p_limit: 10, p_kind: 'laboratorio' });
  assert.deepEqual(I.argsLista(pessoa, 2000, 'xyz'), { p_lat: -23.565, p_lng: -46.652, p_radius_m: 2000, p_limit: 10 }, 'tipo desconhecido não vai');
  assert.deepEqual(I.argsParceiros(pessoa, 50000), { p_lat: -23.565, p_lng: -46.652, p_radius_m: 50000, p_include_demo: false, p_limit: 100 });
  assert.deepEqual(I.argsPontos(pessoa), { p_lat: -23.565, p_lng: -46.652, p_radius_m: 2000, p_limit: 3000 });
  assert.equal(I.PONTOS_SELECT, 'cnes,name,kind,lat,lng,distance_m,total');
  for (const o of [I.argsLista(pessoa, 2000, 'imagem'), I.argsParceiros(pessoa), I.argsPontos(pessoa)]) {
    assert.ok(!/\d\.\d{4}/.test(JSON.stringify(o)), JSON.stringify(o));
  }
  assert.equal(I.chaveCache(pessoa, 'laboratorio', 2000), '-23.565,-46.652|laboratorio|2000');
  assert.equal(I.chaveCache(pessoa, '', 10000), '-23.565,-46.652||10000');
  assert.equal(I.chaveCache(pessoa, 2000), '-23.565,-46.652|2000');
  // Total da área ("Ver todos os N"): o total da 1ª linha do CNES + os parceiros do mesmo tipo.
  assert.equal(I.totalDe([{ total: 1024 }]), 1024);
  assert.equal(I.totalDe([{ total: '57' }]), 57);
  for (const v of [[], [{}], [{ total: -1 }], [{ total: 'x' }], null]) assert.equal(I.totalDe(v), null, JSON.stringify(v));
  const par = [{ kind: 'imagem' }, { kind: 'imagem' }, { kind: 'laboratorio' }];
  assert.equal(I.totalDaArea([{ total: 1020 }], par), 1023);
  assert.equal(I.totalDaArea([{ total: 1020 }], par, 'imagem'), 1022);
  assert.equal(I.totalDaArea([], par, 'laboratorio'), 1, 'lista vazia: 0 do CNES');
  assert.equal(I.totalDaArea([{ name: 'sem total' }], par), null);
  assert.equal(I.totalDaArea(null, par), null);
});

/* ======================= lista e mapa ======================= */
test('lista: CNES e parceiros misturados só pela distância, até 10, filtrados pela aba', () => {
  const lista = I.montarLista(CNES_ROWS, [PARCEIRO]);
  assert.deepEqual(lista.map((r) => r.name), ['Clínica Parceira Paulista', 'Hospital Santa Exemplo', 'Laboratório Análise Paulista', 'Centro de Imagem <b>Teste</b>']);
  assert.deepEqual(lista.map((r) => r.key), [`imed:${PARCEIRO.id}`, 'cnes:2077485', 'cnes:6543210', 'cnes:7000001']);
  assert.deepEqual(lista.map((r) => r.partner), [true, false, false, false]);
  assert.equal(lista[0].uf, 'SP', 'parceiro: UF da coluna state');
  assert.deepEqual(lista.map((r) => r.distance_m), [300, 420, 640, 900]);
  assert.equal(CNES_ROWS[0].partner, undefined, 'não mexe nas linhas recebidas');
  assert.deepEqual(I.montarLista(CNES_ROWS, [PARCEIRO], { tipo: 'imagem' }).map((r) => r.name), ['Clínica Parceira Paulista', 'Centro de Imagem <b>Teste</b>']);
  assert.deepEqual(I.montarLista(CNES_ROWS, [PARCEIRO], { tipo: 'laboratorio' }).map((r) => r.name), ['Laboratório Análise Paulista']);
  assert.deepEqual(I.montarLista(CNES_ROWS, [PARCEIRO], { tipo: 'xyz' }).length, 4, 'tipo desconhecido: todos');
  assert.equal(I.montarLista(CNES_ROWS, [PARCEIRO], { limite: 2 }).length, 2);
  const muitos = Array.from({ length: 14 }, (_, i) => ({ ...CNES_ROWS[0], cnes: String(8000000 + i), name: `Local ${i}`, distance_m: 2000 - i * 100 }));
  const dez = I.montarLista(muitos, []);
  assert.equal(dez.length, 10);
  assert.deepEqual(dez.slice(0, 2).map((r) => r.distance_m), [700, 800]);
  // Linhas sem nome ou sem posição ficam de fora; sem a distância do banco, a conta pela origem.
  const ruins = [{ ...CNES_ROWS[0], name: '' }, { ...CNES_ROWS[0], lat: NaN }, null, { ...CNES_ROWS[0], lng: '1' }];
  assert.equal(I.montarLista(ruins, [null, { ...PARCEIRO, name: undefined }]).length, 0);
  const semDist = I.montarLista([], [{ ...PARCEIRO, distance_m: undefined }], { origem: PAULISTA });
  assert.equal(semDist[0].distance_m, Math.round(G.haversine(PAULISTA, PARCEIRO)));
  // Empate na distância: parceiro primeiro; entre iguais, o nome.
  const empate = I.montarLista([{ ...CNES_ROWS[2], name: 'B', distance_m: 300 }, { ...CNES_ROWS[2], cnes: '7000002', name: 'A', distance_m: 300 }], [PARCEIRO]);
  assert.deepEqual(empate.map((r) => r.name), ['Clínica Parceira Paulista', 'A', 'B']);
  assert.deepEqual(I.montarLista(null, null), []);
});

test('item: tipo · bairro, selos só com o dado e "Parceiro do IMED"', () => {
  assert.equal(I.linhaTipo({ ...PARCEIRO, partner: true }), 'Parceiro do IMED · Diagnóstico por imagem · Bela Vista');
  assert.equal(I.linhaTipo(CNES_ROWS[0]), 'Hospital · Cerqueira César');
  assert.equal(I.linhaTipo({ kind: 'laboratorio' }), 'Laboratório');
  assert.equal(I.linhaTipo({ kind: 'outro', neighborhood: 'Centro' }), 'Clínica · Centro');
  assert.equal(I.linhaTipo({ kind: 'constructor' }), 'Clínica');
  assert.deepEqual(I.selos(CNES_ROWS[0]), ['Aberto 24 horas']);
  assert.deepEqual(I.selos(CNES_ROWS[1]), ['Atende SUS']);
  assert.deepEqual(I.selos({ open_24h: true, sus: true }), ['Aberto 24 horas', 'Atende SUS']);
  assert.deepEqual(I.selos({ ...PARCEIRO, partner: true, sus: true, open_24h: true }), ['Aberto 24 horas'], 'SUS só do CNES');
  assert.deepEqual(I.selos({ open_24h: 'true', sus: 1 }), []);
  assert.deepEqual(I.selos(null), []);
  assert.equal(I.sufixoOrigem('perto'), ' de você');
  assert.equal(I.sufixoOrigem('cidade', { name: 'Campinas' }), ' do centro de Campinas');
  assert.equal(I.sufixoOrigem('cidade', { name: 'Rio de Janeiro' }), ' do centro do Rio de Janeiro');
  assert.equal(I.textoMostrarMais(4), 'Mostrar mais 4');
});

test('mapa: legenda com os 4 números reais por tipo (com "+" quando a área tem mais pontos), título e ponto da origem', () => {
  const pontos = CNES_ROWS.map(({ cnes, name, kind, lat, lng }) => ({ cnes, name, kind, lat, lng }));
  const leg = I.legendaTipos(pontos, [PARCEIRO], 3);
  assert.deepEqual(leg.map((x) => x.texto), ['2', '1', '0', '1']);
  assert.deepEqual(leg.map((x) => x.nome), ['Imagem', 'Laboratórios', 'Clínicas', 'Hospitais']);
  assert.deepEqual(leg.map((x) => x.n), [2, 1, 0, 1]);
  assert.deepEqual(I.legendaTipos(pontos, [PARCEIRO], 5).map((x) => x.texto), ['2+', '1+', '0+', '1+']);
  assert.deepEqual(I.legendaTipos(pontos, [], null).map((x) => x.texto), ['1', '1', '0', '1']);
  const mil = Array.from({ length: 1500 }, () => ({ kind: 'clinica' }));
  assert.equal(I.legendaTipos(mil, [], '1500')[2].texto, '1.500');
  assert.deepEqual(I.legendaTipos(null, null).map((x) => x.texto), ['0', '0', '0', '0']);
  assert.equal(I.textoLegenda(), 'Em até 2 km');
  assert.equal(I.textoLegenda(10000), 'Em até 10 km');
  assert.equal(I.tituloMapa('São Paulo - SP', 'laboratorio'), 'Mapa · São Paulo - SP · Laboratórios');
  assert.equal(I.tituloMapa('Campinas - SP'), 'Mapa · Campinas - SP');
  assert.equal(I.rotuloPontoOrigem('perto'), 'Você (aproximado)');
  assert.equal(I.rotuloPontoOrigem('cidade', { name: 'Campinas' }), 'Centro de Campinas');
  assert.equal(I.rotuloPontoOrigem('cidade', { name: 'Recife' }), 'Centro do Recife');
});

test('cores dos números: contraste de pelo menos 4,5:1 com o número branco', () => {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contraste = (hex) => (1.05 / (lum(hex) + 0.05));
  assert.deepEqual(I.ORDEM_TIPOS.map((k) => I.TIPOS[k].cor), ['#0E7C9C', '#6C4BD8', '#137A44', '#BF3B20']);
  assert.deepEqual(I.ORDEM_TIPOS.map((k) => contraste(I.TIPOS[k].cor).toFixed(2)), ['4.79', '5.78', '5.39', '5.44']);
  for (const k of I.ORDEM_TIPOS) assert.ok(contraste(I.TIPOS[k].cor) >= 4.5, k);
  // As cores antigas da clínica e do hospital não passavam.
  assert.ok(contraste('#1E9E5A') < 4.5 && contraste('#E8512F') < 4.5);
});

/* ======================= textos ======================= */
test('textoResumo: gênero e número certos', () => {
  const campinas = { name: 'Campinas' };
  const casos = [
    [{ n: 10 }, 'Os 10 mais perto de você'],
    [{ n: 10, modo: 'cidade', cidade: campinas }, 'Os 10 mais perto do centro de Campinas'],
    [{ n: 7, modo: 'cidade', cidade: { name: 'Rio de Janeiro' } }, 'Os 7 mais perto do centro do Rio de Janeiro'],
    [{ tipo: 'laboratorio', n: 10 }, 'Os 10 laboratórios mais perto de você'],
    [{ tipo: 'hospital', n: 1 }, 'O hospital mais perto de você'],
    [{ tipo: 'clinica', n: 1 }, 'A clínica mais perto de você'],
    [{ tipo: 'clinica', n: 7, modo: 'cidade', cidade: campinas }, 'As 7 clínicas mais perto do centro de Campinas'],
    [{ tipo: 'imagem', n: 4 }, 'Os 4 locais de diagnóstico por imagem mais perto de você'],
    [{ tipo: 'imagem', n: 1 }, 'O local de diagnóstico por imagem mais perto de você'],
    [{ n: 1 }, 'O local mais perto de você'],
    [{ tipo: 'hospital', n: 3, raio: 10000, primeiro: 0 }, 'Nenhum hospital em até 2 km. Os mais perto, em até 10 km:'],
    [{ tipo: 'clinica', n: 5, raio: 10000, primeiro: 2 }, 'Poucas clínicas em até 2 km. As mais perto, em até 10 km:'],
    [{ tipo: 'clinica', n: 1, raio: 50000, primeiro: 0 }, 'Nenhuma clínica em até 2 km. A mais perto, em até 50 km:'],
    [{ tipo: 'hospital', n: 1, raio: 50000, primeiro: 1 }, 'Poucos hospitais em até 2 km. O mais perto, em até 50 km:'],
    [{ tipo: 'laboratorio', n: 2, raio: 10000, primeiro: 2 }, 'Poucos laboratórios em até 2 km. Os mais perto, em até 10 km:'],
    [{ n: 6, raio: 10000, primeiro: 2 }, 'Poucos locais em até 2 km. Os mais perto, em até 10 km:'],
    [{ n: 4, raio: 50000, primeiro: 0 }, 'Nenhum local em até 2 km. Os mais perto, em até 50 km:'],
    [{ tipo: 'imagem', n: 0, raio: 50000 }, 'Nenhum local de diagnóstico por imagem do cadastro oficial em até 50 km daqui.'],
    [{ tipo: 'clinica', n: 0, raio: 50000 }, 'Nenhuma clínica do cadastro oficial em até 50 km daqui.'],
    [{ tipo: 'hospital', n: 0, raio: 50000 }, 'Nenhum hospital do cadastro oficial em até 50 km daqui.'],
    [{ tipo: 'laboratorio', n: 0, raio: 50000, modo: 'cidade', cidade: { name: 'Recife' } }, 'Nenhum laboratório do cadastro oficial em até 50 km do centro do Recife.'],
    [{ n: 0, raio: 50000 }, 'Nenhum local do cadastro oficial em até 50 km daqui.'],
  ];
  for (const [entrada, frase] of casos) assert.equal(I.textoResumo(entrada), frase, JSON.stringify(entrada));
  assert.equal(I.textoResumo({ n: 10, modo: 'cidade' }), 'Os 10 mais perto de você', 'modo cidade sem cidade');
});

test('"Ver todos": perto (com o número real, sem ele quando falta) e cidade (só com a página da cidade)', () => {
  assert.deepEqual(I.verTodos({ total: 1024 }), { texto: 'Ver todos os 1.024 locais em até 2 km, com filtros', href: 'perto.html?usar=localizacao' });
  assert.equal(I.verTodos({ total: null }).texto, 'Ver todos os locais em até 2 km, com filtros');
  assert.equal(I.verTodos({}).texto, 'Ver todos os locais em até 2 km, com filtros');
  assert.equal(I.verTodos({ total: 57, tipo: 'laboratorio' }).texto, 'Ver todos os 57 laboratórios em até 2 km, com filtros');
  assert.equal(I.verTodos({ total: 12, tipo: 'clinica' }).texto, 'Ver todas as 12 clínicas em até 2 km, com filtros');
  assert.equal(I.verTodos({ tipo: 'clinica' }).texto, 'Ver todas as clínicas em até 2 km, com filtros');
  assert.equal(I.verTodos({ total: 1, tipo: 'hospital' }).texto, 'Ver o hospital em até 2 km, com filtros');
  assert.equal(I.verTodos({ total: 30, raio: 10000 }).texto, 'Ver todos os 30 locais em até 10 km, com filtros');
  assert.deepEqual(I.verTodos({ modo: 'cidade', cidade: { name: 'Campinas', uf: 'SP' }, temPagina: true }), { texto: 'Ver todos os locais de Campinas, por tipo', href: 'cidades/sp/campinas/' });
  assert.deepEqual(I.verTodos({ modo: 'cidade', cidade: RIO, temPagina: true }), { texto: 'Ver todos os locais do Rio de Janeiro, por tipo', href: 'cidades/rj/rio-de-janeiro/' });
  assert.deepEqual(I.verTodos({ modo: 'cidade', cidade: RIO, temPagina: false }), { texto: 'Todas as cidades', href: 'cidades/' });
  assert.deepEqual(I.verTodos({ modo: 'cidade', cidade: { name: 'X', uf: 'xx' }, temPagina: true }), { texto: 'Todas as cidades', href: 'cidades/' });
});

test('rótulos da origem: topo, linha da cidade e busca do topo', () => {
  const linhaPerto = 'Distâncias medidas da sua localização aproximada.';
  assert.deepEqual(I.rotulosOrigem({ modo: 'perto', regiao: SP_REGIAO }), { pequeno: 'Sua região', principal: 'São Paulo - SP', busca: 'São Paulo', rotulo: 'Sua região', botao: 'São Paulo - SP', trocar: true, linha: linhaPerto });
  assert.deepEqual(I.rotulosOrigem({ modo: 'perto' }), { pequeno: 'Perto de você', principal: 'Sua localização', busca: 'Sua localização', rotulo: 'Perto de você', botao: 'Sua localização', trocar: true, linha: linhaPerto });
  assert.deepEqual(I.rotulosOrigem({ modo: 'cidade', cidade: CAMPINAS }), { pequeno: 'Cidade escolhida', principal: 'Campinas - SP', busca: 'Campinas', rotulo: 'Cidade escolhida', botao: 'Campinas - SP', trocar: true, linha: 'Distâncias medidas do centro de Campinas.' });
  assert.equal(I.rotulosOrigem({ modo: 'cidade', cidade: RIO, here: PAULISTA }).linha, 'Distâncias medidas do centro do Rio de Janeiro. Rio de Janeiro fica a 363 km de você.');
  assert.deepEqual(I.rotulosOrigem({ buscando: true }), { pequeno: 'Sua localização', principal: 'Procurando…', busca: 'Sua localização', rotulo: 'Onde você está?', botao: 'Escolher cidade', trocar: false, linha: '' });
  const nada = { pequeno: 'Onde você está?', principal: 'Escolher cidade', busca: 'Escolher cidade', rotulo: 'Onde você está?', botao: 'Escolher cidade', trocar: false, linha: '' };
  assert.deepEqual(I.rotulosOrigem(), nada);
  assert.deepEqual(I.rotulosOrigem({ modo: 'cidade' }), nada, 'modo cidade sem cidade');
  assert.equal(I.TEXTOS.trocarEscondido, ': trocar a cidade');
  assert.equal(I.textoRegiao(SP_REGIAO), 'Sua região: São Paulo - SP');
  assert.equal(I.textoProcurandoCentro('Campinas'), 'Procurando o centro de Campinas…');
  assert.equal(I.textoProcurandoCentro('Rio de Janeiro'), 'Procurando o centro do Rio de Janeiro…');
  assert.equal(I.textoToastCidade('Campinas'), 'Mostrando os locais perto do centro de Campinas');
});

test('#nearCta: o local mais perto de verdade, com a distância; sem ele, o texto padrão', () => {
  assert.equal(I.textoNearCta(), 'Clínicas, laboratórios e hospitais reais, no mapa');
  assert.equal(I.textoNearCta({ modo: 'perto', item: { ...PARCEIRO, partner: true } }), 'Mais perto: Clínica Parceira Paulista, a 300 m');
  assert.equal(I.textoNearCta({ modo: 'cidade', cidade: CAMPINAS, item: { name: 'Hospital X', distance_m: 1200 } }), 'Mais perto do centro de Campinas: Hospital X, a 1,2 km');
  assert.equal(I.textoNearCta({ modo: 'perto', item: CNES_ROWS[1] }), 'Mais perto: Laboratório Análise Paulista, a ~640 m');
  assert.equal(I.textoNearCta({ modo: 'perto', item: { name: 'Sem distância' } }), 'Mais perto: Sem distância');
  assert.equal(I.textoNearCta({ modo: 'perto', item: { name: '' } }), 'Clínicas, laboratórios e hospitais reais, no mapa');
  assert.equal(I.textoNearCta({ modo: 'cidade', item: CNES_ROWS[0] }), 'Clínicas, laboratórios e hospitais reais, no mapa', 'cidade sem nome');
  assert.equal(I.textoNearCta({ item: CNES_ROWS[0] }), 'Clínicas, laboratórios e hospitais reais, no mapa', 'sem origem');
});

test('lista leve do 3D: título em 1 linha e resumo para o leitor de tela', () => {
  assert.deepEqual(I.textoLeve(), { titulo: 'Perto de você', status: 'Aguardando sua localização…' });
  assert.deepEqual(I.textoLeve({ modo: 'perto', n: 4 }), { titulo: 'Perto da sua localização', status: '4 locais perto da sua localização' });
  assert.deepEqual(I.textoLeve({ modo: 'cidade', cidade: CAMPINAS, n: 1 }), { titulo: 'Perto do centro de Campinas', status: '1 local perto do centro de Campinas' });
  assert.deepEqual(I.textoLeve({ modo: 'exemplo', n: 4 }), { titulo: 'Exemplo: perto da Av. Paulista', status: '4 locais perto da Av. Paulista, em São Paulo (exemplo)' });
  assert.deepEqual(I.textoLeve({ modo: 'perto', n: 0 }), { titulo: 'Perto da sua localização', status: null });
  assert.deepEqual(I.textoLeve({ modo: 'cidade' }), { titulo: 'Perto de você', status: 'Aguardando sua localização…' });
});

test('cartões dos estados sem lista: títulos, textos e botões da especificação', () => {
  const e = (t) => I.estadoTela(t);
  assert.deepEqual(e('aguardando'), { titulo: 'Aguardando sua permissão…', texto: 'Se o navegador perguntar, toque em Permitir.', botoes: ['prefiro'], atalhos: false });
  assert.deepEqual(e('buscando'), { titulo: 'Buscando sua localização…', texto: '', botoes: [], atalhos: false });
  assert.deepEqual(e('onde'), { titulo: 'Onde você está?', texto: 'Use sua localização ou escolha a cidade para ver as clínicas mais perto.', botoes: ['usar', 'escolher'], atalhos: true });
  assert.deepEqual(e('negada'), { titulo: 'A localização está desligada para o IMED', texto: 'Tudo bem: escolha a sua cidade. Para usar a localização depois, toque no cadeado ao lado do endereço do site e permita a localização.', botoes: ['escolher'], atalhos: true });
  assert.deepEqual(e('fechou'), { titulo: 'Sem a localização, escolha a cidade', texto: 'Você pode permitir a localização quando quiser.', botoes: ['usar', 'escolher'], atalhos: true });
  assert.deepEqual(e('naoapareceu'), { titulo: 'O navegador não mostrou o pedido de localização', texto: 'Para liberar, toque no cadeado ao lado do endereço do site e permita a localização. Ou escolha a cidade.', botoes: ['usar', 'escolher'], atalhos: true });
  assert.deepEqual(e('demorou'), { titulo: 'A localização demorou para responder', texto: 'Veja se a localização do aparelho está ligada e tente de novo, ou escolha a cidade.', botoes: ['tentar', 'escolher'], atalhos: true });
  assert.deepEqual(e('indisponivel'), { titulo: 'Não conseguimos descobrir onde você está', texto: 'Veja se a localização do aparelho está ligada e tente de novo, ou escolha a cidade.', botoes: ['tentar', 'escolher'], atalhos: true });
  assert.deepEqual(e('sem-suporte'), { titulo: '', texto: 'Seu navegador não informa a localização. Escolha a cidade para ver os locais.', botoes: ['escolher'], atalhos: true });
  assert.deepEqual(e('vazio'), { titulo: 'Ainda não temos o cadastro oficial desta região', texto: 'Na busca completa, o IMED começa a trazer os dados do CNES da sua cidade e mostra o mapa público.', botoes: ['busca', 'outra'], atalhos: false });
  assert.deepEqual(e('erro'), { titulo: 'Não foi possível carregar os locais agora.', texto: 'Verifique sua internet e tente de novo.', botoes: ['tentar'], atalhos: false });
  assert.equal(e('lista'), null);
  assert.equal(e('xyz'), null);
  assert.deepEqual([...I.TELAS], ['lista', 'aguardando', 'buscando', 'onde', 'negada', 'fechou', 'naoapareceu', 'demorou', 'indisponivel', 'sem-suporte', 'vazio', 'erro']);
  // Toda tela do plano existe; todo botão tem texto.
  for (const p of ['cidade', 'silencioso', 'pedir', 'esperar', 'bloqueada', 'sem-suporte']) {
    const tela = I.geoPlan({ cidade: p === 'cidade' ? RIO : null, permissao: { silencioso: 'granted', bloqueada: 'denied' }[p] ?? 'prompt', suporte: p !== 'sem-suporte', pedidoNaAba: p === 'esperar' }).tela;
    assert.ok(I.TELAS.includes(tela), `${p} → ${tela}`);
  }
  for (const t of I.TELAS) for (const b of e(t)?.botoes ?? []) assert.ok(I.BOTOES[b], `${t}: ${b}`);
  assert.deepEqual({ ...I.BOTOES }, { prefiro: 'Prefiro escolher a cidade', escolher: 'Escolher minha cidade', usar: 'Usar minha localização', tentar: 'Tentar de novo', busca: 'Abrir a busca completa', outra: 'Escolher outra cidade' });
  e('onde').botoes.push('x');
  assert.deepEqual(e('onde').botoes, ['usar', 'escolher'], 'cópia: quem usa não muda o original');
});

test('textos do aviso, do status, do seletor e do mapa', () => {
  const T = I.TEXTOS;
  assert.match(T.aviso, /região aproximada/);
  assert.match(T.aviso, /não gravamos/);
  assert.equal(T.avisoNaoApareceu, 'Não apareceu a pergunta? Toque no ícone de localização ao lado do endereço do site ou escolha a cidade.');
  assert.deepEqual([T.avisoPrefiro, T.avisoSaibaMais, T.avisoFechar], ['Prefiro escolher a cidade', 'Saiba mais', 'Fechar aviso']);
  assert.equal(I.LINKS.privacidade, 'privacidade.html#localizacao');
  assert.deepEqual([T.statusPediu, T.statusPronto, T.statusSem], [
    'O IMED pediu sua localização para mostrar as clínicas mais perto.',
    'Pronto! Mostrando as clínicas perto de você.',
    'Sem a sua localização. Escolha a cidade para ver os locais.',
  ]);
  assert.equal(T.titulo, 'Clínicas perto de você');
  assert.equal(T.kicker, 'Cadastro oficial · Ministério da Saúde');
  assert.equal(T.fonte, 'Endereços do CNES, base pública do Ministério da Saúde. O IMED é um serviço privado, sem vínculo com o governo ou o SUS. Valores e horários são confirmados com o local.');
  assert.deepEqual([T.seletorTitulo, T.seletorRotulo, T.seletorExemplo, T.seletorDica], ['Escolha a cidade', 'Cidade', 'Digite o nome da cidade', 'Use as setas para escolher e Enter para confirmar.']);
  assert.match(T.seletorAjuda, /^Para liberar: no computador, clique no cadeado/);
  assert.equal(T.mapaSemOrigem, 'O mapa aparece quando você permite a localização ou escolhe a cidade.');
  assert.deepEqual([I.LINKS.pertoDeMim, I.LINKS.cidades, I.LINKS.naoAchou], ['perto.html?usar=localizacao', 'cidades/', 'perto.html']);
});

test('nenhum texto com "a partir de" (nem preço, nota ou "você está em")', () => {
  const textos = [];
  const add = (v) => {
    if (typeof v === 'string') textos.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === 'object') Object.values(v).forEach(add);
  };
  add(I.TEXTOS); add(I.BOTOES); add(I.ABAS); add(Object.values(I.TIPOS));
  for (const t of I.TELAS) add(I.estadoTela(t));
  const cidades = [null, { name: 'Campinas', uf: 'SP' }, RIO];
  for (const tipo of ['', ...I.ORDEM_TIPOS]) {
    for (const raio of I.RAIOS) {
      for (const n of [0, 1, 2, 10]) for (const primeiro of [0, 1]) for (const modo of ['perto', 'cidade']) for (const cidade of cidades) add(I.textoResumo({ tipo, n, raio, primeiro, modo, cidade }));
      for (const total of [null, 1, 1024]) add(I.verTodos({ tipo, raio, total }).texto);
    }
    add(I.tituloMapa('São Paulo - SP', tipo));
  }
  for (const cidade of cidades) {
    add(I.verTodos({ modo: 'cidade', cidade, temPagina: true }));
    for (const modo of ['perto', 'cidade', 'exemplo', null]) add(I.textoLeve({ modo, cidade, n: 4 }));
    for (const modo of ['perto', 'cidade', null]) {
      add(I.rotulosOrigem({ modo, cidade, regiao: SP_REGIAO, here: PAULISTA }));
      add(I.textoNearCta({ modo, cidade, item: CNES_ROWS[1] }));
    }
  }
  add(I.rotulosOrigem({ buscando: true }));
  for (const permissao of ['prompt', 'granted', 'denied']) for (const ativa of [true, false]) add(I.estadoGeoSeletor({ permissao, ativa, regiao: SP_REGIAO }));
  add(I.estadoGeoSeletor({ suporte: false })); add(I.estadoGeoSeletor({ aguardando: true }));
  for (const n of [0, 1, 12, 120]) add(I.textoContagemCidades(n));
  add([I.textoLocais(6548), I.textoLocais(1120, true), I.textoRegiao(SP_REGIAO), I.textoProcurandoCentro('Campinas'), I.textoToastCidade('Campinas')]);
  add([I.textoFica('Campinas', 84000), I.textoAteVoce(9000), I.textoLegenda(), I.textoMostrarMais(4), I.rotuloPontoOrigem('perto'), I.rotuloPontoOrigem('cidade', RIO)]);
  add([I.linhaTipo({ ...PARCEIRO, partner: true }), I.selos({ open_24h: true, sus: true })]);
  add(I.legendaTipos([], [], 10));
  assert.ok(textos.length > 500, `${textos.length} textos`);
  for (const t of textos) {
    assert.ok(!/a partir d/i.test(t), t);
    assert.ok(!/R\$|★|\bnota\b|você está em/i.test(t), t);
  }
  // Nem nos comentários do arquivo.
  assert.ok(!/a partir d/i.test(SRC), 'inicio-core.js com "a partir de"');
});

test('módulo puro: sem página, sem armazenamento, sem rede e sem importar outros arquivos', () => {
  const codigo = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  assert.ok(!/\b(document|window|globalThis|localStorage|sessionStorage|indexedDB|navigator|location|fetch|XMLHttpRequest|setTimeout|addEventListener)\b/.test(codigo),
    codigo.match(/\b(document|window|globalThis|localStorage|sessionStorage|indexedDB|navigator|location|fetch|XMLHttpRequest|setTimeout|addEventListener)\b/)?.[0]);
  assert.ok(!/^\s*import\b|\bimport\(/m.test(codigo), 'sem import: a página inicial não baixa o geo-core (52 KB) por causa dele');
  assert.ok(!/\bconsole\./.test(codigo));
  // Roda em todo iPhone com iOS 15 (como o resto da página inicial): nada que só chegou no Safari 15.4 ou depois.
  assert.ok(!/Object\.hasOwn\(|\.at\(|\.replaceAll\(|structuredClone|\.findLast|\.toSorted\(|\.groupBy\(/.test(codigo));
});
