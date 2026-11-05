// iMed Agenda, fase 4.2 — "bloquear mesmo assim" sob concorrência, no banco de verdade (Postgres 17 + PostgREST do
// Supabase local). Roda no GitHub (banco.yml):
//   node tests/banco/bloqueio-forcado.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
//   A. 30 conexões diretas: a recepção marca no balcão (agenda_desk_book, como o PostgREST faz com o token dela:
//      authenticated, tempo-limite de 8 s da produção) no USG-1, inícios de 08:00 a 11:30 (de 15 em 15 min, duas para
//      cada início), enquanto 1 conexão confirma o agenda_block_force do USG-1 das 08:00 às 12:00 (com o código de uma
//      prévia feita antes), todas partindo juntas (barreira). Oráculo: OU o bloqueio existe, nenhum uso ativo do USG-1
//      cruza o período e todo agendamento do período está em "remarcação solicitada" sem ocupação, OU a confirmação
//      respondeu affected_changed e não há bloqueio (e aí a prévia e a confirmação de novo, sem disputa, têm de valer).
//   A-HTTP. O mesmo pela API de verdade: 30 POST rpc/agenda_desk_book (token da recepção) e 1 POST
//      rpc/agenda_block_force (token da dona) ao mesmo tempo no PostgREST local; o mesmo oráculo.
//   A-atraso. Como A, mas a confirmação parte 300 ms depois das marcações: se alguma marcação do período já tinha
//      entrado, o código da prévia ficou velho e a confirmação TEM de responder affected_changed (o desfecho que a
//      disputa de A quase nunca mostra, porque a trava da confirmação costuma chegar antes).
//   B. agenda_block_force × agenda_reschedule (o paciente leva o horário das 13:00 para DENTRO do período): OU o
//      bloqueio entrou e a remarcação recebeu slot_taken (o horário das 13:00 continua), OU a remarcação entrou e a
//      confirmação recebeu affected_changed (sem bloqueio).
//   Sempre: 0 impasses (40P01), 0 estouros de tempo (57014), 0 conferências quebradas (23514), nenhum erro HTTP; I1
//   (capacidade e fechamento) e I2 (item × ocupação: todos os recursos ou nenhum) pela consulta do oráculo.
//
// Os dados (uma clínica de teste, a recepção e os agendamentos) são criados aqui e apagados no fim.

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  afirmar, anotar, configLocal, conectar, criarClinicaAgenda, descreverErro, estatisticas, horaSP, limparClinicaAgenda,
  postgrest, principal, resumir, rodarJuntos, textoCodigos, tokenUsuario, violacoesAgenda,
} from './lib.mjs';

const CLINICA = 'cc000000-0000-4000-8000-0000000004b2';
const DONA = 'a5000000-0000-4000-8000-0000000004b2';
const EMAIL = 'dona.bloqueio.forcado@exemplo.test';
const RECEPCAO = 'a5000000-0000-4000-8000-0000000014b2';
const EMAIL_RECEPCAO = 'recepcao.bloqueio.forcado@exemplo.test';
const DIA = 25;  // daqui a 25 dias
const ATRASO_MS = 300;
const ERROS_PROIBIDOS = ['40P01', '57014', '23514'];

const paciente = (n) => ({ name: `Paciente Bloqueio ${n}`, phone: `118${String(n).padStart(8, '0')}`, consent: true });
const claimsDe = (sub, email) => JSON.stringify({ role: 'authenticated', aud: 'authenticated', sub, email, amr: [{ method: 'otp', timestamp: 1 }] });
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
// inícios das marcações da corrida: 08:00, 08:15, ..., 11:30
const INICIOS = Array.from({ length: 15 }, (_, k) => `${String(8 + Math.floor(k / 4)).padStart(2, '0')}:${String((k % 4) * 15).padStart(2, '0')}`);

async function limpar(db) {
  await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA });
  await db.query('delete from auth.users where id = $1', [RECEPCAO]);
}

