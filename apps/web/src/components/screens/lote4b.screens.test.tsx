import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { axe } from "@/test/axe";
import { renderApp } from "@/test/render";
import { WhatsappPanel } from "./settings/WhatsappPanel";

const wa = vi.hoisted(() => {
  const n8nVazio = { url: null as string | null, temSegredo: false, estado: "aguardando" as "aguardando" | "conectado", teste: null as null | { em: string; ok: boolean; versao: string | null } };
  const estado = {
    eu: { verificado: "(11) 91234-5678", pendente: "", codigoAtivo: false, codigoExpiraEm: null },
    pessoas: [],
    admin: true,
    chaves: [],
    chavesPlataforma: [] as Array<{ id: string; nome: string; prefixo: string; criadaEm: string; ultimoUso: string; revogada: boolean }> | null,
    simulador: false,
    n8n: { ...n8nVazio } as typeof n8nVazio | null,
  };
  return {
    estado,
    n8nVazio,
    estadoWhatsappAction: vi.fn(async () => ({ ok: true as const, data: { ...estado } })),
    criarChaveAction: vi.fn(async (_n: string, _t: string) => ({ ok: true as const, data: { chave: "cpl_SEGREDO-da-plataforma" } })),
    revogarChaveAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
    reenviarLinkAcessoAction: vi.fn(),
    iniciarVerificacaoAction: vi.fn(),
    removerMeuNumeroAction: vi.fn(),
    salvarWebhookN8nAction: vi.fn(async (url: string) => {
      Object.assign(estado.n8n!, { url });
      return { ok: true as const, data: estado.n8n! };
    }),
    gerarSegredoN8nAction: vi.fn(async () => {
      Object.assign(estado.n8n!, { temSegredo: true });
      return { ok: true as const, data: { segredo: "whsec_SEGREDO-do-teste", n8n: estado.n8n! } };
    }),
    testarN8nAction: vi.fn(async () => ({ ok: true as const, data: { ok: true, mensagem: "Conectado ao N8N (fluxos versão 1.0.0) em 120 ms.", n8n: estado.n8n! } })),
  };
});

vi.mock("@/server/wa/actions", () => wa);

beforeEach(() => {
  wa.estado.n8n = { ...wa.n8nVazio };
  wa.estado.chavesPlataforma = [];
  vi.clearAllMocks();
});

describe("Lote 4B — Configurações › WhatsApp › N8N", () => {
  it("sem conexão confirmada mostra 'WhatsApp do sistema: aguardando conexão' (ícone + texto) e o teste fica desligado", async () => {
    const { container } = renderApp(<WhatsappPanel />);
    const card = await screen.findByRole("region", { name: "Ligação com o N8N" });
    expect(within(card).getByText("Aguardando conexão")).toBeInTheDocument();
    expect(within(card).getByText(/WhatsApp do sistema: aguardando conexão/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Testar conexão" })).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("não aparece para quem não é Administrador", async () => {
    wa.estado.n8n = null;
    renderApp(<WhatsappPanel />);
    await screen.findByText("Meu WhatsApp");
    expect(screen.queryByRole("region", { name: "Ligação com o N8N" })).not.toBeInTheDocument();
  });

  it("salva o endereço, gera o segredo (mostrado uma vez, com o passo a passo da credencial) e só então libera o teste", async () => {
    renderApp(<WhatsappPanel />);
    const card = await screen.findByRole("region", { name: "Ligação com o N8N" });
    await userEvent.type(within(card).getByLabelText(/Endereço do webhook/), "https://n8n.exemplo.com.br/webhook/medcuidar-teste-conexao");
    await userEvent.click(within(card).getByRole("button", { name: "Salvar endereço" }));
    await waitFor(() => expect(wa.salvarWebhookN8nAction).toHaveBeenCalledWith("https://n8n.exemplo.com.br/webhook/medcuidar-teste-conexao"));

    await userEvent.click(within(card).getByRole("button", { name: "Gerar segredo" }));
    expect(await screen.findByText("whsec_SEGREDO-do-teste")).toBeInTheDocument();
    expect(screen.getByText(/não será mostrado de novo/)).toBeInTheDocument();
    expect(screen.getByText(/MedCuidar Teste de conexão/)).toBeInTheDocument();
    expect(screen.getByText("X-MedCuidar-Token")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Já copiei" }));
    expect(screen.queryByText("whsec_SEGREDO-do-teste")).not.toBeInTheDocument();
    await waitFor(() => expect(within(card).getByRole("button", { name: "Testar conexão" })).toBeEnabled());
  });

  it("mostra o erro de URL recusada (ex.: rede interna) sem salvar", async () => {
    wa.salvarWebhookN8nAction.mockImplementationOnce((async () => ({ ok: false as const, message: "Essa URL não é permitida. Use o endereço público do seu N8N." })) as never);
    renderApp(<WhatsappPanel />);
    const card = await screen.findByRole("region", { name: "Ligação com o N8N" });
    await userEvent.type(within(card).getByLabelText(/Endereço do webhook/), "https://10.0.0.5/x");
    await userEvent.click(within(card).getByRole("button", { name: "Salvar endereço" }));
    expect(await within(card).findByText(/não é permitida/)).toBeInTheDocument();
  });

  it("Testar conexão: sucesso vira 'N8N conectado'; falha mostra a mensagem amigável", async () => {
    Object.assign(wa.estado.n8n!, { url: "https://n8n.exemplo.com.br/webhook/medcuidar-teste-conexao", temSegredo: true });
    wa.testarN8nAction.mockImplementationOnce((async () => ({ ok: true as const, data: { ok: false, mensagem: "O N8N recusou o segredo. Confira a credencial.", n8n: wa.estado.n8n! } })) as never);
    renderApp(<WhatsappPanel />);
    const card = await screen.findByRole("region", { name: "Ligação com o N8N" });
    await userEvent.click(within(card).getByRole("button", { name: "Testar conexão" }));
    expect(await within(card).findByRole("status")).toHaveTextContent("recusou o segredo");
    expect(within(card).getByText("Aguardando conexão")).toBeInTheDocument();

    wa.estado.n8n = { url: wa.estado.n8n!.url, temSegredo: true, estado: "conectado", teste: { em: "22/10/2026 às 10:00", ok: true, versao: "1.0.0" } };
    await userEvent.click(within(card).getByRole("button", { name: "Testar conexão" }));
    expect(await within(card).findByRole("status")).toHaveTextContent("Conectado ao N8N");
    await waitFor(() => expect(within(card).getByText("N8N conectado")).toBeInTheDocument());
  });

  it("chave da plataforma: aparece uma vez, com a instrução de colar no N8N com o nome 'MedCuidar API'", async () => {
    wa.estado.chavesPlataforma = [];
    renderApp(<WhatsappPanel />);
    const card = await screen.findByRole("region", { name: "Chave da plataforma (N8N)" });
    await userEvent.type(within(card).getByLabelText("Nome da nova chave"), "N8N do staging");
    await userEvent.click(within(card).getByRole("button", { name: "Criar chave" }));
    expect(await screen.findByText("cpl_SEGREDO-da-plataforma")).toBeInTheDocument();
    expect(wa.criarChaveAction).toHaveBeenCalledWith("N8N do staging", "plataforma");
    expect(screen.getByText(/MedCuidar API/)).toBeInTheDocument();
    expect(screen.getByText(/Header Auth/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Já copiei" }));
    expect(screen.queryByText("cpl_SEGREDO-da-plataforma")).not.toBeInTheDocument();
  });
});
