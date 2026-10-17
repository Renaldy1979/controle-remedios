import { decodeButtonId, numberedOptions, phoneVariants, renderTemplate, type ChannelAdapter, type InboundMessage, type TemplateId, type TemplateParams } from "@medcuidar/channels";
import type { DataFactory, DomainPort, FamilyData, FamilyInfo, GlobalData, Logger, Monitor, RateLimiter, Row, TranscriptionPort } from "../ports";
import { enqueue, enqueueToRecipients, familyAlertRecipients } from "../outbox";
import { doseText, isConflict, loadMemberCtx, memberCan, n, s, sOpt, type MemberCtx } from "../rows";
import { addMinutes, dateBR, localDate, localTime } from "../time";
import { findMentions, interpretText, parseOption, redactBody } from "./interpret";
import { SECRET_HEADER, SIGNATURE_HEADER, verifySharedSecret, verifySignature } from "./signature";

export interface InboundDeps {
  global: Pick<GlobalData, "listFamilies">;
  dataFor: DataFactory;
  channel: ChannelAdapter;
  domain: DomainPort;
  transcriber: TranscriptionPort;
  monitor: Monitor;
  log: Logger;
  limiter: RateLimiter;
  webhookSecret: string;
  now: () => Date;
  /** Envia a outbox da família na hora (resposta rápida). Opcional: sem ele, o cron entrega no próximo minuto. */
  flush?: (familyId: string) => Promise<void>;
}

export interface InboundRequest {
  rawBody: string;
  headers: Record<string, string | undefined>;
}
export interface InboundResponse {
  status: number;
  body: Record<string, unknown>;
}

interface Candidate {
  family: FamilyInfo;
  data: FamilyData;
  member: Row;
}

interface Ctx {
  deps: InboundDeps;
  family: FamilyInfo;
  data: FamilyData;
  member: MemberCtx;
  msg: InboundMessage;
  now: Date;
  seq: number;
  relatedDoseId?: string;
}

const CONFIRM_WINDOW_BEFORE_MIN = 6 * 60;
const CONFIRM_WINDOW_AFTER_MIN = 60;

/** Entrada do webhook `whatsapp-inbound`. Resposta sempre neutra: nada revela quem é cadastrado. */
export async function handleWhatsappInbound(deps: InboundDeps, req: InboundRequest): Promise<InboundResponse> {
  const header = req.headers[SIGNATURE_HEADER] ?? req.headers[SIGNATURE_HEADER.toUpperCase()];
  if (!verifySignature(req.rawBody, header, deps.webhookSecret) && !verifySharedSecret(req.headers[SECRET_HEADER], deps.webhookSecret)) {
    deps.log.warn("inbound.bad_signature");
    return { status: 401, body: { ok: false } };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(req.rawBody);
  } catch {
    return { status: 400, body: { ok: false } };
  }
  // N8N envia { provider, payload }; aceita também o corpo cru do provedor.
  const payload = typeof raw === "object" && raw !== null && "payload" in raw ? (raw as { payload: unknown }).payload : raw;
  const messages = deps.channel.parseInbound(payload);

  let failed = 0;
  const touched = new Set<string>();
  for (const msg of messages) {
    try {
      const familyId = await processMessage(deps, msg);
      if (familyId) touched.add(familyId);
    } catch (e) {
      failed += 1;
      deps.log.error("inbound.processing_failed", { error: e instanceof Error ? e.name : "unknown" });
      await deps.monitor.alert({ kind: "inbound_error", details: { channel: deps.channel.name } }).catch(() => undefined);
    }
  }
  for (const familyId of touched) {
    try {
      await deps.flush?.(familyId);
    } catch {
      /* a outbox continua enfileirada e o cron entrega */
    }
  }
  // 500 faz o N8N repetir; seguro porque todo passo é idempotente.
  return failed > 0 ? { status: 500, body: { ok: false } } : { status: 200, body: { ok: true } };
}

async function identify(deps: InboundDeps, msg: InboundMessage): Promise<Candidate[]> {
  const families = await deps.global.listFamilies();
  const pool = msg.groupId ? families.filter((f) => f.settings.whatsapp_group_id === msg.groupId) : families;
  const variants = phoneVariants(msg.from);
  const out: Candidate[] = [];
  for (const family of pool) {
    const data = deps.dataFor(family.id);
    const [member] = await data.find("members", { phone_e164: { in: variants }, active: true }, { limit: 1 });
    if (member) out.push({ family, data, member });
  }
  return out;
}

