// iMed Agenda, fase 4.2 — o fechamento da leitura direta (parte 2 da migração agenda_leitura) pela API DE VERDADE:
// HTTP no PostgREST do Supabase local, com os tokens assinados pelo segredo do banco local e os cabeçalhos do site.
// Roda no GitHub (banco.yml):
//   node tests/banco/leitura-direta.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
//   - recepção: GET appointment_requests da clínica → [] (lê por rpc/agenda_requests, que traz a lista);
//     GET clinic_blocks e clinic_schedules → recusado com 42501 (sem permissão), não uma lista vazia em silêncio;
//   - paciente com conta: GET appointment_requests?user_id=eq.<ele> → os pedidos dele;
//   - equipe do IMED: GET appointment_requests?clinic_id=is.null → os pedidos ao IMED; os da clínica → [];
//   - visitante: POST appointment_requests (Prefer: return=minimal) → 201; rpc/cancel_request com o código → "ok";
//     rpc/request_status → "cancelled";
//   - teste obrigatório 2 (balcão), a parte HTTP (arquitetura §13): a recepção marca por POST rpc/agenda_desk_book com
//     o token dela; logo depois, como visitante pela mesma API, rpc/agenda_slots e rpc/available_slots não trazem mais
//     o horário (e antes traziam).
//
// Os dados (uma clínica de teste, usuários e pedidos) são criados aqui e apagados no fim.

import { createHash, randomUUID } from 'node:crypto';
import {
  afirmar, anotar, comoUsuario, configLocal, conectar, criarClinicaAgenda, descreverErro, horaSP, limparClinicaAgenda,
  postgrest, principal, resumir, tokenUsuario,
} from './lib.mjs';

const CLINICA = 'cc000000-0000-4000-8000-0000000004c2';
const DONA = 'a5000000-0000-4000-8000-0000000004c2';
const EMAIL_DONA = 'dona.leitura.direta@exemplo.test';
const RECEPCAO = 'a5000000-0000-4000-8000-0000000014c2';
const EMAIL_RECEPCAO = 'recepcao.leitura.direta@exemplo.test';
const PACIENTE = 'a5000000-0000-4000-8000-0000000024c2';
const EMAIL_PACIENTE = 'paciente.leitura.direta@exemplo.test';
const ADMIN = 'a5000000-0000-4000-8000-0000000034c2';
const EMAIL_ADMIN = 'admin.leitura.direta@exemplo.test';
const PEDIDO_SITE = 'b5000000-0000-4000-8000-0000000004c2';
const PEDIDO_IMED = 'b5000000-0000-4000-8000-0000000014c2';
const PEDIDO_PACIENTE = 'b5000000-0000-4000-8000-0000000024c2';

const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const diaSP = (n) => new Date(Date.now() + n * 86400000 - 3 * 3600000).toISOString().slice(0, 10);

async function limpar(db) {
  await db.query('begin');
  await db.query("select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'limpeza_teste_ci', true)");
  await db.query('delete from public.appointment_requests where id = any ($1::uuid[])', [[PEDIDO_SITE, PEDIDO_IMED, PEDIDO_PACIENTE]]);
  await db.query('commit');
  await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA });
  await db.query('delete from auth.users where id = any ($1::uuid[])', [[RECEPCAO, PACIENTE, ADMIN]]);
  await db.query('delete from public.admin_emails where email = $1', [EMAIL_ADMIN]);
}

// A linha do pedido como o site manda (as 23 colunas; geo-core.js bookingRow + review_token_hash).
const linha = (id, clinica, nome, codigo, extra = {}) => ({
  id, clinic_id: clinica, place_source: clinica ? 'imed' : 'cnes', place_ref: clinica ? null : 'cnes:7654321',
  place_name: clinica ? 'Clínica da Leitura Direta do CI' : 'Laboratório da Leitura Direta', place_address: null, place_phone: null,
  exam_code: 'usg', preferred_date: diaSP(3), preferred_period: 'manha', patient_name: nome, patient_phone: '11955554444',
  patient_email: null, notes: null, consent: true, slot_start: null, for_other: false, other_name: null, relationship: null,
  other_minor: false, guardian_consent: false, other_consent: false, review_token_hash: sha256(codigo), ...extra,
});

