# 12 — Backup e restauração

Serviço `apps/backup` (imagem própria, roda como serviço separado no EasyPanel). Todo dia, de madrugada:

1. gera um **dump do Postgres** (`pg_dump`), **criptografa** (AES-256-GCM, chave sua) e envia ao **Cloudflare R2** em `db/AAAA/MM/`, com um arquivo `.meta.json` ao lado (versão do servidor, linhas por tabela, hash);
2. apaga os backups com mais de **30 dias** (sempre preserva os 3 mais recentes);
3. copia as **fotos de receita** do Appwrite, criptografadas, em `files/` (só as novas; fotos apagadas no Appwrite saem do backup depois de 35 dias);
4. registra a rodada em `state/last-run.json` e avisa o monitor (opcional, abaixo).

Nada de dado de saúde sai da VPS sem criptografia. **Sem a chave `BACKUP_ENCRYPTION_KEY` o backup é irrecuperável.**

## 1. Preparar o R2 (uma vez)

1. Bucket `medcuidar-backups`, **privado**.
2. **Regra de ciclo de vida:** *Settings → Object lifecycle rules*. Se você criou a regra "excluir após 35 dias" para o bucket todo, **edite para valer só para o prefixo `db/`**. Sem isso, as fotos (`files/`) seriam apagadas junto, e quem controla a retenção das fotos é o serviço.
3. Token de API *Object Read & Write* só para esse bucket; guarde Access Key ID e Secret.

## 2. Usuário de leitura no Postgres (recomendado)

No console do Postgres do EasyPanel, como superusuário (`postgres`), troque `SENHA` por uma senha nova:

```sql
CREATE ROLE medcuidar_backup LOGIN PASSWORD 'SENHA' BYPASSRLS;
GRANT pg_read_all_data TO medcuidar_backup;
GRANT CONNECT ON DATABASE medcuidar TO medcuidar_backup;
```

`BYPASSRLS` é necessário porque o isolamento por família (RLS) esconderia as linhas do dump. O papel só lê; não escreve nada. Se não tiver acesso de superusuário, use por enquanto a URL do papel `medcuidar_owner` em `DATABASE_URL_BACKUP` (funciona, mas dá mais poder do que precisa).

## 3. Serviço no EasyPanel

1. **Create service → App**, nome `medcuidar-backup`, origem o mesmo repositório do GitHub, **Build path `/apps/backup`** (usa o `Dockerfile` dessa pasta).
2. **Environment:**

| Variável | Valor |
|---|---|
| `DATABASE_URL_BACKUP` | `postgres://medcuidar_backup:SENHA@automacoes_medcuidar-db:5432/medcuidar` |
| `BACKUP_S3_ENDPOINT` | `https://<ID_DA_CONTA>.r2.cloudflarestorage.com` |
| `BACKUP_S3_BUCKET` | `medcuidar-backups` |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | as chaves do token do R2 |
| `BACKUP_ENCRYPTION_KEY` | a senha longa que você gerou (mín. 16 caracteres) |
| `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY`, `APPWRITE_PRESCRIPTIONS_BUCKET_ID` | os mesmos valores do `medcuidar-web` (a chave precisa de `files.read`, e de `files.write` só se for restaurar fotos) |
| `BACKUP_AT` (opcional) | horário diário, padrão `03:00` (fuso `America/Sao_Paulo`) |
| `BACKUP_RETENTION_DAYS` (opcional) | padrão `30` (mínimo 7) |
| `BACKUP_HEALTHCHECK_URL` (opcional) | endereço de ping de um monitor, ver seção 5 |

3. **Deploy.** No log aparece `serviço no ar: backup diário às 03:00`. Se o último backup não existir ou tiver mais de 26 h, ele roda uma vez na subida.
4. **Primeiro backup de verdade:** no console do serviço (aba Console), `node src/cli.mjs once`. Esperado: `banco: db/... (… tabelas)`, `fotos: N no Appwrite, N enviadas` e `backup concluído`. Confira no painel do R2 que apareceram `db/` e `files/`.

