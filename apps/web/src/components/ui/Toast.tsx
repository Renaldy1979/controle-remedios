"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export interface ToastInput {
  icon?: string;
  message: string;
  /** ação "Desfazer" */
  undo?: () => void;
  /** erro não some sozinho */
  error?: boolean;
}

interface ToastState extends ToastInput {
  id: number;
}

const ToastContext = createContext<{ show: (t: ToastInput) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast fora de <ToastProvider>");
  return ctx.show;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback(
    (t: ToastInput) => {
      clearTimeout(timer.current);
      setToast({ ...t, id: ++seq.current });
      if (!t.error) timer.current = setTimeout(() => setToast(null), t.undo ? 8000 : 5000);
    },
    [],
  );

  useEffect(() => () => clearTimeout(timer.current), []);
  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[88px] z-[60] flex justify-center px-4 desk:bottom-6">
        {/* região viva sempre montada para o leitor de tela anunciar */}
        <div role={toast?.error ? "alert" : "status"} aria-live={toast?.error ? "assertive" : "polite"} className="w-full max-w-[520px]">
          {toast ? (
            <div key={toast.id} className="pointer-events-auto flex items-center gap-3 rounded-lg bg-[var(--tst)] py-2 pl-4 pr-2 text-[var(--tstf)] shadow-lg">
              <Icon name={toast.icon ?? (toast.error ? "error" : "check_circle")} size={24} style={{ color: toast.error ? "var(--msbar)" : "var(--tsti)" }} />
              <p className="min-w-0 flex-1 py-2 font-bold">{toast.message}</p>
              {toast.undo ? (
                <button
                  type="button"
                  className="min-h-touch rounded-md px-3 font-bold underline"
                  style={{ color: "var(--tstl)" }}
                  onClick={() => {
                    toast.undo?.();
                    dismiss();
                  }}
                >
                  Desfazer
                </button>
              ) : null}
              {toast.error ? (
                <button type="button" aria-label="Fechar aviso" onClick={dismiss} className="flex h-11 w-11 items-center justify-center rounded-md">
                  <Icon name="close" size={22} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
