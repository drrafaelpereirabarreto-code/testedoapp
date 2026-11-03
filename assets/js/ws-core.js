// Regras puras do prontuário (iMed Medical Workspace, fase 2), sem tela e sem banco: o mesmo modelo do conteúdo que o
// banco confere (private.ws_conteudo_erro em supabase/migrations/*_prontuario.sql), sinais vitais com a origem de cada
// número, troca SOAP <-> texto livre sem perder nada, IMC com a origem dos dois números, formato do CID-10 e filtros
// da linha do tempo. Testado em tests/ws-core.test.mjs.

export const TEXTO_MAX = 8000;
export const LIVRE_MAX = 20000;
export const MEDIDAS_MAX = 30;
export const DIAG_MAX = 20;

export const ANAMNESE = [
  ['queixa', 'Queixa principal'],
  ['hda', 'História da doença atual'],
  ['antecedentes', 'Antecedentes pessoais'],
  ['familiares', 'Antecedentes familiares'],
  ['habitos', 'Hábitos de vida'],
  ['medicamentos', 'Medicamentos em uso (relatados)'],
  ['alergias', 'Alergias (relatadas)'],
  ['revisao', 'Revisão de sistemas'],
];
export const SOAP = [
  ['s', 'S: Subjetivo'],
  ['o', 'O: Objetivo'],
  ['a', 'A: Avaliação'],
  ['p', 'P: Plano'],
];

// Sinais vitais: unidade fixa e faixa plausível (as mesmas de private.ws_unidade e private.ws_faixa_ok).
export const MEDIDAS = {
  pa_sistolica: { rotulo: 'Pressão sistólica', unidade: 'mmHg', min: 40, max: 300, passo: 1 },
  pa_diastolica: { rotulo: 'Pressão diastólica', unidade: 'mmHg', min: 20, max: 200, passo: 1 },
  fc: { rotulo: 'Frequência cardíaca', unidade: 'bpm', min: 20, max: 300, passo: 1 },
  fr: { rotulo: 'Frequência respiratória', unidade: 'irpm', min: 4, max: 80, passo: 1 },
  temperatura: { rotulo: 'Temperatura', unidade: '°C', min: 30, max: 45, passo: 0.1 },
  spo2: { rotulo: 'Saturação de oxigênio', unidade: '%', min: 50, max: 100, passo: 1 },
  peso: { rotulo: 'Peso', unidade: 'kg', min: 0.3, max: 400, passo: 0.1 },
  altura: { rotulo: 'Altura', unidade: 'cm', min: 20, max: 250, passo: 1 },
  glicemia_capilar: { rotulo: 'Glicemia capilar', unidade: 'mg/dL', min: 10, max: 1000, passo: 1 },
};

// Origem de cada número (quem mediu + como foi obtido). "Integração com aparelho" e "profissional junto do
// paciente" ainda não existem: ficam fora da lista (o banco também recusa).
export const ORIGENS = [
  { id: 'paciente_relato', quem_mediu: 'paciente', como_obtido: 'relato', rotulo: 'Medido pelo paciente (informado por ele)' },
  { id: 'paciente_camera', quem_mediu: 'paciente', como_obtido: 'aparelho_na_camera', rotulo: 'Medido pelo paciente com aparelho, visto na câmera', hora: true },
  { id: 'acompanhante_relato', quem_mediu: 'acompanhante', como_obtido: 'relato', rotulo: 'Medido pelo acompanhante (informado)' },
  { id: 'paciente_estimado', quem_mediu: 'paciente', como_obtido: 'estimado', rotulo: 'Estimado pelo paciente (sem aparelho)' },
  { id: 'medico_video', quem_mediu: 'medico', como_obtido: 'contado_pelo_medico_no_video', rotulo: 'Observado pelo médico no vídeo (contagem)', so: ['fr'] },
];
export const origemDe = (m) => ORIGENS.find((o) => o.quem_mediu === m?.quem_mediu && o.como_obtido === m?.como_obtido) || null;
export const origensPara = (tipo) => ORIGENS.filter((o) => !o.so || o.so.includes(tipo));
export function origemTexto(m) {
  const o = origemDe(m);
  if (!o) return 'Origem não informada';
  return o.rotulo + (m.aparelho ? ` (${m.aparelho})` : '');
}

