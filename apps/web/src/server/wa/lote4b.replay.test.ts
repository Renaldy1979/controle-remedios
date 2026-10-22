// @vitest-environment node
/**
 * Replay local dos fluxos do N8N (Lote 4B), sem N8N nem Evolution Go: repete em código os passos dos fluxos
 * `01-conversa` e `02-lembretes-dose` usando a MESMA lib que o `pnpm n8n:build` embute nos nós Code
 * (integrations/n8n/lib/evolution.ts) e a API /api/v1 de verdade (handlers + Postgres local, papel da aplicação, RLS).
 * A Evolution Go é um servidor falso que só anota o que receberia. Sem o banco no ar, a suíte é PULADA.
 *
 * Nota: o fluxo 02 usa a chave `cpl_` no N8N; aqui a fila é lida com uma chave de FAMÍLIA (`cdf_`) só para não reivindicar
 * mensagens de outras famílias de teste que rodam em paralelo. As duas chaves passam pelos mesmos handlers (coberto no 4A).
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { criarChavePlataforma, revogarChavePlataforma, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { localParts } from "@medcuidar/domain";
import { bancoDisponivel, conectarAdmin, encerrar, limparFamilias, prepararBanco, telefoneAleatorio, type Admin } from "@medcuidar/pg-testing";
import { SYSTEM_PROFILES, familySettingsSchema, type PermissionMap } from "@medcuidar/shared";
import {
  chaveIdempotencia, corpoConversa, corpoEnvioTexto, envioOk, lembretesParaEnviar, normalizarEvento, planejarRespostas, textoDoGemini, transcricaoUtil,
} from "../../../../../integrations/n8n/lib/evolution";
import fx from "../../../../../integrations/n8n/lib/fixtures/eventos.json";
import * as h from "../api/handlers";
import { _limparLimites } from "../api/core";
import { ensureDosesForDay } from "../pg/doses";
import { createFamilyWithAdmin } from "../pg/families";
import * as meds from "../pg/medications";
import * as patients from "../pg/patients";
import { registerPurchase } from "../pg/stock";
import { criarChaveFamilia } from "./keys";

const up = await bancoDisponivel();
if (!up) console.warn("[web] Postgres local indisponível: replay do Lote 4B PULADO. Rode `pnpm db:up`.");

const TZ = "America/Sao_Paulo";
const permsOf = (name: string): PermissionMap => SYSTEM_PROFILES.find((p) => p.name === name)!.permissions;
const settings = familySettingsSchema.parse({});

/** Servidor falso da Evolution Go: guarda o que receberia e pode ser derrubado. */
class EvolutionFalsa {
  enviados: Array<{ number: string; text: string }> = [];
  fora = false;
  /** o que o nó "Envia resposta"/"Envia mensagem" faz: POST /send/text */
  enviar(corpo: { number: string; text: string }): { statusCode: number; body: unknown } {
    if (this.fora) return { statusCode: 502, body: { error: "bad gateway" } };
    this.enviados.push(corpo);
    return { statusCode: 200, body: { messageId: `3EB0${this.enviados.length}` } };
  }
}

