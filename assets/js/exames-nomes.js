// Nomes de exames do dia a dia ("hemograma", "TSH", "beta", "EAS", "USG", "ecografia", "tomo", "ressonancia" sem acento)
// ligados ao código da busca (perto.html?exame=<código>), o mesmo de data.js, geo-core.js e tele-core.js. Só liga nomes a
// exames: não diz para que servem nem que um local faz o exame (o IMED não sabe quais exames cada local faz).
// Funções puras (tests/exames-nomes.test.mjs). A página inicial, a busca e a lista de exames do médico (medico.js) só
// baixam este arquivo quando a pessoa toca na caixa de busca.

export const CODIGOS = ['rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab'];

// n = o nome do exame no site (e outros jeitos de escrevê-lo); a = apelido, mostrado como "também chamado de"; e = exame
// que leva a essa busca ("hemograma" → laboratório). Os do laboratório vêm do catálogo da teleconsulta (tele-core.js
// CATALOG e "aka"; o teste confere). Acento, maiúscula, hífen e espaço não importam; "exame de" no começo é opcional.
const DIC = {
  rx: { n: 'Raio-X|Raios X|Radiografia', a: 'RX|Chapa' },
  usg: { n: 'Ultrassom|Ultrassonografia|Ultra-som|Ultrason', a: 'USG|Ecografia', e: 'Doppler|Transvaginal|Morfológico|Obstétrico' },
  tc: { n: 'Tomografia|Tomografia computadorizada', a: 'Tomo|TC', e: 'Angiotomografia' },
  rm: { n: 'Ressonância|Ressonância magnética', a: 'RM|RNM|Ressonância nuclear magnética', e: 'Angiorressonância' },
  mamo: { n: 'Mamografia', a: 'Mamo' },
  dens: { n: 'Densitometria|Densitometria óssea', a: 'Densito' },
  ecg: { n: 'Eletrocardiograma', a: 'Eletro|ECG|Eletrocardiografia' },
  eco: { n: 'Ecocardiograma', a: 'Ecocardiografia|Ecocardio|Eco do coração', e: 'Ecocardiograma com doppler|Ecodopplercardiograma' },
  lab: {
    n: 'Exames de laboratório|Laboratório|Exames laboratoriais',
    a: 'Exame de sangue|Coleta de sangue|Análises clínicas|Exame de urina|Exame de fezes',
    e: 'Hemograma|Hemograma completo|Glicemia|Glicemia de jejum|Glicose|Hemoglobina glicada|Glicada|HbA1c|A1c|Curva glicêmica|'
      + 'TOTG|Teste oral de tolerância à glicose|Insulina|Colesterol|HDL|LDL|Perfil lipídico|Lipidograma|Triglicerídeos|Ureia|'
      + 'Creatinina|Albumina|Função renal|Sódio|Potássio|Eletrólitos|Cálcio|Ácido úrico|TGO|TGP|Transaminases|Enzimas do fígado|'
      + 'Gama-GT|GGT|Fosfatase alcalina|Bilirrubinas|TSH|T4 livre|T4|T3|Anti-TPO|Exame de tireoide|Vitamina D|25-OH vitamina D|'
      + 'Vitamina B12|B12|Ácido fólico|Folato|Ferro sérico|Ferritina|PCR|Proteína C reativa|VHS|Coagulograma|'
      + 'Tempo de protrombina|TAP|INR|Beta-hCG|Beta|BHCG|Exame de gravidez|PSA|Tipagem sanguínea|Tipo sanguíneo|'
      + 'Grupo sanguíneo|HIV|Sífilis|VDRL|Hepatite|Hepatite B|Hepatite C|Toxoplasmose|Exame de dengue|FAN|Fator reumatoide|'
      + 'Prolactina|FSH|LH|Testosterona|Urina tipo 1|EAS|Sumário de urina|Urina rotina|Urocultura|Cultura de urina|'
      + 'Microalbuminúria|Proteinúria|Urina de 24 horas|Parasitológico de fezes|Parasitológico|Protoparasitológico|EPF|'
      + 'Sangue oculto|Teste de COVID|Teste de COVID-19|RT-PCR|Teste de antígeno|Teste de gripe',
  },
};
// Nome de mais de um exame: a página mostra as opções e a pessoa escolhe (o site não escolhe sozinho). "Ecodoppler"
// também é o nome do doppler das veias e das carótidas (ultrassom), não só do ecocardiograma.
const AMBIGUOS = { Eco: ['eco', 'usg'], Ecodoppler: ['eco', 'usg'] };
// Também são palavras de endereço: no começo do texto, só valem com detalhe, "em", outro exame ou nada depois ("beta em
// Campinas", "eco"; "Eco Park" e "Beta Park" são lugares); no fim, nunca ("Vila Beta").
const FRACOS = new Set(['eco', 'beta', 'chapa', 'doppler', 'sodio', 'calcio', 'potassio', 'fan', 'tap', 'rm', 'tomo']);
// Doença ou condição sozinha ("dengue", "HIV", "gravidez", "tireoide"): a pessoa pode querer o exame ou atendimento,
// então a página pergunta. Com "exame de", "teste de" ou um detalhe ("HIV 1 e 2"), é o exame.
const conj = (s) => new Set(s.split(' '));
const DOENCAS = conj('tireoide gravidez dengue covid hiv sifilis hepatite toxoplasmose gripe');
const EXPLICITO = conj('exame exames teste testes pesquisa dosagem sorologia');

