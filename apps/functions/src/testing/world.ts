import { FakeChannel, type InboundMessage, type TemplateParams } from "@medcuidar/channels";
import { SYSTEM_PROFILES } from "@medcuidar/shared";
import { handleWhatsappInbound, type InboundDeps, type InboundResponse } from "../inbound/handler";
import { signBody, SIGNATURE_HEADER } from "../inbound/signature";
import { createLogger } from "../log";
import { processOutbox, type OutboxDeps, type OutboxReport } from "../outbox";
import type { AlertEvent, AuthPort, Logger, LogFields, Monitor, TranscriptionPort } from "../ports";
import { SlidingWindowLimiter } from "../rate-limit";
import { runSchedulerTick, type SchedulerDeps, type TickReport } from "../scheduler";
import type { LoginDeps } from "../login";
import { FakeDomain } from "./fake-domain";
import { familyInfo, MemoryFamilyData, MemoryGlobalData, MemoryStore } from "./memory-data";

export const FAMILY_ID = "fam-souza";
export const PHONES = {
  ana: "+5511999990001",
  rosa: "+5511999990002",
  joao: "+5511999990003",
  stranger: "+5511900000000",
} as const;
export const GROUP_ID = "120363000000000000@g.us";
export const SECRET = "segredo-de-teste";

export class FakeMonitor implements Monitor {
  heartbeats: Array<{ name: string; info: Record<string, unknown> }> = [];
  alerts: AlertEvent[] = [];
  async heartbeat(name: string, info: Record<string, string | number | boolean>) {
    this.heartbeats.push({ name, info });
  }
  async alert(event: AlertEvent) {
    this.alerts.push(event);
  }
}

export class FakeTranscriber implements TranscriptionPort {
  /** Texto devolvido; `null` simula falha do Gemini. */
  next: string | null = "tomei o zypred";
  calls = 0;
  async transcribe() {
    this.calls += 1;
    if (this.next === null) throw new Error("Gemini: HTTP 503");
    return { text: this.next };
  }
}

export class FakeAuth implements AuthPort {
  async createSessionFor(phone: string) {
    return { token: `token-para-${phone.length}` };
  }
}

export interface LogLine {
  level: string;
  event: string;
  fields: LogFields;
}

export interface WorldOptions {
  now?: Date;
  /** Sobrescritas das configurações da família. */
  settings?: Record<string, unknown>;
  /** Cria tratamentos para o gerador de doses do fake (usado no simulador). */
  withTreatments?: boolean;
  zypredBalance?: number;
}

/** 15/10/2026 14:00 em São Paulo (UTC-3). */
export const DEFAULT_NOW = new Date("2026-10-15T17:00:00.000Z");

