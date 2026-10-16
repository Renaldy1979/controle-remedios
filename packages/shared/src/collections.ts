/**
 * Descrição das coleções do Appwrite. Fonte única usada por `scripts/appwrite`.
 * Mantém paridade com docs/02-banco-de-dados.md e com os schemas zod (há teste de paridade).
 */

export type AttrType = "string" | "integer" | "float" | "boolean" | "datetime" | "enum";

export interface AttrSpec {
  key: string;
  type: AttrType;
  required: boolean;
  array?: boolean;
  size?: number; // string
  elements?: readonly string[]; // enum
  default?: string | number | boolean | null;
}

export interface IndexSpec {
  key: string;
  type: "key" | "unique" | "fulltext";
  attributes: readonly string[];
}

export interface CollectionSpec {
  id: string;
  name: string;
  /** Coleções sem family_id (apenas `families` e `login_codes`). */
  global?: boolean;
  attributes: readonly AttrSpec[];
  indexes: readonly IndexSpec[];
}

const str = (key: string, required = false, size = 255): AttrSpec => ({ key, type: "string", required, size });
const strArr = (key: string, size = 64): AttrSpec => ({ key, type: "string", required: false, array: true, size });
const json = (key: string, required = false): AttrSpec => ({ key, type: "string", required, size: 16384 });
const int = (key: string, required = false): AttrSpec => ({ key, type: "integer", required });
const intArr = (key: string): AttrSpec => ({ key, type: "integer", required: false, array: true });
const flt = (key: string, required = false): AttrSpec => ({ key, type: "float", required });
const bool = (key: string, required = false): AttrSpec => ({ key, type: "boolean", required });
const dt = (key: string, required = false): AttrSpec => ({ key, type: "datetime", required });
const en = (key: string, elements: readonly string[], required = true): AttrSpec => ({
  key,
  type: "enum",
  required,
  elements,
});

const fam = str("family_id", true, 64);
const deleted = dt("deleted_at");

const idx = (key: string, attributes: readonly string[], type: IndexSpec["type"] = "key"): IndexSpec => ({
  key,
  type,
  attributes,
});

