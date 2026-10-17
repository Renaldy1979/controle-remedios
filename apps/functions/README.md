# @medcuidar/functions

Functions do Appwrite (Node) e peças de integração com o WhatsApp. A regra de negócio **não mora aqui**: tudo que é regra entra por `DomainPort` (`src/ports.ts`), ligado a `@medcuidar/domain` na Fase 3 — ver `docs/handoffs/D-para-orquestrador-ligacao-dominio.md`.

| Peça | Arquivo |
|---|---|
| Fila de saída (worker, retentativa, `dedupe_key`) | `src/outbox.ts` |
| Agendador (cron de 1 min) | `src/scheduler.ts` → Function `src/entries/scheduler.ts` |
| Webhook de entrada | `src/inbound/handler.ts` → Function `src/entries/whatsapp-inbound.ts` |
| Interpretação de texto/áudio | `src/inbound/interpret.ts`, `src/transcription/*` |
| Login por código | `src/login.ts` → Function `src/entries/login-code.ts` |
| Dados | `src/data/appwrite.ts` (`FamilyScopedDb`) · fakes em `src/testing/` |
| Simulador de WhatsApp | `src/simulator/` |

## Testar sem número de WhatsApp
```bash
pnpm --filter @medcuidar/functions test                    # suíte completa (fakes em memória)
pnpm --filter @medcuidar/functions simulate -- --scenario  # lembrete → Tomei → desconto → alerta
pnpm --filter @medcuidar/functions simulate                # modo interativo (/ajuda)
pnpm --filter @medcuidar/functions serve:local             # HTTP local em 127.0.0.1:8787 para o N8N de desenvolvimento
```
O simulador usa domínio falso, canal falso e banco em memória: nunca toca na Evolution nem no Appwrite.

## Publicar as Functions
Entradas em `src/entries/` (export default `({ req, res })`). Variáveis: ver `docs/handoffs/D-para-A-variaveis-de-ambiente.md`. Agendar `scheduler` com `* * * * *`. Rodar **uma instância** do worker por vez.

## Privacidade nos logs
Use sempre o `Logger` de `src/log.ts`: ele omite campos sensíveis (telefone, nome, texto, código) e mascara números em strings. Alertas operacionais carregam só ids e contagens.

## API pública para o painel (server-side)
Importe de `@medcuidar/functions` **apenas em código de servidor** (Server Actions, route handlers): o pacote usa a chave de API do Appwrite.

```ts
import { createServices } from "@medcuidar/functions";
const svc = createServices(process.env); // domínio real + FamilyScopedDb + canal + login por código
```

| Grupo | Chamada | O que faz |
|---|---|---|
| `login` | `requestCode(phone)` | Cria o código (hash + limites) e enfileira no WhatsApp. **Sempre** responde `{ ok: true }`, o número exista ou não |
| | `verifyCode(phone, code)` | `{ ok: true, userId, token, expire? }` ou `{ ok: false }`. No painel: `account.createSession({ userId, secret: token })`. Cria/associa o usuário Appwrite na primeira entrada e grava `members.user_id` |
| `doses` | `confirm({ familyId, doseEventId, memberId, channel, sourceMessageId? })` | `channel`: `panel`, `whatsapp` ou `system`. Idempotente por dose e por mensagem. Devolve `{ result, lowStock }` com o aviso de reposição quando o estoque cruza o limite |
| | `undo({ familyId, doseEventId, memberId })` | Desfaz (o prazo de 8 s é da interface); devolve o estoque com `adjustment` |
| `stock` | `balance(familyId, stockItemId)` | Saldo = soma do livro-razão |
| | `adjust({ familyId, stockItemId, newBalance, memberId, note? })` | Ajuste manual → movimento `adjustment` com a diferença (+ auditoria) |
| | `registerPurchase({ familyId, stockItemId, quantity, memberId, replenishmentId?, note? })` | Compra → movimento `purchase` |
| `replenishment` | `claim({ familyId, replenishmentId, memberId, takeOver? })` | "Eu cuido disso" / "Assumir no lugar" |
| | `advance({ familyId, replenishmentId, memberId, action, note?, prescriptionId?, purchaseQuantity? })` | `action`: `complete` ou `cancel`. Ao fechar ("Estoque atualizado") soma a compra ao estoque |
| `prescriptions` | `save({ familyId, memberId, patientId, issuedOn, validUntil?, medicationIds, files, ... })` | Grava receita + itens + arquivos, substitui vencidas/aguardando e avança reposições |
| | `share({ familyId, prescriptionId, memberId, targetMemberId })` | Enfileira a receita no WhatsApp (URL assinada), grava compartilhamento + auditoria |
| | `recordView({ familyId, prescriptionId, memberId })` | Registra visualização |
| `domain` | `DomainPort` completo | `stockOverview`, `checkLowStock`, `resolveResponsible`, `findExpiringPrescriptions`, `getPrescriptionForSharing`... |
| `dataFor(familyId)` | `FamilyData` | Acesso a dados preso à família (`FamilyScopedDb`) |

Tipos exportados: `ConfirmDoseInput`, `ConfirmDoseResult`, `LowStockAlert`, `StockOverviewLine`, `VerifyResult`, `SavePrescriptionInput`, `Services`.
Variáveis exigidas por `createServices`: `APPWRITE_*`, `LOGIN_CODE_SECRET` e as do canal (`CHANNEL_PROVIDER`, `EVOLUTION_*`...). `APPWRITE_PRESCRIPTIONS_BUCKET_ID` (padrão `prescriptions`) é o bucket das receitas para as URLs assinadas.

## Smoke contra o Appwrite real (só a família demo)
```bash
pnpm --filter @medcuidar/functions e2e:demo
```
Usa o `.env` da raiz, **canal falso** (nada vai ao WhatsApp) e só mexe em `demo-familia-souza`. Gera as doses de hoje, resolve responsáveis, roda agendador e fila, confirma, confere o desconto, repete (idempotência), desfaz e confere a devolução. Tudo que cria é removido no fim e o que alterou é restaurado (diário em `%TEMP%\medcuidar-e2e-demo-created.json`, limpo na próxima execução se o script cair).
