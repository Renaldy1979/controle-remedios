"use client";
import { useState } from "react";
import { useActions, useSnapshot } from "@/data";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/Chip";
import { TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { signOut } from "@/server/pg/auth-actions";

/** Minha conta: e-mail, perfil e o WhatsApp (fica PENDENTE; a validação real chega no Lote 4). */
export function AccountScreen() {
  const snap = useSnapshot();
  const actions = useActions();
  const toast = useToast();
  const account = snap.account;
  const [phone, setPhone] = useState(account?.phonePending ? formatPhone(account.phonePending) : "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!account) return null;

  const verified = !!account.phoneVerified;
  const pending = !!account.phonePending;

  const save = async () => {
    const text = phone.trim();
    if (text && !normalizePhone(text)) return setErr("Confira o número com DDD, por exemplo (11) 91234-5678.");
    setErr("");
    setBusy(true);
    const ok = await actions.saveMyPhone(text);
    setBusy(false);
    if (ok === false) return;
    toast({ icon: "check_circle", message: text ? "Número salvo como pendente" : "Número removido" });
  };

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-6">
      <h1 className="font-display text-t1 font-extrabold">Minha conta</h1>
      <section aria-label="Dados da conta" className="rounded-lg border border-bd bg-sf p-4">
        <h2 className="mb-2 font-display text-t2 font-bold">Sua conta</h2>
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[120px_1fr]">
          <dt className="text-ink2">Nome</dt>
          <dd className="font-bold">{account.name}</dd>
          <dt className="text-ink2">E-mail</dt>
          <dd className="break-all font-bold">{account.email}</dd>
          <dt className="text-ink2">Perfil</dt>
          <dd className="font-bold">{snap.member.profileName}</dd>
          <dt className="text-ink2">Família</dt>
          <dd className="font-bold">{snap.family.name}</dd>
        </dl>
      </section>

      <section aria-label="WhatsApp" className="flex flex-col gap-4 rounded-lg border border-bd bg-sf p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-t2 font-bold">WhatsApp</h2>
          {verified ? (
            <StatusChip compact tone="ok" icon="check_circle" label="Verificado" />
          ) : pending ? (
            <StatusChip compact tone="lt" icon="schedule" label="Pendente de validação" />
          ) : (
            <StatusChip compact tone="neu" icon="phone_disabled" label="Não informado" />
          )}
        </div>
        <p className="flex items-start gap-2 text-ink2">
          <Icon name="info" size={22} className="mt-0.5 flex-none text-br" />
          <span>
            Com o WhatsApp validado você recebe lembretes e responde &quot;tomei&quot; pelo celular. <strong>A validação chega no Lote 4.</strong> Até lá o número fica pendente e o portal
            funciona normalmente, sem mensagens.
          </span>
        </p>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <TextField
            label="Celular com DDD"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(11) 91234-5678"
            hint="Deixe em branco para não usar o WhatsApp."
            value={phone}
            error={err}
            onChange={(e) => {
              setPhone(e.target.value);
              setErr("");
            }}
          />
          <div>
            <Button type="submit" icon="check" loading={busy}>
              Salvar número
            </Button>
          </div>
        </form>
      </section>

      <form action={signOut}>
        <Button type="submit" variant="secondary" icon="logout">
          Sair
        </Button>
      </form>
    </div>
  );
}
