// Regras dos recursos de confiança do IMED, sem mexer na página (também rodam no Node: tests/confianca.test.mjs):
// cancelar pedido, Fale com o IMED (protocolo), "Algo errado aqui?", Meus dados (LGPD), pedido para outra
// pessoa e a conferência da equipe antes de aprovar uma clínica. Funções do banco: migração 20261030072000_confianca.sql.

/* ======================= cancelar pedido ======================= */
// Situações do banco em que o paciente ainda pode cancelar pelo site (o banco confere de novo).
export const CANCELLABLE = ['pending', 'contacted', 'confirmed'];

// Pode mostrar "Cancelar pedido"? status: situação que veio do banco (sem ela, não oferece: o banco é quem sabe).
// slot: horário marcado (ISO); se já passou, não dá mais para cancelar pelo site.
export function canCancel(status, slot = null, now = Date.now()) {
  if (!CANCELLABLE.includes(status)) return false;
  if (slot) {
    const t = Date.parse(slot);
    if (!Number.isFinite(t) || t <= now) return false;
  }
  return true;
}

// Respostas de cancel_request em linguagem simples.
export const CANCEL_MSG = {
  already_cancelled: 'Este pedido já estava cancelado.',
  not_cancellable: 'Este pedido já foi concluído e não pode mais ser cancelado pelo site.',
  past: 'O horário deste pedido já passou. Se precisar, fale com o local.',
  forbidden: 'Não conseguimos confirmar que este pedido é seu. Use o aparelho em que fez o pedido ou entre na conta usada nele.',
  not_found: 'Não encontramos este pedido. Ele pode ter sido apagado.',
  error: 'Não foi possível cancelar agora. Confira a internet e tente de novo.',
};
export const cancelDoneText = (slot) => `Pedido cancelado.${slot ? ' O horário voltou a ficar livre.' : ''} Quem ia atender vê o cancelamento no painel do IMED.`;
export const CANCEL_CONFIRM = 'Cancelar este pedido? Cancelar pelo IMED é grátis. Se tiver horário marcado, ele volta a ficar livre para outra pessoa.';

/* ======================= Fale com o IMED ======================= */
// [valor, rótulo, grupo]. Os três de "Meus dados" são os direitos da LGPD (art. 18): acesso, correção e exclusão.
export const CONTACT_SUBJECTS = [
  ['duvida', 'Dúvida sobre o IMED', ''],
  ['cancelamento', 'Cancelar um pedido', ''],
  ['dados_acesso', 'Quero uma cópia dos meus dados', 'Meus dados (LGPD)'],
  ['dados_correcao', 'Quero corrigir meus dados', 'Meus dados (LGPD)'],
  ['dados_exclusao', 'Quero apagar meus dados', 'Meus dados (LGPD)'],
  ['clinica', 'Sou de uma clínica, laboratório ou hospital', ''],
  ['outro', 'Outro assunto', ''],
];
const SUBJECT_ALIAS = { acesso: 'dados_acesso', copia: 'dados_acesso', correcao: 'dados_correcao', corrigir: 'dados_correcao', exclusao: 'dados_exclusao', excluir: 'dados_exclusao', apagar: 'dados_exclusao', cancelar: 'cancelamento' };
export const isSubject = (v) => CONTACT_SUBJECTS.some(([k]) => k === v);
// Assunto vindo do endereço (contato.html?assunto=correcao). Desconhecido: vazio.
export function subjectFromParam(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (isSubject(s)) return s;
  return SUBJECT_ALIAS[s] ?? '';
}
export const isLgpdSubject = (s) => /^dados_/.test(String(s ?? ''));
export const CONTACT_MAX = 2000;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^[1-9]{2}(9\d{8}|[2-8]\d{7})$/;
// "E-mail ou celular" num campo só: com @ é e-mail; sem, celular com DDD (com ou sem +55). Inválido: null.
export function parseReplyContact(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.includes('@')) {
    const email = s.toLowerCase();
    return email.length <= 254 && EMAIL_RE.test(email) ? { email } : null;
  }
  let d = s.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return PHONE_RE.test(d) ? { phone: d } : null;
}

