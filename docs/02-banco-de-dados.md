> **Atenção:** o escopo foi redefinido em 19/10/2026. Onde este documento conflitar com `docs/06-escopo-v2.md`, vale o 06 (login por e-mail/senha no Appwrite, Postgres + Drizzle, API `/api/v1` + N8N com um fluxo por gatilho).

# 02 — Banco de dados (Appwrite)

Fonte da verdade do modelo. Mudou aqui, muda em `packages/shared` (tipos + zod) e em `scripts/appwrite` (criação das coleções) no mesmo commit.

## Regras gerais
- Toda coleção (exceto `families`) tem `family_id` indexado. Cada família é um **Team** do Appwrite; permissões de documento = `team:<family_id>` com papéis.
- Todos têm `$id`, `$createdAt`, `$updatedAt`. Exclusão lógica (`deleted_at`) para dados clínicos; exclusão física só sob pedido LGPD.
- Datas em UTC (ISO). Enums em minúsculas.

## Identidade e acesso
**families**: name, timezone (default America/Sao_Paulo), settings (json: default_low_stock_days, default_reminder_lead_min, default_reminder_retry_min (padrão 15), late_after_min (padrão 15), missed_after_min (padrão 120), repeat_reminder_options_min ([15,30,60]), daily_summary_time (padrão `20:00`), whatsapp_group_id (opcional, grupo da família), reminder_recipients_mode (`all_members|assignments_only|assignments_plus_family`, padrão `all_members`), transcription_provider (padrão `gemini`))
`patients.reminder_recipients_mode` (opcional) sobrescreve o da família.

**members**: family_id, user_id (Appwrite Auth, opcional se só usa WhatsApp), name, phone_e164 (único por família), profile_id, active, receives_family_alerts (bool), whatsapp_status (`unverified|verified|failed`), role_label (texto livre, ex.: "filha", "cuidadora")

**profiles**: family_id, name, permissions (json), is_system (bool). Perfis iniciais: Administrador (sempre total, não editável), Familiar, Cuidadora, Confirmador. Chaves de permissão:
`dashboard.view, patients.view, patients.manage, doses.confirm, doses.history.view, medications.manage, treatments.manage, stock.view, stock.adjust, prescriptions.view, prescriptions.upload, prescriptions.share, prescriptions.delete, replenishment.manage, members.manage, profiles.manage, settings.manage, whatsapp.query`
A matriz do painel agrupa isto em 11 funcionalidades (ver `design/design.md` 5.6); o mapeamento grupo → chaves fica em `packages/shared`.
Padrão de receitas: Administrador, Familiar e Cuidadora veem; Confirmador não.

**login_codes**: phone_e164, code_hash, expires_at, attempts, consumed_at, created_at. Código de 6 dígitos, uso único, expira em minutos, limite de tentativas e de envios por telefone.

## Pacientes e cuidados
**patients**: family_id, name, birth_date, notes, can_use_phone (bool), self_member_id (opcional: o paciente também confirma doses), reminder_recipients_mode (opcional), active

**care_assignments** (escala): family_id, patient_id, member_id, weekdays (int[] 0-6), start_time (HH:mm), end_time (HH:mm), priority (int). Quem recebe o lembrete = assignments cobrindo o horário, por prioridade. Sem cobertura → vai para membros com `receives_family_alerts`.

## Remédios e tratamentos
**medications**: family_id, name, alternative_names (string[]), route (`drops|tablet|powder|liquid|ointment|other`), control_unit (`unit|ml|drop|gram`), drops_per_ml (number, só para gotas), package_size (number, na unidade de controle), requires_prescription (bool, padrão true), notes

**treatments** (demanda de uso): family_id, patient_id, medication_id, start_date, end_date (opcional), status (`active|paused|finished`), low_stock_days (opcional, sobrescreve o padrão), notes

