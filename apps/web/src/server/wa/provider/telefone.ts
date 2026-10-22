/** Telefone do WhatsApp → mesmo formato do cadastro (`members.phone_verified`): só dígitos, celular BR com o 9. */
export const soDigitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

export function telefoneBr(numero: string): string {
  const d = soDigitos(numero);
  return /^55\d{2}[6-9]\d{7}$/.test(d) ? `${d.slice(0, 4)}9${d.slice(4)}` : d;
}

/**
 * As DUAS formas de um celular brasileiro: com o 9 depois do DDD (55 + DDD + 9 + 8 dígitos) e sem ele (55 + DDD + 8 dígitos). Contas
 * antigas do WhatsApp em vários DDDs têm o JID sem o 9, e o provedor pode entregar ou aceitar qualquer uma. A primeira da lista é a
 * forma recebida. Fixos (8 dígitos começando com 2 a 5) e números de outros países têm uma forma só.
 */
export function variantesBr(numero: string): string[] {
  const d = soDigitos(numero);
  const com = /^(55\d{2})9([6-9]\d{7})$/.exec(d);
  if (com) return [d, `${com[1]}${com[2]}`];
  const sem = /^(55\d{2})([6-9]\d{7})$/.exec(d);
  if (sem) return [d, `${sem[1]}9${sem[2]}`];
  return [d];
}

/** `a` e `b` são o mesmo celular (iguais ou uma é a variante da outra)? */
export const mesmoCelular = (a: string, b: string): boolean => variantesBr(a).includes(soDigitos(b));
