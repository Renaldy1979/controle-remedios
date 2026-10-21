/**
 * Integração contra o Postgres local (pnpm db:up). Sem o banco no ar, a suíte é PULADA com uma mensagem clara.
 * Tudo roda com o papel da APLICAÇÃO (medcuidar_app); o papel dono só prepara e confere dados.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "./client";
import { withFamilia, withPlataforma } from "./withFamilia";
import {
  consumirConviteWhatsapp, consumirLinkPrimeiroAcesso, resolverApiKeyPorHash, resolverLinkPrimeiroAcesso, resolverMembroPorAppwriteUser, resolverMembroPorTelefone, verificarTelefonePendente,
} from "./sistema";
import {
  gerarApiKey, gerarTokenPrimeiroAcesso, hashCodigoVerificacao, hashConviteCodigo, sha256, VALIDADE_CONVITE_MS,
} from "./crypto";
import { FAMILY_TABLES } from "./schema";
import * as s from "./schema";
import {
  bancoDisponivel, conectarAdmin, criarFamiliaTeste, encerrar, limparFamilias, prepararBanco, telefoneAleatorio,
  type Admin, type FamiliaTeste,
} from "./testing";

const disponivel = await bancoDisponivel();
if (!disponivel) {
  console.warn("[pg] Postgres local indisponível em DATABASE_URL_ADMIN: testes de integração PULADOS. Rode `pnpm db:up`.");
}

const cod = (e: unknown) => (e as { code?: string }).code;
/** Roda `fn` e devolve o código SQLSTATE do erro (ou "ok" se não falhou). */
async function sqlstate(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    return cod(e) ?? cod((e as { cause?: unknown }).cause) ?? String(e);
  }
}