// Nome no meio da frase ("também chamado de ecografia"): só a primeira letra muda; sigla ("USG", "RNM") fica igual.
export const minusculo = (nome) => (/^[A-Z0-9]{2,}\b/.test(nome) ? nome : nome.charAt(0).toLowerCase() + nome.slice(1));

// Sem acento, em minúsculas e com espaços simples.
export const dobrar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// Palavras sem acento, com a posição no texto (o lugar sai como foi escrito) e se estão entre parênteses:
// [{ p: 'ressonancia', i: 0, f: 11, par: false }].
export function palavras(texto) {
  const s = String(texto ?? '');
  const out = [];
  let fundo = 0, ate = 0;
  for (const m of s.matchAll(/[\p{L}\p{N}]+/gu)) {
    for (const c of s.slice(ate, m.index)) fundo = Math.max(0, fundo + (c === '(' ? 1 : c === ')' ? -1 : 0));
    ate = m.index + m[0].length;
    out.push({ p: dobrar(m[0]), i: m.index, f: ate, par: fundo > 0 });
  }
  return out;
}

// Quantas letras mudar (trocar, tirar, pôr ou inverter duas vizinhas) de uma palavra para a outra; para depois de max.
export function distancia(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let ante = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j += 1) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, ante[j - 2] + 1);
      cur[j] = v;
      if (v < menor) menor = v;
    }
    if (menor > max) return max + 1;
    ante = prev;
    prev = cur;
  }
  return prev[b.length];
}

// Erro de digitação: uma letra, só em palavras de 7 letras ou mais ("resonancia", "hemogrma"). Palavra curta vem certa:
// "Areia" não vira "ureia", nem "Mangue" vira "sangue".
export const TOLERA = 7;
export const parecida = (q, w) => q === w || (w.length >= TOLERA && Math.abs(q.length - w.length) <= 1 && distancia(q, w, 1) <= 1);
// Começo de palavra enquanto a pessoa digita ("resson"); com uma letra errada, só a partir de 7 letras ("resonan").
export function comecoParecido(q, w) {
  if (w.startsWith(q)) return true;
  if (q.length < TOLERA || w.length < TOLERA) return false;
  for (let n = q.length - 1; n <= q.length + 1; n += 1) if (n <= w.length && distancia(q, w.slice(0, n), 1) <= 1) return true;
  return false;
}

