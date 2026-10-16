import type { CSSProperties } from "react";
import { cx } from "@/lib/format";

interface IconProps {
  name: string;
  size?: number;
  className?: string;
  /** Material Symbols preenchido por padrão (design.md 2.6). */
  fill?: boolean;
  style?: CSSProperties;
}

/** Ícone decorativo: sempre acompanhado de texto ou de aria-label no controle pai. */
export function Icon({ name, size = 24, className, fill = true, style }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={cx("msr", className)}
      style={{ fontSize: size, width: size, height: size, ...(fill ? null : { fontVariationSettings: '"FILL" 0, "wght" 500' }), ...style }}
    >
      {name}
    </span>
  );
}
