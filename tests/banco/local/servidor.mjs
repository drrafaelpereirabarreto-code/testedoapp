// Sobe um PostgreSQL descartável nesta máquina (sem Docker) para o laço rápido do banco (tests/banco/local/).
// initdb numa pasta temporária, pg_ctl numa porta livre (só 127.0.0.1), e tudo apagado no fim.
// Procura os programas em $PG_BIN, depois em /usr/lib/postgresql/<versão>/bin (a maior), depois no "pg_config".
// Como root (máquina do Claude), roda initdb e pg_ctl como o usuário "postgres" do sistema (o initdb recusa root).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export function acharBinarios() {
  const candidatos = [];
  if (process.env.PG_BIN) candidatos.push(process.env.PG_BIN);
  for (const base of ['/usr/lib/postgresql', '/usr/local/lib/postgresql']) {
    if (!existsSync(base)) continue;
    const versoes = readdirSync(base).filter((v) => /^\d+$/.test(v)).sort((a, b) => Number(b) - Number(a));
    candidatos.push(...versoes.map((v) => path.join(base, v, 'bin')));
  }
  try {
    candidatos.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch { /* sem pg_config no PATH */ }
  return candidatos.find((d) => d && ['initdb', 'pg_ctl', 'postgres'].every((p) => existsSync(path.join(d, p)))) ?? null;
}

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * Sobe o servidor e devolve { conexao, versao, parar }. `conexao` serve para o pacote "pg"
 * ({ host, port, user, database }). Devolve null se não houver PostgreSQL instalado.
 */
export async function subirPostgres({ maxConexoes = 250 } = {}) {
  const bin = acharBinarios();
  if (!bin) return null;
  const comoRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'imed-pg-'));
  const dados = path.join(dir, 'dados');
  const rodar = (prog, args) => {
    const [cmd, argv] = comoRoot ? ['runuser', ['-u', 'postgres', '--', path.join(bin, prog), ...args]] : [path.join(bin, prog), args];
    const r = spawnSync(cmd, argv, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${prog} falhou (código ${r.status}): ${(r.stderr || r.stdout || r.error?.message || '').trim()}`);
    return r.stdout;
  };
  let parado = false;
  const parar = () => {
    if (parado) return;
    parado = true;
    try { rodar('pg_ctl', ['-D', dados, '-m', 'immediate', '-w', 'stop']); } catch { /* já parado */ }
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    if (comoRoot) execFileSync('chown', ['postgres:postgres', dir]);
    rodar('initdb', ['-D', dados, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C', '--no-sync']);
    const porta = await portaLivre();
    // Mesmos valores da produção onde importam: deadlock_timeout 1 s, READ COMMITTED (padrão), servidor em UTC.
    const opcoes = [`-p ${porta}`, `-k ${dir}`, '-c listen_addresses=127.0.0.1', `-c max_connections=${maxConexoes}`,
      '-c deadlock_timeout=1s', '-c timezone=UTC', '-c log_min_messages=warning'].join(' ');
    rodar('pg_ctl', ['-D', dados, '-o', opcoes, '-l', path.join(dir, 'registro.log'), '-w', '-t', '60', 'start']);
    const versao = rodar('postgres', ['--version']).trim();
    process.once('exit', parar);
    for (const sinal of ['SIGINT', 'SIGTERM']) process.once(sinal, () => { parar(); process.exit(130); });
    return { conexao: { host: '127.0.0.1', port: porta, user: 'postgres', database: 'postgres' }, versao, parar };
  } catch (e) {
    parar();
    throw e;
  }
}
