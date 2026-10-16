import type { LogFields, Logger } from "./ports";

/** Chaves cujo valor nunca vai para o log, qualquer que seja. */
const SENSITIVE_KEY = /phone|fone|telefone|body|text|texto|name|nome|code|codigo|transcript|token|secret|key|url|message|from/i;
/** Telefones (8+ dígitos seguidos, com + ou separadores) e códigos de 6 dígitos em qualquer string. */
const PHONE_LIKE = /\+?\d[\d\s().-]{6,}\d/g;

export function scrub(value: string): string {
  return value.replace(PHONE_LIKE, "[numero]");
}

export function sanitizeFields(fields: LogFields = {}): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(k) && !/^(provider_?message_?id|message_?id|dedupe_?key)$/i.test(k)) {
      out[k] = "[omitido]";
    } else if (typeof v === "string") {
      out[k] = scrub(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export type LogSink = (line: { level: "info" | "warn" | "error"; event: string; fields: LogFields }) => void;

/** Logger estruturado que remove dados pessoais (LGPD). Ids técnicos passam; nomes, telefones e textos não. */
export function createLogger(sink: LogSink): Logger {
  const emit = (level: "info" | "warn" | "error") => (event: string, fields?: LogFields) =>
    sink({ level, event: scrub(event), fields: sanitizeFields(fields) });
  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}

/** Sink padrão: JSON em uma linha no stdout/stderr (capturado pelo Appwrite Functions). */
export const consoleSink: LogSink = ({ level, event, fields }) => {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "info") process.stdout.write(`${line}\n`);
  else console.error(line);
};

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
