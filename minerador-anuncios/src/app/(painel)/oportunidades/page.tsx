import Link from "next/link";
import SeloFase from "@/components/Fase";
import Midia from "@/components/Midia";
import { PAISES } from "@/lib/config";
import { linkBiblioteca, listarOportunidades } from "@/lib/oportunidades";
import { formatarData } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function Oportunidades() {
  const { dia, paisAlvo, itens } = await listarOportunidades();
  const nomeAlvo = PAISES[paisAlvo] ?? paisAlvo;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">🌎 Oportunidades no {nomeAlvo}</h1>
          <p className="max-w-3xl text-sm text-texto-2">
            Produtos que estão fortes lá fora (EUA, Europa…) e que ainda têm <strong>pouca ou nenhuma concorrência</strong> no{" "}
            {nomeAlvo}. É a chance de chegar primeiro.
          </p>
        </div>
        {itens.length > 0 && (
          <a href="/api/exportar?tipo=oportunidades" className="botao-sec">
            ⬇ Baixar planilha
          </a>
        )}
      </div>

      <details className="rounded-2xl border border-borda bg-painel p-4 text-sm text-texto-2">
        <summary className="cursor-pointer font-semibold text-texto">Como ler esta página</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Nota</strong> (0–100): força do produto lá fora (pontuação, anúncios, anunciantes, crescimento), descontada
            a concorrência no {nomeAlvo}. Com 3 ou mais anunciantes aqui, deixa de ser oportunidade.
          </li>
          <li>
            “0 anunciantes aqui” quer dizer que <strong>a coleta não encontrou</strong> ninguém. Por isso, todo dia o robô
            procura no {nomeAlvo}, pelo nome do produto, as melhores oportunidades (aparece “✓ conferido em…”). Mesmo assim,
            confira você também no botão “Procurar no {nomeAlvo}”.
          </li>
          <li>Antes de vender: veja se o produto é permitido no {nomeAlvo}, se tem fornecedor e se a margem fecha.</li>
        </ul>
      </details>

      {!dia || itens.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-borda p-8 text-center text-sm text-texto-2">
          Nenhuma oportunidade ainda. Para aparecer algo aqui, a coleta precisa trazer anúncios de outro país (marque os EUA
          em Configurações e use palavras-chave em inglês, como “US: free shipping”) e a IA precisa estar ligada para
          reconhecer o mesmo produto nos dois países.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {itens.map((o, i) => (
            <li key={o.id} className="rounded-2xl border border-borda bg-painel p-3">
              <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
                <span className="w-6 shrink-0 pt-1 text-center text-lg font-bold text-texto-3 tabular-nums">{i + 1}</span>
                <Link href={`/produtos/${o.id}`} className="shrink-0">
                  <Midia imagem={o.imagem_url} alt={o.nome} className="h-20 w-20 rounded-xl" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/produtos/${o.id}`} className="font-semibold hover:text-destaque-forte">
                      {o.nome}
                    </Link>
                    <SeloFase fase={o.fase} />
                  </div>
                  <p className="text-xs text-texto-3">{o.categoria ?? "—"}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    {o.fora.map((f) => (
                      <span key={f.pais} className="rounded-lg bg-painel-2 px-2 py-1">
                        {PAISES[f.pais] ?? f.pais}: <strong className="tabular-nums">{f.anuncios}</strong> anúncios ·{" "}
                        <strong className="tabular-nums">{f.anunciantes}</strong> anunciante{f.anunciantes === 1 ? "" : "s"}
                      </span>
                    ))}
                    <span
                      className={`rounded-lg px-2 py-1 ${o.alvoAnunciantes === 0 ? "bg-bom/15 text-bom" : "bg-alerta/15 text-alerta"}`}
                    >
                      {nomeAlvo}: <strong className="tabular-nums">{o.alvoAnunciantes}</strong> anunciante
                      {o.alvoAnunciantes === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-texto-3">
                    {o.conferidoEm ? `✓ conferido no ${nomeAlvo} em ${formatarData(o.conferidoEm)}` : "ainda não conferido pelo robô"}
                    {" · "}anúncio mais antigo: {o.dias_max} dias
                  </p>
                </div>
                <div className="flex w-full shrink-0 flex-row items-center justify-between gap-2 sm:w-auto sm:flex-col sm:items-end">
                  <span className="rounded-xl bg-bom px-3 py-1.5 text-lg font-bold text-black tabular-nums" title="Nota de oportunidade (0 a 100)">
                    {o.nota}
                  </span>
                  <a href={linkBiblioteca(o.nome, paisAlvo)} target="_blank" rel="noreferrer" className="botao-sec text-xs">
                    ↗ Procurar no {nomeAlvo}
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
