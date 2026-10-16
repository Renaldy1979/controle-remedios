# Fundação (A) → todos: contratos e ambiente

Estado: Fase 1 concluída (aguardando revisão do orquestrador).

## Ambiente
- Node 20+, pnpm 9 (`corepack enable`). `pnpm install` na raiz.
- **Appwrite:** o dono optou por usar o Appwrite de **produção** (EasyPanel) já na fase de desenvolvimento, projeto `controle-remedios`, banco `medcuidar`, servidor 1.8.1. SDK fixado em `node-appwrite@19.1.0` (versão que não gera aviso de incompatibilidade com o servidor). Não atualizar o SDK sem testar.
- Credenciais só no `.env` da raiz (ignorado pelo git). Modelo em `.env.example`. A chave de API foi colada no chat durante a configuração: **trocar a chave antes de ir ao ar** e restringir os escopos ao necessário.
- Dados de demonstração têm ID com prefixo `demo-` (família `demo-familia-souza`). Remover com `pnpm seed -- --reset` antes de entrar dados reais.

## Comandos
| Comando | O que faz |
|---|---|
| `pnpm typecheck` / `pnpm test` / `pnpm lint` | verificações de todos os pacotes |
| `pnpm schema:apply` | cria/completa o banco a partir de `packages/shared/src/collections.ts` (idempotente, nunca apaga) |
| `pnpm seed` / `pnpm seed -- --reset` | cria / remove a família demo |
| `pnpm --filter @medcuidar/db test:integration` | prova de isolamento contra o Appwrite real (cria e remove 2 times e 2 usuários de teste) |

## Contratos
- **Modelo de dados:** `docs/02-banco-de-dados.md` ↔ `packages/shared/src/collections.ts` (fonte única do schema). Schemas zod são derivados dele (`inputSchemas`, `documentSchemas`). Mudou o modelo → muda o doc, `collections.ts` e roda `pnpm schema:apply`.
- **Permissões:** `PERMISSION_KEYS`, `PERMISSION_GROUPS` (11 linhas da matriz do painel), `SYSTEM_PROFILES` e `can(member, permission)` em `packages/shared`. Administrador sempre pode.
- **Acesso a dados:** usar **somente** `FamilyScopedDb` (`@medcuidar/db`). Ele injeta `family_id` e a permissão de leitura do Team, e trata documento de outra família como proibido. Não usar `Databases` direto na aplicação. Coleções globais (`families`, `login_codes`) não passam por ele.
- **Modelo de acesso:** todo acesso passa pelo servidor com chave de API e filtro por família. As coleções não têm permissão de cliente (nem criação); cada documento recebe `read` do Team como defesa em profundidade.
- Campos JSON (`settings`, `permissions`, `payload`, `meta`) ficam em string: usar `JSON.stringify` ao gravar e `parseJsonField(schema, raw)` ao ler.
- `families.$id` = id do Team da família = `family_id` de todos os documentos.

## Limitações conhecidas
- Appwrite 1.8 não tem transação entre documentos: `confirmDose` (agente B) deve ser idempotente por índice único (`dose_event_id` em `stock_movements`, `source_message_id` em `dose_events`) em vez de depender de transação.
- Índice único de `treatment_phases (treatment_id, order)` impede ordem repetida; sobreposição de dias é validada no domínio, não no banco.
- A CI roda lint, tipos e testes unitários; o teste de integração fica fora até existir um projeto Appwrite de testes separado.
