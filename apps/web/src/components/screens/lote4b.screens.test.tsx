import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { axe } from "@/test/axe";
import { renderApp } from "@/test/render";
import { WhatsappPanel } from "./settings/WhatsappPanel";

type Status = {
  provedor: string; configurado: boolean;
  instancia: { estado: "conectada" | "desconectada" | "aguardando"; desde: string | null; consultadaEm: string | null };
  chave: { recusada: boolean; pausadoAte: string | null; motivo: string };
  midia: { ultimaFalha: { motivo: string; quando: string } | null; modelo: string };
  worker: { habilitado: boolean; ligado: boolean; ultimoBatimento: string | null };
  entrada: { pendentes: number; processando: number; erros: number; maisAntigaSeg: number | null; ultimosErros: Array<{ motivo: string; quando: string; tentativas: number }> };
  saida: { pendentes: number; comErro: number; ultimosErros: Array<{ tipo: string; motivo: string; quando: string }> };
  ia: { configurada: boolean; modelo: string; midia: boolean; mes: string; usadoUsd: number; limiteUsd: number; chamadas: number; excedeu: boolean };
};

const wa = vi.hoisted(() => {
  const statusBase: Status = {
    provedor: "evolution-go", configurado: false,
    instancia: { estado: "aguardando", desde: null, consultadaEm: null },
    midia: { ultimaFalha: null, modelo: "gemini-3.5-flash-lite" },
    chave: { recusada: false, pausadoAte: null, motivo: "Evolution recusou a chave (401): use o token da instância em EVOLUTION_INSTANCE_TOKEN" },
    worker: { habilitado: false, ligado: false, ultimoBatimento: null },
    entrada: { pendentes: 0, processando: 0, erros: 0, maisAntigaSeg: null, ultimosErros: [] },
    saida: { pendentes: 0, comErro: 0, ultimosErros: [] },
    ia: { configurada: false, modelo: "claude-sonnet-5-5", midia: false, mes: "2026-10", usadoUsd: 0, limiteUsd: 5, chamadas: 0, excedeu: false },
  };
  const estado = { eu: { verificado: "(11) 91234-5678", pendente: "", codigoAtivo: false, codigoExpiraEm: null }, pessoas: [], admin: true, chaves: [], simulador: false, status: { ...statusBase } as Status | null };
  return {
    statusBase, estado,
    estadoWhatsappAction: vi.fn(async () => ({ ok: true as const, data: { ...estado } })),
    criarChaveAction: vi.fn(),
    revogarChaveAction: vi.fn(),
    reenviarLinkAcessoAction: vi.fn(),
    iniciarVerificacaoAction: vi.fn(),
    removerMeuNumeroAction: vi.fn(),
    consultarInstanciaAction: vi.fn(async () => ({ ok: true as const, data: { ...statusBase, configurado: true, instancia: { estado: "conectada" as const, desde: "2026-10-22T12:00:00Z", consultadaEm: "2026-10-22T12:01:00Z" } } })),
    definirLimiteIaAction: vi.fn(async (usd: number) => ({ ok: true as const, data: { ...statusBase, ia: { ...statusBase.ia, limiteUsd: usd } } })),
  };
});

vi.mock("@/server/wa/actions", () => wa);

beforeEach(() => {
  wa.estado.status = { ...wa.statusBase };
  vi.clearAllMocks();
});

