# Lote 5C — Roteiro de teste (operação e continuidade)

Sem domínio: use o endereço do `medcuidar-web` no EasyPanel. Guia completo: `docs/14-operacao.md`.

## Parte 0 — Preparar (uma vez)
1. Gere uma senha longa (16+ caracteres) e coloque `BACKUP_REPORT_SECRET=<senha>` no `medcuidar-web`. Faça o **Deploy** do portal (não há migração neste lote).
2. No `medcuidar-backup`: `BACKUP_REPORT_SECRET=<mesma senha>` e `BACKUP_REPORT_URL=https://<portal>/api/internal/backup-report`. Deploy.
3. No `medcuidar-web`, ponha também `APP_VERSION=v0.5.3` (ou o nome da tag que você marcar).

## Parte 1 — Saúde e monitor
4. Abra `https://<portal>/api/health`. Esperado: `{"status":"ok","database":"ok"}`.
5. Abra `https://<portal>/api/health?completo=1`. Esperado: `status ok`, `worker ok`, `backup` e a `versao` que você configurou. (Se `worker` vier `sem_registro` logo após o deploy, espere 1 minuto e recarregue.)
6. Crie o monitor no UptimeRobot (doc 14, seção 1) com essa URL completa.
7. **Teste do alerta:** pause o `medcuidar-web` por 6 minutos. Esperado: e-mail "Down"; ao religar, "Up".

## Parte 2 — Aviso de backup
8. Console do `medcuidar-backup`: `node src/cli.mjs once`. Esperado: `backup concluído`. Recarregue `/api/health?completo=1`: `"backup":"ok"`.
9. **Falha simulada:** no `medcuidar-backup` troque a senha do `DATABASE_URL_BACKUP` por uma errada, Deploy, e rode `node src/cli.mjs once`. Esperado: o comando falha, e no portal (logado como Administrador) o **sino** mostra "O backup automático falhou". Desfaça a senha, Deploy e rode `once` de novo.
10. (Opcional, demora) O aviso de "atrasado" aparece sozinho se passarem 30 h sem backup; está coberto por teste automático.

## Parte 3 — Versão marcada e voltar atrás
11. No terminal do seu computador: `git tag -a v0.5.3 -m "Lote 5C" && git push origin v0.5.3`.
12. No `medcuidar-web` → Source, use a tag `v0.5.3` → Deploy. `/api/health?completo=1` mostra a versão.
13. **Ensaio de rollback:** troque a tag para a anterior (`v0.5.2`, se existir, ou `main`), Deploy, confirme o login e `/api/health?completo=1`; volte para `v0.5.3`.
14. Leia `docs/14-operacao.md` (seções 4 e 5) e diga se algum passo ficou confuso.

## Parte 4 — Restauração testada
15. No console do `medcuidar-backup`: `node src/cli.mjs verify --admin 'postgres://postgres:SENHA@automacoes_medcuidar-db:5432/postgres'`. Esperado: `verificação OK (contagens idênticas)`.

## Registro
Preencha `docs/lotes/L5C-validacao.md`. O Lote 5D (piloto com a família) só começa com **validado**.
