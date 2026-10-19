/** Erro com mensagem segura para mostrar à pessoa. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export class ForbiddenError extends Error {
  constructor(permission: string) {
    super(`Sem permissão: ${permission}`);
    this.name = "ForbiddenError";
  }
}

/** Código SQLSTATE do Postgres (23505 = violação de índice único), mesmo embrulhado pelo Drizzle. */
export function pgCode(e: unknown): string | undefined {
  const x = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const c = x?.code ?? x?.cause?.code;
  return typeof c === "string" ? c : undefined;
}
export const isUniqueViolation = (e: unknown): boolean => pgCode(e) === "23505";