// Palavras em volta do exame. ENCHE: antes dele ("onde fazer exame de", "teste rápido de"). LIGA e ANTES: entre o lugar
// e o exame ("Campinas, exame de sangue"). AQUI: "perto de mim", "na minha cidade" (a localização ou a área atual).
// JUNTA: entre o exame e um detalhe ou outro exame ("de joelho", "com contraste", "e glicemia"). CONECTA e PERTO: antes
// do lugar ("em Campinas", "perto do Centro", "próximo a Campinas").
const ENCHE = conj('exame exames teste testes de do da dos das fazer faco onde quero preciso procuro buscar marcar agendar realizar um uma o a os as rapido rapida pesquisa dosagem sorologia relacao');
const LIGA = conj('em no na nos nas perto proximo proxima de do da dos das a ao aos pelo pela');
const ANTES = conj('onde fazer faco quero preciso procuro buscar marcar agendar realizar em no na nos nas perto proximo proxima');
const AQUI = conj('aqui daqui mim minha meu casa perto proximo proxima localizacao regiao atual local onde estou moro eu me de da do a o em no na sua seu voce vc cidade bairro rua');
const JUNTA = conj('de do da dos das e com sem no na nos nas ou para');
const COM = conj('com sem para'); // "com plaquetas", "sem contraste", "para cirurgia": a palavra seguinte é detalhe
const DE = conj('de do da dos das');
const CONECTA = conj('em no na nos nas');
const PERTO = conj('perto proximo proxima pertinho');
const PREP = conj('de do da dos das a ao aos as');
// Detalhes do exame: parte do corpo, lado, contraste, jeito de fazer ("ressonância do joelho com contraste em Campinas":
// o lugar é só "Campinas"). Número de 1 ou 2 algarismos e o que está entre parênteses também são detalhe.
const DETALHE = conj('torax pulmao pulmoes coluna lombar lombossacra cervical toracica dorsal sacral sacro cranio cabeca encefalo '
  + 'cerebro face seios pescoco ombro ombros braco cotovelo punho mao maos dedo dedos quadril bacia pelve pelvica pelvico femur '
  + 'joelho joelhos perna pernas tornozelo pe pes abdome abdomen abdominal total superior inferior superiores inferiores rins rim '
  + 'renal via vias urinarias urinario aparelho prostata bolsa escrotal testiculos utero ovarios mama mamas mamaria tireoide '
  + 'carotidas carotida vertebrais venoso venosa arterial membros partes moles articulacao figado vesicula pancreas transvaginal '
  + 'endovaginal transretal transabdominal transtoracico transesofagico obstetrico obstetrica morfologico morfologica fetal '
  + 'contraste digital bilateral direito direita esquerdo esquerda completo completa simples jejum rotina lado pa ap perfil '
  + 'lateral panoramico panoramica odontologico odontologica 3d 4d 5d repouso esforco quantitativo qualitativo ultrassensivel '
  + 'fracoes livre livres rapido rapida oral plaquetas antibiograma horas igg igm iga anticorpos anticorpo antigeno ns1 swab '
  + 'nasal urgente urgencia');
// Depois de ecocardiograma ou ultrassom, também é detalhe ("ecocardiograma com doppler" é um exame só).
const ECO_DET = conj('doppler colorido color');
// Começo de endereço ("Rua Augusta, 900", "Vila Mariana"): vale como lugar sem o "em" antes.
const ENDERECO = conj('rua r av avenida al alameda tv trav travessa praca pca largo rod rodovia estr estrada viela beco ladeira '
  + 'bairro vila vl jardim jd parque pq setor quadra qd conjunto conj residencial condominio cond edificio bloco lote chacara '
  + 'sitio fazenda distrito loteamento km br');
