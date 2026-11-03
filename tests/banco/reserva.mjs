// iMed Agenda, fase 3.3 — teste obrigatório 4 (Reserva expirada), a parte que precisa de COMMIT de verdade, no banco
// de verdade (Supabase local). Roda no GitHub (banco.yml):
//   node tests/banco/reserva.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
//   1. A rotina do pg_cron (CALL private.agenda_manutencao(), com COMMIT entre lotes de 50): 120 reservas vencidas
//      viram "expiradas" e soltam os recursos (3 lotes); a reserva ainda no prazo fica; a versão da agenda da clínica
//      sobe; o job está agendado a cada 30 s com o comando certo.
//   2. Confirmar × expirar ao mesmo tempo (§3.3, I5), nas duas ordens: quem trava o pedido primeiro vence; o outro
//      vê a situação nova (a expiração pula o pedido travado; a confirmação depois da expiração responde expired).
// A parte sem COMMIT (prazo, liberação preguiçosa, confirmar, soltar) está em supabase/tests/210_reserva.sql.
// Os dados são criados aqui e apagados no fim.

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  afirmar, anotar, configLocal, conectar, criarClinicaAgenda, descreverErro, horaSP, limparClinicaAgenda, principal, resumir,
} from './lib.mjs';

const CLINICA = 'cc000000-0000-4000-8000-0000000003c4';
const DONA = 'a5000000-0000-4000-8000-0000000003c4';
const EMAIL = 'dona.reserva@exemplo.test';
const DIA = 25;

