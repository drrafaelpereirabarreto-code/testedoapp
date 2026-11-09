// Resumo diário no celular: os anúncios que mais escalaram, as melhores oportunidades e os produtos começando.
// Canais (use um ou os dois):
//  - Telegram: TELEGRAM_BOT_TOKEN no .env + o seu "chat" (o site descobre sozinho em Configurações).
//  - E-mail:  RESEND_API_KEY + RESUMO_EMAIL no .env (resend.com, plano grátis).

import { lerConfig, salvarConfig } from "./config";
import { todos } from "./db";
import { listarOportunidades } from "./oportunidades";
import { FASES, type Fase } from "./pontuacao";
import { formatarData, hojeISO } from "./util";

export interface ConteudoResumo {
  dia: string;
  escalando: Array<{ id: string; pagina: string; produto: string | null; pontuacao: number; dias: number; ativos: number }>;
  oportunidades: Array<{ id: string; nome: string; nota: number; fora: string; alvoAnunciantes: number }>;
  comecando: Array<{ id: string; nome: string; motivo: string }>;
}

export function siteUrl(): string {
  const u = process.env.SITE_URL?.trim() || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return u.replace(/\/+$/, "");
}

export function temTelegram(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
}

export function temEmail(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESUMO_EMAIL?.trim());
}

export async function montarResumo(dia: string, quantidade: number): Promise<ConteudoResumo> {
  const escalando = await todos<{
    id: string; pagina_nome: string | null; produto_nome: string | null; pontuacao: number; dias_no_ar: number; anunciante_ativos: number; pagina_id: string | null;
  }>(
    `SELECT a.id, a.pagina_nome, a.pagina_id, s.produto_nome, a.pontuacao, a.dias_no_ar, a.anunciante_ativos
     FROM anuncios a LEFT JOIN analises s ON s.anuncio_id = a.id AND s.erro IS NULL
     WHERE a.ultima_vez = ? ORDER BY a.escalando DESC, a.pontuacao DESC LIMIT 200`,
    [dia],
  );
  // Um anúncio por anunciante, para o resumo não ficar repetido.
  const vistos = new Set<string>();
  const escolhidos: ConteudoResumo["escalando"] = [];
  for (const e of escalando) {
    const chave = e.pagina_id ?? e.id;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    escolhidos.push({
      id: e.id,
      pagina: e.pagina_nome ?? "Anunciante",
      produto: e.produto_nome,
      pontuacao: Number(e.pontuacao),
      dias: Number(e.dias_no_ar),
      ativos: Number(e.anunciante_ativos),
    });
    if (escolhidos.length >= quantidade) break;
  }

  const { itens, paisAlvo } = await listarOportunidades();
  const oportunidades = itens.slice(0, 3).map((o) => ({
    id: o.id,
    nome: o.nome,
    nota: o.nota,
    fora: o.fora.map((f) => `${f.pais} ${f.anuncios}`).join(", "),
    alvoAnunciantes: o.alvoAnunciantes,
    paisAlvo,
  }));

  const comecando = await todos<{ id: string; nome: string; fase_motivo: string | null }>(
    "SELECT id, nome, fase_motivo FROM produtos WHERE ultima_vez = ? AND fase = 'comecando' ORDER BY pontuacao_max DESC LIMIT 3",
    [dia],
  );

  return {
    dia,
    escalando: escolhidos,
    oportunidades,
    comecando: comecando.map((c) => ({ id: c.id, nome: c.nome, motivo: c.fase_motivo ?? "" })),
  };
}

function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Texto em HTML simples (o Telegram e o e-mail entendem). */
export function resumoHtml(r: ConteudoResumo, url = siteUrl()): string {
  const link = (caminho: string, texto: string) => (url ? `<a href="${url}${caminho}">${esc(texto)}</a>` : esc(texto));
  const linhas: string[] = [`<b>🔥 Minerador de Anúncios — ${formatarData(r.dia)}</b>`, ""];
  if (r.escalando.length) {
    linhas.push("<b>Os que mais escalaram</b>");
    r.escalando.forEach((e, i) => {
      linhas.push(
        `${i + 1}. ${link(`/anuncio/${e.id}`, e.produto ?? e.pagina)} — <b>${e.pontuacao}</b> pts · ${e.dias}d no ar · ${e.ativos} ativos (${esc(e.pagina)})`,
      );
    });
  } else {
    linhas.push("Nenhum anúncio coletado hoje.");
  }
  if (r.oportunidades.length) {
    linhas.push("", "<b>🌎 Oportunidades (forte lá fora, pouca concorrência aqui)</b>");
    for (const o of r.oportunidades) {
      linhas.push(
        `• ${link(`/produtos/${o.id}`, o.nome)} — nota ${o.nota} · lá fora: ${esc(o.fora)} anúncios · aqui: ${o.alvoAnunciantes} anunciante${o.alvoAnunciantes === 1 ? "" : "s"}`,
      );
    }
  }
  if (r.comecando.length) {
    linhas.push("", `<b>${FASES.comecando.rotulo}</b>`);
    for (const c of r.comecando) linhas.push(`• ${link(`/produtos/${c.id}`, c.nome)} — ${esc(c.motivo)}`);
  }
  if (url) linhas.push("", link("/", "Abrir o painel"));
  return linhas.join("\n");
}

