"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, cx, fmtDate, parseDate } from "@/lib/format";
import { maskDate } from "@/lib/date-mask";
import { preparePage } from "@/lib/image-prep";
import { useActions, useSnapshot, type AttachDraft } from "@/data";
import { useOverlay, type Overlay } from "@/components/app/overlay-context";
import { AccessIndicator } from "@/components/domain/Rx";
import { Button } from "@/components/ui/Button";
import { SelectChip } from "@/components/ui/Chip";
import { Checkbox } from "@/components/ui/Controls";
import { Dialog } from "@/components/ui/Dialog";
import { SelectField, TextArea, TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/Layout";
import { useToast } from "@/components/ui/Toast";

type Step = "capture" | "preview" | "form" | "upload" | "error" | "done";
interface Page {
  file?: File;
  rot: number;
  src?: string;
  name?: string;
  pdf?: boolean;
  mb: number;
}

const VALIDITY: Array<{ value: AttachDraft["validity"]; label: string; days: number | null }> = [
  { value: "30", label: "30 dias", days: 30 },
  { value: "60", label: "60 dias", days: 60 },
  { value: "180", label: "6 meses", days: 180 },
  { value: "none", label: "Sem validade", days: null },
];

const MAX_PAGES = 20;
const MAX_BYTES = 15 * 1024 * 1024;
const mbText = (n: number) => n.toFixed(1).replace(".", ",");

type Preset = Extract<Overlay, { type: "attach" }>["preset"];

/** Anexar receita em 3 passos (capturar → pré-visualizar → dados) + envio e "Receita salva". Tela cheia no mobile; diálogo de 560px no desktop. */
export function AttachFlow({ preset }: { preset?: Preset }) {
  const { close, open } = useOverlay();
  const snap = useSnapshot();
  const actions = useActions();
  const toast = useToast();
  const editing = preset?.editId ? snap.prescriptions.find((r) => r.id === preset.editId) : undefined;

  const [step, setStep] = useState<Step>(editing ? "form" : "capture");
  const [pages, setPages] = useState<Page[]>(editing ? Array.from({ length: editing.pages }, () => ({ rot: 0, mb: 1.6 })) : []);
  const [cur, setCur] = useState(0);
  const [crop, setCrop] = useState(false);
  const [patientId, setPatientId] = useState(editing?.patientId ?? preset?.patientId ?? snap.patients[0]!.id);
  const [date, setDate] = useState(editing?.issuedOn ?? snap.todayDate);
  const [doctor, setDoctor] = useState(editing?.doctor ?? preset?.doctor ?? "");
  const [specialty, setSpecialty] = useState(editing?.specialty ?? preset?.specialty ?? "");
  const [medIds, setMedIds] = useState<string[]>(editing?.medicationIds ?? preset?.medicationIds ?? []);
  const [validity, setValidity] = useState<AttachDraft["validity"]>(
    editing ? (editing.validityDays == null ? "none" : ((VALIDITY.find((v) => v.days === editing.validityDays)?.value ?? "30") as AttachDraft["validity"])) : "30",
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [controlled, setControlled] = useState(!!editing?.controlledCopies);
  const [copies, setCopies] = useState(String(editing?.controlledCopies ?? 2));
  const [more, setMore] = useState(!!editing);
  const [errors, setErrors] = useState<{ date?: string; meds?: string }>({});
  const [progress, setProgress] = useState(0);
  const [savedId, setSavedId] = useState<string | null>(null);

  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const draftRef = useRef<AttachDraft | null>(null);

  useEffect(() => () => pagesRef.current.forEach((p) => p.src && URL.revokeObjectURL(p.src)), []);

  const meds = useMemo(() => snap.medications.filter((m) => m.patientId === patientId), [snap.medications, patientId]);
  const doctors = useMemo(() => Array.from(new Set(snap.prescriptions.filter((r) => r.patientId === patientId).map((r) => r.doctor).filter(Boolean))), [snap.prescriptions, patientId]);

  const validityPreview = (() => {
    const d = parseDate(date);
    const days = VALIDITY.find((v) => v.value === validity)?.days;
    if (!d || days == null) return days == null ? "Sem validade informada" : "";
    return `Vence em ${fmtDate(addDays(d, days))}`;
  })();

  // ---------- envio: o servidor sobe as páginas ao Storage e salva; a barra acompanha enquanto isso ----------
  const total = Math.max(0.1, pages.reduce((s, p) => s + p.mb, 0));
  const cancelledRef = useRef(false);
  useEffect(() => {
    if (step !== "upload") return;
    cancelledRef.current = false;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setStep("error");
      return;
    }
    const onOffline = () => setStep("error");
    window.addEventListener("offline", onOffline);
    setProgress(5);
    const iv = setInterval(() => setProgress((p) => Math.min(90, p + 4 + Math.round(Math.random() * 6))), 350);
    void (async () => {
      let id: string | null = null;
      try {
        // gira/reduz as fotos no aparelho antes de enviar; PDF segue como está
        const files = await Promise.all(pages.map((p) => (p.file ? preparePage(p.file, p.rot) : Promise.resolve(undefined))));
        id = await actions.saveRx({ ...draftRef.current!, pages: pages.length || 1, files: files.filter((f): f is File => !!f) });
      } catch {
        id = null;
      }
      clearInterval(iv);
      if (cancelledRef.current) {
        // envio cancelado enquanto salvava: desfaz o que chegou a ser gravado
        if (id) await actions.deleteRx(id);
        return;
      }
      if (!id) return setStep("error");
      setSavedId(id);
      setProgress(100);
      setStep("done");
    })();
    return () => {
      window.removeEventListener("offline", onOffline);
      clearInterval(iv);
    };
  }, [step]);

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_PAGES - pages.length;
    const picked = Array.from(files);
    if (picked.length > room) toast({ error: true, message: `No máximo ${MAX_PAGES} páginas por receita.` });
    const ok = picked.slice(0, Math.max(0, room)).filter((f) => {
      if (f.size > MAX_BYTES) {
        toast({ error: true, message: `"${f.name}" passa de 15 MB e não foi adicionado.` });
        return false;
      }
      if (!/^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(f.type)) {
        toast({ error: true, message: `"${f.name}" não é foto nem PDF.` });
        return false;
      }
      return true;
    });
    if (!ok.length) return;
    const added: Page[] = ok.map((f) => ({ file: f, rot: 0, mb: Math.max(0.1, f.size / 1048576), pdf: f.type === "application/pdf", name: f.name, src: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined }));
    setPages((prev) => {
      setCur(prev.length);
      return [...prev, ...added];
    });
    setStep("preview");
    setCrop(false);
  };

  const removePage = () => {
    setPages((prev) => {
      const p = prev[cur];
      if (p?.src) URL.revokeObjectURL(p.src);
      const next = prev.filter((_, i) => i !== cur);
      if (next.length === 0) setStep("capture");
      setCur(Math.max(0, Math.min(cur, next.length - 1)));
      return next;
    });
  };

  const save = () => {
    const d = parseDate(date);
    const today = parseDate(snap.todayDate)!;
    const e: typeof errors = {};
    if (!d || d > today) e.date = "Use o formato dd/mm/aaaa, com a data de hoje ou anterior.";
    if (!medIds.length) e.meds = "Escolha pelo menos um remédio desta receita.";
    setErrors(e);
    if (e.date || e.meds) return;
    const draft: AttachDraft = { patientId, date, doctor, specialty, medicationIds: medIds, validity, notes, pages: pages.length || 1, controlled, copies: controlled ? Math.max(1, Number(copies) || 1) : undefined, replacesId: preset?.replacesId, editId: preset?.editId };
    if (editing) {
      void (async () => {
        if ((await actions.saveRx(draft)) === null) return;
        toast({ icon: "check_circle", message: "Receita atualizada" });
        close();
      })();
      return;
    }
    draftRef.current = draft;
    setProgress(0);
    setStep("upload");
  };

  const stepNo = step === "capture" ? 1 : step === "preview" ? 2 : 3;
  const title = step === "done" ? "Receita salva" : step === "upload" ? "Enviando a receita" : step === "error" ? "Não foi possível enviar" : editing ? "Editar receita" : "Anexar receita";
  const curPage = pages[cur];
  const donePages = Math.min(pages.length, Math.max(1, Math.ceil((progress / 100) * pages.length)));

  const footer = (() => {
    switch (step) {
      case "capture":
        return <Button variant="secondary" onClick={close}>Cancelar</Button>;
      case "preview":
        return (
          <>
            <Button variant="secondary" onClick={() => setStep("capture")}>Voltar</Button>
            <Button icon="arrow_forward" disabled={!pages.length} onClick={() => setStep("form")}>Continuar</Button>
          </>
        );
      case "form":
        return (
          <>
            <Button variant="secondary" onClick={() => (editing ? close() : setStep("preview"))}>{editing ? "Cancelar" : "Voltar"}</Button>
            <Button icon="check" onClick={save}>{editing ? "Salvar alterações" : "Salvar receita"}</Button>
          </>
        );
      case "upload":
        return <Button variant="secondary" onClick={() => { cancelledRef.current = true; setStep("form"); setProgress(0); }}>Cancelar envio</Button>;
      case "error":
        return (
          <>
            <Button variant="secondary" icon="schedule_send" onClick={() => { toast({ icon: "schedule_send", message: "As fotos ficam no aparelho e são enviadas quando a conexão voltar" }); close(); }}>
              Enviar quando a conexão voltar
            </Button>
            <Button icon="refresh" onClick={() => { setProgress(0); setStep("upload"); }}>Tentar de novo</Button>
          </>
        );
      case "done":
        return (
          <>
            <Button variant="secondary" onClick={close}>Concluir</Button>
            {savedId ? (
              <Link href={`/receitas/${savedId}`} onClick={close} className="inline-flex h-12 items-center justify-center rounded-md border-[1.5px] border-bd2 px-5 font-bold text-br hover:bg-brt">
                Ver receita
              </Link>
            ) : null}
            {savedId ? <Button icon="share" onClick={() => open({ type: "share", rxId: savedId })}>Compartilhar com a família</Button> : null}
          </>
        );
    }
  })();

  return (
    <Dialog title={title} size="attach" onClose={close} footer={footer} description={step === "capture" || step === "preview" || step === "form" ? `Passo ${stepNo} de 3` : undefined}>
      <div className="flex flex-col gap-4">
        {snap.rxStorageReady === false ? (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-lt-bg p-3 font-bold text-lt">
            <Icon name="warning" size={22} className="mt-0.5 flex-none" />
            O armazenamento das receitas ainda não foi configurado. Quem cuida da instalação precisa concluir o passo &quot;Lote 3&quot; do guia antes de anexar.
          </p>
        ) : null}
        {step === "capture" || step === "preview" || step === "form" ? <AccessIndicator people={snap.rxAudience ?? snap.people} /> : null}

        {step === "capture" ? (
          <div className="flex flex-col gap-3">
            <input ref={camRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
            <input ref={galRef} type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
            <button type="button" onClick={() => camRef.current?.click()} className="flex h-16 items-center justify-center gap-3 rounded-md bg-br text-body-lg font-bold text-onbr hover:bg-br2">
              <Icon name="photo_camera" size={28} />
              Tirar foto
            </button>
            <Button size="lg" variant="secondary" icon="photo_library" onClick={() => galRef.current?.click()}>
              Escolher da galeria ou PDF
            </Button>
            <ul className="mt-1 flex flex-col gap-2 text-ink2">
              {["Coloque a receita sobre uma mesa, com boa luz.", "Mostre a folha inteira, sem cortar as bordas.", "Evite sombra e reflexo. Se tiver mais folhas, adicione em seguida."].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <Icon name="lightbulb" size={20} className="mt-0.5 text-br" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {step === "preview" && curPage ? (
          <div className="flex flex-col gap-3">
            <div className="relative mx-auto flex aspect-[3/4] w-full max-w-[280px] items-center justify-center overflow-hidden rounded-lg border border-bd2 bg-[var(--paper)]">
              {curPage.src ? (
                <img src={curPage.src} alt={`Página ${cur + 1} de ${pages.length} da receita`} className="h-full w-full object-contain transition-transform" style={{ transform: `rotate(${curPage.rot * 90}deg)` }} />
              ) : (
                <div role="img" aria-label={`Página ${cur + 1} de ${pages.length}${curPage.pdf ? `, PDF ${curPage.name ?? ""}` : ""}`} className="flex flex-col items-center gap-2 text-ink2 transition-transform" style={{ transform: `rotate(${curPage.rot * 90}deg)` }}>
                  <Icon name={curPage.pdf ? "picture_as_pdf" : "description"} size={56} />
                  <span className="max-w-[200px] truncate font-mono text-cap">{curPage.name ?? "página"}</span>
                </div>
              )}
              {crop ? <span aria-hidden="true" className="pointer-events-none absolute inset-6 rounded border-2 border-dashed border-br" /> : null}
            </div>
            <p className="text-center text-ink2">Página {cur + 1} de {pages.length}</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: "rotate_right", label: "Girar", on: () => setPages((p) => p.map((x, i) => (i === cur ? { ...x, rot: (x.rot + 1) % 4 } : x))) },
                { icon: "crop", label: crop ? "Usar recorte" : "Recortar", on: () => setCrop((v) => !v) },
                { icon: "delete", label: "Remover", on: removePage },
              ].map((a) => (
                <button key={a.label} type="button" onClick={a.on} className="flex h-[60px] flex-col items-center justify-center gap-0.5 rounded-md border-[1.5px] border-bd2 bg-sf font-bold text-br hover:bg-brt">
                  <Icon name={a.icon} size={24} />
                  {a.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto py-1" role="group" aria-label="Páginas">
              {pages.map((p, i) => (
                <button key={i} type="button" aria-label={`Página ${i + 1}`} aria-current={i === cur} onClick={() => setCur(i)} className={cx("flex h-16 w-12 flex-none items-center justify-center rounded-md border-2 bg-[var(--paper)] text-ink2", i === cur ? "border-br" : "border-bd2")}>
                  {p.src ? (
                    <img src={p.src} alt="" className="h-full w-full rounded object-cover" />
                  ) : (
                    <Icon name={p.pdf ? "picture_as_pdf" : "description"} size={22} />
                  )}
                </button>
              ))}
              <button type="button" onClick={() => galRef.current?.click()} className="flex h-16 min-w-[84px] flex-none flex-col items-center justify-center rounded-md border-2 border-dashed border-bd2 px-2 text-cap font-bold text-br">
                <Icon name="add" size={22} />
                Adicionar página
              </button>
              <input ref={galRef} type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
            </div>
          </div>
        ) : null}

        {step === "form" ? (
          <div className="flex flex-col gap-4">
            <SelectField label="Paciente" value={patientId} onChange={(e) => { setPatientId(e.target.value); setMedIds([]); }}>
              {snap.patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </SelectField>
            <TextField label="Data da receita" inputMode="numeric" placeholder="dd/mm/aaaa" value={date} error={errors.date} onChange={(e) => { setDate(maskDate(e.target.value)); setErrors({ ...errors, date: undefined }); }} />
            <fieldset>
              <legend className="mb-1.5 font-bold">Remédios desta receita</legend>
              <div className="flex flex-wrap gap-2">
                {meds.map((m) => (
                  <SelectChip key={m.id} selected={medIds.includes(m.id)} onToggle={() => { setMedIds((v) => (v.includes(m.id) ? v.filter((x) => x !== m.id) : [...v, m.id])); setErrors({ ...errors, meds: undefined }); }}>
                    {m.name}
                  </SelectChip>
                ))}
              </div>
              {errors.meds ? (
                <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-[15px] font-bold text-ms">
                  <Icon name="error" size={18} />
                  {errors.meds}
                </p>
              ) : null}
            </fieldset>
            <div>
              <TextField label="Médico" optional list="medicos" value={doctor} onChange={(e) => setDoctor(e.target.value)} placeholder="Ex.: Dra. Helena Prado" />
              <datalist id="medicos">
                {doctors.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>
            <Button variant="ghost" icon={more ? "expand_less" : "expand_more"} aria-expanded={more} onClick={() => setMore((v) => !v)} className="self-start">
              Mais detalhes
            </Button>
            {more ? (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="mb-1.5 font-bold">Validade <span className="font-normal text-ink3">· opcional</span></p>
                  <div role="group" aria-label="Validade" className="flex flex-wrap gap-2">
                    {VALIDITY.map((v) => (
                      <SelectChip key={v.value} selected={validity === v.value} onToggle={() => setValidity(v.value)}>
                        {v.label}
                      </SelectChip>
                    ))}
                  </div>
                  {validityPreview ? <p className="mt-1.5 flex items-center gap-1.5 text-ink2"><Icon name="event_available" size={18} />{validityPreview}</p> : null}
                </div>
                <TextField label="Especialidade" optional value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
                <div className="flex flex-col gap-2">
                  <Checkbox checked={controlled} onChange={setControlled} label="Receita de controle especial" description="A farmácia retém uma das vias." />
                  {controlled ? (
                    <SelectField label="Número de vias" value={copies} onChange={(e) => setCopies(e.target.value)}>
                      {["1", "2", "3"].map((n) => <option key={n}>{n}</option>)}
                    </SelectField>
                  ) : null}
                </div>
                <TextArea label="Observações" optional value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            ) : null}
          </div>
        ) : null}

        {step === "upload" ? (
          <ProgressBar value={progress} label="Enviando a receita" detail={`Página ${donePages} de ${pages.length || 1} · ${mbText((total * progress) / 100)} de ${mbText(total)} MB`} />
        ) : null}

        {step === "error" ? (
          <div className="flex flex-col gap-3">
            <ProgressBar value={Math.max(progress, 62)} failed label="Envio interrompido" detail={typeof navigator !== "undefined" && navigator.onLine === false ? "Sem conexão. As fotos continuam guardadas neste aparelho." : "A receita não foi salva. O motivo apareceu no aviso. As fotos continuam neste aparelho."} />
            <p role="alert" className="flex items-start gap-2 rounded-md bg-ms-bg p-3 font-bold text-ms">
              <Icon name={typeof navigator !== "undefined" && navigator.onLine === false ? "wifi_off" : "error"} size={22} className="mt-0.5" />
              Nada foi perdido. Tente de novo agora{typeof navigator !== "undefined" && navigator.onLine === false ? " ou deixe para enviar quando a internet voltar" : ""}.
            </p>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-full bg-ok-bg text-ok">
              <Icon name="task_alt" size={40} />
            </span>
            <p className="text-body-lg">A receita foi guardada com acesso restrito. Quem ainda não viu aparece na página da receita.</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
