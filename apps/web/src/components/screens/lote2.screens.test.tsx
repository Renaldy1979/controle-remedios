import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { axe } from "@/test/axe";
import { nav, renderApp } from "@/test/render";
import { createMockDataSource } from "@/data/mock/store";
import type { DataSource, DoseHistoryResult, Snapshot } from "@/data";
import { AppShell } from "@/components/app/AppShell";
import { HomeScreen } from "./HomeScreen";
import { PatientsScreen } from "./PatientsScreen";
import { SettingsScreen } from "./SettingsScreen";
import { DoseHistoryScreen } from "./lote2/DoseHistoryScreen";
import { NoticesScreen } from "./lote2/NoticesScreen";

/** Retrato "do Lote 2" (origem real) montado sobre o mock: doses, estoque, avisos. */
function liveSnapshot(over: Partial<Snapshot> = {}): Snapshot {
  const base = createMockDataSource().getSnapshot();
  const taken = base.doses.filter((d) => d.status === "taken").slice(0, 2);
  return {
    ...base,
    member: { id: "me", name: "Ana", profileName: "Administrador", permissions: {} },
    family: { name: "Família Souza", canSwitch: false },
    history: [],
    interactions: [],
    recentTaken: taken,
    notices: [],
    unreadNotices: 0,
    ...over,
  };
}

function fakePg(snap: Snapshot, over: Partial<DataSource["actions"]> = {}): DataSource {
  const mock = createMockDataSource();
  return {
    kind: "postgres",
    getSnapshot: () => snap,
    previewStockDays: async () => 12,
    subscribe: () => () => {},
    actions: { ...mock.actions, ...over },
  } as DataSource;
}

const shell = (path: string, ui: React.ReactElement) => {
  nav.pathname = path;
  nav.search = "";
  return <AppShell>{ui}</AppShell>;
};

const CONFIRMADOR = { id: "c", name: "Filha", profileName: "Confirmador", permissions: { "dashboard.view": true, "patients.view": true, "doses.confirm": true } } as const;

