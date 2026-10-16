import { doseAlreadyRecorded, doseChoose, doseConfirmed, doseMissedFamily, doseReminder, noPendingDose, notTakenAck, snoozeAck } from "./dose";
import { prescriptionExpiring, prescriptionForwardInfo, prescriptionShared, prescriptionUnavailable } from "./prescription";
import { doseStatusReply, nextDosesReply } from "./queries";
import { lowStock, replenishClaimed, replenishUnavailable, stockReply } from "./stock";
import { dailySummary, help, loginCode, noPermission, operationalNotice, transcriptionFailed } from "./system";
import type { Rendered, TemplateId, TemplateParams } from "./types";

export * from "./types";
export { dateBR, type StockLevel } from "./format";

type Registry = { [K in TemplateId]: (p: TemplateParams[K]) => Rendered };

const REGISTRY: Registry = {
  dose_reminder: doseReminder,
  dose_missed_family: doseMissedFamily,
  low_stock: lowStock,
  prescription_shared: prescriptionShared,
  prescription_expiring: prescriptionExpiring,
  stock_reply: stockReply,
  next_doses_reply: nextDosesReply,
  dose_status_reply: doseStatusReply,
  daily_summary: dailySummary,
  login_code: loginCode,
  help: () => help(),
  dose_confirmed: doseConfirmed,
  dose_already_recorded: doseAlreadyRecorded,
  dose_choose: doseChoose,
  no_pending_dose: noPendingDose,
  snooze_ack: snoozeAck,
  not_taken_ack: () => notTakenAck(),
  no_permission: () => noPermission(),
  transcription_failed: () => transcriptionFailed(),
  replenish_claimed: replenishClaimed,
  replenish_unavailable: () => replenishUnavailable(),
  prescription_unavailable: prescriptionUnavailable,
  prescription_forward_info: prescriptionForwardInfo,
  operational_notice: operationalNotice,
};

export function isTemplateId(id: string): id is TemplateId {
  return id in REGISTRY;
}

export function renderTemplate<K extends TemplateId>(id: K, params: TemplateParams[K]): Rendered {
  const fn = REGISTRY[id] as (p: TemplateParams[K]) => Rendered;
  return fn(params);
}
