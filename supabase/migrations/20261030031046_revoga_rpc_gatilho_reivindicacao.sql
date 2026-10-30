-- A função do gatilho de reivindicação não deve ser chamada como RPC (o gatilho continua funcionando).
revoke execute on function public.check_establishment_claim() from public, anon, authenticated;
