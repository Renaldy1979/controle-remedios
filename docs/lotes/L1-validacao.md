# Lote 1 — Validação do dono

> Preencha depois de rodar `docs/lotes/L1-roteiro.md` no staging. O Lote 2 só começa com o status **validado**.

- **Data do teste:** 10/10/2026
- **Quem testou:** Renaldy
- **Endereço do staging / versão:** https://automacoes-medcuidar-app.8m5sgi.easypanel.host/
- **Aparelhos e navegadores:** Microsoft Edge
- **Status:** ☐ validado ✓ validado com ajustes ☐ não validado

## O que passou

(Cite os passos do roteiro, ex.: A1 a A10, B1 a B8.)

- Todos os passos

## O que não passou

(Passo, o que você esperava e o que aconteceu. Se puder, inclua uma foto da tela.)

| Passo | Esperado | Aconteceu |
| ----- | -------- | --------- |
|       |          |           |

## Ajustes pedidos

(Mudanças que você quer antes de dar o lote como pronto.)

-

## Pendências

Tela de cadastro do paciente no campo data de nascimento não esta formatando automaticamente ao digitar.

-

**Resolvido na entrega do Lote 1 (orquestrador):** o campo de data de nascimento agora coloca as barras sozinho enquanto a pessoa digita (`dd/mm/aaaa`), aceita colar com lixo e permite apagar normalmente (`apps/web/src/lib/date-mask.ts`, com testes). Também foi corrigida a tela "Esqueci minha senha" (e "Nova senha"), que era gerada no build e redirecionava para o login.

## Decisão

✓ Liberar o Lote 2

Assinatura / data:
