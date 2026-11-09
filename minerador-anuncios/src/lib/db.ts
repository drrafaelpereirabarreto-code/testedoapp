// Acesso ao banco de dados.
// - Sem DATABASE_URL: SQLite num arquivo (dados/minerador.db), usando o SQLite que já vem no Node 22.
// - Com DATABASE_URL=postgres://...: Postgres (Supabase, Neon etc.), para colocar na Vercel.
// Todo o SQL do projeto usa "?" nos parâmetros e só comandos que funcionam nos dois bancos.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { SCHEMA } from "./schema";

type Linha = Record<string, unknown>;
type Param = string | number | null;

interface Motor {
  all(sql: string, params: Param[]): Promise<Linha[]>;
  run(sql: string, params: Param[]): Promise<void>;
  exec(sql: string): Promise<void>;
  lote(comandos: Array<[string, Param[]]>): Promise<void>;
  tipo: "sqlite" | "postgres";
}

declare global {
  // eslint-disable-next-line no-var
  var __mineradorDb: Promise<Motor> | undefined;
}

function caminhoSqlite(): string {
  return process.env.SQLITE_ARQUIVO || path.join(process.cwd(), "dados", "minerador.db");
}

async function abrirSqlite(): Promise<Motor> {
  // createRequire evita que o empacotador do Next tente embutir o módulo nativo.
  const req = createRequire(path.join(process.cwd(), "package.json"));
  const { DatabaseSync } = req("node:sqlite") as typeof import("node:sqlite");
  const arquivo = caminhoSqlite();
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const banco = new DatabaseSync(arquivo);
  banco.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  return {
    tipo: "sqlite",
    async all(sql, params) {
      return banco.prepare(sql).all(...params) as Linha[];
    },
    async run(sql, params) {
      banco.prepare(sql).run(...params);
    },
    async exec(sql) {
      banco.exec(sql);
    },
    async lote(comandos) {
      banco.exec("BEGIN");
      try {
        for (const [sql, params] of comandos) banco.prepare(sql).run(...params);
        banco.exec("COMMIT");
      } catch (e) {
        banco.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

function paraPostgres(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function abrirPostgres(url: string): Promise<Motor> {
  const { Pool, types } = await import("pg");
  // COUNT/SUM chegam como texto no Postgres: converte para número.
  types.setTypeParser(20, (v: string) => Number(v));
  types.setTypeParser(1700, (v: string) => Number(v));
  const pool = new Pool({
    connectionString: url,
    max: 3,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  });
  return {
    tipo: "postgres",
    async all(sql, params) {
      const r = await pool.query(paraPostgres(sql), params);
      return r.rows as Linha[];
    },
    async run(sql, params) {
      await pool.query(paraPostgres(sql), params);
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async lote(comandos) {
      const cliente = await pool.connect();
      try {
        await cliente.query("BEGIN");
        for (const [sql, params] of comandos) await cliente.query(paraPostgres(sql), params);
        await cliente.query("COMMIT");
      } catch (e) {
        await cliente.query("ROLLBACK");
        throw e;
      } finally {
        cliente.release();
      }
    },
  };
}

async function abrir(): Promise<Motor> {
  const url = process.env.DATABASE_URL?.trim();
  const motor = url && /^postgres(ql)?:\/\//.test(url) ? await abrirPostgres(url) : await abrirSqlite();
  // Cria as tabelas que faltam (seguro rodar sempre).
  for (const comando of SCHEMA) await motor.exec(comando);
  return motor;
}

function motor(): Promise<Motor> {
  if (!globalThis.__mineradorDb) {
    globalThis.__mineradorDb = abrir().catch((e) => {
      globalThis.__mineradorDb = undefined;
      throw e;
    });
  }
  return globalThis.__mineradorDb;
}

function normalizar(l: Linha): Linha {
  for (const k of Object.keys(l)) if (typeof l[k] === "bigint") l[k] = Number(l[k]);
  return l;
}

export async function todos<T = Linha>(sql: string, params: Param[] = []): Promise<T[]> {
  const m = await motor();
  return (await m.all(sql, params)).map(normalizar) as T[];
}

export async function um<T = Linha>(sql: string, params: Param[] = []): Promise<T | undefined> {
  return (await todos<T>(sql, params))[0];
}

export async function executar(sql: string, params: Param[] = []): Promise<void> {
  const m = await motor();
  await m.run(sql, params);
}

/** Executa vários comandos de uma vez (tudo ou nada). */
export async function emLote(comandos: Array<[string, Param[]]>): Promise<void> {
  if (comandos.length === 0) return;
  const m = await motor();
  // Lotes grandes em partes, para não segurar o banco por muito tempo.
  for (let i = 0; i < comandos.length; i += 500) await m.lote(comandos.slice(i, i + 500));
}

export async function tipoBanco(): Promise<"sqlite" | "postgres"> {
  return (await motor()).tipo;
}
