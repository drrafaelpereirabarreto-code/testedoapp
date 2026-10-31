// Laço rápido do banco (iMed Agenda, fases 3.0 e 3.1; arquitetura §3.4 e §13), SEM Docker: sobe um PostgreSQL
// descartável desta máquina, cria a base mínima (base.sql), o ESPELHO da agenda gerado da própria migração da fundação
// (supabase/migrations/*_agenda_base.sql: agenda.resources e agenda.occupancy, com a restrição de exclusão, os CHECKs e
// os gatilhos de vagas e de capacidade, no schema prova) e o oráculo (prova.sql), e confere em segundos a restrição de
// exclusão (EXCLUDE) que garante "nenhum horário vendido duas vezes para o mesmo recurso".
//
//   node tests/banco/local/rodar.mjs                       casos do §3.4 (segundos)
//   node tests/banco/local/rodar.mjs --concorrencia        + todos os modos de concorrência abaixo
//   node tests/banco/local/rodar.mjs --concorrencia=sem-trava:40,com-trava,remarcacao,capacidade   os do CI
//     sem-trava   40 e 100 ao mesmo tempo no mesmo aparelho, só com o EXCLUDE
//     com-trava   o mesmo, com a trava curta por recurso antes de conferir e gravar (§3.2)
//     remarcacao  troca de horário segura o antigo até o COMMIT; com ROLLBACK, o antigo continua (§3.3, I4)
//     capacidade  sala com 2 vagas, 60 pedidos de 15 min com inícios variados, com trava: nunca 3 ao mesmo tempo
//     <modo>:N    só com N ao mesmo tempo (ex.: sem-trava:40)
//   ... --sem-limite   na concorrência, sem o tempo-limite de 3 s do anon (mostra as cadeias longas de impasse)
//
// Precisa do PostgreSQL (16 ou mais novo, com btree_gist) e do pacote "pg" (npm ci --prefix tests/banco
// --ignore-scripts). Não substitui o CI (falta PostGIS, PostgREST, Auth e Realtime): é para errar rápido antes de
// mandar para o GitHub. No GitHub (GITHUB_ACTIONS=true), sem PostgreSQL na máquina o laço REPROVA (não pula).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { afirmar, anotar, conectar, estatisticas, principal, resumir, rodarJuntos, textoCodigos } from '../lib.mjs';
import { subirPostgres } from './servidor.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const MIGRACOES = path.join(aqui, '..', '..', '..', 'supabase', 'migrations');

/**
 * O espelho da agenda: os blocos entre "-- [espelho do laço local]" e "-- [fim do espelho]" da migração da fundação
 * (a mais nova *_agenda_base.sql), com agenda/private trocados por prova e sem as linhas "-- [só no banco]" (chaves
 * estrangeiras para tabelas que o laço local não tem). Sem os blocos, o laço reprova (a migração mudou de forma).
 */
export function espelhoDaMigracao() {
  const nome = readdirSync(MIGRACOES).filter((n) => /_agenda_base\.sql$/.test(n)).sort().at(-1);
  if (!nome) throw new Error('migração *_agenda_base.sql não encontrada em supabase/migrations (o espelho do laço local vem dela)');
  const sql = readFileSync(path.join(MIGRACOES, nome), 'utf8');
  const blocos = [...sql.matchAll(/^-- \[espelho do laço local\]\n([\s\S]*?)^-- \[fim do espelho\]$/gm)].map((m) => m[1]);
  if (blocos.length < 3 || !blocos.join('').includes('agenda.occupancy') || !blocos.join('').includes('agenda.resources')) {
    throw new Error(`${nome}: faltam os blocos "[espelho do laço local]" com agenda.resources, agenda.occupancy e os gatilhos`);
  }
  const texto = blocos.join('\n').split('\n').filter((l) => !l.includes('-- [só no banco]')).join('\n')
    .replaceAll('private.agenda_', 'prova.agenda_').replace(/\bagenda\./g, 'prova.');
  return { nome, texto };
}
const args = process.argv.slice(2);
const conc = args.find((a) => a.startsWith('--concorrencia'));
const MODOS = ['sem-trava', 'com-trava', 'remarcacao', 'capacidade'];
// "modo" ou "modo:N" (N ao mesmo tempo; sem N, os padrões de cada modo).
const modosConc = (!conc ? [] : conc.includes('=') ? conc.split('=')[1].split(',').filter(Boolean) : MODOS)
  .map((m) => { const [modo, n] = m.split(':'); return { modo, n: n === undefined ? null : Number(n) }; });