/** Devolve o id da família atendida (para descarregar a outbox) ou null se foi ignorada. */
async function processMessage(deps: InboundDeps, msg: InboundMessage): Promise<string | null> {
  const now = deps.now();
  let candidates = await identify(deps, msg);

  // Telefone desconhecido (ou fora do grupo da família): ignora em silêncio.
  if (candidates.length === 0) {
    deps.log.info("inbound.ignored", { reason: "unknown_sender" });
    return null;
  }
  if (!deps.limiter.allow(`in:${msg.from}`, now)) {
    deps.log.warn("inbound.rate_limited");
    return null;
  }

  const decoded = msg.type === "button" && msg.buttonId ? decodeButtonId(msg.buttonId) : null;
  if (decoded) candidates = candidates.filter((c) => c.family.id === decoded.familyId);
  if (candidates.length !== 1) {
    // Botão de outra família, ou texto de quem pertence a mais de uma: não adivinhar.
    deps.log.info("inbound.ignored", { reason: candidates.length === 0 ? "button_family_mismatch" : "multiple_families" });
    return null;
  }
  const { family, data, member: memberRow } = candidates[0]!;

  // Idempotência: mensagem já tratada (webhook repetido) não faz nada.
  const [seen] = await data.find("whatsapp_messages", { provider_message_id: msg.providerMessageId }, { limit: 1 });
  if (seen) {
    deps.log.info("inbound.duplicate", { familyId: family.id });
    return family.id;
  }

  const member = await loadMemberCtx(data, memberRow);
  const ctx: Ctx = { deps, family, data, member, msg, now, seq: 0 };
  let transcript: string | undefined;

  if (decoded) {
    await handleButton(ctx, decoded.action, decoded.ref);
  } else if (msg.type === "audio") {
    transcript = await handleAudio(ctx);
  } else if (msg.type === "text" && msg.text) {
    await handleText(ctx, msg.text);
  } else if (msg.type === "image") {
    await reply(ctx, "operational_notice", { text: "Ainda não consigo receber fotos de receita por aqui. Envie pelo painel do MedCuidar." });
  } else {
    await reply(ctx, "help", {});
  }

  try {
    await data.create("whatsapp_messages", {
      direction: "in",
      provider_message_id: msg.providerMessageId,
      from_phone: msg.from,
      member_id: member.id,
      type: msg.type,
      ...(msg.text ? { body_redacted: redactBody(msg.text) } : msg.buttonId ? { body_redacted: `[botão ${decoded?.action ?? "?"}]` } : {}),
      ...(transcript ? { transcript: transcript.slice(0, 2000) } : {}),
      ...(ctx.relatedDoseId ? { related_dose_event_id: ctx.relatedDoseId } : {}),
      received_at: msg.receivedAt.toISOString(),
    });
  } catch (e) {
    if (!isConflict(e)) throw e; // entrega simultânea da mesma mensagem: o outro lado gravou
  }
  return family.id;
}

// ───────────────────────── respostas ─────────────────────────

async function reply<K extends TemplateId>(ctx: Ctx, template: K, params: TemplateParams[K], opts: { private?: boolean } = {}) {
  ctx.seq += 1;
  const toGroup = ctx.msg.groupId && !opts.private;
  await enqueue(
    ctx.data,
    {
      kind: "reply",
      template,
      params,
      ...(toGroup ? { targetGroupId: ctx.msg.groupId! } : { targetMemberId: ctx.member.id }),
      dedupeKey: `reply:${ctx.msg.providerMessageId}:${ctx.seq}`,
    },
    ctx.now,
  );
}

// ───────────────────────── áudio ─────────────────────────

async function handleAudio(ctx: Ctx): Promise<string | undefined> {
  let text: string;
  try {
    const media = await ctx.deps.channel.fetchMedia(ctx.msg);
    text = (await ctx.deps.transcriber.transcribe({ audio: media.data, mimeType: media.mimeType, language: "pt-BR" })).text;
  } catch {
    ctx.deps.log.warn("inbound.transcription_failed", { familyId: ctx.family.id });
    await reply(ctx, "transcription_failed", {});
    return undefined;
  }
  await handleText(ctx, text);
  return text;
}

// ───────────────────────── botões ─────────────────────────

