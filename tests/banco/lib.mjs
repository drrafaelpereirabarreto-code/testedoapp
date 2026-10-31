// Ferramentas dos testes do banco de verdade (iMed Agenda, fase 3.0; arquitetura §13).
// Usadas pelos scripts tests/banco/*.mjs (no GitHub: .github/workflows/banco.yml) e pelo laço local (tests/banco/local/).
// Dependem só do Node 22 e do pacote "pg", com a versão travada em tests/banco/package-lock.json:
//   npm ci --prefix tests/banco --ignore-scripts
//
//   configLocal()            endereços e segredo do Supabase LOCAL (nunca da produção)
//   jwt(), tokenAnon(), ...  tokens assinados com o segredo do banco local, iguais aos do Auth
//   conectar()               conexão direta com o Postgres (recusa banco com dados da produção)
//   rodarJuntos()            N transações que partem juntas (barreira com pg_advisory_lock)
//   estatisticas()           p50, p95, máximo e erros por código (23P01, 23505, 40P01, 57014...)
//   postgrest()              chamada HTTP no PostgREST local, como o site faz
//   anotar(), resumir()      avisos no topo da execução do GitHub e resumo (o registro do GitHub não é lido daqui)

import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const NO_GITHUB = process.env.GITHUB_ACTIONS === 'true';

/* ===================== Avisos (anotações) e resumo ===================== */

const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/**
 * Mostra um aviso. No GitHub vira anotação (::error, ::warning ou ::notice) no topo da página da execução,
 * com até 14 linhas por aviso (linhas vazias são puladas) e no máximo `maxAvisos` avisos; fora dele, texto simples.
 */
export function anotar(nivel, titulo, texto = '', { maxLinhas = 14, maxAvisos = 3 } = {}) {
  const linhas = String(texto).split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
  const blocos = [];
  for (let i = 0; i < Math.max(linhas.length, 1) && blocos.length < maxAvisos; i += maxLinhas) {
    blocos.push(linhas.slice(i, i + maxLinhas).join('\n'));
  }
  blocos.forEach((b, k) => {
    const t = blocos.length > 1 ? `${titulo} (${k + 1}/${blocos.length})` : titulo;
    if (NO_GITHUB) console.log(`::${nivel} title=${escProp(t)}::${esc(b || t)}`);
    else console.log(`[${nivel === 'error' ? 'ERRO' : nivel === 'warning' ? 'ATENÇÃO' : 'nota'}] ${t}${b ? `\n  ${b.replace(/\n/g, '\n  ')}` : ''}`);
  });
}

/** Texto útil de um erro do Postgres (código, mensagem, detalhe, dica, onde) ou de um erro qualquer. */
export function descreverErro(e) {
  if (!e) return 'erro desconhecido';
  const partes = [];
  if (e.code) partes.push(`código ${e.code}`);
  partes.push(e.message || String(e));
  for (const k of ['detail', 'hint', 'where', 'table', 'constraint']) if (e[k]) partes.push(`${k}: ${e[k]}`);
  if (e.stack && !e.code) partes.push(...String(e.stack).split('\n').slice(1, 6).map((l) => l.trim()));
  return partes.join('\n');
}

let falhas = 0;
/** Confere uma condição: se não vale, avisa (anotação de erro) e o script termina com código 1. */
export function afirmar(cond, titulo, detalhes = '') {
  if (cond) {
    console.log(`ok - ${titulo}`);
    return true;
  }
  falhas++;
  console.log(`FALHOU - ${titulo}`);
  anotar('error', `Falhou - ${titulo}`, detalhes);
  process.exitCode = 1;
  return false;
}
export const falhou = () => falhas > 0;

/**
 * Guarda o resumo do script: JSON em $IMED_RESUMO_DIR (o último passo do banco.yml junta todos numa nota no topo
 * da página) e uma lista no resumo da execução ($GITHUB_STEP_SUMMARY).
 */
export function resumir(nome, dados, notas = []) {
  console.log(`\nResumo - ${nome}\n${notas.map((l) => `  ${l}`).join('\n')}`);
  const dir = process.env.IMED_RESUMO_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${nome}.json`), JSON.stringify({ nome, notas, ...dados }, null, 2));
  }
  const sumario = process.env.GITHUB_STEP_SUMMARY;
  if (sumario && notas.length) appendFileSync(sumario, `### ${nome}\n\n${notas.map((l) => `- ${l}`).join('\n')}\n\n`);
}

/** Roda o corpo do script; erro inesperado vira aviso com a causa (e código de saída 1). */
export async function principal(nome, corpo) {
  try {
    await corpo();
  } catch (e) {
    process.exitCode = 1;
    console.error(e);
    anotar('error', `${nome} - erro inesperado`, descreverErro(e));
  }
}

/* ===================== Supabase LOCAL ===================== */

