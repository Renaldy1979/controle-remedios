"use client";
import { useState } from "react";
import { cx } from "@/lib/format";
import { useActions, useSnapshot, type MedicationVM, type PhaseVM } from "@/data";
import { Button, IconButton } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Controls";
import { SelectField, TextField } from "@/components/ui/Field";
import { Tag } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Toast";

const HOURS = [1, 2, 3, 4, 6, 8, 12, 24];

/** Horários gerados a partir do primeiro horário e da periodicidade (prévia; o cálculo oficial virá de packages/domain). */
function previewTimes(first: string, every: number): string[] {
  const start = Number(first.slice(0, 2)) * 60 + Number(first.slice(3, 5));
  const n = Math.max(1, Math.floor(24 / every));
  return Array.from({ length: n }, (_, i) => {
    const m = (start + i * every * 60) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }).sort();
}

export function SchemesPanel() {
  const snap = useSnapshot();
  const [selId, setSelId] = useState(snap.medications[0]?.id ?? "");
  const med = snap.medications.find((m) => m.id === selId) ?? snap.medications[0];
  if (!med) return <p className="text-ink2">Nenhum remédio cadastrado.</p>;
  return (
    <div className="flex flex-col gap-4">
      <SelectField label="Remédio" value={med.id} onChange={(e) => setSelId(e.target.value)}>
        {snap.medications.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} · {snap.patients.find((p) => p.id === m.patientId)?.name}
          </option>
        ))}
      </SelectField>
      <SchemeForm key={med.id} med={med} />
    </div>
  );
}

function SchemeForm({ med }: { med: MedicationVM }) {
  const toast = useToast();
  const actions = useActions();
  const [phases, setPhases] = useState<PhaseVM[]>(med.phases);
  const [single, setSingle] = useState(med.phases.length === 1);
  const [first, setFirst] = useState(med.firstTime);
  const [firstErr, setFirstErr] = useState("");
  const [idx, setIdx] = useState(0);
  const shown = single ? [phases[0]!] : phases;
  const ph = shown[Math.min(idx, shown.length - 1)]!;
  const lastDay = Math.max(...shown.map((p) => p.toDay ?? p.fromDay + 10));

  const patch = (p: Partial<PhaseVM>) => setPhases(phases.map((x) => (x.order === ph.order ? { ...x, ...p } : x)));
  const times = previewTimes(first, ph.everyHours);

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-bd bg-sf p-4"
      aria-label={`Esquema de ${med.name}`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(first)) {
          setFirstErr("Use o horário no formato 24h, por exemplo 08:00.");
          return;
        }
        if ((await actions.saveScheme(med.id, { single, firstTime: first, phases })) === false) return;
        toast({ icon: "check_circle", message: `Esquema de ${med.name} salvo` });
      }}
    >
      <Switch checked={single} onChange={setSingle} label="Fase única (o mesmo esquema até acabar)" />

      {!single ? (
        <div>
          <div role="img" aria-label={`Fases: ${phases.map((p) => `fase ${p.order} do dia ${p.fromDay} ao ${p.toDay ?? "fim"}`).join("; ")}${med.treatmentDay ? `; hoje é o dia ${med.treatmentDay}` : ""}`} className="relative flex h-3 gap-1 pt-0">
            {phases.map((p) => (
              <span key={p.order} className={cx("h-3 rounded-pill", p.order === ph.order ? "bg-br" : "bg-bd2")} style={{ flex: (p.toDay ?? p.fromDay + 5) - p.fromDay + 1 }} />
            ))}
            {med.treatmentDay ? <span aria-hidden="true" className="absolute -top-1 h-5 w-1 rounded bg-ink" style={{ left: `${(med.treatmentDay / lastDay) * 100}%` }} /> : null}
          </div>
          <div className="mt-1 flex items-center justify-between text-cap text-ink2">
            <span>Dia 1</span>
            {med.treatmentDay ? <span className="font-bold text-ink">Hoje · dia {med.treatmentDay}</span> : null}
            <span>Dia {lastDay}</span>
          </div>
          <div role="group" aria-label="Fases" className="mt-3 flex gap-2">
            {phases.map((p, i) => (
              <button key={p.order} type="button" aria-pressed={i === idx} onClick={() => setIdx(i)} className={cx("min-h-touch rounded-pill border-[1.5px] px-4", i === idx ? "border-br bg-brt font-bold text-pn" : "border-bd2")}>
                Fase {p.order}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 font-bold" id="every-label">De quantas em quantas horas</p>
          <div className="flex items-center gap-2" role="group" aria-labelledby="every-label">
            <IconButton icon="remove" label="Diminuir horas entre as doses" className="border-[1.5px] border-bd2" onClick={() => { const i = HOURS.indexOf(ph.everyHours); patch({ everyHours: HOURS[Math.max(0, i - 1)] ?? ph.everyHours }); }} />
            <span className="num w-24 text-center text-t2 font-extrabold" aria-live="polite">{ph.everyHours} h</span>
            <IconButton icon="add" label="Aumentar horas entre as doses" className="border-[1.5px] border-bd2" onClick={() => { const i = HOURS.indexOf(ph.everyHours); patch({ everyHours: HOURS[Math.min(HOURS.length - 1, i + 1)] ?? ph.everyHours }); }} />
          </div>
        </div>
        <TextField label="Primeiro horário" value={first} error={firstErr} inputMode="numeric" placeholder="08:00" onChange={(e) => { setFirst(e.target.value); setFirstErr(""); }} />
        {!single ? (
          <>
            <TextField label="Do dia" inputMode="numeric" value={String(ph.fromDay)} onChange={(e) => patch({ fromDay: Number(e.target.value) || 1 })} />
            <TextField label="Até o dia" inputMode="numeric" value={ph.toDay == null ? "" : String(ph.toDay)} placeholder="até acabar" onChange={(e) => patch({ toDay: e.target.value ? Number(e.target.value) : null })} />
          </>
        ) : null}
      </div>

      <div>
        <p className="mb-1.5 font-bold">Horários gerados</p>
        <ul className="flex flex-wrap gap-2">
          {times.map((t) => (
            <li key={t}>
              <Tag icon="schedule">{t}</Tag>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <Button type="submit" icon="check">Salvar esquema</Button>
      </div>
    </form>
  );
}
