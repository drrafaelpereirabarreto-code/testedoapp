// Laço rápido do banco (iMed Agenda, fase 3.0; arquitetura §3.4 e §13), SEM Docker: sobe um PostgreSQL descartável
// desta máquina, cria a base mínima (base.sql) e a tabela de prova da agenda (prova.sql) e confere em segundos a
// restrição de exclusão (EXCLUDE) que garante "nenhum horário vendido duas vezes para o mesmo recurso".
//
//   node tests/banco/local/rodar.mjs                       casos do §3.4 (segundos)
//   node tests/banco/local/rodar.mjs --concorrencia        + 40 e 100 ao mesmo tempo, com e sem trava por recurso
//   node tests/banco/local/rodar.mjs --concorrencia=com-trava   só o modo com trava (o do CI)
//   ... --sem-limite   na concorrência, sem o tempo-limite de 3 s do anon (mostra as cadeias longas de impasse)
//
// Precisa do PostgreSQL (16 ou mais novo, com btree_gist) e do pacote "pg" (npm i --no-save pg). Não substitui o CI
// (falta PostGIS, PostgREST, Auth e Realtime): é para errar rápido antes de mandar para o GitHub.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { afirmar, anotar, conectar, estatisticas, principal, resumir, rodarJuntos, textoCodigos } from '../lib.mjs';
import { subirPostgres } from './servidor.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const conc = args.find((a) => a.startsWith('--concorrencia'));
const modosConc = !conc ? [] : conc.includes('=') ? conc.split('=')[1].split(',') : ['sem-trava', 'com-trava'];
const limite = args.includes('--sem-limite') ? null : '3s';

const CLINICA = '0c000000-0000-4000-8000-000000000001';
const RM = '0e000000-0000-4000-8000-000000000001';      // aparelho de ressonância, capacidade 1
const SALA = '0e000000-0000-4000-8000-000000000002';    // sala de coleta, capacidade 2
const t = (hhmm) => `2026-12-01 ${hhmm}:00-03`;
const faixa = (de, ate) => `[${t(de)},${t(ate)})`;

/* ===================== Casos (arquitetura §3.4) ===================== */
// Cada passo roda num SAVEPOINT; `espera` é 'ok' ou o código do erro esperado.
const uso = (rec, de, ate, { vaga = 1, kind = 'agendamento', ativo = true } = {}) => ({
  sql: `insert into prova.occupancy (clinic_id, resource_id, kind, seats, during, item_id, group_no, busy_id, active, released_at)
        values ($1, $2, $3, int4range($4::int, $4::int + 1), $5::tstzrange,
                case when $3 = 'agendamento' then gen_random_uuid() end, case when $3 = 'agendamento' then 1 end,
                case when $3 = 'ocupado' then gen_random_uuid() end, $6, case when $6 then null else now() end)`,
  params: [CLINICA, rec, kind, vaga, faixa(de, ate), ativo],
});
const bloqueio = (rec, de, ate, { ativo = true, grupo = null } = {}) => ({
  sql: `insert into prova.occupancy (clinic_id, resource_id, kind, seats, during, block_id, active, released_at, excl_group)
        values ($1, $2, 'bloqueio', int4range(1, 51), $3::tstzrange, gen_random_uuid(), $4, case when $4 then null else now() end,
                coalesce($5::int8range, '(,)'::int8range))`,
  params: [CLINICA, rec, faixa(de, ate), ativo, grupo],
});

