"use client";
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "@/lib/format";
import { Icon } from "./Icon";
import { IconButton } from "./Button";

interface FieldShellProps {
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  id: string;
  children: ReactNode;
}

export function FieldShell({ label, optional, hint, error, id, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-bold text-ink">
        {label}
        {optional ? <span className="font-normal text-ink3"> · opcional</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-cap text-ink3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-err`} role="alert" className="flex items-center gap-1.5 text-[15px] font-bold text-ms">
          <Icon name="error" size={18} />
          {error}
        </p>
      ) : null}
    </div>
  );
}

const control =
  "w-full rounded-md border-[1.5px] bg-sf px-4 text-body text-ink transition-shadow focus:border-br focus:shadow-[0_0_0_3px_var(--halo)] focus-visible:shadow-[0_0_0_3px_var(--halo)] disabled:bg-sf2 disabled:text-ink3";
const ok = "border-bd2";
const bad = "border-danger bg-[var(--field-err-bg)]";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  id?: string;
}

export function TextField({ label, optional, hint, error, id, className, ...rest }: TextFieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell label={label} optional={optional} hint={hint} error={error} id={fid}>
      <input id={fid} aria-invalid={!!error || undefined} aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined} className={cx(control, "h-12", error ? bad : ok, className)} {...rest} />
    </FieldShell>
  );
}

interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  id?: string;
}

export function TextArea({ label, optional, hint, error, id, className, ...rest }: TextAreaProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell label={label} optional={optional} hint={hint} error={error} id={fid}>
      <textarea id={fid} aria-invalid={!!error || undefined} aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined} className={cx(control, "min-h-24 py-3", error ? bad : ok, className)} {...rest} />
    </FieldShell>
  );
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  id?: string;
  /** destaque quando o filtro está ativo (design.md 3) */
  active?: boolean;
  hideLabel?: boolean;
}

export function SelectField({ label, optional, hint, error, id, active, hideLabel, className, children, ...rest }: SelectFieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  const select = (
    <div className="relative">
      <select
        id={fid}
        aria-invalid={!!error || undefined}
        aria-label={hideLabel ? label : undefined}
        className={cx(control, "h-12 appearance-none pr-11", error ? bad : active ? "border-br font-bold" : ok, className)}
        {...rest}
      >
        {children}
      </select>
      <Icon name="expand_more" size={24} className="pointer-events-none absolute right-3 top-3 text-ink2" />
    </div>
  );
  if (hideLabel) return select;
  return (
    <FieldShell label={label} optional={optional} hint={hint} error={error} id={fid}>
      {select}
    </FieldShell>
  );
}

interface SearchFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
}

/** h52, r14, ícone de busca e botão de limpar de 44px. */
export function SearchField({ value, onChange, placeholder = "Buscar", label = "Buscar" }: SearchFieldProps) {
  const id = useId();
  return (
    <div className="relative">
      <Icon name="search" size={24} className="pointer-events-none absolute left-4 top-[14px] text-ink3" />
      <input
        id={id}
        type="search"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cx(control, ok, "h-[52px] rounded-[14px] pl-12 pr-12 [&::-webkit-search-cancel-button]:hidden")}
      />
      {value ? <IconButton icon="close" label="Limpar busca" onClick={() => onChange("")} className="absolute right-1 top-1" /> : null}
    </div>
  );
}
