// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageAction, PageWithAction } from "./PageAction";

describe("PageAction", () => {
  it("coloca a ação na MESMA linha do título (e a linha quebra no celular)", () => {
    render(
      <PageWithAction title="Remédios">
        <PageAction>
          <button type="button">Novo remédio</button>
        </PageAction>
        <p>conteúdo da página</p>
      </PageWithAction>,
    );
    const title = screen.getByRole("heading", { level: 1, name: "Remédios" });
    const button = screen.getByRole("button", { name: "Novo remédio" });
    // título e botão dividem a mesma linha (mesmo contêiner), que quebra quando não cabe
    expect(title.parentElement).toBe(button.closest("div")?.parentElement);
    expect(title.parentElement?.className).toMatch(/flex-wrap/);
    expect(title.parentElement?.className).toMatch(/justify-between/);
    // o conteúdo da página fica depois da linha do título
    expect(screen.getByText("conteúdo da página")).toBeTruthy();
  });

  it("fora de uma página com título, a ação aparece onde foi escrita", () => {
    render(
      <PageAction>
        <button type="button">Cadastrar paciente</button>
      </PageAction>,
    );
    expect(screen.getByRole("button", { name: "Cadastrar paciente" })).toBeTruthy();
  });
});
