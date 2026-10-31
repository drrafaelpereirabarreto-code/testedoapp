// Regra das chaves do Supabase nos testes de ponta a ponta (fase 0.1 do iMed Agenda: as chaves antigas "anon" e
// "service_role" param no fim de 2026; o site usa a chave publishable nova).
// Toda chamada do site ao Supabase (banco, funções do banco, login e a função do servidor) leva a chave publishable
// do site (assets/js/config.js) só no cabeçalho "apikey". "Authorization: Bearer" vai só com o token de quem entrou
// na conta (nos testes, sempre "tok-..."). A chave nunca vai em Bearer: o Supabase tenta lê-la como token e recusa
// ("Invalid JWT"). Visitante não manda Authorization.
// Uso num teste e2e (não é um teste: o nome não começa com "e2e-"):
//   const browser = vigiarChaves(await chromium.launch());   todo contexto aberto depois disso é vigiado
//   await comChaves(fn)                                        roda o cenário e o reprova se alguma chamada fugiu da regra
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

export const PUBLISHABLE = readFileSync(new URL('../assets/js/config.js', import.meta.url), 'utf8').match(/supabaseKey:\s*'([^']+)'/)[1];
const SUPABASE = 'https://pyoqiecupxhdzigjudyd.supabase.co/';
const problemas = [];

// Confere cada chamada ao Supabase feita pelas páginas deste contexto (a pré-checagem OPTIONS não leva cabeçalhos).
export function vigiarContexto(context) {
  context.on('request', (req) => {
    if (!req.url().startsWith(SUPABASE) || req.method() === 'OPTIONS') return;
    const h = req.headers();
    const onde = `${req.method()} ${new URL(req.url()).pathname}`;
    if (h.apikey !== PUBLISHABLE) problemas.push(`${onde}: apikey ${h.apikey ? 'diferente da chave publishable' : 'ausente'}`);
    if (h.authorization !== undefined && !/^Bearer tok-/.test(h.authorization)) {
      problemas.push(`${onde}: Authorization "${h.authorization.slice(0, 40)}" (só o token de quem entrou na conta)`);
    }
  });
  return context;
}

// Todo contexto novo deste navegador passa a ser vigiado.
export function vigiarChaves(browser) {
  const abrir = browser.newContext.bind(browser);
  browser.newContext = async (...args) => vigiarContexto(await abrir(...args));
  return browser;
}

// Roda um cenário e, no fim, reprova se alguma chamada ao Supabase fugiu da regra.
export async function comChaves(fn) {
  problemas.length = 0;
  await fn();
  assert.deepEqual([...new Set(problemas)], [], 'chaves do Supabase: só a publishable no apikey; Authorization só com o token de quem entrou na conta');
}
