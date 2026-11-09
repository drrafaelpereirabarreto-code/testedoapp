// Converte o que cada robô devolve num formato único.
// Cada robô do Apify usa nomes um pouco diferentes (ad_archive_id, adArchiveID...),
// então aqui procuramos o campo em vários nomes possíveis.

import { createHash } from "node:crypto";
import { dataISO, dominio } from "./util";

export interface AnuncioNormalizado {
  id: string;
  fonte: string;
  pagina_id: string | null;
  pagina_nome: string | null;
  pagina_foto: string | null;
  texto: string | null;
  titulo: string | null;
  descricao: string | null;
  cta: string | null;
  link_destino: string | null;
  dominio: string | null;
  imagem_url: string | null;
  video_url: string | null;
  video_capa: string | null;
  formato: string | null;
  plataformas: string[];
  pais: string | null;
  palavra_chave: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  ativo: boolean;
  colacao_id: string | null;
  colacao_qtd: number;
  criativo_chave: string | null;
  biblioteca_url: string;
}

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}

/** Procura o primeiro valor preenchido entre vários caminhos ("snapshot.body.text"). */
function pegar(o: Obj | null, ...caminhos: string[]): unknown {
  if (!o) return undefined;
  for (const c of caminhos) {
    let atual: unknown = o;
    for (const parte of c.split(".")) {
      const ob = obj(atual);
      if (Array.isArray(atual) && /^\d+$/.test(parte)) atual = atual[Number(parte)];
      else atual = ob ? ob[parte] : undefined;
      if (atual === undefined || atual === null) break;
    }
    if (atual !== undefined && atual !== null && atual !== "") return atual;
  }
  return undefined;
}

function texto(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    // Alguns campos chegam como modelo do Facebook ("{{product.name}}"): não é texto real.
    if (!t || /^\{\{.*\}\}$/.test(t)) return null;
    return t;
  }
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return texto(v.find((x) => texto(x)));
  const o = obj(v);
  if (o) return texto(o.text ?? o.markup ?? o.__html);
  return null;
}

/** Tira tags HTML de textos que vêm em "markup". */
function semHtml(t: string | null): string | null {
  if (!t) return t;
  return t
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** Datas chegam como segundos Unix, milissegundos ou texto. */
export function lerData(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))) {
    const n = Number(v);
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : dataISO(d);
  }
  if (typeof v === "string") {
    // Data pura (sem hora) já está no dia certo: não converte de fuso.
    if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return dataISO(d);
    const m = v.match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  return null;
}

const NOMES_PLATAFORMA: Record<string, string> = {
  FACEBOOK: "FACEBOOK",
  INSTAGRAM: "INSTAGRAM",
  MESSENGER: "MESSENGER",
  AUDIENCE_NETWORK: "AUDIENCE_NETWORK",
  AUDIENCENETWORK: "AUDIENCE_NETWORK",
  THREADS: "THREADS",
  WHATSAPP: "WHATSAPP",
};

function plataformas(v: unknown): string[] {
  const lista = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;|]/) : [];
  const out = new Set<string>();
  for (const p of lista) {
    const chave = String(p).trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (NOMES_PLATAFORMA[chave]) out.add(NOMES_PLATAFORMA[chave]);
    else if (NOMES_PLATAFORMA[chave.replace(/_/g, "")]) out.add(NOMES_PLATAFORMA[chave.replace(/_/g, "")]);
  }
  return [...out];
}

/** Uma "impressão digital" do criativo: o mesmo vídeo/imagem em vários anúncios gera a mesma chave. */
export function chaveCriativo(midiaUrl: string | null, textoAnuncio: string | null): string | null {
  let base = "";
  if (midiaUrl) {
    try {
      // O nome do arquivo no CDN do Facebook identifica a mídia; os parâmetros mudam a cada coleta.
      base = new URL(midiaUrl).pathname.split("/").pop() || "";
    } catch {
      base = midiaUrl;
    }
  }
  if (!base && textoAnuncio) base = textoAnuncio.toLowerCase().replace(/\s+/g, " ").slice(0, 300);
  if (!base) return null;
  return createHash("sha1").update(base).digest("hex").slice(0, 16);
}

export interface Contexto {
  fonte: string;
  pais?: string | null;
  palavraChave?: string | null;
}