const desconhecidos = modosConc.filter((m) => !MODOS.includes(m.modo) || (m.n !== null && !(Number.isInteger(m.n) && m.n >= 2 && m.n <= 200)));
if (desconhecidos.length) {
  console.error(`modo de concorrência desconhecido: ${desconhecidos.map((m) => m.modo + (m.n === null ? '' : `:${m.n}`)).join(', ')}`
    + ` (use ${MODOS.join(', ')}, com :N opcional entre 2 e 200)`);
  process.exit(2);
}
const limite = args.includes('--sem-limite') ? null : '3s';

const CLINICA = '0c000000-0000-4000-8000-000000000001';
const RM = '0e000000-0000-4000-8000-000000000001';      // aparelho de ressonância, capacidade 1
const SALA = '0e000000-0000-4000-8000-000000000002';    // sala de coleta, capacidade 2
// Um dia daqui a 30 dias (a guarda de capacidade só olha usos futuros), no fuso de São Paulo (UTC-3).
const DIA = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const t = (hhmm) => `${DIA} ${hhmm}:00-03`;
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
      ['vaga 1 com o mesmo início (11:00–11:30) é aceita: 2 ao mesmo tempo, dentro da capacidade',
        uso(SALA, '11:00', '11:30'), 'ok'],
      ['reduzir a capacidade para 1 com uso futuro na vaga 2 é recusado (guarda do recurso)',
        { sql: 'update prova.resources set capacity = 1 where id = $1', params: [SALA] }, '23514'],
      ['desativar a sala com usos futuros é recusado (guarda do recurso)',
        { sql: 'update prova.resources set active = false where id = $1', params: [SALA] }, '23514'],
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
  if (modo === 'sem-trava') {
    // Só o EXCLUDE: nunca mais de 1 (sem a restrição, entrariam todos). Zero só se uma cadeia de impasses foi
    // cortada pelo tempo-limite de 3 s (57014), como no §3.4: aí o vencedor também pode ter estourado o tempo.
    afirmar((ativos === 1 || (ativos === 0 && (e.porCodigo['57014'] ?? 0) > 0)) && viol.length === 0,
      `concorrência sem trava (${n}): no máximo 1 uso ativo (a restrição de exclusão segura) e nenhuma violação`,
      `ativos: ${ativos}; erros: ${textoCodigos(e.porCodigo)}; violações: ${JSON.stringify(viol)}`);
  } else {
    afirmar(ativos === 1 && viol.length === 0, `concorrência ${modo} (${n}): exatamente 1 uso ativo e nenhuma violação`,
      `ativos: ${ativos}; violações: ${JSON.stringify(viol)}`);
  }
  if (modo === 'com-trava') {
    afirmar(Object.keys(e.porCodigo).length === 0, `concorrência com trava (${n}): nenhum erro (nem 23P01, 40P01 ou 57014)`,
      textoCodigos(e.porCodigo));
  }
  return { modo, n, ...e, semHorario, totalMs: Math.round(totalMs), ativos, linha };
}

/* ===================== Remarcação sem janela (arquitetura §3.3, I4; §3.4) ===================== */
// Uma transação desativa o uso antigo (10:00–10:45), grava o novo (11:00–11:45) e segura o fim por 1,5 s; enquanto
// isso, outra conexão tenta o horário antigo. Com COMMIT, a outra espera e só entra depois do COMMIT; com ROLLBACK,
// recebe 23P01 e o antigo continua valendo. Em nenhum momento o horário antigo fica livre antes da hora.
const horaSP = `to_char(lower(during) at time zone 'America/Sao_Paulo', 'HH24:MI')`;

