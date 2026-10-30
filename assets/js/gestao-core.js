// Painel de gestão do IMED (gestao.html, só para a equipe do IMED): regras puras, sem página.
// - formatação: R$ (Intl pt-BR), números, porcentagens, datas e horas no fuso de São Paulo;
// - a resposta de public.admin_gestao arrumada para mostrar (o que o banco não consegue calcular fica null e a tela
//   mostra "—"; zero continua zero: nada é inventado);
// - gráficos em SVG feitos à mão, sem biblioteca: linhas (a série por dia), colunas agrupadas (faturamento por mês) e
//   barras horizontais (funil e situações). Cada um sai com role="img" e um resumo em aria-label; a página põe ao lado
//   uma tabela com os mesmos números ("Ver em tabela");
// - fluxograma da entrada de médicos (HTML), planilha CSV das cobranças e validação do formulário "Nova cobrança".
// Roda no navegador (gestao.js) e no Node (tests/gestao.test.mjs). Nada aqui busca dados: os números vêm das funções
// do banco public.admin_gestao e public.admin_cobranca_*, que conferem no servidor se a conta é da equipe do IMED.
import { niceTicks } from './estatisticas.js';

export const DASH = '—';
export const TZ = 'America/Sao_Paulo';
export const CFM_URL = 'https://portal.cfm.org.br/busca-medicos/';
export const PERIODOS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [365, '12 meses']];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/* ======================= números e dinheiro ======================= */
const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const DEC1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const BRL_CURTO = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 });

// Contagem (1.234). Sem número: "—".
export const fmtInt = (n) => (isNum(n) ? INT.format(Math.round(n)) : DASH);
// Centavos → "R$ 1.234,56" (com o espaço fixo do Intl entre "R$" e o número). Sem número: "—".
export const fmtBRL = (cents) => (isNum(cents) ? BRL.format(Math.round(cents) / 100) : DASH);
// Reais → "R$ 2,5 mil" (para o eixo do gráfico).
export const fmtBRLCurto = (reais) => (isNum(reais) ? BRL_CURTO.format(reais) : DASH);

// Porcentagem de a sobre b (0 a 100 ou mais). null quando não dá para calcular (sem número ou b zero).
export function pct(a, b) {
  if (!isNum(a) || !isNum(b) || b <= 0) return null;
  return (a / b) * 100;
}
// 40 → "40%", 2,5 → "2,5%", 99,6 → "99,6%" (não arredonda para 100%), 0,01 → "menos de 0,1%".
export function fmtPct(p) {
  if (!isNum(p)) return DASH;
  if (p > 0 && p < 0.05) return 'menos de 0,1%';
  const casas = (p > 0 && p < 10) || (p > 99 && p < 100) ? 1 : 0;
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: casas }).format(p)}%`;
}
// Minutos (média) → "8 min", "1 h 05 min".
export function fmtMin(m) {
  if (!isNum(m) || m < 0) return DASH;
  if (m < 1) return 'menos de 1 min';
  const t = Math.round(m);
  if (t < 60) return `${t} min`;
  const h = Math.floor(t / 60);
  const r = t % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')} min` : `${h} h`;
}
// Horas (média até aprovar o médico) → "5 horas", "2,5 dias".
export function fmtHoras(h) {
  if (!isNum(h) || h < 0) return DASH;
  if (h < 1) return 'menos de 1 hora';
  if (h < 48) { const r = Math.round(h); return `${r} ${r === 1 ? 'hora' : 'horas'}`; }
  return `${DEC1.format(Math.round((h / 24) * 10) / 10)} dias`;
}
// Média das avaliações (1 a 5) → "4,7 de 5".
export const fmtNota = (m) => (isNum(m) ? `${DEC1.format(m)} de 5` : DASH);
export const plural = (n, um, varios) => `${fmtInt(n)} ${n === 1 ? um : varios}`;