await principal('reserva', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-reserva');
  const notas = [];
  try {
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA });
    const { procedimentos: P } = await criarClinicaAgenda(db, {
      clinica: CLINICA, dona: DONA, email: EMAIL, nome: 'Clínica da Reserva do CI',
      recursos: [{ chave: 'sala', name: 'Sala grande', kind: 'sala', capacity: 50 }],
      procedimentos: [{ chave: 'p', name: 'Exame de 5 minutos', duration_min: 5, grupos: [['sala']] }],
    });
    // O servidor (service_role) reserva, numa conexão direta (como a Edge Function fará).
    const reservar = async (c, n, hhmm) => {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', '{"role": "service_role"}', true), set_config('role', 'service_role', true)`);
      const id = randomUUID();
      const { rows: [r] } = await c.query('select public.agenda_hold($1, $2, $3, $4, $5) as j', [CLINICA,
        JSON.stringify([{ procedure_id: P.p, starts_at: horaSP(DIA, hhmm) }]),
        JSON.stringify({ name: `Paciente Reserva ${n}`, phone: `119${String(n).padStart(8, '0')}`, consent: true }), id,
        `codigo-reserva-${randomUUID()}`]);
      await c.query('commit');
      if (r.j.status !== 'ok') throw new Error(`reserva ${n}: ${JSON.stringify(r.j)}`);
      return id;
    };
    const vencer = async (ids) => {
      await db.query('begin');
      await db.query(`select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_reserva', true)`);
      await db.query(`update public.appointment_requests set hold_expires_at = now() - interval '30 minutes' where id = any ($1::uuid[])`, [ids]);
      await db.query(`update agenda.occupancy o set hold_until = now() - interval '25 minutes'
                      where o.active and o.item_id in (select i.id from agenda.appointment_items i where i.request_id = any ($1::uuid[]))`, [ids]);
      await db.query('commit');
    };
    const situacoes = async (ids) => Object.fromEntries((await db.query(
      `select status, count(*)::int as n from public.appointment_requests where id = any ($1::uuid[]) group by 1`, [ids])).rows
      .map((r) => [r.status, r.n]));

    /* ---------- 1. A rotina do cron ---------- */
    {
      const { rows: [job] } = await db.query(`select schedule, command from cron.job where jobname = 'imed-agenda-manutencao'`);
      afirmar(job?.schedule === '30 seconds' && job?.command === 'call private.agenda_manutencao()',
        'o job imed-agenda-manutencao roda a cada 30 s com CALL private.agenda_manutencao()', JSON.stringify(job));
      const vencidas = [];
      for (let i = 0; i < 120; i++) {
        const hh = String(8 + Math.floor(i / 12)).padStart(2, '0');
        vencidas.push(await reservar(db, i, `${hh}:${String((i % 12) * 5).padStart(2, '0')}`));
      }
      const noPrazo = await reservar(db, 999, '19:00');
      await vencer(vencidas);
      const { rows: [{ v: antes }] } = await db.query('select version as v from agenda.clinic_versions where clinic_id = $1', [CLINICA]);
      const t0 = performance.now();
      await db.query('call private.agenda_manutencao()');
      const ms = Math.round(performance.now() - t0);
      const s = await situacoes(vencidas);
      const { rows: [{ ativos }] } = await db.query(`select count(*)::int as ativos from agenda.occupancy o
        join agenda.appointment_items i on i.id = o.item_id where i.request_id = any ($1::uuid[]) and o.active`, [vencidas]);
      const { rows: [{ v: depois }] } = await db.query('select version as v from agenda.clinic_versions where clinic_id = $1', [CLINICA]);
      afirmar(s.expired === 120 && ativos === 0, 'a rotina expira as 120 reservas vencidas (lotes de 50) e solta os recursos',
        JSON.stringify({ situacoes: s, ativos }));
      afirmar((await situacoes([noPrazo])).hold === 1, 'a reserva ainda no prazo continua reservada');
      afirmar(Number(depois) >= Number(antes) + 3, 'a versão da agenda da clínica sobe a cada lote (3 lotes)', `${antes} → ${depois}`);
      const { rows: [h] } = await db.query(`select count(*)::int as n from agenda.status_history
        where request_id = any ($1::uuid[]) and to_status = 'expired' and origin = 'cron' and reason_code = 'reserva_expirada'`, [vencidas]);
      afirmar(h.n === 120, 'histórico: 120 expiradas pelo sistema (cron), motivo reserva_expirada', `${h.n}`);
      notas.push(`Rotina do cron: 120 reservas vencidas expiradas em ${ms} ms (versão da agenda ${antes} → ${depois}); a no prazo ficou`);
    }

    /* ---------- 2. Confirmar × expirar ---------- */
    {
      // a) a confirmação trava primeiro (ainda no prazo); o prazo vence enquanto ela segura; a expiração pula o pedido
      const id = await reservar(db, 1001, '20:00');
      await db.query('begin');
      await db.query(`select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_reserva', true)`);
      // vence daqui a 2 s (o prazo + a carência de 5 min)
      await db.query(`update public.appointment_requests set hold_expires_at = now() - interval '5 minutes' + interval '2 seconds' where id = $1`, [id]);
      await db.query('commit');
      const c1 = await conectar(cfg.dbUrl, 'imed-confirmar');
      const c2 = await conectar(cfg.dbUrl, 'imed-expirar');
      try {
        await c1.query('begin');
        await c1.query(`select set_config('request.jwt.claims', '{"role": "service_role"}', true), set_config('role', 'service_role', true)`);
        const { rows: [conf] } = await c1.query('select public.agenda_confirm($1) as j', [id]);
        await new Promise((r) => setTimeout(r, 3000));   // o prazo vence enquanto a confirmação segura o pedido
        const { rows: [exp] } = await c2.query('select private.agenda_expire($1) as ok', [id]);
        await c1.query('commit');
        const s = await situacoes([id]);
        afirmar(conf.j.status === 'ok' && exp.ok === false && s.confirmed === 1,
          'I5 (confirma primeiro): a expiração pula o pedido travado e o agendamento fica confirmado',
          JSON.stringify({ confirmar: conf.j, expirou: exp.ok, situacoes: s }));
        notas.push(`I5 confirmar primeiro: confirmar ${conf.j.status}, expirar ${exp.ok} → ${Object.keys(s).join(',')}`);
      } finally {
        await c1.end().catch(() => {});
        await c2.end().catch(() => {});
      }
      // b) a expiração trava primeiro (prazo vencido); a confirmação espera e responde expired
      const id2 = await reservar(db, 1002, '20:30');
      await vencer([id2]);
      const c3 = await conectar(cfg.dbUrl, 'imed-expirar-2');
      const c4 = await conectar(cfg.dbUrl, 'imed-confirmar-2');
      try {
        await c3.query('begin');
        const { rows: [exp] } = await c3.query('select private.agenda_expire($1) as ok', [id2]);
        const t0 = performance.now();
        const conf = (async () => {
          await c4.query('begin');
          await c4.query(`select set_config('request.jwt.claims', '{"role": "service_role"}', true), set_config('role', 'service_role', true)`);
          const { rows: [r] } = await c4.query('select public.agenda_confirm($1) as j', [id2]);
          await c4.query('commit');
          return { j: r.j, ms: performance.now() - t0 };
        })();
        await new Promise((r) => setTimeout(r, 1000));
        await c3.query('commit');
        const { j, ms } = await conf;
        const s = await situacoes([id2]);
        afirmar(exp.ok === true && j.status === 'expired' && ms >= 800 && s.expired === 1,
          'I5 (expira primeiro): a confirmação espera, responde expired e o recurso fica solto',
          JSON.stringify({ expirou: exp.ok, confirmar: j, esperouMs: Math.round(ms), situacoes: s }));
        notas.push(`I5 expirar primeiro: a confirmação esperou ${Math.round(ms)} ms e recebeu ${j.status}`);
      } finally {
        await c3.end().catch(() => {});
        await c4.end().catch(() => {});
      }
    }
    resumir('reserva', {}, notas);
  } finally {
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (reserva)', descreverErro(e)));
    await db.end();
  }
});
