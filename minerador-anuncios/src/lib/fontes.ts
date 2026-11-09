// De onde vêm os anúncios.
//  1) Apify (principal): um robô abre a Biblioteca de Anúncios e devolve os anúncios.
//  2) API oficial do Meta (opcional): só traz dados completos de anúncios políticos fora da UE.

import type { Configuracao } from "./config";
import { normalizarApify, normalizarMeta, type AnuncioNormalizado } from "./normalizar";

const APIFY = "https://api.apify.com/v2";

export interface Busca {
  url: string;
  pais: string | null;
  palavraChave: string | null;
}

/** Monta os links de busca da Biblioteca de Anúncios (palavra-chave x país, e anunciantes acompanhados). */
export function montarBuscas(c: Configuracao): Busca[] {
  const buscas: Busca[] = [];
  const paises = c.paises.length ? c.paises : ["BR"];
  for (const pais of paises) {
    for (const termo of c.palavrasChave) {
      const exata = /^".*"$/.test(termo);
      const q = termo.replace(/^"|"$/g, "");
      const p = new URLSearchParams({
        active_status: "active",
        ad_type: "all",
        country: pais,
        media_type: "all",
        q,
        search_type: exata ? "keyword_exact_phrase" : "keyword_unordered",
      });
      if (c.idioma) p.set("content_languages[0]", c.idioma);
      buscas.push({ url: `https://www.facebook.com/ads/library/?${p.toString()}`, pais, palavraChave: q });
    }
    for (const pagina of c.anunciantes) {
      const p = new URLSearchParams({
        active_status: "active",
        ad_type: "all",
        country: pais,
        media_type: "all",
        search_type: "page",
        view_all_page_id: pagina,
      });
      buscas.push({ url: `https://www.facebook.com/ads/library/?${p.toString()}`, pais, palavraChave: null });
    }
  }
  return buscas;
}

function tokenApify(): string {
  const t = process.env.APIFY_TOKEN?.trim();
  if (!t) throw new Error("Falta o APIFY_TOKEN no arquivo .env (veja o README, passo 2).");
  return t;
}

function actorApify(): string {
  // A API do Apify usa "usuario~robo" no lugar de "usuario/robo".
  return (process.env.APIFY_ACTOR || "curious_coder/facebook-ads-library-scraper").trim().replace("/", "~");
}

/** Entrada do robô. Cada robô tem seu formato; cobrimos os mais usados. */
export function entradaApify(actor: string, buscas: Busca[], limite: number): Record<string, unknown> {
  const nome = actor.replace("~", "/");
  if (nome.startsWith("memo23/")) {
    return { startUrls: buscas.map((b) => b.url), maxItems: limite * buscas.length };
  }
  if (nome.startsWith("apify/")) {
    return {
      startUrls: buscas.map((b) => ({ url: b.url })),
      resultsLimit: limite,
      activeStatus: "active",
    };
  }
  // curious_coder/facebook-ads-library-scraper (padrão) e parecidos.
  return {
    urls: buscas.map((b) => ({ url: b.url })),
    limitPerSource: limite,
    count: limite * buscas.length,
    scrapeAdDetails: false,
    "scrapePageAds.activeStatus": "active",
  };
}

