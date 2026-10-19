# 09 — Deploy do staging no EasyPanel (Lote 1)

Passo a passo para quem **não é técnico** criar o ambiente de teste do MedCuidar: um **Postgres 16** e o **portal** (a partir do GitHub, com o `Dockerfile` da raiz), com HTTPS. O login usa o **Appwrite** que você já tem (só e-mail/senha).

Tempo estimado: 40 a 60 minutos na primeira vez. Tenha à mão: acesso ao EasyPanel, ao Appwrite (Console), ao GitHub do projeto e ao painel do seu domínio (DNS).

> **Regra de ouro:** senhas e chaves só aparecem nos campos do EasyPanel/Appwrite. Nunca cole no chat, em e-mail ou no GitHub.

---

## 0. Antes de começar

Escolha o endereço do staging, por exemplo `staging.medcuidar.seudominio.com.br`. Daqui em diante ele é chamado de **ENDEREÇO**. Anote também:

| O que | Exemplo | Onde você vai usar |
|---|---|---|
| ENDEREÇO do portal | `staging.medcuidar.seudominio.com.br` | Appwrite (plataforma web) e EasyPanel (domínio) |
| Senha do papel **dono** do banco | 24 letras e números, sem símbolos | só no comando de migração (passo 5) |
| Senha do papel **app** do banco | 24 letras e números, sem símbolos | variável `DATABASE_URL` do portal |

Dica: gere as senhas num gerenciador de senhas. **Use só letras e números** (símbolos como `@`, `:` e `/` quebram o endereço do banco).

---

## 1. Configurar o Appwrite (Console do Appwrite)

O portal usa o Appwrite **só para login** (e-mail e senha). Faça isto antes de subir o portal.

### 1.1 Plataforma web (obrigatório)
1. Abra o seu projeto no Console do Appwrite → **Overview** → **Integrations → Platforms** (ou *Add platform*).
2. **Add platform → Web**. Nome: `MedCuidar staging`. **Hostname:** o ENDEREÇO (sem `https://`), por exemplo `staging.medcuidar.seudominio.com.br`.
3. Salve.

Sem isto, os e-mails de confirmação, recuperação de senha e convite falham com "URL host must be one of…".

### 1.2 Envio de e-mails (SMTP) — obrigatório para testar
O Appwrite precisa de um servidor de e-mail para mandar: confirmação de e-mail, recuperação de senha e convite.
1. **Settings → SMTP** → ligue **Custom SMTP**.
2. Preencha servidor, porta, usuário e senha do seu provedor de e-mail (por exemplo Brevo, Mailgun, Amazon SES, ou o SMTP da sua hospedagem). Em **Sender**, o nome `MedCuidar` e um endereço do seu domínio.
3. Clique em **Send test email** e confirme que chegou (veja também o spam).

### 1.3 Modelos de e-mail (português)
Em **Auth → Templates** (ou *Settings → Email templates*), idioma **Português (pt-br)**, revise estes três:
- **Email verification** (confirmação de e-mail): título "Confirme seu e-mail no MedCuidar". O link deve ficar como o Appwrite sugere (`{{redirect}}`).
- **Password recovery** (esqueci a senha): título "Crie uma nova senha no MedCuidar".
- **Magic URL** — **é o e-mail do convite**. Troque o texto padrão ("faça login") por algo como: *"Você foi convidado(a) para o MedCuidar. Toque no botão abaixo, confirme o seu e-mail e crie a sua senha. O link vale por pouco tempo; se vencer, peça um novo na própria tela."*

### 1.4 Métodos de login
Em **Auth → Settings**, deixe **ligados**: *Email/Password* e *Magic URL*. Pode deixar os outros desligados.
Sugestão: *Session length* de 30 dias; *Password dictionary* ligado.

### 1.5 Chave de API (a única que o portal usa)
1. **Overview → Integrations → API keys → Create API key**. Nome: `medcuidar-staging`. Validade: sem expiração (ou 1 ano).
2. **Escopos mínimos do Lote 1** (marque só estes):
   - `users.read` e `users.write` (criar usuário, ler, definir senha, bloquear, encerrar sessões);
   - `sessions.write` (abrir e fechar sessões de login).
3. Copie a chave **uma vez** e cole direto no campo `APPWRITE_API_KEY` do EasyPanel (passo 4). Não cole em nenhum outro lugar.

> Nos próximos lotes entram os escopos de arquivos (`files.read`, `files.write`, `buckets.read`) para as receitas. Eles não são necessários agora.

Anote também o **Endpoint** (`https://…/v1`) e o **Project ID** (em *Settings*): são os valores de `APPWRITE_ENDPOINT` e `APPWRITE_PROJECT_ID`.

---

## 2. Criar o Postgres no EasyPanel

