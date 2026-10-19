import { createHash } from "node:crypto";

const NAMESPACE = "6f1d3b52-8d5e-4c1a-9f0e-3a7b2c9d4e10"; // namespace fixo do MedCuidar

/** UUID v5 determinístico: o mesmo nome gera sempre o mesmo id (seed idempotente e testes estáveis). */
export function uuidDeterministico(nome: string): string {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(ns).update(nome).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