O Appwrite (login) roda na mesma VPS: o banco dele (contas de acesso) **não** está neste backup; ele é coberto pelo backup semanal da Hostinger. O que aqui protege são os **dados do MedCuidar** e as **fotos de receita**.

## 4. Provar que o backup serve (faça agora e uma vez por mês)

No console do serviço de backup (precisa de um usuário do Postgres que possa criar bancos; use o `postgres`):

```bash
node src/cli.mjs verify --admin 'postgres://postgres:SENHA_POSTGRES@automacoes_medcuidar-db:5432/postgres'
```

Ele baixa o backup mais recente, abre com a chave, confere o hash, restaura num banco **descartável**, compara as linhas de cada tabela com as do dia do backup e apaga o banco de teste. Esperado: `verificação OK (contagens idênticas)`. "OK com diferenças pequenas" pode acontecer se alguém usou o sistema durante o backup; falta de tabela ou tabela vazia é falha (código de saída 2).

Outros comandos úteis (`node src/cli.mjs <comando>`):

| Comando | Para quê |
|---|---|
| `list` | lista os backups (data, tamanho, linhas) |
| `once` | faz um backup agora |
| `restore-db --para <url> [--backup <chave>] [--criar-papeis] [--limpar]` | restaura num banco |
| `restore-files [--simular]` | devolve ao Appwrite as fotos que não existirem lá, com o mesmo id |

## 5. Aviso quando falhar (grátis)

Crie uma conta em **healthchecks.io** (plano gratuito), um check com período de 1 dia e tolerância de 3 h, e ponha o endereço de ping em `BACKUP_HEALTHCHECK_URL`. O serviço avisa o início, o sucesso e a falha; se nenhum aviso chegar no prazo, o healthchecks manda e-mail para você. (Um aviso dentro do portal e no WhatsApp entra no Lote 5C, junto com o monitoramento.)

## 6. Emergência: restaurar tudo

Cenário: a VPS foi perdida ou o banco corrompeu.

1. Suba um Postgres novo e rode as migrações (`docs/09`), ou use o banco vazio que o `restore-db` preencherá.
2. Suba o serviço `medcuidar-backup` (ou rode a imagem em qualquer máquina) com as variáveis da seção 3. **A chave `BACKUP_ENCRYPTION_KEY` tem que ser a mesma de quando o backup foi feito.**
3. Banco novo e vazio:
   ```bash
   node src/cli.mjs restore-db --para 'postgres://postgres:SENHA@HOST:5432/medcuidar' --criar-papeis
   ```
   Para escolher um dia específico, use `--backup db/2026/10/medcuidar-AAAAMMDD-HHMMSS.dump.enc` (veja `list`). Restaurar sobre o banco de produção em uso exige `--producao` e `--limpar`, de propósito.
4. Depois de restaurar, **defina de novo as senhas** dos papéis `medcuidar_app` e `medcuidar_owner` (o dump não carrega senhas) e aponte o `medcuidar-web` para o banco.
5. Fotos: com o Appwrite novo no ar e o bucket `prescriptions` criado, `node src/cli.mjs restore-files`.

## Limites conhecidos
- Perda máxima: até 24 h de dados (o backup é diário). Se isso for pouco, dá para rodar mais vezes por dia mudando a regra de horário.
- Fotos apagadas no portal ficam no backup por até 35 dias; a exclusão total de uma família (LGPD) entra no Lote 5B.
- O dump usa `pg_dump` 18 (lê servidores 12 a 18; o `pg_dump` recusa servidor mais novo que ele). Se o Postgres for atualizado para a 19, refaça o build com `--build-arg PG_CLIENT_VERSION=19`. Restaurar num Postgres mais antigo que o do dump funciona, apenas com um aviso de parâmetro desconhecido que o serviço ignora.