await principal('leitura-direta', async () => {
  const cfg = configLocal();
  if (!cfg.apiUrl || !cfg.publishableKey) {
    anotar('warning', 'Sem o PostgREST local (API_URL/PUBLISHABLE_KEY): leitura-direta não rodou');
    return;
  }
  const db = await conectar(cfg.dbUrl, 'imed-leitura-direta-42');
  const notas = [];
  try {
    await limpar(db);
    const { procedimentos: P } = await criarClinicaAgenda(db, {
      clinica: CLINICA, dona: DONA, email: EMAIL_DONA, nome: 'Clínica da Leitura Direta do CI',
      recursos: [{ chave: 'usg', name: 'USG-1' }],
      procedimentos: [{ chave: 'p30', name: 'Ultrassom', duration_min: 30, grupos: [['usg']] }],
    });
    for (const [id, email] of [[RECEPCAO, EMAIL_RECEPCAO], [PACIENTE, EMAIL_PACIENTE], [ADMIN, EMAIL_ADMIN]]) {
      await db.query(`insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
                      values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(),
                              '{"provider": "email", "providers": ["email"]}', '{}', now(), now())`, [id, email]);
    }
    await db.query(`insert into public.clinic_members (clinic_id, user_id, role) values ($1, $2, 'reception')`, [CLINICA, RECEPCAO]);
    await db.query('insert into public.admin_emails (email) values ($1)', [EMAIL_ADMIN]);
    // um bloqueio e um agendamento de balcão da clínica (pelas funções, como a dona)
    const dona = { sub: DONA, email: EMAIL_DONA };
    const bloqueio = await comoUsuario(db, dona, `select public.agenda_block_add($1, null, $2, $3, 'folga', 'Reforma')`,
      [CLINICA, horaSP(20, '08:00'), horaSP(20, '12:00')]);
    const balcao = await comoUsuario(db, dona, `select public.agenda_desk_book($1, $2, $3, 'clinica_telefone')`, [CLINICA,
      JSON.stringify([{ procedure_id: P.p30, starts_at: horaSP(10, '09:00') }]),
      JSON.stringify({ name: 'Paciente do Balcão Leitura', phone: '(11) 94444-3333', consent: true })]);
    afirmar(bloqueio?.status === 'ok' && balcao?.status === 'ok', 'um bloqueio e um agendamento de balcão na clínica',
      JSON.stringify({ bloqueio, balcao }));

    const tokens = {
      recepcao: tokenUsuario(cfg, { sub: RECEPCAO, email: EMAIL_RECEPCAO }),
      paciente: tokenUsuario(cfg, { sub: PACIENTE, email: EMAIL_PACIENTE }),
      admin: tokenUsuario(cfg, { sub: ADMIN, email: EMAIL_ADMIN }),
    };
    const get = (caminho, token) => postgrest(cfg, caminho, { token, metodo: 'GET', prefer: null });

    /* ---------- Visitante e paciente: o pedido pelo site continua igual ---------- */
    const r1 = await postgrest(cfg, 'appointment_requests', { corpo: linha(PEDIDO_SITE, CLINICA, 'Visitante da Leitura Direta', 'codigo-ld-1') });
    const r2 = await postgrest(cfg, 'appointment_requests', { corpo: linha(PEDIDO_IMED, null, 'Visitante Concierge Leitura', 'codigo-ld-2') });
    const r3 = await postgrest(cfg, 'appointment_requests', {
      token: tokens.paciente, corpo: linha(PEDIDO_PACIENTE, CLINICA, 'Paciente com Conta Leitura', 'codigo-ld-3'),
    });
    afirmar(r1.status === 201 && r2.status === 201 && r3.status === 201,
      'POST appointment_requests (Prefer: return=minimal): 201 para o visitante (clínica e IMED) e para o paciente logado',
      JSON.stringify([r1, r2, r3].map((r) => `${r.status} ${r.code ?? ''} ${r.message ?? ''}`)));

    /* ---------- Recepção ---------- */
    const lista = await get(`appointment_requests?select=id,patient_phone&clinic_id=eq.${CLINICA}`, tokens.recepcao);
    afirmar(lista.status === 200 && Array.isArray(lista.json) && lista.json.length === 0,
      'recepção: GET appointment_requests da clínica → [] (a leitura direta fechou)', `HTTP ${lista.status}: ${JSON.stringify(lista.json)?.slice(0, 200)}`);
    for (const tabela of ['clinic_blocks', 'clinic_schedules']) {
      const r = await get(`${tabela}?select=*&clinic_id=eq.${CLINICA}`, tokens.recepcao);
      afirmar([401, 403].includes(r.status) && r.code === '42501',
        `recepção: GET ${tabela} → recusado com 42501 (sem permissão), não uma lista vazia`, `HTTP ${r.status}: ${r.code} ${r.message}`);
    }
    const pela = await postgrest(cfg, 'rpc/agenda_requests', { token: tokens.recepcao, prefer: null, corpo: { p_clinic: CLINICA } });
    const ids = (pela.json?.requests || []).map((x) => x.id);
    afirmar(pela.status === 200 && pela.json?.status === 'ok' && ids.includes(PEDIDO_SITE) && ids.includes(PEDIDO_PACIENTE) && ids.includes(balcao.id),
      'recepção: POST rpc/agenda_requests → os pedidos da clínica (site, paciente e balcão)', `HTTP ${pela.status}: ${JSON.stringify(pela.json)?.slice(0, 300)}`);
    const blocos = await postgrest(cfg, 'rpc/agenda_blocks', { token: tokens.recepcao, prefer: null, corpo: { p_clinic: CLINICA } });
    afirmar(blocos.status === 200 && blocos.json?.blocks?.length === 1 && blocos.json.blocks[0].reason === 'Reforma',
      'recepção: POST rpc/agenda_blocks → o bloqueio, com o motivo', `HTTP ${blocos.status}: ${JSON.stringify(blocos.json)?.slice(0, 300)}`);
    const { rows: [log] } = await db.query(`select count(*)::int as n from agenda.access_log where user_id = $1 and fn = 'agenda_requests'`, [RECEPCAO]);
    afirmar(log.n === 1, 'a leitura da lista pela função fica no access_log', `linhas: ${log.n}`);

    /* ---------- Teste obrigatório 2 (balcão), pela API: a recepção marca e o visitante não vê mais o horário ---------- */
    {
      const dia = diaSP(12);
      const alvo = horaSP(12, '10:00');
      const mais = horaSP(12, '11:00');
      const iso = (x) => new Date(x).toISOString();
      // como o site do paciente: visitante, só com a chave publishable (sem token)
      const livres = async () => {
        const s = await postgrest(cfg, 'rpc/agenda_slots', { prefer: null, corpo: { p_clinic: CLINICA, p_procedure: P.p30, p_from: dia, p_to: dia } });
        const a = await postgrest(cfg, 'rpc/available_slots', { prefer: null, corpo: { p_clinic: CLINICA, p_exam: 'usg', p_from: dia, p_days: 1 } });
        return {
          http: [s.status, a.status],
          slots: Array.isArray(s.json) ? s.json.map((x) => iso(x.slot_start)) : null,
          available: Array.isArray(a.json) ? a.json.map((x) => iso(x.slot_start)) : null,
        };
      };
      const antes = await livres();
      afirmar(antes.http.every((h) => h === 200) && antes.slots?.includes(alvo) && antes.available?.includes(alvo),
        'teste 2 (balcão): antes, o visitante vê o horário pela API (rpc/agenda_slots e rpc/available_slots)',
        JSON.stringify({ alvo, http: antes.http, slots: antes.slots?.length, available: antes.available?.length }));
      const marcou = await postgrest(cfg, 'rpc/agenda_desk_book', {
        token: tokens.recepcao, prefer: null, corpo: {
          p_clinic: CLINICA, p_items: [{ procedure_id: P.p30, starts_at: alvo }],
          p_patient: { name: 'Paciente do Balcão pela API', phone: '(11) 93333-2222', consent: true },
          p_channel: 'clinica_balcao', p_key: randomUUID(),
        },
      });
      afirmar(marcou.status === 200 && marcou.json?.status === 'ok' && !!marcou.json?.id,
        'teste 2 (balcão): a recepção marca pela API (POST rpc/agenda_desk_book com o token dela)',
        `HTTP ${marcou.status}: ${marcou.code ?? ''} ${JSON.stringify(marcou.json)?.slice(0, 300)}`);
      const depois = await livres();
      afirmar(depois.http.every((h) => h === 200) && !!depois.slots && !depois.slots.includes(alvo)
        && !!depois.available && !depois.available.includes(alvo),
        'teste 2 (balcão): logo depois, como visitante pela API, agenda_slots e available_slots não trazem o horário',
        JSON.stringify({ alvo, http: depois.http, agenda_slots: depois.slots?.includes(alvo), available_slots: depois.available?.includes(alvo) }));
      afirmar(!!depois.slots?.includes(mais) && !!depois.available?.includes(mais),
        'teste 2 (balcão): os outros horários do dia continuam oferecidos (o motor não sumiu com tudo)', JSON.stringify({ mais }));
      notas.push(`Teste 2 (balcão) pela API: a recepção marcou ${alvo} por rpc/agenda_desk_book; o visitante deixou de ver esse horário em agenda_slots e available_slots.`);
    }

    /* ---------- Paciente com conta ---------- */
    const meus = await get(`appointment_requests?select=id,status&user_id=eq.${PACIENTE}`, tokens.paciente);
    afirmar(meus.status === 200 && meus.json?.length === 1 && meus.json[0].id === PEDIDO_PACIENTE,
      'paciente: GET appointment_requests?user_id=eq.<ele> → o pedido dele', `HTTP ${meus.status}: ${JSON.stringify(meus.json)}`);
    const tudo = await get('appointment_requests?select=*', tokens.paciente);
    afirmar(tudo.status === 200 && tudo.json?.length === 1, 'paciente: "Baixar meus dados" (select=*) traz só o dele', `HTTP ${tudo.status}; ${tudo.json?.length}`);

    /* ---------- Equipe do IMED ---------- */
    const imed = await get('appointment_requests?select=id&clinic_id=is.null', tokens.admin);
    afirmar(imed.status === 200 && (imed.json || []).some((x) => x.id === PEDIDO_IMED),
      'equipe do IMED: GET appointment_requests?clinic_id=is.null → os pedidos ao IMED', `HTTP ${imed.status}: ${JSON.stringify(imed.json)?.slice(0, 200)}`);
    const daClinica = await get(`appointment_requests?select=id&clinic_id=eq.${CLINICA}`, tokens.admin);
    afirmar(daClinica.status === 200 && daClinica.json?.length === 0,
      'equipe do IMED: os pedidos da clínica não vêm pela leitura direta', `HTTP ${daClinica.status}: ${JSON.stringify(daClinica.json)?.slice(0, 200)}`);
    const motivo = await postgrest(cfg, 'rpc/agenda_requests', { token: tokens.admin, prefer: null, corpo: { p_clinic: CLINICA } });
    const comMotivo = await postgrest(cfg, 'rpc/agenda_requests', {
      token: tokens.admin, prefer: null, corpo: { p_clinic: CLINICA, p_justification: 'suporte_clinica' },
    });
    afirmar(motivo.json?.status === 'justification_required' && comMotivo.json?.status === 'ok' && comMotivo.json.requests.length >= 3,
      'equipe do IMED: pela função, só com o motivo (fica registrado)', JSON.stringify({ sem: motivo.json?.status, com: comMotivo.json?.status }));

    /* ---------- Visitante: cancela e acompanha pelo código ---------- */
    const cancela = await postgrest(cfg, 'rpc/cancel_request', { prefer: null, corpo: { p_id: PEDIDO_SITE, p_token: 'codigo-ld-1' } });
    const situacao = await postgrest(cfg, 'rpc/request_status', { prefer: null, corpo: { p_ids: [PEDIDO_SITE], p_tokens: ['codigo-ld-1'] } });
    afirmar(cancela.status === 200 && cancela.json === 'ok' && situacao.json?.[0]?.status === 'cancelled',
      'visitante: rpc/cancel_request com o código → "ok"; rpc/request_status → cancelled',
      JSON.stringify({ cancela: [cancela.status, cancela.json], situacao: situacao.json }));
    notas.push('Leitura direta fechada para a clínica (pedidos [], bloqueios e horários 42501); paciente, visitante e "Pedidos ao IMED" iguais.');
    resumir('leitura-direta', {}, notas);
  } finally {
    await limpar(db).catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (leitura-direta)', descreverErro(e)));
    await db.end();
  }
});

