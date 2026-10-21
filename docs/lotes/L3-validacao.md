# Lote 3 — Validação do dono

> Registrado pelo orquestrador **a pedido do dono** ("Tudo ok") em 21/10/2026. O Lote 4 só começa com o status **validado**.

- **Data do teste:** 21/10/2026
- **Quem testou:** Renaldy Sousa
- **Endereço do staging / versão:** https://automacoes-medcuidar-app.8m5sgi.easypanel.host (commit `348841c`)
- **Aparelhos e navegadores:** não informado
- **Bucket `prescriptions` criado, chave ampliada e variáveis configuradas (Parte 0):** ✓ sim ☐ não
- **Migração 0005 rodada no staging (Parte 0):** ✓ sim ☐ não *(a reposição em 4 etapas, que depende das colunas novas, funcionou no teste)*
- **Status:** ✓ validado ☐ validado com ajustes ☐ não validado

## O que passou

Tudo (declarado pelo dono: "Tudo ok"): navegação de Configurações em árvore, receitas (anexar, ver, compartilhar, permissões), avisos de validade e reposição em 4 etapas.

## O que não passou

Nada ficou reprovado. Uma falha de configuração apareceu e foi resolvida durante o teste:

| Passo | Esperado | Aconteceu |
| ----- | -------- | --------- |
| Salvar a primeira receita | Receita salva | "O armazenamento das receitas ainda não foi configurado". Causa: faltava a variável `APPWRITE_PRESCRIPTIONS_BUCKET_ID` no app (o código não tem valor padrão). Resolvido criando a variável e reiniciando. Docs e log corrigidos (`05ab677`, `348841c`). |

## Ajustes pedidos

Nenhum na hora da validação. **Pedido depois (21/10/2026):** o botão principal das telas **Remédios** ("Novo remédio"), **Pessoas** ("Convidar pessoa") e **Pacientes** ("Cadastrar paciente") deve ficar **na mesma linha do título da página** (ganha espaço vertical no desktop; no celular o botão desce quando não cabe ao lado do título). Feito no commit `PageAction` (local); **deploy junto com o Lote 4**, por decisão do dono.

## Pendências

- Nenhuma do dono. Para o Lote 4: número de WhatsApp do sistema, URL e credenciais do Evolution Go e do N8N (fora do chat).

## Decisão

✓ Liberar o Lote 4

Assinatura / data: Renaldy Sousa — 21/10/2026 (registrado pelo orquestrador a pedido do dono)
