import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { axe } from "@/test/axe";
import { nav, renderApp } from "@/test/render";
import { createMockDataSource } from "@/data/mock/store";
import type { DataSource, InviteResult, PatientInput, PersonVM, Snapshot } from "@/data";
import { AppShell } from "@/components/app/AppShell";
import { SettingsScreen } from "./SettingsScreen";
import { AccountScreen } from "./lote1/AccountScreen";
import { ComingSoon } from "./lote1/ComingSoon";
import { Lote1Home } from "./lote1/Lote1Home";
import { PatientsScreen } from "./PatientsScreen";
import { AcceptInviteForm, ConfirmEmailForm, CreateFamilyForm, ForgotPasswordForm, ResetPasswordForm, SignInForm, SignUpForm, VerifyPending } from "./auth/AuthForms";
import { AuthFrame } from "./auth/AuthFrame";

const waMock = vi.hoisted(() => ({
  iniciarVerificacaoAction: vi.fn(async (_tel: string) => ({ ok: true as const, data: { codigo: "482913", telefone: "(11) 97777-6666", expiraEm: "2026-10-19T20:00:00Z", expiraHora: "17:00" } })),
}));
vi.mock("@/server/wa/actions", () => ({
  estadoWhatsappAction: async () => ({
    ok: true as const,
    data: { eu: { verificado: "", pendente: "(11) 91234-5678", codigoAtivo: false, codigoExpiraEm: null }, pessoas: [], admin: true, chaves: [], simulador: false, status: null },
  }),
  iniciarVerificacaoAction: waMock.iniciarVerificacaoAction,
  removerMeuNumeroAction: async () => ({ ok: true as const, data: undefined }),
  criarChaveAction: async () => ({ ok: true as const, data: { chave: "cdf_x" } }),
  revogarChaveAction: async () => ({ ok: true as const, data: undefined }),
  reenviarLinkAcessoAction: async () => ({ ok: true as const, data: { link: "http://x" } }),
}));

vi.mock("@/server/pg/auth-actions", () => {
  const act = async () => ({});
  return {
    signIn: act, signUp: act, signOut: act, createFamily: act, forgotPassword: act, resetPassword: act, acceptInvite: act,
    resendInviteEmail: act, confirmEmail: act, resendVerification: act, checkEmailConfirmed: act,
  };
});

const person = (over: Partial<PersonVM>): PersonVM => ({
  id: "x", name: "Fulano", relation: "", profileName: "Familiar", role: "family", phone: "", whatsappActive: false, receivesAlerts: false, permissions: {},
  accessState: "active", email: "fulano@exemplo.test", phonePending: "", active: true, isSelf: false, ...over,
});

/** Retrato "do Lote 1" (origem real) montado a partir do mock, sem doses/estoque/receitas. */
function lote1Snapshot(over: Partial<Snapshot> = {}): Snapshot {
  const base = createMockDataSource().getSnapshot();
  return {
    ...base,
    member: { id: "me", name: "Ana", profileName: "Administrador", permissions: {} },
    family: { name: "Família Souza", canSwitch: false },
    patients: [
      { id: "p1", name: "Adelino", fullName: "Adelino Souza", age: 84, note: "", usesPhone: true, phone: "", birthDate: "1942-03-10", selfMemberId: null, selfMemberName: "" },
      { id: "p2", name: "Maria", fullName: "Maria Souza", age: 81, note: "Alzheimer.", usesPhone: false, phone: "Sem celular", birthDate: "", selfMemberId: null, selfMemberName: "" },
    ],
    people: [
      person({ id: "me", name: "Ana", profileName: "Administrador", role: "admin", isSelf: true }),
      person({ id: "a", name: "Filha", email: "filha@exemplo.test", phonePending: "5511912345678" }),
      person({ id: "b", name: "Dona Zélia", profileName: "Cuidadora", role: "caregiver", accessState: "invited", email: "", invite: { kind: "whatsapp", expiresLabel: "20/10/2026 às 10:00", expired: false } }),
      person({ id: "c", name: "Sr. Pedro", accessState: "invited", invite: { kind: "email", expiresLabel: "20/10/2026 às 10:00", expired: true } }),
      person({ id: "d", name: "Antiga", active: false }),
    ],
    medications: [],
    doses: [],
    prescriptions: [],
    history: [],
    interactions: [],
    stockMovements: [],
    alertCount: 0,
    account: { email: "ana@exemplo.test", name: "Ana", phonePending: "", phoneVerified: "" },
    ...over,
  };
}

