import { FASES, type Fase } from "@/lib/pontuacao";

const CORES: Record<Fase, string> = {
  comecando: "border-bom/50 bg-bom/10 text-bom",
  escalando: "border-quente/50 bg-quente/10 text-quente",
  saturado: "border-ruim/50 bg-ruim/10 text-ruim",
  queda: "border-borda bg-painel-2 text-texto-3",
  estavel: "border-borda bg-painel-2 text-texto-2",
};

/** Selo do termômetro de saturação. Mostra a explicação ao passar o dedo/mouse. */
export default function SeloFase({ fase, motivo, grande = false }: { fase: string | null; motivo?: string | null; grande?: boolean }) {
  if (!fase || !(fase in FASES)) return null;
  const f = fase as Fase;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border font-semibold ${CORES[f]} ${grande ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs"}`}
      title={[motivo, FASES[f].dica].filter(Boolean).join(" — ")}
    >
      {FASES[f].rotulo}
    </span>
  );
}
