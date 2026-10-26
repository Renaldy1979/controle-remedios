import { criarEvolutionGo } from "./evolution-go";
import { criarFake, type ProvedorFake } from "./fake";
import { criarMeta } from "./meta";
import type { ProvedorWhatsapp } from "./types";

export * from "./types";
export { criarFake, type ProvedorFake } from "./fake";
export { criarEvolutionGo } from "./evolution-go";

/** Provedor do ambiente: `WHATSAPP_PROVIDER` = evolution-go (padrão) | fake | meta. */
export const provedorConfigurado = (): "evolution-go" | "fake" | "meta" => {
  const v = (process.env["WHATSAPP_PROVIDER"] ?? "evolution-go").trim().toLowerCase();
  return v === "fake" || v === "meta" ? v : "evolution-go";
};

export const evolutionConfigurada = (): boolean =>
  !!(process.env["EVOLUTION_BASE_URL"]?.trim() && (process.env["EVOLUTION_INSTANCE_TOKEN"]?.trim() || process.env["EVOLUTION_API_KEY"]?.trim()) && process.env["EVOLUTION_INSTANCE_ID"]?.trim());

let _fake: ProvedorFake | undefined;
/** O fake é único por processo: o simulador e o worker enxergam as mesmas mensagens "enviadas". */
export function provedorFake(): ProvedorFake {
  return (_fake ??= criarFake(process.env["WHATSAPP_FAKE_FILE"] ? { arquivo: process.env["WHATSAPP_FAKE_FILE"] } : {}));
}

/** Provedor do ambiente, ou null se ainda não há configuração (sem número, o portal funciona do mesmo jeito). */
export function criarProvedor(): ProvedorWhatsapp | null {
  const id = provedorConfigurado();
  if (id === "fake") {
    if (process.env["APP_ENV"] === "production") throw new Error("O provedor fake é recusado com APP_ENV=production.");
    return provedorFake();
  }
  if (id === "meta") return criarMeta();
  if (!evolutionConfigurada()) return null;
  return criarEvolutionGo({
    baseUrl: process.env["EVOLUTION_BASE_URL"]!.trim(), apiKey: (process.env["EVOLUTION_API_KEY"] ?? "").trim(), instanceToken: (process.env["EVOLUTION_INSTANCE_TOKEN"] ?? "").trim(), instanceId: process.env["EVOLUTION_INSTANCE_ID"]!.trim(),
  });
}
