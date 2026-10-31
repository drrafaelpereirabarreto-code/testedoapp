// Transforma a saída de um passo do banco.yml em avisos (anotações) no topo da execução do GitHub.
// O registro completo das execuções fica num lugar que o Claude não consegue ler: só os avisos aparecem
// (gh api .../check-runs/<job>/annotations). Cada aviso leva até 14 linhas úteis, sem linhas vazias.
//
//   node tests/banco/anotar.mjs supabase-start <registro>   migração que falhou (nome, erro, SQLSTATE, comando)
//   node tests/banco/anotar.mjs pgtap <registro>            cada teste pgTAP que falhou (com have/want) e erros de SQL
//   node tests/banco/anotar.mjs cauda "<título>" <registro> as últimas linhas do registro
//   node tests/banco/anotar.mjs resumo <pasta> "<passos>"   uma nota com o resumo de todos os passos
//   node tests/banco/anotar.mjs impressao <arquivo> "<rótulo>"         resumo por tipo da impressão digital
//   node tests/banco/anotar.mjs impressao-linhas <arquivo> "<tipos>"   as linhas da impressão, em notas
//     (a impressão é a saída de tests/banco/catalogo.sql; o resumo por tipo é igual ao que a mesma consulta dá na
//      produção, para conferir que o banco do CI é igual ao de lá)
//
// O GitHub mostra no máximo 10 avisos de erro por passo e 50 por execução: aqui são no máximo 8 por chamada.

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { anotar } from './lib.mjs';

const [modo, ...resto] = process.argv.slice(2);
const MAX = 8;
const ler = (arq) => (existsSync(arq) ? readFileSync(arq, 'utf8') : '')
  // tira cores e o \r das barras de progresso
  .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '\n').replace(/\r/g, '');
const linhasDe = (texto) => texto.split('\n').map((l) => l.replace(/\s+$/, ''));
const util = (l) => l.trim() !== '';

function cauda(titulo, texto, n = 42) {
  const linhas = linhasDe(texto).filter(util).slice(-n);
  anotar('error', titulo, linhas.length ? linhas.join('\n') : '(registro vazio)', { maxAvisos: 3 });
}

function supabaseStart(texto) {
  const linhas = linhasDe(texto);
  let ultimaMig = -1;
  linhas.forEach((l, i) => { if (/Applying migration /.test(l)) ultimaMig = i; });
  const inicioBusca = ultimaMig >= 0 ? ultimaMig + 1 : 0;
  const iErro = linhas.findIndex((l, i) => i >= inicioBusca && /(SQLSTATE|ERROR|error|failed|Error)/.test(l));
  if (iErro < 0) return cauda('O Supabase local não subiu', texto);
  const migracao = ultimaMig >= 0 ? linhas[ultimaMig].match(/Applying migration (\S+?)(\.\.\.)?$/)?.[1] : null;
  const bloco = linhas.slice(iErro, iErro + 40).filter(util);
  const aplicadas = linhas.filter((l) => /Applying migration /.test(l)).length;
  const titulo = migracao ? `Migração falhou - ${migracao}` : 'O Supabase local não subiu';
  const cab = migracao ? `${migracao} (${aplicadas}ª aplicada) falhou num banco novo:\n` : '';
  anotar('error', titulo, cab + bloco.join('\n'), { maxAvisos: 3 });
}

