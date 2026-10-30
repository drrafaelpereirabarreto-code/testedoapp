// Teste de ponta a ponta do contador de visitas próprio (assets/js/visitas.js) num navegador de verdade (Playwright),
// com o banco simulado. Confere que cada página aberta manda uma visita com o caminho certo e nada pessoal, que o
// computador de testes, os robôs e quem liga "Não rastrear"/GPC não são contados e que uma falha do contador não
// quebra a página. O site roda como no GitHub Pages (em /testedoapp/, com a página 404) e, para imitar o endereço
// de verdade, o navegador abre "imed.test" (um nome que aponta para este computador).
// Rodar com: node tests/e2e-visitas.mjs   (precisa do pacote "playwright" instalado)
// Opcional: E2E_PORT=8787 node tests/e2e-visitas.mjs  usa outra porta (padrão 8779), para rodar em paralelo.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.E2E_PORT) || 8779; // E2E_PORT: outra porta para rodar em paralelo
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const TRACK = `${SUPA}/rest/v1/rpc/track`;
const ANON = readFileSync(join(ROOT, 'assets/js/config.js'), 'utf8').match(/supabaseAnonKey:\s*'([^']+)'/)[1];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const UA_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const UA_PHONE = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/+F9PQAJYwN6V0E0WwAAAABJRU5ErkJggg==', 'base64');

// Servidor como o GitHub Pages: o site mora em /testedoapp/ e o que não existe recebe o 404.html.
const server = http.createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.startsWith('/testedoapp/')) path = path.slice('/testedoapp'.length);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  let body;
  try { body = await readFile(file); } catch { body = null; }
  if (body) res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  else res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(await readFile(join(ROOT, '404.html')));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://imed.test:${PORT}/testedoapp/`; // "domínio do site"
const LOCAL = `http://127.0.0.1:${PORT}/testedoapp/`; // computador de testes

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });

// real: navegador comum (sem a marca de navegador automatizado). gpc / dnt: privacidade ligada no navegador.
// track: resposta do contador ('ok', 500, 'abort', 'hang'). session: sessão da conta guardada no aparelho.
// blockConfig: o config.js não carrega (contador sem endereço do banco).
async function newPage(browser, { real = true, gpc = false, dnt = false, track = 'ok', session = null, blockConfig = false, mobile = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 }, isMobile: mobile, hasTouch: mobile,
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block', reducedMotion: 'reduce',
    // Navegador comum: sem "HeadlessChrome" no nome (o do teste se anuncia assim e o contador o trata como robô).
    ...(real ? { userAgent: mobile ? UA_PHONE : UA_DESKTOP } : {}),
  });
  await context.addInitScript(([o]) => {
    const def = (k, v) => Object.defineProperty(Navigator.prototype, k, { configurable: true, get: () => v });
    if (o.real) def('webdriver', false);
    if (o.gpc) def('globalPrivacyControl', true);
    if (o.dnt) def('doNotTrack', '1');
    try {
      localStorage.setItem('imed_lgpd', '1');
      if (o.session && !sessionStorage.getItem('__seeded')) { localStorage.setItem('imed_session', JSON.stringify(o.session)); sessionStorage.setItem('__seeded', '1'); }
    } catch { /* sem armazenamento */ }
  }, [{ real, gpc, dnt, session }]);
  const log = { track: [], other: [] };
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  if (blockConfig) await context.route(/\/assets\/js\/config\.js$/, (r) => r.abort());
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = req.url();
    if (url === TRACK) {
      log.track.push({ method: req.method(), body: req.postData(), headers: req.headers(), page: req.frame()?.url() });
      if (track === 'abort') return route.abort('internetdisconnected');
      if (track === 'hang') return; // nunca responde
      if (track === 500) return json(route, { message: 'erro no banco' }, 500);
      return json(route, true);
    }
    log.other.push(url);
    if (url.includes('/auth/v1/user')) return json(route, { id: 'uuuuuuuu-0000-4000-8000-000000000001', email: 'paciente@exemplo.com' });
    if (url.includes('/functions/v1/')) return json(route, { ok: false, error: 'unavailable' }, 502);
    return json(route, []);
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, log, errors };
}