const cenarios = [
  {
    nome: 'Aparelho exclusivo (RM, capacidade 1)',
    passos: [
      ['uso 10:00–10:45', uso(RM, '10:00', '10:45'), 'ok'],
      ['outro uso 10:30–11:00 (início diferente que cruza) é recusado', uso(RM, '10:30', '11:00'), '23P01'],
      ['uso com o mesmo início 10:00–10:30 é recusado', uso(RM, '10:00', '10:30'), '23P01'],
      ['uso encostado 10:45–11:15 é aceito', uso(RM, '10:45', '11:15'), 'ok'],
      ['uso liberado (inativo) por cima não conta', uso(RM, '10:15', '10:40', { ativo: false }), 'ok'],
      ['"ocupado" (sem paciente) 10:50–11:00 em cima do uso é recusado', uso(RM, '10:50', '11:00', { kind: 'ocupado' }), '23P01'],
    ],
  },
  {
    nome: 'Bloqueios (fechamento do recurso)',
    passos: [
      ['bloqueio 13:00–15:00 (o gatilho preenche o grupo com o próprio id)', bloqueio(RM, '13:00', '15:00'), 'ok'],
      ['bloqueio 14:00–16:00 que cruza o outro é aceito (manutenção × feriado)', bloqueio(RM, '14:00', '16:00'), 'ok'],
      ['uso 14:30–14:45 dentro do bloqueio é recusado', uso(RM, '14:30', '14:45'), '23P01'],
      ['uso 16:00–16:30 encostado no fim do bloqueio é aceito', uso(RM, '16:00', '16:30'), 'ok'],
      ['bloqueio 16:15–16:45 em cima de um uso é recusado', bloqueio(RM, '16:15', '16:45'), '23P01'],
      ['bloqueio com grupo errado é recusado pelo CHECK', bloqueio(RM, '17:00', '18:00', { grupo: '[5,5]' }), '23514'],
      ['bloqueio inativo (já removido) por cima do uso é aceito', bloqueio(RM, '16:00', '16:30', { ativo: false }), 'ok'],
      ['reativar esse bloqueio por cima do uso é recusado',
        { sql: `update prova.occupancy set active = true, released_at = null
                where resource_id = $1 and kind = 'bloqueio' and not active`, params: [RM] }, '23P01'],
    ],
  },
  {
    nome: 'Sala com capacidade 2 (vagas)',
    passos: [
      ['"ocupado" na vaga 1, 10:00–11:00', uso(SALA, '10:00', '11:00', { kind: 'ocupado' }), 'ok'],
      ['outro na vaga 1, 10:30–11:00, é recusado', uso(SALA, '10:30', '11:00'), '23P01'],
      ['agendamento na vaga 2, 10:30–11:00, é aceito', uso(SALA, '10:30', '11:00', { vaga: 2 }), 'ok'],
      ['vaga 3 (acima da capacidade) é recusada pelo gatilho', uso(SALA, '10:30', '11:00', { vaga: 3 }), '23514'],
      ['uso com 2 vagas de uma vez é recusado pelo CHECK',
        { sql: `insert into prova.occupancy (clinic_id, resource_id, kind, seats, during, item_id, group_no)
                values ($1, $2, 'agendamento', int4range(1, 3), $3::tstzrange, gen_random_uuid(), 1)`,
          params: [CLINICA, SALA, faixa('12:00', '12:30')] }, '23514'],
      ['bloqueio da sala com usos dentro é recusado', bloqueio(SALA, '10:45', '11:30'), '23P01'],
      ['vaga 2 encostada 11:00–11:30 é aceita', uso(SALA, '11:00', '11:30', { vaga: 2 }), 'ok'],
    ],
  },
];

async function rodarCasos(db) {
  let n = 0;
  for (const cen of cenarios) {
    console.log(`\n# ${cen.nome}`);
    await db.query('begin');
    for (const [nome, passo, espera] of cen.passos) {
      await db.query('savepoint passo');
      let obtido = 'ok';
      let detalhe = '';
      try {
        await db.query(passo.sql, passo.params);
        await db.query('release savepoint passo');
      } catch (e) {
        obtido = e.code ?? 'erro';
        detalhe = e.message;
        await db.query('rollback to savepoint passo');
      }
      n++;
      afirmar(obtido === espera, `${cen.nome}: ${nome}`, `esperado ${espera}, veio ${obtido}${detalhe ? ` (${detalhe})` : ''}`);
    }
    const { rows } = await db.query('select * from prova.violacoes() where maximo_simultaneo > capacidade or usos_em_fechamento > 0');
    afirmar(rows.length === 0, `${cen.nome}: oráculo — nenhum recurso acima da capacidade nem uso dentro de fechamento`,
      JSON.stringify(rows));
    await db.query('rollback');
  }
  return n;
}

