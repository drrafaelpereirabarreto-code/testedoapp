import { NextResponse } from "next/server";
import { executar } from "@/lib/db";

export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => ({}))) as { id?: string; acao?: string; nota?: string };
  const id = String(corpo.id ?? "");
  if (!/^[\w-]{1,64}$/.test(id)) return NextResponse.json({ erro: "Anúncio inválido." }, { status: 400 });
  if (corpo.acao === "remover") {
    await executar("DELETE FROM favoritos WHERE anuncio_id = ?", [id]);
    return NextResponse.json({ ok: true });
  }
  const agora = new Date().toISOString();
  await executar(
    `INSERT INTO favoritos (anuncio_id, nota, criado_em, atualizado_em) VALUES (?, ?, ?, ?)
     ON CONFLICT (anuncio_id) DO UPDATE SET nota = excluded.nota, atualizado_em = excluded.atualizado_em`,
    [id, String(corpo.nota ?? "").slice(0, 5000), agora, agora],
  );
  return NextResponse.json({ ok: true });
}
