import Link from "next/link";
import { notFound } from "next/navigation";
import { GradeAnuncios } from "@/components/CartaoAnuncio";
import SeloFase from "@/components/Fase";
import Grafico from "@/components/Grafico";
import { PAISES } from "@/lib/config";
import { FASES, type Fase } from "@/lib/pontuacao";
import { tendenciaTexto } from "@/components/rotulos";
import { produto } from "@/lib/consultas";
import { formatarData } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function Produto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dados = await produto(decodeURIComponent(id));
  if (!dados) notFound();
  const { produto: p, anuncios, historico, paises } = dados;
  const t = tendenciaTexto(p.tendencia);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/produtos" className="text-sm text-texto-2 hover:text-texto">
        ← Ranking de produtos
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{p.nome}</h1>
        <p className="text-sm text-texto-2">
          {p.categoria ?? "sem categoria"} · visto pela 1ª vez em {formatarData(p.primeira_vez)} · última vez em{" "}
          {formatarData(p.ultima_vez)}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Anúncios ativos", p.anuncios_ativos],
          ["Anunciantes", p.anunciantes],
          ["Mais dias no ar", p.dias_max],
          ["Maior pontuação", p.pontuacao_max],
        ].map(([r, v]) => (
          <div key={r} className="rounded-2xl border border-borda bg-painel p-4">
            <dt className="text-xs text-texto-3">{r}</dt>
            <dd className="text-2xl font-bold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-2 rounded-2xl border border-borda bg-painel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <SeloFase fase={p.fase} grande />
          <span className={`text-sm font-semibold ${t.classe}`}>Tendência em 7 dias: {t.texto}</span>
        </div>
        {p.fase_motivo && <p className="text-sm text-texto-2">{p.fase_motivo}.</p>}
        {p.fase && p.fase in FASES && <p className="text-sm text-texto-3">{FASES[p.fase as Fase].dica}</p>}
        {paises.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1 text-xs">
            {paises.map((x) => (
              <span key={x.pais} className="rounded-lg bg-painel-2 px-2 py-1">
                {PAISES[x.pais] ?? x.pais}: <strong>{x.anuncios_ativos}</strong> anúncios · <strong>{x.anunciantes}</strong>{" "}
                anunciante{Number(x.anunciantes) === 1 ? "" : "s"}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Grafico titulo="Anúncios ativos por dia" pontos={historico.map((h) => ({ dia: h.dia, valor: Number(h.anuncios_ativos) }))} />
        <Grafico titulo="Anunciantes por dia" pontos={historico.map((h) => ({ dia: h.dia, valor: Number(h.anunciantes) }))} />
      </div>
      <h2 className="text-lg font-bold">Anúncios deste produto</h2>
      <GradeAnuncios itens={anuncios} />
    </div>
  );
}
