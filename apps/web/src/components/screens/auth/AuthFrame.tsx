import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";

/** Moldura das telas de entrada: faixa de marca no desktop, só o formulário no celular. Sem hooks (serve a páginas de servidor). */
export function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main id="conteudo" className="grid min-h-dvh desk:grid-cols-2">
      <section className="hidden flex-col justify-between bg-br p-12 text-onbr desk:flex" aria-hidden="true">
        <span className="flex items-center gap-3 font-display text-t1 font-extrabold">
          <Icon name="medication" size={40} />
          MedCuidar
        </span>
        <div>
          <p className="font-display text-display font-extrabold">Cada remédio na hora certa.</p>
          <p className="mt-3 max-w-[420px] text-body-lg opacity-90">Lembretes no WhatsApp, estoque que avisa antes de acabar e receitas guardadas em segurança.</p>
        </div>
        <span className="text-cap opacity-80">Para a família cuidar junta.</span>
      </section>

      <section className="flex items-center justify-center p-4 desk:p-12">
        <div className="flex w-full max-w-[420px] flex-col gap-6">
          <span className="flex items-center gap-2.5 font-display text-t2 font-extrabold desk:hidden">
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-br text-onbr">
              <Icon name="medication" size={26} />
            </span>
            MedCuidar
          </span>
          <div>
            <h1 className="font-display text-t1 font-extrabold">{title}</h1>
            {subtitle ? <p className="mt-1 text-ink2">{subtitle}</p> : null}
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

/** Aviso dentro dos formulários: ícone + texto (o estado nunca é só cor). */
export function FormNotice({ kind, children }: { kind: "error" | "ok"; children: ReactNode }) {
  return (
    <p role={kind === "error" ? "alert" : "status"} className={kind === "error" ? "flex items-start gap-2 rounded-md border border-ms-bd bg-ms-bg p-3 font-bold text-ms" : "flex items-start gap-2 rounded-md border border-bd bg-ok-bg p-3 font-bold text-ok"}>
      <Icon name={kind === "error" ? "error" : "check_circle"} size={22} className="mt-0.5 flex-none" />
      <span>{children}</span>
    </p>
  );
}
