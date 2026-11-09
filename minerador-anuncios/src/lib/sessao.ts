// Login simples com senha. O "crachá" (cookie) é assinado com SESSAO_SEGREDO e vale 30 dias.
// Usa só Web Crypto, que funciona tanto no servidor quanto no "proxy" do Next.

export const COOKIE = "minerador_sessao";
export const VALIDADE_SEGUNDOS = 30 * 24 * 3600;

function segredo(): string {
  const s = process.env.SESSAO_SEGREDO?.trim();
  if (s && s.length >= 16) return s;
  // Sem segredo próprio, usa a senha como base (funciona, mas o ideal é definir SESSAO_SEGREDO).
  return `minerador:${process.env.SENHA_ACESSO ?? ""}`;
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

export async function criarSessao(): Promise<string> {
  const expira = Math.floor(Date.now() / 1000) + VALIDADE_SEGUNDOS;
  return `${expira}.${await assinar(String(expira))}`;
}

export async function sessaoValida(valor: string | undefined | null): Promise<boolean> {
  if (!valor || !process.env.SENHA_ACESSO) return false;
  const [expira, assinatura] = valor.split(".");
  if (!expira || !assinatura || !/^\d+$/.test(expira)) return false;
  if (Number(expira) < Date.now() / 1000) return false;
  return iguais(assinatura, await assinar(expira));
}

export async function senhaCorreta(tentativa: string): Promise<boolean> {
  const senha = process.env.SENHA_ACESSO ?? "";
  if (!senha) return false;
  // Compara as assinaturas, para levar o mesmo tempo com senha certa ou errada.
  return iguais(await assinar(`senha:${tentativa}`), await assinar(`senha:${senha}`));
}
