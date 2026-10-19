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
  resolverApiKeyPorHash, resolverMembroPorAppwriteUser, resolverMembroPorTelefone, verificarTelefonePendente,
} from "./sistema";
import { gerarApiKey, hashCodigoVerificacao, sha256 } from "./crypto";
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
      expect(await resolverMembroPorTelefone(tel)).toEqual({ membroId: m, familiaId: B.id, ativo: true, familiaAtiva: true });
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
      const m = await novoMembro(A, { appwriteUserId: aw, email: `${randomUUID()}@teste.test` });
      expect(await resolverMembroPorAppwriteUser(aw)).toEqual({ membroId: m, familiaId: A.id, ativo: true });
      expect(await resolverMembroPorAppwriteUser("inexistente")).toBeNull();
      expect(await sqlstate(() => novoMembro(B, { appwriteUserId: aw }))).toBe("23505");

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
});
