import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, vi } from "vitest";
import { axe } from "@/test/axe";
import { nav, renderApp } from "@/test/render";
import { createMockDataSource } from "@/data/mock/store";
import type { DataSource, Snapshot } from "@/data";
import { AppShell } from "@/components/app/AppShell";
import { HomeScreen } from "./HomeScreen";
import { RxDetailScreen } from "./RxDetailScreen";
import { RxListScreen } from "./RxListScreen";

/** Retrato "do Lote 3" (origem real) montado sobre o mock: receitas, reposição e a lista de pessoas que podem ver receitas. */
function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  const base = createMockDataSource().getSnapshot();
  return {
    ...base,
    member: { id: "me", name: "Ana", profileName: "Administrador", permissions: {} },
    family: { name: "Família Souza", canSwitch: false },
    recentTaken: [],
    notices: [],
    unreadNotices: 0,
    rxStorageReady: true,
    rxAudience: [
      { id: "me", name: "Ana", relation: "", profileName: "Administrador", role: "admin", phone: "", whatsappActive: false, receivesAlerts: false, permissions: {} },
      { id: "fi", name: "Filha", relation: "", profileName: "Familiar", role: "family", phone: "", whatsappActive: false, receivesAlerts: false, permissions: { "prescriptions.view": true } },
      { id: "ne", name: "Neto", relation: "", profileName: "Confirmador", role: "confirmer", phone: "", whatsappActive: false, receivesAlerts: false, permissions: {} },
    ],
    ...over,
  };
}

function fakePg(snap: Snapshot, over: Partial<DataSource["actions"]> = {}): DataSource {
  const mock = createMockDataSource();
  return { kind: "postgres", getSnapshot: () => snap, previewStockDays: async () => 12, subscribe: () => () => {}, actions: { ...mock.actions, ...over } } as DataSource;
}

const shell = (path: string, ui: React.ReactElement) => {
  nav.pathname = path;
  nav.search = "";
  return <AppShell>{ui}</AppShell>;
};

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:teste");
  URL.revokeObjectURL = vi.fn();
});

