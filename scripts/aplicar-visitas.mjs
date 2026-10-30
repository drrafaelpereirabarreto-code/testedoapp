#!/usr/bin/env node
// Põe o contador de visitas próprio (assets/js/visitas.js) em todas as páginas do site: as fixas (raiz e exames/)
// e as das cidades já geradas (cidades/**; o gerador scripts/gerar-cidades.mjs já põe nas que ele cria).
// Rode depois de criar uma página:   node scripts/aplicar-visitas.mjs
// Em cada página, logo depois do <script> do config.js (o contador lê o endereço do banco de lá), entra:
//   <script src="<caminho até a raiz>assets/js/visitas.js" defer></script>
// Página sem config.js: os dois entram antes de </body>, com defer (o config primeiro).
// A página 404 abre em qualquer endereço: usa o caminho absoluto do site e conta sempre como "/404".
// tests/visitas.test.mjs confere que nenhuma página ficou sem o contador.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { paginas, relDe } from './aplicar-rodape.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Páginas de outras frentes: só recebem o contador quando a frente liberar (a teleconsulta põe o dela).
// Para incluir: tire daqui e rode o comando de novo.
export const OUTRAS_FRENTES = ['teleconsulta.html', 'medico.html', 'termo-teleconsulta.html'];

const VISITAS_RE = /\n?<script src="[^"]*assets\/js\/visitas\.js"[^>]*><\/script>/g;
const CONFIG_RE = /<script src="[^"]*assets\/js\/config\.js"[^>]*><\/script>/;

export const tagVisitas = (rel, file = '') =>
  `<script src="${rel}assets/js/visitas.js"${file === '404.html' ? ' data-pagina="/404"' : ''} defer></script>`;

// Devolve o HTML com o contador (uma vez só, logo depois do config.js). Já certo: devolve igual.
export function comVisitas(html, rel, file = '') {
  const tag = tagVisitas(rel, file);
  const cfg = html.match(CONFIG_RE);
  if (cfg && html.includes(`${cfg[0]}\n${tag}`) && (html.match(VISITAS_RE) || []).length === 1) return html;
  let out = html.replace(VISITAS_RE, '');
  const c = out.match(CONFIG_RE);
  if (c) return out.replace(c[0], `${c[0]}\n${tag}`);
  return out.replace('</body>', `<script src="${rel}assets/js/config.js" defer></script>\n${tag}\n</body>`);
}

// Páginas das cidades já geradas (cidades/**/*.html).
export function paginasCidades(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    const abs = join(root, dir);
    if (!existsSync(abs)) return;
    for (const f of readdirSync(abs).sort()) {
      const rel = `${dir}/${f}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (f.endsWith('.html')) out.push(rel);
    }
  };
  walk('cidades');
  return out;
}

// Todas as páginas que devem contar visitas (sem as de outras frentes).
export function paginasComContador(root = ROOT) {
  return [...paginas(root), ...paginasCidades(root)].filter((f) => !OUTRAS_FRENTES.includes(f));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let mudou = 0;
  const lista = [];
  for (const file of paginasComContador()) {
    const path = join(ROOT, file);
    const html = readFileSync(path, 'utf8');
    const novo = comVisitas(html, relDe(file), file);
    if (novo !== html) { writeFileSync(path, novo); mudou += 1; if (lista.length < 30) lista.push(file); }
  }
  console.log(mudou ? `Contador de visitas posto em ${mudou} página(s): ${lista.join(', ')}${mudou > lista.length ? ', …' : ''}` : 'Todas as páginas já tinham o contador de visitas.');
}
