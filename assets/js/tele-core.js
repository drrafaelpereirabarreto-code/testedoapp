// Teleconsulta do IMED: regras puras, sem página (usadas por teleconsulta.js e medico.js e testadas em
// tests/tele-core.test.mjs). Catálogo de exames, validações iguais às do banco, idade, datas no fuso de
// São Paulo, mensagens de erro, lista "Solicitação de exames" para imprimir, vídeo (WebRTC) e consulta periódica.
// Os documentos médicos (receita, atestado, PDF para assinar...) ficam em tele-docs.js.
// Contrato do banco: supabase/migrations/*_teleconsulta.sql e *_tele_documentos.sql.

export const TCLE_VERSION = '2026-10-30.2';    // vai em p_consent_version (máx. 40 caracteres); a parte de documentos entrou na .2
export const NOTICE_VERSION = '2026-10-30';    // aviso regulatório que o médico lê antes de atender
export const CFM_URL = 'https://portal.cfm.org.br/busca-medicos/';
export const STORE_KEY = 'imed_tele';          // {id, token, at} da consulta atual neste aparelho
export const HIST_KEY = 'imed_tele_hist';      // consultas encerradas neste aparelho (para rever exames)
export const PENDING_KEY = 'imed_tele_pending'; // {token, at}: código de um pedido ainda sem resposta do servidor
export const HIST_DAYS = 90;                   // consultas antigas somem sozinhas do aparelho depois disso
export const TZ = 'America/Sao_Paulo';

// Em vez de Object.hasOwn (só no Safari 15.4+: iPhones presos no iOS 15 ainda são comuns).
export const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, String(k ?? ''));

