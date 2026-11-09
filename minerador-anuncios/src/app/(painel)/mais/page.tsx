import Link from "next/link";

export const dynamic = "force-dynamic";

const ITENS = [
  { href: "/categorias", rotulo: "🗂️ Por categoria", texto: "Cada nicho separado" },
  { href: "/meses", rotulo: "📅 Por mês", texto: "Os campeões de cada mês" },
  { href: "/favoritos?de=todos", rotulo: "👥 Favoritos de todos", texto: "Os salvos por todas as pessoas que usam o site" },
  { href: "/config", rotulo: "⚙️ Configurações", texto: "Palavras-chave, países, resumo diário, criativos" },
];

export default function Mais() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Mais</h1>
      {ITENS.map((i) => (
        <Link key={i.href} href={i.href} className="rounded-2xl border border-borda bg-painel p-4 hover:border-texto-3">
          <p className="font-semibold">{i.rotulo}</p>
          <p className="text-sm text-texto-2">{i.texto}</p>
        </Link>
      ))}
      <form method="post" action="/api/sair">
        <button className="botao-sec w-full">Sair</button>
      </form>
    </div>
  );
}
