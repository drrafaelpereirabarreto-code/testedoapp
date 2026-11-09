import Link from "next/link";
import Midia from "@/components/Midia";
import { tendenciaTexto } from "@/components/rotulos";
import { rankingProdutos } from "@/lib/consultas";
import { CATEGORIAS } from "@/lib/ia";

export const dynamic = "force-dynamic";

export default async function Produtos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const categoria = sp.categoria || undefined;
  const q = sp.q?.trim() || undefined;
  const dias = Number(sp.periodo) || 7;
  const produtos = await rankingProdutos({ categoria, q, dias });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">Ranking de produtos</h1>
        <p className="text-sm text-texto-2">
          A IA junta anúncios do mesmo produto, mesmo de anunciantes diferentes. Quanto mais anúncios ativos e mais
          anunciantes vendendo, mais o produto está sendo escalado.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-borda bg-painel p-4">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-texto-2">
          Buscar produto
          <input name="q" defaultValue={q} placeholder="ex.: escova, colágeno…" className="campo" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-texto-2">
          Categoria
          <select name="categoria" defaultValue={categoria ?? ""} className="campo">
            <option value="">Todas</option>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-texto-2">
          Visto nos últimos
          <select name="periodo" defaultValue={String(dias)} className="campo">
            <option value="1">1 dia</option>
            <option value="7">7 dias</option>
            <option value="30">30 dias</option>
            <option value="365">1 ano</option>
          </select>
        </label>
        <button className="botao">Filtrar</button>
      </form>

      {produtos.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-borda p-8 text-center text-sm text-texto-2">
          Nenhum produto ainda. Os produtos aparecem depois que a IA analisa os anúncios (precisa da ANTHROPIC_API_KEY no
          .env).
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {produtos.map((p, i) => {
            const t = tendenciaTexto(p.tendencia);
            return (
              <li key={p.id}>
                <Link
                  href={`/produtos/${p.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-borda bg-painel p-3 transition hover:border-texto-3 sm:flex-nowrap"
                >
                  <span className="w-7 shrink-0 text-center text-lg font-bold text-texto-3 tabular-nums">{i + 1}</span>
                  <Midia imagem={p.imagem_url} alt={p.nome} className="h-14 w-14 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.nome}</p>
                    <p className="text-xs text-texto-3">{p.categoria ?? "—"}</p>
                  </div>
                  <dl className="grid w-full shrink-0 grid-cols-4 gap-x-4 gap-y-1 text-xs sm:w-auto sm:text-right">
                    <div>
                      <dt className="text-texto-3">ativos</dt>
                      <dd className="font-bold tabular-nums">{p.anuncios_ativos}</dd>
                    </div>
                    <div>
                      <dt className="text-texto-3">anunciantes</dt>
                      <dd className="font-bold tabular-nums">{p.anunciantes}</dd>
                    </div>
                    <div>
                      <dt className="text-texto-3">dias no ar</dt>
                      <dd className="font-bold tabular-nums">{p.dias_max}</dd>
                    </div>
                    <div>
                      <dt className="text-texto-3">tendência</dt>
                      <dd className={`font-bold ${t.classe}`}>{t.texto}</dd>
                    </div>
                  </dl>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
