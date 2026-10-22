import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { axe } from "@/test/axe";
import { renderApp } from "@/test/render";
import { FirstAccessForm } from "./auth/AuthForms";
import { SimulatorPanel } from "./settings/SimulatorPanel";
import { WhatsappNumberCard } from "./settings/WhatsappNumberCard";
import { WhatsappPanel } from "./settings/WhatsappPanel";

const wa = vi.hoisted(() => {
  const estado = {
    eu: { verificado: "(11) 91234-5678", pendente: "", codigoAtivo: false, codigoExpiraEm: null },
    pessoas: [
      { id: "1", nome: "Ana", perfil: "Administrador", acesso: "active", numero: "verificado", telefone: "(11) 91234-5678", eu: true },
      { id: "2", nome: "Rosa", perfil: "Familiar", acesso: "whatsapp_verified", numero: "verificado", telefone: "(11) 98888-7777", eu: false },
      { id: "3", nome: "Beto", perfil: "Cuidadora", acesso: "active", numero: "pendente", telefone: "(11) 97777-6666", eu: false },
      { id: "4", nome: "Cida", perfil: "Confirmador", acesso: "active", numero: "sem_numero", telefone: "", eu: false },
    ],
    admin: true,
    chaves: [{ id: "k1", nome: "Planilha", prefixo: "cdf_", criadaEm: "19/10/2026 às 10:00", ultimoUso: "nunca", revogada: false }],
    simulador: true,
  };
  return {
    estado,
    estadoWhatsappAction: vi.fn(async () => ({ ok: true as const, data: estado })),
    criarChaveAction: vi.fn(async (_n: string) => ({ ok: true as const, data: { chave: "cdf_SEGREDO-mostrado-uma-vez" } })),
    revogarChaveAction: vi.fn(async (_id: string) => ({ ok: true as const, data: undefined })),
    reenviarLinkAcessoAction: vi.fn(async (_id: string) => ({ ok: true as const, data: { link: "https://x.test/primeiro-acesso?t=abc" } })),
    iniciarVerificacaoAction: vi.fn(async (_t: string) => ({ ok: true as const, data: { codigo: "123456", telefone: "(11) 91234-5678", expiraEm: "", expiraHora: "10:15" } })),
    removerMeuNumeroAction: vi.fn(async () => ({ ok: true as const, data: undefined })),
    simPessoasAction: vi.fn(async () => ({
      ok: true as const,
      data: [
        { id: "1", nome: "Ana", telefone: "5511912345678", situacao: "verificado" as const },
        { id: "3", nome: "Beto", telefone: "5511977776666", situacao: "pendente" as const },
      ],
    })),
    simEnviarAction: vi.fn(async (i: { telefone: string; texto?: string }) =>
      i.texto === "livre"
        ? { ok: true as const, data: { respostas: [{ texto: "ℹ️ O assistente de perguntas está indisponível no momento." }], digitando: 1 } }
        : { ok: true as const, data: { respostas: [{ texto: "✅ *Anotado*\nAdelino: Zypred das 08:00. Obrigado!" }], digitando: 1 } }),
    simEnviarAgoraAction: vi.fn(async () => ({ ok: true as const, data: [] })),
    simFilaAction: vi.fn(async () => ({
      ok: true as const,
      data: [{ id: "f.m", para: "Ana", telefone: "5511912345678", tipo: "dose_reminder", texto: "⏰ *Hora do remédio — Adelino*\nZypred, às 08:00.\n*1* — Tomei\n*2* — Lembrar em 15 min", quando: "2026-10-19T11:00:00Z" }],
    })),
    simMarcarEnviadaAction: vi.fn(async (_id: string) => ({ ok: true as const, data: null })),
    completeFirstAccess: vi.fn(async () => ({})),
  };
});

vi.mock("@/server/wa/actions", () => wa);
vi.mock("@/server/wa/first-access-actions", () => ({ completeFirstAccess: wa.completeFirstAccess }));
vi.mock("@/server/pg/auth-actions", () => {
  const act = async () => ({});
  return { signIn: act, signUp: act, signOut: act, createFamily: act, forgotPassword: act, resetPassword: act, acceptInvite: act, resendInviteEmail: act, confirmEmail: act, resendVerification: act, checkEmailConfirmed: act };
});