function fakePg(snap: Snapshot, over: Partial<DataSource["actions"]> = {}): DataSource & { actions: DataSource["actions"] } {
  const mock = createMockDataSource();
  return {
    kind: "postgres",
    getSnapshot: () => snap,
    previewStockDays: () => 0,
    subscribe: () => () => {},
    actions: { ...mock.actions, ...over },
  } as DataSource;
}

const shell = (path: string, ui: React.ReactElement) => {
  nav.pathname = path;
  return <AppShell>{ui}</AppShell>;
};

describe("Lote 1 — telas de entrada", () => {
  it("login, criar conta, senha e convite são acessíveis e têm rótulos", async () => {
    const forms: Array<[string, React.ReactElement]> = [
      ["Entrar", <SignInForm key="1" />],
      ["Criar conta", <SignUpForm key="2" />],
      ["Esqueci", <ForgotPasswordForm key="3" />],
      ["Nova senha", <ResetPasswordForm key="4" userId="u" secret="s" />],
      ["Primeira entrada", <CreateFamilyForm key="5" defaultName="Família Souza" />],
      ["Confirmar", <ConfirmEmailForm key="6" userId="u" secret="s" />],
      ["Verificar", <VerifyPending key="7" email="ana@exemplo.test" />],
      ["Convite", <AcceptInviteForm key="8" token="t" userId="u" secret="s" name="Filha" familyName="Família Souza" profileName="Familiar" />],
    ];
    for (const [title, ui] of forms) {
      const { container, unmount } = renderApp(<AuthFrame title={title}>{ui}</AuthFrame>);
      expect(await axe(container), title).toHaveNoViolations();
      unmount();
    }
  });

  it("login pede e-mail e senha, e a senha tem 'Mostrar a senha'", async () => {
    renderApp(<SignInForm />);
    expect(screen.getByLabelText("E-mail")).toBeRequired();
    const senha = screen.getByLabelText("Senha");
    expect(senha).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByLabelText("Mostrar a senha"));
    expect(senha).toHaveAttribute("type", "text");
    expect(screen.getByRole("link", { name: "Esqueci minha senha" })).toHaveAttribute("href", "/esqueci-senha");
  });

  it("criar conta tem senha com no mínimo 8 caracteres e confirmação", () => {
    renderApp(<SignUpForm />);
    expect(screen.getByLabelText("Senha")).toHaveAttribute("minlength", "8");
    expect(screen.getByLabelText("Repita a senha")).toBeRequired();
  });

  it("convite com link do e-mail vencido (sem token do Appwrite) só oferece pedir novo e-mail", () => {
    renderApp(<AcceptInviteForm token="t" userId="" secret="" name="Filha" familyName="Família Souza" profileName="Familiar" />);
    expect(screen.queryByRole("button", { name: "Criar senha e entrar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar um novo e-mail" })).toBeInTheDocument();
  });
});

