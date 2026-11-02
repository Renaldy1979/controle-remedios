"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { cancelarExclusaoAction } from "@/server/pg/privacy-actions";
import { FormNotice } from "./AuthFrame";

export function CancelDeletionButton() {
  const [pending, setPending] = useState(false);
  const [erro, setErro] = useState("");
  return (
    <div className="flex flex-col gap-3">
      {erro ? <FormNotice kind="error">{erro}</FormNotice> : null}
      <Button
        size="lg"
        icon="undo"
        loading={pending}
        loadingText="Cancelando…"
        onClick={async () => {
          setPending(true);
          setErro("");
          const r = await cancelarExclusaoAction();
          if (r && !r.ok) {
            setErro(r.message);
            setPending(false);
          }
        }}
      >
        Cancelar a exclusão
      </Button>
    </div>
  );
}
