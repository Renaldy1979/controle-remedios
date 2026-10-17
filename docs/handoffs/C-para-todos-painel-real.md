# Painel (C) → todos: painel ligado aos dados reais (Fase 3B)

Estado: entregue para revisão. Só `apps/web` foi alterado (mais esta nota e `C-para-D-pedidos.md`).

## Como rodar

| Modo | Comando | O que usa |
|---|---|---|
| Mock (padrão, sem rede) | `pnpm --filter @medcuidar/web dev` | dados fictícios em memória; sem login; "Ver como" para testar perfis |
| Real | `DATA_SOURCE=appwrite pnpm --filter @medcuidar/web dev` | Appwrite + `@medcuidar/domain` + `@medcuidar/functions`; exige login por código |
| e2e (família demo) | `pnpm --filter @medcuidar/web e2e` | build de produção na porta 3100, canal de WhatsApp **falso** |

`/design-system` sempre usa os mocks, mesmo em modo real.

## Variáveis (só servidor; nada vai ao cliente)

Lidas do `.env` da raiz (`next.config.ts` carrega, sem sobrescrever o que já existe) e de `apps/web/.env.local` (ignorado pelo git).

| Variável | Para quê |
|---|---|
| `DATA_SOURCE` | `appwrite` ou `mock` (padrão `mock`) |
| `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_DATABASE_ID`, `APPWRITE_API_KEY` | acesso ao Appwrite (chave de API só no servidor) |
| `LOGIN_CODE_SECRET` | segredo do código de login (D) e das URLs curtas de arquivo de receita. Mínimo 16 caracteres |
| `APPWRITE_PRESCRIPTIONS_BUCKET_ID` | bucket das receitas (padrão `prescriptions`; o painel cria se não existir) |
| `E2E_TEST_MODE=1` | só teste: canal falso em memória + rotas `/api/test/*`. **Recusado com `APP_ENV=production`** |

**Pendência para o orquestrador/A:** `.env.example` ainda não lista `DATA_SOURCE`, `E2E_TEST_MODE` e `APP_ENV` (arquivo fora da pasta do painel).

## Autenticação e permissões

Sessão do **Appwrite Auth**, como em docs/02 (`members.user_id`) e docs/03:

1. **Pedir o código:** `requestLoginCode` (D). A resposta é sempre igual, exista o número ou não.
2. **Verificar:** `verifyLoginCode` → `AuthPort.createSessionFor` real de `@medcuidar/functions` (`AppwriteAuth`): cria/associa o usuário do Appwrite pelo telefone, grava `members.user_id` em todos os cadastros daquele telefone e emite `Users.createToken`.
3. **Sessão:** o painel troca `userId` + token por uma sessão (`Account.createSession`) e guarda o **segredo da sessão** em cookie `mc_session` (httpOnly, `SameSite=Lax`, `Secure` em produção, 30 dias). Nenhum token próprio nem `SESSION_SECRET`.
4. **Cada requisição** (`getAccess`, em layout, Server Actions e rotas): valida a sessão no Appwrite (cliente com `setSession` + `Account.get`), obtém o `userId`, acha os cadastros de membro por `user_id` (índice `by_user`; precisam estar `active`) e relê perfil e permissões no banco. O `familyId` vem só do membro, nunca do cliente.
5. **Qual família?** Se o usuário tem cadastro ativo em mais de uma família, depois do código vai para `/familia` (lista só as famílias dele). A escolha fica no cookie `mc_family`, que só vale se for uma das famílias da pessoa (conferido a cada requisição). "Trocar de família" fica no menu lateral.
6. **Revogar na hora:** remover uma pessoa ou trocar o telefone dela chama `Users.deleteSessions`; trocar o telefone também solta o `user_id` (o próximo login cria o vínculo certo). **Sair** = `Account.deleteSession('current')`.
7. `middleware.ts` só olha se existe o cookie (Edge) e manda para `/login` ou responde 401 em `/api/*`; a validade real é checada no Appwrite a cada requisição, e sessão revogada cai no `/login`.

