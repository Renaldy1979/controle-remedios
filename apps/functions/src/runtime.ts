import { createChannelFromEnv, type ChannelAdapter } from "@medcuidar/channels";
import { FamilyScopedDb } from "@medcuidar/db";
import { Client, Databases, ID } from "node-appwrite";
import { AppwriteFamilyData, AppwriteGlobalData } from "./data/appwrite";
import { unwiredAuth, unwiredDomain } from "./domain-binding";
import type { InboundDeps } from "./inbound/handler";
import { consoleSink, createLogger } from "./log";
import type { LoginDeps } from "./login";
import { HttpMonitor } from "./monitor-http";
import { processOutbox, type OutboxDeps } from "./outbox";
import type { AuthPort, DomainPort, FamilyData, TranscriptionPort } from "./ports";
import { SlidingWindowLimiter } from "./rate-limit";
import type { SchedulerDeps } from "./scheduler";
import { GeminiTranscriber } from "./transcription/gemini";
import { N8nTranscriber } from "./transcription/n8n";

export type Env = Record<string, string | undefined>;

const need = (env: Env, key: string): string => {
  const v = env[key];
  if (!v) throw new Error(`Variável de ambiente ausente: ${key}`);
  return v;
};

export interface Runtime {
  outbox: OutboxDeps;
  scheduler: SchedulerDeps;
  inbound: InboundDeps;
  login: LoginDeps;
}

export interface RuntimeOverrides {
  domain?: DomainPort;
  auth?: AuthPort;
  transcriber?: TranscriptionPort;
  channel?: ChannelAdapter;
}


/** Monta as dependências reais a partir do ambiente. O domínio e a sessão do painel ficam para a Fase 3. */
export function createRuntime(env: Env = process.env, overrides: RuntimeOverrides = {}): Runtime {
  const client = new Client().setEndpoint(need(env, "APPWRITE_ENDPOINT")).setProject(need(env, "APPWRITE_PROJECT_ID")).setKey(need(env, "APPWRITE_API_KEY"));
  const databases = new Databases(client);
  const databaseId = need(env, "APPWRITE_DATABASE_ID");

  const scoped = new Map<string, FamilyData>();
  const dataFor = (familyId: string): FamilyData => {
    let d = scoped.get(familyId);
    if (!d) {
      d = new AppwriteFamilyData(new FamilyScopedDb(databases, databaseId, familyId));
      scoped.set(familyId, d);
    }
    return d;
  };
  const global = new AppwriteGlobalData(databases, databaseId, () => ID.unique());
  const log = createLogger(consoleSink);
  const channel = overrides.channel ?? createChannelFromEnv(env);
  const monitor = new HttpMonitor({
    log,
    ...(env["HEARTBEAT_URL"] ? { heartbeatUrl: env["HEARTBEAT_URL"] } : {}),
    ...(env["ALERTS_WEBHOOK_URL"] ? { alertsWebhookUrl: env["ALERTS_WEBHOOK_URL"] } : {}),
    ...(env["ALERTS_WEBHOOK_SECRET"] ? { alertsSecret: env["ALERTS_WEBHOOK_SECRET"] } : {}),
  });
  const domain = overrides.domain ?? unwiredDomain;
  const sealSecret = need(env, "LOGIN_CODE_SECRET");

  const outbox: OutboxDeps = { global, dataFor, channel, monitor, log, sealSecret };
  const flush = async (familyId: string) => {
    await processOutbox(outbox, new Date(), familyId);
  };
  return {
    outbox,
    scheduler: { global, dataFor, domain, monitor, log },
    inbound: {
      global, dataFor, channel, domain, monitor, log, flush,
      transcriber:
        overrides.transcriber ??
        (env["TRANSCRIPTION_PROVIDER"] === "n8n"
          ? new N8nTranscriber({ url: need(env, "TRANSCRIPTION_N8N_URL"), secret: need(env, "ALERTS_WEBHOOK_SECRET") })
          : new GeminiTranscriber({ apiKey: need(env, "GEMINI_API_KEY"), ...(env["GEMINI_MODEL"] ? { model: env["GEMINI_MODEL"] } : {}) })),
      limiter: new SlidingWindowLimiter(30, 60_000),
      webhookSecret: need(env, "WHATSAPP_WEBHOOK_SECRET"),
      now: () => new Date(),
    },
    login: {
      global, dataFor, log, flush,
      auth: overrides.auth ?? unwiredAuth,
      limiter: new SlidingWindowLimiter(10, 3_600_000),
      hashSecret: sealSecret,
      sealSecret,
      now: () => new Date(),
    },
  };
}
