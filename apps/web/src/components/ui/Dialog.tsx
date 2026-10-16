"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/format";
import type { Tone } from "@/data/types";
import { TONE_BG } from "@/lib/status";
import { Button } from "./Button";
import { Icon } from "./Icon";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Foco preso dentro do diálogo, Esc fecha, foco devolvido ao fechar. */
export function useDialogBehavior(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!items.length) return;
      const a = items[0]!;
      const z = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);
  return ref;
}

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  icon?: string;
  iconTone?: Tone;
  description?: string;
  /** sm 440px · md 520px (sheet) · attach 560px, tela cheia no mobile */
  size?: "sm" | "md" | "attach";
  hideClose?: boolean;
}

/** Modal/sheet r24. Desktop centralizado; mobile fixado embaixo (margem 12px). */
export function Dialog({ title, onClose, children, footer, icon, iconTone = "br", description, size = "sm", hideClose }: DialogProps) {
  const ref = useDialogBehavior(onClose);
  const titleId = useId();
  const descId = useId();
  return (
    <div className={cx("fixed inset-0 z-50 flex bg-scrim", size === "attach" ? "items-stretch desk:items-center" : "items-end desk:items-center", "justify-center")} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        style={{ animation: "rise .22s ease-out" }}
        className={cx(
          "flex max-h-full w-full flex-col bg-sf shadow-lg",
          size === "attach" ? "h-full desk:h-auto desk:max-h-[92vh] desk:max-w-[560px] desk:rounded-xl" : "m-3 max-h-[calc(100%-24px)] rounded-xl desk:m-0 desk:max-h-[88vh]",
          size === "sm" && "desk:max-w-[440px]",
          size === "md" && "desk:max-w-[520px]",
        )}
      >
        <div className="flex items-start gap-3 p-5 pb-3">
          {icon ? (
            <span aria-hidden="true" className={cx("flex h-[52px] w-[52px] flex-none items-center justify-center rounded-[14px]", TONE_BG[iconTone])}>
              <Icon name={icon} size={28} />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-t2 font-extrabold">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-ink2">
                {description}
              </p>
            ) : null}
          </div>
          {!hideClose ? (
            <button type="button" aria-label="Fechar" onClick={onClose} className="-mr-2 -mt-1 flex h-11 w-11 flex-none items-center justify-center rounded-md text-ink2 hover:bg-brt hover:text-br">
              <Icon name="close" size={24} />
            </button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer ? <div className="flex flex-col-reverse gap-2 border-t border-bd p-4 desk:flex-row desk:justify-end">{footer}</div> : null}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  icon?: string;
  tone?: Tone;
  destructive?: boolean;
  altLabel?: string;
  onAlt?: () => void;
  /** exige digitar esta palavra (ex.: REMOVER) quando há impacto na escala */
  requireWord?: string;
}

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose, icon = "delete", tone = "ms", destructive = true, altLabel, onAlt, requireWord }: ConfirmDialogProps) {
  const wordId = useId();
  const [typed, setTyped] = useState("");
  const allowed = !requireWord || typed.trim() === requireWord;
  return (
    <Dialog
      title={title}
      description={description}
      icon={icon}
      iconTone={tone}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} data-autofocus>
            Cancelar
          </Button>
          {altLabel && onAlt ? (
            <Button variant="secondary" onClick={onAlt}>
              {altLabel}
            </Button>
          ) : null}
          <Button variant={destructive ? "danger" : "primary"} disabled={!allowed} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {requireWord ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={wordId} className="font-bold">
            Digite {requireWord} para confirmar
          </label>
          <input id={wordId} value={typed} onChange={(e) => setTyped(e.target.value)} className="h-12 w-full rounded-md border-[1.5px] border-bd2 bg-sf px-4" autoComplete="off" />
        </div>
      ) : null}
    </Dialog>
  );
}
