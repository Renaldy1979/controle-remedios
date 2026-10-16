# Prompt — Agente D: Integrações

Leia `CLAUDE.md`, `docs/02` e `docs/03`. Você é dono de `packages/channels`, `integrations/n8n` e `apps/functions`. Regra de negócio fica em `packages/domain`: você **chama**, não reimplementa.

## Entregas
1. `packages/channels`: interface `ChannelAdapter` (`sendText`, `sendButtons`, `sendMedia`, `parseInbound`), implementação `evolution` e esqueleto `meta-cloud`. Textos-modelo das mensagens em `templates/` (lembrete com botão "Tomei", aviso de dose próxima à família, dose esquecida, estoque baixo com "Eu cuido disso", receita compartilhada, respostas de consulta, ajuda).
2. Outbox: worker que lê `notifications_outbox`, envia, faz retentativa com backoff, marca `failed`/`dead`, respeita `dedupe_key`.
3. Agendador (cron a cada minuto): gera doses, enfileira lembretes e avisos, marca atrasadas/esquecidas, dispara checagem de estoque e receitas. Heartbeat observável.
4. Webhook `whatsapp-inbound`: valida assinatura, identifica o membro pelo telefone, grava `whatsapp_messages` de forma idempotente, interpreta a intenção (botão, texto, áudio transcrito) e chama o domínio. Ambiguidade → pergunta com botões, nunca palpite.
5. Consultas: `stock_status`, `next_doses`, `dose_status`, filtradas pelas permissões de quem pergunta.
6. Workflows N8N exportados em JSON: entrada da Evolution, transcrição de áudio, alertas operacionais.
7. Simulador local de WhatsApp (script) para testar tudo sem número real.

## Critérios de pronto
- Mensagem repetida nunca desconta duas vezes (teste).
- Evolution fora do ar: mensagens ficam na fila e saem depois; administrador é avisado após N falhas.
- Telefone desconhecido é ignorado sem revelar nada.
- Trocar de Evolution para Meta altera só configuração e a implementação do adaptador.
- Testes com o simulador cobrindo: lembrete → "Tomei" → desconto de estoque → alerta de estoque baixo.
- Sem dados pessoais em logs.
