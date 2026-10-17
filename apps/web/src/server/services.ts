import "server-only";
import { createChannelFromEnv, FakeChannel, type ChannelAdapter } from "@medcuidar/channels";
import { createServices, type Services } from "@medcuidar/functions";
import { e2eTestMode } from "./env";

const g = globalThis as unknown as { __mcChannel?: ChannelAdapter; __mcServices?: Services };

/** Canal de WhatsApp. No modo de teste é o canal falso em memória (nada sai para a rede). */
export function getChannel(): ChannelAdapter {
  if (!g.__mcChannel) g.__mcChannel = e2eTestMode() ? new FakeChannel() : createChannelFromEnv(process.env);
  return g.__mcChannel;
}

/**
 * Serviços de domínio (@medcuidar/functions): as mesmas regras do WhatsApp, usadas pelas Server Actions.
 * O login usa o `AuthPort` real de D (cria/associa o usuário do Appwrite ao membro pelo telefone, grava
 * `members.user_id` e emite o token customizado).
 */
export function services(): Services {
  if (!g.__mcServices) g.__mcServices = createServices(process.env, { channel: getChannel() });
  return g.__mcServices;
}
