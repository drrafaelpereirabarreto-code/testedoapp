import { NextResponse } from "next/server";
import { executar } from "@/lib/db";
import { usuarioAtual } from "@/lib/usuario";

export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => ({}))) as { id?: string; acao?: string; nota?: string };
  const id = String(corpo.id ?? "");
  if (!/^[\w-]{1,64}$/.test(id)) return NextResponse.json({ erro: "Anúncio inválido." }, { status: 400 });
  const usuario = await usuarioAtual();
  if (corpo.acao === "remover") {
    await executar("DELETE FROM favoritos_usuarios WHERE usuario = ? AND anuncio_id = ?", [usuario, id]);
    return NextResponse.json({ ok: true });
  }
  const agora = new Date().toISOString();
  await executar(
    `INSERT INTO favoritos_usuarios (usuario, anuncio_id, nota, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (usuario, anuncio_id) DO UPDATE SET nota = excluded.nota, atualizado_em = excluded.atualizado_em`,
    [usuario, id, String(corpo.nota ?? "").slice(0, 5000), agora, agora],
  );
  // Criativo favorito fica guardado para sempre (o link do Facebook expira).
  void import("@/lib/midia").then((m) => m.guardarMidiaDe([id])).catch(() => {});
  return NextResponse.json({ ok: true });
}
