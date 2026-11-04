// iMed Agenda, fase 4.2 — "bloquear mesmo assim" sob concorrência, no banco de verdade (Postgres 17 + PostgREST do
// Supabase local). Roda no GitHub (banco.yml):
//   node tests/banco/bloqueio-forcado.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
//   A. 30 conexões marcam no USG-1 (inícios de 08:00 a 11:30, de 15 em 15 min, duas para cada início) enquanto 1 conexão
//      confirma o agenda_block_force do USG-1 das 08:00 às 12:00 (com o código de uma prévia feita antes), todas
//      partindo juntas (barreira). Oráculo: OU o bloqueio existe, nenhum uso ativo do USG-1 cruza o período e todo
//      agendamento do período está em "remarcação solicitada" sem ocupação, OU a confirmação respondeu affected_changed
//      e não há bloqueio. Depois, a prévia e a confirmação de novo (sem disputa) têm de valer.
//   B. agenda_block_force × agenda_reschedule (o paciente leva o horário das 13:00 para DENTRO do período): OU o
//      bloqueio entrou e a remarcação recebeu slot_taken (o horário das 13:00 continua), OU a remarcação entrou e a
//      confirmação recebeu affected_changed (sem bloqueio).
//   Sempre: 0 impasses (40P01), 0 estouros de tempo (57014), 0 conferências quebradas (23514); I1 (capacidade e
//   fechamento) e I2 (item × ocupação: todos os recursos ou nenhum) pela consulta do oráculo.
//
// Os dados (uma clínica de teste e os agendamentos) são criados aqui e apagados no fim.

import { randomUUID } from 'node:crypto';
import {
  afirmar, anotar, configLocal, conectar, criarClinicaAgenda, descreverErro, estatisticas, horaSP, limparClinicaAgenda,
  principal, resumir, rodarJuntos, textoCodigos, violacoesAgenda,
} from './lib.mjs';

const CLINICA = 'cc000000-0000-4000-8000-0000000004b2';
const DONA = 'a5000000-0000-4000-8000-0000000004b2';
const EMAIL = 'dona.bloqueio.forcado@exemplo.test';
const DIA = 25;  // daqui a 25 dias
const ERROS_PROIBIDOS = ['40P01', '57014', '23514'];

const paciente = (n) => ({ name: `Paciente Bloqueio ${n}`, phone: `118${String(n).padStart(8, '0')}`, consent: true });
const claims = JSON.stringify({ role: 'authenticated', aud: 'authenticated', sub: DONA, email: EMAIL, amr: [{ method: 'otp', timestamp: 1 }] });