async function handleButton(ctx: Ctx, action: string, ref: string) {
  switch (action) {
    case "dose_taken":
      return confirmDose(ctx, ref);
    case "dose_snooze":
      return snooze(ctx, ref);
    case "replenish_claim":
      return claim(ctx, ref);
    case "rx_view":
      return showPrescription(ctx, { replenishmentId: ref });
    case "rx_download":
      return showPrescription(ctx, { prescriptionId: ref });
    case "rx_forward_pharmacy": {
      if (!canShareRx(ctx)) return reply(ctx, "no_permission", {}, { private: true });
      const rx = await ctx.deps.domain.getPrescriptionForSharing({ familyId: ctx.family.id, memberId: ctx.member.id, prescriptionId: ref });
      if (!rx) return reply(ctx, "prescription_unavailable", {}, { private: true });
      await audit(ctx, "prescription.forward_pharmacy_info", rx.prescriptionId);
      return reply(ctx, "prescription_forward_info", { patientName: rx.patientName }, { private: true });
    }
  }
}

async function loadDoseView(data: FamilyData, doseId: string) {
  const dose = await data.getOrNull("dose_events", doseId);
  if (!dose) return null;
  const [patient, medication] = await Promise.all([data.getOrNull("patients", s(dose, "patient_id")), data.getOrNull("medications", s(dose, "medication_id"))]);
  if (!patient || !medication) return null;
  return { dose, patient, medication };
}

async function confirmDose(ctx: Ctx, doseId: string) {
  const { deps, family, data, member, msg, now } = ctx;
  ctx.relatedDoseId = doseId;
  if (!memberCan(member, "doses.confirm")) return reply(ctx, "no_permission", {});

  const result = await deps.domain.confirmDose({
    familyId: family.id, doseEventId: doseId, memberId: member.id, channel: "whatsapp", sourceMessageId: msg.providerMessageId,
  });
  const view = await loadDoseView(data, doseId);
  const patientName = view ? s(view.patient, "name") : "";
  const medicationName = view ? s(view.medication, "name") : "";

  switch (result.outcome) {
    case "confirmed": {
      const time = view ? localTime(new Date(s(view.dose, "scheduled_at")), family.timezone) : localTime(now, family.timezone);
      await reply(ctx, "dose_confirmed", { patientName, medicationName, time });
      // Desconto feito: o domínio reavalia o estoque desse remédio e avisamos a família se cruzou o limite.
      const patientId = result.patientId ?? (view ? s(view.dose, "patient_id") : undefined);
      const medicationId = result.medicationId ?? (view ? s(view.dose, "medication_id") : undefined);
      const alerts = await deps.domain.checkLowStock({ familyId: family.id, ...(patientId ? { patientId } : {}), ...(medicationId ? { medicationId } : {}) });
      const recipients = await familyAlertRecipients(data, family);
      for (const a of alerts) {
        await enqueueToRecipients(
          data,
          recipients,
          {
            kind: "low_stock",
            template: "low_stock",
            params: { familyId: family.id, replenishmentId: a.replenishmentId, patientName: a.patientName, medicationName: a.medicationName, daysLeft: a.daysLeft, level: a.level, isEstimate: a.isEstimate },
            dedupeKey: `low_stock:${a.replenishmentId}:${a.level}`,
          },
          now,
        );
      }
      return;
    }
    case "already_confirmed":
    case "already_taken":
      return reply(ctx, "dose_already_recorded", { patientName, medicationName });
    case "forbidden":
      return reply(ctx, "no_permission", {});
    default:
      return reply(ctx, "no_pending_dose", {});
  }
}

async function snooze(ctx: Ctx, doseId: string) {
  const { family, data, member, msg, now } = ctx;
  ctx.relatedDoseId = doseId;
  const view = await loadDoseView(data, doseId);
  if (!view || !["pending", "late"].includes(s(view.dose, "status"))) return reply(ctx, "no_pending_dose", {});
  const minutes = family.settings.repeat_reminder_options_min[0] ?? 15;
  const at = addMinutes(now, minutes);
  await enqueue(
    data,
    {
      kind: "dose_reminder",
      template: "dose_reminder",
      params: {
        familyId: family.id,
        doseEventId: doseId,
        patientName: s(view.patient, "name"),
        medicationName: s(view.medication, "name"),
        doseText: doseText(n(view.dose, "amount"), view.medication),
        time: localTime(new Date(s(view.dose, "scheduled_at")), family.timezone),
        late: true,
        snoozeMin: minutes,
      },
      targetMemberId: member.id,
      dedupeKey: `dose_reminder:${doseId}:${member.id}:snooze:${msg.providerMessageId}`,
      notBefore: at,
    },
    now,
  );
  return reply(ctx, "snooze_ack", { patientName: s(view.patient, "name"), minutes, time: localTime(at, family.timezone) });
}

