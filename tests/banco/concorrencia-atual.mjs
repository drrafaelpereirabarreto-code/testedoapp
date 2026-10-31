// iMed Agenda, fase 3.0 — como o pedido COM HORÁRIO se comporta HOJE sob concorrência, no banco de verdade
// (Postgres 17 + PostgREST do Supabase local, com todas as migrações aplicadas). Roda no GitHub (banco.yml):
//   node tests/banco/concorrencia-atual.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
// 1. Inícios iguais (já protegido hoje): 40 pedidos ao mesmo tempo no mesmo horário, por conexão direta como
//    visitante (anon) e pelo PostgREST: só 1 entra. Os outros recebem 23505 (índice único
//    appointment_requests_slot_uq) ou 23P01 (o gatilho já viu o horário ocupado); o site reconhece os dois pelo
//    código (geo-core.js, isSlotTaken) e mostra "este horário não está mais livre".
// 2. FALHA ESPERADA — defeito conhecido (arquitetura §1): a grade de hoje só compara o INÍCIO do horário. Com duas
//    faixas no mesmo dia (08:00–12:00 de 45 em 45 min e 08:30–12:00 de 30 em 30 min), o pedido das 08:00 (até 08:45)
//    e o das 08:30 (até 09:00) passam juntos, no mesmo exame, embora se cruzem das 08:30 às 08:45. Este script PASSA
//    enquanto o defeito existir e avisa ("warning" no topo da execução). Na fase 3.3 (agenda.occupancy com EXCLUDE) o
//    defeito some: aí o script REPROVA, pedindo para inverter este teste (o certo passa a ser 1 pedido por intervalo).
//
// Os dados (uma clínica de teste, a grade e os pedidos) são criados aqui e apagados no fim.

import { randomUUID } from 'node:crypto';
import {
  afirmar, anotar, configLocal, conectar, descreverErro, estatisticas, postgrest, principal, resumir, rodarJuntos, textoCodigos,
} from './lib.mjs';

const CLINICA = 'cc000000-0000-4000-8000-0000000000c1';
const N = Number(process.env.N_CONCORRENCIA ?? 40);
const NOME = 'Clínica de Concorrência do CI';
// Faixa A: 08:00–12:00 de 45 min (08:00, 08:45, 09:30, 10:15, 11:00). Faixa B: 08:30–12:00 de 30 min (08:30, 09:00, ...).
const DURACAO = { '08:00': 45, '08:45': 45, '10:15': 45, '08:30': 30, '09:00': 30, '10:30': 30 };
const RECUSA_ESPERADA = new Set(['23505', '23P01']);

async function limpar(db) {
  await db.query('delete from public.appointment_requests where clinic_id = $1', [CLINICA]);
  await db.query('delete from public.clinics where id = $1', [CLINICA]);
}

const minutos = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
/** Pares de pedidos confirmados que se cruzam no tempo (mesmo exame, mesma clínica). */
function paresQueSeCruzam(horas) {
  let pares = 0;
  for (let i = 0; i < horas.length; i++) {
    for (let j = i + 1; j < horas.length; j++) {
      const a = minutos(horas[i]); const b = minutos(horas[j]);
      if (a < b + DURACAO[horas[j]] && b < a + DURACAO[horas[i]]) pares++;
    }
  }
  return pares;
}

