"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DataProvider, type Snapshot } from "@/data";
import { RemoteDataSource } from "@/data/remote";
import { useToast } from "@/components/ui/Toast";
import { OverlayProvider } from "./overlay-context";
import { OverlayHost } from "./OverlayHost";

const REFRESH_MS = 60_000;

/**
 * Liga as telas à origem de dados. Com `initial` (retrato calculado no servidor) usa a origem real;
 * sem ele usa os mocks (testes, /design-system e DATA_SOURCE=mock).
 */
export function DataShell({ children, initial }: { children: ReactNode; initial?: Snapshot }) {
  return initial ? <RemoteShell initial={initial}>{children}</RemoteShell> : <MockShell>{children}</MockShell>;
}

function MockShell({ children }: { children: ReactNode }) {
  return (
    <DataProvider>
      <OverlayProvider>
        {children}
        <OverlayHost />
      </OverlayProvider>
    </DataProvider>
  );
}

function RemoteShell({ children, initial }: { children: ReactNode; initial: Snapshot }) {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [source] = useState(() => new RemoteDataSource(initial, { onError: (m) => toastRef.current({ message: m, error: true }) }));

  // o servidor mandou um retrato novo (navegação): substitui
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    source.replace(initial);
  }, [initial, source]);

  // atualização periódica e ao voltar para a aba (outras pessoas também confirmam doses)
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && void source.refresh();
    const iv = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [source]);

  return (
    <DataProvider source={source}>
      <OverlayProvider>
        {children}
        <OverlayHost />
      </OverlayProvider>
    </DataProvider>
  );
}
