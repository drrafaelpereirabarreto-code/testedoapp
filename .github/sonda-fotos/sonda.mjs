// SONDA TEMPORÁRIA (diagnóstico do mapa 3D; apagar do ramo antes do fim). Fotos reais no celular em 5 lugares,
// troca de cidade e de localização, versão leve com 4 núcleos e os mapas 2D. Só leitura no banco.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { analisar } from './mvt-predios.mjs';

const URL_SITE = 'http://127.0.0.1:8080/';
const SAIDA = process.argv[2] || 'saida';
mkdirSync(SAIDA, { recursive: true }); mkdirSync(path.join(SAIDA, 'pbf'), { recursive: true });
const LUGARES = {
  paulista: { nome: 'Av. Paulista (SP)', latitude: -23.565, longitude: -46.652 },
  campinas: { nome: 'Centro de Campinas', latitude: -22.906, longitude: -47.061 },
  copacabana: { nome: 'Copacabana (RJ)', latitude: -22.967, longitude: -43.186 },
  ribeirao: { nome: 'Jardim Irajá, Ribeirão Preto (residencial)', latitude: -21.214, longitude: -47.806 },
  sorocaba: { nome: 'Campolim, Sorocaba (residencial)', latitude: -23.531, longitude: -47.468 },
};
const CEL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const resumo = {};
const log = (...a) => console.log(...a);

async function contexto(browser, geo, capaz = true, extra = {}) {
  const ctx = await browser.newContext({ ...CEL, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', geolocation: geo, permissions: ['geolocation'],
    serviceWorkers: 'block', reducedMotion: 'no-preference', colorScheme: 'light', ...extra });
  await ctx.addInitScript((capaz) => {
    try { localStorage.setItem('imed_lgpd', '1'); } catch (e) { /* */ }
    if (capaz) {
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
    }
  }, capaz);
  await ctx.route('**/rest/v1/**', (r) => {
    const req = r.request();
    const leitura = req.method() === 'GET' || req.method() === 'HEAD' || (req.method() === 'POST' && /\/rest\/v1\/rpc\//.test(req.url()));
    if (/\/rpc\/track\b/.test(req.url()) || !leitura) return r.fulfill({ status: 204, body: '' });
    return r.continue();
  });
  return ctx;
}
function vigiar(page, reg) {
  reg.ladrilhos = []; reg.falhas = []; reg.console = [];
  page.on('requestfinished', async (req) => { if (/tiles\.openfreemap\.org/.test(req.url())) { const s = await req.sizes().catch(() => null); const resp = await req.response().catch(() => null); reg.ladrilhos.push({ url: req.url().replace('https://tiles.openfreemap.org', ''), status: resp?.status(), bytes: s ? s.responseBodySize : 0, t: Date.now() }); } });
  page.on('requestfailed', (req) => { if (/openfreemap|openstreetmap|supabase/.test(req.url())) reg.falhas.push(`${req.url()} ${req.failure()?.errorText}`); });
  page.on('console', (m) => { if (['warning', 'error'].includes(m.type())) reg.console.push(m.text().slice(0, 300)); });
}
async function esperar3d(page, reg) {
  const t0 = Date.now();
  await page.waitForFunction(() => ['3d', 'leve'].includes(document.body.dataset.hero), null, { timeout: 90000 });
  reg.hero = await page.evaluate(() => document.body.dataset.hero);
  reg.msAte3d = Date.now() - t0;
  if (reg.hero !== '3d') return false;
  await page.waitForFunction(() => (window.HERO?.info?.().predios || 0) > 0, null, { timeout: 60000 }).catch(() => {});
  await pausa(6000);
  await page.waitForFunction(() => (window.HERO?.info?.().sombras || 0) > 0, null, { timeout: 40000 }).catch(() => {});
  await pausa(1500);
  return true;
}
async function estado(page) {
  return page.evaluate(() => {
    const h = document.querySelector('#hero3d')?.getBoundingClientRect();
    return {
      info: window.HERO?.info?.() || null, hero: document.body.dataset.hero, origem: document.body.dataset.origem,
      pinosNaTela: document.querySelectorAll('.h3d-pin.on').length, pinos: document.querySelectorAll('.h3d-pin').length,
      rotulos: [...document.querySelectorAll('.h3d-label.on')].map((l) => l.getAttribute('aria-label')),
      me: document.querySelector('.h3d-me')?.textContent, heroTopo: h ? Math.round(h.top) : null, heroBase: h ? Math.round(h.bottom) : null,
      scrollY: Math.round(scrollY), addr: document.querySelector('#addrTxt')?.textContent, cidade: document.querySelector('#cityName')?.textContent,
    };
  });
}
const rolarAoMapa = (page) => page.evaluate(() => { const h = document.querySelector('#hero3d'); window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 260); });
async function foto(page, nome) { await page.screenshot({ path: path.join(SAIDA, `${nome}.png`) }); log('foto', nome); }
async function passo(nome, fn) { try { await fn(); } catch (e) { log('ERRO', nome, String(e.message || e).split('\n')[0]); resumo[nome] = { ...(resumo[nome] || {}), erro: String(e.message || e).split('\n')[0] }; } }

