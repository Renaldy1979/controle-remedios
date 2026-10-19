"use client";
import Link from "next/link";
import { can } from "@medcuidar/shared";
import { useSnapshot } from "@/data";
import { Guard } from "@/components/app/Guard";
import { Icon } from "@/components/ui/Icon";
import { IconBlock } from "@/components/ui/Layout";

interface Step {
  id: string;
  title: string;
  done: boolean;
  href: string;
  allowed: boolean;
  doneText: string;
  todoText: string;
}

/** Início do Lote 1: sem doses nem estoque ainda, mostra os "primeiros passos" para deixar a família pronta. */
export function Lote1Home() {
  return (
    <Guard permission="dashboard.view">
      <Home />
    </Guard>
  );
}

function Home() {
  const snap = useSnapshot();
  const { member } = snap;
  const others = snap.people.filter((p) => !p.isSelf && p.active !== false);
  const steps: Step[] = [
    { id: "familia", title: "Família criada", done: true, href: "/configuracoes/usuarios", allowed: false, doneText: `${snap.family.name}`, todoText: "" },
    {
      id: "pessoas", title: "Convidar a família", done: others.length > 0, href: "/configuracoes/usuarios", allowed: can(member, "members.manage"),
      doneText: `${others.length} ${others.length === 1 ? "pessoa convidada" : "pessoas convidadas"}`, todoText: "Convide filhos, cuidadoras e quem mais for ajudar, por e-mail ou por WhatsApp.",
    },
    {
      id: "pacientes", title: "Cadastrar os pacientes", done: snap.patients.length > 0, href: "/configuracoes/pacientes", allowed: can(member, "patients.manage"),
      doneText: snap.patients.map((p) => p.name).join(", "), todoText: "Quem toma os remédios? Pode ser mais de uma pessoa.",
    },
    {
      id: "remedios", title: "Cadastrar os remédios", done: snap.medications.length > 0, href: "/configuracoes/remedios", allowed: can(member, "medications.manage") && snap.patients.length > 0,
      doneText: `${snap.medications.length} ${snap.medications.length === 1 ? "remédio" : "remédios"}`, todoText: "Nome, marcas alternativas, tipo de uso e unidade.",
    },
    {
      id: "esquemas", title: "Montar os esquemas", done: snap.medications.some((m) => m.phases.length > 1 || m.perDose !== 1 || m.times[0] !== "08:00" || m.times.length > 1), href: "/configuracoes/esquemas", allowed: can(member, "treatments.manage") && snap.medications.length > 0,
      doneText: "Esquemas ajustados", todoText: "Horários, quantidade por dose e fases (ex.: 3 em 3 h por 15 dias, depois 6 em 6 h).",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-display text-t1 font-extrabold">Olá, {member.name}</p>
        <p className="text-body-lg text-ink2">Vamos deixar a {snap.family.name} pronta para usar.</p>
      </div>

      <section aria-label="Primeiros passos" className="flex flex-col gap-3">
        <h2 className="font-display text-t2 font-bold">Primeiros passos</h2>
        <ol className="flex flex-col gap-3">
          {steps.map((st, i) => {
            const inner = (
              <>
                <IconBlock name={st.done ? "check_circle" : "radio_button_unchecked"} tone={st.done ? "ok" : "neu"} />
                <span className="min-w-0 flex-1">
                  <span className="block text-t3 font-bold">
                    {i + 1}. {st.title}
                    <span className="sr-only">{st.done ? " — feito" : " — a fazer"}</span>
                  </span>
                  <span className="block text-ink2">{st.done ? st.doneText : st.todoText}</span>
                </span>
                {st.allowed ? <Icon name="chevron_right" size={24} className="text-ink3" /> : null}
              </>
            );
            return (
              <li key={st.id}>
                {st.allowed ? (
                  <Link href={st.href} className="flex min-h-14 items-center gap-3 rounded-lg border border-bd bg-sf p-4 hover:bg-sf2">
                    {inner}
                  </Link>
                ) : (
                  <div className="flex min-h-14 items-center gap-3 rounded-lg border border-bd bg-sf p-4">{inner}</div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-label="Próximos lotes" className="flex items-start gap-3 rounded-lg border border-bd bg-pn-bg p-4 text-pn">
        <Icon name="info" size={24} className="mt-0.5 flex-none" />
        <p>
          <strong>Doses, estoque e receitas chegam nos próximos lotes.</strong> Aqui já dá para cadastrar a família, os pacientes e os remédios. O número de WhatsApp de cada pessoa fica
          &quot;pendente&quot; até a validação, que também vem depois.
        </p>
      </section>
    </div>
  );
}
