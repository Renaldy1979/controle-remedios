# MedCuidar — guia para qualquer agente Claude

Sistema multifamília para controlar remédios de idosos: lembretes e confirmação de doses pelo WhatsApp, estoque com previsão de término, receitas com histórico e fluxo de reposição. Primeiro uso real: os sogros do dono (Adelino e Maria; Maria tem Alzheimer e não usa celular).

## Leia antes de qualquer tarefa
1. `docs/01-visao-e-requisitos.md` — o que construir e por quê
2. `docs/02-banco-de-dados.md` — modelo de dados (fonte da verdade)
3. `docs/03-arquitetura-e-integracoes.md` — como as peças conversam
4. `docs/04-plano-de-orquestracao.md` — quem faz o quê, em que ordem, dono de cada pasta
5. `docs/05-design-handoff.md` + `design/design.md` — tokens e telas (quando existir)

Se um documento e o código divergirem, **pare e avise** em vez de decidir sozinho. Mudanças de contrato (dados, tipos, API) são feitas no documento primeiro.

## Stack
Next.js (App Router) + TypeScript + Tailwind · Appwrite (Auth, Databases, Storage, Functions) · N8N (automação) · Evolution API (WhatsApp, trocável pela API oficial Meta) · EasyPanel numa VPS. Testes: Vitest; e2e: Playwright.

## Regras inegociáveis
- **Multifamília desde o início.** Todo registro tem `family_id`; toda consulta filtra por ele; permissões do Appwrite por Team. Nunca vazar dado entre famílias.
- **Dados de saúde (LGPD).** Sem dados pessoais em logs. Arquivos de receita só com URL assinada/permissão. Auditar acesso e exclusão.
- **Estoque é livro-razão.** Saldo = soma de `stock_movements`. Nunca só decrementar um contador. Ajuste manual vira movimento do tipo `adjustment`.
- **Fuso:** `America/Sao_Paulo`. Guardar UTC, exibir local. Horário 24h, datas dd/mm/aaaa.
- **Idempotência:** confirmação de dose e webhooks do WhatsApp podem chegar repetidos; a mesma mensagem nunca desconta duas vezes.
- **Canal de WhatsApp é adaptador** (`packages/channels`). Nenhuma regra de negócio conhece Evolution diretamente.
- **Acessibilidade:** alvos de toque ≥ 44px, contraste AA+, estado nunca só por cor, texto base ≥ 16px.
- **Interface em pt-BR.** Código e nomes técnicos em inglês.
- Estoque de colírio é **estimativa** (gotas por ml configurável); a UI sempre sinaliza isso.

## Convenções
- Monorepo: `apps/web`, `packages/domain`, `packages/shared`, `packages/channels`, `integrations/n8n`, `scripts/appwrite`, `docs`, `design`.
- Cada agente só edita as pastas que o plano lhe atribui. Mudou fora da sua pasta? Abra uma nota em `docs/handoffs/` em vez de editar.
- Commits pequenos e em português, formato `tipo(escopo): descrição`.
- Nenhuma tarefa termina sem testes do que mudou e sem atualizar o doc afetado.
- Segredos só em variáveis de ambiente; `.env.example` sempre atualizado.
