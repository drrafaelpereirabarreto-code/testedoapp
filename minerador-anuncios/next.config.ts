import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O "pg" (Postgres) roda só no servidor e não deve ser empacotado.
  serverExternalPackages: ["pg"],
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
