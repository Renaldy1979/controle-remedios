import { familySettingsSchema, parseJsonField, can, type PermissionMap, type PermissionKey } from "@medcuidar/shared";
import type { FamilyData, Row } from "./ports";
import { z } from "zod";

export const s = (row: Row, key: string): string => String(row[key] ?? "");
export const sOpt = (row: Row, key: string): string | undefined => {
  const v = row[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
};
export const n = (row: Row, key: string): number => Number(row[key] ?? 0);

export function isConflict(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: number }).code === 409;
}

export function parseSettings(raw: unknown) {
  if (typeof raw === "string") return parseJsonField(familySettingsSchema, raw);
  return familySettingsSchema.parse(raw ?? {});
}

export function parsePayload(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const permissionsSchema = z.record(z.string(), z.boolean());

export interface MemberCtx {
  id: string;
  name: string;
  phone: string;
  profileName: string;
  permissions: PermissionMap;
  receivesFamilyAlerts: boolean;
}

export async function loadMemberCtx(data: FamilyData, member: Row): Promise<MemberCtx> {
  let profileName = "";
  let permissions: PermissionMap = {};
  const profileId = sOpt(member, "profile_id");
  if (profileId) {
    const profile = await data.getOrNull("profiles", profileId);
    if (profile) {
      profileName = s(profile, "name");
      try {
        permissions = permissionsSchema.parse(JSON.parse(s(profile, "permissions"))) as PermissionMap;
      } catch {
        permissions = {};
      }
    }
  }
  return {
    id: member.$id,
    name: s(member, "name"),
    phone: s(member, "phone_e164"),
    profileName,
    permissions,
    receivesFamilyAlerts: member["receives_family_alerts"] === true,
  };
}

export const memberCan = (m: MemberCtx, permission: PermissionKey) => can(m, permission);

/** Texto "2 gotas", "1 comprimido"... a partir do remédio. Só apresentação, sem regra clínica. */
export function doseText(amount: number, medication: Row): string {
  const route = s(medication, "route");
  const unit = s(medication, "control_unit");
  const one = amount === 1;
  if (unit === "drop") return `${amount} ${one ? "gota" : "gotas"}`;
  if (unit === "ml") return `${amount} ml`;
  if (unit === "gram") return `${amount} g`;
  if (route === "tablet") return `${amount} ${one ? "comprimido" : "comprimidos"}`;
  return `${amount} ${one ? "dose" : "doses"}`;
}
