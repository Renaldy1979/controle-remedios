# 14 — Operação: monitoramento, versões e voltar atrás (Lote 5C)

Sem domínio próprio por enquanto: tudo abaixo usa o endereço que o EasyPanel já deu ao `medcuidar-web` (o mesmo do staging). Quando houver domínio, só troque o endereço nos monitores.

## 1. Monitoramento externo (grátis, 10 minutos)

O portal tem duas verificações em `/api/health`:

| Endereço | Para quê | Falha (503) quando |
|---|---|---|
| `/api/health` | Docker/EasyPanel (já configurado) | o banco não responde |
| `/api/health?completo=1` | **monitor externo** | o banco não responde **ou o worker de lembretes parou** (sem batimento há mais de 5 min) |

A resposta completa também diz o estado do último backup (`ok`, `falhou`, `atrasado`, `sem_registro`) e a versão no ar. Nunca traz dado de família.

**Montar o alerta (UptimeRobot, plano gratuito):**
1. Crie a conta em uptimerobot.com → *Add New Monitor* → tipo **HTTP(s)**.
2. URL: `https://<endereço do portal>/api/health?completo=1`; intervalo 5 minutos.
3. Em *Alert contacts*, deixe o seu e-mail (e, se quiser, o app do UptimeRobot no celular, que avisa por notificação).
4. Teste: pause o `medcuidar-web` no EasyPanel por 6 minutos; chega o aviso "Down". Religue e chega o "Up".

Dois outros avisos já existem dentro do portal (sino dos Administradores): WhatsApp desconectado / mensagens falhando, e **backup** (abaixo). O monitor externo cobre o caso em que o portal inteiro está fora, que o sino não consegue avisar.

## 2. Aviso de backup no portal

O serviço de backup informa o portal ao fim de cada rodada (só "deu certo?", quando e o tamanho — nunca texto de erro). O portal então:
- avisa os Administradores no sino quando a rodada **falha**;
- avisa quando **nenhum backup termina há mais de 30 horas** (serviço parado, VPS desligada, rodada travada). Uma vez por ocorrência.

Configuração (uma vez):
1. Gere uma senha longa (16+ caracteres) para `BACKUP_REPORT_SECRET`.
2. No **`medcuidar-web`**: `BACKUP_REPORT_SECRET=<a senha>` → Deploy.
3. No **`medcuidar-backup`**: `BACKUP_REPORT_SECRET=<a mesma senha>` e `BACKUP_REPORT_URL=https://<endereço do portal>/api/internal/backup-report` → Deploy.
4. Console do `medcuidar-backup`: `node src/cli.mjs once`. Depois abra `https://<portal>/api/health?completo=1`: `"backup":"ok"`.

Sem `BACKUP_REPORT_SECRET` no portal a rota responde 404 e nada é monitorado (o healthchecks.io da seção 5 do doc 12 continua valendo e é independente).

## 3. Versões marcadas (tag)

Produção só roda **versão marcada**, nunca "o que estiver na main". Convenção: `v0.<lote>.<n>` (ex.: `v0.5.2`).

```bash
git checkout main && git pull
git tag -a v0.5.2 -m "Lote 5B validado"
git push origin v0.5.2
```

No EasyPanel, `medcuidar-web` → *Source*: em vez do ramo `main`, use a tag (campo *Branch*: `v0.5.2`). Em *Environment*, ponha `APP_VERSION=v0.5.2` (aparece em `/api/health?completo=1`). Anote a versão anterior antes de trocar: ela é o seu passo de volta.

## 4. Roteiro de uma atualização

1. **Backup antes da migração.** Console do `medcuidar-backup`: `node src/cli.mjs once` — espere `backup concluído`. (Sem isso, não migre.)
2. Marque a tag (seção 3) e rode a migração, se houver arquivo novo em `packages/pg/drizzle/`:
   `DATABASE_URL_ADMIN=... node /app/migrate/migrate.mjs`
3. Deploy do `medcuidar-web` na tag nova.
4. Confira `/api/health?completo=1`: `status ok`, `worker ok`, versão nova.
5. Faça o roteiro curto do lote (login, "tomei" no WhatsApp, uma tela).

Regra de ouro das migrações: **só aditivas** (criar tabela/coluna, nunca apagar nem renomear no mesmo lote em que o código deixa de usar). Assim a versão anterior do código continua funcionando com o banco já migrado, e voltar o portal não exige mexer no banco.

## 5. Voltar atrás (rollback)

| Situação | O que fazer |
|---|---|
| A versão nova tem defeito, o banco está bem | `medcuidar-web` → *Source* → tag anterior → Deploy; ajuste `APP_VERSION`. Leva ~3 minutos. |
| A migração deu erro no meio | Não faça deploy. Ela roda em transação por arquivo: confira se o arquivo foi aplicado (`select * from drizzle.__drizzle_migrations`). Se nada mudou, corrija e rode de novo. |
| Dados corrompidos/apagados por engano | Restaurar o backup: `docs/12-backup.md`, seção 6 (perda máxima: até 24 h). Para um banco em uso exige `--producao --limpar`, de propósito. |

Depois de qualquer rollback: `/api/health?completo=1` e o roteiro curto.

## 6. Plano B se o sistema ou o WhatsApp cair

1. O Adelino e a Maria seguem a **folha de papel** com os horários (imprima no 5D).
2. As filhas conferem o portal quando voltar; o histórico de doses não é perdido (as confirmações atrasadas podem ser lançadas depois no portal, em "Doses do dia").
3. Só o WhatsApp caiu: o portal funciona normalmente; reconectar o número (QR Code) na Evolution Go (`docs/11-whatsapp-direto.md`).

## Limites conhecidos
- Sem domínio, o monitor externo depende do endereço do EasyPanel; se ele mudar, atualize o monitor.
- O aviso de backup é no sino do portal (não por WhatsApp), porque um WhatsApp desconectado é justamente um dos motivos de alerta.
- O monitor externo só enxerga o portal; se a **VPS inteira** cair, ele avisa por e-mail, mas ninguém recebe WhatsApp até ela voltar.
