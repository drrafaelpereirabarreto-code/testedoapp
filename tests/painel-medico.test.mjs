// Testes do contrato do painel do médico (tele_painel_medico) e da chave "agora" da gestão (admin_gestao), lendo como
// texto a migração supabase/migrations/*_painel_medico.sql (o banco de verdade não é acessado): as chaves que o banco
// manda são as que o site lê (assets/js/medico.js e assets/js/gestao-core.js), as regras de tempo são as mesmas da
// fila e dos documentos (2 h na fila, 3 h de consulta, 7 dias para assinar), nenhum dado de paciente é lido, as
// funções rodam como dono do banco com o search_path vazio, visitante sem conta não chama, a gestão só ganha a chave
// "agora" e a migração não apaga nem muda nenhuma linha.
// Rodar com: node --test tests/painel-medico.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { AGORA_KEYS } from '../assets/js/gestao-core.js';

// A migração ganha o número da versão aplicada no banco (o nome do arquivo muda): procura pelo fim do nome.
const MIG_DIR = new URL('../supabase/migrations/', import.meta.url);
const mig = (fim) => readFileSync(new URL(readdirSync(MIG_DIR).find((f) => f.endsWith(fim)), MIG_DIR), 'utf8');
const SQL = mig('_painel_medico.sql');
const TELE_SQL = mig('_teleconsulta.sql');
const DOCS_SQL = mig('_tele_documentos.sql');
const GESTAO_SQL = mig('_gestao.sql');
const MEDICO_JS = readFileSync(new URL('../assets/js/medico.js', import.meta.url), 'utf8');

// O que o banco roda: o texto sem os comentários (de -- até o fim da linha, e /* ... */).
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const CODE = semComentarios(SQL);
// Uma função do arquivo: os parâmetros, o cabeçalho (até o "as $$") e o corpo (entre os $$).
function fn(sql, nome) {
  const re = new RegExp(`create or replace function ${nome.replace(/\./g, '\\.')}\\(([^)]*)\\)([\\s\\S]*?)\\bas \\$\\$([\\s\\S]*?)\\$\\$;`);
  const m = re.exec(semComentarios(sql));
  assert.ok(m, `função ${nome} no arquivo`);
  return { args: m[1], head: m[2], body: m[3] };
}
// Chaves do jsonb montado no corpo (jsonb_build_object com uma chave por linha: 'chave', valor).
const chaves = (body) => [...body.matchAll(/^\s*'([a-z_]+)',/gm)].map((m) => m[1]);
// Chaves do exemplo do contrato no topo do arquivo ("chave": valor).
const chavesExemplo = (s) => [...s.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]).sort();
const PAINEL = ['aguardando', 'atendidos_hoje', 'atualizado_em', 'documentos_para_assinar', 'em_atendimento', 'espera_mais_longa_min', 'medicos_disponiveis'];

test('arquivo: um só, com o número da versão do banco antes do nome', () => {
  const nomes = readdirSync(MIG_DIR).filter((f) => f.endsWith('_painel_medico.sql'));
  assert.equal(nomes.length, 1, nomes.join(', '));
  assert.match(nomes[0], /^\d{14}_painel_medico\.sql$/);
  assert.ok(nomes[0] > readdirSync(MIG_DIR).find((f) => f.endsWith('_gestao.sql')), 'depois da migração da gestão');
});