async function claim(ctx: Ctx, replenishmentId: string) {
  const { deps, family, data, member, msg, now } = ctx;
  if (!memberCan(member, "replenishment.manage")) return reply(ctx, "no_permission", {});
  const res = await deps.domain.claimReplenishment({ familyId: family.id, replenishmentId, memberId: member.id });
  if (res.outcome === "not_found") return reply(ctx, "replenish_unavailable", {});
  const base = { patientName: res.patientName, medicationName: res.medicationName, ownerName: res.ownerName };
  if (res.outcome === "taken_by_other") return reply(ctx, "replenish_claimed", { ...base, isYou: false });

  if (msg.groupId) return reply(ctx, "replenish_claimed", { ...base, isYou: false }); // todos veem "Fulana cuida disso"
  await reply(ctx, "replenish_claimed", { ...base, isYou: true });
  // Demais pessoas que recebem avisos da família: "Fulana cuida disso".
  const others = (await familyAlertRecipients(data, family)).filter((r) => r.groupId || r.memberId !== member.id);
  await enqueueToRecipients(
    data,
    others,
    { kind: "replenishment_update", template: "replenish_claimed", params: { ...base, isYou: false }, dedupeKey: `claim:${replenishmentId}:${member.id}` },
    now,
  );
}

const canShareRx = (ctx: Ctx) => memberCan(ctx.member, "prescriptions.view") && memberCan(ctx.member, "prescriptions.share");

/** Receita sai do sistema: só para quem pode ver e compartilhar, sempre em conversa privada, sempre auditada. */
async function showPrescription(ctx: Ctx, ref: { replenishmentId?: string; prescriptionId?: string }) {
  const { deps, family, member, now } = ctx;
  if (!canShareRx(ctx)) return reply(ctx, "no_permission", {}, { private: true });
  const rx = await deps.domain.getPrescriptionForSharing({ familyId: family.id, memberId: member.id, ...ref });
  if (!rx) return reply(ctx, "prescription_unavailable", {}, { private: true });
  await ctx.data.create("prescription_shares", {
    prescription_id: rx.prescriptionId, shared_by_member_id: member.id, channel: "whatsapp", target_member_id: member.id, shared_at: now.toISOString(),
  });
  await audit(ctx, "prescription.share_whatsapp", rx.prescriptionId);
  await reply(
    ctx,
    "prescription_shared",
    {
      familyId: family.id,
      prescriptionId: rx.prescriptionId,
      patientName: rx.patientName,
      ...(rx.doctorName ? { doctorName: rx.doctorName } : {}),
      ...(rx.specialty ? { specialty: rx.specialty } : {}),
      ...(rx.validUntil ? { validUntil: dateBR(rx.validUntil) } : {}),
      medications: rx.medications,
      imageUrl: rx.imageUrl,
      mimeType: rx.mimeType,
    },
    { private: true },
  );
}

async function audit(ctx: Ctx, action: string, entityId: string) {
  await ctx.data.create("audit_log", {
    actor_member_id: ctx.member.id, action, entity: "prescription", entity_id: entityId, at: ctx.now.toISOString(), meta: JSON.stringify({ channel: "whatsapp" }),
  });
}

// ───────────────────────── texto ─────────────────────────

