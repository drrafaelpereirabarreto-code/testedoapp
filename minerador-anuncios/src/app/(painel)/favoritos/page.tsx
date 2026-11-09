import Link from "next/link";
import CartaoAnuncio from "@/components/CartaoAnuncio";
import { favoritos } from "@/lib/consultas";
import { variosUsuarios } from "@/lib/sessao";
import { nomeBonito } from "@/lib/usuario";

export const dynamic = "force-dynamic";

export default async function Favoritos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const deTodos = (await searchParams).de === "todos";
  const itens = await favoritos(deTodos);
  const varios = variosUsuarios();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">Favoritos</h1>
        <p className="text-sm text-texto-2">
          {deTodos ? "Os anúncios salvos por todas as pessoas que usam o site." : "Os anúncios que você salvou, com as suas anotações."}
        </p>
      </div>
      {varios && (
        <nav className="flex gap-2 text-sm">
          <Link href="/favoritos" className={`rounded-full border px-3 py-1 ${!deTodos ? "border-destaque bg-destaque/15" : "border-borda"}`}>
            Meus
          </Link>
          <Link href="/favoritos?de=todos" className={`rounded-full border px-3 py-1 ${deTodos ? "border-destaque bg-destaque/15" : "border-borda"}`}>
            De todos
          </Link>
        </nav>
      )}
      {itens.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-borda p-8 text-center text-sm text-texto-2">
          Nenhum favorito ainda. Abra um anúncio e toque em “☆ Salvar nos favoritos”.{" "}
          <Link href="/" className="text-destaque-forte underline">
            Ver anúncios de hoje
          </Link>
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {itens.map((a) => (
            <CartaoAnuncio
              key={`${a.usuario}-${a.id}`}
              a={a}
              extra={
                <>
                  {deTodos && varios && <p className="text-xs text-texto-3">Salvo por {nomeBonito(a.usuario)}</p>}
                  {a.nota ? (
                    <p className="texto-anuncio line-clamp-4 rounded-lg border border-borda bg-painel-2 p-2 text-xs text-texto-2">
                      📝 {a.nota}
                    </p>
                  ) : null}
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
