/** Contexto mínimo das Appwrite Functions (runtime Node) usado pelos pontos de entrada. */
export interface FnContext {
  req: { bodyText: string; headers: Record<string, string | undefined>; method?: string; path?: string };
  res: { json(body: unknown, status?: number): unknown };
  log(message: string): void;
  error(message: string): void;
}