async function handleText(ctx: Ctx, text: string) {
  const chosen = parseOption(text);
  if (chosen !== null) return handleOption(ctx, chosen);
  const { deps, family, data, member, now } = ctx;
  const intent = interpretText(text);
  const [patients, medications] = await Promise.all([data.find("patients", { active: true }, { limit: 200 }), data.find("medications", {}, { limit: 500 })]);
  const mentions = findMentions(text, patients, medications);
  const patientOf = (id: string) => patients.find((p) => p.$id === id);
  const medOf = (id: string) => medications.find((m) => m.$id === id);
  const matchesMentions = (patientId: string, medicationId: string) =>
    (mentions.patientIds.length === 0 || mentions.patientIds.includes(patientId)) &&
    (mentions.medicationIds.length === 0 || mentions.medicationIds.includes(medicationId));

  switch (intent) {
    case "help":
    case "unknown":
      return reply(ctx, "help", {});
    case "not_taken":
      return reply(ctx, "not_taken_ack", {});

    case "stock_status": {
      if (!memberCan(member, "whatsapp.query") || !memberCan(member, "stock.view")) return reply(ctx, "no_permission", {});
      const lines = (await deps.domain.stockOverview({ familyId: family.id })).filter((l) => matchesMentions(l.patientId, l.medicationId));
      return reply(ctx, "stock_reply", {
        lines: lines.map((l) => ({ patientName: l.patientName, medicationName: l.medicationName, daysLeft: l.daysLeft, level: l.level, isEstimate: l.isEstimate })),
      });
    }

    case "next_doses": {
      if (!memberCan(member, "whatsapp.query") || !memberCan(member, "patients.view")) return reply(ctx, "no_permission", {});
      const today = localDate(now, family.timezone);
      const doses = await data.find(
        "dose_events",
        { status: { in: ["pending", "late"] }, scheduled_at: { gte: addMinutes(now, -30).toISOString(), lte: addMinutes(now, 36 * 60).toISOString() } },
        { limit: 100, orderBy: "scheduled_at", order: "asc" },
      );
      const lines = doses
        .filter((d) => localDate(new Date(s(d, "scheduled_at")), family.timezone) === today && matchesMentions(s(d, "patient_id"), s(d, "medication_id")))
        .slice(0, 10)
        .flatMap((d) => {
          const p = patientOf(s(d, "patient_id"));
          const m = medOf(s(d, "medication_id"));
          return p && m
            ? [{ patientName: s(p, "name"), medicationName: s(m, "name"), time: localTime(new Date(s(d, "scheduled_at")), family.timezone), doseText: doseText(n(d, "amount"), m) }]
            : [];
        });
      return reply(ctx, "next_doses_reply", { lines });
    }

    case "dose_status": {
      if (!memberCan(member, "whatsapp.query") || !memberCan(member, "doses.history.view")) return reply(ctx, "no_permission", {});
      if (mentions.medicationIds.length === 0 && mentions.patientIds.length === 0) return reply(ctx, "help", {});
      const today = localDate(now, family.timezone);
      const doses = await data.find(
        "dose_events",
        { scheduled_at: { gte: addMinutes(now, -24 * 60).toISOString(), lte: addMinutes(now, 36 * 60).toISOString() } },
        { limit: 200, orderBy: "scheduled_at", order: "asc" },
      );
      const lines = doses
        .filter((d) => localDate(new Date(s(d, "scheduled_at")), family.timezone) === today && matchesMentions(s(d, "patient_id"), s(d, "medication_id")))
        .slice(0, 10)
        .flatMap((d) => {
          const p = patientOf(s(d, "patient_id"));
          const m = medOf(s(d, "medication_id"));
          const confirmedAt = sOpt(d, "confirmed_at");
          return p && m
            ? [{
                patientName: s(p, "name"),
                medicationName: s(m, "name"),
                time: localTime(new Date(s(d, "scheduled_at")), family.timezone),
                status: s(d, "status") as "pending" | "taken" | "late" | "missed" | "skipped",
                ...(confirmedAt ? { takenAt: localTime(new Date(confirmedAt), family.timezone) } : {}),
              }]
            : [];
        });
      const query = [...mentions.medicationIds.map((id) => medOf(id)), ...mentions.patientIds.map((id) => patientOf(id))].filter(Boolean).map((r) => s(r!, "name")).join(" / ");
      return reply(ctx, "dose_status_reply", { query, lines });
    }

    case "dose_taken": {
      if (!memberCan(member, "doses.confirm")) return reply(ctx, "no_permission", {});
      const pending = await data.find(
        "dose_events",
        { status: { in: ["pending", "late"] }, scheduled_at: { gte: addMinutes(now, -CONFIRM_WINDOW_BEFORE_MIN).toISOString(), lte: addMinutes(now, CONFIRM_WINDOW_AFTER_MIN).toISOString() } },
        { limit: 50, orderBy: "scheduled_at", order: "asc" },
      );
      const candidates = pending.filter((d) => matchesMentions(s(d, "patient_id"), s(d, "medication_id")));
      if (candidates.length === 0) {
        const med = mentions.medicationIds[0] ? medOf(mentions.medicationIds[0]) : undefined;
        const pat = mentions.patientIds[0] ? patientOf(mentions.patientIds[0]) : undefined;
        return reply(ctx, "no_pending_dose", { ...(med ? { medicationName: s(med, "name") } : {}), ...(pat ? { patientName: s(pat, "name") } : {}) });
      }
      if (candidates.length === 1) return confirmDose(ctx, candidates[0]!.$id);

      // Mais de uma possível: nunca chutar. Pergunta com botões.
      const options = candidates.slice(0, 3).flatMap((d) => {
        const p = patientOf(s(d, "patient_id"));
        const m = medOf(s(d, "medication_id"));
        return p && m ? [{ doseEventId: d.$id, patientName: s(p, "name"), medicationName: s(m, "name"), time: localTime(new Date(s(d, "scheduled_at")), family.timezone) }] : [];
      });
      return reply(ctx, "dose_choose", { familyId: family.id, options, moreCount: candidates.length - options.length });
    }
  }
}

