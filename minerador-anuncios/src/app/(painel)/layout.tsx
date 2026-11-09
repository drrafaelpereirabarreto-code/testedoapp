import Link from "next/link";
import { BotaoAtualizar } from "@/components/Botoes";
import { numerosGerais } from "@/lib/consultas";
import { formatarData } from "@/lib/util";
import { carregarDemoSePreciso } from "@/lib/exemplo";
import { nomeBonito, usuarioAtual } from "@/lib/usuario";
import { variosUsuarios } from "@/lib/sessao";

export const dynamic = "force-dynamic";

const LINKS = [
  { href: "/", rotulo: "Hoje", icone: "🔥", celular: "Hoje" },
  { href: "/oportunidades", rotulo: "Oportunidades", icone: "🌎", celular: "Oportun." },
  { href: "/produtos", rotulo: "Produtos", icone: "📦", celular: "Produtos" },
  { href: "/categorias", rotulo: "Categorias", icone: "🗂️", celular: null },
  { href: "/ganchos", rotulo: "Ganchos", icone: "🪝", celular: "Ganchos" },
  { href: "/meses", rotulo: "Por mês", icone: "📅", celular: null },
  { href: "/favoritos", rotulo: "Favoritos", icone: "★", celular: "Favoritos" },
  { href: "/config", rotulo: "Configurações", icone: "⚙️", celular: null },
];

const CELULAR = [...LINKS.filter((l) => l.celular), { href: "/mais", rotulo: "Mais", icone: "☰", celular: "Mais" }];

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  await carregarDemoSePreciso();
  const [n, usuario] = await Promise.all([numerosGerais(), usuarioAtual()]);
  return (
    <div className="pb-20 md:pb-0">
      <header className="sticky top-0 z-20 border-b border-borda bg-fundo/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-bold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={28} height={28} />
            <span className="hidden sm:inline md:hidden xl:inline">Minerador de Anúncios</span>
          </Link>
          <nav aria-label="Principal" className="hidden flex-1 flex-wrap items-center gap-0.5 md:flex">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-lg px-2.5 py-2 text-sm text-texto-2 hover:bg-painel hover:text-texto">
                {l.rotulo}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-right text-xs text-texto-3 2xl:block">
              Última coleta: {formatarData(n.dia)}
              <br />
              {n.total} anúncios no banco
              {variosUsuarios() && <> · {nomeBonito(usuario)}</>}
            </span>
            <BotaoAtualizar compacto />
          </div>
        </div>
      </header>

      {n.exemplo > 0 && (
        <div className="border-b border-alerta/40 bg-alerta/10 px-4 py-2 text-center text-sm text-alerta">
          Você está vendo <strong>dados de EXEMPLO</strong> (inventados, só para conhecer o painel).{" "}
          <Link href="/config#exemplo" className="underline">
            Apagar exemplos
          </Link>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-5">{children}</main>

      {/* Menu de baixo no celular */}
      <nav
        aria-label="Principal (celular)"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-borda bg-painel/95 backdrop-blur md:hidden"
      >
        {CELULAR.map((l) => (
          <Link key={l.href} href={l.href} className="flex flex-col items-center gap-0.5 py-2 text-[10px] text-texto-2">
            <span aria-hidden className="text-base leading-none">
              {l.icone}
            </span>
            {l.celular}
          </Link>
        ))}
      </nav>
    </div>
  );
}