// Tipo de via colado num código ("Av. T-4", "Rua T-3", "Quadra B12"): o código é parte do endereço, não exame.
const VIA = conj('rua r av avenida al alameda tv trav travessa rod rodovia estr estrada quadra qd lote lt bloco bl conjunto conj setor km br');
// Siglas de lugar (o servidor só procura com 3 letras ou mais). SP e RJ são as capitais.
const SIGLAS = new Map(Object.entries({
  bh: 'Belo Horizonte, MG', sp: 'São Paulo, SP', sampa: 'São Paulo, SP', rj: 'Rio de Janeiro, RJ', df: 'Brasília, DF',
  bsb: 'Brasília, DF', floripa: 'Florianópolis, SC', ac: 'Acre', al: 'Alagoas', ap: 'Amapá', am: 'Amazonas', ba: 'Bahia',
  ce: 'Ceará', es: 'Espírito Santo', go: 'Goiás', ma: 'Maranhão', mt: 'Mato Grosso', ms: 'Mato Grosso do Sul',
  mg: 'Minas Gerais', pa: 'Pará', pb: 'Paraíba', pr: 'Paraná', pe: 'Pernambuco', pi: 'Piauí', rn: 'Rio Grande do Norte',
  rs: 'Rio Grande do Sul', ro: 'Rondônia', rr: 'Roraima', sc: 'Santa Catarina', se: 'Sergipe', to: 'Tocantins',
}));
// As 318 cidades do IMED (scripts/cidades.json, sem acento; o teste confere): "ultrassom Campinas" vale sem o "em".
const CIDADES = new Set((''
  + 'abaetetuba|acailandia|aguas lindas de goias|alagoinhas|almirante tamandare|altamira|alvorada|americana|'
  + 'ananindeua|anapolis|angra dos reis|aparecida de goiania|apucarana|aracaju|aracatuba|araguaina|araguari|'
  + 'arapiraca|arapongas|araraquara|araras|araruama|araucaria|araxa|assis|atibaia|bacabal|bage|balneario camboriu|'
  + 'balsas|barbacena|barcarena|barra mansa|barreiras|barretos|barueri|bauru|belem|belford roxo|belo horizonte|'
  + 'bento goncalves|betim|birigui|blumenau|boa esperanca do sul|boa vista|botucatu|braganca|braganca paulista|'
  + 'brasilia|breves|brusque|cabo de santo agostinho|cabo frio|cachoeirinha|cachoeiro de itapemirim|camacari|'
  + 'camaragibe|cambe|camboriu|cameta|campina grande|campinas|campo grande|campo largo|campos dos goytacazes|'
  + 'canoas|caraguatatuba|carapicuiba|cariacica|caruaru|cascavel|castanhal|catalao|catanduva|caucaia|caxias|'
  + 'caxias do sul|chapeco|codo|colatina|colombo|conselheiro lafaiete|contagem|coronel fabriciano|cotia|crato|'
  + 'criciuma|cubatao|cuiaba|curitiba|diadema|divinopolis|dourado|dourados|duque de caxias|embu das artes|erechim|'
  + 'eunapolis|fazenda rio grande|feira de santana|ferraz de vasconcelos|florianopolis|formosa|fortaleza|'
  + 'foz do iguacu|franca|francisco morato|franco da rocha|garanhuns|goiania|governador valadares|gravatai|'
  + 'guarapari|guarapuava|guaratingueta|guaruja|guarulhos|hortolandia|ibirite|igarassu|ilheus|imperatriz|'
  + 'indaiatuba|ipatinga|itabaiana|itabira|itaborai|itabuna|itacoatiara|itaguai|itaituba|itajai|itanhaem|'
  + 'itapecerica da serra|itapetininga|itapevi|itapipoca|itaquaquecetuba|itatiba|itu|ituiutaba|itumbiara|'
  + 'jaboatao dos guararapes|jacarei|jandira|jaragua do sul|jatai|jau|jequie|ji parana|joao pessoa|joinville|'
  + 'juazeiro|juazeiro do norte|juiz de fora|jundiai|lagarto|lages|lauro de freitas|lavras|limeira|linhares|'
  + 'londrina|luis eduardo magalhaes|luziania|macae|macapa|maceio|mage|manacapuru|manaus|maraba|maracanau|'
  + 'maranguape|marica|marilia|maringa|marituba|maua|mesquita|mogi das cruzes|mogi guacu|montes claros|mossoro|'
  + 'muriae|natal|nilopolis|niteroi|nossa senhora do socorro|nova friburgo|nova iguacu|nova lima|novo gama|'
  + 'novo hamburgo|olinda|osasco|ourinhos|paco do lumiar|palhoca|palmas|paragominas|paranagua|parauapebas|'
  + 'parnaiba|parnamirim|passo fundo|passos|patos|patos de minas|paulinia|paulista|paulo afonso|pelotas|petrolina|'
  + 'petropolis|pindamonhangaba|pinhais|piracicaba|piraquara|planaltina|poa|pocos de caldas|ponta grossa|'
  + 'porto alegre|porto seguro|porto velho|pouso alegre|praia grande|presidente prudente|queimados|recife|resende|'
  + 'ribeirao das neves|ribeirao pires|ribeirao preto|rio branco|rio claro|rio das ostras|rio de janeiro|'
  + 'rio grande|rio verde|rondonopolis|sabara|salto|salvador|santa barbara d oeste|santa cruz do sul|santa luzia|'
  + 'santa maria|santa rita|santana|santana de parnaiba|santarem|santo andre|santo antonio de jesus|santos|'
  + 'sao bernardo do campo|sao caetano do sul|sao carlos|sao goncalo|sao goncalo do amarante|sao joao de meriti|'
  + 'sao jose|sao jose de ribamar|sao jose do rio preto|sao jose dos campos|sao jose dos pinhais|sao leopoldo|'
  + 'sao lourenco da mata|sao luis|sao mateus|sao paulo|sao pedro da aldeia|sao vicente|sapucaia do sul|sarandi|'
  + 'senador canedo|serra|sertaozinho|sete lagoas|simoes filho|sinop|sobral|sorocaba|sorriso|sumare|suzano|'
  + 'taboao da serra|tangara da serra|tatui|taubate|teixeira de freitas|teofilo otoni|teresina|teresopolis|timon|'
  + 'toledo|tres lagoas|trindade|tubarao|uberaba|uberlandia|umuarama|uruguaiana|valinhos|valparaiso de goias|'
  + 'varginha|varzea grande|varzea paulista|vespasiano|viamao|vila velha|vitoria|vitoria da conquista|'
  + 'vitoria de santo antao|volta redonda|votorantim').split('|'));

