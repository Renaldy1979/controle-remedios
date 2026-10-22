import "server-only";
import { eq } from "drizzle-orm";
import { resolverMembroPorTelefone, withFamilia, type EstadoAcesso } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { PERMISSION_KEYS, familySettingsSchema, permissionMapSchema, type FamilySettings, type PermissionKey, type PermissionMap } from "@medcuidar/shared";
import type { DoseActor } from "../pg/doses";

/**
 * O que quem só validou o WhatsApp (`whatsapp_verified`) pode fazer (docs/06 seção 2): dar o check, ver a próxima dose,
 * consultar estoque e receber avisos. Receitas, compartilhamento e administração exigem `active`.
 */
export const BASIC_WHATSAPP_PERMISSIONS: readonly PermissionKey[] = ["dashboard.view", "patients.view", "doses.confirm", "stock.view", "whatsapp.query"];

/**
 * Permissões efetivas pelo WhatsApp conforme o estado de acesso. `invited` não pode nada; `whatsapp_verified` só o básico
 * (e nunca como "Administrador": esse nome libera tudo em `can()`, então o perfil é rebatizado); `active` tudo do perfil.
 */
export function effectivePermissions(
  state: EstadoAcesso, profileName: string, permissions: PermissionMap,
): { profileName: string; permissions: PermissionMap } {
  if (state === "active") return { profileName, permissions };
  if (state === "invited") return { profileName: `${profileName} (sem acesso)`, permissions: {} };
  const base: PermissionMap = profileName === "Administrador" ? Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true])) : permissions;
  const out: PermissionMap = {};
  for (const k of BASIC_WHATSAPP_PERMISSIONS) if (base[k] === true) out[k] = true;
  return { profileName: `${profileName} (WhatsApp)`, permissions: out };
}

export interface WaActor extends DoseActor {
  settings: FamilySettings;
  name: string;
  access: EstadoAcesso;
  /** Só dígitos; o número verificado de quem escreveu. */
  phone: string;
  /** Perfil real (para decisões de lista), diferente de member.profileName quando restrito. */
  realProfile: string;
}

/** Carrega o ator a partir do membro já resolvido. Inativo, removido ou família inativa → null. */
export async function loadWaActor(familyId: string, memberId: string, access: EstadoAcesso, phone: string): Promise<WaActor | null> {
  const row = await withFamilia(familyId, async (tx) => {
    const [r] = await tx
      .select({ member: s.members, profile: s.profiles, family: s.families })
      .from(s.members)
      .innerJoin(s.profiles, eq(s.profiles.id, s.members.profileId))
      .innerJoin(s.families, eq(s.families.id, s.members.familyId))
      .where(eq(s.members.id, memberId));
    return r;
  });
  if (!row || !row.member.active || row.member.removedAt || !row.family.active || row.family.deletedAt) return null;
  const parsed = permissionMapSchema.safeParse(row.profile.permissions);
  const eff = effectivePermissions(access, row.profile.name, parsed.success ? parsed.data : {});
  return {
    familyId,
    memberId,
    timezone: row.family.timezone,
    settings: familySettingsSchema.parse(row.family.settings ?? {}),
    member: { id: memberId, name: row.member.name, profileName: eff.profileName, permissions: eff.permissions },
    name: row.member.name,
    access,
    phone,
    realProfile: row.profile.name,
  };
}

/** Remetente (telefone VERIFICADO, só dígitos) → ator. Desconhecido, não verificado ou sem acesso → null (sem distinguir). */
export async function resolveSender(telefone: string): Promise<WaActor | null> {
  const m = await resolverMembroPorTelefone(telefone);
  if (!m || !m.ativo || !m.familiaAtiva || m.estadoAcesso === "invited") return null;
  return loadWaActor(m.familiaId, m.membroId, m.estadoAcesso, telefone);
}
