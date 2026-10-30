// Painel de gestão do IMED (gestao.html): só para a equipe do IMED (is_imed_admin).
// A página em si é pública (GitHub Pages), mas não mostra nada sem a conta da equipe: os números vêm das funções do
// banco public.admin_gestao e public.admin_cobranca_*, que conferem no servidor se a conta é de administrador (sem
// isso o banco recusa com 42501). Sem login: quadro de entrar. Conta que não é da equipe: aviso e nenhuma busca de dados.
// Regras puras, gráficos em SVG, fluxograma, planilha e validação: gestao-core.js (testados em tests/gestao.test.mjs).
// Nada aqui vai para o localStorage além da sessão de login (auth.js); os números ficam só na memória da página.
import { auth, $, $$, esc, note, loading, toast, finishLogin, renderAuth, friendlyError, EXPIRED } from './clinica.js';
import * as G from './gestao-core.js';

// gen muda a cada saída da conta (ou entrada vencida): resposta que chega depois disso é ignorada.
const novaCob = (seq = 0) => ({ rows: [], filter: '', seq, loaded: false, missing: false, open: null, refocus: null, cheia: false, limite: G.LIMITE_LISTA });
const S = { days: 30, data: null, seq: 0, gen: 0, charts: new Map(), cob: novaCob() };
const app = () => $('#app');
// Banco ainda sem a função (migração não aplicada): o PostgREST responde 404 (PGRST202).
const noFn = (err) => err?.status === 404 || err?.data?.code === 'PGRST202' || err?.data?.code === '42883';
const forbidden = (err) => err?.data?.code === '42501' || err?.status === 403;
const dbMsg = (err) => (err?.data?.code === '22023' && typeof err.data.message === 'string' && err.data.message.trim() ? err.data.message.trim().slice(0, 200) : '');

/* ======================= entrada ======================= */
function renderAccount() {
  renderAuth($('#authBox'), {
    back: () => `${location.origin}${location.pathname}`,
    intro: 'Esta página é só para a <b>equipe do IMED</b>. Entre com o e-mail da equipe: enviamos um link de entrada, sem senha.',
    onSignOut: () => { reset(); renderAccount(); toast('Você saiu da sua conta.'); },
  });
}

function reset() {
  S.seq += 1; S.gen += 1; S.data = null; S.charts = new Map();
  S.cob = novaCob(S.cob.seq + 1);
  app().innerHTML = '';
  hideTip();
}

// A renovação da entrada falhou e auth.js apagou a sessão: volta para o quadro de entrar.
function lost() {
  if (auth.user()) return false;
  reset();
  $('#flash').innerHTML = note(esc(EXPIRED), 'warn');
  renderAccount();
  $('#loginEmail')?.focus();
  return true;
}

const card = (html, extra = '') => `<section class="cl-card"${extra}>${html}</section>`;
const retryBtn = (id) => `<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="${id}">Tentar de novo</button></div>`;

async function checkAdmin() {
  app().innerHTML = card(loading('Conferindo se a sua conta é da equipe do IMED…'));
  let admin = false;
  try {
    admin = (await auth.rpc('is_imed_admin')) === true;
  } catch (err) {
    if (lost()) return;
    app().innerHTML = card(`${note(esc(friendlyError(err, 'Não foi possível conferir o acesso agora. Tente de novo em instantes.')), 'err')}${retryBtn('retryAdmin')}`);
    $('#retryAdmin').onclick = checkAdmin;
    return;
  }
  // Sem sessão válida a chamada sai como visitante (e volta "não"): é entrada vencida, não falta de permissão.
  if (lost()) return;
  if (!admin) { notAdmin(); return; }
  renderShell();
}

function notAdmin() {
  reset();
  app().innerHTML = `<section class="cl-card gs-deny" aria-labelledby="denyTitle">
      <h2 id="denyTitle"><i class="fa-solid fa-lock" aria-hidden="true"></i> Esta página é só para a equipe do IMED</h2>
      <p class="cl-help">A conta com que você entrou não é da equipe do IMED, então nenhum número aparece aqui. Se você cuida de uma clínica, use a <a class="link" href="painel.html">área da clínica</a>; se é médico, a <a class="link" href="medico.html">área do médico</a>.</p>
    </section>`;
}

/* ======================= estrutura do painel ======================= */
const SECOES = [['sec-resumo', 'Resumo'], ['sec-atend', 'Atendimentos'], ['sec-fluxo', 'Fluxo do paciente'], ['sec-result', 'Resultados'],
  ['sec-medicos', 'Médicos'], ['sec-clinicas', 'Clínicas'], ['sec-cobranca', 'Faturamento e cobrança']];

function renderShell() {
  app().innerHTML = `<nav class="gs-toc" aria-label="Partes do painel">${SECOES.map(([id, n]) => `<a href="#${id}">${esc(n)}</a>`).join('')}</nav>
    <section class="cl-card gs-ctl" aria-label="Período dos números">
      <fieldset class="gs-period"><legend>Período</legend>
        <div class="gs-seg">${G.PERIODOS.map(([v, n]) => `<label><input type="radio" name="gsDias" value="${v}"${v === S.days ? ' checked' : ''}><span>${esc(n)}</span></label>`).join('')}</div>
      </fieldset>
      <button class="btn btn-ghost btn-sm" type="button" id="gsRefresh"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Atualizar números</button>
      <p class="gs-when" id="gsWhen"><span id="gsPeriodo" aria-live="polite"></span> <span id="gsHora"></span></p>
    </section>
    <div id="gsData" class="gs-app" aria-busy="true">${card(loading('Carregando os números…'))}</div>
    <section class="cl-card gs-sec" id="sec-cobranca" aria-labelledby="sec-cobranca-h">
      <h2 id="sec-cobranca-h"><i class="fa-solid fa-tags" aria-hidden="true"></i>Faturamento e cobrança</h2>
      <p class="cl-note warn gs-honest">O IMED ainda não recebe pagamentos pelo site; aqui a equipe registra as cobranças feitas por fora (Pix, cartão, boleto).</p>
      <div id="cobResumo"></div>
      <div class="gs-cobh"><h3 id="cobListaT">Cobranças</h3><a class="btn btn-ghost btn-sm" href="#cobNovaT" id="cobNovaLink"><i class="fa-solid fa-plus" aria-hidden="true"></i> Nova cobrança<span class="sr"> (vai para o formulário, depois da lista)</span></a></div>
      <div id="cobLista">${loading('Carregando as cobranças…')}</div>
      ${cobFormHtml()}
    </section>`;
  $$('input[name="gsDias"]').forEach((r) => { r.onchange = () => { S.days = Number(r.value); loadGestao(); }; });
  $('#gsRefresh').onclick = () => { loadGestao(); loadCobrancas(); };
  // Atalho "Nova cobrança": o foco vai para o título do formulário (o Tab segue para o primeiro campo), sem passar pela lista.
  $('#cobNovaLink').onclick = (e) => { e.preventDefault(); $('#cobNovaT')?.focus(); };
  wireCobForm();
  wireCobLista();
  loadGestao();
  loadCobrancas();
}