// Compatibilidade com navegadores antigos (iOS 15): AbortSignal.timeout é usado pelo auth.js em toda chamada ao
// banco e só existe no Safari 16+ e no Chrome 103+. Sem ele, todo pedido falhava como "sem internet".
export function ensureCompat(g = globalThis) {
  const AS = g.AbortSignal;
  if (AS && typeof AS.timeout !== 'function' && typeof g.AbortController === 'function') {
    AS.timeout = (ms) => {
      const c = new g.AbortController();
      g.setTimeout(() => { try { c.abort(new g.DOMException('Tempo esgotado', 'TimeoutError')); } catch { c.abort(); } }, ms);
      return c.signal;
    };
  }
}
// Envia o formulário como o botão faria (form.requestSubmit só existe no Safari 16+).
export function submitForm(form, button) {
  if (typeof form.requestSubmit === 'function') form.requestSubmit(button || undefined);
  else if (button) button.click();
  else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

/* ======================= exames ======================= */
// Códigos da busca do site (perto.html?exame=<código>), os mesmos de geo-core.js EXAMS.
export const SEARCH = {
  lab: 'Exames de laboratório', rx: 'Raio-X', usg: 'Ultrassom', tc: 'Tomografia', rm: 'Ressonância magnética',
  mamo: 'Mamografia', dens: 'Densitometria óssea', ecg: 'Eletrocardiograma', eco: 'Ecocardiograma',
};
// Guias de preparo (exames/<slug>.html#preparo). Laboratório não tem guia.
export const GUIDES = {
  rx: 'raio-x', usg: 'ultrassom', tc: 'tomografia', rm: 'ressonancia-magnetica', mamo: 'mamografia',
  dens: 'densitometria-ossea', ecg: 'eletrocardiograma', eco: 'ecocardiograma',
};

// Catálogo (versão 2026-10-30). Sem códigos TUSS: nomes usuais no Brasil. s = código da busca (null = não há
// busca específica); aka = outros nomes, só para achar na busca; obs = dica para a observação do item.
const L = (id, name, aka, obs) => ({ id, name, s: 'lab', ...(aka ? { aka } : {}), ...(obs ? { obs } : {}) });
const I = (id, name, s, aka, obs) => ({ id, name, s, ...(aka ? { aka } : {}), ...(obs ? { obs } : {}) });
const LADO = 'Lado: direito, esquerdo ou ambos';
const CONTRASTE = 'Com ou sem contraste';
export const CATALOG_VERSION = '2026-10-30';
export const CATALOG = [
  { id: 'sangue', label: 'Sangue', items: [
    L('hemograma', 'Hemograma completo'),
    L('glicemia', 'Glicemia de jejum', ['glicose']),
    L('hba1c', 'Hemoglobina glicada (HbA1c)', ['glicada', 'A1c']),
    L('totg', 'Curva glicêmica (TOTG 75 g)', ['teste oral de tolerância à glicose']),
    L('insulina', 'Insulina de jejum'),
    L('colesterol', 'Colesterol total e frações (HDL e LDL)', ['perfil lipídico', 'lipidograma']),
    L('triglicerides', 'Triglicerídeos', ['triglicérides']),
    L('ureia', 'Ureia'),
    L('creatinina', 'Creatinina', ['função renal']),
    L('sodio_potassio', 'Sódio e potássio', ['eletrólitos']),
    L('calcio', 'Cálcio'),
    L('acido_urico', 'Ácido úrico'),
    L('tgo_tgp', 'TGO (AST) e TGP (ALT)', ['transaminases', 'enzimas do fígado']),
    L('gama_gt', 'Gama-GT (GGT)'),
    L('fosfatase_alcalina', 'Fosfatase alcalina'),
    L('bilirrubinas', 'Bilirrubinas (total e frações)'),
    L('tsh', 'TSH', ['tireoide']),
    L('t4_livre', 'T4 livre'),
    L('anti_tpo', 'Anti-TPO (anticorpo antitireoperoxidase)'),
    L('vitamina_d', 'Vitamina D (25-hidroxivitamina D)', ['25-OH vitamina D']),
    L('vitamina_b12', 'Vitamina B12'),
    L('acido_folico', 'Ácido fólico', ['folato']),
    L('ferro', 'Ferro sérico'),
    L('ferritina', 'Ferritina'),
    L('pcr', 'Proteína C reativa (PCR)'),
    L('vhs', 'VHS (velocidade de hemossedimentação)'),
    L('coagulograma', 'Coagulograma (TP/INR e TTPa)', ['tempo de protrombina', 'INR']),
    L('beta_hcg', 'Beta-HCG no sangue (teste de gravidez)', ['BHCG', 'gravidez']),
    L('psa', 'PSA total e livre', ['próstata']),
    L('tipagem', 'Tipagem sanguínea (ABO e fator Rh)', ['grupo sanguíneo']),
    L('hiv', 'HIV 1 e 2 (anticorpos e antígeno)'),
    L('sifilis', 'Sífilis (VDRL ou teste treponêmico)', ['VDRL']),
    L('hepatite_b', 'Hepatite B (HBsAg, anti-HBs e anti-HBc)'),
    L('hepatite_c', 'Hepatite C (anti-HCV)'),
    L('toxoplasmose', 'Toxoplasmose IgG e IgM'),
    L('dengue', 'Dengue (NS1 ou sorologia IgM/IgG)'),
    L('fan', 'FAN (fator antinúcleo)'),
    L('fator_reumatoide', 'Fator reumatoide'),
    L('prolactina', 'Prolactina'),
    L('fsh_lh', 'FSH e LH'),
    L('testosterona', 'Testosterona total'),
  ] },
  { id: 'urina_fezes', label: 'Urina e fezes', items: [
    L('urina_tipo1', 'Urina tipo 1 (EAS)', ['EAS', 'sumário de urina', 'urina rotina']),
    L('urocultura', 'Urocultura com antibiograma', ['cultura de urina']),
    L('albumina_urina', 'Relação albumina/creatinina na urina (microalbuminúria)', ['microalbuminúria']),
    L('proteinuria_24h', 'Proteinúria de 24 horas', ['urina de 24 horas']),
    L('parasitologico', 'Parasitológico de fezes (EPF)', ['exame de fezes', 'protoparasitológico']),
    L('sangue_oculto', 'Pesquisa de sangue oculto nas fezes'),
  ] },
  { id: 'imagem', label: 'Imagem', items: [
    I('rx_torax', 'Raio-X de tórax (PA e perfil)', 'rx', ['radiografia de tórax']),
    I('rx_seios_face', 'Raio-X de seios da face', 'rx'),
    I('rx_coluna_cervical', 'Raio-X de coluna cervical', 'rx'),
    I('rx_coluna_lombar', 'Raio-X de coluna lombossacra', 'rx', ['raio-x de coluna lombar']),
    I('rx_joelho', 'Raio-X de joelho', 'rx', null, LADO),
    I('rx_ombro', 'Raio-X de ombro', 'rx', null, LADO),
    I('rx_mao_punho', 'Raio-X de mão e punho', 'rx', null, LADO),
    I('usg_abdome_total', 'Ultrassom de abdome total', 'usg', ['ultrassonografia de abdome']),
    I('usg_rins', 'Ultrassom de rins e vias urinárias', 'usg', ['ultrassom do aparelho urinário']),
    I('usg_tireoide', 'Ultrassom de tireoide', 'usg'),
    I('usg_pelvico', 'Ultrassom pélvico (via abdominal)', 'usg'),
    I('usg_transvaginal', 'Ultrassom transvaginal', 'usg'),
    I('usg_obstetrico', 'Ultrassom obstétrico', 'usg', null, 'Idade gestacional, se souber'),
    I('usg_mamas', 'Ultrassom de mamas', 'usg'),
    I('usg_prostata', 'Ultrassom de próstata (via abdominal)', 'usg'),
    I('usg_bolsa_escrotal', 'Ultrassom de bolsa escrotal', 'usg', ['ultrassom de testículos']),
    I('usg_partes_moles', 'Ultrassom de partes moles', 'usg', null, 'Região'),
    I('usg_articulacao', 'Ultrassom de articulação (ombro, joelho etc.)', 'usg', null, 'Articulação e lado'),
    I('doppler_venoso_mmii', 'Doppler venoso de membros inferiores', 'usg', ['ultrassom com doppler das pernas'], LADO),
    I('tc_cranio', 'Tomografia de crânio', 'tc', null, CONTRASTE),
    I('tc_torax', 'Tomografia de tórax', 'tc', null, CONTRASTE),
    I('tc_abdome_pelve', 'Tomografia de abdome total (abdome e pelve)', 'tc', null, CONTRASTE),
    I('tc_coluna_lombar', 'Tomografia de coluna lombar', 'tc'),
    I('rm_cranio', 'Ressonância magnética de crânio (encéfalo)', 'rm', null, CONTRASTE),
    I('rm_coluna_lombar', 'Ressonância magnética de coluna lombar', 'rm'),
    I('rm_joelho', 'Ressonância magnética de joelho', 'rm', null, 'Lado: direito ou esquerdo'),
    I('rm_ombro', 'Ressonância magnética de ombro', 'rm', null, 'Lado: direito ou esquerdo'),
    I('mamografia', 'Mamografia bilateral', 'mamo'),
    I('densitometria', 'Densitometria óssea (coluna lombar e fêmur)', 'dens'),
  ] },
  { id: 'coracao', label: 'Coração', items: [
    I('ecg', 'Eletrocardiograma (ECG)', 'ecg'),
    I('eco_tt', 'Ecocardiograma transtorácico', 'eco', ['ecocardiograma com doppler']),
    I('holter', 'Holter 24 horas', null),
    I('mapa', 'MAPA 24 horas (monitorização da pressão arterial)', null),
    I('teste_ergometrico', 'Teste ergométrico (teste de esforço)', null),
    I('doppler_carotidas', 'Doppler de carótidas e vertebrais', 'usg'),
  ] },
  { id: 'outros', label: 'Outros', items: [
    I('papanicolau', 'Papanicolau (citologia do colo do útero)', null, ['preventivo']),
    I('espirometria', 'Espirometria (prova de função pulmonar)', null),
    I('endoscopia', 'Endoscopia digestiva alta', null),
    I('colonoscopia', 'Colonoscopia', null),
    I('audiometria', 'Audiometria', null),
    I('eeg', 'Eletroencefalograma (EEG)', null),
    I('polissonografia', 'Polissonografia (exame do sono)', null),
    I('covid_gripe', 'Teste de COVID-19 ou gripe (swab nasal)', 'lab', ['RT-PCR', 'teste de antígeno']),
  ] },
];
export const OTHER_EXAM = { id: 'outro', name: 'Outro exame' };
const GROUP_OF = new Map(CATALOG.flatMap((g) => g.items.map((it) => [it.id, g])));
export const catalogItem = (id) => {
  const g = GROUP_OF.get(id);
  return g ? { ...g.items.find((it) => it.id === id), group: g.label, groupId: g.id } : null;
};

// Sem acento e em minúsculas, para buscar "ultrassom" com "ULTRASSOM" ou "tireóide" com "tireoide".
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Busca no catálogo pelo nome e pelos outros nomes: todas as palavras precisam aparecer (em qualquer parte).
// nomes: o dicionário da busca do site (o módulo exames-nomes.js, que medico.js baixa quando o médico toca na busca;
// este arquivo não o importa, para a teleconsulta e o documento.html abrirem sem ele). Com ele, a busca também acha os
// apelidos do exame ("USG", "ecografia", "tomo", "RNM", "chapa"), só pela palavra inteira ou pelo começo dela ("sono" não
// acha "ultrassonografia"), e aceita uma letra errada em palavra de 7 letras ou mais ("hemogrma", "resonancia").
const HAY = new Map();
function hayOf(it, nomes) {
  const key = nomes ? `${it.id}+` : it.id;
  if (!HAY.has(key)) {
    const hay = fold([it.name, ...(it.aka || []), SEARCH[it.s] || ''].join(' '));
    const extra = nomes ? nomes.apelidos(it.s).join(' ') : '';
    HAY.set(key, { hay, words: [...new Set(`${hay} ${extra}`.split(/[^a-z0-9]+/).filter(Boolean))] });
  }
  return HAY.get(key);
}
export function searchCatalog(query, nomes = null) {
  const words = fold(query).split(' ').filter(Boolean);
  const out = [];
  for (const g of CATALOG) {
    for (const it of g.items) {
      const h = hayOf(it, nomes);
      const acha = (w) => h.hay.includes(w) || (!!nomes && h.words.some((x) => nomes.comecoParecido(w, x) || nomes.parecida(w, x)));
      if (words.every(acha)) out.push({ ...it, group: g.label, groupId: g.id });
    }
  }
  return out;
}

// Item como o banco guarda: {code, name, group, search, note}. Textos cortados nos limites do banco.
const cut = (v, n) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, n) : null; };
export function examFromCatalog(id, note = '') {
  const it = catalogItem(id);
  if (!it) return null;
  return { code: it.id, name: it.name, group: it.group, search: it.s || null, note: cut(note, 200) };
}
export function freeExam(name, note = '', search = null) {
  const n = cut(name, 120);
  if (!n) return null;
  return { code: OTHER_EXAM.id, name: n, group: 'Outros exames', search: has(SEARCH, search) ? search : null, note: cut(note, 200) };
}
// Lista pronta para tele_set_exams: no máximo 60 itens, sem repetir o mesmo exame do catálogo.
export function examsPayload(list) {
  const seen = new Set();
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    const name = cut(e?.name, 120);
    if (!name) continue;
    const code = cut(e.code, 60);
    const key = code && code !== OTHER_EXAM.id ? `c:${code}` : `n:${fold(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code, name, group: cut(e.group, 60), search: has(SEARCH, e.search) ? e.search : null, note: cut(e.note, 200) });
    if (out.length === 60) break;
  }
  return out;
}

// Exames agrupados na ordem do catálogo (grupos desconhecidos no fim), para mostrar e imprimir.
export function groupExams(exams) {
  const order = CATALOG.map((g) => g.label);
  const groups = new Map();
  for (const e of Array.isArray(exams) ? exams : []) {
    if (!e || !e.name) continue;
    const label = e.group || 'Outros exames';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(e);
  }
  const rank = (l) => { const i = order.indexOf(l); return i < 0 ? order.length : i; };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([label, items]) => ({ label, items }));
}

// Links do exame: busca de locais perto (só com código conhecido) e guia de preparo (quando há).
export function examLinks(e, base = '') {
  const s = has(SEARCH, e?.search) ? e.search : null;
  return {
    near: s ? `${base}perto.html?exame=${s}` : null,
    guide: s && GUIDES[s] ? `${base}exames/${GUIDES[s]}.html#preparo` : null,
  };
}

