"use client";
import { useState, type ReactNode } from "react";
import { useActions, type MedicationVM } from "@/data";
import { useOverlay } from "@/components/app/overlay-context";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

/** "Eu cuido disso" e "Marcar como feito" da reposição, com os desvios: anexar receita (etapa 2) e quantidade comprada (etapa 3). */
export function useReplenishmentActions(med: MedicationVM): { assume: () => Promise<void>; advance: () => Promise<void>; dialog: ReactNode } {
  const actions = useActions();
  const toast = useToast();
  const { open } = useOverlay();
  const [asking, setAsking] = useState(false);
  const r = med.replenishment;

  const assume = async () => {
    if ((await actions.assumeReplenishment(med.id)) === false) return;
    toast({ icon: "front_hand", message: `Combinado: ${med.name}. A família foi avisada.` });
  };

  const advance = async () => {
    if (r.needsAttach) {
      open({ type: "attach", preset: { patientId: med.patientId, medicationIds: [med.id] } });
      return;
    }
    if (r.needsQuantity) {
      setAsking(true);
      return;
    }
    if ((await actions.advanceReplenishment(med.id)) === false) return;
    toast({ icon: "task_alt", message: "Etapa concluída" });
  };

  const dialog = asking ? (
    <QuantityDialog
      medName={med.name}
      unit={med.unitLabel.toLowerCase()}
      suggested={r.suggestedQuantity}
      onClose={() => setAsking(false)}
      onConfirm={async (q) => {
        setAsking(false);
        if ((await actions.advanceReplenishment(med.id, { quantity: q })) === false) return;
        toast({ icon: "task_alt", message: `Compra registrada: ${q} ${med.unitLabel.toLowerCase()}` });
      }}
    />
  ) : null;

  return { assume, advance, dialog };
}

function QuantityDialog({ medName, unit, suggested, onClose, onConfirm }: { medName: string; unit: string; suggested?: number; onClose: () => void; onConfirm: (q: number) => void }) {
  const [v, setV] = useState(suggested ? String(suggested) : "");
  const [err, setErr] = useState("");
  const submit = () => {
    const n = Number(v.replace(",", "."));
    if (!(n > 0)) return setErr("Informe quantas unidades foram compradas.");
    onConfirm(n);
  };
  return (
    <Dialog
      title="Quanto foi comprado?"
      description={medName}
      icon="shopping_bag"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit}>Confirmar compra</Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <TextField label={`Quantidade comprada (${unit})`} inputMode="decimal" data-autofocus value={v} error={err} onChange={(e) => { setV(e.target.value); setErr(""); }} />
      </form>
    </Dialog>
  );
}
