// iMed Agenda, fase 3.3 — teste obrigatório 7 (Falha de conexão), a parte do banco (arquitetura §13). Roda no
// GitHub (banco.yml):
//   node tests/banco/falha.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
//   1. A conexão cai (pg_terminate_backend) no meio de uma marcação: a transação já gravou o cabeçalho, o item e a
//      ocupação, mas não confirmou. Resultado: nenhuma linha parcial (nem pedido, nem item, nem ocupação), o horário
//      continua livre e a próxima pessoa marca normalmente.
//   2. A conexão cai enquanto espera na fila do recurso (outra marcação segura a trava): quem segurava confirma, quem
//      caiu não deixa nada, e a trava do recurso não fica presa.
//   3. O mesmo agendamento reenviado depois da queda (mesmo id e código, como o app faz): grava uma vez só.
// A parte do painel (desconectado enquanto alguém marca; ao reconectar a versão mudou) é da fase 4.3 (tempo real).
// Os dados são criados aqui e apagados no fim.

import { randomUUID } from 'node:crypto';
import {
  afirmar, anotar, configLocal, conectar, criarClinicaAgenda, descreverErro, horaSP, limparClinicaAgenda, principal, resumir,
} from './lib.mjs';

const CLINICA = 'cc000000-0000-4000-8000-0000000003c5';
const DONA = 'a5000000-0000-4000-8000-0000000003c5';
const EMAIL = 'dona.falha@exemplo.test';
const DIA = 22;

