import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "@/test/axe";
import { useState } from "react";
import { Button, IconButton } from "./Button";
import { SelectChip, StatusChip } from "./Chip";
import { Switch, Checkbox } from "./Controls";
import { ConfirmDialog, Dialog } from "./Dialog";
import { TextField } from "./Field";
import { ProgressBar } from "./Layout";
import { Tabs } from "./Tabs";
import { ToastProvider, useToast } from "./Toast";

describe("Button", () => {
  it("mostra Salvando… e bloqueia o clique enquanto carrega", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Salvar</Button>);
    const b = screen.getByRole("button", { name: "Salvando…" });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("botão só de ícone tem nome acessível e alvo de 44px", () => {
    render(<IconButton icon="settings" label="Configurações" />);
    const b = screen.getByRole("button", { name: "Configurações" });
    expect(b.className).toContain("h-11");
    expect(b.className).toContain("w-11");
  });
});

describe("Campos", () => {
  it("erro fica ligado ao campo e é anunciado", async () => {
    render(<TextField label="Data" error="Use dd/mm/aaaa" />);
    const input = screen.getByLabelText("Data");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Use dd/mm/aaaa");
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it("opcional aparece no rótulo", () => {
    render(<TextField label="Médico" optional />);
    expect(screen.getByText(/opcional/)).toBeInTheDocument();
  });
});

describe("Chips e controles", () => {
  it("chip de seleção usa aria-pressed", async () => {
    const Demo = () => {
      const [s, setS] = useState(false);
      return <SelectChip selected={s} onToggle={() => setS(!s)}>Vigentes</SelectChip>;
    };
    render(<Demo />);
    const chip = screen.getByRole("button", { name: "Vigentes" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("chip de status sempre traz ícone e texto", () => {
    render(<StatusChip label="Atrasada" icon="alarm" tone="lt" />);
    expect(screen.getByText("Atrasada")).toBeInTheDocument();
    expect(screen.getByText("alarm")).toHaveAttribute("aria-hidden", "true");
  });

  it("switch expõe role=switch e aria-checked", async () => {
    const Demo = () => {
      const [v, setV] = useState(false);
      return <Switch label="Resumo diário" checked={v} onChange={setV} />;
    };
    render(<Demo />);
    const sw = screen.getByRole("switch", { name: "Resumo diário" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await userEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("checkbox é clicável pelo rótulo", async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Beatriz" />);
    await userEvent.click(screen.getByText("Beatriz"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Tabs", () => {
  it("setas movem a seleção e mantêm role=tab", async () => {
    const Demo = () => {
      const [v, setV] = useState<"a" | "b">("a");
      return <Tabs label="Paciente" value={v} onChange={setV} items={[{ value: "a", label: "Adelino" }, { value: "b", label: "Maria" }]} />;
    };
    render(<Demo />);
    const [a, b] = screen.getAllByRole("tab");
    expect(a).toHaveAttribute("aria-selected", "true");
    a!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(b).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tablist", { name: "Paciente" })).toBeInTheDocument();
  });
});

describe("Dialog", () => {
  it("é um diálogo modal, fecha com Esc e devolve o foco", async () => {
    const Demo = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Abrir</button>
          {open ? <Dialog title="Título" onClose={() => setOpen(false)}><button>Dentro</button></Dialog> : null}
        </>
      );
    };
    render(<Demo />);
    const opener = screen.getByText("Abrir");
    opener.focus();
    await userEvent.click(opener);
    const dlg = screen.getByRole("dialog", { name: "Título" });
    expect(dlg).toHaveAttribute("aria-modal", "true");
    expect(dlg.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("exige digitar REMOVER quando há impacto na escala", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog title="Remover Rosa?" description="Está na escala" confirmLabel="Remover" requireWord="REMOVER" onConfirm={onConfirm} onClose={() => {}} />);
    const ok = screen.getByRole("button", { name: "Remover" });
    expect(ok).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Digite REMOVER/), "REMOVER");
    expect(ok).toBeEnabled();
    await userEvent.click(ok);
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe("Progresso e toast", () => {
  it("barra de progresso tem role=progressbar com valor", () => {
    render(<ProgressBar value={64} label="Enviando a receita" detail="Página 2 de 3" />);
    const bar = screen.getByRole("progressbar", { name: "Enviando a receita" });
    expect(bar).toHaveAttribute("aria-valuenow", "64");
  });

  it("toast aparece em região de status, oferece Desfazer e some em 8 s", () => {
    vi.useFakeTimers();
    const undo = vi.fn();
    const Demo = () => {
      const show = useToast();
      return <button onClick={() => show({ message: "Dose confirmada", undo })}>Disparar</button>;
    };
    render(<ToastProvider><Demo /></ToastProvider>);
    fireEvent.click(screen.getByText("Disparar"));
    expect(screen.getByRole("status")).toHaveTextContent("Dose confirmada");
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    expect(undo).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Disparar"));
    act(() => { vi.advanceTimersByTime(8100); });
    expect(screen.queryByText("Dose confirmada")).toBeNull();
    vi.useRealTimers();
  });

  it("toast de erro não some sozinho", () => {
    vi.useFakeTimers();
    const Demo = () => {
      const show = useToast();
      return <button onClick={() => show({ message: "Sem conexão", error: true })}>Erro</button>;
    };
    render(<ToastProvider><Demo /></ToastProvider>);
    fireEvent.click(screen.getByText("Erro"));
    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.getByRole("alert")).toHaveTextContent("Sem conexão");
    vi.useRealTimers();
  });
});
