/**
 * Seed de demonstração: "Família Souza (demo)" com os dados fictícios do design (design.md seção 7).
 * Idempotente (IDs fixos). Telefones são fictícios. Para apagar: `pnpm seed -- --reset`.
 *
 * Aviso: o projeto Appwrite atual é de produção. Esta família é identificada por `demo-` nos IDs
 * e pode ser removida com --reset antes de entrar dados reais.
 */
import { FamilyScopedDb } from "@medcuidar/db";
import { SYSTEM_PROFILES, familySettingsSchema } from "@medcuidar/shared";
import { COLLECTIONS } from "@medcuidar/shared";
import { Query } from "node-appwrite";
import { createClients, isStatus } from "./client";

const FAMILY_ID = "demo-familia-souza";
const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const daysAhead = (n: number) => daysAgo(-n);

const ctx = createClients();
const { databases, teams, databaseId } = ctx;
const db = new FamilyScopedDb(databases, databaseId, FAMILY_ID);

async function upsert(collection: string, id: string, data: Record<string, unknown>) {
  try {
    await db.create(collection, data, id);
  } catch (err) {
    if (!isStatus(err, 409)) throw err;
  }
}

async function reset() {
  for (const c of [...COLLECTIONS].reverse()) {
    if (c.global) continue;
    for (;;) {
      const page = await db.list(c.id, [Query.limit(100)]);
      if (page.documents.length === 0) break;
      for (const d of page.documents) await databases.deleteDocument(databaseId, c.id, d.$id);
    }
  }
  await databases.deleteDocument(databaseId, "families", FAMILY_ID).catch(() => {});
  await teams.delete(FAMILY_ID).catch(() => {});
  console.error("[seed] família demo removida");
}

