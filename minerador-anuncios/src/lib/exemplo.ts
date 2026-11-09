// Dados de EXEMPLO, só para conhecer o painel antes de ligar o Apify.
// São anúncios inventados (anunciantes "Loja Exemplo"), marcados com fonte = 'exemplo'
// e com um aviso amarelo no topo do site. Apague em Configurações ou com "npm run exemplo:apagar".

import { emLote, executar, todos, um } from "./db";
import { atualizarProdutos, recalcular, salvarAnuncios } from "./coleta";
import { normalizarApify } from "./normalizar";
import { hojeISO, slug, somarDias } from "./util";

interface ProdutoEx {
  nome: string;
  categoria: string;
  cor: string;
  promessa: string;
  gancho: string;
  oferta: string;
  textos: string[];
  /** País de cada anunciante de exemplo (ex.: ["US","US","BR"]). Padrão: 1 a 3 anunciantes no Brasil. */
  anunciantes?: Array<"BR" | "US">;
}

const PRODUTOS: ProdutoEx[] = [
  {
    nome: "Escova alisadora 3 em 1",
    categoria: "beleza",
    cor: "#d55181",
    promessa: "Cabelo liso e sem frizz em 10 minutos, sem ir ao salão",
    gancho: "Pare de gastar com escova progressiva",
    oferta: "50% de desconto + frete grátis",
    textos: [
      "Pare de gastar com escova progressiva! 💇‍♀️ Com a escova 3 em 1 você seca, alisa e modela em 10 minutos.\n\n✅ Frete grátis\n✅ 50% OFF só hoje",
      "Cabelo de salão em casa, todo dia. Últimas unidades com 50% de desconto 👇",
    ],
  },
  {
    nome: "Corretor de postura",
    categoria: "saúde",
    cor: "#1baf7a",
    promessa: "Postura melhor e menos desconforto nas costas no dia a dia",
    gancho: "Você passa mais de 6 horas sentado?",
    oferta: "Compre 1, leve 2",
    textos: [
      "Você passa mais de 6 horas sentado? Seu corpo sente. O corretor de postura é discreto e usa por baixo da roupa.\n\nCompre 1, leve 2 🔥",
      "Use 20 minutos por dia e sinta a diferença na sua postura. Compre agora com frete grátis.",
    ],
  },
  {
    nome: "Curso de confeitaria para vender",
    categoria: "infoproduto",
    cor: "#eda100",
    promessa: "Aprender a fazer doces que vendem e ter uma renda extra em casa",
    gancho: "Ela começou com R$ 50 na cozinha de casa",
    oferta: "Curso online com bônus e garantia de 7 dias",
    textos: [
      "Ela começou com R$ 50 na cozinha de casa. Hoje vende bolos de pote toda semana. 🍰\n\nNo curso você aprende as receitas que mais vendem. Garantia de 7 dias.",
      "Ebook GRÁTIS: 10 doces que vendem muito. Clique em Saiba mais e baixe agora.",
    ],
  },
  {
    nome: "Fonte de água para gatos",
    categoria: "pets",
    cor: "#3987e5",
    promessa: "Gato bebendo mais água e com menos risco de problema nos rins",
    gancho: "Seu gato bebe pouca água?",
    oferta: "Frete grátis + 30% OFF",
    textos: [
      "Seu gato bebe pouca água? 🐱 Gatos preferem água corrente. A fonte silenciosa faz ele beber até 2x mais.\n\nFrete grátis hoje!",
      "Água fresquinha o dia todo para o seu gato. 30% OFF + frete grátis.",
    ],
  },
  {
    nome: "Mop giratório com balde",
    categoria: "casa",
    cor: "#9085e9",
    promessa: "Limpar a casa inteira em metade do tempo, sem molhar as mãos",
    gancho: "Ainda limpa o chão com pano e rodo?",
    oferta: "De R$ 199 por R$ 99 + frete grátis",
    textos: [
      "Ainda limpa o chão com pano e rodo? 😩 O mop giratório limpa e seca sem você encostar a mão.\n\nDe R$ 199 por R$ 99 + frete grátis",
      "Últimas unidades do mop que viralizou! Compre agora.",
    ],
  },
  {
    nome: "Fone de ouvido sem fio",
    categoria: "eletrônicos",
    cor: "#199e70",
    promessa: "Som de fone caro por um preço baixo, com bateria para o dia todo",
    gancho: "Parece fone de R$ 1.500",
    oferta: "Promoção relâmpago com 60% OFF",
    textos: [
      "Parece fone de R$ 1.500, custa uma fração disso. 🎧 Bateria de 30 horas e cancelamento de ruído.\n\n60% OFF só hoje",
    ],
    anunciantes: ["BR", "BR", "BR", "BR", "BR", "BR", "BR", "BR", "BR", "BR", "BR", "US"],
  },
  {
    nome: "Escova removedora de pelos de pets",
    categoria: "pets",
    cor: "#2a78d6",
    promessa: "Tirar os pelos do sofá e da roupa em segundos, sem refil",
    gancho: "Your couch is covered in pet hair?",
    oferta: "Buy 2, get 1 free",
    textos: [
      "Your couch is covered in pet hair? 🐶 One swipe and it's gone. No refills, no batteries.\n\nBuy 2, get 1 FREE",
      "The pet hair remover everyone is talking about. Free shipping today only.",
    ],
    anunciantes: ["US", "US", "US", "US"],
  },
  {
    nome: "Luminária de pôr do sol",
    categoria: "casa",
    cor: "#eb6834",
    promessa: "Deixar o quarto aconchegante e bonito para fotos",
    gancho: "This $20 lamp changed my room",
    oferta: "50% off + free shipping",
    textos: [
      "This $20 lamp changed my room 🌅 Sunset vibes every night.\n\n50% OFF + free shipping",
    ],
    anunciantes: ["US", "US", "US", "BR"],
  },
  {
    nome: "Garrafa de água com marcador de horário",
    categoria: "fitness",
    cor: "#1baf7a",
    promessa: "Beber a quantidade certa de água no dia sem precisar lembrar",
    gancho: "I never drank enough water until this",
    oferta: "Limited stock, 40% off",
    textos: [
      "I never drank enough water until this bottle 💧 Time markers keep you on track all day.\n\nLimited stock — 40% OFF",
    ],
    anunciantes: ["US", "US"],
  },
  {
    nome: "Kit de massinha educativa",
    categoria: "infantil",
    cor: "#e66767",
    promessa: "Criança longe das telas, brincando e aprendendo",
    gancho: "Seu filho passa horas no celular?",
    oferta: "Kit com 24 cores + frete grátis",
    textos: [
      "Seu filho passa horas no celular? 📱 O kit de massinha prende a atenção e estimula a criatividade.\n\nKit com 24 cores + frete grátis",
    ],
  },
];