/* ======================= números (admin_gestao) ======================= */
async function loadGestao() {
  const seq = ++S.seq;
  const box = $('#gsData');
  if (!box) return;
  const busy = [box, $('#cobResumo')].filter(Boolean);
  // Trocou o período ou atualizou: os números de antes ficam (mais claros) até os novos chegarem.
  if (S.data) busy.forEach((el) => el.classList.add('gs-busy'));
  box.setAttribute('aria-busy', 'true');
  const done = () => { busy.forEach((el) => el.classList.remove('gs-busy')); box.removeAttribute('aria-busy'); };
  try {
    const raw = await auth.rpc('admin_gestao', { p_days: S.days });
    if (seq !== S.seq || !box.isConnected) return;
    S.data = G.normalizeGestao(raw, S.days);
    renderData();
    done();
  } catch (err) {
    if (seq !== S.seq || !box.isConnected) return;
    if (lost()) return;
    if (forbidden(err)) { notAdmin(); return; }
    S.data = null;
    S.charts = new Map();
    $('#cobResumo').innerHTML = '';
    setText($('#gsPeriodo'), '');
    setText($('#gsHora'), '');
    box.innerHTML = noFn(err)
      ? section('sec-resumo', 'Resumo', 'fa-list-check', note('O painel de gestão ainda não está ligado no banco. Os números aparecem aqui depois que a atualização do banco for aplicada.', 'warn'))
      : card(`${note(esc(friendlyError(err, 'Não foi possível carregar os números agora. Tente de novo em instantes.')), 'err')}${retryBtn('retryGestao')}`);
    const retry = $('#retryGestao');
    if (retry) retry.onclick = () => loadGestao();
    done();
  }
}

const periodoNome = (dias) => G.PERIODOS.find(([v]) => v === dias)?.[1] || `${dias} dias`;
const periodText = (d) => (d.de && d.ate ? `Números de ${G.fullDay(d.de)} a ${G.fullDay(d.ate)} (${periodoNome(d.dias)}), no horário de São Paulo.` : `Números dos últimos ${periodoNome(d.dias)}.`);

function renderData() {
  const d = S.data;
  const abertas = tabelasAbertas();
  S.charts = new Map();
  $('#gsData').innerHTML = [secResumo(d), secAtend(d), secFluxo(d), secResult(d), secMedicos(d), secClinicas(d)].join('');
  $('#cobResumo').innerHTML = cobResumoHtml(d);
  reabrirTabelas(abertas);
  // O período é lido pelo leitor de tela quando muda; a hora não (sem a hora do banco, não aparece: nada do relógio daqui).
  setText($('#gsPeriodo'), periodText(d));
  setText($('#gsHora'), d.gerado_em ? `Atualizado às ${G.fmtHora(d.gerado_em)}.` : '');
  drawCharts(true);
  // Com a página maior pode aparecer a barra de rolagem (a largura diminui): confere de novo no próximo quadro.
  requestAnimationFrame(() => drawCharts());
}
// Só escreve quando o texto muda (região lida pelo leitor de tela: o mesmo texto de novo seria lido de novo).
function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }
// "Ver em tabela" aberto continua aberto quando os números chegam de novo (depois de uma cobrança, do período…).
const tabelasAbertas = () => new Set($$('details[open]', app()).map((x) => x.closest('[data-fig]')?.dataset.fig).filter(Boolean));
function reabrirTabelas(abertas) {
  if (!abertas.size) return;
  for (const x of $$('#gsData details, #cobResumo details')) if (abertas.has(x.closest('[data-fig]')?.dataset.fig)) x.open = true;
}

/* ---------- peças ---------- */
const section = (id, title, icon, body) => `<section class="cl-card gs-sec" id="${id}" aria-labelledby="${id}-h">
    <h2 id="${id}-h"><i class="fa-solid ${icon}" aria-hidden="true"></i>${esc(title)}</h2>${body}</section>`;
