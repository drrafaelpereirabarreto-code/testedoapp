#!/usr/bin/env node
// Põe o tema (assets/js/tema.js e assets/css/tema.css) no <head> de todas as páginas do site: as fixas (raiz e
// exames/, com a 404) e as das cidades já geradas (o gerador scripts/gerar-cidades.mjs já põe nas que ele cria).
// Rode depois de criar uma página:   node scripts/aplicar-tema.mjs        (--check: só confere, sem gravar)
// Onde entra: logo depois do <meta name="theme-color"> (o tema.js acerta a cor da barra do navegador) e antes de
// qualquer CSS, com o caminho até a raiz certo ('', '../', '../../../' ou o caminho absoluto na 404):
//   <script src="<raiz>assets/js/tema.js"></script>
//   <link rel="stylesheet" href="<raiz>assets/css/tema.css">
// O tema.js é o único script síncrono do site, de propósito: é pequeno e marca o <html> com o tema antes da primeira
// pintura (a página nunca abre piscando no tema errado). tests/tema.test.mjs confere todas as páginas.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { paginas, relDe } from './aplicar-rodape.mjs';
import { paginasCidades } from './aplicar-visitas.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const tagsTema = (rel) => `<script src="${rel}assets/js/tema.js"></script>\n<link rel="stylesheet" href="${rel}assets/css/tema.css">`;

const RE_TAGS = /<script src="[^"]*assets\/js\/tema\.js"[^>]*><\/script>\n?|<link rel="stylesheet" href="[^"]*assets\/css\/tema\.css">\n?/g;
// Onde pôr, na ordem de preferência: depois do theme-color; sem ele, depois do viewport, do charset ou do <head>.
const ANCORAS = [/<meta name="theme-color"[^>]*>/, /<meta name="viewport"[^>]*>/, /<meta charset="[^"]*">/i, /<head>/i];

// Devolve o HTML com o tema no <head> (uma vez só, no lugar certo). Já certo: devolve igual.
export function comTema(html, rel) {
  const limpo = html.replace(RE_TAGS, '');
  const head = limpo.search(/<\/head>/i);
  for (const re of ANCORAS) {
    const m = limpo.match(re);
    if (!m || (head >= 0 && m.index > head)) continue;
    const fim = m.index + m[0].length;
    return `${limpo.slice(0, fim)}\n${tagsTema(rel)}${limpo.slice(fim)}`;
  }
  return html; // sem <head>: não é página
}

// Todas as páginas que recebem o tema: fixas (raiz, exames/, 404) e das cidades.
export const paginasComTema = (root = ROOT) => [...paginas(root), ...paginasCidades(root)];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const so = process.argv.includes('--check');
  const mudou = [];
  for (const file of paginasComTema()) {
    const path = join(ROOT, file);
    const html = readFileSync(path, 'utf8');
    const novo = comTema(html, relDe(file));
    if (novo === html) continue;
    mudou.push(file);
    if (!so) writeFileSync(path, novo);
  }
  const lista = mudou.slice(0, 30).join(', ') + (mudou.length > 30 ? ', …' : '');
  if (so) {
    if (mudou.length) { console.error(`Sem o tema (ou fora do lugar) em ${mudou.length} página(s): ${lista}\nRode: node scripts/aplicar-tema.mjs`); process.exitCode = 1; } else console.log('Todas as páginas já estão com o tema.');
  } else console.log(mudou.length ? `Tema posto em ${mudou.length} página(s): ${lista}` : 'Todas as páginas já estavam com o tema.');
}
