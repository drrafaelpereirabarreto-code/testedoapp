// Documentos médicos da teleconsulta (pedido de exames, receita simples, atestado, declaração de comparecimento,
// encaminhamento, relatório médico e orientações): modelos de texto, validações iguais às do banco, CPF, código de
// conferência, QR Code e a montagem do PDF que o médico assina fora do IMED (certificado ICP-Brasil).
// Lógica pura: roda no navegador (medico.js, teleconsulta.js, documento.js) e no Node (tests/tele-docs.test.mjs).
// As bibliotecas (pdf-lib e qrcode-generator, em assets/vendor) chegam como parâmetro ou por import() na hora do uso.
// Contrato do banco: supabase/migrations/*_tele_documentos.sql. Regras: pesquisa de 30/10/2026 (Res. CFM 2.381/2024 e
// 2.314/2022, Lei 5.991/1973 art. 35, Lei 14.063/2020, RDC Anvisa 1.000/2025) e Guia do Desenvolvedor do validar.iti.gov.br.
import * as T from './tele-core.js';

const esc = T.esc;

/* ======================= tipos de documento ======================= */
// oid: código do tipo de documento de saúde que o validador do ITI (validar.iti.gov.br) lê nos metadados do PDF
// (ramo 2.16.76.1.12.1 da ICP-Brasil, conforme o Guia do Desenvolvedor do Validar). Só os tipos confirmados no guia;
// declaração de comparecimento, encaminhamento e orientações não têm código confirmado e vão sem ele.
export const KINDS = [
  { id: 'exames', tab: 'Pedido de exames', title: 'Solicitação de exames', oid: '2.16.76.1.12.1.3' },
  { id: 'receita', tab: 'Receita', title: 'Receita', oid: '2.16.76.1.12.1.1' },
  { id: 'atestado', tab: 'Atestado', title: 'Atestado médico', oid: '2.16.76.1.12.1.2' },
  { id: 'comparecimento', tab: 'Comparecimento', title: 'Declaração de comparecimento', oid: null },
  { id: 'encaminhamento', tab: 'Encaminhamento', title: 'Encaminhamento', oid: null },
  { id: 'relatorio', tab: 'Relatório', title: 'Relatório médico', oid: '2.16.76.1.12.1.11' },
  { id: 'orientacoes', tab: 'Orientações', title: 'Orientações ao paciente', oid: null },
];
export const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k]));
// Registro do médico no CFM (ramo 2.16.76.1.4.2.2): número do CRM, UF e especialidade.
export const ITI_OID = { crm: '2.16.76.1.4.2.2.1', uf: '2.16.76.1.4.2.2.2', especialidade: '2.16.76.1.4.2.2.3' };

export const TELEMED = 'Documento emitido em modalidade de telemedicina';
export const CFM_PRESCRICAO_URL = 'https://prescricaoeletronica.cfm.org.br/';
export const ITI_URL = 'https://validar.iti.gov.br/';
export const MAX_PDF_BYTES = 3 * 1024 * 1024; // igual ao banco (3.145.728 bytes)
export const UPLOAD_DAYS = 7;                 // enviar o PDF assinado até 7 dias depois de emitir (um PDF por documento)
export const EMIT_HOURS = 24;                 // emitir até 24 horas depois de encerrar a consulta
export const MAX_DOCS = 30;                   // por consulta

/* ======================= receita: só a simples ======================= */
// RDC Anvisa 1.000/2025: desde 30/09/2026 a receita eletrônica de antibiótico, de canetas GLP-1, de controle especial e
// as notificações estão passando para o SNCR da Anvisa (transição que a Anvisa prorrogou para 3/3/2027, a confirmar no
// Diário Oficial). O IMED não é ligado ao SNCR: para evitar recusa na farmácia, bloqueia aqui e no banco.
export const RECEITA_TIPOS = [
  { id: 'simples', label: 'Receita simples: remédio vendido sem retenção da receita na farmácia' },
  { id: 'antimicrobiano', label: 'Antibiótico (antimicrobiano) ou caneta GLP-1 (semaglutida, liraglutida, tirzepatida e outras)', block: 'sncr' },
  { id: 'controle_especial_c1', label: 'Remédio controlado (Portaria 344: lista C1 e as demais de controle especial, receita branca em 2 vias)', block: 'sncr' },
  { id: 'notificacao', label: 'Notificação de receita: azul ou amarela (listas A e B), B2, retinoides ou talidomida', block: 'notificacao' },
];
export const BLOCK_TEXT = {
  sncr: 'Receita de antibiótico, de canetas GLP-1 e de remédio controlado (lista C1 e as demais de controle especial, receita branca em 2 vias) não sai pelo IMED. A Anvisa está passando a versão eletrônica dessas receitas para o sistema dela (SNCR), e a farmácia pode recusar a que não sair de uma plataforma ligada a ele. O IMED não é ligado ao SNCR. Use a Plataforma de Prescrição Eletrônica do CFM (gratuita e ligada ao SNCR) ou receita em papel, e registre no prontuário.',
  notificacao: 'Notificação de receita (azul ou amarela: listas A e B, B2, retinoides e talidomida) não sai pelo IMED: só pode ser eletrônica por plataforma ligada ao SNCR da Anvisa, com a numeração da Vigilância Sanitária, ou no talonário de papel. Use a Plataforma de Prescrição Eletrônica do CFM ou o talonário, e registre no prontuário.',
};
export const receitaBlock = (tipo) => RECEITA_TIPOS.find((t) => t.id === tipo)?.block || null;

// Lista curta de ALERTA (nunca libera nada): nomes comuns de antibiótico, caneta GLP-1 e remédio controlado
// (Portaria 344/98). Se aparecerem na receita simples, a tela mostra o aviso do SNCR e pede confirmação. Mantida pelo
// Dr. Rafael: acrescente ou tire nomes aqui (minúsculas, sem acento).
export const RX_ALERTS = [
  { cat: 'antibiótico', names: ['amoxicilina', 'clavulanato', 'azitromicina', 'claritromicina', 'cefalexina', 'cefuroxima', 'ciprofloxacino', 'levofloxacino',
    'sulfametoxazol', 'nitrofurantoina', 'doxiciclina', 'amoxil', 'clavulin', 'zitromax', 'bactrim'] },
  { cat: 'caneta GLP-1', names: ['semaglutida', 'liraglutida', 'tirzepatida', 'dulaglutida', 'ozempic', 'wegovy', 'rybelsus', 'mounjaro', 'saxenda', 'victoza', 'trulicity'] },
  { cat: 'remédio controlado (Portaria 344)', names: ['clonazepam', 'alprazolam', 'diazepam', 'zolpidem', 'sertralina', 'fluoxetina', 'escitalopram',
    'rivotril', 'frontal', 'valium', 'stilnox', 'zoloft', 'prozac', 'lexapro'] },
];
const foldRx = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Itens da receita com nome da lista de alerta: [{n, name, word, cat}].
export function rxAlerts(itens) {
  const out = [];
  (Array.isArray(itens) ? itens : []).forEach((it, i) => {
    const text = foldRx(it?.medicamento);
    for (const g of RX_ALERTS) {
      const word = g.names.find((w) => new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(text));
      if (word) { out.push({ n: i + 1, name: oneLine(it?.medicamento), word, cat: g.cat }); break; }
    }
  });
  return out;
}
// Endereço residencial (Lei 5.991/1973, art. 35): pelo menos o número da casa ou "s/n". Só a cidade/UF não basta.
export const residentialLike = (v) => /\d/.test(String(v ?? '')) || /(^|[^a-z])s\s*\/\s*n([^a-z]|$)|sem\s+n[uú]mero/i.test(String(v ?? ''));

// Abreviações comuns em receita: a lei pede o modo de usar por extenso (Lei 5.991/1973, art. 35). Só avisa.
const ABBREV = [
  [/\bcps?\b|\bcomps?\b|\bcpr\b/i, 'comprimido'], [/\bv\.?\s?o\.?\b/i, 'por via oral'], [/\bgts?\b/i, 'gotas'],
  [/\b\d{1,2}\s?\/\s?\d{1,2}\s?h\b/i, 'a cada X horas'], [/\bs\.?o\.?s\.?\b/i, 'se precisar (com a condição)'],
  [/\ba\.?c\.?m\.?\b/i, 'a critério médico'], [/\bamp\b/i, 'ampola'], [/\bcx\b/i, 'caixa'], [/\bfr\b/i, 'frasco'],
];
export function abbrevWarnings(text) {
  const s = String(text ?? '');
  return ABBREV.filter(([re]) => re.test(s)).map(([, by]) => by);
}