export function buildWorld(opts: WorldOptions = {}) {
  const store = new MemoryStore();
  const clock = { current: new Date(opts.now ?? DEFAULT_NOW) };
  store.nowIso = () => clock.current.toISOString();
  store.families = [familyInfo(FAMILY_ID, { whatsapp_group_id: null, ...opts.settings }, "Família Souza")];

  const seed = (col: string, id: string, data: Record<string, unknown>) => store.seed(col, FAMILY_ID, id, data);
  const profileIds: Record<string, string> = { Administrador: "prof-admin", Familiar: "prof-fam", Cuidadora: "prof-cuid", Confirmador: "prof-conf" };
  for (const p of SYSTEM_PROFILES) {
    seed("profiles", profileIds[p.name]!, { name: p.name, permissions: JSON.stringify(p.permissions), is_system: true });
  }
  const member = (id: string, name: string, phone: string, profile: string, alerts: boolean) =>
    seed("members", id, { name, phone_e164: phone, profile_id: profile, active: true, receives_family_alerts: alerts, whatsapp_status: "verified" });
  member("mem-ana", "Ana", PHONES.ana, "prof-admin", true);
  member("mem-rosa", "Rosa", PHONES.rosa, "prof-cuid", false);
  member("mem-joao", "Seu João", PHONES.joao, "prof-conf", false);

  seed("patients", "pat-adelino", { name: "Adelino Souza", can_use_phone: true, active: true });
  seed("patients", "pat-maria", { name: "Maria Souza", can_use_phone: false, active: true });
  seed("medications", "med-zypred", { name: "Zypred", alternative_names: ["Facoba", "Vigadexa"], route: "drops", control_unit: "drop", drops_per_ml: 20 });
  seed("medications", "med-losartana", { name: "Losartana", alternative_names: [], route: "tablet", control_unit: "unit" });
  seed("stock_items", "stk-zypred", { patient_id: "pat-adelino", medication_id: "med-zypred", control_unit: "drop", is_estimate: true, cached_balance: opts.zypredBalance ?? 60 });
  seed("stock_items", "stk-losartana", { patient_id: "pat-maria", medication_id: "med-losartana", control_unit: "unit", is_estimate: false, cached_balance: 90 });
  // Livro-razão: o saldo inicial entra como compra, o saldo é a soma dos movimentos.
  seed("stock_movements", "mov-zypred-0", { stock_item_id: "stk-zypred", type: "purchase", quantity: opts.zypredBalance ?? 60 });
  seed("stock_movements", "mov-losartana-0", { stock_item_id: "stk-losartana", type: "purchase", quantity: 90 });
  seed("prescriptions", "rx-zypred", { patient_id: "pat-adelino", doctor_name: "Dra. Helena Prado", specialty: "Oftalmologista", valid_until: "2026-10-25", status: "valid" });
  seed("prescription_items", "rxi-zypred", { prescription_id: "rx-zypred", medication_id: "med-zypred" });

  if (opts.withTreatments) {
    seed("treatments", "trt-zypred", { patient_id: "pat-adelino", medication_id: "med-zypred", status: "active" });
    seed("treatment_phases", "ph-zypred", { treatment_id: "trt-zypred", order: 1, schedule_type: "fixed_times", times: ["08:00", "11:00", "14:00", "17:00"], dose_amount: 1 });
    seed("treatments", "trt-losartana", { patient_id: "pat-maria", medication_id: "med-losartana", status: "active" });
    seed("treatment_phases", "ph-losartana", { treatment_id: "trt-losartana", order: 1, schedule_type: "fixed_times", times: ["14:00"], dose_amount: 1 });
  }

  const domain = new FakeDomain(store, {
    responsibleByPatient: { "pat-adelino": ["mem-rosa"], "pat-maria": ["mem-rosa"] },
    dosesPerDay: { "med-zypred": 4, "med-losartana": 1 },
  });
  const channel = new FakeChannel();
  const monitor = new FakeMonitor();
  const transcriber = new FakeTranscriber();
  const logs: LogLine[] = [];
  const log: Logger = createLogger((l) => logs.push(l));
  const global = new MemoryGlobalData(store);
  const dataFor = (familyId: string) => new MemoryFamilyData(store, familyId);
  const limiter = new SlidingWindowLimiter(1000, 60_000);

  const outboxDeps: OutboxDeps = { global, dataFor, channel, monitor, log, sealSecret: SECRET };
  const schedulerDeps: SchedulerDeps = { global, dataFor, domain, monitor, log };
  const flush = async (familyId: string) => {
    await processOutbox(outboxDeps, clock.current, familyId);
  };
  const inboundDeps: InboundDeps = {
    global, dataFor, channel, domain, transcriber, monitor, log, limiter, webhookSecret: SECRET, now: () => clock.current, flush,
  };
  const loginDeps: LoginDeps = {
    global, dataFor, auth: new FakeAuth(), limiter: new SlidingWindowLimiter(1000, 60_000), hashSecret: SECRET, sealSecret: SECRET, log, now: () => clock.current, flush,
  };

  let seq = 0;
  const world = {
    store, clock, domain, channel, monitor, transcriber, logs, log, global, dataFor, outboxDeps, schedulerDeps, inboundDeps, loginDeps,
    data: dataFor(FAMILY_ID),
    advance(minutes: number) {
      clock.current = new Date(clock.current.getTime() + minutes * 60_000);
    },
    tick(): Promise<TickReport> {
      return runSchedulerTick(schedulerDeps, clock.current);
    },
    flushOutbox(): Promise<OutboxReport> {
      return processOutbox(outboxDeps, clock.current);
    },
    /** Constrói uma mensagem recebida. */
    msg(from: string, rest: Partial<InboundMessage> & { type?: InboundMessage["type"] }, groupId?: string): InboundMessage {
      seq += 1;
      return { providerMessageId: `in-${seq}`, from, type: "text", receivedAt: clock.current, ...(groupId ? { groupId } : {}), ...rest } as InboundMessage;
    },
    /** Entrega mensagens ao webhook assinado, como o N8N faria. */
    async deliver(messages: InboundMessage[], signature?: string): Promise<InboundResponse> {
      const rawBody = JSON.stringify({ provider: "fake", payload: messages });
      return handleWhatsappInbound(inboundDeps, { rawBody, headers: { [SIGNATURE_HEADER]: signature ?? signBody(rawBody, SECRET) } });
    },
    say(from: string, text: string, groupId?: string): Promise<InboundResponse> {
      return world.deliver([world.msg(from, { type: "text", text }, groupId)]);
    },
    press(from: string, buttonId: string, groupId?: string): Promise<InboundResponse> {
      return world.deliver([world.msg(from, { type: "button", buttonId }, groupId)]);
    },
    outbox() {
      return store.all("notifications_outbox");
    },
    stockBalance(itemId = "stk-zypred") {
      return store
        .all("stock_movements")
        .filter((m) => m["stock_item_id"] === itemId)
        .reduce((sum, m) => sum + Number(m["quantity"]), 0);
    },
    movements() {
      return store.all("stock_movements").filter((m) => m["type"] === "dose");
    },
    /** Última mensagem enviada pelo canal. */
    lastSent() {
      return channel.sent[channel.sent.length - 1];
    },
  };
  return world;
}

export type World = ReturnType<typeof buildWorld>;

export function seedDose(world: World, id: string, patientId: string, medicationId: string, scheduledAt: Date, status = "pending", amount = 1) {
  return world.store.seed("dose_events", FAMILY_ID, id, {
    treatment_id: `trt-${id}`, patient_id: patientId, medication_id: medicationId, scheduled_at: scheduledAt.toISOString(), status, amount,
  });
}

export type { TemplateParams };
