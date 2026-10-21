"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * undefined = fora de uma página com título (a ação aparece onde foi escrita);
 * null = a linha do título ainda não montou; elemento = onde a ação deve aparecer.
 */
const SlotContext = createContext<HTMLElement | null | undefined>(undefined);

/**
 * Título da página com a ação principal NA MESMA LINHA (ganha espaço vertical no desktop). Quando o título e o botão
 * não cabem juntos (celular), o botão desce sozinho. As telas declaram a ação com `<PageAction>`.
 */
export function PageWithAction({ title, children }: { title: string; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <SlotContext.Provider value={slot}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="font-display text-t1 font-extrabold">{title}</h1>
        <div ref={setSlot} className="flex flex-none flex-wrap gap-2" />
      </div>
      {children}
    </SlotContext.Provider>
  );
}

/** Ação principal da página (ex.: "Novo remédio"): vai para a linha do título; fora de uma página com título, fica no lugar. */
export function PageAction({ children }: { children: ReactNode }) {
  const slot = useContext(SlotContext);
  if (slot === undefined) return <>{children}</>;
  if (slot === null) return null;
  return createPortal(children, slot);
}
