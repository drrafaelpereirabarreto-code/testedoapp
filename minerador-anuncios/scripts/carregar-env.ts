// Lê o arquivo .env (as chaves) quando rodamos scripts fora do Next.
import fs from "node:fs";
if (fs.existsSync(".env")) process.loadEnvFile(".env");