describe("Lote 1 — portal logado (origem Postgres)", () => {
  it("Início sem remédios mostra os primeiros passos e diz o que vem nos próximos lotes", async () => {
    const { container } = renderApp(shell("/", <Lote1Home />), { source: fakePg(lote1Snapshot()) });
    expect(screen.getByRole("heading", { name: "Primeiros passos" })).toBeInTheDocument();
    expect(screen.getByText(/O WhatsApp chega no Lote 4/)).toBeInTheDocument();
    expect(screen.getByText(/1\. Família criada/)).toBeInTheDocument();
    expect(screen.getByText(/4\. Cadastrar os remédios/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Pacientes lista os pacientes e vazio vira convite para cadastrar", async () => {
    const { container, unmount } = renderApp(shell("/pacientes", <PatientsScreen />), { source: fakePg(lote1Snapshot()) });
    expect(screen.getByText(/Adelino Souza, 84 anos/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Maria" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    unmount();
    renderApp(shell("/pacientes", <PatientsScreen />), { source: fakePg(lote1Snapshot({ patients: [] })) });
    expect(screen.getByText("Nenhum paciente cadastrado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cadastrar paciente" })).toHaveAttribute("href", "/configuracoes/pacientes");
  });

  it("Receitas/Histórico/Estoque mostram 'chega no próximo lote', sem erro", async () => {
    const { container } = renderApp(<ComingSoon icon="history" title="O histórico chega no Lote 2" lot="Lote 2" what="Aqui vão aparecer as doses." />);
    expect(screen.getByText(/Esta parte chega no Lote 2/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Estoque sem remédios orienta a cadastrar; Avisos mostram o limite padrão", async () => {
    const { unmount } = renderApp(shell("/configuracoes/estoque", <SettingsScreen section="estoque" />), { source: fakePg(lote1Snapshot()) });
    expect(screen.getByText("Nenhum remédio cadastrado")).toBeInTheDocument();
    unmount();
    renderApp(shell("/configuracoes/avisos", <SettingsScreen section="avisos" />), { source: fakePg(lote1Snapshot()) });
    expect(screen.getByText("Estoque baixo", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByText(/chegam no Lote 4/)).toBeInTheDocument();
  });

  it("Minha conta (Lote 4A): número pendente, nunca 'verificado'; código de 6 dígitos só aparece ao gerar; número inválido é recusado", async () => {
    const snap = lote1Snapshot({ account: { email: "ana@exemplo.test", name: "Ana", phonePending: "5511912345678", phoneVerified: "" } });
    const { container } = renderApp(shell("/conta", <AccountScreen />), { source: fakePg(snap) });
    expect(await screen.findByText("Pendente de validação")).toBeInTheDocument();
    expect(screen.queryByText("Verificado")).not.toBeInTheDocument();
    expect(screen.queryByText("482913")).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    const campo = screen.getByLabelText("Celular com DDD");
    await userEvent.type(campo, "12");
    await userEvent.click(screen.getByRole("button", { name: "Gerar novo código" }));
    expect(screen.getByText(/Confira o número com DDD/)).toBeInTheDocument();
    expect(waMock.iniciarVerificacaoAction).not.toHaveBeenCalled();
    await userEvent.clear(campo);
    await userEvent.type(campo, "(11) 97777-6666");
    await userEvent.click(screen.getByRole("button", { name: "Gerar novo código" }));
    await waitFor(() => expect(waMock.iniciarVerificacaoAction).toHaveBeenCalledWith("(11) 97777-6666"));
    expect(await screen.findByText("482913")).toBeInTheDocument();
    expect(screen.getByText(/pelo WhatsApp do número/)).toBeInTheDocument();
  });
});

describe("Lote 1 — perfis na interface", () => {
  it("Confirmador não vê Configurações no menu nem seções de administração", () => {
    const snap = lote1Snapshot({
      member: { id: "c", name: "Filha", profileName: "Confirmador", permissions: { "dashboard.view": true, "patients.view": true, "doses.confirm": true } },
      people: [],
      permissionRows: [],
    });
    renderApp(shell("/configuracoes", <SettingsScreen />), { source: fakePg(snap) });
    expect(screen.queryByRole("link", { name: /Configurações/ })).not.toBeInTheDocument();
    expect(screen.getByText("Seu perfil não tem ajustes liberados.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Convidar pessoa" })).not.toBeInTheDocument();
  });

  it("Administrador vê Pacientes, Pessoas e Perfis em Configurações", () => {
    renderApp(shell("/configuracoes", <SettingsScreen />), { source: fakePg(lote1Snapshot()) });
    const nav = screen.getByRole("navigation", { name: "Opções de Configurações" });
    for (const nome of ["Pacientes", "Pessoas", "Perfis", "Remédios", "Esquemas"]) expect(within(nav).getByText(nome)).toBeInTheDocument();
  });
});

describe("Lote 1 — Pessoas (convites e estados)", () => {
  const open = (actions: Partial<DataSource["actions"]> = {}) => renderApp(shell("/configuracoes/pessoas", <SettingsScreen section="pessoas" />), { source: fakePg(lote1Snapshot(), actions) });

  it("mostra os estados com texto e ícone (não só cor): ativo, convite pendente/vencido, desativado e WhatsApp pendente", async () => {
    const { container } = open();
    const lista = screen.getByRole("region", { name: "Pessoas" });
    expect(within(lista).getAllByText("Ativo(a)").length).toBeGreaterThan(0);
    expect(within(lista).getByText("Convite vencido")).toBeInTheDocument();
    expect(within(lista).getByText("Convite pendente")).toBeInTheDocument();
    expect(within(lista).getByText("Desativado(a)")).toBeInTheDocument();
    expect(within(lista).getByText("WhatsApp pendente")).toBeInTheDocument();
    expect(within(lista).getByText(/Convite por WhatsApp · vale até 20\/10\/2026 às 10:00/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("não oferece 'Desativar' para si mesmo, mas oferece para os outros", () => {
    open();
    expect(screen.queryByRole("button", { name: "Desativar Ana" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desativar Filha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reativar Antiga" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gerar novo código para Dona Zélia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reenviar convite a Sr. Pedro" })).toBeInTheDocument();
  });

  it("convite por WhatsApp: código aparece uma vez, com a instrução de envio ao sistema, e some ao fechar", async () => {
    const result: InviteResult = { kind: "whatsapp", memberName: "Seu Zé", code: "482913", expectedPhone: "5511988887777", expiresLabel: "20/10/2026 às 11:00" };
    const inviteMember = vi.fn(async () => result);
    open({ inviteMember });
    await userEvent.click(screen.getByRole("button", { name: "Convidar pessoa" }));
    const dlg = screen.getByRole("dialog", { name: "Convidar pessoa" });
    expect(await axe(dlg)).toHaveNoViolations();
    await userEvent.click(within(dlg).getByLabelText(/Por código de WhatsApp/));
    await userEvent.type(within(dlg).getByLabelText("Nome"), "Seu Zé");
    await userEvent.type(within(dlg).getByLabelText(/Celular com DDD/), "(11) 98888-7777");
    await userEvent.click(within(dlg).getByRole("button", { name: "Gerar código" }));
    await waitFor(() => expect(inviteMember).toHaveBeenCalledWith(expect.objectContaining({ kind: "whatsapp", name: "Seu Zé", phone: "(11) 98888-7777" })));
    const res = await screen.findByRole("dialog", { name: "Código para Seu Zé" });
    expect(within(res).getByText("482913")).toBeInTheDocument();
    expect(within(res).getByText(/aparece só uma vez/)).toBeInTheDocument();
    expect(within(res).getByText(/envia este código ao WhatsApp do sistema/)).toBeInTheDocument();
    expect(within(res).getByText("(••) •••••-7777")).toBeInTheDocument(); // número mascarado
    expect(await axe(res)).toHaveNoViolations();
    await userEvent.click(within(res).getByRole("button", { name: "Entendi" }));
    expect(screen.queryByText("482913")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("482913");
  });

  it("convite por e-mail pede e valida o e-mail e avisa quando o e-mail não saiu", async () => {
    const inviteMember = vi.fn(async (): Promise<InviteResult> => ({ kind: "email", memberName: "Beto", emailSent: false, expiresLabel: "20/10/2026 às 11:00" }));
    open({ inviteMember });
    await userEvent.click(screen.getByRole("button", { name: "Convidar pessoa" }));
    const dlg = screen.getByRole("dialog", { name: "Convidar pessoa" });
    await userEvent.type(within(dlg).getByLabelText("Nome"), "Beto");
    await userEvent.type(within(dlg).getByLabelText("E-mail"), "beto-sem-arroba");
    await userEvent.click(within(dlg).getByRole("button", { name: "Convidar" }));
    expect(within(dlg).getByText(/Confira o e-mail/)).toBeInTheDocument();
    expect(inviteMember).not.toHaveBeenCalled();
    await userEvent.clear(within(dlg).getByLabelText("E-mail"));
    await userEvent.type(within(dlg).getByLabelText("E-mail"), "beto@exemplo.test");
    await userEvent.click(within(dlg).getByRole("button", { name: "Convidar" }));
    await waitFor(() => expect(inviteMember).toHaveBeenCalledWith(expect.objectContaining({ kind: "email", email: "beto@exemplo.test", profileName: "Familiar" })));
    const res = await screen.findByRole("dialog", { name: "Convite criado, e-mail não enviado" });
    expect(within(res).getByText(/Reenviar/)).toBeInTheDocument();
  });

  it("desativar pede confirmação e explica que derruba as sessões", async () => {
    const removeMember = vi.fn(async () => undefined);
    open({ removeMember });
    await userEvent.click(screen.getByRole("button", { name: "Desativar Filha" }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText(/sessões abertas são encerradas/)).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "Desativar pessoa" }));
    await waitFor(() => expect(removeMember).toHaveBeenCalledWith("a"));
  });
});

describe("Lote 1 — Pacientes, Remédios e Esquemas (cadastros)", () => {
  it("paciente: valida nome e data, converte dd/mm/aaaa para ISO e liga a conta do portal", async () => {
    const savePatient = vi.fn(async (_i: PatientInput) => "novo");
    const snap = lote1Snapshot();
    renderApp(shell("/configuracoes/pacientes", <SettingsScreen section="pacientes" />), { source: fakePg(snap, { savePatient }) });
    await userEvent.click(screen.getByRole("button", { name: "Cadastrar paciente" }));
    const dlg = screen.getByRole("dialog", { name: "Cadastrar paciente" });
    expect(await axe(dlg)).toHaveNoViolations();
    await userEvent.click(within(dlg).getByRole("button", { name: "Salvar" }));
    expect(within(dlg).getByText("Informe o nome do paciente.")).toBeInTheDocument();
    await userEvent.type(within(dlg).getByLabelText("Nome completo"), "Seu Ademar");
    await userEvent.type(within(dlg).getByLabelText(/Data de nascimento/), "31/02/1940");
    await userEvent.click(within(dlg).getByRole("button", { name: "Salvar" }));
    expect(within(dlg).getByText(/Use a data no formato dd\/mm\/aaaa/)).toBeInTheDocument();
    await userEvent.clear(within(dlg).getByLabelText(/Data de nascimento/));
    await userEvent.type(within(dlg).getByLabelText(/Data de nascimento/), "05/11/1940");
    await userEvent.selectOptions(within(dlg).getByLabelText(/Tem conta no portal/), "a");
    await userEvent.click(within(dlg).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(savePatient).toHaveBeenCalledTimes(1));
    expect(savePatient.mock.calls[0]![0]).toMatchObject({ name: "Seu Ademar", birthDate: "1940-11-05", usesPhone: true, selfMemberId: "a" });
  });

  it("remédio: sem paciente, orienta a cadastrar um; com paciente, pede unidade e gotas por ml", async () => {
    const { unmount } = renderApp(shell("/configuracoes/remedios", <SettingsScreen section="remedios" />), { source: fakePg(lote1Snapshot({ patients: [] })) });
    expect(screen.getByText("Cadastre um paciente primeiro")).toBeInTheDocument();
    unmount();

    const createMedication = vi.fn(async () => "m1");
    renderApp(shell("/configuracoes/remedios", <SettingsScreen section="remedios" />), { source: fakePg(lote1Snapshot(), { createMedication }) });
    await userEvent.click(screen.getByRole("button", { name: "Novo remédio" }));
    const dlg = screen.getByRole("dialog", { name: "Novo remédio" });
    await userEvent.click(within(dlg).getByRole("button", { name: "Cadastrar" }));
    expect(within(dlg).getByText("Dê um nome ao remédio.")).toBeInTheDocument();
    await userEvent.type(within(dlg).getByLabelText("Nome do remédio"), "Zypred");
    await userEvent.type(within(dlg).getByLabelText(/Marcas alternativas/), "Facoba, Vigadexa, Facoba");
    await userEvent.selectOptions(within(dlg).getByLabelText("Tipo de uso"), "Pingar");
    await userEvent.selectOptions(within(dlg).getByLabelText("Unidade de controle"), "Gotas");
    expect(within(dlg).getByLabelText("Gotas por ml")).toHaveValue("20");
    expect(within(dlg).getByText(/estoque de colírio é sempre uma estimativa/)).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "Cadastrar" }));
    await waitFor(() => expect(createMedication).toHaveBeenCalledWith({ patientId: "p1", name: "Zypred", alternatives: ["Facoba", "Vigadexa"], routeLabel: "Pingar", unitLabel: "Gotas", dropsPerMl: 20, requiresPrescription: true }));
  });

  it("esquema: duas fases (3 em 3 h por 15 dias, depois 6 em 6 h) viram fases sem lacuna", async () => {
    const saveScheme = vi.fn(async () => undefined);
    const med = createMockDataSource().getSnapshot().medications[0]!;
    const snap = lote1Snapshot({
      medications: [{ ...med, id: "m1", patientId: "p2", name: "Zypred", unitLabel: "Gotas", phases: [{ order: 1, everyHours: 24, fromDay: 1, toDay: null, perDose: 1 }], firstTime: "06:00", startDate: "2026-10-01", treatmentDay: null }],
    });
    const { container } = renderApp(shell("/configuracoes/esquemas", <SettingsScreen section="esquemas" />), { source: fakePg(snap, { saveScheme }) });
    const form = screen.getByRole("form", { name: "Esquema de Zypred" });
    await userEvent.click(within(form).getByRole("switch", { name: /Fase única/ }));
    await userEvent.click(within(form).getByRole("button", { name: "Adicionar fase" }));
    const menos = () => within(form).getByRole("button", { name: "Diminuir horas entre as doses" });
    for (let i = 0; i < 3; i++) await userEvent.click(menos()); // fase 2: 24 -> 6
    await userEvent.click(within(form).getByRole("button", { name: "Fase 1" }));
    for (let i = 0; i < 5; i++) await userEvent.click(menos()); // fase 1: 24 -> 3
    expect(within(form).getByLabelText("Quantos dias dura esta fase")).toHaveValue("7"); // a fase que era a última ganha 7 dias de sugestão
    await userEvent.clear(within(form).getByLabelText("Quantos dias dura esta fase"));
    await userEvent.type(within(form).getByLabelText("Quantos dias dura esta fase"), "15");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(form).getByRole("button", { name: "Salvar esquema" }));
    await waitFor(() => expect(saveScheme).toHaveBeenCalledTimes(1));
    const [id, input] = saveScheme.mock.calls[0]! as unknown as [string, { single: boolean; firstTime: string; startDate: string; phases: Array<Record<string, unknown>> }];
    expect(id).toBe("m1");
    expect(input).toMatchObject({ single: false, firstTime: "06:00", startDate: "2026-10-01" });
    expect(input.phases).toEqual([
      { order: 1, everyHours: 3, fromDay: 1, toDay: 15, perDose: 1 },
      { order: 2, everyHours: 6, fromDay: 16, toDay: null, perDose: 1 },
    ]);
  });

  it("esquema: duração inválida não salva e mostra o motivo", async () => {
    const saveScheme = vi.fn(async () => undefined);
    const med = createMockDataSource().getSnapshot().medications[0]!;
    const snap = lote1Snapshot({ medications: [{ ...med, id: "m1", patientId: "p2", name: "Zypred", phases: [{ order: 1, everyHours: 8, fromDay: 1, toDay: null, perDose: 1 }, { order: 2, everyHours: 12, fromDay: 8, toDay: null, perDose: 1 }] }] });
    renderApp(shell("/configuracoes/esquemas", <SettingsScreen section="esquemas" />), { source: fakePg(snap, { saveScheme }) });
    const form = screen.getByRole("form", { name: "Esquema de Zypred" });
    await userEvent.click(within(form).getByRole("button", { name: "Fase 1" }));
    await userEvent.clear(within(form).getByLabelText("Quantos dias dura esta fase"));
    await userEvent.click(within(form).getByRole("button", { name: "Salvar esquema" }));
    expect(within(form).getByRole("alert")).toHaveTextContent(/Fase 1: informe quantos dias ela dura/);
    expect(saveScheme).not.toHaveBeenCalled();
  });
});

describe("Lote 3 — Configurações em árvore", () => {
  const principal = () => screen.getAllByRole("navigation", { name: "Principal" })[0]!;

  it("dentro de uma opção a árvore já vem aberta, o item atual é destacado e a trilha e o título dizem onde está", async () => {
    const { container } = renderApp(shell("/configuracoes/remedios", <SettingsScreen section="remedios" />), { source: fakePg(lote1Snapshot()) });
    const menu = within(principal());
    expect(menu.getByRole("button", { name: "Recolher as opções de Configurações" })).toHaveAttribute("aria-expanded", "true");
    expect(menu.getByRole("link", { name: "Remédios" })).toHaveAttribute("aria-current", "page");
    expect(menu.getByRole("link", { name: "Esquemas" })).not.toHaveAttribute("aria-current");
    expect(menu.getByRole("link", { name: "Configurações" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("heading", { level: 1, name: "Remédios" })).toBeInTheDocument();
    const trilha = screen.getByRole("navigation", { name: "Trilha de navegação" });
    expect(within(trilha).getByRole("link", { name: "Configurações" })).toHaveAttribute("href", "/configuracoes");
    expect(within(trilha).getByText("Remédios")).toHaveAttribute("aria-current", "page");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("o botão recolhe e abre a árvore (aria-expanded), e fora de Configurações ela começa recolhida", async () => {
    renderApp(shell("/pacientes", <PatientsScreen />), { source: fakePg(lote1Snapshot()) });
    const menu = within(principal());
    const abrir = menu.getByRole("button", { name: "Mostrar as opções de Configurações" });
    expect(abrir).toHaveAttribute("aria-expanded", "false");
    expect(abrir).toHaveAttribute("aria-controls", "menu-configuracoes");
    expect(document.getElementById("menu-configuracoes")).toHaveClass("hidden");
    await userEvent.click(abrir);
    expect(menu.getByRole("button", { name: "Recolher as opções de Configurações" })).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("menu-configuracoes")).not.toHaveClass("hidden");
  });

  it("o índice (celular) lista só o que o perfil pode, com descrição; opção sem permissão não aparece nem na árvore", () => {
    const snap = lote1Snapshot({
      member: { id: "f", name: "Filha", profileName: "Familiar", permissions: { "dashboard.view": true, "patients.view": true, "stock.view": true, "stock.adjust": true } },
    });
    renderApp(shell("/configuracoes", <SettingsScreen />), { source: fakePg(snap) });
    const lista = screen.getByRole("navigation", { name: "Opções de Configurações" });
    expect(within(lista).getAllByRole("link").map((l) => l.textContent)).toEqual([expect.stringContaining("Estoque")]);
    expect(within(lista).getByText("Compras, ajustes e movimentações")).toBeInTheDocument();
    expect(within(principal()).queryByRole("link", { name: "Perfis" })).not.toBeInTheDocument();
  });

  it("opção sem permissão (endereço digitado) mostra aviso e o caminho de volta; opção que não existe também", () => {
    const snap = lote1Snapshot({ member: { id: "f", name: "Filha", profileName: "Familiar", permissions: { "dashboard.view": true, "stock.view": true } } });
    const { unmount } = renderApp(shell("/configuracoes/perfis", <SettingsScreen section="perfis" />), { source: fakePg(snap) });
    expect(screen.getByText("Esta área não está liberada para o seu perfil")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar para Configurações" })).toHaveAttribute("href", "/configuracoes");
    expect(screen.queryByRole("heading", { level: 1, name: "Perfis" })).not.toBeInTheDocument();
    unmount();
    renderApp(shell("/configuracoes/nada", <SettingsScreen section="nada" />), { source: fakePg(lote1Snapshot()) });
    expect(screen.getByText("Esta opção não existe")).toBeInTheDocument();
  });
});
