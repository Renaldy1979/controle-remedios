import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { DataShell } from "@/components/app/DataShell";
import { dataSourceKind } from "@/server/env";

// Sempre dinâmico: depende do cookie de sessão e de dados do banco.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (dataSourceKind() === "appwrite") {
    const [{ requireContext }, { buildSnapshot }] = await Promise.all([import("@/server/context"), import("@/server/snapshot")]);
    const ctx = await requireContext();
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
