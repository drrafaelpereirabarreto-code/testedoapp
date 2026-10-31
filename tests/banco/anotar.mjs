// Transforma a saída de um passo do banco.yml em avisos (anotações) no topo da execução do GitHub.
// O registro completo das execuções fica num lugar que o Claude não consegue ler: só os avisos aparecem
// (gh api .../check-runs/<job>/annotations). Cada aviso leva até 14 linhas úteis, sem linhas vazias.
//
//   node tests/banco/anotar.mjs supabase-start <registro>   migração que falhou (nome, erro, SQLSTATE, comando)
//   node tests/banco/anotar.mjs pgtap <registro>            cada teste pgTAP que falhou (com have/want) e erros de SQL
//   node tests/banco/anotar.mjs cauda "<título>" <registro> as últimas linhas do registro
//   node tests/banco/anotar.mjs resumo <pasta> "<passos>"   uma nota com o resumo de todos os passos
//
// O GitHub mostra no máximo 10 avisos de erro por passo e 50 por execução: aqui são no máximo 8 por chamada.

import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
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

if (modo === 'supabase-start') supabaseStart(ler(resto[0]));
else if (modo === 'pgtap') pgtap(ler(resto[0]));
else if (modo === 'cauda') cauda(resto[0], ler(resto[1]));
else if (modo === 'resumo') resumo(resto[0], resto[1]);
else {
  console.error('uso: node tests/banco/anotar.mjs supabase-start|pgtap <registro> | cauda "<título>" <registro> | resumo <pasta> "<passos>"');
  process.exitCode = 2;
}