- **Recusa no servidor:** toda Server Action (`src/server/actions.ts`) valida a entrada com zod e chama `requirePermission(ctx, …)` antes de tocar em dados (teste: `mutations.test.ts`). O retrato enviado ao navegador (`snapshot.ts`) já vem sem o que o perfil não pode ver: sem receitas, histórico, estoque, telefones, matriz de perfis ou configurações de avisos.
- Só um Administrador cria/edita/remove outro Administrador; não dá para remover a si mesmo nem o último Administrador.
- Efeito colateral do primeiro login: o Appwrite ganha um usuário por telefone (na família demo, usuários com telefones fictícios).

## Dados, receitas e arquivos

- **Leituras:** `src/server/snapshot.ts` lê as coleções da família e usa `@medcuidar/domain` (previsão de estoque, nível, situação da receita, escala). Gera (idempotente) os `dose_events` de hoje se o agendador ainda não rodou; atraso/esquecida são calculados na leitura, sem gravar.
- **Escritas:** `src/server/mutations.ts`, sobre `createServices` (D): confirmar/desfazer dose (desfazer só até 30 s depois, quem confirmou), compra, ajuste, reposição (assumir/avançar), salvar receita, compartilhar, visualizar. O resto (remédios, esquemas, pessoas, perfis, avisos) grava via `FamilyScopedDb`.
- **Receitas:** upload para o bucket `prescriptions` com permissão de leitura do Team, nome de arquivo neutro (`rx-p1.jpg`), até 20 páginas de 15 MB, só foto/PDF. Miniaturas e página inteira saem de `/api/rx-file/[fileId]`: exige sessão, `prescriptions.view`, assinatura HMAC de 10 min presa a arquivo+pessoa+família, e a receita não pode estar excluída. A abertura em tela cheia grava `audit_log` (`rx.file_opened`) e `prescription_views`. Exclusão é lógica (`deleted_at`) com Desfazer.
- **Auditoria:** `audit_log` só com ids e contagens (anexar, compartilhar, substituir, excluir, reposição, compra, pessoas, perfis, avisos).
- O retrato é recalculado a cada ação (cada Server Action devolve o novo) e a cada 60 s/ao voltar para a aba. Sem conexão, as telas mantêm os últimos dados com aviso e "Tentar de novo".

## Decisões de mapeamento

- `MedicationVM.id` = `medication_id`, assumindo **um tratamento ativo por remédio e paciente** (como no seed). Se o mesmo remédio tiver dois tratamentos ativos para o mesmo paciente, o modelo de visão precisa passar a usar o id do tratamento.
- "Receber avisos" (matriz de perfis) liga/desliga `receives_family_alerts` dos membros do perfil.
- "À noite, quem confirma" troca o membro das escalas que cruzam a meia-noite.
- `reminder_at_time` e `daily_summary_enabled` ficam como **chaves extras** no JSON `families.settings` (o schema zod de `packages/shared` as ignora). Pedido de formalização em `C-para-D-pedidos.md`.

## Testes

- Unidade/componente: `pnpm --filter @medcuidar/web test` (axe nas telas diárias, contraste dos tokens, retrato com permissões, recusa por permissão, token de sessão, URL assinada).
- e2e (Playwright, Edge): login com código lido do canal falso, código errado, confirmar dose reduz o estoque e Desfazer devolve, Confirmador não vê receitas (e a API de arquivos recusa), anexar receita em 3 passos → ver → excluir. Inclui "Sair apaga a sessão no Appwrite" (o cookie antigo devolvido não abre o painel). Roda contra `demo-familia-souza` **no Appwrite configurado** (hoje o de produção, ver nota de A): cria e apaga receitas de teste e deixa movimentos de estoque de ida e volta (confirmar+desfazer) no livro-razão. Limite real de código de login: 1 por minuto e 10 por hora por telefone; cada telefone pede 1 código por execução.
