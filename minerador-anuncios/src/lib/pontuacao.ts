// O coração do sistema: a Pontuação de Escala (0 a 100).
//
// Soma de 5 sinais, cada um com um teto:
//   Tempo no ar ................ até 30 pontos  (30 dias ≈ 25 pts; 60+ dias = 30)
//   Anúncios ativos ............ até 25 pontos  (do mesmo anunciante ou da mesma página de destino; 50+ = 25)
//   Duplicações do criativo .... até 20 pontos  (mesmo vídeo/imagem em vários anúncios; 20+ = 20)
//   Crescimento ................ até 15 pontos  (anúncios ativos do anunciante subindo nos últimos 7 dias)
//   Plataformas ................ até 10 pontos  (Facebook, Instagram, Messenger, Audience Network...)
//
// Escalas em logaritmo: os primeiros anúncios/dias valem mais que os últimos
// (sair de 1 para 10 anúncios diz muito mais que sair de 40 para 50).

export const PESOS = { tempo: 30, ativos: 25, duplicacoes: 20, crescimento: 15, plataformas: 10 } as const;

export interface Sinais {
  diasNoAr: number;
  anuncianteAtivos: number;
  dominioAtivos: number;
  duplicacoes: number;
  /** Anúncios ativos do anunciante hoje e há ~7 dias (null = ainda sem histórico). */
  ativosHoje: number;
  ativosAntes: number | null;
  plataformas: number;
}

export interface Pontuacao {
  total: number;
  partes: { tempo: number; ativos: number; duplicacoes: number; crescimento: number; plataformas: number };
  crescimento: number; // variação em % (0.5 = +50%)
  escalando: boolean;
  motivos: string[];
}

function escalaLog(valor: number, teto: number, peso: number, minimo = 1): number {
  if (valor <= minimo) return 0;
  return peso * Math.min(1, Math.log(valor) / Math.log(teto));
}

export function calcularPontuacao(s: Sinais): Pontuacao {
  const dias = Math.max(0, s.diasNoAr);
  const tempo = PESOS.tempo * Math.min(1, Math.log1p(dias) / Math.log1p(60));
  const ativosRef = Math.max(s.anuncianteAtivos, s.dominioAtivos, 1);
  const ativos = escalaLog(ativosRef, 50, PESOS.ativos);
  const duplicacoes = escalaLog(Math.max(1, s.duplicacoes), 20, PESOS.duplicacoes);

  let variacao = 0;
  let crescimento = 0;
  if (s.ativosAntes !== null && s.ativosAntes >= 0) {
    const base = Math.max(1, s.ativosAntes);
    variacao = (s.ativosHoje - s.ativosAntes) / base;
    // +100% ou mais em 7 dias = nota máxima.
    crescimento = PESOS.crescimento * Math.max(0, Math.min(1, variacao));
  }
  const plataformas = PESOS.plataformas * Math.min(1, Math.max(0, s.plataformas) / 4);

  const partes = {
    tempo: Math.round(tempo * 10) / 10,
    ativos: Math.round(ativos * 10) / 10,
    duplicacoes: Math.round(duplicacoes * 10) / 10,
    crescimento: Math.round(crescimento * 10) / 10,
    plataformas: Math.round(plataformas * 10) / 10,
  };
  const total = Math.min(100, Math.round(tempo + ativos + duplicacoes + crescimento + plataformas));

  // "Escalando agora": o anunciante colocou mais anúncios no ar nos últimos dias.
  const delta = s.ativosAntes === null ? 0 : s.ativosHoje - s.ativosAntes;
  const subindo = s.ativosAntes !== null && delta >= 2 && variacao >= 0.2;
  // Sem histórico ainda (primeiros dias de uso): anúncio novo + muitas variações = sinal de escala.
  const novoComVariacoes = s.ativosAntes === null && dias <= 14 && ativosRef >= 8 && s.duplicacoes >= 3;
  const escalando = subindo || novoComVariacoes;

  const motivos: string[] = [];
  if (dias >= 30) motivos.push(`No ar há ${dias} dias — provavelmente dá lucro`);
  else if (dias >= 7) motivos.push(`No ar há ${dias} dias`);
  if (ativosRef >= 5) motivos.push(
      s.dominioAtivos > s.anuncianteAtivos
        ? `${s.dominioAtivos} anúncios ativos levando para a mesma página de destino`
        : `${s.anuncianteAtivos} anúncios ativos do mesmo anunciante`,
    );
  if (s.duplicacoes >= 3) motivos.push(`Mesmo criativo em ${s.duplicacoes} anúncios`);
  if (subindo) motivos.push(`Anúncios ativos subiram ${Math.round(variacao * 100)}% (de ${s.ativosAntes} para ${s.ativosHoje})`);
  if (novoComVariacoes) motivos.push("Anúncio novo já com muitas variações");
  if (s.plataformas >= 3) motivos.push(`Rodando em ${s.plataformas} plataformas`);

  return { total, partes, crescimento: Math.round(variacao * 1000) / 1000, escalando, motivos };
}

/** Tendência de um produto: variação dos anúncios ativos em relação a ~7 dias antes. */
export function tendencia(hoje: number, antes: number | null): number {
  if (antes === null) return 0;
  return Math.round(((hoje - antes) / Math.max(1, antes)) * 1000) / 1000;
}
