import { createDomainPort, type FileSigner } from "../domain/binding";
import { buildWorld, FAMILY_ID, type WorldOptions } from "./world";

/** Instante local de hoje (15/10/2026, São Paulo = UTC-3) em UTC. */
const at = (hhmmLocal: string) => new Date(`2026-10-15T${hhmmLocal}:00-03:00`);

export const fakeSigner: FileSigner = {
  async sign(id) {
    return { url: `https://arquivos.exemplo.test/${id}?assinatura=temporaria`, mimeType: "image/jpeg" };
  },
};

/**
 * Mundo de teste com o DOMÍNIO REAL (`createDomainPort` sobre `@medcuidar/domain`) e dados em memória.
 * Hoje (15/10, 14:00 local) já tem a agenda do dia gravada: Zypred 4x/dia e Losartana 1x/dia, com as doses
 * passadas `taken` e `dose-zyp` (e opcionalmente `dose-los`) pendentes às 14:00. O gerador roda de verdade,
 * mas encontra tudo já gravado (idempotente).
 */
export function buildRealWorld(opts: WorldOptions & { twoPending?: boolean } = {}) {
  const w = buildWorld({ settings: { reminder_recipients_mode: "assignments_only", ...opts.settings }, ...opts });
  const seed = (col: string, id: string, data: Record<string, unknown>) => w.store.seed(col, FAMILY_ID, id, data);

  for (const patient of ["pat-adelino", "pat-maria"]) {
    seed("care_assignments", `ca-rosa-${patient}`, {
      patient_id: patient, member_id: "mem-rosa", weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: "00:00", end_time: "00:00", priority: 1,
    });
  }
  seed("treatments", "trt-zypred", { patient_id: "pat-adelino", medication_id: "med-zypred", start_date: "2026-10-01", status: "active" });
  seed("treatment_phases", "ph-zypred", {
    treatment_id: "trt-zypred", order: 1, start_day: 1, end_day: null, schedule_type: "fixed_times", times: ["08:00", "11:00", "14:00", "17:00"], dose_amount: 1,
  });
  seed("treatments", "trt-losartana", { patient_id: "pat-maria", medication_id: "med-losartana", start_date: "2026-10-01", status: "active" });
  seed("treatment_phases", "ph-losartana", {
    treatment_id: "trt-losartana", order: 1, start_day: 1, end_day: null, schedule_type: "fixed_times", times: ["14:00"], dose_amount: 1,
  });

  const dose = (id: string, treatment: string, patient: string, med: string, when: string, status: string) =>
    seed("dose_events", id, { treatment_id: treatment, patient_id: patient, medication_id: med, scheduled_at: at(when).toISOString(), status, amount: 1 });
  dose("dose-zyp-08", "trt-zypred", "pat-adelino", "med-zypred", "08:00", "taken");
  dose("dose-zyp-11", "trt-zypred", "pat-adelino", "med-zypred", "11:00", "taken");
  dose("dose-zyp", "trt-zypred", "pat-adelino", "med-zypred", "14:00", "pending");
  dose("dose-zyp-17", "trt-zypred", "pat-adelino", "med-zypred", "17:00", "pending");
  dose("dose-los", "trt-losartana", "pat-maria", "med-losartana", "14:00", opts.twoPending ? "pending" : "taken");

  const domain = createDomainPort({ global: w.global, dataFor: w.dataFor, now: () => w.clock.current, signer: fakeSigner });
  w.schedulerDeps.domain = domain;
  w.inboundDeps.domain = domain;
  return Object.assign(w, { realDomain: domain });
}

export type RealWorld = ReturnType<typeof buildRealWorld>;
