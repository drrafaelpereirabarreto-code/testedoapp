// Leituras do banco usadas pelas páginas do painel.

import { todos, um } from "./db";
import { hojeISO, jsonSeguro, somarDias } from "./util";

export interface Filtros {
  pais?: string;
  categoria?: string;
  plataforma?: string;
  diasMin?: number;
  ativosMin?: number;
  q?: string;
  escalando?: boolean;
  dia?: string;
}

export interface AnuncioLista {
  id: string;
  pagina_id: string | null;
  pagina_nome: string | null;
  pagina_foto: string | null;
  texto: string | null;
  titulo: string | null;
  cta: string | null;
  imagem_url: string | null;
  video_url: string | null;
  video_capa: string | null;
  formato: string | null;
  plataformas: string[];
  pais: string | null;
  dominio: string | null;
  data_inicio: string | null;
  dias_no_ar: number;
  anunciante_ativos: number;
  duplicacoes: number;
  pontuacao: number;
  escalando: boolean;
  categoria: string | null;
  produto_id: string | null;
  produto_nome: string | null;
  favorito: boolean;
  fonte: string;
}

const COLUNAS = `a.id, a.pagina_id, a.pagina_nome, a.pagina_foto, a.texto, a.titulo, a.cta, a.imagem_url, a.video_url, a.video_capa,
  a.formato, a.plataformas, a.pais, a.dominio, a.data_inicio, a.dias_no_ar, a.anunciante_ativos, a.duplicacoes, a.pontuacao,
  a.escalando, a.categoria, a.produto_id, a.fonte, s.produto_nome, CASE WHEN f.anuncio_id IS NULL THEN 0 ELSE 1 END AS favorito`;

const JUNCOES = `FROM anuncios a
  LEFT JOIN analises s ON s.anuncio_id = a.id AND s.erro IS NULL
  LEFT JOIN favoritos f ON f.anuncio_id = a.id`;

type Param = string | number | null;

function converter(l: Record<string, unknown>): AnuncioLista {
  return {
    ...(l as unknown as AnuncioLista),
    plataformas: jsonSeguro<string[]>(l.plataformas as string, []),
    escalando: Number(l.escalando) === 1,
    favorito: Number(l.favorito) === 1,
    dias_no_ar: Number(l.dias_no_ar),
    anunciante_ativos: Number(l.anunciante_ativos),
    duplicacoes: Number(l.duplicacoes),
    pontuacao: Number(l.pontuacao),
  };
}

function aplicarFiltros(f: Filtros, onde: string[], params: Param[]) {
  if (f.pais) {
    onde.push("a.pais = ?");
    params.push(f.pais);
  }
  if (f.categoria) {
    if (f.categoria === "sem-analise") onde.push("a.categoria IS NULL");
    else {
      onde.push("a.categoria = ?");
      params.push(f.categoria);
    }
  }
  if (f.plataforma) {
    onde.push("a.plataformas LIKE ?");
    params.push(`%"${f.plataforma}"%`);
  }
  if (f.diasMin) {
    onde.push("a.dias_no_ar >= ?");
    params.push(f.diasMin);
  }
  if (f.ativosMin) {
    onde.push("a.anunciante_ativos >= ?");
    params.push(f.ativosMin);
  }
  if (f.escalando) onde.push("a.escalando = 1");
  if (f.q) {
    onde.push("(LOWER(COALESCE(a.texto,'')) LIKE ? OR LOWER(COALESCE(a.titulo,'')) LIKE ? OR LOWER(COALESCE(a.pagina_nome,'')) LIKE ? OR LOWER(COALESCE(s.produto_nome,'')) LIKE ?)");
    const t = `%${f.q.toLowerCase()}%`;
    params.push(t, t, t, t);
  }
}

/** Dia mais recente com coleta (para a página "Hoje" não ficar vazia antes da coleta do dia). */
export async function ultimoDia(): Promise<string | null> {
  const l = await um<{ dia: string | null }>("SELECT MAX(ultima_vez) AS dia FROM anuncios");
  return l?.dia ?? null;
}

export async function anunciosDoDia(f: Filtros, limite = 120): Promise<{ dia: string | null; itens: AnuncioLista[]; total: number }> {
  const dia = f.dia || (await ultimoDia());
  if (!dia) return { dia: null, itens: [], total: 0 };
  const onde = ["a.ultima_vez = ?"];
  const params: Param[] = [dia];
  aplicarFiltros(f, onde, params);
  const where = `WHERE ${onde.join(" AND ")}`;
  const total = await um<{ n: number }>(`SELECT COUNT(*) AS n ${JUNCOES} ${where}`, params);
  const linhas = await todos(
    `SELECT ${COLUNAS} ${JUNCOES} ${where} ORDER BY a.escalando DESC, a.pontuacao DESC, a.dias_no_ar DESC LIMIT ?`,
    [...params, limite],
  );
  return { dia, itens: linhas.map(converter), total: Number(total?.n ?? 0) };
}

