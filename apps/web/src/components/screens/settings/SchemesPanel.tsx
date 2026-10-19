"use client";
import { useState } from "react";
import { cx } from "@/lib/format";
import { parseDate } from "@/lib/format";
import { INTERVAL_HOURS, MAX_PHASES, validateScheme } from "@/lib/scheme";
import { intervalTimes } from "@/lib/times";
import { useActions, useSnapshot, type MedicationVM, type PhaseVM } from "@/data";
import { Button, IconButton } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Controls";
import { SelectField, TextField } from "@/components/ui/Field";
import { Tag } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/Layout";
import { useToast } from "@/components/ui/Toast";

const toDisplay = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const num = (s: string) => Number(String(s).replace(",", "."));

export function SchemesPanel() {
  const snap = useSnapshot();
  const [selId, setSelId] = useState(snap.medications[0]?.id ?? "");
  const med = snap.medications.find((m) => m.id === selId) ?? snap.medications[0];
  if (!med) return <EmptyState icon="timeline" title="Nenhum remédio cadastrado" text="Cadastre um remédio em Remédios para montar o esquema dele." />;
  return (
    <div className="flex flex-col gap-4">
      <SelectField label="Remédio" value={med.id} onChange={(e) => setSelId(e.target.value)}>
        {snap.medications.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} · {snap.patients.find((p) => p.id === m.patientId)?.name}
          </option>
        ))}
      </SelectField>
      <SchemeForm key={`${med.id}:${med.phases.map((p) => `${p.fromDay}-${p.toDay}-${p.everyHours}-${p.perDose}`).join("|")}:${med.firstTime}:${med.startDate ?? ""}`} med={med} />
    </div>
  );
}

interface Row {
  everyHours: number;
  perDose: string;
  /** quantos dias a fase dura; vazio na última = até acabar */
  days: string;
}

const rowsOf = (med: MedicationVM): Row[] =>
  med.phases.map((p) => ({ everyHours: p.everyHours, perDose: String(p.perDose), days: p.toDay == null ? "" : String(p.toDay - p.fromDay + 1) }));

