// Nomes bonitos para mostrar na tela.

export const PLATAFORMAS: Record<string, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  MESSENGER: "Messenger",
  AUDIENCE_NETWORK: "Audience Network",
  THREADS: "Threads",
  WHATSAPP: "WhatsApp",
};

export const PLATAFORMAS_CURTO: Record<string, string> = {
  FACEBOOK: "FB",
  INSTAGRAM: "IG",
  MESSENGER: "MSG",
  AUDIENCE_NETWORK: "AN",
  THREADS: "TH",
  WHATSAPP: "WA",
};

export function corPontuacao(p: number): string {
  if (p >= 70) return "bg-quente text-black";
  if (p >= 50) return "bg-alerta text-black";
  if (p >= 30) return "bg-destaque text-white";
  return "bg-painel-2 text-texto-2 border border-borda";
}

export function rotuloCategoria(c: string | null | undefined): string {
  if (!c) return "sem análise";
  return c;
}

export function tendenciaTexto(t: number): { texto: string; classe: string } {
  if (t >= 0.2) return { texto: `▲ +${Math.round(t * 100)}%`, classe: "text-bom" };
  if (t <= -0.2) return { texto: `▼ ${Math.round(t * 100)}%`, classe: "text-ruim" };
  return { texto: "● estável", classe: "text-texto-3" };
}