// Ladrilhos z14 em volta de cada lugar, pela rede, analisados aqui (prédios por anel externo, altura padrão de 5 m).
const tile = (lng, lat, z) => [Math.floor((lng + 180) / 360 * 2 ** z), Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z)];
async function dadosOSM() {
  const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
  const modelo = tj.tiles[0];
  resumo.tilejson = { modelo, minzoom: tj.minzoom, maxzoom: tj.maxzoom };
  for (const [k, L] of Object.entries(LUGARES)) {
    const c = { lat: L.latitude, lng: L.longitude };
    const [tx, ty] = tile(c.lng, c.lat, 14); const tiles = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = tx + dx, y = ty + dy; tiles.push([x, y]);
      const r = await fetch(modelo.replace('{z}', 14).replace('{x}', x).replace('{y}', y));
      writeFileSync(path.join(SAIDA, 'pbf', `z14_${x}_${y}.pbf`), Buffer.from(await r.arrayBuffer()));
    }
    resumo[`osm-${k}`] = { 300: analisar(path.join(SAIDA, 'pbf'), 14, tiles, c, 300), 750: analisar(path.join(SAIDA, 'pbf'), 14, tiles, c, 750), 1100: analisar(path.join(SAIDA, 'pbf'), 14, tiles, c, 1100) };
    log(k, JSON.stringify(resumo[`osm-${k}`]));
  }
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
await passo('dados-osm', dadosOSM);

// 1) Cada lugar no celular, com a localização do aparelho ali.
for (const [k, L] of Object.entries(LUGARES)) {
  await passo(`celular-${k}`, async () => {
    const reg = resumo[`celular-${k}`] = {};
    const ctx = await contexto(browser, { latitude: L.latitude, longitude: L.longitude });
    const page = await ctx.newPage(); vigiar(page, reg);
    await page.goto(URL_SITE, { waitUntil: 'domcontentloaded' });
    const ok = await esperar3d(page, reg);
    reg.topoDaPagina = await estado(page);
    await foto(page, `predios-antes-${k}-celular-topo`); // o que aparece ao abrir (sem rolar)
    await rolarAoMapa(page); await pausa(1500);
    Object.assign(reg, await estado(page));
    await foto(page, `predios-antes-${k}-celular`);
    if (ok) { await page.locator('#hero3d').screenshot({ path: path.join(SAIDA, `predios-antes-${k}-celular-mapa.png`) }); }
    await ctx.close();
  });
}

// 2) Celular comum (4 núcleos, como a máquina do GitHub, sem ajuste): versão leve?
await passo('celular-4nucleos', async () => {
  const reg = resumo['celular-4nucleos'] = {};
  const ctx = await contexto(browser, { latitude: LUGARES.paulista.latitude, longitude: LUGARES.paulista.longitude }, false);
  const page = await ctx.newPage(); vigiar(page, reg);
  await page.goto(URL_SITE, { waitUntil: 'domcontentloaded' });
  await esperar3d(page, reg);
  reg.navegador = await page.evaluate(() => ({ nucleos: navigator.hardwareConcurrency, memoria: navigator.deviceMemory, coarse: matchMedia('(pointer: coarse)').matches, tela: [screen.width, screen.height], lite: document.body.classList.contains('lite') }));
  await rolarAoMapa(page); await pausa(1000);
  await foto(page, 'predios-antes-leve-4nucleos-celular');
  await ctx.close();
});