1. No EasyPanel, abra (ou crie) o **projeto** do MedCuidar.
2. **+ Service → Postgres**.
3. Nome do serviço: `medcuidar-db`. Imagem/versão: **16**. Defina a senha do superusuário (anote; é só para o passo 3).
4. **Create** e espere ficar verde.
5. Abra o serviço e anote o **host interno** (aparece como *Internal host* / *Connection*, algo como `projeto_medcuidar-db`), a **porta** (5432) e o **nome do banco**.

Não abra a porta do banco para a internet: o portal fala com ele pela rede interna do EasyPanel.

---

## 3. Criar os papéis do banco (dono e app)

O banco usa **dois papéis**: o **dono** (cria as tabelas, só para migrações) e o **app** (usado pelo portal; **sem** poder de burlar o isolamento entre famílias). É o mesmo que `docker/init-roles.sh` faz no ambiente de desenvolvimento.

1. No serviço `medcuidar-db`, abra **Console** (terminal do serviço).
2. Entre no banco (troque `NOME_DO_BANCO` pelo nome anotado no passo 2):
   ```bash
   psql -U postgres -d NOME_DO_BANCO
   ```
3. Cole o bloco abaixo, trocando `SENHA_DONO`, `SENHA_APP` (as senhas do passo 0) e `NOME_DO_BANCO`. Rode tudo de uma vez:
   ```sql
   CREATE ROLE medcuidar_owner LOGIN PASSWORD 'SENHA_DONO' NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
   CREATE ROLE medcuidar_app   LOGIN PASSWORD 'SENHA_APP'  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

   ALTER DATABASE NOME_DO_BANCO OWNER TO medcuidar_owner;
   REVOKE ALL ON DATABASE NOME_DO_BANCO FROM PUBLIC;
   GRANT CONNECT ON DATABASE NOME_DO_BANCO TO medcuidar_owner, medcuidar_app;

   ALTER SCHEMA public OWNER TO medcuidar_owner;
   REVOKE ALL ON SCHEMA public FROM PUBLIC;
   GRANT USAGE ON SCHEMA public TO medcuidar_app;

   ALTER DEFAULT PRIVILEGES FOR ROLE medcuidar_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO medcuidar_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE medcuidar_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO medcuidar_app;
   ```
4. Deve responder `CREATE ROLE`, `CREATE ROLE`, `ALTER DATABASE`… sem erros. Saia com `\q`.

Os endereços de conexão ficam assim (troque HOST, NOME_DO_BANCO e as senhas):

```
DATABASE_URL       = postgres://medcuidar_app:SENHA_APP@HOST:5432/NOME_DO_BANCO        (vai nas variáveis do portal)
DATABASE_URL_ADMIN = postgres://medcuidar_owner:SENHA_DONO@HOST:5432/NOME_DO_BANCO     (só no comando do passo 5)
```

---

## 4. Criar o portal no EasyPanel

1. No mesmo projeto: **+ Service → App**. Nome: `medcuidar-web`.
2. **Source → GitHub**: escolha o repositório do MedCuidar e a branch (`main`). Se o repositório for privado, o EasyPanel mostra uma chave de implantação (*deploy key*) para colar no GitHub em **Settings → Deploy keys** do repositório.
3. **Build → Dockerfile**: caminho do arquivo `Dockerfile` (o da raiz do repositório). Contexto: a raiz (`/`).
4. **Environment** (variáveis de ambiente). Cole assim, trocando os valores:

   | Variável | Valor | Observação |
   |---|---|---|
   | `DATA_SOURCE` | `postgres` | liga o portal real (sem isto aparecem dados fictícios) |
   | `APP_URL` | `https://ENDEREÇO` | sem barra no final; é o endereço dos links dos e-mails |
   | `APP_ENV` | `production` | desliga qualquer rota de teste |
   | `DATABASE_URL` | `postgres://medcuidar_app:SENHA_APP@HOST:5432/NOME_DO_BANCO` | **papel app** |
   | `APPWRITE_ENDPOINT` | `https://…/v1` | do passo 1.5 |
   | `APPWRITE_PROJECT_ID` | o Project ID | do passo 1.5 |
   | `APPWRITE_API_KEY` | a chave criada no passo 1.5 | **segredo** |

   **Não crie** `DATABASE_URL_ADMIN` aqui (a aplicação nunca recebe o papel dono) e **nunca** `E2E_TEST_MODE`.
5. **Domains**: *Add domain* → ENDEREÇO, porta do app **3000**, **HTTPS ligado** (certificado automático). No painel do seu domínio crie o registro DNS **A** do ENDEREÇO apontando para o IP da VPS e espere propagar (alguns minutos).
6. (Opcional) **Resources**: 512 MB de memória é suficiente para o staging.
7. Clique em **Deploy** e acompanhe a aba de logs. A primeira construção leva uns 5 a 10 minutos.

Se ficar vermelho, veja "Problemas comuns" no fim. O serviço só fica **saudável** depois do passo 5 (o teste de saúde confere o banco).

