"use client";
import { useMemo, useState } from "react";
import { cx } from "@/lib/format";
import { MONTHS_PT, WEEKDAYS_LONG_PT, WEEKDAYS_PT, dosesOnDate, monthGrid, type CalendarMed } from "@/lib/scheme-calendar";
import { SCHEME_TZ, localNow } from "@/lib/times";
import { useSnapshot } from "@/data";
import { IconButton } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { Tag } from "@/components/ui/Chip";

const display = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const weekdayOf = (iso: string) => WEEKDAYS_LONG_PT[new Date(`${iso}T12:00:00Z`).getUTCDay()]!;

/** Calendário dos esquemas: mês com as doses de cada dia, filtrável por paciente e remédio. */
export function SchemeCalendar() {
  const snap = useSnapshot();
  const today = localNow(new Date(), SCHEME_TZ).date;
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month0, setMonth0] = useState(Number(today.slice(5, 7)) - 1);
  const [selected, setSelected] = useState(today);
  const [patientId, setPatientId] = useState("");
  const [medId, setMedId] = useState("");

  const medsOfPatient = snap.medications.filter((m) => !patientId || m.patientId === patientId);
  const meds: CalendarMed[] = useMemo(
    () =>
      snap.medications
        .filter((m) => (!patientId || m.patientId === patientId) && (!medId || m.id === medId))
        .map((m) => ({ id: m.id, patientId: m.patientId, name: m.name, unitLabel: m.unitLabel, firstTime: m.firstTime, startDate: m.startDate, phases: m.phases })),
    [snap.medications, patientId, medId],
  );
  const patientName = (id: string) => snap.patients.find((p) => p.id === id)?.name ?? "";
  const grid = useMemo(() => monthGrid(year, month0), [year, month0]);
  const counts = useMemo(() => new Map(grid.flat().map((c) => [c.date, dosesOnDate(meds, c.date).length])), [grid, meds]);
  const dayDoses = useMemo(() => dosesOnDate(meds, selected), [meds, selected]);

  const go = (delta: number) => {
    const d = new Date(Date.UTC(year, month0 + delta, 1));
    setYear(d.getUTCFullYear());
    setMonth0(d.getUTCMonth());
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Paciente" value={patientId} onChange={(e) => { setPatientId(e.target.value); setMedId(""); }}>
          <option value="">Todos os pacientes</option>
          {snap.patients.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </SelectField>
        <SelectField label="Remédio" value={medId} onChange={(e) => setMedId(e.target.value)}>
          <option value="">Todos os remédios</option>
          {medsOfPatient.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </SelectField>
      </div>

      <div className="rounded-lg border border-bd bg-sf p-3 desk:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <IconButton icon="chevron_left" label="Mês anterior" className="border-[1.5px] border-bd2" onClick={() => go(-1)} />
          <h2 className="text-t3 font-extrabold capitalize" aria-live="polite">{MONTHS_PT[month0]} de {year}</h2>
          <IconButton icon="chevron_right" label="Próximo mês" className="border-[1.5px] border-bd2" onClick={() => go(1)} />
        </div>
        <table className="w-full table-fixed border-separate border-spacing-1" aria-label={`Doses previstas em ${MONTHS_PT[month0]} de ${year}`}>
          <thead>
            <tr>
              {WEEKDAYS_PT.map((w) => (
                <th key={w} scope="col" className="pb-1 text-cap font-bold text-ink2">{w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((week) => (
              <tr key={week[0]!.date}>
                {week.map((c) => {
                  const n = counts.get(c.date) ?? 0;
                  const isSel = c.date === selected;
                  return (
                    <td key={c.date} className="p-0">
                      <button
                        type="button"
                        aria-pressed={isSel}
                        aria-label={`${Number(c.date.slice(8, 10))} de ${MONTHS_PT[Number(c.date.slice(5, 7)) - 1]}: ${n === 0 ? "sem doses" : `${n} ${n === 1 ? "dose" : "doses"}`}${c.date === today ? ", hoje" : ""}`}
                        onClick={() => { setSelected(c.date); if (!c.inMonth) { setYear(Number(c.date.slice(0, 4))); setMonth0(Number(c.date.slice(5, 7)) - 1); } }}
                        className={cx(
                          "flex min-h-14 w-full flex-col items-center justify-center rounded-md border-[1.5px] px-0.5 py-1",
                          isSel ? "border-br bg-brt font-bold text-pn" : c.date === today ? "border-ink" : "border-transparent hover:bg-sf2",
                          c.inMonth ? "" : "text-ink3",
                        )}
                      >
                        <span className="num text-body">{Number(c.date.slice(8, 10))}</span>
                        <span className={cx("num text-cap", n ? "font-bold" : "text-ink3")}>{n ? `${n} ${n === 1 ? "dose" : "doses"}` : "—"}</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-cap text-ink2">Contorno escuro = hoje. As doses vêm do esquema de cada remédio (fases e horários).</p>
      </div>

      <section aria-label={`Doses de ${display(selected)}`} className="rounded-lg border border-bd bg-sf p-4">
        <h3 className="mb-2 text-body-lg font-bold">
          {weekdayOf(selected)}, {display(selected)}
          {selected === today ? " · hoje" : ""}
        </h3>
        {dayDoses.length === 0 ? (
          <p className="text-ink2">Nenhuma dose prevista neste dia com os filtros escolhidos.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {dayDoses.map((d) => (
              <li key={`${d.medicationId}-${d.time}`} className="flex flex-wrap items-center gap-2">
                <Tag icon="schedule">{d.time}</Tag>
                <span className="font-bold">{d.medName}</span>
                <span className="text-ink2">· {d.doseText}{patientId ? "" : ` · ${patientName(d.patientId)}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
