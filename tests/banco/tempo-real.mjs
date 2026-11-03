// iMed Agenda, fase 3.4 — teste obrigatório 9 (Isolamento), a parte do Realtime, e o aviso em tempo real (§7), no
// Supabase local de verdade (WebSocket no serviço Realtime). Roda no GitHub (banco.yml):
//   node tests/banco/tempo-real.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
//   1. Canal privado agenda:clinica:<A>: a dona de A entra; o financeiro de A (sem agenda.ver) e a dona de B são
//      recusados; ninguém entra em agenda:imed sem ser da equipe do IMED.
//   2. Aviso só depois do COMMIT: uma mudança na agenda de A (agenda_desk_busy) com a transação ainda aberta não avisa;
//      desfeita (ROLLBACK), nunca avisa; confirmada (COMMIT), a dona de A recebe {v} (só a versão, sem dado pessoal).
//   3. A dona de B, conectada ao próprio canal, não recebe o aviso de A.
// Protocolo (o mesmo que assets/js/tempo-real.js vai usar na 4.3): Phoenix v1 em JSON, tópico "realtime:<nome>",
// phx_join com {config: {broadcast: {self: false}, presence: {enabled: false}, private: true}, access_token}.
// Os dados são criados aqui e apagados no fim.

import {
  afirmar, anotar, configLocal, conectar, criarClinicaAgenda, descreverErro, horaSP, limparClinicaAgenda, principal, resumir,
  tokenUsuario,
} from './lib.mjs';

const A = 'cc000000-0000-4000-8000-0000000003d1';
const B = 'cc000000-0000-4000-8000-0000000003d2';
const DONA_A = { sub: 'a5000000-0000-4000-8000-0000000003d1', email: 'dona.a.tempo-real@exemplo.test' };
const DONA_B = { sub: 'a5000000-0000-4000-8000-0000000003d2', email: 'dona.b.tempo-real@exemplo.test' };
const FIN_A = { sub: 'a5000000-0000-4000-8000-0000000003d3', email: 'fin.a.tempo-real@exemplo.test' };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Uma conexão WebSocket com o Realtime local: entrar em canais e guardar as mensagens que chegam. */
class Canal {
  constructor(url) {
    this.url = url;
    this.ref = 0;
    this.respostas = new Map();
    this.mensagens = [];
  }
  async abrir() {
    this.ws = new WebSocket(this.url);
    await new Promise((ok, falha) => {
      const t = setTimeout(() => falha(new Error('o WebSocket do Realtime não abriu em 10 s')), 10000);
      this.ws.addEventListener('open', () => { clearTimeout(t); ok(); });
      this.ws.addEventListener('error', () => { clearTimeout(t); falha(new Error('erro ao abrir o WebSocket do Realtime')); });
    });
    this.ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.event === 'phx_reply' && this.respostas.has(m.ref)) this.respostas.get(m.ref)(m);
      else this.mensagens.push(m);
    });
    this.batida = setInterval(() => this.mandar('phoenix', 'heartbeat', {}), 25000);
  }
  mandar(topic, event, payload) {
    const ref = String(++this.ref);
    this.ws.send(JSON.stringify({ topic, event, payload, ref, join_ref: event === 'phx_join' ? ref : undefined }));
    return ref;
  }
  /** Entra no canal privado; devolve 'ok' ou o motivo da recusa (resposta de erro, erro do canal ou silêncio em 8 s). */
  async entrar(nome, token) {
    const topic = `realtime:${nome}`;
    const ref = this.mandar(topic, 'phx_join', {
      config: { broadcast: { self: false, ack: false }, presence: { enabled: false }, private: true }, access_token: token,
    });
    const r = await Promise.race([
      new Promise((ok) => this.respostas.set(ref, ok)),
      espera(8000).then(() => null),
    ]);
    if (!r) return 'sem resposta';
    if (r.payload?.status === 'ok') {
      // o Realtime pode recusar logo depois da resposta (system/phx_error) quando a policy nega a leitura
      await espera(1500);
      const erro = this.mensagens.find((m) => m.topic === topic && (m.event === 'phx_error' || m.event === 'phx_close'
        || (m.event === 'system' && m.payload?.status === 'error')));
      return erro ? `recusado depois (${erro.event}: ${JSON.stringify(erro.payload).slice(0, 160)})` : 'ok';
    }
    return `recusado (${JSON.stringify(r.payload?.response ?? r.payload).slice(0, 160)})`;
  }
  avisos(nome) {
    return this.mensagens.filter((m) => m.topic === `realtime:${nome}` && m.event === 'broadcast');
  }
  fechar() {
    clearInterval(this.batida);
    try { this.ws.close(); } catch { /* já fechado */ }
  }
}

