"use client";
import { cx } from "@/lib/format";
import { TONE_TEXT } from "@/lib/status";
import type { ReplenishmentVM } from "@/data";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

/** Versão compacta: 4 segmentos de 6px + "etapa X de 4" + responsável. */
export function ReplProgressCompact({ repl }: { repl: ReplenishmentVM }) {
  if (repl.steps.length === 0) return <p className="text-cap text-ink2">Reposição · ainda não aberta</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <div role="img" aria-label={`Reposição: ${repl.stepText}`} className="flex gap-1">
        {repl.steps.map((s) => (
          <span key={s.n} className={cx("h-1.5 flex-1 rounded-pill", s.kind === "done" ? "bg-ok-bar" : s.kind === "cur" ? "bg-br" : s.kind === "skip" ? "bg-bd2" : "bg-trk")} />
        ))}
      </div>
      <p className="text-cap text-ink2">
        Reposição · {repl.stepText}
      </p>
      <p className={cx("flex items-center gap-1.5 text-cap font-bold", TONE_TEXT[repl.ownerTone])}>
        <Icon name={repl.done ? "task_alt" : repl.owner ? "person" : "person_search"} size={18} />
        {repl.ownerText}
      </p>
    </div>
  );
}

interface ReplStepsProps {
  repl: ReplenishmentVM;
  canManage: boolean;
  onAssume: () => void;
  onAdvance: () => void;
}

/** Versão vertical: círculo de 40px + rótulo + tag de estado + responsável + ações na etapa atual. */
export function ReplSteps({ repl, canManage, onAssume, onAdvance }: ReplStepsProps) {
  return (
    <ol className="flex flex-col" aria-label="Etapas da reposição">
      {repl.steps.map((s, i) => (
        <li key={s.n} className="flex gap-3" aria-current={s.kind === "cur" ? "step" : undefined}>
          <div className="flex flex-col items-center">
            <span
              aria-hidden="true"
              className={cx(
                "flex h-10 w-10 flex-none items-center justify-center rounded-full font-display font-extrabold",
                s.kind === "done" && "bg-ok-bg text-ok",
                s.kind === "cur" && "bg-br text-onbr",
                s.kind === "todo" && "bg-neub text-neuf",
                s.kind === "skip" && "bg-neub text-neuf",
              )}
            >
              {s.kind === "done" ? <Icon name="check" size={24} /> : s.kind === "skip" ? <Icon name="remove" size={24} /> : s.n}
            </span>
            {i < repl.steps.length - 1 ? <span aria-hidden="true" className={cx("w-0.5 flex-1", s.kind === "done" ? "bg-ok-bar" : "bg-trk")} /> : null}
          </div>
          <div className="min-w-0 flex-1 pb-5">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cx("text-t3 font-bold", s.kind === "todo" && "text-ink2")}>{s.label}</p>
              <span className={cx("rounded-sm px-2 text-cap font-bold", s.kind === "cur" ? "bg-brt text-pn" : s.kind === "done" ? "bg-ok-bg text-ok" : "bg-neub text-neuf")}>{s.stateLabel}</span>
            </div>
            {s.text ? <p className={cx("text-cap", s.textTone === "lt" ? "font-bold text-lt" : "text-ink2")}>{s.text}</p> : null}
            {s.kind === "cur" && canManage ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {repl.canAssume ? (
                  <Button variant={repl.owner ? "secondary" : "primary"} icon="front_hand" onClick={onAssume}>
                    {repl.assumeLabel}
                  </Button>
                ) : null}
                <Button variant={repl.mine || repl.owner ? "primary" : "secondary"} icon={repl.needsAttach ? "add_a_photo" : "task_alt"} onClick={onAdvance}>
                  {repl.advanceLabel}
                </Button>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
