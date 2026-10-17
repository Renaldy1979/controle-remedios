# @medcuidar/web

Painel do MedCuidar (Next.js App Router, TypeScript, Tailwind). Interface em pt-BR.

```bash
pnpm --filter @medcuidar/web dev          # mock, sem rede (padrão)
DATA_SOURCE=appwrite pnpm --filter @medcuidar/web dev   # dados reais (precisa do .env da raiz)
pnpm --filter @medcuidar/web test         # unidade + componente + axe
pnpm --filter @medcuidar/web e2e          # Playwright contra a família demo, canal falso
```

- Camada de dados: `src/data/` (interface única `DataSource`; `mock/` para testes e `/design-system`, `remote.ts` para o servidor).
- Servidor: `src/server/` (sessão do Appwrite Auth, permissões, retrato, Server Actions, URLs assinadas). Nada daqui vai ao cliente.
- Login: código de 6 dígitos no WhatsApp → sessão do Appwrite em cookie httpOnly; se o telefone está em mais de uma família, `/familia` pergunta qual.
- Catálogo de componentes: `/design-system`.
- Detalhes, variáveis de ambiente e decisões: `docs/handoffs/C-para-todos-painel-real.md`.
