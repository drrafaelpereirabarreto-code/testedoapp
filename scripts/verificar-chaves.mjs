// Conferência de verdade das chaves novas do Supabase (fase 0.1 do iMed Agenda), contra a PRODUÇÃO.
// Roda no GitHub (.github/workflows/chaves.yml), porque é de lá que o supabase.co abre. Só lê: nada é gravado no
// banco (as escritas do site ficam bloqueadas no navegador, veja a parte c).
//
// (a) A API do Supabase com a chave publishable SÓ no cabeçalho "apikey" (sem Authorization), em funções públicas de
//     leitura: imported_cities, establishment_points, nearby_establishments e nearby_clinics perto da Av. Paulista,
//     request_status com ids que não existem, cnes_last_update, city_establishments de São Paulo, place_ratings e
//     tele_doc_verify com um código que não existe; a tabela de estabelecimentos (REST) e o login (Auth).
// (b) A Edge Function clinicas-proximas do jeito novo (só a publishable no "apikey"). Enquanto ela estiver publicada
//     com verify_jwt=true, o Supabase recusa antes de a função rodar (401): vira AVISO "aguardando o deploy", sem
//     reprovar o resto.
// (c) O site DESTE ramo, servido daqui por um servidor simples, aberto num Chromium de verdade e sem simulação de
//     rede: página inicial (localização na Av. Paulista), perto.html?exame=rm, a página de um local real (o CNES vem
//     da parte a) e a página de uma cidade. Confere os dados reais na tela, nenhuma chamada ao supabase.co com erro e
//     nenhum erro no console. O navegador abre o endereço do site publicado (github.io), mas cada arquivo vem do
//     servidor local: assim a origem é a mesma da produção (a função só atende os sites permitidos).
//
// Cada falha vira uma anotação "::error" (dá para ler pela API do GitHub, sem abrir o registro), cada pendência um
// "::warning" e o resumo de cada parte um "::notice"; tudo também vai para o resumo da execução.
// Uso: node scripts/verificar-chaves.mjs [--partes=a,b,c] [--porta=4870]
import http from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (nome, padrao) => {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a ? a.slice(nome.length + 3) : padrao;
};
const PARTES = new Set(arg('partes', 'a,b,c').split(',').map((s) => s.trim()));
const PORTA = Number(arg('porta', '4870'));

// Tudo vem do config.js do ramo: o mesmo endereço e a mesma chave que o site usa.
const CONFIG = readFileSync(join(ROOT, 'assets/js/config.js'), 'utf8');
const pega = (nome) => CONFIG.match(new RegExp(`${nome}:\\s*'([^']+)'`))?.[1] ?? '';
const SUPABASE = pega('supabaseUrl');
const FUNCOES = pega('functionsUrl');
const CHAVE = pega('supabaseKey');
const SITE = pega('siteUrl'); // https://drrafaelpereirabarreto-code.github.io/testedoapp/
const ORIGEM = new URL(SITE).origin;
const PAULISTA = { lat: -23.565, lng: -46.652 }; // o mesmo ponto da página inicial (arredondado, ~110 m)
const SAO_PAULO = 3550308; // código IBGE

