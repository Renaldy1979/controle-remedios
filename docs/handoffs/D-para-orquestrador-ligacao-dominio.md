# Integrações (D) → Orquestrador: ligação com `@medcuidar/domain`

Estado: Fase 2 do agente D concluída (aguardando revisão). Tudo roda hoje com **domínio falso** (`apps/functions/src/testing/fake-domain.ts`) e canal falso. Nada foi enviado a número real nem gravado no Appwrite de produção.

## O que ligar (Fase 3)
Interface: `DomainPort` em [`apps/functions/src/ports.ts`](../../apps/functions/src/ports.ts). Ligação: preencher `unwiredDomain` em [`apps/functions/src/domain-binding.ts`](../../apps/functions/src/domain-binding.ts) (hoje cada método lança "Domínio não ligado") e passar via `createRuntime(env, { domain })`. O domínio recebe `familyId` e deve montar seu próprio `FamilyScopedDb` (ou receber a fábrica `dataFor`).

| Método da porta | Função esperada do domínio | Quem chama | Contrato que o teste assume |
|---|---|---|---|
| `generateDoseEvents({familyId,date})` | `generateDoseEvents` por tratamento ativo do dia local | agendador, a cada 15 min | idempotente (índice único `treatment_id+scheduled_at`); devolve `{created}` |
| `resolveResponsible({familyId,patientId,at})` | `resolveResponsible` | agendador (lembrete, esquecida) | devolve **ids de membros**; já aplica escala, `reminder_recipients_mode` e a queda para a família quando não há cobertura |
| `classifyDoseTiming({status,scheduledAt,now,lateAfterMin,missedAfterMin})` | regra pending→late→missed | agendador | pura; o agendador persiste a mudança de status |
| `confirmDose({familyId,doseEventId,memberId,channel,sourceMessageId})` | `confirmDose` | webhook (botão/texto/áudio) | **idempotente por `sourceMessageId`** (e por dose): repetição devolve `already_confirmed`/`already_taken`, nunca um 2º `stock_movement`. Desfecho `confirmed\|already_confirmed\|already_taken\|not_found\|forbidden`; devolver `patientId`/`medicationId` evita uma leitura |
| `checkLowStock({familyId,patientId?,medicationId?})` | `forecastDepletion` + `lowStockStatus` + abrir/atualizar `replenishment` | agendador (a cada 30 min, família toda) e webhook (logo após cada dose confirmada, só o remédio da dose) | devolve os itens em `attention`/`critical` **com a reposição já criada**; pode devolver os mesmos a cada chamada: o aviso é deduplicado por `low_stock:<replenishmentId>:<nível>` |
| `stockOverview({familyId,patientId?})` | previsão por item | consulta "estoque", resumo diário | `level` ok/attention/critical (≤7 crítico, 8–14 atenção); `isEstimate` para colírio |
| `findExpiringPrescriptions({familyId,today})` | situação da receita (docs/02) | agendador, a cada 30 min | receitas vigentes que vencem em ≤ 15 dias; o agendador avisa nos limiares 15/7/3/0 dias |
| `claimReplenishment({familyId,replenishmentId,memberId})` | assumir etapa (`owner`) | botão "Eu cuido disso" | `claimed` \| `taken_by_other` \| `not_found` |
| `getPrescriptionForSharing({familyId,memberId,replenishmentId?,prescriptionId?})` | receita vigente do remédio + **URL assinada de curta duração** | botões "Ver receita"/"Baixar" | `null` se não houver/sem acesso. O webhook já exige `prescriptions.view` + `prescriptions.share` e grava `prescription_shares` + `audit_log` |

Também falta ligar `AuthPort.createSessionFor` (`unwiredAuth`): token customizado do Appwrite Auth (`Users.createToken`) para o telefone já validado pelo login por código.