// ───────────────────────── resposta numerada ("1", "2"...) ─────────────────────────

const OPTION_TEMPLATES = new Set<string>(["dose_reminder", "dose_missed_family", "dose_choose", "low_stock"]);
const OPTION_WINDOW_MIN = 180;

interface OptionCandidate {
  template: string;
  rowId: string;
  doseEventId?: string;
  options: ReturnType<typeof numberedOptions>;
}

/**
 * Interpreta "1"/"2" como resposta à última pergunta com opções enviada a esta pessoa (ou ao grupo).
 * Reconstrói as opções a partir da própria outbox (mesmo template e parâmetros do envio), sem estado extra.
 * Mais de uma pergunta pendente que sirva → pergunta de novo com a lista numerada; nunca adivinha.
 */
async function handleOption(ctx: Ctx, chosen: number) {
  const { data, member, msg, now } = ctx;
  const target: Record<string, string> = msg.groupId ? { target_group_id: msg.groupId } : { target_member_id: member.id };
  const rows = await data.find("notifications_outbox", { status: "sent", ...target }, { limit: 10, orderBy: "$updatedAt", order: "desc" });

  const candidates: OptionCandidate[] = [];
  for (const row of rows) {
    if (now.getTime() - new Date(String(row["$updatedAt"] ?? 0)).getTime() > OPTION_WINDOW_MIN * 60_000) continue;
    let payload: { template?: string; params?: Record<string, unknown> };
    try {
      payload = JSON.parse(String(row["payload"] ?? "{}")) as typeof payload;
    } catch {
      continue;
    }
    if (!payload.template || !payload.params || !OPTION_TEMPLATES.has(payload.template)) continue;
    const rendered = renderTemplate(payload.template as TemplateId, payload.params as never);
    const options = numberedOptions(rendered.buttons);
    if (options.length === 0) continue;
    const doseEventId = typeof payload.params["doseEventId"] === "string" ? payload.params["doseEventId"] : undefined;
    candidates.push({ template: payload.template, rowId: row.$id, ...(doseEventId ? { doseEventId } : {}), options });
  }
  if (candidates.length === 0) return reply(ctx, "help", {});

  // Uma pergunta explícita ("Qual dose?") mais recente tem prioridade sobre os lembretes antigos.
  let pool = candidates[0]!.template === "dose_choose" ? [candidates[0]!] : candidates;

  // Descarta lembretes de doses que já foram resolvidas.
  const alive: OptionCandidate[] = [];
  for (const c of pool) {
    if (c.template === "dose_reminder" || c.template === "dose_missed_family") {
      const dose = c.doseEventId ? await data.getOrNull("dose_events", c.doseEventId) : null;
      if (!dose || !["pending", "late"].includes(s(dose, "status"))) continue;
    }
    alive.push(c);
  }
  pool = alive;
  if (pool.length === 0) return reply(ctx, "no_pending_dose", {});

  if (pool.length === 1) {
    const option = pool[0]!.options[chosen - 1];
    const decoded = option ? decodeButtonId(option.id) : null;
    if (!decoded || decoded.familyId !== ctx.family.id) return reply(ctx, "help", {});
    return handleButton(ctx, decoded.action, decoded.ref);
  }

  // Várias perguntas pendentes: não dá para saber a qual o "1" responde.
  const options = [];
  for (const c of [...pool].reverse()) {
    if (!c.doseEventId || options.length >= 3) continue;
    const view = await loadDoseView(data, c.doseEventId);
    if (view) {
      options.push({
        doseEventId: c.doseEventId,
        patientName: s(view.patient, "name"),
        medicationName: s(view.medication, "name"),
        time: localTime(new Date(s(view.dose, "scheduled_at")), ctx.family.timezone),
      });
    }
  }
  if (options.length === 0) return reply(ctx, "help", {});
  return reply(ctx, "dose_choose", { familyId: ctx.family.id, options, moreCount: 0 });
}
