// Guarda uma cópia das imagens e vídeos dos anúncios fortes.
// Os links de mídia do Facebook expiram em poucos dias; sem a cópia, o arquivo "Por mês" ficaria sem imagens.
//  - No seu computador/servidor: arquivos em dados/midia/ (servidos só para quem fez login, em /api/midia/...).
//  - Na Vercel: Vercel Blob (crie um "Blob Store" no projeto; a Vercel coloca BLOB_READ_WRITE_TOKEN sozinha).
// É para estudo pessoal: não republique criativos de outras pessoas.

import fs from "node:fs/promises";
import path from "node:path";
import { lerConfig } from "./config";
import { executar, todos } from "./db";

const LIMITE_IMAGEM = 8 * 1024 * 1024; // 8 MB
const LIMITE_VIDEO = 40 * 1024 * 1024; // 40 MB

export function pastaMidia(): string {
  return process.env.MIDIA_PASTA || path.join(process.cwd(), "dados", "midia");
}

/** Onde guardar: "blob" (Vercel Blob), "disco" (pasta local) ou null (sem lugar fixo, ex.: Vercel sem Blob). */
export function destinoMidia(): "blob" | "disco" | null {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  if (process.env.VERCEL) return null; // o disco da Vercel some a cada execução
  return "disco";
}

const EXTENSOES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

async function baixar(url: string, limite: number): Promise<{ dados: Buffer; tipo: string } | null> {
  if (!/^https?:\/\//.test(url)) return null; // ex.: imagens de exemplo (data:) já são permanentes
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) return null;
    const tipo = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!EXTENSOES[tipo]) return null;
    const tamanho = Number(r.headers.get("content-length") ?? 0);
    if (tamanho > limite) return null;
    const dados = Buffer.from(await r.arrayBuffer());
    if (dados.length > limite) return null;
    return { dados, tipo };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Salva o arquivo e devolve o endereço para usar no site. */
async function salvar(nome: string, dados: Buffer, tipo: string): Promise<string | null> {
  const destino = destinoMidia();
  if (destino === "blob") {
    const { put } = await import("@vercel/blob");
    const r = await put(`criativos/${nome}`, dados, { access: "public", addRandomSuffix: true, contentType: tipo });
    return r.url;
  }
  if (destino === "disco") {
    await fs.mkdir(pastaMidia(), { recursive: true });
    await fs.writeFile(path.join(pastaMidia(), nome), dados);
    return `/api/midia/${nome}`;
  }
  return null;
}

interface Alvo {
  id: string;
  imagem_url: string | null;
  video_url: string | null;
  video_capa: string | null;
  criativo_chave: string | null;
}

async function guardarUm(a: Alvo, comVideo: boolean): Promise<boolean> {
  const hoje = new Date().toISOString().slice(0, 10);
  await executar("UPDATE anuncios SET midia_tentativa = ? WHERE id = ?", [hoje, a.id]);

  // Mesmo criativo já guardado em outro anúncio? Reaproveita, sem baixar de novo.
  if (a.criativo_chave) {
    const igual = await todos<{ imagem_salva: string | null; video_salvo: string | null }>(
      "SELECT imagem_salva, video_salvo FROM anuncios WHERE criativo_chave = ? AND imagem_salva IS NOT NULL AND id <> ? LIMIT 1",
      [a.criativo_chave, a.id],
    );
    if (igual[0]) {
      await executar("UPDATE anuncios SET imagem_salva = ?, video_salvo = COALESCE(?, video_salvo) WHERE id = ?", [
        igual[0].imagem_salva,
        igual[0].video_salvo,
        a.id,
      ]);
      return true;
    }
  }

  let imagem: string | null = null;
  const fonteImagem = a.video_capa || a.imagem_url;
  if (fonteImagem) {
    const b = await baixar(fonteImagem, LIMITE_IMAGEM);
    if (b && b.tipo.startsWith("image/")) imagem = await salvar(`${a.id}.${EXTENSOES[b.tipo]}`, b.dados, b.tipo);
  }
  let video: string | null = null;
  if (comVideo && a.video_url) {
    const b = await baixar(a.video_url, LIMITE_VIDEO);
    if (b && b.tipo.startsWith("video/")) video = await salvar(`${a.id}.${EXTENSOES[b.tipo]}`, b.dados, b.tipo);
  }
  if (!imagem && !video) return false;
  await executar("UPDATE anuncios SET imagem_salva = COALESCE(?, imagem_salva), video_salvo = COALESCE(?, video_salvo) WHERE id = ?", [
    imagem,
    video,
    a.id,
  ]);
  return true;
}

const COLUNAS = "id, imagem_url, video_url, video_capa, criativo_chave";

/** Guarda a mídia de anúncios específicos (ex.: quando você salva nos favoritos). */
export async function guardarMidiaDe(ids: string[]): Promise<number> {
  if (!destinoMidia() || ids.length === 0) return 0;
  const cfg = await lerConfig();
  const alvos = await todos<Alvo>(
    `SELECT ${COLUNAS} FROM anuncios WHERE imagem_salva IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  let n = 0;
  for (const a of alvos) if (await guardarUm(a, cfg.guardarVideos)) n++;
  return n;
}

/**
 * Depois da coleta: guarda os criativos fortes do dia (pontuação alta ou "escalando") e os favoritos.
 * Tenta cada anúncio no máximo uma vez por dia.
 */
export async function guardarMidiaDoDia(dia: string, prazo: number): Promise<number> {
  if (!destinoMidia()) return 0;
  const cfg = await lerConfig();
  if (cfg.guardarMidiaPorDia <= 0) return 0;
  const alvos = await todos<Alvo>(
    `SELECT ${COLUNAS} FROM anuncios
     WHERE ultima_vez = ? AND imagem_salva IS NULL AND (midia_tentativa IS NULL OR midia_tentativa < ?)
       AND (pontuacao >= ? OR escalando = 1 OR id IN (SELECT anuncio_id FROM favoritos_usuarios))
     ORDER BY escalando DESC, pontuacao DESC LIMIT ?`,
    [dia, new Date().toISOString().slice(0, 10), cfg.guardarMidiaPontuacao, cfg.guardarMidiaPorDia],
  );
  let n = 0;
  const fila = [...alvos];
  const trabalhar = async () => {
    while (fila.length && Date.now() < prazo) {
      if (await guardarUm(fila.shift()!, cfg.guardarVideos)) n++;
    }
  };
  await Promise.all([trabalhar(), trabalhar(), trabalhar(), trabalhar()]);
  return n;
}
