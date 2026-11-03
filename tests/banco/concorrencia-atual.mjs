// iMed Agenda — o DEFEITO da agenda antiga, agora corrigido (fase 3.0 mostrava; fase 3.3 inverteu), no banco de
// verdade (Postgres 17 + PostgREST do Supabase local). Roda no GitHub (banco.yml):
//   node tests/banco/concorrencia-atual.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
// O defeito (arquitetura §1): a grade antiga só comparava o INÍCIO do horário. Com duas faixas no mesmo dia (08:00–12:00
// de 45 em 45 min e 08:30–12:00 de 30 em 30 min), o pedido das 08:00 (até 08:45) e o das 08:30 (até 09:00) passavam
// juntos no mesmo exame, embora se cruzassem das 08:30 às 08:45. Até a 3.2 este script PASSAVA com o defeito presente
// ("falha esperada"). Na 3.3 ele foi invertido e agora REPROVA se o defeito voltar:
//   1. O caminho antigo com horário acabou: com a mesma grade antiga, N pedidos ao mesmo tempo com horário (conexão
//      direta como visitante e pelo PostgREST, como o site antigo manda) são TODOS recusados com 23P01 (a mensagem que
//      o site reconhece); nenhum fica gravado e nenhum dá 40P01 ou 57014.
//   2. O mesmo cruzamento pelo motor novo (agenda_book): exame de 45 min (de 45 em 45) e de 30 min (de 30 em 30) no
//      MESMO aparelho, com inícios que se cruzam (06:00 × 06:30 e 10:30 × 11:00), N ao mesmo tempo (conexão direta e
//      PostgREST): exatamente 1 confirmado e 0 pares que se cruzam; e cada um dos dois inícios, sozinho, é livre.
//
// Os dados (duas clínicas de teste, a grade e os pedidos) são criados aqui e apagados no fim.

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  afirmar, anotar, configLocal, conectar, criarClinicaAgenda, descreverErro, estatisticas, horaSP, limparClinicaAgenda,
  postgrest, principal, resumir, rodarJuntos, textoCodigos,
} from './lib.mjs';

const ANTIGA = 'cc000000-0000-4000-8000-0000000000c1';
const NOVA = 'cc000000-0000-4000-8000-0000000000c2';
const DONA = 'a5000000-0000-4000-8000-0000000000c2';
const N = Number(process.env.N_CONCORRENCIA ?? 40);
const DIA = 7;
const comHttp = (cfg) => Boolean(cfg.apiUrl && cfg.publishableKey);

async function limparAntiga(db) {
  await db.query('begin');
  await db.query("select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'limpeza_teste_ci', true)");
  await db.query('delete from public.appointment_requests where clinic_id = $1', [ANTIGA]);
  await db.query('commit');
  await db.query('delete from public.clinics where id = $1', [ANTIGA]);
}

