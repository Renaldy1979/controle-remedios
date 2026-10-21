"use client";
import Link from "next/link";
import { useSnapshot, useCan, useDataKind } from "@/data";
import { Guard } from "@/components/app/Guard";
import { DoseCard } from "@/components/domain/DoseCard";
import { StockCard } from "@/components/domain/StockCard";
import { useDoseActions } from "@/components/domain/useDoseActions";
import { Icon } from "@/components/ui/Icon";
import { IconBlock, SectionHeader } from "@/components/ui/Layout";
import { plural } from "@/lib/format";
import { TONE_BG } from "@/lib/status";
import { useOverlay } from "@/components/app/overlay-context";
import { Button } from "@/components/ui/Button";
import { Lote1Home } from "./lote1/Lote1Home";

export function HomeScreen() {
  return (
    <Guard permission="dashboard.view">
      <Home />
    </Guard>
  );
}

function Home() {
  const snap = useSnapshot();
  const real = useDataKind() === "postgres";
  const canConfirm = useCan("doses.confirm");
  const canStock = useCan("stock.view");
  const { confirm, snooze } = useDoseActions();

  const alerts = snap.doses.filter((d) => d.status === "late" || d.status === "missed");
  const next = snap.doses.filter((d) => d.status === "pending");
  const lowStock = !canStock
    ? []
    : snap.medications.filter((m) => (real ? m.stock.tracked !== false && m.stock.level !== "ok" : m.stock.daysLeft <= 14)).sort((a, b) => a.stock.daysLeft - b.stock.daysLeft);
  const taken = real
    ? (snap.recentTaken ?? [])
    : snap.doses.filter((d) => d.status === "taken").sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")).slice(0, 5);
  const name = (id: string) => snap.patients.find((p) => p.id === id)?.name ?? "";

  const hour = Number(/·\s*(\d{2}):/.exec(snap.nowLabel)?.[1] ?? 12);
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const summary = [alerts.length ? `${plural(alerts.length, "dose pede", "doses pedem")} atenção agora` : "Tudo em dia por enquanto", next[0] ? `próxima às ${next[0].time}` : null].filter(Boolean).join(" · ");

  // origem real, ainda sem remédios: o caminho é cadastrar (primeiros passos)
  if (real && snap.medications.length === 0) return <Lote1Home />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-display text-t1 font-extrabold">{greeting}, {snap.member.name}</p>
        <p className="text-body-lg text-ink2">{summary}</p>
      </div>

      <div className="grid gap-6 desk:grid-cols-[1.25fr_1fr] desk:items-start">
        <div className="flex flex-col gap-6">
          <section id="alertas" aria-labelledby="h-alertas" className="scroll-mt-20">
            <SectionHeader title="Pedem atenção" count={alerts.length} />
            <span id="h-alertas" className="sr-only">
              Doses que pedem atenção
            </span>
            {alerts.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-bd bg-sf p-4">
                <IconBlock name="task_alt" tone="ok" />
                <div>
                  <p className="text-t3 font-bold">Tudo em dia</p>
                  <p className="text-ink2">Nenhuma dose atrasada ou esquecida.</p>
                </div>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {alerts.map((d) => (
                  <li key={d.id}>
                    <DoseCard dose={d} variant={d.status === "late" ? "late" : "missed"} canConfirm={canConfirm} onConfirm={confirm} onSnooze={snooze} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Próximas doses">
            <SectionHeader title="Próximas doses" action={<Link href="/pacientes" className="inline-flex min-h-touch items-center font-bold text-br underline">Ver todas</Link>} />
            {next.length === 0 ? (
              <p className="rounded-lg border border-bd bg-sf p-4 text-ink2">Não há mais doses hoje.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {next.slice(0, 5).map((d, i) => (
                  <li key={d.id}>
                    <DoseCard dose={d} variant={i === 0 ? "featured" : "compact"} canConfirm={canConfirm} onConfirm={confirm} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          {canStock ? (
          <section aria-label="Estoque perto de acabar">
            <SectionHeader title="Estoque perto de acabar" action={<Link href="/configuracoes/estoque" className="inline-flex min-h-touch items-center font-bold text-br underline">Estoque</Link>} />
            {lowStock.length === 0 ? (
              <p className="rounded-lg border border-bd bg-sf p-4 text-ink2">Nenhum remédio com menos de 14 dias.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {lowStock.map((m) => (
                  <li key={m.id}>
                    <StockCard med={m} patientName={name(m.patientId)} withActions />
                  </li>
                ))}
              </ul>
            )}
          </section>
          ) : null}

          <section aria-label="Últimas doses tomadas">
            <SectionHeader title="Últimas doses tomadas" />
            {taken.length === 0 ? (
              <p className="rounded-lg border border-bd bg-sf p-4 text-ink2">Nenhuma dose tomada ainda.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {taken.map((d) => (
                  <li key={d.id}>
                    <DoseCard dose={d} variant="taken" />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {real ? (
            <RxAttention />
          ) : (
          <section aria-label="Últimas interações">
            <SectionHeader title="Últimas interações" />
            <ul className="divide-y divide-bd rounded-lg border border-bd bg-sf">
              {snap.interactions.slice(0, 6).map((i) => (
                <li key={i.id} className="flex items-start gap-3 p-3">
                  <IconBlock name={i.icon} tone={i.tone} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{i.text}</p>
                    <p className="text-cap text-ink2">{i.sub}</p>
                  </div>
                  <span className="num text-cap text-ink3">{i.time}</span>
                </li>
              ))}
            </ul>
          </section>
          )}
        </div>
      </div>
      {real ? null : (
        <p className="flex items-center gap-2 text-cap text-ink3">
          <Icon name="info" size={16} />
          Dados de demonstração (família fictícia).
        </p>
      )}
    </div>
  );
}

/** Receitas que pedem atenção (vence em breve, vencida, aguardando nova ou sem receita), com o caminho direto para ver ou anexar. */
function RxAttention() {
  const snap = useSnapshot();
  const { open } = useOverlay();
  const canView = useCan("prescriptions.view");
  const canUpload = useCan("prescriptions.upload");
  if (!canView && !canUpload) return null;
  const items = snap.medications.filter((m) => !m.otc && m.rx.kind !== "ok" && m.rx.kind !== "otc");
  const patient = (id: string) => snap.patients.find((p) => p.id === id)?.name ?? "";
  return (
    <section aria-label="Receitas que pedem atenção">
      <SectionHeader title="Receitas" action={canView ? <Link href="/receitas" className="inline-flex min-h-touch items-center font-bold text-br underline">Ver receitas</Link> : undefined} />
      {items.length === 0 ? (
        <p className="rounded-lg border border-bd bg-sf p-4 text-ink2">{snap.medications.some((m) => !m.otc) ? "Todas as receitas estão em dia." : "Nenhum remédio precisa de receita."}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 rounded-lg border border-bd bg-sf p-4">
              <p className="font-bold">
                {m.name} <span className="font-normal text-ink2">· {patient(m.patientId)}</span>
              </p>
              <p className={`inline-flex w-fit items-center gap-1.5 rounded-pill px-3 py-1 text-cap font-bold ${TONE_BG[m.rx.tone]}`}>
                <Icon name={m.rx.icon} size={18} />
                {m.rx.text}
              </p>
              <div className="flex flex-wrap gap-2">
                {m.rx.rxId && canView ? (
                  <Button variant="secondary" icon="description" onClick={() => open({ type: "viewer", rxId: m.rx.rxId!, page: 0 })}>
                    Ver receita
                  </Button>
                ) : null}
                {canUpload ? (
                  <Button variant="secondary" icon="add_a_photo" onClick={() => open({ type: "attach", preset: { patientId: m.patientId, medicationIds: [m.id] } })}>
                    Anexar receita
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