await principal('bloqueio-forcado', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-bloqueio-forcado-42');
  const notas = [];
  const rodadas = [];
  try {
    await limpar(db);
    const { recursos, procedimentos: P } = await criarClinicaAgenda(db, {
      clinica: CLINICA, dona: DONA, email: EMAIL, nome: 'Clínica do Bloqueio Forçado do CI',
      recursos: [{ chave: 'usg', name: 'USG-1' }],
      procedimentos: [{ chave: 'p30', name: 'Ultrassom de 30 minutos', duration_min: 30, step_min: 15, grupos: [['usg']] }],
    });
    await db.query(`insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
                    values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(),
                            '{"provider": "email", "providers": ["email"]}', '{}', now(), now())`, [RECEPCAO, EMAIL_RECEPCAO]);
    await db.query(`insert into public.clinic_members (clinic_id, user_id, role) values ($1, $2, 'reception')`, [CLINICA, RECEPCAO]);
    const item = (hhmm) => ({ procedure_id: P.p30, starts_at: horaSP(DIA, hhmm) });
    const ini = horaSP(DIA, '08:00');
    const fim = horaSP(DIA, '12:00');

    // Como o PostgREST faz com o token de cada um: papel authenticated, as claims e o tempo-limite de 8 s da produção.
    const como = (c, claims) => c.query(`select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true),
                                                set_config('statement_timeout', '8s', true)`, [claims]);
    // A recepção marca no balcão (a chave de reenvio de cada marcação é nova).
    const marcar = async (c, itens, n) => {
      await como(c, claimsDe(RECEPCAO, EMAIL_RECEPCAO));
      const { rows: [r] } = await c.query(`select public.agenda_desk_book($1, $2, $3, 'clinica_balcao', $4) as j`,
        [CLINICA, JSON.stringify(itens), JSON.stringify(paciente(n)), randomUUID()]);
      return r.j;
    };
    // O paciente marca pelo site (visitante, 3 s), com o código dele: na rodada B ele mesmo remarca.
    const marcarPaciente = async (c, itens, n, codigo = `codigo-bloqueio-${n}-${randomUUID()}`, id = randomUUID()) => {
      await c.query('set local role anon');
      await c.query(`select set_config('request.jwt.claims', '{"role": "anon"}', true), set_config('statement_timeout', '3s', true)`);
      const { rows: [r] } = await c.query('select public.agenda_book($1, $2, $3, $4, $5) as j',
        [CLINICA, JSON.stringify(itens), JSON.stringify(paciente(n)), id, codigo]);
      return { ...r.j, id, codigo };
    };
    const comoDona = (c) => como(c, claimsDe(DONA, EMAIL));
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
    // erro de banco (código do Postgres) ou da API (HTTP sem resposta da função) reprova; resposta da função
    // (slot_taken...) não
    const semErroDeBanco = (e) => ERROS_PROIBIDOS.every((k) => !e.porCodigo[k])
      && Object.keys(e.porCodigo).every((k) => !/^[0-9A-Z]{5}$/.test(k) && !/^HTTP /.test(k));
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
    // Recomeça com o período vazio: tira os bloqueios e cancela os agendamentos (a dona, pelas funções: desde a 4.2 a
    // clínica não lê as tabelas direto; cancelar fecha sozinho o conflito "Para remarcar" de cada um).
    const zerar = async (rotulo) => {
      const { rows: blocos } = await db.query('select id from public.clinic_blocks where clinic_id = $1 and removed_at is null', [CLINICA]);
      const { rows: pedidos } = await db.query(
        `select id from public.appointment_requests where clinic_id = $1 and status not in ('cancelled', 'expired')`, [CLINICA]);
      await transacao(async (c) => {
        await comoDona(c);
        for (const b of blocos) await c.query('select public.agenda_block_remove($1)', [b.id]);
        for (const p of pedidos) await c.query(`select public.agenda_cancel($1, 'clinica_indisponivel')`, [p.id]);
      });
      const p = await noPeriodo();
      const { rows: [{ abertos }] } = await db.query(
        `select count(*)::int as abertos from agenda.conflicts where clinic_id = $1 and kind = 'bloqueio_sobre_agendamento' and status = 'aberto'`, [CLINICA]);
      afirmar(await bloqueiosAtivos() === 0 && p.usos === 0 && p.fora === 0 && p.remarcar === 0 && abertos === 0,
        `${rotulo}: período vazio para recomeçar (sem bloqueio, agendamento ou conflito aberto)`, JSON.stringify({ ...p, abertos }));
    };
    // Dois agendamentos de balcão no período e a prévia (com os 2 e o código).
    const antesDaCorrida = async (rotulo) => {
      const antes = [];
      for (const [n, hh] of [[1, '08:00'], [2, '10:00']]) antes.push(await transacao((c) => marcar(c, [item(hh)], n)));
      afirmar(antes.every((m) => m.status === 'ok'), `${rotulo}: dois agendamentos de balcão no USG-1 antes da corrida`,
        JSON.stringify(antes.map((m) => m.status)));
      const previa = await transacao((c) => forcar(c, null));
      afirmar(previa.status === 'confirm_required' && previa.items.length === 2 && /^[0-9a-f]{64}$/.test(previa.confirm),
        `${rotulo}: prévia com os 2 agendamentos e o código`, JSON.stringify({ status: previa.status, n: previa.items?.length }));
      return previa;
    };
    // O oráculo de A (os dois desfechos) e um conflito "Para remarcar" por agendamento movido.
    const conferirDesfecho = async (rotulo, st) => {
      const b = await bloqueiosAtivos();
      const p = await noPeriodo();
      if (st === 'ok') {
        afirmar(b === 1 && p.usos === 0 && p.fora === 0 && p.remarcar >= 2,
          `${rotulo} (o bloqueio entrou primeiro): bloqueio gravado, nenhum uso no período, os agendamentos do período em remarcação`,
          JSON.stringify({ bloqueios: b, ...p }));
      } else {
        afirmar(st === 'affected_changed' && b === 0,
          `${rotulo} (alguma marcação entrou antes): a confirmação recebe affected_changed e nada é bloqueado`,
          JSON.stringify({ confirmacao: st, bloqueios: b }));
        // sem disputa: a prévia nova e a confirmação valem
        const p2 = await transacao((c) => forcar(c, null));
        const ok2 = await transacao((c) => forcar(c, p2.confirm));
        const p3 = await noPeriodo();
        afirmar(ok2.status === 'ok' && await bloqueiosAtivos() === 1 && p3.usos === 0 && p3.fora === 0
          && p3.remarcar === p2.items.filter((x) => x.kind === 'agendamento').length,
          `${rotulo} (de novo, sem disputa): a prévia nova e a confirmação valem; todos do período vão para remarcar`,
          JSON.stringify({ previa: p2.status, n: p2.items?.length, confirmacao: ok2.status, ...p3 }));
      }
      const { rows: [{ conflitos }] } = await db.query(
        `select count(*)::int as conflitos from agenda.conflicts where clinic_id = $1 and kind = 'bloqueio_sobre_agendamento' and status = 'aberto'`, [CLINICA]);
      const { remarcar } = await noPeriodo();
      afirmar(conflitos === remarcar, `${rotulo}: um conflito "Para remarcar" aberto para cada agendamento movido`,
        `conflitos ${conflitos}; em remarcação ${remarcar}`);
    };

    /* ---------- A. 30 marcações de balcão × "bloquear mesmo assim" (conexões diretas) ---------- */
    {
      const previa = await antesDaCorrida('A');
      const { resultados, totalMs } = await rodarJuntos({
        conexao: cfg.dbUrl, n: 31, chave: 442001,
        trabalho: async (c, i) => (i === 0 ? forcar(c, previa.confirm) : marcar(c, [item(INICIOS[(i - 1) % 15])], 100 + i)),
      });
      const confirmacao = resultados[0];
      const e = registrar('A. 30 marcações de balcão (recepção) × confirmação do bloqueio forçado (USG-1, 08:00–12:00), conexões diretas',
        resultados.slice(1), totalMs);
      afirmar(semErroDeBanco(e) && confirmacao.ok && !ERROS_PROIBIDOS.includes(confirmacao.code),
        'A: nenhum impasse (40P01), estouro de tempo (57014) ou conferência quebrada (23514)',
        `${textoCodigos(e.porCodigo)}; confirmação: ${confirmacao.code ?? confirmacao.valor?.status}`);
      const st = confirmacao.valor?.status;
      await conferirDesfecho('A', st);
      notas.push(`A: a confirmação do bloqueio respondeu ${st}; ${e.ok} marcação(ões) de balcão entraram`);
    }

    /* ---------- A-HTTP. O mesmo pela API de verdade (PostgREST local) ---------- */
    if (cfg.apiUrl && cfg.publishableKey && cfg.jwtSecret) {
      await zerar('A-HTTP');
      const previa = await antesDaCorrida('A-HTTP');
      const tokens = {
        recepcao: tokenUsuario(cfg, { sub: RECEPCAO, email: EMAIL_RECEPCAO }),
        dona: tokenUsuario(cfg, { sub: DONA, email: EMAIL }),
      };
      let reenvios = 0;
      // Se a conexão HTTP cair, reenvia o MESMO pedido (mesma chave de reenvio; o bloqueio igual já gravado responde
      // ok com replay): nada duplica.
      const chamar = async (caminho, token, corpo) => {
        for (let t = 0; ; t++) {
          try {
            return await postgrest(cfg, caminho, { token, prefer: null, corpo });
          } catch (err) {
            if (t >= 5) throw err;
            reenvios++;
            await espera(200 * (t + 1));
          }
        }
      };
      const resultado = (r) => (r.status !== 200 ? { ok: false, code: r.code ?? `HTTP ${r.status}`, message: r.message, ms: r.ms }
        : { ok: true, valor: r.json, ms: r.ms });
      const t0 = performance.now();
      const marcacoes = Array.from({ length: 30 }, (_, k) => chamar('rpc/agenda_desk_book', tokens.recepcao, {
        p_clinic: CLINICA, p_items: [item(INICIOS[k % 15])], p_patient: paciente(500 + k), p_channel: 'clinica_balcao', p_key: randomUUID(),
      }).then(resultado));
      // a confirmação sai junto com as marcações (o PostgREST atende na ordem que der)
      const confirmacaoP = chamar('rpc/agenda_block_force', tokens.dona, {
        p_clinic: CLINICA, p_resource: recursos.usg, p_starts: ini, p_ends: fim, p_kind: 'manutencao', p_reason: null, p_confirm: previa.confirm,
      }).then(resultado);
      const [confirmacao, ...resultados] = await Promise.all([confirmacaoP, ...marcacoes]);
      const e = registrar('A-HTTP. 30 POST rpc/agenda_desk_book (recepção) × POST rpc/agenda_block_force (dona) no PostgREST',
        resultados, performance.now() - t0);
      afirmar(semErroDeBanco(e) && confirmacao.ok,
        'A-HTTP: nenhum erro de banco nem da API (0 40P01, 0 57014, 0 23514, nenhum HTTP de erro)',
        `${textoCodigos(e.porCodigo)}; confirmação: ${confirmacao.code ?? confirmacao.valor?.status} ${confirmacao.message ?? ''}`);
      const st = confirmacao.valor?.status;
      await conferirDesfecho('A-HTTP', st);
      notas.push(`A-HTTP: a confirmação do bloqueio respondeu ${st}; ${e.ok} marcação(ões) de balcão entraram; ${reenvios} reenvio(s) HTTP`);
    } else {
      anotar('warning', 'Sem o PostgREST local (API_URL/PUBLISHABLE_KEY/JWT_SECRET): a rodada A-HTTP do bloqueio forçado não rodou');
    }

    /* ---------- A-atraso. A confirmação parte depois das marcações: affected_changed ---------- */
    {
      await zerar('A-atraso');
      const previa = await antesDaCorrida('A-atraso');
      const { resultados, totalMs } = await rodarJuntos({
        conexao: cfg.dbUrl, n: 31, chave: 442003,
        trabalho: async (c, i) => {
          if (i > 0) return marcar(c, [item(INICIOS[(i - 1) % 15])], 300 + i);
          await espera(ATRASO_MS);
          // quantos agendamentos do período já estavam gravados quando a confirmação partiu (com os 2 da prévia)
          const { rows: [v] } = await c.query(`select count(*)::int as n from agenda.appointment_items
                                                where clinic_id = $1 and status = 'confirmed' and starts_at < $3 and ends_at > $2`,
          [CLINICA, ini, fim]);
          return { ...(await forcar(c, previa.confirm)), vistos: v.n };
        },
      });
      const confirmacao = resultados[0];
      const e = registrar(`A-atraso. 30 marcações de balcão; a confirmação do bloqueio ${ATRASO_MS} ms depois`, resultados.slice(1), totalMs);
      afirmar(semErroDeBanco(e) && confirmacao.ok && !ERROS_PROIBIDOS.includes(confirmacao.code),
        'A-atraso: nenhum impasse (40P01), estouro de tempo (57014) ou conferência quebrada (23514)',
        `${textoCodigos(e.porCodigo)}; confirmação: ${confirmacao.code ?? confirmacao.valor?.status}`);
      const st = confirmacao.valor?.status;
      const novos = (confirmacao.valor?.vistos ?? 2) - 2;
      if (novos > 0) {
        afirmar(st === 'affected_changed',
          'A-atraso: com marcações do período gravadas depois da prévia, o código ficou velho: a confirmação recebe affected_changed',
          JSON.stringify({ confirmacao: st, novos }));
      } else {
        anotar('warning', 'A-atraso: nenhuma marcação entrou antes da confirmação (máquina lenta?); valeu só o oráculo dos dois desfechos',
          JSON.stringify({ confirmacao: st }));
      }
      await conferirDesfecho('A-atraso', st);
      notas.push(`A-atraso: ${novos} marcação(ões) do período gravada(s) antes da confirmação, que respondeu ${st}; ${e.ok} marcação(ões) entraram`);
    }

    /* ---------- B. "bloquear mesmo assim" × remarcação para dentro do período ---------- */
    {
      await zerar('B');
      const fora = await transacao((c) => marcarPaciente(c, [item('13:00')], 900));
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
    await limpar(db).catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (bloqueio-forcado)', descreverErro(e)));
    await db.end();
  }
});
