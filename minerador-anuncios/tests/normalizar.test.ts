import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarApify, normalizarMeta, lerData } from "../src/lib/normalizar";
import { chaveDestino, diasEntre, slug, somarDias } from "../src/lib/util";
import { entradaApify, montarBuscas } from "../src/lib/fontes";
import { PADRAO } from "../src/lib/config";

// Formato do robô padrão (curious_coder/facebook-ads-library-scraper).
const itemSnake = {
  ad_archive_id: "1234567890123456",
  page_id: "111",
  page_name: "Loja X",
  is_active: true,
  start_date: 1759276800, // 01/10/2025 00:00 UTC
  end_date: null,
  publisher_platform: ["FACEBOOK", "INSTAGRAM", "AUDIENCE_NETWORK"],
  collation_count: 7,
  collation_id: "999",
  url: "https://www.facebook.com/ads/library/?q=x",
  snapshot: {
    body: { text: "Texto do anúncio" },
    title: "{{product.name}}",
    cta_text: "Comprar agora",
    link_url: "https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.lojax.com.br%2Fproduto%3Futm%3D1",
    display_format: "VIDEO",
    page_profile_picture_url: "https://x/foto.jpg",
    images: [],
    videos: [{ video_hd_url: "https://video.xx.fbcdn.net/v/abc123.mp4?oh=1", video_preview_image_url: "https://x/capa.jpg" }],
    cards: [],
  },
};

test("normaliza o formato com sublinhado (robô padrão)", () => {
  const a = normalizarApify(itemSnake, { fonte: "apify", pais: "BR", palavraChave: "x" })!;
  assert.equal(a.id, "1234567890123456");
  assert.equal(a.pagina_nome, "Loja X");
  assert.equal(a.texto, "Texto do anúncio");
  assert.equal(a.titulo, null, "modelo {{product.name}} não é texto");
  assert.equal(a.dominio, "lojax.com.br");
  assert.equal(a.video_url, "https://video.xx.fbcdn.net/v/abc123.mp4?oh=1");
  assert.equal(a.imagem_url, "https://x/capa.jpg");
  assert.deepEqual(a.plataformas, ["FACEBOOK", "INSTAGRAM", "AUDIENCE_NETWORK"]);
  assert.equal(a.colacao_qtd, 7);
  assert.equal(a.data_inicio, "2025-09-30"); // meia-noite UTC = 21h do dia anterior em São Paulo
  assert.equal(a.biblioteca_url, "https://www.facebook.com/ads/library/?id=1234567890123456");
  assert.ok(a.criativo_chave);
});

test("o mesmo vídeo com parâmetros diferentes gera a mesma chave de criativo", () => {
  const outro = structuredClone(itemSnake);
  outro.ad_archive_id = "222";
  outro.snapshot.videos[0].video_hd_url = "https://video.xx.fbcdn.net/v/abc123.mp4?oh=OUTRO";
  const a = normalizarApify(itemSnake, { fonte: "apify" })!;
  const b = normalizarApify(outro, { fonte: "apify" })!;
  assert.equal(a.criativo_chave, b.criativo_chave);
});

test("normaliza o formato camelCase (robô apify/facebook-ads-scraper)", () => {
  const a = normalizarApify(
    {
      adArchiveID: "555",
      pageID: "9",
      pageName: "Marca Y",
      isActive: true,
      startDateFormatted: "2026-10-01T07:00:00.000Z",
      publisherPlatform: ["facebook", "instagram", "messenger"],
      collationCount: 3,
      snapshot: {
        body: { text: "Oi" },
        ctaText: "Saiba mais",
        linkUrl: "https://marcay.com/oferta",
        cards: [{ originalImageUrl: "https://img/1.jpg", title: "Título do card" }],
      },
    },
    { fonte: "apify" },
  )!;
  assert.equal(a.id, "555");
  assert.equal(a.titulo, "Título do card");
  assert.equal(a.imagem_url, "https://img/1.jpg");
  assert.equal(a.cta, "Saiba mais");
  assert.deepEqual(a.plataformas, ["FACEBOOK", "INSTAGRAM", "MESSENGER"]);
  assert.equal(a.data_inicio, "2026-10-01");
});

test("ignora itens sem ID numérico", () => {
  assert.equal(normalizarApify({ foo: 1 }, { fonte: "apify" }), null);
  assert.equal(normalizarApify(null, { fonte: "apify" }), null);
});

test("API do Meta: não guarda o link com o token", () => {
  const a = normalizarMeta(
    { id: "77", page_name: "P", ad_creative_bodies: ["Corpo"], ad_snapshot_url: "https://facebook.com/ads/archive/render_ad/?id=77&access_token=SEGREDO", publisher_platforms: ["facebook"] },
    { fonte: "meta", pais: "BR" },
  )!;
  assert.equal(a.texto, "Corpo");
  assert.ok(!a.biblioteca_url.includes("SEGREDO"));
});

test("datas", () => {
  assert.equal(lerData("2026-01-02"), "2026-01-02");
  assert.equal(lerData(null), null);
  assert.equal(somarDias("2026-03-01", -1), "2026-02-28");
  assert.equal(diasEntre("2026-01-01", "2026-01-31"), 30);
});

test("slug do produto", () => {
  assert.equal(slug("Escova Alisadora 3 em 1!"), "escova-alisadora-3-em-1");
  assert.equal(slug("Fonte de água p/ gatos"), "fonte-de-agua-p-gatos");
});

test("página de destino", () => {
  assert.equal(chaveDestino("https://www.loja.com.br/produto/?utm_source=fb"), "loja.com.br/produto");
  assert.equal(chaveDestino("https://loja.com.br/"), "loja.com.br");
  assert.equal(chaveDestino("https://api.whatsapp.com/send?phone=55"), null);
  assert.equal(chaveDestino("https://www.instagram.com/perfil"), null);
  assert.equal(chaveDestino("https://shopee.com.br/"), null);
  assert.equal(chaveDestino("https://pay.hotmart.com/A123"), "pay.hotmart.com/a123");
});

test("buscas: palavra-chave x país, frase exata entre aspas e anunciantes", () => {
  const b = montarBuscas({ ...PADRAO, palavrasChave: ["ebook", '"frete grátis"'], paises: ["BR", "US"], idioma: "pt", anunciantes: ["123"] });
  assert.equal(b.length, 6);
  const u = new URL(b[1].url);
  assert.equal(u.searchParams.get("q"), "frete grátis");
  assert.equal(u.searchParams.get("search_type"), "keyword_exact_phrase");
  assert.equal(u.searchParams.get("country"), "BR");
  assert.equal(u.searchParams.get("active_status"), "active");
  assert.equal(u.searchParams.get("content_languages[0]"), "pt");
  assert.equal(new URL(b[2].url).searchParams.get("view_all_page_id"), "123");
});

test("entrada do robô padrão do Apify", () => {
  const b = montarBuscas({ ...PADRAO, palavrasChave: ["a", "b"], paises: ["BR"] });
  const e = entradaApify("curious_coder~facebook-ads-library-scraper", b, 50) as { urls: Array<{ url: string }>; limitPerSource: number };
  assert.equal(e.urls.length, 2);
  assert.equal(e.limitPerSource, 50);
});
