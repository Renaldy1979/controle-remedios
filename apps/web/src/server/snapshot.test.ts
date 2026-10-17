import { SYSTEM_PROFILES, familySettingsSchema } from "@medcuidar/shared";
import type { Ctx } from "./context";
import type { R } from "./data";
import { mapSnapshot, type Loaded } from "./snapshot";

const FAM = "fam-t";
// 16/10/2026 12:10 em São Paulo (UTC-3)
const NOW = new Date("2026-10-16T15:10:00.000Z");
const row = (id: string, data: Record<string, unknown>): R => ({ $id: id, $createdAt: "2026-10-01T12:00:00.000Z", $updatedAt: "2026-10-01T12:00:00.000Z", family_id: FAM, ...data });
const brt = (hhmm: string) => new Date(`2026-10-16T${hhmm}:00.000-03:00`).toISOString();

function loaded(): Loaded {
  const profiles = SYSTEM_PROFILES.map((p) => row(`prof-${p.name}`, { name: p.name, permissions: JSON.stringify(p.permissions), is_system: true }));
  const members = [
    row("m-ana", { name: "Ana", phone_e164: "+5511900000001", profile_id: "prof-Administrador", active: true, receives_family_alerts: true, whatsapp_status: "verified", role_label: "filha" }),
    row("m-joao", { name: "Seu João", phone_e164: "+5511900000008", profile_id: "prof-Confirmador", active: true, receives_family_alerts: false, whatsapp_status: "verified", role_label: "sogro" }),
  ];
  const med = (id: string, name: string, extra: Record<string, unknown> = {}) => row(id, { name, alternative_names: [], route: "tablet", control_unit: "unit", requires_prescription: true, ...extra });
  const treat = (id: string, med: string) => row(id, { patient_id: "p-ad", medication_id: med, start_date: "2026-01-01T12:00:00.000Z", status: "active" });
  const phase = (id: string, t: string) => row(id, { treatment_id: t, order: 1, start_day: 1, end_day: null, schedule_type: "fixed_times", times: ["08:00"], dose_amount: 1 });
  const stock = (id: string, med: string) => row(id, { patient_id: "p-ad", medication_id: med, control_unit: "unit", is_estimate: false, cached_balance: 0 });
  const buy = (id: string, item: string, q: number) => row(id, { stock_item_id: item, type: "purchase", quantity: q, created_by_member_id: "m-ana", note: "Saldo inicial" });
  const dose = (id: string, t: string, med: string, at: string, status = "pending") => row(id, { treatment_id: t, patient_id: "p-ad", medication_id: med, scheduled_at: at, status, amount: 1 });
  return {
    members,
    profiles,
    patients: [row("p-ad", { name: "Adelino Souza", birth_date: "1942-03-10T00:00:00.000Z", can_use_phone: true, active: true })],
    medications: [med("med-ok", "Losartana"), med("med-warn", "Omeprazol"), med("med-crit", "Donepezila"), med("med-otc", "Metamucil", { requires_prescription: false })],
    treatments: [treat("t-ok", "med-ok"), treat("t-warn", "med-warn"), treat("t-crit", "med-crit"), treat("t-otc", "med-otc")],
    phases: [phase("ph1", "t-ok"), phase("ph2", "t-warn"), phase("ph3", "t-crit"), phase("ph4", "t-otc")],
    stockItems: [stock("s-ok", "med-ok"), stock("s-warn", "med-warn"), stock("s-crit", "med-crit"), stock("s-otc", "med-otc")],
    movements: [buy("b1", "s-ok", 30), buy("b2", "s-warn", 10), buy("b3", "s-crit", 5), buy("b4", "s-otc", 40)],
    doses: [
      dose("d-missed", "t-ok", "med-ok", brt("08:00")),
      dose("d-late", "t-warn", "med-warn", brt("11:00")),
      dose("d-pending", "t-crit", "med-crit", brt("15:00")),
      dose("d-taken", "t-otc", "med-otc", brt("07:00"), "taken"),
    ],
    prescriptions: [
      row("rx-soon", { patient_id: "p-ad", doctor_name: "Dra. Helena", issued_on: "2026-09-26T12:00:00.000Z", valid_until: "2026-10-26T12:00:00.000Z", status: "valid", is_controlled: false, uploaded_by_member_id: "m-ana" }),
      row("rx-old", { patient_id: "p-ad", doctor_name: "Dr. Antigo", issued_on: "2026-01-01T12:00:00.000Z", valid_until: "2026-04-01T12:00:00.000Z", status: "valid", is_controlled: true, copies: 2, uploaded_by_member_id: "m-ana" }),
    ],
    rxItems: [row("i1", { prescription_id: "rx-soon", medication_id: "med-ok" }), row("i2", { prescription_id: "rx-old", medication_id: "med-warn" })],
    rxFiles: [],
    rxViews: [row("v1", { prescription_id: "rx-soon", member_id: "m-ana", viewed_at: "2026-10-15T12:00:00.000Z" })],
    rxShares: [],
    repls: [],
    replSteps: [],
    assignments: [],
    audit: [],
  };
}

