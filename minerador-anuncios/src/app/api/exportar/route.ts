// Baixar em planilha (abre no Excel e no Google Planilhas). Usa os mesmos filtros da página.
import { lerFiltros } from "@/components/Filtros";
import { anunciosDoDia, rankingProdutos } from "@/lib/consultas";
import { listarOportunidades } from "@/lib/oportunidades";
import { FASES, type Fase } from "@/lib/pontuacao";

export const dynamic = "force-dynamic";

function celula(v: unknown): string {
  const t = v === null || v === undefined ? "" : String(v);
  // Evita que o Excel trate o texto como fórmula.
  const seguro = /^[=+\-@]/.test(t) ? `'${t}` : t;
  return /[";\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

function csv(cabecalho: string[], linhas: unknown[][]): string {
  // ";" e BOM: o Excel em português abre com acentos e colunas certas.
  return "﻿" + [cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  const tipo = sp.tipo ?? "anuncios";
  const site = `${url.protocol}//${url.host}`;
  let conteudo: string;

  if (tipo === "produtos") {
    const itens = await rankingProdutos({ categoria: sp.categoria || undefined, q: sp.q || undefined, dias: Number(sp.periodo) || 7 });
    conteudo = csv(
      ["Produto", "Categoria", "Fase", "Anúncios ativos", "Anunciantes", "Mais dias no ar", "Maior pontuação", "Tendência 7 dias (%)", "Link"],
      itens.map((p) => [
        p.nome, p.categoria, p.fase ? FASES[p.fase as Fase].rotulo : "", p.anuncios_ativos, p.anunciantes, p.dias_max,
        p.pontuacao_max, Math.round(p.tendencia * 100), `${site}/produtos/${p.id}`,
      ]),
    );
  } else if (tipo === "oportunidades") {
    const { itens, paisAlvo } = await listarOportunidades();
    conteudo = csv(
      ["Produto", "Categoria", "Nota", "Anúncios lá fora", "Anunciantes lá fora", "Países", `Anunciantes em ${paisAlvo}`, "Conferido em", "Link"],
      itens.map((o) => [
        o.nome, o.categoria, o.nota, o.foraAnuncios, o.foraAnunciantes, o.fora.map((f) => `${f.pais} ${f.anuncios}`).join(", "),
        o.alvoAnunciantes, o.conferidoEm ?? "", `${site}/produtos/${o.id}`,
      ]),
    );
  } else {
    const { itens } = await anunciosDoDia(lerFiltros(sp), 5000);
    conteudo = csv(
      ["Anunciante", "Produto", "Categoria", "Pontuação", "Escalando agora", "Dias no ar", "Anúncios ativos", "Cópias do criativo",
        "Plataformas", "País", "Título", "Texto", "Site de destino", "Biblioteca de Anúncios", "Detalhe"],
      itens.map((a) => [
        a.pagina_nome, a.produto_nome, a.categoria, a.pontuacao, a.escalando ? "sim" : "não", a.dias_no_ar, a.anunciante_ativos,
        a.duplicacoes, a.plataformas.join(", "), a.pais, a.titulo, a.texto, a.dominio,
        `https://www.facebook.com/ads/library/?id=${a.id}`, `${site}/anuncio/${a.id}`,
      ]),
    );
  }
  const data = new Date().toISOString().slice(0, 10);
  return new Response(conteudo, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="minerador-${tipo}-${data}.csv"`,
    },
  });
}
