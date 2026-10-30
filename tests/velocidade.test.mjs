// Testes da velocidade no celular: letras e ícones do próprio site (scripts/fontes.mjs), scripts que não travam a
// primeira pintura, imagens com tamanho certo e conexão adiantada com o banco.
// Rodar com: node --test tests/velocidade.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { headFontes, parseSpec, atualizarPagina, paginasDoSite, classesUsadas, faCompleto, cssIcones, FORA } from '../scripts/fontes.mjs';
import { generate } from '../scripts/gerar-cidades.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const PAGINAS = paginasDoSite();
const API = 'https://pyoqiecupxhdzigjudyd.supabase.co';

test('scripts/fontes.mjs --check: ícones e <head> das páginas em dia', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/fontes.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('páginas do IMED sem Google Fonts e sem o Font Awesome completo (a teleconsulta fica de fora)', () => {
  assert.ok(PAGINAS.length > 700, 'inclui as páginas das cidades');
  for (const f of PAGINAS) {
    const h = read(f);
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(h), `${f}: ainda chama o Google Fonts`);
    assert.ok(!h.includes('fa/css/all.min.css'), `${f}: ainda usa o all.min.css (102 KB)`);
    if (h.includes('fa/css/icones.min.css')) assert.match(h, /<style data-fontes="[^"]+">@font-face\{/, `${f}: letras declaradas no <head>`);
    const csp = h.match(/Content-Security-Policy" content="([^"]+)"/);
    if (csp) assert.match(csp[1], /font-src 'self';/, `${f}: CSP só com as letras do site`);
  }
  // A teleconsulta (outra equipe) continua com o Font Awesome completo: os arquivos dele ficam.
  for (const f of ['css/all.min.css', 'webfonts/fa-solid-900.woff2', 'webfonts/fa-regular-400.woff2', 'webfonts/fa-brands-400.woff2']) {
    assert.ok(existsSync(join(ROOT, 'assets/vendor/fa', f)), f);
  }
  assert.ok(FORA.test('teleconsulta.html') && FORA.test('medico.html') && FORA.test('assets/js/tele-core.js'));
  assert.ok(!PAGINAS.includes('teleconsulta.html'));
});

test('letras: mesmos pesos de antes, arquivos do próprio site, preload do alfabeto latino', () => {
  assert.deepEqual(parseSpec('Sora:wght@600;700;800&family=Inter:wght@400;500;600;700'), { Sora: [600, 700, 800], Inter: [400, 500, 600, 700] });
  assert.deepEqual(parseSpec('Sora:700;800|Inter:400;600;700'), { Sora: [700, 800], Inter: [400, 600, 700] });
  const h = headFontes('../', 'Sora:wght@700;800&family=Inter:wght@400;600;700');
  // Pesos seguidos viram faixa; 400 e 600 separados continuam separados (500 cai no 400, como antes).
  assert.match(h, /font-family:'Sora';font-style:normal;font-weight:700 800;font-display:swap;src:url\(\.\.\/assets\/fonts\/sora-latin\.woff2\)/);
  assert.match(h, /font-family:'Inter';font-style:normal;font-weight:400;font-display:swap;src:url\(\.\.\/assets\/fonts\/inter-latin\.woff2\)/);
  assert.match(h, /font-family:'Inter';font-style:normal;font-weight:600 700;font-display:swap/);
  assert.ok(!/font-weight:400 700/.test(h));
  assert.match(h, /^<link rel="preload" href="\.\.\/assets\/fonts\/sora-latin\.woff2" as="font" type="font\/woff2" crossorigin>\n<link rel="preload" href="\.\.\/assets\/fonts\/inter-latin\.woff2"/);
  assert.ok(!/latin-ext\.woff2" as="font"/.test(h), 'o latin-ext só baixa se a página tiver letra dele');
  for (const f of ['inter-latin', 'inter-latin-ext', 'sora-latin', 'sora-latin-ext']) {
    const st = statSync(join(ROOT, `assets/fonts/${f}.woff2`));
    assert.ok(st.size > 5000, f);
  }
  assert.ok(existsSync(join(ROOT, 'assets/fonts/OFL-Inter.txt')) && existsSync(join(ROOT, 'assets/fonts/OFL-Sora.txt')), 'licenças');
  // A página inicial usava Sora 500; as outras, 600 a 800. Cada uma continua com os seus pesos.
  assert.match(read('index.html'), /<style data-fontes="Sora:500;600;700;800\|Inter:400;500;600;700">/);
  assert.match(read('perto.html'), /<style data-fontes="Sora:600;700;800\|Inter:400;500;600;700">/);
});

test('troca do <head>: Google Fonts → letras do site, all.min.css → icones.min.css, CSP sem o Google (e roda de novo sem mudar)', () => {
  const antes = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self'">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../../assets/vendor/fa/css/all.min.css">`;
  const depois = atualizarPagina(antes);
  assert.ok(!/googleapis|gstatic|all\.min\.css/.test(depois));
  assert.match(depois, /style-src 'self' 'unsafe-inline'; font-src 'self'; img-src/);
  assert.match(depois, /href="\.\.\/\.\.\/assets\/fonts\/inter-latin\.woff2"/);
  assert.match(depois, /<link rel="stylesheet" href="\.\.\/\.\.\/assets\/vendor\/fa\/css\/icones\.min\.css">/);
  assert.equal(atualizarPagina(depois), depois);
});

test('ícones: todo ícone usado nas páginas do IMED está no recorte (CSS e fontes)', () => {
  const usadas = classesUsadas();
  const { icones } = faCompleto();
  const css = read('assets/vendor/fa/css/icones.min.css');
  const usados = [...usadas].filter((n) => icones.has(n));
  assert.ok(usados.length >= 60, `ícones encontrados: ${usados.length}`);
  for (const n of usados) assert.ok(new RegExp(`\\.${n}:before[,{]`).test(css), `${n} sem regra no icones.min.css`);
  // Ícones de verdade que o site usa em JS (montados na hora): estão no recorte.
  for (const n of ['fa-x-ray', 'fa-flask', 'fa-stethoscope', 'fa-hospital', 'fa-star', 'fa-whatsapp', 'fa-clock']) assert.ok(usadas.has(n), n);
  const cobertura = JSON.parse(read('assets/vendor/fa/webfonts/icones.json'));
  const todos = new Set(Object.values(cobertura).flat());
  for (const n of usados) assert.ok(todos.has(icones.get(n)), `${n} (${icones.get(n).toString(16)}) fora das fontes recortadas`);
  // Rede de segurança: a fonte completa vem primeiro, sem unicode-range; o recorte depois, com o unicode-range.
  assert.match(css, /src:url\(\.\.\/webfonts\/fa-solid-900\.woff2\) format\("woff2"\)\}@font-face\{font-family:"Font Awesome 6 Free";font-style:normal;font-weight:900;font-display:block;src:url\(\.\.\/webfonts\/icones-solid-900\.woff2\) format\("woff2"\);unicode-range:U\+/);
  assert.ok(statSync(join(ROOT, 'assets/vendor/fa/webfonts/icones-solid-900.woff2')).size < 20000, 'recorte bem menor que os 153 KB da fonte completa');
  assert.ok(css.length < 12000, `icones.min.css com ${css.length} bytes`);
  // Sem um ícone, ele some do CSS (o recorte é feito a partir do que o site usa).
  const semX = cssIcones(new Set([...usadas].filter((n) => n !== 'fa-x-ray')), cobertura).css;
  assert.ok(!semX.includes('.fa-x-ray:before') && semX.includes('.fa-flask:before'));
});

test('nenhum script trava a primeira pintura (defer ou módulo) nas páginas do IMED', () => {
  for (const f of PAGINAS) {
    for (const tag of read(f).matchAll(/<script\b[^>]*\bsrc="[^"]+"[^>]*>/g)) {
      assert.match(tag[0], /\b(defer|async)\b|type="module"/, `${f}: ${tag[0]}`);
    }
  }
});

test('busca, local e cidades: Leaflet fora do caminho, conexão com o banco adiantada, módulos pedidos cedo', () => {
  const perto = read('perto.html');
  assert.match(perto, /<script src="assets\/vendor\/leaflet\/leaflet\.js" defer><\/script>\n<script type="module" src="assets\/js\/perto\.js"><\/script>/);
  assert.match(perto, /<link rel="modulepreload" href="assets\/js\/geo-core\.js">/);
  assert.match(perto, /<div class="pt-list" id="list" tabindex="-1"><div class="st">.*Para mostrar distâncias reais/s, 'explicação já no HTML');
  const local = read('local.html');
  assert.ok(!/leaflet\.(js|css)/.test(local), 'local.html: o Leaflet vem só quando o mapa chega perto da tela');
  assert.match(read('assets/js/local.js'), /assets\/vendor\/leaflet\/leaflet\.js/);
  assert.ok(local.includes(`<link rel="preconnect" href="${API}" crossorigin>`));
  assert.match(local, /<link rel="modulepreload" href="assets\/js\/geo-core\.js">\n<link rel="modulepreload" href="assets\/js\/confianca\.js">/);
  assert.match(read('assets/css/local.css'), /#app\[aria-busy="true"\]\{min-height:100vh/);
  assert.ok(read('index.html').includes(`<link rel="preconnect" href="${API}" crossorigin>`));
  // Páginas das cidades (geradas): com a conexão adiantada só onde a lista vem do banco.
  const out = mkdtempSync(join(tmpdir(), 'imed-vel-'));
  try {
    generate({ cities: [{ ibge: 3550308, name: 'São Paulo', uf: 'SP', total: 10, imagem: 1, laboratorio: 2, clinica: 6, hospital: 1 }], base: 'https://exemplo.com.br/', date: '2026-10-30', out, examPages: [] });
    const cidade = readFileSync(join(out, 'cidades/sp/sao-paulo/index.html'), 'utf8');
    const tipo = readFileSync(join(out, 'cidades/sp/sao-paulo/hospitais.html'), 'utf8');
    const indice = readFileSync(join(out, 'cidades/index.html'), 'utf8');
    for (const h of [cidade, tipo]) {
      assert.ok(h.includes(`<link rel="preconnect" href="${API}" crossorigin>`));
      assert.ok(h.includes(headFontes('../../../', 'Sora:wght@600;700;800&family=Inter:wght@400;500;600;700')));
      assert.match(h, /<link rel="stylesheet" href="\.\.\/\.\.\/\.\.\/assets\/vendor\/fa\/css\/icones\.min\.css">/);
      assert.match(h, /<script src="\.\.\/\.\.\/\.\.\/assets\/js\/config\.js" defer><\/script>/);
      assert.ok(!/googleapis|gstatic|all\.min\.css/.test(h));
    }
    assert.ok(!indice.includes('rel="preconnect"'), 'o índice das cidades não busca nada no banco');
    // O que está no repositório é o mesmo que o gerador escreve hoje.
    assert.equal(atualizarPagina(cidade), cidade);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('imagens: tamanho reservado, versão pequena dos ícones e prioridade na imagem do topo dos guias', () => {
  for (const k of ['rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco']) {
    const p = statSync(join(ROOT, `assets/img/ico-${k}-96.webp`)).size;
    assert.ok(p < statSync(join(ROOT, `assets/img/ico-${k}.webp`)).size / 2, `ico-${k}-96 bem menor que o original`);
  }
  const idx = read('index.html');
  const chips = idx.match(/<div class="hchips" id="hchips">(.*?)<\/div>/)[1];
  assert.equal((chips.match(/class="hchip"/g) || []).length, 6, 'atalhos do topo já no HTML (não empurram o título)');
  assert.match(chips, /<img src="assets\/img\/ico-rm-96\.webp" alt="" width="24" height="24">Ressonância/);
  assert.match(chips, /href="teleconsulta\.html"><i class="fa-solid fa-video" aria-hidden="true"><\/i>Teleconsulta/);
  assert.match(idx, /<p class="hero-src wait" id="heroSrc" hidden><\/p>/);
  assert.match(idx, /<script src="assets\/js\/config\.js" defer><\/script>/);
  for (const f of PAGINAS.filter((p) => p.startsWith('exames/'))) {
    const h = read(f);
    assert.match(h, /<section class="g-hero">\s*<img src="[^"]+" alt=""(?: style="[^"]*")? fetchpriority="high">/, `${f}: imagem do topo com prioridade`);
    for (const img of h.matchAll(/<img\b[^>]*>/g)) {
      if (/fetchpriority/.test(img[0])) continue; // fundo do topo: posição absoluta, não empurra nada
      assert.match(img[0], /width="\d+" height="\d+"/, `${f}: ${img[0]}`);
    }
  }
  assert.match(read('assets/css/guia.css'), /\.g-ico\{[^}]*height:auto/, 'ícone grande proporcional com width/height no HTML');
});
