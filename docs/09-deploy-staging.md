# 09 — Deploy do staging no EasyPanel (Lote 1)

Passo a passo para quem **não é técnico** criar o ambiente de teste do MedCuidar: um **Postgres 16** e o **portal** (a partir do GitHub, com o `Dockerfile` da raiz), com HTTPS. O login usa o **Appwrite** que você já tem (só e-mail/senha).

Tempo estimado: 40 a 60 minutos na primeira vez. Tenha à mão: acesso ao EasyPanel, ao Appwrite (Console), ao GitHub do projeto e ao painel do seu domínio (DNS).

> **Regra de ouro:** senhas e chaves só aparecem nos campos do EasyPanel/Appwrite. Nunca cole no chat, em e-mail ou no GitHub.

---

## 0. Antes de começar

Você **não precisa de domínio próprio**. O app já foi criado no EasyPanel e o endereço gratuito com HTTPS já existe:

```
https://automacoes-app-controle-remedios.8m5sgi.easypanel.host
```

Daqui em diante ele é o **ENDEREÇO** (hostname, sem `https://`: `automacoes-app-controle-remedios.8m5sgi.easypanel.host`). O que falta é: criar o **Postgres**, configurar as **variáveis** do app e fazer o **deploy**. Ordem deste guia: Appwrite (conferir) → Postgres → papéis do banco → variáveis e deploy → migração → conferir.

O portal sobe e responde `/api/health` mesmo **sem** `APP_URL`; só os e-mails (confirmação, senha, convite) dependem dela.

Anote antes de começar:

| O que | Onde você vai usar |
|---|---|
| Senha do papel **dono** do banco (24 letras e números, sem símbolos) | só no comando de migração (passo 5) |
| Senha do papel **app** do banco (24 letras e números, sem símbolos) | variável `DATABASE_URL` do portal |

Dica: gere as senhas num gerenciador de senhas. **Use só letras e números** (símbolos como `@`, `:` e `/` quebram o endereço do banco).

---

## 1. Configurar o Appwrite (Console do Appwrite)

O portal usa o Appwrite **só para login** (e-mail e senha). Faça isto antes de subir o portal.

### 1.1 Plataforma web — já cadastrada; só confira
O hostname do staging já foi cadastrado como plataforma Web no projeto do Appwrite. Para conferir: Console do Appwrite → seu projeto → **Overview → Integrations → Platforms** → deve existir uma plataforma **Web** com o hostname exato `automacoes-app-controle-remedios.8m5sgi.easypanel.host` (sem `https://`, sem barra, sem espaço). Se o endereço do app mudar, cadastre o novo hostname.

Sem isto, os e-mails de confirmação, recuperação de senha e convite falham com "URL host must be one of…".

### 1.2 Envio de e-mails (SMTP) — já configurado; só teste
O SMTP do seu Appwrite já está configurado (pré-requisito atendido). Não precisa mexer, só **testar o envio** depois que o portal estiver no ar (passo 6): crie uma conta de teste e confirme que o e-mail de confirmação chega (veja também o spam). Se não chegar, em **Settings → SMTP** use **Send test email**.

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

> No Lote 3 entram os escopos de arquivos (`files.read`, `files.write`, `buckets.read`) para as receitas: veja a **seção 11**. Eles não são necessários nos Lotes 1 e 2.

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

## 4. Criar o portal no EasyPanel (a partir do Git)

