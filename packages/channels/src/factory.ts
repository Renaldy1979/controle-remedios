import { EvolutionGoAdapter } from "./evolution-go";
import { MetaCloudAdapter } from "./meta-cloud";
import type { ChannelAdapter } from "./types";

export type Env = Record<string, string | undefined>;

const need = (env: Env, key: string): string => {
  const v = env[key];
  if (!v) throw new Error(`Variável de ambiente ausente: ${key}`);
  return v;
};

const truthy = (v: string | undefined) => ["1", "true", "sim", "yes"].includes((v ?? "").toLowerCase());

/**
 * Escolhe o canal por configuração. Trocar Evolution Go por Meta muda só estas variáveis:
 * CHANNEL_PROVIDER = evolution-go (padrão) | meta-cloud, SUPPORTS_BUTTONS (padrão false no Evolution Go).
 */
export function createChannelFromEnv(env: Env): ChannelAdapter {
  const provider = env["CHANNEL_PROVIDER"] ?? "evolution-go";
  if (provider === "meta-cloud") {
    return new MetaCloudAdapter({ accessToken: need(env, "META_ACCESS_TOKEN"), phoneNumberId: need(env, "META_PHONE_NUMBER_ID") });
  }
  if (provider !== "evolution-go") throw new Error(`CHANNEL_PROVIDER desconhecido: ${provider}`);
  return new EvolutionGoAdapter({
    baseUrl: need(env, "EVOLUTION_BASE_URL"),
    apiKey: need(env, "EVOLUTION_API_KEY"),
    instanceId: need(env, "EVOLUTION_INSTANCE_ID"),
    supportsButtons: truthy(env["SUPPORTS_BUTTONS"]),
  });
}
