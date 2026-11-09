"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** "Atualizar agora": roda a coleta na hora (pode levar alguns minutos). */
export function BotaoAtualizar({ compacto = false }: { compacto?: boolean }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function atualizar() {
    setRodando(true);
    setMsg("Coletando… pode levar de 1 a 5 minutos. Pode continuar usando o site.");
    try {
      const r = await fetch("/api/coletar", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { mensagem?: string; erro?: string };
      setMsg(j.mensagem ?? j.erro ?? (r.ok ? "Pronto." : `Erro ${r.status}`));
      router.refresh();
    } catch {
      setMsg("A conexão caiu, mas a coleta continua no Apify. Clique de novo daqui a alguns minutos.");
    } finally {
      setRodando(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={atualizar} disabled={rodando} className="botao whitespace-nowrap">
        <span aria-hidden className={rodando ? "animate-spin" : ""}>
          ↻
        </span>
        {compacto ? (rodando ? "…" : "Atualizar") : rodando ? "Coletando…" : "Atualizar agora"}
      </button>
      {msg && (
        <p role="status" className="max-w-xs text-right text-xs text-texto-2">
          {msg}
        </p>
      )}
    </div>
  );
}

/** Copia um texto para a área de transferência. */
export function BotaoCopiar({ texto, rotulo = "Copiar texto" }: { texto: string; rotulo?: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      const t = document.createElement("textarea");
      t.value = texto;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }
  return (
    <button type="button" onClick={copiar} className="botao-sec" aria-live="polite">
      {copiado ? "✓ Copiado" : `⧉ ${rotulo}`}
    </button>
  );
}

/** Estrela de favorito + campo de anotações. */
export function Favorito({ id, inicial, notaInicial }: { id: string; inicial: boolean; notaInicial: string | null }) {
  const router = useRouter();
  const [fav, setFav] = useState(inicial);
  const [nota, setNota] = useState(notaInicial ?? "");
  const [estado, setEstado] = useState<string | null>(null);

  async function enviar(acao: "salvar" | "remover", textoNota = nota) {
    setEstado("Salvando…");
    const r = await fetch("/api/favoritos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, acao, nota: textoNota }),
    });
    if (r.ok) {
      setFav(acao === "salvar");
      setEstado(acao === "salvar" ? "Salvo ✓" : "Removido dos favoritos");
      router.refresh();
    } else setEstado("Não consegui salvar. Tente de novo.");
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => enviar(fav ? "remover" : "salvar")}
        className={fav ? "botao" : "botao-sec"}
        aria-pressed={fav}
      >
        {fav ? "★ Nos favoritos" : "☆ Salvar nos favoritos"}
      </button>
      <label className="flex flex-col gap-1 text-xs text-texto-2">
        Minhas anotações
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={4}
          placeholder="Ex.: testar esse gancho com o produto X; fornecedor no AliExpress…"
          className="campo"
        />
      </label>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => enviar("salvar")} className="botao-sec">
          Salvar anotação
        </button>
        {estado && (
          <span role="status" className="text-xs text-texto-2">
            {estado}
          </span>
        )}
      </div>
    </div>
  );
}

/** Pede a análise da IA para um anúncio. */
export function BotaoAnalisar({ id, refazer = false }: { id: string; refazer?: boolean }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function analisar() {
    setRodando(true);
    setErro(null);
    const r = await fetch("/api/analisar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; erro?: string };
    setRodando(false);
    if (j.ok) router.refresh();
    else setErro(j.erro ?? "Não deu certo.");
  }
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={analisar} disabled={rodando} className={refazer ? "botao-sec" : "botao"}>
        {rodando ? "Analisando… (até 1 minuto)" : refazer ? "↻ Analisar de novo" : "✨ Analisar com IA"}
      </button>
      {erro && <p className="text-xs text-ruim">{erro}</p>}
    </div>
  );
}

/** "Criar roteiro completo" para uma das 3 ideias da IA. */
export function BotaoRoteiro({ id, ideia }: { id: string; ideia: number }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function criar() {
    setRodando(true);
    setErro(null);
    const r = await fetch("/api/roteiro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ideia }),
    }).catch(() => null);
    const j = (await r?.json().catch(() => ({}))) as { ok?: boolean; erro?: string } | undefined;
    setRodando(false);
    if (j?.ok) {
      router.refresh();
      setTimeout(() => document.getElementById("roteiros")?.scrollIntoView({ behavior: "smooth" }), 400);
    } else setErro(j?.erro ?? "Não deu certo. Tente de novo.");
  }
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={criar} disabled={rodando} className="botao-sec text-xs">
        {rodando ? "Escrevendo… (até 1 minuto)" : "🎬 Criar roteiro completo"}
      </button>
      {erro && <p className="text-xs text-ruim">{erro}</p>}
    </div>
  );
}
