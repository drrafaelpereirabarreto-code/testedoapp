// Testes do dicionário de nomes de exames (assets/js/exames-nomes.js, melhoria L2): nome do dia a dia, sigla, sem
// acento e uma letra errada levam ao código da busca; o exame sai do texto e fica só o lugar; nome de cidade nunca
// vira exame; o catálogo da teleconsulta é todo achado.
// Rodar com: node --test tests/exames-nomes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { posix } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as N from '../assets/js/exames-nomes.js';
import * as G from '../assets/js/geo-core.js';
import * as T from '../assets/js/tele-core.js';

const ROOT = new URL('..', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const CIDADES = JSON.parse(read('scripts/cidades.json'));
const exames = (q) => N.separar(q).exames;
const lugar = (q) => N.separar(q).lugar;

test('códigos iguais aos da busca do site, da página inicial e da teleconsulta', () => {
  const data = runInNewContext(`${read('assets/js/data.js')}\n;({ EXAMS })`);
  const ordem = (a) => [...a].sort();
  assert.deepEqual(ordem(N.CODIGOS), ordem(Object.keys(G.EXAMS)));
  assert.deepEqual(ordem(N.CODIGOS), ordem(Object.keys(data.EXAMS)));
  assert.deepEqual(ordem(N.CODIGOS), ordem(Object.keys(T.SEARCH)));
});

test('nome do dia a dia, sigla e sem acento: tireoide e TSH dão laboratório; ecografia e USG dão ultrassom; tomo dá tomografia', () => {
  for (const q of ['tireoide', 'tireóide', 'exame de tireoide', 'TSH', 'hemograma', 'exame de sangue', 'beta', 'beta-hCG', 'beta hcg', 'BHCG',
    'exame de gravidez', 'teste de gravidez', 'EAS', 'urina tipo 1', 'exame de urina', 'glicemia', 'colesterol', 'vitamina D', 'laboratório']) {
    assert.deepEqual(exames(q), ['lab'], q);
  }
  for (const q of ['ecografia', 'USG', 'usg', 'ultrassom', 'ultrassonografia', 'ultra-som', 'ultra som', 'doppler', 'transvaginal']) assert.deepEqual(exames(q), ['usg'], q);
  for (const q of ['tomo', 'TC', 'tomografia', 'tomografia computadorizada', 'angiotomografia']) assert.deepEqual(exames(q), ['tc'], q);
  for (const q of ['ressonancia', 'RESSONÂNCIA', 'ressonância magnética', 'RM', 'RNM']) assert.deepEqual(exames(q), ['rm'], q);
  for (const q of ['raio x', 'raio-x', 'RaioX', 'RX', 'radiografia', 'chapa']) assert.deepEqual(exames(q), ['rx'], q);
  for (const q of ['eletro', 'ECG', 'eletrocardiograma']) assert.deepEqual(exames(q), ['ecg'], q);
  for (const q of ['ecocardiograma', 'eco do coração', 'eco cardiograma']) assert.deepEqual(exames(q), ['eco'], q);
  assert.deepEqual(exames('mamo'), ['mamo']);
  assert.deepEqual(exames('densitometria óssea'), ['dens']);
  // O que o texto ligou, para a página mostrar: "também chamado de" (apelido) ou o nome digitado.
  assert.deepEqual(N.separar('USG').achados, [{ codigos: ['usg'], nome: 'USG', tipo: 'a', erro: false, digitado: 'USG' }]);
  assert.deepEqual(N.separar('hemograma em Campinas').achados, [{ codigos: ['lab'], nome: 'Hemograma', tipo: 'e', erro: false, digitado: 'hemograma' }]);
  assert.equal(N.separar('ressonância').achados[0].tipo, 'n');
  assert.equal(N.minusculo('Ecografia'), 'ecografia');
  assert.equal(N.minusculo('USG'), 'USG');
  assert.equal(N.minusculo('RNM'), 'RNM');
});

test('uma letra errada (trocada, a menos, a mais ou invertida) só em palavras de 7 letras ou mais', () => {
  for (const [q, k] of [['resonancia', 'rm'], ['ressonãncia', 'rm'], ['ultrasom', 'usg'], ['ultrason', 'usg'], ['hemogrma', 'lab'], ['hemograam', 'lab'],
    ['mamografa', 'mamo'], ['tomogarfia', 'tc'], ['eletrocardiogama', 'ecg'], ['ecocardiogarma', 'eco'], ['densiometria', 'dens'], ['ecogafia', 'usg'],
    ['radiogrfia', 'rx'], ['triglicerides', 'lab'], ['tiroide', 'lab']]) {
    assert.deepEqual(exames(q), [k], q);
  }
  const r = N.separar('resonancia em Campinas');
  assert.deepEqual([r.exames, r.lugar, r.achados[0].erro, r.achados[0].digitado], [['rm'], 'Campinas', true, 'resonancia']);
  // Duas letras erradas, ou palavra curta com uma letra errada: não vira exame.
  for (const q of ['resonanica', 'ultrazonn', 'tomp', 'ecco', 'mamu', 'Areia', 'Mangue', 'beto', 'urinha', 'sangui']) assert.deepEqual(exames(q), [], q);
  assert.equal(N.distancia('ressonancia', 'resonancia'), 1);
  assert.equal(N.distancia('tomografia', 'tomogarfia'), 1, 'duas letras vizinhas trocadas contam como uma');
  assert.equal(N.distancia('abc', 'xyz'), 3);
  assert.equal(N.distancia('campinas', 'hemograma', 1), 2, 'para de contar depois do máximo');
  assert.ok(N.parecida('hemogrma', 'hemograma') && !N.parecida('ureia', 'areia') && !N.parecida('sangue', 'mangue'));
  assert.ok(N.comecoParecido('resson', 'ressonancia') && N.comecoParecido('resonan', 'ressonancia') && !N.comecoParecido('resona', 'ressonancia'));
});

test('"eco" dá as duas opções (ecocardiograma ou ultrassom) e o site não escolhe sozinho', () => {
  const r = N.separar('eco');
  assert.deepEqual(r.exames, ['eco', 'usg']);
  assert.deepEqual(r.achados[0].codigos, ['eco', 'usg']);
  assert.deepEqual([N.separar('eco em Recife').exames, lugar('eco em Recife')], [['eco', 'usg'], 'Recife']);
  const s = N.sugerir('eco');
  assert.equal(s.ambiguo, 'Eco');
  assert.deepEqual(s.itens.map((i) => i.codigo), ['eco', 'usg']);
  assert.deepEqual(s.exames, ['eco', 'usg']);
  // Mais de um exame escrito: também é a pessoa quem escolhe.
  assert.deepEqual(exames('ultrassom e raio x em Campinas'), ['usg', 'rx']);
  // "ecocardiograma com doppler" é um exame só (o catálogo da teleconsulta o tem como outro nome do ecocardiograma);
  // "eco com doppler" e "ecodoppler" (também o nome do doppler das veias) continuam com as duas opções.
  for (const q of ['ecocardiograma com doppler', 'Ecocardiograma com Doppler colorido', 'ecodopplercardiograma', 'ecocardiograma transtorácico']) assert.deepEqual(exames(q), ['eco'], q);
  for (const q of ['ultrassom com doppler', 'ultrassom doppler colorido', 'doppler colorido']) assert.deepEqual(exames(q), ['usg'], q);
  for (const q of ['eco com doppler', 'ecodoppler', 'eco doppler']) assert.deepEqual(exames(q), ['eco', 'usg'], q);
  assert.equal(N.sugerir('ecodoppler').ambiguo, 'Ecodoppler');
  // Com o resto do nome, não há dúvida.
  assert.deepEqual(exames('ecografia'), ['usg']);
  assert.deepEqual(exames('eco do coração'), ['eco']);
});

test('o exame sai do texto e fica só o lugar, como a pessoa escreveu', () => {
  for (const [q, ex, l] of [
    ['ressonância em Campinas', ['rm'], 'Campinas'],
    ['ressonancia em Campinas', ['rm'], 'Campinas'],
    ['ultrassom Campinas', ['usg'], 'Campinas'],
    ['Campinas ultrassom', ['usg'], 'Campinas'],
    ['Campinas - ressonância', ['rm'], 'Campinas'],
    ['hemograma', ['lab'], ''],
    ['hemograma perto de mim', ['lab'], ''],
    ['raio x perto de casa', ['rx'], ''],
    ['perto de mim ultrassom', ['usg'], ''],
    ['exame de sangue em São Paulo', ['lab'], 'São Paulo'],
    ['onde fazer hemograma no Rio de Janeiro', ['lab'], 'Rio de Janeiro'],
    ['raio x do joelho em Campinas', ['rx'], 'Campinas'],
    ['ressonância de coluna lombar com contraste em Belo Horizonte', ['rm'], 'Belo Horizonte'],
    ['tomografia de crânio com contraste no Rio de Janeiro', ['tc'], 'Rio de Janeiro'],
    ['ultrassom de tireoide em Curitiba', ['usg'], 'Curitiba'],
    ['Rua Augusta, 900 - raio x', ['rx'], 'Rua Augusta, 900'],
    ['ressonância 01310-100', ['rm'], '01310-100'],
    ['hemograma e glicemia em Recife', ['lab'], 'Recife'],
    ['teste de covid-19 em Campinas', ['lab'], 'Campinas'],
    ['beta em Campinas', ['lab'], 'Campinas'],
    ['ultrassom na Rua da Consolação, 100', ['usg'], 'Rua da Consolação, 100'],
    // Cidades que começam com parte do corpo ou com palavra de ligação continuam inteiras.
    ['ressonância em Volta Redonda', ['rm'], 'Volta Redonda'],
    ['ultrassom em Braço do Norte', ['usg'], 'Braço do Norte'],
    ['hemograma no Pé de Serra', ['lab'], 'Pé de Serra'],
    ['ressonância em Pará de Minas', ['rm'], 'Pará de Minas'],
    ['ultrassom em Coração de Jesus', ['usg'], 'Coração de Jesus'],
    ['ressonância em Augusto Severo (Campo Grande)', ['rm'], 'Augusto Severo (Campo Grande)'],
  ]) {
    assert.deepEqual([exames(q), lugar(q)], [ex, l], q);
  }
  // Sem exame, o texto fica inteiro (vai para o mapa como antes).
  assert.deepEqual(N.separar('  Av. Paulista, 1000  '), { exames: [], achados: [], lugar: 'Av. Paulista, 1000', sobra: '' });
  assert.deepEqual(N.separar(''), { exames: [], achados: [], lugar: '', sobra: '' });
  assert.deepEqual(N.separar(null), { exames: [], achados: [], lugar: '', sobra: '' });
});

test('o que vem depois do exame só vai para o mapa se for lugar: depois de "em", vírgula, CEP, endereço ou cidade do IMED', () => {
  // Detalhe do exame (complemento, parênteses, "em jejum", "com plaquetas", 3D/4D): nada vai para o mapa.
  for (const [q, ex] of [
    ['glicemia em jejum', 'lab'], ['Raio-X de tórax (PA e perfil)', 'rx'], ['Doppler venoso de membros inferiores', 'usg'],
    ['raio x panorâmico', 'rx'], ['teste rápido de HIV', 'lab'], ['beta hcg quantitativo', 'lab'], ['hemograma com plaquetas', 'lab'],
    ['colesterol total e frações', 'lab'], ['ultrassom 3D', 'usg'], ['ultrassom morfológico 4D', 'usg'], ['T4 livre', 'lab'],
    ['ressonância de joelho com contraste', 'rm'], ['exame de sangue para HIV', 'lab'], ['hemograma para cirurgia', 'lab'],
    ['ultrassom obstétrico com doppler', 'usg'], ['ultrassom, doppler', 'usg'],
  ]) {
    assert.deepEqual(N.separar(q), { ...N.separar(q), exames: [ex], lugar: '', sobra: '' }, q);
  }
  // O lugar é só o que vem depois do "em" (ou de "perto de", "próximo a", vírgula); o resto fica de fora.
  for (const [q, l] of [
    ['ressonância pelo SUS em Campinas', 'Campinas'], ['ultrassom 4D em Campinas', 'Campinas'], ['hemograma próximo a Campinas', 'Campinas'],
    ['ultrassom, Campinas', 'Campinas'], ['ultrassom - Campinas', 'Campinas'], ['ultrassom campinas', 'campinas'], ['ultrassom de Campinas', 'Campinas'],
    ['ultrassom Campinas SP', 'Campinas SP'], ['ultrassom Rua Augusta 900', 'Rua Augusta 900'], ['hemograma urgente perto do Hospital São Luiz', 'Hospital São Luiz'],
    ['Conceição do Pará, hemograma', 'Conceição do Pará'], ['Santa Luzia do Pará, hemograma', 'Santa Luzia do Pará'], ['Belo Jardim, hemograma', 'Belo Jardim'],
    ['ultrassom em Coluna', 'Coluna'],
  ]) {
    assert.equal(lugar(q), l, q);
  }
  // Sem "em", o que não é lugar conhecido fica de fora (sobra): a página usa a área atual e explica como escrever.
  for (const [q, sobra] of [['ultrassom Braço do Norte', 'Braço do Norte'], ['Copacabana ultrassom', 'Copacabana'], ['novo ultrassom', 'novo']]) {
    assert.deepEqual([lugar(q), N.separar(q).sobra], ['', sobra], q);
  }
  // Coluna (MG) tem nome de parte do corpo: só com "em" ("ultrassom em Coluna"); "no Coluna" é lido como detalhe.
  assert.deepEqual([lugar('hemograma no Coluna'), lugar('ultrassom Coluna')], ['', '']);
});

test('sigla de lugar (BH, SP, RJ, DF e as UFs) vira o nome; "Sé" e "Poá" não', () => {
  for (const [q, l] of [['ressonância em BH', 'Belo Horizonte, MG'], ['ultrassom em SP', 'São Paulo, SP'], ['hemograma no RJ', 'Rio de Janeiro, RJ'],
    ['raio x em B.H.', 'Belo Horizonte, MG'], ['tomografia em MG', 'Minas Gerais'], ['ultrassom SP', 'São Paulo, SP'], ['BH ultrassom', 'Belo Horizonte, MG'],
    ['ultrassom na Sé', 'Sé'], ['ultrassom em Poá', 'Poá']]) {
    assert.equal(lugar(q), l, q);
  }
  // Sem exame: a sigla sozinha também (o servidor só procura com 3 letras ou mais).
  assert.deepEqual([lugar('BH'), lugar('sp'), lugar('Sé'), lugar('Campinas')], ['Belo Horizonte, MG', 'São Paulo, SP', 'Sé', 'Campinas']);
  // "TC" e "RM" sozinhos continuam exames, e "PA" depois do raio-X é a incidência (detalhe), não o Pará.
  assert.deepEqual([exames('TC'), exames('RM'), lugar('raio x PA e perfil')], [['tc'], ['rm'], '']);
});

test('endereço não vira exame: "Av. T-4" (Goiânia), "Rua T-3", "Quadra B12" e condomínios "Eco Park", "Beta Park"', () => {
  for (const q of ['Goiânia, Av. T-4', 'Setor Bueno, Av. T-4', 'Rua T-3', 'Av. T-4', 'Av T4', 'Avenida T-63', 'Quadra B12', 'Quadra B-12 Lote 5',
    'Lote 4 Quadra T3', 'Rua T 4', 'Rua B 12', 'Eco Park', 'Eco Residencial', 'Eco Ville', 'Residencial Eco Park', 'Beta Park', 'Chapa Diamantina',
    'Eco da Serra', 'Rua Beta', 'Rua Eco 10', 'Jardim Beta']) {
    assert.deepEqual([exames(q), lugar(q)], [[], q], q);
  }
  // Escritos como exame, continuam exames.
  for (const [q, ex] of [['T4', 'lab'], ['T4 livre', 'lab'], ['vitamina b12', 'lab'], ['B12', 'lab'], ['eco em Recife', 'eco'], ['eco Recife', 'eco'], ['beta em Campinas', 'lab'], ['beta', 'lab'], ['chapa do pulmão', 'rx'], ['Sódio e potássio', 'lab'], ['FAN (fator antinúcleo)', 'lab']]) {
    assert.equal(exames(q)[0], ex, q);
  }
  assert.equal(lugar('eco Recife'), 'Recife');
  // Com exame e endereço de Goiânia, o endereço vai inteiro.
  assert.equal(lugar('hemograma na Av. T-4, Goiânia'), 'Av. T-4, Goiânia');
});

test('doença ou condição sozinha ("dengue", "HIV", "gravidez", "tireoide"): a página pergunta se é exame ou atendimento', () => {
  const doenca = (q) => N.separar(q).achados.some((a) => a.doenca);
  for (const q of ['dengue', 'covid', 'covid 19', 'gravidez', 'tireoide', 'HIV', 'hepatite', 'hepatite b', 'sífilis', 'toxoplasmose', 'gripe', 'dengue em Campinas', 'Campinas dengue']) {
    assert.ok(doenca(q), q);
    assert.deepEqual(exames(q), ['lab'], `${q}: o exame continua sendo de laboratório`);
  }
  // Com "exame de", "teste de" ou um detalhe do exame, é o exame (sem perguntar).
  for (const q of ['exame de dengue', 'teste de covid', 'teste rápido de HIV', 'sorologia para dengue', 'HIV 1 e 2 (anticorpos e antígeno)', 'Toxoplasmose IgG e IgM', 'exame de gravidez', 'exame de tireoide', 'TSH', 'hemograma', 'beta hcg', 'HIV e sífilis']) {
    assert.ok(!doenca(q), q);
  }
  assert.equal(N.sugerir('dengue').doenca, 'dengue');
  assert.equal(N.sugerir('hemograma').doenca, null);
});

test('"Campinas" não é exame: nenhuma das 318 cidades do IMED, bairro ou endereço vira exame', () => {
  assert.equal(CIDADES.length, 318);
  for (const c of CIDADES) {
    for (const q of [c.name, `${c.name} - ${c.uf}`, `Rua ${c.name}, 100`, `Avenida ${c.name}`]) {
      assert.deepEqual(exames(q), [], q);
      assert.equal(lugar(q), q, q);
    }
    assert.deepEqual(N.sugerir(c.name).itens, [], `${c.name}: sem sugestão de exame`);
    // Com o exame, o lugar sai inteiro, com acento e maiúsculas.
    for (const q of [`ressonância em ${c.name}`, `ultrassom ${c.name}`, `${c.name} ultrassom`, `hemograma no ${c.name}`]) assert.equal(lugar(q), c.name, q);
  }
  for (const q of ['Campinas', 'Bela Vista', 'Consolação', 'Copacabana', 'Savassi', 'Boa Viagem', 'Moinhos de Vento', 'Centro', 'Liberdade', 'Saúde',
    'Avenida Paulista', 'Av. Paulista, 1500', 'Rua Augusta, 900', 'Alameda Santos', 'Rua Treze de Maio', 'Hospital das Clínicas', '01310-100',
    'Cidade Ocidental', 'Casa Branca', 'Ecoporanga', 'Areia', 'Mangue', 'Glicério', 'Ferraz de Vasconcelos', 'Chapada dos Guimarães', 'Tomé-Açu']) {
    assert.deepEqual(exames(q), [], q);
    assert.deepEqual(N.sugerir(q).itens, [], `${q}: sem sugestão`);
  }
  // Nome de exame que também é palavra comum de endereço: no fim do texto, é o lugar.
  for (const q of ['Estrada de Ferro', 'Vila Beta', 'Rua do Cálcio', 'Praça do Eco', 'Rua Doppler', 'Campinas RM']) assert.deepEqual(exames(q), [], q);
});

test('as 318 cidades do IMED valem sem o "em" ("ultrassom Campinas"); a lista do dicionário acompanha scripts/cidades.json', () => {
  for (const c of CIDADES) {
    // Se falhar: a cidade entrou em scripts/cidades.json e falta na lista CIDADES de assets/js/exames-nomes.js (sem acento).
    assert.equal(N.lugarConhecido(c.name), c.name, `${c.name} na lista CIDADES de exames-nomes.js`);
    assert.equal(N.lugarConhecido(`${c.name} - ${c.uf}`), `${c.name} - ${c.uf}`);
  }
  for (const q of ['01310-100', 'Rua Augusta, 900', 'Av. Paulista']) assert.equal(N.lugarConhecido(q), q, q);
  assert.equal(N.lugarConhecido('BH'), 'Belo Horizonte, MG');
  // Bairro, nome de exame ou texto qualquer: não é lugar conhecido (a página inicial não manda para o mapa).
  for (const q of ['Copacabana', 'hemograma', 'dor de cabeça', 'perto de mim', '', 'Coluna']) assert.equal(N.lugarConhecido(q), '', q);
});

test('sugestões enquanto a pessoa digita: começo do nome, apelido e nome do laboratório', () => {
  const nomes = (q) => N.sugerir(q).itens.map((i) => `${i.codigo}:${i.nome}`);
  assert.deepEqual(nomes('resson'), ['rm:Ressonância']);
  assert.deepEqual(nomes('resonan'), ['rm:Ressonância'], 'uma letra errada a partir de 7 letras');
  assert.deepEqual(nomes('exame de sa'), ['lab:Exame de sangue']);
  assert.deepEqual(nomes('hemo'), ['lab:Hemograma', 'lab:Hemoglobina glicada'], '"Hemograma completo" não repete "Hemograma"');
  assert.deepEqual(nomes('ecog'), ['usg:Ecografia']);
  assert.deepEqual(nomes('us'), ['usg:USG']);
  assert.deepEqual(nomes('hemograma em Camp'), ['lab:Hemograma'], 'o exame inteiro vale mesmo com o lugar pela metade');
  assert.equal(N.sugerir('USG').itens[0].tipo, 'a');
  assert.equal(N.sugerir('hemograma').exato, true);
  assert.equal(N.sugerir('hemo').exato, false);
  for (const q of ['', '   ', 'a', 'r', 'exame', 'exame de']) assert.deepEqual(N.sugerir(q).itens, [], JSON.stringify(q));
  assert.ok(N.sugerir('glic').itens.length <= 8 && N.sugerir('glic').itens.every((i) => i.codigo === 'lab'));
});

test('o catálogo da teleconsulta é todo achado pelo dicionário, e o que não tem busca no site continua sem', () => {
  // Órgão não é exame: "próstata" (outro nome do PSA no catálogo do médico) fica de fora da busca do paciente.
  const FORA = new Set(['próstata']);
  for (const g of T.CATALOG) {
    for (const it of g.items) {
      if (it.s) {
        // O nome que vai no pedido do paciente: exatamente esse exame e nada para o mapa.
        for (const nome of [it.name, ...(it.aka || [])].filter((x) => !FORA.has(x))) {
          const r = N.separar(nome);
          assert.deepEqual([r.exames, r.lugar, r.sobra], [[it.s], '', ''], `${it.id}: "${nome}" → ${it.s}, sem lugar`);
        }
      } else {
        // Holter, MAPA, endoscopia...: o site não tem busca para eles; o dicionário não inventa uma.
        assert.deepEqual(N.examesNoTexto(it.name), [], `${it.id}: "${it.name}" sem busca`);
      }
    }
  }
  // Os apelidos dos exames de imagem vão para a lista da teleconsulta (o laboratório não tem apelido por exame).
  assert.ok(N.apelidos('usg').includes('usg') && N.apelidos('usg').includes('ecografia'));
  assert.ok(N.apelidos('rm').includes('rnm') && N.apelidos('tc').includes('tomo') && N.apelidos('rx').includes('chapa'));
  assert.deepEqual(N.apelidos('lab'), []);
  assert.deepEqual(N.apelidos(null), []);
});

test('só liga nomes a exames, sem preço nem promessa, e é pequeno (baixado só quando a pessoa toca na busca)', () => {
  const src = read('assets/js/exames-nomes.js');
  // Como o navegador recebe (comprimido; os comentários quase não contam): 13 KB levam cerca de 0,14 s na internet 3G
  // (750 kbps), e só depois do toque. Hoje são ~11,5 KB, com a lista das 318 cidades.
  const gz = gzipSync(src).length;
  assert.ok(gz < 13000, `arquivo pequeno (${gz} bytes comprimido)`);
  assert.ok(!/R\$|\d+,\d{2}/.test(src), 'sem preço');
  // A página inicial e a busca não carregam o dicionário ao abrir: só pelo import() dinâmico.
  for (const f of ['index.html', 'perto.html']) assert.ok(!read(f).includes('exames-nomes.js'), `${f} não pede o dicionário ao abrir`);
  assert.match(read('assets/js/inicio.js'), /import\('\.\/exames-nomes\.js'\)/);
  assert.match(read('assets/js/perto.js'), /import\('\.\/exames-nomes\.js'\)/);
  assert.ok(!/^import .*exames-nomes/m.test(read('assets/js/inicio.js')) && !/^import .*exames-nomes/m.test(read('assets/js/perto.js')));
  // Todo nome do dicionário leva a um código que existe.
  for (const q of ['hemograma', 'USG', 'eco', 'tomo']) for (const k of exames(q)) assert.ok(N.CODIGOS.includes(k));
});

test('sem internet: todo arquivo que um script do CORE do sw.js importa direto também está no CORE', (t) => {
  // Um import fixo fora do CORE faz a página inteira parar sem internet (teleconsulta, documento.html pelo QR...).
  // O dicionário entra por import() só quando a pessoa toca na busca: sem ele, a busca funciona como antes.
  const sw = read('sw.js');
  const core = [...sw.slice(sw.indexOf('const CORE'), sw.indexOf('];', sw.indexOf('const CORE'))).matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
  const noCore = new Set(core);
  for (const f of core.filter((x) => x.endsWith('.js'))) {
    const src = read(f), dir = posix.dirname(f);
    for (const m of src.matchAll(/^\s*import\s[^;]*?from\s+'(\.[^']+)'|^\s*import\s+'(\.[^']+)'/gm)) {
      const alvo = posix.normalize(posix.join(dir, m[1] || m[2]));
      assert.ok(noCore.has(alvo), `${f} importa ${alvo}, que não está no CORE do sw.js`);
    }
    for (const m of src.matchAll(/import\(\s*'(\.[^']+)'\s*\)/g)) {
      const alvo = posix.normalize(posix.join(dir, m[1]));
      if (!noCore.has(alvo)) t.diagnostic(`${f} baixa ${alvo} só quando precisa (fora do CORE do sw.js)`);
    }
  }
  assert.ok(!/^import .*exames-nomes/m.test(read('assets/js/tele-core.js')), 'tele-core.js não importa o dicionário');
  assert.match(read('assets/js/medico.js'), /import\('\.\/exames-nomes\.js'\)/, 'a área do médico baixa o dicionário quando usa a busca');
});
