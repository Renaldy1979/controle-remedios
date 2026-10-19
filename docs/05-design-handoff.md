> **Atenção:** o escopo foi redefinido em 19/10/2026. Onde este documento conflitar com `docs/06-escopo-v2.md`, vale o 06 (login por e-mail/senha no Appwrite, Postgres + Drizzle, API `/api/v1` + N8N com um fluxo por gatilho).

# 05 — Handoff do design

## Fonte do design (já importada)
- `design/design.md` — **especificação para implementar**: tokens claro/escuro, componentes, telas, regras de negócio e checklist de acessibilidade. Tokens e componentes vêm daqui; não há `docs/design-tokens.md` separado.
- `design/MedCuidar Design System/*.dc.html` — protótipos do Claude Design. `MedCuidar App.dc.html` é o app funcional de referência de **comportamento** (classe `Component`, dados de exemplo em `MEDS`, `PAT`, `RX0`, `PEOPLE`, `STEPS`). Não copiar o código `.dc.html` para o produto; ele serve para consulta.
- `design/MedCuidar Design System/uploads/` — imagem de referência visual.

## Como o agente C usa isto
1. Converter a seção 2 de `design.md` em `apps/web/src/styles/tokens.css` (variáveis CSS, tema claro e `[data-theme="dark"]`) e `tailwind.config`.
2. Implementar os componentes da seção 3 um a um, com catálogo/Storybook, antes das telas.
3. Implementar as telas da seção 5 e o layout da seção 4 (mobile abaixo de 900px com barra inferior de 5 abas; desktop com menu lateral de 256px).
4. Regras de exibição da seção 6 são **apresentação**; as regras de negócio oficiais ficam em `packages/domain` (D/B). Em divergência, vale `docs/` e o agente abre nota em `docs/handoffs/`.
5. Mensagens de WhatsApp (seção 5.8) viram textos-modelo em `packages/channels/templates` (agente D implementa, C não toca).

## Regras para o front
- Acessibilidade vence o visual: em conflito, seguir a acessibilidade e registrar o desvio.
- Estado nunca só por cor: cor + ícone + texto (tabela 2.3 de `design.md`).
- Ícones: Material Symbols Rounded. Fontes: Plus Jakarta Sans e Atkinson Hyperlegible Next. Carregar com `next/font` ou self-host, sem depender de CDN em produção.
- Dados fictícios da seção 7 de `design.md` viram o seed de desenvolvimento (agente A).

## Decisões do design que alteraram os docs (reconciliação)
Estas decisões já foram refletidas em `docs/01`, `02` e `03`:

| # | Decisão do design | Onde entrou |
|---|---|---|
| 1 | Login por **código de 6 dígitos enviado no WhatsApp** (fluxo próprio, não o OTP nativo do Appwrite) | RF0 em 01; `login_codes` em 02; fluxo em 03 |
| 2 | Avisos e compartilhamento também para o **grupo de WhatsApp da família** | `families.whatsapp_group_id` em 02; adaptador em 03 |
| 3 | Perfis padrão: Administrador, Familiar, Cuidadora, Confirmador (ex.: sogro); 11 permissões, incluindo as de receitas | 02 |
| 4 | Ações novas: Desfazer (8 s), Registrar que tomou depois, Lembrar em 15 min | RF2 em 01 |
| 5 | Atrasada após 15 min e esquecida após 2 h (ambos configuráveis); repetição 15/30/60 min; **resumo diário às 20:00** | 01, 02 |
| 6 | Receita com **controle especial (vias)** e remédio **sem receita** | 02 |
| 7 | Salvar receita nova **substitui** as vencidas/aguardando do mesmo paciente e avança a reposição | 03 |
| 8 | O paciente pode ser também quem confirma (Adelino confirma sozinho as doses da manhã) | 02 |
| 9 | Escala por **faixa de horário** (Rosa 6h–14h, Lúcia 14h–22h, Seu João à noite) | já em 02 (`care_assignments`) |
| 10 | Confirmação destrutiva exige digitar `REMOVER` quando afeta a escala | 01 |
| 11 | Upload de receita retomável, miniaturas reduzidas, URLs assinadas de curta duração | 03 |

## Checklist de fidelidade (E valida)
- [ ] Todas as telas do design existem, em mobile e desktop
- [ ] Claro e escuro
- [ ] Contraste AA medido
- [ ] Navegação por teclado e leitor de tela nas telas diárias
- [ ] Alvos de toque ≥ 44px
- [ ] Checklist da seção 8 de `design.md`
- [ ] Teste com zoom de 200%
