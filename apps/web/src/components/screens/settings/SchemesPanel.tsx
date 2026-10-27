"use client";
import { useState } from "react";
import { cx } from "@/lib/format";
import { parseDate } from "@/lib/format";
import { INTERVAL_HOURS, MAX_PHASES, schemeDosesOnDate, validateScheme } from "@/lib/scheme";
import { SCHEME_TZ, addDaysIso, localNow, nextSlot } from "@/lib/times";
import { useActions, useSnapshot, type MedicationVM, type PhaseVM } from "@/data";
import { Tabs } from "@/components/ui/Tabs";
import { SchemeCalendar } from "./SchemeCalendar";
import { Button, IconButton } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Controls";
import { SelectField, TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/Layout";
import { useToast } from "@/components/ui/Toast";

const toDisplay = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const num = (s: string) => Number(String(s).replace(",", "."));

type View = "editar" | "calendario";

export function SchemesPanel() {
  const snap = useSnapshot();
  const [view, setView] = useState<View>("editar");
  if (snap.medications.length === 0) return <EmptyState icon="timeline" title="Nenhum remédio cadastrado" text="Cadastre um remédio em Remédios para montar o esquema dele." />;
  return (
    <div className="flex flex-col gap-4">
      <Tabs
        label="Como ver os esquemas"
        value={view}
        onChange={setView}
        items={[
          { value: "editar", label: "Editar esquema", icon: "edit" },
          { value: "calendario", label: "Calendário", icon: "calendar_month" },
        ]}
      />
      {view === "editar" ? <SchemeEditor /> : <SchemeCalendar />}
    </div>
  );
}

function SchemeEditor() {
  const snap = useSnapshot();
  const [selId, setSelId] = useState(snap.medications[0]?.id ?? "");
  const med = snap.medications.find((m) => m.id === selId) ?? snap.medications[0];
  if (!med) return null;
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
  /** quantos dias a fase dura (a última pode ser "até acabar o estoque") */
  days: string;
  /** só vale na última fase: sem duração em dias, vale até acabar o estoque */
  untilEnd: boolean;
}

const rowsOf = (med: MedicationVM): Row[] =>
  med.phases.map((p) => ({ everyHours: p.everyHours, perDose: String(p.perDose), days: p.toDay == null ? "" : String(p.toDay - p.fromDay + 1), untilEnd: p.toDay == null }));

const listText = (l: string[]) => (l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} e ${l[l.length - 1]}`);
const PREVIEW_DAYS = 3;

function SchemeForm({ med }: { med: MedicationVM }) {
  const toast = useToast();
  const actions = useActions();
  const unit = med.unitLabel.toLowerCase();
  const [rows, setRows] = useState<Row[]>(med.phases.length ? rowsOf(med) : [{ everyHours: 24, perDose: "1", days: "", untilEnd: true }]);
  // remédio recém-cadastrado (esquema padrão: 1x ao dia às 08:00, começando hoje): sugere o próximo horário redondo e a data de hoje
  const [fresh] = useState(() => {
    const t = localNow(new Date(), SCHEME_TZ).date;
    return med.phases.length <= 1 && (med.phases[0]?.everyHours ?? 24) === 24 && med.firstTime === "08:00" && med.startDate === t;
  });
  const [suggestion] = useState(() => {
    const now = new Date();
    const slot = nextSlot(now, SCHEME_TZ);
    const base = localNow(now, SCHEME_TZ).date;
    return { time: slot.time, date: slot.tomorrow ? addDaysIso(base, 1) : base };
  });
  const [first, setFirst] = useState(fresh ? suggestion.time : med.firstTime);
  const [start, setStart] = useState(toDisplay(fresh ? suggestion.date : (med.startDate ?? "")));
  const [idx, setIdx] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const cur = Math.min(idx, rows.length - 1);
  const ph = rows[cur]!;
  const isLast = cur === rows.length - 1;
  const patch = (p: Partial<Row>) => setRows(rows.map((r, i) => (i === cur ? { ...r, ...p } : r)));

  /** Fases com os dias calculados em sequência (sem lacuna nem sobreposição por construção). */
  const build = (): { phases: PhaseVM[]; errors: string[] } => {
    const errs: string[] = [];
    let from = 1;
    const phases = rows.map((r, i): PhaseVM => {
      const last = i === rows.length - 1;
      let to: number | null = null;
      if (last && r.untilEnd) to = null;
      else if (r.days.trim() === "") errs.push(`Fase ${i + 1}: informe quantos dias ela dura.`);
      else {
        const d = num(r.days);
        if (!Number.isInteger(d) || d < 1) errs.push(`Fase ${i + 1}: a duração precisa ser um número de dias (1 ou mais).`);
        else to = from + d - 1;
      }
      const p: PhaseVM = { order: i + 1, everyHours: r.everyHours, fromDay: from, toDay: to, perDose: num(r.perDose) };
      from = (to ?? from) + 1;
      return p;
    });
    return { phases, errors: errs };
  };

  const built = build();
  const timeline = built.phases;
  const lastDay = Math.max(...timeline.map((p) => p.toDay ?? p.fromDay + 10));
  const nowLocal = localNow(new Date(), SCHEME_TZ);
  const startParsed = start.trim() ? parseDate(start) : null;
  const effectiveStart = startParsed ? toIso(startParsed) : (med.startDate ?? nowLocal.date);
  const totalDays = timeline[timeline.length - 1]!.toDay;
  const validNow = built.errors.length === 0 && validateScheme(timeline, first).ok;

  // prévia: os próximos dias do esquema, pelo mesmo cálculo do servidor
  const previewFrom = effectiveStart > nowLocal.date ? effectiveStart : nowLocal.date;
  const preview = validNow
    ? Array.from({ length: PREVIEW_DAYS }, (_, i) => {
        const date = addDaysIso(previewFrom, i);
        const doses = schemeDosesOnDate({ startDate: effectiveStart, firstTime: first, phases: timeline, date });
        const label = date === nowLocal.date ? "Hoje" : date === addDaysIso(nowLocal.date, 1) ? "Amanhã" : toDisplay(date).slice(0, 5);
        return { date, label: `${label} (${toDisplay(date).slice(0, 5)})`, times: doses.map((d) => d.time), past: date === nowLocal.date ? doses.filter((d) => d.time < `${String(Math.floor(nowLocal.minutes / 60)).padStart(2, "0")}:${String(nowLocal.minutes % 60).padStart(2, "0")}`).map((d) => d.time) : [] };
      })
    : [];

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
    const ok = await actions.saveScheme(med.id, { firstTime: first, phases: b.phases, ...(startIso ? { startDate: startIso } : {}) });
    setBusy(false);
    if (ok === false) return;
    toast({ icon: "check_circle", message: `Esquema de ${med.name} salvo` });
  };

  return (
    <form className="flex flex-col gap-4 rounded-lg border border-bd bg-sf p-4" aria-label={`Esquema de ${med.name}`} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Hora da primeira dose" inputMode="numeric" placeholder="15:00" hint="Formato 24h. É o início do intervalo: de 6 em 6 h a partir das 15:00 = 15:00, 21:00, 03:00, 09:00…" value={first} onChange={(e) => setFirst(e.target.value)} />
        <TextField label="Começa em (dia 1)" inputMode="numeric" placeholder="dd/mm/aaaa" hint="A data da primeira dose." value={start} onChange={(e) => setStart(e.target.value)} />
      </div>

      {rows.length > 1 ? (
        <div>
          <div role="img" aria-label={`Fases: ${timeline.map((p) => `fase ${p.order} do dia ${p.fromDay} ${p.toDay == null ? "até acabar o estoque" : `ao ${p.toDay}`}`).join("; ")}${med.treatmentDay ? `; hoje é o dia ${med.treatmentDay}` : ""}`} className="relative flex h-3 gap-1 pt-0">
            {timeline.map((p, i) => (
              <span key={p.order} className={cx("h-3 rounded-pill", i === cur ? "bg-br" : "bg-bd2")} style={{ flex: (p.toDay ?? p.fromDay + 5) - p.fromDay + 1 }} />
            ))}
            {med.treatmentDay && lastDay >= med.treatmentDay ? <span aria-hidden="true" className="absolute -top-1 h-5 w-1 rounded bg-ink" style={{ left: `${(med.treatmentDay / lastDay) * 100}%` }} /> : null}
          </div>
          <div className="mt-1 flex items-center justify-between text-cap text-ink2">
            <span>Dia 1</span>
            {med.treatmentDay ? <span className="font-bold text-ink">Hoje · dia {med.treatmentDay}</span> : null}
            <span>{totalDays == null ? "Até acabar o estoque" : `Dia ${lastDay}`}</span>
          </div>
          <div role="group" aria-label="Fases" className="mt-3 flex flex-wrap items-center gap-2">
            {rows.map((_, i) => (
              <button key={i} type="button" aria-pressed={i === cur} onClick={() => setIdx(i)} className={cx("min-h-touch rounded-pill border-[1.5px] px-4", i === cur ? "border-br bg-brt font-bold text-pn" : "border-bd2")}>
                Fase {i + 1}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 font-bold" id="every-label">De quantas em quantas horas{rows.length > 1 ? ` (fase ${cur + 1})` : ""}</p>
          <div className="flex items-center gap-2" role="group" aria-labelledby="every-label">
            <IconButton icon="remove" label="Diminuir horas entre as doses" className="border-[1.5px] border-bd2" onClick={() => { const i = INTERVAL_HOURS.indexOf(ph.everyHours as never); patch({ everyHours: INTERVAL_HOURS[Math.max(0, i - 1)] ?? ph.everyHours }); }} />
            <span className="num w-24 text-center text-t2 font-extrabold" aria-live="polite">{ph.everyHours} h</span>
            <IconButton icon="add" label="Aumentar horas entre as doses" className="border-[1.5px] border-bd2" onClick={() => { const i = INTERVAL_HOURS.indexOf(ph.everyHours as never); patch({ everyHours: INTERVAL_HOURS[Math.min(INTERVAL_HOURS.length - 1, i + 1)] ?? ph.everyHours }); }} />
          </div>
        </div>
        <TextField label={`Quantidade por dose (${unit})`} inputMode="decimal" value={ph.perDose} onChange={(e) => patch({ perDose: e.target.value })} />
        <div className="sm:col-span-2 flex flex-col gap-3">
          {isLast ? (
            <Switch checked={ph.untilEnd} onChange={(v) => patch({ untilEnd: v, days: v || ph.days.trim() !== "" ? ph.days : "7" })} label="Até acabar o estoque do remédio" />
          ) : null}
          {!isLast || !ph.untilEnd ? (
            <TextField
              label={rows.length > 1 ? `Por quantos dias dura a fase ${cur + 1}` : "Por quantos dias você vai tomar"}
              inputMode="numeric"
              placeholder="7"
              hint="Quantidade de dias seguidos tomando o remédio."
              value={ph.days}
              onChange={(e) => patch({ days: e.target.value })}
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {rows.length < MAX_PHASES ? (
          <Button
            variant="secondary"
            size="sm"
            icon="add"
            onClick={() => {
              // a nova fase vira a última: a anterior passa a ter duração (se estava "até acabar", 7 dias)
              const next = rows.map((r, i) => (i === rows.length - 1 && r.untilEnd ? { ...r, untilEnd: false, days: r.days.trim() === "" ? "7" : r.days } : r));
              setRows([...next, { everyHours: rows[rows.length - 1]!.everyHours, perDose: rows[rows.length - 1]!.perDose, days: "", untilEnd: true }]);
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
              if (cur === rows.length - 1) left[left.length - 1] = { ...left[left.length - 1]!, days: "", untilEnd: true };
              setRows(left);
              setIdx(Math.max(0, cur - 1));
            }}
          >
            Remover fase {cur + 1}
          </Button>
        ) : null}
      </div>

      {validNow ? (
        <div className="flex flex-col gap-1 rounded-md bg-sf2 p-3" aria-label="Resumo do que vai acontecer">
          <p className="font-bold">Como vai ficar</p>
          <p>
            {rows.length === 1 ? `De ${timeline[0]!.everyHours} em ${timeline[0]!.everyHours} h` : `${rows.length} fases`}, começando em {toDisplay(effectiveStart)} às {first}
            {totalDays == null ? ", até acabar o estoque." : `, por ${totalDays} ${totalDays === 1 ? "dia" : "dias"} (até ${toDisplay(addDaysIso(effectiveStart, totalDays - 1))}).`}
          </p>
          <ul className="flex flex-col gap-0.5">
            {preview.map((d) => (
              <li key={d.date}>
                <span className="font-bold">{d.label}:</span> {d.times.length ? listText(d.times) : "sem doses"}
                {d.past.length ? ` (já passaram ${listText(d.past)})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-ink2">Informe a hora da primeira dose, a data e a duração para ver como o esquema vai ficar.</p>
      )}

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
