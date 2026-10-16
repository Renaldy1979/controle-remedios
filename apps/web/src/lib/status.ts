import type { DoseStatus } from "@medcuidar/shared";
import type { StockLevel, Tone } from "@/data/types";

/** Estado nunca só por cor: cada estado tem ícone + rótulo + tom (design.md 2.3). */

export const DOSE_STATUS: Record<DoseStatus, { label: string; icon: string; tone: Tone }> = {
  pending: { label: "Pendente", icon: "schedule", tone: "pn" },
  taken: { label: "Tomada", icon: "check_circle", tone: "ok" },
  late: { label: "Atrasada", icon: "alarm", tone: "lt" },
  missed: { label: "Esquecida", icon: "cancel", tone: "ms" },
  skipped: { label: "Pulada", icon: "skip_next", tone: "neu" },
};

export const STOCK_LEVEL: Record<StockLevel, { label: string; icon: string; tone: Tone }> = {
  critical: { label: "Crítico", icon: "report", tone: "ms" },
  warning: { label: "Atenção", icon: "hourglass_bottom", tone: "lt" },
  ok: { label: "Estoque ok", icon: "inventory_2", tone: "ok" },
};

export const RX_STATUS = {
  valid: { label: "Vigente", icon: "verified", tone: "ok" as Tone },
  expired: { label: "Vencida", icon: "event_busy", tone: "ms" as Tone },
  awaiting_new: { label: "Aguardando nova", icon: "hourglass_top", tone: "pn" as Tone },
  superseded: { label: "Substituída", icon: "swap_horiz", tone: "neu" as Tone },
};

export const CHANNEL = {
  whatsapp: { label: "WhatsApp", icon: "chat" },
  panel: { label: "Painel", icon: "computer" },
};

/** Classes de fundo + texto por tom (tokens semânticos). */
export const TONE_BG: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  pn: "bg-pn-bg text-pn",
  lt: "bg-lt-bg text-lt",
  ms: "bg-ms-bg text-ms",
  neu: "bg-neub text-neuf",
  br: "bg-brt text-br",
};

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ok",
  pn: "text-pn",
  lt: "text-lt",
  ms: "text-ms",
  neu: "text-ink2",
  br: "text-br",
};

export const TONE_BAR: Record<StockLevel, string> = {
  critical: "bg-ms-bar",
  warning: "bg-lt-bar",
  ok: "bg-ok-bar",
};

export const STOCK_TEXT: Record<StockLevel, string> = {
  critical: "text-ms",
  warning: "text-lt",
  ok: "text-ok",
};
