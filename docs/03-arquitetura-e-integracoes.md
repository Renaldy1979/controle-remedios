# 03 — Arquitetura e integrações

## Visão geral
```
Painel Next.js ──► Appwrite (Auth, DB, Storage, Functions)
                        ▲                │
                        │ API interna    │ eventos
WhatsApp ◄► Evolution ◄► N8N ───────────┘
                         ▲
              Agendador (Appwrite Function, a cada minuto)
```
- **A regra de negócio mora no código** (`packages/domain`, chamado por Appwrite Functions e pela API do painel). O N8N **orquestra e transporta**; não decide estoque nem estado de dose.
- O painel e o WhatsApp usam **as mesmas funções de domínio**: confirmar dose é uma operação única, qualquer canal.

## Componentes
1. **Agendador** (Appwrite Function, cron 1 min): gera `dose_events` do dia (idempotente), enfileira lembretes e avisos em `notifications_outbox`, marca doses `late`/`missed`, abre reposições quando o estoque cruza o limite, avisa receitas que vencem.
2. **Worker de saída**: lê `notifications_outbox` (`queued`), envia via adaptador de canal, faz retentativa com backoff, move para `dead` após N falhas e alerta o administrador. `dedupe_key` evita lembrete duplicado.
3. **Webhook de entrada** (Function `whatsapp-inbound`): recebe do N8N a mensagem normalizada, identifica o membro pelo telefone, grava em `whatsapp_messages` (idempotente por `provider_message_id`), interpreta a intenção e chama o domínio.
4. **Adaptador de canal** (`packages/channels`): interface `sendText, sendButtons, sendMedia, parseInbound`. Implementações: `evolution` (agora) e `meta-cloud` (depois). Trocar = configuração.
5. **N8N**: workflows versionados em `integrations/n8n/*.json`: (a) Evolution webhook → normaliza → chama `whatsapp-inbound`; (b) transcrição de áudio; (c) alertas operacionais ao administrador.
6. **Painel**: Next.js com Server Actions/route handlers que chamam o domínio; Appwrite SDK para auth e leitura.

## Fluxos críticos

### Lembrete e confirmação
1. Agendador acha dose `pending` com `scheduled_at - lead <= agora` → `resolveResponsible` → outbox `dose_reminder` com botão "Tomei" (`payload.dose_event_id`).
2. Responsável toca "Tomei" (ou escreve/manda áudio) → inbound → identifica membro → `confirmDose(doseEventId, memberId, channel, sourceMessageId)`.
3. `confirmDose` (transação lógica): dose → `taken`, cria `stock_movement` tipo `dose` (único por `dose_event_id`), recalcula `cached_balance`, dispara checagem de estoque baixo.
4. Sem confirmação em `reminder_retry_min` → reenvia 1x; em `missed_after_min` → `missed` + aviso à família.

### Mensagem em texto/áudio ambígua
Se houver mais de uma dose pendente possível, responder com botões listando as opções. Nunca confirmar por palpite. Áudio → transcrição → mesma lógica; guardar a transcrição para auditoria.

### Estoque baixo → reposição
1. `forecastDepletion` indica `daysLeft <= threshold` (padrão da família ou do tratamento).
2. Cria `replenishment` (`needs_prescription` se não há receita vigente; senão `prescription_received`), avisa os membros com `receives_family_alerts` com botão "Eu cuido disso".
3. Quem assume vira `owner` da etapa; as demais pessoas recebem "Fulana cuida disso". Avanço de etapa atualiza todos.
4. Compra registrada → `stock_movement` tipo `purchase` → reposição `done`.

### Receitas
Upload no painel (câmera/galeria) → Appwrite Storage com permissão do Team → registros de `prescriptions`/`files`/`items`. Compartilhar no WhatsApp envia a mídia via adaptador usando URL temporária. Foto recebida no WhatsApp (fase 2): fluxo pergunta o paciente por botões e salva como `awaiting_review`.

### Consultas
Intenções: `stock_status`, `next_doses`, `dose_status(medication)`. Resposta filtrada pelas permissões do membro. Intenção desconhecida → mensagem de ajuda com exemplos.

## Segurança e confiabilidade
- Webhooks assinados (segredo compartilhado); rejeitar telefone não cadastrado sem revelar existência da família.
- Rate limit por telefone. Segredos só em env.
- Backups do Appwrite e do Storage diários; teste de restauração documentado.
- Monitoramento: heartbeat do agendador (se parar, alerta); contagem de `failed/dead` no painel do administrador.
- Ambientes: `dev` (Evolution de teste, número de teste) e `prod`. Nunca testar com o número real dos pacientes.

## Decisões abertas
- Provedor de transcrição de áudio (Whisper vs Claude vs outro).
- Retenção de `whatsapp_messages` (sugestão: 12 meses, corpo redigido).
- Limites do plano Evolution/Meta quando virar SaaS.