// Valor digitado em reais ("150", "150,00", "1.234,56", "R$ 99,9", "1234.5") → centavos inteiros.
// null quando vazio; NaN quando não é um valor (letras, mais de 2 casas, sinal de menos).
export function parseReais(v) {
  let s = String(v ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}
// Centavos → "1234,56" (planilha: sem separador de milhar, vírgula nas casas).
export const centsPlanilha = (c) => `${Math.trunc(c / 100)},${String(Math.abs(Math.round(c)) % 100).padStart(2, '0')}`;

/* ======================= datas (fuso de São Paulo) ======================= */
const DIA_SP = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const DATA_SP = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const HORA_SP = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const todaySP = (now = Date.now()) => DIA_SP.format(new Date(now));

// "2026-10-30" de verdade (sem 30 de fevereiro).
export function isIsoDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}
export const shortDay = (iso) => (isIsoDay(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : DASH);
export const fullDay = (iso) => (isIsoDay(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : DASH);
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const weekDay = (iso) => (isIsoDay(iso) ? `${SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()]}, ${fullDay(iso)}` : DASH);
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MES_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const monthLabel = (ym) => { const m = MES_RE.exec(String(ym ?? '')); return m ? `${MESES[Number(m[2]) - 1]}/${m[1].slice(2)}` : String(ym ?? ''); };
export const monthLong = (ym) => { const m = MES_RE.exec(String(ym ?? '')); return m ? `${MESES_LONGOS[Number(m[2]) - 1]} de ${m[1]}` : String(ym ?? ''); };
// "2026-10-29T12:00:00Z" → "29/10/2026 às 09:00" (horário de São Paulo).
export function fmtDateTime(iso) {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return DASH;
  return `${DATA_SP.format(new Date(t))} às ${HORA_SP.format(new Date(t))}`;
}
const dateTimePlanilha = (iso) => { const t = Date.parse(iso); return !iso || Number.isNaN(t) ? '' : `${DATA_SP.format(new Date(t))} ${HORA_SP.format(new Date(t))}`; };
export const fmtHora = (iso) => { const t = Date.parse(iso); return !iso || Number.isNaN(t) ? DASH : HORA_SP.format(new Date(t)); };
// Há quanto tempo: "há 5 min", "há 3 h", "há 2 dias".
export function sinceText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return '';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 60) return min < 1 ? 'agora há pouco' : `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

/* ======================= nomes ======================= */
export const PEDIDO_STATUS = [['pendente', 'Pendente'], ['contatado', 'Contatado'], ['confirmado', 'Confirmado'], ['concluido', 'Concluído'], ['cancelado', 'Cancelado']];
export const TELE_STATUS = [['aguardando', 'Na fila'], ['aceita', 'Aceita pelo médico'], ['em_atendimento', 'Em atendimento'], ['encerrada', 'Encerrada'], ['cancelada', 'Cancelada'], ['expirada', 'Expirada']];
// Os mesmos tipos de documento da teleconsulta (tele-docs.js); o teste confere que nenhum fica sem nome.
export const DOC_TIPOS = [['exames', 'Pedido de exames'], ['receita', 'Receita'], ['atestado', 'Atestado'], ['comparecimento', 'Comparecimento'], ['encaminhamento', 'Encaminhamento'], ['relatorio', 'Relatório'], ['orientacoes', 'Orientações']];
export const COB_TIPOS = [['teleconsulta', 'Teleconsulta'], ['mensalidade_clinica', 'Mensalidade de clínica'], ['comissao_clinica', 'Comissão de clínica'], ['outro', 'Outro']];
export const PAGADORES = [['paciente', 'Paciente'], ['clinica', 'Clínica'], ['medico', 'Médico'], ['outro', 'Outro']];
export const COB_STATUS = [['pendente', 'Pendente'], ['pago', 'Paga'], ['cancelado', 'Cancelada']];
export const FORMAS = [['pix', 'Pix'], ['cartao', 'Cartão'], ['boleto', 'Boleto'], ['dinheiro', 'Dinheiro'], ['transferencia', 'Transferência'], ['outro', 'Outra']];
// Filtro da tabela: "Atrasadas" são as pendentes com vencimento antes de hoje (o banco devolve as pendentes).
export const COB_FILTROS = [['', 'Todas'], ['pendente', 'Pendentes'], ['atrasada', 'Atrasadas'], ['pago', 'Pagas'], ['cancelado', 'Canceladas']];
export const VALOR_MIN = 1;
export const VALOR_MAX = 100000000;
const keys = (list) => new Set(list.map(([k]) => k));
const TIPO_OK = keys(COB_TIPOS);
const PAGADOR_OK = keys(PAGADORES);
export const labelOf = (list, key) => (list.find(([k]) => k === key)?.[1] ?? String(key ?? ''));

// Etapas dos funis (as chaves de "funil" do banco). As três primeiras de cada um são páginas abertas.
export const FUNIL_AGENDA = [['abriram_busca', 'Abriram a busca (Perto de mim)'], ['abriram_local', 'Abriram a página de um local'], ['pedidos', 'Pediram agendamento'], ['confirmados', 'Pedido confirmado'], ['concluidos', 'Atendimento concluído']];
export const FUNIL_TELE = [['abriram_tele', 'Abriram a teleconsulta'], ['tele_fila', 'Entraram na fila'], ['tele_atendidas', 'Atendidas por um médico'], ['tele_encerradas', 'Consulta encerrada'], ['tele_com_documento', 'Com documento emitido']];
// Séries do gráfico "Atendimentos por dia" (as visitas vão em outro gráfico, com a escala delas).
export const SERIES_ATEND = [['pedidos', 'Pedidos de agendamento'], ['tele_pedidas', 'Teleconsultas pedidas'], ['tele_encerradas', 'Teleconsultas encerradas'], ['documentos', 'Documentos emitidos']];

/* ======================= resposta do banco ======================= */
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = (v) => (v === null || v === undefined ? '' : String(v));
// Número que dá para mostrar (zero ou mais). Qualquer outra coisa (null, texto, negativo, NaN) vira null → "—".
export function num(v) {
  if (v === null || v === undefined || typeof v === 'boolean' || (typeof v === 'string' && !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
const pick = (o, list) => Object.fromEntries(list.map((k) => [k, num(o[k])]));
const SERIE_KEYS = ['visitas', 'pedidos', 'tele_pedidas', 'tele_encerradas', 'documentos'];
const PED_KEYS = ['total', 'pendente', 'contatado', 'confirmado', 'cancelado', 'concluido', 'parceiro', 'concierge'];
const TELE_KEYS = ['total', 'aguardando', 'aceita', 'em_atendimento', 'encerrada', 'cancelada', 'expirada', 'espera_media_min', 'duracao_media_min'];
const FUNIL_KEYS = ['visitas', ...FUNIL_AGENDA.map(([k]) => k), ...FUNIL_TELE.map(([k]) => k)];
const MED_KEYS = ['inscritos_periodo', 'pendente', 'aprovado', 'recusado', 'suspenso', 'disponiveis_agora', 'aprovacao_media_horas'];
const CLI_KEYS = ['parceiras', 'com_agenda', 'com_preco', 'interessadas'];
const COB_KEYS = ['faturado_cents', 'a_receber_cents', 'atrasado_cents', 'cancelado_cents', 'qtd_pagas', 'qtd_pendentes'];

// Resposta de admin_gestao → o que a tela mostra. Tolera campo faltando ou fora do formato (vira null, "—").
export function normalizeGestao(raw, dias = 30) {
  const r = obj(raw);
  const pac = obj(r.pacientes);
  const docs = obj(pac.documentos);
  const av = obj(pac.avaliacoes);
  const med = obj(r.medicos);
  const cli = obj(r.clinicas);
  const cob = obj(r.cobranca);
  // Série: um item por dia, em ordem e sem repetir o dia.
  const seen = new Set();
  const serie = (Array.isArray(r.serie) ? r.serie : [])
    .filter((x) => x && isIsoDay(x.dia) && !seen.has(x.dia) && seen.add(x.dia))
    .map((x) => ({ dia: x.dia, ...pick(x, SERIE_KEYS) }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
  const porTipo = {};
  for (const [k, v] of Object.entries(obj(docs.por_tipo))) if (/^[a-z_]{1,40}$/.test(k)) porTipo[k] = num(v);
  const media = num(av.media);
  const nDias = num(r.dias);
  const seenMes = new Set();
  return {
    dias: Number.isInteger(nDias) && nDias > 0 ? nDias : dias,
    de: isIsoDay(r.de) ? r.de : serie[0]?.dia ?? null,
    ate: isIsoDay(r.ate) ? r.ate : serie.at(-1)?.dia ?? null,
    gerado_em: r.gerado_em && !Number.isNaN(Date.parse(r.gerado_em)) ? String(r.gerado_em) : null,
    serie,
    pacientes: {
      atendidos: num(pac.atendidos),
      pedidos: pick(obj(pac.pedidos), PED_KEYS),
      tele: pick(obj(pac.tele), TELE_KEYS),
      documentos: { total: num(docs.total), por_tipo: porTipo, cancelados: num(docs.cancelados), pdf_assinado: num(docs.pdf_assinado) },
      avaliacoes: { total: num(av.total), media: media !== null && media <= 5 ? media : null },
    },
    funil: pick(obj(r.funil), FUNIL_KEYS),
    medicos: {
      ...pick(med, MED_KEYS),
      aguardando: (Array.isArray(med.aguardando) ? med.aguardando : []).filter((d) => d && typeof d === 'object').slice(0, 50).map((d) => ({
        id: str(d.id), nome: str(d.nome).trim(), crm: str(d.crm).trim(), uf: str(d.uf).trim().toUpperCase().slice(0, 2),
        especialidade: d.especialidade === null || d.especialidade === undefined || !String(d.especialidade).trim() ? null : String(d.especialidade).trim(),
        desde: d.desde && !Number.isNaN(Date.parse(d.desde)) ? String(d.desde) : null,
      })),
    },
    clinicas: { ...pick(cli, CLI_KEYS), reivindicacoes: pick(obj(cli.reivindicacoes), ['pendente', 'aprovado', 'recusado']) },
    outros: pick(obj(r.outros), ['lista_espera', 'contatos', 'avisos_de_erro']),
    cobranca: {
      ...pick(cob, COB_KEYS),
      por_mes: (Array.isArray(cob.por_mes) ? cob.por_mes : [])
        .filter((x) => x && MES_RE.test(String(x.mes)) && !seenMes.has(x.mes) && seenMes.add(x.mes))
        .map((x) => ({ mes: x.mes, faturado_cents: num(x.faturado_cents), a_receber_cents: num(x.a_receber_cents) }))
        .sort((a, b) => a.mes.localeCompare(b.mes)),
    },
  };
}

// Soma de uma coluna da série (null se nenhum dia tiver o número).
export function somaSerie(serie, key) {
  const vals = serie.map((x) => x[key]).filter(isNum);
  return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
}

// Funil: cada etapa com a % sobre a etapa anterior e sobre a primeira (null quando não dá para calcular).
export function funnel(steps) {
  return steps.map((s, i) => ({
    ...s,
    pctPrev: i ? pct(s.value, steps[i - 1].value) : null,
    pctFirst: i ? pct(s.value, steps[0].value) : isNum(s.value) && s.value > 0 ? 100 : null,
  }));
}

/* ======================= gráficos em SVG ======================= */
// Largura aproximada de um texto (Inter): basta para reservar espaço e não deixar rótulo sair do desenho.
export const textW = (s, size = 12, bold = false) => String(s).length * size * (bold ? 0.62 : 0.58);
const r1 = (n) => Math.round(n * 10) / 10;
const svgOpen = (W, H, label, cls = '') => `<svg class="gs-svg${cls ? ` ${cls}` : ''}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">`;
// Texto do eixo de baixo que não passa da borda do desenho.
function xLabel(x, y, text, W, size = 11.5) {
  const w = textW(text, size);
  let anchor = 'middle';
  let at = x;
  if (x - w / 2 < 1) { anchor = 'start'; at = Math.max(1, x - 4); }
  else if (x + w / 2 > W - 1) { anchor = 'end'; at = Math.min(W - 1, x + 4); }
  return `<text class="gs-tick" x="${r1(at)}" y="${y}" text-anchor="${anchor}">${esc(text)}</text>`;
}
// Quais rótulos do eixo de baixo aparecem: no máximo um a cada `minGap` px, sempre o último (o dia mais novo).
export function labelStep(n, plotW, minGap = 56) {
  if (n <= 1) return 1;
  const cabem = Math.max(2, Math.floor(plotW / minGap));
  return Math.max(1, Math.ceil(n / cabem));
}
// Coluna (ou barra) com 4 px arredondados só na ponta do dado; reta na linha de base.
function colPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${r1(x)} ${r1(y + h)}V${r1(y + r)}Q${r1(x)} ${r1(y)} ${r1(x + r)} ${r1(y)}H${r1(x + w - r)}Q${r1(x + w)} ${r1(y)} ${r1(x + w)} ${r1(y + r)}V${r1(y + h)}Z`;
}
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h / 2);
  return `M${r1(x)} ${r1(y)}H${r1(x + w - r)}Q${r1(x + w)} ${r1(y)} ${r1(x + w)} ${r1(y + r)}V${r1(y + h - r)}Q${r1(x + w)} ${r1(y + h)} ${r1(x + w - r)} ${r1(y + h)}H${r1(x)}Z`;
}
// Eixo de valores: linhas de grade finas e os números à esquerda. Devolve a escala e o espaço usado.
function yAxis(maxVal, tickFmt, H, padT, padB) {
  const ticks = niceTicks(maxVal);
  const top = ticks[ticks.length - 1] || 1;
  const labels = ticks.map((t) => tickFmt(t));
  const padL = Math.ceil(Math.max(...labels.map((t) => textW(t, 11.5)))) + 10;
  const ph = H - padT - padB;
  const y = (v) => padT + ph - (Math.min(v, top) / top) * ph;
  return { ticks, labels, top, padL, ph, y };
}
function gridSvg(ax, x0, x1) {
  return ax.ticks.map((t, i) => `<line class="${t ? 'gs-grid' : 'gs-base'}" x1="${r1(x0)}" x2="${r1(x1)}" y1="${r1(ax.y(t))}" y2="${r1(ax.y(t))}"/>`
    + `<text class="gs-tick" x="${r1(x0 - 6)}" y="${r1(ax.y(t) + 4)}" text-anchor="end">${esc(ax.labels[i])}</text>`).join('');
}

