import Link from "next/link";
import CartaoAnuncio from "@/components/CartaoAnuncio";
import { favoritos } from "@/lib/consultas";

export const dynamic = "force-dynamic";

export default async function Favoritos() {
  const itens = await favoritos();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">Favoritos</h1>
        <p className="text-sm text-texto-2">Os anúncios que você salvou, com as suas anotações.</p>
      </div>
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
              key={a.id}
              a={a}
              extra={
                a.nota ? (
                  <p className="texto-anuncio line-clamp-4 rounded-lg border border-borda bg-painel-2 p-2 text-xs text-texto-2">
                    📝 {a.nota}
                  </p>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