// { codigos, nome, tipo, toks (sem "exame de"), fraca, doenca }; nome de mais de uma palavra também vale junto ("raiox").
const TIPOS = { n: 0, a: 1, e: 2 };
const ENTRADAS = [];
function entra(codigos, tipo, nome) {
  const toks = palavras(nome).map((x) => x.p);
  let k = 0;
  while (k < toks.length - 1 && /^(exames?|testes?|de|do|da)$/.test(toks[k])) k += 1;
  const core = toks.slice(k);
  const base = { codigos, tipo, nome, fraca: core.length === 1 && FRACOS.has(core[0]), doenca: DOENCAS.has(core[0]) };
  ENTRADAS.push({ ...base, toks: core });
  if (core.length > 1) ENTRADAS.push({ ...base, toks: [core.join('')], junto: true });
}
for (const [cod, grupos] of Object.entries(DIC)) for (const t of 'nae') for (const nome of (grupos[t] || '').split('|').filter(Boolean)) entra([cod], t, nome);
for (const [nome, cods] of Object.entries(AMBIGUOS)) entra(cods, 'a', nome);

// O nome mais comprido que começa na palavra i ("eco cardiograma" também vale). forte: sem as palavras de endereço.
function casar(t, i, forte = false) {
  let melhor = null;
  const prova = (en, ps, fim) => {
    let erros = 0;
    for (let k = 0; k < ps.length; k += 1) {
      if (ps[k] === en.toks[k]) continue;
      if (!parecida(ps[k], en.toks[k])) return;
      erros += 1;
    }
    if (erros > 1) return;
    const c = { en, fim, erros };
    if (!melhor || fim > melhor.fim || (fim === melhor.fim && (erros < melhor.erros || (erros === melhor.erros && TIPOS[en.tipo] < TIPOS[melhor.en.tipo])))) melhor = c;
  };
  for (const en of ENTRADAS) {
    if (forte && en.fraca) continue;
    const n = en.toks.length;
    if (i + n <= t.length) prova(en, t.slice(i, i + n).map((x) => x.p), i + n);
    // Em duas palavras, só sem erro ("ultrassom e" não é "ultrassome") e sem letra solta com número: "Av. T-4" e
    // "Quadra B 12" são endereços, não T4 nem B12.
    if (n === 1 && i + 2 <= t.length && t[i].p.length > 1 && !/^\d+$/.test(t[i + 1].p) && t[i].p + t[i + 1].p === en.toks[0]) prova(en, en.toks, i + 2);
  }
  const en = melhor?.en;
  return en && { codigos: en.codigos, nome: en.nome, tipo: en.tipo, fraca: en.fraca, doenca: en.doenca, erro: melhor.erros > 0, ini: i, fim: melhor.fim };
}

// Vírgula, ponto e vírgula, barra ou travessão antes da palavra k ("ultrassom, Campinas", "Rua Augusta, 900 - raio x").
const sep = (texto, t, k) => k > 0 && k < t.length && /[,;/–—]|\s-|-\s/.test(String(texto).slice(t[k - 1].f, t[k].i));
// A palavra k é detalhe do exame? "Braço do Norte" e "Pé de Serra" não: parte do corpo com "do/de" e outra palavra.
function det(t, k, achados) {
  const x = t[k];
  if (!x) return false;
  if (x.par || /^\d{1,2}$/.test(x.p)) return true;
  if (ECO_DET.has(x.p)) return achados.some((a) => a.codigos.includes('eco') || a.codigos.includes('usg'));
  return DETALHE.has(x.p) && !(k + 2 < t.length && DE.has(t[k + 1].p) && !DETALHE.has(t[k + 2].p));
}
// Onde o exame termina: detalhes ("do joelho", "com contraste", "(PA e perfil)", "em jejum") e outros exames ("e glicemia").
function detalhes(texto, t, j, achados) {
  const exame = (k) => { const m = casar(t, k); return m && (m.fim - k > 1 || !det(t, k, achados)) ? m : null; };
  while (j < t.length) {
    const m = exame(j);
    if (m) { achados.push(m); j = m.fim; continue; }
    if (det(t, j, achados)) { j += 1; continue; }
    const p = t[j].p, q = t[j + 1];
    if (!q) break;
    // Depois de vírgula ou travessão, só detalhe ou outro exame continuam o exame ("ultrassom, com doppler", "hemograma,
    // para cirurgia"); o resto é o lugar ("ultrassom, Pará de Minas", "ultrassom, Sem-Peixe": com maiúscula ou acento).
    if (sep(texto, t, j) && !(JUNTA.has(p) && (det(t, j + 1, achados) || exame(j + 1)
      || (COM.has(String(texto).slice(t[j].i, t[j].f)) && conector(t, j + 1) === j + 1)))) break;
    if (p === 'em' && q.p === 'jejum') { j += 2; continue; }
    if (!JUNTA.has(p)) break;
    const m2 = exame(j + 1);
    if (m2) { achados.push(m2); j = m2.fim; continue; }
    if (det(t, j + 1, achados)) { j += 2; continue; }
    if (COM.has(p) && conector(t, j) === j && conector(t, j + 1) === j + 1 && !sep(texto, t, j + 1)) { j += 2; continue; }
    break;
  }
  return j;
}

