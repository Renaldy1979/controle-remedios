"use client";
import { useActions, useCan, useSnapshot } from "@/data";
import { useOverlay } from "@/components/app/overlay-context";
import { ReplSteps } from "@/components/domain/Replenishment";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

/** Sheet de reposição: 4 etapas, responsável com data, registros. */
export function ReplenishmentSheet({ medId }: { medId: string }) {
  const { close, open } = useOverlay();
  const snap = useSnapshot();
  const actions = useActions();
  const toast = useToast();
  const canManage = useCan("replenishment.manage");
  const med = snap.medications.find((m) => m.id === medId);
  if (!med) return null;
  const r = med.replenishment;
  const patient = snap.patients.find((p) => p.id === med.patientId);

  return (
    <Dialog title={`Reposição de ${med.name}`} description={`${patient?.name ?? ""} · ${med.stock.daysLeft} dias de estoque`} icon="checklist" size="md" onClose={close} footer={<Button variant="secondary" onClick={close}>Fechar</Button>}>
      <ReplSteps
        repl={r}
        canManage={canManage}
        onAssume={() => {
          actions.assumeReplenishment(medId);
          toast({ icon: "front_hand", message: "Combinado. A família foi avisada." });
        }}
        onAdvance={() => {
          if (r.needsAttach) {
            open({ type: "attach", preset: { patientId: med.patientId, medicationIds: [med.id] } });
            return;
          }
          actions.advanceReplenishment(medId);
          toast({ icon: "task_alt", message: "Etapa concluída" });
        }}
      />
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
    </Dialog>
  );
}
