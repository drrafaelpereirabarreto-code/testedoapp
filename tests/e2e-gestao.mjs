// Teste de ponta a ponta do PAINEL DE GESTÃO (gestao.html, só a equipe do IMED) num navegador de verdade
// (Playwright), com o Supabase (login e as funções public.admin_gestao e public.admin_cobranca_*) simulado EM MEMÓRIA,
// com as regras do contrato (só admin; 42501 'forbidden'; dado inválido 22023 com mensagem curta em português).
// Cenários: sem login (quadro de entrar, nada do banco); conta que não é da equipe (aviso e nenhuma busca de dados);
// equipe com dados (números, gráficos com resumo para leitor de tela e tabela, funis, resultados, fluxograma da entrada
// de médicos com os números, médicos aguardando, clínicas, faturamento); período 7/30/90/365; banco ainda sem as funções
// (aviso, sem quebrar); cobrança (criar, erro de validação, erro do banco, marcar como paga, cancelar, voltar para
// pendente, filtro e planilha CSV); link "Painel de gestão" no painel.html só para a equipe; entrada vencida; celular
// 390 px sem rolagem lateral; nenhum erro no console. Com o axe-core por perto (AXE_PATH ou node_modules), audita a
// página da equipe no computador e no celular (falha com violação grave).
// Rodar com: node tests/e2e-gestao.mjs   (precisa do pacote "playwright" instalado)
// Opcional: SHOTS=pasta salva capturas de tela (para mostrar o teste); E2E_PORT muda a porta (padrão 4761);
//           ONLY="trecho" roda só os cenários com esse texto no nome; AXE_PATH=<pasta>/node_modules/axe-core.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const PORT = Number(process.env.E2E_PORT) || 4761; // E2E_PORT: outra porta para rodar em paralelo
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('não encontrado');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

// axe-core (fora do site): AXE_PATH (arquivo, pasta do pacote ou pasta com node_modules) ou o node_modules do projeto.
function findAxe() {
  const tries = [];
  if (process.env.AXE_PATH) {
    const p = resolve(process.env.AXE_PATH);
    tries.push(() => require.resolve(p));
    tries.push(() => createRequire(join(p, 'noop.js')).resolve('axe-core'));
  }
  tries.push(() => require.resolve('axe-core'));
  for (const t of tries) {
    try { const f = t(); if (f && existsSync(f)) { const min = join(dirname(f), 'axe.min.js'); return existsSync(min) ? min : f; } } catch { /* próximo */ }
  }
  return null;
}
const AXE = findAxe();

/* ======================= dados simulados ======================= */
const NOW = '2026-10-30T15:00:00Z'; // 12:00 em São Paulo
const HOJE = '2026-10-30';
const USER_ID = 'uuuuuuuu-0000-4000-8000-0000000000e1';
const addDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const daySP = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const sum = (a) => a.reduce((s, x) => s + x, 0);
const clone = (x) => JSON.parse(JSON.stringify(x));

const ID = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CHARGES = [
  { id: ID(1), criado_em: '2026-10-29T13:00:00Z', tipo: 'teleconsulta', descricao: 'Teleconsulta de 29/10', pagador_tipo: 'paciente', pagador_nome: 'Ana; "Maria" <b>Silva</b>', valor_cents: 8900, vencimento: '2026-10-29', status: 'pendente', pago_em: null, forma: null, obs: '=HYPERLINK("http://x")', teleconsulta_id: null, clinica_id: null },
  { id: ID(2), criado_em: '2026-10-20T10:00:00Z', tipo: 'mensalidade_clinica', descricao: 'Mensalidade de outubro', pagador_tipo: 'clinica', pagador_nome: 'Imagem Paulista', valor_cents: 49900, vencimento: '2026-10-25', status: 'pago', pago_em: '2026-10-22T15:00:00Z', forma: 'pix', obs: null, teleconsulta_id: null, clinica_id: null },
  { id: ID(3), criado_em: '2026-09-15T10:00:00Z', tipo: 'outro', descricao: 'Material de divulgação', pagador_tipo: 'outro', pagador_nome: null, valor_cents: 15000, vencimento: '2026-09-20', status: 'cancelado', pago_em: null, forma: null, obs: null, teleconsulta_id: null, clinica_id: null },
  { id: ID(4), criado_em: '2026-10-28T09:00:00Z', tipo: 'comissao_clinica', descricao: 'Comissão de setembro', pagador_tipo: 'clinica', pagador_nome: 'Laboratório Análise', valor_cents: 25050, vencimento: '2026-11-10', status: 'pendente', pago_em: null, forma: null, obs: null, teleconsulta_id: null, clinica_id: null },
  { id: ID(5), criado_em: '2026-08-10T10:00:00Z', tipo: 'mensalidade_clinica', descricao: 'Mensalidade de agosto', pagador_tipo: 'clinica', pagador_nome: 'Imagem Paulista', valor_cents: 49900, vencimento: '2026-08-25', status: 'pago', pago_em: '2026-08-20T13:00:00Z', forma: 'boleto', obs: null, teleconsulta_id: null, clinica_id: null },
];
const AGUARDANDO = [
  { id: 'dddddddd-0000-4000-8000-000000000002', nome: 'Dr. Davi Rocha', crm: '98765', uf: 'RJ', especialidade: null, desde: '2026-10-28T09:30:00Z' },
  { id: 'dddddddd-0000-4000-8000-000000000001', nome: 'Dra. Carla <b>Mendes</b><img src=x onerror="window.__xss=1">', crm: '123456', uf: 'SP', especialidade: 'Cardiologia', desde: '2026-10-29T12:00:00Z' },
];

