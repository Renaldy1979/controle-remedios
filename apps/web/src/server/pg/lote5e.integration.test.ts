// @vitest-environment node
/**
 * Lote 5E-A (docs/15): uma conta em várias famílias. Família ativa, isolamento, convite para conta existente, desativar,
 * excluir família e o ajuste único. Appwrite e cookies são simulados. Sem o banco no ar a suíte é PULADA (REQUIRE_DB=1 falha).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ativarMembroPorEmail, dadosExternosDaFamilia, listarVinculosDaConta, resolverLinkPrimeiroAcesso, sha256, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { bancoDisponivel, conectarAdmin, encerrar, limparFamilias, limparFamiliasAntigasDeTeste, prepararBanco, type Admin } from "@medcuidar/pg-testing";
import { SYSTEM_PROFILES, can, type PermissionMap } from "@medcuidar/shared";
import { familyChangeDetector, readFamilyMarker } from "@/lib/family-tab";
import { PRIVACY_VERSION } from "@/lib/privacy";
import { FAMILY_TAB_COOKIE } from "../cookies";
import { unblockAccountsOnce } from "../ops/unblock-accounts";
import type { AuthAccount } from "../auth/appwrite";
import { createFamilyWithAdmin } from "./families";
import { escolherVinculo } from "./family-choice";
import { isExistingAccount, linkMemberToAccount } from "./link-account";
import type { Actor } from "./guard";
import * as members from "./members";
import { getAccess } from "./access";

const session = vi.hoisted(() => ({ account: null as unknown, preferred: null as string | null }));
vi.mock("../auth/session", () => ({ currentAccount: async () => session.account }));
vi.mock("./family-cookie", () => ({ preferredFamily: async () => session.preferred }));

const up = await bancoDisponivel();
if (!up) console.warn("[web] Postgres local indisponível: testes do Lote 5E PULADOS. Rode `pnpm db:up`.");

const TZ = "America/Sao_Paulo";
const permsOf = (name: string): PermissionMap => SYSTEM_PROFILES.find((p) => p.name === name)!.permissions;
const newEmail = (tag: string) => `zz-test-5e-${tag}-${randomUUID().slice(0, 8)}@exemplo.test`.toLowerCase();
const newAccount = (tag: string): AuthAccount => ({ id: `zz-test-${randomUUID()}`, email: newEmail(tag), name: `Pessoa ${tag}`, emailVerified: true });

describe("Lote 5E — regras puras", () => {
  const v = (familiaId: string) => ({ membroId: "m", familiaId, ativo: true, estadoAcesso: "active" as const, familiaNome: familiaId, perfilNome: "Familiar", criadoEm: new Date() });

  it("com um vínculo ignora a preferência; com vários só aceita preferência que esteja na lista", () => {
    expect(escolherVinculo([v("a")], "outra")?.familiaId).toBe("a");
    expect(escolherVinculo([v("a"), v("b")], "b")?.familiaId).toBe("b");
    expect(escolherVinculo([v("a"), v("b")], "forjada")).toBeNull();
    expect(escolherVinculo([v("a"), v("b")], null)).toBeNull();
    expect(escolherVinculo([], "a")).toBeNull();
  });

  it("aba antiga percebe a troca de família e não entra em laço", () => {
    let cookie = "";
    const read = () => readFamilyMarker(cookie);
    const semMarca = familyChangeDetector(read);
    expect(semMarca()).toBe(false);
    cookie = `x=1; ${FAMILY_TAB_COOKIE}=fam-b`;
    expect(semMarca()).toBe(true); // outra aba escolheu
    expect(familyChangeDetector(read)()).toBe(false); // depois de recarregar, o valor atual é o de partida
  });
});

describe.skipIf(!up)("Lote 5E — uma conta em várias famílias", () => {
  let admin: Admin;
  const criadas: string[] = [];

  interface Fam {
    familyId: string;
    adm: Actor;
    owner: AuthAccount;
  }

  async function family(tag: string, owner: AuthAccount = newAccount(`dono-${tag}`)): Promise<Fam> {
    const r = await createFamilyWithAdmin({ appwriteUserId: owner.id, name: owner.name, email: owner.email, familyName: `Família 5E ${tag} ${randomUUID().slice(0, 4)}` });
    criadas.push(r.familyId);
    return { familyId: r.familyId, owner, adm: { familyId: r.familyId, memberId: r.memberId, timezone: TZ, member: { id: r.memberId, name: owner.name, profileName: "Administrador", permissions: permsOf("Administrador") } } };
  }

  /** Convite por e-mail de verdade: devolve o token que iria no link. */
  async function invite(f: Fam, email: string, profileName = "Cuidadora") {
    let url = "";
    const out = await members.inviteByEmail(f.adm, { kind: "email", name: "Convidada", email, profileName }, { auth: { sendInviteEmail: async (_e: string, u: string) => { url = u; } }, baseUrl: "https://x.test" });
    const token = new URL(url).searchParams.get("t")!;
    return { memberId: out.memberId, token };
  }

  const accept = async (f: Fam, token: string, memberId: string, account: AuthAccount) =>
    linkMemberToAccount({ familyId: f.familyId, memberId, tokenHash: sha256(token), from: "invited" }, account);

  const acceptPrivacyOf = (accountId: string) => admin`update members set privacy_version = ${PRIVACY_VERSION}, privacy_accepted_at = now() where appwrite_user_id = ${accountId}`;

  /** Uma pessoa cuidadora em A e administradora da própria família B. */
  async function caregiverWithOwnFamily() {
    const a = await family("A");
    const person = newAccount("cuidadora");
    const inv = await invite(a, person.email);
    expect(await accept(a, inv.token, inv.memberId, person)).toBe("ok");
    const b = await family("B", person);
    await acceptPrivacyOf(person.id);
    return { a, b, person, memberInA: inv.memberId };
  }

  beforeAll(async () => {
    admin = conectarAdmin();
    await prepararBanco();
    await limparFamiliasAntigasDeTeste(admin);
  });
  afterAll(async () => {
    await admin`delete from whatsapp_runtime where key = 'contas_5e'`;
    await admin.unsafe("delete from audit_log where family_id = any($1::uuid[])", [criadas]);
    await limparFamilias(admin, criadas);
    await encerrar(admin);
  });

  it("a mesma conta é cuidadora numa família e administradora na dela; cada uma com o seu perfil", async () => {
    const { a, b, person } = await caregiverWithOwnFamily();
    const list = await listarVinculosDaConta(person.id);
    expect(list.map((x) => [x.familiaId, x.perfilNome]).sort()).toEqual([[a.familyId, "Cuidadora"], [b.familyId, "Administrador"]].sort());

    session.account = person;
    session.preferred = a.familyId;
    const inA = await getAccess();
    expect(inA.status).toBe("ok");
    if (inA.status !== "ok") return;
    expect(inA.ctx).toMatchObject({ familyId: a.familyId, familyCount: 2, member: { profileName: "Cuidadora" } });
    // ser administradora em B não dá nada em A
    expect(can(inA.ctx.member, "members.manage")).toBe(false);

    session.preferred = b.familyId;
    const inB = await getAccess();
    expect(inB.status === "ok" && inB.ctx.member.profileName).toBe("Administrador");
  });

  it("sem escolha, ou com cookie forjado para uma terceira família, pede a escolha e não abre nada", async () => {
    const { person } = await caregiverWithOwnFamily();
    const other = await family("Terceira");
    session.account = person;
    for (const preferred of [null, other.familyId, "lixo"]) {
      session.preferred = preferred;
      const r = await getAccess();
      expect(r.status).toBe("choose");
      if (r.status === "choose") expect(r.families.map((x) => x.familiaId)).not.toContain(other.familyId);
    }
  });

  it("aceitar o convite com conta existente não cria outra conta e só vale uma vez", async () => {
    const a = await family("Convite");
    const person = newAccount("existente");
    await family("Propria", person);
    expect(await isExistingAccount({ id: person.id, emailVerified: false })).toBe(true); // tem vínculo
    expect(await isExistingAccount({ id: "zz-test-nova", emailVerified: false })).toBe(false);
    expect(await isExistingAccount({ id: "zz-test-nova", emailVerified: true })).toBe(true);
    const inv = await invite(a, person.email);
    expect(await accept(a, inv.token, inv.memberId, person)).toBe("ok");
    const [m] = await admin`select access_state, appwrite_user_id from members where id = ${inv.memberId}`;
    expect(m).toMatchObject({ access_state: "active", appwrite_user_id: person.id });
    expect(await resolverLinkPrimeiroAcesso(sha256(inv.token))).toBeNull();
    expect(await accept(a, inv.token, inv.memberId, newAccount("atrasado"))).toBe("invalid");
  });

  it("recusa quem já participa da família e e-mail de outra pessoa, sem gastar o link", async () => {
    const a = await family("Recusa");
    const inv = await invite(a, newEmail("alvo"));
    expect(await accept(a, inv.token, inv.memberId, a.owner)).toBe("already_member");
    const clash: AuthAccount = { ...newAccount("clash"), email: a.owner.email };
    expect(await accept(a, inv.token, inv.memberId, clash)).toBe("email_taken");
    expect(await resolverLinkPrimeiroAcesso(sha256(inv.token))).not.toBeNull();
  });

  it("conta com vínculo NÃO é ligada sozinha a um acesso pendente só porque o e-mail bate", async () => {
    const { person } = await caregiverWithOwnFamily();
    const c = await family("Pendente");
    const pending = await withFamilia(c.familyId, async (tx) => {
      const [p] = await tx.select().from(s.profiles).where(eq(s.profiles.name, "Familiar"));
      const [m] = await tx.insert(s.members).values({ familyId: c.familyId, profileId: p!.id, name: "Pendente", email: person.email, accessState: "whatsapp_verified", phoneVerified: `5599${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}` }).returning({ id: s.members.id });
      return m!.id;
    });
    expect(await ativarMembroPorEmail(person.email, person.id)).toBeNull();
    const [m] = await admin`select appwrite_user_id from members where id = ${pending}`;
    expect(m!["appwrite_user_id"]).toBeNull();
  });

  it("desativar numa família não tira o acesso às outras; sem nenhuma, fica desativada", async () => {
    const { a, b, person, memberInA } = await caregiverWithOwnFamily();
    await members.deactivateMember(a.adm, memberInA);
    session.account = person;
    session.preferred = a.familyId; // preferência antiga aponta para a que ela perdeu
    const r = await getAccess();
    expect(r.status === "ok" && r.ctx.familyId).toBe(b.familyId);
    expect(r.status === "ok" && r.ctx.familyCount).toBe(1);
    await admin`update members set active = false, removed_at = now() where appwrite_user_id = ${person.id}`;
    expect((await getAccess()).status).toBe("inactive");
  });

  it("excluir uma família só apaga o login de quem não participa de outra", async () => {
    const { a, person } = await caregiverWithOwnFamily();
    const external = await dadosExternosDaFamilia(a.familyId);
    expect(external.usuariosAppwrite).toEqual([a.owner.id]);
    expect(external.usuariosAppwrite).not.toContain(person.id);
  });

  it("a conta cria várias famílias; o clique duplo cria uma só", async () => {
    const owner = newAccount("varias");
    const name = `Família Dupla ${randomUUID().slice(0, 6)}`;
    const input = { appwriteUserId: owner.id, name: owner.name, email: owner.email, familyName: name };
    const [x, y] = await Promise.all([createFamilyWithAdmin(input), createFamilyWithAdmin(input)]);
    criadas.push(x.familyId, y.familyId);
    expect(y).toEqual(x);
    const other = await createFamilyWithAdmin({ ...input, familyName: `${name} 2` });
    criadas.push(other.familyId);
    expect(other.familyId).not.toBe(x.familyId);
    expect(await listarVinculosDaConta(owner.id)).toHaveLength(2);
  });

  it("ajuste único: libera as contas de vínculos desativados, repete se falhar e depois não roda mais", async () => {
    const { a, person, memberInA } = await caregiverWithOwnFamily();
    await members.deactivateMember(a.adm, memberInA);
    await admin`delete from whatsapp_runtime where key = 'contas_5e'`;
    const failing = await unblockAccountsOnce(async () => { throw new Error("fora do ar"); });
    expect(failing.done).toBe(false);
    const released: string[] = [];
    expect((await unblockAccountsOnce(async (id) => { released.push(id); })).done).toBe(true);
    expect(released).toContain(person.id);
    const again: string[] = [];
    await unblockAccountsOnce(async (id) => { again.push(id); });
    expect(again).toEqual([]);
  });
});