const kpi = (label, value, sub = '', { warn = false, id = '' } = {}) => `<div class="gs-kpi${warn ? ' gs-warn' : ''}"${id ? ` data-kpi="${id}"` : ''}>
    <span class="gs-kpi-l">${warn ? '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' : ''}${esc(label)}</span><b class="gs-kpi-v">${esc(value)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
const legendHtml = (items, sq = false) => `<ul class="gs-legend" aria-label="Legenda">${items.map(([cls, label]) => `<li><span class="gs-key${sq ? ' sq' : ''} ${cls}" aria-hidden="true"></span>${esc(label)}</li>`).join('')}</ul>`;
// Tabela com os mesmos números do gráfico (a primeira coluna é o nome da linha).
const tableHtml = (caption, head, rows) => `<table class="gs-tb"><caption class="sr">${esc(caption)}</caption>
    <thead><tr>${head.map((h, i) => `<th scope="col"${i ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td class="n">${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join('')}</tr>`).join('')}</tbody></table>`;
// Gráfico: título, legenda, o desenho (feito na largura da tela) e "Ver em tabela".
function fig({ id, title, sub = '', legend = '', build, table }) {
  S.charts.set(id, build);
  return `<figure class="gs-fig" data-fig="${id}">
      <figcaption><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</figcaption>
      ${legend}
      <div class="gs-chart" data-chart="${id}"></div>
      <details class="gs-tbl"><summary>Ver em tabela<span class="sr">: ${esc(title)}</span></summary><div class="gs-tbwrap" tabindex="0" role="region" aria-label="Tabela: ${esc(title)}">${table}</div></details>
    </figure>`;
}

/* ---------- 1. resumo ---------- */
function secResumo(d) {
  const p = d.pacientes;
  const c = d.cobranca;
  return section('sec-resumo', 'Resumo', 'fa-list-check', `
    <div class="gs-kpis" id="gsKpis">
      ${kpi('Pacientes atendidos', G.fmtInt(p.atendidos), 'teleconsultas realizadas e pedidos concluídos', { id: 'atendidos' })}
      ${kpi('Pedidos de agendamento', G.fmtInt(p.pedidos.total), 'feitos no período', { id: 'pedidos' })}
      ${kpi('Teleconsultas', G.fmtInt(p.tele.total), 'pedidas no período', { id: 'tele' })}
      ${kpi('Visualizações de página', G.fmtInt(d.funil.visitas), 'páginas abertas, não pessoas', { id: 'visitas' })}
      ${kpi('Faturado', G.fmtBRL(c.faturado_cents), 'cobranças pagas no período', { id: 'faturado' })}
      ${kpi('A receber', G.fmtBRL(c.a_receber_cents), 'cobranças pendentes, de qualquer data', { id: 'receber' })}
    </div>`);
}

/* ---------- 2. atendimentos por dia ---------- */
// Um quadro de colunas para cada número (pedidos, teleconsultas pedidas e encerradas, documentos), lado a lado: com
// poucos casos por dia, colunas separadas leem melhor que linhas cruzadas. As visitas vão em outro gráfico (escala delas).
// Período longo (12 meses): cada coluna soma uma semana (365 colunas viram uma mancha no celular); a tabela fica dia a dia.
function secAtend(d) {
  const s = d.serie;
  if (!s.length) return section('sec-atend', 'Atendimentos por dia', 'fa-calendar-days', '<p class="gs-empty">Ainda não há dias para mostrar neste período.</p>');
  const days = s.map((x) => x.dia);
  const semanal = s.length > G.SEMANAL_DESDE;
  const grupos = semanal ? G.porSemana(s, G.SERIES_ATEND.map(([k]) => k)) : s;
  const cats = semanal ? grupos.map((b) => ({ label: G.shortDay(b.de), tip: G.semanaTip(b) })) : s.map((x) => ({ label: G.shortDay(x.dia), tip: G.weekDay(x.dia) }));
  const desc = [...s].reverse();
  const minis = G.SERIES_ATEND.map(([k, label]) => {
    const id = `atend-${k}`;
    const resumo = semanal ? G.resumoSemanas(label, grupos, k, d.de, d.ate) : G.resumoSerie(label, s, k, d.de, d.ate);
    S.charts.set(id, (w) => G.columnsSvg({ width: w, height: w < 520 ? 130 : 150, cats, series: [{ label, cls: 'gs-c1', values: grupos.map((x) => x[k]) }], label: resumo }));
    return `<div class="gs-mini" data-mini="${k}"><p class="gs-mini-t"><span>${esc(label)}</span><b>${esc(G.fmtInt(G.somaSerie(s, k)))}<small> no período</small></b></p><div class="gs-chart" data-chart="${id}"></div></div>`;
  }).join('');
  const [titulo, ajuda] = semanal
    ? ['Pedidos, teleconsultas e documentos por semana', 'Período longo: cada coluna soma uma semana (a mais antiga leva os dias que sobram) e a tabela mostra dia a dia. Horário de São Paulo. Cada quadro tem a sua escala. Passe o mouse ou toque numa coluna para ver o número da semana.']
    : ['Pedidos, teleconsultas e documentos por dia', 'Horário de São Paulo. Cada quadro tem a sua escala. Passe o mouse ou toque numa coluna para ver o número do dia.'];
  const atend = `<figure class="gs-fig" data-fig="atend">
      <figcaption><b>${esc(titulo)}</b><span>${esc(ajuda)}</span></figcaption>
      <div class="gs-multi">${minis}</div>
      <details class="gs-tbl"><summary>Ver em tabela<span class="sr">: atendimentos por dia</span></summary><div class="gs-tbwrap" tabindex="0" role="region" aria-label="Tabela: atendimentos por dia">${
  tableHtml('Atendimentos por dia', ['Dia', ...G.SERIES_ATEND.map(([, l]) => l)], desc.map((x) => [G.weekDay(x.dia), ...G.SERIES_ATEND.map(([k]) => G.fmtInt(x[k]))]))}</div></details>
    </figure>`;
  const vis = fig({
    id: 'visitas', title: 'Visualizações de página por dia',
    sub: 'Num gráfico separado porque são muito mais que os pedidos. Contagem própria, sem cookies: cada página aberta soma 1 (não é pessoa única).',
    build: (w) => G.lineSvg({ width: w, height: w < 520 ? 170 : 200, days, series: [{ label: 'Visualizações', cls: 'gs-c1', values: s.map((x) => x.visitas) }], label: G.resumoVisitas(s, d.de, d.ate), area: true, peak: true }),
    table: tableHtml('Visualizações de página por dia', ['Dia', 'Visualizações'], desc.map((x) => [G.weekDay(x.dia), G.fmtInt(x.visitas)])),
  });
  return section('sec-atend', 'Atendimentos por dia', 'fa-calendar-days', atend + vis);
}

/* ---------- 3. fluxo do paciente ---------- */
function funnelFig(id, title, defs, d) {
  const steps = G.funnel(defs.map(([key, label]) => ({ key, label, value: d.funil[key] })));
  const max = Math.max(0, ...steps.map((x) => x.value).filter(G.isNum));
  const rows = steps.map((x, i) => ({ label: x.label, value: x.value, extra: i ? G.fmtPct(x.pctPrev) : '', cls: `gs-o${i + 1}` }));
  return fig({
    id, title, sub: 'Número de cada etapa; ao lado, a % sobre a etapa anterior.',
    build: (w) => G.hbarsSvg({ width: w, rows, max, label: G.resumoFunil(title, steps) }),
    table: tableHtml(title, ['Etapa', 'Número', '% da etapa anterior', '% da primeira etapa'], steps.map((x, i) => [x.label, G.fmtInt(x.value), i ? G.fmtPct(x.pctPrev) : G.DASH, G.fmtPct(x.pctFirst)])),
  });
}
function secFluxo(d) {
  return section('sec-fluxo', 'Fluxo do paciente', 'fa-route', `
    <p class="gs-one"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>Visualização não é pessoa única: cada página aberta conta 1, a mesma pessoa pode abrir várias vezes e quem chega pelo Google pula etapas (por isso a % pode passar de 100%).</span></p>
    <div class="gs-two">${funnelFig('funil-agenda', 'Agendamento: da busca ao atendimento', G.FUNIL_AGENDA, d)}${funnelFig('funil-tele', 'Teleconsulta: da página ao documento', G.FUNIL_TELE, d)}</div>`);
}

/* ---------- 4. resultados ---------- */
function statusFig(id, title, defs, counts, total) {
  const rows = defs.map(([k, label]) => ({ label, value: counts[k], extra: G.isNum(counts[k]) && G.isNum(total) && total > 0 ? G.fmtPct(G.pct(counts[k], total)) : '', cls: 'gs-c1' }));
  return fig({
    id, title, sub: `${G.fmtInt(total)} no total; ao lado, a parte de cada situação.`,
    build: (w) => G.hbarsSvg({ width: w, rows, max: G.isNum(total) && total > 0 ? total : null, label: G.resumoBarras(title, rows) }),
    table: tableHtml(title, ['Situação', 'Número', '% do total'], rows.map((r) => [r.label, G.fmtInt(r.value), r.extra || G.DASH])),
  });
}
function secResult(d) {
  const p = d.pacientes;
  const dc = p.documentos;
  const docRows = G.docRows(dc.por_tipo);
  // O banco manda os 7 tipos (zero quando não houve): sem nenhum documento, um aviso no lugar de 7 barras vazias.
  const docs = docRows.some((r) => G.isNum(r.value) && r.value > 0)
    ? fig({
      id: 'docs', title: 'Documentos emitidos por tipo',
      sub: `${G.fmtInt(dc.total)} no total · ${G.plural(dc.cancelados, 'cancelado', 'cancelados')} · ${G.fmtInt(dc.pdf_assinado)} com o PDF assinado enviado.`,
      build: (w) => G.hbarsSvg({ width: w, rows: docRows, label: G.resumoBarras('Documentos emitidos por tipo', docRows) }),
      table: tableHtml('Documentos emitidos por tipo', ['Tipo', 'Documentos'], docRows.map((r) => [r.label, G.fmtInt(r.value)])),
    })
    : `<div class="gs-fig" data-fig="docs"><h3 class="gs-fig-h">Documentos emitidos</h3><p class="gs-empty">${dc.total === 0 ? 'Nenhum documento emitido no período.' : G.isNum(dc.total) ? `${G.fmtInt(dc.total)} no total, sem a divisão por tipo.` : 'Sem o número de documentos.'}</p></div>`;
  const av = p.avaliacoes;
  const aval = G.isNum(av.total) && av.total > 0
    ? `<div class="gs-kpis">${kpi('Avaliações', G.fmtInt(av.total), 'no período', { id: 'aval' })}${kpi('Nota média', G.fmtNota(av.media), 'de 1 a 5 estrelas', { id: 'nota' })}</div>`
    : `<p class="gs-empty">${av.total === 0 ? 'Nenhuma avaliação no período.' : 'Sem o número de avaliações.'}</p>`;
  return section('sec-result', 'Resultados dos atendimentos', 'fa-circle-check', `
    <div class="gs-two">${statusFig('st-pedidos', 'Situação dos pedidos de agendamento', G.PEDIDO_STATUS, p.pedidos, p.pedidos.total)}${statusFig('st-tele', 'Situação das teleconsultas', G.TELE_STATUS, p.tele, p.tele.total)}</div>
    <div class="gs-kpis">
      ${kpi('Espera média na fila', G.fmtMin(p.tele.espera_media_min), 'teleconsulta: do pedido até o médico aceitar', { id: 'espera' })}
      ${kpi('Duração média da consulta', G.fmtMin(p.tele.duracao_media_min), 'teleconsulta: do início ao fim', { id: 'duracao' })}
      ${kpi('Pedidos para parceiros', G.fmtInt(p.pedidos.parceiro), 'a clínica parceira responde', { id: 'parceiro' })}
      ${kpi('Pedidos pelo IMED (concierge)', G.fmtInt(p.pedidos.concierge), 'a equipe do IMED liga e marca', { id: 'concierge' })}
    </div>
    <div class="gs-two">${docs}<div class="gs-fig" data-fig="avaliacoes"><h3 class="gs-fig-h">Avaliações dos pacientes</h3>${aval}</div></div>`);
}

/* ---------- 5. entrada de médicos ---------- */
function secMedicos(d) {
  const m = d.medicos;
  const list = m.aguardando;
  // Sem o número do banco: "—" (a lista vem cortada em 50; o tamanho dela não é o total).
  const total = m.pendente;
  const item = (x) => {
    const crm = x.crm ? `CRM-${x.uf || '?'} ${x.crm}` : 'CRM não informado';
    const nome = x.nome || 'Nome não informado';
    return `<li class="rq gs-wait" data-medico="${esc(x.id)}">
        <div class="rq-hd"><div><h4>${esc(nome)}</h4><small>${esc([crm, x.especialidade].filter(Boolean).join(' · '))}</small></div><span class="rq-st st-pending">Aguardando conferência</span></div>
        <p class="gs-since">${x.desde ? `Inscrição em ${esc(G.fmtDateTime(x.desde))} (${esc(G.sinceText(x.desde))})` : 'Data da inscrição não informada'}</p>
        <div class="rq-act">
          <a class="btn btn-ghost btn-sm" href="${G.CFM_URL}" target="_blank" rel="noopener"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> Conferir no CFM<span class="sr"> o ${esc(crm)} de ${esc(nome)} (abre em outra aba)</span></a>
          <a class="btn btn-primary btn-sm" href="medico.html#adminCard"><i class="fa-solid fa-user-check" aria-hidden="true"></i> Abrir na área do médico<span class="sr"> para conferir ${esc(nome)}</span></a>
        </div>
      </li>`;
  };
  return section('sec-medicos', 'Entrada de médicos', 'fa-user-doctor', `
    <p class="cl-help">Como um médico começa a atender pelo IMED: ele se inscreve na <a href="medico.html">área do médico</a>, a equipe confere o CRM na busca de médicos do CFM e a identidade dele, e só depois de aprovado ele pode ficar disponível para atender. Os números são de agora; a inscrição conta as do período.</p>
    ${G.fluxoMedicosHtml(m)}
    <h3 id="gsAgT">Aguardando conferência (${esc(G.fmtInt(total))})</h3>
    ${list.length ? `<p class="cl-help">Os mais antigos primeiro. Confira o CRM na busca de médicos do CFM e aprove na área do médico, onde ficam a identidade e a conferência completa.${G.isNum(total) && total > list.length ? ` Mostrando os ${list.length} mais antigos.` : ''}</p>
      <ul class="rq-list" id="gsAguardando" aria-labelledby="gsAgT">${list.map(item).join('')}</ul>`
    : '<p class="gs-empty" id="gsAguardando">Nenhum médico aguardando conferência.</p>'}`);
}

/* ---------- 6. entrada de clínicas ---------- */
function secClinicas(d) {
  const c = d.clinicas;
  const r = c.reivindicacoes;
  const o = d.outros;
  return section('sec-clinicas', 'Entrada de clínicas', 'fa-hospital', `
    <div class="gs-kpis">
      ${kpi('Parceiras ativas', G.fmtInt(c.parceiras), 'publicadas no IMED, hoje', { id: 'parceiras' })}
      ${kpi('Com agenda pelo site', G.fmtInt(c.com_agenda), 'o paciente marca o horário direto', { id: 'agenda' })}
      ${kpi('Com preço informado', G.fmtInt(c.com_preco), 'pelo menos 1 exame com preço', { id: 'preco' })}
      ${kpi('Interessadas', G.fmtInt(c.interessadas), 'formulário “Para clínicas”, no período', { id: 'interessadas' })}
    </div>
    <h3>Pedidos para assumir o cadastro <small class="gs-h3s">(todos, pela situação de hoje)</small></h3>
    <div class="gs-kpis">
      ${kpi('Em análise', G.fmtInt(r.pendente), 'esperando a conferência da equipe', { warn: G.isNum(r.pendente) && r.pendente > 0, id: 'reiv-pendente' })}
      ${kpi('Aprovados', G.fmtInt(r.aprovado), 'viraram parceiras', { id: 'reiv-aprovado' })}
      ${kpi('Recusados', G.fmtInt(r.recusado), '', { id: 'reiv-recusado' })}
    </div>
    <div class="cl-actions"><a class="btn btn-ghost btn-sm" href="painel.html"><i class="fa-solid fa-building-circle-check" aria-hidden="true"></i> Conferir os pedidos na área da clínica</a></div>
    <h3>Outros <small class="gs-h3s">(no período)</small></h3>
    <div class="gs-kpis">
      ${kpi('Lista de espera do aplicativo', G.fmtInt(o.lista_espera), '', { id: 'espera-app' })}
      ${kpi('Mensagens do Fale com o IMED', G.fmtInt(o.contatos), 'responda pela área da clínica', { id: 'contatos' })}
      ${kpi('Avisos de erro', G.fmtInt(o.avisos_de_erro), '“Algo errado? Avise” nas páginas', { id: 'avisos' })}
    </div>`);
}

/* ---------- 7. faturamento (totais e meses) ---------- */
function cobResumoHtml(d) {
  const c = d.cobranca;
  const pm = c.por_mes;
  const late = G.isNum(c.atrasado_cents) && c.atrasado_cents > 0;
  const reais = (v) => (G.isNum(v) ? v / 100 : null);
  const meses = pm.length ? fig({
    id: 'meses', title: 'Faturamento por mês (últimos 12 meses)', sub: 'Faturado: pagas no mês (pelo dia do pagamento). A receber: pendentes que vencem no mês.',
    legend: legendHtml([['gs-c1', 'Faturado'], ['gs-c2', 'A receber']], true),
    build: (w) => G.columnsSvg({
      width: w, height: w < 520 ? 190 : 220, cats: pm.map((x) => ({ label: G.monthLabel(x.mes), tip: G.monthLong(x.mes) })),
      series: [{ label: 'Faturado', cls: 'gs-c1', values: pm.map((x) => reais(x.faturado_cents)) }, { label: 'A receber', cls: 'gs-c2', values: pm.map((x) => reais(x.a_receber_cents)) }],
      label: G.resumoMeses(pm), fmt: (v) => G.fmtBRL(G.isNum(v) ? Math.round(v * 100) : null), tickFmt: G.fmtBRLCurto,
    }),
    table: tableHtml('Faturamento por mês', ['Mês', 'Faturado', 'A receber'], [...pm].reverse().map((x) => [G.monthLong(x.mes), G.fmtBRL(x.faturado_cents), G.fmtBRL(x.a_receber_cents)])),
  }) : '<p class="gs-empty">Ainda não há cobranças nos últimos 12 meses.</p>';
  return `<div class="gs-kpis" id="cobKpis">
      ${kpi('Faturado', G.fmtBRL(c.faturado_cents), `${G.plural(c.qtd_pagas, 'cobrança paga', 'cobranças pagas')} no período`, { id: 'cob-faturado' })}
      ${kpi('A receber', G.fmtBRL(c.a_receber_cents), G.plural(c.qtd_pendentes, 'cobrança pendente', 'cobranças pendentes'), { id: 'cob-receber' })}
      ${kpi('Atrasado', G.fmtBRL(c.atrasado_cents), 'pendentes com vencimento antes de hoje', { warn: late, id: 'cob-atrasado' })}
    </div>
    ${G.isNum(c.cancelado_cents) && c.cancelado_cents > 0 ? `<p class="gs-empty gs-canc">Canceladas, de qualquer data: ${esc(G.fmtBRL(c.cancelado_cents))} (não entram no faturado nem no a receber).</p>` : ''}
    <div class="gs-stack">${meses}</div>`;
}

/* ======================= gráficos: desenho na largura certa e balão ======================= */
// Cada gráfico é desenhado na largura do lugar dele (o texto fica sempre do mesmo tamanho, no computador e no
// celular). Ao mudar a largura da janela, desenha de novo.
function drawCharts(force = false) {
  for (const el of $$('[data-chart]')) {
    const build = S.charts.get(el.dataset.chart);
    if (!build) continue;
    const w = Math.round(el.clientWidth) || 600;
    if (!force && el.dataset.w === String(w)) continue;
    el.dataset.w = String(w);
    el.innerHTML = build(w);
  }
}
let resizeTimer;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => drawCharts(), 150); });

// Balão dos gráficos: mostra os números do dia (ou da barra) sob o mouse ou o dedo. Só ajuda: os mesmos números
// estão em "Ver em tabela".
let tipOn = null;
function hideTip() {
  tipOn?.classList.remove('on');
  tipOn = null;
  const tip = $('#gsTip');
  if (tip) tip.hidden = true;
}
function showTip(el, x, y) {
  const tip = $('#gsTip');
  if (!tip) return;
  if (tipOn !== el) {
    tipOn?.classList.remove('on');
    tipOn = el;
    el.classList.add('on');
    tip.textContent = el.getAttribute('data-tip') || '';
    tip.hidden = false;
  }
  const r = tip.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + r.width > innerWidth - 8) left = Math.max(8, x - r.width - 14);
  if (top + r.height > innerHeight - 8) top = Math.max(8, y - r.height - 14);
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}
function initTips() {
  const tipOf = (e) => { const el = e.target?.closest?.('[data-tip]'); return el && app()?.contains(el) ? el : null; };
  document.addEventListener('pointermove', (e) => { const el = tipOf(e); if (el) showTip(el, e.clientX, e.clientY); else if (tipOn) hideTip(); }, { passive: true });
  document.addEventListener('pointerdown', (e) => { const el = tipOf(e); if (el) showTip(el, e.clientX, e.clientY); else hideTip(); }, { passive: true });
  document.documentElement.addEventListener('pointerleave', hideTip);
  addEventListener('scroll', hideTip, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
}

/* ======================= cobranças ======================= */
async function loadCobrancas() {
  const box = $('#cobLista');
  if (!box) return;
  const seq = ++S.cob.seq;
  const f = S.cob.filter;
  const limite = G.limiteCobrancas(f);
  if (S.cob.loaded) { box.classList.add('gs-busy'); box.setAttribute('aria-busy', 'true'); } else box.innerHTML = loading('Carregando as cobranças…');
  const done = () => { box.classList.remove('gs-busy'); box.removeAttribute('aria-busy'); };
  try {
    const rows = await auth.rpc('admin_cobranca_listar', { p_status: G.filtroStatus(f), p_limite: limite });
    if (seq !== S.cob.seq || !box.isConnected) return;
    S.cob.rows = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object' && r.id !== undefined && r.id !== null);
    S.cob.loaded = true;
    S.cob.missing = false;
    S.cob.limite = limite;
    S.cob.cheia = S.cob.rows.length >= limite; // veio cheia: pode haver mais antigas no banco
    formVisivel(true);
    renderCobLista();
    done();
  } catch (err) {
    if (seq !== S.cob.seq || !box.isConnected) return;
    if (lost()) return;
    if (forbidden(err)) { notAdmin(); return; }
    done();
    if (noFn(err)) {
      S.cob.missing = true;
      S.cob.loaded = false;
      box.innerHTML = note('A cobrança ainda não está ligada no banco. A lista e o formulário “Nova cobrança” aparecem aqui depois que a atualização do banco for aplicada.', 'warn');
      formVisivel(false);
      return;
    }
    S.cob.refocus = null;
    box.innerHTML = `${note(esc(friendlyError(err, 'Não foi possível carregar as cobranças agora. Tente de novo em instantes.')), 'err')}${retryBtn('retryCob')}`;
  }
}
// O formulário "Nova cobrança" e o atalho para ele só aparecem com a cobrança ligada no banco.
function formVisivel(on) {
  $('#cobForm').hidden = !on;
  $('#cobNovaLink').hidden = !on;
}

const cobDesc = (r) => (r.descricao ? String(r.descricao) : 'sem descrição');
const STATUS_CLS = { pendente: 'st-pending', pago: 'st-confirmed', cancelado: 'st-cancelled' };

// Ações de cada cobrança. Marcar como pago, cancelar e voltar para pendente mexem no dinheiro: as três abrem um quadro de
// confirmação (com o que vai acontecer) antes de chamar o banco. Erro do banco aparece dentro do quadro.
function cobActions(r) {
  const id = esc(r.id);
  const desc = esc(cobDesc(r));
  const open = S.cob.open && S.cob.open.id === String(r.id) ? S.cob.open.kind : null;
  const voltar = `<button class="btn btn-ghost btn-sm" type="button" data-back="${id}">Voltar</button>`;
  const erro = `<div class="gs-acterr" id="acterr-${id}"></div>`;
  if (open === 'pay') {
    const hoje = G.todaySP();
    return `<div class="gs-pay" id="pay-${id}">
        <label class="cl-lbl" for="forma-${id}">Forma de pagamento</label>
        <select id="forma-${id}" aria-required="true" aria-describedby="forma-${id}-err"><option value="">Escolha</option>${G.FORMAS.map(([v, n]) => `<option value="${v}">${esc(n)}</option>`).join('')}</select>
        <span class="cl-err" id="forma-${id}-err"></span>
        <label class="cl-lbl" for="pagoem-${id}">Pago em</label>
        <input id="pagoem-${id}" type="date" value="${hoje}" min="2020-01-01" max="${hoje}" aria-describedby="pagoem-${id}-hint pagoem-${id}-err">
        <span class="cl-hint" id="pagoem-${id}-hint">O dia em que o dinheiro entrou: a cobrança entra no faturado desse dia.</span>
        <span class="cl-err" id="pagoem-${id}-err"></span>
        <div class="cl-row"><button class="btn btn-primary btn-sm" type="button" data-confirm-pay="${id}">Confirmar pagamento</button>${voltar}</div>
        ${erro}
      </div>`;
  }
  if (open === 'cancel') {
    return `<div class="gs-pay" id="cancel-${id}">
        <p id="cancel-${id}-txt">Cancelar a cobrança de ${esc(G.fmtBRL(G.num(r.valor_cents)))}? Ela sai do “a receber”.</p>
        <div class="cl-row"><button class="btn btn-danger btn-sm" type="button" data-confirm-cancel="${id}" aria-describedby="cancel-${id}-txt">Confirmar cancelamento</button>${voltar}</div>
        ${erro}
      </div>`;
  }
  if (open === 'reopen') {
    return `<div class="gs-pay" id="reopen-${id}">
        <p id="reopen-${id}-txt">${esc(G.avisoReabrir(r))}</p>
        <div class="cl-row"><button class="btn ${r.status === 'pago' ? 'btn-danger' : 'btn-primary'} btn-sm" type="button" data-confirm-reopen="${id}" aria-describedby="reopen-${id}-txt">Confirmar: voltar para pendente</button>${voltar}</div>
        ${erro}
      </div>`;
  }
  if (r.status === 'pendente') {
    return `<div class="gs-acts"><button class="btn btn-primary btn-sm" type="button" data-pay="${id}"><i class="fa-solid fa-check" aria-hidden="true"></i> Marcar como pago<span class="sr">: ${desc}</span></button>
      <button class="btn btn-danger btn-sm" type="button" data-cancel="${id}"><i class="fa-solid fa-xmark" aria-hidden="true"></i> Cancelar<span class="sr"> a cobrança ${desc}</span></button></div>`;
  }
  return `<div class="gs-acts"><button class="btn btn-ghost btn-sm" type="button" data-reopen="${id}"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Voltar para pendente<span class="sr">: ${desc}</span></button></div>`;
}

function cobRow(r, today) {
  const id = esc(r.id);
  const late = G.isOverdue(r, today);
  const st = r.status;
  const cell = (label, html, cls = '', attrs = '') => `<td role="cell" data-label="${label}"${cls ? ` class="${cls}"` : ''}><div${attrs}>${html}</div></td>`;
  // Data e forma de pagamento só na paga (o banco guarda a forma depois de voltar para pendente ou cancelar).
  const paid = st === 'pago' && (r.pago_em || r.forma) ? `<small>${[r.pago_em ? `em ${esc(G.fmtPagoEm(r.pago_em))}` : '', r.forma ? esc(G.labelOf(G.FORMAS, r.forma)) : ''].filter(Boolean).join(' · ')}</small>` : '';
  return `<tr role="row" id="cob-${id}" data-id="${id}"${late ? ' class="gs-late"' : ''}>
      ${cell('Criada em', esc(G.fmtDateTime(r.criado_em)))}
      ${cell('Cobrança', `<b>${esc(cobDesc(r))}</b><small>${esc(G.labelOf(G.COB_TIPOS, r.tipo))}</small>${r.obs ? `<small class="gs-obs">Obs.: ${esc(r.obs)}</small>` : ''}`)}
      ${cell('Quem paga', `${esc(G.labelOf(G.PAGADORES, r.pagador_tipo))}${r.pagador_nome ? `<small>${esc(r.pagador_nome)}</small>` : ''}`)}
      ${cell('Valor', esc(G.fmtBRL(G.num(r.valor_cents))), 'n')}
      ${cell('Vencimento', `${esc(G.fullDay(r.vencimento))}${late ? '<span class="bd bd-err">Atrasada</span>' : ''}`)}
      ${cell('Situação', `<span class="rq-st ${STATUS_CLS[st] || 'st-completed'}">${esc(G.labelOf(G.COB_STATUS, st))}</span>${paid}`, '', ` id="st-${id}" class="gs-st" tabindex="-1"`)}
      ${cell('Ações', cobActions(r))}
    </tr>`;
}

function renderCobLista() {
  const box = $('#cobLista');
  if (!box) return;
  const today = G.todaySP();
  const f = S.cob.filter;
  const rows = G.aplicaFiltro(S.cob.rows, f, today);
  const head = ['Criada em', 'Cobrança', 'Quem paga', 'Valor', 'Vencimento', 'Situação', 'Ações'];
  // Lista que veio cheia: avisa que pode haver mais antigas fora dela (e da planilha).
  const cheia = !S.cob.cheia ? '' : f === 'atrasada'
    ? ` <b>Atenção:</b> vieram só as ${esc(G.fmtInt(S.cob.limite))} pendentes mais novas; pode haver atrasadas mais antigas fora da lista e da planilha.`
    : ` <b>Atenção:</b> vieram só as ${esc(G.fmtInt(S.cob.limite))} mais novas; pode haver mais antigas fora da lista e da planilha.`;
  box.innerHTML = `<div class="cl-filter gs-cobbar">
      <label class="cl-lbl" for="cobFiltro" style="margin:0">Mostrar</label>
      <select id="cobFiltro">${G.COB_FILTROS.map(([v, n]) => `<option value="${v}"${v === f ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <button class="btn btn-ghost btn-sm" type="button" id="cobAtualizar"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Atualizar lista</button>
      <button class="btn btn-ghost btn-sm" type="button" id="cobCsv"${rows.length ? '' : ' disabled'}><i class="fa-solid fa-download" aria-hidden="true"></i> Baixar planilha (CSV)</button>
    </div>
    <p class="cl-help" id="cobConta">${rows.length ? `${esc(G.plural(rows.length, 'cobrança', 'cobranças'))}${f ? ` (${esc(G.labelOf(G.COB_FILTROS, f).toLowerCase())})` : ''}. ` : ''}A lista não depende do período: as mais novas primeiro.${cheia}</p>
    ${rows.length ? `<div class="gs-tbwrap"><table class="gs-tb gs-cob" role="table"><caption class="sr">Cobranças: ${esc(G.labelOf(G.COB_FILTROS, f).toLowerCase())}</caption>
        <thead role="rowgroup"><tr role="row">${head.map((h, i) => `<th role="columnheader" scope="col"${i === 3 ? ' class="n"' : ''}>${h}</th>`).join('')}</tr></thead>
        <tbody role="rowgroup">${rows.map((r) => cobRow(r, today)).join('')}</tbody></table></div>`
    : `<p class="gs-empty" id="cobVazia">${f ? 'Nenhuma cobrança com essa situação.' : 'Ainda não há cobranças registradas.'}</p>`}`;
  if (S.cob.refocus) { ($(S.cob.refocus, box) || $('#cobFiltro', box))?.focus(); S.cob.refocus = null; }
}

// Erro de um campo do quadro de pagamento (texto embaixo do campo e o campo marcado).
function campoErro(el, msg) {
  const out = document.getElementById(`${el.id}-err`);
  if (out) out.textContent = msg || '';
  if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
}

// Lista das cobranças: filtro, atualizar, planilha e as ações de cada uma (marcar como paga, cancelar, voltar para pendente).
function wireCobLista() {
  const box = $('#cobLista');
  box.addEventListener('change', (e) => {
    if (e.target.id !== 'cobFiltro') return;
    S.cob.filter = G.COB_FILTROS.some(([v]) => v === e.target.value) ? e.target.value : '';
    S.cob.open = null;
    S.cob.refocus = '#cobFiltro';
    loadCobrancas();
  });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !box.contains(b)) return;
    const sel = (attr, id) => $(`[${attr}="${CSS.escape(id)}"]`, box);
    if (b.id === 'retryCob' || b.id === 'cobAtualizar') { S.cob.open = null; S.cob.refocus = b.id === 'cobAtualizar' ? '#cobAtualizar' : null; loadCobrancas(); return; }
    if (b.id === 'cobCsv') { baixarCsv(); return; }
    // Abre o quadro de confirmação: pagamento (foco na forma), cancelamento ou voltar para pendente (foco no botão de
    // confirmar, que lê o aviso junto).
    const abrir = b.dataset.pay ? 'pay' : b.dataset.cancel ? 'cancel' : b.dataset.reopen ? 'reopen' : null;
    if (abrir) {
      const id = b.dataset.pay || b.dataset.cancel || b.dataset.reopen;
      S.cob.open = { id, kind: abrir };
      renderCobLista();
      (abrir === 'pay' ? $(`#forma-${CSS.escape(id)}`, box) : sel(abrir === 'cancel' ? 'data-confirm-cancel' : 'data-confirm-reopen', id))?.focus();
      return;
    }
    if (b.dataset.back) {
      const id = b.dataset.back;
      const kind = S.cob.open?.kind;
      S.cob.open = null;
      renderCobLista();
      sel(kind === 'cancel' ? 'data-cancel' : kind === 'reopen' ? 'data-reopen' : 'data-pay', id)?.focus();
      return;
    }
    if (b.dataset.confirmPay) {
      const id = b.dataset.confirmPay;
      const forma = $(`#forma-${CSS.escape(id)}`, box);
      const data = $(`#pagoem-${CSS.escape(id)}`, box);
      const v = G.validarPagamento({ forma: forma.value, pago_em: data.value }, G.todaySP());
      campoErro(forma, v.errors.forma);
      campoErro(data, v.errors.pago_em);
      if (!v.ok) { (v.errors.forma ? forma : data).focus(); return; }
      await setStatus(id, 'pago', b, { forma: v.forma, pagoEm: v.pagoEm });
      return;
    }
    if (b.dataset.confirmCancel) { await setStatus(b.dataset.confirmCancel, 'cancelado', b); return; }
    if (b.dataset.confirmReopen) await setStatus(b.dataset.confirmReopen, 'pendente', b);
  });
}

