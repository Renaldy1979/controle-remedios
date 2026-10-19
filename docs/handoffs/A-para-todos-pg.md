# A → todos: contrato do banco Postgres (`@medcuidar/pg`) — Fase R1

Detalhes completos em `docs/07-banco-postgres.md`. Este é o resumo para API v1 (R2), portal (R3) e N8N (R4).

## Como subir
```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed   # Postgres 16 em localhost:5440, família demo
```
Variáveis (`.env.example`): `DATABASE_URL` (papel `medcuidar_app`, sem BYPASSRLS — a aplicação) e `DATABASE_URL_ADMIN` (papel dono — só migração/seed/testes).
Dependência no `package.json` do consumidor: `"@medcuidar/pg": "workspace:*"` (e `drizzle-orm` para `eq`, `sql`, etc.).

## Exports (`import … from "@medcuidar/pg"`; schema também em `@medcuidar/pg/schema`)
| Export | O que é |
|---|---|
| `getDb()`, `closeDb()`, tipos `Db`, `Tx` | pool único (postgres.js + Drizzle) do papel app |
| `withFamilia(familiaId, async (tx) => …)` | transação com `app.familia_id` (valida UUID). **Todo** acesso a dados de negócio |
| `withPlataforma(async (tx) => …)` | transação com `app.plataforma='on'` (só `platform_api_keys`, `platform_audit_log`) |
| `resolverMembroPorTelefone(tel)` | `{ membroId, familiaId, ativo, familiaAtiva } \| null` (telefone **verificado**, só dígitos) |
| `resolverMembroPorAppwriteUser(id)` | `{ membroId, familiaId, ativo } \| null` (login) |
| `resolverApiKeyPorHash(sha256)` | `{ tipo: "familia"\|"plataforma", keyId, familiaId, escopos } \| null` |
| `verificarTelefonePendente(tel, codigoHash)` | `{ resultado: "verificado"\|"invalido"\|"bloqueado"\|"em_uso", membroId, familiaId }` |
| `sha256`, `gerarCodigoVerificacao`, `hashCodigoVerificacao`, `gerarApiKey("familia"\|"plataforma")` | helpers de hash/chaves (`cdf_`/`cpl_`); guarde só o hash |
| `uuidDeterministico(nome)`, `seedDemo()`, `DEMO_FAMILIA_ID`, `demoId(nome)` | ids estáveis e seed |
| tabelas Drizzle (`families`, `members`, `doseEvents`, …) e `FAMILY_TABLES` | schema |

Tipos de linha: `typeof s.doseEvents.$inferSelect` / `$inferInsert` (ex.: `import * as s from "@medcuidar/pg/schema"`).

## Exemplos
```ts
import { and, eq, sql } from "drizzle-orm";
import * as s from "@medcuidar/pg/schema";
import { withFamilia, resolverMembroPorTelefone, sha256 } from "@medcuidar/pg";

// X-Telefone → família (sem "qual família?")
const m = await resolverMembroPorTelefone(req.headers.get("x-telefone") ?? "");
if (!m?.ativo || !m.familiaAtiva) return generico();

// confirmar dose de forma idempotente
await withFamilia(m.familiaId, async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`);
  const [dose] = await tx.update(s.doseEvents)
    .set({ status: "taken", confirmedAt: new Date(), confirmedByMemberId: m.membroId, channel: "whatsapp", sourceMessageId: wamid })
    .where(and(eq(s.doseEvents.id, doseId), eq(s.doseEvents.status, "pending"))).returning();
  if (!dose) return;
  // desconto único por dose: 23505 aqui = já descontado
  await tx.insert(s.stockMovements).values({ familyId: m.familiaId, stockItemId, type: "dose", quantity: -dose.amount, doseEventId: dose.id })
    .onConflictDoNothing();
});

// saldo = soma dos movimentos
const [{ saldo }] = await withFamilia(fid, (tx) => tx.select({ saldo: sql<number>`coalesce(sum(${s.stockMovements.quantity}),0)::float` })
  .from(s.stockMovements).where(eq(s.stockMovements.stockItemId, itemId)));
```

## O que muda para o domínio (`packages/domain`) — nada quebra, mas atenção
- Nomes snake_case iguais aos de `types.ts`; o Drizzle devolve **camelCase** nas propriedades (`scheduledAt`, `familyId`). Mapear na borda (repositório) ou usar `getTableColumns`/aliases.
- `scheduled_at`/`confirmed_at` vêm como `Date` (o domínio usa string ISO → `.toISOString()`); `date` (`start_date`, `issued_on`…) vem como `"YYYY-MM-DD"`.
- `members.phone_e164`/`whatsapp_status` **não existem mais**: usar `phone_verified` (só dígitos, DDI+DDD+número, sem `+`), `phone_pending`. WhatsApp ligado = `phone_verified IS NOT NULL`.
- `notifications_outbox` virou `notifications` (avisos do portal, por membro, com `read_at`, `whatsapp_sent_at` e `dedupe_key` único por família). Fila de envio do WhatsApp deixa de existir: a API devolve a mensagem pronta e marca `whatsapp_sent_at`.
- `whatsapp_messages` virou `message_log` (`provider_message_id` único, só `body_redacted`; sem `from_phone`).
- `login_codes` sai (login é do Appwrite Auth). `families.settings` é jsonb (`FamilySettings`).
- `chave cdf_` → `api_keys`; `cpl_` → `platform_api_keys`. `resolverApiKeyPorHash` procura nas duas.
- Idempotência de API: tabela `idempotency` (único `(family_id, key)`); expirar em 24 h na leitura/limpeza.

## Regras que valem para todo mundo
1. Nunca ler/escrever dados de negócio fora de `withFamilia`. Sem família o banco devolve zero linhas.
2. `familyId` vem da sessão/chave/telefone resolvidos, nunca de parâmetro do cliente ou de IA.
3. Sem dado pessoal em logs; telefone completo só em `members.phone_*`.
4. Mudança de contrato do banco: `docs/07-banco-postgres.md` primeiro, depois `src/schema.ts` + `pnpm db:generate`.
5. Banco de testes de outros pacotes: use `pnpm db:up` e famílias descartáveis (veja `src/testing.ts` como exemplo); não use o seed demo para asserções destrutivas.

## Fora do escopo desta fase (para as próximas)
Rotas `/api/v1`, troca do portal para o Postgres, remoção de `packages/db`/`scripts/appwrite`/`apps/functions`, limpeza periódica de `idempotency`/`notifications`, geração de doses futuras no seed.