/** Gerador de números "aleatórios" que dá sempre o mesmo resultado (o exemplo fica igual toda vez). */
function sorteio(semente: number) {
  let s = semente;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function imagemSvg(texto: string, cor: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${cor}"/><stop offset="1" stop-color="#15181d"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><text x="300" y="280" font-family="Arial" font-size="38" font-weight="bold" fill="#fff" text-anchor="middle">${texto}</text><text x="300" y="340" font-family="Arial" font-size="26" fill="#fff" opacity="0.8" text-anchor="middle">IMAGEM DE EXEMPLO</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export async function carregarExemplos(dias = 14): Promise<number> {
  const hoje = hojeISO();
  const r = sorteio(42);
  const plataformasTodas = ["FACEBOOK", "INSTAGRAM", "MESSENGER", "AUDIENCE_NETWORK"];

  // Cada anunciante de exemplo vende um produto e tem uma "curva" de anúncios ativos ao longo dos dias.
  interface Anunciante {
    pagina: string;
    nome: string;
    pais: "BR" | "US";
    produto: ProdutoEx;
    inicio: number; // quantos dias atrás começou
    base: number; // anúncios ativos no início
    crescimento: number; // anúncios a mais por dia
  }
  const anunciantes: Anunciante[] = [];
  let n = 0;
  for (const p of PRODUTOS) {
    const lista = p.anunciantes ?? Array.from({ length: 1 + Math.floor(r() * 3) }, () => "BR" as const);
    for (const pais of lista) {
      n++;
      anunciantes.push({
        pagina: String(900000000000 + n),
        nome: pais === "US" ? `Example Store ${n}` : `Loja Exemplo ${n}`,
        pais,
        produto: p,
        inicio: 10 + Math.floor(r() * 80),
        base: 1 + Math.floor(r() * 4),
        crescimento: r() < 0.3 ? 0.6 + r() * 0.8 : r() < 0.5 ? -0.15 : r() * 0.1,
      });
    }
  }

  let total = 0;
  for (let d = dias - 1; d >= 0; d--) {
    const dia = somarDias(hoje, -d);
    const itens: Array<{ item: unknown; pais: string }> = [];
    for (const a of anunciantes) {
      const ativos = Math.max(1, Math.round(a.base + a.crescimento * (dias - 1 - d)));
      const pr = a.produto;
      for (let k = 0; k < ativos; k++) {
        const id = `${a.pagina}${String(k).padStart(3, "0")}`;
        const texto = pr.textos[k % pr.textos.length];
        const inicioAnuncio = somarDias(hoje, -(a.inicio - k * 3 > 1 ? a.inicio - k * 3 : 1));
        if (inicioAnuncio > dia) continue;
        const plataformas = plataformasTodas.slice(0, 1 + ((k + Number(a.pagina.slice(-1))) % 4));
        itens.push({ pais: a.pais, item: {
          ad_archive_id: id,
          page_id: a.pagina,
          page_name: a.nome,
          is_active: true,
          start_date: Math.floor(Date.parse(inicioAnuncio + "T12:00:00Z") / 1000),
          publisher_platform: plataformas,
          collation_count: k % 3 === 0 ? 1 + Math.floor(r() * 6) : 1,
          snapshot: {
            body: { text: texto },
            title: pr.nome,
            cta_text: a.pais === "US" ? "Shop now" : pr.categoria === "infoproduto" ? "Saiba mais" : "Comprar agora",
            link_url: `https://loja-exemplo-${a.pagina.slice(-2)}.invalid/${slug(pr.nome)}?utm_source=fb`,
            display_format: "IMAGE",
            images: [{ original_image_url: imagemSvg(pr.nome, pr.cor) }],
          },
        } });
      }
    }
    const lista = itens
      .map((i) => normalizarApify(i.item, { fonte: "exemplo", pais: i.pais, palavraChave: "exemplo" }))
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .map((x) => ({ ...x, criativo_chave: `ex-${x.pagina_id}-${Number(x.id.slice(-3)) % 2}` }));
    const { total: t } = await salvarAnuncios(lista, dia);
    total = t;
    await recalcular(dia);

    // Análise "da IA" de exemplo (texto fixo, sem gastar nada).
    const comandos: Array<[string, Array<string | number | null>]> = [];
    for (const item of lista) {
      const a = anunciantes.find((x) => x.pagina === item.pagina_id)!;
      const pr = a.produto;
      const pid = slug(pr.nome);
      comandos.push([
        `INSERT INTO analises (anuncio_id, categoria, produto_nome, produto_id, promessa, gancho, oferta, chamada, publico,
          por_que_funciona, ideias, modelo, criado_em, erro)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'exemplo', ?, NULL) ON CONFLICT (anuncio_id) DO NOTHING`,
        [
          item.id, pr.categoria, pr.nome, pid, pr.promessa, pr.gancho, pr.oferta, item.cta ?? "Comprar agora",
          "Exemplo de público",
          "Exemplo: mostra uma dor comum logo na primeira frase e resolve com uma oferta clara.",
          JSON.stringify([
            { titulo: "Antes e depois", gancho: "Exemplo de gancho 1", roteiro: "Ideia de exemplo (a IA de verdade escreve aqui).", visual: "Vídeo de exemplo" },
            { titulo: "Depoimento real", gancho: "Exemplo de gancho 2", roteiro: "Ideia de exemplo.", visual: "Foto de exemplo" },
            { titulo: "Demonstração", gancho: "Exemplo de gancho 3", roteiro: "Ideia de exemplo.", visual: "Vídeo curto de exemplo" },
          ]),
          new Date().toISOString(),
        ],
      ]);
      comandos.push(["UPDATE anuncios SET categoria = ?, produto_id = ? WHERE id = ?", [pr.categoria, pid, item.id]]);
    }
    await emLote(comandos);
    await atualizarProdutos(dia);
  }
  // Uma das oportunidades aparece como "já conferida no Brasil".
  await executar(
    "INSERT INTO verificacoes (produto_id, pais, dia) VALUES (?, 'BR', ?) ON CONFLICT (produto_id, pais) DO UPDATE SET dia = excluded.dia",
    [slug("Escova removedora de pelos de pets"), hoje],
  );
  await executar(
    "INSERT INTO coletas (id, dia, inicio, fim, status, fonte, total, mensagem) VALUES (?, ?, ?, ?, 'concluida', 'exemplo', ?, ?) ON CONFLICT (id) DO NOTHING",
    ["exemplo", hoje, new Date().toISOString(), new Date().toISOString(), total, "Dados de exemplo carregados"],
  );
  return total;
}

declare global {
  // eslint-disable-next-line no-var
  var __mineradorDemo: Promise<void> | undefined;
}

/**
 * Versão de demonstração (DEMO=1): se o banco estiver vazio, carrega os exemplos sozinho.
 * Usado no link de demonstração; no uso normal não faz nada.
 */
export async function carregarDemoSePreciso(): Promise<void> {
  if (process.env.DEMO !== "1") return;
  if (!globalThis.__mineradorDemo) {
    globalThis.__mineradorDemo = (async () => {
      const r = await um<{ n: number }>("SELECT COUNT(*) AS n FROM anuncios");
      if (Number(r?.n ?? 0) === 0) await carregarExemplos();
    })().catch((e) => {
      globalThis.__mineradorDemo = undefined;
      throw e;
    });
  }
  await globalThis.__mineradorDemo;
}

export async function apagarExemplos(): Promise<void> {
  const ads = await todos<{ id: string; pagina_id: string | null; produto_id: string | null }>(
    "SELECT id, pagina_id, produto_id FROM anuncios WHERE fonte = 'exemplo'",
  );
  const paginas = [...new Set(ads.map((a) => a.pagina_id).filter(Boolean))] as string[];
  const produtos = [...new Set(ads.map((a) => a.produto_id).filter(Boolean))] as string[];
  const comandos: Array<[string, Array<string | number | null>]> = [];
  for (const a of ads) {
    comandos.push(["DELETE FROM analises WHERE anuncio_id = ?", [a.id]]);
    comandos.push(["DELETE FROM historico_anuncio WHERE anuncio_id = ?", [a.id]]);
    comandos.push(["DELETE FROM favoritos_usuarios WHERE anuncio_id = ?", [a.id]]);
    comandos.push(["DELETE FROM anuncio_paises WHERE anuncio_id = ?", [a.id]]);
    comandos.push(["DELETE FROM roteiros WHERE anuncio_id = ?", [a.id]]);
  }
  for (const p of paginas) comandos.push(["DELETE FROM historico_anunciante WHERE pagina_id = ?", [p]]);
  comandos.push(["DELETE FROM anuncios WHERE fonte = 'exemplo'", []]);
  comandos.push(["DELETE FROM coletas WHERE fonte = 'exemplo'", []]);
  for (const p of produtos) comandos.push(["DELETE FROM verificacoes WHERE produto_id = ?", [p]]);
  await emLote(comandos);
  // Produtos que ficaram sem nenhum anúncio real.
  for (const p of produtos) {
    const resta = await todos("SELECT id FROM anuncios WHERE produto_id = ? LIMIT 1", [p]);
    if (resta.length === 0) {
      await executar("DELETE FROM produtos WHERE id = ?", [p]);
      await executar("DELETE FROM historico_produto WHERE produto_id = ?", [p]);
      await executar("DELETE FROM produto_pais WHERE produto_id = ?", [p]);
    }
  }
}
