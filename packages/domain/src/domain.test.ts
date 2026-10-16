import { describe, expect, it } from "vitest";
import {
  advanceReplenishment,
  applyAdjustment,
  balance,
  confirmDose,
  undoDoseConfirmation,
  type UndoDoseRepo,
  currentStep,
  forecastDepletion,
  generateDoseEvents,
  isCoverageValid,
  lowStockStatus,
  markLateAndMissed,
  medicationPrescriptionState,
  openReplenishment,
  prescriptionStatus,
  prescriptionsToSupersede,
  resolveResponsible,
  stepState,
  zonedToUtc,
  type ConfirmDoseRepo,
  type DoseEvent,
  type Member,
  type StockMovement,
  type Treatment,
  type TreatmentPhase,
} from "./index";

const TZ = "America/Sao_Paulo";
const treatment: Treatment = {
  id: "t1",
  family_id: "f1",
  patient_id: "p1",
  medication_id: "m1",
  start_date: "2026-10-01",
  status: "active",
};
const phase = (o: Partial<TreatmentPhase>): TreatmentPhase => ({
  id: "ph",
  treatment_id: "t1",
  order: 1,
  start_day: 1,
  end_day: null,
  schedule_type: "interval",
  interval_hours: 3,
  first_dose_time: "06:00",
  dose_amount: 1,
  ...o,
});
const chained = [
  phase({ id: "a", order: 1, start_day: 1, end_day: 15, interval_hours: 3, first_dose_time: "06:00" }),
  phase({ id: "b", order: 2, start_day: 16, end_day: 20, interval_hours: 6, first_dose_time: "06:00" }),
];
const hours = (iso: string[]) => iso.map((s) => new Date(s).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }));

