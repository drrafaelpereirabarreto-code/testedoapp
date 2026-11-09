// Funções pequenas usadas em todo o projeto (datas, textos, números).

export function fuso(): string {
  return process.env.FUSO_HORARIO || "America/Sao_Paulo";
}

/** Data de hoje no fuso configurado, no formato AAAA-MM-DD. */
export function hojeISO(agora: Date = new Date()): string {
  return dataISO(agora);
}

/** Converte um Date para AAAA-MM-DD no fuso configurado. */
export function dataISO(d: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}`;
}

/** Soma (ou subtrai) dias de uma data AAAA-MM-DD. */
export function somarDias(diaISO: string, dias: number): string {
  const [a, m, d] = diaISO.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

/** Dias entre duas datas AAAA-MM-DD (b - a). */
export function diasEntre(a: string, b: string): number {
  const ta = Date.parse(a + "T00:00:00Z");
  const tb = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.round((tb - ta) / 86_400_000);
}

/** Transforma um nome em identificador: "Escova Alisadora 3 em 1" -> "escova-alisadora-3-em-1". */
export function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Domínio de um link, sem "www.". */
export function dominio(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    // Links do Facebook que redirecionam: o destino real vem no parâmetro "u".
    if (/(^|\.)facebook\.com$/.test(u.hostname) && u.searchParams.get("u")) {
      return dominio(u.searchParams.get("u"));
    }
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// Sites usados por muita gente (marketplaces, redes sociais, plataformas de curso).
// Nesses, só o caminho completo identifica a página; a página inicial sozinha não diz nada.
const SITES_COMPARTILHADOS = [
  "facebook.com", "fb.me", "fb.com", "instagram.com", "whatsapp.com", "wa.me", "m.me", "messenger.com",
  "linktr.ee", "bit.ly", "google.com", "youtube.com", "tiktok.com", "apps.apple.com", "play.google.com",
  "shopee.com.br", "mercadolivre.com.br", "amazon.com", "amazon.com.br", "hotmart.com", "kiwify.com.br",
  "eduzz.com", "monetizze.com.br", "shopify.com", "myshopify.com", "wixsite.com", "beacons.ai",
];

const SEM_PAGINA = ["facebook.com", "fb.me", "fb.com", "instagram.com", "whatsapp.com", "wa.me", "m.me", "messenger.com"];

/**
 * Identifica a "página de destino" de um anúncio (site + caminho, sem os parâmetros de rastreio).
 * Devolve null quando o link não identifica uma página própria (ex.: só "instagram.com/").
 */
export function chaveDestino(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    let u = new URL(url);
    if (/(^|\.)facebook\.com$/.test(u.hostname) && u.searchParams.get("u")) u = new URL(u.searchParams.get("u")!);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const caminho = u.pathname.replace(/\/+$/, "").toLowerCase();
    const casa = (d: string) => host === d || host.endsWith("." + d);
    // Links para Facebook, Instagram, WhatsApp e Messenger não dizem qual é o produto.
    if (SEM_PAGINA.some(casa)) return null;
    if (!caminho && SITES_COMPARTILHADOS.some(casa)) return null;
    return host + caminho;
  } catch {
    return null;
  }
}

export function numero(v: unknown, padrao = 0): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : padrao;
}

export function jsonSeguro<T>(texto: string | null | undefined, padrao: T): T {
  if (!texto) return padrao;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return padrao;
  }
}

export function formatarData(diaISO: string | null | undefined): string {
  if (!diaISO) return "—";
  const [a, m, d] = diaISO.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function nomeMes(mesISO: string): string {
  const [a, m] = mesISO.split("-").map(Number);
  return `${MESES[m - 1]} de ${a}`;
}
