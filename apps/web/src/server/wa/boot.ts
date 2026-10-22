import "server-only";
import { iniciarAgendador, type Agendador } from "./agendador";
import { modeloDoAmbiente } from "./ia/modelo";
import { leitorDoAmbiente } from "./ia/midia";
import { logWa } from "./log";
import type { DepsNucleo } from "./nucleo";
import { criarProvedor } from "./provider";
import { configRitmoDoAmbiente, criarRitmo } from "./ritmo";
import { iniciarWorkerEntrada, type WorkerEntrada } from "./worker";

/**
 * Liga o WhatsApp direto no portal (chamado por `instrumentation.ts`, uma vez por processo do servidor Next). Só liga com
 * `WHATSAPP_WORKER_ENABLED=1`: sem número (staging sem chip) nada fica tentando. Sem provedor configurado, também não liga.
 */
export const workerHabilitado = (): boolean => process.env["WHATSAPP_WORKER_ENABLED"] === "1";

let ligado: { entrada: WorkerEntrada; agendador: Agendador } | null = null;

export function nucleoDoAmbiente(baixarMidia?: DepsNucleo["baixarMidia"]): DepsNucleo {
  return { agente: { modelo: modeloDoAmbiente() }, midia: leitorDoAmbiente(), ...(baixarMidia ? { baixarMidia } : {}) };
}

export function iniciarWhatsapp(): boolean {
  if (ligado || !workerHabilitado()) return false;
  const provedor = criarProvedor();
  if (!provedor) {
    logWa({ etapa: "boot", motivo: "provedor_nao_configurado" });
    return false;
  }
  const ritmo = criarRitmo(configRitmoDoAmbiente());
  const conc = Number(process.env["WHATSAPP_WORKER_CONCURRENCY"]);
  const entrada = iniciarWorkerEntrada(
    { provedor, ritmo, nucleo: nucleoDoAmbiente((ref) => provedor.baixarMidia(ref)) },
    { concorrencia: Number.isFinite(conc) && conc > 0 ? Math.min(Math.floor(conc), 8) : 2 },
  );
  const agendador = iniciarAgendador({ provedor, ritmo });
  ligado = { entrada, agendador };
  logWa({ etapa: "boot", provedor: provedor.id, ia: !!process.env["ANTHROPIC_API_KEY"], midia: !!process.env["GEMINI_API_KEY"] });
  const parar = () => { void ligado?.entrada.parar(); void ligado?.agendador.parar(); };
  process.once("SIGTERM", parar);
  return true;
}