/* ===================== Concorrência (arquitetura §3.4) ===================== */
// Mesmo aparelho, inícios 10:00/10:05/10:10, 45 min: todos se cruzam, então só 1 pode entrar.
async function rodarConcorrencia(conexao, db, modo, n) {
  await db.query('truncate prova.occupancy');
  const inicios = ['10:00', '10:05', '10:10'];
  const fim = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); const x = h * 60 + m + 45; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
  const t0 = performance.now();
  const { resultados, totalMs } = await rodarJuntos({
    conexao, n, chave: modo === 'com-trava' ? 515151 : 515150,
    trabalho: async (c, i) => {
      const ini = inicios[i % 3];
      if (limite) await c.query(`select set_config('statement_timeout', $1, true)`, [limite]);
      if (modo === 'com-trava') {
        // Trava curta por recurso, numa instrução própria, ANTES de conferir e gravar (forma de duas chaves; §3.2).
        await c.query('select pg_advisory_xact_lock(7102, hashtext($1::text))', [RM]);
        const { rows } = await c.query(
          `select exists (select 1 from prova.occupancy where resource_id = $1 and active and seats && int4range(1, 2)
                          and during && $2::tstzrange) as ocupado`, [RM, faixa(ini, fim(ini))]);
        if (rows[0].ocupado) return false;        // "sem horário": resposta normal, sem erro
      }
      await c.query(uso(RM, ini, fim(ini)).sql, uso(RM, ini, fim(ini)).params);
      return true;
    },
  });
  const e = estatisticas(resultados);
  const semHorario = resultados.filter((r) => r.valor === false).length;
  const { rows: [{ ativos }] } = await db.query('select count(*)::int as ativos from prova.occupancy where active');
  const { rows: viol } = await db.query('select * from prova.violacoes() where maximo_simultaneo > capacidade or usos_em_fechamento > 0');
  const linha = `${modo}, ${n} ao mesmo tempo: ${e.ok} gravou, ${semHorario} "sem horário", erros: ${textoCodigos(e.porCodigo)}; `
    + `p95 ${e.p95} ms, máx ${e.max} ms, total ${Math.round(totalMs)} ms (com a abertura: ${Math.round(performance.now() - t0)} ms)`;
  console.log(linha);
  afirmar(ativos === 1 && viol.length === 0, `concorrência ${modo} (${n}): exatamente 1 uso ativo e nenhuma violação`,
    `ativos: ${ativos}; violações: ${JSON.stringify(viol)}`);
  if (modo === 'com-trava') {
    afirmar(Object.keys(e.porCodigo).length === 0, `concorrência com trava (${n}): nenhum erro (nem 23P01, 40P01 ou 57014)`,
      textoCodigos(e.porCodigo));
  }
  return { modo, n, ...e, semHorario, totalMs: Math.round(totalMs), ativos, linha };
}

await principal('laço local', async () => {
  const t0 = performance.now();
  const pgsrv = await subirPostgres();
  if (!pgsrv) {
    anotar('notice', 'Laço local pulado', 'PostgreSQL não encontrado nesta máquina (defina PG_BIN com a pasta do initdb).', { maxAvisos: 1 });
    return;
  }
  console.log(`${pgsrv.versao} em 127.0.0.1:${pgsrv.conexao.port} (subiu em ${Math.round(performance.now() - t0)} ms)`);
  const db = await conectar(pgsrv.conexao, 'imed-laco-local');
  try {
    await db.query(readFileSync(path.join(aqui, 'base.sql'), 'utf8'));
    await db.query(readFileSync(path.join(aqui, 'prova.sql'), 'utf8'));
    await db.query(`insert into prova.resources (id, clinic_id, kind, name, capacity)
                    values ($1, $3, 'equipamento', 'RM-1', 1), ($2, $3, 'sala', 'Coleta', 2)`, [RM, SALA, CLINICA]);
    const tCasos = performance.now();
    const casos = await rodarCasos(db);
    const msCasos = Math.round(performance.now() - tCasos);
    console.log(`\n${casos} casos em ${msCasos} ms`);

    const conc = [];
    for (const modo of modosConc) {
      for (const n of [40, 100]) conc.push(await rodarConcorrencia(pgsrv.conexao, db, modo, n));
    }
    const notas = [`${pgsrv.versao}: ${casos} casos da restrição de exclusão em ${msCasos} ms`, ...conc.map((c) => c.linha)];
    resumir('laco-local', { versao: pgsrv.versao, casos, msCasos, concorrencia: conc }, notas);
  } finally {
    await db.end().catch(() => {});
    pgsrv.parar();
  }
  console.log(`\nTudo em ${Math.round((performance.now() - t0) / 100) / 10} s.`);
});
