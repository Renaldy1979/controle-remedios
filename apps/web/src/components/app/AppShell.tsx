"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { can, type PermissionKey } from "@medcuidar/shared";
import { cx } from "@/lib/format";
import { useActions, useSnapshot } from "@/data";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "./theme";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  title: string;
  /** o item aparece se o membro tiver QUALQUER uma destas permissões */
  anyOf: PermissionKey[];
}

const NAV: NavItem[] = [
  { href: "/", label: "Início", icon: "home", title: "Início", anyOf: ["dashboard.view"] },
  { href: "/pacientes", label: "Pacientes", icon: "elderly", title: "Pacientes", anyOf: ["patients.view"] },
  { href: "/receitas", label: "Receitas", icon: "description", title: "Receitas", anyOf: ["prescriptions.view"] },
  { href: "/historico", label: "Histórico", icon: "history", title: "Histórico de doses", anyOf: ["doses.history.view"] },
  { href: "/configuracoes", label: "Ajustes", icon: "settings", title: "Configurações", anyOf: ["settings.manage", "medications.manage", "treatments.manage", "stock.adjust", "members.manage", "profiles.manage"] },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

function Logo() {
  return (
    <span className="flex items-center gap-2.5 font-display text-t2 font-extrabold text-ink">
      <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-br text-onbr">
        <Icon name="medication" size={26} />
      </span>
      MedCuidar
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const snap = useSnapshot();
  const actions = useActions();
  const { member } = snap;
  const items = NAV.filter((n) => n.anyOf.some((p) => can(member, p)));
  const current = NAV.find((n) => isActive(pathname, n.href));

  return (
    <div className="min-h-dvh desk:grid desk:grid-cols-[256px_1fr]">
      <a href="#conteudo" className="sr-only z-[70] rounded-md bg-sf px-4 py-3 font-bold text-br focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Pular para o conteúdo
      </a>

      {/* Menu lateral (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto border-r border-bd bg-sf p-5 desk:flex">
        <Link href="/" aria-label="MedCuidar, ir para o início" className="rounded-md">
          <Logo />
        </Link>
        <nav aria-label="Principal">
          <ul className="flex flex-col gap-1">
            {items.map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <li key={n.href}>
                  <Link href={n.href} aria-current={active ? "page" : undefined} className={cx("flex min-h-12 items-center gap-3 rounded-md px-3 text-body-lg", active ? "bg-brt font-bold text-pn" : "text-ink2 hover:bg-sf2")}>
                    <Icon name={n.icon} size={24} />
                    {n.label === "Ajustes" ? "Configurações" : n.label}
                    {n.href === "/" && snap.alertCount > 0 ? (
                      <span className="ml-auto rounded-pill bg-ms-bg px-2 text-cap font-bold text-ms">
                        {snap.alertCount}
                        <span className="sr-only"> alertas</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {can(member, "patients.view") ? (
          <section aria-label="Pacientes">
            <h2 className="mb-2 px-3 text-cap font-bold text-ink3">Pacientes</h2>
            <ul className="flex flex-col gap-1">
              {snap.patients.map((p) => {
                const ds = snap.doses.filter((d) => d.patientId === p.id);
                const taken = ds.filter((d) => d.status === "taken").length;
                const alert = ds.some((d) => d.status === "late" || d.status === "missed");
                return (
                  <li key={p.id}>
                    <Link href={`/pacientes?p=${p.id}`} className="flex min-h-touch items-center gap-3 rounded-md px-3 py-1 hover:bg-sf2">
                      <Avatar name={p.fullName} role="patient" size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold">{p.name}</span>
                        <span className="block text-cap text-ink2">
                          {taken} de {ds.length} doses
                        </span>
                      </span>
                      {alert ? <Icon name="warning" size={20} className="text-lt" /> : null}
                      {alert ? <span className="sr-only">tem doses que pedem atenção</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        <div className="mt-auto flex flex-col gap-3 border-t border-bd pt-4">
          <div className="flex items-center gap-3">
            <Avatar name={member.name} role="admin" size={40} />
            <div className="min-w-0 flex-1">
              <p className="font-bold">{member.name}</p>
              <p className="text-cap text-ink2">{member.profileName}</p>
            </div>
            <ThemeToggle />
          </div>
          {process.env.NODE_ENV !== "production" ? (
            <label className="flex flex-col gap-1 text-cap text-ink2">
              Ver como (só em teste)
              <select value={member.id} onChange={(e) => actions.viewAs(e.target.value)} className="h-11 rounded-md border-[1.5px] border-bd2 bg-sf px-2 text-body text-ink">
                {snap.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.profileName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Header mobile 64px */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-bd bg-sf px-4 desk:hidden">
          <Link href="/" aria-label="MedCuidar, ir para o início" className="rounded-md">
            <Logo />
          </Link>
          <div className="flex items-center">
            <ThemeToggle />
            <Link href="/#alertas" aria-label={snap.alertCount ? `${snap.alertCount} alertas de doses` : "Nenhum alerta"} className="relative flex h-11 w-11 items-center justify-center rounded-md text-ink2 hover:bg-brt">
              <Icon name="notifications" size={24} />
              {snap.alertCount > 0 ? <span className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-pill bg-danger px-1 text-[13px] font-bold text-white">{snap.alertCount}</span> : null}
            </Link>
          </div>
        </header>

        {/* Header desktop */}
        <header className="hidden h-[72px] items-center justify-between border-b border-bd bg-sf px-8 desk:flex">
          <p aria-hidden="true" className="font-display text-t1 font-extrabold">
            {current?.title ?? "MedCuidar"}
          </p>
          <p className="num text-ink2">{snap.nowLabel}</p>
        </header>

        <main id="conteudo" tabIndex={-1} className="mx-auto w-full max-w-[1240px] flex-1 p-4 pb-28 desk:p-8 desk:pb-8">
          {/* No mobile o título da tela fica no conteúdo; no desktop está no header */}
          {current ? <h1 className="mb-4 font-display text-t1 font-extrabold desk:sr-only">{current.title}</h1> : null}
          {children}
        </main>

        {/* Barra inferior com 5 abas (mobile) */}
        <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-bd bg-sf pb-[env(safe-area-inset-bottom)] desk:hidden">
          <ul className="flex">
            {items.map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <li key={n.href} className="flex-1">
                  <Link href={n.href} aria-current={active ? "page" : undefined} className={cx("flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-cap", active ? "font-bold text-ink" : "text-ink2")}>
                    <span className={cx("relative flex h-8 w-14 items-center justify-center rounded-pill", active ? "bg-brt text-pn" : "")}>
                      <Icon name={n.icon} size={24} />
                      {n.href === "/" && snap.alertCount > 0 ? (
                        <span className="absolute right-1 top-0 flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-danger px-1 text-[13px] font-bold text-white">
                          {snap.alertCount}
                          <span className="sr-only"> alertas</span>
                        </span>
                      ) : null}
                    </span>
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
