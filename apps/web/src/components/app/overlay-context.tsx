"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type Overlay =
  | { type: "viewer"; rxId: string; page: number }
  | { type: "attach"; preset?: { patientId?: string; medicationIds?: string[]; doctor?: string; specialty?: string; replacesId?: string; editId?: string } }
  | { type: "share"; rxId: string; tab?: "family" | "whatsapp" }
  | { type: "replenishment"; medId: string };

interface OverlayApi {
  overlay: Overlay | null;
  open: (o: Overlay) => void;
  close: () => void;
}

const Ctx = createContext<OverlayApi | null>(null);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const close = useCallback(() => setOverlay(null), []);
  const value = useMemo(() => ({ overlay, open: setOverlay, close }), [overlay, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOverlay() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useOverlay fora de <OverlayProvider>");
  return c;
}