// Depois de "em", "no", "na", "perto de", "próximo a", "ao lado de" ou "para" antes de cidade: onde o lugar começa
// (a, se não houver conector).
function conector(t, a) {
  if (a >= t.length) return a;
  if (CONECTA.has(t[a].p)) return a + 1;
  // "para Campinas", "pra Recife": só antes de uma das cidades do IMED ("para cirurgia" é detalhe do exame).
  if ((t[a].p === 'para' || t[a].p === 'pra') && cidadeEm(t, a + 1)) return a + 1;
  let b;
  if (t[a].p === 'ao' && t[a + 1]?.p === 'lado') b = a + 2;
  else if (PERTO.has(t[a].p)) b = a + 1;
  else return a;
  while (b < t.length && PREP.has(t[b].p)) b += 1;
  return b;
}
// Sigla de lugar ("BH", "SP", "MG") pelo nome; o resto fica como foi escrito ("Sé" não é Sergipe).
const siglaOu = (lugar) => { const k = String(lugar).replace(/[.\s]/g, ''); return (/^[A-Za-z]{2,7}$/.test(k) && SIGLAS.get(k.toLowerCase())) || lugar; };
// Quantas palavras a partir de a formam uma das cidades do IMED (0: nenhuma).
function cidadeEm(t, a) {
  let n = 0;
  for (let k = 1; k <= 6 && a + k <= t.length; k += 1) if (CIDADES.has(t.slice(a, a + k).map((x) => x.p).join(' '))) n = k;
  return n;
}
// Lugar que vale sem "em" antes: CEP, uma das cidades do IMED, sigla (BH, SP) e, com endereco, "Rua ...", "Av. ...".
// Devolve onde ele começa (ou -1). fim: onde o trecho do lugar termina.
function conhecido(texto, t, a, endereco, fim = t.length) {
  if (a >= fim) return -1;
  if (/^\d{5}-?\d{3}(?!\d)/.test(String(texto).slice(t[a].i))) return a;
  if ((endereco && ENDERECO.has(t[a].p)) || cidadeEm(t, a)) return a;
  if (DE.has(t[a].p) && cidadeEm(t, a + 1)) return a + 1;
  if (a === fim - 1 && siglaOu(String(texto).slice(t[a].i, t[a].f)) !== String(texto).slice(t[a].i, t[a].f)) return a;
  return -1;
}
// Palavra fraca no começo ("eco", "beta", "doppler"): vale como exame se vier sozinha ou com detalhe, outro exame,
// conector, vírgula, CEP ou cidade depois.
function vale(texto, t, k, m) {
  if (k >= t.length || sep(texto, t, k) || det(t, k, [m]) || conector(t, k) > k) return true;
  if (!DE.has(t[k].p) && conhecido(texto, t, k, false) >= 0) return true; // "eco Recife"; "Eco da Serra" é lugar
  return JUNTA.has(t[k].p) && k + 1 < t.length && (det(t, k + 1, [m]) || !!casar(t, k + 1));
}

// O lugar depois do exame (a partir da palavra k). Só vale como lugar o que vem depois de "em", "perto de", vírgula ou
// travessão, ou o que é CEP, endereço, sigla ou uma das cidades do IMED: o resto ("panorâmico", "pelo SUS") nunca vai
// para o mapa, porque o mapa sempre devolve algum lugar parecido. sobra: o que ficou de fora sem ser lugar.
function depois(texto, t, k) {
  const vazio = { lugar: '', sobra: '' };
  if (k >= t.length) return vazio;
  const aqui = (a) => t.slice(a).every((x) => AQUI.has(x.p));
  const lugar = (a) => (a >= t.length || aqui(a) ? vazio : { lugar: siglaOu(String(texto).slice(t[a].i).trim()), sobra: '' });
  const c = conector(t, k);
  if (c > k || sep(texto, t, k)) return lugar(c);
  if (aqui(k)) return vazio;
  const a = conhecido(texto, t, k, true);
  if (a >= 0) return lugar(a);
  // "ressonância pelo SUS em Campinas": o que vem antes do "em" fica de fora; o lugar é "Campinas".
  for (let b = k + 1; b < t.length; b += 1) { const c2 = conector(t, b); if (c2 > b) return lugar(c2); }
  return { lugar: '', sobra: String(texto).slice(t[k].i).trim() };
}

