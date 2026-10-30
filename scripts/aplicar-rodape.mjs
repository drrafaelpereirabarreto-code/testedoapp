#!/usr/bin/env node
// Põe o rodapé do IMED (scripts/rodape.mjs) nas páginas fixas do site. Rode depois de mudar o rodapé:
//   node scripts/aplicar-rodape.mjs
// Em cada página com os marcadores <!-- rodape --> e <!-- /rodape -->, troca o que está entre eles pelo
// rodapé atual e garante o <link> de assets/css/rodape.css no <head>. Página nova: ponha os dois
// marcadores onde o rodapé deve ficar (normalmente logo antes dos <script> do fim) e rode o comando.
// As páginas das cidades (cidades/**) recebem o rodapé pelo gerador (scripts/gerar-cidades.mjs).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rodapeHtml, INICIO, FIM } from './rodape.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Páginas que precisam ter o rodapé (o teste confere). Outras páginas com os marcadores também são atualizadas.
export const OBRIGATORIAS = [
  'index.html', 'perto.html', 'local.html', 'conta.html', 'painel.html', 'reivindicar.html', 'parceiros.html',
  'sobre.html', 'como-funciona.html', 'termos.html', 'privacidade.html', 'acessibilidade.html', 'contato.html', '404.html',
  'exames/index.html', 'exames/raio-x.html', 'exames/ultrassom.html', 'exames/tomografia.html',
  'exames/ressonancia-magnetica.html', 'exames/mamografia.html', 'exames/densitometria-ossea.html',
  'exames/eletrocardiograma.html', 'exames/ecocardiograma.html',
];

// A página 404 pode abrir em qualquer endereço do site: usa o caminho absoluto do site (de assets/js/config.js).
export function relDe(file, root = ROOT) {
  if (file === '404.html') {
    const src = readFileSync(join(root, 'assets/js/config.js'), 'utf8');
    const m = src.match(/siteUrl\s*:\s*['"]([^'"]+)['"]/);
    return m ? new URL(m[1]).pathname : '/';
  }
  return '../'.repeat(file.split('/').length - 1);
}

// Todas as páginas fixas (raiz e exames/), na ordem do nome.
export function paginas(root = ROOT) {
  const raiz = readdirSync(root).filter((f) => f.endsWith('.html')).sort();
  const exames = existsSync(join(root, 'exames')) ? readdirSync(join(root, 'exames')).filter((f) => f.endsWith('.html')).sort().map((f) => `exames/${f}`) : [];
  return [...raiz, ...exames];
}

export function temMarcadores(html) {
  const a = html.indexOf(INICIO), b = html.indexOf(FIM);
  return a >= 0 && b > a && html.indexOf(INICIO, a + 1) < 0;
}

// Devolve o HTML com o rodapé atual e o CSS do rodapé no <head>. Sem os marcadores: devolve igual.
export function aplicar(html, rel) {
  if (!temMarcadores(html)) return html;
  const a = html.indexOf(INICIO), b = html.indexOf(FIM) + FIM.length;
  let out = html.slice(0, a) + rodapeHtml(rel) + html.slice(b);
  const css = `<link rel="stylesheet" href="${rel}assets/css/rodape.css">`;
  if (!out.includes(css)) {
    out = out.replace(/<link rel="stylesheet" href="[^"]*assets\/css\/rodape\.css">\n?/g, '');
    out = out.replace('</head>', `${css}\n</head>`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mudou = [], faltam = [];
  for (const file of paginas()) {
    const path = join(ROOT, file);
    const html = readFileSync(path, 'utf8');
    if (!temMarcadores(html)) { if (OBRIGATORIAS.includes(file)) faltam.push(file); continue; }
    const novo = aplicar(html, relDe(file));
    if (novo !== html) { writeFileSync(path, novo); mudou.push(file); }
  }
  console.log(mudou.length ? `Rodapé atualizado em: ${mudou.join(', ')}` : 'Todas as páginas já estavam com o rodapé atual.');
  if (faltam.length) { console.error(`Sem os marcadores ${INICIO} … ${FIM}: ${faltam.join(', ')}`); process.exitCode = 1; }
}
