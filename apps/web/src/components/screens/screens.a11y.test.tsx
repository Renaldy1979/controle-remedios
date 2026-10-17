import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { axe } from "@/test/axe";
import { nav, renderApp } from "@/test/render";
import { AppShell } from "@/components/app/AppShell";
import { HomeScreen } from "./HomeScreen";
import { PatientsScreen } from "./PatientsScreen";
import { RxListScreen } from "./RxListScreen";
import { RxDetailScreen } from "./RxDetailScreen";
import { HistoryScreen } from "./HistoryScreen";
import { SettingsScreen } from "./SettingsScreen";
import { LoginScreen } from "./LoginScreen";

const inShell = (path: string, ui: ReactElement) => {
  nav.pathname = path;
  return <AppShell>{ui}</AppShell>;
};

describe("axe nas telas diárias", () => {
  it("Início", async () => {
    const { container } = renderApp(inShell("/", <HomeScreen />));
    expect(screen.getByText(/2 doses pedem atenção/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(["ad", "ma"])("Pacientes (%s)", async (p) => {
    nav.search = `p=${p}`;
    const { container } = renderApp(inShell("/pacientes", <PatientsScreen />));
    expect(screen.getAllByRole("tab").length).toBe(2);
    expect(await axe(container)).toHaveNoViolations();
    nav.search = "";
  });

  it("Receitas, detalhe, histórico, configurações e login", async () => {
    for (const [path, ui] of [
      ["/receitas", <RxListScreen key="a" />],
      ["/receitas/rx1", <RxDetailScreen key="b" id="rx1" />],
      ["/historico", <HistoryScreen key="c" />],
      ["/configuracoes/perfis", <SettingsScreen key="d" section="perfis" />],
      ["/configuracoes/avisos", <SettingsScreen key="e" section="avisos" />],
      ["/configuracoes/estoque", <SettingsScreen key="f" section="estoque" />],
    ] as const) {
      const { container, unmount } = renderApp(inShell(path, ui));
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
    const { container } = renderApp(<LoginScreen />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("comportamento", () => {
  it("confirmar dose some do alerta, mostra toast com Desfazer e Desfazer devolve", async () => {
    renderApp(inShell("/", <HomeScreen />));
    await userEvent.click(screen.getByRole("button", { name: /Confirmar dose de Metamucil/ }));
    expect(screen.getByText("Metamucil das 13:00 confirmada")).toBeInTheDocument();
    expect(screen.getByText(/1 dose pede atenção/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(screen.getByText(/2 doses pedem atenção/)).toBeInTheDocument());
  });

  it("anexar receita abre diálogo modal no passo 1", async () => {
    renderApp(inShell("/receitas", <RxListScreen />));
    await userEvent.click(screen.getByRole("button", { name: "Anexar receita" }));
    expect(screen.getByRole("dialog", { name: "Anexar receita" })).toBeInTheDocument();
    expect(screen.getByText("Passo 1 de 3")).toBeInTheDocument();
    expect(await axe(screen.getByRole("dialog"))).toHaveNoViolations();
  });

  it("Seu João (Confirmador) não vê receitas", async () => {
    const { source } = renderApp(inShell("/receitas", <RxListScreen />));
    source.actions.viewAs("joa");
    await waitFor(() => expect(screen.getByText(/não está liberada/)).toBeInTheDocument());
  });
});
