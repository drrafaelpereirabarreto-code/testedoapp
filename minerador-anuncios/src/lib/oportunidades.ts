// "Oportunidades": produtos fortes lá fora (EUA, Europa...) com pouca ou nenhuma concorrência no seu país.
//
// Cuidado: "nenhum anúncio no Brasil" quer dizer "nenhum anúncio que a coleta encontrou".
// Por isso, todo dia o robô procura no seu país, pelo nome do produto, os mais promissores
// (opção "Conferir no meu país" em Configurações). Produto conferido aparece com a data da conferência.

import { lerConfig } from "./config";
import { todos, um } from "./db";
import { notaOportunidade, type Fase } from "./pontuacao";
import { somarDias } from "./util";

export interface Oportunidade {
  id: string;
  nome: string;
  categoria: string | null;
  fase: Fase | null;
  tendencia: number;
  pontuacao_max: number;
  dias_max: number;
  fora: Array<{ pais: string; anuncios: number; anunciantes: number }>;
  foraAnuncios: number;
  foraAnunciantes: number;
  alvoAnuncios: number;
  alvoAnunciantes: number;
  conferidoEm: string | null;
  nota: number;
  imagem_url: string | null;
  anuncioTop: string | null;
}

async function diaMaisRecente(): Promise<string | null> {
  const r = await um<{ dia: string | null }>("SELECT MAX(dia) AS dia FROM produto_pais");
  return r?.dia ?? null;
}

export async function listarOportunidades(opcoes: { incluirComConcorrencia?: boolean } = {}): Promise<{
  dia: string | null;
  paisAlvo: string;
  itens: Oportunidade[];
}> {
  const cfg = await lerConfig();
  const alvo = cfg.paisAlvo || "BR";
  const dia = await diaMaisRecente();
  if (!dia) return { dia: null, paisAlvo: alvo, itens: [] };

  // Últimos 3 dias: um produto pode não aparecer numa coleta e voltar na seguinte.
  const desde = somarDias(dia, -2);
  const linhas = await todos<{ produto_id: string; pais: string; dia: string; anuncios_ativos: number; anunciantes: number }>(
    "SELECT produto_id, pais, dia, anuncios_ativos, anunciantes FROM produto_pais WHERE dia >= ? ORDER BY dia",
    [desde],
  );
  // Fica com o dia mais recente de cada produto + país.
  const ultimo = new Map<string, (typeof linhas)[number]>();
  for (const l of linhas) ultimo.set(`${l.produto_id}|${l.pais}`, l);

  const porProduto = new Map<string, { fora: Oportunidade["fora"]; alvoAnuncios: number; alvoAnunciantes: number }>();
  for (const l of ultimo.values()) {
    if (!porProduto.has(l.produto_id)) porProduto.set(l.produto_id, { fora: [], alvoAnuncios: 0, alvoAnunciantes: 0 });
    const p = porProduto.get(l.produto_id)!;
    if (l.pais === alvo) {
      p.alvoAnuncios = Number(l.anuncios_ativos);
      p.alvoAnunciantes = Number(l.anunciantes);
    } else {
      p.fora.push({ pais: l.pais, anuncios: Number(l.anuncios_ativos), anunciantes: Number(l.anunciantes) });
    }
  }
  const ids = [...porProduto.keys()].filter((id) => porProduto.get(id)!.fora.length > 0);
  if (ids.length === 0) return { dia, paisAlvo: alvo, itens: [] };

  const produtos = await todos<{
    id: string; nome: string; categoria: string | null; fase: Fase | null; tendencia: number; pontuacao_max: number; dias_max: number;
  }>(`SELECT id, nome, categoria, fase, tendencia, pontuacao_max, dias_max FROM produtos WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  const conferidos = await todos<{ produto_id: string; dia: string }>(
    `SELECT produto_id, dia FROM verificacoes WHERE pais = ? AND produto_id IN (${ids.map(() => "?").join(",")})`,
    [alvo, ...ids],
  );
  const conferidoEm = new Map(conferidos.map((c) => [c.produto_id, c.dia]));
  const capas = await todos<{ produto_id: string; id: string; imagem: string | null }>(
    `SELECT a.produto_id, a.id, COALESCE(a.imagem_salva, a.imagem_url) AS imagem FROM anuncios a
     WHERE a.produto_id IN (${ids.map(() => "?").join(",")}) ORDER BY a.pontuacao DESC`,
    ids,
  );
  const capa = new Map<string, { id: string; imagem: string | null }>();
  for (const c of capas) if (!capa.has(c.produto_id)) capa.set(c.produto_id, { id: c.id, imagem: c.imagem });

  const itens: Oportunidade[] = [];
  for (const p of produtos) {
    const d = porProduto.get(p.id)!;
    const foraAnuncios = d.fora.reduce((s, f) => s + f.anuncios, 0);
    const foraAnunciantes = d.fora.reduce((s, f) => s + f.anunciantes, 0);
    const nota = notaOportunidade({
      foraAnuncios,
      foraAnunciantes,
      pontuacaoMax: Number(p.pontuacao_max),
      tendencia: Number(p.tendencia),
      alvoAnunciantes: d.alvoAnunciantes,
    });
    if (nota === 0 && !opcoes.incluirComConcorrencia) continue;
    itens.push({
      ...p,
      tendencia: Number(p.tendencia),
      pontuacao_max: Number(p.pontuacao_max),
      dias_max: Number(p.dias_max),
      fora: d.fora.sort((a, b) => b.anuncios - a.anuncios),
      foraAnuncios,
      foraAnunciantes,
      alvoAnuncios: d.alvoAnuncios,
      alvoAnunciantes: d.alvoAnunciantes,
      conferidoEm: conferidoEm.get(p.id) ?? null,
      nota,
      imagem_url: capa.get(p.id)?.imagem ?? null,
      anuncioTop: capa.get(p.id)?.id ?? null,
    });
  }
  itens.sort((a, b) => b.nota - a.nota || b.foraAnuncios - a.foraAnuncios);
  return { dia, paisAlvo: alvo, itens };
}

/**
 * Os produtos que o robô deve procurar amanhã no seu país, pelo nome:
 * as melhores oportunidades ainda não conferidas nos últimos 7 dias.
 */
export async function produtosParaConferir(hoje: string): Promise<Array<{ produto_id: string; pais: string; termo: string }>> {
  const cfg = await lerConfig();
  if (cfg.verificarOportunidades <= 0) return [];
  const { itens, paisAlvo } = await listarOportunidades();
  const limite = somarDias(hoje, -7);
  return itens
    .filter((o) => !o.conferidoEm || o.conferidoEm < limite)
    .slice(0, cfg.verificarOportunidades)
    .map((o) => ({ produto_id: o.id, pais: paisAlvo, termo: o.nome }));
}

/** Link para você mesmo procurar o produto na Biblioteca de Anúncios do seu país. */
export function linkBiblioteca(termo: string, pais: string): string {
  const p = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country: pais,
    media_type: "all",
    q: termo,
    search_type: "keyword_unordered",
  });
  return `https://www.facebook.com/ads/library/?${p.toString()}`;
}
