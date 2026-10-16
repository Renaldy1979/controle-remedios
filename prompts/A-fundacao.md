# Prompt — Agente A: Fundação

Leia `CLAUDE.md` e `docs/01` a `docs/04`. Você é dono de: `scripts/appwrite`, `packages/shared`, configs da raiz, `.env.example`, CI.

## Entregas
1. Monorepo (pnpm workspaces) com `apps/web`, `packages/{domain,shared,channels}`, `integrations/n8n`, `scripts/appwrite`, `tests`.
2. Docker Compose local com Appwrite para desenvolvimento.
3. Script **idempotente** que cria todas as coleções, atributos, índices (incluindo os únicos) e permissões de `docs/02`. Rodar duas vezes não quebra nada.
4. Auth e multi-tenant: família = Team; convite de membros; função que resolve `family_id` do usuário logado.
5. `packages/shared`: tipos TypeScript e schemas zod de todas as entidades, enums e as chaves de permissão. Exportar helper `can(member, permission)`.
6. CI: lint, checagem de tipos e testes.
7. Seed de desenvolvimento: uma família com Adelino e Maria, remédios de exemplo (Zypred em gotas, um comprimido, um líquido), uma escala, tratamento com duas fases (3h dias 1–15, 6h dias 16–20).

## Critérios de pronto
- Schema criado do zero por um comando.
- Teste automatizado prova isolamento: usuário da família X não lê nem escreve dados da família Y.
- Tipos e documento `docs/02` batem (qualquer divergência corrigida no doc ou no código, nunca ignorada).
- `.env.example` completo e sem segredos.

Ao terminar, escreva `docs/handoffs/A-para-todos-contratos.md` com como importar tipos, rodar o schema e subir o ambiente.
