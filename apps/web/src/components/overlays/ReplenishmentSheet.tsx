"use client";
import { useCan, useSnapshot, type MedicationVM } from "@/data";
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
  const r = med.replenishment;

  return (
    <Dialog title={`Reposição de ${med.name}`} description={`${patientName} · ${med.stock.daysLeft} dias de estoque`} icon="checklist" size="md" onClose={close} footer={<Button variant="secondary" onClick={close}>Fechar</Button>}>
      <ReplSteps repl={r} canManage={canManage} onAssume={() => void rep.assume()} onAdvance={() => void rep.advance()} />
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