/* ======================= registro dos resultados ======================= */
const resultados = []; // { parte, nome, estado: 'ok' | 'falhou' | 'aguardando' | 'aviso', detalhe }
const registra = (parte, nome, estado, detalhe = '') => {
  resultados.push({ parte, nome, estado, detalhe: String(detalhe) });
  const marca = { ok: 'ok', falhou: 'FALHOU', aguardando: 'AGUARDANDO', aviso: 'AVISO' }[estado];
  console.log(`[${parte}] ${marca} - ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};
// Texto de anotação do GitHub: "%", quebra de linha e "\r" viram código (senão cortam a mensagem); no título, também
// ":" e "," (separam as propriedades da anotação).
const anota = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const anotaTitulo = (s) => anota(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
// Motivo de uma chamada sem resposta (o "fetch failed" do Node esconde a causa em e.cause).
const motivoRede = (e) => [e?.message, e?.cause?.code, e?.cause?.message].filter(Boolean).join(': ');
const curto = (v, n = 160) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…` : s; };

/* ======================= (a) API com a chave publishable só no apikey ======================= */
async function chama(caminho, { metodo = 'POST', corpo, cabecalhos = {} } = {}) {
  const inicio = Date.now();
  const res = await fetch(`${SUPABASE}${caminho}`, {
    method: metodo,
    headers: { apikey: CHAVE, ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...cabecalhos },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const texto = await res.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
  return { status: res.status, dados, ms: Date.now() - inicio };
}

const dadosA = { perto: [], cnes: null, nomeCnes: '', cidade: [] };
async function parteA() {
  const P = 'a';
  // Cada item: nome, chamada, conferência dos dados (devolve '' se ok, ou o motivo).
  const itens = [
    ['imported_cities (cidades importadas)', () => chama('/rest/v1/rpc/imported_cities', { corpo: {} }), (d) => {
      if (!Array.isArray(d) || !d.length) return 'nenhuma cidade';
      const sp = d.find((c) => Number(c.ibge) === SAO_PAULO);
      if (!sp || Number(sp.total) < 1000) return 'São Paulo ausente ou com menos de 1.000 estabelecimentos';
      return `ok: ${d.length} cidades; São Paulo com ${sp.total}`;
    }],
    ['establishment_points (pontos perto da Av. Paulista)', () => chama('/rest/v1/rpc/establishment_points', { corpo: { p_lat: PAULISTA.lat, p_lng: PAULISTA.lng, p_radius_m: 2000, p_limit: 200 } }), (d) => {
      if (!Array.isArray(d) || !d.length) return 'nenhum ponto';
      return `ok: ${d.length} pontos em 2 km`;
    }],
    ['nearby_establishments (CNES perto da Av. Paulista)', () => chama('/rest/v1/rpc/nearby_establishments', { corpo: { p_lat: PAULISTA.lat, p_lng: PAULISTA.lng, p_radius_m: 2000, p_limit: 60 } }), (d) => {
      if (!Array.isArray(d) || !d.length) return 'nenhum estabelecimento';
      const bons = d.filter((r) => /^\d{7}$/.test(String(r.cnes ?? '')) && String(r.name ?? '').trim());
      if (bons.length !== d.length) return 'linha sem CNES ou sem nome';
      const dist = d.map((r) => Number(r.distance_m));
      if (dist.some((x, i) => !Number.isFinite(x) || (i && x < dist[i - 1]))) return 'distâncias fora de ordem';
      dadosA.perto = d;
      // Para a parte c: um local de verdade, o mais perto com coordenada.
      const com = d.find((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng))) ?? d[0];
      dadosA.cnes = String(com.cnes);
      dadosA.nomeCnes = String(com.name).trim();
      return `ok: ${d.length} locais; o mais perto: ${d[0].name} (${d[0].distance_m} m)`;
    }],
    ['nearby_clinics (parceiros perto da Av. Paulista)', () => chama('/rest/v1/rpc/nearby_clinics', { corpo: { p_lat: PAULISTA.lat, p_lng: PAULISTA.lng, p_radius_m: 5000, p_include_demo: false, p_limit: 10 } }), (d) => {
      if (!Array.isArray(d)) return 'resposta não é lista';
      return `ok: ${d.length} parceiro(s) publicado(s) em 5 km`;
    }],
    ['request_status (pedido que não existe)', () => chama('/rest/v1/rpc/request_status', { corpo: { p_ids: ['00000000-0000-4000-8000-000000000000'], p_tokens: ['0'.repeat(64)] } }), (d) => {
      if (!Array.isArray(d) || d.length) return `esperava lista vazia, veio ${curto(d)}`;
      return 'ok: lista vazia';
    }],
    ['cnes_last_update (data da última importação)', () => chama('/rest/v1/rpc/cnes_last_update', { corpo: {} }), (d) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return `esperava uma data, veio ${curto(d)}`;
      return `ok: ${d}`;
    }],
    ['city_establishments (São Paulo)', () => chama('/rest/v1/rpc/city_establishments', { corpo: { p_city: SAO_PAULO, p_kind: null, p_limit: 60, p_offset: 0 } }), (d) => {
      if (!Array.isArray(d) || d.length < 10) return `esperava 10 ou mais, vieram ${Array.isArray(d) ? d.length : curto(d)}`;
      dadosA.cidade = d;
      return `ok: ${d.length} na 1ª página`;
    }],
    ['tele_doc_verify (código que não existe)', () => chama('/rest/v1/rpc/tele_doc_verify', { corpo: { p_code: 'ZZZZZZZZZZ' } }), (d) => {
      if (!Array.isArray(d) || d.length) return `esperava lista vazia, veio ${curto(d)}`;
      return 'ok: lista vazia';
    }],
    ['Auth: /auth/v1/settings (login)', () => chama('/auth/v1/settings', { metodo: 'GET' }), (d) => {
      if (!d || typeof d !== 'object' || !('external' in d)) return `resposta inesperada: ${curto(d)}`;
      return `ok: login por e-mail ${d.external?.email ? 'ligado' : 'desligado'}`;
    }],
  ];
  for (const [nome, chamar, confere] of itens) {
    try {
      const r = await chamar();
      if (r.status !== 200) { registra(P, nome, 'falhou', `HTTP ${r.status}: ${curto(r.dados)}`); continue; }
      const motivo = confere(r.dados);
      registra(P, nome, motivo.startsWith('ok') ? 'ok' : 'falhou', `${motivo} (${r.ms} ms)`);
    } catch (e) {
      registra(P, nome, 'falhou', `sem resposta: ${motivoRede(e)}`);
    }
  }
  // Depois de saber um CNES de verdade: a tabela (REST) e as notas do local.
  if (dadosA.cnes) {
    try {
      const r = await chama(`/rest/v1/establishments?select=cnes,name&cnes=eq.${dadosA.cnes}`, { metodo: 'GET' });
      const ok = r.status === 200 && Array.isArray(r.dados) && r.dados.length === 1 && String(r.dados[0].name).trim() === dadosA.nomeCnes;
      registra(P, `establishments (tabela, CNES ${dadosA.cnes})`, ok ? 'ok' : 'falhou', ok ? `ok: ${dadosA.nomeCnes} (${r.ms} ms)` : `HTTP ${r.status}: ${curto(r.dados)}`);
      const n = await chama('/rest/v1/rpc/place_ratings', { corpo: { p_keys: [`cnes:${dadosA.cnes}`] } });
      registra(P, 'place_ratings (notas do local)', n.status === 200 && Array.isArray(n.dados) ? 'ok' : 'falhou', n.status === 200 ? `ok: ${n.dados.length} nota(s) (${n.ms} ms)` : `HTTP ${n.status}: ${curto(n.dados)}`);
    } catch (e) {
      registra(P, 'establishments (tabela)', 'falhou', `sem resposta: ${motivoRede(e)}`);
    }
  } else {
    registra(P, 'establishments (tabela)', 'falhou', 'sem CNES da busca perto da Av. Paulista');
  }
  // Só para registro (não reprova): a regra que motivou a troca. A chave nova em "Authorization: Bearer" e a
  // chamada sem chave nenhuma.
  try {
    const bearer = await chama('/rest/v1/rpc/cnes_last_update', { corpo: {}, cabecalhos: { Authorization: `Bearer ${CHAVE}` } });
    const sem = await fetch(`${SUPABASE}/rest/v1/rpc/cnes_last_update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000) });
    registra(P, 'registro: chave também no Authorization, e chamada sem chave', 'ok',
      `chave publishable também em "Authorization: Bearer" → HTTP ${bearer.status}${bearer.status >= 400 ? ` (${curto(bearer.dados, 80)})` : ''}; sem chave → HTTP ${sem.status}. O site não usa nenhuma das duas.`);
  } catch (e) {
    registra(P, 'registro: chave também no Authorization, e chamada sem chave', 'ok', `não deu para registrar: ${motivoRede(e)}`);
  }
}

/* ======================= (b) Edge Function clinicas-proximas do jeito novo ======================= */
// true: a função atende com a chave publishable sozinha no apikey (a parte c trata erro dela como falha);
// false: recusou (401), e na parte c os erros dela viram "aguardando o deploy"; null: a parte b não rodou.
let funcaoAceita = null;
async function funcao(corpo, { chave = CHAVE, origem = ORIGEM } = {}) {
  const inicio = Date.now();
  const res = await fetch(`${FUNCOES}/clinicas-proximas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(chave ? { apikey: chave } : {}), ...(origem ? { Origin: origem } : {}) },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(30000),
  });
  const texto = await res.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
  return { status: res.status, dados, ms: Date.now() - inicio, cors: res.headers.get('access-control-allow-origin') };
}
const AGUARDA = 'aguardando o deploy: a função recusou a chave publishable sozinha no apikey (a conferência automática verify_jwt=true não entende a chave nova)';

