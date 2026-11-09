// Configurações que você muda pelo próprio painel (página Configurações).
// Ficam guardadas no banco; se não houver nada salvo, valem os padrões abaixo.

import { executar, todos } from "./db";

export interface Configuracao {
  palavrasChave: string[];
  paises: string[];
  idioma: string; // "" = todos, "pt", "en", "es"...
  anunciantes: string[]; // IDs de páginas do Facebook para acompanhar sempre
  limitePorBusca: number;
  iaMaxPorDia: number;
  /** País onde você vende (página "Oportunidades"). */
  paisAlvo: string;
  /** Quantos produtos fortes lá fora o robô confere todo dia no seu país (busca pelo nome do produto). */
  verificarOportunidades: number;
  /** Guardar cópia dos criativos: quantos por dia e a partir de qual pontuação. */
  guardarMidiaPorDia: number;
  guardarMidiaPontuacao: number;
  guardarVideos: boolean;
  /** Resumo diário. */
  resumoAtivo: boolean;
  resumoQuantidade: number;
  telegramChatId: string;
  ultimoResumo: string;
}

export const PADRAO: Configuracao = {
  // "BR: ..." busca só no Brasil; "US: ..." só nos EUA; sem prefixo, em todos os países marcados.
  palavrasChave: [
    "BR: frete grátis",
    "BR: últimas unidades",
    "BR: compre agora",
    "BR: ebook",
    "BR: curso",
    "US: free shipping",
    "US: limited stock",
    "US: shop now",
  ],
  paises: ["BR", "US"],
  idioma: "",
  anunciantes: [],
  limitePorBusca: Number(process.env.APIFY_LIMITE_POR_BUSCA) || 50,
  iaMaxPorDia: Number(process.env.IA_MAX_POR_DIA) || 30,
  paisAlvo: "BR",
  verificarOportunidades: 5,
  guardarMidiaPorDia: 40,
  guardarMidiaPontuacao: 55,
  guardarVideos: true,
  resumoAtivo: true,
  resumoQuantidade: 10,
  telegramChatId: "",
  ultimoResumo: "",
};

export const PAISES: Record<string, string> = {
  BR: "Brasil",
  US: "Estados Unidos",
  PT: "Portugal",
  MX: "México",
  AR: "Argentina",
  CO: "Colômbia",
  CL: "Chile",
  ES: "Espanha",
  GB: "Reino Unido",
  CA: "Canadá",
  AU: "Austrália",
  DE: "Alemanha",
  FR: "França",
  IT: "Itália",
};

export const IDIOMAS: Record<string, string> = {
  "": "Todos os idiomas",
  pt: "Português",
  en: "Inglês",
  es: "Espanhol",
  fr: "Francês",
  de: "Alemão",
  it: "Italiano",
};

export async function lerConfig(): Promise<Configuracao> {
  const linhas = await todos<{ chave: string; valor: string }>("SELECT chave, valor FROM config");
  const c: Configuracao = { ...PADRAO };
  for (const { chave, valor } of linhas) {
    try {
      const v = JSON.parse(valor);
      if (chave in c) (c as unknown as Record<string, unknown>)[chave] = v;
    } catch {
      /* ignora valor estragado */
    }
  }
  return c;
}

export async function salvarConfig(parcial: Partial<Configuracao>): Promise<void> {
  for (const [chave, valor] of Object.entries(parcial)) {
    if (!(chave in PADRAO) || valor === undefined) continue;
    await executar(
      "INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor",
      [chave, JSON.stringify(valor)],
    );
  }
}

/** Lê uma lista digitada pela pessoa (uma por linha ou separada por vírgula). */
export function lerLista(texto: string): string[] {
  return Array.from(
    new Set(
      texto
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

/** Separa "US: free shipping" em país "US" e termo "free shipping". Sem prefixo, país = null (todos). */
export function lerPalavraChave(linha: string): { pais: string | null; termo: string } {
  const m = /^([A-Za-z]{2})\s*:\s*(.+)$/.exec(linha.trim());
  if (m && m[1].toUpperCase() in PAISES) return { pais: m[1].toUpperCase(), termo: m[2].trim() };
  return { pais: null, termo: linha.trim() };
}
