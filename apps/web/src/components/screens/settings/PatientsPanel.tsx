"use client";
import { useState } from "react";
import { useActions, useSnapshot, type PatientInput, type PatientVM } from "@/data";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Controls";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { SelectField, TextArea, TextField } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/Layout";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { maskDate } from "@/lib/date-mask";
import { parseDate } from "@/lib/format";

const toDisplay = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Pacientes da família: um ou mais. O paciente pode ter conta no portal (ex.: Adelino) ou não (ex.: Maria). */
export function PatientsPanel() {
  const snap = useSnapshot();
  const actions = useActions();
  const toast = useToast();
  const [editing, setEditing] = useState<PatientVM | "new" | null>(null);
  const [removing, setRemoving] = useState<PatientVM | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-ink2">Quem toma os remédios. Pode haver mais de um paciente na família.</p>
        <Button icon="person_add" onClick={() => setEditing("new")}>
          Cadastrar paciente
        </Button>
      </div>

      {snap.patients.length === 0 ? (
        <EmptyState icon="elderly" title="Nenhum paciente ainda" text="Cadastre o primeiro paciente para depois incluir os remédios dele(a)." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {snap.patients.map((p) => (
            <li key={p.id} className="flex flex-col gap-3 rounded-lg border border-bd bg-sf p-4">
              <div className="flex gap-3">
                <Avatar name={p.fullName} role="patient" size={48} whatsapp={p.usesPhone} />
                <div className="min-w-0">
                  <p className="text-t3 font-bold">
                    {p.fullName}
                    {p.age ? `, ${p.age} anos` : ""}
                  </p>
                  <p className="text-ink2">{p.selfMemberName ? `Tem conta no portal (${p.selfMemberName})` : "Sem conta no portal"}</p>
                  <p className="text-cap text-ink2">{p.usesPhone ? "Usa celular" : "Sem celular · os lembretes vão para quem está com ele(a)"}</p>
                  {p.note ? <p className="mt-1 text-ink2">{p.note}</p> : null}
                </div>
              </div>
              <div className="mt-auto flex flex-wrap">
                <Button variant="ghost" size="sm" icon="edit" aria-label={`Editar ${p.fullName}`} onClick={() => setEditing(p)}>
                  Editar
                </Button>
                <Button variant="ghost" size="sm" icon="delete" aria-label={`Arquivar ${p.fullName}`} onClick={() => setRemoving(p)}>
                  Arquivar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <PatientDialog
          patient={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const id = await actions.savePatient(input);
            if (!id) return false;
            setEditing(null);
            toast({ icon: "check_circle", message: input.id ? `${input.name} salvo(a)` : `${input.name} cadastrado(a)` });
            return true;
          }}
        />
      ) : null}

      {removing ? (
        <ConfirmDialog
          title={`Arquivar ${removing.fullName}?`}
          description="O cadastro some das telas e os lembretes dele(a) param. O histórico continua guardado."
          confirmLabel="Arquivar"
          icon="inventory_2"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const who = removing;
            setRemoving(null);
            if ((await actions.deletePatient(who.id)) === false) return;
            toast({ icon: "inventory_2", message: `${who.fullName} foi arquivado(a)` });
          }}
        />
      ) : null}
    </div>
  );
}

function PatientDialog({ patient, onClose, onSave }: { patient: PatientVM | null; onClose: () => void; onSave: (i: PatientInput) => Promise<boolean> }) {
  const snap = useSnapshot();
  const [name, setName] = useState(patient?.fullName ?? "");
  const [birth, setBirth] = useState(toDisplay(patient?.birthDate ?? ""));
  const [notes, setNotes] = useState(patient?.note ?? "");
  const [usesPhone, setUsesPhone] = useState(patient?.usesPhone ?? true);
  const [selfId, setSelfId] = useState(patient?.selfMemberId ?? "");
  const [err, setErr] = useState<{ name?: string; birth?: string }>({});
  const [busy, setBusy] = useState(false);
  const accounts = snap.people.filter((p) => p.active !== false && p.accessState !== "invited");

  const submit = async () => {
    const e: typeof err = {};
    if (!name.trim()) e.name = "Informe o nome do paciente.";
    let iso = "";
    if (birth.trim()) {
      const d = parseDate(birth);
      if (!d || d.getTime() > Date.now() || d.getFullYear() < 1900) e.birth = "Use a data no formato dd/mm/aaaa, por exemplo 10/03/1942.";
      else iso = toIso(d);
    }
    setErr(e);
    if (e.name || e.birth) return;
    setBusy(true);
    await onSave({ ...(patient ? { id: patient.id } : {}), name: name.trim(), birthDate: iso, notes: notes.trim(), usesPhone, selfMemberId: selfId || null });
    setBusy(false);
  };

  return (
    <Dialog
      title={patient ? `Editar ${patient.fullName}` : "Cadastrar paciente"}
      icon={patient ? "edit" : "person_add"}
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Salvar
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(ev) => { ev.preventDefault(); void submit(); }}>
        <TextField label="Nome completo" data-autofocus value={name} error={err.name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Data de nascimento" optional inputMode="numeric" placeholder="dd/mm/aaaa" value={birth} error={err.birth} maxLength={10} autoComplete="bday" onChange={(e) => setBirth(maskDate(e.target.value))} />
        <TextArea label="Observações" optional hint="Ex.: tem Alzheimer; não usa celular. Evite dados que não ajudem no cuidado." maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Checkbox checked={usesPhone} onChange={setUsesPhone} label="Usa celular" description="Desmarque se alguém precisa dar os remédios e confirmar por ele(a)." />
        <SelectField label="Tem conta no portal?" optional hint="Se o paciente também usa o portal, ligue ao usuário dele(a)." value={selfId} onChange={(e) => setSelfId(e.target.value)}>
          <option value="">Não tem conta</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </SelectField>
        {snap.people.some((p) => p.accessState === "invited") ? (
          <p className="flex items-center gap-2 text-cap text-ink2">
            <Icon name="info" size={16} />
            Quem ainda não aceitou o convite só aparece aqui depois de entrar.
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
