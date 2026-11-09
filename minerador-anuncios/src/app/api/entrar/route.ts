import { NextResponse } from "next/server";
import { COOKIE, VALIDADE_SEGUNDOS, criarSessao, senhaCorreta } from "@/lib/sessao";

export async function POST(req: Request) {
  const form = await req.formData();
  const senha = String(form.get("senha") ?? "");
  let volta = String(form.get("volta") ?? "/");
  // Só aceita voltar para uma página deste site.
  if (!volta.startsWith("/") || volta.startsWith("//")) volta = "/";

  if (!(await senhaCorreta(senha))) {
    // Espera um pouco para dificultar quem tenta adivinhar a senha.
    await new Promise((r) => setTimeout(r, 1200));
    return NextResponse.redirect(new URL(`/entrar?erro=1&volta=${encodeURIComponent(volta)}`, req.url), 303);
  }
  const res = NextResponse.redirect(new URL(volta, req.url), 303);
  res.cookies.set(COOKIE, await criarSessao(), {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(req.url).protocol === "https:",
    path: "/",
    maxAge: VALIDADE_SEGUNDOS,
  });
  return res;
}
