"use client";
import { cx } from "@/lib/format";
import { STOCK_LEVEL, STOCK_TEXT, TONE_BG } from "@/lib/status";
import { useCan, type MedicationVM } from "@/data";
import { Button, ButtonLink } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { StockBar } from "@/components/ui/Layout";
import { useOverlay } from "@/components/app/overlay-context";
import { ReplProgressCompact } from "./Replenishment";
import { useReplenishmentActions } from "./useReplenishmentActions";

interface StockCardProps {
  med: MedicationVM;
  patientName: string;
  /** mostra situação da receita, reposição e ações (tela Início) */
  withActions?: boolean;
}

/** Cartão de estoque: dias na cor do nível, barra de 30 dias, chip de nível; colírio/líquido = estimativa. */
export function StockCard({ med, patientName, withActions }: StockCardProps) {
  const lvl = STOCK_LEVEL[med.stock.level];
  const { open } = useOverlay();
  const rep = useReplenishmentActions(med);
  const canViewRx = useCan("prescriptions.view");
  const canUpload = useCan("prescriptions.upload");
  const canRepl = useCan("replenishment.manage");
  const canStock = useCan("stock.adjust");

  const r = med.replenishment;
  const rxId = med.rx.rxId;

  return (
    <article aria-label={`${med.name}, ${patientName}: ${med.stock.daysLeft} dias, ${lvl.label}`} className="flex flex-col gap-3 rounded-lg border border-bd bg-sf p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-t3 font-bold">{med.name}</h3>
          <p className="text-ink2">{patientName}</p>
        </div>
        <StatusChip compact label={lvl.label} icon={lvl.icon} tone={lvl.tone} />
      </div>
      <div className="flex items-baseline gap-3">
        <span className={cx("num text-t1 font-extrabold", STOCK_TEXT[med.stock.level])}>{med.stock.daysLeft === 1 ? "1 dia" : `${med.stock.daysLeft} dias`}</span>
        <span className="text-ink2">{med.stock.runsOutLabel}</span>
      </div>
      <StockBar pct={med.stock.barPct} level={med.stock.level} label={`${med.stock.daysLeft} dias de estoque numa escala de 30 dias`} />
      <p className="text-cap text-ink2">{med.stock.quantityText}</p>
      {med.stock.approximate ? (
        <p className="flex items-start gap-1.5 text-cap text-ink2">
          <Icon name="info" size={18} className="mt-0.5 text-br" />
          Estimativa · {med.stock.approximateNote}
        </p>
      ) : null}

      {withActions ? (
        <>
          <p className={cx("inline-flex w-fit items-center gap-1.5 rounded-pill px-3 py-1 text-cap font-bold", TONE_BG[med.rx.tone])}>
            <Icon name={med.rx.icon} size={18} />
            {med.rx.text}
          </p>
          <ReplProgressCompact repl={r} />
          <div className="flex flex-wrap gap-2">
            {med.rx.kind === "otc" ? (
              canStock ? (
                <ButtonLink href={`/configuracoes/estoque?med=${med.id}`} variant="secondary" icon="shopping_bag">
                  Registrar compra
                </ButtonLink>
              ) : null
            ) : rxId ? (
              canViewRx ? (
                <Button variant="secondary" icon="description" onClick={() => open({ type: "viewer", rxId, page: 0 })}>
                  Ver receita
                </Button>
              ) : null
            ) : canUpload ? (
              <Button variant="secondary" icon="add_a_photo" onClick={() => open({ type: "attach", preset: { patientId: med.patientId, medicationIds: [med.id] } })}>
                Anexar receita
              </Button>
            ) : null}
            {canRepl ? (
              !r.done && !r.owner ? (
                <Button icon="front_hand" onClick={() => void rep.assume()}>
                  Eu cuido disso
                </Button>
              ) : !r.done && r.mine ? (
                <Button icon="task_alt" onClick={() => void rep.advance()}>
                  Marcar etapa feita
                </Button>
              ) : (
                <Button variant="secondary" icon="checklist" onClick={() => open({ type: "replenishment", medId: med.id })}>
                  Ver reposição
                </Button>
              )
            ) : null}
          </div>
        </>
      ) : null}
      {rep.dialog}
    </article>
  );
}