const results = [];
async function scenario(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 5).join('\n  ')}`); }
}
// Espera até chegarem n envios ao contador (ou o tempo acabar).
async function waitTrack(log, n, ms = 8000) {
  const end = Date.now() + ms;
  while (log.track.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  assert.ok(log.track.length >= n, `esperava ${n} envio(s) ao contador, chegaram ${log.track.length}`);
}
// Página carregada e tempo de sobra para um envio que não deveria acontecer.
async function settle(page, ms = 2500) {
  await page.waitForLoadState('load');
  await page.waitForTimeout(ms);
}
const visits = (log) => log.track.map((t) => JSON.parse(t.body || 'null'));

const browser = await chromium.launch({
  args: [`--host-resolver-rules=MAP imed.test 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=http://imed.test:${PORT}`],
});

await scenario('no domínio do site: cada página aberta manda 1 visita, só com o caminho, a chave pública e sem cookie', async () => {
  const { page, log, errors, context } = await newPage(browser);
  const cases = [
    ['', '/'],
    ['index.html?utm_source=zap#agenda', '/'],
    ['perto.html?exame=rm&lat=-23.561&lng=-46.657#mapa', '/perto.html'],
    ['local.html?cnes=2077485', '/local.html'],
    ['exames/', '/exames/'],
    ['exames/raio-x.html#preparo', '/exames/raio-x.html'],
    ['cidades/sp/sao-paulo/clinicas.html', '/cidades/sp/sao-paulo/clinicas.html'],
    ['sobre.html', '/sobre.html'],
    ['privacidade.html', '/privacidade.html'],
    ['nao-existe/pagina?email=maria@exemplo.com', '/404'],
  ];
  for (const [path, expected] of cases) {
    const from = log.track.length;
    await page.goto(SITE + path);
    await waitTrack(log, from + 1);
    await page.waitForTimeout(400);
    const got = log.track.slice(from);
    assert.equal(got.length, 1, `${path}: uma visita só`);
    const [t] = got;
    assert.equal(t.method, 'POST');
    assert.deepEqual(JSON.parse(t.body), { p_path: expected }, `${path}: só o caminho, sem "?" nem "#"`);
    assert.equal(t.headers.apikey, ANON);
    assert.equal(t.headers.authorization, `Bearer ${ANON}`, 'chave pública');
    assert.match(t.headers['content-type'], /application\/json/);
    assert.equal(t.headers.cookie, undefined, `${path}: sem cookie`);
    assert.equal(t.headers.referer, undefined, `${path}: o banco não recebe o endereço da página`);
    assert.ok(!/maria|exemplo|2077485|-23\.5|utm|preparo|agenda/.test(t.body), `${path}: nada do endereço além do caminho`);
    assert.equal(await page.evaluate(() => document.cookie), '', `${path}: nenhum cookie`);
  }
  // Nada guardado no aparelho pelo contador (a página do guia não usa o armazenamento).
  await page.goto(`${SITE}exames/raio-x.html`);
  await waitTrack(log, cases.length + 1);
  assert.deepEqual(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage), document.cookie]), [['imed_lgpd'], [], '']);
  // Prova de que o teste enxerga o endereço de origem: um envio comum (sem a regra do contador) leva o "referer".
  await page.evaluate((u) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}), TRACK);
  await waitTrack(log, cases.length + 2);
  assert.ok(log.track.at(-1).headers.referer, 'um envio comum mostraria a página de origem');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('com a conta aberta: a visita vai com a chave pública, nunca com a sessão da pessoa', async () => {
  const session = { access_token: 'tok-da-pessoa', refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'uuuuuuuu-0000-4000-8000-000000000001', email: 'paciente@exemplo.com' } };
  const { page, log, context } = await newPage(browser, { session });
  await page.goto(`${SITE}conta.html`);
  await waitTrack(log, 1);
  const [t] = log.track;
  assert.deepEqual(JSON.parse(t.body), { p_path: '/conta.html' });
  assert.equal(t.headers.authorization, `Bearer ${ANON}`);
  assert.ok(!t.body.includes('paciente') && !t.headers.authorization.includes('tok-da-pessoa'));
  await context.close();
});

