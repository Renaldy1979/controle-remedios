# 07 — Banco Postgres (Fase R1)

Implementa a seção 4 do `docs/06-escopo-v2.md`. Pacote: `packages/pg` (`@medcuidar/pg`). Substitui o modelo do Appwrite Databases de `docs/02` (lista de entidades continua valendo; os nomes de coluna são os mesmos em snake_case).

## 1. Como rodar

```bash
pnpm db:up        # Postgres 16 em Docker (container medcuidar-postgres, porta 5440, volume medcuidar_pgdata)
pnpm db:migrate   # aplica packages/pg/drizzle/*.sql com o papel dono (DATABASE_URL_ADMIN)
pnpm db:seed      # família "Família Souza (demo)" (idempotente)
pnpm db:reset     # apaga o volume e refaz tudo: down -v + up + migrate + seed
pnpm db:test      # testes (unidade + integração; a integração é PULADA se o banco não estiver no ar)
pnpm db:generate  # gera nova migração a partir de packages/pg/src/schema.ts (drizzle-kit)
```

Sem `.env`, os comandos usam os padrões de desenvolvimento do `.env.example` (só fora de `NODE_ENV=production`). Em produção `DATABASE_URL` e `DATABASE_URL_ADMIN` são obrigatórias.

O container é leve de propósito (`shared_buffers=48MB`, `max_connections=30`, `mem_limit 384m`). Não usa nem toca o `caixa-postgres` de outro projeto.

Mudou o schema? Edite `src/schema.ts`, rode `pnpm db:generate` e, se precisar de SQL à mão (RLS, funções), `pnpm --filter @medcuidar/pg exec drizzle-kit generate --custom --name <nome>`. O contrato é mudado **neste doc primeiro**.

## 2. Papéis (`docker/init-roles.sh`)

| Papel | Uso | Atributos |
|---|---|---|
| `postgres` | só o container (superusuário local) | superusuário |
| `medcuidar_owner` | dono do banco e do schema; roda migrações, seed e testes (`DATABASE_URL_ADMIN`) | sem superusuário, **com BYPASSRLS** (necessário: as tabelas têm FORCE RLS e as funções SECURITY DEFINER pertencem a ele) |
| `medcuidar_app` | portal e API (`DATABASE_URL`) | sem superusuário, **sem BYPASSRLS**, sem CREATEDB/CREATEROLE; só `SELECT/INSERT/UPDATE/DELETE` nas tabelas + `EXECUTE` nas 4 funções |

O papel `app` não cria, altera nem apaga objetos, não desliga o RLS (`set row_security = off` faz a consulta falhar) e não assume o dono. Tudo isso é testado.

## 3. Tabelas

Chaves `uuid` (`gen_random_uuid()`), datas `timestamptz` (UTC), `date` para datas de calendário, enums nativos do Postgres com os mesmos valores de `@medcuidar/shared`. Toda tabela de negócio tem `family_id → families.id`.

