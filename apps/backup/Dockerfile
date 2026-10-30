# syntax=docker/dockerfile:1
#
# MedCuidar — serviço de backup (EasyPanel: serviço "App" separado, caminho de build /apps/backup). Guia: docs/12-backup.md.
#   docker build -t medcuidar-backup apps/backup
# O cliente do Postgres precisa ser da versão do servidor ou mais nova. O servidor do EasyPanel é o 18;
# o pacote vem do repositório oficial do PostgreSQL (PGDG), que mantém as versões novas (o Alpine não tem a 18).
# Para trocar de versão: PG_CLIENT_VERSION no build (ex.: --build-arg PG_CLIENT_VERSION=19).
FROM node:22-bookworm-slim
ARG PG_CLIENT_VERSION=18
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg tini \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-${PG_CLIENT_VERSION} \
 && apt-get purge -y curl gnupg && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
ENV NODE_ENV=production
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/cli.mjs", "serve"]