async function parteB() {
  const P = 'b';
  let st;
  try {
    st = await funcao({ action: 'status' });
  } catch (e) {
    registra(P, 'status (só a publishable no apikey)', 'falhou', `sem resposta: ${motivoRede(e)}`);
    return;
  }
  if (st.status === 401) {
    funcaoAceita = false;
    registra(P, 'clinicas-proximas com a chave nova', 'aguardando', `${AGUARDA} (HTTP 401: ${curto(st.dados, 120)}). Publique com --no-verify-jwt e rode esta conferência de novo.`);
    return;
  }
  funcaoAceita = true;
  registra(P, 'status (só a publishable no apikey)', st.status === 200 && st.dados?.ok === true ? 'ok' : 'falhou',
    st.status === 200 ? `ok: serviço de mapas ${st.dados?.provider} (${st.ms} ms); CORS ${st.cors ?? 'sem cabeçalho'}` : `HTTP ${st.status}: ${curto(st.dados)}`);
  // Que chaves a própria função usa (a função nova diz "nova", "antiga" ou "ausente"; nunca a chave).
  const ch = st.dados?.chaves;
  if (!ch) {
    registra(P, 'versão publicada da função', 'aguardando', 'aguardando o deploy: a função no ar ainda é a antiga (o "status" não diz quais chaves usa). Ela já atendeu a chave publishable sozinha mesmo com verify_jwt=true, mas a documentação manda publicar com --no-verify-jwt: publique a versão deste ramo');
  } else {
    const novas = ch.publishable === 'nova' && ch.secreta === 'nova';
    registra(P, 'chaves em uso na função', novas ? 'ok' : 'aviso', novas
      ? 'ok: publishable e secreta novas (SUPABASE_PUBLISHABLE_KEYS e SUPABASE_SECRET_KEYS)'
      : `publishable: ${ch.publishable}, secreta: ${ch.secreta}. Antes de desligar as chaves antigas, confira em Edge Functions → Secrets se SUPABASE_PUBLISHABLE_KEYS e SUPABASE_SECRET_KEYS existem`);
  }
  try {
    const s = await funcao({ action: 'search', lat: PAULISTA.lat, lng: PAULISTA.lng, radius_m: 2000, include_demo: false });
    const cnes = Array.isArray(s.dados?.cnes) ? s.dados.cnes : [];
    const ok = s.status === 200 && s.dados?.ok === true && cnes.length > 0;
    registra(P, 'search perto da Av. Paulista', ok ? 'ok' : 'falhou',
      ok ? `ok: ${cnes.length} do CNES, ${(s.dados.imed || []).length} parceiro(s), cobertura ${s.dados.coverage?.status} (${s.ms} ms)${s.dados.warnings?.length ? `; avisos: ${s.dados.warnings.join(', ')}` : ''}` : `HTTP ${s.status}: ${curto(s.dados)}`);
    if (ok && !s.dados.coverage?.city) {
      // A cidade vem do importador (importar-clinicas), que a busca chama com a chave secreta.
      registra(P, 'importador respondeu à busca', 'aviso', 'a busca não trouxe a cidade do importador: confira se a importar-clinicas nova foi publicada (ela aceita a chave secreta no apikey)');
    } else if (ok) {
      registra(P, 'importador respondeu à busca (chave secreta)', 'ok', `ok: ${s.dados.coverage.city}/${s.dados.coverage.uf}`);
    }
  } catch (e) {
    registra(P, 'search perto da Av. Paulista', 'falhou', `sem resposta: ${motivoRede(e)}`);
  }
  try {
    const g = await funcao({ action: 'geocode', q: 'Campinas, SP' });
    const ok = g.status === 200 && Number.isFinite(g.dados?.lat) && Number.isFinite(g.dados?.lng);
    registra(P, 'geocode (Campinas)', ok ? 'ok' : 'falhou', ok ? `ok: ${g.dados.label} (${g.ms} ms)` : `HTTP ${g.status}: ${curto(g.dados)}`);
  } catch (e) {
    registra(P, 'geocode (Campinas)', 'falhou', `sem resposta: ${motivoRede(e)}`);
  }
  // A autorização feita no código (verify_jwt=false): sem chave, 401; outro site no navegador, 403.
  try {
    const sem = await funcao({ action: 'status' }, { chave: '' });
    registra(P, 'sem chave nenhuma: recusa (401)', sem.status === 401 ? 'ok' : 'falhou', `HTTP ${sem.status}: ${curto(sem.dados, 100)}`);
    const outro = await funcao({ action: 'status' }, { origem: 'https://exemplo.com' });
    registra(P, 'outro site no navegador: recusa (403)', outro.status === 403 ? 'ok' : 'falhou', `HTTP ${outro.status}: ${curto(outro.dados, 100)}`);
  } catch (e) {
    registra(P, 'recusas da função', 'falhou', `sem resposta: ${motivoRede(e)}`);
  }
}

