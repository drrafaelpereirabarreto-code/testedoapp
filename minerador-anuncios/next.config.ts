import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O "pg" (Postgres) roda só no servidor e não deve ser empacotado.
  serverExternalPackages: ["pg"],
  images: { unoptimized: true },
  poweredByHeader: false,
  // Não leva para o servidor os dados locais nem os testes.
  outputFileTracingExcludes: { "*": ["dados/**", "tests/**", "scripts/**", "README.md"] },
};

export default nextConfig;