/* ======================= sinais de alerta ======================= */
// Qualquer um bloqueia a fila e manda para a emergência (192). "cvv": mostra também o 188 (CVV).
export const ALERTS = [
  { id: 'peito', label: 'Dor ou aperto forte no peito' },
  { id: 'ar', label: 'Falta de ar forte (não consegue completar uma frase) ou lábios roxos' },
  { id: 'desmaio', label: 'Desmaio ou convulsão' },
  { id: 'avc', label: 'Fraqueza, dormência ou boca torta de repente, fala enrolada ou confusão de repente' },
  { id: 'cabeca', label: 'Dor de cabeça súbita e muito forte' },
  { id: 'sangramento', label: 'Sangramento forte que não para' },
  { id: 'alergia', label: 'Inchaço de repente no rosto, na boca ou na garganta (alergia forte)' },
  { id: 'gravidez', label: 'Grávida com sangramento, perda de líquido ou dor forte na barriga' },
  { id: 'intoxicacao', label: 'Intoxicação ou envenenamento (remédio em excesso, produto químico, veneno)' },
  { id: 'machucar', label: 'Pensamentos de se machucar ou de tirar a própria vida', cvv: true },
];
export const alertNeedsCvv = (ids) => (ids || []).some((id) => ALERTS.find((a) => a.id === id)?.cvv);

export const RELATIONSHIPS = ['Mãe', 'Pai', 'Responsável legal (tutor ou guardião)', 'Filho ou filha', 'Cônjuge ou companheiro(a)',
  'Irmão ou irmã', 'Neto ou neta', 'Cuidador(a)', 'Outro parente ou amigo(a)'];
// Para paciente com menos de 18 anos só valem estes (os mesmos de tele_request no banco).
export const GUARDIAN_RELATIONSHIPS = RELATIONSHIPS.slice(0, 3);

/* ======================= datas, idade e telefone ======================= */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');
export const normSpaces = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
// Data de hoje em São Paulo, no formato AAAA-MM-DD.
export const todaySP = (now = new Date()) => DAY_FMT.format(Number.isNaN(new Date(now).getTime()) ? new Date() : new Date(now));

export function isIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
// Idade em anos completos numa data (como private.tele_age). null se a data não vale.
export function ageOn(birth, today) {
  if (!isIsoDate(birth) || !isIsoDate(today)) return null;
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let a = ty - by;
  if (tm < bm || (tm === bm && td < bd)) a -= 1;
  return a;
}
export const ageLabel = (n) => (n == null || n < 0 ? '' : n === 0 ? 'menos de 1 ano' : n === 1 ? '1 ano' : `${n} anos`);

