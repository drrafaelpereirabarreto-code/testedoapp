import Link from "next/link";
import { GradeAnuncios } from "@/components/CartaoAnuncio";
import Filtros, { lerFiltros } from "@/components/Filtros";
import { anunciosDoDia, paisesComDados, ultimasColetas } from "@/lib/consultas";
import { formatarData, hojeISO } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function Hoje({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filtros = lerFiltros(await searchParams);
  const [{ dia, itens, total }, paises, coletas] = await Promise.all([
    anunciosDoDia(filtros),
    paisesComDados(),
    ultimasColetas(1),
  ]);
  const escalando = itens.filter((i) => i.escalando).length;
  const ultima = coletas[0];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Hoje</h1>
          <p className="text-sm text-texto-2">
            {dia ? (
              <>
                Anúncios ativos coletados em <strong>{formatarData(dia)}</strong>
                {dia !== hojeISO() && " (a coleta de hoje ainda não rodou)"}, do mais forte para o mais fraco.
              </>
            ) : (
              "Ainda não há anúncios."
            )}
          </p>
        </div>
        {dia && (
          <div className="flex gap-2 text-center text-xs">
            <div className="rounded-xl border border-borda bg-painel px-3 py-2">
              <div className="text-lg font-bold tabular-nums">{total}</div>
              <div className="text-texto-3">anúncios</div>
            </div>
            <div className="rounded-xl border border-quente/40 bg-quente/10 px-3 py-2">
              <div className="text-lg font-bold tabular-nums text-quente">{escalando}</div>
              <div className="text-texto-3">escalando*</div>
            </div>
          </div>
        )}
      </div>

      {ultima?.status === "erro" && (
        <p className="rounded-xl border border-ruim/40 bg-ruim/10 px-4 py-3 text-sm text-ruim">
          A última coleta deu erro: {ultima.mensagem}
        </p>
      )}
      {ultima?.status === "rodando" && (
        <p className="rounded-xl border border-destaque/40 bg-destaque/10 px-4 py-3 text-sm">
          Há uma coleta rodando no Apify. Clique em “Atualizar” daqui a alguns minutos para buscar o resultado.
        </p>
      )}

      <Filtros valores={filtros} paises={paises} />

      <GradeAnuncios
        itens={itens}
        vazio={
          <div className="rounded-2xl border border-dashed border-borda p-8 text-center text-sm text-texto-2">
            {dia ? (
              "Nenhum anúncio com esses filtros."
            ) : (
              <>
                <p className="text-base font-semibold text-texto">Nenhum anúncio coletado ainda.</p>
                <p className="mt-2">
                  1) Coloque o APIFY_TOKEN no arquivo <code>.env</code> (veja o README). 2) Confira as palavras-chave em{" "}
                  <Link href="/config" className="text-destaque-forte underline">
                    Configurações
                  </Link>
                  . 3) Clique em “Atualizar”.
                </p>
                <p className="mt-2 text-texto-3">Quer só conhecer o painel antes? Rode <code>npm run exemplo</code>.</p>
              </>
            )}
          </div>
        }
      />
      {total > itens.length && (
        <p className="text-center text-xs text-texto-3">
          Mostrando os {itens.length} mais fortes de {total}. Use os filtros para achar os outros.
        </p>
      )}
      <p className="text-xs text-texto-3">
        * “Escalando agora”: o anunciante colocou mais anúncios no ar nos últimos dias (+20% e pelo menos 2 a mais), ou o
        anúncio é novo e já tem muitas variações. A Pontuação de Escala (0–100) soma: tempo no ar, anúncios ativos do mesmo
        anunciante, cópias do mesmo criativo, crescimento e plataformas.
      </p>
    </div>
  );
}
