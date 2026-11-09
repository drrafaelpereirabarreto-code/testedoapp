import Link from "next/link";
import { GradeAnuncios } from "@/components/CartaoAnuncio";
import Filtros, { lerFiltros } from "@/components/Filtros";
import { anunciosPorCategoria, paisesComDados } from "@/lib/consultas";
import { formatarData } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function Categorias({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const filtros = lerFiltros(sp);
  const [{ dia, grupos }, paises] = await Promise.all([anunciosPorCategoria(filtros, filtros.categoria ? 60 : 10), paisesComDados()]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">Por categoria</h1>
        <p className="text-sm text-texto-2">
          Cada nicho separado, sem misturar{dia ? ` — coleta de ${formatarData(dia)}` : ""}. Clique no nome do nicho para
          ver todos.
        </p>
      </div>

      <nav aria-label="Categorias" className="flex flex-wrap gap-2">
        <Link href="/categorias" className={`rounded-full border px-3 py-1 text-sm ${!filtros.categoria ? "border-destaque bg-destaque/15" : "border-borda"}`}>
          Todas
        </Link>
        {grupos.map((g) => (
          <Link
            key={g.categoria}
            href={`/categorias?categoria=${encodeURIComponent(g.categoria === "sem análise" ? "sem-analise" : g.categoria)}`}
            className={`rounded-full border px-3 py-1 text-sm ${(filtros.categoria === "sem-analise" ? "sem análise" : filtros.categoria) === g.categoria ? "border-destaque bg-destaque/15" : "border-borda"}`}
          >
            {g.categoria} <span className="text-texto-3">{g.total}</span>
          </Link>
        ))}
      </nav>

      <Filtros valores={filtros} paises={paises} esconder={["categoria"]} />

      {grupos.length === 0 && (
        <p className="rounded-2xl border border-dashed border-borda p-8 text-center text-sm text-texto-2">Nada por aqui ainda.</p>
      )}
      {grupos.map((g) => (
        <section key={g.categoria} aria-labelledby={`cat-${g.categoria}`} className="flex flex-col gap-3">
          <h2 id={`cat-${g.categoria}`} className="flex items-baseline gap-2 text-lg font-bold capitalize">
            {g.categoria}
            <span className="text-sm font-normal normal-case text-texto-3">
              {g.total} anúncio{g.total === 1 ? "" : "s"}
            </span>
          </h2>
          <GradeAnuncios itens={g.itens} />
        </section>
      ))}
    </div>
  );
}