describe("Lote 4B — Configurações › WhatsApp › WhatsApp do sistema", () => {
  it("sem número: 'aguardando conexão' (ícone + texto), worker desligado, assistente sem chave; sem nada do N8N", async () => {
    const { container } = renderApp(<WhatsappPanel />);
    const card = await screen.findByRole("region", { name: "WhatsApp do sistema" });
    expect(within(card).getByText("Aguardando conexão")).toBeInTheDocument();
    expect(within(card).getByText(/Worker desligado/)).toBeInTheDocument();
    expect(within(card).getByText(/Sem ANTHROPIC_API_KEY/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Consultar agora" })).toBeDisabled();
    expect(container.textContent).not.toMatch(/N8N|Testar conexão|cpl_/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("mostra contagem da fila, motivo resumido dos erros e o uso de IA contra o limite", async () => {
    wa.estado.status = {
      ...wa.statusBase, configurado: true,
      instancia: { estado: "desconectada", desde: "2026-10-22T12:00:00Z", consultadaEm: "2026-10-22T12:05:00Z" },
      worker: { habilitado: true, ligado: true, ultimoBatimento: "2026-10-22T12:05:00Z" },
      entrada: { pendentes: 2, processando: 1, erros: 1, maisAntigaSeg: 42, ultimosErros: [{ motivo: "Error: sem resposta", quando: "22/10/2026 09:00", tentativas: 5 }] },
      saida: { pendentes: 3, comErro: 1, ultimosErros: [{ tipo: "dose_reminder", motivo: "ErroEnvio: Evolution /send/text respondeu 400", quando: "22/10/2026 09:10" }] },
      ia: { configurada: true, modelo: "claude-sonnet-5-5", midia: true, mes: "2026-10", usadoUsd: 5, limiteUsd: 5, chamadas: 40, excedeu: true },
    };
    const { container } = renderApp(<WhatsappPanel />);
    const card = await screen.findByRole("region", { name: "WhatsApp do sistema" });
    expect(within(card).getByText("Desconectada")).toBeInTheDocument();
    expect(within(card).getByText("Worker ligado")).toBeInTheDocument();
    expect(within(card).getByText(/Erro em 22\/10\/2026 09:00: Error: sem resposta \(5 tentativas\)/)).toBeInTheDocument();
    expect(within(card).getByText(/Falha em 22\/10\/2026 09:10 \(dose_reminder\)/)).toBeInTheDocument();
    expect(within(card).getByText("Assistente pausado")).toBeInTheDocument();
    expect(within(card).getByRole("progressbar", { name: "Uso do limite mensal de IA" })).toHaveAttribute("aria-valuenow", "100");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("chave recusada: alerta com a orientação e até quando o envio fica pausado", async () => {
    wa.estado.status = { ...wa.statusBase, configurado: true, chave: { recusada: true, pausadoAte: "26/10/2026 10:10", motivo: "Evolution recusou a chave (401): use o token da instância em EVOLUTION_INSTANCE_TOKEN" } };
    const { container } = renderApp(<WhatsappPanel />);
    const card = await screen.findByRole("region", { name: "WhatsApp do sistema" });
    const alerta = within(card).getByRole("alert");
    expect(alerta).toHaveTextContent("EVOLUTION_INSTANCE_TOKEN");
    expect(alerta).toHaveTextContent("Envio pausado até 26/10/2026 10:10");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("mostra o último motivo de falha de áudio/foto", async () => {
    wa.estado.status = { ...wa.statusBase, configurado: true, ia: { ...wa.statusBase.ia, configurada: true, midia: true }, midia: { modelo: "gemini-3.5-flash-lite", ultimaFalha: { motivo: "modelo da Gemini não encontrado (404): troque GEMINI_MODEL", quando: "26/10/2026 10:00" } } };
    renderApp(<WhatsappPanel />);
    const card = await screen.findByRole("region", { name: "WhatsApp do sistema" });
    expect(within(card).getByText(/Última falha de áudio\/foto \(26\/10\/2026 10:00\): modelo da Gemini não encontrado \(404\)/)).toBeInTheDocument();
    expect(within(card).getByText("gemini-3.5-flash-lite")).toBeInTheDocument();
  });

  it("Consultar agora atualiza o estado; Salvar limite envia o valor com vírgula e recusa texto", async () => {
    wa.estado.status = { ...wa.statusBase, configurado: true };
    const user = userEvent.setup();
    renderApp(<WhatsappPanel />);
    const card = await screen.findByRole("region", { name: "WhatsApp do sistema" });
    await user.click(within(card).getByRole("button", { name: "Consultar agora" }));
    await waitFor(() => expect(wa.consultarInstanciaAction).toHaveBeenCalledTimes(1));

    const campo = within(card).getByLabelText("Limite mensal (US$)");
    await user.clear(campo);
    await user.type(campo, "abc");
    await user.click(within(card).getByRole("button", { name: "Salvar limite" }));
    expect(await within(card).findByText(/valor em dólares/)).toBeInTheDocument();
    expect(wa.definirLimiteIaAction).not.toHaveBeenCalled();
    await user.clear(campo);
    await user.type(campo, "7,50");
    await user.click(within(card).getByRole("button", { name: "Salvar limite" }));
    await waitFor(() => expect(wa.definirLimiteIaAction).toHaveBeenCalledWith(7.5));
  });

  it("não aparece para quem não é Administrador", async () => {
    wa.estado.status = null;
    wa.estado.admin = false;
    renderApp(<WhatsappPanel />);
    await screen.findByRole("region", { name: "Meu número de WhatsApp" });
    expect(screen.queryByRole("region", { name: "WhatsApp do sistema" })).not.toBeInTheDocument();
    wa.estado.admin = true;
  });
});