/* ======================= texto que cabe no PDF ======================= */
// O PDF usa as fontes padrão (Helvetica), que só têm os caracteres do Windows-1252 (todo o português cabe). Trocas
// automáticas para os símbolos mais comuns; o resto o médico precisa reescrever (o paciente vê o mesmo texto).
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const SWAP = {
  '≤': '<=', '≥': '>=', '≠': 'diferente de', '→': '->', '←': '<-', '⇒': '=>', '−': '-', '‐': '-', '‑': '-', '‒': '-', '―': '—',
  '′': "'", '″': '"', 'μ': 'µ', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8', '∕': '/', '⁄': '/', '✓': 'v', '✔': 'v', '×': '×',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '　': ' ',
  '­': '', '​': '', '‌': '', '‍': '', '⁠': '', '﻿': '', ' ': '\n', ' ': '\n',
};
export const winAnsiOk = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff) || CP1252_EXTRA.includes(ch);
};
// Texto do médico antes de ir para o banco: quebras de linha iguais, sem caracteres de controle, símbolos trocados.
export function cleanText(v) {
  return [...String(v ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ')]
    .map((ch) => (Object.prototype.hasOwnProperty.call(SWAP, ch) ? SWAP[ch] : ch))
    .join('')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
}
export const oneLine = (v) => cleanText(v).replace(/\s+/g, ' ').trim();
// Caracteres que não saem no PDF (depois das trocas), sem repetir.
export function pdfUnsupported(v) {
  const bad = new Set();
  for (const ch of cleanText(v)) if (ch !== '\n' && !winAnsiOk(ch)) bad.add(ch);
  return [...bad];
}
// Para o PDF: o que não cabe vira a letra mais parecida (ex.: "ễ" -> "ê") ou "?". Usado nos dados que vêm do banco
// (nome do paciente, por exemplo), que o médico não digitou.
export function pdfSafe(v) {
  let out = '';
  for (const ch of cleanText(v)) {
    if (ch === '\n' || winAnsiOk(ch)) { out += ch; continue; }
    const parts = [...ch.normalize('NFD')];
    const two = parts.length > 1 ? (parts[0] + parts[1]).normalize('NFC') : '';
    if (two && [...two].length === 1 && winAnsiOk(two)) out += two;
    else if (parts.length > 1 && winAnsiOk(parts[0])) out += parts[0];
    else out += '?';
  }
  return out;
}
const len = (s) => [...String(s ?? '')].length;

/* ======================= CPF ======================= */
export const cpfDigits = (v) => T.onlyDigits(v);
// Dígitos verificadores (mesma conta de private.tele_cpf_ok).
export function isCpf(v) {
  const d = String(v ?? '');
  if (!/^[0-9]{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += Number(d[i]) * (n + 1 - i);
    return ((s * 10) % 11) % 10;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
export function fmtCpf(v) {
  const d = cpfDigits(v);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : String(v ?? '');
}
export function maskCpf(v) {
  const d = cpfDigits(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/* ======================= código de conferência ======================= */
// 10 caracteres de 23456789ABCDEFGHJKLMNPQRSTUVWXYZ (sem 0, O, 1 e I), sorteados pelo banco. Mostrado como XXXXX-XXXXX.
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_RE = /^[2-9A-HJ-NP-Z]{10}$/;
export function normCode(v) {
  const s = String(v ?? '');
  if (s.length > 40) return null;
  const c = s.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return CODE_RE.test(c) ? c : null;
}
export const fmtCode = (v) => { const c = normCode(v); return c ? `${c.slice(0, 5)}-${c.slice(5)}` : ''; };
// Endereço público do site com barra no fim (IMED_CONFIG.siteUrl).
export function siteBase(site) {
  const s = String(site || '').trim().replace(/[?#].*$/, '');
  if (!s) return '';
  return s.endsWith('/') ? s : `${s}/`;
}
export const verifyPath = (code) => { const c = normCode(code); return c ? `documento.html?c=${c}` : 'documento.html'; };
export const verifyUrl = (site, code) => `${siteBase(site)}${verifyPath(code)}`;

/* ======================= contato e endereço ======================= */
// Contato profissional como o banco guarda: e-mail em minúsculas ou telefone com DDD (só dígitos, sem o +55).
export function checkContact(v) {
  const s = oneLine(v);
  if (!s) return { ok: false, value: null };
  if (s.includes('@')) {
    const e = s.toLowerCase();
    const ok = len(e) >= 6 && len(e) <= 120 && /^[^@\s]+@[^@\s]+\.[^@\s.]+$/.test(e);
    return { ok, value: ok ? e : null };
  }
  if (!/^[0-9()+.\- ]+$/.test(s)) return { ok: false, value: null };
  const d = T.normPhone(s);
  return T.isPhone(d) ? { ok: true, value: d } : { ok: false, value: null };
}
export const fmtContact = (v) => (String(v ?? '').includes('@') ? String(v) : T.fmtPhone(v));
// Sigla do estado em maiúsculas no fim ("Recife/pe" -> "Recife/PE").
export function fixUf(v) {
  const s = oneLine(v);
  return s.replace(/([/\-,\s])([A-Za-z]{2})\.?$/, (m, sep, uf) => (T.UFS.includes(uf.toUpperCase()) ? `${sep}${uf.toUpperCase()}` : m));
}
const UF_RE = new RegExp(`(^|[^A-Za-zÀ-ÿ])(${T.UFS.join('|')})([^A-Za-zÀ-ÿ]|$)`);
export const hasUf = (v) => UF_RE.test(String(v ?? ''));

/* ======================= perfil do médico e dados do paciente ======================= */
// Mesmas regras de tele_doctor_profile. Devolve os erros por campo e os argumentos da função.
export function checkProfile({ address, contact } = {}) {
  const errors = {};
  const a = oneLine(address);
  const c = checkContact(contact);
  if (len(a) < 5 || len(a) > 200) errors.address = 'Escreva o endereço profissional (rua, número, cidade/UF), de 5 a 200 caracteres. Pode ser o do consultório ou o residencial.';
  else if (pdfUnsupported(a).length) errors.address = `Troque estes caracteres, que não saem no PDF: ${pdfUnsupported(a).join(' ')}`;
  if (!c.ok) errors.contact = 'Informe um telefone com DDD, como (11) 3456-7890, ou um e-mail profissional.';
  return { ok: !Object.keys(errors).length, errors, args: { p_prof_address: a, p_prof_contact: c.value } };
}
export const profileComplete = (p) => !!(p && oneLine(p.prof_address).length >= 5 && checkContact(p.prof_contact).ok);

// CPF (ou "não possui CPF") e endereço/local do paciente. Mesmas regras de tele_doc_patient_data, mais: o médico
// escolhe entre CPF e "não possui" (Res. CFM 2.381/2024; o banco guarda os dois) e o endereço tem a sigla do estado.
export function checkPatient({ cpf, noCpf, address } = {}) {
  const errors = {};
  const d = cpfDigits(cpf);
  const a = fixUf(address);
  if (!noCpf) {
    if (!String(cpf ?? '').trim()) errors.cpf = 'Informe o CPF do paciente ou marque “O paciente não possui CPF”.';
    else if (!/^[0-9.\-\s]+$/.test(String(cpf).trim()) || !isCpf(d)) errors.cpf = 'CPF inválido: confira os 11 números.';
  }
  if (len(a) < 3 || len(a) > 200) errors.address = 'Escreva o endereço do paciente ou, pelo menos, a cidade e a sigla do estado (ex.: Recife/PE).';
  else if (!hasUf(a)) errors.address = 'Inclua a sigla do estado (UF), por exemplo: Recife/PE.';
  else if (pdfUnsupported(a).length) errors.address = `Troque estes caracteres, que não saem no PDF: ${pdfUnsupported(a).join(' ')}`;
  return { ok: !Object.keys(errors).length, errors, args: { p_cpf: noCpf ? '' : d, p_address: a, p_no_cpf: !!noCpf } };
}
// Linha de tele_doc_patient_data -> dados do paciente na tela.
export const patientFromRow = (row) => ({
  cpf: row?.patient_cpf || null, address: row?.patient_address || null, noCpf: !!row?.patient_no_cpf, identityAt: row?.identity_checked_at || null,
});
// O que o médico está vendo e manda em tele_doc_create (p_expect): o banco recusa se o paciente mudou nesse meio-tempo.
export const patientExpect = (p) => ({ cpf: p?.cpf || null, sem_cpf: !!p?.noCpf, endereco: p?.address || null });
export const samePatient = (a, b) => JSON.stringify(patientExpect(a)) === JSON.stringify(patientExpect(b));
// Dados que faltam para emitir (o banco exige nome, endereço/local e CPF ou "não possui CPF").
export function patientMissing(p, noCpf = p?.noCpf) {
  const out = [];
  if (!p?.cpf && !noCpf) out.push('cpf');
  if (!p?.address || !hasUf(p.address)) out.push('address');
  return out;
}

/* ======================= datas ======================= */
export function addDays(iso, n) {
  if (!T.isIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const daySP = (ts) => { const t = new Date(ts ?? ''); return ts && !Number.isNaN(t.getTime()) ? T.todaySP(t) : ''; };
// Início do atendimento (vídeo, ligação ou mensagem: started_at). Sem ele não há documento: a hora do aceite NÃO
// serve (o banco recusa com 'atendimento_nao_iniciado').
export function consultStart(c) { return c?.started_at || null; }
export const consultDay = (c) => daySP(consultStart(c));

const UNITS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze',
  'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
// Número por extenso (0 a 999), para "3 (três) dias".
export function extenso(n) {
  const v = Math.trunc(Number(n));
  if (!Number.isFinite(v) || v < 0 || v > 999) return String(n);
  if (v < 20) return UNITS[v];
  if (v < 100) return TENS[Math.floor(v / 10)] + (v % 10 ? ` e ${UNITS[v % 10]}` : '');
  if (v === 100) return 'cem';
  return HUNDREDS[Math.floor(v / 100)] + (v % 100 ? ` e ${extenso(v % 100)}` : '');
}

/* ======================= validação de cada tipo ======================= */
// form: o que o médico preencheu. ctx: {consult, exams, indication, address (endereço do paciente na tela)}. Devolve
// {ok, errors, warnings, payload} com o payload no formato de tele_doc_create (o banco confere tudo de novo). errors usa
// o nome do campo; nos itens da receita, "itens.N.campo" (N a partir de 1, como o "hint" do banco).
const textField = (v) => cleanText(v).trim();
function pdfCheck(errors, key, v) {
  const bad = pdfUnsupported(v);
  if (bad.length && !errors[key]) errors[key] = `Troque estes caracteres, que não saem no PDF: ${bad.join(' ')}`;
}
// CID do atestado e do relatório: só a pedido e com a autorização expressa do paciente (Res. CFM 2.381/2024).
function cidOf(f, errors) {
  let cid = String(f.cid ?? '').replace(/\s+/g, '').toUpperCase();
  if (/^[A-Z][0-9]{3}$/.test(cid)) cid = `${cid.slice(0, 3)}.${cid.slice(3)}`;
  if (cid && !/^[A-Z][0-9]{2}(\.[0-9])?$/.test(cid)) errors.cid = 'CID-10 inválido. Exemplos: J11 ou J11.1.';
  if (cid && !f.cidAutorizado) errors.cidAutorizado = 'O CID só entra com o pedido e a autorização expressa do paciente: marque a autorização ou apague o CID.';
  return cid;
}
export function validateDoc(kind, form = {}, ctx = {}) {
  const errors = {};
  const warnings = [];
  let payload = null;
  const f = form || {};
  if (!KIND[kind]) return { ok: false, errors: { documento: 'Escolha o tipo de documento.' }, warnings, payload };

  if (kind === 'exames') {
    const itens = T.examsPayload(ctx.exams || []);
    const ind = textField(f.indicacao ?? ctx.indication ?? '');
    if (!itens.length) errors.itens = 'Escolha os exames no quadro “Pedido de exames” antes de emitir.';
    if (len(ind) > 1000) errors.indicacao = 'A indicação clínica pode ter até 1.000 caracteres.';
    for (const [i, e] of itens.entries()) pdfCheck(errors, `itens.${i + 1}`, `${e.name} ${e.note || ''}`);
    pdfCheck(errors, 'indicacao', ind);
    payload = { itens, indicacao: ind || null };
  } else if (kind === 'receita') {
    const tipo = f.tipo || 'simples';
    const block = receitaBlock(tipo);
    if (block) errors.tipo = BLOCK_TEXT[block];
    else if (tipo !== 'simples') errors.tipo = 'Escolha o tipo de receita.';
    const list = Array.isArray(f.itens) ? f.itens : [];
    if (!list.length) errors.itens = 'Inclua pelo menos um medicamento.';
    if (list.length > 20) errors.itens = 'A receita pode ter até 20 medicamentos.';
    const itens = list.slice(0, 20).map((it, i) => {
      const n = i + 1;
      const k = (x) => `itens.${n}.${x}`;
      const o = {
        medicamento: oneLine(it?.medicamento), concentracao: oneLine(it?.concentracao), forma: oneLine(it?.forma) || null,
        via: oneLine(it?.via), posologia: textField(it?.posologia), quantidade: oneLine(it?.quantidade),
        duracao: oneLine(it?.duracao), observacao: textField(it?.observacao) || null,
      };
      if (len(o.medicamento) < 2 || len(o.medicamento) > 200) errors[k('medicamento')] = 'Escreva o nome do medicamento (de preferência o nome genérico).';
      if (!o.concentracao || len(o.concentracao) > 60) errors[k('concentracao')] = 'Informe a concentração (ex.: 500 mg), até 60 caracteres.';
      if (len(o.forma) > 60) errors[k('forma')] = 'A forma pode ter até 60 caracteres.';
      if (!o.via || len(o.via) > 40) errors[k('via')] = 'Informe a via (ex.: oral), até 40 caracteres.';
      if (len(o.posologia) < 3 || len(o.posologia) > 500) errors[k('posologia')] = 'Escreva o modo de usar por extenso (de 3 a 500 caracteres).';
      if (!o.quantidade || len(o.quantidade) > 100) errors[k('quantidade')] = 'Informe a quantidade (ex.: 1 caixa com 20 comprimidos).';
      if (!o.duracao || len(o.duracao) > 60) errors[k('duracao')] = 'Informe a duração (ex.: 5 dias ou uso contínuo).';
      if (len(o.observacao) > 300) errors[k('observacao')] = 'A observação do item pode ter até 300 caracteres.';
      for (const x of ['medicamento', 'concentracao', 'forma', 'via', 'posologia', 'quantidade', 'duracao', 'observacao']) pdfCheck(errors, k(x), o[x]);
      const ab = abbrevWarnings(`${o.posologia} ${o.quantidade}`);
      if (ab.length) warnings.push(`Item ${n}: evite abreviações; a lei pede o modo de usar por extenso (por exemplo: ${ab.join(', ')}).`);
      return o;
    });
    const obs = textField(f.observacao);
    if (len(obs) > 500) errors.observacao = 'As observações podem ter até 500 caracteres.';
    pdfCheck(errors, 'observacao', obs);
    if (!block && !f.confirmaSimples) errors.confirmaSimples = 'Confirme que nenhum item é antibiótico, caneta GLP-1, remédio controlado ou de notificação.';
    // Nome da lista de alerta: aviso do SNCR e confirmação própria (a lista nunca libera nada).
    const alerts = block ? [] : rxAlerts(itens);
    for (const a of alerts) warnings.push(`Item ${a.n}: “${a.name}” parece ser ${a.cat}. Se for, não sai pelo IMED (SNCR da Anvisa): veja o aviso abaixo.`);
    if (alerts.length && !f.confirmaAlerta) errors.confirmaAlerta = `Confira ${alerts.length === 1 ? `o item ${alerts[0].n}` : `os itens ${alerts.map((a) => a.n).join(', ')}`}: confirme que não precisa${alerts.length === 1 ? '' : 'm'} de retenção da receita na farmácia, ou tire da receita.`;
    if (!f.confirmaEndereco) errors.confirmaEndereco = 'Confirme que o endereço do paciente é o residencial completo (a lei exige na receita).';
    // Endereço em branco: quem avisa é o "Antes de emitir" (dados do paciente); aqui, só o que tem cidade e falta a rua.
    else if (ctx.address !== undefined && String(ctx.address ?? '').trim() && !residentialLike(ctx.address)) errors.confirmaEndereco = 'Para a receita, complete o endereço residencial do paciente (rua e número, ou “s/n”), no quadro “Dados do paciente”: só a cidade não basta.';
    payload = { tipo: 'simples', itens, observacao: obs || null, endereco_residencial: true };
  } else if (kind === 'atestado') {
    const day = consultDay(ctx.consult) || T.todaySP();
    const dias = String(f.dias ?? '').trim();
    if (!/^[0-9]{1,3}$/.test(dias) || Number(dias) < 1 || Number(dias) > 90) errors.dias = 'Informe os dias de afastamento: um número inteiro de 1 a 90.';
    else if (Number(dias) > 15) warnings.push('Mais de 15 dias: o trabalhador com carteira assinada passa pela perícia do INSS a partir do 16º dia.');
    const inicio = String(f.inicio || day);
    // Nunca antes do dia da consulta (Código de Ética Médica, art. 80); até 7 dias depois (igual ao banco).
    if (!T.isIsoDate(inicio) || inicio < day || inicio > addDays(day, 7)) errors.inicio = `O afastamento começa entre ${T.fmtDate(day)} (dia da consulta) e ${T.fmtDate(addDays(day, 7))}. Não pode começar antes da consulta.`;
    const cid = cidOf(f, errors);
    const obs = textField(f.observacao);
    if (len(obs) > 500) errors.observacao = 'As observações podem ter até 500 caracteres.';
    pdfCheck(errors, 'observacao', obs);
    const nd = Number(dias);
    payload = { dias: nd, inicio, cid: cid || null, cid_autorizado: !!(cid && f.cidAutorizado), observacao: obs || null };
    if (!errors.dias && !errors.inicio) payload.fim = addDays(inicio, nd - 1);
  } else if (kind === 'comparecimento') {
    // Só com a consulta encerrada: o dia e os horários vêm do registro (início do atendimento e encerramento).
    const c = ctx.consult || {};
    const start = c.started_at || null;
    const end = c.status === 'ended' ? c.ended_at || null : null;
    const obs = textField(f.observacao);
    if (len(obs) > 300) errors.observacao = 'A observação pode ter até 300 caracteres.';
    pdfCheck(errors, 'observacao', obs);
    if (!start) errors.horario = 'O atendimento não começou (sem vídeo, ligação ou mensagem): sem atendimento não há declaração.';
    else if (!end) errors.horario = 'A declaração sai depois de encerrar a consulta: o dia e os horários vêm do registro. Encerre a consulta e abra de novo em “Suas consultas anteriores” (até 24 horas).';
    else if (c.closed_by === 'system') warnings.push('A consulta foi encerrada automaticamente (passou de 3 horas): o fim registrado é o do encerramento automático, não o fim real do atendimento. Se não for verdade, não emita a declaração.');
    payload = { observacao: obs || null };
    // Prévia: o banco grava o dia e os horários do registro da consulta (não são digitados).
    ctx.preview = start ? { data: daySP(start), hora_inicio: T.fmtTime(start), data_fim: end ? daySP(end) : '', hora_fim: end ? T.fmtTime(end) : '' } : {};
  } else if (kind === 'encaminhamento') {
    const esp = oneLine(f.especialidade);
    const motivo = textField(f.motivo);
    const prio = ['eletiva', 'prioritaria', 'urgente'].includes(f.prioridade) ? f.prioridade : 'eletiva';
    const obs = textField(f.observacao);
    if (len(esp) < 2 || len(esp) > 80) errors.especialidade = 'Informe a especialidade ou o serviço (de 2 a 80 caracteres).';
    if (len(motivo) < 3 || len(motivo) > 2000) errors.motivo = 'Escreva o motivo do encaminhamento (de 3 a 2.000 caracteres).';
    if (len(obs) > 500) errors.observacao = 'As observações podem ter até 500 caracteres.';
    if (prio === 'urgente' && !f.orientouUrgencia) errors.orientouUrgencia = 'Encaminhamento urgente: confirme que orientou o paciente a procurar atendimento imediato se piorar.';
    for (const [k2, v] of [['especialidade', esp], ['motivo', motivo], ['observacao', obs]]) pdfCheck(errors, k2, v);
    payload = { especialidade: esp, motivo, prioridade: prio, observacao: obs || null };
  } else {
    const texto = textField(f.texto);
    if (len(texto) < 3 || len(texto) > 4000) errors.texto = kind === 'relatorio' ? 'Escreva o relatório (de 3 a 4.000 caracteres).' : 'Escreva as orientações (de 3 a 4.000 caracteres).';
    pdfCheck(errors, 'texto', texto);
    payload = { texto };
    // Relatório: CID (diagnóstico) só a pedido e com a autorização expressa do paciente, como no atestado.
    if (kind === 'relatorio') {
      const cid = cidOf(f, errors);
      payload = { texto, cid: cid || null, cid_autorizado: !!(cid && f.cidAutorizado) };
    }
  }
  return { ok: !Object.keys(errors).length, errors, warnings, payload };
}

/* ======================= situação do documento ======================= */
// Até quando o médico pode enviar o PDF assinado (7 dias depois de emitir).
export function signDeadline(d) {
  const t = Date.parse(d?.created_at || '');
  return Number.isFinite(t) ? new Date(t + UPLOAD_DAYS * 86400e3).toISOString() : null;
}
// O IMED não confere a validade da assinatura: "PDF assinado enviado", nunca "assinado/válido".
export function docStatus(d, now = Date.now()) {
  if (d?.status === 'cancelado') return { id: 'cancelado', label: 'Cancelado', cls: 'err', long: `Cancelado${d.cancelled_at ? ` em ${T.fmtDateTime(d.cancelled_at)}` : ''}: não use este documento.` };
  if (d?.signed) return { id: 'assinado', label: 'PDF assinado enviado', cls: 'ok', long: `O médico enviou o PDF com assinatura digital${d.signed_at ? ` em ${T.fmtDateTime(d.signed_at)}` : ''}. Use este arquivo e confira a assinatura em validar.iti.gov.br (o resultado precisa ser “Aprovado”).` };
  const until = signDeadline(d);
  if (until && now >= Date.parse(until)) return { id: 'vencido', label: 'Não assinado (prazo encerrado)', cls: 'err', long: 'O médico não enviou o PDF assinado no prazo de 7 dias. Este rascunho não vale como documento. Se você precisar dele, fale com o IMED ou peça uma nova consulta.' };
  return { id: 'rascunho', label: 'Rascunho sem assinatura', cls: 'warn', long: `Rascunho sem assinatura: não vale como documento oficial. Aguardando a assinatura do médico${until ? ` (até ${T.fmtDateTime(until)})` : ''}. Volte a esta página, neste aparelho, para baixar o PDF assinado.` };
}
// Pode enviar o PDF assinado? (só quem emitiu, documento não cancelado e ainda sem PDF, até 7 dias depois de emitir)
export function canUpload(d, now = Date.now()) {
  const t = Date.parse(d?.created_at || '');
  return d?.status === 'emitido' && !d?.signed && Number.isFinite(t) && now - t < UPLOAD_DAYS * 86400e3;
}
// Ainda dá para emitir documentos nesta consulta? (mesma regra do banco: atendimento começado e consulta aceita, em
// andamento ou encerrada há até 24 horas)
export function canEmit(c, now = Date.now()) {
  if (!c || !c.started_at) return false;
  if (c.status === 'accepted' || c.status === 'in_call') return true;
  if (c.status === 'ended') { const t = Date.parse(c.ended_at || ''); return Number.isFinite(t) && now - t < EMIT_HOURS * 3600e3; }
  return false;
}

/* ======================= modelo do documento (tela e PDF) ======================= */
// doc: linha de tele_doc_list / tele_patient_documents (ou um rascunho com os mesmos campos). Devolve o conteúdo
// pronto para a pré-visualização (docHtml) e para o PDF (buildPdf): os dois mostram exatamente os mesmos textos.
const PRIO = { eletiva: 'Eletiva', prioritaria: 'Prioritária', urgente: 'Urgente' };
const paras = (text) => pdfSafe(text).split('\n').map((s) => s.trim());
export function docModel(doc, { site = '', consult = null } = {}) {
  const k = KIND[doc?.kind] || { id: doc?.kind, title: 'Documento', oid: null };
  const d = doc?.doctor_snapshot || {};
  const p = doc?.patient_snapshot || {};
  const pay = doc?.payload || null;
  const S = (v) => pdfSafe(v ?? '');
  const name = S(p.name);
  // CPF ou a declaração "não possui CPF" que o médico registrou (o banco exige um dos dois para emitir).
  const cpf = p.cpf ? fmtCpf(p.cpf) : p.sem_cpf ? 'não possui CPF' : 'não informado';
  const who = p.cpf ? `${name}, CPF ${fmtCpf(p.cpf)},` : p.sem_cpf ? `${name} (não possui CPF)` : name;
  // Início do atendimento: o que o banco copiou na emissão; na pré-visualização, o da consulta aberta.
  const start = p.inicio_atendimento || consultStart(consult);
  const cDay = start ? T.fmtDate(daySP(start)) : '';
  const cTime = start ? T.fmtTime(start) : '';
  const doctorLine = `${S(d.full_name)} — CRM ${S(d.crm)}/${S(d.crm_uf)}${d.rqe ? ` — RQE ${S(d.rqe)}${d.specialty ? ` (${S(d.specialty)})` : ''}` : ''}`;
  const doctor = [['Médico(a)', doctorLine], ['Endereço profissional', S(d.prof_address)], ['Contato profissional', S(fmtContact(d.prof_contact))]];
  const patient = [['Paciente', name], ['CPF', cpf]];
  if (p.birthdate) patient.push(['Nascimento', `${T.fmtDate(p.birthdate)}${p.age != null ? ` (${T.ageLabel(Number(p.age))})` : ''}`]);
  patient.push([k.id === 'receita' ? 'Endereço residencial' : 'Endereço ou local informado', S(p.address)]);
  if (p.for_other && p.requester_name) {
    const minor = p.age != null && Number(p.age) < 18;
    patient.push([minor ? 'Responsável legal presente' : 'Consulta pedida por', `${S(p.requester_name)}${p.relationship ? ` (${S(p.relationship)})` : ''}`]);
  }
  const when = `${cDay ? `Teleconsulta de ${cDay}${cTime ? `, iniciada às ${cTime}` : ''}. ` : ''}Emitido em ${doc?.created_at ? T.fmtDateTime(doc.created_at) : '(data e hora da emissão)'} (horário de Brasília).`;
  const body = [];
  const P = (text, extra = {}) => body.push({ t: 'p', text: S(text), ...extra });
  const KV = (key, text) => body.push({ t: 'kv', k: key, lines: paras(text) });
  if (!pay) {
    body.push({ t: 'p', text: doc?.status === 'cancelado' ? 'Documento cancelado: o conteúdo não é mostrado.' : 'Sem conteúdo.' });
  } else if (k.id === 'exames') {
    P('Solicito os exames abaixo:');
    let n = 1;
    for (const g of T.groupExams(pay.itens)) {
      body.push({ t: 'h', text: S(g.label) });
      for (const e of g.items) body.push({ t: 'li', n: `${n++}.`, text: S(e.name) + (e.note ? ` — ${S(e.note)}` : ''), sub: [] });
    }
    if (pay.indicacao) KV('Indicação clínica', pay.indicacao);
  } else if (k.id === 'receita') {
    P('Receita simples (medicamentos vendidos sem retenção da receita).', { muted: true });
    (pay.itens || []).forEach((it, i) => {
      const use = `Modo de usar: ${paras(it.posologia).join(' ')}`;
      const sub = [`Quantidade: ${S(it.quantidade)}`, it.via ? `Via ${S(it.via)}. ${use}` : use, `Duração: ${S(it.duracao)}`];
      if (it.observacao) sub.push(`Observação: ${paras(it.observacao).join(' ')}`);
      body.push({ t: 'li', n: `${i + 1}.`, text: `${S(it.medicamento)} ${S(it.concentracao)}${it.forma ? `, ${S(it.forma)}` : ''}`, sub, bold: true });
    });
    if (pay.observacao) KV('Observações', pay.observacao);
  } else if (k.id === 'atestado') {
    // Na prévia (antes de emitir) pode faltar o número de dias: aparece "___".
    const n = Number(pay.dias);
    const ini = T.fmtDate(String(pay.inicio || '')) || '___';
    const fim = T.fmtDate(String(pay.fim || '')) || '___';
    const periodo = !(Number.isInteger(n) && n >= 1) ? `por ___ dia(s), a partir de ${ini}`
      : n === 1 ? `por 1 (um) dia, em ${ini}` : `por ${n} (${extenso(n)}) dias, de ${ini} a ${fim}, inclusive`;
    P(`Atesto, para os devidos fins, que ${who} foi atendido(a) por mim em teleconsulta${cDay ? ` em ${cDay}` : ''}${cTime ? `, às ${cTime}` : ''}, e necessita afastar-se de suas atividades ${periodo}.`);
    if (pay.cid) P(`CID: ${S(pay.cid)} — incluído por solicitação e autorização expressa do(a) paciente.`);
    if (pay.observacao) KV('Observações', pay.observacao);
  } else if (k.id === 'comparecimento') {
    // Dia e horários do registro da consulta; se passou da meia-noite, o dia do fim também.
    const d1 = T.fmtDate(String(pay.data || '')) || '___';
    const d2 = pay.data_fim && pay.data_fim !== pay.data ? T.fmtDate(String(pay.data_fim)) : '';
    const h1 = S(pay.hora_inicio) || '___';
    const h2 = S(pay.hora_fim) || '___';
    const quando = d2 ? `de ${d1}, às ${h1}, a ${d2}, às ${h2}` : `no dia ${d1}, das ${h1} às ${h2}`;
    P(`Declaro, para os devidos fins, que ${who} esteve em atendimento médico por teleconsulta ${quando} (horário de Brasília).`);
    if (p.for_other && p.requester_name) P(`Acompanhado(a) por ${S(p.requester_name)}${p.relationship ? ` (${S(p.relationship)})` : ''}.`);
    P('Esta declaração não recomenda afastamento do trabalho ou de outras atividades.');
    if (pay.observacao) KV('Observações', pay.observacao);
  } else if (k.id === 'encaminhamento') {
    P(`Encaminho ${name} para avaliação em ${S(pay.especialidade) || '___'}.`);
    body.push({ t: 'kv', k: 'Prioridade', lines: [PRIO[pay.prioridade] || S(pay.prioridade)] });
    KV('Motivo', pay.motivo);
    if (pay.observacao) KV('Observações', pay.observacao);
    P('Paciente avaliado(a) por teleconsulta, sem exame físico presencial.');
    if (pay.prioridade === 'urgente') P('Em caso de piora, procure o pronto-socorro mais próximo ou ligue 192 (SAMU).', { bold: true });
    P('Agradeço a atenção.');
  } else if (k.id === 'relatorio') {
    if (cDay) P(`Relatório referente à teleconsulta de ${cDay}.`);
    for (const line of paras(pay.texto)) body.push({ t: 'p', text: line, tight: true });
    if (pay.cid) P(`CID: ${S(pay.cid)} — incluído por solicitação e autorização expressa do(a) paciente.`);
  } else if (k.id === 'orientacoes') {
    for (const line of paras(pay.texto)) body.push({ t: 'p', text: line, tight: true });
    P('Se piorar ou aparecer sinal de alerta: ligue 192 (SAMU) ou procure o pronto-socorro mais próximo.', { bold: true });
    P('Estas orientações não substituem receita, atestado ou pedido de exames.');
  }
  const code = normCode(doc?.code);
  const base = siteBase(site);
  return {
    kind: k.id, title: k.title, oid: k.oid || null, brand: 'IMED · Teleconsulta', mode: TELEMED,
    doctor, patient, when, body,
    code, codeText: code ? fmtCode(code) : '', url: code ? verifyUrl(site, code) : '',
    verifyAt: `${base}documento.html`,
    validity: 'Este documento só vale com a assinatura digital ICP-Brasil do(a) médico(a) no arquivo PDF. Confira a assinatura enviando o arquivo em validar.iti.gov.br.',
    sign: 'Assinatura digital do(a) médico(a) (ICP-Brasil)',
    status: doc?.status || 'emitido', signed: !!doc?.signed, cancelledAt: doc?.cancelled_at || null,
    crm: S(d.crm), uf: S(d.crm_uf), specialty: d.rqe && d.specialty ? S(d.specialty) : '', doctorName: S(d.full_name),
  };
}

// Metadados do PDF: título, assunto e os códigos (OIDs) que o validador do ITI usa para reconhecer documento de saúde:
// tipo do documento (valor vazio) e CRM, UF e especialidade do médico (Guia do Desenvolvedor do Validar).
export function pdfInfo(m) {
  const oids = [];
  if (m.oid) oids.push([m.oid, '']);
  if (m.crm) oids.push([ITI_OID.crm, m.crm]);
  if (m.uf) oids.push([ITI_OID.uf, m.uf]);
  if (m.specialty) oids.push([ITI_OID.especialidade, m.specialty]);
  return {
    title: `${m.title}${m.codeText ? ` ${m.codeText}` : ''}`,
    subject: `Documento "${m.title}" emitido em teleconsulta (telemedicina) pelo IMED${m.codeText ? `. Código de conferência ${m.codeText}` : ''}.`,
    author: m.doctorName,
    keywords: `IMED; teleconsulta; ${m.code || ''}`.trim(),
    creator: 'IMED · Teleconsulta', producer: 'IMED (pdf-lib 1.17.1)',
    code: m.code || '', oids,
  };
}
export const pdfFileName = (m, signed = false) => `IMED-${m.kind}-${m.codeText || 'rascunho'}${signed ? '-assinado' : ''}.pdf`;

/* ======================= QR Code ======================= */
export const loadQrLib = () => import('../vendor/qrcode-generator/qrcode.js').then((mod) => mod.default || mod.qrcode);
export const loadPdfLib = () => import('../vendor/pdf-lib/pdf-lib.esm.min.js');
export function qrMatrix(text, qrcode) {
  const q = qrcode(0, 'M');
  q.addData(String(text));
  q.make();
  const n = q.getModuleCount();
  const rows = [];
  for (let r = 0; r < n; r += 1) { const row = []; for (let c = 0; c < n; c += 1) row.push(q.isDark(r, c)); rows.push(row); }
  return { n, rows };
}
// Um caminho SVG só, com os módulos escuros de cada linha juntos (menor e mais nítido).
export function qrPath(m) {
  let d = '';
  m.rows.forEach((row, r) => {
    for (let c = 0; c < m.n;) {
      if (!row[c]) { c += 1; continue; }
      let e = c;
      while (e < m.n && row[e]) e += 1;
      d += `M${c} ${r}h${e - c}v1h-${e - c}z`;
      c = e;
    }
  });
  return d;
}
export function qrSvg(m, label = 'QR Code para conferir este documento') {
  const s = m.n + 8;
  return `<svg class="td-qr" viewBox="-4 -4 ${s} ${s}" width="${s * 3}" height="${s * 3}" role="img" aria-label="${esc(label)}" shape-rendering="crispEdges"><rect x="-4" y="-4" width="${s}" height="${s}" fill="#fff"/><path d="${qrPath(m)}" fill="#000"/></svg>`;
}

/* ======================= pré-visualização (HTML escapado) ======================= */
// mark: 'draft' (paciente, antes do PDF assinado), 'view' (paciente, depois do PDF assinado: só visualização, o que vale
// é o arquivo), 'cancel' (cancelado) ou null (versão para assinar, do médico).
export const MARK_TEXT = {
  draft: 'RASCUNHO SEM ASSINATURA — NÃO VALE COMO DOCUMENTO OFICIAL',
  view: 'VISUALIZAÇÃO — O DOCUMENTO QUE VALE É O PDF ASSINADO',
};
export function docHtml(m, { mark = null, qr = '' } = {}) {
  const dl = (rows) => `<dl class="td-dl">${rows.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>`;
  const block = (b) => {
    if (b.t === 'h') return `<p class="td-h3">${esc(b.text)}</p>`;
    if (b.t === 'kv') return `<p class="td-kv"><b>${esc(b.k)}:</b> ${b.lines.map(esc).join('<br>')}</p>`;
    if (b.t === 'li') return `<div class="td-li"><span class="td-n">${esc(b.n)}</span><div>${b.bold ? `<b>${esc(b.text)}</b>` : esc(b.text)}${b.sub.map((s) => `<br><span class="td-sub">${esc(s)}</span>`).join('')}</div></div>`;
    const cls = [b.muted ? 'td-muted' : '', b.tight ? 'td-tight' : ''].filter(Boolean).join(' ');
    return `<p${cls ? ` class="${cls}"` : ''}>${b.bold ? `<b>${esc(b.text)}</b>` : esc(b.text)}</p>`;
  };
  const banner = mark === 'cancel'
    ? `<p class="td-banner td-banner-cancel">DOCUMENTO CANCELADO${m.cancelledAt ? ` EM ${esc(T.fmtDate(T.todaySP(new Date(m.cancelledAt))))}` : ''} — NÃO UTILIZAR</p>`
    : MARK_TEXT[mark] ? `<p class="td-banner${mark === 'view' ? ' td-banner-view' : ''}">${esc(MARK_TEXT[mark])}</p>` : '';
  return `<article class="td-sheet${mark ? ` td-mark-${mark}` : ''}" aria-label="${esc(`Documento: ${m.title}`)}">
  ${banner}
  <header class="td-head"><p class="td-brand">${esc(m.brand)}</p><p class="td-title">${esc(m.title)}</p><p class="td-mode">${esc(m.mode)}</p></header>
  ${dl(m.doctor)}${dl(m.patient)}
  <p class="td-when">${esc(m.when)}</p>
  <div class="td-body">${m.body.map(block).join('')}</div>
  <div class="td-sign">${esc(m.sign)}</div>
  <footer class="td-foot">${qr || '<span class="td-qr td-qr-none" aria-hidden="true"></span>'}<div>
    <p class="td-code">${m.codeText ? `Código do documento: <b>${esc(m.codeText)}</b>` : 'O código de conferência aparece ao emitir.'}</p>
    <p>Confira a situação deste documento em ${esc(m.verifyAt)}, com o código acima ou pelo QR Code.</p>
    <p>${esc(m.validity)}</p></div></footer>
</article>`;
}

/* ======================= PDF (pdf-lib) ======================= */
// Quebra o texto em linhas que cabem na largura (measure = largura do texto). Palavra maior que a linha é cortada.
export function wrapText(text, width, measure) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    const words = para.split(' ').filter((w) => w !== '');
    let line = '';
    for (let w of words) {
      while (measure(w) > width && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && measure(w.slice(0, cut)) > width) cut -= 1;
        if (line) { out.push(line); line = ''; }
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const cand = line ? `${line} ${w}` : w;
      if (!line || measure(cand) <= width) line = cand;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

const A4 = [595.28, 841.89];
const MX = 50;          // margem lateral
const TOP = 52;         // margem de cima
const BOTTOM = 40;      // margem de baixo (abaixo fica o rodapé da página)
// Monta o PDF A4 (versão para assinar, sem marca d'água). lib = módulo pdf-lib; qrcode = fábrica do qrcode-generator.
export async function buildPdf(m, { lib, qrcode, now = new Date() } = {}) {
  const { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFHexString } = lib;
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0, 0, 0);
  const grey = rgb(0.33, 0.36, 0.4);
  const rule = rgb(0.72, 0.75, 0.78);
  const W = A4[0] - 2 * MX;
  const pages = [];
  let page = null;
  let y = 0;
  const txt = (s, x, yy, { font = reg, size = 10, color = ink } = {}) => page.drawText(String(s), { x, y: yy, size, font, color });
  const lines = (s, width, font, size) => wrapText(s, width, (v) => font.widthOfTextAtSize(v, size));
  const footerH = 22;
  const limit = () => BOTTOM + footerH;
  function newPage() {
    page = pdf.addPage(A4);
    pages.push(page);
    y = A4[1] - TOP;
    if (pages.length > 1) {
      txt(`${m.title} (continuação)`, MX, y, { font: bold, size: 10.5 });
      y -= 8;
      page.drawLine({ start: { x: MX, y }, end: { x: MX + W, y }, thickness: 0.6, color: rule });
      y -= 16;
    }
  }
  function ensure(h) { if (y - h < limit()) newPage(); }
  // Cabeçalho (primeira página)
  newPage();
  txt(m.brand.toUpperCase(), MX, y, { font: bold, size: 8.5, color: grey });
  y -= 24;
  txt(m.title, MX, y, { font: bold, size: 19 });
  y -= 17;
  txt(m.mode, MX, y, { font: bold, size: 10.5 });
  y -= 10;
  page.drawLine({ start: { x: MX, y }, end: { x: MX + W, y }, thickness: 1.2, color: ink });
  y -= 16;
  const LW = 132;
  function rows(list) {
    for (const [label, value] of list) {
      const ls = lines(value || '—', W - LW, reg, 10);
      ensure(ls.length * 13);
      txt(label, MX, y, { font: bold, size: 8.5, color: grey });
      ls.forEach((l, i) => txt(l, MX + LW, y - i * 13, { size: 10 }));
      y -= ls.length * 13 + 3;
    }
  }
  rows(m.doctor);
  y -= 5;
  rows(m.patient);
  y -= 3;
  for (const l of lines(m.when, W, reg, 9)) { ensure(12); txt(l, MX, y, { size: 9, color: grey }); y -= 12; }
  y -= 4;
  page.drawLine({ start: { x: MX, y }, end: { x: MX + W, y }, thickness: 0.6, color: rule });
  y -= 22;
  // Corpo
  const LH = 15;
  for (const b of m.body) {
    if (b.t === 'h') { ensure(LH + 6); y -= 2; txt(b.text.toUpperCase(), MX, y, { font: bold, size: 9, color: grey }); y -= LH; continue; }
    if (b.t === 'kv') {
      const head = `${b.k}:`;
      const ls = b.lines.flatMap((l) => lines(l, W, reg, 11));
      ensure(LH * 2);
      txt(head, MX, y, { font: bold, size: 11 });
      y -= LH;
      for (const l of ls) { ensure(LH); txt(l, MX, y, { size: 11 }); y -= LH; }
      y -= 6;
      continue;
    }
    if (b.t === 'li') {
      const f1 = b.bold ? bold : reg;
      const l1 = lines(b.text, W - 20, f1, 11);
      const subs = b.sub.flatMap((s) => lines(s, W - 20, reg, 10.5));
      ensure(LH * Math.min(l1.length + subs.length, 4));
      txt(b.n, MX, y, { font: bold, size: 11 });
      for (const l of l1) { ensure(LH); txt(l, MX + 20, y, { font: f1, size: 11 }); y -= LH; }
      for (const l of subs) { ensure(14); txt(l, MX + 20, y, { size: 10.5, color: rgb(0.12, 0.14, 0.16) }); y -= 14; }
      y -= 6;
      continue;
    }
    const f1 = b.bold ? bold : reg;
    const ls = lines(b.text, W, f1, 11);
    for (const l of ls) { ensure(LH); txt(l, MX, y, { font: f1, size: 11, color: b.muted ? grey : ink }); y -= LH; }
    y -= b.tight ? 2 : 8;
  }
  // Assinatura e conferência (sempre juntas, no fim)
  const qrSize = 86;
  const info = [m.codeText ? `Código do documento: ${m.codeText}` : 'Código: aparece ao emitir',
    `Confira a situação deste documento em ${m.verifyAt}, com o código acima ou pelo QR Code.`, m.validity];
  const infoLines = [lines(info[0], W - qrSize - 14, bold, 11), lines(info[1], W - qrSize - 14, reg, 8.5), lines(info[2], W - qrSize - 14, reg, 8.5)];
  const endH = 64 + 16 + Math.max(qrSize, 16 + (infoLines[1].length + infoLines[2].length) * 11 + 8);
  ensure(endH);
  y -= 4;
  page.drawRectangle({ x: MX, y: y - 52, width: 270, height: 52, borderColor: rule, borderWidth: 0.8 });
  txt(m.sign, MX + 8, y - 13, { size: 8, color: grey });
  y -= 52 + 18;
  page.drawLine({ start: { x: MX, y }, end: { x: MX + W, y }, thickness: 0.6, color: rule });
  y -= 10;
  if (m.url && qrcode) {
    const mtx = qrMatrix(m.url, qrcode);
    const cell = qrSize / mtx.n;
    page.drawSvgPath(qrPath(mtx), { x: MX, y, scale: cell, color: ink });
  }
  let ty = y - 12;
  const tx = MX + qrSize + 14;
  infoLines[0].forEach((l) => { txt(l, tx, ty, { font: bold, size: 11 }); ty -= 14; });
  ty -= 2;
  for (const l of [...infoLines[1], ...infoLines[2]]) { txt(l, tx, ty, { size: 8.5, color: grey }); ty -= 11; }
  // Rodapé de cada página: código e número da página
  pages.forEach((pg, i) => {
    const fy = BOTTOM;
    pg.drawLine({ start: { x: MX, y: fy + 12 }, end: { x: MX + W, y: fy + 12 }, thickness: 0.4, color: rule });
    const left = `IMED · Teleconsulta · ${m.title}${m.codeText ? ` · Código ${m.codeText}` : ''}`;
    pg.drawText(left, { x: MX, y: fy, size: 7.5, font: reg, color: grey });
    const right = `Página ${i + 1} de ${pages.length}`;
    pg.drawText(right, { x: MX + W - reg.widthOfTextAtSize(right, 7.5), y: fy, size: 7.5, font: reg, color: grey });
  });
  // Metadados (dicionário Info): textos e os OIDs de documento de saúde do ITI. A pdf-lib não escapa "(", ")" e "\" em
  // PDFString.of: sem o escape, uma especialidade como "Pediatria)" quebraria o dicionário (e os OIDs do ITI).
  const meta = pdfInfo(m);
  const lit = (s) => PDFString.of(String(s).replace(/[\\()]/g, (ch) => `\\${ch}`));
  const str = (s) => (/^[\x20-\x7e]*$/.test(s) ? lit(s) : PDFHexString.fromText(s));
  pdf.setTitle(meta.title);
  pdf.setSubject(meta.subject);
  pdf.setAuthor(meta.author || 'IMED');
  pdf.setKeywords([meta.keywords]);
  pdf.setCreator(meta.creator);
  pdf.setProducer(meta.producer);
  pdf.setLanguage('pt-BR');
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  const infoDict = pdf.getInfoDict();
  for (const [oid, value] of meta.oids) infoDict.set(PDFName.of(oid), str(value));
  // Código em texto simples (sem compressão): o banco só aceita o PDF assinado que traz o código DESTE documento.
  if (meta.code) infoDict.set(PDFName.of('IMEDCodigo'), lit(meta.code));
  return pdf.save({ useObjectStreams: false });
}

/* ======================= PDF enviado pelo médico ======================= */
// Conferência simples antes de enviar (o banco confere de novo). Não prova que a assinatura vale: isso é no ITI.
const ascii = (bytes, from, to) => { let s = ''; for (let i = Math.max(0, from); i < Math.min(bytes.length, to); i += 1) s += String.fromCharCode(bytes[i]); return s; };
const hasBytes = (bytes, needle) => {
  const n = [...needle].map((ch) => ch.charCodeAt(0));
  outer: for (let i = 0; i + n.length <= bytes.length; i += 1) {
    for (let j = 0; j < n.length; j += 1) if (bytes[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
};
// Formatos de assinatura em PDF (PAdES) que o banco aceita (/SubFilter).
export const SUBFILTERS = ['/ETSI.CAdES.detached', '/adbe.pkcs7.detached', '/adbe.pkcs7.sha1'];
// "ICP-Brasil" aparece nos certificados da cadeia ICP-Brasil, que vão dentro da assinatura (/Contents, em hexadecimal).
// Sem ele, provavelmente é assinatura do gov.br (avançada): só um aviso, não bloqueia.
const ICP_HEX = ['4943502d42726173696c', '4943502D42726173696C', 'ICP-Brasil'];
export function checkSignedPdf(bytes, code = '') {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!b.length) return { ok: false, error: 'vazio' };
  if (b.length > MAX_PDF_BYTES) return { ok: false, error: 'grande' };
  if (ascii(b, 0, 5) !== '%PDF-' || !ascii(b, b.length - 1024, b.length).includes('%%EOF')) return { ok: false, error: 'nao_pdf' };
  if (!hasBytes(b, '/ByteRange')) return { ok: false, error: 'sem_assinatura' };
  if (!SUBFILTERS.some((s) => hasBytes(b, s))) return { ok: false, error: 'assinatura_desconhecida' };
  // O PDF tem de ser DESTE documento (o PDF gerado pelo IMED traz o código em texto simples).
  const c = normCode(code);
  if (c && !hasBytes(b, c)) return { ok: false, error: 'outro_documento' };
  return { ok: true, error: null, icp: ICP_HEX.some((s) => hasBytes(b, s)) };
}
export const UPLOAD_TEXT = {
  vazio: 'O arquivo está vazio.',
  grande: 'O PDF pode ter até 3 MB. Gere de novo o PDF no IMED e assine sem acrescentar imagens.',
  nao_pdf: 'Este arquivo não é um PDF. Envie o PDF assinado (não uma foto nem um print).',
  sem_assinatura: 'Este PDF ainda não tem assinatura digital. Assine com o seu certificado ICP-Brasil (opção “Assinar PDF”) e envie de novo.',
  assinatura_desconhecida: 'Este PDF não tem uma assinatura digital de PDF reconhecida (PAdES, o formato do ICP-Brasil). Assine com o seu certificado ICP-Brasil usando a opção “Assinar PDF” e envie de novo.',
  outro_documento: 'Este PDF não é deste documento: o código dele não está no arquivo. Gere o PDF deste documento no IMED (“Gerar PDF para assinar”), assine esse arquivo sem salvar em outro formato e envie de novo.',
};
// Aviso (não bloqueia) quando a assinatura não parece ICP-Brasil.
export const ICP_WARN = 'Não encontramos “ICP-Brasil” na assinatura deste PDF. Pode ser uma assinatura do gov.br, que é “avançada”: não serve para atestado, e o CFM pede a qualificada (ICP-Brasil) nos documentos médicos. Confira o arquivo em validar.iti.gov.br antes de enviar. Depois de enviado, o PDF não pode ser trocado (só cancelando e emitindo outro documento).';
export function toBase64(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64) {
  const s = atob(String(b64 || '').replace(/\s+/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

/* ======================= erros do banco ======================= */
// Código, campo ("details") e item ("hint", ex.: "item 2"). Use com T.errorInfo para rede e permissão.
export function docError(err) {
  const { code, details } = T.errorInfo(err);
  return { code, details, hint: err?.data?.hint ?? null };
}
const FIELD = {
  cpf: 'CPF inválido: confira os 11 números.', contato: 'Telefone com DDD ou e-mail profissional inválido.', documento: 'Tipo de documento inválido.',
  payload: 'Os dados do documento estão num formato inválido.', itens: 'Confira a lista de itens.', tipo: 'Escolha o tipo de receita.',
  medicamento: 'o nome do medicamento pode ter de 2 a 200 caracteres.', concentracao: 'informe a concentração (até 60 caracteres).',
  forma: 'a forma pode ter até 60 caracteres.', via: 'informe a via (até 40 caracteres).', posologia: 'o modo de usar pode ter de 3 a 500 caracteres.',
  quantidade: 'informe a quantidade (até 100 caracteres).', duracao: 'informe a duração (até 60 caracteres).', observacao: 'a observação está longa demais.',
  dias: 'Os dias de afastamento vão de 1 a 90.', inicio: 'O afastamento começa no dia da consulta ou até 7 dias depois (nunca antes da consulta).', cid: 'CID-10 inválido (ex.: J11 ou J11.1).',
  data: 'A data e os horários da declaração vêm do registro da consulta e não podem ser digitados.', hora_inicio: 'A data e os horários da declaração vêm do registro da consulta e não podem ser digitados.',
  hora_fim: 'A data e os horários da declaração vêm do registro da consulta e não podem ser digitados.', data_fim: 'A data e os horários da declaração vêm do registro da consulta e não podem ser digitados.',
  especialidade: 'A especialidade pode ter de 2 a 80 caracteres.', prioridade: 'Escolha a prioridade.', texto: 'O texto pode ter de 3 a 4.000 caracteres.',
  indicacao: 'A indicação clínica pode ter até 1.000 caracteres.', pdf: 'O arquivo não é um PDF válido (precisa começar com %PDF- e terminar com %%EOF).',
  pdf_tamanho: 'O PDF pode ter até 3 MB.', codigo: 'O código tem 10 letras e números (sem 0, 1, I e O), como ABCDE-FGHJK.',
  endereco_residencial: 'Confirme que o endereço do paciente é o residencial completo (a lei exige na receita).',
  conferencia: 'A página está desatualizada. Atualize a página e tente de novo.',
};
// where: 'emitir' | 'perfil' | 'paciente' | 'cancelar' | 'enviar' | 'baixar'
export function docErrorText({ code, details = null, hint = null } = {}, where = 'emitir') {
  switch (code) {
    case 'perfil_incompleto': return details === 'contato' ? 'Falta o seu telefone ou e-mail profissional (vai impresso no documento).' : 'Falta o seu endereço profissional (vai impresso no documento).';
    case 'paciente_incompleto': return details === 'nome' ? 'Falta o nome do paciente.' : details === 'cpf' ? 'Falta o CPF do paciente (ou marcar que ele não possui CPF).' : 'Falta o endereço ou a cidade/UF do paciente.';
    case 'atendimento_nao_iniciado': return 'O atendimento ainda não começou: os documentos ficam disponíveis depois que o vídeo conectar, você ligar para o paciente ou mandar mensagem. Sem atendimento, não há documento.';
    case 'consulta_nao_encerrada': return 'A declaração de comparecimento sai depois de encerrar a consulta: o dia e os horários vêm do registro.';
    case 'sem_conferencia_identidade': return 'Marque que conferiu o documento com foto e o CPF do paciente. Se o CPF mudou, confira de novo.';
    case 'dados_paciente_mudaram': return 'O paciente atualizou o CPF ou o endereço na página dele. Confira os dados e a pré-visualização e emita de novo.';
    case 'receita_bloqueada': return BLOCK_TEXT[details === 'notificacao' ? 'notificacao' : 'sncr'];
    case 'cid_sem_autorizacao': return 'O CID só entra com a autorização expressa do paciente: marque a autorização ou apague o CID.';
    case 'limite_documentos': return `Esta consulta chegou ao limite de ${MAX_DOCS} documentos.`;
    case 'documento_cancelado': return 'Este documento foi cancelado. Emita um novo, se precisar.';
    case 'pdf_sem_assinatura': return details === 'subfilter' ? UPLOAD_TEXT.assinatura_desconhecida : UPLOAD_TEXT.sem_assinatura;
    case 'pdf_outro_documento': return UPLOAD_TEXT.outro_documento;
    case 'ja_assinado': return 'Este documento já tem o PDF assinado, e ele não pode ser trocado. Para corrigir, cancele o documento (com o motivo) e emita outro.';
    case 'prazo_encerrado': return where === 'enviar' ? `O prazo para enviar o PDF assinado (${UPLOAD_DAYS} dias depois de emitir) terminou. Cancele este rascunho (o paciente vê o motivo). Se o paciente ainda precisar do documento, será preciso uma nova consulta.`
      : where === 'paciente' ? 'O prazo para completar os dados (24 horas depois de encerrar) terminou.'
        : 'O prazo para emitir documentos (24 horas depois de encerrar a consulta) terminou.';
    case 'estado_invalido': return where === 'paciente' ? 'A consulta não está aberta para completar os dados agora.' : 'A consulta precisa estar em andamento ou encerrada há até 24 horas para emitir documentos.';
    case 'nao_encontrado': return where === 'paciente' ? 'Não encontramos esta teleconsulta neste aparelho.' : 'Não encontramos este documento ou esta consulta.';
    case 'nao_leitor': return 'Só a equipe médica do IMED autorizada a ler prontuários vê os documentos.';
    case 'dados_invalidos': {
      if (where === 'perfil' && details === 'endereco') return 'O endereço profissional pode ter de 5 a 200 caracteres.';
      if (details === 'endereco') return 'O endereço ou local do paciente pode ter de 3 a 200 caracteres.';
      if (where === 'cancelar' && details === 'motivo') return 'Escreva o motivo do cancelamento (de 3 a 300 caracteres).';
      if (details === 'motivo') return 'O motivo pode ter de 3 a 2.000 caracteres.';
      const t = FIELD[details];
      if (!t) return 'Algum dado não está no formato aceito. Confira e tente de novo.';
      const item = /^item\s+(\d+)$/.exec(String(hint || ''));
      return item ? `Item ${item[1]}: ${t}` : t.charAt(0).toUpperCase() + t.slice(1);
    }
    default: return T.errorText(code, details);
  }
}
