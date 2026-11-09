// Análise com IA (Claude, da Anthropic).
// Para cada anúncio: categoria, produto, promessa, gancho, oferta, chamada para ação
// e 3 ideias de anúncio ORIGINAL inspirado no vencedor (sem copiar texto ou imagem).

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const CATEGORIAS = [
  "beleza",
  "saúde",
  "fitness",
  "casa",
  "cozinha",
  "pets",
  "infoproduto",
  "moda",
  "acessórios",
  "eletrônicos",
  "infantil",
  "automotivo",
  "ferramentas",
  "finanças",
  "serviços",
  "outros",
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

const Analise = z.object({
  categoria: z.enum(CATEGORIAS),
  produto_nome: z.string().describe("Nome curto e genérico do produto, em português, sem marca. Ex.: 'Escova alisadora 3 em 1'"),
  promessa: z.string().describe("A promessa principal do anúncio, em 1 frase"),
  gancho: z.string().describe("O gancho dos primeiros segundos / primeira linha que prende a atenção"),
  oferta: z.string().describe("A oferta: preço, desconto, frete, bônus, garantia, escassez. 'Não informada' se não houver"),
  chamada: z.string().describe("A chamada para ação"),
  publico: z.string().describe("Para quem o anúncio parece ser feito"),
  por_que_funciona: z.string().describe("Em 1 a 2 frases, por que este anúncio provavelmente vende"),
  ideias: z
    .array(
      z.object({
        titulo: z.string(),
        gancho: z.string().describe("Primeira frase / primeiros 3 segundos"),
        roteiro: z.string().describe("Roteiro curto ou texto do anúncio, 3 a 6 frases"),
        visual: z.string().describe("Descrição do criativo (imagem ou vídeo) a produzir"),
      }),
    )
    .describe("Exatamente 3 ideias de anúncio original"),
});

export type ResultadoAnalise = z.infer<typeof Analise>;

const SISTEMA = `Você é um estrategista de marketing de resposta direta que ajuda um iniciante brasileiro a estudar anúncios vencedores do Facebook e Instagram.

Você recebe um anúncio coletado da Biblioteca de Anúncios do Meta (texto, título, chamada, link e, às vezes, a imagem). Sua tarefa:
1. Classificar a categoria do produto (use "infoproduto" para cursos, ebooks, mentorias e produtos digitais).
2. Identificar o produto em si com um nome curto, genérico e sem marca, para agrupar anúncios do mesmo produto vindos de anunciantes diferentes. Se a lista de produtos já conhecidos tiver o mesmo produto, repita exatamente aquele nome.
3. Resumir a promessa principal, o gancho, a oferta e a chamada para ação, e dizer para quem é e por que funciona.
4. Sugerir 3 ideias de anúncio ORIGINAL inspiradas na estratégia do vencedor (ângulo, emoção, estrutura), nunca copiando frases, nomes, marcas, imagens ou depoimentos dele. As ideias não podem fazer promessas enganosas, de cura ou de ganho garantido.

Responda sempre em português do Brasil, de forma simples e direta. Não invente dados que não estão no anúncio: se algo não aparece, diga "não informado".`;

const MODELOS_COM_FALLBACK = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

export function modeloIA(): string {
  return (process.env.CLAUDE_MODELO || "claude-opus-5-5").trim();
}

export function temIA(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export interface EntradaAnalise {
  pagina_nome: string | null;
  texto: string | null;
  titulo: string | null;
  descricao: string | null;
  cta: string | null;
  link_destino: string | null;
  formato: string | null;
  imagem_url: string | null;
  dias_no_ar: number;
}

let cliente: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!cliente) cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3 });
  return cliente;
}

/** Só para os testes automáticos: troca o cliente por um que não acessa a internet. */
export function definirClienteParaTeste(c: Anthropic | null): void {
  cliente = c;
}

