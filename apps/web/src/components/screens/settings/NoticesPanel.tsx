"use client";
import { useState } from "react";
import { useActions, useSnapshot } from "@/data";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { SelectChip } from "@/components/ui/Chip";
import { Switch } from "@/components/ui/Controls";
import { SelectField, TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-bd bg-sf p-4">
      <h3 className="font-display text-t2 font-bold">{title}</h3>
      {children}
    </section>
  );
}

export function NoticesPanel() {
  const snap = useSnapshot();
  const actions = useActions();
  const n = snap.notifications;
  const [excMed, setExcMed] = useState(snap.medications[0]?.id ?? "");
  const [excDays, setExcDays] = useState("10");
  const familyPeople = snap.people.filter((p) => ["admin", "family"].includes(p.role));
  const medName = (id: string) => snap.medications.find((m) => m.id === id)?.name ?? id;

  return (
    <div className="grid gap-4 wide:grid-cols-2 wide:items-start">
      <Block title="Estoque baixo">
        <div className="flex items-center gap-2" role="group" aria-label="Antecedência padrão">
          <IconButton icon="remove" label="Diminuir antecedência" className="border-[1.5px] border-bd2" disabled={n.leadDays <= 1} onClick={() => actions.setNotification({ leadDays: n.leadDays - 1 })} />
          <span className="num w-28 text-center text-t2 font-extrabold" aria-live="polite">{n.leadDays} dias</span>
          <IconButton icon="add" label="Aumentar antecedência" className="border-[1.5px] border-bd2" disabled={n.leadDays >= 30} onClick={() => actions.setNotification({ leadDays: n.leadDays + 1 })} />
        </div>
        <p className="text-cap text-ink2">Avisar a família quando faltar esse tempo para o estoque acabar.</p>
        <div>
          <p className="mb-1 font-bold">Exceções por remédio</p>
          {n.exceptions.length ? (
            <ul className="mb-2 flex flex-col gap-1">
              {n.exceptions.map((e) => (
                <li key={e.medicationId} className="flex items-center justify-between rounded-md bg-sf2 px-3">
                  <span>{medName(e.medicationId)} · <strong>{e.days} dias</strong></span>
                  <IconButton icon="delete" label={`Remover exceção de ${medName(e.medicationId)}`} onClick={() => actions.setNotification({ exceptions: n.exceptions.filter((x) => x.medicationId !== e.medicationId) })} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-2 text-ink2">Nenhuma exceção.</p>
          )}
          <div className="grid grid-cols-[1fr_96px_auto] items-end gap-2">
            <SelectField label="Remédio" value={excMed} onChange={(e) => setExcMed(e.target.value)}>
              {snap.medications.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </SelectField>
            <TextField label="Dias" inputMode="numeric" value={excDays} onChange={(e) => setExcDays(e.target.value)} />
            <Button variant="secondary" icon="add" aria-label="Adicionar exceção" disabled={!(Number(excDays) > 0)} onClick={() => actions.setNotification({ exceptions: [...n.exceptions.filter((x) => x.medicationId !== excMed), { medicationId: excMed, days: Number(excDays) }] })} />
          </div>
        </div>
      </Block>

      <Block title="Quem recebe os avisos">
        <ul className="flex flex-col">
          {familyPeople.map((p) => (
            <li key={p.id} className="flex items-center gap-3">
              <Avatar name={p.name} role={p.role} size={36} />
              <span className="flex-1 font-bold">{p.name}</span>
              <Switch label={`${p.name} recebe avisos`} hideLabel checked={!!n.receivers[p.name]} onChange={(v) => actions.setNotification({ receivers: { ...n.receivers, [p.name]: v } })} />
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Doses">
        <Switch label="Lembrete na hora da dose" checked={n.reminderAtTime} onChange={(v) => actions.setNotification({ reminderAtTime: v })} />
        <div>
          <p className="mb-1.5 font-bold">Repetir o lembrete a cada</p>
          <div role="group" aria-label="Repetir lembrete" className="flex flex-wrap gap-2">
            {([15, 30, 60] as const).map((m) => (
              <SelectChip key={m} selected={n.repeatEveryMin === m} onToggle={() => actions.setNotification({ repeatEveryMin: m })}>
                {m === 60 ? "1 hora" : `${m} min`}
              </SelectChip>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Atrasada após (min)" inputMode="numeric" value={String(n.lateAfterMin)} onChange={(e) => actions.setNotification({ lateAfterMin: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
          <TextField label="Esquecida após (min)" inputMode="numeric" value={String(n.missedAfterMin)} onChange={(e) => actions.setNotification({ missedAfterMin: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
        </div>
        <SelectField label="À noite, quem confirma" value={n.nightTo} onChange={(e) => actions.setNotification({ nightTo: e.target.value })}>
          {snap.people.map((p) => <option key={p.id}>{p.name}</option>)}
        </SelectField>
      </Block>

      <Block title="Resumo diário">
        <Switch label="Enviar o resumo do dia para a família" checked={n.dailySummary} onChange={(v) => actions.setNotification({ dailySummary: v })} />
        <TextField label="Horário do resumo" inputMode="numeric" value={n.summaryTime} disabled={!n.dailySummary} onChange={(e) => actions.setNotification({ summaryTime: e.target.value })} />
        <p className="flex items-center gap-2 text-cap text-ink2">
          <Icon name="schedule" size={16} />
          Horário no fuso de São Paulo, em 24h.
        </p>
      </Block>
    </div>
  );
}
