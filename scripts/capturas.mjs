// Capturas de tela do site no ar, com dados reais, para mostrar ao dono como está ficando (Actions → "Capturas do
// site"). Roda no GitHub porque o banco e o mapa abrem de lá. Só navega e digita: não envia pedido nem conta visita
// (o contador e qualquer escrita no banco são barrados aqui). Uso:
//   node scripts/capturas.mjs --url=https://.../testedoapp/ --saida=/pasta
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const URL_SITE = arg('url', 'https://drrafaelpereirabarreto-code.github.io/testedoapp/').replace(/\/?$/, '/');
const SAIDA = arg('saida', 'capturas');
mkdirSync(SAIDA, { recursive: true });

const PAULISTA = { latitude: -23.5650, longitude: -46.6520 };
const TELAS = {
  celular: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  computador: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1.5 },
};
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const feitos = [];

// Sem o aviso de privacidade por cima (a pessoa já teria respondido) e sem rede de escrita.
async function contexto(browser, tela) {
  const ctx = await browser.newContext({
    ...TELAS[tela], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', geolocation: PAULISTA, permissions: ['geolocation'],
    serviceWorkers: 'block', reducedMotion: 'reduce',
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('imed_lgpd', '1'); } catch (e) { /* sem armazenamento */ } });
  await ctx.route('**/rest/v1/**', (r) => {
    const req = r.request();
    const leitura = req.method() === 'GET' || req.method() === 'HEAD' || (req.method() === 'POST' && /\/rest\/v1\/rpc\//.test(req.url()));
    if (/\/rpc\/track\b/.test(req.url()) || !leitura) return r.fulfill({ status: 204, body: '' });
    return r.continue();
  });
  return ctx;
}

async function foto(page, nome, desc) {
  const arquivo = path.join(SAIDA, `${nome}.png`);
  await page.screenshot({ path: arquivo });
  feitos.push({ nome, desc, arquivo: path.basename(arquivo) });
  console.log(`ok  ${nome}: ${desc}`);
}

async function passo(nome, fn) {
  try { await fn(); } catch (e) { console.log(`ERRO ${nome}: ${String(e.message || e).split('\n')[0]}`); feitos.push({ nome, erro: String(e.message || e).split('\n')[0] }); }
}

// Digita sem esperar a página "parar" (a cidade 3D anima o tempo todo).
async function digitar(page, sel, texto) {
  await page.evaluate((s) => { const el = document.querySelector(s); el.scrollIntoView({ block: 'center' }); el.focus(); el.value = ''; }, sel);
  await page.keyboard.type(texto, { delay: 60 });
}

const browser = await chromium.launch();
for (const tela of Object.keys(TELAS)) {
  const ctx = await contexto(browser, tela);
  const page = await ctx.newPage();

  await passo(`${tela}-inicio`, async () => {
    await page.goto(URL_SITE, { waitUntil: 'domcontentloaded' });
    await page.locator('#realList li').first().waitFor({ timeout: 25000 });
    await pausa(1500);
    await foto(page, `${tela}-01-inicio`, 'Página inicial: topo');
  });

  await passo(`${tela}-perto`, async () => {
    await page.evaluate(() => document.querySelector('#reais')?.scrollIntoView({ block: 'start' }));
    await pausa(1500);
    await foto(page, `${tela}-02-perto-de-voce`, 'Clínicas perto de você (localização na Av. Paulista)');
  });

  await passo(`${tela}-seletor`, async () => {
    await page.evaluate(() => document.querySelector('#addrBtn')?.click());
    await pausa(1500);
    await foto(page, `${tela}-03-escolher-cidade`, 'Escolher a cidade (seletor)');
    await page.keyboard.press('Escape');
    await pausa(600);
  });

  await passo(`${tela}-hemograma`, async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await pausa(500);
    await digitar(page, '#heroQ', 'hemograma');
    await page.locator('#heroSug .sug').first().waitFor({ timeout: 10000 });
    await pausa(900);
    await foto(page, `${tela}-04-busca-hemograma`, 'Busca pelo nome popular: "hemograma" leva aos laboratórios');
  });

  await passo(`${tela}-eco`, async () => {
    await digitar(page, '#heroQ', 'eco');
    await pausa(700);
    await page.keyboard.press('Enter');
    await pausa(1200);
    await foto(page, `${tela}-05-busca-eco`, '"eco" pode ser ecocardiograma ou ultrassom: o site pergunta');
  });

  await passo(`${tela}-campinas`, async () => {
    await page.goto(`${URL_SITE}perto.html`, { waitUntil: 'domcontentloaded' });
    await digitar(page, '#q', 'ressonância em Campinas');
    await page.keyboard.press('Enter');
    await page.locator('#list .pc').first().waitFor({ timeout: 30000 });
    await pausa(2500);
    await foto(page, `${tela}-06-ressonancia-em-campinas`, 'Busca "ressonância em Campinas": filtro do exame e o mapa em Campinas');
  });

  await ctx.close();
}
await browser.close();

writeFileSync(path.join(SAIDA, 'resumo.json'), JSON.stringify({ url: URL_SITE, feitos }, null, 2));
const erros = feitos.filter((f) => f.erro);
console.log(`${feitos.length - erros.length} capturas, ${erros.length} erros`);
