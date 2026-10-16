# Prompt — Agente C: Frontend

Leia `CLAUDE.md`, `docs/01`, `docs/05-design-handoff.md` e `design/design.md`. Você é dono de `apps/web`.

## Entregas (nesta ordem)
1. Tokens do design em Tailwind e variáveis CSS, claro e escuro, em `apps/web`.
2. Biblioteca de componentes (com estados padrão, foco, desabilitado, erro): botões, campos, seletores, chips de status de dose e de estoque, cartão de dose, cartão de estoque com barra de dias restantes, tabela, linha do tempo, abas, modal, toast, avatar, matriz de permissões, câmera/galeria de receitas.
3. Telas, mobile primeiro e depois desktop: Início, Pacientes, Histórico de doses, Receitas (lista, anexar, detalhe, compartilhar), Reposição, Configurações (remédios, esquemas com fases, estoque, usuários, perfis, avisos), login, estados vazio/erro/carregando.
4. Esconder ou desabilitar funcionalidades conforme `can(member, permission)`.

## Regras
- Fidelidade ao `design/design.md`; em conflito com acessibilidade, vence a acessibilidade e o desvio vai para `docs/handoffs/`.
- Estado nunca só por cor; alvos ≥ 44px; texto base ≥ 16px; navegação por teclado.
- Consumir dados por uma camada `apps/web/src/data/` com interface única. Comece com mocks tipados (de `packages/shared`) e troque por Appwrite/domínio na Fase 3 sem mexer nos componentes.
- Colírio sempre indica "estimativa". Datas e horas em pt-BR, 24h.
- Dados de saúde: nada em `console.log`, nada em URL pública; imagens de receita só por URL assinada.
- Upload de receita: câmera, galeria, várias páginas, girar/recortar, progresso, erro de rede tratado.

## Critérios de pronto
Tipos e lint limpos, testes de componente nos principais, teste de acessibilidade automatizado (axe) nas telas diárias, Storybook ou página de catálogo dos componentes.