export async function anunciosPorCategoria(f: Filtros, porCategoria = 8) {
  const dia = f.dia || (await ultimoDia());
  if (!dia) return { dia: null, grupos: [] as Array<{ categoria: string; total: number; itens: AnuncioLista[] }> };
  const onde = ["a.ultima_vez = ?"];
  const params: Param[] = [dia];
  aplicarFiltros({ ...f, categoria: undefined }, onde, params);
  const linhas = (await todos(
    `SELECT ${COLUNAS} ${JUNCOES} WHERE ${onde.join(" AND ")} ORDER BY a.pontuacao DESC LIMIT 2000`,
    params,
  )).map(converter);
  const mapa = new Map<string, AnuncioLista[]>();
  const escolhida = f.categoria === "sem-analise" ? "sem análise" : f.categoria;
  for (const l of linhas) {
    const c = l.categoria ?? "sem análise";
    if (escolhida && c !== escolhida) continue;
    if (!mapa.has(c)) mapa.set(c, []);
    mapa.get(c)!.push(l);
  }
  const grupos = [...mapa.entries()]
    .map(([categoria, itens]) => ({ categoria, total: itens.length, itens: itens.slice(0, porCategoria) }))
    .sort((a, b) => (a.categoria === "sem análise" ? 1 : b.categoria === "sem análise" ? -1 : b.total - a.total));
  return { dia, grupos };
}

export interface ProdutoLista {
  id: string;
  nome: string;
  categoria: string | null;
  primeira_vez: string | null;
  ultima_vez: string | null;
  anuncios_ativos: number;
  anunciantes: number;
  dias_max: number;
  pontuacao_max: number;
  tendencia: number;
  imagem_url: string | null;
}

export async function rankingProdutos(f: { categoria?: string; q?: string; dias?: number } = {}): Promise<ProdutoLista[]> {
  const onde = ["p.ultima_vez >= ?"];
  const params: Param[] = [somarDias(hojeISO(), -(f.dias ?? 7))];
  if (f.categoria) {
    onde.push("p.categoria = ?");
    params.push(f.categoria);
  }
  if (f.q) {
    onde.push("LOWER(p.nome) LIKE ?");
    params.push(`%${f.q.toLowerCase()}%`);
  }
  const linhas = await todos<ProdutoLista>(
    `SELECT p.*, (SELECT a.imagem_url FROM anuncios a WHERE a.produto_id = p.id AND a.imagem_url IS NOT NULL
        ORDER BY a.pontuacao DESC LIMIT 1) AS imagem_url
     FROM produtos p WHERE ${onde.join(" AND ")}
     ORDER BY p.anuncios_ativos DESC, p.pontuacao_max DESC LIMIT 200`,
    params,
  );
  return linhas.map((l) => ({ ...l, tendencia: Number(l.tendencia) }));
}

export async function produto(id: string) {
  const p = await um<ProdutoLista>("SELECT p.*, NULL AS imagem_url FROM produtos p WHERE p.id = ?", [id]);
  if (!p) return null;
  const anuncios = (await todos(
    `SELECT ${COLUNAS} ${JUNCOES} WHERE a.produto_id = ? ORDER BY a.ultima_vez DESC, a.pontuacao DESC LIMIT 100`,
    [id],
  )).map(converter);
  const historico = await todos<{ dia: string; anuncios_ativos: number; anunciantes: number }>(
    "SELECT dia, anuncios_ativos, anunciantes FROM historico_produto WHERE produto_id = ? ORDER BY dia",
    [id],
  );
  return { produto: { ...p, tendencia: Number(p.tendencia) }, anuncios, historico };
}

export async function anuncioCompleto(id: string) {
  const l = await um<Record<string, unknown>>(
    `SELECT a.*, s.categoria AS ia_categoria, s.produto_nome, s.promessa, s.gancho, s.oferta, s.chamada, s.publico,
       s.por_que_funciona, s.ideias, s.modelo AS ia_modelo, s.erro AS ia_erro, s.criado_em AS ia_em,
       f.nota, CASE WHEN f.anuncio_id IS NULL THEN 0 ELSE 1 END AS favorito
     FROM anuncios a LEFT JOIN analises s ON s.anuncio_id = a.id LEFT JOIN favoritos f ON f.anuncio_id = a.id
     WHERE a.id = ?`,
    [id],
  );
  if (!l) return null;
  const historico = await todos<{ dia: string; pontuacao: number; anunciante_ativos: number; duplicacoes: number }>(
    "SELECT dia, pontuacao, anunciante_ativos, duplicacoes FROM historico_anuncio WHERE anuncio_id = ? ORDER BY dia",
    [id],
  );
  const doAnunciante = l.pagina_id
    ? await todos<{ dia: string; anuncios_ativos: number }>(
        "SELECT dia, anuncios_ativos FROM historico_anunciante WHERE pagina_id = ? ORDER BY dia",
        [l.pagina_id as string],
      )
    : [];
  const irmaos = l.pagina_id
    ? (await todos(
        `SELECT ${COLUNAS} ${JUNCOES} WHERE a.pagina_id = ? AND a.id <> ? ORDER BY a.ultima_vez DESC, a.pontuacao DESC LIMIT 8`,
        [l.pagina_id as string, id],
      )).map(converter)
    : [];
  return {
    anuncio: {
      ...l,
      plataformas: jsonSeguro<string[]>(l.plataformas as string, []),
      detalhes: jsonSeguro<{ partes?: Record<string, number>; motivos?: string[] }>(l.detalhes_pontuacao as string, {}),
      ideias: jsonSeguro<Array<{ titulo: string; gancho: string; roteiro: string; visual: string }>>(l.ideias as string, []),
      favorito: Number(l.favorito) === 1,
      escalando: Number(l.escalando) === 1,
    } as Record<string, unknown> & {
      plataformas: string[];
      detalhes: { partes?: Record<string, number>; motivos?: string[] };
      ideias: Array<{ titulo: string; gancho: string; roteiro: string; visual: string }>;
      favorito: boolean;
      escalando: boolean;
    },
    historico,
    doAnunciante,
    irmaos,
  };
}

