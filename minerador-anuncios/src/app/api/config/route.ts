import { NextResponse } from "next/server";
import { PAISES, lerLista, salvarConfig } from "@/lib/config";
import { apagarExemplos } from "@/lib/exemplo";

export async function POST(req: Request) {
  const f = await req.formData();
  if (f.get("acao") === "apagar-exemplo") {
    await apagarExemplos();
    return NextResponse.redirect(new URL("/config?apagado=1", req.url), 303);
  }
  const numero = (k: string, min: number, max: number, padrao: number) => {
    const n = Math.floor(Number(f.get(k)));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
  };
  const paisAlvo = String(f.get("paisAlvo") ?? "BR");
  const paises = f.getAll("paises").map(String).filter((p) => p in PAISES);
  // O país onde você vende precisa estar na coleta, senão a página "Oportunidades" não consegue comparar.
  if (paisAlvo in PAISES && !paises.includes(paisAlvo)) paises.unshift(paisAlvo);
  await salvarConfig({
    palavrasChave: lerLista(String(f.get("palavrasChave") ?? "")).slice(0, 50),
    paises,
    paisAlvo: paisAlvo in PAISES ? paisAlvo : "BR",
    verificarOportunidades: numero("verificarOportunidades", 0, 30, 5),
    guardarMidiaPorDia: numero("guardarMidiaPorDia", 0, 500, 40),
    guardarMidiaPontuacao: numero("guardarMidiaPontuacao", 0, 100, 55),
    guardarVideos: f.get("guardarVideos") === "1",
    resumoAtivo: f.get("resumoAtivo") === "1",
    resumoQuantidade: numero("resumoQuantidade", 3, 30, 10),
    idioma: String(f.get("idioma") ?? "").replace(/[^a-z]/g, "").slice(0, 3),
    anunciantes: lerLista(String(f.get("anunciantes") ?? "")).filter((a) => /^\d+$/.test(a)).slice(0, 50),
    limitePorBusca: numero("limitePorBusca", 10, 1000, 50),
    iaMaxPorDia: numero("iaMaxPorDia", 0, 1000, 30),
  });
  return NextResponse.redirect(new URL("/config?salvo=1", req.url), 303);
}
