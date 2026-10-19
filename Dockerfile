# syntax=docker/dockerfile:1
#
# MedCuidar — portal (apps/web) para o staging no EasyPanel. Passo a passo em docs/09-deploy-staging.md.
#   docker build -t medcuidar-web .
# Três estágios: instala dependências -> compila (Next.js em modo "standalone") -> imagem final enxuta,
# sem ferramentas de build, rodando como usuário comum (não-root).

ARG NODE_VERSION=22

# ---------- 1) dependências ----------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --filter @medcuidar/web...

# ---------- 2) compilação ----------
FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone
RUN pnpm --filter @medcuidar/web build
# Ferramenta de migrações: só o necessário (postgres + drizzle-orm) e os arquivos .sql. Roda com o papel DONO, à mão.
RUN mkdir -p /migrate && cp -r packages/pg/drizzle /migrate/drizzle && cp apps/web/scripts/migrate.mjs /migrate/migrate.mjs \
 && cd /migrate && printf '{"name":"medcuidar-migrate","private":true,"type":"module"}' > package.json \
 && npm install --omit=dev --no-audit --no-fund postgres@3.4.9 drizzle-orm@0.36.4

# ---------- 3) imagem final ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_SOURCE=postgres \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app
# O Next.js "standalone" já traz o servidor e só as dependências que o portal usa.
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /migrate /app/migrate
USER app
EXPOSE 3000
# O EasyPanel mostra o serviço como saudável quando /api/health responde 200 (processo no ar e banco conectado).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
