// Testa a coleta inteira sem internet: um Apify e uma Anthropic de mentira respondem às chamadas.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "minerador-"));
process.env.SQLITE_ARQUIVO = path.join(pasta, "teste.db");
process.env.APIFY_TOKEN = "token-de-teste";
process.env.ANTHROPIC_API_KEY = "chave-de-teste";
process.env.CLAUDE_MODELO = "claude-opus-5-5";
// Para testar no Postgres: TESTE_DATABASE_URL=postgres://... npm test (banco vazio, só para teste).
if (process.env.TESTE_DATABASE_URL) process.env.DATABASE_URL = process.env.TESTE_DATABASE_URL;
else delete process.env.DATABASE_URL;
delete process.env.META_TOKEN;

const itensApify = Array.from({ length: 6 }, (_, i) => ({
  ad_archive_id: String(1000 + i),
  page_id: i < 4 ? "p1" : "p2",
  page_name: i < 4 ? "Loja Um" : "Loja Dois",
  is_active: true,
  start_date: Math.floor(Date.now() / 1000) - (40 + i) * 86400,
  publisher_platform: ["FACEBOOK", "INSTAGRAM"],
  collation_count: i === 0 ? 5 : 1,
  url: "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&media_type=all&q=ebook&search_type=keyword_unordered",
  snapshot: {
    body: { text: i < 4 ? "Aprenda a fazer bolos que vendem" : "Fone sem fio com 60% OFF" },
    title: i < 4 ? "Curso de bolos" : "Fone",
    cta_text: "Saiba mais",
    link_url: i < 4 ? "https://bolos.com.br/curso" : "https://fones.com/oferta",
    images: [{ original_image_url: `https://scontent.xx.fbcdn.net/v/img${i < 2 ? "A" : i}.jpg?x=1` }],
  },
}));

let chamadasApify: string[] = [];
let corpoInicio: unknown = null;
const fetchOriginal = globalThis.fetch;

let pedidosIA: Array<{ corpo: Record<string, unknown>; beta: string | null }> = [];
function fetchIA(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const corpo = JSON.parse(String(init?.body));
  const headers = new Headers(init?.headers);
  pedidosIA.push({ corpo, beta: headers.get("anthropic-beta") });
  const texto = String(corpo.messages[0].content.at(-1).text);
  const ehBolo = texto.includes("bolos");
  const analise = {
    categoria: ehBolo ? "infoproduto" : "eletrônicos",
    produto_nome: ehBolo ? "Curso de bolos para vender" : "Fone de ouvido sem fio",
    promessa: "p", gancho: "g", oferta: "o", chamada: "c", publico: "pu", por_que_funciona: "pq",
    ideias: [1, 2, 3].map((n) => ({ titulo: `t${n}`, gancho: "g", roteiro: "r", visual: "v" })),
  };
  return Promise.resolve(
    new Response(
      JSON.stringify({
        id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify(analise) }],
        stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

before(async () => {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    chamadasApify.push(`${init?.method ?? "GET"} ${u.replace("https://api.apify.com/v2", "")}`);
    if (u.includes("/acts/") && init?.method === "POST") {
      corpoInicio = JSON.parse(String(init.body));
      return Response.json({ data: { id: "run1", status: "RUNNING", defaultDatasetId: "ds1" } }, { status: 201 });
    }
    if (u.includes("/actor-runs/run1")) return Response.json({ data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" } });
    if (u.includes("/datasets/ds1/items")) return Response.json(u.includes("offset=0") ? itensApify : []);
    return new Response("não esperado: " + u, { status: 500 });
  }) as typeof fetch;
  const { definirClienteParaTeste } = await import("../src/lib/ia");
  definirClienteParaTeste(new Anthropic({ apiKey: "x", fetch: fetchIA as typeof fetch, maxRetries: 0 }));
});

after(() => {
  globalThis.fetch = fetchOriginal;
  // Fecha a conexão com o banco para o teste terminar.
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
  fs.rmSync(pasta, { recursive: true, force: true });
});

test("coleta completa: Apify → banco → pontuação → IA → produtos", async () => {
  const { executarColeta } = await import("../src/lib/coleta");
  const { todos } = await import("../src/lib/db");

  const r = await executarColeta({ forcar: true, limiteMs: 60_000 });
  assert.equal(r.status, "concluida", r.mensagem);
  assert.equal(r.total, 6);
  assert.equal(r.novos, 6);

  // Pediu ao robô padrão com as palavras-chave padrão x 2 países.
  const entrada = corpoInicio as { urls: Array<{ url: string }>; limitPerSource: number };
  assert.equal(entrada.urls.length, 10);
  assert.ok(chamadasApify[0].startsWith("POST /acts/curious_coder~facebook-ads-library-scraper/runs"));

  const anuncios = await todos<{ id: string; anunciante_ativos: number; duplicacoes: number; pontuacao: number; pais: string; categoria: string; produto_id: string }>(
    "SELECT id, anunciante_ativos, duplicacoes, pontuacao, pais, categoria, produto_id FROM anuncios ORDER BY id",
  );
  assert.equal(anuncios.length, 6);
  assert.equal(anuncios[0].anunciante_ativos, 4);
  assert.equal(anuncios[0].duplicacoes, 5, "collation_count do Meta");
  assert.equal(anuncios[1].duplicacoes, 2, "mesma imagem em 2 anúncios");
  assert.equal(anuncios[0].pais, "BR");
  assert.ok(anuncios.every((a) => a.pontuacao > 0));

  // IA: o anúncio 1001 tem o mesmo criativo do 1000 e reaproveita a análise (5 chamadas para 6 anúncios).
  assert.equal(pedidosIA.length, 5);
  assert.equal(anuncios[0].categoria, "infoproduto");
  assert.equal(anuncios[0].produto_id, "curso-de-bolos-para-vender");
  const primeiro = pedidosIA[0];
  assert.equal(primeiro.corpo.model, "claude-opus-5-5");
  assert.equal(primeiro.corpo.fallbacks, "default");
  assert.ok(primeiro.beta?.includes("server-side-fallback-2026-07-01"));
  const oc = primeiro.corpo.output_config as { effort: string; format: { type: string } };
  assert.equal(oc.effort, "low");
  assert.equal(oc.format.type, "json_schema");

  const produtos = await todos<{ id: string; anuncios_ativos: number; anunciantes: number }>("SELECT * FROM produtos ORDER BY anuncios_ativos DESC");
  assert.equal(produtos.length, 2);
  assert.equal(produtos[0].id, "curso-de-bolos-para-vender");
  assert.equal(produtos[0].anuncios_ativos, 4);

  const hist = await todos("SELECT * FROM historico_anuncio");
  assert.equal(hist.length, 6);

  // Segunda chamada no mesmo dia (agendador) não coleta de novo.
  const r2 = await executarColeta({ forcar: false, limiteMs: 10_000 });
  assert.equal(r2.status, "pulada");
});

test("sem nenhuma chave: avisa em vez de quebrar", async () => {
  const token = process.env.APIFY_TOKEN;
  delete process.env.APIFY_TOKEN;
  const { executarColeta } = await import("../src/lib/coleta");
  const r = await executarColeta({ forcar: true, limiteMs: 5_000 });
  assert.equal(r.status, "erro");
  assert.match(r.mensagem, /APIFY_TOKEN/);
  process.env.APIFY_TOKEN = token;
});
