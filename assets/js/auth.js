// Conta no IMED (pacientes e clínicas): login por link mágico enviado por e-mail, pelo Supabase Auth.
// Sem biblioteca: fala direto com a API REST do Supabase. A sessão fica no localStorage deste navegador.
const C = window.IMED_CONFIG;
const KEY = 'imed_session';

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const write = (s) => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* sem armazenamento */ } };

async function call(path, { method = 'GET', body, token, headers = {}, timeout = 15000 } = {}) {
  const res = await fetch(C.supabaseUrl + path, {
    method,
    headers: { apikey: C.supabaseAnonKey, Authorization: `Bearer ${token || C.supabaseAnonKey}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error((data && (data.msg || data.message || data.error_description || data.error)) || `http ${res.status}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

function store(t) {
  const s = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Math.floor(Date.now() / 1000) + Number(t.expires_in || 3600), user: t.user ? { id: t.user.id, email: t.user.email } : null };
  write(s);
  return s;
}

// Sessão atual (ou null). Não confere a validade; use token() antes de chamar o banco.
export const session = () => read();
export const user = () => read()?.user ?? null;

// Manda o link de entrada para o e-mail. Ao clicar, a pessoa volta para `back` (padrão: esta página).
export async function signIn(email, back = location.href.split('#')[0]) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw Object.assign(new Error('E-mail inválido'), { code: 'invalid_email' });
  await call(`/auth/v1/otp?redirect_to=${encodeURIComponent(back)}`, { method: 'POST', body: { email: e, create_user: true } });
}

// Ao voltar do link do e-mail, a sessão vem no endereço (#access_token=...). Guarda e limpa o endereço.
// Devolve 'ok', 'error' (com a mensagem em .message) ou null quando não há nada para tratar.
export async function handleRedirect() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has('access_token') && !h.has('error') && !h.has('error_description')) return null;
  history.replaceState(history.state, '', location.pathname + location.search);
  if (!h.has('access_token')) return { status: 'error', message: h.get('error_description') || 'O link expirou ou já foi usado. Peça outro.' };
  const t = { access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_in: h.get('expires_in') };
  try {
    const u = await call('/auth/v1/user', { token: t.access_token });
    store({ ...t, user: u });
    return { status: 'ok' };
  } catch {
    return { status: 'error', message: 'Não foi possível confirmar a entrada. Peça outro link.' };
  }
}

// Token válido do usuário (renova se estiver para vencer) ou null se não estiver logado.
export async function token() {
  const s = read();
  if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  try {
    const t = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } });
    return store({ ...t, user: t.user || s.user }).access_token;
  } catch (err) {
    if (err.status === 400 || err.status === 401) write(null);
    return null;
  }
}

export async function signOut() {
  const s = read();
  write(null);
  if (s) await call('/auth/v1/logout', { method: 'POST', token: s.access_token }).catch(() => {});
}

// Chamadas ao banco com a conta (quando logado) ou com a chave pública.
export async function rpc(fn, args = {}) {
  return call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args, token: await token() });
}
export async function select(path) {
  return call(`/rest/v1/${path}`, { token: await token() });
}
export async function insert(table, row) {
  return call(`/rest/v1/${table}`, { method: 'POST', body: row, token: await token(), headers: { Prefer: 'return=minimal' } });
}