1. O app **já foi criado** no EasyPanel (serviço do portal). Abra-o para configurar. (Se precisar criar de novo: **+ Service → App**.)
2. **Source → GitHub**: escolha o repositório `Renaldy1979/controle-remedios`, branch `main`. O seu EasyPanel já está conectado ao GitHub, então não precisa de chave nem token. *Se o repositório não aparecer na lista, reconecte a conta do GitHub no EasyPanel.* Nunca cole chaves ou tokens em chat, e-mail ou no repositório.
3. **Build**: tipo **Dockerfile**, caminho `Dockerfile` (o da raiz), **contexto de build = raiz do repositório** (`/`). O build usa só o conteúdo do repositório: não depende de `.env` nem de nenhum arquivo ignorado pelo Git (o `.dockerignore` ainda exclui `.env*` de propósito).
4. **Porta do app: 3000.** O teste de saúde da imagem é `GET /api/health` (o EasyPanel usa o `HEALTHCHECK` do Dockerfile).
5. **Domains**: confirme que `automacoes-app-controle-remedios.8m5sgi.easypanel.host` aponta para a porta **3000** com HTTPS ligado.
6. **Environment**: cole assim, trocando os valores. Preencha todas antes do primeiro **Deploy**:

   | Variável | Valor | Observação |
   |---|---|---|
   | `DATA_SOURCE` | `postgres` | liga o portal real (sem isto aparecem dados fictícios) |
   | `APP_URL` | `https://automacoes-app-controle-remedios.8m5sgi.easypanel.host` | sem barra no final; é o endereço dos links dos e-mails. Sem ela o portal sobe, mas não monta os links |
   | `APP_ENV` | `production` | desliga qualquer rota de teste |
   | `DATABASE_URL` | `postgres://medcuidar_app:SENHA_APP@HOST_INTERNO:5432/NOME_DO_BANCO` | **papel app**; use o **host interno** do serviço Postgres (passo 2), nunca um endereço público |
   | `APPWRITE_ENDPOINT` | `https://…/v1` | do passo 1.5 |
   | `APPWRITE_PROJECT_ID` | o Project ID | do passo 1.5 |
   | `APPWRITE_API_KEY` | a chave criada no passo 1.5 | **segredo** |

   **Não crie** `DATABASE_URL_ADMIN` aqui (a aplicação nunca recebe o papel dono) e **nunca** `E2E_TEST_MODE`.
7. **Resources**: o build do Next.js é a parte pesada. Se a VPS tiver pouca memória, limite o app a ~1 GB durante o build (ou faça o deploy com os outros serviços ocupados no mínimo); depois de pronto, 512 MB bastam para rodar. Um build pode levar de 5 a 30 minutos conforme a máquina.
8. Clique em **Deploy** e acompanhe os logs.
9. Se você mudar qualquer variável depois, **reinicie/refaça o deploy** do app para ele ler o novo valor.

Se ficar vermelho, veja "Problemas comuns" no fim. O serviço só fica **saudável** depois que o banco estiver acessível (passos 2 e 3) (o teste de saúde confere o banco).

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
Por segurança, só use isto se o banco estiver acessível por um túnel. **Não abra a porta do Postgres na internet**: o caminho recomendado é o console do serviço do portal, que fala com o banco pela rede interna do EasyPanel.

---

## 6. Conferir

1. Abra `https://automacoes-app-controle-remedios.8m5sgi.easypanel.host/api/health`. Deve mostrar `{"status":"ok","database":"ok"}`.
   - `"database":"indisponivel"` → confira `DATABASE_URL` (host, senha, nome do banco) e o passo 3.
2. Abra `https://automacoes-app-controle-remedios.8m5sgi.easypanel.host` → deve ir para a tela **Entrar** (cadeado na barra do navegador).
3. **Teste o envio de e-mail:** toque em **Criar conta** com um e-mail seu; o e-mail de confirmação deve chegar em até 1 minuto (veja o spam).
4. Siga o roteiro de teste em `docs/lotes/L1-roteiro.md`. O primeiro passo é **Criar conta**.

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
| `APPWRITE_API_KEY` | sim | chave com `users.read`, `users.write`, `sessions.write` e, no Lote 3, `files.read`, `files.write`, `buckets.read` |
| `APPWRITE_PRESCRIPTIONS_BUCKET_ID` | Lote 3 | **Obrigatória** (não há valor padrão): ID do bucket privado das receitas (seção 11). Sem ela o portal mostra "O armazenamento das receitas ainda não foi configurado" |
| `FILE_URL_SECRET` | Lote 3 | segredo (32+ caracteres) que assina os links de 10 minutos das páginas das receitas |
| `PORT`, `HOSTNAME` | não | a imagem já define `3000` e `0.0.0.0` |
| `DATABASE_URL_ADMIN` | **nunca no serviço** | só no comando de migração do passo 5 |
| `E2E_TEST_MODE` | **nunca** | só testes automáticos locais |

