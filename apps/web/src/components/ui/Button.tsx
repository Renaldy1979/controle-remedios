"use client";
import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/format";
import { Icon } from "./Icon";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerOutline";
export type ButtonSize = "md" | "lg" | "sm";

const base =
  "inline-flex select-none items-center justify-center gap-2 rounded-md font-bold transition-colors disabled:cursor-not-allowed disabled:bg-[var(--disabled-bg)] disabled:text-[var(--disabled-fg)] disabled:border-transparent";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-br text-onbr hover:bg-br2",
  secondary: "border-[1.5px] border-bd2 bg-sf text-br hover:border-br hover:bg-brt",
  ghost: "text-br hover:bg-brt",
  danger: "bg-danger text-white hover:bg-danger-hover",
  dangerOutline: "border-[1.5px] border-ms-bd bg-sf text-ms hover:bg-ms-bg",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-touch px-4 text-body",
  md: "h-12 px-5 text-body",
  lg: "h-14 px-6 text-body-lg",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", full = false, extra?: string) {
  return cx(base, variants[variant], sizes[size], full && "w-full", extra);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: string;
  loading?: boolean;
  loadingText?: string;
  full?: boolean;
}

export function Button({ variant = "primary", size = "md", icon, loading, loadingText = "Salvando…", full, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, full, className)} {...rest}>
      {loading ? <span aria-hidden="true" className="h-5 w-5 rounded-full border-[3px] border-current border-t-transparent" style={{ animation: "spin .8s linear infinite" }} /> : icon ? <Icon name={icon} size={22} /> : null}
      {loading ? loadingText : children}
    </button>
  );
}

interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: string;
  full?: boolean;
  children: ReactNode;
}

export function ButtonLink({ href, variant = "primary", size = "md", icon, full, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonClass(variant, size, full, className)} {...rest}>
      {icon ? <Icon name={icon} size={22} /> : null}
      {children}
    </Link>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  /** obrigatório: botão só com ícone precisa de nome acessível */
  label: string;
  tone?: "default" | "inverse";
}

export function IconButton({ icon, label, tone = "default", className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-11 w-11 flex-none items-center justify-center rounded-md transition-colors disabled:opacity-50",
        tone === "default" ? "text-ink2 hover:bg-brt hover:text-br" : "text-white hover:bg-white/15",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={24} />
    </button>
  );
}