describe("Lote 2 — Início (origem Postgres)", () => {
  it("mostra atrasadas, próximas, estoque perto de acabar e últimas tomadas, sem dados de demonstração", async () => {
    const snap = liveSnapshot();
    const { container } = renderApp(shell("/", <HomeScreen />), { source: fakePg(snap) });
    expect(screen.getByRole("heading", { name: /Pedem atenção/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Próximas doses" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Estoque perto de acabar" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Últimas doses tomadas" })).toBeInTheDocument();
    expect(screen.queryByText(/Dados de demonstração/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Últimas interações" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Receitas que pedem atenção" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("confirmar chama a ação do servidor e oferece Desfazer, que chama o desfazer", async () => {
    const snap = liveSnapshot();
    const next = snap.doses.find((d) => d.status === "pending")!;
    const confirmDose = vi.fn(async () => undefined);
    const undoDose = vi.fn(async () => undefined);
    renderApp(shell("/", <HomeScreen />), { source: fakePg(snap, { confirmDose, undoDose }) });
    await userEvent.click(screen.getAllByRole("button", { name: new RegExp(`Confirmar dose de ${next.medName} das ${next.time}`) })[0]!);
    await waitFor(() => expect(confirmDose).toHaveBeenCalledWith(next.id));
    await userEvent.click(await screen.findByRole("button", { name: /Desfazer/ }));
    expect(undoDose).toHaveBeenCalledWith(next.id);
  });

  it("dose esquecida pede 'Registrar que tomou depois' e atrasada oferece 'Lembrar de novo'", async () => {
    const snap = liveSnapshot();
    const missed = snap.doses.find((d) => d.status === "missed")!;
    const late = snap.doses.find((d) => d.status === "late")!;
    const confirmDose = vi.fn(async () => undefined);
    const snoozeDose = vi.fn(async () => undefined);
    renderApp(shell("/", <HomeScreen />), { source: fakePg(snap, { confirmDose, snoozeDose }) });
    await userEvent.click(screen.getByRole("button", { name: "Registrar que tomou depois" }));
    await waitFor(() => expect(confirmDose).toHaveBeenCalledWith(missed.id));
    await userEvent.click(screen.getByRole("button", { name: "Lembrar de novo" }));
    await waitFor(() => expect(snoozeDose).toHaveBeenCalledWith(late.id, 15));
  });

  it("Confirmador vê a próxima dose e o check, mas não vê estoque", async () => {
    const snap = liveSnapshot({ member: { ...CONFIRMADOR, permissions: { ...CONFIRMADOR.permissions } } });
    renderApp(shell("/", <HomeScreen />), { source: fakePg(snap) });
    expect(screen.getByRole("heading", { name: "Próximas doses" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Confirmar dose de/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Estoque perto de acabar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Histórico" })).not.toBeInTheDocument();
  });

  it("sem remédios, mostra os primeiros passos", () => {
    renderApp(shell("/", <HomeScreen />), { source: fakePg(liveSnapshot({ medications: [], doses: [], recentTaken: [] })) });
    expect(screen.getByRole("heading", { name: "Primeiros passos" })).toBeInTheDocument();
  });
});

describe("Lote 2 — Pacientes (doses do dia)", () => {
  it("mostra os horários de hoje com a situação de cada um e quem deu o check", async () => {
    const snap = liveSnapshot();
    const { container } = renderApp(shell("/pacientes", <PatientsScreen />), { source: fakePg(snap) });
    expect(screen.getAllByLabelText("Horários de hoje").length).toBeGreaterThan(0);
    expect(screen.getByText(/doses tomadas hoje/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("tocar num horário pendente confirma a dose; esquecida vira 'registrar que tomou depois'", async () => {
    const snap = liveSnapshot();
    const patient = snap.patients[0]!;
    const missed = snap.doses.find((d) => d.status === "missed" && d.patientId === patient.id);
    const confirmDose = vi.fn(async () => undefined);
    renderApp(shell("/pacientes", <PatientsScreen />), { source: fakePg(snap, { confirmDose }) });
    const pending = snap.doses.find((d) => d.status === "pending" && d.patientId === patient.id)!;
    await userEvent.click(screen.getAllByRole("button", { name: new RegExp(`Confirmar dose das ${pending.time}`) })[0]!);
    await waitFor(() => expect(confirmDose).toHaveBeenCalledWith(pending.id));
    if (missed) expect(screen.getByRole("button", { name: new RegExp(`Registrar que tomou depois a dose das ${missed.time}`) })).toBeInTheDocument();
  });

  it("estoque sem registro avisa e leva a registrar a compra", () => {
    const snap = liveSnapshot();
    const meds = snap.medications.map((m, i) => (i === 0 ? { ...m, stock: { ...m.stock, tracked: false } } : m));
    renderApp(shell("/pacientes", <PatientsScreen />), { source: fakePg({ ...snap, medications: meds }) });
    expect(screen.getByText("Estoque ainda não registrado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registrar compra" })).toHaveAttribute("href", `/configuracoes/estoque?med=${meds[0]!.id}`);
  });
});

describe("Lote 2 — Estoque em Configurações", () => {
  it("lista por urgência com estimativa sinalizada, registra compra com prévia e ajusta com motivo", async () => {
    const snap = liveSnapshot();
    const registerPurchase = vi.fn(async () => undefined);
    const adjustStock = vi.fn(async () => undefined);
    const { container } = renderApp(shell("/configuracoes/estoque", <SettingsScreen section="estoque" />), { source: fakePg(snap, { registerPurchase, adjustStock }) });
    expect(screen.getByRole("region", { name: "Estoque por urgência" })).toBeInTheDocument();
    expect(screen.getAllByText(/Estimativa/).length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();

    const compra = screen.getByRole("form", { name: "Registrar compra" });
    const campo = within(compra).getByLabelText(/Quantidade comprada/);
    await userEvent.clear(campo);
    await userEvent.type(campo, "20");
    expect(await within(compra).findByTestId("purchase-preview")).toHaveTextContent(/para 12 dias/);
    await userEvent.click(within(compra).getByRole("button", { name: "Registrar compra" }));
    await waitFor(() => expect(registerPurchase).toHaveBeenCalledWith(snap.medications[0]!.id, 20));

    const ajuste = screen.getByRole("form", { name: "Ajuste manual" });
    await userEvent.type(within(ajuste).getByLabelText(/Quanto tem agora/), "7");
    await userEvent.type(within(ajuste).getByLabelText(/Motivo/), "conferi o frasco");
    await userEvent.click(within(ajuste).getByRole("button", { name: "Registrar ajuste" }));
    await waitFor(() => expect(adjustStock).toHaveBeenCalledWith(snap.medications[0]!.id, 7, "conferi o frasco"));
  });

  it("Familiar sem permissão de ajustar vê o estoque, mas não os formulários", () => {
    const snap = liveSnapshot({ member: { id: "x", name: "Cuida", profileName: "Cuidadora", permissions: { "dashboard.view": true, "stock.view": true } } });
    renderApp(shell("/configuracoes/estoque", <SettingsScreen section="estoque" />), { source: fakePg(snap) });
    expect(screen.queryByRole("form", { name: "Registrar compra" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Estoque por urgência" })).toBeInTheDocument();
  });

  it("Avisos: o limite padrão muda de 1 em 1 dia e os prazos de dose são editáveis", async () => {
    const snap = liveSnapshot();
    const setNotification = vi.fn(async () => undefined);
    const { container } = renderApp(shell("/configuracoes/avisos", <SettingsScreen section="avisos" />), { source: fakePg(snap, { setNotification }) });
    expect(screen.getByTestId("lead-days")).toHaveTextContent(`${snap.notifications.leadDays} dias`);
    await userEvent.click(screen.getByRole("button", { name: "Aumentar antecedência" }));
    expect(setNotification).toHaveBeenCalledWith({ leadDays: snap.notifications.leadDays + 1 });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Lote 2 — sino e avisos", () => {
  const notice = (over: Partial<NonNullable<Snapshot["notices"]>[number]> = {}) => ({
    id: "n1", kind: "low_stock", title: "Estoque baixo: Zypred (Maria)", body: "Restam cerca de 5 dias.", whenLabel: "hoje às 10:00", read: false, href: "/configuracoes/estoque?med=zyp", ...over,
  });

  it("o sino mostra quantos avisos novos e leva para /avisos", () => {
    const snap = liveSnapshot({ notices: [notice(), notice({ id: "n2" })], unreadNotices: 2 });
    renderApp(shell("/", <HomeScreen />), { source: fakePg(snap) });
    const bells = screen.getAllByRole("link", { name: "Avisos: 2 novos" });
    expect(bells.length).toBeGreaterThan(0);
    expect(bells[0]).toHaveAttribute("href", "/avisos");
    expect(screen.getAllByTestId("bell-count")[0]).toHaveTextContent("2");
  });

  it("sem avisos novos o sino fica sem número", () => {
    renderApp(shell("/", <HomeScreen />), { source: fakePg(liveSnapshot()) });
    expect(screen.getAllByRole("link", { name: "Avisos: nenhum novo" }).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("bell-count")).not.toBeInTheDocument();
  });

  it("lista lidos e não lidos (com texto, não só cor), marca como lido e leva ao estoque", async () => {
    const markNoticesRead = vi.fn(async () => undefined);
    const snap = liveSnapshot({ notices: [notice(), notice({ id: "n2", read: true, title: "Estoque baixo: Losartana (Adelino)" })], unreadNotices: 1 });
    const { container } = renderApp(shell("/avisos", <NoticesScreen />), { source: fakePg(snap, { markNoticesRead }) });
    expect(screen.getByTestId("notices-summary")).toHaveTextContent("1 aviso novo");
    expect(screen.getByText("Novo")).toBeInTheDocument();
    expect(screen.getByText("Lido")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Ver estoque e registrar compra" })[0]).toHaveAttribute("href", "/configuracoes/estoque?med=zyp");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Marcar todos como lidos" }));
    expect(markNoticesRead).toHaveBeenCalledWith();
    await userEvent.click(screen.getByRole("button", { name: "Marcar como lido" }));
    expect(markNoticesRead).toHaveBeenCalledWith(["n1"]);
  });

  it("sem avisos mostra um estado vazio claro", () => {
    renderApp(shell("/avisos", <NoticesScreen />), { source: fakePg(liveSnapshot()) });
    expect(screen.getByText("Nenhum aviso por enquanto")).toBeInTheDocument();
  });
});

describe("Lote 2 — Histórico de doses", () => {
  const rows: DoseHistoryResult = {
    truncated: false,
    people: [{ id: "m1", name: "Ana" }],
    rows: [
      { id: "d1", dateLabel: "19/10/2026", time: "14:00", medName: "Zypred", patientId: "p1", patientName: "Maria", status: "taken", doseText: "1 gota", who: "Ana", doneLabel: "19/10 às 14:05", channel: "panel" },
      { id: "d2", dateLabel: "19/10/2026", time: "06:00", medName: "Zypred", patientId: "p1", patientName: "Maria", status: "missed", doseText: "1 gota", who: "", doneLabel: "", channel: "" },
    ],
  };

  it("carrega do servidor, mostra quem deu, quando e o canal, e refiltra por situação", async () => {
    const loadDoseHistory = vi.fn(async () => rows);
    const { container } = renderApp(shell("/historico", <DoseHistoryScreen />), { source: fakePg(liveSnapshot(), { loadDoseHistory }) });
    await waitFor(() => expect(screen.getByTestId("history-count")).toHaveTextContent("2 registros"));
    expect(loadDoseHistory).toHaveBeenCalledWith(expect.objectContaining({ from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
    expect(screen.getAllByText(/Ana/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/19\/10 às 14:05/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Ninguém confirmou/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Esquecidas" }));
    await waitFor(() => expect(loadDoseHistory).toHaveBeenLastCalledWith(expect.objectContaining({ status: "missed" })));
    await userEvent.selectOptions(screen.getByLabelText("Quem deu"), "m1");
    await waitFor(() => expect(loadDoseHistory).toHaveBeenLastCalledWith(expect.objectContaining({ status: "missed", memberId: "m1" })));
  });

  it("sem resultado mostra estado vazio com 'Limpar filtros'", async () => {
    const loadDoseHistory = vi.fn(async () => ({ rows: [], people: [], truncated: false }));
    renderApp(shell("/historico", <DoseHistoryScreen />), { source: fakePg(liveSnapshot(), { loadDoseHistory }) });
    expect(await screen.findByText("Ainda não há doses no histórico")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tomadas" }));
    expect(await screen.findByText("Nenhum registro com esses filtros")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpar filtros" })).toBeInTheDocument();
  });

  it("perfil sem permissão de histórico não vê a tela", () => {
    const snap = liveSnapshot({ member: { ...CONFIRMADOR, permissions: { ...CONFIRMADOR.permissions } } });
    renderApp(shell("/historico", <DoseHistoryScreen />), { source: fakePg(snap) });
    expect(screen.getByText(/não está liberada para o seu perfil/)).toBeInTheDocument();
  });
});
