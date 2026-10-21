import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";
import { cx } from "@/lib/format";
import type { StockLevel, Tone } from "@/data/types";
import { STOCK_LEVEL, TONE_BG, TONE_BAR } from "@/lib/status";
import { Icon } from "./Icon";

/** Cartão r16. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rounded-lg border border-bd bg-sf shadow-sm", className)} {...rest} />;
}

export function SectionHeader({ title, action, count }: { title: string; action?: ReactNode; count?: number }) {
  return (
    <div className="mb-3 flex min-h-touch items-center justify-between gap-3">
      <h2 className="font-display text-t2 font-bold">
        {title}
        {count != null ? <span className="ml-2 text-body font-normal text-ink3">{count}</span> : null}
      </h2>
      {action}
    </div>
  );
}

/** Bloco de ícone 48-52px r14, fundo tonal. */
export function IconBlock({ name, tone = "br", size = 48 }: { name: string; tone?: Tone; size?: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className={cx("flex flex-none items-center justify-center rounded-[14px]", TONE_BG[tone])}>
      <Icon name={name} size={size >= 52 ? 28 : 26} />
    </span>
  );
}

/** Barra de dias com escala de 30 dias e marca de aviso (nível por cor + texto no cartão). */
export function StockBar({ pct, level, markerAtPct = 47, label }: { pct: number; level: StockLevel; markerAtPct?: number; label: string }) {
  return (
    <div role="img" aria-label={label} className="relative h-3 w-full rounded-pill bg-trk">
      <div className={cx("h-full rounded-pill", TONE_BAR[level])} style={{ width: `${Math.max(3, pct)}%` }} />
      <span aria-hidden="true" className="absolute -top-0.5 h-4 w-0.5 bg-ink3" style={{ left: `${markerAtPct}%` }} />
    </div>
  );
}

export function ProgressBar({ value, label, failed, detail }: { value: number; label: string; failed?: boolean; detail?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-bold">{label}</span>
        <span className="num font-extrabold">{Math.round(value)}%</span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} className="h-3.5 w-full overflow-hidden rounded-pill bg-trk">
        <div className={cx("h-full rounded-pill transition-[width]", failed ? "bg-ms-bar" : "bg-br")} style={{ width: `${value}%` }} />
      </div>
      {detail ? <p className="text-cap text-ink2">{detail}</p> : null}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-bd2 bg-sf px-6 py-10 text-center">
      <IconBlock name={icon} size={52} />
      <h2 className="font-display text-t2 font-bold">{title}</h2>
      {text ? <p className="max-w-[420px] text-ink2">{text}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("shimmer rounded-md", className)} />;
}

export function InlineStock({ level }: { level: StockLevel }) {
  const l = STOCK_LEVEL[level];
  return (
    <span className={cx("inline-flex items-center gap-1 font-bold", level === "critical" ? "text-ms" : level === "warning" ? "text-lt" : "text-ok")}>
      <Icon name={l.icon} size={18} />
      {l.label}
    </span>
  );
}

// ---------- Tabela (cabeçalho --sf2, linhas de 56px) ----------

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-bd bg-sf">
      <table className={cx("w-full border-collapse text-left", className)} {...rest} />
    </div>
  );
}
export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cx("bg-sf2 px-4 py-3 text-cap font-bold text-ink2", className)} {...rest} />;
}
export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cx("h-14 border-t border-bd px-4 align-middle", className)} {...rest} />;
}

// ---------- Linha do tempo ----------

export interface TimelineItem {
  id: string;
  icon: string;
  tone: Tone;
  title: ReactNode;
  detail?: ReactNode;
  time?: string;
  /** rótulo textual do estado (estado nunca só por cor) */
  statusLabel?: string;
}

export function Timeline({ items, label }: { items: TimelineItem[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col">
      {items.map((it, i) => (
        <li key={it.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span aria-hidden="true" className={cx("flex h-9 w-9 flex-none items-center justify-center rounded-full", TONE_BG[it.tone])}>
              <Icon name={it.icon} size={20} />
            </span>
            {i < items.length - 1 ? <span aria-hidden="true" className="w-0.5 flex-1 bg-bd" /> : null}
          </div>
          <div className="min-w-0 flex-1 pb-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-bold">{it.title}</p>
              {it.time ? <span className="num flex-none text-cap text-ink3">{it.time}</span> : null}
            </div>
            {it.statusLabel ? <p className="text-cap font-bold text-ink2">{it.statusLabel}</p> : null}
            {it.detail ? <p className="text-cap text-ink2">{it.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
