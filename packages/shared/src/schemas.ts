import { z, type ZodTypeAny } from "zod";
import { COLLECTIONS, type AttrSpec, type CollectionSpec } from "./collections";

/** Campos que o Appwrite adiciona a todo documento. */
const systemFields = {
  $id: z.string(),
  $createdAt: z.string(),
  $updatedAt: z.string(),
};

function attrToZod(attr: AttrSpec): ZodTypeAny {
  let base: ZodTypeAny;
  switch (attr.type) {
    case "string":
      base = z.string().max(attr.size ?? 255);
      break;
    case "integer":
      base = z.number().int();
      break;
    case "float":
      base = z.number();
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "datetime":
      base = z.string().datetime({ offset: true });
      break;
    case "enum":
      base = z.enum(attr.elements as [string, ...string[]]);
      break;
  }
  if (attr.array) base = z.array(base);
  return attr.required ? base : base.nullish();
}

/** Schema do documento criado/atualizado (sem campos de sistema). */
export function inputSchemaFor(collection: CollectionSpec) {
  return z.object(Object.fromEntries(collection.attributes.map((a) => [a.key, attrToZod(a)])));
}

/** Schema do documento lido do banco (inclui `$id`, `$createdAt`, `$updatedAt`). */
export function documentSchemaFor(collection: CollectionSpec) {
  return inputSchemaFor(collection).extend(systemFields);
}

export const inputSchemas = Object.fromEntries(COLLECTIONS.map((c) => [c.id, inputSchemaFor(c)])) as Record<
  string,
  ReturnType<typeof inputSchemaFor>
>;

export const documentSchemas = Object.fromEntries(COLLECTIONS.map((c) => [c.id, documentSchemaFor(c)])) as Record<
  string,
  ReturnType<typeof documentSchemaFor>
>;

// Configurações da família (campo `settings` de `families`, guardado como JSON).
export const familySettingsSchema = z.object({
  default_low_stock_days: z.number().int().positive().default(7),
  default_reminder_lead_min: z.number().int().nonnegative().default(0),
  default_reminder_retry_min: z.number().int().positive().default(15),
  late_after_min: z.number().int().positive().default(15),
  missed_after_min: z.number().int().positive().default(120),
  repeat_reminder_options_min: z.array(z.number().int().positive()).default([15, 30, 60]),
  daily_summary_time: z.string().regex(/^\d{2}:\d{2}$/).default("20:00"),
  whatsapp_group_id: z.string().nullish(),
  reminder_recipients_mode: z.enum(["all_members", "assignments_only", "assignments_plus_family"]).default("all_members"),
  transcription_provider: z.string().default("gemini"),
});
export type FamilySettings = z.infer<typeof familySettingsSchema>;

/** Regras do Appwrite exigem `Record<string, unknown>` na escrita; estes helpers parseiam JSON guardado em string. */
export function parseJsonField<T extends ZodTypeAny>(schema: T, raw: string): z.infer<T> {
  return schema.parse(JSON.parse(raw));
}