| Tabela | Relações / regras |
|---|---|
| `families` | `name`, `timezone` (`America/Sao_Paulo`), `settings` jsonb (`FamilySettings`), `active`, `deleted_at` |
| `profiles` | por família; único `(family_id, name)`; `permissions` jsonb |
| `members` | `profile_id → profiles`; **`access_state`** (`invited` \| `whatsapp_verified` \| `active`, padrão `invited`), `email`, `email_confirmed_at`, `appwrite_user_id` (único, parcial), `phone_verified` (**único no sistema**, parcial), `phone_pending`, `verification_code_hash/expires_at/attempts`, `receives_family_alerts`, `active`, `removed_at`. Checks: `active` exige `appwrite_user_id` + e-mail + `email_confirmed_at`; fora de `active` esses dois não existem (o `email` pré-preenchido pode); `whatsapp_verified` exige `phone_verified` |
| `invites` | convite por `email` ou `whatsapp`: `profile_id`, `member_id` (membro criado, nasce `invited`), `email` **xor** `expected_phone` (só dígitos), `code_hash` (hash preso ao número, nunca o código), `expires_at` (24 h), `attempts`, `consumed_at`, `revoked_at`, `created_by_member_id`. Único **um convite WhatsApp ativo por `expected_phone`** (índice parcial: sem `consumed_at`/`revoked_at`), então o app revoga o antigo antes de criar outro |
| `first_access_links` | `member_id`, `token_hash` (sha256, único; o token só existe no link enviado), `expires_at` (24 h), `consumed_at`, `revoked_at` |
| `patients` | `self_member_id → members` (opcional: paciente que também é usuário), `reminder_recipients_mode` |
| `care_assignments` | paciente × membro × dias da semana × janela `HH:mm` × prioridade |
| `medications` | `route`, `control_unit`, `drops_per_ml` (colírio), `package_size` |
| `treatments` | paciente × remédio; `status`, `start_date/end_date`, `low_stock_days` |
| `treatment_phases` | `(treatment_id, order)` único; check: `interval` exige `interval_hours`+`first_dose_time`, `fixed_times` exige `times` |
| `dose_events` | **único `(treatment_id, scheduled_at)`**; único `source_message_id` (parcial); `status`, `channel`, `confirmed_by_member_id`; `remind_again_at` (pedido "lembrar de novo", migração 0004: o Lote 2 grava, o envio é do Lote 4) |
| `stock_items` | único `(family_id, patient_id, medication_id)`; `is_estimate`; `cached_balance` é só cache |
| `stock_movements` | **livro-razão**; **único `dose_event_id`** (parcial); check: `type='dose'` exige `dose_event_id`; `quantity <> 0`. Compensações de "desfazer" são `adjustment` sem `dose_event_id` (`note: undo:<doseId>:<n>`), como o domínio já faz |
| `prescriptions`, `prescription_files`, `prescription_items`, `prescription_shares`, `prescription_views` | receita e anexos (`storage_file_id` = arquivo no bucket do Appwrite, só URL assinada), itens `(prescription_id, medication_id)` único, compartilhamentos e visualizações auditáveis |
| `replenishments` | no máximo **uma aberta** por `(paciente, remédio)` (índice parcial: status fora de `done/cancelled`) |
| `replenishment_steps` | único `(replenishment_id, step)` |
| `notifications` | avisos do portal por membro; `read_at`; `whatsapp_sent_at` (marca de envio idempotente); **único `(family_id, dedupe_key)`** |
| `message_log` | WhatsApp entrada/saída; **único `provider_message_id`**; só texto redigido (sem dado pessoal) |
| `audit_log` | `actor_member_id`, `action`, `entity`, `entity_id`, `meta` |
| `api_keys` | chaves `cdf_` por família; só `key_hash` (sha256, único), `scopes`, `last_used_at`, `revoked_at` |
| `idempotency` | **único `(family_id, key)`**; `request_hash`, `status` (nulo = em andamento), `response` jsonb, `created_at` (a API expira em 24 h) |
| `platform_api_keys` | chaves `cpl_` da plataforma (N8N), sem família |
| `platform_audit_log` | auditoria das chamadas da plataforma (telefone mascarado) |
| `phone_lockouts` | tentativas por telefone na verificação; sem política (só a função mexe) |

Integridade entre famílias: as FKs são simples (não compostas). O RLS impede escrever `family_id` alheio; um id de outra família numa FK exigiria conhecê-lo e a API valida o escopo do recurso. Se isso virar risco, passar a FKs compostas `(family_id, id)` numa migração.

## 4. RLS

- Todas as tabelas com `family_id` e `families`: `ENABLE` + `FORCE ROW LEVEL SECURITY` e a política `family_isolation`:
  `family_id = nullif(current_setting('app.familia_id', true), '')::uuid` em `USING` **e** `WITH CHECK` (em `families`: `id = ...`). O `nullif` evita erro de cast quando o valor é vazio; sem `app.familia_id` nada é visível nem gravável.
- `platform_api_keys` e `platform_audit_log`: política `platform_access` com `current_setting('app.plataforma', true) = 'on'`. Dentro de `withPlataforma` as tabelas de família continuam invisíveis.
- `phone_lockouts`: RLS ligado sem política e sem `GRANT` ao papel app.
- Funções `SECURITY DEFINER` (`search_path` fixo, `EXECUTE` só para `medcuidar_app`), o mínimo para o que acontece **antes** de saber a família:

