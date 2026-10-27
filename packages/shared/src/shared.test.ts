import { describe, expect, it } from "vitest";
import {
  ACTION_PERMISSIONS,
  ADMIN_PROFILE_NAME,
  READ_ONLY_PROFILE_NAME,
  COLLECTIONS,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  SYSTEM_PROFILES,
  can,
  familySettingsSchema,
  inputSchemas,
} from "./index";

describe("collections", () => {
  it("tem ids únicos", () => {
    const ids = COLLECTIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("toda coleção de família tem family_id obrigatório e indexado", () => {
    for (const c of COLLECTIONS.filter((x) => !x.global)) {
      const fam = c.attributes.find((a) => a.key === "family_id");
      expect(fam?.required, c.id).toBe(true);
      const indexed = c.indexes.some((i) => i.attributes[0] === "family_id");
      expect(indexed, `${c.id} sem índice por family_id`).toBe(true);
    }
  });

  it("índices só referenciam atributos existentes", () => {
    for (const c of COLLECTIONS) {
      const keys = new Set(c.attributes.map((a) => a.key));
      for (const i of c.indexes) {
        for (const a of i.attributes) expect(keys.has(a), `${c.id}.${i.key} -> ${a}`).toBe(true);
      }
    }
  });

  it("atributos obrigatórios não têm default e enums têm elementos", () => {
    for (const c of COLLECTIONS) {
      for (const a of c.attributes) {
        if (a.type === "enum") expect(a.elements?.length, `${c.id}.${a.key}`).toBeGreaterThan(0);
        if (a.required) expect(a.default, `${c.id}.${a.key}`).toBeUndefined();
      }
    }
  });
});

describe("permissões", () => {
  it("grupos da matriz só usam chaves válidas e cobrem todas as chaves", () => {
    const used = new Set(PERMISSION_GROUPS.flatMap((g) => g.keys));
    for (const k of used) expect(PERMISSION_KEYS).toContain(k);
    for (const k of PERMISSION_KEYS) expect(used.has(k), k).toBe(true);
  });

  it("administrador sempre pode, mesmo com mapa vazio", () => {
    expect(can({ profileName: ADMIN_PROFILE_NAME, permissions: {} }, "prescriptions.delete")).toBe(true);
  });

  it("confirmador não vê receitas por padrão; familiar e cuidadora veem", () => {
    const by = (n: string) => SYSTEM_PROFILES.find((p) => p.name === n)!;
    expect(can({ profileName: "Confirmador", permissions: by("Confirmador").permissions }, "prescriptions.view")).toBe(false);
    expect(can({ profileName: "Familiar", permissions: by("Familiar").permissions }, "prescriptions.view")).toBe(true);
    expect(can({ profileName: "Cuidadora", permissions: by("Cuidadora").permissions }, "prescriptions.view")).toBe(true);
  });
});

describe("perfil Somente leitura", () => {
  const prof = SYSTEM_PROFILES.find((p) => p.name === READ_ONLY_PROFILE_NAME)!;

  it("é o último perfil de sistema e tem exatamente as 5 permissões de leitura", () => {
    expect(SYSTEM_PROFILES[SYSTEM_PROFILES.length - 1]!.name).toBe(READ_ONLY_PROFILE_NAME);
    expect(Object.keys(prof.permissions).sort()).toEqual(["dashboard.view", "doses.history.view", "patients.view", "stock.view", "whatsapp.query"]);
  });

  it("nenhuma permissão de ação vem ligada e `can` recusa mesmo com o mapa adulterado", () => {
    const forjado = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true]));
    for (const k of ACTION_PERMISSIONS) {
      expect(prof.permissions[k], k).toBeUndefined();
      expect(can({ profileName: READ_ONLY_PROFILE_NAME, permissions: forjado }, k), k).toBe(false);
    }
    // leitura de receita pode ser liberada pelo administrador
    expect(can({ profileName: READ_ONLY_PROFILE_NAME, permissions: { "prescriptions.view": true } }, "prescriptions.view")).toBe(true);
    expect(can({ profileName: READ_ONLY_PROFILE_NAME, permissions: prof.permissions }, "prescriptions.view")).toBe(false);
  });

  it("cada permissão está em exatamente uma lista: de ação ou de leitura", () => {
    const leitura = PERMISSION_KEYS.filter((k) => !ACTION_PERMISSIONS.includes(k));
    expect(leitura.sort()).toEqual(["dashboard.view", "doses.history.view", "patients.view", "prescriptions.view", "stock.view", "whatsapp.query"]);
  });
});

describe("schemas", () => {
  it("configurações da família têm padrões do design", () => {
    const s = familySettingsSchema.parse({});
    expect(s.late_after_min).toBe(15);
    expect(s.missed_after_min).toBe(120);
    expect(s.daily_summary_time).toBe("20:00");
    expect(s.reminder_recipients_mode).toBe("all_members");
  });

  it("valida uma dose e recusa status inválido", () => {
    const ok = {
      family_id: "f1", treatment_id: "t1", patient_id: "p1", medication_id: "m1",
      scheduled_at: "2026-10-15T17:00:00.000Z", status: "pending", amount: 1,
    };
    expect(inputSchemas["dose_events"]!.safeParse(ok).success).toBe(true);
    expect(inputSchemas["dose_events"]!.safeParse({ ...ok, status: "done" }).success).toBe(false);
  });
});