async function setStatus(id, status, btn, { forma = null, pagoEm = null } = {}) {
  const r = S.cob.rows.find((x) => String(x.id) === id);
  if (!r) return;
  const gen = S.gen;
  const group = btn.closest('.gs-pay, .gs-acts');
  const btns = group ? $$('button', group) : [btn];
  btns.forEach((x) => { x.disabled = true; });
  const errBox = () => $(`#acterr-${CSS.escape(id)}`);
  if (errBox()) errBox().innerHTML = '';
  try {
    // Pago noutro dia: admin_cobranca_salvar grava o dia informado. Hoje: admin_cobranca_status grava a hora de agora.
    const res = pagoEm
      ? await auth.rpc('admin_cobranca_salvar', { p: { id, status: 'pago', forma, pago_em: pagoEm } })
      : await auth.rpc('admin_cobranca_status', { p_id: id, p_status: status, p_forma: forma });
    if (gen !== S.gen) return; // saiu da conta enquanto salvava
    const upd = res && typeof res === 'object' && String(res.id) === id ? res : null;
    const nome = `“${cobDesc(upd || r)}”`;
    const text = status === 'pago' ? `Cobrança ${nome} marcada como paga${pagoEm ? ` em ${G.fullDay(pagoEm)}` : ''} (${G.labelOf(G.FORMAS, upd?.forma || forma)}).`
      : status === 'cancelado' ? `Cobrança ${nome} cancelada.` : `Cobrança ${nome} voltou para pendente.`;
    S.cob.open = null;
    if (!upd) {
      // O banco não devolveu a cobrança: busca a lista de novo (nada de montar a data do pagamento com o relógio daqui).
      S.cob.refocus = `#st-${CSS.escape(id)}`;
      loadCobrancas();
      toast(text);
      loadGestao();
      return;
    }
    // Fica na lista aberta só se ainda combinar com o filtro.
    const i = S.cob.rows.indexOf(r);
    const fica = G.noFiltro(upd, S.cob.filter, G.todaySP());
    if (i >= 0) { if (fica) S.cob.rows[i] = upd; else S.cob.rows.splice(i, 1); }
    renderCobLista();
    // Um aviso só: o balão no alto da tela (o leitor de tela também lê). O foco vai para a situação da cobrança, nunca
    // para um botão que mexe no dinheiro (dois Enter seguidos não desfazem nada).
    toast(`${text}${fica ? '' : ' Ela saiu desta lista por causa do filtro.'}`);
    ($(`#st-${CSS.escape(id)}`) || $('#cobFiltro'))?.focus();
    loadGestao(); // os totais (faturado, a receber, atrasado) mudam
  } catch (err) {
    if (gen !== S.gen) return;
    if (lost()) return;
    // Sem permissão (a conta deixou de ser da equipe): some tudo, como ao abrir a página.
    if (forbidden(err)) { notAdmin(); return; }
    btns.forEach((x) => { x.disabled = false; });
    const msg = dbMsg(err) || (noFn(err) ? 'A cobrança ainda não está ligada no banco.' : friendlyError(err, 'Não foi possível salvar agora. Tente de novo em instantes.'));
    if (errBox()) errBox().innerHTML = note(esc(msg), 'err'); else toast(msg);
    if (btn.isConnected && (!document.activeElement || document.activeElement === document.body)) btn.focus();
  }
}

