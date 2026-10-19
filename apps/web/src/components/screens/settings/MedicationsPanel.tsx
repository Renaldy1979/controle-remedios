"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useActions, useCan, useDataKind, useSnapshot, type MedicationInput, type MedicationVM } from "@/data";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { SelectField, TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/Layout";
import { useToast } from "@/components/ui/Toast";
import { ROUTE_LABELS, UNIT_LABELS } from "@/lib/labels";

const DEFAULT_DROPS = "20";

const parseAlternatives = (text: string) => [...new Set(text.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 10);

export function MedicationsPanel() {
  const snap = useSnapshot();
  const actions = useActions();
  const toast = useToast();
  const [selId, setSelId] = useState<string>(snap.medications[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const med = snap.medications.find((m) => m.id === selId) ?? snap.medications[0];

  if (snap.patients.length === 0) {
    return (
      <EmptyState
        icon="elderly"
        title="Cadastre um paciente primeiro"
        text="Cada remédio pertence a um paciente."
        action={
          <Link href="/configuracoes/pacientes" className="inline-flex min-h-touch items-center gap-1 font-bold text-br">
            <Icon name="person_add" size={20} />
            Ir para Pacientes
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button icon="add" onClick={() => setAdding(true)}>
          Novo remédio
        </Button>
      </div>
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
                {snap.medications.every((m) => m.patientId !== p.id) ? <li className="px-3 text-ink2">Nenhum remédio ainda.</li> : null}
              </ul>
            </section>
          ))}
        </div>
        {med ? <MedicationForm key={med.id} med={med} onDeleted={() => setSelId("")} /> : <p className="text-ink2">Escolha um remédio na lista ou cadastre um novo.</p>}
      </div>

      {adding ? (
        <NewMedicationDialog
          onClose={() => setAdding(false)}
          onSave={async (input) => {
            const id = await actions.createMedication(input);
            if (!id) return false;
            setAdding(false);
            setSelId(id);
            toast({ icon: "check_circle", message: `${input.name} cadastrado. Ajuste o horário em Esquemas.` });
            return true;
          }}
        />
      ) : null}
    </div>
  );
}

function NewMedicationDialog({ onClose, onSave }: { onClose: () => void; onSave: (i: MedicationInput) => Promise<boolean> }) {
  const snap = useSnapshot();
  const [patientId, setPatientId] = useState(snap.patients[0]?.id ?? "");
  const [name, setName] = useState("");
  const [alts, setAlts] = useState("");
  const [route, setRoute] = useState(ROUTE_LABELS[1]!);
  const [unit, setUnit] = useState(UNIT_LABELS[0]!);
  const [drops, setDrops] = useState(DEFAULT_DROPS);
  const [stock, setStock] = useState("");
  const isReal = useDataKind() === "postgres";
  const canStock = useCan("stock.adjust");
  const withStock = isReal && canStock;
  const [err, setErr] = useState<{ name?: string; drops?: string; stock?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e: typeof err = {};
    if (!name.trim()) e.name = "Dê um nome ao remédio.";
    const d = Number(drops.replace(",", "."));
    if (unit === "Gotas" && !(d > 0)) e.drops = "Informe quantas gotas tem em 1 ml (padrão 20).";
    const st = stock.trim() === "" ? 0 : Number(stock.replace(",", "."));
    if (withStock && !(Number.isFinite(st) && st >= 0)) e.stock = "Informe um número (ou deixe em branco).";
    setErr(e);
    if (e.name || e.drops || e.stock) return;
    setBusy(true);
    await onSave({ patientId, name: name.trim(), alternatives: parseAlternatives(alts), routeLabel: route, unitLabel: unit, ...(unit === "Gotas" ? { dropsPerMl: d } : {}), ...(withStock && st > 0 ? { initialStock: st } : {}) });
    setBusy(false);
  };

  return (
    <Dialog
      title="Novo remédio"
      icon="medication"
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Cadastrar
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(ev) => { ev.preventDefault(); void submit(); }}>
        <SelectField label="Paciente" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
          {snap.patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}
            </option>
          ))}
        </SelectField>
        <TextField label="Nome do remédio" data-autofocus value={name} error={err.name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Marcas alternativas" optional hint="Separe por vírgula. Só uma delas é usada por vez. Ex.: Facoba, Vigadexa" value={alts} onChange={(e) => setAlts(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Tipo de uso" value={route} onChange={(e) => setRoute(e.target.value)}>
            {ROUTE_LABELS.map((r) => <option key={r}>{r}</option>)}
          </SelectField>
          <SelectField label="Unidade de controle" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNIT_LABELS.map((r) => <option key={r}>{r}</option>)}
          </SelectField>
        </div>
        {unit === "Gotas" ? <TextField label="Gotas por ml" inputMode="decimal" hint="Padrão: 20. O estoque de colírio é sempre uma estimativa." value={drops} error={err.drops} onChange={(e) => setDrops(e.target.value)} /> : null}
        {withStock ? <TextField label={`Estoque inicial (${unit.toLowerCase()})`} optional inputMode="decimal" hint="Quanto tem agora. Vira a primeira entrada do estoque; depois use Registrar compra." value={stock} error={err.stock} onChange={(e) => setStock(e.target.value)} /> : null}
        <p className="flex items-start gap-2 text-cap text-ink2">
          <Icon name="info" size={16} className="mt-0.5 flex-none" />
          O remédio nasce com 1 dose por dia, às 08:00. Ajuste horários e fases em Esquemas.
        </p>
      </form>
    </Dialog>
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
  const [dropsPerMl, setDropsPerMl] = useState(String(med.dropsPerMl ?? DEFAULT_DROPS));
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<{ name?: string; drops?: string }>({});
  useEffect(() => setErr({}), [name, dropsPerMl]);

  const save = async () => {
    const e: typeof err = {};
    if (!name.trim()) e.name = "Dê um nome ao remédio.";
    const d = Number(dropsPerMl.replace(",", "."));
    if (unit === "Gotas" && !(d > 0)) e.drops = "Informe quantas gotas tem em 1 ml (padrão 20).";
    setErr(e);
    if (e.name || e.drops) return;
    if ((await actions.updateMedication(med.id, { name: name.trim(), alternatives: alts, routeLabel: route, unitLabel: unit, ...(unit === "Gotas" ? { dropsPerMl: d } : {}) })) === false) return;
    toast({ icon: "check_circle", message: `${name.trim()} salvo` });
  };

  return (
    <form className="flex flex-col gap-4 rounded-lg border border-bd bg-sf p-4" onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label={`Editar ${med.name}`}>
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
          <Button variant="secondary" icon="add" disabled={!newAlt.trim() || alts.includes(newAlt.trim())} onClick={() => { setAlts([...alts, newAlt.trim()]); setNewAlt(""); }}>
            Adicionar
          </Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Tipo de uso" value={route} onChange={(e) => setRoute(e.target.value)}>
          {ROUTE_LABELS.map((r) => <option key={r}>{r}</option>)}
        </SelectField>
        <SelectField label="Unidade de controle" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {UNIT_LABELS.map((r) => <option key={r}>{r}</option>)}
        </SelectField>
        {unit === "Gotas" ? <TextField label="Gotas por ml" inputMode="decimal" hint="Padrão: 20. O estoque de colírio é sempre uma estimativa." value={dropsPerMl} error={err.drops} onChange={(e) => setDropsPerMl(e.target.value)} /> : null}
      </div>
      <p className="flex items-start gap-2 text-cap text-ink2">
        <Icon name="info" size={16} className="mt-0.5 flex-none" />
        A quantidade por dose e os horários ficam em Esquemas.
      </p>
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
          onConfirm={async () => {
            setConfirm(false);
            if ((await actions.deleteMedication(med.id)) === false) return;
            onDeleted();
            toast({ icon: "delete", message: `${med.name} excluído`, undo: () => void actions.restoreMedication(med.id) });
          }}
        />
      ) : null}
    </form>
  );
}