async function apify<T>(caminho: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${APIFY}${caminho}`, {
    ...init,
    headers: { Authorization: `Bearer ${tokenApify()}`, "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (!r.ok) {
    const corpo = await r.text().catch(() => "");
    if (r.status === 401) throw new Error("O Apify recusou o token (APIFY_TOKEN errado?).");
    if (r.status === 402) throw new Error("Acabou o crédito do Apify neste mês (erro 402).");
    if (r.status === 404) throw new Error(`Robô do Apify não encontrado: ${actorApify()}. Confira APIFY_ACTOR.`);
    throw new Error(`Apify respondeu ${r.status}: ${corpo.slice(0, 300)}`);
  }
  return (await r.json()) as T;
}

interface ExecucaoApify {
  id: string;
  status: string; // READY, RUNNING, SUCCEEDED, FAILED, ABORTED, TIMED-OUT
  defaultDatasetId: string;
  statusMessage?: string;
}

/** Inicia o robô no Apify e devolve o ID da execução (não espera terminar). */
export async function iniciarApify(buscas: Busca[], limite: number): Promise<string> {
  const actor = actorApify();
  const r = await apify<{ data: ExecucaoApify }>(`/acts/${actor}/runs`, {
    method: "POST",
    body: JSON.stringify(entradaApify(actor, buscas, limite)),
  });
  return r.data.id;
}

export async function situacaoApify(execucaoId: string): Promise<ExecucaoApify> {
  return (await apify<{ data: ExecucaoApify }>(`/actor-runs/${execucaoId}`)).data;
}

/** Baixa os anúncios de uma execução que terminou e normaliza. */
export async function resultadosApify(execucao: ExecucaoApify, buscas: Busca[]): Promise<AnuncioNormalizado[]> {
  const itens: unknown[] = [];
  for (let offset = 0; ; offset += 1000) {
    const parte = await apify<unknown[]>(
      `/datasets/${execucao.defaultDatasetId}/items?clean=true&format=json&offset=${offset}&limit=1000`,
    );
    itens.push(...parte);
    if (parte.length < 1000) break;
  }
  const porUrl = new Map(buscas.map((b) => [b.url, b]));
  const saida: AnuncioNormalizado[] = [];
  for (const item of itens) {
    const o = (item ?? {}) as Record<string, unknown>;
    // Descobre de qual busca veio o anúncio (para saber país e palavra-chave).
    const origem = String(o.url ?? o.inputUrl ?? o.input_url ?? o.searchUrl ?? "");
    const busca = porUrl.get(origem) ?? buscas.find((b) => origem && origem.includes(encodeURIComponent(b.palavraChave ?? "§")));
    const pais = busca?.pais ?? (new URLSearchParams(origem.split("?")[1] || "").get("country") || null);
    const n = normalizarApify(item, { fonte: "apify", pais, palavraChave: busca?.palavraChave ?? null });
    if (n) saida.push(n);
  }
  return saida;
}

/** Coleta pela API oficial do Meta (módulo opcional). */
export async function coletarMeta(c: Configuracao): Promise<AnuncioNormalizado[]> {
  const token = process.env.META_TOKEN?.trim();
  if (!token) return [];
  const saida: AnuncioNormalizado[] = [];
  const campos = [
    "id", "page_id", "page_name", "ad_creative_bodies", "ad_creative_link_titles",
    "ad_creative_link_captions", "ad_creative_link_descriptions", "ad_delivery_start_time",
    "ad_delivery_stop_time", "publisher_platforms", "languages",
  ].join(",");
  for (const pais of c.paises) {
    for (const termo of c.palavrasChave) {
      const p = new URLSearchParams({
        search_terms: termo.replace(/^"|"$/g, ""),
        ad_reached_countries: JSON.stringify([pais]),
        ad_active_status: "ACTIVE",
        ad_type: "ALL",
        fields: campos,
        limit: String(Math.min(c.limitePorBusca, 100)),
        access_token: token,
      });
      if (c.idioma) p.set("languages", JSON.stringify([c.idioma]));
      const r = await fetch(`https://graph.facebook.com/v23.0/ads_archive?${p}`, { cache: "no-store" });
      if (!r.ok) {
        // Erro comum: fora da UE, a API só aceita anúncios políticos. Segue para a próxima busca.
        continue;
      }
      const j = (await r.json()) as { data?: unknown[] };
      for (const item of j.data ?? []) {
        const n = normalizarMeta(item, { fonte: "meta", pais, palavraChave: termo });
        if (n) saida.push(n);
      }
    }
  }
  return saida;
}

export function temApify(): boolean {
  return Boolean(process.env.APIFY_TOKEN?.trim());
}

export function temMeta(): boolean {
  return Boolean(process.env.META_TOKEN?.trim());
}