function montarTexto(a: EntradaAnalise, produtosConhecidos: string[]): string {
  const linhas = [
    "<anuncio>",
    `Anunciante: ${a.pagina_nome ?? "não informado"}`,
    `Formato: ${a.formato ?? "não informado"}`,
    `Dias no ar: ${a.dias_no_ar}`,
    `Título: ${a.titulo ?? "não informado"}`,
    `Descrição do link: ${a.descricao ?? "não informada"}`,
    `Botão (CTA): ${a.cta ?? "não informado"}`,
    `Link de destino: ${a.link_destino ?? "não informado"}`,
    "Texto do anúncio:",
    (a.texto ?? "(sem texto)").slice(0, 4000),
    "</anuncio>",
  ];
  if (produtosConhecidos.length) {
    linhas.push("", "<produtos_ja_conhecidos>", ...produtosConhecidos.slice(0, 150), "</produtos_ja_conhecidos>");
  }
  return linhas.join("\n");
}

async function chamar(a: EntradaAnalise, produtosConhecidos: string[], comImagem: boolean) {
  const modelo = modeloIA();
  const conteudo: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (comImagem && a.imagem_url) conteudo.push({ type: "image", source: { type: "url", url: a.imagem_url } });
  conteudo.push({ type: "text", text: montarTexto(a, produtosConhecidos) });

  const usarFallback = MODELOS_COM_FALLBACK.has(modelo);
  return anthropic().beta.messages.parse({
    model: modelo,
    max_tokens: 16000,
    system: SISTEMA,
    messages: [{ role: "user", content: conteudo }],
    output_config: { effort: "low", format: betaZodOutputFormat(Analise) },
    // Se o modelo recusar por engano (filtro de segurança), a Anthropic tenta outro modelo sozinha.
    ...(usarFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
}

export interface RespostaIA {
  ok: boolean;
  analise?: ResultadoAnalise;
  erro?: string;
  modelo: string;
}

export async function analisarAnuncio(a: EntradaAnalise, produtosConhecidos: string[]): Promise<RespostaIA> {
  const modelo = modeloIA();
  if (!temIA()) return { ok: false, erro: "Falta a ANTHROPIC_API_KEY no .env", modelo };
  let resposta;
  try {
    resposta = await chamar(a, produtosConhecidos, true);
  } catch (e) {
    // Imagem do Facebook expirada ou bloqueada: tenta de novo só com o texto.
    if (e instanceof Anthropic.BadRequestError && a.imagem_url) {
      try {
        resposta = await chamar(a, produtosConhecidos, false);
      } catch (e2) {
        return { ok: false, erro: descreverErro(e2), modelo };
      }
    } else {
      return { ok: false, erro: descreverErro(e), modelo };
    }
  }
  if (resposta.stop_reason === "refusal") {
    return { ok: false, erro: "A IA não quis analisar este anúncio (recusa de segurança).", modelo };
  }
  if (resposta.stop_reason === "max_tokens" || !resposta.parsed_output) {
    return { ok: false, erro: "A resposta da IA veio incompleta.", modelo };
  }
  const analise = resposta.parsed_output;
  analise.ideias = analise.ideias.slice(0, 3);
  return { ok: true, analise, modelo: resposta.model ?? modelo };
}

function descreverErro(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Chave da Anthropic inválida (ANTHROPIC_API_KEY).";
  if (e instanceof Anthropic.PermissionDeniedError) return "A chave da Anthropic não tem permissão para este modelo.";
  if (e instanceof Anthropic.NotFoundError) return `Modelo não encontrado: ${modeloIA()}. Confira CLAUDE_MODELO.`;
  if (e instanceof Anthropic.RateLimitError) return "Limite de uso da Anthropic atingido; tente mais tarde.";
  if (e instanceof Anthropic.BadRequestError) return `Pedido recusado pela Anthropic: ${e.message.slice(0, 200)}`;
  if (e instanceof Anthropic.APIError) return `Erro da Anthropic (${e.status ?? "?"}): ${e.message.slice(0, 200)}`;
  return e instanceof Error ? e.message : String(e);
}