await principal('concorrencia-atual', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-concorrencia-preparo');
  const rodadas = [];
  const notas = [];
  try {
    await limparAntiga(db);
    await limparClinicaAgenda(db, { clinica: NOVA, dona: DONA });
    const { rows: [{ dia, dow }] } = await db.query(
      `select ((now() at time zone 'America/Sao_Paulo')::date + ${DIA})::text as dia,
              extract(dow from (now() at time zone 'America/Sao_Paulo')::date + ${DIA})::int as dow`);

    /* ---------- 1. A grade antiga com o cruzamento: o caminho antigo com horário é recusado ---------- */
    await db.query(
      `insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
       values ($1, 'Clínica da Grade Antiga do CI', 'imagem', 'Rua do Teste, 300', 'São Paulo', 'SP',
               extensions.st_setsrid(extensions.st_makepoint(-46.65, -23.57), 4326)::extensions.geography, 'published', true, false)`,
      [ANTIGA]);
    await db.query(`insert into public.clinic_exams (clinic_id, exam_code) values ($1, 'usg')`, [ANTIGA]);
    await db.query(
      `insert into public.clinic_schedules (clinic_id, weekday, start_time, end_time, slot_minutes, exam_codes)
       values ($1, $2, '08:00', '12:00', 45, '{usg}'), ($1, $2, '08:30', '12:00', 30, '{usg}')`, [ANTIGA, dow]);
    const linha = (hhmm, nome) => ({
      id: randomUUID(), clinic_id: ANTIGA, place_source: 'imed', place_name: 'Clínica da Grade Antiga do CI', exam_code: 'usg',
      preferred_date: dia, patient_name: nome, patient_phone: '11988887777', consent: true, slot_start: horaSP(DIA, hhmm),
    });
    const registrar = (nome, resultados, totalMs) => {
      const e = estatisticas(resultados);
      rodadas.push({ nome, ...e, totalMs: Math.round(totalMs) });
      notas.push(`${nome}: ${e.ok} de ${e.total} entraram; ${textoCodigos(e.porCodigo)}; p95 ${e.p95} ms, máx ${e.max} ms`);
      console.log(notas.at(-1));
      return e;
    };
    {
      const { resultados, totalMs } = await rodarJuntos({
        conexao: cfg.dbUrl, n: N, chave: 424243,
        trabalho: async (c, i) => {
          const r = linha(i % 2 ? '08:30' : '08:00', `Paciente Cruzado ${i}`);
          await c.query('set local role anon');
          await c.query(`select set_config('request.jwt.claims', '{"role": "anon"}', true), set_config('statement_timeout', '3s', true)`);
          await c.query(
            `insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
               patient_name, patient_phone, consent, slot_start)
             values ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10::timestamptz)`,
            [r.id, r.clinic_id, r.place_source, r.place_name, r.exam_code, r.preferred_date, r.patient_name, r.patient_phone, r.consent, r.slot_start]);
        },
      });
      const e = registrar(`1. caminho antigo com horário, ${N} ao mesmo tempo, conexão direta (08:00 de 45 min × 08:30 de 30 min)`, resultados, totalMs);
      afirmar(e.ok === 0 && e.porCodigo['23P01'] === N, '1: caminho antigo com horário (conexão direta): todos recusados com 23P01',
        `entraram ${e.ok}; ${textoCodigos(e.porCodigo)}`);
    }
    if (comHttp(cfg)) {
      const t0 = performance.now();
      const resultados = await Promise.all(Array.from({ length: N }, async (_, i) => {
        const r = await postgrest(cfg, 'appointment_requests', { corpo: linha(i % 2 ? '09:00' : '08:45', `Paciente Cruzado HTTP ${i}`) });
        return r.status === 201 ? { ok: true, ms: r.ms } : { ok: false, code: r.code ?? `HTTP ${r.status}`, message: r.message, ms: r.ms };
      }));
      const e = registrar(`1. caminho antigo com horário, ${N} ao mesmo tempo, PostgREST (08:45 × 09:00)`, resultados, performance.now() - t0);
      afirmar(e.ok === 0 && e.porCodigo['23P01'] === N, '1: caminho antigo com horário (PostgREST): todos recusados com 23P01',
        `entraram ${e.ok}; ${textoCodigos(e.porCodigo)}`);
    }
    const { rows: [{ n: gravados }] } = await db.query('select count(*)::int as n from public.appointment_requests where clinic_id = $1', [ANTIGA]);
    afirmar(gravados === 0, '1: nenhum pedido com horário gravado pela grade antiga', `${gravados}`);

    /* ---------- 2. O mesmo cruzamento pelo motor novo: 1 por intervalo ---------- */
    const { procedimentos: P } = await criarClinicaAgenda(db, {
      clinica: NOVA, dona: DONA, email: 'dona.cruzamento@exemplo.test', nome: 'Clínica do Cruzamento do CI',
      recursos: [{ chave: 'usg', name: 'Aparelho de ultrassom' }],
      procedimentos: [
        { chave: 'p45', name: 'Ultrassom de 45 minutos', duration_min: 45, step_min: 45, grupos: [['usg']] },
        { chave: 'p30', name: 'Ultrassom de 30 minutos', duration_min: 30, step_min: 30, grupos: [['usg']] },
      ],
    });
    const item = (i, a, b) => [{ procedure_id: i % 2 ? P.p30 : P.p45, starts_at: horaSP(DIA, i % 2 ? b : a) }];
    const pac = (n) => ({ name: `Paciente Cruzado ${n}`, phone: `119${String(n).padStart(8, '0')}`, consent: true });
    const pares = async (ini, fim) => (await db.query(`
      select count(*)::int as n from agenda.occupancy a join agenda.occupancy b on b.resource_id = a.resource_id and b.id > a.id
      where a.clinic_id = $1 and a.active and b.active and a.kind = 'agendamento' and b.kind = 'agendamento'
        and a.during && b.during and a.during && tstzrange($2::timestamptz, $3::timestamptz)`, [NOVA, ini, fim])).rows[0].n;
    const ativos = async (ini, fim) => (await db.query(`select count(*)::int as n from agenda.occupancy
      where clinic_id = $1 and active and kind = 'agendamento' and during && tstzrange($2::timestamptz, $3::timestamptz)`, [NOVA, ini, fim])).rows[0].n;
    {
      const { rows: livres } = await db.query(`select to_char(s.slot_start at time zone 'America/Sao_Paulo', 'HH24:MI') as h
        from private.agenda_free_starts($1, $2, $4::date, $4::date, now()) s
        union all select to_char(s.slot_start at time zone 'America/Sao_Paulo', 'HH24:MI')
        from private.agenda_free_starts($1, $3, $4::date, $4::date, now()) s`, [NOVA, P.p45, P.p30, dia]);
      const h = new Set(livres.map((x) => x.h));
      afirmar(['06:00', '06:30', '10:30', '11:00'].every((x) => h.has(x)), '2: antes da corrida, os quatro inícios estão livres no motor',
        [...h].slice(0, 40).join(' '));
    }
    {
      const { resultados, totalMs } = await rodarJuntos({
        conexao: cfg.dbUrl, n: N, chave: 424244,
        trabalho: async (c, i) => {
          await c.query('set local role anon');
          await c.query(`select set_config('request.jwt.claims', '{"role": "anon"}', true), set_config('statement_timeout', '3s', true)`);
          const { rows: [r] } = await c.query('select public.agenda_book($1, $2, $3, $4, $5) as j',
            [NOVA, JSON.stringify(item(i, '06:00', '06:30')), JSON.stringify(pac(100 + i)), randomUUID(), `codigo-cruzado-${randomUUID()}`]);
          if (r.j.status !== 'ok') throw Object.assign(new Error(r.j.status), { code: r.j.status });
          return r.j;
        },
      });
      const e = registrar(`2. motor novo, ${N} ao mesmo tempo, conexão direta (06:00 de 45 min × 06:30 de 30 min, mesmo aparelho)`, resultados, totalMs);
      const p = await pares(horaSP(DIA, '06:00'), horaSP(DIA, '07:00'));
      const usos = await ativos(horaSP(DIA, '06:00'), horaSP(DIA, '07:00'));
      afirmar(e.ok === 1 && p === 0 && usos === 1,
        '2: motor novo (conexão direta): exatamente 1 confirmado e 0 pares que se cruzam (o defeito de hoje sumiu)',
        `confirmados ${e.ok}; pares que se cruzam ${p}; ${textoCodigos(e.porCodigo)}`);
      afirmar(Object.keys(e.porCodigo).every((k) => k === 'slot_taken'), '2: os outros recebem slot_taken (sem 40P01 nem 57014)', textoCodigos(e.porCodigo));
    }
    if (comHttp(cfg)) {
      const t0 = performance.now();
      const resultados = await Promise.all(Array.from({ length: N }, async (_, i) => {
        const r = await postgrest(cfg, 'rpc/agenda_book', { prefer: null, corpo: {
          p_clinic: NOVA, p_items: item(i, '10:30', '11:00'), p_patient: pac(300 + i), p_id: randomUUID(), p_token: `codigo-cruzado-http-${randomUUID()}` } });
        if (r.status !== 200) return { ok: false, code: r.code ?? `HTTP ${r.status}`, message: r.message, ms: r.ms };
        return r.json?.status === 'ok' ? { ok: true, ms: r.ms } : { ok: false, code: r.json?.status, ms: r.ms };
      }));
      const e = registrar(`2. motor novo, ${N} ao mesmo tempo, PostgREST (10:30 de 45 min × 11:00 de 30 min)`, resultados, performance.now() - t0);
      const p = await pares(horaSP(DIA, '10:30'), horaSP(DIA, '11:30'));
      afirmar(e.ok === 1 && p === 0, '2: motor novo (PostgREST): exatamente 1 confirmado e 0 pares que se cruzam',
        `confirmados ${e.ok}; pares ${p}; ${textoCodigos(e.porCodigo)}`);
    } else {
      anotar('warning', 'Sem o PostgREST local (API_URL e chave): as rodadas HTTP não rodaram');
    }
    notas.push('O defeito da agenda antiga (inícios diferentes que se cruzam passavam juntos) NÃO aparece mais: o caminho antigo com horário acabou e o motor novo segura 1 por intervalo.');
    resumir('concorrencia-atual', { rodadas }, notas);
  } finally {
    await limparAntiga(db).catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (grade antiga)', descreverErro(e)));
    await limparClinicaAgenda(db, { clinica: NOVA, dona: DONA })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (concorrencia-atual)', descreverErro(e)));
    await db.end();
  }
});