export async function favoritos(): Promise<Array<AnuncioLista & { nota: string | null }>> {
  const linhas = await todos(
    `SELECT ${COLUNAS}, f.nota FROM favoritos f JOIN anuncios a ON a.id = f.anuncio_id
     LEFT JOIN analises s ON s.anuncio_id = a.id AND s.erro IS NULL
     ORDER BY f.atualizado_em DESC`,
  );
  return linhas.map((l) => ({ ...converter(l), favorito: true, nota: (l.nota as string) ?? null }));
}

/** Campeões de cada mês: maior pontuação que cada anúncio atingiu no mês. */
export async function campeoesPorMes(porMes = 12) {
  const linhas = await todos<{ mes: string; anuncio_id: string; max_pontos: number; n_dias: number }>(
    `SELECT SUBSTR(dia, 1, 7) AS mes, anuncio_id, MAX(pontuacao) AS max_pontos, COUNT(*) AS n_dias
     FROM historico_anuncio GROUP BY SUBSTR(dia, 1, 7), anuncio_id`,
  );
  const porMesMapa = new Map<string, typeof linhas>();
  for (const l of linhas) {
    if (!porMesMapa.has(l.mes)) porMesMapa.set(l.mes, []);
    porMesMapa.get(l.mes)!.push(l);
  }
  const meses = [...porMesMapa.keys()].sort().reverse();
  const resultado: Array<{ mes: string; total: number; itens: Array<AnuncioLista & { max_pontos: number; n_dias: number }> }> = [];
  for (const mes of meses) {
    const top = porMesMapa
      .get(mes)!
      .sort((a, b) => Number(b.max_pontos) - Number(a.max_pontos) || Number(b.n_dias) - Number(a.n_dias))
      .slice(0, porMes);
    const ids = top.map((t) => t.anuncio_id);
    const dados = (await todos(`SELECT ${COLUNAS} ${JUNCOES} WHERE a.id IN (${ids.map(() => "?").join(",")})`, ids)).map(converter);
    const porId = new Map(dados.map((d) => [d.id, d]));
    resultado.push({
      mes,
      total: porMesMapa.get(mes)!.length,
      itens: top
        .filter((t) => porId.has(t.anuncio_id))
        .map((t) => ({ ...porId.get(t.anuncio_id)!, max_pontos: Number(t.max_pontos), n_dias: Number(t.n_dias) })),
    });
  }
  return resultado;
}

export async function ultimasColetas(n = 10) {
  return todos<{
    id: string; dia: string; inicio: string; fim: string | null; status: string; fonte: string | null;
    total: number; novos: number; analisados: number; mensagem: string | null;
  }>("SELECT * FROM coletas ORDER BY inicio DESC LIMIT ?", [n]);
}

export async function numerosGerais() {
  const dia = await ultimoDia();
  const r = await um<{ n_total: number; n_hoje: number; n_escalando: number; n_exemplo: number }>(
    `SELECT COUNT(*) AS n_total,
       SUM(CASE WHEN ultima_vez = ? THEN 1 ELSE 0 END) AS n_hoje,
       SUM(CASE WHEN ultima_vez = ? AND escalando = 1 THEN 1 ELSE 0 END) AS n_escalando,
       SUM(CASE WHEN fonte = 'exemplo' THEN 1 ELSE 0 END) AS n_exemplo
     FROM anuncios`,
    [dia, dia],
  );
  return {
    dia,
    total: Number(r?.n_total ?? 0),
    hoje: Number(r?.n_hoje ?? 0),
    escalando: Number(r?.n_escalando ?? 0),
    exemplo: Number(r?.n_exemplo ?? 0),
  };
}

export async function paisesComDados(): Promise<string[]> {
  return (await todos<{ pais: string }>("SELECT DISTINCT pais FROM anuncios WHERE pais IS NOT NULL ORDER BY pais")).map((l) => l.pais);
}