function SchemeForm({ med }: { med: MedicationVM }) {
  const toast = useToast();
  const actions = useActions();
  const unit = med.unitLabel.toLowerCase();
  const [rows, setRows] = useState<Row[]>(med.phases.length ? rowsOf(med) : [{ everyHours: 24, perDose: "1", days: "" }]);
  const [single, setSingle] = useState(med.phases.length <= 1);
  const [first, setFirst] = useState(med.firstTime);
  const [start, setStart] = useState(toDisplay(med.startDate ?? ""));
  const [idx, setIdx] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const shown = single ? [rows[0]!] : rows;
  const cur = Math.min(idx, shown.length - 1);
  const ph = shown[cur]!;
  const patch = (p: Partial<Row>) => setRows(rows.map((r, i) => (i === cur ? { ...r, ...p } : r)));

  /** Fases com os dias calculados em sequência (sem lacuna nem sobreposição por construção). */
  const build = (): { phases: PhaseVM[]; errors: string[] } => {
    const errs: string[] = [];
    const list = single ? [rows[0]!] : rows;
    let from = 1;
    const phases = list.map((r, i): PhaseVM => {
      const last = i === list.length - 1;
      let to: number | null = null;
      if (!(single && last)) {
        if (r.days.trim() === "" && !last) errs.push(`Fase ${i + 1}: informe quantos dias ela dura.`);
        else if (r.days.trim() !== "") {
          const d = num(r.days);
          if (!Number.isInteger(d) || d < 1) errs.push(`Fase ${i + 1}: a duração precisa ser um número de dias (1 ou mais).`);
          else to = from + d - 1;
        }
      }
      const p: PhaseVM = { order: i + 1, everyHours: r.everyHours, fromDay: from, toDay: single ? null : to, perDose: num(r.perDose) };
      from = (to ?? from) + 1;
      return p;
    });
    return { phases, errors: errs };
  };

  const timeline = build().phases;
  const lastDay = Math.max(...timeline.map((p) => p.toDay ?? p.fromDay + 10));
  const times = intervalTimes(first, ph.everyHours);

  const submit = async () => {
    const b = build();
    const errs = [...b.errors];
    let startIso: string | undefined;
    if (start.trim()) {
      const d = parseDate(start);
      if (!d) errs.push("Use a data de início no formato dd/mm/aaaa.");
      else startIso = toIso(d);
    }
    if (!errs.length) errs.push(...validateScheme(b.phases.map((p) => ({ everyHours: p.everyHours, fromDay: p.fromDay, toDay: p.toDay, perDose: p.perDose })), first).errors);
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    const ok = await actions.saveScheme(med.id, { single, firstTime: first, phases: b.phases, ...(startIso ? { startDate: startIso } : {}) });
    setBusy(false);
    if (ok === false) return;
    toast({ icon: "check_circle", message: `Esquema de ${med.name} salvo` });
  };

  return (
    <form className="flex flex-col gap-4 rounded-lg border border-bd bg-sf p-4" aria-label={`Esquema de ${med.name}`} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <Switch checked={single} onChange={(v) => { setSingle(v); setIdx(0); }} label="Fase única (o mesmo esquema até acabar)" />

      {!single ? (
        <div>
          <div role="img" aria-label={`Fases: ${timeline.map((p) => `fase ${p.order} do dia ${p.fromDay} ${p.toDay == null ? "até acabar" : `ao ${p.toDay}`}`).join("; ")}${med.treatmentDay ? `; hoje é o dia ${med.treatmentDay}` : ""}`} className="relative flex h-3 gap-1 pt-0">
            {timeline.map((p, i) => (
              <span key={p.order} className={cx("h-3 rounded-pill", i === cur ? "bg-br" : "bg-bd2")} style={{ flex: (p.toDay ?? p.fromDay + 5) - p.fromDay + 1 }} />
            ))}
            {med.treatmentDay && lastDay >= med.treatmentDay ? <span aria-hidden="true" className="absolute -top-1 h-5 w-1 rounded bg-ink" style={{ left: `${(med.treatmentDay / lastDay) * 100}%` }} /> : null}
          </div>
          <div className="mt-1 flex items-center justify-between text-cap text-ink2">
            <span>Dia 1</span>
            {med.treatmentDay ? <span className="font-bold text-ink">Hoje · dia {med.treatmentDay}</span> : null}
            <span>{timeline[timeline.length - 1]!.toDay == null ? "Até acabar" : `Dia ${lastDay}`}</span>
          </div>
          <div role="group" aria-label="Fases" className="mt-3 flex flex-wrap items-center gap-2">
            {rows.map((_, i) => (
              <button key={i} type="button" aria-pressed={i === cur} onClick={() => setIdx(i)} className={cx("min-h-touch rounded-pill border-[1.5px] px-4", i === cur ? "border-br bg-brt font-bold text-pn" : "border-bd2")}>
                Fase {i + 1}
              </button>
            ))}
            {rows.length < MAX_PHASES ? (
              <Button
                variant="secondary"
                size="sm"
                icon="add"
                onClick={() => {
                  // a nova fase vira a última: a anterior passa a ter duração (se estava "até acabar", 7 dias)
                  const next = rows.map((r, i) => (i === rows.length - 1 && r.days.trim() === "" ? { ...r, days: "7" } : r));
                  setRows([...next, { everyHours: rows[rows.length - 1]!.everyHours, perDose: rows[rows.length - 1]!.perDose, days: "" }]);
                  setIdx(rows.length);
                }}
              >
                Adicionar fase
              </Button>
            ) : null}
            {rows.length > 1 ? (
              <Button
                variant="ghost"
                size="sm"
                icon="delete"
                onClick={() => {
                  const left = rows.filter((_, i) => i !== cur);
                  if (cur === rows.length - 1) left[left.length - 1] = { ...left[left.length - 1]!, days: "" };
                  setRows(left);
                  setIdx(Math.max(0, cur - 1));
                }}
              >
                Remover fase {cur + 1}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 font-bold" id="every-label">De quantas em quantas horas{!single ? ` (fase ${cur + 1})` : ""}</p>
          <div className="flex items-center gap-2" role="group" aria-labelledby="every-label">
            <IconButton icon="remove" label="Diminuir horas entre as doses" className="border-[1.5px] border-bd2" onClick={() => { const i = INTERVAL_HOURS.indexOf(ph.everyHours as never); patch({ everyHours: INTERVAL_HOURS[Math.max(0, i - 1)] ?? ph.everyHours }); }} />
            <span className="num w-24 text-center text-t2 font-extrabold" aria-live="polite">{ph.everyHours} h</span>
            <IconButton icon="add" label="Aumentar horas entre as doses" className="border-[1.5px] border-bd2" onClick={() => { const i = INTERVAL_HOURS.indexOf(ph.everyHours as never); patch({ everyHours: INTERVAL_HOURS[Math.min(INTERVAL_HOURS.length - 1, i + 1)] ?? ph.everyHours }); }} />
          </div>
        </div>
        <TextField label={`Quantidade por dose (${unit})`} inputMode="decimal" value={ph.perDose} onChange={(e) => patch({ perDose: e.target.value })} />
        <TextField label="Primeiro horário do dia" inputMode="numeric" placeholder="08:00" hint="Formato 24h. Vale para todas as fases." value={first} onChange={(e) => setFirst(e.target.value)} />
        <TextField label="Começa em (dia 1)" inputMode="numeric" placeholder="dd/mm/aaaa" hint="A data em que o tratamento começou." value={start} onChange={(e) => setStart(e.target.value)} />
        {!single ? (
          <TextField
            label={cur === rows.length - 1 ? "Quantos dias dura (vazio = até acabar)" : "Quantos dias dura esta fase"}
            inputMode="numeric"
            placeholder={cur === rows.length - 1 ? "até acabar" : "15"}
            value={ph.days}
            onChange={(e) => patch({ days: e.target.value })}
          />
        ) : null}
      </div>

      <div>
        <p className="mb-1.5 font-bold">Horários gerados{!single ? ` na fase ${cur + 1}` : ""}</p>
        {times.length ? (
          <ul className="flex flex-wrap gap-2">
            {times.map((t) => (
              <li key={t}>
                <Tag icon="schedule">{t}</Tag>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink2">Informe o primeiro horário para ver os horários do dia.</p>
        )}
      </div>

      {errors.length ? (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-ms-bd bg-ms-bg p-3 font-bold text-ms">
          <Icon name="error" size={22} className="mt-0.5 flex-none" />
          <ul className="flex flex-col gap-1">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <Button type="submit" icon="check" loading={busy}>Salvar esquema</Button>
      </div>
    </form>
  );
}
