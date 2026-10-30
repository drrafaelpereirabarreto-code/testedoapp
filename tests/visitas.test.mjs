// Testes do contador de visitas próprio (sem cookies e sem dados pessoais):
// - assets/js/visitas.js num navegador de mentira (node:vm): caminho certo, chave pública, nada no aparelho,
//   quando não conta (testes, robôs, Não rastrear/GPC) e window.IMED_TRACK;
// - a regra do banco (supabase/migrations/20261030073000_visitas.sql) aceita todas as páginas do site e os
//   eventos que o site manda; track e admin_stats com as travas certas;
// - o contador em todas as páginas (scripts/aplicar-visitas.mjs e o gerador das cidades);
// - a aba "Visitas" do painel (assets/js/estatisticas.js).
// Rodar com: node --test tests/visitas.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../assets/js/geo-core.js';
import * as V from '../assets/js/estatisticas.js';
import { comVisitas, tagVisitas, paginasComContador, paginasCidades, OUTRAS_FRENTES } from '../scripts/aplicar-visitas.mjs';
import { relDe, paginas } from '../scripts/aplicar-rodape.mjs';
import { generate, UF_NAMES } from '../scripts/gerar-cidades.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const CODE = read('assets/js/visitas.js');
const SQL = read('supabase/migrations/20261030073000_visitas.sql');
const CFG = { supabaseUrl: 'https://pyoqiecupxhdzigjudyd.supabase.co', supabaseAnonKey: 'chave-publica-anon' };
const SITE = 'https://drrafaelpereirabarreto-code.github.io/testedoapp/';
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

// Navegador de mentira: só o que visitas.js usa. Guarda os envios (fetch) e qualquer acesso a cookie ou armazenamento.
function browser({ url = `${SITE}perto.html`, src = `${SITE}assets/js/visitas.js`, pagina = null, nav = {}, win = {}, config = CFG, ready = 'complete', prerendering = false, fetch } = {}) {
  const u = new URL(url);
  const calls = [];
  const on = {};
  const touched = [];
  const spy = (name) => new Proxy({}, { get: (_, k) => { touched.push(`${name}.${String(k)}`); return () => null; } });
  const listen = (pfx) => (type, fn) => { (on[pfx + type] ||= []).push(fn); };
  const document = {
    currentScript: src === null ? null : { src, getAttribute: (k) => (k === 'data-pagina' ? pagina : null) },
    readyState: ready, prerendering, addEventListener: listen('doc:'),
  };
  Object.defineProperty(document, 'cookie', { get() { touched.push('cookie'); return ''; }, set() { touched.push('cookie='); } });
  const g = {
    location: { href: u.href, protocol: u.protocol, hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash },
    navigator: { userAgent: PHONE_UA, webdriver: false, doNotTrack: null, ...nav },
    document, IMED_CONFIG: config, URL,
    fetch: fetch || ((to, o) => { calls.push({ url: to, o, body: JSON.parse(o.body) }); return Promise.resolve({ ok: true, status: 200 }); }),
    addEventListener: listen(''),
    requestIdleCallback: (fn) => fn(),
    setTimeout: (fn) => fn(),
    localStorage: spy('localStorage'), sessionStorage: spy('sessionStorage'), indexedDB: spy('indexedDB'),
    ...win,
  };
  g.window = g;
  vm.createContext(g);
  vm.runInContext(CODE, g);
  const fire = (type, e = {}) => [...(on[type] || [])].forEach((f) => f(e));
  const fireDoc = (type) => [...(on[`doc:${type}`] || [])].forEach((f) => f({}));
  return { g, calls, touched, fire, fireDoc, again: () => vm.runInContext(CODE, g) };
}

