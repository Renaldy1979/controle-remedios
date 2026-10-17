import "server-only";
import { createChannelFromEnv, FakeChannel, normalizePhone, type ChannelAdapter } from "@medcuidar/channels";
import { AppwriteFamilyData, AppwriteGlobalData, createServices, findMembersByPhone, type AuthPort, type Services } from "@medcuidar/functions";
import { ID } from "node-appwrite";
import { clients, familyDb } from "./clients";
import { e2eTestMode, sessionSecret } from "./env";
import { SESSION_TTL_SEC, signSession } from "./session-token";

const g = globalThis as unknown as { __mcChannel?: ChannelAdapter; __mcServices?: Services };

/** Canal de WhatsApp. No modo de teste é o canal falso em memória (nada sai para a rede). */
export function getChannel(): ChannelAdapter {
  if (!g.__mcChannel) g.__mcChannel = e2eTestMode() ? new FakeChannel() : createChannelFromEnv(process.env);
  return g.__mcChannel;
}

function buildAuth(): AuthPort {
  const c = clients();
  const global = new AppwriteGlobalData(c.databases, c.databaseId, () => ID.unique());
  const dataFor = (familyId: string) => new AppwriteFamilyData(familyDb(familyId));
  return {
    /**
     * Sessão do painel: token assinado próprio. Os membros entram só por WhatsApp e não têm usuário no
     * Appwrite Auth, então o cookie leva família + membro (ver session-token.ts). Número em mais de uma
     * família: entra na primeira (falta o passo "qual família?", registrado no handoff).
     */
    async createSessionFor(phoneE164) {
      const [found] = await findMembersByPhone({ global, dataFor }, normalizePhone(phoneE164) ?? phoneE164);
      if (!found) return null;
      const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
      return { token: await signSession({ f: found.familyId, m: found.member.$id, exp }, sessionSecret()), userId: found.member.$id, expire: new Date(exp * 1000).toISOString() };
    },
  };
}

/** Serviços de domínio (@medcuidar/functions): as mesmas regras do WhatsApp, usadas pelas Server Actions. */
export function services(): Services {
  if (!g.__mcServices) g.__mcServices = createServices(process.env, { auth: buildAuth(), channel: getChannel() });
  return g.__mcServices;
}
