// @vitest-environment node
/**
 * Integração do Lote 4B (WhatsApp direto no portal, sem N8N) contra o Postgres local (pnpm db:up), com o papel da APLICAÇÃO (sem BYPASSRLS):
 * webhook, fila de entrada, worker, núcleo da conversa, agente de IA (modelo SIMULADO: nenhuma chamada real à Anthropic, ao Gemini nem à
 * Evolution), agendador de saída, PARAR/REATIVAR, alertas e custo de IA. Sem o banco no ar, a suíte é PULADA.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { listarFamiliasComWhatsapp, tentarTravaConsultiva, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { bancoDisponivel, conectarAdmin, encerrar, limparFamilias, limparFamiliasAntigasDeTeste, prepararBanco, telefoneAleatorio, type Admin } from "@medcuidar/pg-testing";
import { SYSTEM_PROFILES, familySettingsSchema, type PermissionMap } from "@medcuidar/shared";
import { ensureDosesForDay } from "../pg/doses";
import { createFamilyWithAdmin } from "../pg/families";
import * as meds from "../pg/medications";
import * as patients from "../pg/patients";
import { adjustStock, registerPurchase } from "../pg/stock";
import { contadores, loadWaActor, resolveSender, type WaActor } from "./actor";
import { monitorarInstancia, registrarResultadoEnvio } from "./alertas";
import { cicloAgendador } from "./agendador";
import { gerarMensagens, pendentes, pendentesDeTodas, resumoSaida } from "./fila";
import { MAX_TENTATIVAS, concluir, enfileirar, falhar, limparEntrada, reivindicar, resumoEntrada } from "./inbound";
import { responderLivre, type DepsAgente } from "./ia/agente";
import { executarFerramenta } from "./ia/ferramentas";
import type { ChamarModelo, PedidoModelo, RespostaModelo } from "./ia/modelo";
import type { LeitorMidia } from "./ia/midia";
import { definirLimiteMensal, resumoDeUso } from "./ia/uso";
import { comandoDeAvisos, processarEntrada, type DepsNucleo } from "./nucleo";
import { criarFake, type ProvedorFake } from "./provider/fake";
import { criarEvolutionGo } from "./provider/evolution-go";
import type { MensagemRecebida } from "./provider/types";
import fx from "./provider/fixtures/eventos.json";
import { criarRitmo, type Relogio } from "./ritmo";
import { lerRuntime } from "./runtime";
import { enviarPendentes } from "./saida";
import { segredoConfere, tratarWebhook } from "./webhook";
import { iniciarWorkerEntrada, processarItem, rodarUmaVez, type DepsWorker } from "./worker";
import { startPhoneVerification } from "./phone-verify";
import { variantesBr } from "./provider/telefone";
import { vi } from "vitest";

const up = await bancoDisponivel();
if (!up) console.warn("[web] Postgres local indisponível: testes de integração do Lote 4B PULADOS. Rode `pnpm db:up`.");

const TZ = "America/Sao_Paulo";
const DAY = "2026-10-19";
/** 06:10 em São Paulo: a dose das 06:00 está na hora. */
const T0610 = new Date("2026-10-19T09:10:00Z");
const settings = familySettingsSchema.parse({});
const permsOf = (name: string): PermissionMap => SYSTEM_PROFILES.find((p) => p.name === name)!.permissions;
const SEGREDO = "segredo-de-teste-do-webhook-0001";

/* ------------------------------------------------------------------ apoio: modelo simulado, relógio e mensagens */