test('visita: manda só o caminho da página (sem "?", "#" nem index.html), com a chave pública e sem cookie', () => {
  const cases = [
    [SITE, '/'],
    [`${SITE}index.html?utm_source=x#agenda`, '/'],
    [`${SITE}perto.html?exame=rm&lat=-23.561&lng=-46.657#mapa`, '/perto.html'],
    [`${SITE}perto`, '/perto.html'],
    [`${SITE}local.html?cnes=2077485`, '/local.html'],
    [`${SITE}conta.html#access_token=segredo&refresh_token=x`, '/conta.html'],
    [`${SITE}exames/`, '/exames/'],
    [`${SITE}exames/index.html`, '/exames/'],
    [`${SITE}exames/raio-x.html#preparo`, '/exames/raio-x.html'],
    [`${SITE}cidades/`, '/cidades/'],
    [`${SITE}cidades/sp/sao-paulo/`, '/cidades/sp/sao-paulo/'],
    [`${SITE}cidades/sp/sao-paulo/clinicas.html`, '/cidades/sp/sao-paulo/clinicas.html'],
  ];
  for (const [url, path] of cases) {
    const b = browser({ url });
    assert.equal(b.calls.length, 1, `${url}: uma visita`);
    const [c] = b.calls;
    assert.equal(c.url, 'https://pyoqiecupxhdzigjudyd.supabase.co/rest/v1/rpc/track');
    assert.deepEqual(c.body, { p_path: path }, url);
    assert.equal(c.o.method, 'POST');
    assert.deepEqual({ ...c.o.headers }, { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey, Authorization: `Bearer ${CFG.supabaseAnonKey}` });
    assert.equal(c.o.keepalive, true);
    assert.equal(c.o.credentials, 'omit', 'sem cookie');
    assert.equal(c.o.referrerPolicy, 'no-referrer', 'o banco não recebe o endereço completo da página');
    assert.deepEqual(b.touched, [], 'não lê nem grava cookie, localStorage, sessionStorage ou IndexedDB');
  }
  // Domínio próprio (o site na raiz) e a página 404, que abre em qualquer endereço.
  assert.deepEqual(browser({ url: 'https://imed.com.br/perto.html?x=1', src: 'https://imed.com.br/assets/js/visitas.js' }).calls[0].body, { p_path: '/perto.html' });
  assert.deepEqual(browser({ url: `${SITE}nao-existe/pagina?email=maria@exemplo.com`, pagina: '/404' }).calls[0].body, { p_path: '/404' });
  assert.equal(browser({ url: 'https://drrafaelpereirabarreto-code.github.io/outro-site/x.html' }).calls.length, 0, 'página fora do site não conta');
});

test('visita: uma por página aberta, depois de carregar; de novo só ao voltar pela seta (cache do navegador)', () => {
  const b = browser({ ready: 'interactive' });
  assert.equal(b.calls.length, 0, 'espera a página carregar');
  b.fire('load');
  b.fire('load');
  b.fire('pagehide');
  b.fire('pageshow', { persisted: false });
  assert.equal(b.calls.length, 1);
  b.g.document.readyState = 'complete';
  b.fire('pageshow', { persisted: true });
  assert.equal(b.calls.length, 2, 'voltou pela seta: nova visita');
  // Saiu antes de terminar de carregar: conta na saída (keepalive), uma vez só.
  const early = browser({ ready: 'loading' });
  early.fire('pagehide');
  early.fire('load');
  assert.equal(early.calls.length, 1);
  // Página pré-carregada pelo navegador: só conta quando a pessoa abre.
  const pre = browser({ prerendering: true });
  assert.equal(pre.calls.length, 0);
  pre.g.document.prerendering = false;
  pre.fireDoc('prerenderingchange');
  assert.equal(pre.calls.length, 1);
  // Arquivo carregado duas vezes na mesma página: conta uma vez.
  const twice = browser();
  twice.again();
  assert.equal(twice.calls.length, 1);
});