/* ======================= (c) o site deste ramo num navegador de verdade ======================= */
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
const BASE_PATH = new URL(SITE).pathname; // "/testedoapp/"

// Servidor estático simples, como o GitHub Pages: o site mora em /testedoapp/ e o que não existe recebe o 404.html.
function servidor() {
  const srv = http.createServer(async (req, res) => {
    let caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!caminho.startsWith(BASE_PATH)) { res.writeHead(404).end(); return; }
    caminho = caminho.slice(BASE_PATH.length - 1);
    let arquivo = normalize(join(ROOT, caminho));
    if (!arquivo.startsWith(ROOT) || /[\\/](\.git|\.github|node_modules|memory|tests|scripts|supabase)([\\/]|$)/.test(arquivo.slice(ROOT.length - 1))) { res.writeHead(404).end(); return; }
    if (caminho.endsWith('/')) arquivo = join(arquivo, 'index.html');
    try {
      const corpo = await readFile(arquivo);
      res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] || 'application/octet-stream' }).end(corpo);
    } catch {
      res.writeHead(404, { 'Content-Type': TIPOS['.html'] }).end(await readFile(join(ROOT, '404.html')).catch(() => ''));
    }
  });
  return new Promise((ok) => srv.listen(PORTA, '127.0.0.1', () => ok(srv)));
}

