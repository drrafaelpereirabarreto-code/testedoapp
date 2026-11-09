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
process.env.MIDIA_PASTA = path.join(pasta, "midia");
process.env.TELEGRAM_BOT_TOKEN = "123:telegram-de-teste";
process.env.TELEGRAM_CHAT_ID = "999";
process.env.SITE_URL = "https://meu-minerador.exemplo";

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

// Dois anúncios do mesmo fone vindos da busca dos EUA (o produto aparece nos dois países).
for (let i = 0; i < 2; i++) {
  itensApify.push({
    ...structuredClone(itensApify[5]),
    ad_archive_id: String(2000 + i),
    page_id: "p3",
    page_name: "US Store",
    url: "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&media_type=all&q=free+shipping&search_type=keyword_unordered",
  });
  itensApify[itensApify.length - 1].snapshot.images = [{ original_image_url: `https://scontent.xx.fbcdn.net/v/us${i}.jpg` }];
}

let chamadasApify: string[] = [];
const mensagensTelegram: string[] = [];
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
    if (u.startsWith("https://scontent.xx.fbcdn.net/")) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    }
    if (u.startsWith("https://api.telegram.org/")) {
      mensagensTelegram.push(JSON.parse(String(init?.body)).text);
      return Response.json({ ok: true });
    }
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
  const { salvarConfig } = await import("../src/lib/config");
  await salvarConfig({ guardarMidiaPontuacao: 30 });

  const r = await executarColeta({ forcar: true, limiteMs: 60_000 });
  assert.equal(r.status, "concluida", r.mensagem);
  assert.equal(r.total, 8);
  assert.equal(r.novos, 8);

  // Pediu ao robô padrão com as palavras-chave padrão x 2 países.
  const entrada = corpoInicio as { urls: Array<{ url: string }>; limitPerSource: number };
  assert.equal(entrada.urls.length, 8, "5 palavras-chave do Brasil + 3 dos EUA");
  assert.ok(chamadasApify[0].startsWith("POST /acts/curious_coder~facebook-ads-library-scraper/runs"));

  const anuncios = await todos<{ id: string; anunciante_ativos: number; duplicacoes: number; pontuacao: number; pais: string; categoria: string; produto_id: string }>(
    "SELECT id, anunciante_ativos, duplicacoes, pontuacao, pais, categoria, produto_id FROM anuncios ORDER BY id",
  );
  assert.equal(anuncios.length, 8);
  assert.equal(anuncios[0].anunciante_ativos, 4);
  assert.equal(anuncios[0].duplicacoes, 5, "collation_count do Meta");
  assert.equal(anuncios[1].duplicacoes, 2, "mesma imagem em 2 anúncios");
  assert.equal(anuncios[0].pais, "BR");
  assert.ok(anuncios.every((a) => a.pontuacao > 0));

  // IA: o anúncio 1001 tem o mesmo criativo do 1000 e reaproveita a análise (5 chamadas para 6 anúncios).
  assert.equal(pedidosIA.length, 7);
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
  const fases = await todos<{ id: string; fase: string }>("SELECT id, fase FROM produtos ORDER BY id");
  assert.ok(fases.every((f) => f.fase), "todo produto ganha uma fase");

  // País de cada anúncio e produto por país.
  const porPais = await todos<{ produto_id: string; pais: string; anuncios_ativos: number }>(
    "SELECT produto_id, pais, anuncios_ativos FROM produto_pais ORDER BY produto_id, pais",
  );
  assert.deepEqual(
    porPais.map((p) => `${p.produto_id} ${p.pais} ${p.anuncios_ativos}`),
    ["curso-de-bolos-para-vender BR 4", "fone-de-ouvido-sem-fio BR 2", "fone-de-ouvido-sem-fio US 2"],
  );

  // Criativos fortes guardados no disco.
  const salvos = await todos<{ id: string; imagem_salva: string }>("SELECT id, imagem_salva FROM anuncios WHERE imagem_salva IS NOT NULL");
  assert.ok(salvos.length > 0, "guardou algum criativo");
  assert.match(salvos[0].imagem_salva, /^\/api\/midia\/\d+\.jpg$/);
  assert.ok(fs.existsSync(path.join(process.env.MIDIA_PASTA!, salvos[0].imagem_salva.split("/").pop()!)));

  // Resumo pelo Telegram, com links para o painel.
  assert.equal(mensagensTelegram.length, 1);
  assert.match(mensagensTelegram[0], /Os que mais escalaram/);
  assert.match(mensagensTelegram[0], /https:\/\/meu-minerador\.exemplo\/anuncio\//);

  const hist = await todos("SELECT * FROM historico_anuncio");
  assert.equal(hist.length, 8);

  // Segunda chamada no mesmo dia (agendador) não coleta de novo.
  const r2 = await executarColeta({ forcar: false, limiteMs: 10_000 });
  assert.equal(r2.status, "pulada");
  assert.equal(mensagensTelegram.length, 1, "não manda o resumo duas vezes no mesmo dia");
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

test("oportunidades: forte nos EUA, sem ninguém no Brasil", async () => {
  const { executar, emLote } = await import("../src/lib/db");
  const { listarOportunidades, produtosParaConferir } = await import("../src/lib/oportunidades");
  const { hojeISO } = await import("../src/lib/util");
  const dia = hojeISO();
  await emLote([
    ["INSERT INTO produtos (id, nome, categoria, primeira_vez, ultima_vez, anuncios_ativos, anunciantes, dias_max, pontuacao_max, tendencia) VALUES ('escova-pet', 'Escova de pelos de pet', 'pets', ?, ?, 20, 4, 60, 85, 0.5)", [dia, dia]],
    ["INSERT INTO produto_pais (produto_id, pais, dia, anuncios_ativos, anunciantes) VALUES ('escova-pet', 'US', ?, 20, 4)", [dia]],
  ]);
  const { itens } = await listarOportunidades();
  const escova = itens.find((o) => o.id === "escova-pet");
  assert.ok(escova, "a escova aparece como oportunidade");
  assert.equal(escova!.alvoAnunciantes, 0);
  assert.ok(escova!.nota > 50);
  // O fone já tem 1 anunciante no Brasil: oportunidade, mas com nota menor.
  const fone = itens.find((o) => o.id === "fone-de-ouvido-sem-fio");
  assert.ok(fone && fone.nota < escova!.nota);

  // Amanhã o robô procura a escova no Brasil pelo nome.
  const conferir = await produtosParaConferir(dia);
  assert.ok(conferir.some((c) => c.produto_id === "escova-pet" && c.pais === "BR" && c.termo === "Escova de pelos de pet"));
  const { montarBuscas } = await import("../src/lib/fontes");
  const { lerConfig } = await import("../src/lib/config");
  const buscas = montarBuscas(await lerConfig(), conferir);
  assert.ok(buscas.some((b) => b.pais === "BR" && b.palavraChave === "Escova de pelos de pet"));
  await executar("DELETE FROM produto_pais WHERE produto_id = 'escova-pet'");
});