const ctxFor = (memberId: "m-ana" | "m-joao"): Ctx => {
  const m = loaded().members.find((x) => x.$id === memberId)!;
  const p = SYSTEM_PROFILES.find((x) => `prof-${x.name}` === String(m["profile_id"]))!;
  return { familyId: FAM, db: {} as Ctx["db"], member: { id: memberId, name: String(m["name"]), profileName: p.name, permissions: p.permissions }, timezone: "America/Sao_Paulo", settings: familySettingsSchema.parse({}) };
};

describe("mapSnapshot (administrador)", () => {
  const snap = mapSnapshot(ctxFor("m-ana"), loaded(), NOW);
  const med = (name: string) => snap.medications.find((m) => m.name === name)!;

  it("estoque vem do livro-razão e o nível segue 7/14 dias", () => {
    // 12:10: a dose das 08:00 já passou, então a previsão (domínio) conta hoje sem dose e cobre 1 dia a mais que o saldo
    expect(med("Losartana").stock).toMatchObject({ quantity: 30, daysLeft: 31, level: "ok" });
    expect(med("Omeprazol").stock).toMatchObject({ quantity: 10, daysLeft: 11, level: "warning" });
    expect(med("Donepezila").stock).toMatchObject({ quantity: 5, daysLeft: 6, level: "critical" });
  });

  it("doses de hoje: esquecida, atrasada, pendente e tomada, no fuso de São Paulo", () => {
    const by = (id: string) => snap.doses.find((d) => d.id === id)!;
    expect(by("d-missed")).toMatchObject({ status: "missed", time: "08:00" });
    expect(by("d-late")).toMatchObject({ status: "late", whenLabel: "Atrasada há 1 h 10" });
    expect(by("d-pending")).toMatchObject({ status: "pending", whenLabel: "em 2 h 50" });
    expect(by("d-taken").status).toBe("taken");
    expect(snap.alertCount).toBe(2);
    expect(snap.doses.map((d) => d.time)).toEqual(["07:00", "08:00", "11:00", "15:00"]);
  });

  it("situação da receita: vence em breve, vencida e sem receita; remédio sem receita não exige", () => {
    expect(med("Losartana").rx).toMatchObject({ kind: "soon", rxId: "rx-soon", alert: false });
    expect(med("Omeprazol").rx).toMatchObject({ kind: "expired", alert: true });
    expect(med("Donepezila").rx).toMatchObject({ kind: "none", alert: true });
    expect(med("Metamucil").rx).toMatchObject({ kind: "otc", alert: false });
    const soon = snap.prescriptions.find((r) => r.id === "rx-soon")!;
    expect(soon.status).toMatchObject({ kind: "valid", soon: true, daysLeft: 10, validityText: "Vence em 10 dias · 26/10/2026" });
    expect(soon.latestValid).toBe(true);
    expect(snap.prescriptions.find((r) => r.id === "rx-old")).toMatchObject({ controlledCopies: 2, status: { kind: "expired" } });
  });

  it("quem viu e quem ainda não viu; quem não tem permissão aparece à parte", () => {
    const soon = snap.prescriptions.find((r) => r.id === "rx-soon")!;
    expect(soon.views.map((v) => v.who)).toEqual(["Ana"]);
    expect(soon.notViewed).toEqual([]);
    expect(soon.cannotView).toEqual(["Seu João"]);
  });

  it("o administrador enxerga pessoas, matriz de permissões e avisos", () => {
    expect(snap.people.find((p) => p.name === "Ana")?.phone).toBe("(11) 90000-0001");
    expect(snap.permissionRows).toHaveLength(11);
    expect(snap.profiles).toEqual(["Administrador", "Familiar", "Cuidadora", "Confirmador"]);
    expect(snap.notifications.leadDays).toBe(7);
  });
});

describe("mapSnapshot (confirmador): o servidor não manda o que o perfil não pode ver", () => {
  const snap = mapSnapshot(ctxFor("m-joao"), loaded(), NOW);

  it("sem receitas, sem histórico e sem estoque", () => {
    expect(snap.prescriptions).toEqual([]);
    expect(snap.history).toEqual([]);
    expect(snap.stockMovements).toEqual([]);
    expect(snap.medications.every((m) => m.stock.quantity === 0 && m.stock.quantityText === "")).toBe(true);
    expect(snap.medications.every((m) => m.rx.rxId === undefined)).toBe(true);
  });

  it("sem telefones, sem matriz de permissões e sem configurações de avisos", () => {
    expect(snap.people.every((p) => p.phone === "")).toBe(true);
    expect(snap.permissionRows).toEqual([]);
    expect(snap.notifications.exceptions).toEqual([]);
    expect(snap.notifications.receivers).toEqual({});
  });

  it("ainda vê e pode confirmar as doses", () => {
    expect(snap.doses.length).toBe(4);
    expect(snap.member.permissions["doses.confirm"]).toBe(true);
  });
});
