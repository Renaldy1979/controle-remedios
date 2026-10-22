> **Atualização de 22/10/2026 (Lote 4B):** o N8N foi removido. O WhatsApp roda direto no portal (webhook → fila no Postgres → worker → núcleo da conversa → provedor). Onde este documento falar de N8N, workflows ou `integrations/n8n`, vale `docs/06-escopo-v2.md` (seção 5) e `docs/11-whatsapp-direto.md`.

> **Atenção:** o escopo foi redefinido em 19/10/2026. Onde este documento conflitar com `docs/06-escopo-v2.md`, vale o 06 (login por e-mail/senha no Appwrite, Postgres + Drizzle, API `/api/v1` + N8N com um fluxo por gatilho).

# 04 — Plano de orquestração

Objetivo: vários agentes especializados trabalhando em paralelo **sem pisar um no outro**, todos presos aos mesmos documentos. Vale tanto para sessões do Claude Code quanto para agentes no Maestri.

## Princípio
**Contratos primeiro, depois paralelo.** Os tipos (`packages/shared`) e o modelo (`docs/02`) são o contrato. Só com o contrato fechado os agentes B, C e D rodam ao mesmo tempo.

## Agentes e pastas (cada um só edita o que é seu)
| Agente | Responsabilidade | Pastas que edita |
|---|---|---|
| **Orquestrador** | divide, revisa, integra, mantém docs e o quadro de status | `docs/`, `CLAUDE.md`, `docs/handoffs/` |
| **A — Fundação** | scaffold do monorepo, CI, Appwrite (coleções, permissões por Team, Storage), auth, multi-tenant, tipos e zod | `scripts/appwrite`, `packages/shared`, configs raiz, `.env.example` |
| **B — Domínio** | geração de doses, livro-razão, previsão de término, escala, regras de reposição; tudo puro e testado | `packages/domain` |
| **C — Frontend** | design system em Tailwind a partir de `design/design.md`, telas, formulários, upload de receitas, acessibilidade | `apps/web` |
| **D — Integrações** | adaptador de canal, Evolution, workflows N8N, webhook de entrada, outbox/worker, agendador, transcrição | `packages/channels`, `integrations/n8n`, `apps/functions` |
| **E — Qualidade e segurança** | revisão, testes e2e, LGPD, isolamento entre famílias, carga do agendador | `tests/`, relatórios em `docs/reviews/` |

Regra de fronteira: precisa de algo fora da sua pasta → escreve `docs/handoffs/<de>-para-<para>-<tema>.md` com o pedido; o dono atende.

## Fases e portões
**Fase 0 — Decisões (humano + Orquestrador).** Fechar as premissas de `docs/01` e importar `design/design.md`. *Portão:* premissas respondidas.

**Fase 1 — Fundação (A, sozinho).** Monorepo, Appwrite local via Docker, coleções de `docs/02` por script idempotente, Auth + Teams, tipos/zod gerados do modelo, CI (lint, tipos, testes). *Portão:* `pnpm test` verde; script cria o schema do zero; teste prova que a família X não lê dados da família Y.

**Fase 2 — Paralelo (B ∥ C ∥ D).**
- B: `generateDoseEvents`, `balance`, `forecastDepletion`, `lowStockStatus`, `resolveResponsible`, `confirmDose`. Casos obrigatórios: fases encadeadas (3h dias 1–15, 6h dias 16–20), fase "até acabar", colírio em gotas, virada de dia/fuso, confirmação duplicada, ajuste manual.
- C: tokens e componentes → Início → Pacientes → Histórico → Receitas → Configurações. Usa dados mockados tipados até B/D existirem.
- D: adaptador + Evolution em ambiente de teste, outbox com retentativa, webhook idempotente, agendador, N8N.
*Portão:* cada agente com testes verdes e doc atualizado.

**Fase 3 — Integração (Orquestrador + A).** Trocar mocks do front pelas funções reais; fluxo ponta a ponta: lembrete → "Tomei" → estoque desconta → alerta de estoque baixo → reposição. *Portão:* roteiro e2e do Playwright + roteiro manual com número de teste.

**Fase 4 — Qualidade (E).** Revisão de segurança/LGPD, teste de falhas (Evolution fora do ar, webhook repetido, agendador parado), acessibilidade, performance mobile. *Portão:* sem achados críticos abertos.

**Fase 5 — Piloto.** Subir no EasyPanel; usar com a família 2 semanas, com uma pessoa conferindo o papel ao lado; ajustar. Só então migrar para a API oficial da Meta e pensar em SaaS.

## Quadro de status (o Orquestrador mantém em `docs/status.md`)
Colunas: tarefa · agente · fase · estado (`pendente|fazendo|revisão|pronto`) · bloqueio.

## Definição de pronto (todo agente)
1. Critério da tarefa atendido e **testado** (unidade ou e2e).
2. Lint e tipos limpos.
3. Doc afetado atualizado (`docs/02` se tocou em dados).
4. Nenhum segredo, nenhum dado pessoal em log.
5. Nota curta em `docs/handoffs/` se algum outro agente precisa saber de algo.

## Como rodar
**Aqui (Claude Code desktop):** o Orquestrador é esta sessão; cada agente é uma sessão filha com o prompt de `prompts/`. Fases 1 e 3 sequenciais; fase 2 com três sessões em worktrees separados (pastas diferentes, sem conflito). Eu reviso cada entrega antes de seguir.
**Maestri:** um terminal por agente no canvas, cada um com o prompt do seu arquivo em `prompts/`, todos apontando para a mesma pasta/repo. A coordenação é a mesma; muda só onde você acompanha.

## Riscos conhecidos
- Previsão de colírio é estimativa: sempre mostrar confiança e permitir ajuste.
- Confirmação ambígua por áudio/texto: nunca adivinhar, perguntar com botões.
- Ban do número na Evolution: usar número dedicado, volume baixo, respostas só a quem conversou; manter o adaptador trocável.
- Escala incompleta: sem cobertura o lembrete cai para a família, nunca some.
