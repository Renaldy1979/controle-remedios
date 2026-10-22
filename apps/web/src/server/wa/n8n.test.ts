// @vitest-environment node
/**
 * URL do webhook do N8N, segredo do teste e botão "Testar conexão" (Lote 4B): validação contra SSRF, assinatura HMAC, cada tipo de falha
 * com servidor falso, segredo cifrado no banco e RLS. A parte do banco é PULADA sem o Postgres local (pnpm db:up).
 */
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withFamilia } from "@medcuidar/pg";
import { bancoDisponivel, conectarAdmin, encerrar, limparFamilias, prepararBanco, type Admin } from "@medcuidar/pg-testing";
import { UserError } from "../pg/errors";
import { createFamilyWithAdmin } from "../pg/families";
import {
  assinarWebhook, cifrarSegredo, decifrarSegredo, gerarSegredoDoTeste, gerarSegredoN8n, ipPrivado, lerEstadoN8n, salvarUrlN8n, testarConexaoWebhook, testarN8n,
  validarUrlWebhook,
} from "./n8n";

process.env["FILE_URL_SECRET"] ??= "segredo-de-teste-com-mais-de-dezesseis-letras";

describe("validarUrlWebhook (SSRF)", () => {
  it("aceita https público (IP literal ou nome que resolve)", async () => {
    expect((await validarUrlWebhook("https://8.8.8.8/webhook/x")).hostname).toBe("8.8.8.8");
  });
  it.each([
    ["http://exemplo.com/x", /https/],
    ["ftp://exemplo.com/x", /https/],
    ["https://usuario:senha@exemplo.com/x", /usuário e senha/],
    ["https://usuario@exemplo.com/x", /usuário e senha/],
    ["isso não é url", /URL válida/],
    ["https://localhost/x", /não é permitida/],
    ["https://n8n.local/x", /não é permitida/],
    ["https://servico.internal/x", /não é permitida/],
    ["https://127.0.0.1/x", /não é permitida/],
    ["https://10.0.0.5/x", /não é permitida/],
    ["https://192.168.1.10/x", /não é permitida/],
    ["https://172.16.0.1/x", /não é permitida/],
    ["https://169.254.169.254/latest/meta-data", /não é permitida/],
    ["https://[::1]/x", /não é permitida/],
    ["https://[::ffff:127.0.0.1]/x", /não é permitida/],
    ["https://[fd00::1]/x", /não é permitida/],
  ])("recusa %s", async (url, msg) => {
    await expect(validarUrlWebhook(url)).rejects.toThrowError(msg);
  });
  it("nome que não resolve é recusado com mensagem amigável", async () => {
    await expect(validarUrlWebhook("https://nao-existe-mesmo.invalid/x")).rejects.toThrowError(/Não encontramos esse endereço/);
  });
  it("ipPrivado cobre as faixas", () => {
    for (const ip of ["0.0.0.0", "10.1.1.1", "127.0.0.1", "100.64.0.1", "169.254.1.1", "172.31.255.255", "192.168.0.1", "224.0.0.1", "::", "::1", "fc00::1", "fe80::1"]) expect(ipPrivado(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.63.0.1", "2606:4700::1111"]) expect(ipPrivado(ip), ip).toBe(false);
  });
});

describe("segredo cifrado", () => {
  it("cifra e decifra; é aleatório; adulterar ou outro formato não decifra", () => {
    const seg = gerarSegredoN8n();
    expect(seg).toMatch(/^whsec_[0-9a-f]{48}$/);
    const c1 = cifrarSegredo(seg);
    expect(c1).not.toContain(seg);
    expect(cifrarSegredo(seg)).not.toBe(c1);
    expect(decifrarSegredo(c1)).toBe(seg);
    expect(decifrarSegredo(c1.slice(0, -2) + "xx")).toBeNull();
    expect(decifrarSegredo("lixo")).toBeNull();
  });
});

describe("testarConexaoWebhook com servidor falso", () => {
  let srv: Server;
  let base: string;
  let modo = "ok";
  let ultimo: { headers: IncomingHttpHeaders; corpo: string; metodo: string } | null = null;
  const SEGREDO = "whsec_teste";

  beforeAll(async () => {
    srv = createServer((req, res) => {
      let corpo = "";
      req.on("data", (c) => (corpo += c));
      req.on("end", () => {
        ultimo = { headers: req.headers, corpo, metodo: req.method ?? "" };
        if (modo === "sem_resposta") return; // nunca responde (timeout)
        if (modo === "redirect") { res.writeHead(302, { location: "http://127.0.0.1:1/interno" }); return void res.end(); }
        if (modo === "401") { res.writeHead(401); return void res.end("{}"); }
        if (modo === "404") { res.writeHead(404); return void res.end("{}"); }
        if (modo === "500") { res.writeHead(500); return void res.end("{}"); }
        if (modo === "ok_false") { res.writeHead(200, { "content-type": "application/json" }); return void res.end(JSON.stringify({ ok: false })); }
        if (modo === "html") { res.writeHead(200, { "content-type": "text/html" }); return void res.end("<html></html>"); }
        // modo ok: confere o segredo e a assinatura como o fluxo 05 faria
        const ts = String(req.headers["x-medcuidar-timestamp"] ?? "");
        const assinaturaOk = req.headers["x-medcuidar-assinatura"] === assinarWebhook(SEGREDO, ts, corpo);
        if (req.headers["x-medcuidar-token"] !== SEGREDO || !assinaturaOk) { res.writeHead(401); return void res.end("{}"); }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, versao: "1.0.0" }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/webhook/medcuidar-teste-conexao`;
  });
  afterAll(async () => {
    srv.closeAllConnections();
    await new Promise<void>((r) => srv.close(() => r()));
  });
  const testar = (extra: Partial<Parameters<typeof testarConexaoWebhook>[0]> = {}) =>
    testarConexaoWebhook({ url: base, segredo: SEGREDO, permitirPrivada: true, timeoutMs: 600, ...extra });

  it("sucesso: devolve a versão e envia segredo, timestamp e assinatura HMAC válidos num POST JSON", async () => {
    modo = "ok";
    const r = await testar();
    expect(r).toMatchObject({ ok: true, versao: "1.0.0" });
    expect(ultimo!.metodo).toBe("POST");
    expect(ultimo!.headers["x-medcuidar-token"]).toBe(SEGREDO);
    expect(ultimo!.headers["x-medcuidar-assinatura"]).toBe(assinarWebhook(SEGREDO, String(ultimo!.headers["x-medcuidar-timestamp"]), ultimo!.corpo));
    expect(JSON.parse(ultimo!.corpo)).toMatchObject({ evento: "teste_conexao", origem: "medcuidar" });
    // nenhum dado pessoal no corpo
    expect(ultimo!.corpo).not.toMatch(/\d{10,}|@/);
  });
  it("segredo errado → mensagem sobre o segredo", async () => {
    modo = "ok";
    const r = await testar({ segredo: "outro" });
    expect(r).toMatchObject({ ok: false });
    expect((r as { erro: string }).erro).toMatch(/recusou o segredo/);
  });
  it.each([
    ["401", /recusou o segredo/],
    ["404", /Webhook não encontrado/],
    ["500", /código 500/],
    ["redirect", /redirecionou/],
    ["ok_false", /recusou o teste/],
  ])("falha %s → mensagem amigável", async (m, msg) => {
    modo = m;
    const r = await testar();
    expect(r.ok).toBe(false);
    expect((r as { erro: string }).erro).toMatch(msg);
  });
  it("resposta que não é JSON conta como conectado, sem versão", async () => {
    modo = "html";
    expect(await testar()).toMatchObject({ ok: true, versao: null });
  });
  it("timeout curto → mensagem de demora; não segue redirect (a rota interna nunca é chamada)", async () => {
    modo = "sem_resposta";
    const t = await testar({ timeoutMs: 200 });
    expect((t as { erro: string }).erro).toMatch(/demorou demais/);
    modo = "redirect";
    expect((await testar() as { erro: string }).erro).toMatch(/redirecionou/);
  });
  it("servidor fora do ar → não foi possível conectar", async () => {
    const r = await testarConexaoWebhook({ url: "http://127.0.0.1:1/x", segredo: SEGREDO, permitirPrivada: true, timeoutMs: 600 });
    expect((r as { erro: string }).erro).toMatch(/Não foi possível conectar/);
  });
  it("sem permitirPrivada, a URL local é recusada ANTES de qualquer chamada", async () => {
    modo = "ok";
    ultimo = null;
    const r = await testarConexaoWebhook({ url: base, segredo: SEGREDO, timeoutMs: 600 });
    expect(r.ok).toBe(false);
    expect(ultimo).toBeNull();
  });
});

const up = await bancoDisponivel();
describe.skipIf(!up)("configuração por família no Postgres (RLS, segredo cifrado)", () => {
  let admin: Admin;
  const criadas: string[] = [];
  let srv: Server;
  let url: string;
  let segredoDoServidor = "";

  const novaFamilia = async (nome: string) => {
    const r = await createFamilyWithAdmin({ appwriteUserId: `zz-test-${randomUUID()}`, name: `Admin ${nome}`, email: `zz-test-${nome}-${randomUUID().slice(0, 6)}@exemplo.test`.toLowerCase(), familyName: `Família ${nome}` });
    criadas.push(r.familyId);
    return r.familyId;
  };

  beforeAll(async () => {
    process.env["ALLOW_PRIVATE_WEBHOOKS"] = "1";
    delete process.env["APP_ENV"];
    admin = conectarAdmin();
    await prepararBanco();
    srv = createServer((req, res) => {
      let corpo = "";
      req.on("data", (c) => (corpo += c));
      req.on("end", () => {
        const ok = req.headers["x-medcuidar-token"] === segredoDoServidor;
        res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
        res.end(JSON.stringify(ok ? { ok: true, versao: "1.0.0" } : { ok: false }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/webhook/medcuidar-teste-conexao`;
  });
  afterAll(async () => {
    srv.closeAllConnections();
    await new Promise<void>((r) => srv.close(() => r()));
    await admin.unsafe("delete from audit_log where family_id = any($1::uuid[])", [criadas]);
    await limparFamilias(admin, criadas);
    delete process.env["ALLOW_PRIVATE_WEBHOOKS"];
    await encerrar(admin);
  });

  it("começa 'aguardando'; só passa a 'conectado' depois de um teste OK; trocar a URL ou o segredo volta a 'aguardando'", async () => {
    const f = await novaFamilia("N8n");
    expect(await lerEstadoN8n(f)).toMatchObject({ url: null, temSegredo: false, teste: null, estado: "aguardando" });
    await expect(testarN8n(f)).rejects.toThrowError(/Salve a URL/);
    await salvarUrlN8n(f, url);
    await expect(testarN8n(f)).rejects.toThrowError(/Gere o segredo/);
    segredoDoServidor = await gerarSegredoDoTeste(f);
    const t = await testarN8n(f);
    expect(t.resultado).toMatchObject({ ok: true, versao: "1.0.0" });
    expect(t.estado).toMatchObject({ estado: "conectado", temSegredo: true, teste: { ok: true, versao: "1.0.0" } });
    // novo segredo: o servidor ainda tem o antigo → recusa e volta a aguardar
    await gerarSegredoDoTeste(f);
    expect((await lerEstadoN8n(f)).estado).toBe("aguardando");
    const falha = await testarN8n(f);
    expect(falha.resultado.ok).toBe(false);
    expect(falha.estado).toMatchObject({ estado: "aguardando", teste: { ok: false } });
  });

  it("o segredo fica cifrado no banco (nunca em claro) e a URL é validada ao salvar", async () => {
    const f = await novaFamilia("Cifra");
    const segredo = await gerarSegredoDoTeste(f);
    const [r] = await admin`select n8n_secret_enc from family_integrations where family_id = ${f}`;
    expect(String(r!["n8n_secret_enc"])).toMatch(/^v1\./);
    expect(String(r!["n8n_secret_enc"])).not.toContain(segredo);
    delete process.env["ALLOW_PRIVATE_WEBHOOKS"];
    await expect(salvarUrlN8n(f, "https://127.0.0.1/x")).rejects.toBeInstanceOf(UserError);
    await expect(salvarUrlN8n(f, "http://n8n.exemplo.com/x")).rejects.toThrowError(/https/);
    process.env["ALLOW_PRIVATE_WEBHOOKS"] = "1";
  });

  it("RLS: uma família não enxerga a configuração da outra", async () => {
    const a = await novaFamilia("RlsA");
    const b = await novaFamilia("RlsB");
    await salvarUrlN8n(a, url);
    expect((await lerEstadoN8n(b)).url).toBeNull();
    const vistas = await withFamilia(b, (tx) => tx.execute(`select count(*)::int as n from family_integrations` as never));
    expect(Number((vistas as unknown as Array<{ n: number }>)[0]!.n)).toBe(0);
  });
});
