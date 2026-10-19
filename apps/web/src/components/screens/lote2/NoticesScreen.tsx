"use client";
import Link from "next/link";
import { cx } from "@/lib/format";
import { useActions, useSnapshot } from "@/data";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { EmptyState, IconBlock } from "@/components/ui/Layout";

/** Sino do portal: os avisos da pessoa logada (ex.: estoque baixo), lidos e não lidos. */
export function NoticesScreen() {
  const snap = useSnapshot();
  const actions = useActions();
  const notices = snap.notices ?? [];
  const unread = snap.unreadNotices ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-t1 font-extrabold">Avisos</h1>
        {unread > 0 ? (
          <Button variant="secondary" icon="done_all" onClick={() => void actions.markNoticesRead()}>
            Marcar todos como lidos
          </Button>
        ) : null}
      </div>
      <p className="text-ink2" aria-live="polite" data-testid="notices-summary">
        {unread > 0 ? `${unread} ${unread === 1 ? "aviso novo" : "avisos novos"}` : "Nenhum aviso novo."}
      </p>
      {notices.length === 0 ? (
        <EmptyState icon="notifications" title="Nenhum aviso por enquanto" text="Quando o estoque de um remédio estiver acabando, o aviso aparece aqui e no sino." />
      ) : (
        <ul className="flex flex-col gap-3">
          {notices.map((n) => (
            <li key={n.id}>
              <article aria-label={`${n.read ? "Lido" : "Não lido"}: ${n.title}`} className={cx("flex gap-3 rounded-lg border p-4", n.read ? "border-bd bg-sf" : "border-lt-bd bg-lt-sf shadow-sm")}>
                <IconBlock name={n.kind === "low_stock" ? "inventory_2" : "notifications"} tone={n.read ? "neu" : "lt"} />
                <div className="min-w-0 flex-1">
                  <p className="text-t3 font-bold">{n.title}</p>
                  {n.body ? <p className="text-ink2">{n.body}</p> : null}
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 text-cap text-ink2">
                    <span>{n.whenLabel}</span>
                    <span className="inline-flex items-center gap-1 font-bold">
                      <Icon name={n.read ? "drafts" : "mark_email_unread"} size={16} />
                      {n.read ? "Lido" : "Novo"}
                    </span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {n.href !== "/" ? (
                      <Link href={n.href} onClick={() => !n.read && void actions.markNoticesRead([n.id])} className="inline-flex min-h-touch items-center gap-1 font-bold text-br underline">
                        <Icon name="shopping_bag" size={20} />
                        Ver estoque e registrar compra
                      </Link>
                    ) : null}
                    {!n.read ? (
                      <Button variant="ghost" size="sm" icon="check" onClick={() => void actions.markNoticesRead([n.id])}>
                        Marcar como lido
                      </Button>
                    ) : null}
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
