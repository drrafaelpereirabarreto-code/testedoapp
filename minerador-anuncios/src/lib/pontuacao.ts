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

// ---------------------------------------------------------------------------
// Termômetro de saturação: em que fase o produto está.
// ---------------------------------------------------------------------------

export type Fase = "comecando" | "escalando" | "saturado" | "queda" | "estavel";

export const FASES: Record<Fase, { rotulo: string; dica: string }> = {
  comecando: { rotulo: "🌱 Começando", dica: "Poucos anunciantes e anúncios recentes: bom momento para testar." },
  escalando: { rotulo: "🚀 Escalando", dica: "Cada vez mais anúncios no ar: o produto está vendendo." },
  saturado: { rotulo: "🧱 Saturado", dica: "Muita gente vendendo: só entre com um ângulo ou oferta bem diferente." },
  queda: { rotulo: "📉 Em queda", dica: "Os anúncios estão saindo do ar." },
  estavel: { rotulo: "➖ Estável", dica: "Sem grandes mudanças nos últimos dias." },
};

export interface SinaisProduto {
  anunciantes: number;
  /** Anunciantes ~7 dias atrás (null = ainda sem histórico). */
  anunciantesAntes: number | null;
  anunciosAtivos: number;
  /** Variação dos anúncios ativos em ~7 dias (0.5 = +50%). */
  tendencia: number;
  /** Dias no ar do anúncio mais antigo do produto. */
  diasMax: number;
}

export const LIMITES_FASE = { saturadoAnunciantes: 10, saturadoRapido: 6, comecandoAnunciantes: 2, comecandoDias: 30 };

export function faseProduto(s: SinaisProduto): { fase: Fase; motivo: string } {
  const L = LIMITES_FASE;
  const crescAnunciantes =
    s.anunciantesAntes !== null && s.anunciantesAntes > 0 ? (s.anunciantes - s.anunciantesAntes) / s.anunciantesAntes : 0;
  if (s.anunciantes >= L.saturadoAnunciantes) {
    return { fase: "saturado", motivo: `${s.anunciantes} anunciantes vendendo o mesmo produto` };
  }
  if (s.anunciantes >= L.saturadoRapido && crescAnunciantes >= 0.5) {
    return {
      fase: "saturado",
      motivo: `Anunciantes subiram de ${s.anunciantesAntes} para ${s.anunciantes} em uma semana (a concorrência está chegando rápido)`,
    };
  }
  if (s.anunciantes <= L.comecandoAnunciantes && s.diasMax <= L.comecandoDias) {
    return {
      fase: "comecando",
      motivo: `Só ${s.anunciantes} anunciante${s.anunciantes === 1 ? "" : "s"} e o anúncio mais antigo tem ${s.diasMax} dias`,
    };
  }
  if (s.tendencia >= 0.2) {
    return { fase: "escalando", motivo: `Anúncios ativos subiram ${Math.round(s.tendencia * 100)}% em ~7 dias` };
  }
  if (s.tendencia <= -0.3) {
    return { fase: "queda", motivo: `Anúncios ativos caíram ${Math.round(-s.tendencia * 100)}% em ~7 dias` };
  }
  if (s.anunciosAtivos >= 10) {
    return { fase: "escalando", motivo: `${s.anunciosAtivos} anúncios ativos ao mesmo tempo` };
  }
  return { fase: "estavel", motivo: "Sem grandes mudanças nos últimos dias" };
}

// ---------------------------------------------------------------------------
// Oportunidade: forte lá fora, pouca ou nenhuma concorrência no seu país.
// ---------------------------------------------------------------------------

export interface SinaisOportunidade {
  foraAnuncios: number;
  foraAnunciantes: number;
  pontuacaoMax: number;
  tendencia: number;
  alvoAnunciantes: number;
}

/** Nota de 0 a 100. Zero quando já há concorrência demais no país-alvo. */
export function notaOportunidade(s: SinaisOportunidade): number {
  if (s.foraAnuncios <= 0 || s.alvoAnunciantes > 2) return 0;
  const forca =
    0.5 * Math.min(100, s.pontuacaoMax) +
    25 * Math.min(1, Math.log(1 + s.foraAnuncios) / Math.log(31)) +
    15 * Math.min(1, s.foraAnunciantes / 5) +
    10 * Math.max(0, Math.min(1, s.tendencia));
  const concorrencia = s.alvoAnunciantes === 0 ? 1 : s.alvoAnunciantes === 1 ? 0.75 : 0.5;
  return Math.round(forca * concorrencia);
}
