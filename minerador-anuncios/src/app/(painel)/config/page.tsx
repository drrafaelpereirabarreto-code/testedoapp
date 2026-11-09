import { IDIOMAS, PAISES, lerConfig } from "@/lib/config";
import { numerosGerais, ultimasColetas } from "@/lib/consultas";
import { tipoBanco } from "@/lib/db";
import { montarBuscas, temApify, temMeta } from "@/lib/fontes";
import { modeloIA, temIA } from "@/lib/ia";

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
  const buscas = montarBuscas(cfg).length;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-bold">Configurações</h1>
      {sp.salvo && (
        <p role="status" className="rounded-xl border border-bom/40 bg-bom/10 px-4 py-3 text-sm text-bom">
          Salvo! A próxima coleta já usa estas configurações.
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
        </ul>
      </section>

      <form method="post" action="/api/config" className="flex flex-col gap-4 rounded-2xl border border-borda bg-painel p-4">
        <h2 className="font-bold">O que coletar</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">Palavras-chave</span>
          <span className="text-xs text-texto-3">
            Uma por linha. Coloque entre aspas para buscar a frase exata (ex.: &quot;frete grátis&quot;).
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