| SQL | TS (`@medcuidar/pg`) | Para quê |
|---|---|---|
| `resolve_member_by_phone(tel)` | `resolverMembroPorTelefone` | telefone **verificado** → membro e família (sem passo "qual família") |
| `resolve_member_by_appwrite_user(id)` | `resolverMembroPorAppwriteUser` | sessão do Appwrite Auth → membro e família |
| `resolve_api_key(hash)` | `resolverApiKeyPorHash` | chave `cdf_` (família) ou `cpl_` (plataforma); ignora revogadas; marca `last_used_at` |
| `consume_whatsapp_invite(tel, hash)` | `consumirConviteWhatsapp` | convite por WhatsApp (ver seção 4.1) |
| `resolve_first_access_link(hash)` / `consume_first_access_link(hash)` | `resolverLinkPrimeiroAcesso` / `consumirLinkPrimeiroAcesso` | link de primeiro acesso: resolver (só leitura) e consumir (uso único, atômico) |
| `verify_pending_phone(tel, hash)` | `verificarTelefonePendente` | o remetente envia o código; vira `verificado`, `invalido`, `bloqueado` (5 erros/15 min) ou `em_uso` |

- Gatilho `members_phone_change`: informar um `phone_pending` novo zera o `phone_verified` do membro ("trocar o número invalida o verificado"); quem era `whatsapp_verified` volta a `invited`.
- `resolve_member_by_phone` e `resolve_member_by_appwrite_user` devolvem também `access_state` (`estadoAcesso`). **A API decide o que cada estado pode**: `invited` não pode nada; `whatsapp_verified` só as permissões básicas pelo WhatsApp (check de dose, próxima dose, estoque, avisos); `active` tudo o que o perfil permite. O banco só garante a coerência dos dados (checks acima).

### 4.1 Estados de acesso, convites e primeiro acesso (docs/06 seção 2)

Fluxo: o admin cria o membro (`invited`) e o convite em `withFamilia`, guardando só `hashConviteCodigo(telefone, código)` e `expires_at = agora + 24 h` (`VALIDADE_CONVITE_MS`); mostra o código uma vez. O convidado envia o código ao WhatsApp do sistema; o N8N chama a API com o **remetente real**, que chama `consumirConviteWhatsapp(remetente, hashConviteCodigo(remetente, código))`:

- Só encontra o convite pelo **número do remetente** (`expected_phone`). Outro número, mesmo com o código certo, não acha o convite, **não gasta tentativa dele** e recebe a mesma resposta de "código errado" (não revela se existe convite). O custo do erro vai para o remetente (`phone_lockouts`: 5 erros em 15 min bloqueiam aquele número).
- Erro com o número esperado: `attempts + 1`; no 5º erro o convite é revogado.
- Sucesso: `consumed_at` (uso único), `phone_verified = remetente`, `access_state = whatsapp_verified` (se ainda `invited`). Número já verificado por outro usuário → `em_uso`, convite intacto. Expirado, revogado ou consumido → `invalido`.
- Depois do `verificado`, o app cria o link de primeiro acesso: `gerarTokenPrimeiroAcesso()` → grava `first_access_links` (`hash`, 24 h) e envia o `token` ao WhatsApp verificado.
- Primeiro acesso: `resolverLinkPrimeiroAcesso(sha256(token))` para a tela (não gasta o link); ao concluir, `consumirLinkPrimeiroAcesso` (atômico: só um de vários pedidos concorrentes vence) e então o app, em `withFamilia`, cria o usuário no Appwrite e atualiza o membro para `active` (`appwrite_user_id`, `email`, `email_confirmed_at`). Convite por e-mail usa `invites.kind = 'email'` (sem código; o e-mail é enviado pelo Appwrite) e o mesmo caminho até `active`.
- `invites` e `first_access_links` têm RLS por família: a família B não lê, altera nem apaga os da A. As funções acima são as únicas que enxergam entre famílias, e só pelo hash.

Limite conhecido: quem controla o código da aplicação pode escolher qualquer `app.familia_id`. O RLS protege contra bug de consulta (esquecer o filtro, id trocado), não contra código malicioso do servidor. A identidade da família sempre vem da sessão/chave/telefone resolvidos, nunca de parâmetro livre.

## 5. Como usar o `withFamilia`