// Linhas por dia. series: [{ label, cls: 'gs-c1', values: [n|null, ...] }], um valor por dia de `days`.
// area: preenche de leve embaixo (só para uma série). peak: escreve o número do dia com mais.
// Cada dia tem uma faixa invisível (data-tip) que mostra todos os números daquele dia ao passar o mouse.
export function lineSvg({ width = 640, height = 220, days = [], series = [], label = '', fmt = fmtInt, area = false, peak = false } = {}) {
  const W = Math.max(240, Math.round(width));
  const H = Math.max(140, Math.round(height));
  const n = days.length;
  const vals = series.flatMap((s) => s.values.filter(isNum));
  const max = vals.length ? Math.max(...vals) : 0;
  const padT = peak ? 22 : 12;
  const padB = 26;
  const padR = 10;
  const ax = yAxis(max, fmt, H, padT, padB);
  const pw = W - ax.padL - padR;
  const x = (i) => ax.padL + (n <= 1 ? pw / 2 : (i * pw) / (n - 1));
  let out = svgOpen(W, H, label) + gridSvg(ax, ax.padL, W - padR);
  // eixo de baixo
  const step = labelStep(n, pw);
  for (let i = 0; i < n; i += 1) if ((n - 1 - i) % step === 0) out += xLabel(x(i), H - 7, shortDay(days[i]), W);
  // linhas (um valor sem número interrompe a linha)
  const dots = n > 0 && n <= 31 && (n === 1 || pw / (n - 1) >= 14);
  for (const s of series) {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => { if (!isNum(v)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${r1(x(i))} ${r1(ax.y(v))}`; pen = true; });
    if (area && series.length === 1 && d && s.values.every(isNum) && n > 1) {
      out += `<path class="gs-area ${esc(s.cls)}" d="${d}L${r1(x(n - 1))} ${r1(ax.y(0))}L${r1(x(0))} ${r1(ax.y(0))}Z"/>`;
    }
    if (d) out += `<path class="gs-line ${esc(s.cls)}" d="${d}"/>`;
    if (dots) s.values.forEach((v, i) => { if (isNum(v)) out += `<circle class="gs-dot ${esc(s.cls)}" cx="${r1(x(i))}" cy="${r1(ax.y(v))}" r="4"/>`; });
  }
  // o dia com mais (uma série só): o número em cima do ponto
  if (peak && series.length === 1 && max > 0) {
    const v = series[0].values;
    const i = v.lastIndexOf(max);
    out += xLabel(x(i), r1(ax.y(max) - 9), fmt(max), W, 12).replace('class="gs-tick"', 'class="gs-peak"');
  }
  // faixas para o mouse (uma por dia)
  for (let i = 0; i < n; i += 1) {
    const a = i === 0 ? ax.padL : (x(i - 1) + x(i)) / 2;
    const b = i === n - 1 ? W - padR : (x(i) + x(i + 1)) / 2;
    const tip = [weekDay(days[i]), ...series.map((s) => `${s.label}: ${fmt(s.values[i])}`)].join('\n');
    out += `<rect class="gs-hit" x="${r1(a)}" y="${padT}" width="${r1(Math.max(1, b - a))}" height="${r1(ax.ph)}" data-tip="${esc(tip)}"/>`;
  }
  return `${out}</svg>`;
}

// Colunas agrupadas (ex.: faturado e a receber por mês). cats: [{ label, tip }]; series: [{ label, cls, values }].
// fmt: número no balão; tickFmt: número do eixo.
export function columnsSvg({ width = 640, height = 220, cats = [], series = [], label = '', fmt = fmtInt, tickFmt = fmtInt } = {}) {
  const W = Math.max(240, Math.round(width));
  const H = Math.max(140, Math.round(height));
  const n = cats.length;
  const m = Math.max(1, series.length);
  const vals = series.flatMap((s) => s.values.filter(isNum));
  const max = vals.length ? Math.max(...vals) : 0;
  const padT = 12;
  const padB = 26;
  const padR = 6;
  const ax = yAxis(max, tickFmt, H, padT, padB);
  const pw = W - ax.padL - padR;
  const gw = n ? pw / n : pw;
  const gap = 2;
  const bw = Math.max(2, Math.min(24, (gw - 8 - (m - 1) * gap) / m));
  const cx = (i) => ax.padL + gw * i + gw / 2;
  let out = svgOpen(W, H, label) + gridSvg(ax, ax.padL, W - padR);
  const step = labelStep(n, pw, 46);
  for (let i = 0; i < n; i += 1) {
    if ((n - 1 - i) % step === 0) out += xLabel(cx(i), H - 7, cats[i].label, W);
    const x0 = cx(i) - (m * bw + (m - 1) * gap) / 2;
    series.forEach((s, j) => {
      const v = s.values[i];
      if (!isNum(v) || v <= 0) return;
      const h = Math.max(2, ax.y(0) - ax.y(v));
      out += `<path class="gs-bar ${esc(s.cls)}" d="${colPath(x0 + j * (bw + gap), ax.y(0) - h, bw, h)}"/>`;
    });
    const tip = [cats[i].tip || cats[i].label, ...series.map((s) => `${s.label}: ${fmt(s.values[i])}`)].join('\n');
    out += `<rect class="gs-hit" x="${r1(ax.padL + gw * i)}" y="${padT}" width="${r1(gw)}" height="${r1(ax.ph)}" data-tip="${esc(tip)}"/>`;
  }
  return `${out}</svg>`;
}

// Quebra um rótulo em até duas linhas para caber na largura (sem cortar letra).
export function wrapText(text, maxW, size = 13) {
  const t = String(text ?? '');
  if (textW(t, size, true) <= maxW) return [t];
  const words = t.split(' ');
  let best = [t];
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (textW(a, size, true) <= maxW) best = [a, b];
  }
  return best;
}

// Barras deitadas: o nome em cima, a barra embaixo e o número na ponta direita. A barra mede a parte sobre `max`
// (um trilho claro mostra o todo). rows: [{ label, value, extra, cls }]; extra entra depois do número ("40%").
export function hbarsSvg({ width = 640, rows = [], label = '', max = null, fmt = fmtInt } = {}) {
  const W = Math.max(240, Math.round(width));
  const vals = rows.map((r) => r.value).filter(isNum);
  const top = isNum(max) && max > 0 ? max : vals.length ? Math.max(...vals) : 0;
  const texts = rows.map((r) => `${fmt(r.value)}${r.extra ? ` · ${r.extra}` : ''}`);
  const valW = Math.ceil(Math.max(40, ...texts.map((t) => textW(t, 13, true)))) + 10;
  const trackW = Math.max(60, W - valW);
  const BAR = 12;
  let y = 0;
  let body = '';
  rows.forEach((r, i) => {
    const lines = wrapText(r.label, W - 2);
    lines.forEach((ln, k) => { body += `<text class="gs-lab" x="0" y="${y + 14 + k * 16}">${esc(ln)}</text>`; });
    const by = y + 6 + lines.length * 16;
    body += `<rect class="gs-track" x="0" y="${by}" width="${r1(trackW)}" height="${BAR}" rx="4"/>`;
    if (isNum(r.value) && r.value > 0 && top > 0) {
      const w = Math.max(3, (Math.min(r.value, top) / top) * trackW);
      body += `<path class="gs-bar ${esc(r.cls || 'gs-c1')}" d="${barPath(0, by, w, BAR)}"/>`;
    }
    body += `<text class="gs-val" x="${W}" y="${by + BAR - 1}" text-anchor="end">${esc(texts[i])}</text>`;
    const rowH = by + BAR + 10 - y;
    body += `<rect class="gs-hit" x="0" y="${y}" width="${W}" height="${rowH}" data-tip="${esc(`${r.label}: ${texts[i]}`)}"/>`;
    y += rowH;
  });
  const H = Math.max(20, y);
  return `${svgOpen(W, H, label, 'gs-hsvg')}${body}</svg>`;
}

/* ======================= resumos (aria-label dos gráficos) ======================= */
const lista = (itens) => (itens.length > 1 ? `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}` : itens[0] || '');
const periodo = (de, ate) => (isIsoDay(de) && isIsoDay(ate) ? `de ${shortDay(de)} a ${shortDay(ate)}` : 'no período');

export function resumoAtendimentos(serie, de, ate) {
  const partes = SERIES_ATEND.map(([k, nome]) => { const t = somaSerie(serie, k); return `${fmtInt(t)} ${nome.toLowerCase()}`; });
  let pico = '';
  const ped = serie.map((x) => x.pedidos);
  const mx = Math.max(0, ...ped.filter(isNum));
  if (mx > 0) pico = `; o dia com mais pedidos de agendamento foi ${shortDay(serie[ped.lastIndexOf(mx)].dia)}, com ${fmtInt(mx)}`;
  return `Atendimentos por dia, ${periodo(de, ate)}: ${lista(partes)}${pico}.`;
}
export function resumoVisitas(serie, de, ate) {
  const total = somaSerie(serie, 'visitas');
  const v = serie.map((x) => x.visitas);
  const mx = Math.max(0, ...v.filter(isNum));
  return `Visualizações de página por dia, ${periodo(de, ate)}: ${fmtInt(total)} no total${mx > 0 ? `; o dia com mais foi ${shortDay(serie[v.lastIndexOf(mx)].dia)}, com ${fmtInt(mx)}` : ''}.`;
}
export function resumoFunil(titulo, steps) {
  return `${titulo}: ${lista(funnel(steps).map((s, i) => `${s.label.toLowerCase()} ${fmtInt(s.value)}${i ? ` (${fmtPct(s.pctPrev)} da etapa anterior)` : ''}`))}.`;
}
export const resumoBarras = (titulo, rows, fmt = fmtInt) => `${titulo}: ${rows.length ? lista(rows.map((r) => `${r.label.toLowerCase()} ${fmt(r.value)}`)) : 'nenhum'}.`;
export function resumoMeses(porMes) {
  if (!porMes.length) return 'Faturamento por mês: sem meses para mostrar.';
  const fat = somaSerie(porMes, 'faturado_cents');
  const rec = somaSerie(porMes, 'a_receber_cents');
  const v = porMes.map((x) => x.faturado_cents);
  const mx = Math.max(0, ...v.filter(isNum));
  const pico = mx > 0 ? `; o mês com mais faturamento foi ${monthLong(porMes[v.lastIndexOf(mx)].mes)}, com ${fmtBRL(mx)}` : '';
  return `Faturamento por mês, de ${monthLong(porMes[0].mes)} a ${monthLong(porMes.at(-1).mes)}: ${fmtBRL(fat)} faturado e ${fmtBRL(rec)} a receber${pico}.`;
}

/* ======================= fluxograma da entrada de médicos ======================= */
// Inscrição → Conferência do CRM no CFM → Aprovado → Disponível para atender, com os ramos Recusado (sai da
// conferência) e Suspenso (sai do aprovado). Cada caixa com o número de agora. HTML (o texto quebra sozinho no
// celular); as setas são desenho do CSS. Ordem de leitura: as etapas, cada ramo logo depois da etapa de onde sai.
export function fluxoMedicosHtml(m) {
  const md = m || {};
  const box = (cls, icon, n, title, caption, branch = '') => `<li class="gs-fx ${cls}">
      ${branch ? `<span class="sr">${esc(branch)} </span>` : ''}<span class="gs-fx-ic" aria-hidden="true"><i class="fa-solid ${icon}"></i></span>
      <span class="gs-fx-tx"><b class="gs-fx-n">${esc(fmtInt(n))}</b><span class="gs-fx-t">${esc(title)}</span><small>${esc(caption)}</small></span>
    </li>`;
  const tempo = isNum(md.aprovacao_media_horas) ? `aprovados · em média ${fmtHoras(md.aprovacao_media_horas)} até aprovar` : 'aprovados';
  return `<ol class="gs-flow" aria-label="Fluxograma da entrada de médicos">
    ${box('gs-fs1', 'fa-user-plus', md.inscritos_periodo, 'Inscrição', 'inscritos no período, na área do médico')}
    ${box('gs-fs2', 'fa-id-card', md.pendente, 'Conferência do CRM no CFM', 'aguardando a equipe conferir CRM e identidade')}
    ${box('gs-fb2 gs-fx-no', 'fa-user-xmark', md.recusado, 'Recusado', 'não passaram na conferência', 'Ramo da conferência:')}
    ${box('gs-fs3 gs-fx-ok', 'fa-user-check', md.aprovado, 'Aprovado', tempo)}
    ${box('gs-fb3 gs-fx-warn', 'fa-ban', md.suspenso, 'Suspenso', 'aprovados e depois suspensos', 'Ramo do aprovado:')}
    ${box('gs-fs4', 'fa-user-doctor', md.disponiveis_agora, 'Disponível para atender', isNum(md.disponiveis_agora) ? 'médicos atendendo agora' : 'sem esse número no banco')}
  </ol>`;
}

// Documentos por tipo, na ordem dos tipos da teleconsulta; um tipo que o site ainda não conhece entra no fim, pelo nome.
export function docRows(porTipo) {
  const pt = obj(porTipo);
  const has = (k) => Object.prototype.hasOwnProperty.call(pt, k);
  const known = DOC_TIPOS.filter(([k]) => has(k)).map(([k, label]) => ({ label, value: num(pt[k]), cls: 'gs-c1' }));
  const extra = Object.keys(pt).filter((k) => !DOC_TIPOS.some(([x]) => x === k)).sort().map((k) => ({ label: k, value: num(pt[k]), cls: 'gs-c1' }));
  return [...known, ...extra];
}

/* ======================= cobranças ======================= */
export const isOverdue = (r, today = todaySP()) => r?.status === 'pendente' && isIsoDay(r.vencimento) && r.vencimento < today;

// Filtro da tabela: o que pedir ao banco (p_status) e quais linhas ficam na tela ("" = todas).
export const filtroStatus = (f) => (f === 'atrasada' ? 'pendente' : ['pendente', 'pago', 'cancelado'].includes(f) ? f : null);
export const noFiltro = (r, f, today = todaySP()) => (!f ? true : f === 'atrasada' ? isOverdue(r, today) : r?.status === f);
export const aplicaFiltro = (rows, f, today = todaySP()) => (Array.isArray(rows) ? rows : []).filter((r) => noFiltro(r, f, today));

// Formulário "Nova cobrança" → { ok, errors: { campo: texto }, payload } com as mesmas regras do banco.
export function validarCobranca(f = {}, today = todaySP()) {
  const errors = {};
  const tipo = String(f.tipo ?? '').trim();
  if (!TIPO_OK.has(tipo)) errors.tipo = 'Escolha o tipo da cobrança.';
  const descricao = String(f.descricao ?? '').replace(/\s+/g, ' ').trim();
  if (descricao.length < 3) errors.descricao = 'Descreva a cobrança (pelo menos 3 letras).';
  else if (descricao.length > 200) errors.descricao = 'Use até 200 letras na descrição.';
  const pagadorTipo = String(f.pagador_tipo ?? '').trim();
  if (!PAGADOR_OK.has(pagadorTipo)) errors.pagador_tipo = 'Escolha quem paga.';
  const nome = String(f.pagador_nome ?? '').replace(/\s+/g, ' ').trim();
  if (nome.length > 120) errors.pagador_nome = 'Use até 120 letras no nome.';
  const cents = parseReais(f.valor);
  if (cents === null) errors.valor = 'Informe o valor.';
  else if (Number.isNaN(cents)) errors.valor = 'Valor inválido. Use, por exemplo, 150 ou 1.234,56.';
  else if (cents < VALOR_MIN || cents > VALOR_MAX) errors.valor = 'O valor precisa ficar entre R$ 0,01 e R$ 1.000.000,00.';
  let vencimento = String(f.vencimento ?? '').trim();
  if (!vencimento) vencimento = today;
  else if (!isIsoDay(vencimento) || vencimento < '2020-01-01' || vencimento > '2099-12-31') errors.vencimento = 'Vencimento inválido: use uma data de 2020 a 2099.';
  const obs = String(f.obs ?? '').trim();
  if (obs.length > 500) errors.obs = 'Use até 500 letras na observação.';
  const ok = !Object.keys(errors).length;
  return { ok, errors, payload: ok ? { tipo, descricao, pagador_tipo: pagadorTipo, pagador_nome: nome || null, valor_cents: cents, vencimento, obs: obs || null } : null };
}

// Célula da planilha: texto que começa com = + - @ ganha um apóstrofo (a planilha não roda como fórmula);
// com ponto e vírgula, aspas ou quebra de linha vai entre aspas, com as aspas dobradas.
export function csvCell(v, { text = true } = {}) {
  let s = v === null || v === undefined ? '' : String(v);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const CSV_HEADER = ['Criada em', 'Tipo', 'Descrição', 'Quem paga', 'Nome de quem paga', 'Valor (R$)', 'Vencimento', 'Situação', 'Atrasada', 'Pago em', 'Forma de pagamento', 'Observação', 'Código'];
// Planilha das cobranças (Excel e Google Planilhas em português): ponto e vírgula, BOM do UTF-8 e quebra CRLF.
export function cobrancasCsv(rows, today = todaySP()) {
  const lines = [CSV_HEADER.map((h) => csvCell(h)).join(';')];
  for (const r of Array.isArray(rows) ? rows : []) {
    const cents = num(r?.valor_cents);
    const cells = [
      dateTimePlanilha(r.criado_em), labelOf(COB_TIPOS, r.tipo), r.descricao, labelOf(PAGADORES, r.pagador_tipo), r.pagador_nome,
      cents === null ? '' : centsPlanilha(cents), isIsoDay(r.vencimento) ? fullDay(r.vencimento) : '', labelOf(COB_STATUS, r.status),
      r.status === 'pendente' ? (isOverdue(r, today) ? 'sim' : 'não') : '', dateTimePlanilha(r.pago_em), r.forma ? labelOf(FORMAS, r.forma) : '', r.obs, r.id,
    ];
    lines.push(cells.map((v, i) => csvCell(v, { text: i !== 5 })).join(';'));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