describe("Lote 3 — receitas (origem Postgres)", () => {
  it("lista com busca e filtros; o indicador de acesso restrito usa a lista de pessoas que podem ver", async () => {
    const snap = snapshot();
    const { container } = renderApp(shell("/receitas", <RxListScreen />), { source: fakePg(snap) });
    await userEvent.click(screen.getByRole("button", { name: /Acesso restrito · 2 pessoas/ })); // Ana e Filha; o Neto não pode
    expect(screen.getByText("Não podem ver")).toBeInTheDocument();
    expect(within(screen.getByText("Não podem ver").parentElement!).getByText("Neto")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Buscar receitas"), "zzzz-nao-existe");
    expect(screen.getByText("Nenhuma receita encontrada")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("anexar: a máscara dd/mm/aaaa e o aviso de armazenamento não configurado", async () => {
    const snap = snapshot({ rxStorageReady: false });
    renderApp(shell("/receitas", <RxListScreen />), { source: fakePg(snap) });
    await userEvent.click(screen.getAllByRole("button", { name: /Anexar/ })[0]!);
    const dlg = screen.getByRole("dialog", { name: "Anexar receita" });
    expect(within(dlg).getByRole("alert")).toHaveTextContent(/armazenamento das receitas ainda não foi configurado/);
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "pagina.jpg", { type: "image/jpeg" });
    const input = dlg.querySelector('input[type="file"][accept*="application/pdf"]') as HTMLInputElement;
    await userEvent.upload(input, [file]);
    await userEvent.click(within(dlg).getByRole("button", { name: "Continuar" }));
    const data = within(dlg).getByLabelText("Data da receita");
    await userEvent.clear(data);
    await userEvent.type(data, "01102026");
    expect(data).toHaveValue("01/10/2026");
  });

  it("anexar recusa arquivo que não é foto nem PDF e página de mais de 15 MB, sem adicionar nada", async () => {
    renderApp(shell("/receitas", <RxListScreen />), { source: fakePg(snapshot()) });
    await userEvent.click(screen.getAllByRole("button", { name: /Anexar/ })[0]!);
    const dlg = screen.getByRole("dialog", { name: "Anexar receita" });
    const input = dlg.querySelector('input[type="file"][accept*="application/pdf"]') as HTMLInputElement;
    const doc = new File(["x"], "virus.exe", { type: "application/x-msdownload" });
    const grande = new File([new Uint8Array(16 * 1024 * 1024)], "grande.jpg", { type: "image/jpeg" });
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(input, [doc]);
    expect(await screen.findByText(/não é foto nem PDF/)).toBeInTheDocument();
    await user.upload(input, [grande]);
    expect(await screen.findByText(/passa de 15 MB/)).toBeInTheDocument();
    expect(within(dlg).queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument(); // nada entrou: segue no passo 1
  });

  it("compartilhar na origem real: só 'Na família' (sem WhatsApp), sem a própria pessoa e com quem não pode ver bloqueado", async () => {
    const snap = snapshot();
    const rx = snap.prescriptions[0]!;
    const shareRx = vi.fn(async () => undefined);
    renderApp(shell(`/receitas/${rx.id}`, <RxDetailScreen id={rx.id} />), { source: fakePg({ ...snap, prescriptions: [{ ...rx, cannotView: ["Neto"] }] }, { shareRx }) });
    await userEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    const dlg = screen.getByRole("dialog", { name: "Compartilhar receita" });
    expect(within(dlg).queryByText("Pelo WhatsApp")).not.toBeInTheDocument();
    expect(within(dlg).queryByRole("checkbox", { name: /Ana/ })).not.toBeInTheDocument();
    expect(within(dlg).getByRole("checkbox", { name: /Neto/ })).toBeDisabled();
    await userEvent.click(within(dlg).getByRole("checkbox", { name: /Filha/ }));
    await userEvent.click(within(dlg).getByRole("button", { name: "Compartilhar com 1" }));
    await waitFor(() => expect(shareRx).toHaveBeenCalledWith(rx.id, { memberIds: ["fi"], label: "Filha" }, "MedCuidar"));
  });

  it("o visualizador abre PDF num quadro e a foto numa imagem, e oferece baixar a página", async () => {
    const snap = snapshot();
    const base = snap.prescriptions[0]!;
    const rx = { ...base, pages: 2, pageUrls: [{ thumb: "/api/rx-file/a?v=thumb", full: "/api/rx-file/a?v=full", mime: "image/jpeg" }, { thumb: "/api/rx-file/b?v=thumb", full: "/api/rx-file/b?v=full", mime: "application/pdf" }] };
    const recordRxView = vi.fn();
    renderApp(shell(`/receitas/${rx.id}`, <RxDetailScreen id={rx.id} />), { source: fakePg({ ...snap, prescriptions: [rx] }, { recordRxView }) });
    await userEvent.click(screen.getByRole("button", { name: /em tela cheia/ }));
    const viewer = screen.getByRole("dialog", { name: /página 1 de 2/ });
    expect(viewer.querySelector("img")).toHaveAttribute("src", "/api/rx-file/a?v=full");
    expect(within(viewer).getByRole("link", { name: "Baixar esta página" })).toHaveAttribute("href", "/api/rx-file/a?v=full");
    await userEvent.click(within(viewer).getByRole("button", { name: "Próxima página" }));
    expect(viewer.querySelector("iframe")).toHaveAttribute("src", "/api/rx-file/b?v=full");
    expect(recordRxView).toHaveBeenCalledWith(rx.id); // registra quem viu
  });
});

describe("Lote 3 — reposição e receita no Início (origem Postgres)", () => {
  const patientOf = (snap: Snapshot, id: string) => snap.patients.find((p) => p.id === id)!.name;
  const lowMed = (snap: Snapshot) => snap.medications.find((m) => m.stock.level !== "ok" && !m.otc)!;

  it("cartão de estoque: situação da receita, etapa, responsável e os botões Registrar compra e Eu cuido disso", async () => {
    const snap = snapshot();
    const med = lowMed(snap);
    const semDono = { ...med, replenishment: { ...med.replenishment, owner: undefined, mine: false, done: false } };
    const assumeReplenishment = vi.fn(async () => undefined);
    const { container } = renderApp(shell("/", <HomeScreen />), { source: fakePg({ ...snap, medications: snap.medications.map((m) => (m.id === med.id ? semDono : m)) }, { assumeReplenishment }) });
    const card = screen.getByRole("article", { name: new RegExp(`^${med.name}, ${patientOf(snap, med.patientId)}:`) });
    expect(within(card).getByText(med.rx.text)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Registrar compra" })).toHaveAttribute("href", `/configuracoes/estoque?med=${med.id}`);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(card).getByRole("button", { name: "Eu cuido disso" }));
    await waitFor(() => expect(assumeReplenishment).toHaveBeenCalledWith(med.id, { takeOver: false }));
  });

  it("quem já tem dono na etapa vê 'Assumir no lugar' e a troca vai com takeOver", async () => {
    const snap = snapshot();
    const base = lowMed(snap);
    const owned = {
      ...base,
      replenishment: {
        ...base.replenishment, owner: "Filha", mine: false, canAssume: true, assumeLabel: "Assumir no lugar", done: false, ownerText: "Filha vai pedir a receita",
        steps: [{ n: 1, label: "Pedir receita ao médico", kind: "cur" as const, stateLabel: "Etapa atual", text: "Filha vai pedir a receita", textTone: "neu" as const }],
      },
    };
    const assumeReplenishment = vi.fn(async () => undefined);
    renderApp(shell("/", <HomeScreen />), { source: fakePg({ ...snap, medications: snap.medications.map((m) => (m.id === base.id ? owned : m)) }, { assumeReplenishment }) });
    await userEvent.click(screen.getAllByRole("button", { name: "Ver reposição" })[0]!);
    const sheet = screen.getByRole("dialog", { name: new RegExp(`Reposição de ${base.name}`) });
    await userEvent.click(within(sheet).getByRole("button", { name: "Assumir no lugar" }));
    await waitFor(() => expect(assumeReplenishment).toHaveBeenCalledWith(base.id, { takeOver: true }));
  });

  it("sem reposição aberta o cartão diz isso e 'Eu cuido disso' começa uma", async () => {
    const snap = snapshot();
    const base = lowMed(snap);
    const none = { ...base, replenishment: { ...base.replenishment, steps: [], owner: undefined, mine: false, done: false, ownerText: "Nenhuma reposição aberta" } };
    const assumeReplenishment = vi.fn(async () => undefined);
    renderApp(shell("/", <HomeScreen />), { source: fakePg({ ...snap, medications: snap.medications.map((m) => (m.id === base.id ? none : m)) }, { assumeReplenishment }) });
    const card = screen.getByRole("article", { name: new RegExp(`^${base.name}, ${patientOf(snap, base.patientId)}:`) });
    expect(within(card).getByText(/ainda não aberta/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Eu cuido disso" }));
    await waitFor(() => expect(assumeReplenishment).toHaveBeenCalled());
  });

  it("'Receitas que pedem atenção' lista o que venceu ou falta; sem permissão de receitas não aparece", () => {
    const snap = snapshot();
    const alerta = snap.medications.find((m) => !m.otc && m.rx.kind !== "ok" && m.rx.kind !== "otc");
    const { unmount } = renderApp(shell("/", <HomeScreen />), { source: fakePg(snap) });
    const regiao = screen.getByRole("region", { name: "Receitas que pedem atenção" });
    if (alerta) expect(within(regiao).getAllByText(alerta.rx.text).length).toBeGreaterThan(0);
    unmount();
    renderApp(shell("/", <HomeScreen />), { source: fakePg(snapshot({ member: { id: "c", name: "Neto", profileName: "Confirmador", permissions: { "dashboard.view": true, "patients.view": true } } })) });
    expect(screen.queryByRole("region", { name: "Receitas que pedem atenção" })).not.toBeInTheDocument();
  });
});
