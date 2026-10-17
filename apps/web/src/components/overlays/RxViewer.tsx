"use client";
import { useEffect, useId, useState } from "react";
import { useActions, useSnapshot } from "@/data";
import { useOverlay } from "@/components/app/overlay-context";
import { useDialogBehavior } from "@/components/ui/Dialog";
import { Button, IconButton } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { RxThumb, rxPageAlt } from "@/components/domain/Rx";
import { useToast } from "@/components/ui/Toast";

const ZOOMS = [1, 1.5, 2, 2.5, 3];

interface Props {
  rxId: string;
  initialPage: number;
  /** estados forçados para o catálogo/testes */
  forceState?: "loading" | "error";
}

/** Visualizador em tela cheia: ← → trocam de página, + e − dão zoom (100–300%), Esc fecha. */
export function RxViewer({ rxId, initialPage, forceState }: Props) {
  const { close } = useOverlay();
  const snap = useSnapshot();
  const toast = useToast();
  const actions = useActions();
  const rx = snap.prescriptions.find((r) => r.id === rxId);
  const [page, setPage] = useState(initialPage);
  const [zoom, setZoom] = useState(1);
  const [state, setState] = useState<"loading" | "ok" | "error">(forceState ?? "loading");
  const ref = useDialogBehavior(close);
  const titleId = useId();

  const pages = rx?.pages ?? 1;
  const url = rx?.pageUrls?.[page]?.full;
  // registra a visualização (auditoria de acesso) uma vez por abertura
  useEffect(() => {
    void actions.recordRxView(rxId);
  }, [actions, rxId]);
  useEffect(() => {
    if (forceState) return;
    setState("loading");
    if (url) return; // com imagem real, quem tira o "carregando" é o onLoad da <img>
    const t = setTimeout(() => setState("ok"), 600);
    return () => clearTimeout(t);
  }, [page, forceState, url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setPage((p) => Math.min(pages - 1, p + 1));
      else if (e.key === "ArrowLeft") setPage((p) => Math.max(0, p - 1));
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(3, z + 0.5));
      else if (e.key === "-") setZoom((z) => Math.max(1, z - 0.5));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pages]);

  if (!rx) return null;
  const alt = rxPageAlt(rx, page + 1);

  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="fixed inset-0 z-50 flex flex-col bg-[#0B1222] text-white">
      <div className="flex items-center gap-2 p-3">
        <IconButton icon="close" label="Fechar visualizador" tone="inverse" onClick={close} data-autofocus />
        <h2 id={titleId} className="min-w-0 flex-1 truncate font-bold">
          Receita de {rx.medNames.join(" e ")} · página {page + 1} de {pages}
        </h2>
        <IconButton icon="download" label="Baixar receita" tone="inverse" onClick={() => toast({ icon: "download", message: "Baixar fica disponível quando o armazenamento for ligado" })} />
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {state === "loading" ? (
          <p role="status" className="flex items-center gap-2 text-body-lg">
            <Icon name="progress_activity" size={28} style={{ animation: "spin 1s linear infinite" }} />
            Carregando foto em alta resolução…
          </p>
        ) : state === "error" ? (
          <div role="alert" className="flex flex-col items-center gap-3 text-center">
            <Icon name="broken_image" size={48} />
            <p className="text-body-lg font-bold">Não foi possível carregar a foto</p>
            <Button variant="secondary" icon="refresh" onClick={() => setState("loading")}>
              Tentar de novo
            </Button>
          </div>
        ) : null}
        {state !== "error" && url ? (
          <img src={url} alt={alt} onLoad={() => setState("ok")} onError={() => setState("error")} className={state === "ok" ? "block" : "hidden"} style={{ width: `${Math.round(360 * zoom)}px`, maxWidth: zoom === 1 ? "100%" : "none" }} />
        ) : state === "ok" ? (
          <div style={{ width: `${Math.min(420, 360) * zoom}px`, maxWidth: zoom === 1 ? "100%" : "none" }}>
            <RxThumb alt={alt} pages={1} width={Math.round(360 * zoom)} />
          </div>
        ) : null}
        {pages > 1 ? (
          <>
            <button type="button" aria-label="Página anterior" disabled={page === 0} onClick={() => setPage(page - 1)} className="absolute left-2 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white/15 hover:bg-white/25 disabled:opacity-30">
              <Icon name="chevron_left" size={32} />
            </button>
            <button type="button" aria-label="Próxima página" disabled={page === pages - 1} onClick={() => setPage(page + 1)} className="absolute right-2 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white/15 hover:bg-white/25 disabled:opacity-30">
              <Icon name="chevron_right" size={32} />
            </button>
          </>
        ) : null}
      </div>

      <div className="flex items-center justify-center gap-3 p-3">
        <IconButton icon="remove" label="Diminuir zoom" tone="inverse" disabled={zoom <= 1} onClick={() => setZoom(Math.max(1, zoom - 0.5))} />
        <span className="num w-16 text-center font-bold" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <IconButton icon="add" label="Aumentar zoom" tone="inverse" disabled={zoom >= ZOOMS[ZOOMS.length - 1]!} onClick={() => setZoom(Math.min(3, zoom + 0.5))} />
        {pages > 1 ? (
          <div className="ml-4 flex gap-2" role="group" aria-label="Páginas">
            {Array.from({ length: pages }, (_, i) => (
              <button key={i} type="button" aria-label={`Ir para a página ${i + 1}`} aria-current={i === page} onClick={() => setPage(i)} className="flex h-11 w-6 items-center justify-center">
                <span className={`h-3 w-3 rounded-full ${i === page ? "bg-white" : "bg-white/40"}`} />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