async function rodarRemarcacao(conexao, db, desfecho) {
  await db.query('truncate prova.occupancy');
  const antigo = uso(RM, '10:00', '10:45');
  const { rows: [{ id }] } = await db.query(`${antigo.sql} returning id`, antigo.params);
  const remarca = await conectar(conexao, 'imed-remarcacao');
  const outro = await conectar(conexao, 'imed-horario-antigo');
  try {
    await remarca.query('begin');
    await remarca.query(`update prova.occupancy set active = false, released_at = now(), release_reason = 'remarcado'
                         where id = $1`, [id]);
    const novo = uso(RM, '11:00', '11:45');
    await remarca.query(novo.sql, novo.params);
    const t0 = performance.now();
    const tentativa = outro.query(antigo.sql, antigo.params)
      .then(() => ({ ok: true, ms: performance.now() - t0 }), (e) => ({ ok: false, code: e.code, ms: performance.now() - t0 }));
    await new Promise((r) => setTimeout(r, 1500));
    const { rows: [{ esperando }] } = await db.query(
      `select count(*)::int as esperando from pg_stat_activity
        where application_name = 'imed-horario-antigo' and wait_event_type = 'Lock'`);
    await remarca.query(desfecho);
    const r = await tentativa;
    const ativos = (await db.query(`select ${horaSP} as h from prova.occupancy where active order by lower(during)`)).rows.map((x) => x.h);
    const { rows: viol } = await db.query('select * from prova.violacoes() where maximo_simultaneo > capacidade or usos_em_fechamento > 0');
    const resultado = r.ok ? 'entrou' : `recusado (${r.code})`;
    const linha = `remarcação com ${desfecho.toUpperCase()}: quem tentou o horário antigo esperou ${Math.round(r.ms)} ms e ${resultado}; `
      + `ativos no fim: ${ativos.join(' e ') || 'nenhum'}`;
    console.log(linha);
    afirmar(esperando === 1, `remarcação (${desfecho}): o horário antigo fica preso enquanto a remarcação não termina`,
      `conexões esperando trava depois de 1,5 s: ${esperando}`);
    if (desfecho === 'commit') {
      afirmar(r.ok && r.ms >= 1000 && ativos.join(',') === '10:00,11:00' && viol.length === 0,
        'remarcação (commit): o horário antigo só fica livre no COMMIT e o novo fica ocupado',
        `${resultado} em ${Math.round(r.ms)} ms; ativos: ${ativos.join(', ')}; violações: ${JSON.stringify(viol)}`);
    } else {
      afirmar(!r.ok && r.code === '23P01' && ativos.join(',') === '10:00' && viol.length === 0,
        'remarcação (rollback): o horário antigo continua com o dono e quem tentou recebe 23P01',
        `${resultado}; ativos: ${ativos.join(', ')}; violações: ${JSON.stringify(viol)}`);
    }
    return { modo: `remarcacao-${desfecho}`, esperaMs: Math.round(r.ms), resultado, ativos, linha };
  } finally {
    await remarca.end().catch(() => {});
    await outro.end().catch(() => {});
  }
}

/* ===================== Capacidade 2 sob concorrência (arquitetura §3.2, vagas; §3.4) ===================== */
// Sala com 2 vagas; n pedidos de 15 min com inícios de 10:00 a 10:55 (de 5 em 5) partem juntos. Com a trava por
// recurso, cada um pega a menor vaga livre no intervalo ou recebe "sem horário". O oráculo, que não olha a vaga,
// confere que nunca há 3 usos ao mesmo tempo.
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

