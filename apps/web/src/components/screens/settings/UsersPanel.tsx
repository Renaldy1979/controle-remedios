"use client";
import { useState } from "react";
import { useActions, useSnapshot, type MemberInput, type PersonVM } from "@/data";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/Chip";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { SelectField, TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";

/** Quem está na escala de cuidado: remover exige digitar REMOVER (RF1.9). */
const ON_SCHEDULE = new Set(["Rosa", "Lúcia", "Seu João"]);

export function UsersPanel() {
  const snap = useSnapshot();
  const actions = useActions();
  const toast = useToast();
  const [removing, setRemoving] = useState<PersonVM | null>(null);
  const [editing, setEditing] = useState<PersonVM | "new" | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Pacientes">
        <h3 className="mb-3 font-display text-t2 font-bold">Pacientes</h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {snap.patients.map((p) => (
            <li key={p.id} className="flex gap-3 rounded-lg border border-bd bg-sf p-4">
              <Avatar name={p.fullName} role="patient" size={48} whatsapp={p.usesPhone} />
              <div>
                <p className="text-t3 font-bold">
                  {p.fullName}
                  {p.age ? `, ${p.age} anos` : ""}
                </p>
                <p className="text-ink2">{p.usesPhone ? (p.phone ? `WhatsApp: ${p.phone}` : "Usa WhatsApp") : "Sem celular · os lembretes vão para quem está com ele(a)"}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Pessoas">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-display text-t2 font-bold">Pessoas</h3>
          <Button variant="secondary" icon="person_add" onClick={() => setEditing("new")}>
            Convidar pessoa
          </Button>
        </div>
        <ul className="divide-y divide-bd rounded-lg border border-bd bg-sf">
          {snap.people.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
              <Avatar name={p.name} role={p.role} size={44} whatsapp={p.whatsappActive} />
              <div className="min-w-0 flex-1 basis-48">
                <p className="font-bold">
                  {p.name} <span className="font-normal text-ink2">· {p.relation}</span>
                </p>
                <p className="text-cap text-ink2">
                  {p.profileName} · <span className="num">{p.phone}</span>
                </p>
              </div>
              <StatusChip compact tone={p.whatsappActive ? "ok" : "lt"} icon={p.whatsappActive ? "check_circle" : "schedule"} label={p.whatsappActive ? "WhatsApp ativo" : "Convite pendente"} />
              <div className="flex">
                <Button variant="ghost" size="sm" icon="edit" aria-label={`Editar ${p.name}`} onClick={() => setEditing(p)}>
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

      {editing ? (
        <MemberDialog
          person={editing === "new" ? null : editing}
          profiles={snap.profiles}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const ok = editing === "new" ? await actions.inviteMember(input) : await actions.updateMember(editing.id, input);
            if (ok === false) return;
            setEditing(null);
            toast({ icon: "check_circle", message: editing === "new" ? `${input.name} foi convidada(o)` : `${input.name} atualizada(o)` });
          }}
        />
      ) : null}

      {removing ? (
        <ConfirmDialog
          title={`Remover ${removing.name}?`}
          description={ON_SCHEDULE.has(removing.name) ? `${removing.name} está na escala de doses. Sem essa pessoa, alguns horários ficam sem responsável.` : `${removing.name} deixa de receber avisos da família.`}
          confirmLabel="Remover pessoa"
          requireWord={ON_SCHEDULE.has(removing.name) ? "REMOVER" : undefined}
          icon="person_remove"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const who = removing;
            setRemoving(null);
            if ((await actions.removeMember(who.id)) === false) return;
            toast({ icon: "person_remove", message: `${who.name} foi removida(o)` });
          }}
        />
      ) : null}
    </div>
  );
}

function MemberDialog({ person, profiles, onClose, onSave }: { person: PersonVM | null; profiles: string[]; onClose: () => void; onSave: (i: MemberInput) => Promise<void> }) {
  const [name, setName] = useState(person?.name ?? "");
  const [phone, setPhone] = useState(person?.phone ?? "");
  const [profile, setProfile] = useState(person?.profileName ?? profiles.find((p) => p === "Familiar") ?? profiles[0] ?? "");
  const [relation, setRelation] = useState(person ? person.relation.split(" · ")[0]! : "");
  const [err, setErr] = useState<{ name?: string; phone?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e: typeof err = {};
    if (!name.trim()) e.name = "Informe o nome.";
    if (phone.replace(/\D/g, "").length < 10) e.phone = "Confira o número com DDD, por exemplo (11) 91234-5678.";
    setErr(e);
    if (e.name || e.phone) return;
    setBusy(true);
    await onSave({ name, phone, profileName: profile, relation });
    setBusy(false);
  };

  return (
    <Dialog
      title={person ? `Editar ${person.name}` : "Convidar pessoa"}
      icon={person ? "edit" : "person_add"}
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {person ? "Salvar" : "Convidar"}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <TextField label="Nome" data-autofocus value={name} error={err.name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Celular com DDD (WhatsApp)" type="tel" inputMode="tel" value={phone} error={err.phone} onChange={(e) => setPhone(e.target.value)} />
        <SelectField label="Perfil" value={profile} onChange={(e) => setProfile(e.target.value)}>
          {profiles.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </SelectField>
        <TextField label="Relação" optional hint="Ex.: filha, cuidadora, sobrinho" value={relation} onChange={(e) => setRelation(e.target.value)} />
      </form>
    </Dialog>
  );
}