await scenario('computador de testes e navegador automatizado: não manda nada (o contador existe e responde false)', async () => {
  // 127.0.0.1, mesmo num navegador comum.
  let { page, log, errors, context } = await newPage(browser);
  await page.goto(`${LOCAL}perto.html?exame=rm`);
  await settle(page);
  assert.equal(log.track.length, 0, 'localhost não conta');
  assert.equal(await page.evaluate(() => typeof window.IMED_TRACK), 'function');
  assert.equal(await page.evaluate(() => window.IMED_TRACK('busca_exame', 'rm')), false);
  await page.goto(`${LOCAL}`);
  await settle(page, 1500);
  assert.equal(log.track.length, 0);
  assert.deepEqual(errors, []);
  await context.close();
  // No domínio do site, mas com a marca de navegador automatizado (robôs e os testes de ponta a ponta).
  ({ page, log, context } = await newPage(browser, { real: false }));
  await page.goto(`${SITE}sobre.html`);
  await settle(page);
  assert.equal(log.track.length, 0, 'navegador automatizado não conta');
  await context.close();
});

await scenario('?visitas=teste liga o contador no teste; "Não rastrear" e GPC desligam até assim', async () => {
  let { page, log, context } = await newPage(browser, { real: false });
  await page.goto(`${LOCAL}exames/?visitas=teste`);
  await waitTrack(log, 1);
  assert.deepEqual(visits(log), [{ p_path: '/exames/' }]);
  await context.close();
  for (const opt of [{ gpc: true }, { dnt: true }]) {
    ({ page, log, context } = await newPage(browser, opt));
    await page.goto(`${SITE}sobre.html?visitas=teste`);
    await settle(page);
    assert.equal(log.track.length, 0, `${JSON.stringify(opt)}: não conta`);
    assert.equal(await page.evaluate(() => window.IMED_TRACK('busca_exame', 'rm')), false);
    await page.waitForTimeout(300);
    assert.equal(log.track.length, 0);
    await context.close();
  }
});

await scenario('falha do contador não quebra a página: banco com erro, sem internet, sem resposta e sem config.js', async () => {
  for (const track of [500, 'abort', 'hang']) {
    const { page, log, errors, context } = await newPage(browser, { track });
    await page.goto(`${SITE}exames/raio-x.html`);
    await waitTrack(log, 1);
    // Eventos também não quebram (e não esperam a resposta).
    assert.equal(await page.evaluate(() => window.IMED_TRACK('busca_exame', 'rm')), true);
    await page.click('footer .rd-logo'); // link "IMED, página inicial" do rodapé
    await page.waitForURL(SITE);
    await page.waitForSelector('footer.rodape');
    await waitTrack(log, 3);
    assert.deepEqual(errors, [], `${track}: sem erro na página`);
    await context.close();
  }
  const { page, log, errors, context } = await newPage(browser, { blockConfig: true });
  await page.goto(`${SITE}sobre.html`);
  await settle(page, 1500);
  assert.equal(log.track.length, 0, 'sem config.js, o contador não sabe para onde mandar');
  assert.equal(await page.evaluate(() => window.IMED_TRACK('busca_exame', 'rm')), false);
  assert.ok(await page.isVisible('h1'));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (390 px): conta a visita da página inicial e da busca, sem erro', async () => {
  const { page, log, errors, context } = await newPage(browser, { mobile: true });
  await page.goto(SITE);
  await waitTrack(log, 1);
  await page.goto(`${SITE}perto.html`);
  await waitTrack(log, 2);
  assert.deepEqual(visits(log), [{ p_path: '/' }, { p_path: '/perto.html' }]);
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