async function seed() {
  try {
    await teams.create(FAMILY_ID, "Família Souza (demo)");
  } catch (err) {
    if (!isStatus(err, 409)) throw err;
  }
  try {
    await databases.createDocument(databaseId, "families", FAMILY_ID, {
      name: "Família Souza (demo)",
      timezone: "America/Sao_Paulo",
      settings: JSON.stringify(familySettingsSchema.parse({})),
    });
  } catch (err) {
    if (!isStatus(err, 409)) throw err;
  }

  // perfis iniciais
  const profileId = (name: string) => `demo-prof-${name.toLowerCase()}`;
  for (const p of SYSTEM_PROFILES) {
    await upsert("profiles", profileId(p.name), {
      name: p.name,
      permissions: JSON.stringify(p.permissions),
      is_system: true,
    });
  }

  // pessoas (telefones fictícios)
  const people: Array<[string, string, string, string, boolean]> = [
    ["ana", "Ana", "Administrador", "filha", true],
    ["beatriz", "Beatriz", "Familiar", "filha", true],
    ["claudia", "Cláudia", "Familiar", "filha", true],
    ["denise", "Denise", "Familiar", "filha", true],
    ["lucas", "Lucas", "Familiar", "sobrinho", true],
    ["rosa", "Rosa", "Cuidadora", "cuidadora", false],
    ["lucia", "Lúcia", "Cuidadora", "cuidadora", false],
    ["joao", "Seu João", "Confirmador", "sogro", false],
  ];
  let n = 1;
  for (const [key, name, profile, role, alerts] of people) {
    await upsert("members", `demo-m-${key}`, {
      name,
      phone_e164: `+5511900000${String(n++).padStart(3, "0")}`,
      profile_id: profileId(profile),
      active: true,
      receives_family_alerts: alerts,
      whatsapp_status: "unverified",
      role_label: role,
    });
  }

  // pacientes
  await upsert("patients", "demo-p-adelino", {
    name: "Adelino Souza", birth_date: "1942-03-10T00:00:00.000Z", can_use_phone: true,
    self_member_id: "demo-m-joao", active: true,
  });
  await upsert("patients", "demo-p-maria", {
    name: "Maria Souza", birth_date: "1945-07-22T00:00:00.000Z", can_use_phone: false,
    notes: "Alzheimer. Não usa celular: quem estiver com ela confirma as doses.", active: true,
  });

  // escala: Rosa 6h-14h, Lúcia 14h-22h, Seu João à noite
  const allWeek = [0, 1, 2, 3, 4, 5, 6];
  for (const patient of ["adelino", "maria"]) {
    await upsert("care_assignments", `demo-ca-rosa-${patient}`, {
      patient_id: `demo-p-${patient}`, member_id: "demo-m-rosa", weekdays: allWeek, start_time: "06:00", end_time: "14:00", priority: 1,
    });
    await upsert("care_assignments", `demo-ca-lucia-${patient}`, {
      patient_id: `demo-p-${patient}`, member_id: "demo-m-lucia", weekdays: allWeek, start_time: "14:00", end_time: "22:00", priority: 1,
    });
    await upsert("care_assignments", `demo-ca-joao-${patient}`, {
      patient_id: `demo-p-${patient}`, member_id: "demo-m-joao", weekdays: allWeek, start_time: "22:00", end_time: "06:00", priority: 1,
    });
  }

  // remédios
  const meds: Array<[string, Record<string, unknown>]> = [
    ["zypred", { name: "Zypred", alternative_names: ["Facoba", "Vigadexa"], route: "drops", control_unit: "drop", drops_per_ml: 20, package_size: 100, requires_prescription: true }],
    ["losartana", { name: "Losartana 50 mg", alternative_names: [], route: "tablet", control_unit: "unit", package_size: 30, requires_prescription: true }],
    ["donepezila", { name: "Donepezila 10 mg", alternative_names: [], route: "tablet", control_unit: "unit", package_size: 30, requires_prescription: true }],
    ["omeprazol", { name: "Omeprazol 20 mg", alternative_names: [], route: "tablet", control_unit: "unit", package_size: 28, requires_prescription: true }],
    ["metamucil", { name: "Metamucil", alternative_names: [], route: "powder", control_unit: "gram", package_size: 300, requires_prescription: false }],
  ];
  for (const [key, m] of meds) await upsert("medications", `demo-med-${key}`, m);

  // tratamentos e fases
  type Phase = Record<string, unknown>;
  const treatments: Array<[string, string, string, number, Phase[]]> = [
    // [id, paciente, remédio, dias desde o início, fases]
    ["zypred-adelino", "adelino", "zypred", 6, [
      { start_day: 1, end_day: 15, schedule_type: "interval", interval_hours: 3, first_dose_time: "06:00", dose_amount: 2 },
      { start_day: 16, end_day: 20, schedule_type: "interval", interval_hours: 6, first_dose_time: "06:00", dose_amount: 2 },
    ]],
    ["losartana-adelino", "adelino", "losartana", 90, [
      { start_day: 1, end_day: null, schedule_type: "fixed_times", times: ["08:00"], dose_amount: 1 },
    ]],
    ["donepezila-maria", "maria", "donepezila", 120, [
      { start_day: 1, end_day: null, schedule_type: "fixed_times", times: ["12:00"], dose_amount: 1 },
    ]],
    ["omeprazol-adelino", "adelino", "omeprazol", 60, [
      { start_day: 1, end_day: null, schedule_type: "fixed_times", times: ["07:00"], dose_amount: 1 },
    ]],
    ["metamucil-maria", "maria", "metamucil", 30, [
      { start_day: 1, end_day: null, schedule_type: "fixed_times", times: ["09:00"], dose_amount: 10 },
    ]],
  ];
  for (const [id, patient, med, ago, phases] of treatments) {
    await upsert("treatments", `demo-t-${id}`, {
      patient_id: `demo-p-${patient}`, medication_id: `demo-med-${med}`, start_date: daysAgo(ago), status: "active",
    });
    let order = 1;
    for (const ph of phases) {
      await upsert("treatment_phases", `demo-ph-${id}-${order}`, { treatment_id: `demo-t-${id}`, order, ...ph });
      order++;
    }
  }

  // estoque inicial (compra) — Zypred acaba em ~6 dias de 3 em 3 h: 8 doses/dia * 2 gotas = 16 gotas/dia
  const stock: Array<[string, string, string, number, boolean]> = [
    ["zypred-adelino", "adelino", "zypred", 96, true],
    ["losartana-adelino", "adelino", "losartana", 24, false],
    ["donepezila-maria", "maria", "donepezila", 11, false],
    ["omeprazol-adelino", "adelino", "omeprazol", 9, false],
    ["metamucil-maria", "maria", "metamucil", 200, false],
  ];
  const unitOf: Record<string, string> = { zypred: "drop", metamucil: "gram" };
  for (const [id, patient, med, qty, estimate] of stock) {
    await upsert("stock_items", `demo-s-${id}`, {
      patient_id: `demo-p-${patient}`, medication_id: `demo-med-${med}`, control_unit: unitOf[med] ?? "unit",
      is_estimate: estimate, cached_balance: qty, cached_balance_at: NOW.toISOString(),
    });
    await upsert("stock_movements", `demo-sm-${id}-0`, {
      stock_item_id: `demo-s-${id}`, type: "purchase", quantity: qty, created_by_member_id: "demo-m-ana", note: "Saldo inicial (seed)",
    });
  }

  // receitas (sem arquivos de foto no seed)
  await upsert("prescriptions", "demo-rx-zypred", {
    patient_id: "demo-p-adelino", doctor_name: "Dra. Helena Prado", specialty: "Oftalmologista",
    issued_on: daysAgo(20), valid_until: daysAhead(10), status: "valid", is_controlled: false, uploaded_by_member_id: "demo-m-ana",
  });
  await upsert("prescription_items", "demo-rxi-zypred", { prescription_id: "demo-rx-zypred", medication_id: "demo-med-zypred" });
  await upsert("prescriptions", "demo-rx-donepezila", {
    patient_id: "demo-p-maria", doctor_name: "Dr. Carlos Nogueira", specialty: "Neurologista",
    issued_on: daysAgo(85), valid_until: daysAhead(5), status: "valid", is_controlled: true, copies: 2, uploaded_by_member_id: "demo-m-ana",
  });
  await upsert("prescription_items", "demo-rxi-donepezila", { prescription_id: "demo-rx-donepezila", medication_id: "demo-med-donepezila" });

  console.error("[seed] família Souza (demo) pronta");
}

(process.argv.includes("--reset") ? reset() : seed()).catch((err) => {
  console.error(err);
  process.exit(1);
});
