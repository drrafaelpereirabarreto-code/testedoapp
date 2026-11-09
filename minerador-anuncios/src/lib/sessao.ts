// Login com senha. Uma pessoa (SENHA_ACESSO) ou várias (USUARIOS=rafael:senha1,esposa:senha2).
// O "crachá" (cookie) guarda o nome de quem entrou, é assinado com SESSAO_SEGREDO e vale 30 dias.
// Usa só Web Crypto, que funciona tanto no servidor quanto no "proxy" do Next.

export const COOKIE = "minerador_sessao";
export const VALIDADE_SEGUNDOS = 30 * 24 * 3600;

/** Lista de pessoas que podem entrar: nome → senha. */
export function usuarios(): Map<string, string> {
  const m = new Map<string, string>();
  for (const par of (process.env.USUARIOS ?? "").split(",")) {
    const i = par.indexOf(":");
    if (i <= 0) continue;
    const nome = par.slice(0, i).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const senha = par.slice(i + 1).trim();
    if (nome && senha) m.set(nome, senha);
  }
  if (m.size === 0 && process.env.SENHA_ACESSO) m.set("eu", process.env.SENHA_ACESSO);
  return m;
}

export function variosUsuarios(): boolean {
  return usuarios().size > 1;
}

function segredo(): string {
  const s = process.env.SESSAO_SEGREDO?.trim();
  if (s && s.length >= 16) return s;
  // Sem segredo próprio, usa as senhas como base (funciona, mas o ideal é definir SESSAO_SEGREDO).
  return `minerador:${process.env.SENHA_ACESSO ?? ""}:${process.env.USUARIOS ?? ""}`;
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function assinar(texto: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(texto)));
}

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function criarSessao(usuario: string): Promise<string> {
  const expira = Math.floor(Date.now() / 1000) + VALIDADE_SEGUNDOS;
  const corpo = `${usuario}.${expira}`;
  return `${corpo}.${await assinar(corpo)}`;
}

/** Devolve o nome de quem está logado, ou null. */
export async function lerSessao(valor: string | undefined | null): Promise<string | null> {
  if (!valor) return null;
  const partes = valor.split(".");
  if (partes.length !== 3) return null;
  const [usuario, expira, assinatura] = partes;
  if (!/^\d+$/.test(expira) || Number(expira) < Date.now() / 1000) return null;
  if (!usuarios().has(usuario)) return null; // pessoa removida da lista perde o acesso
  return iguais(assinatura, await assinar(`${usuario}.${expira}`)) ? usuario : null;
}

export async function sessaoValida(valor: string | undefined | null): Promise<boolean> {
  return (await lerSessao(valor)) !== null;
}

/** Confere a senha. Com uma pessoa só, basta a senha; com várias, o nome escolhido também. */
export async function conferirSenha(nome: string, tentativa: string): Promise<string | null> {
  const lista = usuarios();
  if (lista.size === 0) return null;
  const quem = lista.size === 1 ? [...lista.keys()][0] : nome.trim().toLowerCase();
  const senha = lista.get(quem);
  // Compara as assinaturas, para levar o mesmo tempo com senha certa ou errada.
  const ok = iguais(await assinar(`senha:${tentativa}`), await assinar(`senha:${senha ?? "\u0000sem-usuario"}`));
  return ok && senha ? quem : null;
}
