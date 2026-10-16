"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/format";
import { TONE_BG } from "@/lib/status";
import type { Tone } from "@/data/types";
import { Icon } from "./Icon";

interface StatusChipProps {
  label: string;
  icon: string;
  tone: Tone;
  /** compacto h28 (14px 700) ou normal h32-36 */
  compact?: boolean;
  className?: string;
  children?: ReactNode;
}

/** Chip de status: sempre ícone + texto (estado nunca só por cor). */
export function StatusChip({ label, icon, tone, compact, className }: StatusChipProps) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-pill font-bold", compact ? "min-h-7 px-2.5 text-cap" : "min-h-9 px-3 text-body", TONE_BG[tone], className)}>
      <Icon name={icon} size={compact ? 18 : 20} />
      {label}
    </span>
  );
}

interface SelectChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  selected: boolean;
  onToggle?: () => void;
  icon?: string;
  count?: number;
}

/** Chip de seleção h44 com aria-pressed. */
export function SelectChip({ selected, onToggle, icon, count, children, className, ...rest }: SelectChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cx(
        "inline-flex min-h-touch flex-none items-center gap-1.5 rounded-pill border-[1.5px] px-4 text-body transition-colors",
        selected ? "border-br bg-brt font-bold text-pn" : "border-bd2 bg-sf text-ink hover:bg-sf2",
        className,
      )}
      {...rest}
    >
      {selected ? <Icon name="check" size={20} /> : icon ? <Icon name={icon} size={20} /> : null}
      {children}
      {count != null ? <span className="text-cap text-ink3">{count}</span> : null}
    </button>
  );
}

/** Etiqueta neutra pequena (tag): tipo de uso, fase etc. */
export function Tag({ children, icon, tone = "neu" }: { children: ReactNode; icon?: string; tone?: Tone }) {
  return (
    <span className={cx("inline-flex min-h-7 items-center gap-1 rounded-sm px-2.5 text-cap font-bold", TONE_BG[tone])}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </span>
  );
}
