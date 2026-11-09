import { GradeAnuncios } from "@/components/CartaoAnuncio";
import { campeoesPorMes } from "@/lib/consultas";
import { nomeMes } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function Meses() {
  const meses = await campeoesPorMes(15);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Arquivo por mês</h1>
        <p className="text-sm text-texto-2">
          Os campeões de cada mês: a maior Pontuação de Escala que cada anúncio atingiu naquele mês.
        </p>
      </div>
      {meses.length === 0 && (
        <p className="rounded-2xl border border-dashed border-borda p-8 text-center text-sm text-texto-2">
          O arquivo começa a encher a partir da primeira coleta.
        </p>
      )}
      {meses.map((m) => (
        <section key={m.mes} className="flex flex-col gap-3">
          <h2 className="text-lg font-bold capitalize">
            {nomeMes(m.mes)} <span className="text-sm font-normal text-texto-3">· {m.total} anúncios acompanhados</span>
          </h2>
          <GradeAnuncios itens={m.itens.map((i) => ({ ...i, pontuacao: i.max_pontos }))} />
        </section>
      ))}
    </div>
  );
}