const USO = { input_tokens: 1200, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const fala = (t: string, uso: Record<string, number> = USO): RespostaModelo => ({ status: 200, body: { content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: uso } });
const usa = (name: string, input: unknown, id = "tu_1"): RespostaModelo => ({
  status: 200, body: { content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use", usage: USO },
});

/** Modelo roteirizado: devolve as respostas na ordem e guarda cada pedido recebido. */
function roteiro(respostas: RespostaModelo[]): { modelo: ChamarModelo; pedidos: PedidoModelo[] } {
  const pedidos: PedidoModelo[] = [];
  let i = 0;
  return {
    pedidos,
    modelo: async (p) => {
      pedidos.push(JSON.parse(JSON.stringify(p)) as PedidoModelo);
      const r = respostas[Math.min(i++, respostas.length - 1)];
      if (!r) throw new Error("modelo sem roteiro");
      return r;
    },
  };
}

/** Relógio que não espera de verdade. */
function relogioFalso(): Relogio & { pausas: number[] } {
  let t = Date.now();
  const pausas: number[] = [];
  return { agora: () => t, dormir: async (ms) => { pausas.push(ms); t += ms; }, aleatorio: () => 0.5, pausas };
}

const msgTexto = (telefone: string, texto: string, msgId = `zz-${randomUUID()}`): MensagemRecebida => ({
  msgId, telefone, numeroResposta: telefone, tipo: "texto", texto, acao: "", aviso: "", mime: "", base64: "", segundos: 0, midiaRef: null, idadeSegundos: 0,
});
const msgMidia = (telefone: string, tipo: "audio" | "imagem", extra: Partial<MensagemRecebida> = {}): MensagemRecebida => ({
  ...msgTexto(telefone, "", `zz-${randomUUID()}`), tipo, base64: "QUJD", mime: tipo === "audio" ? "audio/ogg" : "image/jpeg", segundos: 4, ...extra,
});

const leitor = (texto: string | null): LeitorMidia & { chamadas: number } => {
  const l = {
    chamadas: 0,
    async transcreverAudio() { l.chamadas++; return { texto, uso: texto ? { entrada: 0, midia: 128, saida: 20, estimado: false } : null }; },
    async lerImagem() { l.chamadas++; return { texto, uso: texto ? { entrada: 1100, midia: 0, saida: 60, estimado: false } : null }; },
  };
  return l;
};

interface Fam {
  familyId: string; adminId: string; patientId: string; patientName: string; medId: string; medName: string; adminPhone: string; doses: string[];
  admin: Parameters<typeof meds.createMedication>[0];
}

describe.skipIf(!up)("Lote 4B — WhatsApp direto no portal", () => {
  let admin: Admin;
  const criadas: string[] = [];

  const actorDe = (familyId: string, memberId: string, profileName: string, name: string) => ({
    familyId, memberId, timezone: TZ, settings, member: { id: memberId, name, profileName, permissions: permsOf(profileName) },
  });

  /** Família com 1 paciente, 1 remédio de 8 em 8 h (06:00, 14:00, 22:00), 10 comprimidos; o administrador tem número VERIFICADO. */
  async function novaFamilia(nome: string): Promise<Fam> {
    const r = await createFamilyWithAdmin({
      appwriteUserId: `zz-test-${randomUUID()}`, name: `Admin ${nome}`, email: `zz-test-${nome}-${randomUUID().slice(0, 6)}@exemplo.test`.toLowerCase(), familyName: `Família ${nome}`,
    });
    criadas.push(r.familyId);
    const a = actorDe(r.familyId, r.memberId, "Administrador", `Admin ${nome}`);
    const adminPhone = telefoneAleatorio();
    await withFamilia(r.familyId, (tx) => tx.update(s.members).set({ phoneVerified: adminPhone }).where(eq(s.members.id, r.memberId)));
    const patientName = `Adelino${nome}`;
    const patientId = await patients.savePatient(a, { name: patientName, birthDate: "", notes: "", usesPhone: true, selfMemberId: null });
    const medName = `Zypred${nome}`;
    const medId = await meds.createMedication(a, { patientId, name: medName, alternatives: [], route: "tablet", controlUnit: "unit" });
    await meds.saveScheme(a, medId, { startDate: DAY, firstTime: "06:00", phases: [{ everyHours: 8, fromDay: 1, toDay: null, perDose: 1 }] });
    await registerPurchase(a, medId, 10, "Saldo inicial");
    await ensureDosesForDay(r.familyId, DAY);
    const doses = await withFamilia(r.familyId, (tx) => tx.select({ id: s.doseEvents.id }).from(s.doseEvents).orderBy(s.doseEvents.scheduledAt));
    return { familyId: r.familyId, adminId: r.memberId, patientId, patientName, medId, medName, adminPhone, doses: doses.map((d) => d.id), admin: a };
  }

  async function pessoa(familyId: string, profileName: string, nome: string, extra: { phone?: string | null; state?: "active" | "whatsapp_verified"; pending?: string | null } = {}) {
    const state = extra.state ?? "active";
    const phone = extra.phone === undefined ? telefoneAleatorio() : extra.phone;
    const id = await withFamilia(familyId, async (tx) => {
      const [p] = await tx.select().from(s.profiles).where(eq(s.profiles.name, profileName));
      const [m] = await tx.insert(s.members).values({
        familyId, profileId: p!.id, name: nome, email: `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`, accessState: state,
        appwriteUserId: state === "active" ? `zz-test-${randomUUID()}` : null, emailConfirmedAt: state === "active" ? new Date() : null,
        phoneVerified: phone, phonePending: extra.pending ?? null,
      }).returning({ id: s.members.id });
      return m!.id;
    });
    return { id, phone };
  }

  const saldo = async (f: Fam) => {
    const [r] = await admin`select coalesce(sum(m.quantity), 0)::float8 as total from stock_movements m join stock_items i on i.id = m.stock_item_id where i.family_id = ${f.familyId} and i.medication_id = ${f.medId}`;
    return r!["total"] as number;
  };
  const optOut = async (id: string) => ((await admin`select whatsapp_opt_out_at from members where id = ${id}`)[0]!["whatsapp_opt_out_at"] as Date | null);

  /** Entra na fila já "vencida" (o relógio das conversas é fixo em T0610; o `next_attempt_at` padrão é o relógio real). */
  async function entra(m: MensagemRecebida) {
    await enfileirar(m);
    await admin`update whatsapp_inbound set next_attempt_at = '2000-01-01' where msg_id = ${m.msgId}`;
  }
  const linha = async (msgId: string) => (await admin`select * from whatsapp_inbound where msg_id = ${msgId}`)[0]!;

  /** Dependências do worker com provedor fake, relógio falso e modelo simulado. */
  function deps(opts: { modelo?: ChamarModelo | null; midia?: LeitorMidia | null; fake?: ProvedorFake } = {}) {
    const fake = opts.fake ?? criarFake();
    const relogio = relogioFalso();
    const ritmo = criarRitmo({ relogio, maxPorMinuto: 1000, maxPorHora: 10000 });
    const nucleo: DepsNucleo = { agente: { modelo: opts.modelo === undefined ? null : opts.modelo, agora: () => T0610 }, midia: opts.midia ?? null, agora: () => T0610 };
    const d: DepsWorker = { provedor: fake, ritmo, nucleo, relogio, agora: () => T0610 };
    return { d, fake, relogio };
  }

  const actorAdmin = async (f: Fam) => (await resolveSender(f.adminPhone))!;

  beforeAll(async () => {
    process.env["APP_URL"] = "http://app.test";
    process.env["WHATSAPP_WEBHOOK_SECRET"] = SEGREDO;
    process.env["ANTHROPIC_MODEL"] = "claude-sonnet-5-5";
    admin = conectarAdmin();
    await prepararBanco();
    await limparFamiliasAntigasDeTeste(admin);
    await admin`delete from whatsapp_inbound`;
  });
  beforeEach(async () => {
    await admin`delete from whatsapp_inbound`;
  });
  afterAll(async () => {
    await admin`delete from whatsapp_inbound`;
    await admin`delete from whatsapp_runtime`;
    await admin.unsafe("delete from audit_log where family_id = any($1::uuid[])", [criadas]);
    await limparFamilias(admin, criadas); // com tentativas e conferência: lança se sobrar família
    await admin`delete from phone_lockouts where phone like '5599%'`;
    await encerrar(admin);
  });

  /* ------------------------------------------------------------ webhook */
  describe("webhook: POST /api/whatsapp/evolution/[segredo]", () => {
    const prov = criarEvolutionGo({ baseUrl: "https://e", apiKey: "k", instanceId: "00000000-0000-0000-0000-000000000001" });
    /** Fixture com id novo e carimbo de agora (senão o teste envelhece e cai no filtro de mensagens antigas). */
    const evento = (base: typeof fx.texto, id = `zz-${randomUUID()}`) =>
      JSON.stringify({ ...base, data: { ...base.data, Info: { ...base.data.Info, ID: id, Timestamp: new Date().toISOString() } } });

    it("segredo inválido → 404 genérico, sem vazar nada e sem gravar", async () => {
      for (const errado of ["", "errado", SEGREDO + "x", SEGREDO.slice(0, -1)]) {
        const r = await tratarWebhook(errado, evento(fx.texto), prov);
        expect(r.status).toBe(404);
        expect(JSON.stringify(r.corpo)).not.toContain(SEGREDO);
      }
      expect((await admin`select count(*)::int as n from whatsapp_inbound`)[0]!["n"]).toBe(0);
    });
    it("sem WHATSAPP_WEBHOOK_SECRET configurado, nada confere (nem o segredo vazio)", () => {
      expect(segredoConfere("", "")).toBe(false);
      expect(segredoConfere("curto", "curto")).toBe(false);
      expect(segredoConfere(SEGREDO, SEGREDO)).toBe(true);
    });
    it("mensagem válida entra na fila (200 na hora); a MESMA mensagem duas vezes entra uma vez só", async () => {
      const id = `zz-${randomUUID()}`;
      const corpo = evento(fx.texto, id);
      const a = await tratarWebhook(SEGREDO, corpo, prov);
      const b = await tratarWebhook(SEGREDO, corpo, prov);
      expect(a).toMatchObject({ status: 200, corpo: { ok: true, duplicada: false } });
      expect(b).toMatchObject({ status: 200, corpo: { ok: true, duplicada: true } });
      const rows = await admin`select * from whatsapp_inbound where msg_id = ${id}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]!["phone"]).toBe("5511912345678");
      expect(rows[0]!["status"]).toBe("pendente");
    });
    it("fromMe, grupo, status e eventos que não são mensagem são ignorados (200, nada na fila)", async () => {
      for (const [k, motivo] of [["from_me", "propria"], ["grupo", "grupo"], ["status", "status"], ["recibo", "evento"], ["presenca", "evento"]] as const) {
        const r = await tratarWebhook(SEGREDO, JSON.stringify(fx[k]), prov);
        expect(r).toMatchObject({ status: 200, corpo: { ok: true, ignorado: motivo } });
      }
      expect((await admin`select count(*)::int as n from whatsapp_inbound`)[0]!["n"]).toBe(0);
    });
    it("mensagem velha (backlog depois de reconexão) é ignorada; corpo que não é JSON → 400", async () => {
      const velha = JSON.stringify({ ...fx.texto, data: { ...fx.texto.data, Info: { ...fx.texto.data.Info, ID: `zz-${randomUUID()}`, Timestamp: "2020-01-01T00:00:00Z" } } });
      expect(await tratarWebhook(SEGREDO, velha, prov)).toMatchObject({ status: 200, corpo: { ignorado: "antiga" } });
      expect((await tratarWebhook(SEGREDO, "isso não é json", prov)).status).toBe(400);
    });
  });

  /* ------------------------------------------------------------ fila de entrada */
  describe("fila de entrada no Postgres", () => {
    const m = (tel: string, id: string) => msgTexto(tel, "oi", id);
    const vencer = (ids: string[]) => admin`update whatsapp_inbound set next_attempt_at = '2000-01-01' where msg_id = any(${ids})`;

    it("uma conversa por telefone por vez e EM ORDEM, mesmo com dois workers pedindo ao mesmo tempo", async () => {
      const x = telefoneAleatorio(), y = telefoneAleatorio();
      for (const [t, id] of [[x, "zz-x1"], [x, "zz-x2"], [x, "zz-x3"], [y, "zz-y1"]] as const) {
        await enfileirar(m(t, id));
        await new Promise((r) => setTimeout(r, 5));
      }
      await vencer(["zz-x1", "zz-x2", "zz-x3", "zz-y1"]);
      const [a, b] = await Promise.all([reivindicar(), reivindicar()]);
      expect([a?.msgId, b?.msgId].sort()).toEqual(["zz-x1", "zz-y1"]); // nunca x2 enquanto x1 está em andamento
      expect(await reivindicar()).toBeNull(); // x e y ocupados
      await concluir(a!.msgId === "zz-x1" ? a!.id : b!.id);
      expect((await reivindicar())?.msgId).toBe("zz-x2"); // só depois que x1 acabou, na ordem
    });

    it("item travado por queda do processo volta quando a trava vence (e conta a tentativa)", async () => {
      const t = telefoneAleatorio();
      await enfileirar(m(t, "zz-trava"));
      await vencer(["zz-trava"]);
      const i1 = await reivindicar();
      expect(i1?.tentativas).toBe(1);
      expect(await reivindicar()).toBeNull(); // ainda travado
      await admin`update whatsapp_inbound set locked_until = now() - interval '1 minute' where msg_id = 'zz-trava'`;
      const i2 = await reivindicar();
      expect(i2).toMatchObject({ msgId: "zz-trava", tentativas: 2 });
    });

    it("falha: recuo crescente, não reivindica antes da hora e, no limite, vira erro SEM payload", async () => {
      const t = telefoneAleatorio();
      await enfileirar(m(t, "zz-recuo"));
      await vencer(["zz-recuo"]);
      let agora = new Date();
      let item = (await reivindicar(agora))!;
      expect(await falhar(item, "falhou 5511912345678", agora)).toBe("pendente");
      expect(await reivindicar(agora)).toBeNull(); // dentro do recuo
      agora = new Date(agora.getTime() + 31_000);
      item = (await reivindicar(agora))!;
      expect(item.tentativas).toBe(2);
      for (let n = item.tentativas; n < MAX_TENTATIVAS; n++) {
        await falhar(item, "falhou", agora);
        agora = new Date(agora.getTime() + 11 * 60_000);
        item = (await reivindicar(agora))!;
      }
      expect(item.tentativas).toBe(MAX_TENTATIVAS);
      expect(await falhar(item, "esgotou", agora)).toBe("erro");
      const l = await linha("zz-recuo");
      expect(l["status"]).toBe("erro");
      expect(l["payload"]).toBeNull();
      expect(String(l["error_summary"])).not.toMatch(/\d{8,}/);
      expect((await resumoEntrada()).erros).toBe(1);
    });

    it("retenção: ao concluir o payload (e a mídia em base64) é apagado; linhas antigas somem", async () => {
      const t = telefoneAleatorio();
      await enfileirar({ ...msgTexto(t, "foto", "zz-ret"), tipo: "imagem", base64: "A".repeat(2000) });
      expect(JSON.stringify((await linha("zz-ret"))["payload"])).toContain("AAAA");
      await vencer(["zz-ret"]);
      const i = (await reivindicar())!;
      await concluir(i.id);
      const l = await linha("zz-ret");
      expect(l["payload"]).toBeNull();
      expect(l["response_text"]).toBeNull();
      expect(await limparEntrada()).toBe(0); // recém-concluída: fica
      await admin`update whatsapp_inbound set finished_at = now() - interval '8 days' where msg_id = 'zz-ret'`;
      expect(await limparEntrada()).toBe(1);
      expect(await admin`select 1 from whatsapp_inbound where msg_id = 'zz-ret'`).toHaveLength(0);
    });

    it("a fila de entrada não é visível fora da plataforma (RLS): o papel da aplicação sem withPlataforma não lê nada", async () => {
      await enfileirar(m(telefoneAleatorio(), "zz-rls"));
      const { getDb } = await import("@medcuidar/pg");
      expect(await getDb().select().from(s.whatsappInbound)).toHaveLength(0);
    });
  });

  /* ------------------------------------------------------------ worker + núcleo */
  describe("worker e núcleo da conversa", () => {
    it("'tomei' pelo WhatsApp: presença 'digitando…', pausa de 2 a 6 s, resposta e estoque baixa 1", async () => {
      const f = await novaFamilia("Tomei");
      const { d, fake, relogio } = deps();
      const mm = msgTexto(f.adminPhone, "tomei");
      await entra(mm);
      expect(await rodarUmaVez(d)).toBe(true);
      expect(fake.enviados).toHaveLength(1);
      expect(fake.enviados[0]!.texto).toContain("Anotado");
      expect(fake.presencas).toEqual([f.adminPhone]);
      expect(relogio.pausas.length).toBeGreaterThan(0);
      expect(relogio.pausas.every((p) => p >= 2000 && p <= 6000)).toBe(true);
      expect(await saldo(f)).toBe(9);
      const l = await linha(mm.msgId);
      expect(l["status"]).toBe("feito");
      expect(l["payload"]).toBeNull();
      expect(l["response_text"]).toBeNull();
    });

    it("a MESMA mensagem duas vezes baixa o estoque uma vez só (e a segunda não refaz nada)", async () => {
      const f = await novaFamilia("Dup");
      const { d } = deps();
      const mm = msgTexto(f.adminPhone, "tomei");
      const r1 = await processarEntrada(mm, d.nucleo);
      const r2 = await processarEntrada(mm, d.nucleo);
      expect(r1.respostas[0]).toContain("Anotado");
      expect(r2.intent).toBe("repetida");
      expect(await saldo(f)).toBe(9);
    });

    it("retentativa SEM resposta duplicada: recusa clara do provedor volta para a fila e, na 2ª vez, sai uma só vez", async () => {
      const f = await novaFamilia("Retry");
      const fake = criarFake();
      fake.falharProximos(1, true);
      const { d } = deps({ fake });
      const mm = msgTexto(f.adminPhone, "tomei");
      await entra(mm);
      expect(await rodarUmaVez(d)).toBe(true);
      expect(fake.enviados).toHaveLength(0);
      let l = await linha(mm.msgId);
      expect(l["status"]).toBe("pendente");
      expect(l["stage"]).toBe("respondido"); // a resposta ficou guardada: não refaz a conversa
      expect(await saldo(f)).toBe(9);
      await admin`update whatsapp_inbound set next_attempt_at = '2000-01-01' where msg_id = ${mm.msgId}`;
      expect(await rodarUmaVez(d)).toBe(true);
      expect(fake.enviados).toHaveLength(1);
      expect(fake.enviados[0]!.texto).toContain("Anotado");
      l = await linha(mm.msgId);
      expect(l["status"]).toBe("feito");
      expect(await saldo(f)).toBe(9); // continua uma baixa só
      expect(await rodarUmaVez(d)).toBe(false);
    });

    it("falha AMBÍGUA do provedor (sem resposta) não reenvia: melhor perder do que responder em dobro", async () => {
      const f = await novaFamilia("Ambig");
      const fake = criarFake();
      fake.falharProximos(1, false);
      const { d } = deps({ fake });
      const mm = msgTexto(f.adminPhone, "estoque");
      await entra(mm);
      await rodarUmaVez(d);
      expect(fake.enviados).toHaveLength(0);
      expect((await linha(mm.msgId))["status"]).toBe("feito");
      expect(await rodarUmaVez(d)).toBe(false);
      expect(fake.enviados).toHaveLength(0);
    });

    it("queda do processo DEPOIS de marcar 'enviado': a recuperação conclui sem enviar de novo", async () => {
      const f = await novaFamilia("Queda");
      const { d, fake } = deps();
      const mm = msgTexto(f.adminPhone, "estoque");
      await entra(mm);
      await admin`update whatsapp_inbound set status = 'processando', stage = 'enviado', response_text = 'x', locked_until = '2000-01-01', attempts = 1 where msg_id = ${mm.msgId}`;
      expect(await rodarUmaVez(d)).toBe(true);
      expect(fake.enviados).toHaveLength(0);
      expect((await linha(mm.msgId))["status"]).toBe("feito");
    });

    it("erros repetidos viram 'erro' visível no fim e a pessoa recebe o aviso de instabilidade UMA vez", async () => {
      const f = await novaFamilia("Erro");
      const { d, fake } = deps();
      const mm: MensagemRecebida = { ...msgTexto(f.adminPhone, "tomei"), tipo: "texto" };
      await entra(mm);
      // payload ausente = falha de processamento a cada tentativa
      await admin`update whatsapp_inbound set payload = null where msg_id = ${mm.msgId}`;
      for (let n = 0; n < MAX_TENTATIVAS; n++) {
        await admin`update whatsapp_inbound set next_attempt_at = '2000-01-01' where msg_id = ${mm.msgId}`;
        await rodarUmaVez(d);
      }
      const l = await linha(mm.msgId);
      expect(l["status"]).toBe("erro");
      expect(String(l["error_summary"])).toContain("sem payload");
      expect(fake.enviados.filter((e) => e.texto.includes("instabilidade"))).toHaveLength(1);
    });

    it("remetente desconhecido ou só com número PENDENTE: resposta genérica igual, nada registrado", async () => {
      const f = await novaFamilia("Desc");
      const pend = await pessoa(f.familyId, "Familiar", "Pendente", { phone: null, pending: telefoneAleatorio() });
      const { d } = deps();
      const desconhecido = await processarEntrada(msgTexto(telefoneAleatorio(), "tomei"), d.nucleo);
      const [p] = await admin`select phone_pending from members where id = ${pend.id}`;
      const pendente = await processarEntrada(msgTexto(p!["phone_pending"] as string, "tomei"), d.nucleo);
      expect(desconhecido.origem).toBe("recusa");
      expect(pendente.respostas).toEqual(desconhecido.respostas);
      expect(await saldo(f)).toBe(10);
      const [log] = await admin`select count(*)::int as n from message_log where family_id = ${f.familyId}`;
      expect(log!["n"]).toBe(0);
    });

    it("desconhecido também não gasta IA nem baixa mídia (mídia recebe a resposta genérica)", async () => {
      const { modelo, pedidos } = roteiro([fala("não deveria")]);
      const l = leitor("tomei");
      const { d } = deps({ modelo, midia: l });
      const r = await processarEntrada(msgMidia(telefoneAleatorio(), "audio"), d.nucleo);
      expect(r.origem).toBe("recusa");
      expect(pedidos).toHaveLength(0);
      expect(l.chamadas).toBe(0);
    });

    it("verificação de posse: o dono do número envia o código do portal e o número vira verificado", async () => {
      const f = await novaFamilia("Posse");
      const novo = await pessoa(f.familyId, "Familiar", "Rosa", { phone: null });
      const numero = telefoneAleatorio();
      const ctx = { ...actorDe(f.familyId, novo.id, "Familiar", "Rosa"), } as unknown as Parameters<typeof startPhoneVerification>[0];
      const v = await startPhoneVerification(ctx, numero);
      const { d } = deps();
      const errado = await processarEntrada(msgTexto(numero, "000000"), d.nucleo);
      expect(errado.intent).toBe("codigo_invalido");
      const certo = await processarEntrada(msgTexto(numero, `CÓDIGO ${v.code}`), d.nucleo);
      expect(certo.intent).toBe("numero_verificado");
      const [m] = await admin`select phone_verified from members where id = ${novo.id}`;
      expect(m!["phone_verified"]).toBe(numero);
    });

    it("PARAR e REATIVAR: por membro, sem modelo; quem PAROU não recebe avisos agendados mas continua sendo atendido", async () => {
      const f = await novaFamilia("Parar");
      const outro = await pessoa(f.familyId, "Familiar", "Outro");
      const { modelo, pedidos } = roteiro([fala("não deveria ser chamado")]);
      const { d } = deps({ modelo });
      expect((await pendentes(f.familyId, { reivindicar: false, agora: T0610 })).map((x) => x.membroId)).toEqual(expect.arrayContaining([f.adminId, outro.id]));

      const p = await processarEntrada(msgTexto(f.adminPhone, "PARAR"), d.nucleo);
      expect(p).toMatchObject({ origem: "comando", intent: "parar" });
      expect(p.respostas[0]).toContain("Avisos pausados");
      expect(await optOut(f.adminId)).not.toBeNull();
      expect(await optOut(outro.id)).toBeNull(); // só ele
      const depois = (await pendentes(f.familyId, { reivindicar: false, agora: T0610 })).map((x) => x.membroId);
      expect(depois).not.toContain(f.adminId);
      expect(depois).toContain(outro.id);
      // continua sendo atendido quando escreve
      expect((await processarEntrada(msgTexto(f.adminPhone, "estoque"), d.nucleo)).respostas[0]).toContain(f.medName);

      const r = await processarEntrada(msgTexto(f.adminPhone, "reativar"), d.nucleo);
      expect(r).toMatchObject({ origem: "comando", intent: "reativar" });
      expect(await optOut(f.adminId)).toBeNull();
      expect((await pendentes(f.familyId, { reivindicar: false, agora: T0610 })).map((x) => x.membroId)).toContain(f.adminId);
      expect(pedidos).toHaveLength(0);
    });

    it("PARAR só vale como mensagem INTEIRA digitada (frases e áudio não viram comando)", async () => {
      expect(comandoDeAvisos("PARAR")).toBe("parar");
      expect(comandoDeAvisos("  Parar avisos! ")).toBe("parar");
      expect(comandoDeAvisos("Reativar")).toBe("reativar");
      expect(comandoDeAvisos("quero parar de tomar o remédio")).toBeNull();
      expect(comandoDeAvisos("não pare")).toBeNull();
      const f = await novaFamilia("ParAud");
      const { d } = deps({ midia: leitor("parar"), modelo: roteiro([fala("Posso ajudar com os remédios.")]).modelo });
      await processarEntrada(msgMidia(f.adminPhone, "audio"), d.nucleo);
      expect(await optOut(f.adminId)).toBeNull();
    });

    it("áudio 'como está o estoque': transcrito pelo Gemini e respondido SEM IA; uso do Gemini registrado", async () => {
      const f = await novaFamilia("Audio");
      const { modelo, pedidos } = roteiro([fala("x")]);
      const l = leitor("como está o estoque?");
      const { d } = deps({ modelo, midia: l });
      const mm = msgMidia(f.adminPhone, "audio");
      const r = await processarEntrada(mm, d.nucleo);
      expect(r.origem).toBe("conversa");
      expect(r.respostas[0]).toContain(f.medName);
      expect(pedidos).toHaveLength(0);
      const uso = await admin`select * from ai_usage where family_id = ${f.familyId} and operation = 'audio'`;
      expect(uso).toHaveLength(1);
      expect(uso[0]!["provider"]).toBe("google");
    });

    it("áudio 'tomei' NÃO confirma dose (transcrição pode errar): pede a confirmação por texto", async () => {
      const f = await novaFamilia("AudTomei");
      const { d } = deps({ midia: leitor("tomei o remédio") });
      const r = await processarEntrada(msgMidia(f.adminPhone, "audio"), d.nucleo);
      expect(r.intent).toBe("audio_escrita_pede_texto");
      expect(r.respostas[0]).toContain("confirme por texto");
      expect(await saldo(f)).toBe(10);
    });

    it("mídia que falha: aviso amigável, sem chamar o modelo; mídia grande recusada pelo provedor; sem Gemini configurado", async () => {
      const f = await novaFamilia("MidFalha");
      const { modelo, pedidos } = roteiro([fala("x")]);
      const { d } = deps({ modelo, midia: leitor(null) });
      expect((await processarEntrada(msgMidia(f.adminPhone, "audio"), d.nucleo)).respostas[0]).toContain("Não consegui entender o áudio");
      expect((await processarEntrada(msgMidia(f.adminPhone, "imagem"), d.nucleo)).respostas[0]).toContain("Não consegui ler a foto");
      expect((await processarEntrada(msgMidia(f.adminPhone, "audio", { base64: "", midiaRef: null }), d.nucleo)).respostas[0]).toContain("Não consegui abrir");
      expect((await processarEntrada({ ...msgMidia(f.adminPhone, "imagem"), tipo: "recusa", aviso: "foto_grande", base64: "" }, d.nucleo)).respostas[0]).toContain("grande demais");
      const semGemini = deps({ modelo, midia: null });
      expect((await processarEntrada(msgMidia(f.adminPhone, "audio"), semGemini.d.nucleo)).respostas[0]).toContain("Não consegui entender o áudio");
      expect((await processarEntrada({ ...msgTexto(f.adminPhone, ""), tipo: "outro" }, d.nucleo)).respostas[0]).toContain("só entendo texto");
      expect(pedidos).toHaveLength(0);
    });

    it("mídia sem base64 mas com referência: o worker pede o download ao provedor", async () => {
      const f = await novaFamilia("Baixa");
      const l = leitor("próximas doses");
      const baixou: unknown[] = [];
      const { d } = deps({ midia: l });
      const nucleo: DepsNucleo = { ...d.nucleo, baixarMidia: async (ref) => { baixou.push(ref); return { base64: "QUJD", mimetype: "audio/ogg" }; } };
      const r = await processarEntrada({ ...msgMidia(f.adminPhone, "audio", { base64: "", midiaRef: { audioMessage: { seconds: 3 } } }) }, nucleo);
      expect(baixou).toHaveLength(1);
      expect(r.respostas[0]).toMatch(/Próximas doses|pendente/i);
    });

    it("ambiguidade continua com opções numeradas e o estoque só baixa na escolha (núcleo do 4A pelo worker)", async () => {
      const f = await novaFamilia("Ambi");
      const { d } = deps();
      const agora14 = new Date("2026-10-19T17:10:00Z");
      const nucleo: DepsNucleo = { ...d.nucleo, agora: () => agora14, agente: { ...d.nucleo.agente, agora: () => agora14 } };
      const r = await processarEntrada(msgTexto(f.adminPhone, "tomei"), nucleo);
      expect(r.respostas[0]).toContain("Qual dose");
      expect(await saldo(f)).toBe(10);
      const e = await processarEntrada(msgTexto(f.adminPhone, "1"), nucleo);
      expect(e.respostas[0]).toContain("Anotado");
      expect(await saldo(f)).toBe(9);
    });

    it("convite por WhatsApp e código de verificação continuam passando pelo mesmo caminho (remetente sem acesso só aceita códigos)", async () => {
      const { d } = deps();
      const r = await processarEntrada(msgTexto(telefoneAleatorio(), "oi, tudo bem?"), d.nucleo);
      expect(r.origem).toBe("recusa");
    });

    it("dois workers em paralelo nunca respondem duas vezes à mesma mensagem", async () => {
      const f = await novaFamilia("Par");
      const fake = criarFake();
      const a = deps({ fake }).d, b = deps({ fake }).d;
      const mm = msgTexto(f.adminPhone, "estoque");
      await entra(mm);
      const [x, y] = await Promise.all([rodarUmaVez(a), rodarUmaVez(b)]);
      expect([x, y].filter(Boolean)).toHaveLength(1);
      expect(fake.enviados).toHaveLength(1);
    });

    it("laço do worker: processa a fila sozinho e para quando pedido", async () => {
      const f = await novaFamilia("Laco");
      const fake = criarFake();
      const { d } = deps({ fake });
      const mm = msgTexto(f.adminPhone, "estoque");
      await entra(mm);
      const w = iniciarWorkerEntrada(d, { concorrencia: 1, intervaloOciosoMs: 10 });
      for (let i = 0; i < 100 && fake.enviados.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
      await w.parar();
      expect(fake.enviados).toHaveLength(1);
    });

    it("processarItem sem payload falha com motivo (para o recuo agir)", async () => {
      const { d } = deps();
      await expect(processarItem({ id: randomUUID(), msgId: "x", telefone: "5511", payload: null, etapa: "novo", respostaTexto: null, respostaOrigem: null, tentativas: 1 }, d)).rejects.toThrow(/payload/);
    });
  });

  /* ------------------------------------------------------------ agente de IA */
  describe("agente de IA (modelo simulado, só leitura)", () => {
    const agente = (modelo: ChamarModelo | null, extra: Partial<DepsAgente> = {}): DepsAgente => ({ modelo, agora: () => T0610, ...extra });

    it("pergunta livre: escolhe a ferramenta de leitura certa, com os argumentos certos, e responde com o dado dela", async () => {
      const f = await novaFamilia("Livre");
      const a = await actorAdmin(f);
      const { modelo, pedidos } = roteiro([usa("consultar_estoque", { remedio: f.medName }), fala(`O ${f.medName} tem estoque para alguns dias.`)]);
      const r = await responderLivre(a, `E o ${f.medName}, vai acabar?`, "zz-livre-1", agente(modelo));
      expect(r).toMatchObject({ motivo: "ok", texto: expect.stringContaining("estoque") });
      expect(pedidos).toHaveLength(2);
      // pedido 1: ferramentas SÓ de leitura, system constante, pergunta e contexto nas mensagens
      expect(pedidos[0]!.model).toBe("claude-sonnet-5-5");
      expect((pedidos[0]!.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(["consultar_estoque", "proximas_doses", "doses_do_dia", "status_da_dose", "reposicoes_abertas", "receita_vigente"]);
      expect(JSON.stringify(pedidos[0]!.messages)).toContain("vai acabar?");
      expect(pedidos[0]!.system[0]!.cache_control).toEqual({ type: "ephemeral" });
      // pedido 2: o resultado da ferramenta volta ao modelo, com os dados reais do banco
      const volta = JSON.stringify(pedidos[1]!.messages.at(-1));
      expect(volta).toContain("tool_result");
      expect(volta).toContain("diasRestantes");
      expect(volta).toContain(f.patientName);
    });

    it("registra uso e custo por família (cada chamada ao modelo) e guarda só TEXTO na memória", async () => {
      const f = await novaFamilia("Uso");
      const a = await actorAdmin(f);
      const { modelo } = roteiro([usa("proximas_doses", {}), fala("A próxima é às 06:00.")]);
      await responderLivre(a, "qual a próxima?", "zz-uso-1", agente(modelo));
      const uso = await admin`select * from ai_usage where family_id = ${f.familyId} and operation = 'conversa' order by created_at`;
      expect(uso).toHaveLength(2);
      expect(uso[0]).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5", input_tokens: 1200, output_tokens: 150, cost_micros: 3900, estimated: false });
      const r = await resumoDeUso(f.familyId, TZ, T0610);
      expect(r.usadoMicros).toBe(7800);
      const [sess] = await admin`select turns from agent_sessions where family_id = ${f.familyId}`;
      const turns = sess!["turns"] as Array<{ role: string; text: string }>;
      expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
      expect(JSON.stringify(turns)).not.toContain("tool_use");
      // a conversa seguinte leva o histórico curto
      const seg = roteiro([fala("Ok.")]);
      await responderLivre(a, "e depois dela?", "zz-uso-2", agente(seg.modelo));
      expect(JSON.stringify(seg.pedidos[0]!.messages)).toContain("qual a próxima?");
    });

    it("medir de novo a mesma chamada não duplica o custo (idempotente por mensagem)", async () => {
      const f = await novaFamilia("UsoIdem");
      const a = await actorAdmin(f);
      for (let i = 0; i < 2; i++) await responderLivre(a, "oi", "zz-idem", agente(roteiro([fala("Olá!")]).modelo));
      expect((await admin`select count(*)::int as n from ai_usage where family_id = ${f.familyId}`)[0]!["n"]).toBe(1);
    });

    it("sem ANTHROPIC_API_KEY: 'o assistente de perguntas está indisponível' e o resto funciona", async () => {
      const f = await novaFamilia("SemChave");
      const { d } = deps({ modelo: null });
      const livre = await processarEntrada(msgTexto(f.adminPhone, "conte uma piada sobre remédios"), d.nucleo);
      expect(livre.respostas[0]).toContain("assistente de perguntas está indisponível");
      expect((await processarEntrada(msgTexto(f.adminPhone, "estoque"), d.nucleo)).respostas[0]).toContain(f.medName);
      expect((await processarEntrada(msgTexto(f.adminPhone, "tomei"), d.nucleo)).respostas[0]).toContain("Anotado");
    });

    it("erro do modelo vira mensagem amigável, sem detalhe técnico", async () => {
      const f = await novaFamilia("ErroModelo");
      const a = await actorAdmin(f);
      for (const status of [500, 429, 401, 0]) {
        const r = await responderLivre(a, "uma pergunta", `zz-err-${status}`, agente(async () => ({ status, body: null })));
        expect(r.motivo).toBe("erro_modelo");
        expect(r.texto).toContain("Não consegui responder agora");
        expect(r.texto).not.toMatch(/\d{3}|anthropic|erro \d/i);
      }
      const recusa = await responderLivre(a, "x", "zz-ref", agente(async () => ({ status: 200, body: { content: [], stop_reason: "refusal", usage: USO } })));
      expect(recusa.motivo).toBe("recusa");
    });

    it("laço de ferramentas tem limite de iterações", async () => {
      const f = await novaFamilia("Laco2");
      const a = await actorAdmin(f);
      const { modelo, pedidos } = roteiro([usa("proximas_doses", {})]);
      const r = await responderLivre(a, "x", "zz-lim-iter", agente(modelo, { maxIteracoes: 3 }));
      expect(r.motivo).toBe("limite_iteracoes");
      expect(pedidos).toHaveLength(3);
    });

    it("ferramenta desconhecida ou de ESCRITA inventada pelo modelo é recusada e nada muda", async () => {
      const f = await novaFamilia("Escrita");
      const a = await actorAdmin(f);
      const { modelo } = roteiro([usa("confirmar_dose", { doseId: f.doses[0], telefone: "5511999999999" }), fala("Não consigo confirmar por aqui.")]);
      const r = await responderLivre(a, "confirma a dose pra mim", "zz-esc", agente(modelo));
      expect(r.motivo).toBe("ok");
      expect(await saldo(f)).toBe(10);
      const x = await executarFerramenta(a, "confirmar_dose", { doseId: f.doses[0] }, T0610);
      expect(x).toMatchObject({ erro: true });
      const [d] = await admin`select status from dose_events where id = ${f.doses[0]!}`;
      expect(d!["status"]).not.toBe("taken");
    });

    it("limite mensal: ao estourar, o agente pausa, avisa o administrador UMA vez e o caminho determinístico segue", async () => {
      const f = await novaFamilia("Limite");
      await definirLimiteMensal(f.familyId, 0.005); // US$ 0,005 = 5000 micros
      const a = await actorAdmin(f);
      const m1 = roteiro([fala("Primeira resposta.")]); // custa 3900 micros: ainda abaixo
      expect((await responderLivre(a, "pergunta 1", "zz-l1", agente(m1.modelo))).motivo).toBe("ok");
      const m2 = roteiro([fala("Segunda resposta.")]); // leva a 7800: estoura
      expect((await responderLivre(a, "pergunta 2", "zz-l2", agente(m2.modelo))).motivo).toBe("ok");
      const m3 = roteiro([fala("não deve chamar")]);
      const bloqueado = await responderLivre(a, "pergunta 3", "zz-l3", agente(m3.modelo));
      expect(bloqueado).toMatchObject({ motivo: "pausado", texto: expect.stringContaining("pausado") });
      expect(m3.pedidos).toHaveLength(0); // nenhuma chamada paga depois do limite
      await responderLivre(a, "pergunta 4", "zz-l4", agente(m3.modelo));
      const avisos = await admin`select * from notifications where family_id = ${f.familyId} and payload->>'alerta' = 'ia_limite'`;
      expect(avisos).toHaveLength(1);
      expect(avisos[0]!["member_id"]).toBe(f.adminId);
      // caminho determinístico intacto
      const { d } = deps({ modelo: m3.modelo });
      expect((await processarEntrada(msgTexto(f.adminPhone, "tomei"), d.nucleo)).respostas[0]).toContain("Anotado");
    });

    it("limite 0 pausa o assistente desde a primeira pergunta; o padrão do ambiente vale sem configuração própria", async () => {
      const f = await novaFamilia("LimZero");
      const a = await actorAdmin(f);
      expect((await resumoDeUso(f.familyId, TZ, T0610)).limiteMicros).toBe(5_000_000);
      await definirLimiteMensal(f.familyId, 0);
      const m = roteiro([fala("x")]);
      expect((await responderLivre(a, "oi", "zz-z0", agente(m.modelo))).motivo).toBe("pausado");
      expect(m.pedidos).toHaveLength(0);
    });

    it("system e ferramentas são CONSTANTES entre famílias (prompt caching); o que varia fica só nas mensagens", async () => {
      const f1 = await novaFamilia("Cache1"), f2 = await novaFamilia("Cache2");
      const r1 = roteiro([fala("a")]), r2 = roteiro([fala("b")]);
      await responderLivre(await actorAdmin(f1), "pergunta da família 1", "zz-c1", agente(r1.modelo));
      await responderLivre(await actorAdmin(f2), "pergunta da família 2", "zz-c2", agente(r2.modelo));
      const [p1, p2] = [r1.pedidos[0]!, r2.pedidos[0]!];
      expect(JSON.stringify(p1.system)).toBe(JSON.stringify(p2.system));
      expect(JSON.stringify(p1.tools)).toBe(JSON.stringify(p2.tools));
      expect(JSON.stringify(p1.messages)).not.toBe(JSON.stringify(p2.messages));
      expect(JSON.stringify(p1.system)).not.toContain(f1.familyId);
      // só o último bloco da última mensagem leva o ponto de cache
      const blocos = p1.messages.at(-1)!.content as Array<{ cache_control?: unknown }>;
      expect(blocos.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
    });

    it("a ferramenta respeita o RLS: a família A nunca lê dados da B (nem pedindo pelo nome do paciente da B)", async () => {
      const A = await novaFamilia("RlsA"), B = await novaFamilia("RlsB");
      const a = await actorAdmin(A);
      const todos = await executarFerramenta(a, "consultar_estoque", {}, T0610);
      expect(todos.erro).toBe(false);
      expect(todos.conteudo).toContain(A.patientName);
      expect(todos.conteudo).not.toContain(B.patientName);
      const pedindoB = await executarFerramenta(a, "consultar_estoque", { paciente: B.patientName, remedio: B.medName }, T0610);
      expect(JSON.parse(pedindoB.conteudo)).toMatchObject({ itens: [], total: 0 });
      for (const t of ["proximas_doses", "doses_do_dia", "status_da_dose", "reposicoes_abertas", "receita_vigente"]) {
        const x = await executarFerramenta(a, t, { paciente: B.patientName }, T0610);
        expect(x.conteudo, t).not.toContain(B.patientName);
        expect(x.conteudo, t).not.toContain(B.medName);
      }
    });

    it("telefone e membro NUNCA são parâmetro: campos extras do modelo são descartados", async () => {
      const A = await novaFamilia("ParamA"), B = await novaFamilia("ParamB");
      const a = await actorAdmin(A);
      const x = await executarFerramenta(a, "proximas_doses", { telefone: B.adminPhone, membro: B.adminId, familia: B.familyId, familyId: B.familyId }, T0610);
      expect(x.conteudo).toContain(A.patientName);
      expect(x.conteudo).not.toContain(B.patientName);
    });

    it("a ferramenta respeita a permissão do membro: sem 'ver estoque' ou sem acesso completo, nada é lido", async () => {
      const f = await novaFamilia("Perm");
      const conf = await pessoa(f.familyId, "Confirmador", "Confirmador");
      const actorConf = (await resolveSender(conf.phone!))!;
      const est = await executarFerramenta(actorConf, "consultar_estoque", {}, T0610);
      expect(est.erro).toBe(true);
      expect(est.conteudo).toContain("permissão");
      expect(est.conteudo).not.toContain(f.patientName);
      expect((await executarFerramenta(actorConf, "reposicoes_abertas", {}, T0610)).erro).toBe(true);
      expect((await executarFerramenta(actorConf, "receita_vigente", {}, T0610)).erro).toBe(true);
      // quem só validou o WhatsApp não lê receitas, mesmo com perfil de Administrador
      const wa = await pessoa(f.familyId, "Administrador", "SoWhatsapp", { state: "whatsapp_verified" });
      const actorWa = (await resolveSender(wa.phone!))!;
      const rx = await executarFerramenta(actorWa, "receita_vigente", {}, T0610);
      expect(rx.erro).toBe(true);
      expect((await executarFerramenta(actorWa, "consultar_estoque", {}, T0610)).erro).toBe(false);
    });

    it("pergunta livre pelo núcleo: passa pelo agente só depois de o código não entender; confirmar dose nunca vai ao modelo", async () => {
      const f = await novaFamilia("Nucleo");
      const { modelo, pedidos } = roteiro([fala("Posso ajudar com os remédios da família.")]);
      const { d } = deps({ modelo });
      const livre = await processarEntrada(msgTexto(f.adminPhone, "qual a capital da França?"), d.nucleo);
      expect(livre).toMatchObject({ origem: "agente" });
      expect(pedidos).toHaveLength(1);
      await processarEntrada(msgTexto(f.adminPhone, "tomei"), d.nucleo);
      await processarEntrada(msgTexto(f.adminPhone, "estoque"), d.nucleo);
      await processarEntrada(msgTexto(f.adminPhone, "próximas doses"), d.nucleo);
      expect(pedidos).toHaveLength(1); // nada disso chegou ao modelo
    });

    it("foto: a leitura da imagem (texto) é o que chega ao Claude; nada é confirmado a partir de foto", async () => {
      const f = await novaFamilia("Foto");
      const { modelo, pedidos } = roteiro([fala("Vi o nome de um remédio, mas não posso orientar o uso.")]);
      const { d } = deps({ modelo, midia: leitor("Caixa de remédio: tomei 1 comprimido") });
      const r = await processarEntrada(msgMidia(f.adminPhone, "imagem"), d.nucleo);
      expect(r.origem).toBe("agente");
      expect(JSON.stringify(pedidos[0]!.messages)).toContain("Caixa de remédio");
      expect(JSON.stringify(pedidos[0]!.messages)).not.toContain("QUJD"); // o base64 nunca vai ao Claude
      expect(await saldo(f)).toBe(10);
      expect((await admin`select 1 from ai_usage where family_id = ${f.familyId} and operation = 'imagem'`)).toHaveLength(1);
    });
  });

  /* ------------------------------------------------------------ agendador e saída */
  describe("agendador: lembretes e avisos pelo mesmo worker", () => {
    const novoRitmo = () => criarRitmo({ relogio: relogioFalso(), maxPorMinuto: 1000, maxPorHora: 10000 });

    it("lembrete de dose na hora: sai uma vez, só para número verificado, com 'digitando…'; rodar de novo não repete", async () => {
      const f = await novaFamilia("Lemb");
      const pend = await pessoa(f.familyId, "Familiar", "SemNumero", { phone: null, pending: telefoneAleatorio() });
      const fake = criarFake();
      const r1 = await enviarPendentes(fake, novoRitmo(), { agora: () => T0610, somenteFamilia: f.familyId });
      expect(r1.enviadas).toBeGreaterThan(0);
      const para = fake.enviados.map((e) => e.numero);
      expect(para).toContain(f.adminPhone);
      expect(fake.enviados.find((e) => e.numero === f.adminPhone)!.texto).toContain("Hora do remédio");
      expect(fake.presencas.length).toBe(fake.enviados.length);
      const [p] = await admin`select phone_pending from members where id = ${pend.id}`;
      expect(para).not.toContain(p!["phone_pending"]);
      const n = fake.enviados.length;
      const r2 = await enviarPendentes(fake, novoRitmo(), { agora: () => T0610, somenteFamilia: f.familyId });
      expect(r2.enviadas).toBe(0);
      expect(fake.enviados).toHaveLength(n);
    });

    it("quem PAROU não recebe o lembrete; dose já resolvida no portal sai da fila", async () => {
      const f = await novaFamilia("LembParou");
      await withFamilia(f.familyId, (tx) => tx.update(s.members).set({ whatsappOptOutAt: new Date() }).where(eq(s.members.id, f.adminId)));
      const fake = criarFake();
      await enviarPendentes(fake, novoRitmo(), { agora: () => T0610, somenteFamilia: f.familyId });
      expect(fake.enviados).toHaveLength(0);
    });

    it("dose esquecida (2 h depois), estoque baixo e resumo diário: tipos certos, sem repetir, com relógio injetável", async () => {
      const f = await novaFamilia("Tipos");
      const fake = criarFake();
      const tipos = async (agora: Date) => {
        await gerarMensagens(f.familyId, agora);
        return (await admin`select kind from outbound_messages where family_id = ${f.familyId} order by created_at`).map((r) => r["kind"] as string);
      };
      expect(await tipos(T0610)).toContain("dose_reminder");
      const tarde = new Date("2026-10-19T12:30:00Z"); // 09:30: a das 06:00 passou de 2 h
      expect(await tipos(tarde)).toContain("dose_missed");
      const noite = new Date("2026-10-19T23:30:00Z"); // 20:30: horário do resumo
      expect(await tipos(noite)).toContain("daily_summary");
      const antes = (await tipos(noite)).length;
      expect((await tipos(noite)).length).toBe(antes); // dedupe
      void fake;
    });

    it("receita vencendo e reposição (avisos do sino) saem pelo WhatsApp só para acesso completo, uma vez", async () => {
      const f = await novaFamilia("Avisos");
      await withFamilia(f.familyId, async (tx) => {
        await tx.insert(s.notifications).values([
          { familyId: f.familyId, memberId: f.adminId, kind: "prescription_expiring", title: "Receita vence em 7 dias", body: "Zypred", payload: {}, dedupeKey: "zz-rx-1", createdAt: T0610 },
          { familyId: f.familyId, memberId: f.adminId, kind: "replenishment_update", title: "Reposição: comprado", body: "Zypred", payload: {}, dedupeKey: "zz-rep-1", createdAt: T0610 },
        ]);
      });
      await gerarMensagens(f.familyId, T0610);
      await gerarMensagens(f.familyId, T0610);
      const rows = await admin`select kind from outbound_messages where family_id = ${f.familyId} and kind in ('rx_expiring','replenishment')`;
      expect(rows.map((r) => r["kind"]).sort()).toEqual(["replenishment", "rx_expiring"]);
    });

    it("falha CLARA no envio: recuo, nova tentativa sem duplicar e, no limite, erro visível (sem laço)", async () => {
      const f = await novaFamilia("FalhaSaida");
      const fake = criarFake();
      let agora = T0610;
      fake.falharProximos(1, true);
      const r1 = await enviarPendentes(fake, novoRitmo(), { agora: () => agora, somenteFamilia: f.familyId });
      expect(r1.falhas).toBe(1);
      const [m] = await admin`select * from outbound_messages where family_id = ${f.familyId} and kind = 'dose_reminder'`;
      expect(m).toMatchObject({ send_attempts: 1 });
      expect(m!["sent_at"]).toBeNull();
      expect(String(m!["error_summary"])).not.toContain("Hora do remédio");
      // dentro do recuo nada acontece
      const r2 = await enviarPendentes(fake, novoRitmo(), { agora: () => agora, somenteFamilia: f.familyId });
      expect(r2.enviadas).toBe(0);
      agora = new Date(agora.getTime() + 2 * 60_000);
      const r3 = await enviarPendentes(fake, novoRitmo(), { agora: () => agora, somenteFamilia: f.familyId });
      expect(r3.enviadas).toBeGreaterThan(0);
      const lembretes = fake.enviados.filter((e) => e.numero === f.adminPhone && e.texto.includes("Hora do remédio"));
      expect(lembretes).toHaveLength(1);
    });

    it("falhas definitivas viram erro visível e param de ser tentadas", async () => {
      const f = await novaFamilia("Definitiva");
      const fake = criarFake();
      fake.falharProximos(1000, true);
      let agora = T0610;
      for (let i = 0; i < 8; i++) {
        await enviarPendentes(fake, novoRitmo(), { agora: () => agora, somenteFamilia: f.familyId });
        agora = new Date(agora.getTime() + 40 * 60_000);
      }
      const resumo = await resumoSaida(f.familyId);
      expect(resumo.comErro).toBeGreaterThan(0);
      expect(resumo.ultimosErros[0]!.motivo).not.toContain("Hora do remédio");
      fake.falharProximos(0);
      const depois = await enviarPendentes(fake, novoRitmo(), { agora: () => agora, somenteFamilia: f.familyId });
      expect(depois.enviadas).toBe(0); // erro definitivo não volta para a fila
    });

    it("falha AMBÍGUA no envio agendado não reenvia", async () => {
      const f = await novaFamilia("AmbigSaida");
      const fake = criarFake();
      fake.falharProximos(1, false);
      const r1 = await enviarPendentes(fake, novoRitmo(), { agora: () => T0610, somenteFamilia: f.familyId });
      expect(r1.ambiguas).toBe(1);
      const r2 = await enviarPendentes(fake, novoRitmo(), { agora: () => new Date(T0610.getTime() + 5 * 60_000), somenteFamilia: f.familyId });
      expect(r2.enviadas).toBe(0);
    });

    it("duas instâncias enviando ao mesmo tempo: cada lembrete sai uma só vez", async () => {
      const f = await novaFamilia("DuasInst");
      const fake = criarFake();
      await Promise.all([
        enviarPendentes(fake, novoRitmo(), { agora: () => T0610, somenteFamilia: f.familyId }),
        enviarPendentes(fake, novoRitmo(), { agora: () => T0610, somenteFamilia: f.familyId }),
      ]);
      const meus = fake.enviados.filter((e) => e.numero === f.adminPhone && e.texto.includes("Hora do remédio"));
      expect(meus).toHaveLength(1);
    });
  });

  /* ------------------------------------------------------------ líder, alertas e estado */
  describe("líder único (trava consultiva), alertas e estado", () => {
    it("só UMA instância é líder do agendador: a segunda não consegue; solta, outra assume", async () => {
      const nome = `zz-teste-${randomUUID()}`;
      const a = await tentarTravaConsultiva(nome);
      expect(a).not.toBeNull();
      expect(await tentarTravaConsultiva(nome)).toBeNull();
      expect(await a!.aindaMinha()).toBe(true);
      await a!.liberar();
      const b = await tentarTravaConsultiva(nome);
      expect(b).not.toBeNull();
      await b!.liberar();
    });

    it("ciclo do agendador: o líder envia e registra o batimento; quem não é líder não faz nada", async () => {
      const f = await novaFamilia("Ciclo");
      const fake = criarFake();
      const estado = { trava: null, ultimaLimpeza: Date.now(), ultimoMonitor: Date.now() };
      let nega = true;
      const base = { provedor: fake, ritmo: criarRitmo({ relogio: relogioFalso() }), agora: () => T0610, somenteFamilia: f.familyId, tentarTrava: async () => (nega ? null : ({ aindaMinha: async () => true, liberar: async () => {} })) };
      expect(await cicloAgendador(base, estado)).toBe(false);
      nega = false;
      expect(await cicloAgendador(base, estado)).toBe(true);
      const w = await lerRuntime<{ lider: boolean; provedor: string }>("worker");
      expect(w).toMatchObject({ lider: true, provedor: "fake" });
      expect(fake.enviados.some((e) => e.numero === f.adminPhone)).toBe(true);
    });

    it("instância desconectada por mais de 2 min alerta os administradores UMA vez; ao voltar, avisa de novo uma vez", async () => {
      const f = await novaFamilia("Instancia");
      const fake = criarFake();
      const inicio = new Date();
      fake.conectada = false;
      await monitorarInstancia(fake, inicio);
      const sino = () => admin`select title from notifications where family_id = ${f.familyId} and member_id = ${f.adminId} and payload->>'alerta' like 'wa_%'`;
      expect(await sino()).toHaveLength(0); // ainda dentro do prazo
      await monitorarInstancia(fake, new Date(inicio.getTime() + 3 * 60_000));
      await monitorarInstancia(fake, new Date(inicio.getTime() + 6 * 60_000));
      expect((await sino()).map((r) => r["title"])).toEqual(["WhatsApp do sistema desconectado"]);
      expect((await lerRuntime<{ conectada: boolean; alertada: boolean }>("instancia"))).toMatchObject({ conectada: false, alertada: true });
      fake.conectada = true;
      await monitorarInstancia(fake, new Date(inicio.getTime() + 8 * 60_000));
      expect((await sino()).map((r) => r["title"]).sort()).toEqual(["WhatsApp do sistema desconectado", "WhatsApp do sistema reconectado"]);
    });

    it("provedor que não responde conta como desconectado; resposta de formato desconhecido (null) não alerta", async () => {
      const f = await novaFamilia("InstNull");
      const fake = criarFake();
      const t0 = new Date(Date.now() + 3_600_000);
      fake.conectada = null;
      await monitorarInstancia(fake, t0);
      await monitorarInstancia(fake, new Date(t0.getTime() + 10 * 60_000));
      expect(await admin`select 1 from notifications where family_id = ${f.familyId} and payload->>'alerta' like 'wa_%'`).toHaveLength(0);
    });

    it("5 falhas de envio SEGUIDAS alertam os administradores uma vez; um sucesso zera a contagem", async () => {
      const f = await novaFamilia("FalhasSeguidas");
      const t0 = new Date(Date.now() + 7_200_000);
      for (let i = 0; i < 4; i++) await registrarResultadoEnvio(false, new Date(t0.getTime() + i * 1000));
      await registrarResultadoEnvio(true, t0);
      for (let i = 0; i < 4; i++) await registrarResultadoEnvio(false, new Date(t0.getTime() + 60_000 + i * 1000));
      expect(await admin`select 1 from notifications where family_id = ${f.familyId} and payload->>'alerta' = 'wa_envio_falhando'`).toHaveLength(0);
      for (let i = 0; i < 3; i++) await registrarResultadoEnvio(false, new Date(t0.getTime() + 120_000 + i * 1000));
      expect(await admin`select 1 from notifications where family_id = ${f.familyId} and payload->>'alerta' = 'wa_envio_falhando'`).toHaveLength(1);
      await registrarResultadoEnvio(true, t0);
    });

    it("o estado do WhatsApp do sistema (worker, instância) não é visível fora da plataforma", async () => {
      const { getDb } = await import("@medcuidar/pg");
      expect(await getDb().select().from(s.whatsappRuntime)).toHaveLength(0);
    });

    it("o simulador usa a MESMA fila e o mesmo worker; o worker real nunca pega as mensagens dele", async () => {
      const f = await novaFamilia("Sim");
      const { conversarNoSimulador } = await import("./simulador");
      const r = await conversarNoSimulador(f.adminPhone, { texto: "estoque" });
      expect(r.respostas[0]!.texto).toContain(f.medName);
      expect(r.digitando).toBe(1);
      const [feito] = await admin`select status, payload from whatsapp_inbound where msg_id like 'sim-%' and phone = ${f.adminPhone}`;
      expect(feito).toMatchObject({ status: "feito", payload: null });
      // mensagem do simulador parada na fila não é reivindicada pelo worker real
      await enfileirar(msgTexto(f.adminPhone, "estoque", "sim-parada"));
      await admin`update whatsapp_inbound set next_attempt_at = '2000-01-01' where msg_id = 'sim-parada'`;
      expect(await reivindicar()).toBeNull();
      expect((await reivindicar(new Date(), { somenteMsgId: "sim-parada" }))?.msgId).toBe("sim-parada");
    });

    it("carga útil do webhook de áudio com base64 vira item com mídia, apagada ao concluir", async () => {
      const prov = criarEvolutionGo({ baseUrl: "https://e", apiKey: "k", instanceId: "00000000-0000-0000-0000-000000000001" });
      const id = `zz-${randomUUID()}`;
      const corpo = JSON.stringify({ ...fx.audio_com_base64, data: { ...fx.audio_com_base64.data, Info: { ...fx.audio_com_base64.data.Info, ID: id, Timestamp: new Date().toISOString() } } });
      await tratarWebhook(SEGREDO, corpo, prov);
      expect(JSON.stringify((await linha(id))["payload"])).toContain("T2dnUw");
      await admin`update whatsapp_inbound set next_attempt_at = '2000-01-01' where msg_id = ${id}`;
      const i = (await reivindicar())!;
      await concluir(i.id);
      expect((await linha(id))["payload"]).toBeNull();
    });
  });


  /* ------------------------------------------------------------ nono dígito (celular BR com ou sem o 9) */
  describe("celular brasileiro com e sem o 9 depois do DDD", () => {
    /** Celular de teste: as duas formas do MESMO número (DDD fictício 99, prefixo de 8 dígitos começando em 6-9). */
    const celular = () => {
      const oito = String(6 + Math.floor(Math.random() * 4)) + String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
      return { com: `55999${oito}`, sem: `5599${oito}` };
    };
    const definirNumero = (familyId: string, memberId: string, phone: string) =>
      withFamilia(familyId, (tx) => tx.update(s.members).set({ phoneVerified: phone }).where(eq(s.members.id, memberId)));
    const sendNumber = async (id: string) => ((await admin`select whatsapp_send_number from members where id = ${id}`)[0]!["whatsapp_send_number"] as string | null);
    const ritmoRapido = () => criarRitmo({ relogio: relogioFalso(), maxPorMinuto: 1000, maxPorHora: 10000 });

    it("variantesBr: celular com/sem o 9 tem as duas formas; fixo e estrangeiro, uma só", () => {
      const c = celular();
      expect(variantesBr(c.com)).toEqual([c.com, c.sem]);
      expect(variantesBr(c.sem)).toEqual([c.sem, c.com]);
      expect(variantesBr("551132345678")).toEqual(["551132345678"]);
      expect(variantesBr("14155550123")).toEqual(["14155550123"]);
    });

    it("cadastrado COM o 9, remetente chega SEM o 9 (e o contrário): o mesmo membro é reconhecido", async () => {
      const f = await novaFamilia("Nono1");
      const c = celular();
      await definirNumero(f.familyId, f.adminId, c.com);
      expect((await resolveSender(c.sem))?.memberId).toBe(f.adminId);
      expect((await resolveSender(c.com))?.memberId).toBe(f.adminId);
      expect((await resolveSender(c.sem))?.phone).toBe(c.com); // o número verificado continua o cadastrado
      const g = await novaFamilia("Nono2");
      const d = celular();
      await definirNumero(g.familyId, g.adminId, d.sem);
      expect((await resolveSender(d.com))?.memberId).toBe(g.adminId);
      const { d: dep } = deps();
      expect((await processarEntrada(msgTexto(d.com, "estoque"), dep.nucleo)).respostas[0]).toContain(g.medName);
    });

    it("ambiguidade (duas pessoas, uma de cada forma): AMBOS são recusados como desconhecidos, contados e logados SEM o número", async () => {
      const f = await novaFamilia("Ambig9");
      const outro = await pessoa(f.familyId, "Familiar", "Outro");
      const c = celular();
      await definirNumero(f.familyId, f.adminId, c.com);
      await definirNumero(f.familyId, outro.id, c.sem);
      const espiao = vi.spyOn(console, "warn").mockImplementation(() => {});
      const antes = contadores.remetenteAmbiguo;
      expect(await resolveSender(c.com)).toBeNull();
      expect(await resolveSender(c.sem)).toBeNull();
      const linhas = espiao.mock.calls.map((x) => String(x[0])).join("\n");
      espiao.mockRestore();
      expect(contadores.remetenteAmbiguo).toBe(antes + 2);
      expect(linhas).toContain("remetente_ambiguo");
      expect(linhas).not.toContain(c.com.slice(4));
      const { d } = deps();
      const r = await processarEntrada(msgTexto(c.com, "tomei"), d.nucleo);
      expect(r.origem).toBe("recusa");
      expect(await saldo(f)).toBe(10);
    });

    it("entre famílias: formas diferentes em famílias diferentes também são ambíguas e nada vaza", async () => {
      const A = await novaFamilia("NonoA"), B = await novaFamilia("NonoB");
      const c = celular();
      await definirNumero(A.familyId, A.adminId, c.com);
      await definirNumero(B.familyId, B.adminId, c.sem);
      expect(await resolveSender(c.com)).toBeNull();
      expect(await resolveSender(c.sem)).toBeNull();
      const { d, fake } = deps();
      const r = await processarEntrada(msgTexto(c.sem, "estoque"), d.nucleo);
      expect(r.respostas.join(" ")).not.toContain(A.medName);
      expect(r.respostas.join(" ")).not.toContain(B.medName);
      expect(fake.enviados).toHaveLength(0);
    });

    it("a variante NÃO sequestra o número de outra pessoa: com a outra forma já verificada, um código válido não verifica ninguém", async () => {
      const f = await novaFamilia("Sequestro");
      const dono = await pessoa(f.familyId, "Familiar", "Dono");
      const intruso = await pessoa(f.familyId, "Familiar", "Intruso", { phone: null });
      const c = celular();
      await definirNumero(f.familyId, dono.id, c.com);
      const ctx = actorDe(f.familyId, intruso.id, "Familiar", "Intruso") as unknown as Parameters<typeof startPhoneVerification>[0];
      const v = await startPhoneVerification(ctx, c.sem);
      const { d } = deps();
      const r = await processarEntrada(msgTexto(c.sem, v.code), d.nucleo); // chega como o dono (variante): resolve o dono, não verifica
      expect(r.intent).not.toBe("numero_verificado");
      const [m] = await admin`select phone_verified from members where id = ${intruso.id}`;
      expect(m!["phone_verified"]).toBeNull();
      expect((await resolveSender(c.com))?.memberId).toBe(dono.id);
    });

    it("verificação pelo código: cadastrou SEM o 9 e o WhatsApp entrega COM o 9 (e o contrário); fica verificado como cadastrado", async () => {
      const f = await novaFamilia("Posse9");
      for (const cadastrado of [celular().sem, celular().com]) {
        const p = await pessoa(f.familyId, "Familiar", `Rosa${cadastrado.slice(-3)}`, { phone: null });
        const ctx = actorDe(f.familyId, p.id, "Familiar", "Rosa") as unknown as Parameters<typeof startPhoneVerification>[0];
        const v = await startPhoneVerification(ctx, cadastrado);
        const remetente = variantesBr(cadastrado)[1]!;
        const { d } = deps();
        expect((await processarEntrada(msgTexto(remetente, `${v.code}`), d.nucleo)).intent).toBe("numero_verificado");
        const [m] = await admin`select phone_verified from members where id = ${p.id}`;
        expect(m!["phone_verified"]).toBe(cadastrado);
        expect((await resolveSender(remetente))?.memberId).toBe(p.id);
      }
    });

    it("envio: a consulta 'está no WhatsApp?' decide a forma, que fica guardada no membro e não é consultada de novo", async () => {
      const f = await novaFamilia("Envio1");
      const c = celular();
      await definirNumero(f.familyId, f.adminId, c.com);
      const fake = criarFake();
      fake.consulta.set(c.com, c.sem); // o WhatsApp dele é o antigo, sem o 9
      const ritmo = ritmoRapido();
      await enviarPendentes(fake, ritmo, { agora: () => T0610, somenteFamilia: f.familyId });
      const dele = fake.enviados.filter((e) => e.numero === c.sem || e.numero === c.com);
      expect(dele.length).toBeGreaterThan(0);
      expect(dele.every((e) => e.numero === c.sem)).toBe(true);
      expect(await sendNumber(f.adminId)).toBe(c.sem);
      expect(fake.consultas).toEqual([c.com]);
      // novo aviso: usa a forma guardada, sem consultar
      await admin`delete from outbound_messages where family_id = ${f.familyId}`;
      await enviarPendentes(fake, ritmo, { agora: () => new Date(T0610.getTime() + 60_000), somenteFamilia: f.familyId });
      expect(fake.consultas).toEqual([c.com]);
      expect(fake.enviados.filter((e) => e.numero === c.com)).toHaveLength(0);
    });

    it("envio sem a consulta: 'número inexistente' na forma cadastrada → UMA retentativa na outra forma, sem duplicar, e guarda a que funcionou", async () => {
      const f = await novaFamilia("Envio2");
      const c = celular();
      await definirNumero(f.familyId, f.adminId, c.com);
      const fake = criarFake(); // consultaIndisponivel = true: a rota não responde
      fake.inexistentes.add(c.com);
      const r = await enviarPendentes(fake, ritmoRapido(), { agora: () => T0610, somenteFamilia: f.familyId });
      expect(r.falhas).toBe(0);
      const lembretes = fake.enviados.filter((e) => e.texto.includes("Hora do remédio"));
      expect(lembretes).toHaveLength(1);
      expect(lembretes[0]!.numero).toBe(c.sem);
      expect(await sendNumber(f.adminId)).toBe(c.sem);
      const [m] = await admin`select count(*)::int as n from outbound_messages where family_id = ${f.familyId} and kind = 'dose_reminder' and sent_at is not null`;
      expect(m!["n"]).toBe(1);
    });

    it("as duas formas inexistentes: falha clara normal (recuo/erro), sem mensagem enviada", async () => {
      const f = await novaFamilia("Envio3");
      const c = celular();
      await definirNumero(f.familyId, f.adminId, c.com);
      const fake = criarFake();
      fake.inexistentes.add(c.com);
      fake.inexistentes.add(c.sem);
      const r = await enviarPendentes(fake, ritmoRapido(), { agora: () => T0610, somenteFamilia: f.familyId });
      expect(r.falhas).toBeGreaterThan(0);
      expect(fake.enviados).toHaveLength(0);
    });

    it("aprende com quem escreve: a forma do número que chegou fica guardada e é a usada nos lembretes", async () => {
      const f = await novaFamilia("Aprende");
      const c = celular();
      await definirNumero(f.familyId, f.adminId, c.com);
      const { d } = deps();
      await processarEntrada({ ...msgTexto(c.com, "estoque"), numeroResposta: c.sem }, d.nucleo);
      expect(await sendNumber(f.adminId)).toBe(c.sem);
      const fake = criarFake();
      await enviarPendentes(fake, ritmoRapido(), { agora: () => T0610, somenteFamilia: f.familyId });
      expect(fake.consultas).toHaveLength(0);
      expect(fake.enviados.filter((e) => e.numero === c.com)).toHaveLength(0);
      expect(fake.enviados.filter((e) => e.numero === c.sem).length).toBeGreaterThan(0);
    });
  });


  /* ------------------------------------------------------------ custo da varredura de famílias */
  describe("varredura de todas as famílias", () => {
    it("leitura da plataforma (somenteLer) NÃO gera nem agenda nada: nenhuma linha nova na fila de nenhuma família", async () => {
      const f = await novaFamilia("Leitura");
      const antes = (await admin`select count(*)::int as n from outbound_messages where family_id = ${f.familyId}`)[0]!["n"];
      await pendentesDeTodas({ reivindicar: false, agora: T0610, limite: 200 });
      const depois = (await admin`select count(*)::int as n from outbound_messages where family_id = ${f.familyId}`)[0]!["n"];
      expect(depois).toBe(antes);
      expect(depois).toBe(0);
      // o agendador (reivindicar) é quem gera
      await pendentes(f.familyId, { reivindicar: true, agora: T0610, limite: 200 });
      expect((await admin`select count(*)::int as n from outbound_messages where family_id = ${f.familyId}`)[0]!["n"]).toBeGreaterThan(0);
    });

    it("o agendador só visita famílias com WhatsApp: número verificado (sem PARAR) e tratamento ativo", async () => {
      const com = await novaFamilia("VisitaCom");
      const semNumero = await novaFamilia("VisitaSemNumero");
      await withFamilia(semNumero.familyId, (tx) => tx.update(s.members).set({ phoneVerified: null }).where(eq(s.members.id, semNumero.adminId)));
      const parou = await novaFamilia("VisitaParou");
      await withFamilia(parou.familyId, (tx) => tx.update(s.members).set({ whatsappOptOutAt: new Date() }).where(eq(s.members.id, parou.adminId)));
      const ids = new Set((await listarFamiliasComWhatsapp()).map((x) => x.familiaId));
      expect(ids.has(com.familyId)).toBe(true);
      expect(ids.has(semNumero.familyId)).toBe(false);
      expect(ids.has(parou.familyId)).toBe(false);
    });

    it("a limpeza dos testes confere que nada sobrou (e lança se sobrar)", async () => {
      const f = await novaFamilia("Limpa");
      await limparFamilias(admin, [f.familyId]);
      expect((await admin`select count(*)::int as n from families where id = ${f.familyId}`)[0]!["n"]).toBe(0);
      criadas.splice(criadas.indexOf(f.familyId), 1);
    });
  });


  /* ------------------------------------------------------------ chave recusada (401) e backlog de avisos */
  describe("chave recusada pela Evolution e backlog de doses", () => {
    const ritmoRapido = () => criarRitmo({ relogio: relogioFalso(), maxPorMinuto: 1000, maxPorHora: 10000 });
    const limparAuth = () => admin`delete from whatsapp_runtime where key = 'auth'`;

    it("401 repetido: não gasta tentativas da mensagem, pausa o envio, avisa o administrador UMA vez e só volta depois de 10 min", async () => {
      await limparAuth();
      const f = await novaFamilia("Chave401");
      const fake = criarFake();
      fake.recusarChave = true;
      // o fake nunca conta como "provedor real" para a pausa: usa um id diferente
      Object.defineProperty(fake, "id", { value: "evolution-go" });
      const ritmo = ritmoRapido();
      let agora = T0610;
      const rodar = () => enviarPendentes(fake, ritmo, { agora: () => agora, somenteFamilia: f.familyId });
      const r1 = await rodar();
      expect(r1.falhas).toBeGreaterThan(0);
      expect(r1.erroDefinitivo).toBe(0);
      const linhas = await admin`select send_attempts, claim_count, failed_at, sent_at, error_summary from outbound_messages where family_id = ${f.familyId}`;
      for (const l of linhas) {
        expect(l["send_attempts"]).toBe(0); // erro de chave não é tentativa da mensagem
        expect(l["failed_at"]).toBeNull();
        expect(l["sent_at"]).toBeNull();
        expect(String(l["error_summary"])).toContain("EVOLUTION_INSTANCE_TOKEN"); // motivo claro no painel, sem segredo
      }
      // acumula falhas de chave até a pausa (3 seguidas)
      for (let i = 0; i < 3; i++) {
        agora = new Date(agora.getTime() + 2 * 60_000);
        await rodar();
      }
      const est = await lerRuntime<{ pausadoAte: string | null; alertada: boolean }>("auth");
      expect(est?.pausadoAte).toBeTruthy();
      expect(est?.alertada).toBe(true);
      const avisos = await admin`select body from notifications where family_id = ${f.familyId} and payload->>'alerta' = 'wa_chave_recusada'`;
      expect(avisos).toHaveLength(1);
      expect(String(avisos[0]!["body"])).toContain("EVOLUTION_INSTANCE_TOKEN");
      // em pausa: nada é reivindicado nem enviado
      const antes = fake.enviados.length;
      agora = new Date(agora.getTime() + 60_000);
      const pausado = await rodar();
      expect(pausado).toEqual({ enviadas: 0, falhas: 0, erroDefinitivo: 0, ambiguas: 0 });
      expect(fake.enviados).toHaveLength(antes);
      // passados 10 min, volta a tentar; com a chave certa, as mensagens SAEM (nada se perdeu)
      fake.recusarChave = false;
      agora = new Date(agora.getTime() + 11 * 60_000);
      const depois = await rodar();
      expect(depois.enviadas).toBeGreaterThan(0);
      expect((await lerRuntime<{ pausadoAte: string | null; alertada: boolean }>("auth"))).toMatchObject({ pausadoAte: null, alertada: false });
      await limparAuth();
    });

    it("o motivo resumido de uma falha de chave é claro e sem segredo (e erro comum continua contando tentativa)", async () => {
      const f = await novaFamilia("Motivo401");
      const fake = criarFake();
      fake.falharProximos(1, true);
      const ritmo = ritmoRapido();
      await enviarPendentes(fake, ritmo, { agora: () => T0610, somenteFamilia: f.familyId });
      const [m] = await admin`select send_attempts, error_summary from outbound_messages where family_id = ${f.familyId} and error_summary is not null limit 1`;
      expect(m!["send_attempts"]).toBe(1);
      expect(String(m!["error_summary"])).toBe("falha programada");
    });

    it("dose ESQUECIDA só avisa a família se o horário foi nas últimas 6 h; as mais antigas ficam só no portal", async () => {
      const f = await novaFamilia("Backlog");
      const tipos = async (agora: Date) => {
        await gerarMensagens(f.familyId, agora);
        return (await admin`select kind, context from outbound_messages where family_id = ${f.familyId} and kind = 'dose_missed'`);
      };
      // dose das 06:00 (09:00Z). 09:30 local = 2 h 30 depois: já esquecida e dentro das 6 h
      expect((await tipos(new Date("2026-10-19T12:30:00Z"))).length).toBeGreaterThan(0);
      const g = await novaFamilia("BacklogVelho");
      // 13:30 local (7 h 30 depois da das 06:00): as 06:00 passou de 6 h e NÃO gera; a das 14:00 ainda nem chegou
      await gerarMensagens(g.familyId, new Date("2026-10-19T16:30:00Z"));
      const velhas = await admin`select context from outbound_messages where family_id = ${g.familyId} and kind = 'dose_missed'`;
      expect(velhas.filter((x) => (x["context"] as { doseId?: string }).doseId === g.doses[0])).toHaveLength(0);
      const lemb = await admin`select context from outbound_messages where family_id = ${g.familyId} and kind = 'dose_reminder'`;
      expect(lemb.filter((x) => (x["context"] as { doseId?: string }).doseId === g.doses[0])).toHaveLength(0); // sem lembrete para quem já passou do prazo
    });
  });

  it("falha de mídia grava o motivo para o painel (e o log traz origem e tamanho, sem conteúdo); o sucesso seguinte limpa", async () => {
    const f = await novaFamilia("MotivoMidia");
    const falha: LeitorMidia = { transcreverAudio: async () => ({ texto: null, uso: null, motivo: "Gemini recusou a chave (403 PERMISSION_DENIED): confira GEMINI_API_KEY" }), lerImagem: async () => ({ texto: null, uso: null }) };
    const espiao = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { d } = deps({ midia: falha });
    const r = await processarEntrada(msgMidia(f.adminPhone, "audio"), d.nucleo);
    const linhas = espiao.mock.calls.map((x) => String(x[0])).join(" ");
    espiao.mockRestore();
    expect(r.respostas[0]).toContain("Não consegui entender o áudio");
    expect(await lerRuntime<{ motivo: string | null }>("midia")).toMatchObject({ motivo: expect.stringContaining("403") });
    expect(linhas).toContain('"origem":"webhook"');
    expect(linhas).toMatch(/"kb":\d/);
    expect(linhas).not.toContain("QUJD");
    const { d: d2 } = deps({ midia: leitor("estoque") });
    await processarEntrada(msgMidia(f.adminPhone, "audio"), d2.nucleo);
    expect(await lerRuntime<{ motivo: string | null }>("midia")).toMatchObject({ motivo: null });
    await admin`delete from whatsapp_runtime where key = 'midia'`;
  });


  /* ------------------------------------------------------------ quantidade restante nas respostas */
  describe("estoque com a QUANTIDADE restante", () => {
    it("'estoque' mostra comprimidos e dias; perguntas de quantidade com o nome do remédio filtram; sem menção lista tudo", async () => {
      const f = await novaFamilia("Qtd");
      const outro = await meds.createMedication(f.admin, { patientId: f.patientId, name: `Vitamina${f.medName.slice(-3)}`, alternatives: [], route: "tablet", controlUnit: "unit", requiresPrescription: false, initialStock: 60 });
      void outro;
      const { d } = deps();
      const geral = await processarEntrada(msgTexto(f.adminPhone, "estoque"), d.nucleo);
      expect(geral.respostas[0]).toContain(`${f.medName}: 10 comprimidos ·`);
      expect(geral.respostas[0]).toContain("Vitamina");
      const so = await processarEntrada(msgTexto(f.adminPhone, `quantos comprimidos de ${f.medName} eu tenho?`), d.nucleo);
      expect(so.intent).toBe("estoque");
      expect(so.respostas[0]).toContain("10 comprimidos");
      expect(so.respostas[0]).not.toContain("Vitamina");
      const paciente = await processarEntrada(msgTexto(f.adminPhone, `quanto resta do ${f.medName}`), d.nucleo);
      expect(paciente.respostas[0]).toContain(`${f.medName}: 10 comprimidos`);
    });

    it("remédio citado sem estoque cadastrado: diz isso; permissão de estoque é respeitada", async () => {
      const f = await novaFamilia("QtdSem");
      const sem = await meds.createMedication(f.admin, { patientId: f.patientId, name: `Losartana${f.medName.slice(-3)}`, alternatives: [], route: "tablet", controlUnit: "unit", requiresPrescription: false });
      void sem;
      const { d } = deps();
      const r = await processarEntrada(msgTexto(f.adminPhone, `quantos comprimidos de losartana${f.medName.slice(-3).toLowerCase()} eu tenho?`), d.nucleo);
      expect(r.respostas[0]).toContain("Não há estoque cadastrado para Losartana");
      // Confirmador não vê estoque: resposta de falta de permissão, sem números
      const conf = await pessoa(f.familyId, "Confirmador", "Conf");
      const r2 = await processarEntrada(msgTexto(conf.phone!, "quantos comprimidos eu tenho?"), d.nucleo);
      expect(r2.respostas.join(" ")).not.toMatch(/comprimidos ·/);
    });

    it("aviso de estoque baixo e resumo trazem a quantidade restante", async () => {
      const f = await novaFamilia("QtdBaixo");
      await adjustStock(f.admin, f.medId, 2, "conferi", T0610);
      await gerarMensagens(f.familyId, T0610);
      const [m] = await admin`select body from outbound_messages where family_id = ${f.familyId} and kind = 'low_stock' limit 1`;
      expect(String(m!["body"])).toMatch(/Restam 2 comprimidos \(/);
      const noite = new Date("2026-10-19T23:30:00Z");
      await gerarMensagens(f.familyId, noite);
      const [r] = await admin`select body from outbound_messages where family_id = ${f.familyId} and kind = 'daily_summary' limit 1`;
      expect(String(r!["body"])).toMatch(/Estoque crítico[\s\S]*2 comprimidos ·/);
    });

    it("a ferramenta do agente devolve quantidade, unidade, dias e nível", async () => {
      const f = await novaFamilia("QtdFerr");
      const a = await actorAdmin(f);
      const x = await executarFerramenta(a, "consultar_estoque", {}, T0610);
      const item = (JSON.parse(x.conteudo) as { itens: Array<Record<string, unknown>> }).itens[0]!;
      expect(item).toMatchObject({ remedio: f.medName, quantidade: 10, quantidadeTexto: "10 comprimidos", unidade: "unit", via: "tablet", nivel: expect.any(String) });
      expect(typeof item["diasRestantes"]).toBe("number");
    });
  });

  it("(sanidade) loadWaActor de uma família inexistente devolve null", async () => {
    expect(await loadWaActor(randomUUID(), randomUUID(), "active", "5511")).toBeNull();
    void ({} as WaActor);
  });
});
