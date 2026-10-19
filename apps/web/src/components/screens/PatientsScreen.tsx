"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { cx } from "@/lib/format";
import { DOSE_STATUS, STOCK_LEVEL, STOCK_TEXT, TONE_BG, TONE_TEXT } from "@/lib/status";
import Link from "next/link";
import { useCan, useDataKind, useSnapshot, type DoseVM, type MedicationVM } from "@/data";
import { Guard } from "@/components/app/Guard";
import { useOverlay } from "@/components/app/overlay-context";
import { useDoseActions } from "@/components/domain/useDoseActions";
import { Icon } from "@/components/ui/Icon";
import { StatusChip, Tag } from "@/components/ui/Chip";
import { EmptyState, StockBar } from "@/components/ui/Layout";
import { Tabs, tabPanelProps } from "@/components/ui/Tabs";

export function PatientsScreen() {
  return (
    <Guard permission="patients.view">
      <Patients />
    </Guard>
  );
}

function Patients() {
  const snap = useSnapshot();
  const router = useRouter();
  const params = useSearchParams();
  const real = useDataKind() === "postgres";
  const canManage = useCan("patients.manage");
  // dd/mm/aaaa -> aaaa-mm-dd; doses de ontem ainda sem resolução aparecem nos alertas do Início, não aqui
  const todayIso = snap.todayDate.split("/").reverse().join("-");
  const first = snap.patients[0];
  if (!first) {
    return (
      <EmptyState
        icon="elderly"
        title="Nenhum paciente cadastrado"
        text={canManage ? "Cadastre quem toma os remédios para começar." : "Peça a quem administra a família para cadastrar os pacientes."}
        action={canManage ? <Link href="/configuracoes/pacientes" className="inline-flex min-h-touch items-center gap-1 font-bold text-br">Cadastrar paciente</Link> : undefined}
      />
    );
  }
  const current = snap.patients.find((p) => p.id === params.get("p")) ?? first;
  const doses = snap.doses.filter((d) => d.patientId === current.id && (!d.date || d.date === todayIso));
  const taken = doses.filter((d) => d.status === "taken").length;
  const count = (s: DoseVM["status"]) => doses.filter((d) => d.status === s).length;
  const meds = snap.medications.filter((m) => m.patientId === current.id);

  const items = snap.patients.map((p) => ({
    value: p.id,
    label: p.name,
    alertLabel: snap.doses.some((d) => d.patientId === p.id && (d.status === "late" || d.status === "missed")) ? `${p.name} tem doses que pedem atenção` : undefined,
  }));

  return (
    <div className="flex flex-col gap-5">
      <Tabs label="Paciente" items={items} value={current.id} onChange={(id) => router.replace(`/pacientes?p=${id}`, { scroll: false })} variant="underline" idPrefix="pac" />
      <div {...tabPanelProps("pac", current.id)} className="flex flex-col gap-5">
        <section aria-label="Resumo do dia" className="flex flex-col gap-3 rounded-lg border border-bd bg-sf p-4">
          <div>
            <p className="font-display text-t2 font-bold">
              {current.fullName}{current.age ? `, ${current.age} anos` : ""}
            </p>
            <p className="text-ink2">{current.note}</p>
          </div>
          <p className="text-body-lg font-bold">
            {taken} de {doses.length} doses tomadas hoje
          </p>
          <div className="flex flex-wrap gap-2">
            {(["pending", "late", "missed"] as const).map((s) => (
              <StatusChip key={s} compact tone={DOSE_STATUS[s].tone} icon={DOSE_STATUS[s].icon} label={`${count(s)} ${DOSE_STATUS[s].label.toLowerCase()}${count(s) === 1 ? "" : "s"}`} />
            ))}
          </div>
          {!real && current.id === "ma" ? (
            <p className="flex items-start gap-2 rounded-md bg-pn-bg p-3 text-pn">
              <Icon name="groups" size={22} className="mt-0.5" />
              <span>Maria não usa celular. Quem confirma por turno: Rosa (6h–14h), Lúcia (14h–22h) e Seu João (à noite).</span>
            </p>
          ) : null}
        </section>

        <ul className="grid gap-4 wide:grid-cols-2">
          {meds.map((m) => (
            <li key={m.id}>
              <MedicationBlock med={m} doses={doses.filter((d) => d.medicationId === m.id)} real={real} />
            </li>
          ))}
        </ul>
        {meds.length === 0 ? <p className="text-ink2">Nenhum remédio cadastrado para {current.name}.</p> : null}
      </div>
    </div>
  );
}

