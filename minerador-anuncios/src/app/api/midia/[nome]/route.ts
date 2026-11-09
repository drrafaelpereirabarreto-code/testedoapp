// Entrega as imagens e vídeos guardados no disco (só para quem fez login: o proxy confere).
import fs from "node:fs/promises";
import path from "node:path";
import { pastaMidia } from "@/lib/midia";

const TIPOS: Record<string, string> = {
  jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
};

export async function GET(req: Request, { params }: { params: Promise<{ nome: string }> }) {
  const { nome } = await params;
  // Só nomes simples (número.extensão): nada de "../".
  const m = /^([\w-]{1,80})\.(jpg|png|webp|gif|mp4|webm|mov)$/.exec(nome);
  if (!m) return new Response("Não encontrado", { status: 404 });
  const arquivo = path.join(pastaMidia(), nome);
  try {
    const st = await fs.stat(arquivo);
    const dados = await fs.readFile(arquivo);
    const tipo = TIPOS[m[2]];
    const cabecalhos: Record<string, string> = {
      "Content-Type": tipo,
      "Cache-Control": "private, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
    };
    // Vídeos: o navegador pede pedaços (Range) para poder avançar o vídeo.
    const range = req.headers.get("range");
    const r = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (r) {
      const inicio = r[1] ? Number(r[1]) : Math.max(0, st.size - Number(r[2]));
      const fim = r[1] && r[2] ? Math.min(Number(r[2]), st.size - 1) : st.size - 1;
      if (inicio >= st.size || inicio > fim) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${st.size}` } });
      return new Response(dados.subarray(inicio, fim + 1), {
        status: 206,
        headers: { ...cabecalhos, "Content-Range": `bytes ${inicio}-${fim}/${st.size}`, "Content-Length": String(fim - inicio + 1) },
      });
    }
    return new Response(dados, { headers: { ...cabecalhos, "Content-Length": String(st.size) } });
  } catch {
    return new Response("Não encontrado", { status: 404 });
  }
}
