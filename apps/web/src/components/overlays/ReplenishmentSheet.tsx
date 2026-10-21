"use client";
import { useState } from "react";
import { useActions, useCan, useDataKind, useSnapshot, type MedicationVM } from "@/data";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { useOverlay } from "@/components/app/overlay-context";
import { ReplSteps } from "@/components/domain/Replenishment";
import { useReplenishmentActions } from "@/components/domain/useReplenishmentActions";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";

/** Sheet de reposição: 4 etapas, responsável com data, registros. */
export function ReplenishmentSheet({ medId }: { medId: string }) {
  const { close } = useOverlay();
  const snap = useSnapshot();
  const canManage = useCan("replenishment.manage");
  const med = snap.medications.find((m) => m.id === medId);
  if (!med) return null;
  return <Sheet med={med} onClose={close} canManage={canManage} patientName={snap.patients.find((p) => p.id === med.patientId)?.name ?? ""} />;
}

function Sheet({ med, onClose: close, canManage, patientName }: { med: MedicationVM; onClose: () => void; canManage: boolean; patientName: string }) {
  const rep = useReplenishmentActions(med);
  const actions = useActions();
  const toast = useToast();
  const real = useDataKind() === "postgres";
  const [cancelling, setCancelling] = useState(false);
  const r = med.replenishment;
  const opened = r.steps.length > 0;

  return (
    <Dialog title={`Reposição de ${med.name}`} description={`${patientName} · ${med.stock.daysLeft} dias de estoque`} icon="checklist" size="md" onClose={close} footer={<Button variant="secondary" onClick={close}>Fechar</Button>}>
      {opened ? (
        <ReplSteps repl={r} canManage={canManage} onAssume={() => void rep.assume()} onAdvance={() => void rep.advance()} />
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-bd bg-sf2 p-4">
          <p className="font-bold">Ainda não há reposição aberta para este remédio.</p>
          <p className="text-ink2">Ela abre sozinha quando o estoque chega ao limite. Se quiser, comece agora.</p>
          {canManage ? <Button icon="front_hand" onClick={() => void rep.assume()}>Eu cuido disso</Button> : null}
        </div>
      )}
      {real && opened && !r.done && canManage ? (
        <Button variant="dangerOutline" icon="cancel" className="mt-2 self-start" onClick={() => setCancelling(true)}>
          Cancelar reposição
        </Button>
      ) : null}
      {cancelling ? (
        <ConfirmDialog
          title="Cancelar esta reposição?"
          description="Use quando não precisa mais repor agora. Ela volta a abrir sozinha se o estoque continuar baixo."
          confirmLabel="Cancelar reposição"
          onClose={() => setCancelling(false)}
          onConfirm={async () => {
            setCancelling(false);
            if ((await actions.cancelReplenishment(med.id)) === false) return;
            toast({ icon: "cancel", message: "Reposição cancelada" });
          }}
        />
      ) : null}
      <h3 className="mb-2 mt-2 font-display text-t2 font-bold">Registros</h3>
      {r.log.length === 0 ? (
        <p className="text-ink2">Nenhum registro ainda.</p>
      ) : (
        <ul className="divide-y divide-bd rounded-lg border border-bd">
          {r.log.map((l, i) => (
            <li key={i} className="p-3">
              <p className="font-bold">{l.text}</p>
              <p className="text-cap text-ink2">{l.sub}</p>
            </li>
          ))}
        </ul>
      )}
      {rep.dialog}
    </Dialog>
  );
}