function MedicationBlock({ med, doses, real }: { med: MedicationVM; doses: DoseVM[]; real: boolean }) {
  const { open } = useOverlay();
  const { confirm } = useDoseActions();
  const canConfirm = useCan("doses.confirm");
  const canViewRx = useCan("prescriptions.view");
  const canUpload = useCan("prescriptions.upload");
  const canStock = useCan("stock.view");
  const canAdjust = useCan("stock.adjust");
  const lvl = STOCK_LEVEL[med.stock.level];

  const rxAction = (() => {
    if (real || med.rx.kind === "otc") return null;
    if (med.rx.rxId && canViewRx) return () => open({ type: "viewer", rxId: med.rx.rxId!, page: 0 });
    if (!med.rx.rxId && canUpload) return () => open({ type: "attach", preset: { patientId: med.patientId, medicationIds: [med.id] } });
    return null;
  })();

  return (
    <article aria-label={med.name} className="flex h-full flex-col gap-3 rounded-lg border border-bd bg-sf p-4 shadow-sm">
      <div>
        <h2 className="flex items-center gap-2 text-t3 font-bold">
          {med.name}
          {med.rx.alert ? (
            <>
              <Icon name="warning" size={22} className="text-lt" />
              <span className="sr-only">Atenção: {med.rx.text}</span>
            </>
          ) : null}
        </h2>
        {med.alternatives.length > 1 ? <p className="text-cap text-ink2">Marcas: {med.alternatives.join(" ou ")} · só uma delas</p> : null}
        <p className="text-ink2">
          {med.doseText} · {med.scheduleText}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Tag icon="medication">{med.routeLabel}</Tag>
        <Tag icon="timeline">{med.phaseText}</Tag>
      </div>

      {rxAction ? (
        <button type="button" onClick={rxAction} className={cx("flex min-h-touch items-center gap-2 rounded-md px-3 py-2 text-left font-bold", TONE_BG[med.rx.tone])}>
          <Icon name={med.rx.icon} size={20} />
          <span className="flex-1">{med.rx.label}</span>
          <Icon name="chevron_right" size={20} />
        </button>
      ) : (
        <p className={cx("flex min-h-touch items-center gap-2 rounded-md px-3 py-2 font-bold", TONE_BG[med.rx.tone])}>
          <Icon name={med.rx.icon} size={20} />
          {med.rx.label}
        </p>
      )}

      <ul className="flex flex-wrap gap-2" aria-label="Horários de hoje">
        {doses.map((d) => {
          const st = DOSE_STATUS[d.status];
          const actionable = canConfirm && (d.status === "pending" || d.status === "late" || d.status === "missed");
          const inner = (
            <>
              <Icon name={st.icon} size={20} />
              <span className="num font-bold">{d.time}</span>
              <span className="text-cap">{st.label}</span>
            </>
          );
          const cls = cx("inline-flex min-h-touch items-center gap-1.5 rounded-pill px-3", TONE_BG[st.tone]);
          return (
            <li key={d.id}>
              {actionable ? (
                <button type="button" onClick={() => confirm(d)} aria-label={d.status === "missed" ? `Registrar que tomou depois a dose das ${d.time}` : `Confirmar dose das ${d.time}, ${st.label.toLowerCase()}`} className={cx(cls, "border-[1.5px] border-current")}>
                  {inner}
                </button>
              ) : (
                <span className={cls}>{inner}</span>
              )}
              {real && d.status === "taken" && d.doneBy ? <span className="mt-0.5 block px-1 text-cap text-ink2">{d.doneBy} · {d.doneAt}</span> : null}
            </li>
          );
        })}
      </ul>

      {canStock && med.stock.tracked === false ? (
        <div className="mt-auto flex flex-col gap-2 border-t border-bd pt-3">
          <p className="flex items-center gap-2 font-bold text-ink2"><Icon name="help" size={20} />Estoque ainda não registrado</p>
          {canAdjust ? <Link href={`/configuracoes/estoque?med=${med.id}`} className="inline-flex min-h-touch items-center gap-1 font-bold text-br underline">Registrar compra</Link> : null}
        </div>
      ) : canStock ? (
      <div className="mt-auto flex flex-col gap-2 border-t border-bd pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cx("num text-t2 font-extrabold", STOCK_TEXT[med.stock.level])}>{med.stock.coversUntilEnd ? "Cobre o tratamento" : `${med.stock.daysLeft} dias`}</span>
          <span className="text-ink2">{med.stock.runsOutLabel}</span>
        </div>
        <StockBar pct={med.stock.barPct} level={med.stock.level} label={`${med.stock.daysLeft} dias de estoque`} />
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-cap text-ink2">
          <span className={cx("inline-flex items-center gap-1 font-bold", TONE_TEXT[lvl.tone])}>
            <Icon name={lvl.icon} size={16} />
            {lvl.label}
          </span>
          <span data-testid="stock-quantity" data-quantity={med.stock.quantity}>
            {med.stock.quantityText}
          </span>
          {med.stock.approximate ? <span className="inline-flex items-center gap-1"><Icon name="info" size={16} className="text-br" />Estimativa</span> : null}
        </p>
      </div>
      ) : null}
    </article>
  );
}
