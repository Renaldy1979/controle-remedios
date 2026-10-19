# @medcuidar/web

Portal do MedCuidar (Next.js App Router, TypeScript, Tailwind). Interface em pt-BR. Lote 1: acesso e cadastros com **Postgres** (`@medcuidar/pg`, RLS por família) e **Appwrite Auth** (e-mail/senha).

```bash
pnpm db:up && pnpm db:migrate                       # Postgres local (raiz do repositório)
DATA_SOURCE=postgres APP_URL=http://localhost:3000 pnpm --filter @medcuidar/web dev   # portal real (usa APPWRITE_* do .env da raiz)
pnpm --filter @medcuidar/web dev                    # mock, sem rede nem login (padrão; só desenvolvimento)
pnpm --filter @medcuidar/web test                   # unidade + componente + axe + integração (esta é pulada sem o Postgres)
pnpm --filter @medcuidar/web e2e                    # Playwright: Postgres local + Appwrite do .env; apaga o que criou (prefixo zz-test-)
```

## Como funciona (Lote 1)
- **Dados:** `DATA_SOURCE=postgres`. Todo acesso passa por `withFamilia` (RLS). `src/server/pg/`:
  `access.ts` (sessão → membro → contexto), `snapshot.ts` (retrato para as telas), `members.ts` (convites, desativar), `patients.ts`, `medications.ts` (remédios e esquemas), `profiles.ts` (matriz), `families.ts` (primeira entrada), `actions.ts` (Server Actions das telas), `auth-actions.ts` (formulários de entrada).
- **Sessão:** segredo da sessão do **Appwrite Auth** em cookie `mc_session` (httpOnly, SameSite=Lax, Secure em produção), validado no Appwrite a cada requisição. O `familyId` vem **só** do membro (`resolve_member_by_appwrite_user`), nunca do cliente. A chave de API do Appwrite fica só no servidor (`src/server/auth/appwrite.ts`).
- **Permissões:** `can()` de `@medcuidar/shared`. A recusa acontece **no servidor** (`requirePermission` em toda função de negócio); a tela só esconde o que a pessoa não pode usar. O retrato enviado ao navegador já vem sem o que o perfil não vê.
- **Telas de entrada:** `src/app/(auth)/` — `login`, `criar-conta`, `verificar-email`, `criar-familia`, `esqueci-senha`, `redefinir-senha`, `aceitar-convite`. Tudo o mais exige sessão (`src/middleware.ts` + `requireContext`).
- **Camada de dados das telas:** `src/data/` (interface `DataSource`; `mock/` para testes e `/design-system`, `remote.ts` para o servidor). Doses, estoque, receitas e histórico **não existem** nesta origem (Lotes 2 e 3): as telas mostram "chega no próximo lote".
- **Saúde:** `GET /api/health` (sem dados sensíveis). **Imagem Docker:** `Dockerfile` na raiz; deploy em `docs/09-deploy-staging.md`.
- Catálogo de componentes: `/design-system`.

## Legado (a remover nos Lotes 2 a 4)
`src/server/{actions,mutations,snapshot,context,data,services,clients,session,auth-actions,files}.ts` e seus testes são a camada antiga (Appwrite Databases + login por código de WhatsApp). **Não estão ligados** ao portal do Lote 1 (ficam só como referência para portar doses, estoque e receitas) e saem junto com `packages/db`, `apps/functions` e `packages/channels`. O e2e antigo (família demo no Appwrite) foi aposentado; o do Lote 1 é `e2e/lote1.spec.ts`.

Variáveis de ambiente do portal e passo a passo de staging: `docs/09-deploy-staging.md` e `.env.example`.
