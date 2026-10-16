import { ChannelError, renderTemplate, sendContent, type ChannelAdapter, type TemplateId, type TemplateParams } from "@medcuidar/channels";
import type { DataFactory, FamilyData, FamilyInfo, GlobalData, Logger, Monitor, Row } from "./ports";
import { addMinutes } from "./time";
import { isConflict, n, parsePayload, s, sOpt } from "./rows";
import { unseal } from "./seal";

export type OutboxKind =
  | "dose_reminder"
  | "dose_upcoming_family"
  | "dose_missed"
  | "low_stock"
  | "prescription_expiring"
  | "replenishment_update"
  | "daily_summary"
  | "login_code"
  | "reply";

export interface EnqueueInput<K extends TemplateId = TemplateId> {
  kind: OutboxKind;
  template: K;
  params: TemplateParams[K];
  targetMemberId?: string;
  targetGroupId?: string;
  /** Idempotência: o mesmo valor nunca enfileira duas vezes. É prefixado com a família. */
  dedupeKey: string;
  notBefore?: Date;
}

export interface EnqueueResult {
  created: boolean;
  id: string;
}

export async function enqueue<K extends TemplateId>(data: FamilyData, input: EnqueueInput<K>, now: Date): Promise<EnqueueResult> {
  const dedupe_key = `${data.familyId}:${input.dedupeKey}`.slice(0, 200);
  const existing = await data.find("notifications_outbox", { dedupe_key }, { limit: 1 });
  if (existing[0]) return { created: false, id: existing[0].$id };
  try {
    const row = await data.create("notifications_outbox", {
      kind: input.kind,
      ...(input.targetMemberId ? { target_member_id: input.targetMemberId } : {}),
      ...(input.targetGroupId ? { target_group_id: input.targetGroupId } : {}),
      payload: JSON.stringify({ template: input.template, params: input.params }),
      status: "queued",
      attempts: 0,
      next_attempt_at: (input.notBefore ?? now).toISOString(),
      dedupe_key,
    });
    return { created: true, id: row.$id };
  } catch (e) {
    if (!isConflict(e)) throw e;
    const again = await data.find("notifications_outbox", { dedupe_key }, { limit: 1 });
    return { created: false, id: again[0]?.$id ?? "" };
  }
}

export interface Recipient {
  memberId?: string;
  groupId?: string;
}

/** Quem recebe avisos da família: o grupo configurado, ou cada membro com `receives_family_alerts`. */
export async function familyAlertRecipients(data: FamilyData, family: Pick<FamilyInfo, "settings">): Promise<Recipient[]> {
  const group = family.settings.whatsapp_group_id;
  if (group) return [{ groupId: group }];
  const members = await data.find("members", { active: true, receives_family_alerts: true });
  return members.filter((m) => sOpt(m, "phone_e164")).map((m) => ({ memberId: m.$id }));
}

export const recipientKey = (r: Recipient) => (r.groupId ? "group" : (r.memberId ?? "none"));

export async function enqueueToRecipients<K extends TemplateId>(
  data: FamilyData,
  recipients: Recipient[],
  base: Omit<EnqueueInput<K>, "targetMemberId" | "targetGroupId">,
  now: Date,
): Promise<number> {
  let created = 0;
  for (const r of recipients) {
    const res = await enqueue(
      data,
      {
        ...base,
        dedupeKey: `${base.dedupeKey}:${recipientKey(r)}`,
        ...(r.groupId ? { targetGroupId: r.groupId } : { targetMemberId: r.memberId }),
      },
      now,
    );
    if (res.created) created += 1;
  }
  return created;
}

// ───────────────────────── worker ─────────────────────────

export interface OutboxConfig {
  maxAttempts: number;
  baseBackoffSec: number;
  maxBackoffSec: number;
  batchSize: number;
  /** Tempo que uma mensagem fica "sending" antes de ser considerada abandonada e reprocessada. */
  leaseSec: number;
  /** Falhas retentáveis seguidas que indicam provedor fora do ar: interrompe o lote e avisa o administrador. */
  providerDownAfter: number;
}

export const DEFAULT_OUTBOX_CONFIG: OutboxConfig = {
  maxAttempts: 8,
  baseBackoffSec: 30,
  maxBackoffSec: 1800,
  batchSize: 50,
  leaseSec: 120,
  providerDownAfter: 3,
};

export interface OutboxDeps {
  global: Pick<GlobalData, "listFamilies">;
  dataFor: DataFactory;
  channel: ChannelAdapter;
  monitor: Monitor;
  log: Logger;
  /** Segredo para abrir códigos de login selados. */
  sealSecret?: string;
  config?: Partial<OutboxConfig>;
}

export interface OutboxReport {
  sent: number;
  retry: number;
  dead: number;
  obsolete: number;
  providerDown: boolean;
}

export function backoffSeconds(attempts: number, cfg: Pick<OutboxConfig, "baseBackoffSec" | "maxBackoffSec">): number {
  return Math.min(cfg.maxBackoffSec, cfg.baseBackoffSec * 2 ** Math.max(0, attempts - 1));
}