test('painel do médico: as 7 chaves do contrato são as que a página do médico lê (nada além delas)', () => {
  const agora = fn(SQL, 'private.tele_agora');
  const painel = fn(SQL, 'public.tele_painel_medico');
  assert.deepEqual([...chaves(agora.body), ...chaves(painel.body)].sort(), PAINEL);
  assert.match(painel.body, /return private\.tele_agora\(v_doc\.id\) \|\| jsonb_build_object\(/, 'a conta de agora (só as consultas dele) e mais as 3 chaves do painel');
  // A página do médico lê as 5 contagens de NUM_KEYS, a espera e a hora: as mesmas 7.
  const num = /const NUM_KEYS = \[([^\]]*)\]/.exec(MEDICO_JS);
  assert.ok(num, 'NUM_KEYS em assets/js/medico.js');
  assert.ok(MEDICO_JS.includes('r.espera_mais_longa_min') && MEDICO_JS.includes('r.atualizado_em'), 'a página lê a espera e a hora');
  assert.deepEqual([...[...num[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), 'espera_mais_longa_min', 'atualizado_em'].sort(), PAINEL);
  // O exemplo do contrato no topo do arquivo também.
  assert.deepEqual(chavesExemplo(/rpc\/tele_painel_medico[^\n]*\n--\s*(\{[\s\S]*?\})/.exec(SQL)[1]), PAINEL);
});

test('gestão: a chave "agora" tem as 4 contagens que a página de gestão lê, com a mesma conta do painel do médico', () => {
  const agora = fn(SQL, 'private.tele_agora');
  assert.deepEqual(chaves(agora.body).sort(), [...AGORA_KEYS].sort());
  assert.ok(fn(SQL, 'public.admin_gestao').body.includes("'agora', private.tele_agora(null::uuid)"), 'na gestão, as consultas de todos os médicos');
  assert.deepEqual(chavesExemplo(/"agora": (\{[^}]*\})/.exec(SQL)[1]), [...AGORA_KEYS].sort());
});

test('gestão: igual à da migração da gestão, com a mesma assinatura, só com a chave "agora" a mais', () => {
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const antiga = fn(GESTAO_SQL, 'public.admin_gestao');
  const nova = fn(SQL, 'public.admin_gestao');
  assert.equal(norm(nova.args), 'p_days integer default 30');
  assert.equal(norm(nova.args), norm(antiga.args));
  assert.equal(norm(nova.head), norm(antiga.head));
  assert.equal(norm(nova.body).replace(", 'agora', private.tele_agora(null::uuid))", ')'), norm(antiga.body));
});

test('regras de tempo iguais às da fila e dos documentos: 2 h na fila, 30 min para começar, 3 h de consulta, 7 dias para assinar', () => {
  const agora = fn(SQL, 'private.tele_agora').body;
  const painel = fn(SQL, 'public.tele_painel_medico').body;
  const fila = fn(TELE_SQL, 'public.tele_queue').body;
  const efetiva = fn(TELE_SQL, 'private.tele_effective_status').body;
  assert.ok(efetiva.includes("p_status = 'waiting' and p_created < now() - interval '2 hours'"));
  assert.ok(efetiva.includes("p_accepted < now() - interval '30 minutes'"));
  assert.ok(efetiva.includes("p_started < now() - interval '3 hours'"));
  // Aguardando: a fila de tele_queue (situação waiting, pedido há no máximo 2 h).
  const naFila = "t.status = 'waiting' and t.created_at >= now() - interval '2 hours'";
  assert.ok(fila.includes(naFila) && agora.includes(naFila));
  // Em atendimento: aceita ou em chamada, pela situação de fato (30 min para começar e 3 h de consulta), como tele_queue.
  const emAtendimento = "private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at) in ('accepted', 'in_call')";
  assert.ok(fila.includes(`t.status in ('accepted', 'in_call')\n           and ${emAtendimento}`));
  assert.ok(agora.includes("where t.status in ('accepted', 'in_call')") && agora.replace(/\s+/g, ' ').includes(emAtendimento));
  // Atendidos hoje: o fim é o que vem primeiro (o gravado ou 3 h depois do começo). Com coalesce, a consulta que passou
  // de 3 h perto da meia-noite contaria em dois dias (antes e depois de a limpeza automática gravar o fim).
  assert.equal(painel.split("least(t.ended_at, t.started_at + interval '3 hours')").length - 1, 2);
  assert.ok(!painel.includes('coalesce(t.ended_at'));
  assert.ok(painel.includes("and t.started_at is not null"), 'só as que começaram');
  assert.ok(painel.includes("t.created_at >= v_ini - interval '1 day'"), 'só as pedidas desde 24 h antes de hoje (do pedido ao fim: no máximo 5 h 30)');
  // Documentos para assinar: a lista de tele_doc_pending sem as que passaram do prazo de 7 dias (expired).
  const pend = fn(DOCS_SQL, 'public.tele_doc_pending').body;
  const falta = "d.doctor_id = v_doc.id and d.status = 'emitido' and d.signed_at is null";
  assert.ok(pend.includes(falta) && painel.includes(falta));
  assert.ok(pend.includes("d.created_at < now() - interval '7 days'") && painel.includes("d.created_at >= v_now - interval '7 days'"));
  // Médicos disponíveis: a regra de tele_doctors_online (sem o limite de 50 da lista).
  const disponivel = "d.status = 'approved' and d.available_until > now()";
  assert.ok(fn(TELE_SQL, 'public.tele_doctors_online').body.includes(disponivel) && agora.includes(disponivel));
  // Hoje é o dia de São Paulo.
  assert.ok(painel.includes("v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;"));
});