---

## 5. Criar as tabelas (migrações)

Só depois que o portal estiver no ar. **Uma vez agora** e **de novo a cada lote** que trouxer tabelas novas (o roteiro do lote avisa).

1. No serviço `medcuidar-web`, abra **Console**.
2. Digite (troque pelo endereço do dono do passo 3; mantenha as aspas simples):
   ```bash
   DATABASE_URL_ADMIN='postgres://medcuidar_owner:SENHA_DONO@HOST:5432/NOME_DO_BANCO' node /app/migrate/migrate.mjs
   ```
3. Deve responder `Migrações aplicadas.` Pode rodar de novo sem problema: o que já foi aplicado é ignorado.

A senha do dono fica só neste comando; ela **não** é gravada nas variáveis do serviço.

**Alternativa, de uma máquina com o código (para quem desenvolve):** com o banco acessível, no terminal do projeto:
```bash
DATABASE_URL_ADMIN='postgres://medcuidar_owner:SENHA_DONO@HOST:5432/NOME_DO_BANCO' pnpm --filter @medcuidar/pg migrate
```
Por segurança, só use isto se o banco estiver acessível por um túnel (o banco não deve ficar aberto na internet).

---

## 6. Conferir

1. Abra `https://ENDEREÇO/api/health`. Deve mostrar `{"status":"ok","database":"ok"}`.
   - `"database":"indisponivel"` → confira `DATABASE_URL` (host, senha, nome do banco) e o passo 3.
2. Abra `https://ENDEREÇO` → deve ir para a tela **Entrar** (cadeado na barra do navegador).
3. Siga o roteiro de teste em `docs/lotes/L1-roteiro.md`. O primeiro passo é **Criar conta**.

Para ver o que o servidor está fazendo: serviço `medcuidar-web` → **Logs**. Os logs **não** mostram e-mails, telefones nem códigos.

---

## 7. Atualizar para uma nova versão

1. Faça o *push* na branch configurada (ou clique em **Deploy** no serviço).
2. Se o lote trouxe tabelas novas, rode de novo o **passo 5**.
3. Confira `/api/health`.

## 8. Variáveis de ambiente (resumo)

| Variável | Obrigatória | Para quê |
|---|---|---|
| `DATA_SOURCE` | sim (`postgres`) | origem dos dados; padrão da imagem já é `postgres` |
| `APP_URL` | sim | endereço público (links dos e-mails) |
| `APP_ENV` | recomendada (`production`) | recusa o modo de teste |
| `DATABASE_URL` | sim | papel **app** do Postgres (sem poder de dono) |
| `APPWRITE_ENDPOINT` | sim | endereço do Appwrite (`…/v1`) |
| `APPWRITE_PROJECT_ID` | sim | projeto do Appwrite |
| `APPWRITE_API_KEY` | sim | chave com `users.read`, `users.write`, `sessions.write` |
| `PORT`, `HOSTNAME` | não | a imagem já define `3000` e `0.0.0.0` |
| `DATABASE_URL_ADMIN` | **nunca no serviço** | só no comando de migração do passo 5 |
| `E2E_TEST_MODE` | **nunca** | só testes automáticos locais |

Variáveis dos próximos lotes (WhatsApp, N8N, Evolution Go, bucket de receitas) entram quando o lote chegar.

## 9. Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Build falha no EasyPanel | Veja o log da construção. Confirme que o contexto é a raiz do repositório e o arquivo é `Dockerfile`. |
| `/api/health` mostra `database: indisponivel` | `DATABASE_URL` errada (host interno, porta, nome do banco ou senha) ou papéis não criados (passo 3). |
| "relation … does not exist" nos logs | Falta rodar as migrações (passo 5). |
| Criar conta dá "Não foi possível criar a conta" | Confira `APPWRITE_*`, os escopos da chave (passo 1.5) e se o projeto do Appwrite está no ar. |
| O e-mail de confirmação não chega | SMTP do Appwrite (passo 1.2) e pasta de spam. Na tela dá para pedir o e-mail de novo a cada 2 minutos. |
| "URL host must be one of…" | Falta a plataforma web com o ENDEREÇO (passo 1.1). |
| Convite criado, "e-mail não enviado" | Mesmo problema do SMTP; use **Reenviar** na lista de pessoas depois de corrigir. |
| Login entra e cai de volta no login | O endereço está em `http://` sem HTTPS: ligue HTTPS no domínio (o cookie de sessão exige HTTPS). |

## 10. Limitações conhecidas do Lote 1

- Doses, estoque, receitas, histórico e avisos **não existem ainda** (telas mostram "chega no próximo lote").
- WhatsApp: o número fica **pendente**; a validação e o uso do código de convite chegam no **Lote 4**.
- Não há dados de exemplo no staging: o teste começa criando a conta.
- A confirmação do e-mail depende do SMTP configurado no Appwrite (passo 1.2).
