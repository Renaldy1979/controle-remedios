"use client";
import { useMemo, useState } from "react";
import { useCan, useSnapshot, type RxVM } from "@/data";
import { Guard } from "@/components/app/Guard";
import { useOverlay } from "@/components/app/overlay-context";
import { AccessIndicator, RxCard } from "@/components/domain/Rx";
import { Button } from "@/components/ui/Button";
import { SelectChip } from "@/components/ui/Chip";
import { SearchField, SelectField } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/Layout";

type StatusFilter = "all" | RxVM["status"]["kind"];

const STATUS_CHIPS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "valid", label: "Vigentes" },
  { value: "expired", label: "Vencidas" },
  { value: "awaiting_new", label: "Aguardando nova" },
  { value: "superseded", label: "Substituídas" },
];

export function RxListScreen() {
  return (
    <Guard permission="prescriptions.view">
      <RxList />
    </Guard>
  );
}

function RxList() {
  const snap = useSnapshot();
  const canUpload = useCan("prescriptions.upload");
  const { open } = useOverlay();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [patient, setPatient] = useState("all");
  const [doctor, setDoctor] = useState("all");
  const [med, setMed] = useState("all");
  const [period, setPeriod] = useState("all");
  const [sort, setSort] = useState<"new" | "old">("new");
  const [moreOpen, setMoreOpen] = useState(false);

  const all = snap.prescriptions;
  const doctors = useMemo(() => Array.from(new Set(all.map((r) => r.doctor).filter(Boolean))).sort(), [all]);
  const hasFilters = q !== "" || status !== "all" || patient !== "all" || doctor !== "all" || med !== "all" || period !== "all";

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((r) => (status === "all" ? true : r.status.kind === status))
      .filter((r) => (patient === "all" ? true : r.patientId === patient))
      .filter((r) => (doctor === "all" ? true : r.doctor === doctor))
      .filter((r) => (med === "all" ? true : r.medicationIds.includes(med)))
      .filter((r) => (period === "all" ? true : r.daysSinceIssue <= Number(period)))
      .filter((r) => !needle || [r.doctor, r.specialty, r.patientName, r.notes, ...r.medNames].join(" ").toLowerCase().includes(needle))
      .sort((a, b) => (sort === "new" ? a.daysSinceIssue - b.daysSinceIssue : b.daysSinceIssue - a.daysSinceIssue));
  }, [all, q, status, patient, doctor, med, period, sort]);

  const featured = !hasFilters && sort === "new" ? list.find((r) => r.status.kind === "valid" && r.latestValid) : undefined;
  const rest = featured ? list.filter((r) => r.id !== featured.id) : list;
  const clear = () => {
    setQ("");
    setStatus("all");
    setPatient("all");
    setDoctor("all");
    setMed("all");
    setPeriod("all");
  };
  const attach = () => open({ type: "attach" });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 desk:flex-row desk:items-center desk:justify-between">
        <AccessIndicator people={snap.rxAudience ?? snap.people} />
        {canUpload ? (
          <Button size="lg" icon="add_a_photo" onClick={attach} className="w-full desk:w-auto">
            Anexar receita
          </Button>
        ) : null}
      </div>

      {all.length === 0 ? (
        <EmptyState icon="description" title="Nenhuma receita ainda" text="Anexe a foto da primeira receita para a família acompanhar a validade." action={canUpload ? <Button size="lg" icon="add_a_photo" onClick={attach}>Anexar a primeira receita</Button> : undefined} />
      ) : (
        <>
          <SearchField value={q} onChange={setQ} placeholder="Buscar por médico, remédio ou paciente" label="Buscar receitas" />
          <div role="group" aria-label="Situação da receita" className="flex gap-2 overflow-x-auto pb-1">
            {STATUS_CHIPS.map((c) => (
              <SelectChip key={c.value} selected={status === c.value} onToggle={() => setStatus(c.value)} count={c.value === "all" ? all.length : all.filter((r) => r.status.kind === c.value).length}>
                {c.label}
              </SelectChip>
            ))}
          </div>

          <div className="desk:hidden">
            <Button variant="secondary" icon="tune" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
              Mais filtros
            </Button>
          </div>
          <div className={`${moreOpen ? "grid" : "hidden"} grid-cols-1 gap-3 desk:grid desk:grid-cols-5`}>
            <SelectField label="Paciente" value={patient} active={patient !== "all"} onChange={(e) => setPatient(e.target.value)}>
              <option value="all">Todos</option>
              {snap.patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="Médico" value={doctor} active={doctor !== "all"} onChange={(e) => setDoctor(e.target.value)}>
              <option value="all">Todos</option>
              {doctors.map((d) => (
                <option key={d}>{d}</option>
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
            <SelectField label="Período" value={period} active={period !== "all"} onChange={(e) => setPeriod(e.target.value)}>
              <option value="all">Qualquer data</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="365">Último ano</option>
            </SelectField>
            <SelectField label="Ordenar" value={sort} onChange={(e) => setSort(e.target.value as "new" | "old")}>
              <option value="new">Mais recentes</option>
              <option value="old">Mais antigas</option>
            </SelectField>
          </div>

          <p className="text-ink2" aria-live="polite">
            {list.length} {list.length === 1 ? "receita" : "receitas"}
          </p>

          {list.length === 0 ? (
            <EmptyState icon="search_off" title="Nenhuma receita encontrada" text="Tente outra busca ou tire algum filtro." action={<Button variant="secondary" icon="filter_alt_off" onClick={clear}>Limpar busca e filtros</Button>} />
          ) : (
            <ul className="grid gap-3 wide:grid-cols-2">
              {featured ? (
                <li className="wide:col-span-2">
                  <RxCard rx={featured} featured />
                </li>
              ) : null}
              {rest.map((r) => (
                <li key={r.id}>
                  <RxCard rx={r} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
