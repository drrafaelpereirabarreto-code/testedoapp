// Botões de Configurações: "Enviar resumo agora" e "Conectar meu Telegram".
import { NextResponse } from "next/server";
import { ultimoDia } from "@/lib/consultas";
import { descobrirChatTelegram, enviarResumo } from "@/lib/resumo";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const f = await req.formData();
  let mensagem: string;
  if (f.get("acao") === "telegram") {
    mensagem = (await descobrirChatTelegram()).mensagem;
  } else {
    const dia = (await ultimoDia()) ?? undefined;
    const r = await enviarResumo({ dia, forcar: true });
    mensagem = r.mensagem || "Nada para enviar.";
  }
  return NextResponse.redirect(new URL(`/config?aviso=${encodeURIComponent(mensagem)}#resumo`, req.url), 303);
}
