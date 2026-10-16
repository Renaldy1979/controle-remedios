"use client";
import { useId, type ReactNode } from "react";
import { cx } from "@/lib/format";
import { Icon } from "./Icon";

interface CheckboxProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** 24px por padrão; listas de pessoas usam 26px */
  size?: 24 | 26;
}

/** Caixa 24px r8; a área clicável (linha toda) tem pelo menos 44px. */
export function Checkbox({ checked, onChange, label, description, disabled, size = 24 }: CheckboxProps) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx("flex min-h-touch cursor-pointer items-center gap-3 py-1", disabled && "cursor-not-allowed opacity-60")}>
      <input id={id} type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden="true"
        style={{ width: size, height: size }}
        className={cx("flex flex-none items-center justify-center rounded-sm border-2 peer-focus-visible:shadow-[0_0_0_3px_var(--sf),0_0_0_5px_var(--br)]", checked ? "border-br bg-br text-onbr" : "border-bd2 bg-sf")}
      >
        {checked ? <Icon name="check" size={size - 6} /> : null}
      </span>
      <span className="flex flex-col">
        <span>{label}</span>
        {description ? <span className="text-cap text-ink2">{description}</span> : null}
      </span>
    </label>
  );
}

interface RadioGroupProps<T extends string> {
  name: string;
  legend: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; description?: string }>;
}

export function RadioGroup<T extends string>({ name, legend, value, onChange, options }: RadioGroupProps<T>) {
  return (
    <fieldset className="flex flex-col">
      <legend className="mb-1 font-bold">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="flex min-h-touch cursor-pointer items-center gap-3 py-1">
          <input type="radio" className="peer sr-only" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span aria-hidden="true" className={cx("flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 peer-focus-visible:shadow-[0_0_0_3px_var(--sf),0_0_0_5px_var(--br)]", value === o.value ? "border-br" : "border-bd2")}>
            {value === o.value ? <span className="h-3 w-3 rounded-full bg-br" /> : null}
          </span>
          <span className="flex flex-col">
            <span>{o.label}</span>
            {o.description ? <span className="text-cap text-ink2">{o.description}</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  /** esconde o rótulo visual (continua como nome acessível) */
  hideLabel?: boolean;
  disabled?: boolean;
  /** mostra "Sim"/"Não" ao lado (matriz de permissões) */
  showState?: boolean;
  small?: boolean;
}

/** Switch 52×32 (ou 44×26 na matriz), com ícone no knob: estado nunca só por cor. */
export function Switch({ checked, onChange, label, hideLabel, disabled, showState, small }: SwitchProps) {
  const w = small ? 44 : 52;
  const h = small ? 26 : 32;
  const k = h - 8;
  return (
    <span className="inline-flex min-h-touch items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{ width: w, height: h }}
        className={cx("relative flex-none rounded-pill transition-colors disabled:cursor-not-allowed disabled:opacity-60", checked ? "bg-br" : "bg-bd2")}
      >
        <span
          aria-hidden="true"
          style={{ width: k, height: k, left: checked ? w - k - 4 : 4, top: 4 }}
          className="absolute flex items-center justify-center rounded-full bg-white text-[#0E1A33] transition-all"
        >
          <Icon name={checked ? "check" : "close"} size={k - 6} />
        </span>
      </button>
      {!hideLabel && !showState ? <span>{label}</span> : null}
      {showState ? <span className="w-9 text-cap font-bold">{checked ? "Sim" : "Não"}</span> : null}
    </span>
  );
}