function pgtap(texto) {
  const linhas = linhasDe(texto);
  const blocos = [];
  let arquivo = '';
  for (let i = 0; i < linhas.length && blocos.length < MAX; i++) {
    const l = linhas[i];
    const arq = l.match(/(?:^|\/)([\w.-]+\.(?:sql|pg))\s+\.{2,}/);
    if (arq) arquivo = arq[1];
    if (/^#\s+Failed test/.test(l)) {
      const b = [l.replace(/^#\s+/, '')];
      for (let j = i + 1; j < linhas.length && b.length < 14; j++) {
        if (!/^#/.test(linhas[j]) || /^#\s+(Failed test|Looks like)/.test(linhas[j])) break;
        if (util(linhas[j].replace(/^#/, ''))) b.push(linhas[j].replace(/^#\s?/, ''));
      }
      blocos.push({ titulo: `pgTAP reprovou - ${arquivo || 'teste'}`, texto: b.join('\n') });
    } else if (/psql:.*(ERROR|FATAL):/.test(l)) {
      const b = [l];
      for (let j = i + 1; j < linhas.length && b.length < 14; j++) {
        if (!/^(DETAIL|HINT|CONTEXT|LINE \d+|QUERY|\s|psql:.*(DETAIL|HINT|CONTEXT|LINE))/.test(linhas[j])) break;
        if (util(linhas[j])) b.push(linhas[j]);
      }
      const nome = l.match(/psql:(?:.*\/)?([\w.-]+\.(?:sql|pg)):\d+/)?.[1] ?? arquivo;
      blocos.push({ titulo: `Erro de SQL no teste - ${nome || 'pgTAP'}`, texto: b.join('\n') });
    } else if (/(Bad plan|Dubious, test returned|No subtests run|planned \d+ tests? but ran)/.test(l)) {
      blocos.push({ titulo: `pgTAP parou no meio - ${arquivo || 'teste'}`, texto: l.trim() });
    }
  }
  const vistos = new Set();
  const unicos = blocos.filter((b) => !vistos.has(b.texto) && vistos.add(b.texto));
  if (!unicos.length) return cauda('pgTAP falhou', texto);
  for (const b of unicos) anotar('error', b.titulo, b.texto, { maxAvisos: 1 });
  const resultado = linhasDe(texto).filter((l) => /^(Files=|Result:|Failed \d+\/\d+ test programs)/.test(l));
  if (resultado.length) anotar('error', 'pgTAP - resultado', resultado.join('\n'), { maxAvisos: 1 });
}

function resumo(pasta, passos) {
  const linhas = [];
  if (passos) linhas.push(`Passos: ${passos}`);
  const arquivos = existsSync(pasta) ? readdirSync(pasta).sort() : [];
  for (const a of arquivos) {
    const p = path.join(pasta, a);
    if (a.endsWith('.txt')) linhas.push(...linhasDe(readFileSync(p, 'utf8')).filter(util));
    else if (a.endsWith('.json')) {
      const j = JSON.parse(readFileSync(p, 'utf8'));
      for (const n of j.notas ?? []) linhas.push(`${j.nome}: ${n}`);
    }
  }
  if (!linhas.length) linhas.push('nenhum passo deixou resumo');
  anotar('notice', 'Resumo do banco', linhas.join('\n'), { maxAvisos: 1, maxLinhas: 40 });
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Resumo do banco\n\n${linhas.map((l) => `- ${l}`).join('\n')}\n`);
  }
}

/* ===================== Impressão digital (tests/banco/catalogo.sql) ===================== */
// Linhas "<tipo> <objeto> <hash>". O resumo de cada tipo é o MD5 (12 caracteres) das linhas do tipo em ordem de
// bytes, unidas por "\n" — o mesmo que dá, rodada na produção, a consulta
//   select split_part(linha, ' ', 1), count(*), left(md5(string_agg(linha, chr(10) order by linha collate "C")), 12)
//   from (<tests/banco/catalogo.sql sem o "order by" do fim>) z group by 1 order by 1;
const linhasImpressao = (arq) => linhasDe(ler(arq)).filter(util).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

function resumoImpressao(linhas) {
  const porTipo = new Map();
  for (const l of linhas) {
    const tipo = l.split(' ', 1)[0];
    if (!porTipo.has(tipo)) porTipo.set(tipo, []);
    porTipo.get(tipo).push(l);
  }
  const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex').slice(0, 12);
  return [...porTipo.keys()].sort().map((tipo) => ({ tipo, n: porTipo.get(tipo).length, hash: md5(porTipo.get(tipo).join('\n')) }));
}

function impressao(arq, rotulo) {
  const linhas = linhasImpressao(arq);
  if (!linhas.length) {
    anotar('error', `Impressão digital vazia - ${rotulo}`, `nenhuma linha em ${arq}`);
    process.exitCode = 1;
    return;
  }
  const tipos = resumoImpressao(linhas);
  const extensoes = linhas.filter((l) => l.startsWith('extensao ')).map((l) => l.split(' ').slice(1).join(' ')).join(', ');
  const texto = `Impressão digital ${rotulo}: ${linhas.length} objetos; ${tipos.map((t) => `${t.tipo} ${t.n} ${t.hash}`).join(' · ')}`
    + `\nExtensões ${rotulo}: ${extensoes || 'nenhuma'}`;
  console.log(texto);
  const dir = process.env.IMED_RESUMO_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    const nome = `45-impressao-${rotulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.txt`;
    writeFileSync(path.join(dir, nome), `${texto}\n`);
  }
}

// As linhas da impressão (de alguns tipos ou de todas), em notas de até ~3.500 caracteres, para comparar objeto a
// objeto com a produção quando o resumo por tipo não bate. No máximo 9 notas (o GitHub mostra 10 por passo).
function impressaoLinhas(arq, tiposTexto) {
  const tipos = new Set(String(tiposTexto || 'todos').split(/[\s,]+/).filter(Boolean));
  const linhas = linhasImpressao(arq).filter((l) => tipos.has('todos') || tipos.has(l.split(' ', 1)[0]));
  const blocos = [];
  let atual = [];
  let tamanho = 0;
  for (const l of linhas) {
    if (atual.length && tamanho + l.length + 1 > 3500) { blocos.push(atual); atual = []; tamanho = 0; }
    atual.push(l);
    tamanho += l.length + 1;
  }
  if (atual.length) blocos.push(atual);
  const MAX_NOTAS = 9;
  blocos.slice(0, MAX_NOTAS).forEach((b, i) => {
    anotar('notice', `Impressão digital (${[...tipos].join(',')}) ${i + 1}/${blocos.length}`, b.join('\n'),
      { maxAvisos: 1, maxLinhas: b.length });
  });
  if (blocos.length > MAX_NOTAS) {
    anotar('warning', 'Impressão digital cortada',
      `${blocos.length} blocos; só os ${MAX_NOTAS} primeiros viraram nota. Peça menos tipos (impressao=funcao,tabela...).`);
  }
}

if (modo === 'supabase-start') supabaseStart(ler(resto[0]));
else if (modo === 'pgtap') pgtap(ler(resto[0]));
else if (modo === 'cauda') cauda(resto[0], ler(resto[1]));
else if (modo === 'resumo') resumo(resto[0], resto[1]);
else if (modo === 'impressao') impressao(resto[0], resto[1] || 'do banco');
else if (modo === 'impressao-linhas') impressaoLinhas(resto[0], resto[1]);
else {
  console.error('uso: node tests/banco/anotar.mjs supabase-start|pgtap <registro> | cauda "<título>" <registro> | '
    + 'resumo <pasta> "<passos>" | impressao <arquivo> "<rótulo>" | impressao-linhas <arquivo> "<tipos>"');
  process.exitCode = 2;
}
