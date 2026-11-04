# Evolution Go oficial + correção do "Client outdated (405)" (PR #227 da Evolution Go: store.SetWAVersion).
# TEMPORÁRIO: quando sair a imagem oficial 0.7.3 (ou mais nova, sem -beta), volte o serviço para evoapicloud/evolution-go.
# Veja infra/evolution-go/README.md. Contexto de build: esta pasta.

FROM golang:1.25.0-alpine AS build
RUN apk update && apk add --no-cache git build-base libjpeg-turbo-dev libwebp-dev

ARG EVO_REF=0.7.2
WORKDIR /build
RUN git clone --depth 1 --branch "${EVO_REF}" https://github.com/evolution-foundation/evolution-go.git .

COPY wa-version.snippet.go /tmp/snippet.go
# insere o trecho ANTES da criação do logger (logo depois do bloco que escolhe a versão) e confere que entrou
RUN awk 'FNR==NR { s = s $0 "\n"; next } /FIX: Sempre criar logger, mesmo que WaDebug/ && !done { printf "%s", s; done = 1 } { print }' \
      /tmp/snippet.go pkg/whatsmeow/service/whatsmeow.go > /tmp/out.go \
 && mv /tmp/out.go pkg/whatsmeow/service/whatsmeow.go \
 && grep -q "Applied store.SetWAVersion" pkg/whatsmeow/service/whatsmeow.go

RUN go mod download
ARG VERSION=${EVO_REF}-wav
RUN CGO_ENABLED=1 go build -ldflags "-X main.version=${VERSION}" -o server ./cmd/evolution-go

FROM alpine:3.19.1 AS final
RUN apk update && apk add --no-cache tzdata ffmpeg libjpeg-turbo libwebp poppler-utils
WORKDIR /app
COPY --from=build /build/server .
COPY --from=build /build/manager/dist ./manager/dist
COPY --from=build /build/VERSION ./VERSION
ENV TZ=America/Sao_Paulo
ENTRYPOINT ["/app/server"]
