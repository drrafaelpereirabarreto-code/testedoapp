import Link from "next/link";
import { notFound } from "next/navigation";
import { BotaoAnalisar, BotaoCopiar, Favorito } from "@/components/Botoes";
import { GradeAnuncios } from "@/components/CartaoAnuncio";
import Grafico from "@/components/Grafico";
import Midia from "@/components/Midia";
import { PLATAFORMAS, corPontuacao } from "@/components/rotulos";
import { anuncioCompleto } from "@/lib/consultas";
import { PESOS } from "@/lib/pontuacao";
import { temIA } from "@/lib/ia";
import { formatarData } from "@/lib/util";

export const dynamic = "force-dynamic";

const NOMES_PARTES: Record<string, string> = {
  tempo: "Tempo no ar",
  ativos: "Anúncios ativos",
  duplicacoes: "Cópias do criativo",
  crescimento: "Crescimento",
  plataformas: "Plataformas",
};

function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

export default async function Anuncio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dados = await anuncioCompleto(id);
  if (!dados) notFound();
  const { anuncio: a, historico, doAnunciante, irmaos } = dados;

  const texto = s(a.texto);
  const titulo = s(a.titulo);
  const descricao = s(a.descricao);
  const link = s(a.link_destino);
  const textoCompleto = [titulo, texto, descricao].filter(Boolean).join("\n\n");
  const temAnalise = Boolean(s(a.promessa)) && !s(a.ia_erro);
  const pontuacao = Number(a.pontuacao);
  const ideiasTexto = a.ideias
    .map((i, n) => `IDEIA ${n + 1}: ${i.titulo}\nGancho: ${i.gancho}\nRoteiro: ${i.roteiro}\nVisual: ${i.visual}`)
    .join("\n\n");

  return (
    <div className="flex flex-col gap-6">
      <Link href="/" className="text-sm text-texto-2 hover:text-texto">
        ← Voltar
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* Criativo */}
        <div className="flex flex-col gap-3">
          <Midia
            imagem={s(a.imagem_url)}
            video={s(a.video_url)}
            capa={s(a.video_capa)}
            alt={`Criativo do anúncio de ${s(a.pagina_nome) ?? "anunciante"}`}
            biblioteca={s(a.biblioteca_url) ?? undefined}
            tocarVideo
            className="w-full rounded-2xl border border-borda lg:max-h-[640px]"
          />
          <div className="flex flex-wrap gap-2">
            <a href={s(a.biblioteca_url) ?? "#"} target="_blank" rel="noreferrer" className="botao-sec">
              ↗ Biblioteca de Anúncios
            </a>
            {link && (
              <a href={link} target="_blank" rel="noreferrer nofollow" className="botao-sec">
                ↗ Página de destino
              </a>
            )}
            {s(a.video_url) && (
              <a href={s(a.video_url)!} target="_blank" rel="noreferrer" download className="botao-sec">
                ⬇ Baixar vídeo
              </a>
            )}
          </div>
        </div>

        {/* Dados */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-xl px-3 py-1.5 text-xl font-bold tabular-nums ${corPontuacao(pontuacao)}`}>{pontuacao}</span>
            <span className="text-sm text-texto-3">Pontuação de Escala</span>
            {a.escalando && <span className="rounded-lg bg-quente px-2 py-1 text-xs font-bold text-black">🔥 Escalando agora</span>}
            {s(a.fonte) === "exemplo" && <span className="rounded-lg bg-alerta px-2 py-1 text-xs font-bold text-black">EXEMPLO</span>}
          </div>
          <div>
            <h1 className="text-xl font-bold">{s(a.pagina_nome) ?? "Anunciante"}</h1>
            <p className="text-sm text-texto-2">
              No ar desde {formatarData(s(a.data_inicio))} ({Number(a.dias_no_ar)} dias) · {s(a.pais) ?? "país ?"} ·{" "}
              {a.plataformas.map((p) => PLATAFORMAS[p] ?? p).join(", ") || "plataformas ?"}
              {s(a.dominio) && <> · {s(a.dominio)}</>}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Dias no ar", a.dias_no_ar],
              ["Anúncios ativos do anunciante", a.anunciante_ativos],
              ["Cópias do criativo", a.duplicacoes],
              ["Mesma página de destino", a.dominio_ativos],
            ].map(([r, v]) => (
              <div key={r as string} className="rounded-xl border border-borda bg-painel p-3">
                <dt className="text-xs text-texto-3">{r as string}</dt>
                <dd className="text-xl font-bold tabular-nums">{Number(v)}</dd>
              </div>
            ))}
          </dl>

          {a.detalhes.partes && (
            <details className="rounded-xl border border-borda bg-painel p-3 text-sm">
              <summary className="cursor-pointer font-semibold">Por que essa pontuação?</summary>
              <ul className="mt-3 flex flex-col gap-2">
                {Object.entries(a.detalhes.partes).map(([k, v]) => {
                  const teto = PESOS[k as keyof typeof PESOS] ?? 1;
                  return (
                    <li key={k} className="grid grid-cols-[9rem_1fr_3.5rem] items-center gap-2">
                      <span className="text-texto-2">{NOMES_PARTES[k] ?? k}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-painel-2">
                        <span className="block h-full rounded-full bg-destaque" style={{ width: `${(Number(v) / teto) * 100}%` }} />
                      </span>
                      <span className="text-right tabular-nums text-texto-2">
                        {Number(v).toFixed(0)}/{teto}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {a.detalhes.motivos && a.detalhes.motivos.length > 0 && (
                <ul className="mt-3 list-disc pl-5 text-texto-2">
                  {a.detalhes.motivos.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </details>
          )}

          <section className="rounded-2xl border border-borda bg-painel p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-bold">Texto do anúncio</h2>
              {textoCompleto && <BotaoCopiar texto={textoCompleto} />}
            </div>
            {titulo && <p className="mb-2 font-semibold">{titulo}</p>}
            <p className="texto-anuncio text-sm text-texto-2">{texto ?? "(sem texto)"}</p>
            {descricao && <p className="mt-2 text-sm text-texto-3">{descricao}</p>}
            {s(a.cta) && (
              <p className="mt-3 inline-block rounded-lg bg-painel-2 px-3 py-1 text-sm font-semibold">Botão: {s(a.cta)}</p>
            )}
          </section>
        </div>
      </div>

      {/* Análise da IA */}
      <section className="rounded-2xl border border-borda bg-painel p-4" aria-labelledby="ia">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="ia" className="text-lg font-bold">
            ✨ Análise da IA
          </h2>
          {temIA() && <BotaoAnalisar id={id} refazer={temAnalise} />}
        </div>
        {!temAnalise ? (
          <p className="text-sm text-texto-2">
            {s(a.ia_erro)
              ? `A última tentativa deu erro: ${s(a.ia_erro)}`
              : temIA()
                ? "Este anúncio ainda não foi analisado. A coleta diária analisa os mais fortes; você também pode pedir agora."
                : "Para a análise com IA, coloque a ANTHROPIC_API_KEY no arquivo .env (veja o README)."}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                ["Produto", a.produto_nome],
                ["Categoria", a.ia_categoria],
                ["Promessa principal", a.promessa],
                ["Gancho (primeiros segundos)", a.gancho],
                ["Oferta", a.oferta],
                ["Chamada para ação", a.chamada],
                ["Para quem é", a.publico],
                ["Por que funciona", a.por_que_funciona],
              ].map(([r, v]) => (
                <div key={r as string} className="rounded-xl bg-painel-2 p-3">
                  <dt className="text-xs text-texto-3">{r as string}</dt>
                  <dd className="mt-1 text-sm">
                    {r === "Produto" && a.produto_id ? (
                      <Link href={`/produtos/${a.produto_id as string}`} className="text-destaque-forte underline">
                        {String(v ?? "—")}
                      </Link>
                    ) : (
                      String(v ?? "—")
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-bold">3 ideias de anúncio original</h3>
                {ideiasTexto && <BotaoCopiar texto={ideiasTexto} rotulo="Copiar ideias" />}
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {a.ideias.map((i, n) => (
                  <article key={n} className="flex flex-col gap-2 rounded-xl border border-borda bg-painel-2 p-3 text-sm">
                    <h4 className="font-semibold">
                      {n + 1}. {i.titulo}
                    </h4>
                    <p>
                      <span className="text-texto-3">Gancho: </span>
                      {i.gancho}
                    </p>
                    <p className="texto-anuncio text-texto-2">{i.roteiro}</p>
                    <p className="text-xs text-texto-3">🎬 {i.visual}</p>
                  </article>
                ))}
              </div>
              <p className="mt-2 text-xs text-texto-3">
                Use como inspiração: crie seu próprio texto e criativo. Copiar anúncio, imagem ou vídeo de outra pessoa pode
                violar direitos autorais e as regras do Meta.
              </p>
            </div>
            <p className="text-xs text-texto-3">
              Modelo: {String(a.ia_modelo ?? "")} · {a.ia_em ? new Date(String(a.ia_em)).toLocaleString("pt-BR") : ""}
            </p>
          </div>
        )}
      </section>

      {/* Evolução */}
      <section className="flex flex-col gap-3" aria-labelledby="evolucao">
        <h2 id="evolucao" className="text-lg font-bold">
          Evolução
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Grafico
            titulo="Anúncios ativos do anunciante"
            pontos={doAnunciante.map((h) => ({ dia: h.dia, valor: Number(h.anuncios_ativos) }))}
          />
          <Grafico titulo="Pontuação de Escala" pontos={historico.map((h) => ({ dia: h.dia, valor: Number(h.pontuacao) }))} />
        </div>
      </section>

      {/* Favoritos */}
      <section className="rounded-2xl border border-borda bg-painel p-4" aria-labelledby="fav">
        <h2 id="fav" className="mb-3 text-lg font-bold">
          Favoritos e anotações
        </h2>
        <Favorito id={id} inicial={a.favorito} notaInicial={s(a.nota)} />
      </section>

      {irmaos.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Outros anúncios deste anunciante</h2>
          <GradeAnuncios itens={irmaos} />
        </section>
      )}
    </div>
  );
}
