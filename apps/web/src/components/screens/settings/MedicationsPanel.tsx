"use client";
import { useEffect, useState } from "react";
import { useActions, useSnapshot, type MedicationVM } from "@/data";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { SelectField, TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";

const ROUTES = ["Pingar", "Comprimido", "Pó dissolvido", "Líquido", "Pomada", "Outro"];
const UNITS = ["Unidade", "ml", "Gotas", "Grama"];

export function MedicationsPanel() {
  const snap = useSnapshot();
  const [selId, setSelId] = useState<string>(snap.medications[0]?.id ?? "");
  const med = snap.medications.find((m) => m.id === selId) ?? snap.medications[0];

  return (
    <div className="grid gap-5 wide:grid-cols-[300px_1fr] wide:items-start">
      <div className="flex flex-col gap-4">
        {snap.patients.map((p) => (
          <section key={p.id} aria-label={`Remédios de ${p.name}`}>
            <h3 className="mb-1 font-bold text-ink2">{p.name}</h3>
            <ul className="flex flex-col gap-1">
              {snap.medications.filter((m) => m.patientId === p.id).map((m) => (
                <li key={m.id}>
                  <button type="button" aria-pressed={m.id === med?.id} onClick={() => setSelId(m.id)} className={`flex min-h-touch w-full items-center gap-2 rounded-md px-3 text-left ${m.id === med?.id ? "bg-brt font-bold text-pn" : "hover:bg-sf2"}`}>
                    <Icon name="medication" size={20} />
                    {m.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {med ? <MedicationForm key={med.id} med={med} onDeleted={() => setSelId("")} /> : <p className="text-ink2">Nenhum remédio cadastrado.</p>}
    </div>
  );
}

function MedicationForm({ med, onDeleted }: { med: MedicationVM; onDeleted: () => void }) {
  const actions = useActions();
  const toast = useToast();
  const [name, setName] = useState(med.name);
  const [alts, setAlts] = useState(med.alternatives);
  const [newAlt, setNewAlt] = useState("");
  const [route, setRoute] = useState(med.routeLabel);
  const [unit, setUnit] = useState(med.unitLabel);
  const [dropsPerMl, setDropsPerMl] = useState("20");
  const [perDose, setPerDose] = useState(String(med.perDose));
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<{ name?: string; perDose?: string }>({});
  useEffect(() => setErr({}), [name, perDose]);

  const save = () => {
    const q = Number(perDose.replace(",", "."));
    const e: typeof err = {};
    if (!name.trim()) e.name = "Dê um nome ao remédio.";
    if (!(q > 0)) e.perDose = "Informe uma quantidade maior que zero.";
    setErr(e);
    if (e.name || e.perDose) return;
    actions.updateMedication(med.id, { name: name.trim(), alternatives: alts, routeLabel: route, perDose: q });
    toast({ icon: "check_circle", message: `${name.trim()} salvo` });
  };

  return (
    <form className="flex flex-col gap-4 rounded-lg border border-bd bg-sf p-4" onSubmit={(e) => { e.preventDefault(); save(); }} aria-label={`Editar ${med.name}`}>
      <TextField label="Nome do remédio" value={name} error={err.name} onChange={(e) => setName(e.target.value)} />
      <div>
        <p className="mb-1 font-bold">Marcas alternativas <span className="font-normal text-ink3">· só uma delas</span></p>
        <ul className="mb-2 flex flex-wrap gap-2">
          {alts.map((a) => (
            <li key={a}>
              <button type="button" onClick={() => setAlts(alts.filter((x) => x !== a))} aria-label={`Remover marca ${a}`} className="inline-flex min-h-touch items-center gap-1.5 rounded-pill border-[1.5px] border-bd2 bg-sf px-4 hover:bg-sf2">
                {a}
                <Icon name="close" size={18} />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TextField label="Nova marca" value={newAlt} onChange={(e) => setNewAlt(e.target.value)} />
          </div>
          <Button variant="secondary" icon="add" disabled={!newAlt.trim()} onClick={() => { setAlts([...alts, newAlt.trim()]); setNewAlt(""); }}>
            Adicionar
          </Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Tipo de uso" value={route} onChange={(e) => setRoute(e.target.value)}>
          {ROUTES.map((r) => <option key={r}>{r}</option>)}
        </SelectField>
        <SelectField label="Unidade de controle" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {UNITS.map((r) => <option key={r}>{r}</option>)}
        </SelectField>
        {unit === "Gotas" ? <TextField label="Gotas por ml" inputMode="numeric" hint="Padrão: 20. O estoque de colírio é sempre uma estimativa." value={dropsPerMl} onChange={(e) => setDropsPerMl(e.target.value)} /> : null}
        <TextField label={`Quantidade por dose (${unit.toLowerCase()})`} inputMode="decimal" value={perDose} error={err.perDose} onChange={(e) => setPerDose(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" icon="check">Salvar</Button>
        <Button variant="dangerOutline" icon="delete" onClick={() => setConfirm(true)}>Excluir remédio</Button>
      </div>
      {confirm ? (
        <ConfirmDialog
          title={`Excluir ${med.name}?`}
          description="Os lembretes deste remédio param. O histórico de doses continua guardado."
          confirmLabel="Excluir"
          onClose={() => setConfirm(false)}
          onConfirm={() => {
            actions.deleteMedication(med.id);
            setConfirm(false);
            onDeleted();
            toast({ icon: "delete", message: `${med.name} excluído`, undo: () => actions.restoreMedication(med.id) });
          }}
        />
      ) : null}
    </form>
  );
}
