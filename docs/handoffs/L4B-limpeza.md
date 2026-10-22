# Lote 4B — Limpeza do legado (escopo v1)

**Estado: EXECUTADA** (autorizada pelo dono), em commit separado, com lint, tipos, `pnpm n8n:validar` e todos os testes verdes (24+1 arquivos do portal, 406 testes). Tudo continua no histórico do git. Também saíram do `.env.example` as variáveis só do legado e `APPWRITE_DATABASE_ID`.

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

## Nono dígito do celular brasileiro (resolvido no Lote 4B)
Contas antigas do WhatsApp em vários DDDs (inclusive Minas Gerais) têm o JID **sem o 9** (55 + DDD + 8 dígitos), e o provedor pode entregar ou aceitar o número em qualquer uma das duas formas. Decisões:

1. **Armazenamento:** o número cadastrado fica **como a pessoa digitou**, só dígitos com DDI 55 (`normalizePhone`), sem forçar o 9. A comparação é sempre **pelas duas variantes** (`variantesBr` em `apps/web/src/server/wa/provider/telefone.ts`). Só celulares (8 dígitos começando em 6 a 9) têm duas formas; fixo e número estrangeiro têm uma.
2. **Identidade do remetente (`resolveSender`):** casa as duas variantes contra números **verificados**. Só vale se levarem a **exatamente um** membro. Duas pessoas (na mesma família ou em famílias diferentes) = **ambiguidade**: o remetente é tratado como desconhecido (resposta genérica) e só um contador sobe (`contadores.remetenteAmbiguo`, log `remetente_ambiguo` sem número). Nada vaza entre famílias.
3. **Verificação e convite por código:** tentam as duas formas; o número fica verificado **exatamente como foi cadastrado**. Se qualquer forma do número já é de um membro verificado, o código **não é aceito** (resposta genérica): uma variante nunca "sequestra" o número de outra pessoa.
4. **Envio dos lembretes (`wa/destino.ts`):** usa a forma guardada em `members.whatsapp_send_number` (migração 0009), aprendida quando a pessoa escreve (o número do remetente que chegou) ou num envio anterior. Sem forma guardada, pergunta ao provedor "este número está no WhatsApp?" (`numeroNoWhatsapp`, `POST /user/check` na Evolution Go). Se a consulta não existir ou falhar, tenta a forma cadastrada e, em caso de **"número inexistente"** (recusa clara, nada saiu), faz **uma** retentativa com a outra forma, **sem duplicar**. A forma que funcionou fica guardada. As respostas a quem escreveu sempre vão para o número de onde a mensagem veio.
5. **A confirmar com número real** (`TODO verificar com mensagem real`): rota e formato de `/user/check`, o texto do erro de número inexistente no `/send/text` e se o webhook entrega mesmo o JID sem o 9. Roteiro: `docs/lotes/L4B-roteiro.md`, passo B1b.

O número do chip do sistema **não** entra em código, docs ou testes: é só configuração da Evolution Go.
