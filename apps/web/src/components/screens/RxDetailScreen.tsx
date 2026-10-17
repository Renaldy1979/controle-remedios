"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cx } from "@/lib/format";
import { TONE_TEXT } from "@/lib/status";
import { useActions, useCan, useSnapshot, type RxVM } from "@/data";
import { Guard } from "@/components/app/Guard";
import { useOverlay } from "@/components/app/overlay-context";
import { AccessIndicator, RxThumb, rxPageAlt } from "@/components/domain/Rx";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { StatusChip, Tag } from "@/components/ui/Chip";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { EmptyState, Timeline, type TimelineItem } from "@/components/ui/Layout";
import { useToast } from "@/components/ui/Toast";

export function RxDetailScreen({ id }: { id: string }) {
  return (
    <Guard permission="prescriptions.view">
      <Detail id={id} />
    </Guard>
  );
}

function Detail({ id }: { id: string }) {
  const snap = useSnapshot();
  const actions = useActions();
  const toast = useToast();
  const router = useRouter();
  const { open } = useOverlay();
  const canShare = useCan("prescriptions.share");
  const canUpload = useCan("prescriptions.upload");
  const canDelete = useCan("prescriptions.delete");
  const [confirm, setConfirm] = useState<null | "delete" | "superseded">(null);

  const rx = snap.prescriptions.find((r) => r.id === id);
  if (!rx) return <EmptyState icon="search_off" title="Receita não encontrada" text="Ela pode ter sido excluída." action={<Link href="/receitas" className="inline-flex min-h-touch items-center font-bold text-br underline">Voltar para as receitas</Link>} />;

  const prev = rx.previousId ? snap.prescriptions.find((r) => r.id === rx.previousId) : undefined;
  const next = rx.nextId ? snap.prescriptions.find((r) => r.id === rx.nextId) : undefined;
  const title = `Receita de ${rx.medNames.join(" e ")}`;

  const history: TimelineItem[] = [
    ...(next ? [{ id: "next", icon: "swap_horiz", tone: "neu" as const, title: `Substituída pela receita de ${next.issuedOn}`, detail: <Link className="inline-flex min-h-touch items-center font-bold text-br underline" href={`/receitas/${next.id}`}>Abrir a receita nova</Link> }] : []),
    ...rx.shares.map((s, i) => ({ id: `s${i}`, icon: "share", tone: "br" as const, title: `Compartilhada com ${s.to}`, detail: `${s.who} · ${s.at} · ${s.channel}` })),
    { id: "att", icon: "description", tone: "ok", title: "Receita anexada", detail: `${rx.attachedBy} · ${rx.attachedAt}` },
    ...(prev ? [{ id: "prev", icon: "history", tone: "neu" as const, title: `Substituiu a receita de ${prev.issuedOn}`, detail: <Link className="inline-flex min-h-touch items-center font-bold text-br underline" href={`/receitas/${prev.id}`}>Abrir a receita anterior</Link> }] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <Link href="/receitas" className="inline-flex min-h-touch w-fit items-center gap-1 font-bold text-br">
        <Icon name="arrow_back" size={22} />
        Receitas
      </Link>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <StatusChip label={rx.status.label} icon={rx.status.icon} tone={rx.status.tone} />
          <AccessIndicator people={snap.people} />
        </div>
        <h2 className="font-display text-t1 font-extrabold">{title}</h2>
        <p className="text-body-lg text-ink2">
          {rx.patientName} · {rx.doctor || "Médico não informado"}
        </p>
        <p className={cx("flex items-center gap-1.5 text-body-lg font-bold", TONE_TEXT[rx.status.validityTone])}>
          <Icon name={rx.status.validityIcon} size={22} />
          {rx.status.validityText}
        </p>
      </header>

      <div className="grid gap-6 desk:grid-cols-2 desk:items-start">
        <div className="flex flex-col gap-4">
          <button type="button" onClick={() => open({ type: "viewer", rxId: rx.id, page: 0 })} aria-label={`Abrir ${rxPageAlt(rx, 1)} em tela cheia`} className="mx-auto block w-full max-w-[420px] rounded-lg">
            <RxThumb alt={rxPageAlt(rx, 1)} src={rx.pageUrls?.[0]?.full} pages={rx.pages} width={420} />
          </button>
          {rx.pages > 1 ? (
            <ul className="flex gap-2" aria-label="Páginas da receita">
              {Array.from({ length: rx.pages }, (_, i) => (
                <li key={i}>
                  <RxThumb alt={rxPageAlt(rx, i + 1)} src={rx.pageUrls?.[i]?.thumb} width={72} onClick={() => open({ type: "viewer", rxId: rx.id, page: i })} />
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {canShare ? (
              <Button icon="share" onClick={() => open({ type: "share", rxId: rx.id })}>
                Compartilhar
              </Button>
            ) : null}
            <Button variant="secondary" icon="download" onClick={() => toast({ icon: "download", message: "Baixar fica disponível quando o armazenamento for ligado" })}>
              Baixar
            </Button>
            {canUpload ? (
              <Button variant="secondary" icon="edit" onClick={() => open({ type: "attach", preset: { editId: rx.id } })}>
                Editar
              </Button>
            ) : null}
            {canUpload && rx.status.kind !== "superseded" ? (
              <Button variant="secondary" icon="swap_horiz" onClick={() => setConfirm("superseded")}>
                Marcar como substituída
              </Button>
            ) : null}
            {canDelete ? (
              <Button variant="dangerOutline" icon="delete" onClick={() => setConfirm("delete")}>
                Excluir
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <Section title="Dados">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <Row k="Paciente" v={rx.patientName} />
              <Row k="Médico" v={rx.doctor || "Não informado"} />
              <Row k="Especialidade" v={rx.specialty || "Não informada"} />
              <Row k="Emissão" v={rx.issuedOn} />
              <Row k="Anexada por" v={`${rx.attachedBy} · ${rx.attachedAt}`} />
              <Row k="Observações" v={rx.notes || "Nenhuma"} />
            </dl>
            {rx.controlledCopies ? <div className="mt-2"><Tag tone="lt" icon="lock">Controle especial · {rx.controlledCopies} vias</Tag></div> : null}
          </Section>

          <Section title="Remédios desta receita">
            <ul className="flex flex-col gap-2">
              {rx.medicationIds.map((mid, i) => {
                const m = snap.medications.find((x) => x.id === mid);
                return (
                  <li key={mid}>
                    <Link href={`/pacientes?p=${rx.patientId}`} className="flex min-h-touch items-center gap-2 rounded-md px-2 hover:bg-sf2">
                      <Icon name="medication" size={22} className="text-br" />
                      <span className="flex-1 font-bold">{rx.medNames[i]}</span>
                      {m ? <span className="text-cap text-ink2">{m.stock.daysLeft} dias de estoque</span> : null}
                      <Icon name="chevron_right" size={20} className="text-ink3" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title="Histórico">
            <Timeline items={history} label="Histórico da receita" />
          </Section>

          <Section title="Quem já viu">
            <ViewList rx={rx} people={snap.people} />
          </Section>
        </div>
      </div>

      {confirm === "delete" ? (
        <ConfirmDialog
          title="Excluir esta receita?"
          description="A foto sai do MedCuidar e a exclusão fica registrada. Você pode desfazer por alguns segundos."
          confirmLabel="Excluir receita"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            if ((await actions.deleteRx(rx.id)) === false) return;
            router.push("/receitas");
            toast({ icon: "delete", message: "Receita excluída", undo: () => void actions.restoreRx(rx.id) });
          }}
        />
      ) : null}
      {confirm === "superseded" ? (
        <ConfirmDialog
          title="Marcar como substituída?"
          description="Use quando já existe uma receita mais nova. Se ela ainda não foi anexada, anexe agora."
          icon="swap_horiz"
          tone="br"
          destructive={false}
          confirmLabel="Anexar a nova"
          altLabel="Só marcar"
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            open({ type: "attach", preset: { patientId: rx.patientId, medicationIds: rx.medicationIds, doctor: rx.doctor, specialty: rx.specialty, replacesId: rx.id } });
          }}
          onAlt={async () => {
            setConfirm(null);
            if ((await actions.markSuperseded(rx.id)) === false) return;
            toast({ icon: "swap_horiz", message: "Receita marcada como substituída" });
          }}
        />
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-bd bg-sf p-4">
      <h3 className="mb-3 font-display text-t2 font-bold">{title}</h3>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-ink2">{k}</dt>
      <dd className="font-bold">{v}</dd>
    </>
  );
}

function ViewList({ rx, people }: { rx: RxVM; people: ReturnType<typeof useSnapshot>["people"] }) {
  return (
    <div className="flex flex-col gap-3">
      {rx.views.length ? (
        <ul className="flex flex-col gap-2">
          {rx.views.map((v) => (
            <li key={v.who + v.when} className="flex items-center gap-2">
              <Icon name="visibility" size={20} className="text-ok" />
              <span className="font-bold">{v.who}</span>
              <span className="text-cap text-ink2">Viu em {v.when}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink2">Ninguém abriu esta receita ainda.</p>
      )}
      {rx.notViewed.length ? (
        <div>
          <p className="font-bold">Ainda não viram</p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {rx.notViewed.map((n) => (
              <li key={n} className="flex items-center gap-2 text-ink2">
                <Icon name="visibility_off" size={18} />
                {n}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <p className="font-bold">Quem pode ver</p>
        <ul className="mt-1 flex flex-wrap gap-2">
          {people.filter((p) => !rx.cannotView.includes(p.name)).map((p) => (
            <li key={p.id} className="flex items-center gap-1.5">
              <Avatar name={p.name} role={p.role} size={28} />
              {p.name}
            </li>
          ))}
        </ul>
        {rx.cannotView.length ? (
          <p className="mt-1 flex items-center gap-1.5 text-cap text-ink2">
            <Icon name="lock" size={16} />
            Sem permissão: {rx.cannotView.join(", ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
