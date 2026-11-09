// A coleta diária, do começo ao fim:
// 1. pede ao Apify (ou à API do Meta) os anúncios ativos das suas palavras-chave;
// 2. guarda no banco, sem repetir anúncio;
// 3. calcula a Pontuação de Escala e grava o histórico do dia;
// 4. manda os melhores anúncios novos para a IA analisar;
// 5. agrupa por produto e calcula a tendência.
// Tudo pode ser retomado: se o tempo acabar no meio, a próxima chamada continua de onde parou.

import { randomUUID } from "node:crypto";
import { lerConfig } from "./config";
import { emLote, executar, todos, um } from "./db";
import {
  coletarMeta,
  iniciarApify,
  montarBuscas,
  resultadosApify,
  situacaoApify,
  temApify,
  temMeta,
} from "./fontes";
import { analisarAnuncio, temIA } from "./ia";
import { guardarMidiaDoDia } from "./midia";
import { produtosParaConferir } from "./oportunidades";
import { enviarResumo } from "./resumo";
import type { AnuncioNormalizado } from "./normalizar";
import { calcularPontuacao, faseProduto, tendencia } from "./pontuacao";
import { chaveDestino, diasEntre, hojeISO, jsonSeguro, slug, somarDias } from "./util";

type Param = string | number | null;

export interface ResumoColeta {
  status: "concluida" | "rodando" | "erro" | "pulada";
  mensagem: string;
  total?: number;
  novos?: number;
  analisados?: number;
}

/** Guarda os anúncios coletados hoje. Devolve quantos vieram e quantos são novos. */
export async function salvarAnuncios(lista: AnuncioNormalizado[], hoje = hojeISO()): Promise<{ total: number; novos: number }> {
  const unicos = new Map<string, AnuncioNormalizado>();
  // O mesmo anúncio pode aparecer na busca do Brasil e na dos EUA: guarda todos os países.
  const paisesPorAnuncio = new Map<string, Set<string>>();
  for (const a of lista) {
    if (!unicos.has(a.id)) unicos.set(a.id, a);
    if (a.pais) {
      if (!paisesPorAnuncio.has(a.id)) paisesPorAnuncio.set(a.id, new Set());
      paisesPorAnuncio.get(a.id)!.add(a.pais);
    }
  }
  if (unicos.size === 0) return { total: 0, novos: 0 };

  const ids = [...unicos.keys()];
  const existentes = new Set<string>();
  for (let i = 0; i < ids.length; i += 400) {
    const parte = ids.slice(i, i + 400);
    const linhas = await todos<{ id: string }>(
      `SELECT id FROM anuncios WHERE id IN (${parte.map(() => "?").join(",")})`,
      parte,
    );
    for (const l of linhas) existentes.add(l.id);
  }

  const comandos: Array<[string, Param[]]> = [];
  for (const a of unicos.values()) {
    comandos.push([
      `INSERT INTO anuncios (id, fonte, pagina_id, pagina_nome, pagina_foto, texto, titulo, descricao, cta, link_destino, dominio,
        imagem_url, video_url, video_capa, formato, plataformas, pais, palavra_chave, data_inicio, data_fim, ativo,
        colacao_id, colacao_qtd, criativo_chave, biblioteca_url, primeira_vez, ultima_vez)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
        pagina_nome = COALESCE(excluded.pagina_nome, anuncios.pagina_nome),
        pagina_foto = COALESCE(excluded.pagina_foto, anuncios.pagina_foto),
        texto = COALESCE(excluded.texto, anuncios.texto),
        titulo = COALESCE(excluded.titulo, anuncios.titulo),
        descricao = COALESCE(excluded.descricao, anuncios.descricao),
        cta = COALESCE(excluded.cta, anuncios.cta),
        link_destino = COALESCE(excluded.link_destino, anuncios.link_destino),
        dominio = COALESCE(excluded.dominio, anuncios.dominio),
        imagem_url = COALESCE(excluded.imagem_url, anuncios.imagem_url),
        video_url = COALESCE(excluded.video_url, anuncios.video_url),
        video_capa = COALESCE(excluded.video_capa, anuncios.video_capa),
        formato = COALESCE(excluded.formato, anuncios.formato),
        plataformas = excluded.plataformas,
        pais = COALESCE(anuncios.pais, excluded.pais),
        palavra_chave = COALESCE(anuncios.palavra_chave, excluded.palavra_chave),
        data_inicio = COALESCE(excluded.data_inicio, anuncios.data_inicio),
        data_fim = excluded.data_fim,
        ativo = excluded.ativo,
        colacao_id = COALESCE(excluded.colacao_id, anuncios.colacao_id),
        colacao_qtd = excluded.colacao_qtd,
        criativo_chave = COALESCE(excluded.criativo_chave, anuncios.criativo_chave),
        ultima_vez = excluded.ultima_vez`,
      [
        a.id, a.fonte, a.pagina_id, a.pagina_nome, a.pagina_foto, a.texto, a.titulo, a.descricao, a.cta, a.link_destino,
        a.dominio, a.imagem_url, a.video_url, a.video_capa, a.formato, JSON.stringify(a.plataformas), a.pais,
        a.palavra_chave, a.data_inicio, a.data_fim, a.ativo ? 1 : 0, a.colacao_id, a.colacao_qtd, a.criativo_chave,
        a.biblioteca_url, hoje, hoje,
      ],
    ]);
  }
  for (const [id, paises] of paisesPorAnuncio) {
    for (const pais of paises) {
      comandos.push([
        `INSERT INTO anuncio_paises (anuncio_id, pais, ultima_vez) VALUES (?, ?, ?)
         ON CONFLICT (anuncio_id, pais) DO UPDATE SET ultima_vez = excluded.ultima_vez`,
        [id, pais, hoje],
      ]);
    }
  }
  await emLote(comandos);
  return { total: unicos.size, novos: ids.filter((id) => !existentes.has(id)).length };
}

