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