export async function processOutbox(deps: OutboxDeps, now: Date, onlyFamilyId?: string): Promise<OutboxReport> {
  const cfg = { ...DEFAULT_OUTBOX_CONFIG, ...deps.config };
  const report: OutboxReport = { sent: 0, retry: 0, dead: 0, obsolete: 0, providerDown: false };
  let consecutiveRetryable = 0;
  const families = (await deps.global.listFamilies()).filter((f) => !onlyFamilyId || f.id === onlyFamilyId);

  for (const family of families) {
    const data = deps.dataFor(family.id);
    const due = await data.find(
      "notifications_outbox",
      { status: { in: ["queued", "failed", "sending"] }, next_attempt_at: { lte: now.toISOString() } },
      { limit: cfg.batchSize, orderBy: "next_attempt_at", order: "asc" },
    );
    for (const row of due) {
      const outcome = await deliver(deps, cfg, data, row, now);
      if (outcome === "sent") {
        report.sent += 1;
        consecutiveRetryable = 0;
      } else if (outcome === "obsolete") {
        report.obsolete += 1;
      } else if (outcome === "dead") {
        report.dead += 1;
      } else {
        report.retry += 1;
        consecutiveRetryable += 1;
        if (consecutiveRetryable >= cfg.providerDownAfter) {
          report.providerDown = true;
          await deps.monitor.alert({ kind: "provider_down", details: { channel: deps.channel.name, consecutiveFailures: consecutiveRetryable } });
          deps.log.error("outbox.provider_down", { channel: deps.channel.name });
          return report; // as demais continuam na fila, intactas
        }
      }
    }
  }
  return report;
}

type Outcome = "sent" | "retry" | "dead" | "obsolete";

async function deliver(deps: OutboxDeps, cfg: OutboxConfig, data: FamilyData, row: Row, now: Date): Promise<Outcome> {
  const familyId = data.familyId;
  const kind = s(row, "kind");
  const attemptsBefore = n(row, "attempts");

  const die = async (reason: string, alert: boolean): Promise<Outcome> => {
    await data.update("notifications_outbox", row.$id, { status: "dead", attempts: attemptsBefore + 1, last_error: reason.slice(0, 500), next_attempt_at: null });
    if (alert) {
      await deps.monitor.alert({ kind: "outbox_dead", details: { familyId, outboxId: row.$id, messageKind: kind, attempts: attemptsBefore + 1 } });
    }
    deps.log.warn("outbox.dead", { familyId, outboxId: row.$id, kind, reason });
    return "dead";
  };

  // Reivindica a linha: se o processo cair daqui, ela volta ao fim do lease.
  await data.update("notifications_outbox", row.$id, { status: "sending", next_attempt_at: addMinutes(now, cfg.leaseSec / 60).toISOString() });

  const payload = parsePayload(row["payload"]);
  const template = payload["template"] as TemplateId | undefined;
  let params = payload["params"] as Record<string, unknown> | undefined;
  if (!template || !params) return die("payload inválido", true);

  if (template === "login_code") {
    const sealed = typeof params["sealed"] === "string" ? params["sealed"] : "";
    const code = deps.sealSecret ? unseal(sealed, deps.sealSecret) : null;
    if (!code) return die("código selado ilegível", true);
    params = { code, minutes: params["minutes"] ?? 10 };
  }

  // Dose já resolvida (tomada/pulada) enquanto a fila esperava: não incomodar mais ninguém.
  const doseId = kind === "dose_reminder" && typeof params["doseEventId"] === "string" ? params["doseEventId"] : null;
  if (doseId) {
    const dose = await data.getOrNull("dose_events", doseId);
    if (!dose || !["pending", "late"].includes(s(dose, "status"))) {
      await data.update("notifications_outbox", row.$id, { status: "dead", last_error: "obsolete: dose já resolvida", next_attempt_at: null });
      return "obsolete";
    }
  }

  let content;
  try {
    content = renderTemplate(template, params as never);
  } catch {
    return die("falha ao montar a mensagem", true);
  }

  try {
    let phone: string | undefined;
    const groupId = sOpt(row, "target_group_id");
    if (!groupId) {
      const memberId = sOpt(row, "target_member_id");
      const member = memberId ? await data.getOrNull("members", memberId) : null;
      phone = member && member["active"] !== false ? sOpt(member, "phone_e164") : undefined;
      if (!phone) return die("destinatário indisponível", false);
    }
    const result = groupId
      ? await deps.channel.sendToGroup(groupId, content)
      : await sendContent(deps.channel, phone!, content);

    await data.update("notifications_outbox", row.$id, {
      status: "sent",
      attempts: attemptsBefore + 1,
      last_error: null,
      next_attempt_at: null,
      ...(template === "login_code" ? { payload: JSON.stringify({ template, params: {} }) } : {}),
    });
    try {
      await data.create("whatsapp_messages", {
        direction: "out",
        provider_message_id: result.providerMessageId,
        type: content.media ? "image" : "text",
        body_redacted: `[${template}]`,
        ...(doseId ? { related_dose_event_id: doseId } : {}),
        received_at: now.toISOString(),
      });
    } catch (e) {
      if (!isConflict(e)) throw e;
    }
    return "sent";
  } catch (e) {
    if (e instanceof ChannelError && !e.retryable) return die(`recusado pelo canal (${e.status ?? "?"})`, true);
    const attempts = attemptsBefore + 1;
    if (attempts >= cfg.maxAttempts) return die("tentativas esgotadas", true);
    const reason = e instanceof ChannelError ? e.message : "erro inesperado no envio";
    await data.update("notifications_outbox", row.$id, {
      status: "failed",
      attempts,
      last_error: reason.slice(0, 500),
      next_attempt_at: new Date(now.getTime() + backoffSeconds(attempts, cfg) * 1000).toISOString(),
    });
    deps.log.warn("outbox.retry", { familyId, outboxId: row.$id, kind, attempts });
    return "retry";
  }
}

