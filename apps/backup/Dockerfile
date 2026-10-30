# syntax=docker/dockerfile:1
#
# MedCuidar — serviço de backup (EasyPanel: serviço "App" separado, caminho de build /apps/backup). Guia: docs/12-backup.md.
#   docker build -t medcuidar-backup apps/backup
# O cliente do Postgres precisa ser da versão do servidor ou mais novo (o pg_dump 17 lê servidores 12 a 17).
FROM node:22-alpine
RUN apk add --no-cache postgresql17-client tini
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
ENV NODE_ENV=production
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/cli.mjs", "serve"]