function resultado(texto, t, achados, { lugar = '', sobra = '', doenca = false } = {}) {
  return {
    exames: [...new Set(achados.flatMap((a) => a.codigos))],
    achados: achados.map((a, n) => ({ codigos: a.codigos, nome: a.nome, tipo: a.tipo, erro: a.erro, digitado: String(texto).slice(t[a.ini].i, t[a.fim - 1].f), ...(doenca && !n ? { doenca: true } : {}) })),
    lugar,
    sobra,
  };
}

// Separa o exame do lugar: "ressonância em Campinas" e "Campinas, raio x do joelho" → lugar 'Campinas';
// "hemograma perto de mim" → lugar '' (a localização ou a área atual); "eco em Recife" → exames ['eco', 'usg'] (a
// pessoa escolhe); "Campinas" → exames []. achados: { codigos, nome do dicionário, tipo, erro, digitado, doenca? }.
// sobra: o que não é exame nem lugar ("ultrassom Braço do Norte" sem o "em"); a página explica como escrever.
export function separar(texto) {
  const t = palavras(texto);
  const nada = { exames: [], achados: [], lugar: siglaOu(String(texto ?? '').trim()), sobra: '' };
  // O exame primeiro: "exame de sangue em Campinas", "hemograma", "sorologia para dengue" ("Pará, hemograma" não).
  let i = 0;
  while (i < t.length && (ENCHE.has(t[i].p) || (t[i].p === 'para' && i + 1 < t.length && !sep(texto, t, i + 1)))) i += 1;
  const m = i < t.length ? casar(t, i) : null;
  if (m && (!m.fraca || vale(texto, t, m.fim, m))) {
    const achados = [m];
    const k = detalhes(texto, t, m.fim, achados);
    const doenca = m.doenca && achados.length === 1 && k === m.fim && !t.slice(0, i).some((x) => EXPLICITO.has(x.p));
    return resultado(texto, t, achados, { ...depois(texto, t, k), doenca });
  }
  // O exame depois do lugar: "Campinas ultrassom", "Rua Augusta, 900 - raio x", "perto de mim ultrassom".
  for (let s = 1; s < t.length; s += 1) {
    if (VIA.has(t[s - 1].p) && !sep(texto, t, s)) continue; // "Av. T4", "Quadra B12": parte do endereço
    const m2 = casar(t, s, true);
    if (!m2) continue;
    const achados = [m2];
    const k = detalhes(texto, t, m2.fim, achados);
    if (k !== t.length) continue;
    // Volta pelas palavras de ligação ("Campinas, exame de sangue"), sem passar da vírgula ("Conceição do Pará, hemograma").
    let b = 0, e = s;
    while (e > 0 && !sep(texto, t, e) && (LIGA.has(t[e - 1].p) || ENCHE.has(t[e - 1].p))) e -= 1;
    while (b < e && ANTES.has(t[b].p)) b += 1;
    const doenca = m2.doenca && achados.length === 1 && k === m2.fim && !t.slice(0, s).some((x) => EXPLICITO.has(x.p));
    if (b >= e || t.slice(b, e).every((x) => AQUI.has(x.p))) return resultado(texto, t, achados, { doenca });
    const trecho = String(texto).slice(t[b].i, t[e].i).replace(/[\s,;:/–—-]+$/, '');
    // Antes do exame, também só vale o lugar separado por vírgula ou travessão, ou conhecido ("novo ultrassom" não).
    if (sep(texto, t, e) || conhecido(texto, t, b, true, e) >= 0) return resultado(texto, t, achados, { lugar: siglaOu(trecho), doenca });
    return resultado(texto, t, achados, { sobra: trecho, doenca });
  }
  return nada;
}

// O texto inteiro é um lugar que vale sem exame: uma das cidades do IMED (com ou sem a UF), CEP, endereço ou sigla.
// A página inicial passa esse lugar para a busca ("Campinas" → perto.html?onde=Campinas).
export function lugarConhecido(texto) {
  const t = palavras(texto);
  if (!t.length) return '';
  const n = cidadeEm(t, 0);
  const uf = (k) => k === t.length - 1 && t[k].p.length === 2 && SIGLAS.has(t[k].p);
  if (n && (n === t.length || uf(n))) return String(texto).trim();
  return conhecido(texto, t, 0, true) === 0 ? siglaOu(String(texto).trim()) : '';
}

