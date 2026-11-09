import Link from "next/link";
import { notFound } from "next/navigation";
import { GradeAnuncios } from "@/components/CartaoAnuncio";
import Grafico from "@/components/Grafico";
import { tendenciaTexto } from "@/components/rotulos";
import { produto } from "@/lib/consultas";
import { formatarData } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function Produto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dados = await produto(decodeURIComponent(id));
  if (!dados) notFound();
  const { produto: p, anuncios, historico } = dados;
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
      <p className={`text-sm font-semibold ${t.classe}`}>Tendência em 7 dias: {t.texto}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Grafico titulo="Anúncios ativos por dia" pontos={historico.map((h) => ({ dia: h.dia, valor: Number(h.anuncios_ativos) }))} />
        <Grafico titulo="Anunciantes por dia" pontos={historico.map((h) => ({ dia: h.dia, valor: Number(h.anunciantes) }))} />
      </div>
      <h2 className="text-lg font-bold">Anúncios deste produto</h2>
      <GradeAnuncios itens={anuncios} />
    </div>
  );
}
