// Aba "Visitas" do painel.html (só a equipe do IMED): os números do contador de visitas próprio, que a função
// admin_stats do banco devolve (supabase/migrations/20261030073000_visitas.sql). Aqui ficam só regras puras e o
// HTML (testados em tests/visitas.test.mjs); quem busca os números é o painel.js.
// Contagem própria, sem cookies e sem dados pessoais: só páginas, dias e totais (veja assets/js/visitas.js).
import { EXAMS, KINDS } from './geo-core.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('pt-BR');

export const PERIODS = [[7, 'Últimos 7 dias'], [30, 'Últimos 30 dias']];

// Nome das páginas fixas, para a tabela "Páginas mais vistas".
const PAGES = {
  '/': 'Página inicial', '/perto.html': 'Perto de mim (busca)', '/local.html': 'Página de um local',
  '/conta.html': 'Minha conta', '/painel.html': 'Área da clínica', '/reivindicar.html': 'Assumir o cadastro',
  '/parceiros.html': 'Para clínicas', '/sobre.html': 'Quem somos', '/como-funciona.html': 'Como funciona',
  '/termos.html': 'Termos de uso', '/privacidade.html': 'Privacidade', '/acessibilidade.html': 'Acessibilidade',
  '/contato.html': 'Fale com o IMED', '/teleconsulta.html': 'Teleconsulta', '/medico.html': 'Área do médico',
  '/termo-teleconsulta.html': 'Termo da teleconsulta', '/404': 'Página não encontrada (404)',
  '/exames/': 'Guias de exames', '/cidades/': 'Clínicas por cidade',
};
const CITY_TYPES = { clinicas: 'Clínicas', laboratorios: 'Laboratórios', hospitais: 'Hospitais', 'diagnostico-por-imagem': 'Diagnóstico por imagem' };
const SMALL = new Set(['da', 'das', 'de', 'do', 'dos', 'e', 'd']);
// "sao-jose-dos-campos" -> "Sao Jose dos Campos" (o endereço da página não tem acento).
const unslug = (s) => s.split('-').map((w, i) => (i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

export function pageLabel(path) {
  const p = String(path ?? '');
  if (PAGES[p]) return PAGES[p];
  let m = /^\/exames\/([a-z0-9-]+)\.html$/.exec(p);
  if (m) {
    const exam = Object.values(EXAMS).find((e) => e.slug === m[1]);
    return `Guia: ${exam ? exam.n : unslug(m[1])}`;
  }
  m = /^\/cidades\/([a-z]{2})\/([a-z0-9-]+)\/(?:([a-z-]+)\.html)?$/.exec(p);
  if (m) {
    const where = `${unslug(m[2])} - ${m[1].toUpperCase()}`;
    return m[3] ? `${CITY_TYPES[m[3]] || unslug(m[3])} em ${where}` : `Cidade: ${where}`;
  }
  m = /^\/([a-z0-9-]+)\.html$/.exec(p);
  return m ? unslug(m[1]) : p;
}

// "SP/São Paulo" -> "São Paulo - SP".
export function cityLabel(detail) {
  const m = /^([A-Z]{2})\/(.+)$/.exec(String(detail ?? ''));
  return m ? `${m[2]} - ${m[1]}` : String(detail ?? '');
}
export function examLabel(code) {
  if (!code) return 'Não informado';
  if (EXAMS[code]) return EXAMS[code].n;
  return code === 'consulta' ? 'Consulta' : code === 'outro' ? 'Outro atendimento' : String(code);
}
export const kindLabel = (code) => KINDS[code]?.n || String(code ?? '');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const count = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// Resposta do banco -> números prontos para mostrar. Tolera campos faltando ou fora do formato: o que não
// é número vira 0 e os dias sem visita entram com 0 (a série sempre tem todos os dias do período).
export function normalizeStats(raw, days = 7) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const dias = Number.isInteger(Number(r.dias)) && Number(r.dias) > 0 ? Number(r.dias) : days;
  const byDay = new Map();
  for (const x of Array.isArray(r.por_dia) ? r.por_dia : []) {
    if (x && ISO.test(String(x.dia))) byDay.set(String(x.dia), (byDay.get(String(x.dia)) || 0) + count(x.visitas));
  }
  const known = [...byDay.keys()].sort();
  const ate = ISO.test(String(r.ate)) ? String(r.ate) : known[known.length - 1] || '';
  const de = ISO.test(String(r.de)) ? String(r.de) : ate ? addDays(ate, 1 - dias) : '';
  const porDia = [];
  if (de && ate && de <= ate) {
    for (let d = de, i = 0; d <= ate && i < 400; d = addDays(d, 1), i += 1) porDia.push({ dia: d, visitas: byDay.get(d) || 0 });
  }
  const rows = (list, key, value) => (Array.isArray(list) ? list : [])
    .filter((x) => x && typeof x[key] === 'string')
    .map((x) => ({ [key]: x[key], [value]: count(x[value]) }));
  const eventos = {};
  if (r.eventos && typeof r.eventos === 'object') for (const [k, v] of Object.entries(r.eventos)) eventos[k] = count(v);
  const visitas = r.visitas == null ? porDia.reduce((s, x) => s + x.visitas, 0) : count(r.visitas);
  return {
    dias, de, ate, visitas, porDia,
    paginas: rows(r.paginas, 'pagina', 'visitas'),
    exames: rows(r.exames, 'exame', 'total'),
    tipos: rows(r.tipos, 'tipo', 'total'),
    cidades: rows(r.cidades, 'cidade', 'total'),
    pedidos: rows(r.pedidos, 'exame', 'total'),
    eventos,
  };
}

// Marcas do eixo: 0 e passos "redondos" (1, 2 ou 5 vezes 10^n), com o topo cobrindo o maior valor.
export function niceTicks(max, target = 4) {
  const m = Math.max(0, Number(max) || 0);
  if (!m) return [0, 1];
  const rough = m / target;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const r = rough / mag;
  const step = Math.max(1, (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag);
  const top = Math.ceil(m / step) * step;
  const out = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v));
  return out;
}