describe("generateDoseEvents", () => {
  it("fase 1: 3 em 3 h → 6h..21h (6 doses; 24h não entra no mesmo dia)", () => {
    const d = generateDoseEvents(treatment, chained, "2026-10-15", TZ);
    expect(hours(d.map((x) => x.scheduled_at))).toEqual(["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]);
    expect(d[0]!.phase_id).toBe("a");
  });
  it("borda do dia 15→16 muda de fase", () => {
    const d15 = generateDoseEvents(treatment, chained, "2026-10-15", TZ);
    const d16 = generateDoseEvents(treatment, chained, "2026-10-16", TZ);
    expect(d15.every((x) => x.phase_id === "a")).toBe(true);
    expect(hours(d16.map((x) => x.scheduled_at))).toEqual(["06:00", "12:00", "18:00"]);
    expect(d16.every((x) => x.phase_id === "b")).toBe(true);
  });
  it("depois do dia 20 e antes do início não gera", () => {
    expect(generateDoseEvents(treatment, chained, "2026-10-21", TZ)).toEqual([]);
    expect(generateDoseEvents(treatment, chained, "2026-09-30", TZ)).toEqual([]);
  });
  it("fase final 'até acabar' continua gerando", () => {
    const p = [phase({ end_day: null })];
    expect(generateDoseEvents(treatment, p, "2027-03-01", TZ).length).toBe(6);
  });
  it("é idempotente e descarta já existentes", () => {
    const a = generateDoseEvents(treatment, chained, "2026-10-15", TZ);
    expect(generateDoseEvents(treatment, chained, "2026-10-15", TZ)).toEqual(a);
    const b = generateDoseEvents(treatment, chained, "2026-10-15", TZ, [{ scheduled_at: a[0]!.scheduled_at }]);
    expect(b.length).toBe(a.length - 1);
  });
  it("guarda UTC e usa dia local: 22h local não vira o dia seguinte", () => {
    const p = [phase({ schedule_type: "fixed_times", times: ["22:30", "08:00"], interval_hours: null })];
    const d = generateDoseEvents(treatment, p, "2026-10-15", TZ);
    expect(d.map((x) => x.scheduled_at)).toEqual(["2026-10-15T11:00:00.000Z", "2026-10-16T01:30:00.000Z"]);
  });
  it("não gera para tratamento pausado", () => {
    expect(generateDoseEvents({ ...treatment, status: "paused" }, chained, "2026-10-15", TZ)).toEqual([]);
  });
  it("horário de verão (fuso com DST) não duplica nem pula: horários fixos e intervalo", () => {
    const NY = "America/New_York";
    // 08/03/2026: salto 02:00→03:00
    const fixed = [phase({ schedule_type: "fixed_times", times: ["01:30", "02:30", "03:30", "12:00"], interval_hours: null })];
    const d = generateDoseEvents(treatment, fixed, "2026-10-15", NY); // dia normal
    expect(d.length).toBe(4);
    const springT = { ...treatment, start_date: "2026-03-01" };
    const spring = generateDoseEvents(springT, fixed, "2026-03-08", NY);
    // 02:30 inexistente cai em 03:30 → a mesma instância não pode duplicar
    expect(new Set(spring.map((x) => x.scheduled_at)).size).toBe(spring.length);
    const iv = generateDoseEvents(springT, [phase({ interval_hours: 4, first_dose_time: "00:00" })], "2026-03-08", NY);
    const gaps = iv.slice(1).map((x, i) => (Date.parse(x.scheduled_at) - Date.parse(iv[i]!.scheduled_at)) / 3600000);
    expect(gaps.every((g) => g === 4)).toBe(true);
    const fall = generateDoseEvents({ ...treatment, start_date: "2026-11-01" }, [phase({ interval_hours: 4, first_dose_time: "00:00" })], "2026-11-01", NY);
    const gaps2 = fall.slice(1).map((x, i) => (Date.parse(x.scheduled_at) - Date.parse(fall[i]!.scheduled_at)) / 3600000);
    expect(gaps2.every((g) => g === 4)).toBe(true);
  });
  it("zonedToUtc em São Paulo (UTC−3, sem DST)", () => {
    expect(zonedToUtc("2026-10-15", 6 * 60, TZ).toISOString()).toBe("2026-10-15T09:00:00.000Z");
  });
});

describe("confirmDose", () => {
  function makeRepo() {
    const doses = new Map<string, DoseEvent>();
    const movements: StockMovement[] = [];
    doses.set("d1", {
      id: "d1", family_id: "f1", treatment_id: "t1", patient_id: "p1", medication_id: "m1",
      scheduled_at: "2026-10-15T09:00:00.000Z", status: "pending", amount: 2,
    });
    const repo: ConfirmDoseRepo & UndoDoseRepo = {
      getDose: async (id) => doses.get(id) ?? null,
      findDoseBySourceMessage: async (s) => [...doses.values()].find((d) => d.source_message_id === s) ?? null,
      findStockItemId: async () => "s1",
      listDoseMovements: async (id) => movements.filter((m) => m.dose_event_id === id || m.note?.includes(`:${id}`)),
      insertMovement: async (m) => void movements.push(m),
      resetDose: async (id, status: "pending" | "late" | "missed") => {
        const d = { ...doses.get(id)!, status, confirmed_by_member_id: null, confirmed_at: null, channel: null, source_message_id: null };
        doses.set(id, d);
        return d;
      },
      insertDoseMovementIfAbsent: async (m) => {
        if (movements.some((x) => x.dose_event_id === m.dose_event_id)) return false;
        movements.push(m);
        return true;
      },
      markTaken: async (id, patch) => {
        const d = { ...doses.get(id)!, status: "taken" as const, ...patch };
        doses.set(id, d);
        return d;
      },
    };
    return { repo, movements, doses };
  }
  const input = { doseId: "d1", memberId: "m", channel: "whatsapp" as const, sourceMessageId: "wa-1", now: new Date("2026-10-15T09:05:00Z") };

  it("a mesma confirmação enviada duas vezes desconta uma vez", async () => {
    const { repo, movements } = makeRepo();
    const r1 = await confirmDose(repo, input);
    const r2 = await confirmDose(repo, input);
    expect(r1.result).toBe("confirmed");
    expect(r2.result).toBe("duplicate");
    expect(movements).toHaveLength(1);
    expect(movements[0]!.quantity).toBe(-2);
  });
  it("outra mensagem na dose já tomada também é duplicidade", async () => {
    const { repo, movements } = makeRepo();
    await confirmDose(repo, input);
    const r = await confirmDose(repo, { ...input, sourceMessageId: "wa-2" });
    expect(r.result).toBe("duplicate");
    expect(movements).toHaveLength(1);
  });
  it("retomada após falha entre movimento e dose não duplica o desconto", async () => {
    const { repo, movements } = makeRepo();
    await repo.insertDoseMovementIfAbsent({ family_id: "f1", stock_item_id: "s1", type: "dose", quantity: -2, dose_event_id: "d1" });
    const r = await confirmDose(repo, input);
    expect(r.result).toBe("confirmed");
    expect(movements).toHaveLength(1);
  });
  it("registra quem e o canal; dose inexistente e pulada", async () => {
    const { repo, doses } = makeRepo();
    const r = await confirmDose(repo, input);
    expect(r.result === "confirmed" && r.dose.confirmed_by_member_id).toBe("m");
    expect(await confirmDose(repo, { ...input, doseId: "x", sourceMessageId: null })).toEqual({ result: "not_found" });
    doses.set("d2", { ...doses.get("d1")!, id: "d2", status: "skipped", source_message_id: null });
    expect((await confirmDose(repo, { ...input, doseId: "d2", sourceMessageId: null })).result).toBe("not_confirmable");
  });
  it("confirmar → desfazer → confirmar deixa saldo = inicial − 1 dose; desfazer duas vezes devolve uma vez", async () => {
    const { repo, movements, doses } = makeRepo();
    const base = { doseId: "d1", memberId: "m", channel: "panel" as const, now: new Date("2026-10-15T09:05:00Z") };
    const undo = (now = base.now) => undoDoseConfirmation(repo, { doseId: "d1", memberId: "m", now });
    await confirmDose(repo, base);
    expect(balance(movements)).toBe(-2);
    expect(await undo(new Date("2026-10-15T09:05:08Z"))).toMatchObject({ result: "undone", stockRestored: true });
    expect(doses.get("d1")).toMatchObject({ status: "pending", confirmed_by_member_id: null, channel: null });
    expect(balance(movements)).toBe(0);
    expect((await undo()).result).toBe("not_taken");
    expect(balance(movements)).toBe(0);
    await confirmDose(repo, base);
    expect(balance(movements)).toBe(-2);
    await undo();
    await confirmDose(repo, base);
    expect(balance(movements)).toBe(-2);
    expect(movements.filter((m) => m.dose_event_id === "d1")).toHaveLength(1);
  });
  it("desfazer: status volta conforme o atraso; recusa dose não tomada ou inexistente", async () => {
    const { repo } = makeRepo();
    const u = (doseId: string, now: Date) => undoDoseConfirmation(repo, { doseId, memberId: "m", now });
    expect((await u("d1", new Date())).result).toBe("not_taken");
    expect((await u("zz", new Date())).result).toBe("not_found");
    await confirmDose(repo, { doseId: "d1", memberId: "m", channel: "panel", now: new Date("2026-10-15T09:05:00Z") });
    const r = await u("d1", new Date("2026-10-15T09:30:00Z"));
    expect(r.result === "undone" && r.dose.status).toBe("late");
  });
  it("desfazer retomado após falha (compensação feita, dose ainda tomada) não devolve duas vezes", async () => {
    const { repo, movements } = makeRepo();
    await confirmDose(repo, input);
    movements.push({ family_id: "f1", stock_item_id: "s1", type: "adjustment", quantity: 2, note: "undo:d1:0" });
    await undoDoseConfirmation(repo, { doseId: "d1", memberId: "m", now: input.now });
    expect(balance(movements)).toBe(0);
  });
});

describe("markLateAndMissed", () => {
  const settings = { late_after_min: 15, missed_after_min: 120 };
  const at = "2026-10-15T12:00:00.000Z";
  const now = (min: number) => new Date(Date.parse(at) + min * 60000);
  const doses = [{ id: "d", status: "pending" as const, scheduled_at: at }];
  it("pendente → atrasada após 15 min; esquecida após 2 h avisa a família", () => {
    expect(markLateAndMissed(now(10), settings, doses)).toEqual([]);
    expect(markLateAndMissed(now(15), settings, doses)[0]).toMatchObject({ to: "late", notifyFamily: false });
    expect(markLateAndMissed(now(120), settings, doses)[0]).toMatchObject({ to: "missed", notifyFamily: true });
    expect(markLateAndMissed(now(130), settings, [{ ...doses[0]!, status: "late" as const }])[0]).toMatchObject({ from: "late", to: "missed" });
  });
  it("ignora tomadas e atrasadas que continuam atrasadas", () => {
    expect(markLateAndMissed(now(500), settings, [{ id: "x", status: "taken", scheduled_at: at }])).toEqual([]);
    expect(markLateAndMissed(now(60), settings, [{ id: "x", status: "late", scheduled_at: at }])).toEqual([]);
  });
});

describe("estoque", () => {
  it("balance soma movimentos; ajuste vira movimento adjustment", () => {
    const mv = [{ quantity: 30 }, { quantity: -2 }, { quantity: -2 }];
    expect(balance(mv)).toBe(26);
    const adj = applyAdjustment(mv, { familyId: "f1", stockItemId: "s1", newBalance: 20, memberId: "m" });
    expect(adj).toMatchObject({ type: "adjustment", quantity: -6 });
    expect(applyAdjustment(mv, { familyId: "f1", stockItemId: "s1", newBalance: 26, memberId: "m" })).toBeNull();
    expect(() => applyAdjustment(mv, { familyId: "f1", stockItemId: "s1", newBalance: -1, memberId: "m" })).toThrow();
  });
  it("lowStockStatus: ≤7 crítico, 8–14 atenção, >14 ok", () => {
    expect([0, 7].map((d) => lowStockStatus(d))).toEqual(["critical", "critical"]);
    expect([8, 14].map((d) => lowStockStatus(d))).toEqual(["attention", "attention"]);
    expect(lowStockStatus(15)).toBe("ok");
    expect(lowStockStatus(null)).toBe("ok");
    expect(lowStockStatus(10, 3)).toBe("ok");
  });
});

describe("forecastDepletion", () => {
  const from = "2026-10-01";
  it("fase única: 60 unidades, 6 doses/dia → 10 dias", () => {
    const f = forecastDepletion({ balance: 60, is_estimate: false }, treatment, [phase({})], from, TZ);
    expect(f).toMatchObject({ daysLeft: 10, depletionDate: "2026-10-11", confidence: "high" });
  });
  it("atravessa mudança de fase (6/dia nos dias 1–15, 3/dia nos dias 16–20)", () => {
    // 15*6=90 + 3 dias*3=9 → 99 cobre 18 dias; 100 não cobre dia 19 inteiro? 100-90=10 → 3 dias (9), sobra 1 → acaba no dia 19
    const f = forecastDepletion({ balance: 100, is_estimate: false }, treatment, chained, from, TZ);
    expect(f.daysLeft).toBe(18);
    expect(f.depletionDate).toBe("2026-10-19");
  });
  it("cobre até o fim das fases finitas", () => {
    const f = forecastDepletion({ balance: 500, is_estimate: false }, treatment, chained, from, TZ);
    expect(f).toMatchObject({ coversUntilEnd: true, daysLeft: null, depletionDate: null });
  });
  it("fase final 'até acabar' sempre esgota", () => {
    const p = [phase({ end_day: null })];
    expect(forecastDepletion({ balance: 6000, is_estimate: false }, treatment, p, from, TZ).daysLeft).toBe(1000);
  });
  it("calcula a partir de um dia no meio do tratamento", () => {
    const f = forecastDepletion({ balance: 30, is_estimate: false }, treatment, chained, "2026-10-14", TZ);
    // dias 14,15 (6 cada)=12; 16,17,18,19,20 (3 cada)=15 → 27; sobram 3 → cobre tudo? 30≥27 → até o fim
    expect(f.coversUntilEnd).toBe(true);
    const g = forecastDepletion({ balance: 20, is_estimate: false }, treatment, chained, "2026-10-14", TZ);
    // 12 + 3 dias (9) = 21 > 20 → dias 14,15,16,17 (18) cobertos; dia 18 precisa 3, restam 2
    expect(g.daysLeft).toBe(4);
    expect(g.depletionDate).toBe("2026-10-18");
  });
  it("colírio: frasco 5 ml, 20 gotas/ml, 2 gotas por dose, 3 em 3 h → 100 gotas / 16 = 6 dias, confiança baixa", () => {
    const drops = [phase({ dose_amount: 2, first_dose_time: "00:00", end_day: 15 })];
    const f = forecastDepletion({ balance: 5 * 20, is_estimate: true }, treatment, drops, from, TZ);
    expect(f.daysLeft).toBe(6);
    expect(f.confidence).toBe("low");
  });
  it("hoje (Date no meio do dia) conta só as doses que faltam", () => {
    const drops = [phase({ dose_amount: 2, first_dose_time: "06:00" })]; // 6 doses × 2 = 12/dia; faltam 15h,18h,21h = 6
    const s = { balance: 24, is_estimate: true };
    const f = forecastDepletion(s, treatment, drops, new Date("2026-10-15T17:10:00Z"), TZ); // 14:10 local
    expect(f).toMatchObject({ daysLeft: 2, depletionDate: "2026-10-17", confidence: "low" });
    // com saldo 19 acaba no dia 17; com string de data o dia inteiro conta
    expect(forecastDepletion({ ...s, balance: 19 }, treatment, drops, new Date("2026-10-15T17:10:00Z"), TZ).depletionDate).toBe("2026-10-17");
    expect(forecastDepletion({ ...s, balance: 19 }, treatment, drops, "2026-10-15", TZ).depletionDate).toBe("2026-10-16");
    // depois da última dose do dia, hoje já não consome
    const late = forecastDepletion({ ...s, balance: 12 }, treatment, drops, new Date("2026-10-16T01:00:00Z"), TZ); // 22:00 local
    expect(late).toMatchObject({ daysLeft: 2, depletionDate: "2026-10-17" });
  });
  it("ajuste manual muda saldo e previsão", () => {
    const mv = [{ quantity: 60 }];
    const before = forecastDepletion({ balance: balance(mv), is_estimate: false }, treatment, [phase({})], from, TZ);
    const adj = applyAdjustment(mv, { familyId: "f1", stockItemId: "s1", newBalance: 30, memberId: "m" })!;
    const after = forecastDepletion({ balance: balance([...mv, adj]), is_estimate: false }, treatment, [phase({})], from, TZ);
    expect(before.daysLeft).toBe(10);
    expect(after.daysLeft).toBe(5);
  });
  it("respeita end_date do tratamento", () => {
    const f = forecastDepletion({ balance: 60, is_estimate: false }, { ...treatment, end_date: "2026-10-05" }, [phase({})], from, TZ);
    expect(f.coversUntilEnd).toBe(true);
  });
});

describe("resolveResponsible", () => {
  const m = (id: string, family = false, active = true): Member => ({ id, name: id, active, receives_family_alerts: family });
  const members = [m("rosa"), m("lucia"), m("ana", true), m("joao"), m("off", true, false)];
  const asg = [
    { member_id: "rosa", weekdays: [1, 2, 3, 4, 5], start_time: "06:00", end_time: "14:00", priority: 1 },
    { member_id: "lucia", weekdays: [1, 2, 3, 4, 5], start_time: "14:00", end_time: "22:00", priority: 1 },
    { member_id: "joao", weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: "22:00", end_time: "06:00", priority: 1 },
    { member_id: "ana", weekdays: [1], start_time: "06:00", end_time: "14:00", priority: 2 },
  ];
  // quinta 15/10/2026
  const at = (hhmm: string, day = "2026-10-15") => zonedToUtc(day, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);
  it("escolhe pela faixa de horário", () => {
    const r = resolveResponsible({ assignments: asg, members, mode: "assignments_only", datetime: at("09:00") });
    expect(r.recipients.map((x) => x.id)).toEqual(["rosa"]);
    expect(resolveResponsible({ assignments: asg, members, mode: "assignments_only", datetime: at("15:00") }).recipients[0]!.id).toBe("lucia");
  });
  it("faixa noturna cruza a meia-noite", () => {
    expect(resolveResponsible({ assignments: asg, members, mode: "assignments_only", datetime: at("23:30") }).recipients[0]!.id).toBe("joao");
    expect(resolveResponsible({ assignments: asg, members, mode: "assignments_only", datetime: at("03:00") }).recipients[0]!.id).toBe("joao");
  });
  it("prioridade ordena e assignments_plus_family soma a família sem duplicar", () => {
    const seg = at("07:00", "2026-10-12"); // segunda
    const r = resolveResponsible({ assignments: asg, members, mode: "assignments_plus_family", datetime: seg });
    expect(r.responsible.map((x) => x.id)).toEqual(["rosa", "ana"]);
    expect(r.recipients.map((x) => x.id)).toEqual(["rosa", "ana"]);
  });
  it("sem cobertura cai na família (apenas ativos)", () => {
    const r = resolveResponsible({ assignments: [asg[0]!], members, mode: "assignments_only", datetime: at("20:00") });
    expect(r).toMatchObject({ usedFamilyFallback: true, source: "family_fallback" });
    expect(r.recipients.map((x) => x.id)).toEqual(["ana"]);
  });
  it("all_members envia para todos os ativos", () => {
    const r = resolveResponsible({ assignments: asg, members, mode: "all_members", datetime: at("09:00") });
    expect(r.recipients.map((x) => x.id)).toEqual(["rosa", "lucia", "ana", "joao"]);
    expect(r.responsible[0]!.id).toBe("rosa");
  });
});

describe("reposição", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const open = () => openReplenishment({ triggeredBy: "low_stock", requiresPrescription: true, now });
  it("4 etapas na ordem; duas pessoas não assumem a mesma etapa", () => {
    let r = open();
    expect(currentStep(r)!.step).toBe(1);
    const c1 = advanceReplenishment(r, { type: "claim", memberId: "bia", now });
    expect(c1.ok).toBe(true);
    r = (c1 as { ok: true; replenishment: typeof r }).replenishment;
    expect(advanceReplenishment(r, { type: "claim", memberId: "ana", now })).toEqual({ ok: false, reason: "already_claimed" });
    expect(advanceReplenishment(r, { type: "complete", memberId: "ana", now })).toEqual({ ok: false, reason: "not_owner" });
    const take = advanceReplenishment(r, { type: "claim", memberId: "ana", now, takeOver: true });
    expect(take.ok && currentStep(take.replenishment)!.owner_member_id).toBe("ana");
  });
  it("percorre tudo até done, exige quantidade na compra e fecha", () => {
    let r = open();
    const step = (a: Parameters<typeof advanceReplenishment>[1]) => {
      const x = advanceReplenishment(r, a);
      if (!x.ok) throw new Error(x.reason);
      r = x.replenishment;
    };
    step({ type: "complete", memberId: "bia", now }); // 1
    expect(r.status).toBe("needs_prescription");
    step({ type: "complete", memberId: "bia", now, prescriptionId: "rx" }); // 2
    expect(r.status).toBe("prescription_received");
    expect(advanceReplenishment(r, { type: "complete", memberId: "bia", now })).toEqual({ ok: false, reason: "missing_purchase_quantity" });
    step({ type: "complete", memberId: "bia", now, purchaseQuantity: 60 }); // 3
    expect(r.status).toBe("purchased");
    expect(stepState(r, 4)).toBe("current");
    step({ type: "complete", memberId: "lucas", now }); // 4
    expect(r.status).toBe("done");
    expect(r.closed_at).not.toBeNull();
    expect(advanceReplenishment(r, { type: "claim", memberId: "x", now })).toEqual({ ok: false, reason: "closed" });
  });
  it("remédio sem receita pula as etapas 1 e 2", () => {
    const r = openReplenishment({ triggeredBy: "manual", requiresPrescription: false, now });
    expect(stepState(r, 1)).toBe("not_applicable");
    expect(currentStep(r)!.step).toBe(3);
    expect(r.status).toBe("prescription_received");
  });
  it("cancelar encerra", () => {
    const x = advanceReplenishment(open(), { type: "cancel", memberId: "a", now });
    expect(x.ok && x.replenishment.status).toBe("cancelled");
  });
});

describe("receitas", () => {
  const today = "2026-10-15";
  it("ordem das regras: substituída > aguardando > vencida > vigente", () => {
    expect(prescriptionStatus("2026-01-01", "2026-01-31", today, { supersededById: "x", hasPendingRequest: true }).status).toBe("superseded");
    expect(prescriptionStatus("2026-01-01", "2026-12-31", today, { hasPendingRequest: true }).status).toBe("awaiting_new");
    expect(prescriptionStatus("2026-01-01", "2026-10-14", today).status).toBe("expired");
    expect(prescriptionStatus("2026-01-01", "2026-10-15", today).status).toBe("valid");
  });
  it("vence em X dias quando faltam ≤ 15; sem validade = vigente", () => {
    expect(prescriptionStatus("2026-09-25", "2026-10-25", today)).toMatchObject({ status: "valid", expiresInDays: 10, expiringSoon: true });
    expect(prescriptionStatus("2026-09-25", "2026-11-25", today).expiringSoon).toBe(false);
    expect(prescriptionStatus("2026-09-25", null, today)).toMatchObject({ status: "valid", noValidityInformed: true });
  });
  const rx = (id: string, status: "valid" | "expired" | "awaiting_new" | "superseded", meds: string[], issued = "2026-10-01") => ({
    id, patient_id: "p1", status, medication_ids: meds, issued_on: issued,
  });
  it("cobertura e estado por remédio", () => {
    const list = [rx("a", "expired", ["m1"]), rx("b", "valid", ["m2"])];
    expect(isCoverageValid(treatment, list)).toBe(false);
    expect(isCoverageValid(treatment, list, { requiresPrescription: false })).toBe(true);
    expect(isCoverageValid(treatment, [...list, rx("c", "valid", ["m1"])])).toBe(true);
    expect(medicationPrescriptionState("m1", list).state).toBe("expired");
    expect(medicationPrescriptionState("m1", list, false).state).toBe("not_needed");
    expect(medicationPrescriptionState("m1", [rx("d", "awaiting_new", ["m1"]), ...list]).state).toBe("awaiting");
    expect(medicationPrescriptionState("m3", list).state).toBe("none");
    expect(medicationPrescriptionState("m1", [rx("o", "valid", ["m1"], "2026-01-01"), rx("n", "valid", ["m1"], "2026-09-01")]).prescription!.id).toBe("n");
  });
  it("receita nova substitui vencidas/aguardando com remédio em comum", () => {
    const created = { id: "new", patient_id: "p1", medication_ids: ["m1"] };
    const existing = [rx("a", "expired", ["m1"]), rx("b", "awaiting_new", ["m1", "m9"]), rx("c", "valid", ["m1"]), rx("d", "expired", ["m2"])];
    expect(prescriptionsToSupersede(created, existing)).toEqual(["a", "b"]);
  });
});
