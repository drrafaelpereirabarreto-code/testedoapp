// iMed Agenda, fase 3.1 — o que NÃO vem das migrações e precisa ser igual na produção, conferido no Supabase local do
// GitHub (banco.yml):
//   node tests/banco/fora-das-migracoes.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
// 1. "Confirm email" ligado no Auth (GET /auth/v1/settings: mailer_autoconfirm = false). Na produção é a pendência do
//    dono "manter Confirm email ligado": sem ela, dá para criar conta com o e-mail de outra pessoa (o is_imed_admin e o
//    imed_has exigem e-mail confirmado e sessão pelo link, mas a regra de base é essa).
// 2. Schemas expostos pela API (PostgREST): só public e graphql_public. agenda, private, net, auth e cron têm de ser
//    recusados (PGRST106) — é o que mantém o schema agenda e o net (pg_net) fora da API (000_catalogo, pendência do net).
// 3. Tempo-limite das chamadas por papel (anon 3 s, authenticated 8 s; a guarda do 000_catalogo reprova se mudar):
//    aqui só aparece no resumo, com o do authenticator.
// Valores da produção conferidos em 31/10/2026: tempos-limite por SELECT (conector). "Confirm email" e os schemas
// expostos não aparecem no banco: na produção, conferir no painel do Supabase (Authentication → Sign In / Providers →
// Email: "Confirm email"; Settings → API → Exposed schemas) ou pelo mesmo GET público que este script faz aqui.
// Não grava nada.

import { afirmar, configLocal, conectar, principal, resumir, tokenAnon } from './lib.mjs';

await principal('fora-das-migracoes', async () => {
  const cfg = configLocal();
  const notas = [];
  if (!cfg.apiUrl || !cfg.anonKey) throw new Error('Sem o endereço da API local ou a chave anon (supabase status)');

  // 1. Confirm email
  {
    const r = await fetch(`${cfg.apiUrl}/auth/v1/settings`, { headers: { apikey: cfg.anonKey } });
    let j = null;
    try { j = await r.json(); } catch { /* sem JSON */ }
    afirmar(r.ok && j?.mailer_autoconfirm === false,
      '"Confirm email" ligado no Auth (mailer_autoconfirm = false), como na produção',
      `HTTP ${r.status}: ${JSON.stringify(j)?.slice(0, 300)}`);
    notas.push(`Auth: mailer_autoconfirm = ${j?.mailer_autoconfirm} (Confirm email ${j?.mailer_autoconfirm === false ? 'ligado' : 'DESLIGADO'}); `
      + `cadastro ${j?.disable_signup ? 'fechado' : 'aberto'}; login anônimo ${j?.external?.anonymous_users ? 'ligado' : 'desligado'}`);
  }

  // 2. Schemas expostos
  {
    const token = tokenAnon(cfg);
    const recusas = [];
    const abertos = [];
    let permitidos = '';
    for (const schema of ['agenda', 'private', 'net', 'auth', 'cron']) {
      const r = await fetch(`${cfg.apiUrl}/rest/v1/qualquer_tabela?select=*&limit=1`, {
        headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}`, 'Accept-Profile': schema },
      });
      let j = null;
      try { j = await r.json(); } catch { /* sem JSON */ }
      if (j?.code === 'PGRST106') {
        recusas.push(schema);
        // A lista vem na mensagem ("...one of the following: public, graphql_public") ou na dica ("Only the following
        // schemas are exposed: ..."), conforme a versão do PostgREST.
        const texto = [j.message, j.hint, j.details].filter(Boolean).join(' | ');
        const m = texto.match(/following[^:]*:\s*([a-z0-9_]+(?:\s*,\s*[a-z0-9_]+)*)/i);
        permitidos = m ? m[1].split(',').map((x) => x.trim()).sort().join(', ') : texto.slice(0, 200);
      } else {
        abertos.push(`${schema} (HTTP ${r.status} ${j?.code ?? ''})`);
      }
    }
    afirmar(abertos.length === 0, 'a API (PostgREST) recusa os schemas agenda, private, net, auth e cron (PGRST106)',
      `aceitos: ${abertos.join(', ')}`);
    afirmar(permitidos === 'graphql_public, public', 'a API expõe só public e graphql_public, como na produção',
      `schemas expostos: ${permitidos || '(sem a lista)'}`);
    notas.push(`PostgREST: expõe ${permitidos || '?'}; recusa ${recusas.join(', ') || 'nenhum'}`);
  }

  // 3. Tempos-limite por papel (só leitura do catálogo)
  {
    const db = await conectar(cfg.dbUrl, 'imed-fora-das-migracoes');
    try {
      const { rows } = await db.query(
        `select r.rolname, coalesce(array_to_string(s.setconfig, ' '), '-') as cfg
           from pg_roles r left join pg_db_role_setting s on s.setrole = r.oid and s.setdatabase = 0
          where r.rolname in ('anon', 'authenticated', 'authenticator') order by 1`);
      notas.push(`papéis: ${rows.map((x) => `${x.rolname} ${x.cfg}`).join('; ')}`);
    } finally {
      await db.end();
    }
  }

  resumir('fora-das-migracoes', {}, notas);
});
