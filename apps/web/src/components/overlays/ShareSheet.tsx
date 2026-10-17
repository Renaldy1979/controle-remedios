"use client";
import { useState } from "react";
import { cx } from "@/lib/format";
import { useActions, useSnapshot } from "@/data";
import { useOverlay } from "@/components/app/overlay-context";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Checkbox, RadioGroup } from "@/components/ui/Controls";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea, TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Tabs, tabPanelProps } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";

type Purpose = "pharmacy" | "buyer" | "other";
type Target = "pharmacy" | "group" | "buyer" | "other";

const PURPOSE_TEXT: Record<Purpose, (p: string, meds: string) => string> = {
  pharmacy: (p, meds) => `Olá! Segue a receita de ${p} (${meds}). Pode separar para retirada?`,
  buyer: (p, meds) => `Oi! Esta é a receita de ${p} (${meds}) para a compra. Avise quando comprar, por favor.`,
  other: (p, meds) => `Receita de ${p}: ${meds}.`,
};

/** Compartilhar: aba "Na família" (pessoas) e "Pelo WhatsApp" (finalidade, destino, mensagem editável, prévia). */
export function ShareSheet({ rxId, initialTab = "family" }: { rxId: string; initialTab?: "family" | "whatsapp" }) {
  const { close } = useOverlay();
  const snap = useSnapshot();
  const actions = useActions();
  const toast = useToast();
  const rx = snap.prescriptions.find((r) => r.id === rxId);
  const [tab, setTab] = useState<"family" | "whatsapp">(initialTab);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [purpose, setPurpose] = useState<Purpose>("pharmacy");
  const [target, setTarget] = useState<Target>("pharmacy");
  const [other, setOther] = useState("");
  const [otherErr, setOtherErr] = useState("");
  const meds = rx?.medNames.join(", ") ?? "";
  const patient = rx?.patientName ?? "";
  const [msg, setMsg] = useState(() => PURPOSE_TEXT.pharmacy(patient, meds));
  if (!rx) return null;

  const buyer = snap.medications.find((m) => rx.medicationIds.includes(m.id) && m.replenishment.owner)?.replenishment.owner;
  const targetName: Record<Target, string> = { pharmacy: "Farmácia São João", group: "Grupo da família", buyer: buyer ?? "Quem assumiu a compra", other: other || "outro número" };
  const chosen = snap.people.filter((p) => sel[p.id]);

  const sendFamily = async () => {
    if (!chosen.length) return;
    if ((await actions.shareRx(rx.id, { memberIds: chosen.map((p) => p.id), label: chosen.map((p) => p.name).join(" e ") }, "MedCuidar")) === false) return;
    toast({ icon: "share", message: `Receita compartilhada com ${chosen.map((p) => p.name).join(", ")}` });
    close();
  };

  const sendWhatsApp = async () => {
    if (target === "other" && !/^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$/.test(other.trim())) {
      setOtherErr("Informe o número com DDD, por exemplo (11) 91234-5678.");
      return;
    }
    const buyerId = snap.people.find((p) => p.name === buyer)?.id;
    const dest = target === "buyer" && buyerId ? { memberIds: [buyerId] } : target === "other" ? { phone: other.trim() } : {};
    if ((await actions.shareRx(rx.id, { ...dest, label: targetName[target], message: msg }, "WhatsApp")) === false) return;
    toast({ icon: "chat", message: `Receita enviada para ${targetName[target]}` });
    close();
  };

  return (
    <Dialog title="Compartilhar receita" description={`Receita de ${meds} · ${patient}`} icon="share" size="md" onClose={close}>
      <div className="flex flex-col gap-4">
        <Tabs label="Como compartilhar" items={[{ value: "family", label: "Na família", icon: "groups" }, { value: "whatsapp", label: "Pelo WhatsApp", icon: "chat" }]} value={tab} onChange={setTab} idPrefix="share" />
        <div {...tabPanelProps("share", tab)} className="flex flex-col gap-4">
          {tab === "family" ? (
            <>
              <ul className="flex flex-col divide-y divide-bd">
                {snap.people.map((p) => {
                  const blocked = rx.cannotView.includes(p.name);
                  const view = rx.views.find((v) => v.who === p.name);
                  return (
                    <li key={p.id} className="flex items-center gap-2 py-1">
                      <Checkbox
                        size={26}
                        disabled={blocked}
                        checked={!!sel[p.id]}
                        onChange={(v) => setSel({ ...sel, [p.id]: v })}
                        label={
                          <span className="flex items-center gap-2">
                            <Avatar name={p.name} role={p.role} size={32} />
                            <span>
                              <span className="font-bold">{p.name}</span> <span className="text-ink2">· {p.profileName}</span>
                            </span>
                          </span>
                        }
                        description={
                          blocked ? (
                            <span className="inline-flex items-center gap-1">
                              <Icon name="lock" size={14} />
                              Sem permissão para ver receitas
                            </span>
                          ) : view ? (
                            `Viu em ${view.when}`
                          ) : (
                            "Ainda não viu"
                          )
                        }
                      />
                    </li>
                  );
                })}
              </ul>
              <Button icon="send" disabled={!chosen.length} onClick={() => void sendFamily()}>
                Compartilhar{chosen.length ? ` com ${chosen.length}` : ""}
              </Button>
            </>
          ) : (
            <>
              <RadioGroup<Purpose>
                name="finalidade"
                legend="Para quê?"
                value={purpose}
                onChange={(v) => {
                  setPurpose(v);
                  setMsg(PURPOSE_TEXT[v](patient, meds));
                  setTarget(v === "pharmacy" ? "pharmacy" : v === "buyer" ? "buyer" : target);
                }}
                options={[
                  { value: "pharmacy", label: "Para a farmácia" },
                  { value: "buyer", label: "Para quem vai comprar" },
                  { value: "other", label: "Outro" },
                ]}
              />
              <RadioGroup<Target>
                name="destino"
                legend="Enviar para"
                value={target}
                onChange={setTarget}
                options={[
                  { value: "pharmacy", label: "Farmácia São João" },
                  { value: "group", label: "Grupo da família" },
                  { value: "buyer", label: buyer ? `${buyer} (assumiu a compra)` : "Quem assumiu a compra", description: buyer ? undefined : "Ninguém assumiu a compra ainda" },
                  { value: "other", label: "Outro número" },
                ]}
              />
              {target === "other" ? <TextField label="Número com DDD" inputMode="tel" placeholder="(11) 91234-5678" value={other} error={otherErr} onChange={(e) => { setOther(e.target.value); setOtherErr(""); }} /> : null}
              <TextArea label="Mensagem" value={msg} onChange={(e) => setMsg(e.target.value)} />
              <div aria-label="Prévia da mensagem" className="rounded-lg bg-sf2 p-3">
                <p className="mb-1 text-cap text-ink3">Prévia</p>
                <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-ok-bg p-3 text-ok">
                  <div className="mb-2 flex items-center gap-2 rounded-md bg-sf/60 p-2 text-ink">
                    <Icon name="description" size={22} />
                    <span className="text-cap font-bold">Receita de {meds} · {rx.pages} {rx.pages === 1 ? "página" : "páginas"}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{msg}</p>
                </div>
              </div>
              <p className={cx("flex items-start gap-2 rounded-md bg-lt-bg p-3 text-lt")}>
                <Icon name="warning" size={22} className="mt-0.5" />
                <span>A imagem sai do MedCuidar. Quem receber poderá guardar e encaminhar. O envio fica registrado.</span>
              </p>
              <Button icon="send" onClick={() => void sendWhatsApp()}>
                Enviar pelo WhatsApp
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
