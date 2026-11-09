// Roda a coleta pelo terminal:  npm run coletar
// Use num agendador (cron do servidor, Agendador de Tarefas do Windows) para rodar todo dia.
//   --forcar   coleta de novo mesmo que já tenha coletado hoje
import "./carregar-env";
import { executarColeta } from "../src/lib/coleta";

const forcar = process.argv.includes("--forcar");
console.log(`Iniciando a coleta${forcar ? " (forçada)" : ""}…`);
// No terminal não há limite de tempo da Vercel: espera até 30 minutos.
const r = await executarColeta({ forcar, limiteMs: 30 * 60_000 });
console.log(`[${r.status}] ${r.mensagem}`);
process.exit(r.status === "erro" ? 1 : 0);
