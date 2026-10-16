# Integrações (D) → Fundação (A): variáveis de ambiente novas

`.env.example` é da pasta do agente A. Acrescentar (sem valores reais):

```env
# Canal de WhatsApp: evolution (padrão) ou meta-cloud
CHANNEL_PROVIDER=evolution
# (já existentes) EVOLUTION_BASE_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE / WHATSAPP_WEBHOOK_SECRET / GEMINI_API_KEY
# Meta Cloud (só se CHANNEL_PROVIDER=meta-cloud)
META_ACCESS_TOKEN=
META_PHONE_NUMBER_ID=

# Segredo para selar/hashear o código de login (gere um aleatório longo)
LOGIN_CODE_SECRET=
# Transcrição: gemini (padrão) ou n8n
TRANSCRIPTION_PROVIDER=gemini
GEMINI_MODEL=gemini-2.5-flash
TRANSCRIPTION_N8N_URL=

# Monitoramento
HEARTBEAT_URL=            # URL de push do monitor externo (Uptime Kuma/Healthchecks)
ALERTS_WEBHOOK_URL=       # webhook "medcuidar-alertas" do N8N
ALERTS_WEBHOOK_SECRET=
SCHEDULER_TRIGGER_SECRET= # só para disparar a Function scheduler por HTTP
```

Sem mudança de modelo de dados: usamos `notifications_outbox`, `whatsapp_messages`, `login_codes`, `audit_log`, `prescription_shares` como estão em `collections.ts`. Observações:
- `login_codes` não tem `created_at`; usamos `$createdAt`.
- Para o worker, `notifications_outbox.next_attempt_at` é sempre preenchido (a consulta `status in (...) and next_attempt_at <= agora` não enxerga nulos); só vira `null` em `sent`/`dead`.
- Sugestão (não bloqueante): índice em `dose_events (status, scheduled_at)` para a consulta do agendador a cada minuto.