export const COLLECTIONS: readonly CollectionSpec[] = [
  {
    id: "families",
    name: "Famílias",
    global: true,
    attributes: [str("name", true), str("timezone", true, 64), json("settings", true), dt("deleted_at")],
    indexes: [],
  },
  {
    id: "login_codes",
    name: "Códigos de login",
    global: true,
    attributes: [
      str("phone_e164", true, 20),
      str("code_hash", true, 128),
      dt("expires_at", true),
      int("attempts", true),
      dt("consumed_at"),
    ],
    indexes: [idx("by_phone", ["phone_e164"]), idx("by_expiry", ["expires_at"])],
  },
  {
    id: "profiles",
    name: "Perfis",
    attributes: [fam, str("name", true, 80), json("permissions", true), bool("is_system", true)],
    indexes: [idx("by_family", ["family_id"]), idx("family_name", ["family_id", "name"], "unique")],
  },
  {
    id: "members",
    name: "Membros",
    attributes: [
      fam,
      str("user_id", false, 64),
      str("name", true, 120),
      str("phone_e164", true, 20),
      str("profile_id", true, 64),
      bool("active", true),
      bool("receives_family_alerts", true),
      en("whatsapp_status", ["unverified", "verified", "failed"]),
      str("role_label", false, 80),
    ],
    indexes: [
      idx("by_family", ["family_id"]),
      idx("family_phone", ["family_id", "phone_e164"], "unique"),
      idx("by_phone", ["phone_e164"]),
      idx("by_user", ["user_id"]),
    ],
  },
  {
    id: "patients",
    name: "Pacientes",
    attributes: [
      fam,
      str("name", true, 120),
      dt("birth_date"),
      str("notes", false, 2000),
      bool("can_use_phone", true),
      str("self_member_id", false, 64),
      en("reminder_recipients_mode", ["all_members", "assignments_only", "assignments_plus_family"], false),
      bool("active", true),
      deleted,
    ],
    indexes: [idx("by_family", ["family_id"])],
  },
  {
    id: "care_assignments",
    name: "Escala de responsáveis",
    attributes: [
      fam,
      str("patient_id", true, 64),
      str("member_id", true, 64),
      intArr("weekdays"),
      str("start_time", true, 5),
      str("end_time", true, 5),
      int("priority", true),
    ],
    indexes: [idx("by_family", ["family_id"]), idx("by_patient", ["family_id", "patient_id"])],
  },
  {
    id: "medications",
    name: "Remédios",
    attributes: [
      fam,
      str("name", true, 120),
      strArr("alternative_names", 120),
      en("route", ["drops", "tablet", "powder", "liquid", "ointment", "other"]),
      en("control_unit", ["unit", "ml", "drop", "gram"]),
      flt("drops_per_ml"),
      flt("package_size"),
      bool("requires_prescription", true),
      str("notes", false, 2000),
      deleted,
    ],
    indexes: [idx("by_family", ["family_id"])],
  },
  {
    id: "treatments",
    name: "Tratamentos",
    attributes: [
      fam,
      str("patient_id", true, 64),
      str("medication_id", true, 64),
      dt("start_date", true),
      dt("end_date"),
      en("status", ["active", "paused", "finished"]),
      int("low_stock_days"),
      str("notes", false, 2000),
      deleted,
    ],
    indexes: [
      idx("by_family", ["family_id"]),
      idx("by_patient", ["family_id", "patient_id"]),
      idx("by_status", ["family_id", "status"]),
    ],
  },
  {
    id: "treatment_phases",
    name: "Fases do tratamento",
    attributes: [
      fam,
      str("treatment_id", true, 64),
      int("order", true),
      int("start_day", true),
      int("end_day"),
      en("schedule_type", ["interval", "fixed_times"]),
      flt("interval_hours"),
      str("first_dose_time", false, 5),
      strArr("times", 5),
      flt("dose_amount", true),
    ],
    indexes: [idx("by_treatment", ["family_id", "treatment_id"]), idx("treatment_order", ["treatment_id", "order"], "unique")],
  },
  {
    id: "dose_events",
    name: "Doses",
    attributes: [
      fam,
      str("treatment_id", true, 64),
      str("patient_id", true, 64),
      str("medication_id", true, 64),
      dt("scheduled_at", true),
      en("status", ["pending", "taken", "late", "missed", "skipped"]),
      str("confirmed_by_member_id", false, 64),
      dt("confirmed_at"),
      en("channel", ["whatsapp", "panel", "system"], false),
      str("source_message_id", false, 128),
      str("skipped_reason", false, 500),
      flt("amount", true),
      str("phase_id", false, 64),
    ],
    indexes: [
      idx("treatment_time", ["treatment_id", "scheduled_at"], "unique"),
      idx("source_message", ["source_message_id"], "unique"),
      idx("by_family_time", ["family_id", "scheduled_at"]),
      idx("by_patient_time", ["family_id", "patient_id", "scheduled_at"]),
      idx("by_status", ["family_id", "status"]),
    ],
  },
  {
    id: "stock_items",
    name: "Itens de estoque",
    attributes: [
      fam,
      str("patient_id", true, 64),
      str("medication_id", true, 64),
      en("control_unit", ["unit", "ml", "drop", "gram"]),
      bool("is_estimate", true),
      flt("cached_balance", true),
      dt("cached_balance_at"),
    ],
    indexes: [idx("by_family", ["family_id"]), idx("patient_med", ["family_id", "patient_id", "medication_id"], "unique")],
  },
  {
    id: "stock_movements",
    name: "Movimentos de estoque",
    attributes: [
      fam,
      str("stock_item_id", true, 64),
      en("type", ["purchase", "dose", "adjustment", "loss"]),
      flt("quantity", true),
      str("dose_event_id", false, 64),
      str("replenishment_id", false, 64),
      str("created_by_member_id", false, 64),
      str("note", false, 500),
    ],
    indexes: [
      idx("by_item", ["family_id", "stock_item_id"]),
      idx("dose_event", ["dose_event_id"], "unique"),
    ],
  },
  {
    id: "prescriptions",
    name: "Receitas",
    attributes: [
      fam,
      str("patient_id", true, 64),
      str("doctor_name", false, 120),
      str("specialty", false, 80),
      dt("issued_on", true),
      dt("valid_until"),
      en("status", ["valid", "expired", "awaiting_new", "superseded"]),
      str("superseded_by_id", false, 64),
      bool("is_controlled", true),
      int("copies"),
      str("notes", false, 2000),
      str("uploaded_by_member_id", true, 64),
      deleted,
    ],
    indexes: [
      idx("by_family", ["family_id"]),
      idx("by_patient", ["family_id", "patient_id"]),
      idx("by_status", ["family_id", "status"]),
    ],
  },
  {
    id: "prescription_files",
    name: "Arquivos de receita",
    attributes: [
      fam,
      str("prescription_id", true, 64),
      str("storage_file_id", true, 64),
      int("page", true),
      str("mime", true, 80),
      int("size", true),
    ],
    indexes: [idx("by_prescription", ["family_id", "prescription_id"])],
  },
  {
    id: "prescription_items",
    name: "Remédios da receita",
    attributes: [fam, str("prescription_id", true, 64), str("medication_id", true, 64)],
    indexes: [
      idx("by_prescription", ["family_id", "prescription_id"]),
      idx("by_medication", ["family_id", "medication_id"]),
      idx("presc_med", ["prescription_id", "medication_id"], "unique"),
    ],
  },
  {
    id: "prescription_shares",
    name: "Compartilhamentos de receita",
    attributes: [
      fam,
      str("prescription_id", true, 64),
      str("shared_by_member_id", true, 64),
      en("channel", ["internal", "whatsapp"]),
      str("target_member_id", false, 64),
      str("target_phone", false, 20),
      dt("shared_at", true),
    ],
    indexes: [idx("by_prescription", ["family_id", "prescription_id"])],
  },
  {
    id: "prescription_views",
    name: "Visualizações de receita",
    attributes: [fam, str("prescription_id", true, 64), str("member_id", true, 64), dt("viewed_at", true)],
    indexes: [idx("by_prescription", ["family_id", "prescription_id"])],
  },
  {
    id: "replenishments",
    name: "Reposições",
    attributes: [
      fam,
      str("patient_id", true, 64),
      str("medication_id", true, 64),
      en("status", ["needs_prescription", "prescription_received", "purchased", "done", "cancelled"]),
      en("triggered_by", ["low_stock", "prescription_expiry", "manual"]),
      dt("opened_at", true),
      dt("closed_at"),
    ],
    indexes: [idx("by_family_status", ["family_id", "status"]), idx("by_patient_med", ["family_id", "patient_id", "medication_id"])],
  },
  {
    id: "replenishment_steps",
    name: "Etapas de reposição",
    attributes: [
      fam,
      str("replenishment_id", true, 64),
      int("step", true),
      str("owner_member_id", false, 64),
      dt("done_at"),
      str("note", false, 500),
      str("prescription_id", false, 64),
      flt("purchase_quantity"),
    ],
    indexes: [idx("by_replenishment", ["family_id", "replenishment_id"]), idx("repl_step", ["replenishment_id", "step"], "unique")],
  },
  {
    id: "notifications_outbox",
    name: "Fila de notificações",
    attributes: [
      fam,
      en("kind", [
        "dose_reminder", "dose_upcoming_family", "dose_missed", "low_stock", "prescription_expiring",
        "replenishment_update", "daily_summary", "login_code", "reply",
      ]),
      str("target_member_id", false, 64),
      str("target_group_id", false, 128),
      json("payload", true),
      en("status", ["queued", "sending", "sent", "failed", "dead"]),
      int("attempts", true),
      dt("next_attempt_at"),
      str("last_error", false, 500),
      str("dedupe_key", true, 200),
    ],
    indexes: [
      idx("by_family", ["family_id"]),
      idx("dedupe", ["dedupe_key"], "unique"),
      idx("by_status_next", ["status", "next_attempt_at"]),
    ],
  },
  {
    id: "whatsapp_messages",
    name: "Mensagens de WhatsApp",
    attributes: [
      fam,
      en("direction", ["in", "out"]),
      str("provider_message_id", true, 128),
      str("from_phone", false, 20),
      str("member_id", false, 64),
      en("type", ["text", "button", "audio", "image"]),
      str("body_redacted", false, 1000),
      str("transcript", false, 2000),
      str("related_dose_event_id", false, 64),
      dt("received_at", true),
    ],
    indexes: [idx("provider_message", ["provider_message_id"], "unique"), idx("by_family_time", ["family_id", "received_at"])],
  },
  {
    id: "audit_log",
    name: "Auditoria",
    attributes: [
      fam,
      str("actor_member_id", false, 64),
      str("action", true, 80),
      str("entity", true, 80),
      str("entity_id", false, 64),
      dt("at", true),
      json("meta"),
    ],
    indexes: [idx("by_family_time", ["family_id", "at"]), idx("by_entity", ["family_id", "entity", "entity_id"])],
  },
];

export const COLLECTION_IDS = COLLECTIONS.map((c) => c.id);