export const PAPEIS = [['principal', 'Principal'], ['secundario', 'Secundário'], ['hipotese', 'Hipótese']];
export const SITUACOES = [['suspeito', 'Suspeito'], ['confirmado', 'Confirmado'], ['descartado', 'Descartado']];

const str = (v) => (typeof v === 'string' ? v : '');
const tem = (v) => str(v).trim() !== '';

export function vazio() {
  return { modo: 'soap', anamnese: {}, exame: { geral: '', medidas: [] }, diagnosticos: [], conduta: '', soap: {}, livre: '', nao_classificado: '' };
}

// Conteúdo que veio do banco (ou de uma versão antiga), com todas as chaves.
export function normalizar(c) {
  const v = vazio();
  if (!c || typeof c !== 'object') return v;
  v.modo = c.modo === 'livre' ? 'livre' : 'soap';
  for (const [k] of ANAMNESE) if (tem(c.anamnese?.[k])) v.anamnese[k] = str(c.anamnese[k]);
  for (const [k] of SOAP) if (tem(c.soap?.[k])) v.soap[k] = str(c.soap[k]);
  v.exame.geral = str(c.exame?.geral);
  v.exame.medidas = Array.isArray(c.exame?.medidas) ? c.exame.medidas.map((m) => ({ ...m })) : [];
  v.diagnosticos = Array.isArray(c.diagnosticos) ? c.diagnosticos.map((d) => ({ ...d })) : [];
  v.conduta = str(c.conduta);
  v.livre = str(c.livre);
  v.nao_classificado = str(c.nao_classificado);
  return v;
}

// O que vai para o banco: sem campos vazios (nada inventado, nada a mais).
export function paraSalvar(c) {
  const n = normalizar(c);
  const out = { modo: n.modo };
  const an = Object.fromEntries(Object.entries(n.anamnese).filter(([, t]) => tem(t)));
  if (Object.keys(an).length) out.anamnese = an;
  const ex = {};
  if (tem(n.exame.geral)) ex.geral = n.exame.geral;
  if (n.exame.medidas.length) ex.medidas = n.exame.medidas.map(medidaLimpa);
  if (Object.keys(ex).length) out.exame = ex;
  if (n.diagnosticos.length) out.diagnosticos = n.diagnosticos.map((d) => ({ cid: d.cid || null, descricao: str(d.descricao).trim(), papel: d.papel, situacao: d.situacao }));
  if (tem(n.conduta)) out.conduta = n.conduta;
  const so = Object.fromEntries(Object.entries(n.soap).filter(([, t]) => tem(t)));
  if (Object.keys(so).length) out.soap = so;
  if (tem(n.livre)) out.livre = n.livre;
  if (tem(n.nao_classificado)) out.nao_classificado = n.nao_classificado;
  return out;
}
function medidaLimpa(m) {
  const o = { tipo: m.tipo, valor: Number(m.valor), quem_mediu: m.quem_mediu, como_obtido: m.como_obtido };
  if (tem(m.aparelho)) o.aparelho = m.aparelho.trim();
  if (tem(m.medido_em)) o.medido_em = m.medido_em;
  return o;
}