/** Recalcula a Pontuação de Escala de todos os anúncios vistos hoje e grava o histórico do dia. */
export async function recalcular(hoje = hojeISO()): Promise<void> {
  const anuncios = await todos<{
    id: string;
    pagina_id: string | null;
    link_destino: string | null;
    criativo_chave: string | null;
    colacao_qtd: number;
    data_inicio: string | null;
    primeira_vez: string | null;
    plataformas: string | null;
  }>(
    `SELECT id, pagina_id, link_destino, criativo_chave, colacao_qtd, data_inicio, primeira_vez, plataformas
     FROM anuncios WHERE ultima_vez = ? AND ativo = 1`,
    [hoje],
  );
  if (anuncios.length === 0) return;

  const contar = (chave: (a: (typeof anuncios)[number]) => string | null) => {
    const m = new Map<string, number>();
    for (const a of anuncios) {
      const k = chave(a);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const porPagina = contar((a) => a.pagina_id);
  // "Mesma página de destino": outros anúncios (de qualquer anunciante) levando para a mesma página.
  const porDestino = contar((a) => chaveDestino(a.link_destino));
  const porCriativo = contar((a) => a.criativo_chave);

  // Anúncios ativos de cada anunciante há ~7 dias (aceita de 2 a 10 dias atrás, o mais perto de 7).
  const historico = await todos<{ pagina_id: string; dia: string; anuncios_ativos: number }>(
    "SELECT pagina_id, dia, anuncios_ativos FROM historico_anunciante WHERE dia >= ? AND dia <= ?",
    [somarDias(hoje, -10), somarDias(hoje, -2)],
  );
  const alvo = somarDias(hoje, -7);
  const antes = new Map<string, { dia: string; n: number }>();
  for (const h of historico) {
    const atual = antes.get(h.pagina_id);
    if (!atual || Math.abs(diasEntre(h.dia, alvo)) < Math.abs(diasEntre(atual.dia, alvo))) {
      antes.set(h.pagina_id, { dia: h.dia, n: Number(h.anuncios_ativos) });
    }
  }

  const comandos: Array<[string, Param[]]> = [];
  for (const [pagina, n] of porPagina) {
    comandos.push([
      `INSERT INTO historico_anunciante (pagina_id, dia, anuncios_ativos) VALUES (?, ?, ?)
       ON CONFLICT (pagina_id, dia) DO UPDATE SET anuncios_ativos = excluded.anuncios_ativos`,
      [pagina, hoje, n],
    ]);
  }

  for (const a of anuncios) {
    const ativosAnunciante = a.pagina_id ? porPagina.get(a.pagina_id) ?? 1 : 1;
    const destino = chaveDestino(a.link_destino);
    const ativosDominio = destino ? porDestino.get(destino) ?? 1 : 1;
    const duplicacoes = Math.max(Number(a.colacao_qtd) || 1, a.criativo_chave ? porCriativo.get(a.criativo_chave) ?? 1 : 1);
    const dias = Math.max(0, diasEntre(a.data_inicio ?? a.primeira_vez ?? hoje, hoje));
    const p = calcularPontuacao({
      diasNoAr: dias,
      anuncianteAtivos: ativosAnunciante,
      dominioAtivos: ativosDominio,
      duplicacoes,
      ativosHoje: ativosAnunciante,
      ativosAntes: a.pagina_id ? antes.get(a.pagina_id)?.n ?? null : null,
      plataformas: jsonSeguro<string[]>(a.plataformas, []).length,
    });
    comandos.push([
      `UPDATE anuncios SET dias_no_ar = ?, anunciante_ativos = ?, dominio_ativos = ?, duplicacoes = ?, crescimento = ?,
        pontuacao = ?, escalando = ?, detalhes_pontuacao = ? WHERE id = ?`,
      [dias, ativosAnunciante, ativosDominio, duplicacoes, p.crescimento, p.total, p.escalando ? 1 : 0,
        JSON.stringify({ partes: p.partes, motivos: p.motivos }), a.id],
    ]);
    comandos.push([
      `INSERT INTO historico_anuncio (anuncio_id, dia, pontuacao, anunciante_ativos, duplicacoes, escalando)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (anuncio_id, dia) DO UPDATE SET pontuacao = excluded.pontuacao,
        anunciante_ativos = excluded.anunciante_ativos, duplicacoes = excluded.duplicacoes, escalando = excluded.escalando`,
      [a.id, hoje, p.total, ativosAnunciante, duplicacoes, p.escalando ? 1 : 0],
    ]);
  }
  await emLote(comandos);
}

/** Grava a análise da IA e liga o anúncio ao produto. */
async function gravarAnalise(
  anuncioId: string,
  dados: {
    categoria: string | null;
    produto_nome: string | null;
    promessa?: string | null;
    gancho?: string | null;
    oferta?: string | null;
    chamada?: string | null;
    publico?: string | null;
    por_que_funciona?: string | null;
    ideias?: unknown;
    modelo: string;
    erro?: string | null;
  },
): Promise<void> {
  const produtoId = dados.produto_nome ? slug(dados.produto_nome) || null : null;
  await emLote([
    [
      `INSERT INTO analises (anuncio_id, categoria, produto_nome, produto_id, promessa, gancho, oferta, chamada, publico,
        por_que_funciona, ideias, modelo, criado_em, erro)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (anuncio_id) DO UPDATE SET categoria = excluded.categoria, produto_nome = excluded.produto_nome,
        produto_id = excluded.produto_id, promessa = excluded.promessa, gancho = excluded.gancho, oferta = excluded.oferta,
        chamada = excluded.chamada, publico = excluded.publico, por_que_funciona = excluded.por_que_funciona,
        ideias = excluded.ideias, modelo = excluded.modelo, criado_em = excluded.criado_em, erro = excluded.erro`,
      [
        anuncioId, dados.categoria, dados.produto_nome, produtoId, dados.promessa ?? null, dados.gancho ?? null,
        dados.oferta ?? null, dados.chamada ?? null, dados.publico ?? null, dados.por_que_funciona ?? null,
        dados.ideias ? JSON.stringify(dados.ideias) : null, dados.modelo, new Date().toISOString(), dados.erro ?? null,
      ],
    ],
    ...(dados.erro
      ? []
      : ([["UPDATE anuncios SET categoria = ?, produto_id = ? WHERE id = ?", [dados.categoria, produtoId, anuncioId]]] as Array<
          [string, Param[]]
        >)),
  ]);
}

/** Analisa um anúncio com a IA agora (usado também pelo botão "Analisar com IA" no detalhe). */
export async function analisarUm(anuncioId: string): Promise<{ ok: boolean; erro?: string }> {
  const a = await um<{
    pagina_nome: string | null; texto: string | null; titulo: string | null; descricao: string | null; cta: string | null;
    link_destino: string | null; formato: string | null; imagem_url: string | null; dias_no_ar: number;
  }>(
    "SELECT pagina_nome, texto, titulo, descricao, cta, link_destino, formato, imagem_url, dias_no_ar FROM anuncios WHERE id = ?",
    [anuncioId],
  );
  if (!a) return { ok: false, erro: "Anúncio não encontrado." };
  const conhecidos = await todos<{ nome: string }>("SELECT nome FROM produtos ORDER BY anuncios_ativos DESC LIMIT 150");
  const r = await analisarAnuncio({ ...a, dias_no_ar: Number(a.dias_no_ar) }, conhecidos.map((p) => p.nome));
  if (!r.ok || !r.analise) {
    await gravarAnalise(anuncioId, { categoria: null, produto_nome: null, modelo: r.modelo, erro: r.erro ?? "erro" });
    return { ok: false, erro: r.erro };
  }
  await gravarAnalise(anuncioId, { ...r.analise, modelo: r.modelo });
  return { ok: true };
}

/** Manda para a IA os anúncios de hoje ainda sem análise, dos mais fortes para os mais fracos. */
export async function analisarPendentes(hoje: string, prazo: number, maxPorDia: number): Promise<number> {
  if (!temIA()) return 0;
  const feitos = await um<{ n: number }>(
    "SELECT COUNT(*) AS n FROM analises WHERE criado_em >= ? AND erro IS NULL AND modelo <> 'reaproveitada'",
    [hoje],
  );
  let cota = Math.max(0, maxPorDia - Number(feitos?.n ?? 0));

  const pendentes = await todos<{ id: string; criativo_chave: string | null }>(
    `SELECT a.id, a.criativo_chave FROM anuncios a
     LEFT JOIN analises s ON s.anuncio_id = a.id
     WHERE a.ultima_vez = ? AND (s.anuncio_id IS NULL OR (s.erro IS NOT NULL AND s.criado_em < ?))
     ORDER BY a.pontuacao DESC LIMIT 500`,
    [hoje, hoje],
  );

  // Anúncios com o mesmo criativo: a IA analisa só o primeiro; os outros reaproveitam (sem gastar).
  const vistos = new Set<string>();
  const principais: typeof pendentes = [];
  const copias: typeof pendentes = [];
  for (const p of pendentes) {
    if (p.criativo_chave && vistos.has(p.criativo_chave)) copias.push(p);
    else {
      if (p.criativo_chave) vistos.add(p.criativo_chave);
      principais.push(p);
    }
  }

  const reaproveitar = async (p: (typeof pendentes)[number]): Promise<boolean> => {
    if (!p.criativo_chave) return false;
    const igual = await um<Record<string, string | null>>(
      `SELECT s.* FROM analises s JOIN anuncios a ON a.id = s.anuncio_id
       WHERE a.criativo_chave = ? AND s.erro IS NULL AND s.anuncio_id <> ? LIMIT 1`,
      [p.criativo_chave, p.id],
    );
    if (!igual) return false;
    await gravarAnalise(p.id, {
      categoria: igual.categoria, produto_nome: igual.produto_nome, promessa: igual.promessa, gancho: igual.gancho,
      oferta: igual.oferta, chamada: igual.chamada, publico: igual.publico, por_que_funciona: igual.por_que_funciona,
      ideias: jsonSeguro(igual.ideias, []), modelo: "reaproveitada",
    });
    return true;
  };

  let analisados = 0;
  const fila = [...principais];
  const trabalhar = async () => {
    while (fila.length && Date.now() < prazo) {
      const p = fila.shift()!;
      // Mesmo criativo já analisado em outro dia? Reaproveita.
      if (await reaproveitar(p)) continue;
      if (cota <= 0) continue;
      cota--;
      const r = await analisarUm(p.id);
      if (r.ok) analisados++;
    }
  };
  // 3 análises ao mesmo tempo.
  await Promise.all([trabalhar(), trabalhar(), trabalhar()]);
  for (const p of copias) {
    if (Date.now() >= prazo) break;
    await reaproveitar(p);
  }
  return analisados;
}

/** Agrupa os anúncios de hoje por produto e calcula a tendência. */
export async function atualizarProdutos(hoje = hojeISO()): Promise<void> {
  const grupos = await todos<{
    produto_id: string; n_ativos: number; n_anunciantes: number; max_dias: number; max_pontos: number;
  }>(
    `SELECT produto_id, COUNT(*) AS n_ativos, COUNT(DISTINCT pagina_id) AS n_anunciantes,
       MAX(dias_no_ar) AS max_dias, MAX(pontuacao) AS max_pontos
     FROM anuncios WHERE ultima_vez = ? AND ativo = 1 AND produto_id IS NOT NULL GROUP BY produto_id`,
    [hoje],
  );
  if (grupos.length === 0) return;
  const nomes = await todos<{ produto_id: string; produto_nome: string; categoria: string | null }>(
    "SELECT produto_id, produto_nome, categoria FROM analises WHERE produto_id IS NOT NULL AND erro IS NULL",
  );
  const nomePorId = new Map<string, { nome: string; categoria: string | null }>();
  for (const n of nomes) if (!nomePorId.has(n.produto_id)) nomePorId.set(n.produto_id, { nome: n.produto_nome, categoria: n.categoria });

  const historico = await todos<{ produto_id: string; dia: string; anuncios_ativos: number; anunciantes: number }>(
    "SELECT produto_id, dia, anuncios_ativos, anunciantes FROM historico_produto WHERE dia >= ? AND dia <= ?",
    [somarDias(hoje, -10), somarDias(hoje, -2)],
  );
  const alvo = somarDias(hoje, -7);
  const antes = new Map<string, { dia: string; n: number; anunciantes: number }>();
  for (const h of historico) {
    const atual = antes.get(h.produto_id);
    if (!atual || Math.abs(diasEntre(h.dia, alvo)) < Math.abs(diasEntre(atual.dia, alvo))) {
      antes.set(h.produto_id, { dia: h.dia, n: Number(h.anuncios_ativos), anunciantes: Number(h.anunciantes) });
    }
  }

  const comandos: Array<[string, Param[]]> = [];
  for (const g of grupos) {
    const info = nomePorId.get(g.produto_id) ?? { nome: g.produto_id, categoria: null };
    const tend = tendencia(Number(g.n_ativos), antes.get(g.produto_id)?.n ?? null);
    const anunciantesAntes = antes.get(g.produto_id)?.anunciantes ?? null;
    const f = faseProduto({
      anunciantes: Number(g.n_anunciantes),
      anunciantesAntes,
      anunciosAtivos: Number(g.n_ativos),
      tendencia: tend,
      diasMax: Number(g.max_dias),
    });

    comandos.push([
      `INSERT INTO produtos (id, nome, categoria, primeira_vez, ultima_vez, anuncios_ativos, anunciantes, dias_max, pontuacao_max,
        tendencia, fase, fase_motivo, anunciantes_antes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET nome = excluded.nome, categoria = COALESCE(excluded.categoria, produtos.categoria),
        ultima_vez = excluded.ultima_vez, anuncios_ativos = excluded.anuncios_ativos, anunciantes = excluded.anunciantes,
        dias_max = excluded.dias_max, pontuacao_max = excluded.pontuacao_max, tendencia = excluded.tendencia,
        fase = excluded.fase, fase_motivo = excluded.fase_motivo, anunciantes_antes = excluded.anunciantes_antes`,
      [g.produto_id, info.nome, info.categoria, hoje, hoje, g.n_ativos, g.n_anunciantes, g.max_dias, g.max_pontos, tend,
        f.fase, f.motivo, anunciantesAntes],
    ]);
    comandos.push([
      `INSERT INTO historico_produto (produto_id, dia, anuncios_ativos, anunciantes) VALUES (?, ?, ?, ?)
       ON CONFLICT (produto_id, dia) DO UPDATE SET anuncios_ativos = excluded.anuncios_ativos, anunciantes = excluded.anunciantes`,
      [g.produto_id, hoje, g.n_ativos, g.n_anunciantes],
    ]);
  }

  // Produto por país (para a página "Oportunidades").
  const porPais = await todos<{ produto_id: string; pais: string; n_ativos: number; n_anunciantes: number }>(
    `SELECT a.produto_id, ap.pais, COUNT(*) AS n_ativos, COUNT(DISTINCT a.pagina_id) AS n_anunciantes
     FROM anuncios a JOIN anuncio_paises ap ON ap.anuncio_id = a.id AND ap.ultima_vez = ?
     WHERE a.ultima_vez = ? AND a.ativo = 1 AND a.produto_id IS NOT NULL
     GROUP BY a.produto_id, ap.pais`,
    [hoje, hoje],
  );
  for (const r of porPais) {
    comandos.push([
      `INSERT INTO produto_pais (produto_id, pais, dia, anuncios_ativos, anunciantes) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (produto_id, pais, dia) DO UPDATE SET anuncios_ativos = excluded.anuncios_ativos, anunciantes = excluded.anunciantes`,
      [r.produto_id, r.pais, hoje, r.n_ativos, r.n_anunciantes],
    ]);
  }
  await emLote(comandos);
}

async function terminar(id: string, status: string, mensagem: string, extra: { total?: number; novos?: number; analisados?: number } = {}) {
  await executar(
    `UPDATE coletas SET status = ?, mensagem = ?, fim = ?, total = COALESCE(?, total), novos = COALESCE(?, novos),
      analisados = COALESCE(?, analisados) WHERE id = ?`,
    [status, mensagem, new Date().toISOString(), extra.total ?? null, extra.novos ?? null, extra.analisados ?? null, id],
  );
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Extra = { produto_id: string; pais: string; termo: string };

/**
 * Depois da coleta: anota os produtos conferidos no seu país, guarda os criativos fortes e manda o resumo.
 * Nada aqui derruba a coleta: um erro só vira um aviso na mensagem.
 */
async function posColeta(dia: string, prazo: number, extras: Extra[]): Promise<string> {
  const avisos: string[] = [];
  try {
    await emLote(
      extras.map((e) => [
        `INSERT INTO verificacoes (produto_id, pais, dia) VALUES (?, ?, ?)
         ON CONFLICT (produto_id, pais) DO UPDATE SET dia = excluded.dia`,
        [e.produto_id, e.pais, dia],
      ]),
    );
  } catch (e) {
    avisos.push(`Conferência no seu país: ${e instanceof Error ? e.message : e}`);
  }
  try {
    const n = await guardarMidiaDoDia(dia, prazo);
    if (n) avisos.push(`${n} criativos guardados.`);
  } catch (e) {
    avisos.push(`Guardar criativos: ${e instanceof Error ? e.message : e}`);
  }
  try {
    const r = await enviarResumo({ dia });
    if (r.mensagem && r.enviado) avisos.push(r.mensagem);
  } catch (e) {
    avisos.push(`Resumo: ${e instanceof Error ? e.message : e}`);
  }
  return avisos.length ? " " + avisos.join(" ") : "";
}

/**
 * Roda (ou continua) a coleta de hoje.
 * @param forcar  true = coleta de novo mesmo que já tenha coletado hoje (botão "Atualizar agora").
 * @param limiteMs tempo máximo desta chamada (na Vercel, menos de 5 minutos).
 */
export async function executarColeta(opcoes: { forcar?: boolean; limiteMs?: number } = {}): Promise<ResumoColeta> {
  const prazo = Date.now() + (opcoes.limiteMs ?? 270_000);
  const hoje = hojeISO();
  const cfg = await lerConfig();

  // Coleta presa há mais de 6 horas: desiste dela.
  const limiteVelha = new Date(Date.now() - 6 * 3600_000).toISOString();
  await executar("UPDATE coletas SET status = 'erro', mensagem = 'Tempo esgotado no Apify', fim = ? WHERE status = 'rodando' AND inicio < ?", [
    new Date().toISOString(),
    limiteVelha,
  ]);

  let coleta = await um<{ id: string; execucao_id: string | null; dia: string; extras: string | null }>(
    "SELECT id, execucao_id, dia, extras FROM coletas WHERE status = 'rodando' ORDER BY inicio DESC LIMIT 1",
  );

  if (!coleta) {
    const jaFeita = await um<{ id: string }>("SELECT id FROM coletas WHERE dia = ? AND status = 'concluida' LIMIT 1", [hoje]);
    if (jaFeita && !opcoes.forcar) {
      // Já coletou hoje: só aproveita o tempo para terminar análises pendentes.
      const analisados = await analisarPendentes(hoje, prazo, cfg.iaMaxPorDia);
      if (analisados) await atualizarProdutos(hoje);
      const extra = await posColeta(hoje, prazo, []);
      return {
        status: "pulada",
        mensagem: `A coleta de hoje já foi feita.${analisados ? ` ${analisados} análises novas.` : ""}${extra}`,
        analisados,
      };
    }
    if (!temApify() && !temMeta()) {
      return {
        status: "erro",
        mensagem: "Nenhuma fonte configurada. Coloque o APIFY_TOKEN (ou o META_TOKEN) no arquivo .env — veja o README.",
      };
    }
    const id = randomUUID();
    // Além das palavras-chave, confere no seu país os produtos que estão fortes lá fora.
    const extras = await produtosParaConferir(hoje).catch(() => []);
    const buscas = montarBuscas(cfg, extras);
    if (buscas.length === 0) return { status: "erro", mensagem: "Cadastre pelo menos uma palavra-chave em Configurações." };

    if (temApify()) {
      try {
        const execucao = await iniciarApify(buscas, cfg.limitePorBusca);
        await executar(
          "INSERT INTO coletas (id, dia, inicio, status, fonte, execucao_id, mensagem, extras) VALUES (?, ?, ?, 'rodando', 'apify', ?, ?, ?)",
          [id, hoje, new Date().toISOString(), execucao, `${buscas.length} buscas enviadas ao Apify`, JSON.stringify(extras)],
        );
        coleta = { id, execucao_id: execucao, dia: hoje, extras: JSON.stringify(extras) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await executar("INSERT INTO coletas (id, dia, inicio, fim, status, fonte, mensagem) VALUES (?, ?, ?, ?, 'erro', 'apify', ?)", [
          id, hoje, new Date().toISOString(), new Date().toISOString(), msg,
        ]);
        return { status: "erro", mensagem: msg };
      }
    } else {
      // Só a API oficial do Meta.
      await executar("INSERT INTO coletas (id, dia, inicio, status, fonte) VALUES (?, ?, ?, 'processando', 'meta')", [
        id, hoje, new Date().toISOString(),
      ]);
      try {
        const lista = await coletarMeta(cfg);
        const { total, novos } = await salvarAnuncios(lista, hoje);
        await recalcular(hoje);
        const analisados = await analisarPendentes(hoje, prazo, cfg.iaMaxPorDia);
        await atualizarProdutos(hoje);
        const extra = await posColeta(hoje, prazo, []);
        const msg =
          (total ? `${total} anúncios pela API do Meta.` : "A API do Meta não devolveu anúncios (fora da UE ela só traz anúncios políticos).") + extra;
        await terminar(id, "concluida", msg, { total, novos, analisados });
        return { status: "concluida", mensagem: msg, total, novos, analisados };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await terminar(id, "erro", msg);
        return { status: "erro", mensagem: msg };
      }
    }
  }

  // Espera o robô do Apify terminar (consultando a cada 10 segundos).
  const atual = coleta!;
  try {
    while (true) {
      const s = await situacaoApify(atual.execucao_id!);
      if (s.status === "SUCCEEDED") {
        await executar("UPDATE coletas SET status = 'processando' WHERE id = ?", [atual.id]);
        const extras = jsonSeguro<Extra[]>(atual.extras, []);
        let lista = await resultadosApify(s, montarBuscas(cfg, extras));
        if (temMeta()) lista = lista.concat(await coletarMeta(cfg).catch(() => []));
        const dia = atual.dia;
        const { total, novos } = await salvarAnuncios(lista, dia);
        await recalcular(dia);
        const analisados = await analisarPendentes(dia, prazo, cfg.iaMaxPorDia);
        await atualizarProdutos(dia);
        const extra = total ? await posColeta(dia, prazo, extras) : "";
        const msg = total
          ? `${total} anúncios coletados (${novos} novos), ${analisados} analisados pela IA.${extra}`
          : "O Apify terminou mas não trouxe anúncios. Teste outras palavras-chave ou outro robô (APIFY_ACTOR).";
        await terminar(atual.id, "concluida", msg, { total, novos, analisados });
        return { status: "concluida", mensagem: msg, total, novos, analisados };
      }
      if (["FAILED", "ABORTED", "TIMED-OUT", "TIMED_OUT"].includes(s.status)) {
        const msg = `O robô do Apify falhou (${s.status}). ${s.statusMessage ?? ""}`.trim();
        await terminar(atual.id, "erro", msg);
        return { status: "erro", mensagem: msg };
      }
      if (Date.now() + 15_000 > prazo) {
        return {
          status: "rodando",
          mensagem: "O Apify ainda está coletando. Clique em \"Atualizar agora\" de novo em alguns minutos para buscar o resultado.",
        };
      }
      await esperar(10_000);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Volta para "rodando" para tentar de novo na próxima chamada.
    await executar("UPDATE coletas SET status = 'rodando', mensagem = ? WHERE id = ?", [msg, atual.id]);
    return { status: "erro", mensagem: msg };
  }
}
