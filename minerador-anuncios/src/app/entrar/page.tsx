export const dynamic = "force-dynamic";

export default async function Entrar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const semSenha = !process.env.SENHA_ACESSO;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form method="post" action="/api/entrar" className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-borda bg-painel p-6">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={36} height={36} />
          <h1 className="text-xl font-bold">Minerador de Anúncios</h1>
        </div>
        {semSenha ? (
          <p className="rounded-xl border border-alerta/40 bg-alerta/10 p-3 text-sm text-alerta">
            Defina a senha: coloque <code>SENHA_ACESSO=sua-senha</code> no arquivo <code>.env</code> (ou nas variáveis da
            Vercel) e reinicie.
          </p>
        ) : (
          <>
            <input type="hidden" name="volta" value={sp.volta ?? "/"} />
            <label className="flex flex-col gap-1 text-sm">
              Senha
              <input name="senha" type="password" required autoFocus autoComplete="current-password" className="campo" />
            </label>
            {sp.erro && (
              <p role="alert" className="text-sm text-ruim">
                Senha errada. Tente de novo.
              </p>
            )}
            <button className="botao">Entrar</button>
          </>
        )}
      </form>
    </main>
  );
}
