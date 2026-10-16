# Prompt — Agente B: Domínio

Leia `CLAUDE.md`, `docs/01`, `docs/02`, `docs/03`. Você é dono de `packages/domain`. Código **puro** (sem I/O direto; recebe repositórios por interface), 100% testável, usando os tipos de `packages/shared`.

## Funções a entregar
- `generateDoseEvents(treatment, phases, date, tz)`: doses do dia, idempotentes, respeitando fase por dia do tratamento, intervalo em horas ou horários fixos, virada de dia e fuso.
- `confirmDose(...)`: marca como tomada, cria o movimento de estoque (único por dose), recusa duplicidade, registra quem e por qual canal.
- `markLateAndMissed(now, settings)`.
- `balance(movements)` e `applyAdjustment(...)`.
- `forecastDepletion(stockItem, treatment, phases, from)`: percorre as fases futuras somando consumo por dia; retorna `{ depletionDate, daysLeft, confidence }`; confiança baixa para estimativa (gotas).
- `lowStockStatus(daysLeft, threshold)`.
- `resolveResponsible(assignments, datetime)` com prioridade e fallback para a família.
- Reposição: `openReplenishment`, `advanceReplenishment` (assumir etapa, concluir, cancelar), sem duas pessoas na mesma etapa.
- Receitas: `prescriptionStatus(issuedOn, validUntil, today)`, `isCoverageValid(treatment, prescriptions)`.

## Testes obrigatórios
- Fases encadeadas: 3 em 3 h dias 1–15, 6 em 6 h dias 16–20; borda do dia 15→16.
- Fase final "até acabar".
- Previsão que atravessa mudança de fase.
- Colírio: 20 gotas/ml, frasco de 5 ml, 2 gotas por dose.
- Mesma confirmação enviada duas vezes desconta uma vez.
- Ajuste manual muda o saldo e a previsão.
- Mudança de horário de verão/fuso não duplica nem pula doses.
- Sem cobertura de escala cai na família.

## Critérios de pronto
Cobertura de testes alta nas regras acima, sem dependência de Appwrite, documentação das funções públicas em `packages/domain/README.md`. Se precisar de campo novo no modelo, peça via `docs/handoffs/`.