test('não conta: computador de testes, robôs, "Não rastrear" e GPC; ?visitas=teste liga só nos testes', () => {
  const none = (opts, why) => {
    const b = browser(opts);
    assert.equal(b.calls.length, 0, why);
    assert.equal(b.g.IMED_TRACK('busca_exame', 'rm'), false, `${why}: evento também não`);
    assert.equal(b.calls.length, 0, why);
  };
  for (const url of ['http://localhost:8080/perto.html', 'http://127.0.0.1:8781/', 'http://192.168.0.12/', 'http://10.0.0.5/index.html',
    'http://172.20.1.1/', 'file:///home/rafael/site/index.html', 'http://imed.local/', 'http://[::1]:8000/']) {
    none({ url, src: `${new URL(url).origin === 'null' ? 'file:///home/rafael/site/' : new URL(url).origin + '/'}assets/js/visitas.js` }, url);
  }
  none({ nav: { webdriver: true } }, 'navegador automatizado (testes de ponta a ponta)');
  none({ nav: { userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } }, 'robô do Google');
  none({ nav: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0 Safari/537.36' } }, 'navegador sem tela');
  none({ nav: { userAgent: 'Mozilla/5.0 (Linux; Android 11; moto g power) Chrome-Lighthouse' } }, 'Lighthouse/PageSpeed');
  none({ nav: { doNotTrack: '1' } }, 'Não rastrear');
  none({ win: { doNotTrack: '1' } }, 'Não rastrear (window.doNotTrack)');
  none({ nav: { globalPrivacyControl: true } }, 'GPC');
  none({ url: 'http://127.0.0.1:8781/perto.html?visitas=teste', src: 'http://127.0.0.1:8781/assets/js/visitas.js', nav: { globalPrivacyControl: true } }, 'GPC vale até no teste');
  none({ url: 'http://127.0.0.1:8781/perto.html?xvisitas=teste', src: 'http://127.0.0.1:8781/assets/js/visitas.js' }, 'parâmetro errado');
  // Celular de verdade com "bot" no nome do modelo conta normalmente.
  assert.equal(browser({ nav: { userAgent: 'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' } }).calls.length, 1);
  // ?visitas=teste liga no computador de testes, mesmo no navegador automatizado.
  const t = browser({ url: 'http://127.0.0.1:8781/perto.html?exame=rm&visitas=teste', src: 'http://127.0.0.1:8781/assets/js/visitas.js', nav: { webdriver: true } });
  assert.deepEqual(t.calls.map((c) => c.body), [{ p_path: '/perto.html' }]);
});

test('IMED_TRACK: evento sem dado pessoal, cada busca uma vez por página, e nunca quebra a página', async () => {
  const b = browser();
  b.calls.length = 0;
  const T = b.g.IMED_TRACK;
  assert.equal(T('busca_exame', 'rm'), true);
  assert.deepEqual(b.calls.at(-1).body, { p_path: '/perto.html', p_event: 'busca_exame', p_detail: 'rm' });
  assert.equal(T('busca_exame', 'rm'), false, 'a mesma busca não conta de novo na mesma página');
  assert.equal(T('busca_exame', 'usg'), true);
  assert.equal(T('busca_cidade', '  SP/São   Paulo '), true);
  assert.equal(b.calls.at(-1).body.p_detail, 'SP/São Paulo');
  assert.equal(T('pedido_enviado', 'rm'), true);
  assert.equal(T('pedido_enviado', 'rm'), true, 'dois pedidos são dois pedidos');
  assert.equal(T('teleconsulta_iniciada'), true);
  assert.deepEqual(b.calls.at(-1).body, { p_path: '/perto.html', p_event: 'teleconsulta_iniciada' }, 'sem detalhe: nem manda o campo');
  const n = b.calls.length;
  assert.equal(T('busca_cidade', 'maria@exemplo.com'), false, 'e-mail');
  assert.equal(T('busca_cidade', '11 98765-4321'), false, 'celular');
  assert.equal(T('pedido_enviado', '11987654321'), false, 'telefone');
  assert.equal(T('pedido_enviado', '52998224725'), false, 'CPF');
  assert.equal(T('busca_cidade', '01310-200'), false, 'CEP');
  assert.equal(T('pedido_enviado', 'x'.repeat(81)), false, 'comprido demais');
  assert.equal(T('Busca Exame', 'rm'), false, 'nome de evento fora do formato');
  assert.equal(T(123), false);
  assert.equal(b.calls.length, n);
  // No máximo 40 eventos por página aberta.
  const many = browser();
  for (let i = 0; i < 60; i += 1) many.g.IMED_TRACK('pedido_enviado', 'rm');
  assert.equal(many.calls.length, 1 + 40);
  // Falhas: fetch que estoura, que falha depois, banco sem config — nada quebra.
  const boom = browser({ fetch: () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(boom.g.IMED_TRACK('pedido_enviado', 'rm'), false);
  let unhandled = 0;
  const onUnhandled = () => { unhandled += 1; };
  process.on('unhandledRejection', onUnhandled);
  const offline = browser({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
  assert.equal(offline.g.IMED_TRACK('busca_exame', 'rm'), true);
  await new Promise((r) => setTimeout(r, 20));
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled, 0, 'erro de rede não vira erro solto na página');
  const noCfg = browser({ config: null });
  assert.equal(noCfg.calls.length, 0);
  assert.equal(noCfg.g.IMED_TRACK('busca_exame', 'rm'), false);
});

/* ------------------------- banco: a migração ------------------------- */
const fnBody = (name) => {
  const i = SQL.indexOf(`create or replace function ${name}(`);
  assert.ok(i >= 0, `${name} existe na migração`);
  return SQL.slice(i, SQL.indexOf('$$;', SQL.indexOf('as $$', i)) + 3);
};
const arr = (s) => [...s.matchAll(/'([^']*)'/g)].map((m) => m[1]);

// Regra de páginas do banco (private.visit_path), refeita aqui com as expressões tiradas da própria migração.
const VP = fnBody('private.visit_path');
const PATS = [...VP.matchAll(/p ~ '([^']+)'/g)].map((m) => m[1]);
const UFS = arr(VP.match(/array\[([^\]]+)\]/)[1]);
function serverPath(p) {
  const q = String(p ?? '').trim().slice(0, 200).replace(/\/index\.html$/, '/');
  if (q.length < 1 || q.length > 120 || new RegExp(PATS[0]).test(q)) return null;
  if (q === '/404' || q === '/cidades/') return q;
  if (new RegExp(PATS[1]).test(q) || new RegExp(PATS[2]).test(q)) return q;
  if (new RegExp(PATS[3]).test(q) && UFS.includes(q.slice(9, 11).toUpperCase())) return q;
  return null;
}

test('banco: track só soma 1, sem dado pessoal; admin_stats só para a equipe do IMED', () => {
  assert.deepEqual(PATS.length, 4, 'regra de páginas: dígitos, raiz, exames e cidades');
  assert.equal(PATS[0], '[0-9]{5}');
  assert.deepEqual([...UFS].sort(), Object.keys(UF_NAMES).sort(), 'as 27 UFs');
  const track = fnBody('public.track');
  assert.match(track, /^create or replace function public\.track\(p_path text, p_event text default null, p_detail text default null\)\nreturns boolean/);
  const stats = fnBody('public.admin_stats');
  for (const [name, body] of [['track', track], ['admin_stats', stats]]) {
    assert.match(body, /security definer/, `${name}: security definer`);
    assert.match(body, /set search_path = ''/, `${name}: search_path fixo`);
  }
  assert.match(track, /set views = views \+ 1/);
  assert.match(track, /set total = total \+ 1/);
  assert.match(track, /values \(v_day, v_path, 1\)/);
  assert.match(track, /values \(v_day, v_event, v_detail, 1\)/);
  assert.match(track, />= 3000 then return false/, 'teto de páginas novas por dia');
  assert.match(track, />= 2000 then return false/, 'teto de eventos novos por dia');
  assert.match(track, /from public\.municipalities m where m\.uf = left\(v_detail, 2\) and m\.name = substr\(v_detail, 4\)/, 'cidade só se existir');
  assert.match(stats, /if not coalesce\(public\.is_imed_admin\(\), false\) then\s+raise exception 'forbidden' using errcode = '42501'/);
  assert.match(SQL, /revoke all on function public\.track\(text, text, text\) from public;\ngrant execute on function public\.track\(text, text, text\) to anon, authenticated;/);
  assert.match(SQL, /revoke all on function public\.admin_stats\(integer\) from public, anon;\ngrant execute on function public\.admin_stats\(integer\) to authenticated;/);
  assert.match(SQL, /revoke all on schema private from public, anon, authenticated;/);
  for (const t of ['page_views_daily', 'site_events_daily']) {
    assert.match(SQL, new RegExp(`alter table private\\.${t} enable row level security;`));
    assert.match(SQL, new RegExp(`revoke all on table private\\.${t} from public, anon, authenticated;`));
  }
  // Só dia, página/evento, detalhe e total: nenhuma coluna para IP, aparelho, conta, sessão ou identificador.
  const cols = (t) => SQL.slice(SQL.indexOf(`create table if not exists private.${t} (`)).split('\n);')[0].split('\n').slice(1)
    .map((l) => l.trim().split(/\s+/)[0]).filter((c) => c && c !== 'primary');
  assert.deepEqual(cols('page_views_daily'), ['day', 'path', 'views']);
  assert.deepEqual(cols('site_events_daily'), ['day', 'event', 'detail', 'total']);
  const code = SQL.replace(/--.*$/gm, '').replace(/comment on [^;]+;/g, '');
  assert.ok(!/\binet\b|user_agent|\bip\b|user_id|session|cookie|fingerprint|auth\.uid|auth\.jwt/i.test(code), 'nada de IP, navegador, conta ou sessão no SQL');
  assert.ok(!/\b(drop|delete from|truncate)\b/i.test(code), 'não apaga nada');
});

test('contrato: o banco aceita todas as páginas do site e os eventos que o site manda', () => {
  const all = [...paginas(), ...paginasCidades()];
  assert.ok(all.length > 100);
  for (const f of all) {
    const p = browser({ url: SITE + f.replace(/(^|\/)index\.html$/, '$1'), pagina: f === '404.html' ? '/404' : null }).calls[0]?.body.p_path;
    assert.ok(p, `${f}: o contador manda o caminho`);
    assert.equal(serverPath(p), p, `${f}: o banco aceita ${p}`);
  }
  for (const bad of ['/perto.html?x=1', '/perto.html#y', '/Perto.html', '/cidades/xx/sao-paulo/', '/cidades/sp/sao-paulo/outra.html',
    '/a/b.html', '/maria@exemplo.com', '/joao-11987654321.html', `/${'a'.repeat(130)}.html`, '', 'perto.html']) {
    assert.equal(serverPath(bad), null, `recusa ${bad}`);
  }
  assert.equal(serverPath('/index.html'), '/');
  // Eventos chamados pelo site (perto.js, local.js, inicio.js) estão na lista do banco.
  const ED = fnBody('private.visit_event_detail');
  const events = new Set();
  for (const f of readdirSync(join(ROOT, 'assets/js')).filter((x) => x.endsWith('.js'))) {
    for (const m of read(`assets/js/${f}`).matchAll(/(?:IMED_TRACK\?\.|\btrack)\('([a-z_]+)'/g)) events.add(m[1]);
  }
  for (const e of ['busca_cidade', 'busca_exame', 'busca_tipo', 'pedido_enviado']) assert.ok(events.has(e), `o site conta ${e}`);
  for (const e of [...events, 'teleconsulta_iniciada']) assert.match(ED, new RegExp(`p_event = '${e}'`), `${e}: está na lista do banco`);
  const list = (ev) => arr(ED.match(new RegExp(`p_event = '${ev}'[^\\n]*?(?:\\n[^\\n]*?)?any \\(array\\[([^\\]]+)\\]`))[1]);
  assert.deepEqual(list('busca_exame'), Object.keys(G.EXAMS));
  assert.deepEqual(list('busca_tipo'), Object.keys(G.KINDS));
  assert.deepEqual(list('pedido_enviado'), ['', ...Object.keys(G.EXAMS), 'consulta', 'outro']);
  // Cidade da busca: "UF/Cidade" vinda do servidor ou do estabelecimento mais próximo; nada da posição.
  assert.equal(G.searchCity({ status: 'done', city: 'São Paulo', uf: 'SP' }, []), 'SP/São Paulo');
  assert.equal(G.searchCity({ status: 'loading', city: null, uf: null }, [{ city: 'Santa Bárbara d\'Oeste', uf: 'sp' }]), "SP/Santa Bárbara d'Oeste");
  assert.equal(G.searchCity(null, [{ city: null }, { city: 'Campinas', uf: 'SP' }]), 'SP/Campinas');
  assert.equal(G.searchCity(null, [{ lat: -23.5, lng: -46.6 }]), '');
  assert.equal(G.searchCity({ city: 'a/b', uf: 'SP' }), '');
  assert.equal(G.searchCity({ city: 'Rio', uf: 'Rio de Janeiro' }), '');
});

test('o contador está em todas as páginas, logo depois do config.js (404 com o caminho absoluto)', (t) => {
  const pages = paginasComContador();
  assert.ok(pages.includes('index.html') && pages.includes('404.html') && pages.includes('exames/raio-x.html') && pages.includes('cidades/index.html'));
  for (const f of pages) {
    const html = read(f);
    const rel = relDe(f);
    const tag = tagVisitas(rel, f);
    assert.equal((html.match(/assets\/js\/visitas\.js/g) || []).length, 1, `${f}: o contador uma vez`);
    assert.match(html, new RegExp(`<script src="${rel.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}assets/js/config\\.js"[^>]*></script>\\n${tag.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`), `${f}: logo depois do config.js (rode node scripts/aplicar-visitas.mjs)`);
    assert.equal(comVisitas(html, rel, f), html, `${f}: em dia`);
  }
  assert.match(read('404.html'), /<script src="\/testedoapp\/assets\/js\/visitas\.js" data-pagina="\/404" defer><\/script>/);
  assert.match(read('sobre.html'), /<script src="assets\/js\/config\.js" defer><\/script>\n<script src="assets\/js\/visitas\.js" defer><\/script>\n/);
  // As páginas de outras frentes ficam de fora até a frente liberar (a teleconsulta põe o dela).
  assert.deepEqual(OUTRAS_FRENTES, ['teleconsulta.html', 'medico.html', 'termo-teleconsulta.html']);
  // comVisitas: põe uma vez, troca a versão antiga e põe o config.js quando a página não tem.
  const sem = '<html><body><main></main>\n</body></html>';
  const com = comVisitas(sem, '../');
  assert.equal(com, '<html><body><main></main>\n<script src="../assets/js/config.js" defer></script>\n<script src="../assets/js/visitas.js" defer></script>\n</body></html>');
  assert.equal(comVisitas(com, '../'), com);
  const velho = '<body>\n<script src="assets/js/config.js"></script>\n<script src="x/assets/js/visitas.js" async></script>\n</body>';
  assert.equal(comVisitas(velho, ''), '<body>\n<script src="assets/js/config.js"></script>\n<script src="assets/js/visitas.js" defer></script>\n</body>');
  // Página 404 depois de trocar o domínio (o site passa a morar na raiz "/"): os dois caminhos são corrigidos.
  const p404 = read('404.html');
  const novo = comVisitas(p404, '/', '404.html');
  assert.match(novo, /<script src="\/assets\/js\/config\.js" defer><\/script>\n<script src="\/assets\/js\/visitas\.js" data-pagina="\/404" defer><\/script>/);
  assert.ok(!novo.includes('/testedoapp/assets/js/config.js') && !novo.includes('/testedoapp/assets/js/visitas.js'));
  assert.equal(comVisitas(novo, '/', '404.html'), novo);
  // O gerador das cidades já põe o contador nas páginas novas.
  const out = mkdtempSync(join(tmpdir(), 'imed-visitas-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const cities = [{ ibge: 3550308, name: 'São Paulo', uf: 'SP', total: 10, imagem: 2, laboratorio: 2, clinica: 4, hospital: 2 }];
  const { written } = generate({ cities, base: 'https://exemplo.com.br/', date: '2026-10-30', out, examPages: [] });
  for (const f of written.filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(join(out, f), 'utf8');
    assert.ok(html.includes(`<script src="${relDe(f)}assets/js/config.js"></script>\n${tagVisitas(relDe(f))}`), `${f}: gerada com o contador`);
  }
});

/* ------------------------- aba Visitas do painel ------------------------- */
const RAW = {
  dias: 7, de: '2026-10-24', ate: '2026-10-30', visitas: 1260,
  por_dia: [{ dia: '2026-10-30', visitas: 60 }, { dia: '2026-10-25', visitas: '200' }, { dia: '2026-10-27', visitas: 1000 }, { dia: 'ontem', visitas: 5 }],
  paginas: [{ pagina: '/perto.html', visitas: 700 }, { pagina: '/', visitas: 400 }, { pagina: '/cidades/sp/sao-paulo/clinicas.html', visitas: 100 }, { pagina: '/<b>x</b>.html', visitas: 60 }, { pagina: 7 }],
  exames: [{ exame: 'rm', total: 12 }, { exame: 'lab', total: 3 }],
  tipos: [{ tipo: 'imagem', total: 4 }],
  cidades: [{ cidade: 'SP/São Paulo', total: 9 }, { cidade: 'RJ/<img src=x>', total: 1 }],
  pedidos: [{ exame: '', total: 1 }, { exame: 'rm', total: 2 }],
  eventos: { busca_exame: 15, busca_cidade: 10, pedido_enviado: 3, teleconsulta_iniciada: 'x' },
};

test('aba Visitas: números do banco viram série completa, rótulos e eixo redondo', () => {
  const s = V.normalizeStats(RAW, 7);
  assert.equal(s.dias, 7);
  assert.equal(s.visitas, 1260);
  assert.deepEqual(s.porDia.map((x) => `${x.dia.slice(8)}:${x.visitas}`), ['24:0', '25:200', '26:0', '27:1000', '28:0', '29:0', '30:60'], 'todos os dias, em ordem, com 0');
  assert.equal(s.paginas.length, 4, 'linha sem caminho fica de fora');
  assert.deepEqual(s.eventos, { busca_exame: 15, busca_cidade: 10, pedido_enviado: 3, teleconsulta_iniciada: 0 });
  assert.deepEqual(V.normalizeStats(null, 30), { dias: 30, de: '', ate: '', visitas: 0, porDia: [], paginas: [], exames: [], tipos: [], cidades: [], pedidos: [], eventos: {} });
  assert.deepEqual(V.niceTicks(0), [0, 1]);
  assert.deepEqual(V.niceTicks(1), [0, 1]);
  assert.deepEqual(V.niceTicks(3), [0, 1, 2, 3]);
  assert.deepEqual(V.niceTicks(7), [0, 2, 4, 6, 8]);
  assert.deepEqual(V.niceTicks(40), [0, 10, 20, 30, 40]);
  assert.deepEqual(V.niceTicks(1234), [0, 500, 1000, 1500]);
  assert.equal(V.pageLabel('/'), 'Página inicial');
  assert.equal(V.pageLabel('/perto.html'), 'Perto de mim (busca)');
  assert.equal(V.pageLabel('/exames/ressonancia-magnetica.html'), 'Guia: Ressonância');
  assert.equal(V.pageLabel('/cidades/sp/sao-jose-dos-campos/'), 'Cidade: Sao Jose dos Campos - SP');
  assert.equal(V.pageLabel('/cidades/sp/santa-barbara-d-oeste/hospitais.html'), 'Hospitais em Santa Barbara d Oeste - SP');
  assert.equal(V.pageLabel('/404'), 'Página não encontrada (404)');
  assert.equal(V.pageLabel('/pagina-nova.html'), 'Pagina Nova');
  assert.equal(V.cityLabel('SP/São Paulo'), 'São Paulo - SP');
  assert.deepEqual(['rm', 'lab', 'consulta', 'outro', ''].map(V.examLabel), ['Ressonância', 'Exames de laboratório', 'Consulta', 'Outro atendimento', 'Não informado']);
  assert.equal(V.kindLabel('imagem'), 'Diagnóstico por imagem');
});

test('aba Visitas: HTML com números, gráfico acessível e tudo escapado', () => {
  const html = V.statsHtml(V.normalizeStats(RAW, 7));
  assert.match(html, /<span>Visitas<\/span><b>1\.260<\/b><small>de 24\/10 a 30\/10<\/small>/);
  assert.match(html, /<span>Média por dia<\/span><b>180<\/b>/);
  assert.match(html, /<span>Pedidos enviados<\/span><b>3<\/b>/);
  assert.match(html, /<span>Teleconsultas iniciadas<\/span><b>0<\/b>/);
  assert.match(html, /role="img" aria-label="Visitas por dia, de 24\/10 a 30\/10: 1\.260 visitas no total; o dia com mais foi 27\/10, com 1\.000\."/);
  assert.equal((html.match(/class="vs-peak"/g) || []).length, 1, 'só o maior dia com o número em cima');
  assert.equal((html.match(/class="vs-bar"/g) || []).length, 3, 'dia sem visita não tem coluna');
  assert.match(html, /title="ter, 27\/10: 1\.000 visitas"/);
  assert.match(html, /title="sex, 30\/10: 60 visitas \(hoje, até agora\)"/);
  assert.match(html, /<span>hoje<\/span>/);
  assert.match(html, /Ver os números de cada dia/);
  assert.match(html, /<td>Perto de mim \(busca\)<small>\/perto\.html<\/small><\/td><td class="n">700<\/td>/);
  assert.match(html, /<td>Clínicas em Sao Paulo - SP<small>\/cidades\/sp\/sao-paulo\/clinicas\.html<\/small>/);
  assert.match(html, /<td>Ressonância<\/td><td class="n">12<\/td>/);
  assert.match(html, /<td>São Paulo - SP<\/td><td class="n">9<\/td>/);
  assert.match(html, /<td>Não informado<\/td><td class="n">1<\/td>/);
  assert.ok(!/<b>x<\/b>|<img/.test(html), 'caminho e cidade vindos do banco são escapados');
  assert.match(html, /&lt;img src=x&gt; - RJ/);
  // 30 dias: rótulo do dia só uma vez por semana (contando de hoje para trás).
  const porDia = Array.from({ length: 30 }, (_, i) => ({ dia: `2026-10-${String(i + 1).padStart(2, '0')}`, visitas: i }));
  const chart = V.chartHtml(porDia);
  assert.equal((chart.match(/<li><span>/g) || []).length, 5, 'rótulos: 30/10 (hoje), 23, 16, 9 e 2/10');
  // Sem visitas no período: aviso no lugar do gráfico.
  const empty = V.statsHtml(V.normalizeStats({ dias: 7, de: '2026-10-24', ate: '2026-10-30', visitas: 0, por_dia: [] }, 7));
  assert.match(empty, /Ainda não há visitas contadas neste período\./);
  assert.ok(!empty.includes('vs-chart'));
  assert.match(empty, /Nenhuma busca por exame ainda\./);
});
