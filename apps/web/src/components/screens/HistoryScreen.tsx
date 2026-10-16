"use client";
import { useEffect, useMemo, useState } from "react";
import { useSnapshot, type HistoryEntryVM } from "@/data";
import { Guard } from "@/components/app/Guard";
import { Button } from "@/components/ui/Button";
import { SelectChip, StatusChip } from "@/components/ui/Chip";
import { SelectField } from "@/components/ui/Field";
import { EmptyState, Table, Td, Th, Timeline } from "@/components/ui/Layout";
import { Tabs } from "@/components/ui/Tabs";

type StatusFilter = "all" | "taken" | "late" | "missed" | "other";
type View = "timeline" | "table";

const CHIPS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "taken", label: "Tomadas" },
  { value: "late", label: "Atrasadas" },
  { value: "missed", label: "Esquecidas" },
  { value: "other", label: "Receitas e reposição" },
];

export function HistoryScreen() {
  return (
    <Guard permission="doses.history.view">
      <History />
    </Guard>
  );
}

function History() {
  const snap = useSnapshot();
  const [patient, setPatient] = useState("all");
  const [med, setMed] = useState("all");
  const [person, setPerson] = useState("all");
  const [period, setPeriod] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [view, setView] = useState<View>("timeline");

  useEffect(() => {
    if (window.matchMedia("(min-width: 900px)").matches) setView("table");
  }, []);

  const list = useMemo(
    () =>
      snap.history.filter(
        (h) =>
          (patient === "all" || h.patientId === patient) &&
          (med === "all" || h.medicationIds.includes(med)) &&
          (person === "all" || h.who === person) &&
          (period === "all" || h.day === period) &&
          (status === "all" || (status === "other" ? h.kind !== "dose" : h.status === status)),
      ),
    [snap.history, patient, med, person, period, status],
  );
  const clear = () => {
    setPatient("all");
    setMed("all");
    setPerson("all");
    setPeriod("all");
    setStatus("all");
  };
  const patientName = (id: string) => snap.patients.find((p) => p.id === id)?.name ?? "";
  const days = Array.from(new Set(list.map((h) => h.day)));
  const group = (d: "today" | "yesterday") => list.filter((h) => h.day === d);
  const dayTitle = (h: HistoryEntryVM) => `${h.day === "today" ? "HOJE" : "ONTEM"} · ${h.dayLabel.toUpperCase()}`;

  const toItem = (h: HistoryEntryVM) => ({
    id: h.id,
    icon: h.icon,
    tone: h.tone,
    title: h.title,
    statusLabel: h.statusLabel,
    detail: `${patientName(h.patientId)} · ${h.detail}`,
    time: h.time,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 wide:grid-cols-4">
        <SelectField label="Paciente" value={patient} active={patient !== "all"} onChange={(e) => setPatient(e.target.value)}>
          <option value="all">Todos</option>
          {snap.patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Remédio" value={med} active={med !== "all"} onChange={(e) => setMed(e.target.value)}>
          <option value="all">Todos</option>
          {snap.medications.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Pessoa" value={person} active={person !== "all"} onChange={(e) => setPerson(e.target.value)}>
          <option value="all">Todas</option>
          {snap.people.map((p) => (
            <option key={p.id}>{p.name}</option>
          ))}
        </SelectField>
        <SelectField label="Período" value={period} active={period !== "all"} onChange={(e) => setPeriod(e.target.value)}>
          <option value="all">Hoje e ontem</option>
          <option value="today">Hoje</option>
          <option value="yesterday">Ontem</option>
        </SelectField>
      </div>

      <div role="group" aria-label="Tipo de registro" className="flex gap-2 overflow-x-auto pb-1">
        {CHIPS.map((c) => (
          <SelectChip key={c.value} selected={status === c.value} onToggle={() => setStatus(c.value)}>
            {c.label}
          </SelectChip>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-ink2" aria-live="polite">
          {list.length} {list.length === 1 ? "registro" : "registros"}
        </p>
        <div className="w-64 flex-none [&_button]:whitespace-nowrap">
          <Tabs label="Forma de exibir" value={view} onChange={setView} items={[{ value: "timeline", label: "Linha do tempo" }, { value: "table", label: "Tabela" }]} idPrefix="hist" />
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState icon="search_off" title="Nenhum registro com esses filtros" action={<Button variant="secondary" icon="filter_alt_off" onClick={clear}>Limpar filtros</Button>} />
      ) : view === "timeline" ? (
        <div className="flex flex-col gap-5">
          {days.map((d) => (
            <section key={d} aria-label={dayTitle(group(d)[0]!)}>
              <h2 className="mb-3 text-cap font-bold tracking-wide text-ink2">{dayTitle(group(d)[0]!)}</h2>
              <Timeline label={dayTitle(group(d)[0]!)} items={group(d).map(toItem)} />
            </section>
          ))}
        </div>
      ) : (
        <Table>
          <caption className="sr-only">Histórico de doses e eventos</caption>
          <thead>
            <tr>
              <Th>Quando</Th>
              <Th>Registro</Th>
              <Th>Paciente</Th>
              <Th>Estado</Th>
              <Th>Quem</Th>
              <Th>Canal</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((h) => (
              <tr key={h.id} className="hover:bg-sf2">
                <Td className="num whitespace-nowrap">
                  {h.day === "today" ? "Hoje" : "Ontem"} · {h.time}
                </Td>
                <Td className="font-bold">{h.title}</Td>
                <Td>{patientName(h.patientId)}</Td>
                <Td>
                  <StatusChip compact label={h.statusLabel} icon={h.icon} tone={h.tone} />
                </Td>
                <Td>{h.who || "—"}</Td>
                <Td>{h.channel || "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
