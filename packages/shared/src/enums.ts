import { z } from "zod";

export const medRouteSchema = z.enum(["drops", "tablet", "powder", "liquid", "ointment", "other"]);
export type MedRoute = z.infer<typeof medRouteSchema>;

export const controlUnitSchema = z.enum(["unit", "ml", "drop", "gram"]);
export type ControlUnit = z.infer<typeof controlUnitSchema>;

export const treatmentStatusSchema = z.enum(["active", "paused", "finished"]);
export const scheduleTypeSchema = z.enum(["interval", "fixed_times"]);

export const doseStatusSchema = z.enum(["pending", "taken", "late", "missed", "skipped"]);
export type DoseStatus = z.infer<typeof doseStatusSchema>;

export const channelSchema = z.enum(["whatsapp", "panel", "system"]);
export const stockMovementTypeSchema = z.enum(["purchase", "dose", "adjustment", "loss"]);

export const prescriptionStatusSchema = z.enum(["valid", "expired", "awaiting_new", "superseded"]);
export const shareChannelSchema = z.enum(["internal", "whatsapp"]);

export const replenishmentStatusSchema = z.enum([
  "needs_prescription",
  "prescription_received",
  "purchased",
  "done",
  "cancelled",
]);
export const replenishmentTriggerSchema = z.enum(["low_stock", "prescription_expiry", "manual"]);

export const outboxKindSchema = z.enum([
  "dose_reminder",
  "dose_upcoming_family",
  "dose_missed",
  "low_stock",
  "prescription_expiring",
  "replenishment_update",
  "daily_summary",
  "login_code",
  "reply",
]);
export const outboxStatusSchema = z.enum(["queued", "sending", "sent", "failed", "dead"]);

export const messageDirectionSchema = z.enum(["in", "out"]);
export const messageTypeSchema = z.enum(["text", "button", "audio", "image"]);

export const recipientsModeSchema = z.enum(["all_members", "assignments_only", "assignments_plus_family"]);
export type RecipientsMode = z.infer<typeof recipientsModeSchema>;

export const whatsappStatusSchema = z.enum(["unverified", "verified", "failed"]);
