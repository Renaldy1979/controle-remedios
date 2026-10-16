"use client";
import { useState } from "react";
import { useSnapshot, type PersonVM } from "@/data";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/Chip";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";

/** Quem está na escala de cuidado: remover exige digitar REMOVER (RF1.9). */
const ON_SCHEDULE = new Set(["Rosa", "Lúcia", "Seu João"]);

export function UsersPanel() {
  const snap = useSnapshot();
  const toast = useToast();
  const [removing, setRemoving] = useState<PersonVM | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Pacientes">
        <h3 className="mb-3 font-display text-t2 font-bold">Pacientes</h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {snap.patients.map((p) => (
            <li key={p.id} className="flex gap-3 rounded-lg border border-bd bg-sf p-4">
              <Avatar name={p.fullName} role="patient" size={48} whatsapp={p.usesPhone} />
              <div>
                <p className="text-t3 font-bold">{p.fullName}, {p.age} anos</p>
                <p className="text-ink2">{p.usesPhone ? `WhatsApp: ${p.phone}` : "Sem celular · os lembretes vão para quem está com ela"}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Pessoas">
        <h3 className="mb-3 font-display text-t2 font-bold">Pessoas</h3>
        <ul className="divide-y divide-bd rounded-lg border border-bd bg-sf">
          {snap.people.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
              <Avatar name={p.name} role={p.role} size={44} whatsapp={p.whatsappActive} />
              <div className="min-w-0 flex-1 basis-48">
                <p className="font-bold">{p.name} <span className="font-normal text-ink2">· {p.relation}</span></p>
                <p className="text-cap text-ink2">{p.profileName} · <span className="num">{p.phone}</span></p>
              </div>
              <StatusChip compact tone={p.whatsappActive ? "ok" : "lt"} icon={p.whatsappActive ? "check_circle" : "schedule"} label={p.whatsappActive ? "WhatsApp ativo" : "Convite pendente"} />
              <div className="flex">
                <Button variant="ghost" size="sm" icon="edit" aria-label={`Editar ${p.name}`} onClick={() => toast({ icon: "edit", message: "A edição de pessoas será ligada ao Appwrite na próxima fase" })}>
                  Editar
                </Button>
                <Button variant="ghost" size="sm" icon="person_remove" aria-label={`Remover ${p.name}`} onClick={() => setRemoving(p)}>
                  Remover
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex items-center gap-2 text-cap text-ink2">
          <Icon name="info" size={16} />
          Quem está na escala de cuidado (cuidadoras e Seu João) só sai depois de digitar REMOVER.
        </p>
      </section>

      {removing ? (
        <ConfirmDialog
          title={`Remover ${removing.name}?`}
          description={ON_SCHEDULE.has(removing.name) ? `${removing.name} está na escala de doses. Sem essa pessoa, alguns horários ficam sem responsável.` : `${removing.name} deixa de receber avisos da família.`}
          confirmLabel="Remover pessoa"
          requireWord={ON_SCHEDULE.has(removing.name) ? "REMOVER" : undefined}
          icon="person_remove"
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            toast({ icon: "person_remove", message: `${removing.name} removida (simulação, nada foi salvo)` });
            setRemoving(null);
          }}
        />
      ) : null}
    </div>
  );
}
