// Botão "Analisar com IA" no detalhe do anúncio.
import { NextResponse } from "next/server";
import { analisarUm, atualizarProdutos } from "@/lib/coleta";
import { um } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => ({}))) as { id?: string };
  const id = String(corpo.id ?? "");
  if (!/^[\w-]{1,64}$/.test(id)) return NextResponse.json({ ok: false, erro: "Anúncio inválido." }, { status: 400 });
  const r = await analisarUm(id);
  if (r.ok) {
    const a = await um<{ ultima_vez: string }>("SELECT ultima_vez FROM anuncios WHERE id = ?", [id]);
    if (a?.ultima_vez) await atualizarProdutos(a.ultima_vez);
  }
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