/** Normaliza um item vindo do Apify (qualquer um dos robôs mais usados). */
export function normalizarApify(item: unknown, ctx: Contexto): AnuncioNormalizado | null {
  const o = obj(item);
  if (!o) return null;
  const id = texto(pegar(o, "ad_archive_id", "adArchiveID", "adArchiveId", "ad_id", "adId", "id"));
  if (!id || !/^\d+$/.test(id)) return null;

  const snap = obj(pegar(o, "snapshot")) ?? o;
  const card0 = obj(pegar(snap, "cards.0"));

  const corpo = semHtml(
    texto(pegar(snap, "body.text", "body.markup.__html", "body", "ad_creative_body")) ??
      texto(pegar(card0, "body")) ??
      texto(pegar(o, "ad_creative_bodies", "adText", "body", "text")),
  );
  const titulo = texto(pegar(snap, "title", "link_title")) ?? texto(pegar(card0, "title")) ?? texto(pegar(o, "title", "headline"));
  const descricao =
    texto(pegar(snap, "link_description", "linkDescription", "caption")) ?? texto(pegar(card0, "link_description", "caption"));
  const cta = texto(pegar(snap, "cta_text", "ctaText")) ?? texto(pegar(card0, "cta_text", "ctaText")) ?? texto(pegar(o, "cta"));
  const link =
    texto(pegar(snap, "link_url", "linkUrl")) ??
    texto(pegar(card0, "link_url", "linkUrl")) ??
    texto(pegar(o, "landing_url", "landingUrl", "link_url", "Website"));

  const imagem =
    texto(pegar(snap, "images.0.original_image_url", "images.0.originalImageUrl", "images.0.resized_image_url", "images.0.resizedImageUrl")) ??
    texto(pegar(card0, "original_image_url", "originalImageUrl", "resized_image_url", "resizedImageUrl")) ??
    texto(pegar(o, "imageUrl", "image_url"));
  const video =
    texto(pegar(snap, "videos.0.video_hd_url", "videos.0.videoHdUrl", "videos.0.video_sd_url", "videos.0.videoSdUrl")) ??
    texto(pegar(card0, "video_hd_url", "videoHdUrl", "video_sd_url", "videoSdUrl")) ??
    texto(pegar(o, "videoUrl", "video_url"));
  const capa =
    texto(pegar(snap, "videos.0.video_preview_image_url", "videos.0.videoPreviewImageUrl")) ??
    texto(pegar(card0, "video_preview_image_url", "videoPreviewImageUrl"));

  const paginaId = texto(pegar(o, "page_id", "pageID", "pageId", "snapshot.page_id"));
  const ativoBruto = pegar(o, "is_active", "isActive", "active");
  const colacao = Number(pegar(o, "collation_count", "collationCount") ?? 1);

  return {
    id,
    fonte: ctx.fonte,
    pagina_id: paginaId,
    pagina_nome: texto(pegar(o, "page_name", "pageName", "snapshot.page_name", "Company Name")),
    pagina_foto: texto(pegar(snap, "page_profile_picture_url", "pageProfilePictureUrl")),
    texto: corpo,
    titulo,
    descricao,
    cta,
    link_destino: link,
    dominio: dominio(link),
    imagem_url: imagem ?? capa,
    video_url: video,
    video_capa: capa,
    formato: texto(pegar(snap, "display_format", "displayFormat")) ?? (video ? "VIDEO" : imagem ? "IMAGE" : null),
    plataformas: plataformas(pegar(o, "publisher_platform", "publisherPlatform", "publisher_platforms", "platforms")),
    pais: ctx.pais ?? null,
    palavra_chave: ctx.palavraChave ?? null,
    data_inicio: lerData(pegar(o, "start_date", "startDate", "start_date_formatted", "startDateFormatted", "ad_delivery_start_time")),
    data_fim: lerData(pegar(o, "end_date", "endDate", "end_date_formatted", "endDateFormatted", "ad_delivery_stop_time")),
    ativo: ativoBruto === undefined ? true : ativoBruto === true || ativoBruto === "true" || ativoBruto === 1,
    colacao_id: texto(pegar(o, "collation_id", "collationID", "collationId")),
    colacao_qtd: Number.isFinite(colacao) && colacao > 0 ? Math.round(colacao) : 1,
    criativo_chave: chaveCriativo(video ?? imagem ?? capa, corpo),
    biblioteca_url: `https://www.facebook.com/ads/library/?id=${id}`,
  };
}

/** Normaliza um item da API oficial do Meta (endpoint ads_archive). */
export function normalizarMeta(item: unknown, ctx: Contexto): AnuncioNormalizado | null {
  const o = obj(item);
  if (!o) return null;
  const id = texto(o.id);
  if (!id) return null;
  const corpo = texto(o.ad_creative_bodies);
  const link = texto(o.ad_creative_link_captions);
  const fim = lerData(o.ad_delivery_stop_time);
  return {
    id,
    fonte: "meta",
    pagina_id: texto(o.page_id),
    pagina_nome: texto(o.page_name),
    pagina_foto: null,
    texto: corpo,
    titulo: texto(o.ad_creative_link_titles),
    descricao: texto(o.ad_creative_link_descriptions),
    cta: null,
    link_destino: link && /^https?:/.test(link) ? link : link ? `https://${link}` : null,
    dominio: dominio(link && /^https?:/.test(link) ? link : link ? `https://${link}` : null),
    imagem_url: null,
    video_url: null,
    video_capa: null,
    formato: null,
    plataformas: plataformas(o.publisher_platforms),
    pais: ctx.pais ?? null,
    palavra_chave: ctx.palavraChave ?? null,
    data_inicio: lerData(o.ad_delivery_start_time),
    data_fim: fim,
    ativo: !fim,
    colacao_id: null,
    colacao_qtd: 1,
    criativo_chave: chaveCriativo(null, corpo),
    // O "ad_snapshot_url" da API traz o seu token no link: não guardamos.
    biblioteca_url: `https://www.facebook.com/ads/library/?id=${id}`,
  };
}