await principal('bloqueio-forcado', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-bloqueio-forcado-42');
  const notas = [];
  const rodadas = [];
  try {
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA });
    const { recursos, procedimentos: P } = await criarClinicaAgenda(db, {
      clinica: CLINICA, dona: DONA, email: EMAIL, nome: 'Clínica do Bloqueio Forçado do CI',
      recursos: [{ chave: 'usg', name: 'USG-1' }],
      procedimentos: [{ chave: 'p30', name: 'Ultrassom de 30 minutos', duration_min: 30, step_min: 15, grupos: [['usg']] }],
    });
    const item = (hhmm) => ({ procedure_id: P.p30, starts_at: horaSP(DIA, hhmm) });
    const ini = horaSP(DIA, '08:00');
    const fim = horaSP(DIA, '12:00');

    // Como o PostgREST: visitante marcando (tempo-limite de 3 s do anon na produção) e a dona bloqueando (8 s).
    const marcar = async (c, itens, n, codigo = `codigo-bloqueio-${n}-${randomUUID()}`, id = randomUUID()) => {
      await c.query('set local role anon');
      await c.query(`select set_config('request.jwt.claims', '{"role": "anon"}', true), set_config('statement_timeout', '3s', true)`);
      const { rows: [r] } = await c.query('select public.agenda_book($1, $2, $3, $4, $5) as j',
        [CLINICA, JSON.stringify(itens), JSON.stringify(paciente(n)), id, codigo]);
      return { ...r.j, id, codigo };
    };
    const comoDona = async (c) => {
      await c.query(`select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true),
                            set_config('statement_timeout', '8s', true)`, [claims]);
    };
    const forcar = async (c, confirmar) => {
      await comoDona(c);
      const { rows: [r] } = await c.query(`select public.agenda_block_force($1, $2, $3, $4, 'manutencao', null, $5) as j`,
        [CLINICA, recursos.usg, ini, fim, confirmar ?? null]);
      return r.j;
    };
    const transacao = async (f) => {
      const c = await conectar(cfg.dbUrl, 'imed-bloqueio-forcado-um');
      try {
        await c.query('begin');
        const v = await f(c);
        await c.query('commit');
        return v;
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally { await c.end(); }
    };
    const registrar = (nome, resultados, totalMs) => {
      const e = estatisticas(resultados.map((r) => (r.ok && r.valor?.status !== 'ok' ? { ...r, ok: false, code: r.valor?.status } : r)));
      rodadas.push({ nome, ...e, totalMs: Math.round(totalMs) });
      notas.push(`${nome}: ${e.ok} ok de ${e.total}; ${textoCodigos(e.porCodigo)}; p95 ${e.p95} ms; total ${Math.round(totalMs)} ms`);
      console.log(notas.at(-1));
      return e;
    };
    const semErroDeBanco = (e) => ERROS_PROIBIDOS.every((k) => !e.porCodigo[k]) && Object.keys(e.porCodigo).every((k) => !/^[0-9A-Z]{5}$/.test(k));
    const bloqueiosAtivos = async () => (await db.query(
      `select count(*)::int as n from public.clinic_blocks where clinic_id = $1 and removed_at is null and starts_at = $2 and ends_at = $3`,
      [CLINICA, ini, fim])).rows[0].n;
    // I2 (item × ocupação): ativo = um uso ativo por grupo; remarcação = todos ou nenhum; encerrado = nenhum.
    const violacoesI2 = async () => (await db.query(`
      select i.id, i.status, (select count(*) from agenda.occupancy o where o.item_id = i.id and o.active)::int as usos,
             cardinality(i.groups) as grupos
      from agenda.appointment_items i where i.clinic_id = $1`, [CLINICA])).rows
      .filter((r) => (['hold', 'awaiting_payment', 'confirmed', 'checked_in', 'in_service'].includes(r.status) && r.usos !== r.grupos)
        || (r.status === 'reschedule_requested' && r.usos !== 0 && r.usos !== r.grupos)
        || (!['hold', 'awaiting_payment', 'confirmed', 'checked_in', 'in_service', 'reschedule_requested'].includes(r.status) && r.usos > 0))
      .map((r) => `item ${r.id} (${r.status}) com ${r.usos} uso(s) ativo(s) para ${r.grupos} grupo(s)`);
    // Usos ativos do USG-1 que cruzam o período e agendamentos do período fora de "remarcação solicitada".
    const noPeriodo = async () => (await db.query(`
      select (select count(*) from agenda.occupancy o where o.resource_id = $2 and o.active and o.kind <> 'bloqueio'
                and o.during && tstzrange($3::timestamptz, $4::timestamptz))::int as usos,
             (select count(*) from agenda.appointment_items i where i.clinic_id = $1 and i.starts_at < $4 and i.ends_at > $3
                and i.status not in ('reschedule_requested', 'cancelled', 'expired'))::int as fora,
             (select count(*) from agenda.appointment_items i where i.clinic_id = $1 and i.starts_at < $4 and i.ends_at > $3
                and i.status = 'reschedule_requested')::int as remarcar`, [CLINICA, recursos.usg, ini, fim])).rows[0];

    /* ---------- A. 30 marcações × "bloquear mesmo assim" ---------- */
    {
      // dois agendamentos antes da corrida (a prévia já conta com eles)
      const antes = [];
      for (const [n, hh] of [[1, '08:00'], [2, '10:00']]) {
        antes.push(await transacao((c) => marcar(c, [item(hh)], n)));
      }
      afirmar(antes.every((m) => m.status === 'ok'), 'A: dois agendamentos no USG-1 antes da corrida', JSON.stringify(antes.map((m) => m.status)));
      const previa = await transacao((c) => forcar(c, null));
      afirmar(previa.status === 'confirm_required' && previa.items.length === 2 && /^[0-9a-f]{64}$/.test(previa.confirm),
        'A: prévia com os 2 agendamentos e o código', JSON.stringify({ status: previa.status, n: previa.items?.length }));
      const inicios = Array.from({ length: 15 }, (_, k) => `${String(8 + Math.floor(k / 4)).padStart(2, '0')}:${String((k % 4) * 15).padStart(2, '0')}`);
      const { resultados, totalMs } = await rodarJuntos({
        conexao: cfg.dbUrl, n: 31, chave: 442001,
        trabalho: async (c, i) => (i === 0 ? forcar(c, previa.confirm) : marcar(c, [item(inicios[(i - 1) % 15])], 100 + i)),
      });
      const confirmacao = resultados[0];
      const e = registrar('A. 30 marcações × confirmação do bloqueio forçado (USG-1, 08:00–12:00)', resultados.slice(1), totalMs);
      afirmar(semErroDeBanco(e) && confirmacao.ok && !ERROS_PROIBIDOS.includes(confirmacao.code),
        'A: nenhum impasse (40P01), estouro de tempo (57014) ou conferência quebrada (23514)',
        `${textoCodigos(e.porCodigo)}; confirmação: ${confirmacao.code ?? confirmacao.valor?.status}`);
      const st = confirmacao.valor?.status;
      const b = await bloqueiosAtivos();
      const p = await noPeriodo();
      if (st === 'ok') {
        afirmar(b === 1 && p.usos === 0 && p.fora === 0 && p.remarcar >= 2,
          'A (o bloqueio entrou primeiro): bloqueio gravado, nenhum uso no período, os agendamentos do período em remarcação',
          JSON.stringify({ bloqueios: b, ...p }));
      } else {
        afirmar(st === 'affected_changed' && b === 0,
          'A (alguma marcação entrou antes): a confirmação recebe affected_changed e nada é bloqueado',
          JSON.stringify({ confirmacao: st, bloqueios: b }));
        // sem disputa: a prévia nova e a confirmação valem
        const p2 = await transacao((c) => forcar(c, null));
        const ok2 = await transacao((c) => forcar(c, p2.confirm));
        const p3 = await noPeriodo();
        afirmar(ok2.status === 'ok' && await bloqueiosAtivos() === 1 && p3.usos === 0 && p3.fora === 0 && p3.remarcar === p2.items.filter((x) => x.kind === 'agendamento').length,
          'A (de novo, sem disputa): a prévia nova e a confirmação valem; todos do período vão para remarcar',
          JSON.stringify({ previa: p2.status, n: p2.items?.length, confirmacao: ok2.status, ...p3 }));
      }
      notas.push(`A: a confirmação do bloqueio respondeu ${st}; ${e.ok} marcação(ões) entraram`);
      const { rows: [{ conflitos }] } = await db.query(
        `select count(*)::int as conflitos from agenda.conflicts where clinic_id = $1 and kind = 'bloqueio_sobre_agendamento' and status = 'aberto'`, [CLINICA]);
      const { remarcar } = await noPeriodo();
      afirmar(conflitos === remarcar, 'A: um conflito "Para remarcar" aberto para cada agendamento movido', `conflitos ${conflitos}; em remarcação ${remarcar}`);
    }

    /* ---------- B. "bloquear mesmo assim" × remarcação para dentro do período ---------- */
    {
      // tira o bloqueio da rodada A e cancela os agendamentos dela (a dona, pelas funções: desde a 4.2 a clínica não lê
      // as tabelas direto), para recomeçar o período vazio
      const { rows: blocos } = await db.query('select id from public.clinic_blocks where clinic_id = $1 and removed_at is null', [CLINICA]);
      const { rows: pedidos } = await db.query(
        `select id from public.appointment_requests where clinic_id = $1 and status not in ('cancelled', 'expired')`, [CLINICA]);
      await transacao(async (c) => {
        await comoDona(c);
        for (const b of blocos) await c.query('select public.agenda_block_remove($1)', [b.id]);
        for (const p of pedidos) await c.query(`select public.agenda_cancel($1, 'clinica_indisponivel')`, [p.id]);
      });
      const fora = await transacao((c) => marcar(c, [item('13:00')], 900));
      afirmar(fora.status === 'ok', 'B: um agendamento às 13:00 (fora do período)', JSON.stringify(fora));
      const previa = await transacao((c) => forcar(c, null));
      afirmar(previa.status === 'confirm_required' && previa.items.length === 0, 'B: prévia sem ninguém no período', JSON.stringify(previa));
      const { resultados, totalMs } = await rodarJuntos({
        conexao: cfg.dbUrl, n: 2, chave: 442002,
        trabalho: async (c, i) => {
          if (i === 0) return forcar(c, previa.confirm);
          await c.query('set local role anon');
          await c.query(`select set_config('request.jwt.claims', '{"role": "anon"}', true), set_config('statement_timeout', '3s', true)`);
          const { rows: [r] } = await c.query('select public.agenda_reschedule($1, $2, $3, $4) as j',
            [fora.id, JSON.stringify([{ seq: 1, starts_at: horaSP(DIA, '09:00') }]), fora.codigo, randomUUID()]);
          return r.j;
        },
      });
      const [bloq, rem] = resultados;
      notas.push(`B: bloqueio ${bloq.valor?.status ?? bloq.code}; remarcação ${rem.valor?.status ?? rem.code}; ${Math.round(totalMs)} ms`);
      console.log(notas.at(-1));
      afirmar(bloq.ok && rem.ok, 'B: nenhum erro de banco na disputa', JSON.stringify({ bloqueio: bloq.code, remarcacao: rem.code }));
      const { rows: [a] } = await db.query('select status, slot_start from public.appointment_requests where id = $1', [fora.id]);
      const b = await bloqueiosAtivos();
      const as = new Date(a.slot_start).toISOString();
      if (bloq.valor?.status === 'ok') {
        afirmar(rem.valor?.status === 'slot_taken' && b === 1 && a.status === 'confirmed' && as === horaSP(DIA, '13:00'),
          'B (o bloqueio entrou primeiro): a remarcação recebe slot_taken e o horário das 13:00 continua',
          JSON.stringify({ remarcacao: rem.valor?.status, bloqueios: b, situacao: a.status, horario: as }));
      } else {
        afirmar(bloq.valor?.status === 'affected_changed' && rem.valor?.status === 'ok' && b === 0 && as === horaSP(DIA, '09:00'),
          'B (a remarcação entrou primeiro): a confirmação recebe affected_changed e o paciente fica às 09:00',
          JSON.stringify({ bloqueio: bloq.valor?.status, remarcacao: rem.valor?.status, bloqueios: b, horario: as }));
      }
    }

    /* ---------- Oráculo ---------- */
    const viol = [...await violacoesAgenda(db, CLINICA), ...await violacoesI2()];
    afirmar(viol.length === 0, 'oráculo: capacidade, nenhum uso dentro de bloqueio e item × ocupação (I2) em ordem', viol.join('\n'));
    resumir('bloqueio-forcado', { rodadas }, notas);
  } finally {
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (bloqueio-forcado)', descreverErro(e)));
    await db.end();
  }
});
