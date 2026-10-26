# Lote 4B — Validação do dono

> Registrado pelo orquestrador **a pedido do dono** ("Lote 4B ok") em 26/10/2026, pelo roteiro rápido (`L4B-roteiro-rapido.md`). O Lote 5 só começa com o status **validado**.

- **Data do teste:** 26/10/2026
- **Quem testou:** Renaldy Sousa
- **Endereço do staging / versão (commit):** https://automacoes-medcuidar-app.8m5sgi.easypanel.host (código até `df44b43`; correções do teste real em `a4eee63`)
- **Aparelhos e navegadores:** não informado (WhatsApp real, chip dedicado conectado na instância `medcuidar` da Evolution Go)
- **Migração 0008 a 0010 rodada no staging (Parte 0):** ✓ sim ☐ não *(a fila e o worker funcionaram no teste)*
- **Variáveis novas criadas:** ✓ sim ☐ não *(`WHATSAPP_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `EVOLUTION_*`, `WHATSAPP_WORKER_ENABLED`)*
- **Parte A (sem número, pelo simulador) concluída:** ☐ sim ✓ dispensada pelo dono (testou direto no WhatsApp)
- **Parte B (com número real) concluída:** ✓ sim ☐ não ☐ ainda não há número
- **Status:** ✓ validado ☐ validado com ajustes ☐ não validado

## O que passou

Declarado pelo dono: **"Lote 4B ok"**. Observado nos registros do teste real, antes da declaração:
- Webhook da Evolution Go recebendo as mensagens, fila e worker processando.
- Conversa por texto ("estoque") respondendo.
- Pergunta livre respondida pelo Claude (1 chamada registrada no painel de IA).
- **Áudio** transcrito pelo Gemini depois da troca do modelo.
- Envio pelo WhatsApp funcionando depois de usar o token da instância.

## O que não passou (corrigido durante o teste)

| Passo | Esperado | Aconteceu |
| ----- | -------- | --------- |
| Envio de mensagens | Mensagem sai pelo WhatsApp | A Evolution Go respondeu **401** em `/send/text`: o provedor mandava a chave global; as rotas de envio exigem o **token da instância**. Contornado com o token em `EVOLUTION_API_KEY`; corrigido no código (`EVOLUTION_INSTANCE_TOKEN`, motivo claro no painel e pausa do envio em 401) em `5db7b65`. |
| Áudio | Transcrição | Resposta "não consegui entender o áudio": o Google devolvia **404** porque `gemini-2.5-flash` foi aposentado (16/10/2026). Resolvido com `GEMINI_MODEL=gemini-3.5-flash-lite`; padrão do código trocado, com reserva em 404, mime normalizado e diagnóstico no painel em `a4eee63`. |
| Ao ligar o worker | Só avisos úteis | Foram geradas várias mensagens de "dose esquecida" de doses antigas (dados de teste). Agora só doses das últimas 6 horas geram aviso. |

## Formato real das mensagens (Parte B, passo B1)
Sem divergência de formato registrada pelo dono: as mensagens de texto e de áudio foram interpretadas e respondidas.

## Ajustes pedidos
1. **Estoque no WhatsApp deve informar a quantidade restante** (hoje mostra só os dias ou o aviso de estoque baixo): em implementação.
2. **Vários remédios lembrados juntos:** um lembrete agrupado por paciente e horário, com o menu "1 — Tomei todos", "2 — Confirmar um por um" e "3 — Lembrar depois"; no um por um, "Tomei", "Lembrar depois" e "Não vou tomar" (pulada). Em implementação.

Esses dois ajustes saem em uma versão seguinte e **não** bloqueiam a validação do lote.

## Pendências
- Ajustes 1 e 2 acima (entregues na próxima versão e conferidos antes do envio).
- Trocar a chave do Appwrite colada no chat no começo do projeto e apagar a família demo antes do piloto familiar (Lote 5).

## Decisão

✓ Liberar o Lote 5

Assinatura / data: Renaldy Sousa — 26/10/2026 (registrado pelo orquestrador a pedido do dono)
