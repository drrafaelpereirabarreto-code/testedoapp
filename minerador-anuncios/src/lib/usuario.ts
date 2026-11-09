// Quem está usando o site agora (lido do cookie de login).
import { cookies } from "next/headers";
import { COOKIE, lerSessao } from "./sessao";

export async function usuarioAtual(): Promise<string> {
  const c = await cookies();
  return (await lerSessao(c.get(COOKIE)?.value)) ?? "eu";
}

export function nomeBonito(u: string): string {
  return u === "eu" ? "Você" : u.charAt(0).toUpperCase() + u.slice(1);
}