// Números do período (o resto vem das regras do contrato). A série soma os totais, como no banco.
const PAT = { pedidos: [0, 1, 0, 2, 1, 0, 1], tele_pedidas: [1, 0, 0, 1, 0, 1, 0], tele_encerradas: [1, 0, 0, 0, 0, 1, 0], documentos: [0, 2, 0, 0, 1, 0, 0] };
function resumoCobranca(charges, days) {
  const from = addDays(HOJE, 1 - days);
  const pagas = charges.filter((c) => c.status === 'pago' && daySP(c.pago_em) >= from && daySP(c.pago_em) <= HOJE);
  const pend = charges.filter((c) => c.status === 'pendente');
  const meses = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(2026, 9 - 11 + i, 1)); return d.toISOString().slice(0, 7); });
  return {
    faturado_cents: sum(pagas.map((c) => c.valor_cents)), a_receber_cents: sum(pend.map((c) => c.valor_cents)),
    atrasado_cents: sum(pend.filter((c) => c.vencimento < HOJE).map((c) => c.valor_cents)), cancelado_cents: sum(charges.filter((c) => c.status === 'cancelado').map((c) => c.valor_cents)),
    qtd_pagas: pagas.length, qtd_pendentes: pend.length,
    por_mes: meses.map((mes) => ({
      mes,
      faturado_cents: sum(charges.filter((c) => c.status === 'pago' && daySP(c.pago_em).startsWith(mes)).map((c) => c.valor_cents)),
      a_receber_cents: sum(pend.filter((c) => c.vencimento.startsWith(mes)).map((c) => c.valor_cents)),
    })),
  };
}
function gestao(days, charges) {
  const de = addDays(HOJE, 1 - days);
  const serie = Array.from({ length: days }, (_, i) => ({
    dia: addDays(de, i), visitas: i === days - 4 ? 1000 : 120 + ((i * 53) % 97),
    pedidos: PAT.pedidos[i % 7], tele_pedidas: PAT.tele_pedidas[i % 7], tele_encerradas: PAT.tele_encerradas[i % 7], documentos: PAT.documentos[i % 7],
  }));
  const tot = (k) => sum(serie.map((x) => x[k]));
  const ped = tot('pedidos');
  const concluido = Math.floor(ped * 0.3); const confirmado = Math.floor(ped * 0.25); const cancelado = Math.floor(ped * 0.1); const contatado = Math.floor(ped * 0.15);
  const tp = tot('tele_pedidas'); const te = tot('tele_encerradas');
  const resto = tp - te - 1;
  const docs = tot('documentos');
  const exames = Math.ceil(docs * 0.45); const receita = Math.floor(docs * 0.25); const atestado = Math.floor(docs * 0.15);
  return {
    dias: days, de, ate: HOJE, gerado_em: NOW, serie,
    pacientes: {
      atendidos: te + concluido,
      pedidos: { total: ped, pendente: ped - concluido - confirmado - cancelado - contatado, contatado, confirmado, cancelado, concluido, parceiro: Math.ceil(ped * 0.7), concierge: ped - Math.ceil(ped * 0.7) },
      tele: { total: tp, aguardando: 1, aceita: 0, em_atendimento: 0, encerrada: te, cancelada: Math.floor(resto / 2), expirada: resto - Math.floor(resto / 2), espera_media_min: 7.5, duracao_media_min: 18.2 },
      documentos: { total: docs, por_tipo: { exames, receita, atestado, comparecimento: 0, encaminhamento: 0, relatorio: docs - exames - receita - atestado, orientacoes: 0 }, cancelados: 1, pdf_assinado: Math.max(0, docs - 2) },
      avaliacoes: { total: 3, media: 4.7 },
    },
    funil: { visitas: tot('visitas'), abriram_busca: 1200, abriram_local: 480, pedidos: ped, confirmados: confirmado + concluido, concluidos: concluido, abriram_tele: 300, tele_fila: tp, tele_atendidas: te, tele_encerradas: te, tele_com_documento: Math.min(te, 5) },
    medicos: { inscritos_periodo: days >= 30 ? 4 : 1, pendente: 2, aprovado: 5, recusado: 1, suspenso: 0, disponiveis_agora: 1, aprovacao_media_horas: 30.5, aguardando: AGUARDANDO },
    clinicas: { parceiras: 7, com_agenda: 3, com_preco: 5, interessadas: days >= 30 ? 11 : 2, reivindicacoes: { pendente: 2, aprovado: 7, recusado: 1 } },
    outros: { lista_espera: 40, contatos: 6, avisos_de_erro: 2 },
    cobranca: resumoCobranca(charges, days),
  };
}

