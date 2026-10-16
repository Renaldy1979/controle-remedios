# 05 — Handoff do design

O design é gerado no Claude Design. Quando terminar:

1. Salvar o arquivo exportado em `design/design.md` (e imagens/protótipos em `design/assets/`).
2. O Orquestrador lê `design/design.md` e cria `docs/design-tokens.md` com: cores (marca, neutras, estados), tipografia, espaçamento, raios, sombras, e a lista de componentes e telas.
3. O agente C converte os tokens em `apps/web/tailwind.config` + `apps/web/src/styles/tokens.css` (variáveis CSS, claro e escuro) e implementa os componentes um a um.

## Regras para o front
- O `design/design.md` manda no visual; se algo conflitar com acessibilidade (contraste, alvo de toque, texto mínimo), vale a acessibilidade e o agente registra o desvio em `docs/handoffs/`.
- Estados de dose e estoque usam os tokens semânticos (tomada, pendente, atrasada, esquecida; ok, atenção, crítico), sempre com ícone e texto.
- Telas previstas: Início, Pacientes, Histórico de doses, Receitas (lista, anexar, detalhe, compartilhar), Reposição, Configurações (remédios, esquemas, estoque, usuários, perfis, avisos), login e estados vazios/erro/carregando.
- Mensagens de WhatsApp desenhadas no design viram os textos-modelo em `packages/channels/templates` (D implementa, C não toca).

## Checklist de fidelidade (E valida)
- [ ] Todas as telas do design existem, em mobile e desktop
- [ ] Claro e escuro
- [ ] Contraste AA medido
- [ ] Navegação por teclado e leitor de tela nas telas diárias
- [ ] Alvos de toque ≥ 44px
