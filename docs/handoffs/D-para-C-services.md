# Integrações (D) → Frontend (C): contrato de `createServices`

Código: `apps/functions/src/services.ts` e `runtime.ts`. Uso **apenas no servidor** (Server Actions, route handlers); o pacote usa a chave de API do Appwrite.

```ts
import { createServices } from "@medcuidar/functions";
const svc = createServices(process.env);            // singleton por processo (cache de FamilyScopedDb por família)
```
Variáveis: `APPWRITE_ENDPOINT/PROJECT_ID/DATABASE_ID/API_KEY`, `LOGIN_CODE_SECRET`, canal (`CHANNEL_PROVIDER` = `evolution-go` | `meta-cloud` | `fake`, ver item 3) e, para URLs de receita, `APPWRITE_PRESCRIPTIONS_BUCKET_ID` (padrão `prescriptions`). `createServices` **não** exige `GEMINI_API_KEY` nem `WHATSAPP_WEBHOOK_SECRET`.
Segundo parâmetro (testes): `createServices(env, { channel?, now?, domain?, auth?, signer?, wrapData? })`.

## 1) Métodos (todos assíncronos; `familyId` sempre explícito)

| Chamada | Parâmetros | Retorno |
|---|---|---|
| `svc.doses.confirm(i)` | `{ familyId, doseEventId, memberId, channel: "panel"\|"whatsapp"\|"system", sourceMessageId? }` | `{ result: { outcome: "confirmed"\|"already_confirmed"\|"already_taken"\|"not_found"\|"forbidden", patientId?, medicationId? }, lowStock: LowStockAlert[] }` |
| `svc.doses.undo(i)` | `{ familyId, doseEventId, memberId }` | `{ result: "undone", dose, stockRestored } \| { result: "not_found" } \| { result: "not_taken", dose }` |
| `svc.stock.balance(familyId, stockItemId)` | | `number` (soma do livro-razão) |
| `svc.stock.adjust(i)` | `{ familyId, stockItemId, newBalance, memberId, note? }` | `{ movement: StockMovement \| null, balance }` (`null` = saldo já era esse). Lança se `newBalance` < 0 |
| `svc.stock.registerPurchase(i)` | `{ familyId, stockItemId, quantity (>0), memberId, replenishmentId?, note? }` | `{ balance }`. Lança se `quantity` ≤ 0 |
| `svc.replenishment.claim(i)` | `{ familyId, replenishmentId, memberId, takeOver? }` | `{ ok: true, replenishment, notify? } \| { ok: false, reason: "already_claimed"\|"closed"\|"no_current_step"\|"not_found" }` |
| `svc.replenishment.advance(i)` | `{ familyId, replenishmentId, memberId, action: "complete"\|"cancel", note?, prescriptionId?, purchaseQuantity? }` | idem; `reason` também `"not_owner"\|"missing_purchase_quantity"`. Ao fechar (`status: "done"`) já grava a compra no estoque |
| `svc.prescriptions.save(i)` | `{ familyId, memberId, patientId, issuedOn "YYYY-MM-DD", validUntil?, doctorName?, specialty?, isControlled?, copies?, notes?, medicationIds[] (≥1), files: [{ storageFileId, page, mime, size }] }` | `{ prescriptionId, superseded: string[], replenishmentsAdvanced: string[] }`. O **upload** ao Storage é do painel; aqui só se registra o `storageFileId` |
| `svc.prescriptions.share(i)` | `{ familyId, prescriptionId, memberId, targetMemberId }` | `{ shared: boolean }` (`false` = sem arquivo/receita). Enfileira no WhatsApp com URL assinada e audita |
| `svc.prescriptions.recordView(i)` | `{ familyId, prescriptionId, memberId }` | `void` (grava `prescription_views`) |
| `svc.login.requestCode(phone)` | telefone em qualquer formato | **sempre** `{ ok: true }` |
| `svc.login.verifyCode(phone, code)` | `code` de 6 dígitos | `{ ok: true, userId, token, expire? } \| { ok: false }` |
| `svc.domain.stockOverview({ familyId, patientId? })` | | `StockOverviewLine[]` (`daysLeft` 3650 = "cobre até o fim do tratamento") |
| `svc.dataFor(familyId)` | | `FamilyData` (find/get/create/update/remove presos à família) |

- **"Registrar que tomou depois"**: é `doses.confirm` sobre a dose `late`/`missed` (o domínio aceita). `confirmed_at` é **agora**; não há parâmetro de horário retroativo (me avise se o design exigir).
- **Desfazer** é do painel por até 8 s (a UI controla o prazo); o serviço desfaz a qualquer momento enquanto a dose estiver `taken`.
- Erros de negócio vêm no retorno (`outcome`/`reason`); exceções são falhas de infraestrutura ou entrada inválida.
- Tipos exportados: `ConfirmDoseInput`, `ConfirmDoseResult`, `LowStockAlert`, `StockOverviewLine`, `VerifyResult`, `SavePrescriptionInput`, `Services`.
- Permissões (`can(member, "doses.confirm")` etc.) **não** são checadas aqui: a Server Action confere o perfil antes de chamar (o webhook do WhatsApp faz o mesmo no seu lado).

## 2) Sessão: `token` e mapeamento sessão → membro
`verifyCode` devolve **`userId` + `token` (o `secret`)** do `Users.createToken` do Appwrite (válido por 15 min, uso único). No web:

```ts
// servidor (admin client) — devolve a sessão para gravar em cookie httpOnly
const session = await new Account(adminClient).createSession({ userId, secret: token });
// cookie: session.secret  → nas próximas requisições: new Client().setSession(session.secret)
```
(No navegador, `account.createSession({ userId, secret })` do SDK web também serve.)

Sessão → membro: `account.get().$id` = `members.user_id`. A associação é criada na primeira entrada para **todos** os cadastros com aquele telefone (um por família), então um usuário pode ter vários `member` (um por família): `FamilyScopedDb`/`FamilyData` não consulta entre famílias, então liste as famílias do usuário com `databases.listDocuments("members", [Query.equal("user_id", [userId])])` (índice `by_user`) no servidor com a chave de API e escolha a família ativa. Os usuários **não** são adicionados aos Teams do Appwrite; todo acesso a dados deve passar pelo servidor com `FamilyScopedDb`.

## 3) Modo de teste (e2e contra `demo-familia-souza`)
`CHANNEL_PROVIDER=fake` (recusado se `NODE_ENV=production`): nada sai para a rede; cada envio é anexado a um arquivo JSONL (`FAKE_CHANNEL_FILE`, padrão `%TEMP%/medcuidar-fake-channel.jsonl`), então o processo do Playwright lê o que o servidor Next enviou:

```ts
import { lastLoginCode } from "@medcuidar/channels";
const code = lastLoginCode("+5511900000001");   // último código enviado a esse telefone (null se nenhum)
```
Passo a passo: o teste preenche o telefone de um membro demo (`demo-m-ana` = `+5511900000001`, ver `scripts/appwrite/src/seed.ts`) → o servidor chama `svc.login.requestCode` → o código é enviado pela outbox (entrega imediata, sem cron) → o teste lê `lastLoginCode` → digita → `verifyCode`. Intervalo mínimo entre pedidos ao mesmo telefone: 60 s; no máximo 5 por hora; 5 tentativas por código. Para zerar entre execuções, apague o arquivo do canal (os registros de `login_codes` expiram sozinhos em 10 min).
Para testes de componente/unidade sem Appwrite, use os fakes em memória de `apps/functions/src/testing/` (`buildRealWorld`).
