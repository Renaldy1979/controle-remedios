"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { aceitarPrivacidadeAction } from "@/server/pg/privacy-actions";
import { FormNotice } from "./AuthFrame";

export function PrivacyAcceptButton() {
  const [pending, setPending] = useState(false);
  const [erro, setErro] = useState("");
  return (
    <div className="flex flex-col gap-3">
      {erro ? <FormNotice kind="error">{erro}</FormNotice> : null}
      <Button
        size="lg"
        icon="verified"
        loading={pending}
        loadingText="Salvando…"
        onClick={async () => {
          setPending(true);
          setErro("");
          const r = await aceitarPrivacidadeAction();
          if (r && !r.ok) {
            setErro(r.message);
            setPending(false);
          }
        }}
      >
        Li e aceito
      </Button>
    </div>
  );
}
