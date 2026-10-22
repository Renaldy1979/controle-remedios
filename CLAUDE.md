# MedCuidar — guia para qualquer agente Claude

Sistema multifamília para controlar remédios de idosos: lembretes e confirmação de doses pelo WhatsApp, estoque com previsão de término, receitas com histórico e fluxo de reposição. Primeiro uso real: os sogros do dono (Adelino e Maria; Maria tem Alzheimer e não usa celular).

## Leia antes de qualquer tarefa
0. **`docs/06-escopo-v2.md` — fonte da verdade (19/10/2026). Onde conflitar com os docs 01 a 05, vale o 06.**
1. `docs/01-visao-e-requisitos.md` — o que construir e por quê
2. `docs/02-banco-de-dados.md` — modelo de dados (fonte da verdade)
3. `docs/03-arquitetura-e-integracoes.md` — como as peças conversam
4. `docs/04-plano-de-orquestracao.md` — quem faz o quê, em que ordem, dono de cada pasta
5. `docs/05-design-handoff.md` + `design/design.md` — tokens e telas (quando existir)

Se um documento e o código divergirem, **pare e avise** em vez de decidir sozinho. Mudanças de contrato (dados, tipos, API) são feitas no documento primeiro.

## Stack
Next.js (App Router) + TypeScript + Tailwind · **Postgres + Drizzle** (dados, RLS por família) · **Appwrite só para Auth (e-mail/senha) e bucket de receitas/anexos** · API pública `/api/v1` no Next.js · **WhatsApp direto no portal, sem N8N** (webhook + fila no Postgres + worker; núcleo da conversa em código; Claude via Messages API só para perguntas livres, com ferramentas de leitura; Gemini para áudio/imagem) · Evolution Go (provedor atrás de interface; trocável pela API oficial da Meta) · EasyPanel numa VPS. Testes: Vitest; e2e: Playwright.
Padrão de referência: projeto `controle-financeiro` do dono (`withFamilia`, `rota()`, chaves cdf_, Idempotency-Key, OpenAPI; lote AG1 = conversa do agente dentro do app, sem N8N).

## Regras inegociáveis
- **Multifamília desde o início.** Todo registro tem `family_id`; todo acesso a dados passa por `withFamilia` e o **RLS do Postgres** isola as famílias. Nunca vazar dado entre famílias.
- **WhatsApp só para número verificado.** Usuário sem número verificado não recebe nem é atendido pelo WhatsApp; o portal funciona normalmente. A identidade vem do remetente real, nunca de parâmetro escolhido por IA. Confirmar dose nunca passa por IA.
- **Dados de saúde (LGPD).** Sem dados pessoais em logs. Arquivos de receita só com URL assinada/permissão. Auditar acesso e exclusão.
- **Estoque é livro-razão.** Saldo = soma de `stock_movements`. Nunca só decrementar um contador. Ajuste manual vira movimento do tipo `adjustment`.
- **Fuso:** `America/Sao_Paulo`. Guardar UTC, exibir local. Horário 24h, datas dd/mm/aaaa.
- **Idempotência:** confirmação de dose e webhooks do WhatsApp podem chegar repetidos; a mesma mensagem nunca desconta duas vezes.
- **Provedor de WhatsApp atrás de interface.** Nada de Evolution/Meta fora do módulo do provedor. O agente de IA só lê (ferramentas em processo dentro de `withFamilia`, com as permissões do membro); confirmar dose, desfazer e qualquer escrita nunca passam pelo modelo.
- **Acessibilidade:** alvos de toque ≥ 44px, contraste AA+, estado nunca só por cor, texto base ≥ 16px.
- **Interface em pt-BR.** Código e nomes técnicos em inglês.
- Estoque de colírio é **estimativa** (gotas por ml configurável); a UI sempre sinaliza isso.

## Entrega por lotes (`docs/08-lotes.md`)
- Cada lote termina com algo **testável pelo dono** em staging, com roteiro em `docs/lotes/L<n>-roteiro.md`. O lote só está pronto com testes verdes, conferência do orquestrador **e validação do dono** registrada em `docs/lotes/L<n>-validacao.md`. Não comece o lote seguinte sem o "validado".

## Convenções
- Monorepo: `apps/web` (portal + API `/api/v1`), `packages/domain`, `packages/shared`, `packages/pg` (`@medcuidar/pg`: Postgres + Drizzle + RLS), `docs`, `design`. O legado do escopo v1 (`apps/functions`, `packages/channels`, `packages/db`, `scripts/appwrite`) foi removido no Lote 4B (`docs/handoffs/L4B-limpeza.md`).
- Cada agente só edita as pastas que o plano lhe atribui. Mudou fora da sua pasta? Abra uma nota em `docs/handoffs/` em vez de editar.
- Commits pequenos e em português, formato `tipo(escopo): descrição`.
- Nenhuma tarefa termina sem testes do que mudou e sem atualizar o doc afetado.
- Segredos só em variáveis de ambiente; `.env.example` sempre atualizado.
