import { createChannelFromEnv, type ChannelAdapter } from "@medcuidar/channels";
import { FamilyScopedDb } from "@medcuidar/db";
import { Client, Databases, ID, Tokens, Users } from "node-appwrite";
import { AppwriteFamilyData, AppwriteGlobalData } from "./data/appwrite";
import { AppwriteAuth, AppwriteFileSigner } from "./domain/appwrite-adapters";
import { createDomainPort, type FileSigner } from "./domain/binding";
import type { InboundDeps } from "./inbound/handler";
import { consoleSink, createLogger } from "./log";
import type { LoginDeps } from "./login";
import { HttpMonitor } from "./monitor-http";
import { processOutbox, type OutboxDeps } from "./outbox";
import type { AuthPort, DomainPort, FamilyData, GlobalData, TranscriptionPort } from "./ports";
import { SlidingWindowLimiter } from "./rate-limit";
import type { SchedulerDeps } from "./scheduler";
import { buildServices } from "./services";
import { GeminiTranscriber } from "./transcription/gemini";
import { N8nTranscriber } from "./transcription/n8n";

export type Env = Record<string, string | undefined>;

const need = (env: Env, key: string): string => {
  const v = env[key];
  if (!v) throw new Error(`Variável de ambiente ausente: ${key}`);
  return v;
};

export interface Runtime {
  global: GlobalData;
  dataFor: (familyId: string) => FamilyData;
  domain: ReturnType<typeof createDomainPort>;
  channel: ChannelAdapter;
  outbox: OutboxDeps;
  scheduler: SchedulerDeps;
  login: LoginDeps;
  /** Só exige GEMINI_API_KEY/WHATSAPP_WEBHOOK_SECRET quando realmente usado (o painel não precisa). */
  readonly inbound: InboundDeps;
}

export interface RuntimeOverrides {
  domain?: DomainPort & { repoFor: ReturnType<typeof createDomainPort>["repoFor"] };
  auth?: AuthPort;
  signer?: FileSigner;
  transcriber?: TranscriptionPort;
  channel?: ChannelAdapter;
  now?: () => Date;
  /** Decora o acesso a dados de cada família (ex.: gravar o que foi criado, no e2e). */
  wrapData?: (data: FamilyData) => FamilyData;
}

/** Monta as dependências reais a partir do ambiente (Appwrite, canal, domínio, sessão do painel). */
export function createRuntime(env: Env = process.env, overrides: RuntimeOverrides = {}): Runtime {
  const client = new Client().setEndpoint(need(env, "APPWRITE_ENDPOINT")).setProject(need(env, "APPWRITE_PROJECT_ID")).setKey(need(env, "APPWRITE_API_KEY"));
  const databases = new Databases(client);
  const databaseId = need(env, "APPWRITE_DATABASE_ID");
  const now = overrides.now ?? (() => new Date());

  const scoped = new Map<string, FamilyData>();
  const dataFor = (familyId: string): FamilyData => {
    let d = scoped.get(familyId);
    if (!d) {
      d = new AppwriteFamilyData(new FamilyScopedDb(databases, databaseId, familyId));
      if (overrides.wrapData) d = overrides.wrapData(d);
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
  const signer =
    overrides.signer ??
    new AppwriteFileSigner(new Tokens(client), {
      endpoint: need(env, "APPWRITE_ENDPOINT"),
      projectId: need(env, "APPWRITE_PROJECT_ID"),
      bucketId: env["APPWRITE_PRESCRIPTIONS_BUCKET_ID"] ?? "prescriptions",
    });
  const domain = overrides.domain ?? createDomainPort({ global, dataFor, now, signer });
  const auth = overrides.auth ?? new AppwriteAuth(new Users(client), { global, dataFor });
  const sealSecret = need(env, "LOGIN_CODE_SECRET");

  const outbox: OutboxDeps = { global, dataFor, channel, monitor, log, sealSecret };
  const flush = async (familyId: string) => {
    await processOutbox(outbox, now(), familyId);
  };
  const runtime: Runtime = {
    global, dataFor, domain: domain as Runtime["domain"], channel, outbox,
    scheduler: { global, dataFor, domain, monitor, log },
    login: { global, dataFor, log, flush, auth, limiter: new SlidingWindowLimiter(10, 3_600_000), hashSecret: sealSecret, sealSecret, now },
    get inbound(): InboundDeps {
      return {
        global, dataFor, channel, domain, monitor, log, flush, now,
        transcriber:
          overrides.transcriber ??
          (env["TRANSCRIPTION_PROVIDER"] === "n8n"
            ? new N8nTranscriber({ url: need(env, "TRANSCRIPTION_N8N_URL"), secret: need(env, "ALERTS_WEBHOOK_SECRET") })
            : new GeminiTranscriber({ apiKey: need(env, "GEMINI_API_KEY"), ...(env["GEMINI_MODEL"] ? { model: env["GEMINI_MODEL"] } : {}) })),
        limiter: inboundLimiter,
        webhookSecret: need(env, "WHATSAPP_WEBHOOK_SECRET"),
      };
    },
  };
  const inboundLimiter = new SlidingWindowLimiter(30, 60_000);
  return runtime;
}

/**
 * Fábrica para o painel (server-side, sem HTTP): domínio + banco + canal + login por código.
 * `const svc = createServices(process.env); await svc.doses.confirm({...})`.
 */
export function createServices(env: Env = process.env, overrides: RuntimeOverrides = {}) {
  const rt = createRuntime(env, overrides);
  const signer = overrides.signer;
  return buildServices({
    global: rt.global as GlobalData,
    dataFor: rt.dataFor,
    domain: rt.domain,
    channel: rt.channel,
    login: rt.login,
    ...(signer ? { signer } : {}),
    ...(overrides.now ? { now: overrides.now } : {}),
  });
}