// Funções do banco só de leitura que as quatro páginas usam. Outra função qualquer fica bloqueada (e vira aviso).
const LEITURA = new Set(['imported_cities', 'nearby_establishments', 'establishment_points', 'nearby_clinics', 'request_status',
  'cnes_last_update', 'city_establishments', 'place_ratings', 'place_reviews', 'clinics_with_schedule', 'available_slots',
  'tele_doctors_online', 'tele_doc_verify']);

async function parteC() {
  const P = 'c';
  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)('playwright'));
  } catch {
    registra(P, 'Playwright', 'falhou', 'pacote "playwright" não instalado');
    return;
  }
  const srv = await servidor();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    geolocation: { latitude: -23.5651, longitude: -46.6521, accuracy: 30 }, permissions: ['geolocation'],
    serviceWorkers: 'block', reducedMotion: 'reduce',
  });
  // O aviso de privacidade (LGPD) já respondido, para não cobrir a tela.
  await context.addInitScript(() => { try { localStorage.setItem('imed_lgpd', '1'); } catch { /* sem armazenamento */ } });
  // O endereço do site publicado, servido pelo servidor local (os arquivos deste ramo).
  await context.route(`${ORIGEM}/**`, async (route) => {
    const u = new URL(route.request().url());
    try {
      const r = await fetch(`http://127.0.0.1:${PORTA}${u.pathname}${u.search}`);
      await route.fulfill({ status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'no-store' }, body: Buffer.from(await r.arrayBuffer()) });
    } catch {
      await route.abort();
    }
  });
  // Escritas bloqueadas (não sujam a produção): o contador de visitas, inserções/alterações em tabelas e qualquer
  // função do banco fora da lista de leitura.
  const bloqueadas = [];
  await context.route(`${SUPABASE}/rest/v1/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.continue();
    const u = new URL(req.url());
    const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)/)?.[1];
    const escrita = rpc ? !LEITURA.has(rpc) : !['GET', 'HEAD'].includes(req.method());
    if (!escrita) return route.continue();
    bloqueadas.push(`${req.method()} ${u.pathname}`);
    return route.fulfill({ status: rpc ? 200 : 201, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: rpc ? 'null' : '' });
  });

  const paginas = [
    { nome: 'página inicial (localização na Av. Paulista)', caminho: '', confere: async (page) => {
      await page.waitForFunction(() => /estabelecimentos oficiais/.test(document.querySelector('#livePill')?.textContent || ''), null, { timeout: 45000 });
      await page.waitForSelector('#realList li b', { timeout: 45000 });
      const nomes = await page.$$eval('#realList li b', (els) => els.map((e) => e.textContent.trim()));
      const pilula = (await page.textContent('#livePill')).trim();
      const daApi = new Set(dadosA.perto.map((r) => String(r.name).trim()));
      const comuns = nomes.filter((n) => daApi.has(n));
      if (nomes.length < 3) return `só ${nomes.length} local(is) na lista`;
      if (dadosA.perto.length && !comuns.length) return `nenhum nome da lista bate com a API (${nomes.slice(0, 3).join('; ')})`;
      return `ok: "${pilula}"; ${nomes.length} locais perto, ${comuns.length} iguais aos da API (ex.: ${nomes.slice(0, 2).join('; ')})`;
    } },
    { nome: 'perto.html?exame=rm (busca por ressonância)', caminho: 'perto.html?exame=rm', confere: async (page) => {
      await page.waitForSelector('.pc h3', { timeout: 60000 });
      await page.waitForFunction(() => !document.querySelector('.pt-more'), null, { timeout: 30000 }).catch(() => {});
      const nomes = await page.$$eval('.pc h3', (els) => els.map((e) => e.textContent.trim()));
      if (!nomes.length) return 'nenhum resultado';
      return `ok: ${nomes.length} resultado(s) (ex.: ${nomes.slice(0, 2).join('; ')})`;
    } },
    { nome: 'local.html (um local de verdade)', caminho: () => `local.html?cnes=${dadosA.cnes}`, pula: () => !dadosA.cnes && 'sem CNES da parte a', confere: async (page) => {
      await page.waitForSelector('#lcName', { timeout: 45000 });
      const nome = (await page.textContent('#lcName')).trim();
      if (nome !== dadosA.nomeCnes) return `nome na página "${nome}" diferente do banco "${dadosA.nomeCnes}"`;
      return `ok: ${nome} (CNES ${dadosA.cnes})`;
    } },
    { nome: 'cidades/sp/sao-paulo/ (página da cidade)', caminho: 'cidades/sp/sao-paulo/', confere: async (page) => {
      await page.waitForSelector('#cdList .cd-item h3', { timeout: 45000 });
      const nomes = await page.$$eval('#cdList .cd-item h3', (els) => els.map((e) => e.textContent.trim()));
      const daApi = new Set(dadosA.cidade.map((r) => String(r.name).trim()));
      const comuns = nomes.filter((n) => daApi.has(n));
      if (nomes.length < 10) return `só ${nomes.length} local(is) na lista`;
      if (dadosA.cidade.length && !comuns.length) return 'nenhum nome da lista bate com a API';
      return `ok: ${nomes.length} locais na lista, ${comuns.length} iguais aos da API`;
    } },
  ];

  for (const pg of paginas) {
    const motivoPula = pg.pula?.();
    if (motivoPula) { registra(P, pg.nome, 'falhou', `não deu para abrir: ${motivoPula}`); continue; }
    const page = await context.newPage();
    const falhas = []; // chamadas ao supabase.co com erro
    const aguardando = []; // falhas da clinicas-proximas enquanto ela não foi publicada de novo
    const terceiros = []; // erros de serviços de fora (mapa)
    const erros = []; // erros no console e da página
    const chamadas = { total: 0, comAuthorization: 0, chaveErrada: 0 }; // cabeçalhos das chamadas ao supabase.co
    const supa = (url) => url.startsWith(SUPABASE);
    const daFuncao = (url) => url.startsWith(`${FUNCOES}/clinicas-proximas`);
    // A regra das chaves no navegador de verdade: só a publishable no apikey e, sem conta, nada no Authorization.
    page.on('request', (req) => {
      if (!supa(req.url()) || req.method() === 'OPTIONS') return;
      const h = req.headers();
      chamadas.total += 1;
      if (h.apikey !== CHAVE) chamadas.chaveErrada += 1;
      if (h.authorization !== undefined) chamadas.comAuthorization += 1;
    });
    page.on('response', (r) => {
      const url = r.url();
      if (!supa(url) || r.status() < 400 || r.request().method() === 'OPTIONS') return;
      const item = `${r.request().method()} ${new URL(url).pathname} → HTTP ${r.status()}`;
      if (daFuncao(url) && funcaoAceita !== true) aguardando.push(item);
      else falhas.push(item);
    });
    page.on('requestfailed', (req) => {
      const url = req.url();
      const erro = req.failure()?.errorText || '';
      if (/ERR_ABORTED/.test(erro)) return; // cancelada pelo próprio site (busca nova) ou ao fechar a página
      const item = `${req.method()} ${url.split('?')[0]} → ${erro}`;
      if (daFuncao(url) && funcaoAceita !== true) aguardando.push(item);
      else if (supa(url)) falhas.push(item);
      else if (!url.startsWith(ORIGEM)) terceiros.push(item);
      else falhas.push(item);
    });
    page.on('pageerror', (e) => erros.push(`erro na página: ${e.message.split('\n')[0]}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const onde = m.location()?.url || '';
      const texto = `${m.text().split('\n')[0]}${onde ? ` (${onde.split('?')[0]})` : ''}`;
      if ((daFuncao(onde) || /clinicas-proximas/.test(m.text())) && funcaoAceita !== true) aguardando.push(`console: ${texto}`);
      else if (onde && !onde.startsWith(ORIGEM) && !supa(onde)) terceiros.push(`console: ${texto}`);
      else erros.push(`console: ${texto}`);
    });
    const caminho = typeof pg.caminho === 'function' ? pg.caminho() : pg.caminho;
    let motivo;
    try {
      await page.goto(SITE + caminho, { waitUntil: 'domcontentloaded', timeout: 45000 });
      motivo = await pg.confere(page);
      // Chamadas que chegam depois (notas, pontos do mapa, a 2ª página da lista).
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    } catch (e) {
      motivo = `não terminou: ${e.message.split('\n')[0]}`;
    }
    await page.close();
    const problemas = [...new Set([...falhas.map((f) => `supabase.co: ${f}`), ...erros])];
    if (!chamadas.total) problemas.push('nenhuma chamada ao supabase.co');
    if (chamadas.chaveErrada) problemas.push(`${chamadas.chaveErrada} chamada(s) sem a chave publishable no apikey`);
    if (chamadas.comAuthorization) problemas.push(`${chamadas.comAuthorization} chamada(s) com Authorization (visitante não manda)`);
    const ok = motivo.startsWith('ok') && !problemas.length;
    const regra = `${chamadas.total} chamada(s) ao Supabase, todas com a chave publishable só no apikey`;
    registra(P, pg.nome, ok ? 'ok' : 'falhou', ok ? `${motivo}; ${regra}` : [motivo, ...problemas].join(' | '));
    if (aguardando.length) registra(P, `${pg.nome}: clinicas-proximas`, 'aguardando', `${AGUARDA}; o site usou o plano B (o banco direto). ${[...new Set(aguardando)].slice(0, 3).join(' | ')}`);
    if (terceiros.length) registra(P, `${pg.nome}: serviços de fora`, 'aviso', [...new Set(terceiros)].slice(0, 3).join(' | '));
  }
  registra(P, 'escritas bloqueadas no navegador', 'ok', bloqueadas.length ? `bloqueadas: ${[...new Set(bloqueadas)].join(', ')}` : 'nenhuma escrita tentada (o contador de visitas não conta navegador automatizado)');
  await context.close();
  await browser.close();
  srv.close();
}

