# Lote 5A — Validação do dono

> Preencha depois de seguir `docs/lotes/L5A-roteiro.md`. O Lote 5B só começa com o status **validado**.

- **Data do teste:** 30/10/2026 a 02/11/2026
- **Quem testou:** Renaldy (dono)
- **Endereço do staging / versão (commit):** staging do EasyPanel, `9cf5f3c`
- **Aparelhos e navegadores:** não informado
- **Migração 0011 rodada no staging (Parte 0):** ☑ sim ☐ não
- **Variáveis novas criadas:** nenhuma neste lote
- **Perfil "Somente leitura" com ações travadas na matriz (passos 5 e 6):** ☑ sim ☐ não
- **Convite por e-mail e por WhatsApp, entrada e menu só de leitura (passos 7 a 10):** ☑ sim ☐ não
- **"Tomei" recusado pelo WhatsApp e consultas funcionando (passos 11 e 12):** ☑ sim ☐ não
- **Só o resumo diário chegou (passo 13):** ☐ sim ☐ não ☐ ainda não deu o horário (não registrado em separado; o dono deu o roteiro como "tudo ok")
- **Status:** ☑ validado ☐ validado com ajustes ☐ não validado

## O que passou

Todo o roteiro do Lote 5A ("tudo ok", segundo o dono). Também passaram, no mesmo ciclo de testes: os ajustes de esquemas (hora padrão, "Como vai ficar", calendário com filtros, intervalo contínuo), o "tomei" um a um com "Tomei todos", a opção "Todas (as N pendentes)" na lista de pendentes, e o backup diário para o Cloudflare R2 com restauração provada (`verify` OK).

## O que não passou

| Passo | Esperado | Aconteceu |
| ----- | -------- | --------- |
| (backup) primeira rodada | `pg_dump` lê o servidor | Servidor é Postgres 18 e a imagem tinha o cliente 17. Corrigido em `3c25e73` (cliente 18); repetido e aprovado |
| ("tomei" com pendentes de horários diferentes) | opção para confirmar todas | A lista não tinha "Todas". Corrigido em `9cf5f3c`; reaprovado |

## Ajustes pedidos

Nenhum em aberto.