```ts
import { eq } from "drizzle-orm";
import { withFamilia, resolverMembroPorTelefone } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";

// 1) descobrir a família (sessão, chave Bearer ou telefone do remetente)
const m = await resolverMembroPorTelefone("5511900000001");
if (!m || !m.ativo || !m.familiaAtiva) return respostaGenerica();

// 2) TODO acesso a dados de negócio dentro de withFamilia (uma transação; erro = rollback de tudo)
await withFamilia(m.familiaId, async (tx) => {
  const [dose] = await tx.select().from(s.doseEvents).where(eq(s.doseEvents.id, id));
  await tx.insert(s.stockMovements).values({ familyId: m.familiaId, stockItemId, type: "dose", quantity: -2, doseEventId: id });
});
```

Regras de uso:
1. Nunca use `getDb()` direto para dados de negócio (sem família não vê nada). `getDb()` serve para as funções de `sistema.ts` e para `withFamilia`/`withPlataforma`.
2. Sempre informe `familyId` nos `insert` (o `WITH CHECK` recusa outro valor).
3. `withPlataforma` só para `platform_api_keys` e `platform_audit_log`.
4. Idempotência de webhook/comando: faça `insert` em `message_log`/`idempotency`/`dose_events.source_message_id` e trate `23505` (unique violation) como "já processado". Para serializar a mesma `Idempotency-Key`, use `select pg_advisory_xact_lock(hashtextextended(key, 0))` no início da transação.
5. Saldo de estoque = `sum(stock_movements.quantity)`; `cached_balance` é cache e pode ser atualizado na mesma transação.
6. Datas de calendário (`date`) vêm como `"YYYY-MM-DD"` (string); instantes (`timestamptz`) como `Date` (o domínio usa ISO: converta com `.toISOString()`).
7. Migrações só com o papel dono. A aplicação nunca recebe `DATABASE_URL_ADMIN`.

## 6. Testes

`packages/pg/src/*.test.ts` — `unit.test.ts` (ids, hashes, validação) e `integration.test.ts` (Postgres real, papel `medcuidar_app`): isolamento por RLS (leitura, insert, update, delete, SQL cru, sem contexto, tabelas de plataforma), índices únicos de dose/movimento/notificação/mensagem/idempotência, telefone verificado único e fluxo de verificação, rollback, convites e estados de acesso (checks de `active`, convite preso ao número, uso único, expiração, limite de tentativas, `em_uso`, link de primeiro acesso, RLS das tabelas novas), e limites do papel (sem superusuário/BYPASSRLS, não desliga RLS, não cria nem altera tabelas). Cada execução cria duas famílias descartáveis e as apaga ao final; o seed demo não é tocado.

## 6.1 Migração 0004 (Lote 2)

`0004_dose_lembrar_de_novo.sql`: acrescenta `dose_events.remind_again_at timestamptz` (nulo). Nenhuma tabela nova: `notifications` (avisos do sino, `dedupe_key` único por família), `stock_items` e `stock_movements` já existiam e seguem com RLS por família (o teste de isolamento do Lote 2 cobre `dose_events`, `stock_items`, `stock_movements` e `notifications`). O limite de estoque baixo por remédio é `treatments.low_stock_days` (nulo = padrão da família em `families.settings.default_low_stock_days`). Aplicar no staging: `node /app/migrate/migrate.mjs` com `DATABASE_URL_ADMIN` temporária (ver `docs/09`).

Convenções do livro-razão usadas pelo portal: compra = `purchase`; saldo inicial = `purchase` com `note = 'Saldo inicial'`; ajuste manual = `adjustment` com `note = 'Ajuste: <motivo>'`; baixa de dose = `dose` (único por `dose_event_id`); desfazer/refazer = `adjustment` com `note = 'undo:<dose>:<n>'` / `'redo:<dose>:<n>'`. O aviso de estoque baixo usa `dedupe_key = low_stock:<stock_item>:<ciclo>:<membro>`, onde o ciclo é a última entrada (compra ou ajuste positivo que não seja undo/redo): um aviso por ciclo e por pessoa.

## 7. Divergências e pendências

- `docs/06` cita `app.familia_id` simples; usamos `nullif(...)::uuid` (equivalente, sem erro de cast).
- Chaves `cdf_` e `cpl_` ficam em duas tabelas (`api_keys` com família, `platform_api_keys` sem), por causa do RLS; `resolve_api_key` procura nas duas.
- Falta (próximas fases): rotinas de limpeza (`idempotency` > 24 h, `notifications` antigas), geração das doses futuras do seed e FKs compostas por família, se desejado.
