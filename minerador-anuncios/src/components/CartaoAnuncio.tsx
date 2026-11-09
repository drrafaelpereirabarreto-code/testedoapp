import Link from "next/link";
import type { AnuncioLista } from "@/lib/consultas";
import Midia from "./Midia";
import { PLATAFORMAS, PLATAFORMAS_CURTO, corPontuacao, rotuloCategoria } from "./rotulos";

export default function CartaoAnuncio({ a, extra }: { a: AnuncioLista; extra?: React.ReactNode }) {
  const titulo = a.titulo || a.texto?.split("\n")[0] || "Anúncio sem texto";
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-borda bg-painel transition hover:border-texto-3">
      <Link href={`/anuncio/${a.id}`} className="relative block">
        <Midia
          imagem={a.imagem_url}
          video={a.video_url}
          capa={a.video_capa}
          alt={`Criativo do anúncio de ${a.pagina_nome ?? "anunciante"}`}
          className="aspect-square w-full"
        />
        <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          <span className={`rounded-lg px-2 py-1 text-sm font-bold tabular-nums shadow ${corPontuacao(a.pontuacao)}`} title="Pontuação de Escala (0 a 100)">
            {a.pontuacao}
          </span>
          {a.escalando && (
            <span className="rounded-lg bg-quente px-2 py-1 text-xs font-bold text-black shadow">🔥 Escalando agora</span>
          )}
        </div>
        {a.favorito && (
          <span className="absolute right-2 top-2 rounded-lg bg-black/70 px-2 py-1 text-sm" title="Nos favoritos">
            ★
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2 text-xs text-texto-3">
          <span className="truncate font-semibold text-texto-2">{a.pagina_nome ?? "Anunciante"}</span>
          {a.pais && <span className="shrink-0 rounded bg-painel-2 px-1.5 py-0.5">{a.pais}</span>}
        </div>
        <Link href={`/anuncio/${a.id}`} className="line-clamp-2 text-sm font-semibold leading-snug hover:text-destaque-forte">
          {titulo}
        </Link>
        {a.produto_nome && <p className="line-clamp-1 text-xs text-texto-2">📦 {a.produto_nome}</p>}
        <dl className="mt-auto grid grid-cols-3 gap-1 pt-1 text-center text-xs">
          <div className="rounded-lg bg-painel-2 px-1 py-1.5">
            <dt className="text-texto-3">no ar</dt>
            <dd className="font-bold tabular-nums">{a.dias_no_ar}d</dd>
          </div>
          <div className="rounded-lg bg-painel-2 px-1 py-1.5">
            <dt className="text-texto-3">ativos</dt>
            <dd className="font-bold tabular-nums">{a.anunciante_ativos}</dd>
          </div>
          <div className="rounded-lg bg-painel-2 px-1 py-1.5">
            <dt className="text-texto-3">cópias</dt>
            <dd className="font-bold tabular-nums">{a.duplicacoes}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-texto-3">
          <span className="rounded bg-painel-2 px-1.5 py-0.5">{rotuloCategoria(a.categoria)}</span>
          {a.plataformas.map((p) => (
            <span key={p} className="rounded border border-borda px-1.5 py-0.5" title={PLATAFORMAS[p] ?? p}>
              {PLATAFORMAS_CURTO[p] ?? p}
            </span>
          ))}
        </div>
        {extra}
      </div>
    </article>
  );
}

export function GradeAnuncios({ itens, vazio }: { itens: AnuncioLista[]; vazio?: React.ReactNode }) {
  if (itens.length === 0) return <>{vazio}</>;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {itens.map((a) => (
        <CartaoAnuncio key={a.id} a={a} />
      ))}
    </div>
  );
}
