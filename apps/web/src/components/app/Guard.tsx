"use client";
import type { ReactNode } from "react";
import type { PermissionKey } from "@medcuidar/shared";
import { useCan } from "@/data";
import { EmptyState } from "@/components/ui/Layout";

/** Esconde a tela inteira para quem não tem a permissão (o menu já omite o item). */
export function Guard({ permission, children }: { permission: PermissionKey; children: ReactNode }) {
  const allowed = useCan(permission);
  if (!allowed) return <EmptyState icon="lock" title="Esta área não está liberada para o seu perfil" text="Peça a quem administra a família para ajustar as permissões em Configurações › Perfis." />;
  return <>{children}</>;
}