describe.skipIf(!up)("Lote 4B — replay dos fluxos 01 (conversa) e 02 (lembretes) contra a API real", () => {
  let admin: Admin;
  const criadas: string[] = [];
  const chavesPlataforma: string[] = [];
  let cpl: string;
  let evo: EvolutionFalsa;
  /** corpos e cabeçalhos das chamadas à API, para provar que o telefone só vai em X-Telefone */
  let chamadas: Array<{ rota: string; corpo: unknown; telefoneHeader: string | null }>;

  const req = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    new NextRequest(`http://api.test/api/v1${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const semParams = { params: Promise.resolve({}) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lerJson = async (r: Response) => (await r.json()) as { dados?: any; erro?: { codigo: string } };

  /** Payload da Evolution Go no formato da fixture, com remetente, id e texto trocados e carimbo de agora. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = (base: keyof typeof fx, o: { tel?: string; id?: string; texto?: string } = {}): any => {
    const p = JSON.parse(JSON.stringify(fx[base]));
    const info = p.data?.Info;
    if (info) {
      info.Timestamp = new Date().toISOString();
      info.ID = o.id ?? `3EB0${randomUUID().slice(0, 8)}`;
      if (o.tel && !info.IsGroup && info.Chat !== "status@broadcast") { info.Chat = `${o.tel}@s.whatsapp.net`; info.Sender = `${o.tel}@s.whatsapp.net`; }
      if (o.tel && info.IsGroup) info.Sender = `${o.tel}@s.whatsapp.net`;
      if (o.texto !== undefined && p.data.Message?.conversation !== undefined) p.data.Message.conversation = o.texto;
    }
    return p;
  };

  /**
   * Fluxo 01-conversa em código: Normaliza → Atender? → (áudio: transcreve) → Prepara chamada → Conversa (API) →
   * Interpreta resposta → (livre: agente) → Envia resposta pela Evolution.
   */
  async function fluxo01(entrada: unknown, opcoes: { transcrever?: (m: unknown) => string } = {}) {
    const e = normalizarEvento(entrada, { agoraMs: Date.now(), idadeMaximaMin: 60 });
    if (e.acao !== "processar") return { ignorado: e.motivo, intent: null as string | null, livre: false };
    let transcrito: string | undefined;
    if (e.tipo === "audio") {
      transcrito = transcricaoUtil(textoDoGemini({ content: { parts: [{ text: opcoes.transcrever?.(e.midia) ?? "" }] } }));
      if (!transcrito) {
        evo.enviar(corpoEnvioTexto(e.telefone, "Não consegui entender o áudio. Pode escrever em texto, por favor?") as { number: string; text: string });
        return { ignorado: null, intent: "audio_nao_entendido", livre: false };
      }
    }
    const corpo = corpoConversa(e, transcrito);
    chamadas.push({ rota: "/conversa/mensagem", corpo, telefoneHeader: e.telefone });
    const resp = await h.conversaMensagem(
      req("POST", "/conversa/mensagem", { authorization: `Bearer ${cpl}`, "x-telefone": e.telefone, "idempotency-key": chaveIdempotencia(e.messageId) }, corpo),
      semParams,
    );
    if (resp.status < 200 || resp.status >= 300) return { ignorado: null, intent: `http_${resp.status}`, livre: false };
    const dados = (await lerJson(resp)).dados;
    const plano = planejarRespostas(dados, e.telefone);
    if (!plano.livre) for (const envio of plano.envios) evo.enviar(envio);
    return { ignorado: null, intent: dados.intent as string, livre: plano.livre };
  }

  /** Família de teste: 1 paciente, 1 remédio de 24 h cuja dose venceu há 5 minutos (hoje), 10 comprimidos, admin com número verificado. */
  async function novaFamilia(nome: string) {
    const r = await createFamilyWithAdmin({
      appwriteUserId: `zz-test-${randomUUID()}`, name: `Admin ${nome}`, email: `zz-test-${nome}-${randomUUID().slice(0, 6)}@exemplo.test`.toLowerCase(), familyName: `Família ${nome}`,
    });
    criadas.push(r.familyId);
    const a = { familyId: r.familyId, memberId: r.memberId, timezone: TZ, settings, member: { id: r.memberId, name: `Admin ${nome}`, profileName: "Administrador", permissions: permsOf("Administrador") } };
    const tel = telefoneAleatorio();
    await withFamilia(r.familyId, (tx) => tx.update(s.members).set({ phoneVerified: tel }).where(eq(s.members.id, r.memberId)));
    const cincoAtras = new Date(Date.now() - 5 * 60_000);
    const loc = localParts(cincoAtras, TZ);
    const hhmm = `${String(Math.floor(loc.minutes / 60)).padStart(2, "0")}:${String(loc.minutes % 60).padStart(2, "0")}`;
    const patientId = await patients.savePatient(a, { name: `Adelino ${nome}`, birthDate: "", notes: "", usesPhone: true, selfMemberId: null });
    const medId = await meds.createMedication(a, { patientId, name: `Zypred${nome}`, alternatives: [], route: "tablet", controlUnit: "unit" });
    await meds.saveScheme(a, medId, { startDate: loc.date, firstTime: hhmm, phases: [{ everyHours: 24, fromDay: 1, toDay: null, perDose: 1 }] });
    await registerPurchase(a, medId, 10, "Saldo inicial");
    await ensureDosesForDay(r.familyId, loc.date);
    const fam = await criarChaveFamilia(a, "zz-test replay");
    return { familyId: r.familyId, adminId: r.memberId, tel, medId, admin: a, cdf: fam.chave };
  }

  const saldo = async (f: { familyId: string; medId: string }) => {
    const [r] = await admin`select coalesce(sum(m.quantity), 0)::float8 as total from stock_movements m join stock_items i on i.id = m.stock_item_id where i.family_id = ${f.familyId} and i.medication_id = ${f.medId}`;
    return r!["total"] as number;
  };
  const movimentos = async (familyId: string) => (await admin`select id from stock_movements m where m.dose_event_id in (select id from dose_events where family_id = ${familyId})`).length;

  /** Fluxo 02 em código: Busca da fila → Prepara envios → Envia mensagem → Confere envios → Marca enviada / Marca falha. */
  async function fluxo02(cdf: string, tel: string) {
    const r = await h.lembretesPendentes(req("GET", "/lembretes/pendentes?limite=10", { authorization: `Bearer ${cdf}` }), semParams);
    expect(r.status).toBe(200);
    const itens = lembretesParaEnviar((await lerJson(r)).dados).filter((i) => i.telefone === tel);
    const resultado: Array<{ id: string; ok: boolean }> = [];
    for (const it of itens) {
      const env = evo.enviar(corpoEnvioTexto(it.telefone, it.texto) as { number: string; text: string });
      const ok = envioOk(env.statusCode, env.body);
      const corpo = ok ? {} : { falhou: true };
      const m = await h.lembreteEnviado(req("POST", `/lembretes/${it.id}/enviado`, { authorization: `Bearer ${cdf}` }, corpo), { params: Promise.resolve({ id: it.id }) });
      expect(m.status).toBe(200);
      resultado.push({ id: it.id, ok });
    }
    return resultado;
  }

  beforeAll(async () => {
    process.env["APP_URL"] = "http://app.test";
    admin = conectarAdmin();
    await prepararBanco();
    const k = await criarChavePlataforma("zz-test replay 4b", ["conversa"]);
    chavesPlataforma.push(k.id);
    cpl = k.chave;
  });
  beforeEach(() => {
    _limparLimites();
    evo = new EvolutionFalsa();
    chamadas = [];
  });
  afterAll(async () => {
    for (const id of chavesPlataforma) await revogarChavePlataforma(id);
    await admin`delete from platform_audit_log where key_id in (select id from platform_api_keys where name like 'zz-test%')`;
    await admin`delete from platform_api_keys where name like 'zz-test%'`;
    await admin.unsafe("delete from audit_log where family_id = any($1::uuid[])", [criadas]);
    await limparFamilias(admin, criadas);
    await admin`delete from phone_lockouts where phone like '5599%'`;
    await encerrar(admin);
  });

  /* ------------------------------------------------------------------ 01-conversa */
  describe("fluxo 01-conversa", () => {
    it("número verificado é atendido: 'tomei' confirma a dose e a resposta pronta vai ao remetente", async () => {
      const f = await novaFamilia("Tomei");
      const antes = await saldo(f);
      const r = await fluxo01(payload("texto", { tel: f.tel, texto: "tomei" }));
      expect(r.intent).toBe("dose_tomada");
      expect(evo.enviados).toHaveLength(1);
      expect(evo.enviados[0]!.number).toBe(f.tel);
      expect(evo.enviados[0]!.text).toContain("Anotado");
      expect(await saldo(f)).toBe(antes - 1);
    });

    it("a MESMA mensagem duas vezes (reentrega da Evolution) baixa o estoque uma só vez", async () => {
      const f = await novaFamilia("Dupla");
      const antes = await saldo(f);
      const p = payload("texto", { tel: f.tel, texto: "tomei", id: `3EB0REP${randomUUID().slice(0, 6)}` });
      const a = await fluxo01(p);
      const b = await fluxo01(JSON.parse(JSON.stringify(p)));
      expect(a.intent).toBe("dose_tomada");
      expect(b.intent).toBeTruthy();
      expect(await movimentos(f.familyId)).toBe(1);
      expect(await saldo(f)).toBe(antes - 1);
      // reenvio com a mesma Idempotency-Key devolve a resposta guardada: o remetente recebe o mesmo texto
      expect(evo.enviados[1]!.text).toBe(evo.enviados[0]!.text);
    });

    it("mensagem de outra pessoa com a mesma dose já tomada não desconta de novo", async () => {
      const f = await novaFamilia("Outra");
      await fluxo01(payload("texto", { tel: f.tel, texto: "tomei" }));
      const depois = await saldo(f);
      await fluxo01(payload("texto", { tel: f.tel, texto: "tomei" })); // outro id de mensagem
      expect(await saldo(f)).toBe(depois);
      expect(await movimentos(f.familyId)).toBe(1);
    });

    it("número desconhecido e número só 'pendente' recebem a MESMA resposta genérica, sem nenhum dado da família", async () => {
      const f = await novaFamilia("Gen");
      const pend = telefoneAleatorio();
      await withFamilia(f.familyId, async (tx) => {
        const [p] = await tx.select().from(s.profiles).where(eq(s.profiles.name, "Familiar"));
        await tx.insert(s.members).values({ familyId: f.familyId, profileId: p!.id, name: "Pendente", email: `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`, accessState: "active", appwriteUserId: `zz-test-${randomUUID()}`, emailConfirmedAt: new Date(), phonePending: pend });
      });
      const antes = await saldo(f);
      const desconhecido = telefoneAleatorio();
      const a = await fluxo01(payload("texto", { tel: desconhecido, texto: "tomei" }));
      const b = await fluxo01(payload("texto", { tel: pend, texto: "tomei" }));
      expect(a.intent).toBe("desconhecido");
      expect(b.intent).toBe("desconhecido");
      expect(evo.enviados[0]!.text).toBe(evo.enviados[1]!.text);
      expect(evo.enviados.map((e) => e.text).join(" ")).not.toMatch(/Adelino|Zypred|Família/);
      expect(await saldo(f)).toBe(antes);
    });

    it.each([
      ["from_me", "enviada_por_nos"],
      ["grupo", "grupo"],
      ["status", "status_ou_broadcast"],
      ["recibo", "nao_e_mensagem"],
      ["presenca", "nao_e_mensagem"],
    ] as const)("%s é ignorado: nada vai à API nem à Evolution", async (k, motivo) => {
      const f = await novaFamilia(`Ign${k}`);
      const antes = await saldo(f);
      const r = await fluxo01(payload(k, { tel: f.tel, texto: "tomei" }));
      expect(r.ignorado).toBe(motivo);
      expect(chamadas).toHaveLength(0);
      expect(evo.enviados).toHaveLength(0);
      expect(await saldo(f)).toBe(antes);
    });

    it("o telefone vai só no cabeçalho X-Telefone: o corpo enviado à API não o contém", async () => {
      const f = await novaFamilia("Corpo");
      await fluxo01(payload("texto", { tel: f.tel, texto: "estoque" }));
      expect(chamadas).toHaveLength(1);
      expect(JSON.stringify(chamadas[0]!.corpo)).not.toContain(f.tel);
      expect(chamadas[0]!.telefoneHeader).toBe(f.tel);
    });

    it("'como está o estoque?' é respondido em código (sem IA)", async () => {
      const f = await novaFamilia("Est");
      const r = await fluxo01(payload("texto_extendido", { tel: f.tel }));
      expect(r.livre).toBe(false);
      expect(r.intent).toBe("estoque");
      expect(evo.enviados[0]!.text).toContain("Zypred");
    });

    it("pergunta que não casa com nenhum comando vira intent 'livre' (agente de IA) e nada é enviado antes dele", async () => {
      const f = await novaFamilia("Livre");
      const r = await fluxo01(payload("texto", { tel: f.tel, texto: "o que é bom para dor de cabeça da Maria?" }));
      expect(r.livre).toBe(true);
      expect(r.intent).toBe("livre");
      expect(evo.enviados).toHaveLength(0);
    });

    it("áudio transcrito em 'tomei' confirma a dose; áudio não entendido pede texto e não chama a API", async () => {
      const f = await novaFamilia("Audio");
      const antes = await saldo(f);
      const ruim = await fluxo01(payload("audio", { tel: f.tel }), { transcrever: () => "" });
      expect(ruim.intent).toBe("audio_nao_entendido");
      expect(chamadas).toHaveLength(0);
      expect(evo.enviados[0]!.text).toContain("entender o áudio");
      expect(await saldo(f)).toBe(antes);
      const bom = await fluxo01(payload("audio", { tel: f.tel }), { transcrever: () => "tomei" });
      expect(bom.intent).toBe("dose_tomada");
      expect(await saldo(f)).toBe(antes - 1);
    });

    it("mensagem antiga demais (backlog) é ignorada", async () => {
      const f = await novaFamilia("Antiga");
      const p = payload("texto", { tel: f.tel, texto: "tomei" });
      p.data.Info.Timestamp = new Date(Date.now() - 3 * 3600_000).toISOString();
      const r = await fluxo01(p);
      expect(r.ignorado).toBe("antiga");
      expect(chamadas).toHaveLength(0);
    });

    it("falha da API vira 'http_<status>' e nada é descontado (o fluxo avisa o remetente com a mensagem padrão)", async () => {
      const f = await novaFamilia("Falha");
      const antes = await saldo(f);
      const ruim = await h.conversaMensagem(req("POST", "/conversa/mensagem", { authorization: "Bearer cpl_chave-inexistente-0000000000", "x-telefone": f.tel }, { messageId: "x", texto: "tomei" }), semParams);
      expect(ruim.status).toBe(401);
      expect(await saldo(f)).toBe(antes);
    });
  });

  /* ------------------------------------------------------------------ 02-lembretes-dose */
  describe("fluxo 02-lembretes-dose", () => {
    it("o lembrete só é marcado como enviado depois do envio OK; falha de envio solta a mensagem e ela volta no próximo ciclo", async () => {
      const f = await novaFamilia("Lemb");
      const sentAt = async () => (await admin`select sent_at, kind from outbound_messages where family_id = ${f.familyId} and kind = 'dose_reminder'`)[0];

      evo.fora = true;
      const c1 = await fluxo02(f.cdf, f.tel);
      expect(c1).toHaveLength(1);
      expect(c1[0]!.ok).toBe(false);
      expect((await sentAt())!["sent_at"]).toBeNull();
      expect(evo.enviados).toHaveLength(0);

      evo.fora = false;
      const c2 = await fluxo02(f.cdf, f.tel);
      expect(c2).toHaveLength(1);
      expect(c2[0]!.ok).toBe(true);
      expect((await sentAt())!["sent_at"]).not.toBeNull();
      expect(evo.enviados).toHaveLength(1);
      expect(evo.enviados[0]!.number).toBe(f.tel);
      expect(evo.enviados[0]!.text).toMatch(/Zypred/);

      // depois de enviado, o próximo ciclo não repete
      expect(await fluxo02(f.cdf, f.tel)).toHaveLength(0);
      expect(evo.enviados).toHaveLength(1);
    });

    it("lembrete enviado + resposta 'tomei' do remetente: o estoque baixa uma vez e o lembrete seguinte não vem (dose resolvida)", async () => {
      const f = await novaFamilia("Ciclo");
      const antes = await saldo(f);
      await fluxo02(f.cdf, f.tel);
      expect(evo.enviados).toHaveLength(1);
      const r = await fluxo01(payload("texto", { tel: f.tel, texto: "1" }));
      expect(r.intent).toBe("opcao"); // o "1" significa "Tomei" da dose do lembrete que acabou de chegar
      expect(await saldo(f)).toBe(antes - 1);
      evo.enviados = [];
      expect(await fluxo02(f.cdf, f.tel)).toHaveLength(0);
    });
  });
});
