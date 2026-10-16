/** Normaliza para E.164 (`+5511999998888`). Retorna null se não parecer telefone. */
export function normalizePhone(raw: string): string | null {
  const base = raw.split("@")[0]!.split(":")[0]!;
  const digits = base.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  // Brasil sem código do país: DDD + 8 ou 9 dígitos.
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return `+${digits}`;
}

/**
 * O WhatsApp às vezes entrega números antigos sem o nono dígito (55 + DDD + 8 dígitos).
 * Devolve as variantes para casar com o cadastro.
 */
export function phoneVariants(e164: string): string[] {
  const m = /^\+55(\d{2})(9?)(\d{8})$/.exec(e164);
  if (!m) return [e164];
  return [`+55${m[1]}9${m[3]}`, `+55${m[1]}${m[3]}`];
}

export function phoneToJid(e164: string): string {
  return `${e164.replace(/\D/g, "")}@s.whatsapp.net`;
}

/** Evolution aceita número puro (sem +) para contatos e o JID completo para grupos. */
export function destinationFor(to: string): string {
  return to.endsWith("@g.us") ? to : to.replace(/\D/g, "");
}
