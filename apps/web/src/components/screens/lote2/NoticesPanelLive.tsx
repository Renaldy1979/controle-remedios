"use client";
import { useState } from "react";
import { can } from "@medcuidar/shared";
import { useActions, useSnapshot } from "@/data";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Block, CommitField } from "../settings/NoticesPanel";

/** Avisos do Lote 2: limite de estoque baixo (padrão e por remédio), prazos de atraso/esquecida e quem é avisado no sino. */
export function NoticesPanelLive() {
  const snap = useSnapshot();
  const actions = useActions();
  const n = snap.notifications;
  const [excMed, setExcMed] = useState(snap.medications[0]?.id ?? "");
  const [excDays, setExcDays] = useState("10");
  const medName = (id: string) => snap.medications.find((m) => m.id === id)?.name ?? id;
  const buyers = snap.people.filter((p) => p.active !== false && p.accessState === "active" && (can(p, "stock.adjust") || can(p, "replenishment.manage")));

  return (
    <div className="grid gap-4 wide:grid-cols-2 wide:items-start">
      <Block title="Estoque baixo">
        <div className="flex items-center gap-2" role="group" aria-label="Antecedência padrão">
          <IconButton icon="remove" label="Diminuir antecedência" className="border-[1.5px] border-bd2" disabled={n.leadDays <= 1} onClick={() => actions.setNotification({ leadDays: n.leadDays - 1 })} />
          <span className="num w-28 text-center text-t2 font-extrabold" aria-live="polite" data-testid="lead-days">{n.leadDays} dias</span>
          <IconButton icon="add" label="Aumentar antecedência" className="border-[1.5px] border-bd2" disabled={n.leadDays >= 60} onClick={() => actions.setNotification({ leadDays: n.leadDays + 1 })} />
        </div>
        <p className="text-cap text-ink2">Quando o estoque de um remédio durar esse tempo ou menos, o sino do portal avisa quem pode comprar. É o limite padrão da família.</p>
        <div>
          <p className="mb-1 font-bold">Limite por remédio</p>
          {n.exceptions.length ? (
            <ul className="mb-2 flex flex-col gap-1">
              {n.exceptions.map((e) => (
                <li key={e.medicationId} className="flex items-center justify-between rounded-md bg-sf2 px-3">
                  <span>
                    {medName(e.medicationId)} · <strong>{e.days} dias</strong>
                  </span>
                  <IconButton icon="delete" label={`Remover limite de ${medName(e.medicationId)}`} onClick={() => actions.setNotification({ exceptions: n.exceptions.filter((x) => x.medicationId !== e.medicationId) })} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-2 text-ink2">Nenhum. Todos os remédios usam o limite padrão.</p>
          )}
          {snap.medications.length ? (
            <div className="grid grid-cols-[1fr_96px_auto] items-end gap-2">
              <SelectField label="Remédio" value={excMed} onChange={(e) => setExcMed(e.target.value)}>
                {snap.medications.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </SelectField>
              <TextField label="Dias" inputMode="numeric" value={excDays} onChange={(e) => setExcDays(e.target.value)} />
              <Button variant="secondary" icon="add" aria-label="Adicionar limite" disabled={!(Number(excDays) > 0)} onClick={() => actions.setNotification({ exceptions: [...n.exceptions.filter((x) => x.medicationId !== excMed), { medicationId: excMed, days: Number(excDays) }] })} />
            </div>
          ) : null}
        </div>
      </Block>

      <Block title="Quem recebe o aviso de estoque">
        <p className="text-ink2">O aviso aparece no sino de todas as pessoas ativas que podem registrar compras ou cuidar da reposição, e dos administradores. Quem não validou o WhatsApp vê o aviso só no portal.</p>
        {buyers.length ? (
          <ul className="flex flex-col">
            {buyers.map((p) => (
              <li key={p.id} className="flex min-h-touch items-center gap-3">
                <Avatar name={p.name} role={p.role} size={36} />
                <span className="flex-1 font-bold">{p.name}</span>
                <span className="text-cap text-ink2">{p.whatsappActive ? "Portal e WhatsApp" : "Só no portal"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink2">Ninguém com permissão de compra ainda. Ajuste em Perfis.</p>
        )}
      </Block>

      <Block title="Doses">
        <div className="grid gap-3 sm:grid-cols-2">
          <CommitField label="Atrasada após (min)" inputMode="numeric" value={String(n.lateAfterMin)} onCommit={(v) => actions.setNotification({ lateAfterMin: Number(v.replace(/\D/g, "")) || 1 })} />
          <CommitField label="Esquecida após (min)" inputMode="numeric" value={String(n.missedAfterMin)} onCommit={(v) => actions.setNotification({ missedAfterMin: Number(v.replace(/\D/g, "")) || 1 })} />
        </div>
        <p className="text-cap text-ink2">Uma dose fica &quot;atrasada&quot; depois do primeiro prazo e &quot;esquecida&quot; depois do segundo. A de esquecida precisa ser maior.</p>
      </Block>

      <section className="flex items-start gap-3 rounded-lg border border-bd bg-pn-bg p-4 text-pn">
        <Icon name="info" size={22} className="mt-0.5 flex-none" />
        <p>Lembretes pelo WhatsApp, repetição, resumo diário e escolha de quem recebe cada aviso chegam no Lote 4.</p>
      </section>
    </div>
  );
}
