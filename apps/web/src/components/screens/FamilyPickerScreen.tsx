"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { chooseFamilyAction } from "@/server/auth-actions";

interface Props {
  families: Array<{ id: string; name: string }>;
  currentId?: string;
  /** só para testes: troca a ação do servidor */
  onChoose?: (id: string) => Promise<{ ok: boolean }>;
}

/** Depois do código, quando o telefone está em mais de uma família: escolher qual abrir. */
export function FamilyPickerScreen({ families, currentId, onChoose = chooseFamilyAction }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const choose = async (id: string) => {
    setBusy(id);
    setErr("");
    const r = await onChoose(id).catch(() => ({ ok: false }));
    if (r.ok) window.location.assign("/");
    else {
      setBusy(null);
      setErr("Não foi possível abrir essa família. Entre de novo.");
    }
  };

  return (
    <main id="conteudo" className="flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-full max-w-[440px] flex-col gap-5">
        <div>
          <h1 className="font-display text-t1 font-extrabold">Qual família?</h1>
          <p className="mt-1 text-ink2">Seu número está cadastrado em mais de uma família. Escolha qual abrir agora.</p>
        </div>
        <ul className="flex flex-col gap-3">
          {families.map((f) => (
            <li key={f.id}>
              <Button variant={f.id === currentId ? "primary" : "secondary"} size="lg" icon="groups" full loading={busy === f.id} loadingText="Abrindo…" disabled={busy !== null && busy !== f.id} onClick={() => void choose(f.id)}>
                {f.name}
                {f.id === currentId ? " (atual)" : ""}
              </Button>
            </li>
          ))}
        </ul>
        {err ? (
          <p role="alert" className="flex items-center gap-1.5 font-bold text-ms">
            <Icon name="error" size={18} />
            {err}
          </p>
        ) : null}
      </div>
    </main>
  );
}