**treatment_phases**: family_id, treatment_id, order, start_day (1-based), end_day (null = até acabar), schedule_type (`interval|fixed_times`), interval_hours (para interval), first_dose_time (HH:mm), times (string[] para fixed_times), dose_amount (na control_unit)
Regras: fases sem sobreposição; `end_day` de uma fase + 1 = `start_day` da seguinte; apenas a última pode ter `end_day` nulo.
Exemplo: fase 1 = dias 1–15, interval 3h; fase 2 = dias 16–20, interval 6h.
**Intervalo contínuo (27/10/2026, ver `docs/06` seção 9):** `interval` corre sem parar através da meia-noite. Âncora = `start_date` + `first_dose_time` da fase de menor `order`; cada fase começa em `start_day` no horário da âncora e gera doses a cada `interval_hours` até o fim do seu último dia (`end_day`). Nenhuma mudança de colunas.

## Doses
**dose_events**: family_id, treatment_id, patient_id, medication_id, scheduled_at, status (`pending|taken|late|missed|skipped`), confirmed_by_member_id, confirmed_at, channel (`whatsapp|panel|system`), source_message_id, skipped_reason, amount (snapshot da dose), phase_id
Índice único: `(treatment_id, scheduled_at)` — impede geração duplicada. Índice único em `source_message_id` quando presente — impede confirmação duplicada.

## Estoque (livro-razão)
**stock_items**: family_id, patient_id, medication_id, control_unit, is_estimate (bool), cached_balance (derivado, reconstruível), cached_balance_at
**stock_movements**: family_id, stock_item_id, type (`purchase|dose|adjustment|loss`), quantity (+ entra, − sai), dose_event_id (opcional, único quando presente), purchase_id/replenishment_id (opcional), created_by_member_id, note
Saldo = soma de `quantity`. `cached_balance` é só otimização e pode ser recomputado.

## Receitas
**prescriptions**: family_id, patient_id, doctor_name, specialty, issued_on, valid_until, status (`valid|expired|awaiting_new|superseded`), superseded_by_id, is_controlled (bool, controle especial), copies (int, número de vias), notes, uploaded_by_member_id
Situação (derivada, regra no domínio): 1) tem substituta → `superseded`; 2) tem pedido pendente → `awaiting_new`; 3) `issued_on + validade < hoje` → `expired`; 4) senão `valid` ("vence em X dias" se faltam ≤ 15); sem validade = `valid`.
**prescription_files**: family_id, prescription_id, storage_file_id (Appwrite Storage), page, mime, size
**prescription_items**: family_id, prescription_id, medication_id
**prescription_shares**: family_id, prescription_id, shared_by_member_id, channel (`internal|whatsapp`), target_member_id/target_phone, shared_at
**prescription_views**: family_id, prescription_id, member_id, viewed_at

## Reposição
**replenishments**: family_id, patient_id, medication_id, status (`needs_prescription|prescription_received|purchased|done|cancelled`), triggered_by (`low_stock|prescription_expiry|manual`), opened_at, closed_at
**replenishment_steps**: family_id, replenishment_id, step, owner_member_id, done_at, note, prescription_id, purchase_quantity

## Comunicação e auditoria
**notifications_outbox**: family_id, kind (`dose_reminder|dose_upcoming_family|dose_missed|low_stock|prescription_expiring|replenishment_update|reply`), target_member_id, payload (json), status (`queued|sending|sent|failed|dead`), attempts, next_attempt_at, last_error, dedupe_key (único)
**whatsapp_messages**: family_id, direction (`in|out`), provider_message_id (único), from_phone, member_id, type (`text|button|audio|image`), body_redacted, transcript, related_dose_event_id, received_at
**audit_log**: family_id, actor_member_id, action, entity, entity_id, at, meta (sem dados clínicos em texto livre)

## Cálculos centrais (implementados em `packages/domain`)
- `generateDoseEvents(treatment, phases, date)` → lista idempotente de doses do dia.
- `balance(stockItem)` → soma dos movimentos.
- `forecastDepletion(stockItem, treatment, phases, from)` → data estimada de término, percorrendo as fases futuras e a quantidade por dia de cada uma; retorna também `daysLeft` e `confidence` (baixa para colírio/estimativa).
- `lowStockStatus(daysLeft, thresholdDays)` → `ok|attention|critical`.
- `resolveResponsible(patient, datetime)` → membros que recebem o lembrete.
