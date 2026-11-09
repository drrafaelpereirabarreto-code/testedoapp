// Coleta diária automática. A Vercel chama este endereço uma vez por dia (veja vercel.json)
// mandando "Authorization: Bearer <CRON_SECRET>". Também dá para chamar de outro agendador.
import { NextResponse } from "next/server";
import { executarColeta } from "@/lib/coleta";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }
  try {
    const r = await executarColeta({ forcar: false, limiteMs: 270_000 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ status: "erro", mensagem: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
