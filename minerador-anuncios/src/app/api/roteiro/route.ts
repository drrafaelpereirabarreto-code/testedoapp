// "Criar roteiro completo" a partir de uma das 3 ideias da IA.
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { executar, um } from "@/lib/db";
import { criarRoteiro } from "@/lib/ia";
import { usuarioAtual } from "@/lib/usuario";
import { jsonSeguro } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => ({}))) as { id?: string; ideia?: number };
  const id = String(corpo.id ?? "");
  const n = Number(corpo.ideia);
  if (!/^[\w-]{1,64}$/.test(id) || !Number.isInteger(n) || n < 0 || n > 2) {
    return NextResponse.json({ ok: false, erro: "Pedido inválido." }, { status: 400 });
  }
  const a = await um<Record<string, unknown>>(
    `SELECT a.pagina_nome, a.texto, a.titulo, a.descricao, a.cta, a.link_destino, a.formato, a.imagem_url, a.dias_no_ar,
       s.produto_nome, s.ideias
     FROM anuncios a JOIN analises s ON s.anuncio_id = a.id AND s.erro IS NULL WHERE a.id = ?`,
    [id],
  );
  const ideias = jsonSeguro<Array<{ titulo: string; gancho: string; roteiro: string; visual: string }>>(a?.ideias as string, []);
  if (!a || !ideias[n]) return NextResponse.json({ ok: false, erro: "Analise o anúncio com a IA primeiro." }, { status: 400 });
  const r = await criarRoteiro(
    {
      pagina_nome: a.pagina_nome as string | null,
      texto: a.texto as string | null,
      titulo: a.titulo as string | null,
      descricao: a.descricao as string | null,
      cta: a.cta as string | null,
      link_destino: a.link_destino as string | null,
      formato: a.formato as string | null,
      imagem_url: null,
      dias_no_ar: Number(a.dias_no_ar),
      produto_nome: a.produto_nome as string | null,
    },
    ideias[n],
  );
  if (!r.ok || !r.roteiro) return NextResponse.json(r, { status: 500 });
  await executar("INSERT INTO roteiros (id, anuncio_id, ideia, usuario, conteudo, modelo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)", [
    randomUUID(), id, n, await usuarioAtual(), JSON.stringify(r.roteiro), r.modelo, new Date().toISOString(),
  ]);
  return NextResponse.json({ ok: true });
}
