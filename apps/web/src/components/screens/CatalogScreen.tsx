"use client";
import { useState, type ReactNode } from "react";
import { DOSE_STATUS, RX_STATUS, STOCK_LEVEL } from "@/lib/status";
import { useSnapshot } from "@/data";
import { ThemeToggle } from "@/components/app/theme";
import { DoseCard } from "@/components/domain/DoseCard";
import { PermissionMatrix } from "@/components/domain/PermissionMatrix";
import { ReplProgressCompact, ReplSteps } from "@/components/domain/Replenishment";
import { AccessIndicator, RxCard, RxThumb } from "@/components/domain/Rx";
import { StockCard } from "@/components/domain/StockCard";
import { Avatar, AvatarGroup } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { SelectChip, StatusChip, Tag } from "@/components/ui/Chip";
import { Checkbox, RadioGroup, Switch } from "@/components/ui/Controls";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { SearchField, SelectField, TextArea, TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { EmptyState, ProgressBar, Skeleton, Table, Td, Th, Timeline } from "@/components/ui/Layout";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";

const COLORS = ["bg", "sf", "sf2", "bd", "bd2", "ink", "ink2", "ink3", "br", "br2", "brt", "onbr", "neub", "neuf", "trk", "okb", "okf", "okbar", "pnb", "pnf", "ltb", "ltf", "ltbar", "ltsf", "ltbd", "msb", "msf", "msbar", "msbd"];

function Sec({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex flex-col gap-4 rounded-lg border border-bd bg-sf p-5">
      <h2 id={`${id}-h`} className="font-display text-t2 font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Catálogo dos componentes do design (substitui o Storybook): estados padrão, foco, desabilitado e erro. */
export function CatalogScreen() {
  const snap = useSnapshot();
  const toast = useToast();
  const [chip, setChip] = useState(true);
  const [sw, setSw] = useState(true);
  const [cb, setCb] = useState(true);
  const [rd, setRd] = useState<"a" | "b">("a");
  const [tab, setTab] = useState<"a" | "b">("a");
  const [q, setQ] = useState("");
  const [dlg, setDlg] = useState<null | "modal" | "confirm">(null);
  const [rows, setRows] = useState(snap.permissionRows);
  const doses = snap.doses;
  const late = doses.find((d) => d.status === "late")!;
  const missed = doses.find((d) => d.status === "missed")!;
  const next = doses.find((d) => d.status === "pending")!;
  const taken = doses.find((d) => d.status === "taken")!;
  const zyp = snap.medications.find((m) => m.id === "zyp")!;
  const don = snap.medications.find((m) => m.id === "don")!;
  const rx = snap.prescriptions[0]!;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 p-4 desk:p-8">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-t1 font-extrabold">Design system MedCuidar</h1>
          <p className="text-ink2">Tokens e componentes (design/design.md, seções 2 e 3). Alterne o tema no botão ao lado.</p>
        </div>
        <ThemeToggle />
      </header>

      <Sec id="cores" title="Cores">
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 desk:grid-cols-7">
          {COLORS.map((c) => (
            <li key={c} className="flex flex-col gap-1">
              <span aria-hidden="true" className="h-12 rounded-md border border-bd2" style={{ background: `var(--${c})` }} />
              <code className="text-cap">--{c}</code>
            </li>
          ))}
        </ul>
      </Sec>

      <Sec id="tipografia" title="Tipografia">
        <p className="font-display text-display font-extrabold">Display 40</p>
        <p className="font-display text-t1 font-extrabold">Título 1 · 28</p>
        <p className="font-display text-t2 font-bold">Título 2 · 22</p>
        <p className="num font-display text-time font-extrabold">Horário 08:00 · 24</p>
        <p className="text-t3 font-bold">Título 3 · 18</p>
        <p className="text-body-lg">Corpo grande · 18</p>
        <p>Corpo base · 16. Texto corrido do sistema, sempre 16px ou mais.</p>
        <p className="text-cap">Legenda · 14, só para metadado não essencial</p>
      </Sec>

      <Sec id="botoes" title="Botões">
        <div className="flex flex-wrap items-center gap-3">
          <Button icon="check">Primário</Button>
          <Button size="lg">Grande 56</Button>
          <Button variant="secondary">Secundário</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="danger" icon="delete">Perigo</Button>
          <Button variant="dangerOutline">Perigo contorno</Button>
          <Button disabled>Desabilitado</Button>
          <Button loading>Salvar</Button>
          <IconButton icon="settings" label="Configurações" />
        </div>
      </Sec>

      <Sec id="campos" title="Campos">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Nome" placeholder="Digite aqui" />
          <TextField label="Data" optional hint="Use dd/mm/aaaa" />
          <TextField label="Com erro" defaultValue="32/13/2026" error="Use o formato dd/mm/aaaa." />
          <TextField label="Desabilitado" disabled defaultValue="Não editável" />
          <SelectField label="Select"><option>Adelino</option><option>Maria</option></SelectField>
          <SelectField label="Select com filtro ativo" active defaultValue="b"><option value="a">Todos</option><option value="b">Adelino</option></SelectField>
          <TextArea label="Observações" optional />
          <SearchField value={q} onChange={setQ} placeholder="Buscar" />
        </div>
      </Sec>

      <Sec id="selecao" title="Chips, checkbox, rádio e switch">
        <div className="flex flex-wrap gap-2">
          <SelectChip selected={chip} onToggle={() => setChip(!chip)}>Selecionado</SelectChip>
          <SelectChip selected={!chip} onToggle={() => setChip(!chip)}>Alternar</SelectChip>
          <Tag icon="medication">Tag</Tag>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Checkbox checked={cb} onChange={setCb} label="Checkbox" />
          <RadioGroup name="demo" legend="Rádio" value={rd} onChange={setRd} options={[{ value: "a", label: "Opção A" }, { value: "b", label: "Opção B" }]} />
          <div className="flex flex-col">
            <Switch checked={sw} onChange={setSw} label="Switch" />
            <Switch checked={false} onChange={() => {}} label="Desligado" />
            <Switch checked disabled onChange={() => {}} label="Desabilitado" />
          </div>
        </div>
      </Sec>

      <Sec id="status" title="Chips de status (ícone + texto)">
        <div className="flex flex-wrap gap-2">
          {Object.values(DOSE_STATUS).map((s) => <StatusChip key={s.label} {...s} />)}
          {Object.values(STOCK_LEVEL).map((s) => <StatusChip key={s.label} {...s} />)}
          {Object.values(RX_STATUS).map((s) => <StatusChip key={s.label} {...s} />)}
          <StatusChip compact tone="lt" icon="event_upcoming" label="Vence em 10 dias" />
        </div>
      </Sec>

      <Sec id="abas" title="Abas e avatares">
        <Tabs label="Segmentadas" value={tab} onChange={setTab} items={[{ value: "a", label: "Linha do tempo" }, { value: "b", label: "Tabela" }]} idPrefix="cat-seg" />
        <Tabs label="Pacientes" variant="underline" value={tab} onChange={setTab} items={[{ value: "a", label: "Adelino", alertLabel: "tem alerta" }, { value: "b", label: "Maria" }]} idPrefix="cat-und" />
        <div className="flex items-center gap-4">
          <Avatar name="Ana" role="admin" /> <Avatar name="Beatriz" role="family" /> <Avatar name="Rosa" role="caregiver" whatsapp /> <Avatar name="Seu João" role="confirmer" />
          <AvatarGroup people={[{ name: "Ana", role: "admin" }, { name: "Beatriz", role: "family" }, { name: "Rosa", role: "caregiver" }]} />
        </div>
      </Sec>

      <Sec id="doses" title="Cartões de dose">
        <div className="grid gap-3 desk:grid-cols-2">
          <DoseCard dose={next} variant="featured" />
          <DoseCard dose={next} variant="compact" />
          <DoseCard dose={late} variant="late" />
          <DoseCard dose={missed} variant="missed" />
          <DoseCard dose={taken} variant="taken" />
        </div>
      </Sec>

      <Sec id="estoque" title="Cartões de estoque">
        <div className="grid gap-3 desk:grid-cols-2">
          <StockCard med={zyp} patientName="Adelino" withActions />
          <StockCard med={don} patientName="Maria" />
        </div>
      </Sec>

      <Sec id="tabela" title="Tabela e linha do tempo">
        <Table>
          <caption className="sr-only">Exemplo</caption>
          <thead><tr><Th>Hora</Th><Th>Remédio</Th><Th>Estado</Th></tr></thead>
          <tbody><tr className="hover:bg-sf2"><Td className="num">09:00</Td><Td>Zypred</Td><Td><StatusChip compact {...DOSE_STATUS.taken} /></Td></tr></tbody>
        </Table>
        <Timeline label="Exemplo" items={[{ id: "1", icon: "check_circle", tone: "ok", title: "Zypred · 12:00", statusLabel: "Tomada", detail: "Seu João · 12:04 · WhatsApp", time: "12:04" }, { id: "2", icon: "cancel", tone: "ms", title: "Losartana · 08:00", statusLabel: "Esquecida" }]} />
      </Sec>

      <Sec id="feedback" title="Modal, toast, progresso e vazio">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setDlg("modal")}>Abrir modal</Button>
          <Button variant="secondary" onClick={() => setDlg("confirm")}>Confirmação destrutiva</Button>
          <Button variant="secondary" onClick={() => toast({ message: "Dose confirmada", undo: () => {} })}>Toast com Desfazer</Button>
          <Button variant="secondary" onClick={() => toast({ message: "Sem conexão", error: true })}>Toast de erro</Button>
        </div>
        <ProgressBar value={64} label="Enviando a receita" detail="Página 2 de 3 · 3,1 de 4,8 MB" />
        <ProgressBar value={62} failed label="Envio interrompido" />
        <Skeleton className="h-16 w-full" />
        <EmptyState icon="description" title="Nenhuma receita ainda" text="Anexe a primeira receita." />
      </Sec>

      <Sec id="receitas" title="Componentes de receitas">
        <div className="flex flex-wrap items-end gap-4">
          <RxThumb alt="Receita, página 1" pages={2} />
          <RxThumb alt="Carregando" state="loading" />
          <RxThumb alt="Erro" state="error" />
        </div>
        <AccessIndicator people={snap.people} />
        <RxCard rx={rx} featured />
      </Sec>

      <Sec id="reposicao" title="Etapas de reposição">
        <ReplProgressCompact repl={zyp.replenishment} />
        <ReplSteps repl={zyp.replenishment} canManage onAssume={() => {}} onAdvance={() => {}} />
      </Sec>

      <Sec id="permissoes" title="Matriz de permissões">
        <PermissionMatrix profiles={snap.profiles} rows={rows} onChange={(id, p, v) => setRows(rows.map((r) => (r.id === id ? { ...r, values: r.values.map((x, i) => (snap.profiles[i] === p ? v : x)) } : r)))} />
      </Sec>

      {dlg === "modal" ? <Dialog title="Título do modal" description="Texto de apoio em cor secundária." icon="info" onClose={() => setDlg(null)} footer={<><Button variant="secondary" onClick={() => setDlg(null)}>Cancelar</Button><Button onClick={() => setDlg(null)}>Confirmar</Button></>}><p>Conteúdo. Esc fecha e o foco volta ao botão que abriu.</p></Dialog> : null}
      {dlg === "confirm" ? <ConfirmDialog title="Remover Rosa?" description="Rosa está na escala de doses." confirmLabel="Remover" requireWord="REMOVER" icon="person_remove" onClose={() => setDlg(null)} onConfirm={() => setDlg(null)} /> : null}
      <p className="flex items-center gap-2 text-cap text-ink3"><Icon name="info" size={16} />Catálogo interno de desenvolvimento.</p>
    </div>
  );
}
