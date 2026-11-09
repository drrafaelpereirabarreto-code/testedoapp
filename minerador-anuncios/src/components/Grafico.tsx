"use client";

// Gráfico de linha simples (uma série por gráfico), com linha-guia e caixinha ao passar o dedo/mouse,
// e uma tabela com os mesmos números logo abaixo.
import { useRef, useState } from "react";

interface Ponto {
  dia: string;
  valor: number;
}

const COR = "#3987e5";

function diaCurto(d: string) {
  const [, m, dd] = d.split("-");
  return `${dd}/${m}`;
}

export default function Grafico({ titulo, pontos, unidade = "" }: { titulo: string; pontos: Ponto[]; unidade?: string }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);

  if (pontos.length === 0) {
    return (
      <figure className="rounded-2xl border border-borda bg-painel p-4">
        <figcaption className="text-sm font-semibold">{titulo}</figcaption>
        <p className="mt-2 text-sm text-texto-3">Ainda sem histórico. O gráfico aparece a partir da próxima coleta.</p>
      </figure>
    );
  }

  const L = 640;
  const A = 200;
  const m = { e: 36, d: 12, t: 12, b: 26 };
  const max = Math.max(1, ...pontos.map((p) => p.valor));
  // Teto "redondo" (10, 20, 30… ou 100, 200…) para as marcas do eixo saírem em números inteiros.
  const passo = max <= 10 ? 10 : Math.pow(10, Math.floor(Math.log10(max)));
  const teto = Math.max(10, Math.ceil(max / passo) * passo);
  const x = (i: number) => m.e + (pontos.length === 1 ? (L - m.e - m.d) / 2 : (i * (L - m.e - m.d)) / (pontos.length - 1));
  const y = (v: number) => m.t + (A - m.t - m.b) * (1 - v / teto);
  const caminho = pontos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
  const marcas = teto % 2 === 0 ? [0, teto / 2, teto] : [0, teto];
  const passoRotulo = Math.max(1, Math.ceil(pontos.length / 6));

  function mover(ev: React.PointerEvent<SVGSVGElement>) {
    const caixa = ref.current?.getBoundingClientRect();
    if (!caixa) return;
    const px = ((ev.clientX - caixa.left) / caixa.width) * L;
    let melhor = 0;
    for (let i = 1; i < pontos.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(melhor) - px)) melhor = i;
    setAtivo(melhor);
  }

  const pa = ativo !== null ? pontos[ativo] : null;

  return (
    <figure className="rounded-2xl border border-borda bg-painel p-4">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{titulo}</span>
        <span className="text-xs text-texto-3">
          {pa ? (
            <>
              <strong className="text-base text-texto tabular-nums">
                {pa.valor}
                {unidade}
              </strong>{" "}
              em {diaCurto(pa.dia)}
            </>
          ) : (
            <>
              hoje: <strong className="text-base text-texto tabular-nums">{pontos[pontos.length - 1].valor}{unidade}</strong>
            </>
          )}
        </span>
      </figcaption>
      <svg
        ref={ref}
        viewBox={`0 0 ${L} ${A}`}
        className="mt-2 w-full touch-none select-none"
        role="img"
        aria-label={`${titulo}: de ${pontos[0].valor} em ${diaCurto(pontos[0].dia)} para ${pontos[pontos.length - 1].valor} em ${diaCurto(pontos[pontos.length - 1].dia)}`}
        onPointerMove={mover}
        onPointerDown={mover}
        onPointerLeave={() => setAtivo(null)}
      >
        {marcas.map((v) => (
          <g key={v}>
            <line x1={m.e} x2={L - m.d} y1={y(v)} y2={y(v)} stroke="#262b34" strokeWidth={1} />
            <text x={m.e - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#7a828f">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {pontos.map((p, i) =>
          i % passoRotulo === 0 || i === pontos.length - 1 ? (
            <text key={p.dia} x={x(i)} y={A - 6} textAnchor="middle" fontSize={11} fill="#7a828f">
              {diaCurto(p.dia)}
            </text>
          ) : null,
        )}
        <path d={caminho} fill="none" stroke={COR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {pontos.length <= 40 &&
          pontos.map((p, i) => <circle key={p.dia} cx={x(i)} cy={y(p.valor)} r={4} fill={COR} stroke="#15181d" strokeWidth={2} />)}
        {pa && ativo !== null && (
          <>
            <line x1={x(ativo)} x2={x(ativo)} y1={m.t} y2={A - m.b} stroke="#a9b0bb" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x(ativo)} cy={y(pa.valor)} r={6} fill={COR} stroke="#15181d" strokeWidth={2} />
          </>
        )}
      </svg>
      <details className="mt-2 text-xs text-texto-2">
        <summary className="cursor-pointer text-texto-3">Ver números em tabela</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead>
            <tr className="text-texto-3">
              <th className="py-1 font-normal">Dia</th>
              <th className="py-1 font-normal">{titulo}</th>
            </tr>
          </thead>
          <tbody>
            {pontos.map((p) => (
              <tr key={p.dia} className="border-t border-borda">
                <td className="py-1">{diaCurto(p.dia)}</td>
                <td className="py-1">
                  {p.valor}
                  {unidade}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
