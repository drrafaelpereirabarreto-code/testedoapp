// Botão "Atualizar agora": coleta na hora (ou continua a coleta que está rodando no Apify).
import { NextResponse } from "next/server";
import { executarColeta } from "@/lib/coleta";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const r = await executarColeta({ forcar: true, limiteMs: 270_000 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ status: "erro", mensagem: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
