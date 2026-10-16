"use client";
import { useOverlay } from "./overlay-context";
import { AttachFlow } from "@/components/overlays/AttachFlow";
import { ReplenishmentSheet } from "@/components/overlays/ReplenishmentSheet";
import { ShareSheet } from "@/components/overlays/ShareSheet";
import { RxViewer } from "@/components/overlays/RxViewer";

/** Renderiza o overlay ativo (visualizador, anexar, compartilhar, reposição). */
export function OverlayHost() {
  const { overlay } = useOverlay();
  if (!overlay) return null;
  switch (overlay.type) {
    case "viewer":
      return <RxViewer rxId={overlay.rxId} initialPage={overlay.page} />;
    case "attach":
      return <AttachFlow preset={overlay.preset} />;
    case "share":
      return <ShareSheet rxId={overlay.rxId} initialTab={overlay.tab} />;
    case "replenishment":
      return <ReplenishmentSheet medId={overlay.medId} />;
  }
}