/**
 * Endereços e segredo do Supabase local. Ordem: arquivo de $IMED_SUPABASE_STATUS (o banco.yml grava a saída de
 * "supabase status -o json"), depois o próprio "supabase status -o json", depois as variáveis DB_URL, API_URL,
 * JWT_SECRET e ANON_KEY. Recusa endereço que não seja desta máquina: os testes nunca falam com a produção.
 */
// A saída de "supabase status -o json" pode vir com avisos antes ou depois do JSON: pega só o objeto.
export const jsonDaSaida = (texto) => JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));

export function configLocal() {
  let st = null;
  const arq = process.env.IMED_SUPABASE_STATUS;
  if (arq && existsSync(arq)) st = jsonDaSaida(readFileSync(arq, 'utf8'));
  if (!st && !process.env.DB_URL) {
    try {
      st = jsonDaSaida(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch { /* sem a CLI ou sem o Supabase local de pé */ }
  }
  st ??= {};
  const cfg = {
    dbUrl: st.DB_URL ?? process.env.DB_URL,
    apiUrl: st.API_URL ?? process.env.API_URL,
    jwtSecret: st.JWT_SECRET ?? process.env.JWT_SECRET,
    anonKey: st.ANON_KEY ?? process.env.ANON_KEY,
  };
  if (!cfg.dbUrl) throw new Error('Supabase local não encontrado: rode "supabase start" (ou defina DB_URL).');
  for (const [k, v] of Object.entries({ dbUrl: cfg.dbUrl, apiUrl: cfg.apiUrl })) {
    if (v && !ehDestaMaquina(v)) {
      throw new Error(`${k} não é desta máquina (${v.replace(/\/\/[^@/]*@/, '//***@')}): os testes do banco só rodam no Supabase local.`);
    }
  }
  return cfg;
}

/**
 * Endereço desta máquina (127.0.0.1, localhost ou [::1]) e SEM parâmetro que troque o servidor de verdade: o pacote
 * "pg" dá prioridade a host=, hostaddr= e service= da query (ex.: ...@127.0.0.1/postgres?host=db.<projeto>.supabase.co
 * iria para a produção). Um túnel local para a produção passaria daqui: quem pega isso é a conferência de conectar().
 */
export function ehDestaMaquina(endereco) {
  let u;
  try { u = new URL(endereco); } catch { return false; }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return false;
  for (const p of u.searchParams.keys()) if (['host', 'hostaddr', 'service'].includes(p.toLowerCase())) return false;
  return true;
}

/* ===================== Tokens (JWT HS256, assinados com o segredo do banco local) ===================== */

const b64url = (obj) => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');

export function jwt(claims, segredo, { validadeS = 3600 } = {}) {
  if (!segredo) throw new Error('Sem o segredo dos tokens do Supabase local (JWT_SECRET).');
  const agora = Math.floor(Date.now() / 1000);
  const corpo = { iat: agora, exp: agora + validadeS, ...claims };
  const base = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(corpo)}`;
  return `${base}.${createHmac('sha256', segredo).update(base).digest('base64url')}`;
}

/** Visitante (o que o site manda hoje sem login), assinado aqui com o segredo do Supabase local. */
export const tokenAnon = (cfg) => jwt({ role: 'anon', iss: 'supabase' }, cfg.jwtSecret);

/** Pessoa logada pelo link do e-mail (amr "otp"), como o Auth emite. */
export const tokenUsuario = (cfg, { sub, email }) => jwt({
  role: 'authenticated', aud: 'authenticated', iss: 'supabase', sub, email,
  amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) }],
}, cfg.jwtSecret);

/* ===================== Postgres ===================== */

let pgMod = null;
export async function carregarPg() {
  if (pgMod) return pgMod;
  try {
    pgMod = (await import('pg')).default;
  } catch {
    throw new Error('Falta o pacote "pg": rode "npm ci --prefix tests/banco --ignore-scripts" na pasta do repositório.');
  }
  return pgMod;
}

const bancosConferidos = new Set();

/**
 * Conexão direta. Na primeira conexão com cada banco, confere que ele NÃO tem dados da produção: banco novo (CI,
 * cópia local) não tem nenhuma importação do CNES (public.establishment_imports vazia; a produção tem centenas).
 * Assim, nem um túnel local para a produção deixa os scripts gravarem clínicas e pedidos de teste lá.
 */
export async function conectar(conexao, nome = 'imed-teste') {
  const pg = await carregarPg();
  const opcoes = typeof conexao === 'string' ? { connectionString: conexao } : { ...conexao };
  const c = new pg.Client({ ...opcoes, application_name: nome, connectionTimeoutMillis: 15000 });
  await c.connect();
  c.on('error', () => {}); // conexão derrubada no meio de um teste não derruba o processo
  const chave = typeof conexao === 'string' ? conexao : `${conexao.host}:${conexao.port}/${conexao.database}`;
  if (!bancosConferidos.has(chave)) {
    try {
      const { rows: [t] } = await c.query(`select to_regclass('public.establishment_imports') is not null as tem`);
      if (t.tem) {
        const { rows: [r] } = await c.query('select exists (select 1 from public.establishment_imports) as producao');
        if (r.producao) {
          throw new Error('este banco tem importações do CNES (public.establishment_imports): parece a PRODUÇÃO, '
            + 'e os testes só rodam num banco novo (Supabase local)');
        }
      }
    } catch (e) {
      await c.end().catch(() => {});
      throw e;
    }
    bancosConferidos.add(chave);
  }
  return c;
}

/**
 * Roda `n` transações que partem juntas. Cada uma abre a transação, espera na barreira
 * (pg_advisory_xact_lock_shared enquanto o coordenador segura pg_advisory_lock da mesma chave), chama
 * `trabalho(cliente, i)` e faz COMMIT; erro faz ROLLBACK e é guardado com o código do Postgres.
 * O tempo de cada uma conta da saída da barreira até o fim do COMMIT (sem a abertura da conexão).
 */
export async function rodarJuntos({ conexao, n, trabalho, chave = 424242, limiteEsperaMs = 60000 }) {
  const coord = await conectar(conexao, 'imed-coordenador');
  await coord.query('select pg_advisory_lock($1::bigint)', [chave]);
  const clientes = [];
  try {
    for (let i = 0; i < n; i += 20) {
      clientes.push(...await Promise.all(Array.from({ length: Math.min(20, n - i) }, (_, k) => conectar(conexao, `imed-trabalho-${i + k}`))));
    }
    const resultados = new Array(n);
    const corridas = clientes.map(async (c, i) => {
      let t0 = 0;
      try {
        await c.query('begin');
        await c.query('select pg_advisory_xact_lock_shared($1::bigint)', [chave]);
        t0 = performance.now();
        const valor = await trabalho(c, i);
        await c.query('commit');
        resultados[i] = { ok: valor !== false, valor, ms: performance.now() - t0 };
      } catch (e) {
        const ms = t0 ? performance.now() - t0 : 0;
        try { await c.query('rollback'); } catch { /* conexão perdida */ }
        resultados[i] = { ok: false, code: e.code ?? 'sem_codigo', message: e.message, ms };
      }
    });
    // Solta a barreira só quando todas estão esperando nela.
    const limite = performance.now() + limiteEsperaMs;
    for (;;) {
      const { rows } = await coord.query(
        `select count(*)::int as n from pg_locks
          where locktype = 'advisory' and classid::bigint = 0 and objid::bigint = $1::bigint and objsubid = 1
            and not granted`, [chave % 4294967296]);
      if (rows[0].n >= n) break;
      if (performance.now() > limite) throw new Error(`só ${rows[0].n} de ${n} transações chegaram à barreira em ${limiteEsperaMs} ms`);
      await new Promise((r) => setTimeout(r, 20));
    }
    const solta = performance.now();
    await coord.query('select pg_advisory_unlock($1::bigint)', [chave]);
    await Promise.all(corridas);
    return { resultados, totalMs: performance.now() - solta };
  } finally {
    await Promise.all(clientes.map((c) => c.end().catch(() => {})));
    await coord.end().catch(() => {});
  }
}

/* ===================== Números ===================== */

export function percentil(valores, p) {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}

/** Resumo de uma rodada: quantas deram certo, erros por código e tempos (ms). */
export function estatisticas(resultados) {
  const porCodigo = {};
  for (const r of resultados) if (!r.ok && r.code) porCodigo[r.code] = (porCodigo[r.code] ?? 0) + 1;
  const ms = resultados.map((r) => r.ms);
  return {
    total: resultados.length,
    ok: resultados.filter((r) => r.ok).length,
    porCodigo,
    p50: Math.round(percentil(ms, 50)),
    p95: Math.round(percentil(ms, 95)),
    max: Math.round(Math.max(0, ...ms.filter(Number.isFinite))),
  };
}

export const textoCodigos = (porCodigo) =>
  Object.keys(porCodigo).length ? Object.entries(porCodigo).map(([k, v]) => `${v}× ${k}`).join(', ') : 'nenhum erro';

/* ===================== HTTP no PostgREST local ===================== */

/**
 * Chamada no PostgREST local como o site faz (apikey + Authorization). Devolve status, código do erro e tempo.
 * `prefer: null` não manda o cabeçalho Prefer (chamada de função, rpc/...).
 */
export async function postgrest(cfg, caminho, { token, metodo = 'POST', corpo, prefer = 'return=minimal' } = {}) {
  const t0 = performance.now();
  const resp = await fetch(`${cfg.apiUrl}/rest/v1/${caminho}`, {
    method: metodo,
    headers: {
      apikey: cfg.anonKey ?? token,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resp.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* resposta sem JSON */ }
  return { status: resp.status, ok: resp.ok, code: json?.code, message: json?.message ?? texto.slice(0, 300), json, ms: performance.now() - t0 };
}