export function fmtDate(iso) {
  if (!isIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
const DT_FMT = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function parts(ts) {
  const d = new Date(ts ?? '');
  if (!ts || Number.isNaN(d.getTime())) return null;
  return Object.fromEntries(DT_FMT.formatToParts(d).map((p) => [p.type, p.value]));
}
// "30/10/2026 às 14:05" no horário de Brasília.
export function fmtDateTime(ts) {
  const p = parts(ts);
  return p ? `${p.day}/${p.month}/${p.year} às ${p.hour}:${p.minute}` : '';
}
export function fmtTime(ts) {
  const p = parts(ts);
  return p ? `${p.hour}:${p.minute}` : '';
}

// Telefone como o banco aceita: DDD + número (10 ou 11 dígitos), aceitando +55, espaços e traços.
export function normPhone(v) {
  let d = onlyDigits(v);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d;
}
export const isPhone = (d) => /^[1-9][1-9][0-9]{8,9}$/.test(String(d ?? ''));
export function fmtPhone(v) {
  const d = normPhone(v);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(v ?? '');
}
export const telHref = (v) => { const d = normPhone(v); return isPhone(d) ? `tel:+55${d}` : null; };
// Máscara enquanto digita: (11) 98765-4321.
export function maskPhone(v) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/* ======================= formulário do paciente ======================= */
// Mesmas regras de tele_request. Devolve os erros por campo (para mostrar todos de uma vez) e os
// argumentos da função (sem p_token_hash, que a página acrescenta).
// v: {who:'me'|'other', requester, relationship, agrees, name, birth, phone, reason, alerts:[], none, guardian, consent}
// agrees: adulto pedido por outra pessoa — o paciente está presente e concorda (ou quem pede é o representante legal).
export function validateRequest(v, today = todaySP()) {
  const errors = {};
  const forOther = v.who === 'other';
  const name = normSpaces(v.name);
  const reason = String(v.reason ?? '').trim();
  const phone = normPhone(v.phone);
  const alerts = (v.alerts || []).filter((id) => ALERTS.some((a) => a.id === id));
  const age = isIsoDate(v.birth) && v.birth <= today ? ageOn(v.birth, today) : null;
  const minor = age != null && age < 18;
  if (alerts.length) errors.alerts = 'emergencia';
  else if (!v.none) errors.alerts = 'Responda se o paciente tem algum destes sinais agora.';
  if (forOther) {
    const req = normSpaces(v.requester);
    if (req.length < 3 || req.length > 120) errors.requester = 'Escreva o seu nome completo (de quem está pedindo a consulta).';
    const rel = normSpaces(v.relationship);
    if (rel.length < 2 || rel.length > 60) errors.relationship = 'Escolha o que você é do paciente.';
  }
  if (name.length < 3 || name.length > 120) errors.name = 'Escreva o nome completo do paciente.';
  if (!isIsoDate(v.birth)) errors.birth = 'Informe a data de nascimento do paciente (dia, mês e ano).';
  else if (v.birth > today) errors.birth = 'A data de nascimento não pode ser no futuro.';
  else if (age > 120) errors.birth = 'Confira o ano de nascimento.';
  if (!isPhone(phone)) errors.phone = 'Informe o celular com DDD, como (11) 98765-4321.';
  if (reason.length < 3) errors.reason = 'Conte em poucas palavras o motivo da consulta.';
  else if (reason.length > 1000) errors.reason = 'O motivo pode ter até 1.000 caracteres.';
  if (minor) {
    if (!forOther) errors.minor = 'O paciente tem menos de 18 anos: a consulta precisa ser pedida pelo pai, pela mãe ou pelo responsável legal. Marque “Para outra pessoa” e preencha os seus dados.';
    else {
      if (!errors.relationship && !GUARDIAN_RELATIONSHIPS.includes(normSpaces(v.relationship))) errors.relationship = 'Paciente com menos de 18 anos: quem pede precisa ser a mãe, o pai ou o responsável legal.';
      if (!v.guardian) errors.guardian = 'Confirme que você é o responsável legal e que vai estar presente durante toda a consulta.';
    }
  } else if (forOther && age != null && !v.agrees) {
    errors.agrees = 'Confirme que o paciente está com você e concorda com a teleconsulta (ou que você é o representante legal dele).';
  }
  if (!v.consent) errors.consent = 'Para entrar na fila, leia e aceite o termo de consentimento.';
  const args = {
    p_patient_name: name,
    p_birthdate: v.birth,
    p_phone: phone,
    p_reason: reason,
    p_alert_flags: alerts,
    p_for_other: forOther,
    p_requester_name: forOther ? normSpaces(v.requester) : null,
    p_relationship: forOther ? normSpaces(v.relationship) : null,
    p_guardian_consent: forOther && minor && !!v.guardian,
    p_patient_agrees: forOther && !minor && !!v.agrees,
    p_consent: !!v.consent,
    p_consent_version: TCLE_VERSION,
  };
  return { errors, ok: Object.keys(errors).length === 0, args, age, minor };
}

// Campo do formulário do paciente para cada "details" de dados_invalidos (e sem_consentimento/paciente).
export const PATIENT_FIELD = { nome: 'name', nascimento: 'birth', telefone: 'phone', motivo: 'reason', responsavel: 'requester', parentesco: 'relationship', paciente: 'agrees' };

// O que o paciente pode fazer para sair da consulta agora: 'cancel' (desistir: ainda não começou), 'end' (encerrar a
// consulta já começada por vídeo, ligação ou mensagem) ou null. Mesmas regras de tele_cancel e tele_patient_end.
export function patientExit(row) {
  if (!row) return null;
  if (row.status === 'waiting') return 'cancel';
  if (row.status === 'accepted') return row.started_at ? 'end' : 'cancel';
  if (row.status === 'in_call') return 'end';
  return null;
}

/* ======================= cadastro do médico ======================= */
export function normCrm(v) { return onlyDigits(v).replace(/^0+/, ''); }
// Mesmas regras de tele_doctor_register. v: {full_name, crm, crm_uf, rqe, specialty, phone}
export function validateDoctor(v) {
  const errors = {};
  const name = normSpaces(v.full_name);
  const crm = normCrm(v.crm);
  const uf = String(v.crm_uf ?? '').trim().toUpperCase();
  const rqe = normCrm(v.rqe) || null;
  const spec = normSpaces(v.specialty) || null;
  const phone = normPhone(v.phone) || null;
  if (name.length < 5 || name.length > 120 || !/\S \S/.test(name)) errors.full_name = 'Escreva o nome completo, como está no CRM (nome e sobrenome).';
  if (!/^[1-9][0-9]{0,9}$/.test(crm)) errors.crm = 'Informe o número do CRM (só números).';
  if (!UFS.includes(uf)) errors.crm_uf = 'Escolha o estado (UF) do CRM.';
  if (rqe && !/^[1-9][0-9]{0,9}$/.test(rqe)) errors.rqe = 'O RQE tem só números.';
  if (!rqe && spec) errors.rqe = 'Para mostrar a especialidade, informe o RQE.';
  if (rqe && !spec) errors.specialty = 'Informe a especialidade do RQE.';
  if (spec && (spec.length < 2 || spec.length > 80)) errors.specialty = 'A especialidade pode ter de 2 a 80 caracteres.';
  if (phone && !isPhone(phone)) errors.phone = 'Informe o celular com DDD, como (11) 98765-4321, ou deixe em branco.';
  return {
    errors, ok: Object.keys(errors).length === 0,
    args: { p_full_name: name, p_crm: crm, p_crm_uf: uf, p_rqe: rqe, p_specialty: rqe ? spec : null, p_phone: phone },
  };
}
export const DOCTOR_FIELD = { nome: 'full_name', crm: 'crm', uf: 'crm_uf', rqe: 'rqe', especialidade: 'specialty', telefone: 'phone' };

/* ======================= conferência do médico (equipe do IMED) ======================= */
// Itens da conferência antes de aprovar (tele_admin_save_checks). "group": cfm, rqe (só com RQE) e identidade, que
// pode ser provada pelo vídeo (os dois itens) OU pela assinatura ICP-Brasil.
export const CHECK_ITEMS = [
  { id: 'cfm_active', group: 'cfm', label: 'Situação ativa no CFM, com nome, CRM e UF iguais aos do cadastro' },
  { id: 'rqe_checked', group: 'rqe', label: 'RQE e especialidade iguais aos do CFM' },
  { id: 'id_video', group: 'video', label: 'Chamada de vídeo: documento oficial com foto, rosto conferido com a pessoa' },
  { id: 'crm_card', group: 'video', label: 'Chamada de vídeo: carteira do CRM com o mesmo nome e número' },
  { id: 'icp_signature', group: 'icp', label: 'Ou: documento assinado com o certificado ICP-Brasil do médico, validado em validar.iti.gov.br (nome e CPF iguais)' },
];
export const CHECK_VALID_DAYS = 30;     // aprovar exige conferência feita há até 30 dias
export const RECHECK_MONTHS = 12;       // depois de 12 meses da conferência, o banco suspende até conferir de novo
// O que falta para aprovar (null = pode aprovar). Mesmas regras de private.tele_check_missing.
export function checkMissing(check, doctor) {
  if (!check) return 'conferencia';
  const same = ['full_name', 'crm', 'crm_uf', 'rqe', 'specialty'].every((k) => (check[k] ?? null) === (doctor?.[k] ?? null));
  if (!same) return 'dados';
  if (!check.cfm_active) return 'cfm';
  if (doctor?.rqe && !check.rqe_checked) return 'rqe';
  if (!((check.id_video && check.crm_card) || check.icp_signature)) return 'identidade';
  return null;
}
// Data até quando a conferência vale (12 meses), para mostrar ao médico e à equipe.
export function recheckDue(checkedAt) {
  const d = new Date(checkedAt ?? '');
  if (!checkedAt || Number.isNaN(d.getTime())) return null;
  const due = new Date(d.getTime());
  due.setUTCMonth(due.getUTCMonth() + RECHECK_MONTHS);
  return due.toISOString();
}

/* ======================= identificação do médico ======================= */
export const doctorCrm = (d) => (d && d.crm ? `CRM-${String(d.crm_uf || '').toUpperCase()} ${d.crm}` : '');
// Especialidade só com RQE (regra do CFM).
export const doctorSpecialty = (d) => (d && d.rqe ? `${d.specialty ? `${d.specialty} · ` : ''}RQE ${d.rqe}` : '');
export const doctorLine = (d) => [d?.full_name, doctorCrm(d), doctorSpecialty(d)].filter(Boolean).join(' · ');

/* ======================= situação e textos ======================= */
export const STATUS_PATIENT = {
  waiting: 'Na fila', accepted: 'Médico chamando', in_call: 'Em consulta', ended: 'Encerrada', cancelled: 'Cancelada', expired: 'Expirada',
};
export const STATUS_DOCTOR = {
  waiting: 'Esperando', accepted: 'Aceita', in_call: 'Em atendimento', ended: 'Encerrada', cancelled: 'Cancelada pelo paciente', expired: 'Expirada',
};
export const DOCTOR_REVIEW = { pending: 'Em análise', approved: 'Aprovado', rejected: 'Recusado', suspended: 'Suspenso' };

export function positionText(pos) {
  const n = Number(pos);
  if (!Number.isInteger(n) || n < 1) return 'Você está na fila.';
  if (n === 1) return 'Você é o próximo da fila.';
  return n === 2 ? 'Há 1 pessoa na sua frente.' : `Há ${n - 1} pessoas na sua frente.`;
}
export const consultCode = (id) => `TELE-${String(id ?? '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;

// Para o médico: a página do paciente está aberta? (seconds = há quantos segundos ela deu sinal; null = nunca).
export function seenText(seconds) {
  const s = Number(seconds);
  if (seconds == null || !Number.isFinite(s) || s < 0) return { ok: false, text: 'A página do paciente ainda não deu sinal.' };
  if (s <= 30) return { ok: true, text: 'A página da teleconsulta está aberta no aparelho do paciente.' };
  const min = Math.max(1, Math.round(s / 60));
  return { ok: false, text: `A página do paciente não dá sinal há ${min === 1 ? '1 minuto' : `${min} minutos`} (tela apagada ou página fechada).` };
}

/* ======================= erros do banco ======================= */
const KNOWN = new Set(['emergencia', 'sem_consentimento', 'dados_invalidos', 'menor_sem_responsavel', 'telefone_indisponivel', 'fila_cheia',
  'nao_encontrado', 'estado_invalido', 'versao_antiga', 'limite_mensagens', 'sem_login', 'sem_cadastro', 'nao_aprovado',
  'consulta_ativa', 'ja_atendida', 'indisponivel', 'prazo_encerrado', 'so_admin', 'crm_em_uso', 'conferencia_incompleta',
  // documentos (supabase/migrations/*_tele_documentos.sql; textos em tele-docs.js)
  'perfil_incompleto', 'paciente_incompleto', 'receita_bloqueada', 'cid_sem_autorizacao', 'limite_documentos', 'documento_cancelado',
  'pdf_sem_assinatura', 'pdf_outro_documento', 'ja_assinado', 'nao_leitor', 'erro_codigo', 'atendimento_nao_iniciado', 'consulta_nao_encerrada',
  'sem_conferencia_identidade', 'dados_paciente_mudaram']);
// Código curto do erro (como o banco manda em "message") e o campo ("details"). Sem internet: 'rede'.
export function errorInfo(err) {
  const msg = String(err?.data?.message ?? err?.message ?? '');
  const details = err?.data?.details ?? null;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { code: 'rede', details: null };
  if (KNOWN.has(msg)) return { code: msg, details };
  if (err?.status === 401 || err?.status === 403 || err?.data?.code === '42501' || /JWT|permission denied/i.test(msg)) return { code: 'sem_permissao', details: null };
  if (!err?.status) return { code: 'rede', details: null };
  return { code: 'erro', details: null };
}
const FIELD_TEXT = {
  nome: 'Confira o nome.', nascimento: 'Confira a data de nascimento.', telefone: 'Confira o celular com DDD.', motivo: 'Confira o motivo da consulta.',
  token: 'Não foi possível criar o código desta consulta neste aparelho. Atualize a página e tente de novo.',
  responsavel: 'Confira o seu nome (de quem pede).', parentesco: 'Escolha o que você é do paciente.',
  crm: 'Confira o número do CRM.', uf: 'Confira o estado (UF) do CRM.', rqe: 'Confira o RQE.', especialidade: 'Especialidade só com RQE (e RQE com a especialidade).',
  exames: 'Algum exame está com texto longo demais.', indicacao: 'A indicação clínica pode ter até 1.000 caracteres.',
  notas: 'O registro da consulta ficou longo demais.', orientacoes: 'As orientações podem ter até 4.000 caracteres.',
  mensagem: 'A mensagem pode ter de 1 a 1.000 caracteres.', sdp: 'Não foi possível preparar o vídeo. Tente de novo.', status: 'Situação inválida.',
  nota: 'A observação da conferência pode ter até 300 caracteres.',
};
const CHECK_TEXT = {
  conferencia: 'Antes de aprovar, faça e salve a conferência: situação no CFM e prova de identidade.',
  dados: 'O médico mudou os dados do cadastro depois da conferência. Confira de novo e salve.',
  cfm: 'Falta conferir no CFM a situação ativa, com nome, CRM e UF iguais aos do cadastro.',
  rqe: 'Falta conferir o RQE e a especialidade no CFM.',
  identidade: 'Falta a prova de identidade: vídeo com documento com foto e carteira do CRM, ou documento assinado com o certificado ICP-Brasil do médico.',
  antiga: `A conferência tem mais de ${CHECK_VALID_DAYS} dias. Confira de novo e salve.`,
};
export function errorText(code, details = null) {
  switch (code) {
    case 'emergencia': return 'Pelos sinais marcados, pode ser uma emergência. Ligue 192 (SAMU) ou vá ao pronto-socorro mais próximo.';
    case 'sem_consentimento': return details === 'paciente'
      ? 'Confirme que o paciente está com você e concorda com a teleconsulta (ou que você é o representante legal dele).'
      : 'Para entrar na fila, leia e aceite o termo de consentimento.';
    case 'dados_invalidos': return FIELD_TEXT[details] || 'Algum dado não está no formato aceito. Confira e tente de novo.';
    case 'menor_sem_responsavel': return 'Paciente com menos de 18 anos: a consulta precisa ser pedida pela mãe, pelo pai ou pelo responsável legal, que deve estar presente.';
    // Mesmo texto para "este celular já tem consulta" e "muitos pedidos hoje": não revela se alguém está em consulta.
    case 'telefone_indisponivel': return 'Não foi possível entrar na fila com este celular agora. Se você já pediu uma teleconsulta, abra esta página no aparelho e no navegador em que pediu. Se não, tente de novo mais tarde.';
    case 'fila_cheia': return 'A fila está cheia agora. Tente de novo em alguns minutos.';
    case 'conferencia_incompleta': return CHECK_TEXT[details] || CHECK_TEXT.conferencia;
    case 'nao_encontrado': return 'Não encontramos esta teleconsulta.';
    case 'estado_invalido': return 'A consulta mudou de situação. A página foi atualizada.';
    case 'versao_antiga': return 'O médico tentou o vídeo de novo. Conectando…';
    case 'limite_mensagens': return 'Esta consulta chegou ao limite de mensagens.';
    case 'sem_login': return 'Sua entrada expirou. Entre de novo com o link enviado ao seu e-mail.';
    case 'sem_cadastro': return 'Faça primeiro o seu cadastro de médico.';
    case 'nao_aprovado': return 'Seu cadastro não está aprovado agora. Veja a situação no topo da página.';
    case 'consulta_ativa': return 'Você já tem uma consulta em andamento. Encerre-a antes de atender outro paciente.';
    case 'ja_atendida': return 'Outro médico já atendeu este paciente.';
    case 'indisponivel': return 'Este paciente saiu da fila ou o pedido expirou.';
    case 'prazo_encerrado': return 'O prazo para complementar esta consulta (24 horas depois de encerrar) terminou.';
    case 'so_admin': return 'Só a equipe do IMED pode fazer isso.';
    case 'crm_em_uso': return 'Este CRM/UF já está aprovado ou suspenso em outra conta. Para aprovar este cadastro, recuse antes o outro (se for o errado). Se o CRM é seu, fale com o IMED.';
    case 'sem_permissao': return 'Sua entrada expirou ou não tem permissão para isso. Entre de novo com o link do e-mail.';
    case 'rede': return 'Sem resposta do servidor. Confira a internet e tente de novo.';
    default: return 'Não foi possível concluir agora. Tente de novo em instantes.';
  }
}

/* ======================= código secreto do paciente ======================= */
export function newToken(c = globalThis.crypto) {
  return [...c.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256Hex(text, c = globalThis.crypto) {
  const buf = await c.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => UUID.test(String(v ?? ''));
const validEntry = (e) => e && isUuid(e.id) && /^[0-9a-f]{64}$/.test(String(e.token ?? ''));
const readJson = (storage, key, fallback) => { try { return JSON.parse(storage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
const writeJson = (storage, key, v) => { try { if (v == null) storage.removeItem(key); else storage.setItem(key, JSON.stringify(v)); } catch { /* sem armazenamento */ } };
export function readCurrent(storage) {
  const e = readJson(storage, STORE_KEY, null);
  return validEntry(e) ? { id: e.id, token: e.token, at: e.at || null } : null;
}
export const writeCurrent = (storage, e) => writeJson(storage, STORE_KEY, e ? { id: e.id, token: e.token, at: e.at || new Date().toISOString() } : null);
// Consultas guardadas neste aparelho, sem as vencidas (HIST_DAYS dias depois de guardadas).
export function readHistory(storage, now = Date.now()) {
  const list = readJson(storage, HIST_KEY, []);
  const limit = HIST_DAYS * 86400e3;
  const fresh = (x) => { const t = Date.parse(x.saved || x.at || ''); return !Number.isFinite(t) || now - t < limit; };
  return Array.isArray(list) ? list.filter((x) => validEntry(x) && fresh(x)) : [];
}
// Guarda a consulta (mais nova primeiro, até 10) para o paciente rever os exames e as orientações depois.
export function archive(storage, e, meta = {}, now = Date.now()) {
  if (!validEntry(e)) return readHistory(storage, now);
  const old = readHistory(storage, now).find((x) => x.id === e.id);
  const item = { id: e.id, token: e.token, at: e.at || null, saved: old?.saved || new Date(now).toISOString(), ...meta };
  const list = [item, ...readHistory(storage, now).filter((x) => x.id !== e.id)].slice(0, 10);
  writeJson(storage, HIST_KEY, list);
  return list;
}
export const removeHistory = (storage, id) => writeJson(storage, HIST_KEY, readHistory(storage).filter((x) => x.id !== id));
export const clearHistory = (storage) => writeJson(storage, HIST_KEY, null);

// Código de um pedido enviado e ainda sem resposta (a resposta pode se perder no 3G): guardado ANTES de pedir,
// para repetir o pedido com o mesmo código (o banco devolve a mesma consulta). Vale por 2 horas.
export function readPending(storage, now = Date.now()) {
  const p = readJson(storage, PENDING_KEY, null);
  const t = Date.parse(p?.at || '');
  if (!p || !/^[0-9a-f]{64}$/.test(String(p.token ?? '')) || !Number.isFinite(t) || now - t > 2 * 3600e3 || t - now > 60e3) return null;
  return { token: p.token, at: p.at };
}
export const writePending = (storage, p) => writeJson(storage, PENDING_KEY, p ? { token: p.token, at: p.at || new Date().toISOString() } : null);

/* ======================= mensagens (chat) ======================= */
export function mergeMessages(list, incoming) {
  const map = new Map((list || []).map((m) => [Number(m.id), m]));
  for (const m of incoming || []) if (m && Number.isFinite(Number(m.id))) map.set(Number(m.id), m);
  return [...map.values()].sort((a, b) => Number(a.id) - Number(b.id));
}
export const lastId = (list) => (list && list.length ? Math.max(...list.map((m) => Number(m.id))) : 0);

/* ======================= folha: Lista de exames (não é o pedido médico) ======================= */
// HTML (já escapado) da folha para imprimir ou salvar em PDF. at = data e hora da consulta; version e updatedAt =
// versão do pedido (exams_version) e quando ela foi enviada (exams_at): a folha nova substitui as anteriores.
// Não tem assinatura: o título e o aviso no topo dizem que o pedido que vale é o PDF assinado pelo médico.
export function requestDocHtml({ id, patient_name, patient_birthdate, doctor, exams, indication, at, version = 0, updatedAt = null, printedAt = new Date(), site = '' }) {
  const d = doctor || {};
  const age = ageOn(patient_birthdate, todaySP(new Date(at || printedAt)));
  const groups = groupExams(exams);
  let n = 1;
  const lists = groups.map((g) => {
    const start = n;
    n += g.items.length;
    return `<h3>${esc(g.label)}</h3><ol start="${start}">${g.items.map((e) => `<li><b>${esc(e.name)}</b>${e.note ? ` — ${esc(e.note)}` : ''}</li>`).join('')}</ol>`;
  }).join('');
  const spec = doctorSpecialty(d);
  return `<article class="tl-doc">
  <header class="tl-doc-h"><p class="tl-doc-brand">IMED · Teleconsulta</p><h1>Lista de exames (não é o pedido médico)</h1><p class="tl-doc-mode">Lista da teleconsulta, sem assinatura</p></header>
  <p class="tl-doc-warn"><b>Esta folha NÃO é o pedido médico e não tem assinatura digital ICP-Brasil.</b> Ela serve só para você se organizar. O pedido de exames que vale é o PDF assinado pelo médico: baixe-o na página da teleconsulta, em “Documentos da consulta”, e leve esse arquivo ao laboratório ou à clínica.</p>
  <dl class="tl-doc-dl">
    <div><dt>Paciente</dt><dd>${esc(patient_name)}</dd></div>
    <div><dt>Data de nascimento</dt><dd>${esc(fmtDate(patient_birthdate))}${age != null ? ` (${esc(ageLabel(age))})` : ''}</dd></div>
    <div><dt>Data e hora da consulta</dt><dd>${esc(fmtDateTime(at))} (horário de Brasília)</dd></div>
    <div><dt>Código da consulta</dt><dd>${esc(consultCode(id))}</dd></div>
    ${Number(version) > 0 ? `<div><dt>Versão do pedido</dt><dd>${esc(String(Number(version)))}${updatedAt ? `, de ${esc(fmtDateTime(updatedAt))}` : ''}${Number(version) > 1 ? ' (substitui as anteriores)' : ''}</dd></div>` : ''}
  </dl>
  <section><h2>Médico(a) da teleconsulta</h2><p><b>${esc(d.full_name || '')}</b><br>${esc(doctorCrm(d))}${spec ? `<br>${esc(spec)}` : ''}</p></section>
  ${indication ? `<section><h2>Indicação clínica</h2><p class="tl-pre">${esc(indication)}</p></section>` : ''}
  <section><h2>Exames da lista</h2>${lists || '<p>Nenhum exame.</p>'}</section>
  <footer class="tl-doc-f">Gerado pelo IMED em ${esc(fmtDateTime(printedAt))}${site ? ` · ${esc(site)}` : ''}</footer>
</article>`;
}

/* ======================= vídeo (WebRTC) ======================= */
// Conexão direta entre os navegadores, sem "trickle ICE": cada lado espera juntar os candidatos (ou o tempo
// acabar) e grava a descrição completa (SDP) no banco. RTCPeerConnection pode ser trocado (testes).
export const ICE_DEFAULT = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
export const iceServersFrom = (cfg) => (Array.isArray(cfg?.tele?.iceServers) ? cfg.tele.iceServers : ICE_DEFAULT);

export function waitIceGathering(pc, ms = 4000, timers = globalThis) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const off = () => { pc.removeEventListener?.('icegatheringstatechange', onState); pc.removeEventListener?.('icecandidate', onCand); };
    const finish = (ok) => { if (done) return; done = true; timers.clearTimeout(t); off(); resolve(ok); };
    const onState = () => { if (pc.iceGatheringState === 'complete') finish(true); };
    const onCand = (e) => { if (e && e.candidate === null) finish(true); };
    const t = timers.setTimeout(() => finish(false), ms);
    pc.addEventListener('icegatheringstatechange', onState);
    pc.addEventListener('icecandidate', onCand);
  });
}

// Situação simples da conexão: new | connecting | connected | disconnected | failed | closed.
export function peerState(pc) {
  const c = pc?.connectionState;
  if (c && c !== 'new') return c;
  const i = pc?.iceConnectionState;
  if (i === 'checking') return 'connecting';
  if (i === 'connected' || i === 'completed') return 'connected';
  if (i === 'disconnected' || i === 'failed' || i === 'closed') return i;
  return 'new';
}

export function createPeer({ RTCPeerConnection: PC = globalThis.RTCPeerConnection, MediaStream: MS = globalThis.MediaStream,
  iceServers = ICE_DEFAULT, gatherMs = 4000, onTrack, onState, timers = globalThis } = {}) {
  if (typeof PC !== 'function') throw Object.assign(new Error('Este navegador não faz chamada de vídeo.'), { code: 'sem_webrtc' });
  const pc = new PC({ iceServers });
  let remote = null;
  let closed = false;
  let last = '';
  const emit = () => { const s = peerState(pc); if (s !== last) { last = s; onState?.(s); } };
  pc.addEventListener('connectionstatechange', emit);
  pc.addEventListener('iceconnectionstatechange', emit);
  pc.addEventListener('track', (e) => {
    const s = e.streams && e.streams[0];
    if (s) remote = s;
    else { if (!remote && typeof MS === 'function') remote = new MS(); remote?.addTrack?.(e.track); }
    onTrack?.(remote, e);
  });
  const addLocal = (stream) => {
    if (!stream) return;
    for (const t of stream.getTracks()) pc.addTrack(t, stream);
  };
  return {
    pc,
    // Quem chama (o médico): oferta com áudio e vídeo, mesmo sem câmera (para receber os do paciente).
    async offer(stream) {
      addLocal(stream);
      const kinds = new Set((stream?.getTracks() || []).map((t) => t.kind));
      for (const k of ['audio', 'video']) if (!kinds.has(k)) pc.addTransceiver(k, { direction: 'recvonly' });
      await pc.setLocalDescription(await pc.createOffer());
      await waitIceGathering(pc, gatherMs, timers);
      return pc.localDescription.sdp;
    },
    // Quem atende (o paciente): resposta à oferta, com a câmera e o microfone que houver.
    async answer(sdp, stream) {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      addLocal(stream);
      await pc.setLocalDescription(await pc.createAnswer());
      await waitIceGathering(pc, gatherMs, timers);
      return pc.localDescription.sdp;
    },
    async applyAnswer(sdp) { await pc.setRemoteDescription({ type: 'answer', sdp }); },
    // Troca a câmera (frente/trás) sem refazer a conexão.
    async replaceVideo(track) {
      const tr = (pc.getTransceivers?.() || []).find((t) => t.sender?.track?.kind === 'video' || t.receiver?.track?.kind === 'video');
      if (tr) await tr.sender.replaceTrack(track);
    },
    state: () => peerState(pc),
    flow: () => mediaFlow(pc),
    get remote() { return remote; },
    get closed() { return closed; },
    close() { if (closed) return; closed = true; try { pc.close(); } catch { /* já fechada */ } },
  };
}

// Quem envia e quem recebe áudio e vídeo, pelo que foi combinado na conexão (currentDirection de cada transceiver).
// send* = este aparelho envia; recv* = este aparelho recebe. Sem câmera e microfone (permissão negada), o paciente só
// recebe: o médico vê recvAudio=false e precisa ligar. Antes de combinar (sem currentDirection), tudo fica false.
export function mediaFlow(pc) {
  const out = { known: false, sendAudio: false, sendVideo: false, recvAudio: false, recvVideo: false };
  for (const t of pc?.getTransceivers?.() || []) {
    if (t.stopped) continue;
    const kind = t.receiver?.track?.kind || t.sender?.track?.kind;
    const dir = t.currentDirection;
    if (!kind || !dir) continue;
    out.known = true;
    const send = dir === 'sendrecv' || dir === 'sendonly';
    const recv = dir === 'sendrecv' || dir === 'recvonly';
    if (kind === 'audio') { out.sendAudio = out.sendAudio || send; out.recvAudio = out.recvAudio || recv; }
    if (kind === 'video') { out.sendVideo = out.sendVideo || send; out.recvVideo = out.recvVideo || recv; }
  }
  return out;
}

/* ======================= consulta periódica ======================= */
// Chama run() de tempos em tempos, sem sobrepor chamadas. Com a aba escondida: pausa (hiddenInterval null)
// ou fica mais lenta; ao voltar para a aba, consulta na hora. stop() para de vez.
export function createPoller({ run, interval = 4000, hiddenInterval = null, doc = globalThis.document, timers = globalThis }) {
  let timer = null;
  let running = false;
  let again = false;
  let stopped = true;
  let ms = interval;
  let hms = hiddenInterval;
  const hidden = () => !!(doc && doc.hidden);
  const clear = () => { if (timer != null) timers.clearTimeout(timer); timer = null; };
  const schedule = () => {
    clear();
    if (stopped) return;
    if (hidden()) { if (hms != null) timer = timers.setTimeout(tick, hms); return; }
    timer = timers.setTimeout(tick, ms);
  };
  async function tick() {
    timer = null;
    if (stopped) return;
    if (running) { again = true; return; }
    running = true;
    try { await run(); } catch { /* a próxima tentativa resolve */ } finally { running = false; }
    if (again && !stopped) { again = false; return tick(); }
    schedule();
  }
  const onVis = () => { if (!stopped && !hidden()) { clear(); tick(); } };
  doc?.addEventListener?.('visibilitychange', onVis);
  return {
    start() { if (!stopped) return; stopped = false; tick(); },
    stop() { stopped = true; again = false; clear(); },
    now() { if (stopped) return; clear(); tick(); },
    setInterval(v) { if (v !== ms) { ms = v; if (!running && !stopped && timer != null) schedule(); } },
    // Intervalo com a aba escondida (null = pausa). Na fila e na chamada a página precisa continuar consultando.
    setHidden(v) { if (v !== hms) { hms = v; if (!running && !stopped && hidden()) schedule(); } },
    get active() { return !stopped; },
    destroy() { this.stop(); doc?.removeEventListener?.('visibilitychange', onVis); },
  };
}