Variáveis dos próximos lotes (WhatsApp, N8N, Evolution Go) entram quando o lote chegar. As do bucket de receitas são do Lote 3 (seção 11).

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

- (Lote 1) Doses, estoque, receitas, histórico e avisos não existiam ainda; hoje chegaram até o Lote 3 (veja `docs/08-lotes.md`).
- WhatsApp: o número fica **pendente**; a validação e o uso do código de convite chegam no **Lote 4**.
- Não há dados de exemplo no staging: o teste começa criando a conta.
- A confirmação do e-mail depende do SMTP configurado no Appwrite (passo 1.2).

---

## 11. Lote 3 — receitas e reposição (bucket de receitas, chave e variáveis)

As fotos e PDFs das receitas ficam num **bucket privado do Appwrite**. O portal é o único que lê e grava nele (com a chave de API do servidor); a pessoa só vê a página por uma rota do próprio portal que exige login, permissão de ver receitas e um link de curta duração (10 minutos). **Não existe endereço público do arquivo.**

> O portal **não cria** o bucket sozinho (por segurança a chave do portal não tem poder de criar bucket). Você cria uma vez, no Console do Appwrite, como abaixo. Se faltar o bucket, a chave ou a variável, o portal continua funcionando: só a tela de receitas avisa "O armazenamento das receitas ainda não foi configurado" (e o `/api/health` **não** depende disso).

### 11.1 Criar o bucket `prescriptions` (Console do Appwrite)

1. **Storage → Create bucket**.
2. **Bucket ID:** `prescriptions` (use exatamente este, em minúsculas; é o que a variável do passo 11.3 aponta). **Name:** `Receitas`.
   - *Já existe um bucket `prescriptions` do modelo antigo?* Abra-o: se estiver **vazio** (Files = 0), é só conferir os ajustes abaixo e seguir. Se tiver arquivos, **não use**: crie outro com ID `rx-staging` e coloque esse ID na variável do passo 11.3.
3. Em **Settings** do bucket:

   | Ajuste | Valor |
   |---|---|
   | **Permissions** (permissões do bucket) | **vazio** — não adicione nenhum papel (`Any`, `Users`, etc. deixam o arquivo aberto) |
   | **File security** | **Ligado** |
   | **Maximum file size** | **15 MB** |
   | **Allowed file extensions** | `jpg`, `jpeg`, `png`, `webp`, `heic`, `pdf` |
   | **Encryption** | **Ligado** |
   | **Compression** | `None` (o próprio portal reduz a foto no celular antes de enviar) |
   | **Antivirus** | **Ligado**, se a opção estiver disponível no seu Appwrite (precisa do ClamAV). Se estiver desabilitada ou der erro, deixe desligado |
   | **Enabled** | Ligado |

4. Salve. Não envie arquivo por aqui: o portal faz isso.

### 11.2 Ampliar a chave de API do staging

1. Console → **Overview → Integrations → API keys** → a chave `medcuidar-staging` → **Scopes**.
2. **Acrescente** (sem tirar os de antes): `files.read`, `files.write` e `buckets.read`. **Nada além disso** — em especial **não** marque `buckets.write` (o portal não precisa criar nem apagar buckets).
3. Salve. A chave continua a mesma: não precisa trocar nada nas variáveis dela.

### 11.3 Variáveis do portal no EasyPanel

No serviço `medcuidar-web` → **Environment**, acrescente:

| Variável | Valor | Observação |
|---|---|---|
| `APPWRITE_PRESCRIPTIONS_BUCKET_ID` | `prescriptions` (ou `rx-staging`, se for o caso) | o ID do bucket do passo 11.1 |
| `FILE_URL_SECRET` | 32 ou mais letras e números aleatórios | **segredo**: assina os links de 10 minutos das páginas. Gere num gerenciador de senhas. Se mudar, os links abertos param de valer (a tela gera novos sozinha) |

