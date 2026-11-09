// Porteiro do site: quem não entrou com a senha vai para /entrar.
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, sessaoValida } from "@/lib/sessao";

const LIVRES = ["/entrar", "/api/entrar", "/api/cron"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (LIVRES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (await sessaoValida(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ erro: "Faça login." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/entrar";
  url.search = pathname === "/" ? "" : `?volta=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