/* ======================= execução e resumo ======================= */
const NOMES = { a: 'API com a chave publishable (só apikey)', b: 'Edge Function clinicas-proximas', c: 'site do ramo no navegador' };
console.log(`Supabase: ${SUPABASE} · chave: ${CHAVE.slice(0, 18)}… · site: ${SITE}`);
if (!/^sb_publishable_/.test(CHAVE)) {
  console.log(`::error title=${anotaTitulo('Chaves: config.js')}::assets/js/config.js sem a chave publishable em supabaseKey`);
  process.exit(1);
}
if (PARTES.has('a')) await parteA();
if (PARTES.has('b')) await parteB();
if (PARTES.has('c')) await parteC();

const porParte = (p) => resultados.filter((r) => r.parte === p);
const conta = (lista, e) => lista.filter((r) => r.estado === e).length;
const linhas = [];
const erros = resultados.filter((r) => r.estado === 'falhou');
const avisos = resultados.filter((r) => r.estado === 'aguardando' || r.estado === 'aviso');
// Até 9 anotações de cada tipo por parte do GitHub (o limite é 10 por passo): o resto vai junto na última.
const emite = (tipo, lista) => {
  const mostra = lista.length > 9 ? [...lista.slice(0, 8), { parte: '*', nome: `mais ${lista.length - 8}`, detalhe: lista.slice(8).map((r) => `(${r.parte}) ${r.nome}: ${r.detalhe}`).join(' || ') }] : lista;
  for (const r of mostra) console.log(`::${tipo} title=${anotaTitulo(`Chaves (${r.parte}) ${r.nome}`)}::${anota(curto(r.detalhe, 1500))}`);
};
emite('error', erros);
emite('warning', avisos);
for (const p of ['a', 'b', 'c'].filter((x) => PARTES.has(x))) {
  const l = porParte(p);
  const resumo = `${conta(l, 'ok')} ok, ${conta(l, 'falhou')} falha(s), ${conta(l, 'aguardando')} aguardando o deploy, ${conta(l, 'aviso')} aviso(s)`;
  linhas.push(`(${p}) ${NOMES[p]}: ${resumo}`);
  const det = l.map((r) => `${{ ok: 'ok', falhou: 'FALHOU', aguardando: 'AGUARDANDO', aviso: 'AVISO' }[r.estado]} ${r.nome}: ${curto(r.detalhe, 260)}`).join('\n');
  console.log(`::notice title=${anotaTitulo(`Chaves (${p}) ${NOMES[p]} — ${resumo}`)}::${anota(det)}`);
}
const geral = erros.length ? `${erros.length} falha(s)` : avisos.length ? `tudo certo, com ${avisos.length} pendência(s)` : 'tudo certo';
console.log(`::notice title=${anotaTitulo('Chaves — resumo')}::${anota(`${geral}\n${linhas.join('\n')}`)}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const md = ['### Chaves do Supabase (fase 0.1)', '', `**${geral}**`, '', '| Parte | Conferência | Resultado | Detalhe |', '| --- | --- | --- | --- |',
    ...resultados.map((r) => `| ${r.parte} | ${r.nome} | ${{ ok: 'ok', falhou: '**FALHOU**', aguardando: 'aguardando o deploy', aviso: 'aviso' }[r.estado]} | ${curto(r.detalhe, 300).replace(/\s+/g, ' ').replace(/\|/g, '\\|')} |`)];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${md.join('\n')}\n`);
}
process.exit(erros.length ? 1 : 0);