function baixarCsv() {
  const today = G.todaySP();
  const rows = G.aplicaFiltro(S.cob.rows, S.cob.filter, today);
  if (!rows.length) return;
  const url = URL.createObjectURL(new Blob([G.cobrancasCsv(rows, today)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `imed-cobrancas-${today}${S.cob.filter ? `-${S.cob.filter}` : ''}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Planilha com ${G.plural(rows.length, 'cobrança', 'cobranças')} baixada${S.cob.cheia ? ': só as da lista (pode haver mais antigas)' : ''}.`);
}

/* ---------- nova cobrança ---------- */
const CAMPOS = [['tipo', 'cTipo'], ['pagador_tipo', 'cPag'], ['descricao', 'cDesc'], ['pagador_nome', 'cNome'], ['valor', 'cValor'], ['vencimento', 'cVenc'], ['obs', 'cObs']];
function cobFormHtml() {
  const opt = (list) => `<option value="">Escolha</option>${list.map(([v, n]) => `<option value="${v}">${esc(n)}</option>`).join('')}`;
  const help = (id, text) => `<span class="cl-hint" id="${id}Hint">${text}</span>`;
  const err = (id) => `<span class="cl-err" id="${id}Err"></span>`;
  // Obrigatórios: tipo, quem paga, descrição e valor (aria-required; os opcionais dizem "opcional" no nome).
  return `<form id="cobForm" class="gs-new" novalidate aria-labelledby="cobNovaT">
      <h3 id="cobNovaT" tabindex="-1">Nova cobrança</h3>
      <p class="cl-help">Registre aqui uma cobrança feita por fora do site. Ela entra como pendente; quando o pagamento chegar, use “Marcar como pago” na lista.</p>
      <div class="cl-grid">
        <div class="cl-field"><label class="cl-lbl" for="cTipo">Tipo</label><select id="cTipo" aria-required="true" aria-describedby="cTipoErr">${opt(G.COB_TIPOS)}</select>${err('cTipo')}</div>
        <div class="cl-field"><label class="cl-lbl" for="cPag">Quem paga</label><select id="cPag" aria-required="true" aria-describedby="cPagErr">${opt(G.PAGADORES)}</select>${err('cPag')}</div>
        <div class="cl-field full"><label class="cl-lbl" for="cDesc">Descrição</label><input id="cDesc" type="text" maxlength="200" autocomplete="off" aria-required="true" aria-describedby="cDescHint cDescErr">${help('cDesc', 'De 3 a 200 letras. Ex.: Mensalidade de novembro da Clínica Sol')}${err('cDesc')}</div>
        <div class="cl-field"><label class="cl-lbl" for="cNome">Nome de quem paga <small>(opcional)</small></label><input id="cNome" type="text" maxlength="120" autocomplete="off" aria-describedby="cNomeErr">${err('cNome')}</div>
        <div class="cl-field"><label class="cl-lbl" for="cValor">Valor em R$</label><input id="cValor" type="text" inputmode="decimal" maxlength="16" autocomplete="off" aria-required="true" aria-describedby="cValorHint cValorPrevia cValorErr">${help('cValor', 'Em reais, com vírgula nos centavos. Ex.: 150 ou 1.234,56')}<span class="cl-hint gs-previa" id="cValorPrevia"></span>${err('cValor')}</div>
        <div class="cl-field"><label class="cl-lbl" for="cVenc">Vencimento</label><input id="cVenc" type="date" value="${G.todaySP()}" min="2020-01-01" max="2099-12-31" aria-describedby="cVencHint cVencErr">${help('cVenc', 'Em branco: hoje.')}${err('cVenc')}</div>
        <div class="cl-field full"><label class="cl-lbl" for="cObs">Observação <small>(opcional, só a equipe vê)</small></label><textarea id="cObs" maxlength="500" aria-describedby="cObsErr"></textarea>${err('cObs')}</div>
      </div>
      <div class="cl-actions"><button class="btn btn-coral" type="submit" id="cSalvar">Registrar cobrança</button></div>
      <div id="cMsg" aria-live="polite"></div>
    </form>`;
}

function wireCobForm() {
  const form = $('#cobForm');
  // "Vai registrar R$ 1.500,00.": o valor como vai ficar, antes de salvar ("1.500" e "1.50" são bem diferentes).
  const previa = () => { $('#cValorPrevia').textContent = G.previaValor($('#cValor').value); };
  $('#cValor').addEventListener('input', previa);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const val = (id) => $(`#${id}`).value;
    const today = G.todaySP();
    const { ok, errors, payload } = G.validarCobranca({
      tipo: val('cTipo'), pagador_tipo: val('cPag'), descricao: val('cDesc'), pagador_nome: val('cNome'), valor: val('cValor'), vencimento: val('cVenc'), obs: val('cObs'),
    }, today);
    let first = null;
    for (const [k, id] of CAMPOS) {
      const el = $(`#${id}`);
      $(`#${id}Err`).textContent = errors[k] || '';
      if (errors[k]) { el.setAttribute('aria-invalid', 'true'); first ||= el; } else el.removeAttribute('aria-invalid');
    }
    $('#cMsg').innerHTML = '';
    if (!ok) { first?.focus(); return; }
    const gen = S.gen;
    const btn = $('#cSalvar');
    btn.disabled = true;
    btn.textContent = 'Registrando…';
    try {
      const saved = await auth.rpc('admin_cobranca_salvar', { p: payload });
      if (gen !== S.gen || !form.isConnected) return; // saiu da conta enquanto salvava
      const row = saved && typeof saved === 'object' && saved.id !== undefined && saved.id !== null ? saved
        : null;
      form.reset();
      $('#cVenc').value = G.todaySP();
      previa();
      const fica = row && G.noFiltro(row, S.cob.filter, today);
      // Lista ainda não carregada (ou o banco não devolveu a cobrança): busca de novo em vez de mostrar só a nova.
      if (!row || !S.cob.loaded) loadCobrancas();
      else if (fica) { S.cob.rows.unshift(row); renderCobLista(); }
      // Um aviso só, logo embaixo do botão (o leitor de tela lê).
      const text = `Cobrança registrada: ${G.fmtBRL(payload.valor_cents)} · ${payload.descricao}.`;
      $('#cMsg').innerHTML = note(esc(`${text}${row && !fica ? ' Ela não aparece na lista por causa do filtro.' : ''}`), 'ok');
      loadGestao(); // os totais mudam
    } catch (err) {
      if (gen !== S.gen || !form.isConnected) return;
      if (lost()) return;
      // Sem permissão (a conta deixou de ser da equipe): some tudo, como ao abrir a página.
      if (forbidden(err)) { notAdmin(); return; }
      $('#cMsg').innerHTML = note(esc(dbMsg(err) || (noFn(err) ? 'A cobrança ainda não está ligada no banco.'
        : friendlyError(err, 'Não foi possível registrar agora. Tente de novo em instantes.'))), 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Registrar cobrança';
      if (btn.isConnected && (!document.activeElement || document.activeElement === document.body)) btn.focus();
    }
  };
}

/* ======================= início ======================= */
async function init() {
  initTips();
  const flash = await finishLogin();
  if (flash) $('#flash').innerHTML = note(esc(flash.text), flash.kind);
  renderAccount();
  if (auth.user()) checkAdmin();
}
init();
