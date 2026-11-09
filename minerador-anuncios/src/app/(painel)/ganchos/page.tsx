import Link from "next/link";
import { BotaoCopiar } from "@/components/Botoes";
import { ganchos } from "@/lib/consultas";
import { CATEGORIAS } from "@/lib/ia";

export const dynamic = "force-dynamic";

export default async function Ganchos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const categoria = sp.categoria || undefined;
  const q = sp.q?.trim() || undefined;
  const itens = await ganchos({ categoria, q });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">🪝 Biblioteca de ganchos</h1>
        <p className="max-w-3xl text-sm text-texto-2">
          O gancho é a primeira frase (ou os 3 primeiros segundos) que prende a atenção. Aqui ficam os ganchos dos anúncios
          vencedores, separados por nicho. Use como inspiração para escrever os seus — não copie igual.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-borda bg-painel p-4">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-texto-2">
          Buscar
          <input name="q" defaultValue={q} placeholder="ex.: dor nas costas, gato, renda extra…" className="campo" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-texto-2">
          Nicho
          <select name="categoria" defaultValue={categoria ?? ""} className="campo">
            <option value="">Todos</option>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button className="botao">Filtrar</button>
      </form>

      {itens.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-borda p-8 text-center text-sm text-texto-2">
          Nenhum gancho ainda. Eles aparecem depois que a IA analisa os anúncios.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {itens.map((g) => (
            <li key={g.anuncio_id} className="flex flex-col gap-2 rounded-2xl border border-borda bg-painel p-4">
              <p className="text-lg font-semibold leading-snug">“{g.gancho}”</p>
              {g.promessa && <p className="text-sm text-texto-2">Promessa: {g.promessa}</p>}
              <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-texto-3">
                <span className="rounded bg-painel-2 px-1.5 py-0.5">{g.categoria ?? "—"}</span>
                {g.produto_nome && <span>📦 {g.produto_nome}</span>}
                <span>
                  · {g.pontuacao} pts · {g.dias_no_ar}d no ar
                </span>
                {g.vezes > 1 && <span>· usado em {g.vezes} anúncios</span>}
                {g.escalando === 1 && <span className="text-quente">· 🔥 escalando</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <BotaoCopiar texto={g.gancho} rotulo="Copiar gancho" />
                <Link href={`/anuncio/${g.anuncio_id}`} className="botao-sec">
                  Ver anúncio
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
