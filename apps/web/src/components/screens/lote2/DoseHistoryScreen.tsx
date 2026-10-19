"use client";
import { useEffect, useRef, useState } from "react";
import type { DoseStatus } from "@medcuidar/shared";
import { DOSE_STATUS, CHANNEL } from "@/lib/status";
import { addDays, fmtDate } from "@/lib/format";
import { useActions, useSnapshot, type DoseHistoryResult, type DoseHistoryRowVM } from "@/data";
import { Guard } from "@/components/app/Guard";
import { Button } from "@/components/ui/Button";
import { SelectChip, StatusChip } from "@/components/ui/Chip";
import { SelectField } from "@/components/ui/Field";
import { EmptyState, Table, Td, Th, Timeline } from "@/components/ui/Layout";
import { Tabs } from "@/components/ui/Tabs";

type StatusFilter = "all" | DoseStatus;
type View = "timeline" | "table";
type Period = "today" | "yesterday" | "7" | "30" | "all";

const CHIPS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "taken", label: "Tomadas" },
  { value: "late", label: "Atrasadas" },
  { value: "missed", label: "Esquecidas" },
  { value: "pending", label: "Pendentes" },
];

/** Histórico de doses (Lote 2): filtros por paciente, remédio, pessoa, período e situação, aplicados no servidor. */
export function DoseHistoryScreen() {
  return (
    <Guard permission="doses.history.view">
      <History />
    </Guard>
  );
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function History() {
  const snap = useSnapshot();
  const actions = useActions();
  const [patient, setPatient] = useState("all");
  const [med, setMed] = useState("all");
  const [person, setPerson] = useState("all");
  const [period, setPeriod] = useState<Period>("7");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [view, setView] = useState<View>("timeline");
  const [data, setData] = useState<DoseHistoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // as pessoas do filtro vêm das respostas (quem já confirmou doses) e não somem ao filtrar
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (window.matchMedia("(min-width: 900px)").matches) setView("table");
  }, []);

  // dd/mm/aaaa (hoje, no fuso da família) -> Date local sem hora
  const todayStr = snap.todayDate;
  const today = (() => {
    const [d, m, y] = todayStr.split("/").map(Number) as [number, number, number];
    return new Date(y, m - 1, d);
  })();

  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    const [d, m, y] = todayStr.split("/").map(Number) as [number, number, number];
    const t0 = new Date(y, m - 1, d);
    const range =
      period === "today" ? { from: iso(t0), to: iso(t0) }
      : period === "yesterday" ? { from: iso(addDays(t0, -1)), to: iso(addDays(t0, -1)) }
      : period === "7" ? { from: iso(addDays(t0, -6)), to: iso(t0) }
      : period === "30" ? { from: iso(addDays(t0, -29)), to: iso(t0) }
      : {};
    void Promise.resolve(
      actions.loadDoseHistory({
        ...(patient !== "all" ? { patientId: patient } : {}),
        ...(med !== "all" ? { medicationId: med } : {}),
        ...(person !== "all" ? { memberId: person } : {}),
        ...(status !== "all" ? { status } : {}),
        ...range,
      }),
    ).then((r) => {
      if (mine !== seq.current) return;
      setLoading(false);
      if (r) {
        setData(r);
        setPeople((cur) => (r.people.length >= cur.length ? r.people : cur));
      }
    });
  }, [patient, med, person, period, status, todayStr, actions]);

  const rows = data?.rows ?? [];
  const clear = () => {
    setPatient("all");
    setMed("all");
    setPerson("all");
    setPeriod("7");
    setStatus("all");
  };

  const detail = (r: DoseHistoryRowVM) => {
    const who = r.who
      ? `${r.who}${r.doneLabel ? ` · ${r.doneLabel}` : ""}${r.channel ? ` · ${CHANNEL[r.channel].label}` : ""}`
      : r.status === "missed" ? "Ninguém confirmou" : r.status === "late" ? "Ainda sem confirmação" : "";
    return [r.patientName, r.doseText, who].filter(Boolean).join(" · ");
  };
  const days = Array.from(new Set(rows.map((r) => r.dateLabel)));
  const noFilters = period === "7" && patient === "all" && med === "all" && person === "all" && status === "all";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 wide:grid-cols-4">
        <SelectField label="Paciente" value={patient} active={patient !== "all"} onChange={(e) => setPatient(e.target.value)}>
          <option value="all">Todos</option>
          {snap.patients.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </SelectField>
        <SelectField label="Remédio" value={med} active={med !== "all"} onChange={(e) => setMed(e.target.value)}>
          <option value="all">Todos</option>
          {snap.medications.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </SelectField>
        <SelectField label="Quem deu" value={person} active={person !== "all"} onChange={(e) => setPerson(e.target.value)}>
          <option value="all">Todas as pessoas</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </SelectField>
        <SelectField label="Período" value={period} active={period !== "7"} onChange={(e) => setPeriod(e.target.value as Period)}>
          <option value="today">Hoje</option>
          <option value="yesterday">Ontem</option>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="all">Tudo</option>
        </SelectField>
      </div>

      <div role="group" aria-label="Situação da dose" className="flex gap-2 overflow-x-auto pb-1">
        {CHIPS.map((c) => (
          <SelectChip key={c.value} selected={status === c.value} onToggle={() => setStatus(c.value)}>
            {c.label}
          </SelectChip>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-ink2" aria-live="polite" data-testid="history-count">
          {loading && !data ? "Carregando…" : `${rows.length}${data?.truncated ? "+" : ""} ${rows.length === 1 ? "registro" : "registros"}`}
        </p>
        <div className="w-64 flex-none [&_button]:whitespace-nowrap">
          <Tabs label="Forma de exibir" value={view} onChange={setView} items={[{ value: "timeline", label: "Linha do tempo" }, { value: "table", label: "Tabela" }]} idPrefix="hist" />
        </div>
      </div>
      {data?.truncated ? <p className="text-cap text-ink2">Mostrando os registros mais recentes. Use os filtros para ver os mais antigos.</p> : null}

      {!loading && rows.length === 0 ? (
        <EmptyState
          icon="search_off"
          title={noFilters ? "Ainda não há doses no histórico" : "Nenhum registro com esses filtros"}
          text="As doses aparecem aqui quando chega a hora delas. Quem deu o check e quando fica registrado."
          action={<Button variant="secondary" icon="filter_alt_off" onClick={clear}>Limpar filtros</Button>}
        />
      ) : view === "timeline" ? (
        <div className="flex flex-col gap-5">
          {days.map((d) => (
            <section key={d} aria-label={d}>
              <h2 className="mb-3 text-cap font-bold tracking-wide text-ink2">{d === fmtDate(today) ? `HOJE · ${d}` : d}</h2>
              <Timeline
                label={d}
                items={rows.filter((r) => r.dateLabel === d).map((r) => ({
                  id: r.id,
                  icon: DOSE_STATUS[r.status].icon,
                  tone: DOSE_STATUS[r.status].tone,
                  title: `${r.medName} · ${r.time}`,
                  statusLabel: DOSE_STATUS[r.status].label,
                  detail: detail(r),
                  time: r.time,
                }))}
              />
            </section>
          ))}
        </div>
      ) : (
        <Table>
          <caption className="sr-only">Histórico de doses</caption>
          <thead>
            <tr>
              <Th>Dia e hora</Th>
              <Th>Remédio</Th>
              <Th>Paciente</Th>
              <Th>Situação</Th>
              <Th>Quem deu</Th>
              <Th>Quando</Th>
              <Th>Canal</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-sf2">
                <Td className="num whitespace-nowrap">{r.dateLabel.slice(0, 5)} · {r.time}</Td>
                <Td className="font-bold">{r.medName} <span className="font-normal text-ink2">· {r.doseText}</span></Td>
                <Td>{r.patientName}</Td>
                <Td>
                  <StatusChip compact label={DOSE_STATUS[r.status].label} icon={DOSE_STATUS[r.status].icon} tone={DOSE_STATUS[r.status].tone} />
                </Td>
                <Td>{r.who || "—"}</Td>
                <Td className="num whitespace-nowrap">{r.doneLabel || "—"}</Td>
                <Td>{r.channel ? CHANNEL[r.channel].label : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
