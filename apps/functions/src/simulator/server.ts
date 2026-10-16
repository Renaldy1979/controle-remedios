import { createServer } from "node:http";
import { handleWhatsappInbound } from "../inbound/handler";
import { WhatsAppSimulator } from "./simulator";

/**
 * Servidor HTTP local para apontar o N8N de desenvolvimento (ou curl) ao pipeline real com domínio falso.
 *   POST /whatsapp-inbound  (assinado, mesmo contrato da Function)
 *   POST /tick              agendador + fila
 *   GET  /sent              o que o "WhatsApp" entregaria
 * Escuta só em 127.0.0.1.
 */
const sim = new WhatsAppSimulator();
const port = Number(process.env["SIM_PORT"] ?? 8787);

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    void (async () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method === "POST" && req.url === "/whatsapp-inbound") {
        const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
        const out = await handleWhatsappInbound(sim.world.inboundDeps, { rawBody, headers });
        await sim.world.flushOutbox();
        return send(out.status, out.body);
      }
      if (req.method === "POST" && req.url === "/tick") return send(200, await sim.tick());
      if (req.method === "GET" && req.url === "/sent") return send(200, sim.world.channel.sent);
      return send(404, { ok: false });
    })();
  });
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`Simulador em http://127.0.0.1:${port} (segredo de assinatura: veja SECRET em testing/world.ts)\n`);
});