test('LGPD: o painel e a conta de agora não leem nenhum dado de paciente (só contagens e minutos)', () => {
  for (const nome of ['private.tele_agora', 'public.tele_painel_medico']) {
    assert.doesNotMatch(fn(SQL, nome).body, /patient|reason|requester|relationship|token|notes|guidance|exams|cpf|phone|birth|snapshot/i, nome);
  }
});

test('segurança: só médico aprovado e admin, como dono do banco com o search_path vazio; visitante sem conta não chama', () => {
  for (const nome of ['public.tele_painel_medico', 'public.admin_gestao']) {
    const { head } = fn(SQL, nome);
    assert.match(head, /\bsecurity definer\b/, `${nome}: security definer`);
    assert.match(head, /\bset search_path = ''/, `${nome}: search_path vazio`);
    assert.match(head, /\bstable\b/, `${nome}: só lê`);
  }
  const agora = fn(SQL, 'private.tele_agora').head;
  assert.match(agora, /\bset search_path = ''/);
  assert.doesNotMatch(agora, /security definer/, 'a conta interna roda com o dono das duas funções que a chamam');
  // Médico aprovado, com os mesmos erros da fila (P0001 sem_login, sem_cadastro, nao_aprovado); admin, senão 42501.
  assert.ok(fn(TELE_SQL, 'public.tele_queue').body.includes('v_doc := private.tele_me(true);'));
  assert.ok(fn(SQL, 'public.tele_painel_medico').body.includes('v_doc := private.tele_me(true);'));
  assert.match(fn(SQL, 'public.admin_gestao').body, /if not coalesce\(public\.is_imed_admin\(\), false\) then\s+raise exception 'forbidden' using errcode = '42501';/);
  // Permissões: visitante sem conta (anon) e PUBLIC não chamam; a conta interna não é liberada para ninguém.
  for (const linha of [
    'revoke all on function private.tele_agora(uuid) from public, anon, authenticated;',
    'revoke all on function public.tele_painel_medico() from public, anon;',
    'grant execute on function public.tele_painel_medico() to authenticated;',
    'revoke all on function public.admin_gestao(integer) from public, anon;',
    'grant execute on function public.admin_gestao(integer) to authenticated;',
  ]) assert.ok(CODE.includes(linha), linha);
  assert.doesNotMatch(CODE, /\bgrant\b[^;]*\bto\b[^;]*\b(anon|public)\b/i);
  assert.doesNotMatch(CODE, /\bgrant\b[^;]*private\.tele_agora/i);
});

test('a migração não apaga nem muda nenhuma linha e pode rodar de novo', () => {
  assert.doesNotMatch(CODE, /\b(drop|delete|truncate|update|insert|alter)\b/i);
  assert.doesNotMatch(CODE, /\bcreate\s+(function|table|index|trigger|policy|view)\b/i, 'função com "or replace"');
  assert.equal(CODE.match(/\bcreate or replace function\b/g).length, 3);
});