async function rodarCapacidade(conexao, db, n) {
  await db.query('truncate prova.occupancy');
  const t0 = performance.now();
  const { resultados, totalMs } = await rodarJuntos({
    conexao, n, chave: 515152,
    trabalho: async (c, i) => {
      if (limite) await c.query(`select set_config('statement_timeout', $1, true)`, [limite]);
      const ini = 10 * 60 + 5 * (i % 12);
      const de = hhmm(ini);
      const ate = hhmm(ini + 15);
      await c.query('select pg_advisory_xact_lock(7102, hashtext($1::text))', [SALA]);
      const { rows } = await c.query(
        `select s as vaga from prova.resources r, generate_series(1, r.capacity) s
          where r.id = $1
            and not exists (select 1 from prova.occupancy o where o.resource_id = r.id and o.active
                              and o.seats && int4range(s, s + 1) and o.during && $2::tstzrange)
          order by s limit 1`, [SALA, faixa(de, ate)]);
      if (!rows.length) return false;
      const p = uso(SALA, de, ate, { vaga: rows[0].vaga });
      await c.query(p.sql, p.params);
      return true;
    },
  });
  const e = estatisticas(resultados);
  const semHorario = resultados.filter((r) => r.valor === false).length;
  const { rows: [{ maximo }] } = await db.query(
    'select coalesce(max(maximo_simultaneo), 0)::int as maximo from prova.violacoes() where resource_id = $1', [SALA]);
  const { rows: viol } = await db.query('select * from prova.violacoes() where maximo_simultaneo > capacidade or usos_em_fechamento > 0');
  const linha = `capacidade 2 com trava, ${n} ao mesmo tempo (15 min, inícios de 10:00 a 10:55): ${e.ok} gravados, `
    + `${semHorario} "sem horário", erros: ${textoCodigos(e.porCodigo)}; máximo ao mesmo tempo: ${maximo}; `
    + `p95 ${e.p95} ms, máx ${e.max} ms, total ${Math.round(totalMs)} ms (com a abertura: ${Math.round(performance.now() - t0)} ms)`;
  console.log(linha);
  afirmar(viol.length === 0 && maximo <= 2 && e.ok >= 2, `capacidade 2 (${n}): no máximo 2 usos ao mesmo tempo`,
    `gravados: ${e.ok}; máximo ao mesmo tempo: ${maximo}; violações: ${JSON.stringify(viol)}`);
  afirmar(Object.keys(e.porCodigo).length === 0, `capacidade 2 (${n}): nenhum erro (nem 23P01, 40P01 ou 57014)`,
    textoCodigos(e.porCodigo));
  return { modo: 'capacidade', n, ...e, semHorario, maximo, totalMs: Math.round(totalMs), linha };
}

await principal('laço local', async () => {
  const t0 = performance.now();
  const pgsrv = await subirPostgres();
  if (!pgsrv) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      // No GitHub a imagem ubuntu-24.04 traz o PostgreSQL: se sumiu, o laço não pode passar em silêncio.
      afirmar(false, 'Laço local: PostgreSQL não encontrado na máquina do GitHub',
        'initdb/pg_ctl/postgres não estão em /usr/lib/postgresql/<versão>/bin nem no pg_config (a imagem mudou?).');
      return;
    }
    anotar('notice', 'Laço local pulado', 'PostgreSQL não encontrado nesta máquina (defina PG_BIN com a pasta do initdb).', { maxAvisos: 1 });
    return;
  }
  console.log(`${pgsrv.versao} em 127.0.0.1:${pgsrv.conexao.port} (subiu em ${Math.round(performance.now() - t0)} ms)`);
  const db = await conectar(pgsrv.conexao, 'imed-laco-local');
  try {
    await db.query(readFileSync(path.join(aqui, 'base.sql'), 'utf8'));
    const espelho = espelhoDaMigracao();
    await db.query('create schema prova');
    await db.query(espelho.texto);
    await db.query(readFileSync(path.join(aqui, 'prova.sql'), 'utf8'));
    console.log(`Espelho da agenda gerado de ${espelho.nome}`);
    await db.query(`insert into prova.resources (id, clinic_id, kind, name, capacity)
                    values ($1, $3, 'equipamento', 'RM-1', 1), ($2, $3, 'sala', 'Coleta', 2)`, [RM, SALA, CLINICA]);
    const tCasos = performance.now();
    const casos = await rodarCasos(db);
    const msCasos = Math.round(performance.now() - tCasos);
    console.log(`\n${casos} casos em ${msCasos} ms`);

    const conc = [];
    for (const { modo, n } of modosConc) {
      if (modo === 'remarcacao') {
        for (const desfecho of ['commit', 'rollback']) conc.push(await rodarRemarcacao(pgsrv.conexao, db, desfecho));
      } else if (modo === 'capacidade') {
        conc.push(await rodarCapacidade(pgsrv.conexao, db, n ?? 60));
      } else {
        for (const k of n ? [n] : [40, 100]) conc.push(await rodarConcorrencia(pgsrv.conexao, db, modo, k));
      }
    }
    const notas = [`${pgsrv.versao}: ${casos} casos da restrição de exclusão em ${msCasos} ms (espelho de ${espelho.nome})`,
      ...conc.map((c) => c.linha)];
    resumir('laco-local', { versao: pgsrv.versao, casos, msCasos, concorrencia: conc }, notas);
  } finally {
    await db.end().catch(() => {});
    pgsrv.parar();
  }
  console.log(`\nTudo em ${Math.round((performance.now() - t0) / 100) / 10} s.`);
});
