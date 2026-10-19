"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useActions, useCan, usePreviewStockDays, useSnapshot } from "@/data";
import { StockCard } from "@/components/domain/StockCard";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { EmptyState, IconBlock } from "@/components/ui/Layout";
import { useToast } from "@/components/ui/Toast";

export function StockPanel() {
  const snap = useSnapshot();
  const canAdjust = useCan("stock.adjust");
  const params = useSearchParams();
  // por urgência: menos dias primeiro; remédios sem estoque registrado vão para o fim
  const sorted = snap.medications.slice().sort((a, b) => Number(a.stock.tracked === false) - Number(b.stock.tracked === false) || a.stock.daysLeft - b.stock.daysLeft);
  const name = (id: string) => snap.patients.find((p) => p.id === id)?.name ?? "";

  if (snap.medications.length === 0) {
    return (
      <EmptyState
        icon="inventory_2"
        title="Nenhum remédio cadastrado"
        text="O estoque é acompanhado por remédio. Cadastre o remédio e o esquema primeiro."
        action={<Link href="/configuracoes/remedios" className="inline-flex min-h-touch items-center gap-1 font-bold text-br">Ir para Remédios</Link>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-start gap-2 rounded-lg bg-pn-bg p-3 text-pn">
        <Icon name="info" size={22} className="mt-0.5" />
        <span>O estoque de colírio e de líquidos é uma estimativa (gotas por ml configurável). Confira o frasco de vez em quando e faça um ajuste manual se precisar.</span>
      </p>

      {canAdjust ? (
        <div className="grid gap-4 wide:grid-cols-2">
          <PurchaseForm initialMed={params.get("med") ?? undefined} />
          <AdjustForm />
        </div>
      ) : null}

      <section aria-label="Estoque por urgência">
        <h3 className="mb-3 font-display text-t2 font-bold">Por urgência</h3>
        <ul className="grid gap-3 sm:grid-cols-2 wide:grid-cols-3">
          {sorted.map((m) => (
            <li key={m.id}>
              <StockCard med={m} patientName={name(m.patientId)} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Movimentações">
        <h3 className="mb-3 font-display text-t2 font-bold">Movimentações</h3>
        <ul className="divide-y divide-bd rounded-lg border border-bd bg-sf">
          {snap.stockMovements.length === 0 ? <li className="p-4 text-ink2">Nenhuma movimentação ainda. Registre uma compra para começar.</li> : null}
          {snap.stockMovements.map((m) => (
            <li key={m.id} className="flex items-center gap-3 p-3">
              <IconBlock name={m.icon} tone={m.tone} size={40} />
              <div>
                <p className="font-bold">{m.text}</p>
                <p className="text-cap text-ink2">{m.sub}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function PurchaseForm({ initialMed }: { initialMed?: string }) {
  const snap = useSnapshot();
  const actions = useActions();
  const preview = usePreviewStockDays();
  const toast = useToast();
  const [medId, setMedId] = useState(snap.medications.some((m) => m.id === initialMed) ? initialMed! : snap.medications[0]!.id);
  const [qty, setQty] = useState("30");
  const [err, setErr] = useState("");
  const med = snap.medications.find((m) => m.id === medId)!;
  const n = Number(qty.replace(",", "."));
  const valid = n > 0;
  const [after, setAfter] = useState<number | null>(null);
  useEffect(() => {
    if (!valid) return setAfter(null);
    let live = true;
    void Promise.resolve(preview(medId, n)).then((d) => live && setAfter(d));
    return () => {
      live = false;
    };
  }, [valid, medId, n, preview]);

  return (
    <form
      aria-label="Registrar compra"
      className="flex flex-col gap-3 rounded-lg border border-bd bg-sf p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return setErr("Informe uma quantidade maior que zero.");
        if ((await actions.registerPurchase(medId, n)) === false) return;
        toast({ icon: "shopping_bag", message: `Compra registrada · ${med.name} +${n}` });
        setQty("");
      }}
    >
      <h3 className="font-display text-t2 font-bold">Registrar compra</h3>
      <SelectField label="Remédio" value={medId} onChange={(e) => setMedId(e.target.value)}>
        {snap.medications.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </SelectField>
      <TextField label={`Quantidade comprada (${med.unitLabel.toLowerCase()})`} inputMode="decimal" value={qty} error={err} onChange={(e) => { setQty(e.target.value); setErr(""); }} />
      {valid && after !== null ? <p className="rounded-md bg-ok-bg p-3 font-bold text-ok" data-testid="purchase-preview">{med.stock.tracked === false ? `Fica com ${after} dias de estoque` : `Passa de ${med.stock.daysLeft} para ${after} dias`}</p> : null}
      <Button type="submit" icon="shopping_bag">Registrar compra</Button>
    </form>
  );
}

function AdjustForm() {
  const snap = useSnapshot();
  const actions = useActions();
  const toast = useToast();
  const [medId, setMedId] = useState(snap.medications[0]!.id);
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const med = snap.medications.find((m) => m.id === medId)!;
  const n = Number(counted.replace(",", "."));

  return (
    <form
      aria-label="Ajuste manual"
      className="flex flex-col gap-3 rounded-lg border border-bd bg-sf p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (counted === "" || !(n >= 0)) return setErr("Informe quanto tem no frasco ou na caixa agora.");
        if (n === med.stock.quantity) return setErr("A quantidade é a mesma que já está registrada.");
        if ((await actions.adjustStock(medId, n, reason)) === false) return;
        toast({ icon: "tune", message: `Ajuste registrado · ${med.name}` });
        setCounted("");
        setReason("");
      }}
    >
      <h3 className="font-display text-t2 font-bold">Ajuste manual</h3>
      <SelectField label="Remédio" value={medId} onChange={(e) => setMedId(e.target.value)}>
        {snap.medications.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </SelectField>
      <TextField label={`Quanto tem agora (${med.unitLabel.toLowerCase()})`} hint={`Registrado: ${med.stock.quantityText}`} inputMode="decimal" value={counted} error={err} onChange={(e) => { setCounted(e.target.value); setErr(""); }} />
      <TextField label="Motivo" optional value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: conferi o frasco" />
      <Button type="submit" variant="secondary" icon="tune">Registrar ajuste</Button>
    </form>
  );
}
