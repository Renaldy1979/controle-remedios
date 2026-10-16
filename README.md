# MedCuidar (controle-remedios)

Sistema multifamília para controlar remédios de idosos: lembretes e confirmação de doses pelo WhatsApp, estoque com previsão de término, receitas com histórico e fluxo de reposição.

## Status
- Planejamento e design: concluídos (`docs/`, `design/`).
- Fase 1 (Fundação): concluída. Monorepo, `packages/shared`, `packages/db`, schema e seed no Appwrite.
- Próximas: Fase 2 em paralelo (domínio, frontend, integrações). Ver `docs/04-plano-de-orquestracao.md`.

## Começar
```bash
corepack enable
pnpm install
cp .env.example .env   # preencha com as credenciais do Appwrite
pnpm test
```

Comece por `CLAUDE.md` e pela pasta `docs/`. Notas de Fundação em `docs/handoffs/A-para-todos-contratos.md`.
