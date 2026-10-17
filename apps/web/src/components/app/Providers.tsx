"use client";
import { useEffect, type ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";

/** Providers globais. Dados e overlays ficam em <DataShell> (cada grupo de rotas escolhe a origem). */
export function Providers({ children }: { children: ReactNode }) {
  // sinal para os testes e2e: depois da hidratação os botões já respondem ao clique
  useEffect(() => {
    document.body.dataset["hydrated"] = "1";
  }, []);
  return <ToastProvider>{children}</ToastProvider>;
}
