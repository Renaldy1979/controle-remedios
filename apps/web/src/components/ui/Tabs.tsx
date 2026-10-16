"use client";
import { useId, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@/lib/format";
import { Icon } from "./Icon";

interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: string;
  /** indicador de alerta com nome acessível (ícone + aria-label) */
  alertLabel?: string;
  leading?: ReactNode;
}

interface TabsProps<T extends string> {
  items: Array<TabItem<T>>;
  value: T;
  onChange: (v: T) => void;
  label: string;
  /** "segmented": trilho em pílula. "underline": abas de paciente. */
  variant?: "segmented" | "underline";
  idPrefix?: string;
}

function useArrowNav<T extends string>(items: Array<TabItem<T>>, value: T, onChange: (v: T) => void) {
  return (e: KeyboardEvent) => {
    const i = items.findIndex((x) => x.value === value);
    let n = i;
    if (e.key === "ArrowRight") n = (i + 1) % items.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = items.length - 1;
    else return;
    e.preventDefault();
    onChange(items[n]!.value);
    const prefix = (e.currentTarget as HTMLElement).dataset.prefix;
    const target = items[n]!.value;
    requestAnimationFrame(() => document.getElementById(`${prefix}-tab-${target}`)?.focus());
  };
}

/** role=tablist/tab, setas movem a seleção (roving tabindex). */
export function Tabs<T extends string>({ items, value, onChange, label, variant = "segmented", idPrefix }: TabsProps<T>) {
  const auto = useId();
  const prefix = idPrefix ?? auto;
  const onKey = useArrowNav(items, value, onChange);
  return (
    <div role="tablist" aria-label={label} data-prefix={prefix} onKeyDown={onKey} className={cx("flex", variant === "segmented" ? "gap-1 rounded-pill bg-neub p-1" : "gap-1 border-b border-bd")}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            id={`${prefix}-tab-${it.value}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(it.value)}
            className={cx(
              "flex min-h-11 flex-1 items-center justify-center gap-2 text-body transition-colors",
              variant === "segmented"
                ? cx("rounded-pill px-4", active ? "bg-sf font-bold text-br shadow-sm" : "text-neuf hover:text-ink")
                : cx("border-b-[3px] px-3 py-2", active ? "border-br font-bold text-ink" : "border-transparent text-ink2 hover:text-ink"),
            )}
          >
            {it.leading}
            {it.icon ? <Icon name={it.icon} size={20} /> : null}
            {it.label}
            {it.alertLabel ? <Icon name="warning" size={18} className="text-lt" /> : null}
            {it.alertLabel ? <span className="sr-only">{it.alertLabel}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function tabPanelProps(prefix: string, value: string) {
  return { role: "tabpanel", id: `${prefix}-panel`, "aria-labelledby": `${prefix}-tab-${value}` } as const;
}