// Erros por campo: subject, name, contact, message, code.
export function validateContact(v) {
  const err = {};
  if (!isSubject(v.subject)) err.subject = 'Escolha o assunto.';
  const name = String(v.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) err.name = 'Digite seu nome.';
  else if (name.length > 120) err.name = 'Use até 120 caracteres.';
  if (!parseReplyContact(v.contact)) err.contact = 'Digite um e-mail (como voce@exemplo.com) ou um celular com DDD (como (11) 98765-4321).';
  const msg = String(v.message ?? '').trim();
  if (msg.length < 5) err.message = 'Escreva a sua mensagem.';
  else if (msg.length > CONTACT_MAX) err.message = `Use até ${CONTACT_MAX} caracteres.`;
  if (String(v.code ?? '').trim().length > 40) err.code = 'Confira o protocolo (até 40 caracteres).';
  return err;
}

// Argumentos de send_contact.
export function contactArgs(v) {
  const c = parseReplyContact(v.contact);
  return {
    p_subject: v.subject,
    p_name: String(v.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
    p_contact: c?.email ?? c?.phone ?? '',
    p_message: String(v.message ?? '').trim().slice(0, CONTACT_MAX),
    p_request_code: String(v.code ?? '').trim().slice(0, 40) || null,
  };
}

// Erro de send_contact (exceção P0001: 'limite' ou 'dados_invalidos' com o campo em "details").
const CONTACT_FIELD = { assunto: 'subject', nome: 'name', contato: 'contact', mensagem: 'message', protocolo: 'code' };
export function contactError(err) {
  const code = err?.data?.message ?? err?.message ?? '';
  if (code === 'limite') return { text: 'Você mandou várias mensagens em pouco tempo. Espere um pouco e tente de novo. Se for urgente sobre um pedido, ligue para o local.' };
  if (code === 'dados_invalidos') {
    const field = CONTACT_FIELD[err?.data?.details] ?? null;
    return { field, text: 'Confira os campos marcados e tente de novo.' };
  }
  return { text: 'Não foi possível enviar agora. Confira a internet e tente de novo.' };
}
export const isProtocol = (v) => /^IMED-\d{8}-[A-Z0-9]{4}$/.test(String(v ?? ''));

/* ======================= "Algo errado aqui? Avise o IMED" ======================= */
export const REPORT_KINDS = [
  ['telefone', 'O telefone está errado ou não atende'],
  ['fechado', 'O local fechou'],
  ['endereco', 'O endereço mudou'],
  ['exame', 'Não faz o exame indicado'],
  ['outro', 'Outro problema'],
];
export const REPORT_NOTE_MAX = 300;
export const reportKindLabel = (k) => REPORT_KINDS.find(([v]) => v === k)?.[1] ?? 'Outro problema';
export function validateReport(v) {
  const err = {};
  if (!REPORT_KINDS.some(([k]) => k === v.kind)) err.kind = 'Escolha o que está errado.';
  if (String(v.note ?? '').trim().length > REPORT_NOTE_MAX) err.note = `Use até ${REPORT_NOTE_MAX} caracteres.`;
  return err;
}
// Argumentos de report_place_issue para um local da página (cadastro oficial: código CNES; parceiro: id).
export function reportArgs(place, v) {
  const cnes = place?.source === 'cnes' ? String(place.id ?? '').replace(/^cnes:/, '') : null;
  const note = String(v.note ?? '').trim().replace(/\s+/g, ' ').slice(0, REPORT_NOTE_MAX);
  return {
    p_cnes: cnes && /^\d{7}$/.test(cnes) ? cnes : null,
    p_clinic: place?.source === 'imed' ? place.clinic_id ?? null : null,
    p_kind: v.kind,
    p_note: note || null,
  };
}
export const REPORT_MSG = {
  ok: 'Obrigado! A equipe do IMED vai conferir.',
  limite: 'Já recebemos muitos avisos sobre este local hoje. Obrigado, a equipe do IMED vai conferir.',
  nao_encontrado: 'Este local não está mais no IMED.',
  dados_invalidos: 'Confira o que está errado e tente de novo.',
  error: 'Não foi possível enviar agora. Confira a internet e tente de novo.',
};

/* ======================= Meus dados (LGPD) ======================= */
// Cópia dos dados que a pessoa já vê no IMED, para baixar em JSON. O código secreto dos pedidos (token) fica
// de fora: ele só serve para este aparelho e, solto num arquivo, deixaria outra pessoa cancelar o pedido.
export function dataExport({ email = null, userId = null, requests = [], claims = [], device = [], now = Date.now() } = {}) {
  return {
    servico: 'IMED',
    gerado_em: new Date(now).toISOString(),
    sobre_este_arquivo: 'Cópia dos seus dados no IMED: os pedidos da sua conta (se você entrou), os pedidos de cadastro de clínica feitos por ela e os pedidos guardados neste aparelho. O código secreto de cada pedido não vem no arquivo. Para corrigir ou apagar dados, use o Fale com o IMED.',
    conta: email || userId ? { email, id: userId } : null,
    pedidos_da_conta: Array.isArray(requests) ? requests : [],
    pedidos_de_cadastro_de_clinica: Array.isArray(claims) ? claims : [],
    pedidos_deste_aparelho: (Array.isArray(device) ? device : []).filter((a) => a && typeof a === 'object').map(({ token, ...rest }) => rest),
  };
}
export const dataExportName = (now = Date.now()) => `imed-meus-dados-${new Date(now).toISOString().slice(0, 10)}.json`;

/* ======================= conferência antes de aprovar uma clínica ======================= */
// [campo de claim_checks, título, o que a equipe confere]
export const CLAIM_CHECKS = [
  ['cnes_active', 'CNES ativo', 'A ficha do estabelecimento está ativa no CNES (link "Ficha no CNES", acima).'],
  ['cnpj_active', 'CNPJ ativo', 'O CNPJ do estabelecimento está ativo na Receita Federal.'],
  ['phone_confirmed', 'Ligação para o telefone oficial do CNES', 'Liguei para o telefone que está no CNES e confirmei que quem pediu responde pelo local.'],
  ['crm_active', 'Médico responsável com CRM ativo', 'O médico responsável pelo local tem CRM ativo na busca do Conselho Federal de Medicina.'],
];
export const checksComplete = (c) => CLAIM_CHECKS.every(([k]) => c?.[k] === true);
export function checksPayload(get) {
  const out = Object.fromEntries(CLAIM_CHECKS.map(([k]) => [k, get(k) === true]));
  const note = String(get('note') ?? '').trim().slice(0, 300);
  if (note) out.note = note;
  return out;
}

/* ======================= datas ======================= */
const BR_DATE = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
const BR_LONG = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
// Instante (ISO) → "30/10/2026" no fuso de São Paulo. Inválido: ''.
export function dateBR(iso) {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? BR_DATE.format(new Date(t)) : '';
}
// Data do banco ("2026-10-30") → "30 de outubro de 2026". Inválida: ''.
export function dayLong(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day ?? ''))) return '';
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : BR_LONG.format(d);
}

/* ======================= ponto de partida da página inicial ======================= */
// Cidades que levam "do" (do Rio de Janeiro); as outras, "de" (de Belo Horizonte).
const DO_CIDADE = new Set(['Rio de Janeiro', 'Rio Grande', 'Recife', 'Crato', 'Guarujá']);
export const deCidade = (name) => `${DO_CIDADE.has(String(name)) ? 'do' : 'de'} ${name}`;
