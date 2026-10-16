"use client";
import Link from "next/link";
import { useSnapshot, useCan } from "@/data";
import { Guard } from "@/components/app/Guard";
import { DoseCard } from "@/components/domain/DoseCard";
import { StockCard } from "@/components/domain/StockCard";
import { useDoseActions } from "@/components/domain/useDoseActions";
import { Icon } from "@/components/ui/Icon";
import { IconBlock, SectionHeader } from "@/components/ui/Layout";
import { plural } from "@/lib/format";

export function HomeScreen() {
  return (
    <Guard permission="dashboard.view">
      <Home />
    </Guard>
  );
}

function Home() {
  const snap = useSnapshot();
  const canConfirm = useCan("doses.confirm");
  const { confirm, snooze } = useDoseActions();

  const alerts = snap.doses.filter((d) => d.status === "late" || d.status === "missed");
  const next = snap.doses.filter((d) => d.status === "pending");
  const lowStock = snap.medications.filter((m) => m.stock.daysLeft <= 14).sort((a, b) => a.stock.daysLeft - b.stock.daysLeft);
  const taken = snap.doses.filter((d) => d.status === "taken").sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")).slice(0, 5);
  const name = (id: string) => snap.patients.find((p) => p.id === id)?.name ?? "";

  const summary = [alerts.length ? `${plural(alerts.length, "dose pede", "doses pedem")} atenção agora` : "Tudo em dia por enquanto", next[0] ? `próxima às ${next[0].time}` : null].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-display text-t1 font-extrabold">Boa tarde, {snap.member.name}</p>
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

          <section aria-label="Últimas doses tomadas">
            <SectionHeader title="Últimas doses tomadas" />
            <ul className="flex flex-col gap-2">
              {taken.map((d) => (
                <li key={d.id}>
                  <DoseCard dose={d} variant="taken" />
                </li>
              ))}
            </ul>
          </section>

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
        </div>
      </div>
      <p className="flex items-center gap-2 text-cap text-ink3">
        <Icon name="info" size={16} />
        Dados de demonstração (família fictícia).
      </p>
    </div>
  );
}