/* ======================= banco simulado ======================= */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });
const bad = (route, message) => json(route, { code: '22023', message, details: null, hint: null }, 400);
const NOFN = (fn) => ({ code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` });
const TIPOS = ['teleconsulta', 'mensalidade_clinica', 'comissao_clinica', 'outro'];
const PAGADORES = ['paciente', 'clinica', 'medico', 'outro'];
const STATUS = ['pendente', 'pago', 'cancelado'];
const FORMAS = ['pix', 'cartao', 'boleto', 'dinheiro', 'transferencia', 'outro'];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;

async function newPage(browser, { mobile = false, logged = false, email = 'equipe@imed.com.br', expired = false, db: dbOpts = {}, bypassCSP = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block', acceptDownloads: true, bypassCSP,
  });
  await context.clock.setFixedTime(new Date(NOW));
  const nowS = Math.floor(Date.parse(NOW) / 1000);
  const db = {
    admin: true, charges: clone(CHARGES), gestaoMissing: false, cobMissing: false, gestaoError: null, gestaoDelay: 0, cobError: null, saveError: null,
    failRefresh: false, members: [], clinics: [], calls: [],
    ...dbOpts,
  };
  const log = [];
  await context.addInitScript(([s]) => {
    try {
      localStorage.setItem('imed_lgpd', '1');
      if (s && !sessionStorage.getItem('__seeded')) { localStorage.setItem('imed_session', JSON.stringify(s)); sessionStorage.setItem('__seeded', '1'); }
    } catch { /* sem armazenamento */ }
  }, [logged ? { access_token: 'tok-init', refresh_token: 'ref', expires_at: expired ? nowS - 600 : nowS + 3600, user: { id: USER_ID, email } } : null]);
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const path = url.pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const entry = { method: req.method(), path, q: url.search, query: url.searchParams, body, auth: req.headers().authorization };
    log.push(entry);
    if (path === '/auth/v1/otp') return json(route, {});
    if (path === '/auth/v1/user') return json(route, { id: USER_ID, email });
    if (path === '/auth/v1/token' && db.failRefresh) return json(route, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' }, 400);
    if (path === '/auth/v1/token') return json(route, { access_token: 'tok-new', refresh_token: 'ref2', expires_in: 3600, user: { id: USER_ID, email } });
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });
    const rest = path.replace('/rest/v1/', '');
    const anon = !/^Bearer tok-/.test(entry.auth || '');
    const isAdmin = db.admin && !anon;
    // Funções só para a equipe: o banco confere is_imed_admin() no servidor.
    const onlyAdmin = () => json(route, { code: '42501', message: 'forbidden', details: null, hint: null }, anon ? 401 : 403);
    switch (rest) {
      case 'rpc/is_imed_admin': return json(route, isAdmin);
      case 'rpc/admin_gestao': {
        if (db.gestaoDelay) await new Promise((r) => setTimeout(r, db.gestaoDelay));
        if (db.gestaoMissing) return json(route, NOFN('admin_gestao(p_days)'), 404);
        if (!isAdmin) return onlyAdmin();
        if (db.gestaoError) return json(route, db.gestaoError.body, db.gestaoError.status);
        const days = Math.min(366, Math.max(1, Number(body?.p_days) || 30));
        return json(route, gestao(days, db.charges));
      }
      case 'rpc/admin_cobranca_listar': {
        if (db.cobMissing) return json(route, NOFN('admin_cobranca_listar(p_status, p_limite)'), 404);
        if (!isAdmin) return onlyAdmin();
        if (db.cobError) return json(route, db.cobError.body, db.cobError.status);
        const st = body?.p_status ?? null;
        if (st !== null && !STATUS.includes(st)) return bad(route, 'Situação inválida.');
        const lim = Math.min(1000, Math.max(1, Number(body?.p_limite) || 200));
        return json(route, db.charges.filter((c) => !st || c.status === st).sort((a, b) => b.criado_em.localeCompare(a.criado_em)).slice(0, lim));
      }
      case 'rpc/admin_cobranca_salvar': {
        if (db.cobMissing) return json(route, NOFN('admin_cobranca_salvar(p)'), 404);
        if (!isAdmin) return onlyAdmin();
        if (db.saveError) return json(route, db.saveError, 400);
        const p = body?.p;
        if (!p || typeof p !== 'object') return bad(route, 'Dados da cobrança inválidos.');
        if (!TIPOS.includes(p.tipo)) return bad(route, 'Tipo de cobrança inválido.');
        const desc = String(p.descricao ?? '').trim();
        if (desc.length < 3 || desc.length > 200) return bad(route, 'Descrição deve ter de 3 a 200 caracteres.');
        if (!PAGADORES.includes(p.pagador_tipo)) return bad(route, 'Tipo de pagador inválido.');
        if (p.pagador_nome != null && String(p.pagador_nome).length > 120) return bad(route, 'Nome do pagador deve ter até 120 caracteres.');
        if (!Number.isInteger(p.valor_cents) || p.valor_cents < 1 || p.valor_cents > 100000000) return bad(route, 'Valor inválido: informe de R$ 0,01 a R$ 1.000.000,00.');
        const venc = p.vencimento ?? HOJE;
        if (!isDate(venc) || venc < '2020-01-01' || venc > '2099-12-31') return bad(route, 'Vencimento inválido: use uma data de 2020 a 2099 (AAAA-MM-DD).');
        if (p.obs != null && String(p.obs).length > 500) return bad(route, 'Observação deve ter até 500 caracteres.');
        const row = { id: randomUUID(), criado_em: NOW, tipo: p.tipo, descricao: desc, pagador_tipo: p.pagador_tipo, pagador_nome: p.pagador_nome ?? null,
          valor_cents: p.valor_cents, vencimento: venc, status: 'pendente', pago_em: null, forma: null, obs: p.obs ?? null, teleconsulta_id: null, clinica_id: null };
        db.charges.push(row);
        return json(route, row);
      }
      case 'rpc/admin_cobranca_status': {
        if (db.cobMissing) return json(route, NOFN('admin_cobranca_status(p_id, p_status, p_forma)'), 404);
        if (!isAdmin) return onlyAdmin();
        if (!STATUS.includes(body?.p_status)) return bad(route, 'Situação inválida.');
        if (body.p_forma != null && body.p_forma !== '' && !FORMAS.includes(body.p_forma)) return bad(route, 'Forma de pagamento inválida.');
        const c = db.charges.find((x) => x.id === body.p_id);
        if (!c) return bad(route, 'Cobrança não encontrada.');
        if (body.p_status === 'pago') { if (c.status !== 'pago') c.pago_em = NOW; } else c.pago_em = null;
        if (body.p_forma) c.forma = body.p_forma;
        c.status = body.p_status;
        return json(route, c);
      }
      // painel.html (o link "Painel de gestão")
      case 'clinic_members': return json(route, anon ? [] : db.members);
      case 'clinics': return json(route, db.clinics);
      default:
        if (req.method() === 'GET') return json(route, []);
        return json(route, { message: `não simulado: ${rest}` }, 404);
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push(`diálogo inesperado: ${d.message()}`); d.dismiss(); });
  return { context, page, log, db, errors };
}

const calls = (log, path) => log.filter((e) => e.path.endsWith(path));
const dataCalls = (log) => log.filter((e) => /\/rpc\/admin_(gestao|cobranca_)/.test(e.path));
const shot = async (page, name, selector = null) => {
  if (!SHOTS) return;
  await page.waitForTimeout(250);
  if (selector) await page.locator(selector).screenshot({ path: join(SHOTS, `${name}.png`) });
  else await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
};
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const kpiV = async (page, id) => norm(await page.textContent(`[data-kpi="${id}"] .gs-kpi-v`));
const noOverflow = async (page) => {
  const [w, sw] = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
  const vw = page.viewportSize().width;
  assert.ok(w <= vw && sw <= vw, `sem rolagem lateral (janela ${w}px, conteúdo ${sw}px, aparelho ${vw}px)`);
};
const brl = (c) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100).replace(/\s/g, ' ');
const int = (n) => new Intl.NumberFormat('pt-BR').format(n);
const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

async function runAxe(page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] });
    return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  });
}

const results = [];
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
const limite = (name) => new Promise((_, fail) => { const t = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); t.unref?.(); });
async function scenario(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  try { await Promise.race([fn(), limite(name)]); results.push(['ok', name]); console.log(`ok  ${name}`); } catch (e) { results.push(['FALHOU', name]); console.log(`FALHOU  ${name}\n   ${e.stack}`); }
}

const browser = await chromium.launch();
const F30 = gestao(30, CHARGES);
const F7 = gestao(7, CHARGES);

await scenario('sem login: quadro de entrar, nada do banco, página fora do Google e sem o contador de visitas', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#loginEmail');
  assert.equal(await page.title(), 'Painel de gestão · IMED');
  assert.equal(await page.getAttribute('meta[name="robots"]', 'content'), 'noindex, nofollow');
  assert.equal(await page.locator('script[src*="visitas.js"]').count(), 0, 'sem o contador de visitas');
  assert.match(norm(await page.textContent('#authBox')), /Esta página é só para a equipe do IMED/);
  assert.equal(norm(await page.textContent('#app')), '', 'nada da gestão sem login');
  assert.equal(log.filter((e) => e.path.startsWith('/rest/v1/')).length, 0, 'nenhuma chamada ao banco sem login');
  await shot(page, 'gestao-01-sem-login');
  await page.fill('#loginEmail', 'Equipe@IMED.com.br');
  await page.click('#authBox button[type="submit"]');
  await page.waitForSelector('#loginMsg.ok');
  const otp = calls(log, '/auth/v1/otp')[0];
  assert.equal(new URL(otp.path + otp.q, SUPA).searchParams.get('redirect_to'), `${BASE}gestao.html`, 'o link do e-mail volta para gestao.html');
  assert.equal(otp.body.email, 'equipe@imed.com.br');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('conta que não é da equipe: aviso e nenhuma busca de dados; o painel.html não mostra o link', async () => {
  const { page, log, errors, context } = await newPage(browser, { logged: true, email: 'dono@clinica.com.br', db: { admin: false } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#denyTitle');
  assert.equal(norm(await page.textContent('#denyTitle')), 'Esta página é só para a equipe do IMED');
  assert.equal(calls(log, '/rpc/is_imed_admin').length, 1);
  assert.equal(calls(log, '/rpc/is_imed_admin')[0].auth, 'Bearer tok-init', 'confere com a conta de quem entrou');
  assert.equal(dataCalls(log).length, 0, 'nenhuma chamada de dados');
  assert.equal(await page.locator('.gs-kpi, .gs-fig, #cobForm').count(), 0);
  assert.equal(await page.locator('#app a[href="painel.html"]').count(), 1);
  await shot(page, 'gestao-02-sem-permissao');
  // painel.html: clínica sem ser da equipe, sem o atalho para a gestão.
  const C1 = 'cccccccc-0000-4000-8000-000000000001';
  const { page: p2, errors: e2, context: c2 } = await newPage(browser, { logged: true, email: 'dono@clinica.com.br', db: { admin: false, members: [{ clinic_id: C1, role: 'owner' }], clinics: [{ id: C1, name: 'Imagem Paulista', kind: 'imagem', city: 'São Paulo', state: 'SP', status: 'published', accepts_online_booking: true }] } });
  await p2.goto(`${BASE}painel.html`);
  await p2.waitForSelector('#tab-pedidos');
  await p2.waitForFunction(() => !document.querySelector('#panel .cl-state'));
  assert.equal(await p2.locator('#goGestao, a[href="gestao.html"]').count(), 0, 'clínica não vê o link da gestão');
  assert.deepEqual(e2, []);
  await c2.close();
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('painel.html: o link "Painel de gestão" aparece só para a equipe do IMED', async () => {
  const { page, errors, context } = await newPage(browser, { logged: true, db: { admin: true } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#goGestao');
  assert.equal(await page.getAttribute('#goGestao', 'href'), 'gestao.html');
  assert.equal(norm(await page.textContent('#goGestao')), 'Painel de gestão');
  assert.equal(await page.textContent('#clinicTitle'), 'Equipe do IMED');
  await shot(page, 'gestao-03-link-no-painel', '#app > section.cl-card');
  await page.click('#goGestao');
  await page.waitForURL(/gestao\.html$/);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('equipe do IMED: resumo, gráficos com resumo e tabela, funis, resultados, fluxograma dos médicos, clínicas e faturamento', async () => {
  const { page, log, errors, context } = await newPage(browser, { logged: true });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  await page.waitForSelector('#cobLista table');
  const q = calls(log, '/rpc/admin_gestao');
  assert.deepEqual(q[0].body, { p_days: 30 }, 'começa pelos últimos 30 dias');
  assert.equal(q[0].auth, 'Bearer tok-init');
  assert.deepEqual(calls(log, '/rpc/admin_cobranca_listar')[0].body, { p_status: null, p_limite: 200 });
  assert.equal(await page.isChecked('input[name="gsDias"][value="30"]'), true);
  assert.match(norm(await page.textContent('#gsWhen')), /^Números de 01\/10\/2026 a 30\/10\/2026 \(30 dias\), no horário de São Paulo\. Atualizado às 12:00\.$/);
  // 1. resumo
  const P = F30.pacientes;
  const C = F30.cobranca;
  assert.equal(await kpiV(page, 'atendidos'), int(P.atendidos));
  assert.equal(await kpiV(page, 'pedidos'), int(P.pedidos.total));
  assert.equal(await kpiV(page, 'tele'), int(P.tele.total));
  assert.equal(await kpiV(page, 'visitas'), int(F30.funil.visitas));
  assert.equal(await kpiV(page, 'faturado'), brl(C.faturado_cents));
  assert.equal(await kpiV(page, 'receber'), brl(C.a_receber_cents));
  assert.equal(C.faturado_cents, 49900);
  assert.equal(C.a_receber_cents, 33950);
  // 2. atendimentos por dia: 4 linhas (sem as visitas), resumo para leitor de tela e tabela com os mesmos números
  const atend = page.locator('figure[data-fig="atend"]');
  const svgA = atend.locator('svg[role="img"]');
  const S = F30.serie;
  const tot = (k) => sum(S.map((x) => x[k]));
  const peak = Math.max(...S.map((x) => x.pedidos));
  const peakDay = S[S.map((x) => x.pedidos).lastIndexOf(peak)].dia;
  assert.equal(await svgA.getAttribute('aria-label'), `Atendimentos por dia, de 01/10 a 30/10: ${tot('pedidos')} pedidos de agendamento, ${tot('tele_pedidas')} teleconsultas pedidas, ${tot('tele_encerradas')} teleconsultas encerradas e ${tot('documentos')} documentos emitidos; o dia com mais pedidos de agendamento foi ${dm(peakDay)}, com ${peak}.`);
  assert.equal(await svgA.locator('path.gs-line').count(), 4);
  assert.equal(await svgA.locator('rect.gs-hit').count(), 30);
  assert.deepEqual(await atend.locator('.gs-legend li').allTextContents(), ['Pedidos de agendamento', 'Teleconsultas pedidas', 'Teleconsultas encerradas', 'Documentos emitidos']);
  assert.equal(Number(await svgA.getAttribute('width')), Math.round(await atend.locator('.gs-chart').evaluate((el) => el.clientWidth)), 'desenhado na largura do lugar');
  await atend.locator('summary').click();
  const rowsA = atend.locator('tbody tr');
  assert.equal(await rowsA.count(), 30);
  assert.equal(norm(await rowsA.first().innerText()), `sex, 30/10/2026 ${S[29].pedidos} ${S[29].tele_pedidas} ${S[29].tele_encerradas} ${S[29].documentos}`, 'o dia mais novo primeiro');
  // balão ao passar o mouse
  const hit = svgA.locator('rect.gs-hit').nth(27);
  await hit.hover();
  await page.waitForSelector('#gsTip:not([hidden])');
  assert.equal(await page.textContent('#gsTip'), `qua, 28/10/2026\nPedidos de agendamento: ${S[27].pedidos}\nTeleconsultas pedidas: ${S[27].tele_pedidas}\nTeleconsultas encerradas: ${S[27].tele_encerradas}\nDocumentos emitidos: ${S[27].documentos}`);
  await page.mouse.move(5, 5);
  await page.waitForSelector('#gsTip', { state: 'hidden' });
  // visitas em outro gráfico, com o dia de mais visitas escrito
  const vis = page.locator('figure[data-fig="visitas"]');
  assert.equal(await vis.locator('svg[role="img"]').getAttribute('aria-label'), `Visualizações de página por dia, de 01/10 a 30/10: ${int(F30.funil.visitas)} no total; o dia com mais foi 27/10, com 1.000.`);
  assert.equal(await vis.locator('path.gs-area').count(), 1);
  assert.equal(await vis.locator('.gs-peak').textContent(), '1.000');
  // 3. fluxo do paciente: funis com % sobre a etapa anterior
  assert.match(norm(await page.textContent('#sec-fluxo')), /Visualização não é pessoa única/);
  const fa = page.locator('figure[data-fig="funil-agenda"]');
  const PF = F30.funil;
  const pc = (a, b) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: (a / b) * 100 > 0 && (a / b) * 100 < 10 ? 1 : 0 }).format((a / b) * 100)}%`;
  assert.equal(await fa.locator('svg').getAttribute('aria-label'), `Agendamento: da busca ao atendimento: abriram a busca (perto de mim) 1.200, abriram a página de um local 480 (40% da etapa anterior), pediram agendamento ${PF.pedidos} (${pc(PF.pedidos, 480)} da etapa anterior), pedido confirmado ${PF.confirmados} (${pc(PF.confirmados, PF.pedidos)} da etapa anterior) e atendimento concluído ${PF.concluidos} (${pc(PF.concluidos, PF.confirmados)} da etapa anterior).`);
  assert.equal(await fa.locator('path.gs-bar').count(), 5);
  assert.deepEqual(await fa.locator('path.gs-bar').evaluateAll((b) => b.map((x) => x.getAttribute('class'))), ['gs-bar gs-o1', 'gs-bar gs-o2', 'gs-bar gs-o3', 'gs-bar gs-o4', 'gs-bar gs-o5'], 'um tom só, do escuro ao claro');
  await fa.locator('summary').click();
  assert.deepEqual((await fa.locator('tbody tr').allInnerTexts()).map(norm).slice(0, 2), ['Abriram a busca (Perto de mim) 1.200 — 100%', 'Abriram a página de um local 480 40% 40%']);
  const ft = page.locator('figure[data-fig="funil-tele"]');
  assert.match(await ft.locator('svg').getAttribute('aria-label'), new RegExp(`^Teleconsulta: da página ao documento: abriram a teleconsulta 300, entraram na fila ${PF.tele_fila} \\(${pc(PF.tele_fila, 300).replace('.', '\\.')} da etapa anterior\\)`));
  // 4. resultados
  const sp = page.locator('figure[data-fig="st-pedidos"]');
  await sp.locator('summary').click();
  assert.deepEqual((await sp.locator('tbody tr').allInnerTexts()).map(norm), [
    ['Pendente', P.pedidos.pendente], ['Contatado', P.pedidos.contatado], ['Confirmado', P.pedidos.confirmado], ['Concluído', P.pedidos.concluido], ['Cancelado', P.pedidos.cancelado],
  ].map(([n, v]) => `${n} ${v} ${pc(v, P.pedidos.total)}`));
  assert.equal(await page.locator('figure[data-fig="st-tele"] path.gs-bar').count(), ['aguardando', 'aceita', 'em_atendimento', 'encerrada', 'cancelada', 'expirada'].filter((k) => P.tele[k] > 0).length, 'situação com zero não desenha barra');
  assert.equal(await kpiV(page, 'espera'), '8 min');
  assert.equal(await kpiV(page, 'duracao'), '18 min');
  assert.equal(await kpiV(page, 'parceiro'), int(P.pedidos.parceiro));
  assert.equal(await kpiV(page, 'concierge'), int(P.pedidos.concierge));
  const dc = page.locator('figure[data-fig="docs"]');
  assert.equal(norm(await dc.locator('figcaption span').textContent()), `${P.documentos.total} no total · 1 cancelado · ${P.documentos.pdf_assinado} com o PDF assinado enviado.`);
  await dc.locator('summary').click();
  assert.deepEqual((await dc.locator('tbody th').allTextContents()), ['Pedido de exames', 'Receita', 'Atestado', 'Comparecimento', 'Encaminhamento', 'Relatório', 'Orientações']);
  assert.equal(await kpiV(page, 'aval'), '3');
  assert.equal(await kpiV(page, 'nota'), '4,7 de 5');
  // 5. médicos: fluxograma com os números de agora e a lista dos que aguardam
  const flow = page.locator('ol.gs-flow');
  const n = async (cls) => norm(await flow.locator(`.${cls} .gs-fx-n`).textContent());
  assert.deepEqual([await n('gs-fs1'), await n('gs-fs2'), await n('gs-fb2'), await n('gs-fs3'), await n('gs-fb3'), await n('gs-fs4')], ['4', '2', '1', '5', '0', '1']);
  assert.deepEqual((await flow.locator('.gs-fx-t').allTextContents()), ['Inscrição', 'Conferência do CRM no CFM', 'Recusado', 'Aprovado', 'Suspenso', 'Disponível para atender']);
  assert.match(norm(await flow.locator('.gs-fs3').textContent()), /em média 31 horas até aprovar/);
  assert.match(norm(await flow.locator('.gs-fb2').textContent()), /^Ramo da conferência:/, 'leitor de tela sabe de onde sai o ramo');
  const boxes = await flow.locator('li').evaluateAll((li) => li.map((x) => { const r = x.getBoundingClientRect(); return [x.className.split(' ')[1], Math.round(r.left), Math.round(r.top)]; }));
  const pos = Object.fromEntries(boxes.map(([c, l, t]) => [c, { l, t }]));
  assert.ok(pos['gs-fs1'].l < pos['gs-fs2'].l && pos['gs-fs2'].l < pos['gs-fs3'].l && pos['gs-fs3'].l < pos['gs-fs4'].l, 'etapas lado a lado, na ordem');
  assert.ok(pos['gs-fb2'].t > pos['gs-fs2'].t && pos['gs-fb2'].l === pos['gs-fs2'].l, 'Recusado embaixo da conferência');
  assert.ok(pos['gs-fb3'].t > pos['gs-fs3'].t && pos['gs-fb3'].l === pos['gs-fs3'].l, 'Suspenso embaixo do aprovado');
  assert.equal(norm(await page.textContent('#gsAgT')), 'Aguardando conferência (2)');
  const waits = page.locator('#gsAguardando li');
  assert.equal(await waits.count(), 2);
  assert.match(norm(await waits.nth(0).innerText()), /^Dr\. Davi Rocha CRM-RJ 98765 Aguardando conferência Inscrição em 28\/10\/2026 às 06:30 \(há 2 dias\)/);
  assert.match(norm(await waits.nth(1).locator('h4').textContent()), /^Dra\. Carla <b>Mendes<\/b><img src=x onerror="window\.__xss=1">$/, 'nome escapado');
  assert.match(norm(await waits.nth(1).locator('small').textContent()), /^CRM-SP 123456 · Cardiologia$/);
  const cfm = waits.nth(1).locator('a', { hasText: 'Conferir no CFM' });
  assert.equal(await cfm.getAttribute('href'), 'https://portal.cfm.org.br/busca-medicos/');
  assert.equal(await cfm.getAttribute('target'), '_blank');
  assert.equal(await cfm.getAttribute('rel'), 'noopener');
  assert.equal(await waits.nth(1).locator('a', { hasText: 'Abrir na área do médico' }).getAttribute('href'), 'medico.html#adminCard');
  // 6. clínicas
  assert.deepEqual([await kpiV(page, 'parceiras'), await kpiV(page, 'agenda'), await kpiV(page, 'preco'), await kpiV(page, 'interessadas')], ['7', '3', '5', '11']);
  assert.deepEqual([await kpiV(page, 'reiv-pendente'), await kpiV(page, 'reiv-aprovado'), await kpiV(page, 'reiv-recusado')], ['2', '7', '1']);
  assert.equal(await page.locator('[data-kpi="reiv-pendente"].gs-warn').count(), 1, 'pedidos em análise em destaque');
  assert.deepEqual([await kpiV(page, 'espera-app'), await kpiV(page, 'contatos'), await kpiV(page, 'avisos')], ['40', '6', '2']);
  // 7. faturamento
  assert.match(norm(await page.textContent('#sec-cobranca .gs-honest')), /^O IMED ainda não recebe pagamentos pelo site; aqui a equipe registra as cobranças feitas por fora \(Pix, cartão, boleto\)\. Quando um meio de pagamento for ligado, as cobranças entram sozinhas\.$/);
  assert.deepEqual([await kpiV(page, 'cob-faturado'), await kpiV(page, 'cob-receber'), await kpiV(page, 'cob-atrasado')], [brl(49900), brl(33950), brl(8900)]);
  assert.equal(await page.locator('[data-kpi="cob-atrasado"].gs-warn').count(), 1);
  assert.match(norm(await page.textContent('[data-kpi="cob-faturado"]')), /1 cobrança paga no período/);
  const meses = page.locator('figure[data-fig="meses"]');
  assert.equal(await meses.locator('rect.gs-hit').count(), 12);
  assert.equal(await meses.locator('path.gs-bar').count(), 3, 'faturado em ago e out, a receber em out');
  assert.equal(await meses.locator('svg').getAttribute('aria-label'), `Faturamento por mês, de novembro de 2025 a outubro de 2026: ${brl(99800)} faturado e ${brl(8900)} a receber; o mês com mais faturamento foi outubro de 2026, com ${brl(49900)}.`);
  // tabela das cobranças: mais nova primeiro, atrasada marcada, nada de HTML de quem digitou
  const trs = page.locator('#cobLista tbody tr');
  assert.deepEqual(await trs.evaluateAll((r) => r.map((x) => x.dataset.id)), [ID(1), ID(4), ID(2), ID(3), ID(5)]);
  assert.match(norm(await trs.nth(0).textContent()), /Ana; "Maria" <b>Silva<\/b>/);
  assert.equal(await trs.nth(0).locator('.bd-err').textContent(), 'Atrasada');
  assert.equal(await page.locator('#cobLista tr.gs-late').count(), 1);
  assert.match(norm(await trs.nth(2).innerText()), /Paga em 22\/10\/2026 às 12:00 · Pix/);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'HTML escapado');
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = false; });
  await shot(page, 'gestao-04-painel-completo');
  await shot(page, 'gestao-05-fluxo-do-paciente', '#sec-fluxo');
  await shot(page, 'gestao-06-fluxograma-medicos', '#sec-medicos');
  await shot(page, 'gestao-07-faturamento', '#sec-cobranca');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('período: 7 dias, 12 meses e 90 dias; os números de antes ficam (mais claros) até os novos chegarem', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  db.gestaoDelay = 700;
  await page.click('.gs-seg label:has-text("7 dias")');
  await page.waitForSelector('#gsData.gs-busy[aria-busy="true"]');
  assert.equal(await kpiV(page, 'pedidos'), int(F30.pacientes.pedidos.total), 'segura os números de antes');
  await page.waitForFunction(() => !document.querySelector('#gsData.gs-busy'));
  assert.deepEqual(calls(log, '/rpc/admin_gestao').at(-1).body, { p_days: 7 });
  assert.equal(await kpiV(page, 'pedidos'), int(F7.pacientes.pedidos.total));
  assert.equal(await kpiV(page, 'faturado'), brl(0), 'nada pago nos últimos 7 dias');
  assert.equal(await page.locator('figure[data-fig="atend"] rect.gs-hit').count(), 7);
  assert.match(norm(await page.textContent('#gsWhen')), /de 24\/10\/2026 a 30\/10\/2026 \(7 dias\)/);
  assert.equal(await page.evaluate(() => document.activeElement?.value), '7', 'o foco continua no período');
  assert.equal(calls(log, '/rpc/admin_cobranca_listar').length, 1, 'a lista das cobranças não depende do período');
  db.gestaoDelay = 0;
  await page.click('.gs-seg label:has-text("12 meses")');
  await page.waitForFunction(() => document.querySelectorAll('figure[data-fig="atend"] rect.gs-hit').length === 365);
  assert.deepEqual(calls(log, '/rpc/admin_gestao').at(-1).body, { p_days: 365 });
  const xs = await page.locator('figure[data-fig="atend"] svg').evaluate((svg) => { const b = svg.getBoundingClientRect(); return [...svg.querySelectorAll('text.gs-tick')].map((t) => t.getBoundingClientRect()).filter((r) => r.top > b.bottom - 24).map((r) => ({ left: r.left, right: r.right })).sort((a, c) => a.left - c.left); });
  assert.ok(xs.length >= 5, `rótulos dos dias: ${xs.length}`);
  for (let i = 1; i < xs.length; i += 1) assert.ok(xs[i].left >= xs[i - 1].right, 'rótulos dos dias sem se encostar');
  assert.equal(await page.locator('figure[data-fig="atend"] circle').count(), 0, 'sem bolinhas em 365 dias');
  await page.click('.gs-seg label:has-text("90 dias")');
  await page.waitForFunction(() => document.querySelectorAll('figure[data-fig="atend"] rect.gs-hit').length === 90);
  assert.deepEqual(calls(log, '/rpc/admin_gestao').at(-1).body, { p_days: 90 });
  await page.click('#gsRefresh');
  await page.waitForFunction(() => !document.querySelector('#gsData[aria-busy]') && document.querySelectorAll('figure[data-fig="atend"] rect.gs-hit').length === 90);
  await shot(page, 'gestao-08-periodo-90-dias', '#sec-atend');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('banco ainda sem as funções: aviso claro na gestão e na cobrança, sem quebrar; outro erro com "Tentar de novo"', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, db: { gestaoMissing: true, cobMissing: true } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#gsData .cl-note.warn');
  assert.match(norm(await page.textContent('#gsData')), /O painel de gestão ainda não está ligado no banco\. Os números aparecem aqui depois que a atualização do banco for aplicada\./);
  await page.waitForSelector('#cobLista .cl-note.warn');
  assert.match(norm(await page.textContent('#cobLista')), /A cobrança ainda não está ligada no banco/);
  assert.equal(await page.isHidden('#cobForm'), true, 'sem a função, sem o formulário');
  assert.equal(await page.locator('.gs-fig').count(), 0);
  assert.match(norm(await page.textContent('#sec-cobranca .gs-honest')), /O IMED ainda não recebe pagamentos pelo site/);
  await shot(page, 'gestao-09-banco-sem-funcoes');
  // Outro erro: mensagem e "Tentar de novo".
  db.gestaoMissing = false;
  db.gestaoError = { status: 500, body: { message: 'erro' } };
  await page.click('#gsRefresh');
  await page.waitForSelector('#retryGestao');
  assert.match(norm(await page.textContent('#gsData')), /Não foi possível carregar os números agora/);
  db.gestaoError = null;
  db.cobMissing = false;
  await page.click('#retryGestao');
  await page.waitForSelector('#sec-resumo .gs-kpi');
  await page.click('#gsRefresh');
  await page.waitForSelector('#cobLista table');
  assert.equal(await page.isHidden('#cobForm'), false, 'com a função, o formulário volta');
  assert.ok(calls(log, '/rpc/admin_cobranca_listar').length >= 2);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('cobrança: validar, erro do banco, criar, marcar como paga, cancelar, voltar para pendente, filtro e planilha CSV', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#cobLista table');
  await page.waitForSelector('#sec-resumo .gs-kpi');
  assert.equal(await page.inputValue('#cVenc'), HOJE, 'vencimento começa em hoje');
  // formulário vazio: erros nos obrigatórios, nada vai para o banco
  await page.fill('#cVenc', '');
  await page.click('#cSalvar');
  for (const [id, msg] of [['cTipo', 'Escolha o tipo da cobrança.'], ['cPag', 'Escolha quem paga.'], ['cDesc', 'Descreva a cobrança (pelo menos 3 letras).'], ['cValor', 'Informe o valor.']]) {
    assert.equal(await page.textContent(`#${id}Err`), msg, id);
    assert.equal(await page.getAttribute(`#${id}`, 'aria-invalid'), 'true', id);
  }
  assert.equal(await page.textContent('#cVencErr'), '', 'vencimento em branco vale hoje');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cTipo', 'foco no primeiro campo com erro');
  assert.equal(calls(log, '/rpc/admin_cobranca_salvar').length, 0);
  await shot(page, 'gestao-10-cobranca-erros', '#cobForm');
  await page.selectOption('#cTipo', 'comissao_clinica');
  await page.selectOption('#cPag', 'clinica');
  await page.fill('#cDesc', '  Comissão   de outubro ');
  await page.fill('#cNome', 'Clínica Sol');
  await page.fill('#cValor', 'abc');
  await page.click('#cSalvar');
  assert.equal(await page.textContent('#cValorErr'), 'Valor inválido. Use, por exemplo, 150 ou 1.234,56.');
  await page.fill('#cValor', '0,00');
  await page.click('#cSalvar');
  assert.equal(await page.textContent('#cValorErr'), 'O valor precisa ficar entre R$ 0,01 e R$ 1.000.000,00.');
  assert.equal(calls(log, '/rpc/admin_cobranca_salvar').length, 0);
  // erro do banco (22023): a mensagem curta dele aparece
  await page.fill('#cValor', 'R$ 1.234,56');
  await page.fill('#cVenc', '2026-11-05');
  await page.fill('#cObs', 'Pix combinado');
  db.saveError = { code: '22023', message: 'Clínica não encontrada.', details: null, hint: null };
  await page.click('#cSalvar');
  await page.waitForSelector('#cMsg .cl-note.err');
  assert.equal(norm(await page.textContent('#cMsg')), 'Clínica não encontrada.');
  // agora salva
  db.saveError = null;
  const before = calls(log, '/rpc/admin_gestao').length;
  await page.click('#cSalvar');
  await page.waitForSelector('#cMsg .cl-note.ok');
  const sv = calls(log, '/rpc/admin_cobranca_salvar');
  assert.deepEqual(sv.at(-1).body, { p: { tipo: 'comissao_clinica', descricao: 'Comissão de outubro', pagador_tipo: 'clinica', pagador_nome: 'Clínica Sol', valor_cents: 123456, vencimento: '2026-11-05', obs: 'Pix combinado' } });
  assert.equal(sv.at(-1).auth, 'Bearer tok-init');
  assert.equal(norm(await page.textContent('#cMsg')), `Cobrança registrada: ${brl(123456)} · Comissão de outubro.`);
  assert.equal(await page.inputValue('#cDesc'), '', 'formulário limpo');
  assert.equal(await page.inputValue('#cVenc'), HOJE);
  const created = db.charges.at(-1);
  assert.equal(await page.locator('#cobLista tbody tr').first().getAttribute('data-id'), created.id, 'a nova aparece no topo');
  await page.waitForFunction((n) => document.querySelector('[data-kpi="cob-receber"] .gs-kpi-v')?.textContent.replace(/\s/g, ' ') === n, brl(33950 + 123456));
  assert.ok(calls(log, '/rpc/admin_gestao').length > before, 'os totais são buscados de novo');
  // marcar como paga: pede a forma de pagamento
  const r1 = `#cob-${ID(1)}`;
  await page.click(`${r1} [data-pay]`);
  assert.equal(await page.evaluate(() => document.activeElement.id), `forma-${ID(1)}`, 'foco na forma de pagamento');
  await page.click(`${r1} [data-confirm-pay]`);
  assert.equal(await page.textContent(`#forma-${ID(1)}-err`), 'Escolha a forma de pagamento.');
  assert.equal(calls(log, '/rpc/admin_cobranca_status').length, 0);
  await page.selectOption(`#forma-${ID(1)}`, 'pix');
  await shot(page, 'gestao-11-marcar-como-pago', r1);
  await page.click(`${r1} [data-confirm-pay]`);
  await page.waitForFunction((sel) => /Paga/.test(document.querySelector(sel)?.textContent || ''), r1);
  assert.deepEqual(calls(log, '/rpc/admin_cobranca_status').at(-1).body, { p_id: ID(1), p_status: 'pago', p_forma: 'pix' });
  assert.match(norm(await page.innerText(r1)), /Paga em 30\/10\/2026 às 12:00 · Pix/);
  assert.equal(await page.locator(`${r1}.gs-late`).count(), 0, 'paga não fica atrasada');
  assert.match(norm(await page.textContent('#cobMsg')), /^Cobrança “Teleconsulta de 29\/10” marcada como paga \(Pix\)\.$/);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.reopen), ID(1), 'foco segue na mesma cobrança');
  await page.waitForFunction((n) => document.querySelector('[data-kpi="cob-faturado"] .gs-kpi-v')?.textContent.replace(/\s/g, ' ') === n, brl(49900 + 8900));
  assert.equal(await kpiV(page, 'cob-atrasado'), brl(0));
  // cancelar: confirma antes
  const r4 = `#cob-${ID(4)}`;
  await page.click(`${r4} [data-cancel]`);
  assert.match(norm(await page.textContent(`${r4} .gs-pay`)), /Cancelar a cobrança de R\$ 250,50\? Ela sai do “a receber”\./);
  await page.click(`${r4} [data-back]`);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.cancel), ID(4), '"Voltar" devolve o foco');
  assert.equal(calls(log, '/rpc/admin_cobranca_status').length, 1);
  await page.click(`${r4} [data-cancel]`);
  await page.click(`${r4} [data-confirm-cancel]`);
  await page.waitForFunction((sel) => /Cancelada/.test(document.querySelector(sel)?.textContent || ''), r4);
  assert.deepEqual(calls(log, '/rpc/admin_cobranca_status').at(-1).body, { p_id: ID(4), p_status: 'cancelado', p_forma: null });
  await page.waitForFunction((n) => document.querySelector('[data-kpi="cob-receber"] .gs-kpi-v')?.textContent.replace(/\s/g, ' ') === n, brl(123456));
  // voltar para pendente (desfaz um engano)
  await page.click(`#cob-${ID(3)} [data-reopen]`);
  await page.waitForFunction((sel) => /Pendente/.test(document.querySelector(sel)?.textContent || ''), `#cob-${ID(3)}`);
  assert.deepEqual(calls(log, '/rpc/admin_cobranca_status').at(-1).body, { p_id: ID(3), p_status: 'pendente', p_forma: null });
  assert.equal(await page.locator(`#cob-${ID(3)}.gs-late`).count(), 1, 'vencida em 20/09: atrasada');
  // erro do banco ao mudar a situação
  db.charges = db.charges.filter((c) => c.id !== ID(5));
  await page.click(`#cob-${ID(5)} [data-reopen]`);
  await page.waitForSelector('#cobMsg .cl-note.err');
  assert.equal(norm(await page.textContent('#cobMsg')), 'Cobrança não encontrada.');
  assert.equal(await page.isDisabled(`#cob-${ID(5)} [data-reopen]`), false, 'o botão volta a funcionar');
  // filtro: pagas (o banco filtra) e atrasadas (pendentes do banco, filtradas aqui pelo vencimento)
  await page.selectOption('#cobFiltro', 'pago');
  await page.waitForFunction(() => document.querySelectorAll('#cobLista tbody tr').length === 2);
  assert.deepEqual(calls(log, '/rpc/admin_cobranca_listar').at(-1).body, { p_status: 'pago', p_limite: 200 });
  assert.deepEqual(await page.locator('#cobLista tbody tr').evaluateAll((r) => r.map((x) => x.dataset.id)), [ID(1), ID(2)]);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cobFiltro', 'foco continua no filtro');
  await page.selectOption('#cobFiltro', 'atrasada');
  await page.waitForFunction(() => document.querySelectorAll('#cobLista tbody tr').length === 1 && document.querySelector('#cobLista tbody tr')?.dataset.id.endsWith('3'));
  assert.deepEqual(calls(log, '/rpc/admin_cobranca_listar').at(-1).body, { p_status: 'pendente', p_limite: 200 });
  assert.match(norm(await page.textContent('#cobConta')), /^1 cobrança \(atrasadas\)\./);
  await page.selectOption('#cobFiltro', 'cancelado');
  await page.waitForFunction(() => document.querySelectorAll('#cobLista tbody tr').length === 1);
  assert.deepEqual(await page.locator('#cobLista tbody tr').evaluateAll((r) => r.map((x) => x.dataset.id)), [ID(4)]);
  // planilha CSV (todas)
  await page.selectOption('#cobFiltro', '');
  await page.waitForFunction(() => document.querySelectorAll('#cobLista tbody tr').length === 5);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#cobCsv')]);
  assert.equal(dl.suggestedFilename(), 'imed-cobrancas-2026-10-30.csv');
  const csv = await readFile(await dl.path(), 'utf8');
  assert.ok(csv.startsWith('﻿Criada em;Tipo;Descrição;Quem paga;Nome de quem paga;Valor (R$);Vencimento;Situação;Atrasada;Pago em;Forma de pagamento;Observação;Código\r\n'), 'cabeçalho com BOM e ponto e vírgula');
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 6, 'cabeçalho + 5 cobranças');
  assert.equal(lines[1], `30/10/2026 12:00;Comissão de clínica;Comissão de outubro;Clínica;Clínica Sol;1234,56;05/11/2026;Pendente;não;;;Pix combinado;${created.id}`);
  assert.equal(lines[2], `29/10/2026 10:00;Teleconsulta;Teleconsulta de 29/10;Paciente;"Ana; ""Maria"" <b>Silva</b>";89,00;29/10/2026;Paga;;30/10/2026 12:00;Pix;"'=HYPERLINK(""http://x"")";${ID(1)}`, 'aspas dobradas, ponto e vírgula entre aspas e fórmula desligada');
  assert.equal(lines[3], `28/10/2026 06:00;Comissão de clínica;Comissão de setembro;Clínica;Laboratório Análise;250,50;10/11/2026;Cancelada;;;;;${ID(4)}`);
  assert.equal(lines[4], `20/10/2026 07:00;Mensalidade de clínica;Mensalidade de outubro;Clínica;Imagem Paulista;499,00;25/10/2026;Paga;;22/10/2026 12:00;Pix;;${ID(2)}`);
  assert.equal(lines[5], `15/09/2026 07:00;Outro;Material de divulgação;Outro;;150,00;20/09/2026;Pendente;sim;;;;${ID(3)}`);
  await shot(page, 'gestao-12-cobrancas', '#sec-cobranca');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('entrada vencida: volta para o quadro de entrar sem mostrar nada', async () => {
  const { page, log, errors, context } = await newPage(browser, { logged: true, expired: true, db: { failRefresh: true } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#flash .cl-note.warn');
  assert.match(norm(await page.textContent('#flash')), /Sua entrada expirou\. Peça um novo link abaixo\./);
  await page.waitForSelector('#loginEmail');
  assert.equal(dataCalls(log).length, 0, 'nenhuma chamada de dados');
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_session')), null);
  assert.equal(norm(await page.textContent('#app')), '');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('volta do link do e-mail: entra, confere a equipe e mostra os números', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}gestao.html#access_token=tok-link&refresh_token=r1&expires_in=3600&token_type=bearer`);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  assert.equal(new URL(page.url()).hash, '', 'o endereço fica sem o token');
  assert.match(norm(await page.textContent('#flash')), /Pronto, você entrou\./);
  assert.equal(calls(log, '/rpc/is_imed_admin')[0].auth, 'Bearer tok-link');
  assert.equal(calls(log, '/rpc/admin_gestao')[0].auth, 'Bearer tok-link');
  // sair limpa tudo
  await page.click('[data-signout]');
  await page.waitForSelector('#loginEmail');
  assert.equal(await page.locator('.gs-kpi').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (390 px): sem rolagem lateral, gráficos na largura da tela, fluxograma em pé e cobranças em cartões', async () => {
  const { page, errors, context, db } = await newPage(browser, { mobile: true, logged: true, db: {} });
  db.charges.push({ ...CHARGES[0], id: ID(9), descricao: 'Descrição bem comprida sem espaço: '.concat('x'.repeat(120)), pagador_nome: 'N'.repeat(100), obs: 'o'.repeat(300) });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  await page.waitForSelector('#cobLista table');
  await noOverflow(page);
  for (const id of ['atend', 'visitas', 'funil-agenda', 'funil-tele', 'st-pedidos', 'st-tele', 'docs', 'meses']) {
    const [w, cw] = await page.locator(`figure[data-fig="${id}"]`).evaluate((f) => [Number(f.querySelector('svg').getAttribute('width')), f.querySelector('.gs-chart').clientWidth]);
    assert.equal(w, cw, `${id}: desenhado na largura do celular`);
    assert.ok(w <= 370, `${id}: ${w}px`);
  }
  // textos dos gráficos dentro do desenho
  const out = await page.evaluate(() => [...document.querySelectorAll('.gs-svg')].flatMap((svg) => {
    const b = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('text')].filter((t) => { const r = t.getBoundingClientRect(); return r.left < b.left - 1 || r.right > b.right + 1; }).map((t) => t.textContent);
  }));
  assert.deepEqual(out, [], 'nenhum texto sai do gráfico');
  // fluxograma em pé: etapas uma embaixo da outra, ramos ao lado
  const pos = await page.locator('ol.gs-flow li').evaluateAll((li) => Object.fromEntries(li.map((x) => { const r = x.getBoundingClientRect(); return [x.className.split(' ')[1], [Math.round(r.left), Math.round(r.top)]]; })));
  assert.ok(pos['gs-fs1'][1] < pos['gs-fs2'][1] && pos['gs-fs2'][1] < pos['gs-fs3'][1] && pos['gs-fs3'][1] < pos['gs-fs4'][1], 'etapas descendo');
  assert.ok(pos['gs-fb2'][0] > pos['gs-fs2'][0] && pos['gs-fb2'][1] === pos['gs-fs2'][1], 'Recusado ao lado da conferência');
  // tabelas abertas e a cobrança com o pagamento aberto
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
  await noOverflow(page);
  await page.click(`#cob-${ID(1)} [data-pay]`);
  await noOverflow(page);
  const card = await page.locator(`#cob-${ID(1)}`).evaluate((tr) => getComputedStyle(tr).display);
  assert.equal(card, 'block', 'cobrança vira cartão');
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = false; });
  await shot(page, 'gestao-13-celular');
  await shot(page, 'gestao-14-celular-fluxograma', '#sec-medicos');
  await shot(page, 'gestao-15-celular-cobranca', '#sec-cobranca');
  // alvos de toque de 44 px nos controles da gestão
  const small = await page.evaluate(() => [...document.querySelectorAll('#app button, #app a.btn, #app select, .gs-seg label, .gs-toc a, #app summary')]
    .filter((el) => el.offsetParent).map((el) => [el.textContent.trim().slice(0, 30), Math.round(el.getBoundingClientRect().height)]).filter(([, h]) => h < 43.5));
  assert.deepEqual(small, [], 'alvos de toque com 44 px');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('acessibilidade (axe): página da equipe no computador e no celular, sem violação grave', async () => {
  if (!AXE) { console.log('   aviso - axe-core não encontrado: auditoria pulada (use AXE_PATH=<pasta>/node_modules/axe-core)'); return; }
  for (const mobile of [false, true]) {
    const { page, errors, context } = await newPage(browser, { mobile, logged: true, bypassCSP: true });
    await page.goto(`${BASE}gestao.html`);
    await page.waitForSelector('#sec-resumo .gs-kpi');
    await page.waitForSelector('#cobLista table');
    await page.click(`#cob-${ID(1)} [data-pay]`);
    assert.deepEqual(await runAxe(page), [], mobile ? 'celular' : 'computador');
    assert.deepEqual(errors, []);
    await context.close();
  }
  const { page, context } = await newPage(browser, { logged: true, bypassCSP: true, db: { admin: false } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#denyTitle');
  assert.deepEqual(await runAxe(page), [], 'aviso de sem permissão');
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
