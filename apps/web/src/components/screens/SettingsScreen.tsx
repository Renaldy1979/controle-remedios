"use client";
import Link from "next/link";
import { can } from "@medcuidar/shared";
import { useDataKind, useSnapshot } from "@/data";
import { Guard } from "@/components/app/Guard";
import { PageWithAction } from "@/components/app/PageAction";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/Layout";
import { SECTIONS, isSectionId, visibleSections, type SectionId } from "@/lib/settings-sections";
import { MedicationsPanel } from "./settings/MedicationsPanel";
import { SchemesPanel } from "./settings/SchemesPanel";
import { StockPanel } from "./settings/StockPanel";
import { UsersPanel } from "./settings/UsersPanel";
import { PatientsPanel } from "./settings/PatientsPanel";
import { NoticesPanelLive } from "./lote2/NoticesPanelLive";
import { ProfilesPanel } from "./settings/ProfilesPanel";
import { NoticesPanel } from "./settings/NoticesPanel";
import { WhatsappPanel } from "./settings/WhatsappPanel";
import { SimulatorPanel } from "./settings/SimulatorPanel";

export { SECTIONS, type SectionId };

/**
 * Configurações em árvore: `/configuracoes` é o índice (lista de opções) e cada opção é uma página com rota própria,
 * título e trilha ("Configurações › Remédios"). No desktop as opções também são a árvore do menu lateral.
 */
export function SettingsScreen({ section }: { section?: string }) {
  return (
    <Guard permission="dashboard.view">{section ? <SectionPage section={section} /> : <SettingsIndex />}</Guard>
  );
}

function SettingsIndex() {
  const { member, simulatorEnabled } = useSnapshot();
  const allowed = visibleSections(member, simulatorEnabled);
  if (allowed.length === 0) return <p className="text-ink2">Seu perfil não tem ajustes liberados.</p>;
  return (
    <nav aria-label="Opções de Configurações">
      <ul className="grid gap-3 desk:grid-cols-2">
        {allowed.map((s) => (
          <li key={s.id}>
            <Link href={`/configuracoes/${s.id}`} className="flex min-h-16 items-center gap-3 rounded-lg border border-bd bg-sf px-4 py-3 hover:bg-sf2">
              <span aria-hidden="true" className="flex h-12 w-12 flex-none items-center justify-center rounded-[14px] bg-brt text-pn">
                <Icon name={s.icon} size={26} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body-lg font-bold">{s.label}</span>
                <span className="block text-cap text-ink2">{s.help}</span>
              </span>
              <Icon name="chevron_right" size={22} className="text-ink3" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SectionPage({ section }: { section: string }) {
  const { member, simulatorEnabled } = useSnapshot();
  const meta = visibleSections(member, simulatorEnabled).find((s) => s.id === section) ?? SECTIONS.find((s) => s.id === section && !("simulatorOnly" in s));
  if (!meta || !isSectionId(meta.id)) return <EmptyState icon="search_off" title="Esta opção não existe" action={<Link href="/configuracoes" className="inline-flex min-h-touch items-center font-bold text-br underline">Voltar para Configurações</Link>} />;
  if (!can(member, meta.permission)) {
    return <EmptyState icon="lock" title="Esta área não está liberada para o seu perfil" text="Peça a quem administra a família para ajustar as permissões em Configurações › Perfis." action={<Link href="/configuracoes" className="inline-flex min-h-touch items-center font-bold text-br underline">Voltar para Configurações</Link>} />;
  }
  return (
    <div className="min-w-0">
      <Link href="/configuracoes" className="mb-1 inline-flex min-h-touch items-center gap-1 font-bold text-br desk:hidden">
        <Icon name="arrow_back" size={22} />
        Configurações
      </Link>
      <nav aria-label="Trilha de navegação" className="mb-1 hidden text-cap text-ink2 desk:block">
        <ol className="flex items-center gap-1">
          <li>
            <Link href="/configuracoes" className="inline-flex min-h-touch items-center font-bold text-br underline">
              Configurações
            </Link>
          </li>
          <li aria-hidden="true">
            <Icon name="chevron_right" size={18} />
          </li>
          <li aria-current="page" className="font-bold text-ink">
            {meta.label}
          </li>
        </ol>
      </nav>
      <PageWithAction title={meta.label}>
        <Panel id={meta.id} />
      </PageWithAction>
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
    case "pessoas":
      return <UsersPanel />;
    case "perfis":
      return <ProfilesPanel />;
    case "avisos":
      return real ? <NoticesPanelLive /> : <NoticesPanel />;
    case "whatsapp":
      return <WhatsappPanel />;
    case "simulador":
      return <SimulatorPanel />;
  }
}