describe("Lote 4A — Configurações › WhatsApp", () => {
  it("mostra o meu número verificado, o estado de cada pessoa (com ícone + texto) e as chaves sem o valor", async () => {
    const { container } = renderApp(<WhatsappPanel />);
    expect(await screen.findByText("Meu WhatsApp")).toBeInTheDocument();
    const meu = screen.getByRole("region", { name: "Meu número de WhatsApp" });
    expect(within(meu).getByText("Verificado")).toBeInTheDocument();
    const pessoas = screen.getByRole("region", { name: "Pessoas e WhatsApp" });
    expect(within(pessoas).getByText("Número pendente")).toBeInTheDocument();
    expect(within(pessoas).getByText("Sem número")).toBeInTheDocument();
    expect(within(pessoas).getAllByText("Número verificado")).toHaveLength(2);
    expect(within(pessoas).getAllByRole("button", { name: "Reenviar link de acesso" })).toHaveLength(1); // só quem espera o primeiro acesso
    expect(screen.getByText("Planilha")).toBeInTheDocument();
    expect(screen.queryByText(/SEGREDO/)).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("criar chave: o valor aparece uma vez, com aviso, e some ao fechar", async () => {
    renderApp(<WhatsappPanel />);
    const card = await screen.findByRole("region", { name: "Chaves de API da família" });
    await userEvent.type(within(card).getByLabelText("Nome da nova chave"), "Teste");
    await userEvent.click(within(card).getByRole("button", { name: "Criar chave" }));
    expect(await screen.findByText("cdf_SEGREDO-mostrado-uma-vez")).toBeInTheDocument();
    expect(screen.getByText(/não será mostrada de novo/)).toBeInTheDocument();
    expect(wa.criarChaveAction).toHaveBeenCalledWith("Teste");
    await userEvent.click(screen.getByRole("button", { name: "Já copiei" }));
    expect(screen.queryByText("cdf_SEGREDO-mostrado-uma-vez")).not.toBeInTheDocument();
  });

  it("revogar chave chama a ação", async () => {
    renderApp(<WhatsappPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Revogar" }));
    await waitFor(() => expect(wa.revogarChaveAction).toHaveBeenCalledWith("k1"));
  });

  it("reenviar link de acesso mostra o link novo uma vez", async () => {
    renderApp(<WhatsappPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Reenviar link de acesso" }));
    expect(await screen.findByText(/primeiro-acesso\?t=abc/)).toBeInTheDocument();
  });

  it("número sem verificar: gera o código de 6 dígitos e diz de qual número enviar", async () => {
    let gerado = false;
    wa.iniciarVerificacaoAction.mockImplementationOnce(async () => {
      gerado = true;
      return { ok: true as const, data: { codigo: "123456", telefone: "(11) 91234-5678", expiraEm: "", expiraHora: "10:15" } };
    });
    wa.estadoWhatsappAction.mockImplementation((async () => ({
      ok: true as const,
      data: { ...wa.estado, eu: gerado ? { verificado: "", pendente: "(11) 91234-5678", codigoAtivo: true, codigoExpiraEm: "2026-10-19T20:00:00Z" } : { verificado: "", pendente: "", codigoAtivo: false, codigoExpiraEm: null } },
    })) as never);
    renderApp(<WhatsappNumberCard />);
    expect(await screen.findByText("Não informado")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Celular com DDD"), "(11) 91234-5678");
    await userEvent.click(screen.getByRole("button", { name: "Gerar código" }));
    expect(await screen.findByText("123456")).toBeInTheDocument();
    expect(screen.getByText(/pelo WhatsApp do número/)).toBeInTheDocument();
  });
});

describe("Lote 4A — Simulador de WhatsApp", () => {
  it("tem o banner fixo, o seletor 'Falar como' e a fila; axe sem violações", async () => {
    const { container } = renderApp(<SimulatorPanel />);
    expect(screen.getByText("Simulador: nenhuma mensagem real é enviada")).toBeInTheDocument();
    expect(await screen.findByLabelText("Falar como")).toBeInTheDocument();
    expect(await screen.findByText(/Hora do remédio — Adelino/)).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Mensagens que o sistema enviaria agora" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("envia pela fila e pelo worker, mostra o digitando simulado e a resposta (inclusive a do assistente indisponível)", async () => {
    renderApp(<SimulatorPanel />);
    await screen.findByLabelText("Falar como");
    await waitFor(() => expect(screen.getByRole("option", { name: /Ana/ })).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText("Mensagem"), "tomei");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    const log = screen.getByRole("log", { name: "Mensagens" });
    expect(await within(log).findByText("Anotado")).toBeInTheDocument();
    expect(wa.simEnviarAction).toHaveBeenCalledWith({ telefone: "5511912345678", texto: "tomei" });
    await userEvent.type(screen.getByLabelText("Mensagem"), "livre");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await within(log).findByText(/assistente de perguntas está indisponível/)).toBeInTheDocument();
    expect(within(log).getAllByText(/digitando… \(simulado/).length).toBeGreaterThan(0);
  });

  it("'Marcar como enviada' leva a mensagem para a conversa da pessoa", async () => {
    renderApp(<SimulatorPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Marcar como enviada" }));
    await waitFor(() => expect(wa.simMarcarEnviadaAction).toHaveBeenCalledWith("f.m"));
    const log = screen.getByRole("log", { name: "Mensagens" });
    expect(await within(log).findByText(/Hora do remédio — Adelino/)).toBeInTheDocument();
  });
});

describe("Lote 4A — Primeiro acesso", () => {
  it("pede e-mail e senha, confirma a senha e não mostra nada além do necessário; axe sem violações", async () => {
    const { container } = renderApp(<FirstAccessForm token="t" name="Rosa Souza" familyName="Família Souza" profileName="Familiar" />);
    expect(screen.getByText(/Seu WhatsApp já está confirmado/)).toBeInTheDocument();
    expect(screen.getByLabelText("Seu e-mail")).toBeRequired();
    expect(screen.getByLabelText("Crie uma senha")).toBeRequired();
    expect(screen.getByLabelText("Repita a senha")).toBeRequired();
    expect(screen.getByRole("button", { name: "Criar meu acesso" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
