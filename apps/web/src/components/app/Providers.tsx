"use client";
import type { ReactNode } from "react";
import { DataProvider } from "@/data";
import { ToastProvider } from "@/components/ui/Toast";
import { OverlayProvider } from "./overlay-context";
import { OverlayHost } from "./OverlayHost";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <DataProvider>
      <ToastProvider>
        <OverlayProvider>
          {children}
          <OverlayHost />
        </OverlayProvider>
      </ToastProvider>
    </DataProvider>
  );
}
