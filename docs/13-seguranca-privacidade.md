# 13 — Segurança e privacidade (Lote 5B)

Contrato do Lote 5B. Decisões do dono em 02/11/2026 e o que o sistema faz com dado de saúde (LGPD, Lei 13.709/2018).

## 1. Decisões

| Tema | Decisão |
|---|---|
| Controlador dos dados | O próprio dono do sistema (pessoa física). Contato do titular: renaldy.sousa@gmail.com |
| Exclusão da família | Pedida pelo **Administrador**. Fica **agendada por 30 dias** (dá para cancelar); passados os 30 dias, tudo é apagado de vez |
| Exportar dados | Só o **Administrador** da família |
| Retenção | Dados ficam enquanto a família usar o sistema. Receitas e histórico não expiram sozinhos. Backups diários guardam 30 dias (dump) e até 35 dias (fotos apagadas) e **depois somem sozinhos** |

## 2. Cabeçalhos HTTP, cookies e login

- Cabeçalhos em todas as respostas (`apps/web/next.config.ts`): `Content-Security-Policy` (só a própria origem; `unsafe-inline` em script/estilo porque o Next injeta scripts de hidratação e o tema inicial é inline), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` (a receita em PDF abre num iframe da própria origem), `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Strict-Transport-Security` (só em produção) e `X-Powered-By` desligado.
- Cookie de sessão (`mc_session`): `httpOnly`, `SameSite=Lax`, `Secure` em produção, 30 dias ou até o fim da sessão. O segredo é o da sessão do Appwrite e é validado no Appwrite a cada requisição.
- **Limite de tentativas de login** (`server/auth/throttle.ts`), além do que o Appwrite já faz: 8 erros por e-mail ou 40 por endereço em 15 minutos travam novas tentativas até a janela acabar. Fica na memória do servidor (um processo só na VPS); reiniciar o portal zera os contadores. A chave é um hash, o e-mail não vai a log.
- Código de verificação do WhatsApp: 5 erros por código e 5 por telefone em 15 min bloqueiam por 15 min (já existia, no banco).

## 3. Isolamento entre famílias

- Toda tabela com `family_id` (e `families`) tem RLS **ligado, FORCE** e política (teste do Lote 1, mantido). O papel da aplicação não tem BYPASSRLS.
- Teste novo de acesso cruzado **pelas rotas da API `/api/v1`**: a chave de uma família nunca lê nem altera dado de outra, mesmo pedindo o id de um recurso alheio.

## 4. Segredos e logs

- Segredos só em variáveis de ambiente (`.env.example` lista todas). Varredura do repositório (arquivos e histórico) por padrões de chave: ver `docs/lotes/L5B-roteiro.md`.
- **Checklist de rotação** (trocar a chave no provedor e na variável do EasyPanel; reiniciar o serviço):
  - `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_TOKEN` (Evolution Go)
  - `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`
  - `WHATSAPP_WEBHOOK_SECRET` (muda a URL do webhook: atualizar na Evolution)
  - `FILE_URL_SECRET` (invalida links de receita já abertos; não afeta o dado)
  - `APPWRITE_API_KEY` (já trocada) e as chaves do R2 do backup
  - `BACKUP_ENCRYPTION_KEY` **não** se troca sem plano: backups antigos só abrem com a chave antiga
- Log sem dado pessoal: nenhum `console.*` do servidor imprime nome, e-mail, telefone, texto de mensagem ou conteúdo de receita. Só códigos de erro e ids.

## 5. LGPD

### Base legal e aviso
- Dado de saúde é dado pessoal sensível (art. 11). A base é o **consentimento** do titular ou do responsável, e a **tutela da saúde** no cuidado.
- **Política de privacidade pública** em `/privacidade` (sem login). Texto em `apps/web/src/lib/privacy.ts` com número de versão (`PRIVACY_VERSION`). Mudou o texto, sobe a versão e todos aceitam de novo.
- **Aceite do membro:** todo usuário do portal precisa aceitar a versão vigente antes de usar o sistema (tela `/privacidade/aceitar`, também para quem já existia). Guarda `members.privacy_accepted_at` e `members.privacy_version`. Quem só usa o WhatsApp recebe o link da política na mensagem de boas-vindas e o aceite é registrado na verificação do número.
- **Paciente:** ao cadastrar um paciente, quem cadastra confirma que **tem autorização da pessoa ou é o responsável** por ela (obrigatório quando a pessoa não consegue consentir, como na demência). Guarda `patients.data_authorized_at` e `patients.data_authorized_by`.

### Direitos do titular
- **Exportar** (Administrador, Configurações › Privacidade e dados): arquivo JSON com todos os dados da família (pessoas, pacientes, remédios, esquemas, doses, estoque, receitas e a lista dos arquivos, avisos, auditoria). **Sem** segredos (hashes de chave e de código, tokens). As fotos das receitas continuam disponíveis pela tela de receitas, com link assinado.
- **Excluir** (Administrador): pede com confirmação digitando o nome da família. A família entra em **exclusão agendada** (`families.deleted_at`): ninguém usa o sistema, os avisos param, e o Administrador vê uma tela com a data e o botão **Cancelar a exclusão**. Em 30 dias, a rotina diária apaga: fotos das receitas no Appwrite, contas de login (Appwrite) das pessoas da família, e todas as linhas do Postgres da família. Fica só um registro sem dado pessoal em `platform_audit_log` (id da família, data).
- **Backups:** o dump diário fica 30 dias e as fotos copiadas são podadas em até 35 dias (`docs/12-backup.md`); a família excluída some deles nesse prazo e, se um backup for restaurado, a rotina de exclusão **roda de novo** sobre a lista de excluídas (`platform_audit_log`).
- Pedidos do titular que não sejam do Administrador (ex.: familiar que quer corrigir ou apagar algo): ao e-mail do controlador, resposta em até 15 dias.

### Auditoria
Já existente (`audit_log` por família): acesso e exclusão de receita, entrada e saída de pessoas, mudanças de perfil e de chave. Novos eventos: `privacy.accept`, `family.export`, `family.delete_request`, `family.delete_cancel`; a exclusão definitiva grava em `platform_audit_log`.

## 6. Dependências e CI

- `pnpm audit --prod`: corrigidos drizzle-orm (0.45.4), fast-xml-parser e postcss (por `pnpm.overrides`). **Aceitos e documentados:** `zod` 3.x da SDK da Anthropic (consumo de memória em coleções enormes: nossas entradas são pequenas e limitadas), `uuid` 9 e `@smithy/config-resolver` do AWS SDK do serviço de backup (não alcançáveis: sem `buf` fornecido e região fixa "auto").
- **CI com Postgres:** o fluxo do GitHub (`.github/workflows/ci.yml`) sobe um serviço `postgres:16`, cria os papéis (`docker/init-roles.sh`), migra e roda **todos** os testes com `REQUIRE_DB=1` (sem pulos).
