/**
 * Seed de demonstração: "Família Souza (demo)" com os dados FICTÍCIOS do design (design.md seção 7),
 * portado de scripts/appwrite/src/seed.ts. Idempotente (IDs UUID determinísticos). Roda com o papel da aplicação
 * dentro de withFamilia, então o próprio seed exercita o RLS. Telefones e e-mails são inventados.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_PROFILES, familySettingsSchema } from "@medcuidar/shared";
import { closeDb } from "./client";
import { withFamilia } from "./withFamilia";
import { uuidDeterministico } from "./ids";
import * as s from "./schema";

const d = (nome: string) => uuidDeterministico(`demo:${nome}`);
export const DEMO_FAMILIA_ID = d("familia-souza");
export const demoId = d;

const today = new Date();
const dayStr = (offset: number) => new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

export async function seedDemo(): Promise<void> {
  const F = DEMO_FAMILIA_ID;
  await withFamilia(F, async (tx) => {
    await tx.insert(s.families).values({
      id: F, name: "Família Souza (demo)", timezone: "America/Sao_Paulo", settings: familySettingsSchema.parse({}),
    }).onConflictDoNothing();

    const profileId = (name: string) => d(`prof-${name.toLowerCase()}`);
    await tx.insert(s.profiles).values(SYSTEM_PROFILES.map((p) => ({
      id: profileId(p.name), familyId: F, name: p.name, permissions: p.permissions as Record<string, boolean>, isSystem: true,
    }))).onConflictDoNothing();

    // pessoas: [chave, nome, perfil, papel, recebe avisos da família, estado de acesso, telefone verificado (fictício) | null]
    // Mostra os três estados: active (login no portal), whatsapp_verified (só WhatsApp) e invited (convidado).
    type Estado = "invited" | "whatsapp_verified" | "active";
    const people: Array<[string, string, string, string, boolean, Estado, string | null]> = [
      ["ana", "Ana", "Administrador", "filha", true, "active", "5511900000001"],
      ["beatriz", "Beatriz", "Familiar", "filha", true, "active", "5511900000002"],
      ["claudia", "Cláudia", "Familiar", "filha", true, "active", "5511900000003"],
      ["denise", "Denise", "Familiar", "filha", true, "invited", null],
      ["lucas", "Lucas", "Familiar", "sobrinho", true, "active", "5511900000005"],
      ["rosa", "Rosa", "Cuidadora", "cuidadora", false, "whatsapp_verified", "5511900000006"],
      ["lucia", "Lúcia", "Cuidadora", "cuidadora", false, "whatsapp_verified", "5511900000007"],
      ["joao", "Seu João", "Confirmador", "sogro", false, "whatsapp_verified", "5511900000008"],
    ];
    await tx.insert(s.members).values(people.map(([key, name, profile, role, alerts, estado, phone]) => ({
      id: d(`m-${key}`), familyId: F, profileId: profileId(profile), name, roleLabel: role,
      email: `${key}@demo.medcuidar.test`, receivesFamilyAlerts: alerts, phoneVerified: phone, active: true,
      accessState: estado,
      // ids do Appwrite FICTÍCIOS, só para o estado active
      appwriteUserId: estado === "active" ? `demo-appwrite-${key}` : null,
      emailConfirmedAt: estado === "active" ? today : null,
    }))).onConflictDoNothing();

    await tx.insert(s.patients).values([
      { id: d("p-adelino"), familyId: F, name: "Adelino Souza", birthDate: "1942-03-10", canUsePhone: true, selfMemberId: d("m-joao") },
      {
        id: d("p-maria"), familyId: F, name: "Maria Souza", birthDate: "1945-07-22", canUsePhone: false,
        notes: "Alzheimer. Não usa celular: quem estiver com ela confirma as doses.",
      },
    ]).onConflictDoNothing();

    // escala: Rosa 6h-14h, Lúcia 14h-22h, Seu João à noite
    const allWeek = [0, 1, 2, 3, 4, 5, 6];
    const shifts: Array<[string, string, string]> = [["rosa", "06:00", "14:00"], ["lucia", "14:00", "22:00"], ["joao", "22:00", "06:00"]];
    await tx.insert(s.careAssignments).values(
      ["adelino", "maria"].flatMap((patient) => shifts.map(([who, start, end]) => ({
        id: d(`ca-${who}-${patient}`), familyId: F, patientId: d(`p-${patient}`), memberId: d(`m-${who}`),
        weekdays: allWeek, startTime: start!, endTime: end!, priority: 1,
      }))),
    ).onConflictDoNothing();

    type Med = typeof s.medications.$inferInsert;
    const meds: Array<[string, Omit<Med, "id" | "familyId">]> = [
      ["zypred", { name: "Zypred", alternativeNames: ["Facoba", "Vigadexa"], route: "drops", controlUnit: "drop", dropsPerMl: 20, packageSize: 100, requiresPrescription: true }],
      ["losartana", { name: "Losartana 50 mg", route: "tablet", controlUnit: "unit", packageSize: 30, requiresPrescription: true }],
      ["donepezila", { name: "Donepezila 10 mg", route: "tablet", controlUnit: "unit", packageSize: 30, requiresPrescription: true }],
      ["omeprazol", { name: "Omeprazol 20 mg", route: "tablet", controlUnit: "unit", packageSize: 28, requiresPrescription: true }],
      ["metamucil", { name: "Metamucil", route: "powder", controlUnit: "gram", packageSize: 300, requiresPrescription: false }],
    ];
    await tx.insert(s.medications).values(meds.map(([key, m]) => ({ ...m, id: d(`med-${key}`), familyId: F }))).onConflictDoNothing();

    type Phase = Omit<typeof s.treatmentPhases.$inferInsert, "id" | "familyId" | "treatmentId" | "order">;
    const treatments: Array<[string, string, string, number, Phase[]]> = [
      ["zypred-adelino", "adelino", "zypred", 6, [
        { startDay: 1, endDay: 15, scheduleType: "interval", intervalHours: 3, firstDoseTime: "06:00", doseAmount: 2 },
        { startDay: 16, endDay: 20, scheduleType: "interval", intervalHours: 6, firstDoseTime: "06:00", doseAmount: 2 },
      ]],
      ["losartana-adelino", "adelino", "losartana", 90, [{ startDay: 1, endDay: null, scheduleType: "fixed_times", times: ["08:00"], doseAmount: 1 }]],
      ["donepezila-maria", "maria", "donepezila", 120, [{ startDay: 1, endDay: null, scheduleType: "fixed_times", times: ["12:00"], doseAmount: 1 }]],
      ["omeprazol-adelino", "adelino", "omeprazol", 60, [{ startDay: 1, endDay: null, scheduleType: "fixed_times", times: ["07:00"], doseAmount: 1 }]],
      ["metamucil-maria", "maria", "metamucil", 30, [{ startDay: 1, endDay: null, scheduleType: "fixed_times", times: ["09:00"], doseAmount: 10 }]],
    ];
    await tx.insert(s.treatments).values(treatments.map(([id, patient, med, ago]) => ({
      id: d(`t-${id}`), familyId: F, patientId: d(`p-${patient}`), medicationId: d(`med-${med}`), startDate: dayStr(-ago), status: "active" as const,
    }))).onConflictDoNothing();
    await tx.insert(s.treatmentPhases).values(treatments.flatMap(([id, , , , phases]) => phases.map((ph, i) => ({
      ...ph, id: d(`ph-${id}-${i + 1}`), familyId: F, treatmentId: d(`t-${id}`), order: i + 1,
    })))).onConflictDoNothing();

    // estoque inicial: o saldo é a SOMA dos movimentos (livro-razão); cached_balance é só cache.
    const stock: Array<[string, string, string, number, boolean]> = [
      ["zypred-adelino", "adelino", "zypred", 96, true],
      ["losartana-adelino", "adelino", "losartana", 24, false],
      ["donepezila-maria", "maria", "donepezila", 11, false],
      ["omeprazol-adelino", "adelino", "omeprazol", 9, false],
      ["metamucil-maria", "maria", "metamucil", 200, false],
    ];
    const unitOf: Record<string, "drop" | "gram" | "unit"> = { zypred: "drop", metamucil: "gram" };
    await tx.insert(s.stockItems).values(stock.map(([id, patient, med, qty, estimate]) => ({
      id: d(`s-${id}`), familyId: F, patientId: d(`p-${patient}`), medicationId: d(`med-${med}`),
      controlUnit: unitOf[med] ?? "unit", isEstimate: estimate, cachedBalance: qty, cachedBalanceAt: today,
    }))).onConflictDoNothing();
    await tx.insert(s.stockMovements).values(stock.map(([id, , , qty]) => ({
      id: d(`sm-${id}-0`), familyId: F, stockItemId: d(`s-${id}`), type: "purchase" as const, quantity: qty,
      createdByMemberId: d("m-ana"), note: "Saldo inicial (seed)",
    }))).onConflictDoNothing();

    // receitas (sem arquivos de foto no seed)
    await tx.insert(s.prescriptions).values([
      {
        id: d("rx-zypred"), familyId: F, patientId: d("p-adelino"), doctorName: "Dra. Helena Prado", specialty: "Oftalmologista",
        issuedOn: dayStr(-20), validUntil: dayStr(10), status: "valid", isControlled: false, uploadedByMemberId: d("m-ana"),
      },
      {
        id: d("rx-donepezila"), familyId: F, patientId: d("p-maria"), doctorName: "Dr. Carlos Nogueira", specialty: "Neurologista",
        issuedOn: dayStr(-85), validUntil: dayStr(5), status: "valid", isControlled: true, copies: 2, uploadedByMemberId: d("m-ana"),
      },
    ]).onConflictDoNothing();
    await tx.insert(s.prescriptionItems).values([
      { id: d("rxi-zypred"), familyId: F, prescriptionId: d("rx-zypred"), medicationId: d("med-zypred") },
      { id: d("rxi-donepezila"), familyId: F, prescriptionId: d("rx-donepezila"), medicationId: d("med-donepezila") },
    ]).onConflictDoNothing();
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await seedDemo();
    console.warn("[seed] família Souza (demo) pronta");
  } finally {
    await closeDb();
  }
}