async function enviarTelegram(html: string, chatId: string): Promise<void> {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`Telegram respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function enviarEmail(html: string, dia: string): Promise<void> {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESUMO_REMETENTE || "Minerador de Anúncios <onboarding@resend.dev>",
      to: process.env.RESUMO_EMAIL!.split(",").map((e) => e.trim()),
      subject: `🔥 Anúncios escalando — ${formatarData(dia)}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${html.replace(/\n/g, "<br>")}</div>`,
    }),
  });
  if (!r.ok) throw new Error(`Resend respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

export function chatTelegram(chatSalvo: string): string {
  return process.env.TELEGRAM_CHAT_ID?.trim() || chatSalvo;
}

/**
 * Envia o resumo do dia (uma vez por dia). Com forcar=true envia de novo (botão "Enviar resumo agora").
 * Devolve o que aconteceu, em português, para mostrar na tela.
 */
export async function enviarResumo(opcoes: { dia?: string; forcar?: boolean } = {}): Promise<{ enviado: boolean; mensagem: string }> {
  const cfg = await lerConfig();
  const dia = opcoes.dia ?? hojeISO();
  if (!opcoes.forcar && (!cfg.resumoAtivo || cfg.ultimoResumo === dia)) return { enviado: false, mensagem: "" };
  const chat = chatTelegram(cfg.telegramChatId);
  const canais: string[] = [];
  const erros: string[] = [];
  if (!(temTelegram() && chat) && !temEmail()) {
    return { enviado: false, mensagem: "Nenhum canal configurado (Telegram ou e-mail). Veja o README, passo 7." };
  }
  const html = resumoHtml(await montarResumo(dia, cfg.resumoQuantidade));
  if (temTelegram() && chat) {
    try {
      await enviarTelegram(html, chat);
      canais.push("Telegram");
    } catch (e) {
      erros.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (temEmail()) {
    try {
      await enviarEmail(html, dia);
      canais.push("e-mail");
    } catch (e) {
      erros.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (canais.length) await salvarConfig({ ultimoResumo: dia });
  return {
    enviado: canais.length > 0,
    mensagem: [canais.length ? `Resumo enviado por ${canais.join(" e ")}.` : "", ...erros].filter(Boolean).join(" "),
  };
}

/**
 * Descobre o seu "chat" do Telegram: você manda qualquer mensagem para o seu robô e clica no botão;
 * o site lê a última mensagem recebida e guarda de quem ela veio.
 */
export async function descobrirChatTelegram(): Promise<{ ok: boolean; mensagem: string }> {
  if (!temTelegram()) return { ok: false, mensagem: "Falta o TELEGRAM_BOT_TOKEN no .env." };
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates?limit=20`);
  if (!r.ok) return { ok: false, mensagem: `O Telegram recusou o token (${r.status}). Confira o TELEGRAM_BOT_TOKEN.` };
  const j = (await r.json()) as { result?: Array<{ message?: { chat?: { id: number; first_name?: string; title?: string } } }> };
  const ultima = [...(j.result ?? [])].reverse().find((u) => u.message?.chat?.id);
  if (!ultima?.message?.chat) {
    return { ok: false, mensagem: "Nenhuma mensagem encontrada. Abra o seu robô no Telegram, mande um “oi” e clique de novo." };
  }
  const chat = ultima.message.chat;
  await salvarConfig({ telegramChatId: String(chat.id) });
  return { ok: true, mensagem: `Pronto! Conectado ao chat de ${chat.first_name ?? chat.title ?? "você"}.` };
}

export type { Fase };