describe.skipIf(!disponivel)("Postgres + RLS (papel da aplicação)", () => {
  let admin: Admin;
  let A: FamiliaTeste;
  let B: FamiliaTeste;
  const criadas: string[] = [];

  beforeAll(async () => {
    admin = conectarAdmin();
    await prepararBanco();
    A = await criarFamiliaTeste("A");
    B = await criarFamiliaTeste("B");
    criadas.push(A.id, B.id);
  });

  afterAll(async () => {
    await limparFamilias(admin, criadas);
    await admin`delete from phone_lockouts where phone like '5599%'`;
    await encerrar(admin);
  });

  /* ------------------------------------------------------------ (a) isolamento por RLS */
  describe("isolamento entre famílias", () => {
    it("toda tabela com family_id (e families) tem RLS ligado, FORCE e política", async () => {
      const rows = await admin`
        select c.relname, c.relrowsecurity, c.relforcerowsecurity,
               (select count(*) from pg_policy p where p.polrelid = c.oid)::int as politicas
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname not like '\\_\\_drizzle%' and c.relname <> 'phone_lockouts'`;
      expect(rows.length).toBeGreaterThanOrEqual(FAMILY_TABLES.length + 1);
      for (const r of rows) {
        expect(r.relrowsecurity, `${r.relname} sem ENABLE RLS`).toBe(true);
        expect(r.relforcerowsecurity, `${r.relname} sem FORCE RLS`).toBe(true);
        expect(r.politicas, `${r.relname} sem política`).toBeGreaterThan(0);
      }
      const comFamilia = await admin`
        select table_name from information_schema.columns where table_schema = 'public' and column_name = 'family_id'`;
      for (const { table_name } of comFamilia) {
        if (table_name === "platform_audit_log") continue; // global (family_id é só informativo)
        expect(FAMILY_TABLES as readonly string[], `${table_name} fora de FAMILY_TABLES`).toContain(table_name);
      }
    });

    it("família A só enxerga as próprias linhas (query builder e SQL cru)", async () => {
      await withFamilia(A.id, async (tx) => {
        const pacientes = await tx.select().from(s.patients);
        expect(pacientes.map((p) => p.id)).toEqual([A.patientId]);
        const fams = await tx.select().from(s.families);
        expect(fams.map((f) => f.id)).toEqual([A.id]);
        const cru = await tx.execute<{ id: string }>(sql`select id from patients`);
        expect([...cru].map((r) => r.id)).toEqual([A.patientId]);
        // mesmo pedindo a linha de B de forma explícita
        const pedindoB = await tx.execute(sql`select * from patients where id = ${B.patientId} or family_id = ${B.id}`);
        expect(pedindoB.length).toBe(0);
        for (const t of FAMILY_TABLES) {
          const linhas = await tx.execute<{ family_id: string }>(sql.raw(`select family_id from ${t}`));
          for (const l of linhas) expect(l.family_id, `${t} vazou linha de outra família`).toBe(A.id);
        }
      });
    });

    it("A não atualiza nem apaga linhas de B", async () => {
      await withFamilia(A.id, async (tx) => {
        const up = await tx.update(s.patients).set({ name: "invadido" }).where(eq(s.patients.id, B.patientId)).returning();
        expect(up).toHaveLength(0);
        const upCru = await tx.execute(sql`update dose_events set status = 'taken' where id = ${B.doseId} returning id`);
        expect(upCru.length).toBe(0);
        const del = await tx.delete(s.patients).where(eq(s.patients.id, B.patientId)).returning();
        expect(del).toHaveLength(0);
        const delCru = await tx.execute(sql`delete from medications where family_id = ${B.id} returning id`);
        expect(delCru.length).toBe(0);
      });
      const [p] = await admin`select name from patients where id = ${B.patientId}`;
      expect(p?.name).toBe("Paciente B");
      const [{ n } = { n: -1 }] = await admin`select count(*)::int as n from dose_events where id = ${B.doseId} and status = 'pending'`;
      expect(n).toBe(1);
    });

    it("A não consegue mover linha própria para a família B (UPDATE com WITH CHECK)", async () => {
      const code = await sqlstate(() => withFamilia(A.id, (tx) =>
        tx.update(s.patients).set({ familyId: B.id }).where(eq(s.patients.id, A.patientId))));
      expect(code).toBe("42501");
    });

    it("inserir com family_id de outra família falha em todas as direções", async () => {
      const code = await sqlstate(() => withFamilia(A.id, (tx) =>
        tx.insert(s.patients).values({ familyId: B.id, name: "intruso" })));
      expect(code).toBe("42501");
      const codeSql = await sqlstate(() => withFamilia(A.id, (tx) =>
        tx.execute(sql`insert into medications (family_id, name, route, control_unit) values (${B.id}, 'x', 'tablet', 'unit')`)));
      expect(codeSql).toBe("42501");
      const codeFam = await sqlstate(() => withFamilia(A.id, (tx) =>
        tx.insert(s.families).values({ id: randomUUID(), name: "clone" })));
      expect(codeFam).toBe("42501");
      const [{ n } = { n: -1 }] = await admin`select count(*)::int as n from patients where name = 'intruso'`;
      expect(n).toBe(0);
    });

    it("sem app.familia_id não vê nada em nenhuma tabela, nem insere", async () => {
      const db = getDb();
      for (const t of ["families", ...FAMILY_TABLES]) {
        const r = await db.execute(sql.raw(`select 1 from ${t}`));
        expect(r.length, `${t} visível sem família`).toBe(0);
      }
      const code = await sqlstate(async () => {
        await db.insert(s.patients).values({ familyId: A.id, name: "sem contexto" });
      });
      expect(code).toBe("42501");
    });

    it("transações seguintes não herdam a família da anterior (set_config local)", async () => {
      await withFamilia(A.id, async (tx) => {
        expect((await tx.select().from(s.patients)).length).toBe(1);
      });
      const r = await getDb().execute(sql`select count(*)::int as n from patients`);
      expect(r[0]?.n).toBe(0);
      const guc = await getDb().execute<{ v: string | null }>(sql`select current_setting('app.familia_id', true) as v`);
      expect([null, ""]).toContain(guc[0]?.v ?? null);
    });

    it("tabelas da plataforma só aparecem em withPlataforma, e as de família nunca", async () => {
      const k = gerarApiKey("plataforma");
      const keyId = await withPlataforma(async (tx) => {
        const [row] = await tx.insert(s.platformApiKeys).values({ name: "teste-rls", keyHash: k.hash, scopes: ["conversa"] }).returning();
        return row!.id;
      });
      try {
        // dentro de uma família: invisível
        const emFamilia = await withFamilia(A.id, (tx) => tx.select().from(s.platformApiKeys));
        expect(emFamilia).toHaveLength(0);
        expect(await getDb().select().from(s.platformApiKeys)).toHaveLength(0);
        // escrever sem plataforma falha
        const code = await sqlstate(() => withFamilia(A.id, (tx) =>
          tx.insert(s.platformApiKeys).values({ name: "x", keyHash: sha256("x") })));
        expect(code).toBe("42501");
        // dentro da plataforma: vê a chave, mas nenhuma tabela de família
        await withPlataforma(async (tx) => {
          const chaves = await tx.select().from(s.platformApiKeys).where(eq(s.platformApiKeys.id, keyId));
          expect(chaves).toHaveLength(1);
          expect(await tx.select().from(s.patients)).toHaveLength(0);
          expect(await tx.select().from(s.members)).toHaveLength(0);
        });
      } finally {
        await admin`delete from platform_api_keys where id = ${keyId}`;
      }
    });

    it("phone_lockouts não é acessível ao papel da aplicação", async () => {
      expect(await sqlstate(() => getDb().execute(sql`select * from phone_lockouts`))).toBe("42501");
      expect(await sqlstate(() => getDb().execute(sql`insert into phone_lockouts (phone) values ('5511900009999')`))).toBe("42501");
    });
  });

  /* ------------------------------------------------------------ (b) índices únicos */
  describe("unicidade de dose e de movimento de estoque", () => {
    it("(treatment_id, scheduled_at) é único em dose_events", async () => {
      const code = await sqlstate(() => withFamilia(A.id, (tx) => tx.insert(s.doseEvents).values({
        familyId: A.id, treatmentId: A.treatmentId, patientId: A.patientId, medicationId: A.medicationId,
        scheduledAt: new Date("2026-10-19T11:00:00Z"), amount: 1,
      })));
      expect(code).toBe("23505");
      // outro horário do mesmo tratamento é permitido
      await withFamilia(A.id, (tx) => tx.insert(s.doseEvents).values({
        familyId: A.id, treatmentId: A.treatmentId, patientId: A.patientId, medicationId: A.medicationId,
        scheduledAt: new Date("2026-10-19T15:00:00Z"), amount: 1,
      }));
    });

    it("source_message_id repetido não confirma duas doses", async () => {
      const msg = `wamid.${randomUUID()}`;
      await withFamilia(A.id, (tx) => tx.update(s.doseEvents).set({ sourceMessageId: msg }).where(eq(s.doseEvents.id, A.doseId)));
      const code = await sqlstate(() => withFamilia(A.id, (tx) => tx.insert(s.doseEvents).values({
        familyId: A.id, treatmentId: A.treatmentId, patientId: A.patientId, medicationId: A.medicationId,
        scheduledAt: new Date("2026-10-20T11:00:00Z"), amount: 1, sourceMessageId: msg,
      })));
      expect(code).toBe("23505");
    });

    it("movimento de dose é único por dose_event_id; compensações (adjustment) sem dose_event_id passam", async () => {
      await withFamilia(A.id, (tx) => tx.insert(s.stockMovements).values({
        familyId: A.id, stockItemId: A.stockItemId, type: "dose", quantity: -1, doseEventId: A.doseId,
      }));
      const dup = await sqlstate(() => withFamilia(A.id, (tx) => tx.insert(s.stockMovements).values({
        familyId: A.id, stockItemId: A.stockItemId, type: "dose", quantity: -1, doseEventId: A.doseId,
      })));
      expect(dup).toBe("23505");
      await withFamilia(A.id, async (tx) => {
        await tx.insert(s.stockMovements).values({
          familyId: A.id, stockItemId: A.stockItemId, type: "adjustment", quantity: 1, note: `undo:${A.doseId}:1`,
        });
        await tx.insert(s.stockMovements).values({
          familyId: A.id, stockItemId: A.stockItemId, type: "purchase", quantity: 30,
        });
        const [saldo] = await tx.select({ saldo: sql<number>`coalesce(sum(${s.stockMovements.quantity}), 0)::float` })
          .from(s.stockMovements).where(eq(s.stockMovements.stockItemId, A.stockItemId));
        expect(saldo?.saldo).toBe(30); // -1 (dose) +1 (undo) +30 (compra): o saldo é a soma dos movimentos
      });
    });

    it("movimento do tipo dose exige dose_event_id e quantidade não nula", async () => {
      expect(await sqlstate(() => withFamilia(A.id, (tx) => tx.insert(s.stockMovements).values({
        familyId: A.id, stockItemId: A.stockItemId, type: "dose", quantity: -1,
      })))).toBe("23514");
      expect(await sqlstate(() => withFamilia(A.id, (tx) => tx.insert(s.stockMovements).values({
        familyId: A.id, stockItemId: A.stockItemId, type: "adjustment", quantity: 0,
      })))).toBe("23514");
    });

    it("dedupe_key de notificação é único por família, mas pode repetir entre famílias", async () => {
      const ins = (f: FamiliaTeste) => withFamilia(f.id, (tx) => tx.insert(s.notifications).values({
        familyId: f.id, memberId: f.memberId, kind: "low_stock", title: "Estoque baixo", dedupeKey: "low_stock:1",
      }));
      await ins(A);
      expect(await sqlstate(() => ins(A))).toBe("23505");
      await ins(B);
    });

    it("provider_message_id do WhatsApp é único (idempotência do webhook)", async () => {
      const id = `wamid.${randomUUID()}`;
      const ins = () => withFamilia(A.id, (tx) => tx.insert(s.messageLog).values({
        familyId: A.id, direction: "in", providerMessageId: id, memberId: A.memberId, bodyRedacted: "1",
      }));
      await ins();
      expect(await sqlstate(ins)).toBe("23505");
    });

    it("idempotência: (family_id, key) único", async () => {
      const ins = () => withFamilia(A.id, (tx) => tx.insert(s.idempotency).values({
        familyId: A.id, key: "msg-1", requestHash: sha256("{}"), status: 200, response: { ok: true },
      }));
      await ins();
      expect(await sqlstate(ins)).toBe("23505");
    });

    it("fase de tratamento: interval exige horas e primeira dose; fixed_times exige horários", async () => {
      const fase = (v: Partial<typeof s.treatmentPhases.$inferInsert>) => sqlstate(() => withFamilia(A.id, (tx) =>
        tx.insert(s.treatmentPhases).values({ familyId: A.id, treatmentId: A.treatmentId, order: Math.floor(Math.random() * 1e6) + 10, startDay: 1, doseAmount: 1, scheduleType: "interval", ...v })));
      expect(await fase({})).toBe("23514");
      expect(await fase({ intervalHours: 6 })).toBe("23514");
      expect(await fase({ scheduleType: "fixed_times" })).toBe("23514");
      expect(await fase({ intervalHours: 6, firstDoseTime: "06:00" })).toBe("ok");
      expect(await fase({ scheduleType: "fixed_times", times: ["08:00"] })).toBe("ok");
    });

    it("FK real: dose de tratamento inexistente falha", async () => {
      expect(await sqlstate(() => withFamilia(A.id, (tx) => tx.insert(s.doseEvents).values({
        familyId: A.id, treatmentId: randomUUID(), patientId: A.patientId, medicationId: A.medicationId,
        scheduledAt: new Date(), amount: 1,
      })))).toBe("23503");
    });
  });

  /* ------------------------------------------------------------ (c) telefone verificado */
  describe("telefone verificado único no sistema", () => {
    async function novoMembro(f: FamiliaTeste, v: Partial<typeof s.members.$inferInsert> = {}): Promise<string> {
      const id = randomUUID();
      await withFamilia(f.id, (tx) => tx.insert(s.members).values({
        id, familyId: f.id, profileId: f.profileId, name: "Pessoa", ...v,
      }));
      return id;
    }

    it("o mesmo número verificado não pode estar em dois usuários, nem em famílias diferentes", async () => {
      const tel = telefoneAleatorio();
      await novoMembro(A, { phoneVerified: tel });
      expect(await sqlstate(() => novoMembro(A, { phoneVerified: tel }))).toBe("23505");
      expect(await sqlstate(() => novoMembro(B, { phoneVerified: tel }))).toBe("23505");
    });

    it("pendente pode repetir (ninguém toma um número só por digitá-lo) e formato inválido é recusado", async () => {
      const tel = telefoneAleatorio();
      await novoMembro(A, { phonePending: tel });
      await novoMembro(B, { phonePending: tel });
      expect(await sqlstate(() => novoMembro(A, { phoneVerified: "+55 (11) 9" }))).toBe("23514");
      expect(await sqlstate(() => novoMembro(A, { phonePending: "123" }))).toBe("23514");
    });

    it("resolverMembroPorTelefone acha só número verificado, em qualquer família", async () => {
      const tel = telefoneAleatorio();
      const pend = telefoneAleatorio();
      const m = await novoMembro(B, { phoneVerified: tel });
      await novoMembro(B, { phonePending: pend });
      expect(await resolverMembroPorTelefone(tel)).toEqual({ membroId: m, familiaId: B.id, ativo: true, familiaAtiva: true, estadoAcesso: "invited" });
      expect(await resolverMembroPorTelefone(pend)).toBeNull();
      expect(await resolverMembroPorTelefone("abc")).toBeNull();
      expect(await resolverMembroPorTelefone(telefoneAleatorio())).toBeNull();
    });

    it("trocar o número (novo pendente) invalida o verificado", async () => {
      const tel = telefoneAleatorio();
      const m = await novoMembro(A, { phoneVerified: tel });
      await withFamilia(A.id, (tx) => tx.update(s.members).set({ phonePending: telefoneAleatorio() }).where(eq(s.members.id, m)));
      const [row] = await withFamilia(A.id, (tx) => tx.select().from(s.members).where(eq(s.members.id, m)));
      expect(row?.phoneVerified).toBeNull();
      expect(await resolverMembroPorTelefone(tel)).toBeNull();
    });

    it("fluxo de verificação: o remetente envia o código e o pendente vira verificado", async () => {
      const tel = telefoneAleatorio();
      const codigo = "123456";
      const m = await novoMembro(A, {
        phonePending: tel, verificationCodeHash: hashCodigoVerificacao(codigo),
        verificationExpiresAt: new Date(Date.now() + 15 * 60_000),
      });
      const errado = await verificarTelefonePendente(tel, hashCodigoVerificacao("000000"));
      expect(errado.resultado).toBe("invalido");
      const ok = await verificarTelefonePendente(tel, hashCodigoVerificacao(codigo));
      expect(ok).toEqual({ resultado: "verificado", membroId: m, familiaId: A.id });
      const [row] = await withFamilia(A.id, (tx) => tx.select().from(s.members).where(eq(s.members.id, m)));
      expect(row).toMatchObject({ phoneVerified: tel, phonePending: null, verificationCodeHash: null, verificationAttempts: 0 });
      expect((await resolverMembroPorTelefone(tel))?.membroId).toBe(m);
    });

    it("código expirado não verifica; 5 erros derrubam o código e bloqueiam o telefone", async () => {
      const exp = telefoneAleatorio();
      await novoMembro(A, {
        phonePending: exp, verificationCodeHash: hashCodigoVerificacao("111111"),
        verificationExpiresAt: new Date(Date.now() - 1000),
      });
      expect((await verificarTelefonePendente(exp, hashCodigoVerificacao("111111"))).resultado).toBe("invalido");

      const tel = telefoneAleatorio();
      const m = await novoMembro(A, {
        phonePending: tel, verificationCodeHash: hashCodigoVerificacao("222222"),
        verificationExpiresAt: new Date(Date.now() + 60_000),
      });
      for (let i = 0; i < 5; i++) {
        expect((await verificarTelefonePendente(tel, hashCodigoVerificacao("999999"))).resultado).toBe("invalido");
      }
      // bloqueado: nem o código certo passa
      expect((await verificarTelefonePendente(tel, hashCodigoVerificacao("222222"))).resultado).toBe("bloqueado");
      const [row] = await withFamilia(A.id, (tx) => tx.select().from(s.members).where(eq(s.members.id, m)));
      expect(row?.phoneVerified).toBeNull();
      expect(row?.verificationCodeHash).toBeNull();
      await admin`delete from phone_lockouts where phone = ${tel}`;
    });

    it("número já verificado em outro usuário → em_uso e nada muda", async () => {
      const tel = telefoneAleatorio();
      const dono = await novoMembro(B, { phoneVerified: tel });
      // o pendente entra por update direto (o trigger só zera o verificado do PRÓPRIO membro)
      const outro = await novoMembro(A);
      await withFamilia(A.id, (tx) => tx.update(s.members).set({
        phonePending: tel, verificationCodeHash: hashCodigoVerificacao("333333"),
        verificationExpiresAt: new Date(Date.now() + 60_000),
      }).where(eq(s.members.id, outro)));
      const r = await verificarTelefonePendente(tel, hashCodigoVerificacao("333333"));
      expect(r.resultado).toBe("em_uso");
      expect((await resolverMembroPorTelefone(tel))?.membroId).toBe(dono);
    });

    it("resolverMembroPorAppwriteUser e resolverApiKeyPorHash", async () => {
      const aw = `aw_${randomUUID()}`;
      const ativo = { accessState: "active" as const, emailConfirmedAt: new Date() };
      const m = await novoMembro(A, { appwriteUserId: aw, email: `${randomUUID()}@teste.test`, ...ativo });
      expect(await resolverMembroPorAppwriteUser(aw)).toEqual({ membroId: m, familiaId: A.id, ativo: true, estadoAcesso: "active" });
      expect(await resolverMembroPorAppwriteUser("inexistente")).toBeNull();
      expect(await sqlstate(() => novoMembro(B, { appwriteUserId: aw, email: `${randomUUID()}@teste.test`, ...ativo }))).toBe("23505");

      const kf = gerarApiKey("familia");
      const kp = gerarApiKey("plataforma");
      await withFamilia(A.id, (tx) => tx.insert(s.apiKeys).values({ familyId: A.id, name: "t", keyHash: kf.hash, scopes: ["doses"] }));
      await withPlataforma((tx) => tx.insert(s.platformApiKeys).values({ name: "t", keyHash: kp.hash, scopes: ["conversa"] }));
      try {
        expect(await resolverApiKeyPorHash(kf.hash)).toMatchObject({ tipo: "familia", familiaId: A.id, escopos: ["doses"] });
        expect(await resolverApiKeyPorHash(kp.hash)).toMatchObject({ tipo: "plataforma", familiaId: null, escopos: ["conversa"] });
        expect(await resolverApiKeyPorHash(sha256("nada"))).toBeNull();
        await withFamilia(A.id, (tx) => tx.update(s.apiKeys).set({ revokedAt: new Date() }).where(eq(s.apiKeys.keyHash, kf.hash)));
        expect(await resolverApiKeyPorHash(kf.hash)).toBeNull();
        await withPlataforma((tx) => tx.update(s.platformApiKeys).set({ revokedAt: new Date() }).where(eq(s.platformApiKeys.keyHash, kp.hash)));
        expect(await resolverApiKeyPorHash(kp.hash)).toBeNull();
        // chave guardada só como hash, prefixo travado
        expect(await sqlstate(() => withFamilia(A.id, (tx) => tx.execute(sql`update api_keys set prefix = 'xxx_' where key_hash = ${kf.hash}`)))).toBe("23514");
      } finally {
        await admin`delete from platform_api_keys where key_hash = ${kp.hash}`;
      }
    });
  });

  /* ------------------------------------------------------------ estados de acesso, convites e primeiro acesso */
  describe("estados de acesso", () => {
    const novo = async (f: FamiliaTeste, v: Partial<typeof s.members.$inferInsert> = {}) => {
      const id = randomUUID();
      await withFamilia(f.id, (tx) => tx.insert(s.members).values({ id, familyId: f.id, profileId: f.profileId, name: "Pessoa", ...v }));
      return id;
    };

    it("todo membro nasce invited", async () => {
      const id = await novo(A);
      const [m] = await withFamilia(A.id, (tx) => tx.select().from(s.members).where(eq(s.members.id, id)));
      expect(m?.accessState).toBe("invited");
    });

    it("active exige appwrite_user_id, e-mail e e-mail confirmado", async () => {
      const ok = { accessState: "active" as const, appwriteUserId: `aw_${randomUUID()}`, email: `${randomUUID()}@teste.test`, emailConfirmedAt: new Date() };
      await novo(A, ok);
      expect(await sqlstate(() => novo(A, { ...ok, appwriteUserId: null, email: `${randomUUID()}@t.test` }))).toBe("23514");
      expect(await sqlstate(() => novo(A, { ...ok, appwriteUserId: `aw_${randomUUID()}`, email: null }))).toBe("23514");
      expect(await sqlstate(() => novo(A, { ...ok, appwriteUserId: `aw_${randomUUID()}`, email: `${randomUUID()}@t.test`, emailConfirmedAt: null }))).toBe("23514");
    });

    it("appwrite_user_id e e-mail confirmado não existem fora de active (e-mail pré-preenchido pode)", async () => {
      for (const accessState of ["invited", "whatsapp_verified"] as const) {
        const base = () => ({ accessState, phoneVerified: telefoneAleatorio() });
        expect(await sqlstate(() => novo(A, { ...base(), appwriteUserId: `aw_${randomUUID()}` })), accessState).toBe("23514");
        expect(await sqlstate(() => novo(A, { ...base(), emailConfirmedAt: new Date() })), accessState).toBe("23514");
      }
      await novo(A, { email: `${randomUUID()}@pre.test` }); // pré-preenchido pelo admin, ainda não confirmado
    });

    it("whatsapp_verified exige telefone verificado", async () => {
      expect(await sqlstate(() => novo(A, { accessState: "whatsapp_verified" }))).toBe("23514");
      await novo(A, { accessState: "whatsapp_verified", phoneVerified: telefoneAleatorio() });
    });

    it("trocar o número de um whatsapp_verified o devolve a invited", async () => {
      const id = await novo(A, { accessState: "whatsapp_verified", phoneVerified: telefoneAleatorio() });
      await withFamilia(A.id, (tx) => tx.update(s.members).set({ phonePending: telefoneAleatorio() }).where(eq(s.members.id, id)));
      const [m] = await withFamilia(A.id, (tx) => tx.select().from(s.members).where(eq(s.members.id, id)));
      expect(m).toMatchObject({ accessState: "invited", phoneVerified: null });
    });

    it("telefone verificado é único entre famílias", async () => {
      const tel = telefoneAleatorio();
      await novo(B, { accessState: "whatsapp_verified", phoneVerified: tel });
      expect(await sqlstate(() => novo(A, { accessState: "whatsapp_verified", phoneVerified: tel }))).toBe("23505");
    });
  });

  describe("convite por WhatsApp", () => {
    const criarConvite = async (f: FamiliaTeste, tel: string, codigo: string) => {
      const memberId = randomUUID();
      const inviteId = randomUUID();
      await withFamilia(f.id, async (tx) => {
        await tx.insert(s.members).values({ id: memberId, familyId: f.id, profileId: f.profileId, name: "Convidada" });
        await tx.insert(s.invites).values({
          id: inviteId, familyId: f.id, kind: "whatsapp", profileId: f.profileId, memberId, expectedPhone: tel,
          codeHash: hashConviteCodigo(tel, codigo), expiresAt: new Date(Date.now() + VALIDADE_CONVITE_MS),
          createdByMemberId: f.memberId,
        });
      });
      return { memberId, inviteId };
    };
    const ler = (f: FamiliaTeste, inviteId: string, memberId: string) => withFamilia(f.id, async (tx) => ({
      inv: (await tx.select().from(s.invites).where(eq(s.invites.id, inviteId)))[0]!,
      mem: (await tx.select().from(s.members).where(eq(s.members.id, memberId)))[0]!,
    }));
    const limparBloqueio = (...tels: string[]) => admin`delete from phone_lockouts where phone in ${admin(tels)}`;

    it("remetente esperado + código certo: consome, verifica o número e deixa whatsapp_verified", async () => {
      const tel = telefoneAleatorio();
      const { memberId, inviteId } = await criarConvite(A, tel, "482910");
      const r = await consumirConviteWhatsapp(tel, hashConviteCodigo(tel, "482910"));
      expect(r).toEqual({ resultado: "verificado", membroId: memberId, familiaId: A.id, conviteId: inviteId, perfilId: A.profileId });
      const { inv, mem } = await ler(A, inviteId, memberId);
      expect(inv.consumedAt).not.toBeNull();
      expect(mem).toMatchObject({ phoneVerified: tel, accessState: "whatsapp_verified", appwriteUserId: null, emailConfirmedAt: null });
      expect(await resolverMembroPorTelefone(tel)).toMatchObject({ membroId: memberId, estadoAcesso: "whatsapp_verified" });
    });

    it("uso único: o mesmo código não vale uma segunda vez", async () => {
      const tel = telefoneAleatorio();
      await criarConvite(A, tel, "111222");
      const h = hashConviteCodigo(tel, "111222");
      expect((await consumirConviteWhatsapp(tel, h)).resultado).toBe("verificado");
      expect((await consumirConviteWhatsapp(tel, h)).resultado).toBe("invalido");
      await limparBloqueio(tel);
    });

    it("preso ao número: outro remetente com o código certo não consome nem gasta tentativa do convite", async () => {
      const tel = telefoneAleatorio();
      const intruso = telefoneAleatorio();
      const { memberId, inviteId } = await criarConvite(A, tel, "333444");
      for (const h of [hashConviteCodigo(intruso, "333444"), hashConviteCodigo(tel, "333444")]) {
        for (let i = 0; i < 6; i++) expect((await consumirConviteWhatsapp(intruso, h)).resultado).not.toBe("verificado");
      }
      const { inv, mem } = await ler(A, inviteId, memberId);
      expect(inv).toMatchObject({ attempts: 0, consumedAt: null, revokedAt: null });
      expect(mem).toMatchObject({ accessState: "invited", phoneVerified: null });
      expect((await consumirConviteWhatsapp(intruso, hashConviteCodigo(intruso, "333444"))).resultado).toBe("bloqueado");
      expect((await consumirConviteWhatsapp(tel, hashConviteCodigo(tel, "333444"))).resultado).toBe("verificado");
      await limparBloqueio(intruso);
    });

    it("a resposta não revela se existe convite para o número", async () => {
      const tel = telefoneAleatorio();
      const semConvite = telefoneAleatorio();
      await criarConvite(A, tel, "555666");
      const errado = await consumirConviteWhatsapp(tel, hashConviteCodigo(tel, "000000"));
      const outro = await consumirConviteWhatsapp(semConvite, hashConviteCodigo(semConvite, "000000"));
      expect(errado).toEqual(outro);
      await limparBloqueio(tel, semConvite);
    });

    it("expirado não vale, mesmo com o código certo", async () => {
      const tel = telefoneAleatorio();
      const { inviteId, memberId } = await criarConvite(A, tel, "777888");
      await admin`update invites set expires_at = now() - interval '1 second', created_at = now() - interval '25 hours' where id = ${inviteId}`;
      expect((await consumirConviteWhatsapp(tel, hashConviteCodigo(tel, "777888"))).resultado).toBe("invalido");
      expect((await ler(A, inviteId, memberId)).mem.accessState).toBe("invited");
      await limparBloqueio(tel);
    });

    it("limite de tentativas: 5 erros revogam o convite; o código certo depois não passa", async () => {
      const tel = telefoneAleatorio();
      const { inviteId, memberId } = await criarConvite(A, tel, "999000");
      for (let i = 0; i < 5; i++) {
        expect((await consumirConviteWhatsapp(tel, hashConviteCodigo(tel, "123123"))).resultado).toBe("invalido");
        await limparBloqueio(tel); // exercita só o limite do convite, sem o bloqueio por telefone
      }
      const { inv } = await ler(A, inviteId, memberId);
      expect(inv.attempts).toBe(5);
      expect(inv.revokedAt).not.toBeNull();
      expect((await consumirConviteWhatsapp(tel, hashConviteCodigo(tel, "999000"))).resultado).toBe("invalido");
      await limparBloqueio(tel);
    });

    it("revogado não vale; só um convite ativo por número esperado", async () => {
      const tel = telefoneAleatorio();
      const { inviteId } = await criarConvite(A, tel, "121212");
      expect(await sqlstate(() => criarConvite(B, tel, "343434"))).toBe("23505");
      await withFamilia(A.id, (tx) => tx.update(s.invites).set({ revokedAt: new Date() }).where(eq(s.invites.id, inviteId)));
      expect((await consumirConviteWhatsapp(tel, hashConviteCodigo(tel, "121212"))).resultado).toBe("invalido");
      await criarConvite(B, tel, "343434");
      await limparBloqueio(tel);
    });

    it("número já verificado por outro usuário: em_uso e o convite não é consumido", async () => {
      const tel = telefoneAleatorio();
      const { inviteId, memberId } = await criarConvite(A, tel, "565656");
      await withFamilia(B.id, (tx) => tx.insert(s.members).values({
        familyId: B.id, profileId: B.profileId, name: "Dono do número", accessState: "whatsapp_verified", phoneVerified: tel,
      }));
      const r = await consumirConviteWhatsapp(tel, hashConviteCodigo(tel, "565656"));
      expect(r.resultado).toBe("em_uso");
      expect(r.membroId).toBeNull();
      const { inv, mem } = await ler(A, inviteId, memberId);
      expect(inv.consumedAt).toBeNull();
      expect(mem.accessState).toBe("invited");
    });

    it("formato: hash válido; e-mail xor número esperado", async () => {
      const tel = telefoneAleatorio();
      expect((await consumirConviteWhatsapp(tel, "123456")).resultado).toBe("invalido");
      expect((await consumirConviteWhatsapp("abc", sha256("x"))).resultado).toBe("invalido");
      const memberId = randomUUID();
      await withFamilia(A.id, (tx) => tx.insert(s.members).values({ id: memberId, familyId: A.id, profileId: A.profileId, name: "X" }));
      const base = { familyId: A.id, profileId: A.profileId, memberId, expiresAt: new Date(Date.now() + 1000) };
      const ins = (v: Partial<typeof s.invites.$inferInsert> & { kind: "email" | "whatsapp" }) =>
        sqlstate(() => withFamilia(A.id, (tx) => tx.insert(s.invites).values({ ...base, ...v })));
      expect(await ins({ kind: "whatsapp" })).toBe("23514");
      expect(await ins({ kind: "whatsapp", expectedPhone: tel, codeHash: "puro-123456" })).toBe("23514");
      expect(await ins({ kind: "email", email: "a@b.test", expectedPhone: tel })).toBe("23514");
      expect(await ins({ kind: "email", email: "a@b.test" })).toBe("ok");
    });

    it("RLS: a família B não enxerga nem altera convites e links da A, e sem família não vê nada", async () => {
      const tel = telefoneAleatorio();
      const { inviteId, memberId } = await criarConvite(A, tel, "787878");
      const { hash } = gerarTokenPrimeiroAcesso();
      await withFamilia(A.id, (tx) => tx.insert(s.firstAccessLinks).values({
        familyId: A.id, memberId, tokenHash: hash, expiresAt: new Date(Date.now() + VALIDADE_CONVITE_MS),
      }));
      await withFamilia(B.id, async (tx) => {
        expect(await tx.select().from(s.invites).where(eq(s.invites.id, inviteId))).toHaveLength(0);
        expect(await tx.select().from(s.firstAccessLinks)).toHaveLength(0);
        expect(await tx.update(s.invites).set({ revokedAt: new Date() }).where(eq(s.invites.id, inviteId)).returning()).toHaveLength(0);
        expect(await tx.delete(s.firstAccessLinks).returning()).toHaveLength(0);
      });
      expect(await getDb().select().from(s.invites)).toHaveLength(0);
      expect(await getDb().select().from(s.firstAccessLinks)).toHaveLength(0);
      expect(await sqlstate(() => withFamilia(B.id, (tx) => tx.insert(s.invites).values({
        familyId: A.id, kind: "email", email: "x@y.test", profileId: A.profileId, memberId, expiresAt: new Date(Date.now() + 1000),
      })))).toBe("42501");
      const [{ n } = { n: -1 }] = await admin`select count(*)::int as n from invites where id = ${inviteId} and revoked_at is null`;
      expect(n).toBe(1);
    });
  });

  describe("link de primeiro acesso", () => {
    const criarLink = async (f: FamiliaTeste) => {
      const memberId = randomUUID();
      await withFamilia(f.id, (tx) => tx.insert(s.members).values({
        id: memberId, familyId: f.id, profileId: f.profileId, name: "Primeiro acesso", email: `${randomUUID()}@pa.test`,
        accessState: "whatsapp_verified", phoneVerified: telefoneAleatorio(),
      }));
      const { token, hash } = gerarTokenPrimeiroAcesso();
      const [row] = await withFamilia(f.id, (tx) => tx.insert(s.firstAccessLinks).values({
        familyId: f.id, memberId, tokenHash: hash, expiresAt: new Date(Date.now() + VALIDADE_CONVITE_MS),
      }).returning());
      return { memberId, token, hash, linkId: row!.id };
    };

    it("resolve sem consumir; consome uma única vez", async () => {
      const { memberId, hash, linkId } = await criarLink(A);
      const r = await resolverLinkPrimeiroAcesso(hash);
      expect(r).toMatchObject({ linkId, membroId: memberId, familiaId: A.id, estadoAcesso: "whatsapp_verified" });
      expect(r?.email).toMatch(/@pa\.test$/);
      expect(await resolverLinkPrimeiroAcesso(hash)).not.toBeNull();
      expect(await consumirLinkPrimeiroAcesso(hash)).toEqual({ linkId, membroId: memberId, familiaId: A.id });
      expect(await consumirLinkPrimeiroAcesso(hash)).toBeNull();
      expect(await resolverLinkPrimeiroAcesso(hash)).toBeNull();
    });

    it("consumo concorrente: só um vence", async () => {
      const { hash } = await criarLink(A);
      const r = await Promise.all([1, 2, 3, 4].map(() => consumirLinkPrimeiroAcesso(hash)));
      expect(r.filter((x) => x !== null)).toHaveLength(1);
    });

    it("expirado, revogado, desconhecido ou fora do formato não resolvem", async () => {
      const exp = await criarLink(A);
      await admin`update first_access_links set expires_at = now() - interval '1 second', created_at = now() - interval '25 hours' where id = ${exp.linkId}`;
      expect(await resolverLinkPrimeiroAcesso(exp.hash)).toBeNull();
      expect(await consumirLinkPrimeiroAcesso(exp.hash)).toBeNull();
      const rev = await criarLink(A);
      await withFamilia(A.id, (tx) => tx.update(s.firstAccessLinks).set({ revokedAt: new Date() }).where(eq(s.firstAccessLinks.id, rev.linkId)));
      expect(await resolverLinkPrimeiroAcesso(rev.hash)).toBeNull();
      expect(await consumirLinkPrimeiroAcesso(sha256("desconhecido"))).toBeNull();
      expect(await resolverLinkPrimeiroAcesso("token-puro")).toBeNull();
    });

    it("só o hash fica no banco: token em claro é recusado pelo formato", async () => {
      const { token, memberId } = await criarLink(A);
      expect(await sqlstate(() => withFamilia(A.id, (tx) => tx.insert(s.firstAccessLinks).values({
        familyId: A.id, memberId, tokenHash: token, expiresAt: new Date(Date.now() + 1000),
      })))).toBe("23514");
    });

    it("fluxo completo: link consumido e membro ativado (active) com Appwrite e e-mail confirmado", async () => {
      const { memberId, hash } = await criarLink(A);
      expect((await consumirLinkPrimeiroAcesso(hash))?.membroId).toBe(memberId);
      await withFamilia(A.id, (tx) => tx.update(s.members).set({
        accessState: "active", appwriteUserId: `aw_${randomUUID()}`, emailConfirmedAt: new Date(),
      }).where(eq(s.members.id, memberId)));
      const [m] = await withFamilia(A.id, (tx) => tx.select().from(s.members).where(eq(s.members.id, memberId)));
      expect(m?.accessState).toBe("active");
    });
  });

  /* ------------------------------------------------------------ (d) rollback */
  describe("transação", () => {
    it("erro dentro de withFamilia desfaz tudo", async () => {
      const id = randomUUID();
      await expect(withFamilia(A.id, async (tx) => {
        await tx.insert(s.patients).values({ id, familyId: A.id, name: "Fantasma" });
        expect(await tx.select().from(s.patients).where(eq(s.patients.id, id))).toHaveLength(1);
        throw new Error("falhou no meio");
      })).rejects.toThrow("falhou no meio");
      const [{ n } = { n: -1 }] = await admin`select count(*)::int as n from patients where id = ${id}`;
      expect(n).toBe(0);
    });

    it("violação no meio da transação desfaz também o que veio antes", async () => {
      const id = randomUUID();
      const code = await sqlstate(() => withFamilia(A.id, async (tx) => {
        await tx.insert(s.patients).values({ id, familyId: A.id, name: "Antes da falha" });
        await tx.insert(s.patients).values({ id: randomUUID(), familyId: B.id, name: "viola RLS" });
      }));
      expect(code).toBe("42501");
      const [{ n } = { n: -1 }] = await admin`select count(*)::int as n from patients where id = ${id}`;
      expect(n).toBe(0);
    });

    it("commit normal persiste", async () => {
      const id = randomUUID();
      await withFamilia(A.id, (tx) => tx.insert(s.patients).values({ id, familyId: A.id, name: "Persistente" }));
      const [{ n } = { n: -1 }] = await admin`select count(*)::int as n from patients where id = ${id}`;
      expect(n).toBe(1);
    });
  });

  /* ------------------------------------------------------------ (e) o papel da aplicação não foge do RLS */
  describe("limites do papel da aplicação", () => {
    it("não é superusuário nem tem BYPASSRLS", async () => {
      const r = await getDb().execute<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean }>(
        sql`select current_user, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb from pg_roles r where r.rolname = current_user`,
      );
      expect(r[0]).toMatchObject({ current_user: "medcuidar_app", rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
    });

    it("não desliga o RLS (SET row_security = off e ALTER TABLE ... DISABLE)", async () => {
      // com row_security=off o Postgres NÃO ignora a política: recusa a consulta
      const code = await sqlstate(() => withFamilia(A.id, async (tx) => {
        await tx.execute(sql`set local row_security = off`);
        await tx.execute(sql`select * from patients`);
      }));
      expect(code).toBe("42501");
      for (const stmt of [
        "alter table patients disable row level security",
        "alter table patients no force row level security",
        "drop policy family_isolation on patients",
        "create policy tudo on patients using (true)",
        "alter table patients owner to medcuidar_app",
      ]) {
        expect(await sqlstate(() => getDb().execute(sql.raw(stmt))), stmt).toBe("42501");
      }
    });

    it("não cria, altera nem apaga tabelas e não assume o papel dono", async () => {
      for (const stmt of [
        "create table invasora (id int)",
        "create table public.invasora (id int)",
        "alter table patients add column x int",
        "drop table patients",
        "truncate patients",
        "set role medcuidar_owner",
        "create role intruso",
        "create function f() returns int language sql as 'select 1'",
      ]) {
        expect(await sqlstate(() => getDb().execute(sql.raw(stmt))), stmt).toBe("42501");
      }
      const [{ n } = { n: -1 }] = await admin`select count(*)::int as n from information_schema.tables where table_name = 'invasora'`;
      expect(n).toBe(0);
    });

    it("não consegue se passar pela plataforma para ler dados de família", async () => {
      // app.plataforma só abre as tabelas globais; as de família continuam presas à família
      const r = await withPlataforma((tx) => tx.execute(sql`select count(*)::int as n from members`));
      expect(r[0]?.n).toBe(0);
    });
  });

  /* ------------------------------------------------------------ Lote 4A: fila de saída, conversa e primeiro acesso */
  describe("Lote 4A", () => {
    it("outbound_messages e conversation_state: B não lê nem altera os de A, e o dedupe é por família", async () => {
      const mA = A.memberId;
      await withFamilia(A.id, async (tx) => {
        await tx.insert(s.outboundMessages).values({ familyId: A.id, memberId: mA, kind: "dose_reminder", dedupeKey: "k1", body: "oi" });
        await tx.insert(s.conversationState).values({ familyId: A.id, memberId: mA, kind: "reminders", expiresAt: new Date(Date.now() + 60_000) });
      });
      await withFamilia(B.id, async (tx) => {
        expect(await tx.select().from(s.outboundMessages)).toHaveLength(0);
        expect(await tx.select().from(s.conversationState)).toHaveLength(0);
        expect(await tx.update(s.outboundMessages).set({ sentAt: new Date() }).returning()).toHaveLength(0);
        // mesma chave em outra família é permitida
        await tx.insert(s.outboundMessages).values({ familyId: B.id, memberId: B.memberId, kind: "dose_reminder", dedupeKey: "k1", body: "oi" });
      });
      // linha com family_id de A gravada por B é recusada pelo RLS
      expect(await sqlstate(() => withFamilia(B.id, (tx) =>
        tx.insert(s.outboundMessages).values({ familyId: A.id, memberId: mA, kind: "x", dedupeKey: "k2", body: "x" })))).toBe("42501");
      // dedupe repetido na mesma família: 23505
      expect(await sqlstate(() => withFamilia(A.id, (tx) =>
        tx.insert(s.outboundMessages).values({ familyId: A.id, memberId: mA, kind: "dose_reminder", dedupeKey: "k1", body: "oi" })))).toBe("23505");
    });

    it("list_active_families devolve só id e fuso das famílias ativas", async () => {
      const { listarFamiliasAtivas } = await import("./sistema");
      const l = await listarFamiliasAtivas();
      expect(l.map((f) => f.familiaId)).toEqual(expect.arrayContaining([A.id, B.id]));
      expect(Object.keys(l[0]!).sort()).toEqual(["familiaId", "fuso"]);
    });

    it("activate_member_by_email: só com candidato único whatsapp_verified; vira active", async () => {
      const { ativarMembroPorEmail } = await import("./sistema");
      const tel = telefoneAleatorio();
      const email = `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`;
      const id = randomUUID();
      await withFamilia(A.id, async (tx) => {
        await tx.insert(s.members).values({ id, familyId: A.id, profileId: A.profileId, name: "Convidado", email, accessState: "whatsapp_verified", phoneVerified: tel });
      });
      // e-mail desconhecido: nada
      expect(await ativarMembroPorEmail("outro@exemplo.test", "u-x")).toBeNull();
      const uid = `zz-test-${randomUUID()}`;
      const r = await ativarMembroPorEmail(email.toUpperCase(), uid);
      expect(r?.membroId).toBe(id);
      const [m] = await admin`select access_state, appwrite_user_id from members where id = ${id}`;
      expect(m?.access_state).toBe("active");
      expect(m?.appwrite_user_id).toBe(uid);
      // de novo (já ativo) e usuário já ligado: nada
      expect(await ativarMembroPorEmail(email, uid)).toBeNull();
    });

    it("activate_member_by_email recusa quando há dois candidatos com o mesmo e-mail", async () => {
      const { ativarMembroPorEmail } = await import("./sistema");
      const email = `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`;
      for (const F of [A, B]) {
        await withFamilia(F.id, async (tx) => {
          await tx.insert(s.members).values({ familyId: F.id, profileId: F.profileId, name: "Dup", email, accessState: "whatsapp_verified", phoneVerified: telefoneAleatorio() });
        });
      }
      expect(await ativarMembroPorEmail(email, `zz-test-${randomUUID()}`)).toBeNull();
    });
  });
});
