import { can, type PermissionKey } from "@medcuidar/shared";
import type { Member } from "@/data/types";
import { ForbiddenError } from "./errors";

/** Quem está agindo, no mínimo necessário para as regras de negócio (o Ctx completo também serve). */
export interface Actor {
  familyId: string;
  memberId: string;
  timezone: string;
  member: Member;
}

/** Recusa no SERVIDOR (não só esconde na UI). */
export function requirePermission(actor: Pick<Actor, "member">, ...permissions: PermissionKey[]): void {
  for (const p of permissions) if (!can(actor.member, p)) throw new ForbiddenError(p);
}

export const isAdmin = (actor: Pick<Actor, "member">): boolean => actor.member.profileName === "Administrador";
