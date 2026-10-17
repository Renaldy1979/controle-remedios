import { EvolutionGoAdapter } from "./evolution-go";
import { DEFAULT_FAKE_LOG, FakeChannel } from "./fake";
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
  if (provider === "fake") {
    // Só para desenvolvimento e e2e: nada sai para a rede; os envios ficam em um arquivo.
    if (env["NODE_ENV"] === "production") throw new Error("CHANNEL_PROVIDER=fake não é permitido em produção");
    const channel = new FakeChannel(env["FAKE_CHANNEL_FILE"] ?? DEFAULT_FAKE_LOG);
    channel.supportsButtons = truthy(env["SUPPORTS_BUTTONS"]);
    return channel;
  }
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
