import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { DataShell } from "@/components/app/DataShell";
import { dataSourceKind } from "@/server/env";

// Sempre dinâmico: depende do cookie de sessão e de dados do banco.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (dataSourceKind() === "postgres") {
    const [{ requireContext }, { buildSnapshot }, { prepareDaySafe }] = await Promise.all([import("@/server/pg/access"), import("@/server/pg/snapshot"), import("@/server/pg/prepare")]);
    // sem sessão, e-mail por confirmar, sem família ou desativado: cada caso vai para a tela certa
    const ctx = await requireContext();
    await prepareDaySafe(ctx); // doses de hoje (idempotente), atraso/esquecida e aviso de estoque baixo
    const initial = await buildSnapshot(ctx);
    return (
      <DataShell initial={initial}>
        <AppShell>{children}</AppShell>
      </DataShell>
    );
  }
  return (
    <DataShell>
      <AppShell>{children}</AppShell>
    </DataShell>
  );
}
