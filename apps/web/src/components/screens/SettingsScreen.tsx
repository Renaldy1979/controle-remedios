"use client";
import Link from "next/link";
import { can, type PermissionKey } from "@medcuidar/shared";
import { cx } from "@/lib/format";
import { useDataKind, useSnapshot } from "@/data";
import { Guard } from "@/components/app/Guard";
import { Icon } from "@/components/ui/Icon";
import { MedicationsPanel } from "./settings/MedicationsPanel";
import { SchemesPanel } from "./settings/SchemesPanel";
import { StockPanel } from "./settings/StockPanel";
import { UsersPanel } from "./settings/UsersPanel";
import { PatientsPanel } from "./settings/PatientsPanel";
import { NoticesPanelLive } from "./lote2/NoticesPanelLive";
import { ProfilesPanel } from "./settings/ProfilesPanel";
import { NoticesPanel } from "./settings/NoticesPanel";

export const SECTIONS = [
  { id: "remedios", label: "Remédios", icon: "medication", help: "Nome, marcas, tipo de uso e dose", permission: "medications.manage" },
  { id: "esquemas", label: "Esquemas", icon: "timeline", help: "Fases, horários e duração", permission: "treatments.manage" },
  { id: "estoque", label: "Estoque", icon: "inventory_2", help: "Compras, ajustes e movimentações", permission: "stock.view" },
  { id: "pacientes", label: "Pacientes", icon: "elderly", help: "Quem toma os remédios", permission: "patients.manage" },
  { id: "usuarios", label: "Pessoas", icon: "group", help: "Convidar, perfis de acesso e desativar", permission: "members.manage" },
  { id: "perfis", label: "Perfis", icon: "admin_panel_settings", help: "O que cada perfil pode fazer", permission: "profiles.manage" },
  { id: "avisos", label: "Avisos", icon: "notifications", help: "Quando e para quem avisar", permission: "settings.manage" },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: string; help: string; permission: PermissionKey }>;

export type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsScreen({ section }: { section?: string }) {
  return (
    <Guard permission="dashboard.view">
      <Settings section={section} />
    </Guard>
  );
}

function Settings({ section }: { section?: string }) {
  const { member } = useSnapshot();
  const allowed = SECTIONS.filter((s) => can(member, s.permission));
  const active = allowed.find((s) => s.id === section);
  // No desktop a lista fica ao lado e o primeiro painel abre por padrão; no mobile /configuracoes mostra só a lista.
  const shown = active ?? allowed[0];

  return (
    <div className="grid gap-6 desk:grid-cols-[280px_1fr] desk:items-start">
      <nav aria-label="Configurações" className={cx(active ? "hidden desk:block" : "block")}>
        <ul className="flex flex-col gap-2">
          {allowed.map((s) => {
            const current = s.id === shown?.id;
            return (
              <li key={s.id}>
                <Link href={`/configuracoes/${s.id}`} aria-current={current ? "page" : undefined} className={cx("flex min-h-14 items-center gap-3 rounded-lg border px-4 py-2", current ? "border-bd bg-sf hover:bg-sf2 desk:border-br desk:bg-brt" : "border-bd bg-sf hover:bg-sf2")}>
                  <Icon name={s.icon} size={26} className={current ? "text-br" : "text-ink2"} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{s.label}</span>
                    <span className="block text-cap text-ink2">{s.help}</span>
                  </span>
                  <Icon name="chevron_right" size={22} className="text-ink3 desk:hidden" />
                </Link>
              </li>
            );
          })}
        </ul>
        {allowed.length === 0 ? <p className="text-ink2">Seu perfil não tem ajustes liberados.</p> : null}
      </nav>

      {shown ? (
        <div className={cx("min-w-0", active ? "block" : "hidden desk:block")}>
          <Link href="/configuracoes" className="mb-3 inline-flex min-h-touch items-center gap-1 font-bold text-br desk:hidden">
            <Icon name="arrow_back" size={22} />
            Configurações
          </Link>
          <h2 className="mb-4 font-display text-t1 font-extrabold">{shown.label}</h2>
          <Panel id={shown.id} />
        </div>
      ) : null}
    </div>
  );
}

function Panel({ id }: { id: SectionId }) {
  const real = useDataKind() === "postgres";
  switch (id) {
    case "pacientes":
      return <PatientsPanel />;
    case "remedios":
      return <MedicationsPanel />;
    case "esquemas":
      return <SchemesPanel />;
    case "estoque":
      return <StockPanel />;
    case "usuarios":
      return <UsersPanel />;
    case "perfis":
      return <ProfilesPanel />;
    case "avisos":
      return real ? <NoticesPanelLive /> : <NoticesPanel />;
  }
}
