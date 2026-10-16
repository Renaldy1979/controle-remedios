import type { OutboundContent } from "../types";
import type { StockLevel } from "./format";

export type Rendered = OutboundContent;

export interface DoseReminderParams {
  familyId: string;
  doseEventId: string;
  patientName: string;
  medicationName: string;
  /** Ex.: "2 gotas". */
  doseText: string;
  /** HH:mm no fuso da família. */
  time: string;
  late?: boolean;
  snoozeMin?: number;
}

export interface DoseMissedFamilyParams {
  familyId: string;
  doseEventId: string;
  patientName: string;
  medicationName: string;
  time: string;
  callPhone?: string;
}

export interface LowStockParams {
  familyId: string;
  replenishmentId: string;
  patientName: string;
  medicationName: string;
  daysLeft: number;
  level: StockLevel;
  isEstimate: boolean;
}

export interface PrescriptionSharedParams {
  familyId: string;
  prescriptionId: string;
  patientName: string;
  doctorName?: string;
  specialty?: string;
  /** dd/mm/aaaa já formatado, ou ausente. */
  validUntil?: string;
  medications: string[];
  imageUrl: string;
  mimeType: string;
}

export interface PrescriptionExpiringParams {
  patientName: string;
  medications: string[];
  daysLeft: number;
  validUntil: string;
}

export interface StockLine {
  patientName: string;
  medicationName: string;
  daysLeft: number;
  level: StockLevel;
  isEstimate: boolean;
}
export interface StockReplyParams {
  lines: StockLine[];
}

export interface NextDoseLine {
  patientName: string;
  medicationName: string;
  time: string;
  doseText: string;
}
export interface NextDosesReplyParams {
  lines: NextDoseLine[];
}

export interface DoseStatusLine {
  patientName: string;
  medicationName: string;
  time: string;
  status: "pending" | "taken" | "late" | "missed" | "skipped";
  /** HH:mm da confirmação, quando tomada. */
  takenAt?: string;
}
export interface DoseStatusReplyParams {
  query: string;
  lines: DoseStatusLine[];
}

export interface DailySummaryParams {
  /** dd/mm/aaaa. */
  date: string;
  patients: Array<{ name: string; taken: number; missed: number; pending: number }>;
  criticalStock: Array<{ patientName: string; medicationName: string; daysLeft: number; isEstimate: boolean }>;
  openReplenishments: number;
}

export interface LoginCodeParams {
  code: string;
  minutes: number;
}

export interface DoseChooseParams {
  familyId: string;
  options: Array<{ doseEventId: string; patientName: string; medicationName: string; time: string }>;
  moreCount: number;
}

export interface TemplateParams {
  dose_reminder: DoseReminderParams;
  dose_missed_family: DoseMissedFamilyParams;
  low_stock: LowStockParams;
  prescription_shared: PrescriptionSharedParams;
  prescription_expiring: PrescriptionExpiringParams;
  stock_reply: StockReplyParams;
  next_doses_reply: NextDosesReplyParams;
  dose_status_reply: DoseStatusReplyParams;
  daily_summary: DailySummaryParams;
  login_code: LoginCodeParams;
  help: Record<string, never>;
  dose_confirmed: { patientName: string; medicationName: string; time: string };
  dose_already_recorded: { patientName: string; medicationName: string };
  dose_choose: DoseChooseParams;
  no_pending_dose: { medicationName?: string; patientName?: string };
  snooze_ack: { patientName: string; minutes: number; time: string };
  not_taken_ack: Record<string, never>;
  no_permission: Record<string, never>;
  transcription_failed: Record<string, never>;
  replenish_claimed: { patientName: string; medicationName: string; ownerName: string; isYou: boolean };
  replenish_unavailable: Record<string, never>;
  prescription_unavailable: { patientName?: string };
  prescription_forward_info: { patientName: string };
  operational_notice: { text: string };
}
export type TemplateId = keyof TemplateParams;
