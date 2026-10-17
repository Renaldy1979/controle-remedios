import type { ReactNode } from "react";
import { DataShell } from "@/components/app/DataShell";

/** O catálogo sempre usa os mocks, nunca dados reais. */
export default function Layout({ children }: { children: ReactNode }) {
  return <DataShell>{children}</DataShell>;
}
