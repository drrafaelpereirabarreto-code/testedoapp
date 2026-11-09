// Carrega (ou apaga) dados de EXEMPLO para conhecer o painel antes de ligar o Apify.
//   npm run exemplo          carrega
//   npm run exemplo:apagar   apaga
import "./carregar-env";
import { apagarExemplos, carregarExemplos } from "../src/lib/exemplo";

if (process.argv.includes("--apagar")) {
  await apagarExemplos();
  console.log("Dados de exemplo apagados.");
} else {
  const n = await carregarExemplos();
  console.log(`Pronto: ${n} anúncios de exemplo (14 dias de histórico). Rode "npm run dev" e abra http://localhost:3000`);
}
process.exit(0);