// O texto é só uma das cidades do IMED, com ou sem a UF ("Campinas", "Campinas - SP", "Belo Horizonte, MG"). Só a
// cidade vai no endereço da busca (?onde=); bairro, rua e CEP ficam guardados só na aba (longe do histórico).
export function ehCidade(texto) {
  const t = palavras(texto);
  const n = cidadeEm(t, 0);
  return n > 0 && (n === t.length || (n === t.length - 1 && t[n].p.length === 2 && SIGLAS.has(t[n].p)));
}

// Códigos de todos os nomes de exame no texto, em qualquer posição (para conferir o catálogo).
export function examesNoTexto(texto) {
  const t = palavras(texto);
  const out = new Set();
  for (let i = 0; i < t.length; i += 1) { const m = casar(t, i); if (m) m.codigos.forEach((c) => out.add(c)); }
  return [...out];
}

// Sugestões enquanto a pessoa digita: o exame escrito inteiro ("hemograma em Campinas"; exato, com os códigos em
// exames; no "eco", ambiguo; em "dengue", doenca: o que foi digitado) ou os nomes que começam com o que foi digitado
// ("resson", "exame de sa", "hemo"). lugar e sobra: os de separar.
export function sugerir(texto, max = 8) {
  const s = separar(texto);
  const nada = { itens: [], ambiguo: null, doenca: null, exato: false, exames: [], lugar: s.lugar, sobra: s.sobra };
  if (s.exames.length) {
    const itens = s.achados.flatMap((a) => a.codigos.map((codigo) => ({ codigo, nome: a.nome, tipo: a.tipo, erro: a.erro })));
    const amb = s.achados.find((a) => a.codigos.length > 1);
    const doe = s.achados.find((a) => a.doenca);
    return { ...nada, itens: itens.slice(0, max), ambiguo: amb ? amb.nome : null, doenca: doe ? doe.digitado : null, exato: true, exames: s.exames };
  }
  const t = palavras(texto).map((x) => x.p);
  let i = 0;
  while (i < t.length - 1 && ENCHE.has(t[i])) i += 1;
  const q = t.slice(i);
  if (!q.length || (q.length === 1 && ENCHE.has(q[0]))) return nada;
  const ult = q[q.length - 1];
  const hits = [];
  for (const en of ENTRADAS) {
    if (en.junto || ult.length < (en.tipo === 'e' ? 3 : 2)) continue;
    for (let o = 0; o + q.length <= en.toks.length; o += 1) {
      let erros = 0, ok = true;
      for (let k = 0; k < q.length && ok; k += 1) {
        const w = en.toks[o + k];
        if (q[k] === w) continue;
        const fim = k === q.length - 1;
        if (fim && w.startsWith(q[k])) continue;
        if (parecida(q[k], w) || (fim && comecoParecido(q[k], w))) erros += 1;
        else ok = false;
      }
      if (ok && erros <= 1) { hits.push({ en, erros, o }); break; }
    }
  }
  hits.sort((a, b) => a.erros - b.erros || (a.o > 0) - (b.o > 0) || TIPOS[a.en.tipo] - TIPOS[b.en.tipo] || a.en.nome.length - b.en.nome.length);
  const itens = [], vistos = [];
  for (const { en, erros } of hits) {
    for (const codigo of en.codigos) {
      const nome = dobrar(en.nome);
      // n e a: um por exame; e: sem "Glicemia de jejum" depois de "Glicemia".
      if (vistos.some((v) => v.codigo === codigo && (en.tipo !== 'e' ? v.tipo !== 'e' : v.tipo === 'e' && nome.startsWith(v.nome)))) continue;
      vistos.push({ codigo, tipo: en.tipo, nome });
      itens.push({ codigo, nome: en.nome, tipo: en.tipo, erro: erros > 0 });
    }
  }
  return { ...nada, itens: itens.slice(0, max) };
}

// Outros nomes do exame de imagem, sem acento, para a lista de exames do médico achar "USG", "ecografia", "tomo" ou
// "RNM" (tele-core.js searchCatalog). No laboratório, não: lá são nomes de grupos ("exame de sangue"), não de cada exame.
export function apelidos(codigo) {
  if (codigo === 'lab') return [];
  return ENTRADAS.filter((en) => !en.junto && en.tipo !== 'e' && en.codigos.includes(codigo)).map((en) => dobrar(en.nome));
}
