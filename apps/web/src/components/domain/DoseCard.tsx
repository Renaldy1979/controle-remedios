"use client";
import Link from "next/link";
import { cx } from "@/lib/format";
import { DOSE_STATUS, CHANNEL } from "@/lib/status";
import type { DoseVM } from "@/data";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { IconBlock } from "@/components/ui/Layout";

export type DoseCardVariant = "featured" | "compact" | "late" | "missed" | "taken";

interface DoseCardProps {
  dose: DoseVM;
  variant?: DoseCardVariant;
  /** esconde as ações quando o perfil não pode confirmar */
  canConfirm?: boolean;
  onConfirm?: (d: DoseVM) => void;
  onSnooze?: (d: DoseVM) => void;
  showPatient?: boolean;
}

/** Cartão de dose r16 (design.md 3). Ação "Confirmar dose" h48–52. */
export function DoseCard({ dose, variant = "compact", canConfirm = true, onConfirm, onSnooze, showPatient = true }: DoseCardProps) {
  const st = DOSE_STATUS[dose.status];
  const featured = variant === "featured";
  const late = variant === "late";
  const missed = variant === "missed";
  const taken = variant === "taken";
  const label = `${dose.medName}, ${dose.patientName}, ${dose.time}, ${st.label}`;

  return (
    <article
      aria-label={label}
      className={cx(
        "rounded-lg border bg-sf shadow-sm",
        late && "border-lt-bd bg-lt-sf",
        missed && "border-ms-bd",
        !late && !missed && "border-bd",
        featured && "border-[1.5px] border-br shadow-md",
      )}
    >
      {late ? (
        <div className="flex items-center gap-2 rounded-t-lg bg-lt-bg px-4 py-2 font-bold text-lt">
          <Icon name="alarm" size={20} />
          {dose.whenLabel}
        </div>
      ) : null}
      {missed ? (
        <div className="flex items-center gap-2 rounded-t-lg bg-ms-bg px-4 py-2 font-bold text-ms">
          <Icon name="cancel" size={20} />
          Esquecida · ninguém confirmou
        </div>
      ) : null}
      <div className={cx("flex gap-3 p-4", taken && "items-center py-3")}>
        <IconBlock name={taken ? "check_circle" : late ? "alarm" : missed ? "cancel" : "medication"} tone={taken ? "ok" : late ? "lt" : missed ? "ms" : "br"} size={featured ? 52 : 48} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className={cx("num font-extrabold", featured ? "text-time-lg" : "text-time", missed && "line-through decoration-2")}>{dose.time}</span>
            {variant === "featured" || variant === "compact" ? <span className="font-bold text-pn">{dose.whenLabel}</span> : null}
          </div>
          <p className="text-t3 font-bold">{dose.medName}</p>
          <p className="text-ink2">
            {dose.doseText}
            {showPatient ? <span> · {dose.patientName}</span> : null}
          </p>
          {taken ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-cap text-ink2">
              <StatusChip compact label={st.label} icon={st.icon} tone={st.tone} />
              {dose.doneBy ? <span>{dose.doneBy}</span> : null}
              {dose.doneAt ? <span className="num">{dose.doneAt}</span> : null}
              {dose.channel ? (
                <span className="inline-flex items-center gap-1">
                  <Icon name={CHANNEL[dose.channel].icon} size={16} />
                  {CHANNEL[dose.channel].label}
                </span>
              ) : null}
            </p>
          ) : (
            <p className="mt-0.5 text-cap text-ink2">
              Quem dá: <strong>{dose.responsible}</strong> · {dose.phaseText}
            </p>
          )}
        </div>
      </div>
      {!taken && canConfirm ? (
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          {variant === "missed" ? (
            <>
              <Button size="md" variant="primary" icon="edit_note" onClick={() => onConfirm?.(dose)}>
                Registrar que tomou depois
              </Button>
              <Link href="/historico" className="inline-flex h-12 items-center gap-2 rounded-md px-4 font-bold text-br hover:bg-brt">
                Ver histórico
              </Link>
            </>
          ) : (
            <>
              <Button size={featured ? "lg" : "md"} variant="primary" icon="check" onClick={() => onConfirm?.(dose)} className={featured ? "w-full desk:w-auto" : undefined} aria-label={`Confirmar dose de ${dose.medName} das ${dose.time}`}>
                Confirmar dose
              </Button>
              {late ? (
                <Button size="md" variant="secondary" icon="notifications_active" onClick={() => onSnooze?.(dose)}>
                  Lembrar de novo
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}