// 3) Troca de endereço no celular: Paulista (localização) → seletor "Campinas" → "Usar minha localização" (Copacabana).
await passo('troca', async () => {
  const reg = resumo.troca = {};
  const ctx = await contexto(browser, { latitude: LUGARES.paulista.latitude, longitude: LUGARES.paulista.longitude });
  const page = await ctx.newPage(); vigiar(page, reg);
  await page.goto(URL_SITE, { waitUntil: 'domcontentloaded' });
  await esperar3d(page, reg);
  reg.antes = await estado(page);
  // A pessoa desce até "Clínicas perto de você" e toca em Trocar.
  await page.evaluate(() => document.querySelector('#reais').scrollIntoView());
  await pausa(800);
  await page.click('#cityBtn');
  await page.waitForSelector('#cityQ');
  await page.type('#cityQ', 'Campinas', { delay: 60 });
  await page.waitForSelector('#cityList li', { timeout: 20000 });
  const t0 = Date.now();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.dataset.origem === 'cidade', null, { timeout: 30000 });
  reg.msAteCidade = Date.now() - t0;
  reg.logoDepois = await estado(page);
  await pausa(8000);
  reg.depois8s = await estado(page);
  await foto(page, 'predios-antes-troca-campinas-vista'); // o que a pessoa vê depois de escolher (onde ela está na página)
  await rolarAoMapa(page); await pausa(2500);
  reg.depoisNoMapa = await estado(page);
  await foto(page, 'predios-antes-troca-campinas-mapa3d');
  // Mapa 2D (Leaflet) da tela "Clínicas perto de você": "Ver no mapa" no celular.
  await page.evaluate(() => document.querySelector('#reais').scrollIntoView());
  await pausa(500);
  if (await page.isVisible('#mapOpen')) {
    await page.click('#mapOpen'); await pausa(6000);
    reg.leaflet = await page.evaluate(() => ({ zoom: document.querySelector('#realMap .leaflet-container, #realMap')?.className, tiles: document.querySelectorAll('#realMap img.leaflet-tile-loaded').length }));
    await foto(page, 'predios-antes-troca-campinas-mapa2d');
    await page.keyboard.press('Escape'); await pausa(800);
  } else reg.leaflet = 'sem botão Ver no mapa';
  // "Usar minha localização" com o aparelho agora em Copacabana.
  await ctx.setGeolocation({ latitude: LUGARES.copacabana.latitude, longitude: LUGARES.copacabana.longitude });
  await page.evaluate(() => document.querySelector('#reais').scrollIntoView());
  await pausa(500);
  if (await page.isVisible('#useGeoBtn')) {
    await page.click('#useGeoBtn');
    await page.waitForFunction(() => document.body.dataset.origem === 'perto', null, { timeout: 30000 }).catch(() => {});
    await pausa(8000);
    reg.depoisGeo = await estado(page);
    await rolarAoMapa(page); await pausa(2500);
    reg.depoisGeoNoMapa = await estado(page);
    await foto(page, 'predios-antes-troca-geo-copacabana-mapa3d');
  } else reg.depoisGeo = 'sem botão Usar minha localização';
  await ctx.close();
});

// 4) Busca e página do local (Leaflet 2D) em Copacabana.
await passo('perto-copacabana', async () => {
  const reg = resumo['perto-copacabana'] = {};
  const ctx = await contexto(browser, { latitude: LUGARES.copacabana.latitude, longitude: LUGARES.copacabana.longitude });
  const page = await ctx.newPage(); vigiar(page, reg);
  await page.goto(URL_SITE + 'perto.html?usar=localizacao', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.pc', { timeout: 60000 }).catch(() => {});
  await pausa(3000);
  if (await page.isVisible('#viewToggle')) { await page.click('#viewToggle'); await pausa(5000); }
  reg.mapa = await page.evaluate(() => ({ zoom: document.querySelector('#map')?.dataset.zoom, viewM: document.querySelector('#map')?.dataset.viewM, pins: document.querySelector('#map')?.dataset.pins }));
  await foto(page, 'predios-antes-perto-copacabana-mapa2d');
  const href = await page.evaluate(() => document.querySelector('a[href*="local.html?"]')?.getAttribute('href'));
  reg.local = href;
  if (href) {
    await page.goto(URL_SITE + href, { waitUntil: 'domcontentloaded' });
    await pausa(2000);
    await page.evaluate(() => document.querySelector('.leaflet-container, #localMap, .lc-map, [id*="map" i]')?.scrollIntoView({ block: 'center' }));
    await pausa(5000);
    await foto(page, 'predios-antes-local-copacabana-mapa2d');
  }
  await ctx.close();
});

await browser.close();
writeFileSync(path.join(SAIDA, 'resumo.json'), JSON.stringify(resumo, null, 1));
log('fim');