const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' });
export const shortDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const longDay = (iso) => `${WEEKDAY.format(new Date(`${iso}T12:00:00Z`)).replace('.', '')}, ${shortDay(iso)}`;
const plural = (n, one, many) => `${fmtInt(n)} ${n === 1 ? one : many}`;

// Gráfico de colunas (visitas por dia) feito só com HTML e CSS: uma cor, linhas de grade finas, o maior dia
// com o número em cima e, ao passar o mouse, o dia e o total. Os números de todos os dias ficam na tabela abaixo.
export function chartHtml(porDia) {
  const list = Array.isArray(porDia) ? porDia : [];
  const max = list.reduce((m, x) => Math.max(m, x.visitas), 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const peak = list.findIndex((x) => x.visitas === max && max > 0);
  const n = list.length;
  // Rótulo do dia: todos até 7 dias; com mais, um por semana contando de hoje para trás.
  const showX = (i) => n <= 7 || (n - 1 - i) % 7 === 0;
  const summary = n
    ? `Visitas por dia, de ${shortDay(list[0].dia)} a ${shortDay(list[n - 1].dia)}: ${plural(list.reduce((s, x) => s + x.visitas, 0), 'visita', 'visitas')} no total${max ? `; o dia com mais foi ${shortDay(list[peak].dia)}, com ${fmtInt(max)}` : ''}.`
    : 'Sem dias no período.';
  return `<div class="vs-chart" role="img" aria-label="${esc(summary)}">
      <div class="vs-y" aria-hidden="true">${ticks.map((t) => `<span style="bottom:${(t / top) * 100}%">${fmtInt(t)}</span>`).join('')}</div>
      <div class="vs-plot" aria-hidden="true">
        ${ticks.map((t) => `<i class="vs-gl" style="bottom:${(t / top) * 100}%"></i>`).join('')}
        <ol class="vs-cols">${list.map((x, i) => `<li title="${esc(`${longDay(x.dia)}: ${plural(x.visitas, 'visita', 'visitas')}${i === n - 1 ? ' (hoje, até agora)' : ''}`)}"${i === n - 1 ? ' class="today"' : ''}>${
          x.visitas ? `<span class="vs-bar" style="height:${((x.visitas / top) * 100).toFixed(2)}%">${i === peak ? `<b class="vs-peak">${fmtInt(x.visitas)}</b>` : ''}</span>` : ''}</li>`).join('')}</ol>
      </div>
      <ol class="vs-x" aria-hidden="true">${list.map((x, i) => `<li>${showX(i) ? `<span>${i === n - 1 ? 'hoje' : shortDay(x.dia)}</span>` : ''}</li>`).join('')}</ol>
    </div>`;
}

function tableHtml(caption, head, rows, empty) {
  return `<section class="vs-box" aria-label="${esc(caption)}"><h3>${esc(caption)}</h3>
      ${rows.length ? `<table class="vs-tb"><thead><tr><th scope="col">${esc(head[0])}</th><th scope="col" class="n">${esc(head[1])}</th></tr></thead>
        <tbody>${rows.map(([label, value, sub]) => `<tr><td>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</td><td class="n">${fmtInt(value)}</td></tr>`).join('')}</tbody></table>`
    : `<p class="vs-empty">${esc(empty)}</p>`}
    </section>`;
}

// Conteúdo da aba (tudo escapado: caminhos e cidades vêm do banco).
export function statsHtml(s) {
  const ev = (k) => s.eventos[k] || 0;
  const media = s.dias ? s.visitas / s.dias : 0;
  const fmtMedia = media.toLocaleString('pt-BR', { maximumFractionDigits: media < 10 ? 1 : 0 });
  const kpi = (label, value, extra = '') => `<div class="vs-kpi"><span>${esc(label)}</span><b>${value}</b>${extra}</div>`;
  const period = s.de && s.ate ? `de ${shortDay(s.de)} a ${shortDay(s.ate)}` : '';
  return `<div class="vs-kpis">
      ${kpi('Visitas', fmtInt(s.visitas), period ? `<small>${esc(period)}</small>` : '')}
      ${kpi('Média por dia', esc(fmtMedia))}
      ${kpi('Pedidos enviados', fmtInt(ev('pedido_enviado')))}
      ${kpi('Teleconsultas iniciadas', fmtInt(ev('teleconsulta_iniciada')))}
    </div>
    <figure class="vs-fig">
      <figcaption><b>Visitas por dia</b><span>Horário de São Paulo. Hoje ainda está em andamento.</span></figcaption>
      ${s.visitas ? chartHtml(s.porDia) : '<p class="vs-empty">Ainda não há visitas contadas neste período.</p>'}
    </figure>
    <details class="vs-days"><summary>Ver os números de cada dia</summary>
      <table class="vs-tb"><thead><tr><th scope="col">Dia</th><th scope="col" class="n">Visitas</th></tr></thead>
      <tbody>${[...s.porDia].reverse().map((x, i) => `<tr><td>${esc(longDay(x.dia))}${i === 0 ? ' <small>(hoje, até agora)</small>' : ''}</td><td class="n">${fmtInt(x.visitas)}</td></tr>`).join('')}</tbody></table>
    </details>
    <div class="vs-boxes">
      ${tableHtml('Páginas mais vistas', ['Página', 'Visitas'], s.paginas.map((x) => [pageLabel(x.pagina), x.visitas, x.pagina]), 'Nenhuma visita ainda.')}
      ${tableHtml('Exames mais buscados', ['Exame', 'Buscas'], s.exames.map((x) => [examLabel(x.exame), x.total]), 'Nenhuma busca por exame ainda.')}
      ${tableHtml('Cidades mais buscadas', ['Cidade', 'Buscas'], s.cidades.map((x) => [cityLabel(x.cidade), x.total]), 'Nenhuma busca com cidade ainda.')}
      ${tableHtml('Tipos de local buscados', ['Tipo', 'Buscas'], s.tipos.map((x) => [kindLabel(x.tipo), x.total]), 'Nenhuma busca por tipo de local ainda.')}
      ${tableHtml('Pedidos enviados por exame', ['Exame', 'Pedidos'], s.pedidos.map((x) => [examLabel(x.exame), x.total]), 'Nenhum pedido enviado ainda.')}
    </div>`;
}
