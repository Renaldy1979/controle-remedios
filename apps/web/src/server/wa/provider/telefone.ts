/** Telefone do WhatsApp → mesmo formato do cadastro (`members.phone_verified`): só dígitos, celular BR com o 9. */
export const soDigitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

export function telefoneBr(numero: string): string {
  const d = soDigitos(numero);
  return /^55\d{2}[6-9]\d{7}$/.test(d) ? `${d.slice(0, 4)}9${d.slice(4)}` : d;
}
