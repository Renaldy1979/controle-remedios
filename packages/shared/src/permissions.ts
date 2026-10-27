import { z } from "zod";

export const PERMISSION_KEYS = [
  "dashboard.view",
  "patients.view",
  "patients.manage",
  "doses.confirm",
  "doses.history.view",
  "medications.manage",
  "treatments.manage",
  "stock.view",
  "stock.adjust",
  "prescriptions.view",
  "prescriptions.upload",
  "prescriptions.share",
  "prescriptions.delete",
  "replenishment.manage",
  "members.manage",
  "profiles.manage",
  "settings.manage",
  "whatsapp.query",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export const permissionKeySchema = z.enum(PERMISSION_KEYS);

/** Mapa de permissões de um perfil. Chave ausente = negado. */
export const permissionMapSchema = z.record(permissionKeySchema, z.boolean());
export type PermissionMap = Partial<Record<PermissionKey, boolean>>;

/**
 * Funcionalidades exibidas na matriz do painel (design.md 5.6).
 * Cada linha liga/desliga um grupo de chaves.
 */
export const PERMISSION_GROUPS: ReadonlyArray<{ id: string; label: string; keys: readonly PermissionKey[] }> = [
  { id: "view", label: "Ver doses e estoque", keys: ["dashboard.view", "patients.view", "doses.history.view", "stock.view"] },
  { id: "confirm", label: "Confirmar dose", keys: ["doses.confirm"] },
  { id: "edit_meds", label: "Editar remédios e esquemas", keys: ["medications.manage", "treatments.manage"] },
  { id: "stock", label: "Registrar compra e ajustar estoque", keys: ["stock.adjust", "replenishment.manage"] },
  { id: "prescriptions_view", label: "Ver receitas", keys: ["prescriptions.view"] },
  { id: "prescriptions_upload", label: "Anexar receitas", keys: ["prescriptions.upload"] },
  { id: "prescriptions_share", label: "Compartilhar receitas", keys: ["prescriptions.share"] },
  { id: "prescriptions_delete", label: "Excluir receitas", keys: ["prescriptions.delete"] },
  { id: "users", label: "Gerenciar usuários e perfis", keys: ["members.manage", "profiles.manage", "settings.manage", "patients.manage"] },
  { id: "query", label: "Consultar pelo WhatsApp", keys: ["whatsapp.query"] },
  { id: "alerts", label: "Receber avisos", keys: [] },
];

const all = (): PermissionMap => Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true]));
const only = (...keys: PermissionKey[]): PermissionMap => Object.fromEntries(keys.map((k) => [k, true]));

/** Perfis iniciais criados com cada família. */
export const SYSTEM_PROFILES: ReadonlyArray<{ name: string; permissions: PermissionMap }> = [
  { name: "Administrador", permissions: all() },
  {
    name: "Familiar",
    permissions: only(
      "dashboard.view", "patients.view", "doses.confirm", "doses.history.view", "stock.view", "stock.adjust",
      "prescriptions.view", "prescriptions.upload", "prescriptions.share", "replenishment.manage", "whatsapp.query",
    ),
  },
  {
    name: "Cuidadora",
    permissions: only(
      "dashboard.view", "patients.view", "doses.confirm", "doses.history.view", "stock.view", "prescriptions.view", "whatsapp.query",
    ),
  },
  { name: "Confirmador", permissions: only("dashboard.view", "patients.view", "doses.confirm", "whatsapp.query") },
  {
    name: "Somente leitura",
    permissions: only("dashboard.view", "patients.view", "doses.history.view", "stock.view", "whatsapp.query"),
  },
];

export const ADMIN_PROFILE_NAME = "Administrador";

/** Perfil de quem só acompanha (visão de relatório): vê e não age. */
export const READ_ONLY_PROFILE_NAME = "Somente leitura";

/**
 * Permissões que fazem ALGO (escrever, confirmar, cadastrar, administrar). Nunca podem ser ligadas no perfil
 * "Somente leitura": a matriz bloqueia e o servidor recusa. `prescriptions.view`, `stock.view` etc. são de leitura.
 */
export const ACTION_PERMISSIONS: readonly PermissionKey[] = [
  "doses.confirm",
  "stock.adjust",
  "replenishment.manage",
  "prescriptions.upload",
  "prescriptions.share",
  "prescriptions.delete",
  "members.manage",
  "profiles.manage",
  "settings.manage",
  "patients.manage",
  "medications.manage",
  "treatments.manage",
];

export const isReadOnlyProfile = (profileName: string): boolean => profileName === READ_ONLY_PROFILE_NAME;
export const isActionPermission = (k: PermissionKey): boolean => ACTION_PERMISSIONS.includes(k);

/** Uma linha da matriz (grupo de chaves) só de ação? Então fica travada no perfil "Somente leitura". */
export const isActionGroup = (g: { keys: readonly PermissionKey[] }): boolean => g.keys.some(isActionPermission);

/** Administrador sempre tem acesso total, independente do mapa salvo. */
export function can(
  member: { profileName: string; permissions: PermissionMap },
  permission: PermissionKey,
): boolean {
  if (member.profileName === ADMIN_PROFILE_NAME) return true;
  // trava de defesa: mesmo que o mapa salvo no banco tenha uma permissão de ação, "Somente leitura" nunca age
  if (member.profileName === READ_ONLY_PROFILE_NAME && ACTION_PERMISSIONS.includes(permission)) return false;
  return member.permissions[permission] === true;
}
