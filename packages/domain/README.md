# @medcuidar/domain

Regras de negócio do MedCuidar. Código **puro**: sem Appwrite, sem rede, sem `Date.now()` (o "agora" entra por parâmetro). Persistência entra por interfaces (`ConfirmDoseRepo`). Fuso padrão `America/Sao_Paulo`; datas locais são `YYYY-MM-DD`, instantes são ISO UTC.

```ts
import { generateDoseEvents, forecastDepletion } from "@medcuidar/domain";
```

## Funções públicas

| Função | O que faz |
|---|---|
| `generateDoseEvents(treatment, phases, date, tz?, existing?)` | Doses do dia local. Fase pelo dia do tratamento (1-based). `interval`: a partir de `first_dose_time`, a cada N horas **reais** enquanto ainda for o mesmo dia local (3 h desde 06:00 → 06,09,…,21). `fixed_times`: horários de parede. Idempotente; `existing` descarta o que já foi gravado; `key = treatment_id\|scheduled_at` espelha o índice único. Horário de verão não duplica nem pula doses. |
| `confirmDose(repo, input)` | Idempotente por `source_message_id` e por status. Ordem: movimento `dose` (único por `dose_event_id`) → dose `taken`; retomar após falha não duplica. Retorna `confirmed \| duplicate \| not_found \| not_confirmable`. Aceita confirmar dose `late`/`missed`. |
| `markLateAndMissed(now, settings, doses)` | Lista de mudanças: `pending→late` após `late_after_min`; `pending/late→missed` após `missed_after_min` (com `notifyFamily`). |
| `balance(movements)` / `applyAdjustment(movements, input)` | Saldo = soma; ajuste manual gera o movimento `adjustment` com a diferença (ou `null` se nada muda). |
| `forecastDepletion(stock, treatment, phases, from, tz?)` | Percorre dia a dia com o consumo da fase de cada dia. Retorna `{ depletionDate, daysLeft, coversUntilEnd, confidence }`. `daysLeft` = dias inteiros cobertos contando hoje (= `floor(estoque / consumo diário)` numa fase única). `confidence: "low"` se `is_estimate`. Sem fim previsto (cobre até o fim do tratamento) → datas `null`. |
| `lowStockStatus(daysLeft, threshold = 7)` | `≤ limite` crítico, `≤ 2×limite` atenção, senão ok (7 → 7/14). |
| `resolveResponsible({ assignments, members, mode, datetime, tz? })` | Escala por faixa de horário (aceita faixa noturna), prioridade crescente. Modos `all_members`, `assignments_only`, `assignments_plus_family`; sem cobertura → membros com `receives_family_alerts` (`usedFamilyFallback`). Só membros ativos. `effectiveRecipientsMode` aplica o override do paciente. |
| `openReplenishment`, `advanceReplenishment`, `currentStep`, `stepState`, `purchaseQuantity` | 4 etapas. `claim` recusa se outra pessoa já assumiu (`takeOver` = "Assumir no lugar"); `complete` só do dono; etapa 3 exige quantidade; sem receita as etapas 1–2 ficam `not_applicable`. Estado puro, devolvido novo a cada passo. |
| `prescriptionStatus(issuedOn, validUntil, today, opts)` | Ordem: substituída → aguardando → vencida → vigente (`expiringSoon` se faltam ≤ 15 dias; sem validade = vigente). |
| `isCoverageValid`, `medicationPrescriptionState`, `prescriptionsToSupersede` | Cobertura do tratamento, estado por remédio (vigente mais recente → aguardando → não precisa → vencida → sem receita) e quais receitas a nova substitui. |

## Decisões

- `doses por dia` de uma fase de intervalo depende de `first_dose_time` (3 h desde 00:00 = 8/dia; desde 06:00 = 6/dia).
- O pacote não decide o `drops_per_ml`: o chamador converte o saldo do colírio para gotas (`ml × drops_per_ml`) antes de prever.
- Persistência fica fora: quem chama grava o movimento de compra (`purchaseQuantity`) ao fechar a reposição e as mudanças de `prescriptionsToSupersede`.

## Comandos

```bash
pnpm --filter @medcuidar/domain test
pnpm --filter @medcuidar/domain typecheck
```