## Ordem sugerida
1. Implementar `DomainPort` sobre `@medcuidar/domain` e rodar `pnpm --filter @medcuidar/functions test` trocando `FakeDomain` por ele (os testes em `flow.test.ts`/`scheduler.test.ts` documentam o comportamento esperado).
2. `createRuntime` com `{ domain, auth }`; publicar as Functions de `apps/functions/src/entries/` (`scheduler` com cron `* * * * *`, `whatsapp-inbound`, `login-code`).
3. Importar os workflows de `integrations/n8n` (ver README lá) e apontar a Evolution de **teste** para o N8N.
4. Roteiro manual com número de teste (nunca o número real dos pacientes).

## Divergências e decisões a confirmar
- **Botão "Ele já tomou"** (design 5.8) virou **"Já tomou"**: não conhecemos o gênero do paciente e o rótulo cabe em 20 caracteres. Ação é a mesma (confirmar a dose em nome do paciente).
- **"Ligar"**: botão do tipo `call` (Evolution) com o telefone do primeiro responsável que tiver número; omitido se ninguém tiver.
- **`dose_upcoming_family`** (aviso de dose *próxima* à família) existe no enum, mas **não é gerado**: o prompt pede só o aviso de dose esquecida e não há configuração que diga quando avisar. Falta decidir a regra.
- **Heartbeat** não tem coleção própria: o agendador faz ping HTTP em `HEARTBEAT_URL` (monitor de push externo) e alerta o administrador por N8N → e-mail (`ALERTS_WEBHOOK_URL`). Alertas contêm só ids/contagens.
- **`login_codes`** não tem `created_at`: usamos o `$createdAt` do Appwrite para intervalo mínimo (60 s) e limite por hora (5).
- **Código de login na outbox**: fica *selado* (AES-GCM, `LOGIN_CODE_SECRET`) até o envio e é zerado depois; só o HMAC fica em `login_codes`.
- **`dead` com `last_error` iniciando em `obsolete:`**: lembrete de dose que já foi tomada/pulada enquanto esperava na fila (ex.: Evolution fora do ar por horas) é descartado sem alertar o administrador. É um uso do estado `dead` — sugiro um estado/motivo próprio se o painel for contar `dead`.
- **`dedupe_key`** é gravado com prefixo da família (`<familyId>:<chave>`), pois o índice único é global.
- **Telefone em mais de uma família**: texto livre de quem pertence a 2+ famílias é **ignorado** (não adivinhamos); botões resolvem a família pelo id embutido (`mc1:<ação>:<familyId>:<ref>`). Se isso virar caso real, precisa de um passo "qual família?".
- **Receita pelo WhatsApp** sempre vai em conversa privada (nunca ao grupo), exige `prescriptions.view`+`prescriptions.share` (Cuidadora não tem `share` no perfil padrão) e é auditada.
- **Foto de receita recebida**: fase 2 do produto; hoje responde "ainda não consigo receber fotos; use o painel".

## Atualizações de documentação que cabem ao Orquestrador (docs/03)
- Contrato do webhook: corpo `{provider,payload}` + cabeçalho `x-medcuidar-signature: sha256=<HMAC-SHA256 do corpo>`; respostas 200 neutra / 401 / 500 (N8N repete).
- Formato de ID de botão `mc1:<ação>:<familyId>:<ref>`.
- Heartbeat por push HTTP e alertas operacionais (acima).
- Cadência do agendador: geração de doses a cada 15 min; estoque/receitas a cada 30 min e após cada confirmação; resumo na janela de 3 h após `daily_summary_time` com dedupe.
- Retentativa: backoff 30 s ×2 até 30 min, `dead` após 8 tentativas ou erro definitivo (4xx); 3 falhas retentáveis seguidas = "provedor fora do ar" (para o lote e alerta).

## Riscos conhecidos
- **Botões na Evolution (Baileys)**: mensagens com botões interativos não são suportadas de forma estável em contas não oficiais e podem não aparecer no aparelho. O adaptador está isolado (`packages/channels/src/evolution.ts`); se falhar no teste real, a saída é lista/enquete ou texto "responda 1/2". Validar cedo com o número de teste.
- Os JSONs do N8N foram escritos à mão e **não foram importados numa instância real**.
- A outbox usa "reivindicar com lease" (status `sending` + `next_attempt_at`), sem compare-and-swap (Appwrite 1.8 não tem): rodar **uma só instância** do worker por vez.
