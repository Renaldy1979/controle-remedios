"use client";
import { useCallback } from "react";
import { useActions } from "@/data";
import type { DoseVM } from "@/data";
import { useToast } from "@/components/ui/Toast";

/** Confirmar dose com Desfazer por 8 s, lembrar em 15 min, registrar depois. */
export function useDoseActions() {
  const actions = useActions();
  const toast = useToast();

  const confirm = useCallback(
    (d: DoseVM) => {
      actions.confirmDose(d.id);
      toast({ icon: "check_circle", message: `${d.medName} das ${d.time} confirmada`, undo: () => actions.undoDose(d.id) });
    },
    [actions, toast],
  );

  const snooze = useCallback(
    (d: DoseVM) => {
      actions.snoozeDose(d.id, 15);
      toast({ icon: "notifications_active", message: `Vamos lembrar de novo em 15 min · ${d.medName}` });
    },
    [actions, toast],
  );

  return { confirm, snooze };
}
