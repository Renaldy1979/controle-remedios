# Integrações (D) → Fundação (A): variáveis de ambiente

Atualizado: o canal é o **Evolution Go** (adaptador `evolution-go`). As variáveis já foram acrescentadas ao `.env.example` da raiz (arquivo editado só por esta tarefa, a pedido do orquestrador); a lista completa e comentada está lá. Resumo do que mudou em relação à versão anterior desta nota: `EVOLUTION_INSTANCE` virou `EVOLUTION_INSTANCE_ID` (UUID), `CHANNEL_PROVIDER` agora é `evolution-go|meta-cloud`, e há `SUPPORTS_BUTTONS` (padrão `false`).

Sem mudança de modelo de dados: usamos `notifications_outbox`, `whatsapp_messages`, `login_codes`, `audit_log`, `prescription_shares` como estão em `collections.ts`. Observações:
- `login_codes` não tem `created_at`; usamos `$createdAt`.
- `notifications_outbox.next_attempt_at` é sempre preenchido enquanto não está `sent`/`dead`.
- **Índices sugeridos** (o Appwrite exige índice para filtrar): `dose_events (status, scheduled_at)`; `notifications_outbox (target_member_id)` e `(target_group_id)` com `status` (resposta numerada "1/2" consulta as últimas mensagens enviadas à pessoa); `members (phone_e164)` já existe por família; `whatsapp_messages (provider_message_id)` já existe.
