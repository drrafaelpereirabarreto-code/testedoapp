// Barra de filtros. É um formulário comum (método GET): funciona até sem JavaScript.
import { PAISES } from "@/lib/config";
import { CATEGORIAS } from "@/lib/ia";
import type { Filtros as TipoFiltros } from "@/lib/consultas";
import { PLATAFORMAS } from "./rotulos";

export function lerFiltros(sp: Record<string, string | string[] | undefined>): TipoFiltros {
  const s = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const n = (k: string) => {
    const v = Number(s(k));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
  };
  return {
    pais: s("pais"),
    categoria: s("categoria"),
    plataforma: s("plataforma"),
    diasMin: n("dias"),
    ativosMin: n("ativos"),
    q: s("q"),
    escalando: s("escalando") === "1",
  };
}

export default function Filtros({
  valores,
  paises,
  esconder = [],
}: {
  valores: TipoFiltros;
  paises: string[];
  esconder?: Array<"categoria">;
}) {
  const ativos = Object.values(valores).filter((v) => v !== undefined && v !== false).length;
  return (
    <details className="group rounded-2xl border border-borda bg-painel" open={ativos > 0}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">
        <span>
          Filtros{" "}
          {ativos > 0 && <span className="ml-1 rounded-full bg-destaque px-2 py-0.5 text-xs text-white">{ativos}</span>}
        </span>
        <span className="text-texto-3 transition group-open:rotate-180" aria-hidden>
          ▾
        </span>
      </summary>
      <form method="get" className="grid grid-cols-2 gap-3 border-t border-borda p-4 sm:grid-cols-3 lg:grid-cols-7">
        <label className="col-span-2 flex flex-col gap-1 text-xs text-texto-2 sm:col-span-3 lg:col-span-2">
          Palavra-chave
          <input name="q" defaultValue={valores.q} placeholder="ex.: emagrecer, frete grátis…" className="campo" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-texto-2">
          País
          <select name="pais" defaultValue={valores.pais ?? ""} className="campo">
            <option value="">Todos</option>
            {paises.map((p) => (
              <option key={p} value={p}>
                {PAISES[p] ?? p}
              </option>
            ))}
          </select>
        </label>
        {!esconder.includes("categoria") && (
          <label className="flex flex-col gap-1 text-xs text-texto-2">
            Categoria
            <select name="categoria" defaultValue={valores.categoria ?? ""} className="campo">
              <option value="">Todas</option>
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="sem-analise">sem análise</option>
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-texto-2">
          Plataforma
          <select name="plataforma" defaultValue={valores.plataforma ?? ""} className="campo">
            <option value="">Todas</option>
            {Object.entries(PLATAFORMAS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-texto-2">
          Mín. dias no ar
          <input name="dias" type="number" min={0} inputMode="numeric" defaultValue={valores.diasMin} placeholder="ex.: 30" className="campo" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-texto-2">
          Mín. anúncios ativos
          <input name="ativos" type="number" min={0} inputMode="numeric" defaultValue={valores.ativosMin} placeholder="ex.: 5" className="campo" />
        </label>
        <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-3 lg:col-span-7">
          <label className="flex items-center gap-2 text-sm text-texto-2">
            <input type="checkbox" name="escalando" value="1" defaultChecked={valores.escalando} className="h-4 w-4 accent-[#ff7a45]" />
            Só “Escalando agora”
          </label>
          <div className="ml-auto flex gap-2">
            <a href="?" className="botao-sec">
              Limpar
            </a>
            <button type="submit" className="botao">
              Aplicar filtros
            </button>
          </div>
        </div>
      </form>
    </details>
  );
}
