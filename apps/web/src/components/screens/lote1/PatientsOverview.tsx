"use client";
import Link from "next/link";
import { useCan, useSnapshot } from "@/data";
import { Guard } from "@/components/app/Guard";
import { Avatar } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/Layout";

/** Pacientes do Lote 1: quem são e o que tomam (esquemas). As doses do dia chegam no Lote 2. */
export function PatientsOverview() {
  return (
    <Guard permission="patients.view">
      <Overview />
    </Guard>
  );
}

function Overview() {
  const snap = useSnapshot();
  const canManage = useCan("patients.manage");
  if (snap.patients.length === 0) {
    return (
      <EmptyState
        icon="elderly"
        title="Nenhum paciente cadastrado"
        text={canManage ? "Cadastre quem toma os remédios para começar." : "Peça a quem administra a família para cadastrar os pacientes."}
        action={canManage ? <ButtonLink href="/configuracoes/pacientes" icon="person_add">Cadastrar paciente</ButtonLink> : undefined}
      />
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-start gap-2 rounded-lg border border-bd bg-pn-bg p-3 text-pn">
        <Icon name="info" size={22} className="mt-0.5 flex-none" />
        <span>As doses do dia e o estoque chegam no próximo lote. Aqui você confere quem toma o quê e em quais horários.</span>
      </p>
      <ul className="grid gap-4 wide:grid-cols-2">
        {snap.patients.map((p) => {
          const meds = snap.medications.filter((m) => m.patientId === p.id);
          return (
            <li key={p.id}>
              <article aria-label={p.fullName} className="flex h-full flex-col gap-3 rounded-lg border border-bd bg-sf p-4 shadow-sm">
                <div className="flex gap-3">
                  <Avatar name={p.fullName} role="patient" size={52} whatsapp={p.usesPhone} />
                  <div className="min-w-0">
                    <h2 className="font-display text-t2 font-bold">
                      {p.fullName}
                      {p.age ? `, ${p.age} anos` : ""}
                    </h2>
                    {p.note ? <p className="text-ink2">{p.note}</p> : null}
                    <p className="text-cap text-ink2">
                      {p.selfMemberName ? `Tem conta no portal (${p.selfMemberName})` : "Sem conta no portal"} · {p.usesPhone ? "Usa celular" : "Não usa celular"}
                    </p>
                  </div>
                </div>
                {meds.length === 0 ? (
                  <p className="text-ink2">Nenhum remédio cadastrado.</p>
                ) : (
                  <ul className="flex flex-col gap-2" aria-label={`Remédios de ${p.name}`}>
                    {meds.map((m) => (
                      <li key={m.id} className="rounded-md border border-bd p-3">
                        <p className="text-t3 font-bold">{m.name}</p>
                        {m.alternatives.length ? <p className="text-cap text-ink2">Marcas: {m.alternatives.join(" ou ")} · só uma delas</p> : null}
                        <p className="text-ink2">
                          {m.doseText} · {m.scheduleText} · {m.phaseText}
                        </p>
                        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Horários">
                          {m.times.map((t) => (
                            <li key={t}>
                              <Tag icon="schedule">{t}</Tag>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
                {canManage ? (
                  <Link href="/configuracoes/pacientes" className="mt-auto inline-flex min-h-touch items-center gap-1 font-bold text-br">
                    <Icon name="edit" size={20} />
                    Editar cadastro
                  </Link>
                ) : null}
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