await principal('concorrencia-atual', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-concorrencia-preparo');
  const rodadas = [];
  const notas = [];
  try {
    await limpar(db);
    const { rows: [{ dia, dow }] } = await db.query(
      `select ((now() at time zone 'America/Sao_Paulo')::date + 7)::text as dia,
              extract(dow from (now() at time zone 'America/Sao_Paulo')::date + 7)::int as dow`);
    const { rows: horarios } = await db.query(
      `select h, t::text as ts, (extract(epoch from t) * 1000)::bigint::text as ms
         from unnest($2::text[]) h, lateral (select ($1::date + h::time) at time zone 'America/Sao_Paulo' as t) x`,
      [dia, Object.keys(DURACAO)]);
    const ts = Object.fromEntries(horarios.map((r) => [r.h, r.ts]));
    const horaDe = Object.fromEntries(horarios.map((r) => [r.ms, r.h]));

    await db.query(
      `insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
       values ($1, $2, 'imagem', 'Rua do Teste, 300', 'São Paulo', 'SP',
               extensions.st_setsrid(extensions.st_makepoint(-46.65, -23.57), 4326)::extensions.geography, 'published', true, false)`,
      [CLINICA, NOME]);
    await db.query(`insert into public.clinic_exams (clinic_id, exam_code) values ($1, 'usg')`, [CLINICA]);
    await db.query(
      `insert into public.clinic_schedules (clinic_id, weekday, start_time, end_time, slot_minutes, exam_codes)
       values ($1, $2, '08:00', '12:00', 45, '{usg}'), ($1, $2, '08:30', '12:00', 30, '{usg}')`, [CLINICA, dow]);

    const linha = (hora, nome) => ({
      id: randomUUID(), clinic_id: CLINICA, place_source: 'imed', place_name: NOME, exam_code: 'usg', preferred_date: dia,
      patient_name: nome, patient_phone: '11988887777', consent: true, slot_start: ts[hora],
    });

    // Pedido direto na tabela como o visitante (anon), com o tempo-limite do anon na produção (3 s).
    const pedirDireto = async (c, hora, nome) => {
      const r = linha(hora, nome);
      await c.query('set local role anon');
      await c.query(`select set_config('request.jwt.claims', '{"role": "anon"}', true), set_config('statement_timeout', '3s', true)`);
      await c.query(
        `insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
           patient_name, patient_phone, consent, slot_start)
         values ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10::timestamptz)`,
        [r.id, r.clinic_id, r.place_source, r.place_name, r.exam_code, r.preferred_date, r.patient_name, r.patient_phone, r.consent, r.slot_start]);
    };
    // O mesmo pelo PostgREST, como o site (POST /rest/v1/appointment_requests, return=minimal), como visitante: só a
    // chave publishable no "apikey", sem token (fase 0.1).
    const pedirHttp = async (hora, nome) => {
      const r = await postgrest(cfg, 'appointment_requests', { corpo: linha(hora, nome) });
      return r.status === 201 ? { ok: true, ms: r.ms } : { ok: false, code: r.code ?? `HTTP ${r.status}`, message: r.message, ms: r.ms };
    };
    const confirmados = async (horas) => (await db.query(
      `select (extract(epoch from slot_start) * 1000)::bigint::text as ms from public.appointment_requests
        where clinic_id = $1 and status = 'confirmed' and slot_start = any ($2::timestamptz[]) order by slot_start`,
      [CLINICA, horas.map((h) => ts[h])])).rows.map((r) => horaDe[r.ms] ?? r.ms);

    const registrar = (nome, resultados, totalMs, extra = {}) => {
      const e = estatisticas(resultados);
      rodadas.push({ nome, ...e, totalMs: Math.round(totalMs), ...extra });
      const inesperados = Object.entries(e.porCodigo).filter(([k]) => !RECUSA_ESPERADA.has(k));
      notas.push(`${nome}: ${e.ok} de ${e.total} entraram; recusas: ${textoCodigos(e.porCodigo)}; p95 ${e.p95} ms, máx ${e.max} ms`
        + `; 40P01: ${e.porCodigo['40P01'] ?? 0}; 57014: ${e.porCodigo['57014'] ?? 0}`);
      console.log(notas.at(-1));
      return { e, inesperados };
    };

    /* ---------- 1. Inícios iguais: só 1 entra ---------- */
    {
      const { resultados, totalMs } = await rodarJuntos({
        conexao: cfg.dbUrl, n: N, trabalho: (c, i) => pedirDireto(c, '10:15', `Paciente Direto ${i}`),
      });
      const { e, inesperados } = registrar(`Inícios iguais, ${N} ao mesmo tempo, conexão direta (10:15)`, resultados, totalMs);
      afirmar(e.ok === 1, 'inícios iguais (conexão direta): exatamente 1 pedido entra',
        `entraram ${e.ok} de ${e.total}; recusas: ${textoCodigos(e.porCodigo)}`);
      afirmar(inesperados.length === 0, 'inícios iguais (conexão direta): só recusas 23505/23P01 (sem 40P01 nem 57014)',
        resultados.filter((r) => !r.ok && !RECUSA_ESPERADA.has(r.code)).slice(0, 5).map((r) => `${r.code}: ${r.message}`).join('\n'));
      afirmar((await confirmados(['10:15'])).length === 1, 'inícios iguais (conexão direta): 1 confirmado no banco');
    }
    {
      const t0 = performance.now();
      const resultados = await Promise.all(Array.from({ length: N }, (_, i) => pedirHttp('10:30', `Paciente HTTP ${i}`)));
      const { e, inesperados } = registrar(`Inícios iguais, ${N} ao mesmo tempo, PostgREST (10:30)`, resultados, performance.now() - t0);
      afirmar(e.ok === 1, 'inícios iguais (PostgREST): exatamente 1 pedido entra (201) e o resto é recusado',
        `entraram ${e.ok} de ${e.total}; recusas: ${textoCodigos(e.porCodigo)}\n${resultados.find((r) => !r.ok)?.message ?? ''}`);
      afirmar(inesperados.length === 0, 'inícios iguais (PostgREST): só recusas 23505/23P01 (sem 40P01 nem 57014)',
        resultados.filter((r) => !r.ok && !RECUSA_ESPERADA.has(r.code)).slice(0, 5).map((r) => `${r.code}: ${r.message}`).join('\n'));
      afirmar((await confirmados(['10:30'])).length === 1, 'inícios iguais (PostgREST): 1 confirmado no banco');
    }

    /* ---------- 2. FALHA ESPERADA: inícios diferentes que se cruzam ---------- */
    // O que o defeito de hoje produz: exatamente UM pedido confirmado em cada um dos dois inícios (o índice único
    // segura o mesmo início) e todas as outras recusas por 23505/23P01. Dois confirmados no MESMO início seriam outro
    // defeito (índice único quebrado), e 40P01/57014 seriam travamento: os dois reprovam aqui, em vez de passarem
    // como "falha esperada".
    const conferirCruzados = (via, horas, esperadas, inesperados, resultados) => {
      const repetidos = horas.filter((h, i) => horas.indexOf(h) !== i);
      afirmar(repetidos.length === 0, `cruzados (${via}): no máximo 1 pedido por início (índice único)`,
        `confirmados: ${horas.join(', ') || 'nenhum'}; repetidos: ${repetidos.join(', ')}`);
      afirmar(horas.length === 0 || horas.every((h) => esperadas.includes(h)),
        `cruzados (${via}): só os dois horários pedidos foram confirmados`, `confirmados: ${horas.join(', ')}`);
      afirmar(inesperados.length === 0, `cruzados (${via}): só recusas 23505/23P01 (sem 40P01 nem 57014)`,
        resultados.filter((r) => !r.ok && !RECUSA_ESPERADA.has(r.code)).slice(0, 5).map((r) => `${r.code}: ${r.message}`).join('\n'));
    };
    const defeito = [];
    {
      const { resultados, totalMs } = await rodarJuntos({
        conexao: cfg.dbUrl, n: N, chave: 424243,
        trabalho: (c, i) => pedirDireto(c, i % 2 ? '08:30' : '08:00', `Paciente Cruzado ${i}`),
      });
      const horas = await confirmados(['08:00', '08:30']);
      const pares = paresQueSeCruzam(horas);
      const { inesperados } = registrar(`Inícios diferentes que se cruzam, ${N} ao mesmo tempo, conexão direta (08:00 de 45 min × 08:30 de 30 min)`,
        resultados, totalMs, { confirmados: horas, paresQueSeCruzam: pares });
      conferirCruzados('conexão direta', horas, ['08:00', '08:30'], inesperados, resultados);
      defeito.push({ via: 'conexão direta', horas, pares });
    }
    {
      const t0 = performance.now();
      const resultados = await Promise.all(Array.from({ length: N },
        (_, i) => pedirHttp(i % 2 ? '09:00' : '08:45', `Paciente Cruzado HTTP ${i}`)));
      const horas = await confirmados(['08:45', '09:00']);
      const pares = paresQueSeCruzam(horas);
      const { inesperados } = registrar(`Inícios diferentes que se cruzam, ${N} ao mesmo tempo, PostgREST (08:45 de 45 min × 09:00 de 30 min)`,
        resultados, performance.now() - t0, { confirmados: horas, paresQueSeCruzam: pares });
      conferirCruzados('PostgREST', horas, ['08:45', '09:00'], inesperados, resultados);
      defeito.push({ via: 'PostgREST', horas, pares });
    }

    // Defeito presente = os dois inícios diferentes confirmados juntos (1 par que se cruza), sem repetição.
    const temDefeito = (d) => d.pares === 1 && d.horas.length === 2 && new Set(d.horas).size === 2;
    const comDefeito = defeito.filter(temDefeito);
    const semDefeito = defeito.filter((d) => d.pares === 0 && d.horas.length === 1);
    const textoDefeito = defeito.map((d) => `${d.via}: confirmados ${d.horas.join(' e ') || 'nenhum'} → ${d.pares} par(es) que se cruzam`).join('\n');
    if (comDefeito.length === defeito.length) {
      console.log('FALHA ESPERADA - defeito de hoje confirmado (inícios diferentes que se cruzam passam juntos)');
      anotar('warning', 'FALHA ESPERADA - defeito conhecido de hoje (corrigido na fase 3.3)',
        'Dois pedidos com inícios diferentes que se cruzam no mesmo exame passam juntos (a grade só compara o início).\n'
        + `${textoDefeito}\nEste teste passa enquanto o defeito existir. Na fase 3.3 ele deve ser invertido.`, { maxAvisos: 1 });
      notas.push(`FALHA ESPERADA (defeito de hoje, corrigido na 3.3): ${defeito.map((d) => `${d.via} ${d.horas.join(' e ')}`).join('; ')} se cruzam e passaram juntos`);
    } else if (semDefeito.length === defeito.length) {
      afirmar(false, 'o defeito de hoje NÃO aparece mais: inverta este teste (fase 3.3; arquitetura §13)', textoDefeito);
    } else {
      afirmar(false, 'pedidos que se cruzam deram um resultado inesperado (nem o defeito de hoje, nem 1 por intervalo)', textoDefeito);
    }

    resumir('concorrencia-atual', { rodadas, defeito }, notas);
  } finally {
    await limpar(db).catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (concorrencia-atual)', descreverErro(e)));
    await db.end();
  }
});
