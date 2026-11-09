import { IDIOMAS, PAISES, lerConfig } from "@/lib/config";
import { numerosGerais, ultimasColetas } from "@/lib/consultas";
import { tipoBanco } from "@/lib/db";
import { montarBuscas, temApify, temMeta } from "@/lib/fontes";
import { modeloIA, temIA } from "@/lib/ia";
import { destinoMidia } from "@/lib/midia";
import { chatTelegram, siteUrl, temEmail, temTelegram } from "@/lib/resumo";
import { usuarios } from "@/lib/sessao";
import { nomeBonito } from "@/lib/usuario";

export const dynamic = "force-dynamic";

function Situacao({ ok, sim, nao }: { ok: boolean; sim: string; nao: string }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className={ok ? "text-bom" : "text-alerta"}>
        {ok ? "✓" : "!"}
      </span>
      <span>{ok ? sim : nao}</span>
    </li>
  );
}

export default async function Config({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [cfg, coletas, banco, n] = await Promise.all([lerConfig(), ultimasColetas(10), tipoBanco(), numerosGerais()]);
  const buscas = montarBuscas(cfg).length + cfg.verificarOportunidades;
  const midia = destinoMidia();
  const chat = chatTelegram(cfg.telegramChatId);
  const pessoas = [...usuarios().keys()];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-bold">Configurações</h1>
      {sp.salvo && (
        <p role="status" className="rounded-xl border border-bom/40 bg-bom/10 px-4 py-3 text-sm text-bom">
          Salvo! A próxima coleta já usa estas configurações.
        </p>
      )}
      {sp.aviso && (
        <p role="status" className="rounded-xl border border-destaque/40 bg-destaque/10 px-4 py-3 text-sm">
          {sp.aviso}
        </p>
      )}
      {sp.apagado && (
        <p role="status" className="rounded-xl border border-bom/40 bg-bom/10 px-4 py-3 text-sm text-bom">
          Dados de exemplo apagados.
        </p>
      )}

      <section className="rounded-2xl border border-borda bg-painel p-4">
        <h2 className="mb-2 font-bold">Situação</h2>
        <ul className="flex flex-col gap-1 text-sm text-texto-2">
          <Situacao ok={temApify()} sim="Apify conectado (coleta principal)." nao="Falta o APIFY_TOKEN no .env — sem ele não há coleta." />
          <Situacao
            ok={temIA()}
            sim={`IA ligada (modelo ${modeloIA()}).`}
            nao="Falta a ANTHROPIC_API_KEY no .env — os anúncios aparecem, mas sem análise e sem agrupar produtos."
          />
          <Situacao
            ok={temMeta()}
            sim="API oficial do Meta ligada (módulo opcional)."
            nao="API oficial do Meta desligada (opcional; fora da UE só traz anúncios políticos)."
          />
          <Situacao ok sim={`Banco de dados: ${banco === "sqlite" ? "SQLite (arquivo no computador)" : "Postgres"}.`} nao="" />
          <Situacao
            ok={midia !== null}
            sim={`Criativos guardados ${midia === "blob" ? "no Vercel Blob" : "na pasta dados/midia"}.`}
            nao="Criativos não estão sendo guardados: na Vercel, crie um Blob Store no projeto (README, passo 6)."
          />
          <Situacao
            ok={(temTelegram() && Boolean(chat)) || temEmail()}
            sim={`Resumo diário por ${[temTelegram() && chat ? "Telegram" : "", temEmail() ? "e-mail" : ""].filter(Boolean).join(" e ")}.`}
            nao="Resumo diário desligado: falta configurar o Telegram ou o e-mail (veja abaixo)."
          />
          <Situacao
            ok={pessoas.length > 1}
            sim={`Acesso para ${pessoas.length} pessoas: ${pessoas.map(nomeBonito).join(", ")}.`}
            nao="Acesso para 1 pessoa. Para a sua esposa ter login e favoritos próprios, use USUARIOS no .env (README)."
          />
        </ul>
      </section>

      <form method="post" action="/api/config" className="flex flex-col gap-4 rounded-2xl border border-borda bg-painel p-4">
        <h2 className="font-bold">O que coletar</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">Palavras-chave</span>
          <span className="text-xs text-texto-3">
            Uma por linha. Comece com o país para buscar só nele: <strong>BR: frete grátis</strong>,{" "}
            <strong>US: free shipping</strong>. Sem país, busca em todos os marcados. Entre aspas busca a frase exata (ex.:
            BR: &quot;frete grátis&quot;). Para achar oportunidades, use palavras em inglês para os EUA.
          </span>
          <textarea name="palavrasChave" rows={6} defaultValue={cfg.palavrasChave.join("\n")} className="campo" />
        </label>

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-semibold">Países</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(PAISES).map(([cod, nome]) => (
              <label key={cod} className="flex items-center gap-2 text-texto-2">
                <input type="checkbox" name="paises" value={cod} defaultChecked={cfg.paises.includes(cod)} className="h-4 w-4 accent-[#3987e5]" />
                {nome}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Idioma dos anúncios</span>
            <select name="idioma" defaultValue={cfg.idioma} className="campo">
              {Object.entries(IDIOMAS).map(([cod, nome]) => (
                <option key={cod} value={cod}>
                  {nome}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Anúncios por busca</span>
            <input name="limitePorBusca" type="number" min={10} max={1000} defaultValue={cfg.limitePorBusca} className="campo" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Análises de IA por dia</span>
            <input name="iaMaxPorDia" type="number" min={0} max={1000} defaultValue={cfg.iaMaxPorDia} className="campo" />
          </label>
        </div>

        <h2 className="pt-2 font-bold">🌎 Oportunidades</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">País onde você vende</span>
            <select name="paisAlvo" defaultValue={cfg.paisAlvo} className="campo">
              {Object.entries(PAISES).map(([cod, nome]) => (
                <option key={cod} value={cod}>
                  {nome}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Produtos a conferir por dia no seu país</span>
            <input name="verificarOportunidades" type="number" min={0} max={30} defaultValue={cfg.verificarOportunidades} className="campo" />
            <span className="text-xs text-texto-3">O robô procura cada um pelo nome. Cada um é uma busca a mais no Apify. 0 = desliga.</span>
          </label>
        </div>

        <h2 className="pt-2 font-bold">💾 Guardar criativos</h2>
        <p className="text-xs text-texto-3">
          Os links de imagem e vídeo do Facebook expiram em poucos dias. O site guarda uma cópia dos anúncios fortes e de todos
          os favoritos, para o arquivo “Por mês” continuar com as imagens. Só para estudo: não republique criativos de outras
          pessoas.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Quantos por dia</span>
            <input name="guardarMidiaPorDia" type="number" min={0} max={500} defaultValue={cfg.guardarMidiaPorDia} className="campo" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">A partir de qual pontuação</span>
            <input name="guardarMidiaPontuacao" type="number" min={0} max={100} defaultValue={cfg.guardarMidiaPontuacao} className="campo" />
          </label>
          <label className="flex items-center gap-2 pt-6 text-sm text-texto-2">
            <input type="checkbox" name="guardarVideos" value="1" defaultChecked={cfg.guardarVideos} className="h-4 w-4 accent-[#3987e5]" />
            Guardar vídeos também
          </label>
        </div>

        <h2 className="pt-2 font-bold">📲 Resumo diário</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-texto-2">
            <input type="checkbox" name="resumoAtivo" value="1" defaultChecked={cfg.resumoAtivo} className="h-4 w-4 accent-[#3987e5]" />
            Mandar o resumo depois de cada coleta
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Quantos anúncios no resumo</span>
            <input name="resumoQuantidade" type="number" min={3} max={30} defaultValue={cfg.resumoQuantidade} className="campo" />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">Anunciantes que quero acompanhar sempre (opcional)</span>
          <span className="text-xs text-texto-3">
            ID da página do Facebook, um por linha. Ele aparece no link “Ver todos os anúncios” da Biblioteca:
            view_all_page_id=<strong>123456789</strong>. Todo dia o robô traz todos os anúncios ativos dessas páginas.
          </span>
          <textarea name="anunciantes" rows={3} defaultValue={cfg.anunciantes.join("\n")} className="campo" />
        </label>

        <p className="rounded-xl bg-painel-2 p-3 text-xs text-texto-2">
          Hoje são <strong>{buscas}</strong> buscas por dia × até <strong>{cfg.limitePorBusca}</strong> anúncios = até{" "}
          <strong>{buscas * cfg.limitePorBusca}</strong> anúncios por dia. No robô padrão do Apify (US$ 0,75 por 1.000 anúncios)
          isso dá no máximo cerca de <strong>US$ {((buscas * cfg.limitePorBusca * 30 * 0.75) / 1000).toFixed(2)}</strong> por mês.
        </p>

        <button className="botao self-start">Salvar configurações</button>
      </form>

      <section id="resumo" className="flex flex-col gap-3 rounded-2xl border border-borda bg-painel p-4">
        <h2 className="font-bold">📲 Receber o resumo no celular</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-texto-2">
          <li>
            <strong>Telegram (grátis):</strong> no Telegram, fale com <strong>@BotFather</strong>, mande <code>/newbot</code> e
            siga as perguntas. Ele devolve um token: coloque em <code>TELEGRAM_BOT_TOKEN</code> no .env (ou na Vercel).
          </li>
          <li>Abra o seu robô novo no Telegram e mande um “oi”. Depois clique em “Conectar meu Telegram” abaixo.</li>
          <li>
            <strong>Ou por e-mail:</strong> crie conta grátis em resend.com, pegue a chave e coloque <code>RESEND_API_KEY</code> e{" "}
            <code>RESUMO_EMAIL</code> (o e-mail da sua conta no Resend) no .env.
          </li>
        </ol>
        <p className="text-sm">
          Telegram: {temTelegram() ? (chat ? "✓ conectado" : "token ok, falta conectar o chat") : "não configurado"} · E-mail:{" "}
          {temEmail() ? "✓ configurado" : "não configurado"}
          {!siteUrl() && " · Dica: coloque SITE_URL no .env para o resumo ter links que abrem o painel."}
        </p>
        <div className="flex flex-wrap gap-2">
          {temTelegram() && (
            <form method="post" action="/api/resumo">
              <input type="hidden" name="acao" value="telegram" />
              <button className="botao-sec">Conectar meu Telegram</button>
            </form>
          )}
          <form method="post" action="/api/resumo">
            <input type="hidden" name="acao" value="enviar" />
            <button className="botao-sec">Enviar resumo agora</button>
          </form>
        </div>
      </section>

      <section className="rounded-2xl border border-borda bg-painel p-4">
        <h2 className="mb-2 font-bold">Últimas coletas</h2>
        {coletas.length === 0 ? (
          <p className="text-sm text-texto-3">Nenhuma coleta ainda.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-borda text-sm">
            {coletas.map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5 py-2">
                <span>
                  <strong
                    className={c.status === "concluida" ? "text-bom" : c.status === "erro" ? "text-ruim" : "text-alerta"}
                  >
                    {c.status}
                  </strong>{" "}
                  · {new Date(c.inicio).toLocaleString("pt-BR")} · {c.fonte}
                </span>
                {c.mensagem && <span className="text-xs text-texto-2">{c.mensagem}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="exemplo" className="rounded-2xl border border-borda bg-painel p-4">
        <h2 className="mb-2 font-bold">Dados de exemplo</h2>
        <p className="mb-3 text-sm text-texto-2">
          {n.exemplo > 0
            ? `Há ${n.exemplo} anúncios de exemplo (inventados) no banco.`
            : "Não há dados de exemplo no banco."}
        </p>
        {n.exemplo > 0 && (
          <form method="post" action="/api/config">
            <input type="hidden" name="acao" value="apagar-exemplo" />
            <button className="botao-sec">Apagar dados de exemplo</button>
          </form>
        )}
      </section>

      <form method="post" action="/api/sair">
        <button className="botao-sec">Sair</button>
      </form>
    </div>
  );
}