await principal('tempo-real', async () => {
  const cfg = configLocal();
  if (!cfg.apiUrl) throw new Error('Sem o endereço da API local (supabase status: API_URL).');
  const db = await conectar(cfg.dbUrl, 'imed-tempo-real');
  const notas = [];
  const canais = [];
  try {
    await limparClinicaAgenda(db, { clinica: A, dona: DONA_A.sub });
    await limparClinicaAgenda(db, { clinica: B, dona: DONA_B.sub });
    await db.query('delete from auth.users where id = $1', [FIN_A.sub]);
    const { recursos: RA } = await criarClinicaAgenda(db, {
      clinica: A, dona: DONA_A.sub, email: DONA_A.email, nome: 'Clínica A do Tempo Real',
      recursos: [{ chave: 'usg', name: 'USG do Tempo Real' }],
      procedimentos: [{ chave: 'p', name: 'Ultrassom do Tempo Real', duration_min: 30, grupos: [['usg']] }],
    });
    await criarClinicaAgenda(db, {
      clinica: B, dona: DONA_B.sub, email: DONA_B.email, nome: 'Clínica B do Tempo Real',
      recursos: [{ chave: 'usg', name: 'USG B do Tempo Real' }],
      procedimentos: [{ chave: 'p', name: 'Ultrassom B do Tempo Real', duration_min: 30, grupos: [['usg']] }],
    });
    await db.query(`insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
                    values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(),
                            '{"provider": "email", "providers": ["email"]}', '{}', now(), now())`, [FIN_A.sub, FIN_A.email]);
    await db.query(`insert into public.clinic_members (clinic_id, user_id, role) values ($1, $2, 'finance')`, [A, FIN_A.sub]);

    // A chave do site (publishable) no "apikey", como o painel fará (fase 0.1: o site não tem token de visitante).
    if (!cfg.publishableKey) throw new Error('Sem a chave publishable local (supabase status: PUBLISHABLE_KEY).');
    const url = `${cfg.apiUrl.replace(/^http/, 'ws')}/realtime/v1/websocket?vsn=1.0.0&apikey=${encodeURIComponent(cfg.publishableKey)}`;
    const tA = tokenUsuario(cfg, DONA_A);
    const ca = new Canal(url);
    canais.push(ca);
    await ca.abrir();
    const entrouA = await ca.entrar(`agenda:clinica:${A}`, tA);
    afirmar(entrouA === 'ok', 'a dona de A entra no canal privado agenda:clinica:A', entrouA);

    const cb = new Canal(url);
    canais.push(cb);
    await cb.abrir();
    const bEmA = await cb.entrar(`agenda:clinica:${A}`, tokenUsuario(cfg, DONA_B));
    afirmar(bEmA !== 'ok', 'a dona de B é recusada no canal da clínica A', bEmA);
    const bEmB = await cb.entrar(`agenda:clinica:${B}`, tokenUsuario(cfg, DONA_B));
    afirmar(bEmB === 'ok', 'a dona de B entra no canal da própria clínica', bEmB);

    const cf = new Canal(url);
    canais.push(cf);
    await cf.abrir();
    const fin = await cf.entrar(`agenda:clinica:${A}`, tokenUsuario(cfg, FIN_A));
    afirmar(fin !== 'ok', 'o financeiro de A (sem agenda.ver) é recusado no canal da agenda', fin);
    const imed = await cf.entrar('agenda:imed', tA);
    afirmar(imed !== 'ok', 'agenda:imed recusa quem não é da equipe do IMED', imed);

    // Mudança na agenda de A numa transação aberta (como a dona de A), depois desfeita.
    const mudar = async (fim) => {
      await db.query('begin');
      await db.query(`select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`,
        [JSON.stringify({ role: 'authenticated', aud: 'authenticated', ...DONA_A, amr: [{ method: 'otp', timestamp: 1 }] })]);
      const { rows: [r] } = await db.query(`select public.agenda_desk_busy($1, $2, $3, $4) as j`,
        [A, horaSP(15, '08:00'), horaSP(15, '08:30'), RA.usg]);
      afirmar(r.j?.status === 'ok', `"só ocupar" na agenda de A (${fim})`, JSON.stringify(r.j));
      await espera(2500);
      const antes = ca.avisos(`agenda:clinica:${A}`).length;
      await db.query(fim);
      return antes;
    };
    const antesRollback = await mudar('rollback');
    afirmar(antesRollback === 0, 'com a transação aberta, nenhum aviso sai', `${antesRollback} aviso(s)`);
    await espera(3000);
    afirmar(ca.avisos(`agenda:clinica:${A}`).length === 0, 'transação desfeita (ROLLBACK) não avisa ninguém',
      JSON.stringify(ca.avisos(`agenda:clinica:${A}`)));
    const { rows: [v0] } = await db.query('select version from agenda.clinic_versions where clinic_id = $1', [A]);

    const antesCommit = await mudar('commit');
    afirmar(antesCommit === 0, 'antes do COMMIT, nenhum aviso', `${antesCommit} aviso(s)`);
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && ca.avisos(`agenda:clinica:${A}`).length === 0) await espera(200);
    const recebidos = ca.avisos(`agenda:clinica:${A}`);
    const msg = recebidos[0]?.payload;
    notas.push(`Aviso depois do COMMIT: ${recebidos.length ? `${Date.now() - t0} ms` : 'não chegou em 15 s'}.`);
    afirmar(recebidos.length >= 1, 'depois do COMMIT, a dona de A recebe o aviso', JSON.stringify(ca.mensagens.slice(-5)));
    if (msg) {
      const corpo = msg.payload ?? {};
      const chaves = Object.keys(corpo).sort().join(',');
      afirmar(msg.event === 'agenda' && (chaves === 'id,v' || chaves === 'v'), 'o aviso leva só a versão (e o id da mensagem)',
        JSON.stringify(msg));
      afirmar(Number(corpo.v) === Number(v0?.version ?? 0) + 1, 'a versão do aviso é a versão nova da agenda',
        `aviso ${corpo.v}, antes ${v0?.version}`);
    }
    await espera(1000);
    afirmar(cb.avisos(`agenda:clinica:${B}`).length === 0 && cb.avisos(`agenda:clinica:${A}`).length === 0,
      'a dona de B não recebe nada da clínica A', JSON.stringify(cb.mensagens.slice(-5)));
    resumir('tempo-real', { entrouA, bEmA, fin, imed }, notas);
  } catch (e) {
    anotar('error', 'tempo-real: erro', descreverErro(e));
    process.exitCode = 1;
  } finally {
    for (const c of canais) c.fechar();
    try {
      await db.query('rollback').catch(() => {});
      await db.query(`delete from public.clinic_members where user_id = $1`, [FIN_A.sub]);
      await db.query('delete from auth.users where id = $1', [FIN_A.sub]);
      await limparClinicaAgenda(db, { clinica: A, dona: DONA_A.sub });
      await limparClinicaAgenda(db, { clinica: B, dona: DONA_B.sub });
    } finally {
      await db.end();
    }
  }
});