Salve e faça **Deploy** de novo (variável nova só vale depois de reiniciar).

### 11.4 Rodar a migração do Lote 3

O Lote 3 traz a **migração `0005`** (duas colunas na etapa da reposição e um índice que impede a mesma compra de somar duas vezes). Rode como no passo 5:

```bash
DATABASE_URL_ADMIN='postgres://medcuidar_owner:SENHA_DONO@HOST:5432/NOME_DO_BANCO' node /app/migrate/migrate.mjs
```

Deve responder `Migrações aplicadas.` Pode rodar de novo sem problema.

> **Permissões dos arquivos:** o portal grava cada página **sem nenhuma permissão** (`permissions: []`, nem de Team: quem entra por e-mail não está em Team). Só a chave de API do servidor lê; as pessoas veem pela rota do portal (sessão + permissão + link curto assinado).

### 11.5 Conferir

1. `/api/health` continua `{"status":"ok","database":"ok"}`.
2. Entre como administrador → **Receitas → Anexar receita**. **Não** deve aparecer o aviso amarelo "O armazenamento das receitas ainda não foi configurado". Anexe uma foto de teste e abra-a.
3. **Segurança:** abra o endereço direto do arquivo do Appwrite e a rota do portal **com o link vencido ou sem login**, numa janela anônima: **nenhum** deve abrir.
4. No Console do Appwrite, **Storage → Receitas → Files**: o arquivo aparece com o nome `rx-p1.jpg` (nome neutro, sem nada da pessoa ou do remédio), e **sem** permissões de leitura na lista.

| Mensagem na tela | O que fazer |
|---|---|
| "O armazenamento das receitas ainda não foi configurado…" | Falta a variável `APPWRITE_PRESCRIPTIONS_BUCKET_ID`, o bucket não existe com esse ID ou a chave não tem `files.read`/`files.write`/`buckets.read` (passos 11.1 a 11.3). Depois de corrigir, faça o Deploy de novo |
| "Não foi possível falar com o armazenamento das receitas agora" | O Appwrite está fora do ar ou lento. Tente de novo em instantes |
| "Cada página pode ter até 15 MB" / "Use fotos (JPG, PNG, WEBP, HEIC) ou PDF" | A regra do bucket e do portal. Fotos tiradas no celular são reduzidas sozinhas; PDF grande precisa ser comprimido |
| Envio de muitas páginas falha sem mensagem | O limite de envio de uma vez é de ~30 MB no total (`serverActions.bodySizeLimit`). Envie em duas receitas ou comprima os PDFs |

### 11.6 Testes automáticos que falam com o Appwrite

- Os testes comuns (`pnpm test`) e o e2e **não escrevem no seu bucket**: o e2e guarda as páginas na memória do servidor de teste (`RX_STORAGE=memory`, só com `E2E_TEST_MODE=1`).
- Para provar a ida real ao Appwrite existe um teste à parte, que **cria um bucket de teste dedicado** (`zz-test-rx-…`, com os mesmos ajustes do passo 11.1), grava, lê, apaga e **apaga o bucket**. Precisa de uma chave com `buckets.write` (a chave de desenvolvimento do `.env`, não a do staging):
  ```bash
  RX_APPWRITE_TEST=1 pnpm --filter @medcuidar/web exec vitest run rx-storage.appwrite
  ```

### 11.7 Privacidade (LGPD) do que o Lote 3 grava

- O bucket é privado, com *file security*, criptografia e nome de arquivo neutro. A miniatura é reduzida (360 px).
- Toda página inteira aberta fica em `audit_log` (`rx.file_opened`, só com o id do arquivo) e cada pessoa que abriu a receita fica em `prescription_views` ("quem viu").
- A auditoria de receitas e reposição guarda **só ids e contagens**: nunca o nome do médico, as observações, o remédio por extenso ou o conteúdo da foto. Os logs do servidor também não mostram dados pessoais.
- Excluir uma receita é **lógico** (com "Desfazer"): ela some do portal e a rota de arquivo passa a recusar, mas a foto continua no bucket até a limpeza definitiva (Lote 5).
