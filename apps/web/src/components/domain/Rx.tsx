"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { cx } from "@/lib/format";
import { TONE_BG, TONE_TEXT } from "@/lib/status";
import type { PersonVM, RxVM } from "@/data";
import { StatusChip, Tag } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Avatar";

interface RxThumbProps {
  alt: string;
  /** URL assinada da imagem (origem real). Sem ela desenha o papel de exemplo. */
  src?: string;
  pages?: number;
  width?: number;
  state?: "ok" | "loading" | "error";
  onClick?: () => void;
}

/** Miniatura 3:4, papel #FBFAF6 com linhas e contador de páginas. Carregando = shimmer; erro = "Não carregou". */
export function RxThumb({ alt, src, pages = 1, width = 76, state: forced = "ok", onClick }: RxThumbProps) {
  const [failed, setFailed] = useState(false);
  const state = forced === "ok" && failed ? "error" : forced;
  const body =
    state === "loading" ? (
      <div className="shimmer h-full w-full rounded-md" />
    ) : state === "error" ? (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-md border border-ms-bd bg-ms-bg p-1 text-center text-ms">
        <Icon name="broken_image" size={24} />
        <span className="text-[13px] font-bold leading-tight">Não carregou</span>
      </div>
    ) : src && !failed ? (
      <div className="relative h-full w-full overflow-hidden rounded-md border border-bd2 bg-[var(--paper)] shadow-sm">
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
        {pages > 1 ? <span className="absolute bottom-1 right-1 rounded-sm bg-[#0E1A33] px-1 font-mono text-[13px] font-bold text-white">{pages}</span> : null}
      </div>
    ) : (
      <div className="relative h-full w-full overflow-hidden rounded-md border border-bd2 bg-[var(--paper)] p-2 shadow-sm">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <span key={i} className="mb-[7%] block h-[2px] rounded bg-[#0E1A33]/15" style={{ width: `${88 - ((i * 13) % 30)}%` }} />
        ))}
        {pages > 1 ? <span className="absolute bottom-1 right-1 rounded-sm bg-[#0E1A33] px-1 font-mono text-[13px] font-bold text-white">{pages}</span> : null}
      </div>
    );
  const style = { width, maxWidth: "100%", aspectRatio: "3 / 4" } as const;
  if (onClick)
    return (
      <button type="button" onClick={onClick} aria-label={alt} style={style} className="flex-none rounded-md">
        {body}
      </button>
    );
  return (
    <div role="img" aria-label={alt} style={style} className="flex-none">
      {body}
    </div>
  );
}

export function rxPageAlt(rx: RxVM, page: number) {
  return `Receita de ${rx.medNames.join(", ")}, página ${page} de ${rx.pages}`;
}

/** Cartão de receita; "destaque" = vigente mais recente (borda 1.5 br, miniatura maior). */
export function RxCard({ rx, featured }: { rx: RxVM; featured?: boolean }) {
  return (
    <Link
      href={`/receitas/${rx.id}`}
      className={cx("flex gap-4 rounded-lg border bg-sf p-4 shadow-sm transition-colors hover:bg-sf2", featured ? "border-[1.5px] border-br" : "border-bd")}
    >
      <RxThumb alt={rxPageAlt(rx, 1)} src={rx.pageUrls?.[0]?.thumb} pages={rx.pages} width={featured ? 104 : 76} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{rx.patientName}</span>
          <StatusChip compact label={rx.status.label} icon={rx.status.icon} tone={rx.status.tone} />
          {featured ? <Tag icon="star" tone="br">Vigente mais recente</Tag> : null}
        </div>
        <p className="mt-1 font-bold">{rx.doctor || "Médico não informado"}</p>
        <p className="text-cap text-ink2">
          {[rx.specialty, `emitida em ${rx.issuedOn}`].filter(Boolean).join(" · ")}
        </p>
        <p className={cx("mt-1 flex items-center gap-1.5 text-cap font-bold", TONE_TEXT[rx.status.validityTone])}>
          <Icon name={rx.status.validityIcon} size={18} />
          {rx.status.validityText}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {rx.medNames.map((n) => (
            <Tag key={n} icon="medication">
              {n}
            </Tag>
          ))}
          {rx.controlledCopies ? <Tag tone="lt" icon="lock">Controle especial · {rx.controlledCopies} vias</Tag> : null}
        </div>
      </div>
      <Icon name="chevron_right" size={24} className="mt-1 hidden flex-none text-ink3 sm:block" />
    </Link>
  );
}

/** Pílula "Acesso restrito · N pessoas"; ao expandir mostra quem pode e quem não pode ver. */
export function AccessIndicator({ people }: { people: PersonVM[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const can = people.filter((p) => p.permissions["prescriptions.view"] || p.profileName === "Administrador");
  const cannot = people.filter((p) => !can.includes(p));
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-touch items-center gap-2 rounded-pill border border-bd2 bg-sf px-4 font-bold text-ink2 hover:bg-sf2"
      >
        <Icon name="lock" size={20} />
        Acesso restrito · {can.length} pessoas
        <Icon name={open ? "expand_less" : "expand_more"} size={20} />
      </button>
      {open ? (
        <div id={id} className="mt-2 rounded-lg border border-bd bg-sf p-4">
          <p className="font-bold">Podem ver</p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {can.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <Avatar name={p.name} role={p.role} size={28} />
                {p.name}
              </li>
            ))}
          </ul>
          {cannot.length ? (
            <>
              <p className="mt-3 font-bold">Não podem ver</p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {cannot.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-ink2">
                    <Icon name="lock" size={18} />
                    {p.name}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <Link href="/configuracoes/perfis" className="mt-3 inline-flex min-h-touch items-center font-bold text-br underline">
            Ver perfis e permissões
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function rxToneBg(rx: RxVM) {
  return TONE_BG[rx.status.tone];
}
