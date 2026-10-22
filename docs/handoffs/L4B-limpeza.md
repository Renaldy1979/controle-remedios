# Lote 4B — Limpeza do legado (escopo v1)

**Estado: PREPARADA, NÃO EXECUTADA.** A remoção de pastas foi bloqueada pelo classificador de permissões da sessão (“destruição local irreversível”). Tudo está no git (nada se perde). Falta autorização para rodar a remoção; os passos abaixo são exatamente o que será feito, em commit separado, só com tudo verde.

## Já feito (sem apagar nada)
- `apps/web/src/components/screens/LoginScreen.tsx`: tela simulada (só `DATA_SOURCE=mock`) não chama mais `auth-actions` legado.
- `apps/web/src/components/app/AppShell.tsx`: “Sair” usa `signOut` de `server/pg/auth-actions` (o `logoutAction` legado dependia do Appwrite v1).
- Regras do legado ainda úteis já vivem no código novo: interpretação de mensagens (`apps/web/src/server/wa/interpret.ts`), normalização/envio da Evolution Go (`integrations/n8n/lib/evolution.ts`, com fixtures e testes).
- `pnpm schema:apply` e `pnpm seed` (Appwrite) já saíram do `package.json` da raiz.

## A remover (confirmado por grep: nada de `packages/pg`, `packages/domain`, `packages/shared` ou do que o portal usa em produção depende disso)
| O quê | Por quê |
|---|---|
| `apps/functions` | agendador, fila, webhook e login por código do v1: substituídos pela API `/api/v1` e pelos fluxos do N8N (`docs/06` §7) |
| `packages/channels` | o texto é gerado pela API; o envio é do N8N/Evolution Go |
| `packages/db` (Appwrite Databases) e `scripts/appwrite` | substituídos por Postgres + Drizzle + RLS; o Appwrite fica só com Auth e bucket |
| `integrations/n8n/{alertas-operacionais,disparo-agendador,transcricao-audio,whatsapp-entrada}.json` | substituídos por `integrations/n8n/fluxos/*` |
| `apps/web/src/server/{actions,auth-actions,clients,context,data,mutations,services,session,snapshot}.ts` + testes `mutations/session/snapshot` | camada v1 do portal (Appwrite Databases + `@medcuidar/functions/channels/db`); o portal v2 usa `server/pg/*` e `server/wa/*` |
| `apps/web/src/components/screens/FamilyPickerScreen.tsx` e `FamilyPicker.test.tsx` | seletor de família do v1 (só o teste o usava) |

## A ajustar junto
`pnpm-workspace.yaml` (tirar `scripts/*`), `apps/web/package.json` (dependências `@medcuidar/{channels,db,functions}`), `apps/web/next.config.ts` (`transpilePackages`), `pnpm-lock.yaml`, `.github/workflows/ci.yml` (comentário sobre `@medcuidar/db`), `.env.example` (variáveis só do legado: `CHANNEL_PROVIDER`, `EVOLUTION_*`, `META_*`, `WHATSAPP_WEBHOOK_SECRET`, `LOGIN_CODE_SECRET`, `TRANSCRIPTION_*`, `GEMINI_*`, `HEARTBEAT_URL`, `ALERTS_*`, `SCHEDULER_TRIGGER_SECRET`, `SMOKE_*`, `APPWRITE_DATABASE_ID`), `CLAUDE.md` (convenções de pastas) e `docs/06` §7 (marcar como removido).

## Verificação depois da remoção
`pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (os testes do legado saem da contagem), `pnpm n8n:validar`, e2e dos lotes 1 a 4B.

## Pendência de regra (não copiada porque a identidade é sensível)
`packages/channels/src/phone.ts` tinha `phoneVariants`: o WhatsApp pode entregar números antigos do Brasil **sem o nono dígito** (55 + DDD + 8 dígitos). O código novo (`resolveSender`) casa o número exato. Se, com número real, o dono validar um número e a mensagem chegar sem o 9, será preciso casar as duas variantes **só na identificação do remetente** (com teste de que não vaza entre famílias). Anotado como risco do roteiro 4B (B1).
