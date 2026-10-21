/**
 * Schema Postgres do MedCuidar (Drizzle). Fonte da verdade do modelo de dados na v2 (docs/06 e docs/07).
 * snake_case, UUID como chave, FKs reais. O RLS e as funções SECURITY DEFINER ficam em drizzle/0001_rls.sql.
 * Os valores dos enums vêm de @medcuidar/shared (uma só lista).
 */
import { sql } from "drizzle-orm";
import {
  boolean, check, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable, smallint, text,
  timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import {
  channelSchema, controlUnitSchema, doseStatusSchema, medRouteSchema, outboxKindSchema, prescriptionStatusSchema,
  recipientsModeSchema, replenishmentStatusSchema, replenishmentTriggerSchema, scheduleTypeSchema,
  shareChannelSchema, stockMovementTypeSchema, treatmentStatusSchema, messageDirectionSchema, messageTypeSchema,
} from "@medcuidar/shared";

const values = <T extends string>(o: readonly [T, ...T[]]) => [...o] as [T, ...T[]];

export const medRouteEnum = pgEnum("med_route", values(medRouteSchema.options));
export const controlUnitEnum = pgEnum("control_unit", values(controlUnitSchema.options));
export const treatmentStatusEnum = pgEnum("treatment_status", values(treatmentStatusSchema.options));
export const scheduleTypeEnum = pgEnum("schedule_type", values(scheduleTypeSchema.options));
export const doseStatusEnum = pgEnum("dose_status", values(doseStatusSchema.options));
export const channelEnum = pgEnum("dose_channel", values(channelSchema.options));
export const stockMovementTypeEnum = pgEnum("stock_movement_type", values(stockMovementTypeSchema.options));
export const prescriptionStatusEnum = pgEnum("prescription_status", values(prescriptionStatusSchema.options));
export const shareChannelEnum = pgEnum("share_channel", values(shareChannelSchema.options));
export const replenishmentStatusEnum = pgEnum("replenishment_status", values(replenishmentStatusSchema.options));
export const replenishmentTriggerEnum = pgEnum("replenishment_trigger", values(replenishmentTriggerSchema.options));
export const recipientsModeEnum = pgEnum("recipients_mode", values(recipientsModeSchema.options));
export const notificationKindEnum = pgEnum("notification_kind", values(outboxKindSchema.options));
export const messageDirectionEnum = pgEnum("message_direction", values(messageDirectionSchema.options));
export const accessStateEnum = pgEnum("access_state", ["invited", "whatsapp_verified", "active"]);
export const inviteKindEnum = pgEnum("invite_kind", ["email", "whatsapp"]);
export const messageTypeEnum = pgEnum("message_type", values(messageTypeSchema.options));

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const familyId = () => uuid("family_id").notNull().references(() => families.id);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ------------------------------------------------------------------ famílias e pessoas */

export const families = pgTable("families", {
  id: id(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  /** FamilySettings (@medcuidar/shared/familySettingsSchema), validado na API. */
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  active: boolean("active").notNull().default(true),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
});

export const profiles = pgTable("profiles", {
  id: id(),
  familyId: familyId(),
  name: text("name").notNull(),
  permissions: jsonb("permissions").$type<Record<string, boolean>>().notNull().default({}),
  isSystem: boolean("is_system").notNull().default(false),
}, (t) => [
  uniqueIndex("profiles_family_name_uq").on(t.familyId, t.name),
]);

export const members = pgTable("members", {
  id: id(),
  familyId: familyId(),
  profileId: uuid("profile_id").notNull().references(() => profiles.id),
  name: text("name").notNull(),
  email: text("email"),
  /**
   * Estado de acesso (docs/06 seção 2): invited (nada) → whatsapp_verified (WhatsApp básico) → active (portal completo).
   * `active` é o único estado com `appwrite_user_id` e e-mail confirmado (checks abaixo).
   */
  accessState: accessStateEnum("access_state").notNull().default("invited"),
  /** E-mail confirmado (Appwrite). Só existe em `active`. O `email` em si pode estar pré-preenchido em qualquer estado. */
  emailConfirmedAt: timestamp("email_confirmed_at", { withTimezone: true }),
  /** Id do usuário no Appwrite Auth (login e-mail/senha). Só existe em `active`. */
  appwriteUserId: text("appwrite_user_id"),
  roleLabel: text("role_label"),
  active: boolean("active").notNull().default(true),
  receivesFamilyAlerts: boolean("receives_family_alerts").notNull().default(false),
  /** Número VERIFICADO (só dígitos, DDI+DDD+número). Único no sistema inteiro. */
  phoneVerified: text("phone_verified"),
  /** Número informado e ainda não verificado. */
  phonePending: text("phone_pending"),
  /** sha256 do código de 6 dígitos (nunca o código). */
  verificationCodeHash: text("verification_code_hash"),
  verificationExpiresAt: ts("verification_expires_at"),
  verificationAttempts: smallint("verification_attempts").notNull().default(0),
  removedAt: ts("removed_at"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("members_phone_verified_uq").on(t.phoneVerified).where(sql`${t.phoneVerified} is not null`),
  uniqueIndex("members_appwrite_user_uq").on(t.appwriteUserId).where(sql`${t.appwriteUserId} is not null`),
  uniqueIndex("members_family_email_uq").on(t.familyId, sql`lower(${t.email})`).where(sql`${t.email} is not null`),
  index("members_phone_pending_idx").on(t.phonePending).where(sql`${t.phonePending} is not null`),
  index("members_family_idx").on(t.familyId),
  check("members_phone_verified_fmt", sql`${t.phoneVerified} is null or ${t.phoneVerified} ~ '^[0-9]{10,15}$'`),
  check("members_active_needs_auth", sql`${t.accessState} <> 'active' or (${t.appwriteUserId} is not null and ${t.email} is not null and ${t.emailConfirmedAt} is not null)`),
  check("members_auth_only_active", sql`${t.accessState} = 'active' or (${t.appwriteUserId} is null and ${t.emailConfirmedAt} is null)`),
  check("members_wa_needs_phone", sql`${t.accessState} <> 'whatsapp_verified' or ${t.phoneVerified} is not null`),
  check("members_phone_pending_fmt", sql`${t.phonePending} is null or ${t.phonePending} ~ '^[0-9]{10,15}$'`),
]);

export const patients = pgTable("patients", {
  id: id(),
  familyId: familyId(),
  name: text("name").notNull(),
  birthDate: date("birth_date", { mode: "string" }),
  notes: text("notes"),
  canUsePhone: boolean("can_use_phone").notNull().default(true),
  /** Quando o paciente também é usuário (ex.: Adelino). */
  selfMemberId: uuid("self_member_id").references(() => members.id),
  reminderRecipientsMode: recipientsModeEnum("reminder_recipients_mode").notNull().default("all_members"),
  active: boolean("active").notNull().default(true),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
}, (t) => [
  index("patients_family_idx").on(t.familyId),
]);

export const careAssignments = pgTable("care_assignments", {
  id: id(),
  familyId: familyId(),
  patientId: uuid("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  weekdays: smallint("weekdays").array().notNull().default(sql`'{0,1,2,3,4,5,6}'`),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  priority: integer("priority").notNull().default(1),
}, (t) => [
  index("care_assignments_patient_idx").on(t.familyId, t.patientId),
  check("care_assignments_time_fmt", sql`${t.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ${t.endTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
]);

/** Convites (e-mail ou WhatsApp). O código nunca é guardado, só o hash (preso ao número esperado). */
export const invites = pgTable("invites", {
  id: id(),
  familyId: familyId(),
  kind: inviteKindEnum("kind").notNull(),
  profileId: uuid("profile_id").notNull().references(() => profiles.id),
  /** Membro criado/vinculado ao convite (nasce `invited`). */
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  /** kind = email */
  email: text("email"),
  /** kind = whatsapp: só dígitos; o código só vale se vier deste número. */
  expectedPhone: text("expected_phone"),
  /** kind = whatsapp: hashConviteCodigo(expected_phone, código). */
  codeHash: text("code_hash"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: smallint("attempts").notNull().default(0),
  consumedAt: ts("consumed_at"),
  revokedAt: ts("revoked_at"),
  createdByMemberId: uuid("created_by_member_id").references(() => members.id),
  createdAt: createdAt(),
}, (t) => [
  // um convite de WhatsApp ativo por número esperado (o app revoga o antigo antes de criar outro)
  uniqueIndex("invites_expected_phone_active_uq").on(t.expectedPhone)
    .where(sql`${t.kind} = 'whatsapp' and ${t.consumedAt} is null and ${t.revokedAt} is null`),
  index("invites_family_idx").on(t.familyId, t.createdAt),
  index("invites_member_idx").on(t.memberId),
  check("invites_kind_fields", sql`(${t.kind} = 'email' and ${t.email} is not null and ${t.expectedPhone} is null)
    or (${t.kind} = 'whatsapp' and coalesce(${t.expectedPhone} ~ '^[0-9]{10,15}$', false) and coalesce(${t.codeHash} ~ '^[0-9a-f]{64}$', false))`),
  check("invites_expiry", sql`${t.expiresAt} > ${t.createdAt}`),
]);

/** Link de primeiro acesso ao portal (uso único, 24 h). Só o hash do token é guardado. */
export const firstAccessLinks = pgTable("first_access_links", {
  id: id(),
  familyId: familyId(),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: ts("consumed_at"),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("first_access_links_token_uq").on(t.tokenHash),
  index("first_access_links_member_idx").on(t.familyId, t.memberId),
  check("first_access_links_hash_fmt", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  check("first_access_links_expiry", sql`${t.expiresAt} > ${t.createdAt}`),
]);

/* ------------------------------------------------------------------ remédios e tratamentos */

export const medications = pgTable("medications", {
  id: id(),
  familyId: familyId(),
  name: text("name").notNull(),
  alternativeNames: text("alternative_names").array().notNull().default(sql`'{}'`),
  route: medRouteEnum("route").notNull(),
  controlUnit: controlUnitEnum("control_unit").notNull(),
  /** Só colírio/gotas: gotas por ml (estimativa). */
  dropsPerMl: doublePrecision("drops_per_ml"),
  packageSize: doublePrecision("package_size"),
  requiresPrescription: boolean("requires_prescription").notNull().default(false),
  notes: text("notes"),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
}, (t) => [
  index("medications_family_idx").on(t.familyId),
  check("medications_drops_pos", sql`${t.dropsPerMl} is null or ${t.dropsPerMl} > 0`),
]);

export const treatments = pgTable("treatments", {
  id: id(),
  familyId: familyId(),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  medicationId: uuid("medication_id").notNull().references(() => medications.id),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }),
  status: treatmentStatusEnum("status").notNull().default("active"),
  lowStockDays: integer("low_stock_days"),
  notes: text("notes"),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
}, (t) => [
  index("treatments_patient_idx").on(t.familyId, t.patientId),
  index("treatments_status_idx").on(t.familyId, t.status),
  check("treatments_dates", sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
]);

export const treatmentPhases = pgTable("treatment_phases", {
  id: id(),
  familyId: familyId(),
  treatmentId: uuid("treatment_id").notNull().references(() => treatments.id, { onDelete: "cascade" }),
  order: integer("order").notNull(),
  startDay: integer("start_day").notNull(),
  endDay: integer("end_day"),
  scheduleType: scheduleTypeEnum("schedule_type").notNull(),
  intervalHours: doublePrecision("interval_hours"),
  firstDoseTime: text("first_dose_time"),
  times: text("times").array(),
  doseAmount: doublePrecision("dose_amount").notNull(),
}, (t) => [
  uniqueIndex("treatment_phases_order_uq").on(t.treatmentId, t.order),
  index("treatment_phases_family_idx").on(t.familyId, t.treatmentId),
  check("treatment_phases_days", sql`${t.startDay} >= 1 and (${t.endDay} is null or ${t.endDay} >= ${t.startDay})`),
  check("treatment_phases_amount", sql`${t.doseAmount} > 0`),
  check("treatment_phases_schedule", sql`(${t.scheduleType} = 'interval' and coalesce(${t.intervalHours} > 0, false) and ${t.firstDoseTime} is not null)
    or (${t.scheduleType} = 'fixed_times' and coalesce(array_length(${t.times}, 1), 0) > 0)`),
]);

export const doseEvents = pgTable("dose_events", {
  id: id(),
  familyId: familyId(),
  treatmentId: uuid("treatment_id").notNull().references(() => treatments.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  medicationId: uuid("medication_id").notNull().references(() => medications.id),
  phaseId: uuid("phase_id").references(() => treatmentPhases.id, { onDelete: "set null" }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  status: doseStatusEnum("status").notNull().default("pending"),
  confirmedByMemberId: uuid("confirmed_by_member_id").references(() => members.id),
  confirmedAt: ts("confirmed_at"),
  channel: channelEnum("channel"),
  /** Id da mensagem do WhatsApp que confirmou (idempotência). */
  sourceMessageId: text("source_message_id"),
  skippedReason: text("skipped_reason"),
  amount: doublePrecision("amount").notNull(),
  /** Pedido "lembrar de novo" (Lote 2 registra; o envio é do Lote 4): quando o lembrete deve ser repetido. */
  remindAgainAt: ts("remind_again_at"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("dose_events_treatment_time_uq").on(t.treatmentId, t.scheduledAt),
  uniqueIndex("dose_events_source_message_uq").on(t.sourceMessageId).where(sql`${t.sourceMessageId} is not null`),
  index("dose_events_family_time_idx").on(t.familyId, t.scheduledAt),
  index("dose_events_patient_time_idx").on(t.familyId, t.patientId, t.scheduledAt),
  index("dose_events_status_idx").on(t.familyId, t.status),
  check("dose_events_amount", sql`${t.amount} > 0`),
]);

/* ------------------------------------------------------------------ estoque (livro-razão) */

export const stockItems = pgTable("stock_items", {
  id: id(),
  familyId: familyId(),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  medicationId: uuid("medication_id").notNull().references(() => medications.id),
  controlUnit: controlUnitEnum("control_unit").notNull(),
  /** Colírio: o estoque é estimativa (a UI sempre sinaliza). */
  isEstimate: boolean("is_estimate").notNull().default(false),
  /** Cache do saldo; a verdade é a soma de stock_movements. */
  cachedBalance: doublePrecision("cached_balance").notNull().default(0),
  cachedBalanceAt: ts("cached_balance_at"),
}, (t) => [
  uniqueIndex("stock_items_patient_med_uq").on(t.familyId, t.patientId, t.medicationId),
]);

export const stockMovements = pgTable("stock_movements", {
  id: id(),
  familyId: familyId(),
  stockItemId: uuid("stock_item_id").notNull().references(() => stockItems.id),
  type: stockMovementTypeEnum("type").notNull(),
  /** + entra, − sai. */
  quantity: doublePrecision("quantity").notNull(),
  doseEventId: uuid("dose_event_id").references(() => doseEvents.id),
  replenishmentId: uuid("replenishment_id").references(() => replenishments.id),
  createdByMemberId: uuid("created_by_member_id").references(() => members.id),
  note: text("note"),
  createdAt: createdAt(),
}, (t) => [
  // o desconto original de uma dose existe uma só vez; compensações (undo/redo) são `adjustment` sem dose_event_id
  uniqueIndex("stock_movements_dose_event_uq").on(t.doseEventId).where(sql`${t.doseEventId} is not null`),
  index("stock_movements_item_idx").on(t.familyId, t.stockItemId),
  check("stock_movements_dose_link", sql`${t.type} <> 'dose' or ${t.doseEventId} is not null`),
  check("stock_movements_qty", sql`${t.quantity} <> 0`),
  // a compra de uma reposição soma ao estoque uma só vez (migração 0005)
  uniqueIndex("stock_movements_replenishment_purchase_uq").on(t.replenishmentId)
    .where(sql`${t.replenishmentId} is not null and ${t.type} = 'purchase'`),
]);

/* ------------------------------------------------------------------ receitas */

export const prescriptions = pgTable("prescriptions", {
  id: id(),
  familyId: familyId(),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  doctorName: text("doctor_name"),
  specialty: text("specialty"),
  issuedOn: date("issued_on", { mode: "string" }).notNull(),
  validUntil: date("valid_until", { mode: "string" }),
  status: prescriptionStatusEnum("status").notNull().default("valid"),
  supersededById: uuid("superseded_by_id"),
  isControlled: boolean("is_controlled").notNull().default(false),
  copies: smallint("copies"),
  notes: text("notes"),
  uploadedByMemberId: uuid("uploaded_by_member_id").notNull().references(() => members.id),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
}, (t) => [
  index("prescriptions_patient_idx").on(t.familyId, t.patientId),
  index("prescriptions_status_idx").on(t.familyId, t.status),
  check("prescriptions_dates", sql`${t.validUntil} is null or ${t.validUntil} >= ${t.issuedOn}`),
]);

export const prescriptionFiles = pgTable("prescription_files", {
  id: id(),
  familyId: familyId(),
  prescriptionId: uuid("prescription_id").notNull().references(() => prescriptions.id, { onDelete: "cascade" }),
  /** Id do arquivo no bucket do Appwrite. Acesso só por URL assinada. */
  storageFileId: text("storage_file_id").notNull(),
  page: integer("page").notNull().default(1),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
}, (t) => [index("prescription_files_idx").on(t.familyId, t.prescriptionId)]);

export const prescriptionItems = pgTable("prescription_items", {
  id: id(),
  familyId: familyId(),
  prescriptionId: uuid("prescription_id").notNull().references(() => prescriptions.id, { onDelete: "cascade" }),
  medicationId: uuid("medication_id").notNull().references(() => medications.id),
}, (t) => [
  uniqueIndex("prescription_items_uq").on(t.prescriptionId, t.medicationId),
  index("prescription_items_med_idx").on(t.familyId, t.medicationId),
]);

export const prescriptionShares = pgTable("prescription_shares", {
  id: id(),
  familyId: familyId(),
  prescriptionId: uuid("prescription_id").notNull().references(() => prescriptions.id, { onDelete: "cascade" }),
  sharedByMemberId: uuid("shared_by_member_id").notNull().references(() => members.id),
  channel: shareChannelEnum("channel").notNull(),
  targetMemberId: uuid("target_member_id").references(() => members.id),
  /** Só dígitos; sem dado pessoal em logs. */
  targetPhone: text("target_phone"),
  sharedAt: timestamp("shared_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("prescription_shares_idx").on(t.familyId, t.prescriptionId)]);

export const prescriptionViews = pgTable("prescription_views", {
  id: id(),
  familyId: familyId(),
  prescriptionId: uuid("prescription_id").notNull().references(() => prescriptions.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id),
  viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("prescription_views_idx").on(t.familyId, t.prescriptionId)]);

/* ------------------------------------------------------------------ reposição */

export const replenishments = pgTable("replenishments", {
  id: id(),
  familyId: familyId(),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  medicationId: uuid("medication_id").notNull().references(() => medications.id),
  status: replenishmentStatusEnum("status").notNull().default("needs_prescription"),
  triggeredBy: replenishmentTriggerEnum("triggered_by").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: ts("closed_at"),
}, (t) => [
  index("replenishments_status_idx").on(t.familyId, t.status),
  index("replenishments_patient_med_idx").on(t.familyId, t.patientId, t.medicationId),
  // no máximo uma reposição aberta por paciente+remédio
  uniqueIndex("replenishments_open_uq").on(t.familyId, t.patientId, t.medicationId)
    .where(sql`${t.status} not in ('done','cancelled')`),
]);

export const replenishmentSteps = pgTable("replenishment_steps", {
  id: id(),
  familyId: familyId(),
  replenishmentId: uuid("replenishment_id").notNull().references(() => replenishments.id, { onDelete: "cascade" }),
  step: integer("step").notNull(),
  ownerMemberId: uuid("owner_member_id").references(() => members.id),
  /** Quando a pessoa atual assumiu a etapa ("desde …"); migração 0005. */
  claimedAt: ts("claimed_at"),
  /** Etapa que não se aplica (remédio sem receita pula as etapas 1 e 2); migração 0005. */
  notApplicable: boolean("not_applicable").notNull().default(false),
  doneAt: ts("done_at"),
  note: text("note"),
  prescriptionId: uuid("prescription_id").references(() => prescriptions.id),
  purchaseQuantity: doublePrecision("purchase_quantity"),
}, (t) => [
  uniqueIndex("replenishment_steps_uq").on(t.replenishmentId, t.step),
  index("replenishment_steps_family_idx").on(t.familyId, t.replenishmentId),
]);

/* ------------------------------------------------------------------ avisos, mensagens e auditoria */

/** Avisos no portal, por membro. Lembretes e estoque baixo chegam aqui e (se verificado) pelo WhatsApp. */
export const notifications = pgTable("notifications", {
  id: id(),
  familyId: familyId(),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  kind: notificationKindEnum("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  readAt: ts("read_at"),
  /** Marca de idempotência do envio ao WhatsApp (nulo = ainda não enviado). */
  whatsappSentAt: ts("whatsapp_sent_at"),
  dedupeKey: text("dedupe_key").notNull(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("notifications_dedupe_uq").on(t.familyId, t.dedupeKey),
  index("notifications_member_idx").on(t.familyId, t.memberId, t.readAt),
]);

/** Mensagens do WhatsApp (entrada e saída). `provider_message_id` único = idempotência dos webhooks. */
export const messageLog = pgTable("message_log", {
  id: id(),
  familyId: familyId(),
  direction: messageDirectionEnum("direction").notNull(),
  providerMessageId: text("provider_message_id").notNull(),
  memberId: uuid("member_id").references(() => members.id),
  type: messageTypeEnum("type").notNull().default("text"),
  /** Texto SEM dados pessoais (redigido). */
  bodyRedacted: text("body_redacted"),
  transcript: text("transcript"),
  relatedDoseEventId: uuid("related_dose_event_id").references(() => doseEvents.id),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("message_log_provider_uq").on(t.providerMessageId),
  index("message_log_family_time_idx").on(t.familyId, t.receivedAt),
]);

export const auditLog = pgTable("audit_log", {
  id: id(),
  familyId: familyId(),
  actorMemberId: uuid("actor_member_id").references(() => members.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
}, (t) => [
  index("audit_log_time_idx").on(t.familyId, t.at),
  index("audit_log_entity_idx").on(t.familyId, t.entity, t.entityId),
]);

/* ------------------------------------------------------------------ API: chaves e idempotência */

/** Chaves por família (`cdf_`). Só o hash é guardado. */
export const apiKeys = pgTable("api_keys", {
  id: id(),
  familyId: familyId(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull().default("cdf_"),
  keyHash: text("key_hash").notNull(),
  scopes: text("scopes").array().notNull().default(sql`'{}'`),
  createdByMemberId: uuid("created_by_member_id").references(() => members.id),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("api_keys_hash_uq").on(t.keyHash),
  index("api_keys_family_idx").on(t.familyId),
  check("api_keys_prefix", sql`${t.prefix} = 'cdf_'`),
]);

/** Chaves da PLATAFORMA (`cpl_`, ex.: N8N, escopo `conversa`). Sem família: RLS por `app.plataforma`. */
export const platformApiKeys = pgTable("platform_api_keys", {
  id: id(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull().default("cpl_"),
  keyHash: text("key_hash").notNull(),
  scopes: text("scopes").array().notNull().default(sql`'{}'`),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("platform_api_keys_hash_uq").on(t.keyHash),
  check("platform_api_keys_prefix", sql`${t.prefix} = 'cpl_'`),
]);

/** Auditoria das chamadas da plataforma (sem telefone completo). */
export const platformAuditLog = pgTable("platform_audit_log", {
  id: id(),
  keyId: uuid("key_id").references(() => platformApiKeys.id),
  method: text("method").notNull(),
  route: text("route").notNull(),
  familyId: uuid("family_id"),
  maskedPhone: text("masked_phone"),
  status: smallint("status").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("platform_audit_log_at_idx").on(t.at)]);

/** Tentativas por telefone na verificação do WhatsApp. Sem política: só a função verify_pending_phone mexe. */
export const phoneLockouts = pgTable("phone_lockouts", {
  phone: text("phone").primaryKey(),
  failures: smallint("failures").notNull().default(0),
  blockedUntil: ts("blocked_until"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const idempotency = pgTable("idempotency", {
  id: id(),
  familyId: familyId(),
  key: text("key").notNull(),
  requestHash: text("request_hash").notNull(),
  /** Nulo enquanto a primeira requisição ainda está em andamento. */
  status: smallint("status"),
  response: jsonb("response"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("idempotency_family_key_uq").on(t.familyId, t.key),
  index("idempotency_created_idx").on(t.createdAt),
]);

/* ------------------------------------------------------------------ WhatsApp: fila de saída e conversa (Lote 4A) */

/**
 * Fila de mensagens a enviar (docs/10). A API decide quem, quando e o texto; o N8N só envia e marca como enviada.
 * `dedupe_key` único por família = a mesma mensagem nunca entra duas vezes. A reivindicação é um "lease" atômico
 * (`claimed_until`) feito com FOR UPDATE SKIP LOCKED. O corpo é dado de saúde: nunca vai para log.
 */
export const outboundMessages = pgTable("outbound_messages", {
  id: id(),
  familyId: familyId(),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  /** dose_reminder | dose_missed | low_stock | rx_expiring | replenishment | daily_summary */
  kind: text("kind").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  body: text("body").notNull(),
  /** Rótulos das opções numeradas (1, 2, ...). */
  options: jsonb("options").$type<string[]>().notNull().default([]),
  /** Para onde a resposta numérica aponta (ids de dose, remédio...). */
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
  notBefore: timestamp("not_before", { withTimezone: true }).notNull().defaultNow(),
  claimedUntil: ts("claimed_until"),
  claimCount: smallint("claim_count").notNull().default(0),
  sentAt: ts("sent_at"),
  discardedAt: ts("discarded_at"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("outbound_messages_dedupe_uq").on(t.familyId, t.dedupeKey),
  index("outbound_messages_pending_idx").on(t.familyId, t.notBefore).where(sql`${t.sentAt} is null and ${t.discardedAt} is null`),
]);

/** A última pergunta numerada feita a cada pessoa ("1 — Tomei"): o que "1" e "2" significam agora. Uma linha por pessoa. */
export const conversationState = pgTable("conversation_state", {
  id: id(),
  familyId: familyId(),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  /** reminders | choose_dose | choose_snooze | choose_replenishment | low_stock */
  kind: text("kind").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("conversation_state_member_uq").on(t.familyId, t.memberId),
]);

/** Tabelas com `family_id` (RLS por família). Usado pelos testes de isolamento. */
export const FAMILY_TABLES = [
  "profiles", "members", "patients", "care_assignments", "medications", "treatments", "treatment_phases",
  "dose_events", "stock_items", "stock_movements", "prescriptions", "prescription_files", "prescription_items",
  "prescription_shares", "prescription_views", "replenishments", "replenishment_steps", "notifications",
  "message_log", "audit_log", "api_keys", "idempotency", "invites", "first_access_links",
  "outbound_messages", "conversation_state",
] as const;