await principal('falha', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-falha');
  const notas = [];
  try {
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA });
    const { procedimentos: P } = await criarClinicaAgenda(db, {
      clinica: CLINICA, dona: DONA, email: EMAIL, nome: 'Clínica da Falha do CI',
      recursos: [{ chave: 'unico', name: 'Aparelho único' }],
      procedimentos: [{ chave: 'p', name: 'Exame de 30 minutos', duration_min: 30, grupos: [['unico']] }],
    });
    const itens = (hhmm) => JSON.stringify([{ procedure_id: P.p, starts_at: horaSP(DIA, hhmm) }]);
    const pac = (n) => JSON.stringify({ name: `Paciente Falha ${n}`, phone: `119${String(n).padStart(8, '0')}`, consent: true });
    const marcar = (c, hhmm, n, id = randomUUID(), codigo = `codigo-falha-${randomUUID()}`) =>
      c.query(`select public.agenda_book($1, $2, $3, $4, $5) as j`, [CLINICA, itens(hhmm), pac(n), id, codigo]);
    const anon = async (c) => {
      await c.query('begin');
      await c.query('set local role anon');
      await c.query(`select set_config('request.jwt.claims', '{"role": "anon"}', true)`);
    };
    const contar = async (id) => (await db.query(`
      select (select count(*) from public.appointment_requests where id = $1)::int as pedidos,
             (select count(*) from agenda.appointment_items where request_id = $1)::int as itens,
             (select count(*) from agenda.occupancy o where o.clinic_id = $2 and o.item_id is not null
                and not exists (select 1 from agenda.appointment_items i where i.id = o.item_id))::int as orfas`, [id, CLINICA])).rows[0];
    const pid = async (c) => (await c.query('select pg_backend_pid() as p')).rows[0].p;

    /* ---------- 1. Cai no meio da marcação ---------- */
    {
      const c = await conectar(cfg.dbUrl, 'imed-vai-cair');
      const id = randomUUID();
      const pid0 = await pid(c);
      await anon(c);
      const { rows: [r] } = await marcar(c, '09:00', 1, id);
      const { rows: [{ dentro }] } = await c.query(`select count(*)::int as dentro from agenda.occupancy o
        join agenda.appointment_items i on i.id = o.item_id where i.request_id = $1 and o.active`, [id]).catch(() => ({ rows: [{ dentro: -1 }] }));
      await db.query('select pg_terminate_backend($1)', [pid0]);
      await c.end().catch(() => {});
      await new Promise((res) => setTimeout(res, 300));
      const x = await contar(id);
      afirmar(r.j.status === 'ok' && x.pedidos === 0 && x.itens === 0 && x.orfas === 0,
        '7: a conexão caiu depois de gravar (sem COMMIT): nenhuma linha parcial', JSON.stringify({ marcou: r.j.status, dentroDaTransacao: dentro, ...x }));
      const c2 = await conectar(cfg.dbUrl, 'imed-depois-da-queda');
      await anon(c2);
      const { rows: [r2] } = await marcar(c2, '09:00', 2);
      await c2.query('commit');
      await c2.end();
      afirmar(r2.j.status === 'ok', '7: o horário continuou livre e a próxima pessoa marca', JSON.stringify(r2.j));
      notas.push(`Queda no meio da marcação: ${x.pedidos} pedido, ${x.itens} item e ${x.orfas} ocupação órfã depois; o horário seguiu livre (${r2.j.status})`);
    }

    /* ---------- 2. Cai enquanto espera na fila do recurso ---------- */
    {
      const c1 = await conectar(cfg.dbUrl, 'imed-segura');
      const c2 = await conectar(cfg.dbUrl, 'imed-espera-e-cai');
      const id2 = randomUUID();
      await anon(c1);
      const { rows: [r1] } = await marcar(c1, '10:00', 3);
      const pid2 = await pid(c2);
      await anon(c2);
      const esperando = marcar(c2, '10:30', 4, id2).catch((e) => ({ erro: e.code ?? e.message }));
      await new Promise((res) => setTimeout(res, 500));
      await db.query('select pg_terminate_backend($1)', [pid2]);
      const caiu = await esperando;
      await c2.end().catch(() => {});
      await c1.query('commit');
      await c1.end();
      const x = await contar(id2);
      const c3 = await conectar(cfg.dbUrl, 'imed-depois-da-fila');
      await anon(c3);
      const t0 = Date.now();
      const { rows: [r3] } = await marcar(c3, '10:30', 5);
      await c3.query('commit');
      await c3.end();
      afirmar(r1.j.status === 'ok' && caiu?.erro && x.pedidos === 0 && r3.j.status === 'ok' && Date.now() - t0 < 2000,
        '7: quem caiu na fila do recurso não deixa nada e a trava não fica presa',
        JSON.stringify({ segurou: r1.j.status, caiu, ...x, depois: r3.j.status }));
      notas.push(`Queda na fila do recurso: ${caiu?.erro ?? 'sem erro'}; nada gravado; a próxima marcação entrou em ${Date.now() - t0} ms`);
    }

    /* ---------- 3. Reenvio depois da queda ---------- */
    {
      const id = randomUUID();
      const codigo = `codigo-reenvio-${randomUUID()}`;
      const c = await conectar(cfg.dbUrl, 'imed-reenvio-cai');
      const pid1 = await pid(c);
      await anon(c);
      await marcar(c, '11:00', 6, id, codigo);
      await db.query('select pg_terminate_backend($1)', [pid1]);
      await c.end().catch(() => {});
      const c2 = await conectar(cfg.dbUrl, 'imed-reenvio');
      const res = [];
      for (let k = 0; k < 2; k++) {
        await anon(c2);
        const { rows: [r] } = await marcar(c2, '11:00', 6, id, codigo);
        await c2.query('commit');
        res.push(r.j.status + (r.j.replay ? ' (replay)' : ''));
      }
      await c2.end();
      const x = await contar(id);
      afirmar(res[0] === 'ok' && res[1] === 'ok (replay)' && x.pedidos === 1 && x.itens === 1,
        '7: reenviado depois da queda (mesmo id e código): grava uma vez; o segundo reenvio é replay', JSON.stringify({ res, ...x }));
      notas.push(`Reenvio depois da queda: ${res.join(' → ')}; ${x.pedidos} agendamento`);
    }
    resumir('falha', {}, notas);
  } finally {
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (falha)', descreverErro(e)));
    await db.end();
  }
});