// Número digitado (aceita vírgula). null se não for número.
export function numero(t) {
  const s = String(t ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

// Confere uma medida antes de pôr na lista. Devolve a mensagem do erro ou null.
export function medidaErro(m, agora = Date.now()) {
  const def = MEDIDAS[m?.tipo];
  if (!def) return 'Escolha o sinal vital.';
  if (typeof m.valor !== 'number' || !Number.isFinite(m.valor)) return 'Digite o valor medido (sinal não aferido: não registre).';
  if (m.valor < def.min || m.valor > def.max) return `Valor fora do esperado para ${def.rotulo.toLowerCase()} (${fmtNum(def.min)} a ${fmtNum(def.max)} ${def.unidade}). Confira.`;
  const o = origemDe(m);
  if (!o) return 'Escolha a origem do número (quem mediu e como).';
  if (o.so && !o.so.includes(m.tipo)) return 'Pelo vídeo, o médico só consegue contar a frequência respiratória.';
  if (str(m.aparelho).length > 80) return 'Nome do aparelho: até 80 caracteres.';
  if (o.hora) {
    if (!tem(m.medido_em)) return 'Informe a hora da medida.';
    const t = Date.parse(m.medido_em);
    if (!Number.isFinite(t) || t > agora + 5 * 60e3 || t < agora - 30 * 86400e3) return 'Hora da medida inválida.';
  }
  return null;
}

// O mesmo que o banco confere no conteúdo inteiro (resposta: campo com problema ou null).
export function conteudoErro(c) {
  const n = normalizar(c);
  for (const [k] of ANAMNESE) if (str(n.anamnese[k]).length > TEXTO_MAX) return `anamnese.${k}`;
  for (const [k] of SOAP) if (str(n.soap[k]).length > TEXTO_MAX) return `soap.${k}`;
  if (n.exame.geral.length > TEXTO_MAX) return 'exame.geral';
  for (const k of ['conduta', 'livre', 'nao_classificado']) if (n[k].length > LIVRE_MAX) return k;
  if (n.exame.medidas.length > MEDIDAS_MAX) return 'exame.medidas';
  for (const [i, m] of n.exame.medidas.entries()) if (medidaErro(m)) return `medida.${i + 1}`;
  if (n.diagnosticos.length > DIAG_MAX) return 'diagnosticos';
  for (const [i, d] of n.diagnosticos.entries()) {
    const t = str(d.descricao).trim();
    if (t.length < 2 || t.length > 300) return `diagnostico.${i + 1}.descricao`;
    if (d.cid != null && d.cid !== '' && !/^[A-Z][0-9]{2}[0-9X]?$/.test(d.cid)) return `diagnostico.${i + 1}.cid`;
    if (!PAPEIS.some(([p]) => p === d.papel)) return `diagnostico.${i + 1}.papel`;
    if (!SITUACOES.some(([s]) => s === d.situacao)) return `diagnostico.${i + 1}.situacao`;
  }
  if (n.diagnosticos.filter((d) => d.papel === 'principal').length > 1) return 'diagnosticos.principal';
  return null;
}

export function estaVazio(c) {
  const n = normalizar(c);
  return !Object.values(n.anamnese).some(tem) && !Object.values(n.soap).some(tem) && !tem(n.livre) && !tem(n.conduta)
    && !tem(n.exame.geral) && !tem(n.nao_classificado) && !n.exame.medidas.length && !n.diagnosticos.length;
}

/* ---------- SOAP <-> texto livre, sem perder nada ---------- */
const ROT = { s: 'S', o: 'O', a: 'A', p: 'P' };
export function soapParaTexto(soap) {
  return SOAP.filter(([k]) => tem(soap?.[k])).map(([k]) => `${ROT[k]}: ${str(soap[k]).trim()}`).join('\n\n');
}
// Texto com "S:", "O:", "A:", "P:" no começo da linha (também "Subjetivo:", "Avaliação:"...) vira SOAP; o que não
// estiver debaixo de nenhum rótulo volta em "resto" (fica em "Texto não classificado", nunca some).
export function textoParaSoap(texto) {
  const soap = {};
  const resto = [];
  let atual = null;
  const RX = /^\s*(s|o|a|p|subjetivo|objetivo|avalia[cç][aã]o|plano)\s*[:\-–]\s?(.*)$/i;
  const chave = (r) => ({ s: 's', subjetivo: 's', o: 'o', objetivo: 'o', a: 'a', p: 'p', plano: 'p' }[r.toLowerCase()] || (/^avalia/i.test(r) ? 'a' : null));
  for (const linha of String(texto || '').split('\n')) {
    const m = linha.match(RX);
    if (m) {
      atual = chave(m[1]);
      soap[atual] = soap[atual] ? `${soap[atual]}\n${m[2]}` : m[2];
    } else if (atual) {
      soap[atual] += `\n${linha}`;
    } else {
      resto.push(linha);
    }
  }
  for (const k of Object.keys(soap)) { soap[k] = soap[k].replace(/\s+$/, ''); if (!soap[k].trim()) delete soap[k]; }
  return { soap, resto: resto.join('\n').trim() };
}

// Troca o modo da evolução. Nada é apagado: o outro formato continua guardado; se o formato novo estiver vazio, ele
// nasce do outro (SOAP vira texto com rótulos; texto com rótulos vira SOAP e o que sobrar vai para "não classificado").
export function alternarModo(c, novo) {
  const n = normalizar(c);
  if (novo !== 'soap' && novo !== 'livre') return n;
  if (n.modo === novo) return n;
  if (novo === 'livre' && !tem(n.livre)) n.livre = soapParaTexto(n.soap);
  if (novo === 'soap' && !Object.values(n.soap).some(tem) && tem(n.livre)) {
    const { soap, resto } = textoParaSoap(n.livre);
    n.soap = soap;
    if (resto) n.nao_classificado = tem(n.nao_classificado) ? `${n.nao_classificado.trim()}\n\n${resto}` : resto;
  }
  n.modo = novo;
  return n;
}
// O outro formato tem algo que o atual não mostra? (a pré-visualização mostra os dois nesse caso)
export function outroFormatoDiferente(c) {
  const n = normalizar(c);
  if (n.modo === 'soap') return tem(n.livre) && n.livre.trim() !== soapParaTexto(n.soap).trim();
  return Object.values(n.soap).some(tem) && soapParaTexto(n.soap).trim() !== n.livre.trim();
}

/* ---------- IMC (só na tela; nunca gravado como medida) ---------- */
export function imc(medidas, idadeAnos = null) {
  const ultima = (t) => [...(medidas || [])].reverse().find((m) => m.tipo === t && Number.isFinite(Number(m.valor)));
  const p = ultima('peso');
  const a = ultima('altura');
  if (!p || !a) return null;
  const valor = Number(p.valor) / ((Number(a.valor) / 100) ** 2);
  if (!Number.isFinite(valor)) return null;
  const v = Math.round(valor * 10) / 10;
  const crianca = idadeAnos != null && idadeAnos < 20;
  return {
    valor: v,
    texto: `IMC ${fmtNum(v)} kg/m²`,
    // Menores de 20 anos: só o número (a classificação de adulto não vale; exige percentil).
    classificacao: crianca ? null : classeAdulto(v),
    origem: `Peso: ${origemTexto(p)}. Altura: ${origemTexto(a)}.`,
    aviso: crianca ? 'Menor de 20 anos: a classificação de adulto não se aplica (avaliar por percentil).' : null,
  };
}
function classeAdulto(v) {
  if (v < 18.5) return 'Abaixo de 18,5';
  if (v < 25) return 'Entre 18,5 e 24,9';
  if (v < 30) return 'Entre 25 e 29,9';
  return '30 ou mais';
}

/* ---------- CID-10 ---------- */
export const cidFmt = (c) => (/^[A-Z][0-9]{2}[0-9X]$/.test(String(c || '')) ? `${c.slice(0, 3)}.${c.slice(3)}` : String(c || ''));
export function avisoSexo(restr) {
  if (restr === 'M') return 'Este código costuma se aplicar ao sexo masculino. Confira.';
  if (restr === 'F') return 'Este código costuma se aplicar ao sexo feminino. Confira.';
  return '';
}

/* ---------- linha do tempo ---------- */
export const FILTROS = [
  ['tudo', 'Tudo'],
  ['registro', 'Registro'],
  ['versao', 'Versões'],
  ['diagnostico', 'Diagnósticos'],
  ['adendo', 'Adendos'],
  ['documento', 'Documentos'],
];
const GRUPO = { finalizado: 'registro', encerrado_sem_finalizar: 'registro', versao: 'versao', diagnostico: 'diagnostico', adendo: 'adendo', documento: 'documento' };
export const grupoDe = (ev) => GRUPO[ev?.tipo] || 'registro';
export function filtrarEventos(eventos, filtro = 'tudo') {
  const lista = Array.isArray(eventos) ? eventos : [];
  return filtro === 'tudo' ? lista : lista.filter((e) => grupoDe(e) === filtro);
}
export function contarPorFiltro(eventos) {
  const out = Object.fromEntries(FILTROS.map(([k]) => [k, 0]));
  for (const e of Array.isArray(eventos) ? eventos : []) { out.tudo += 1; out[grupoDe(e)] += 1; }
  return out;
}

export function fmtNum(v) {
  return String(v).replace('.', ',');
}

// Texto curto de quanto tempo faz (para "Salvo há 3 s").
export function haQuanto(t, agora = Date.now()) {
  const s = Math.max(0, Math.round((agora - t) / 1000));
  if (s < 5) return 'agora';
  if (s < 60) return `há ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  return `há ${Math.round(m / 60)} h`;
}
