# Integrações (D) → Orquestrador: Evolution Go (pesquisa; adaptador AINDA NÃO reescrito)

Fontes: swagger oficial `EvolutionAPI/evolution-go/docs/swagger.json` e docs.evolutionfoundation.com.br/evolution-go/*.md (webhooks, send-a-*).

## Confirmado na documentação
- **Autenticação:** cabeçalho `apikey: <GLOBAL_API_KEY>`; chamadas por instância também levam o cabeçalho `instanceId: <UUID da instância>`.
- **Texto:** `POST /send/text` `{number, text, id?, delay?, formatJid?, quoted?{messageId,participant}, mentionedJid?}`.
- **Mídia:** `POST /send/media` `{number, type, url, caption?, filename?}`.
- **Botões:** `POST /send/button` `{number,title,description,footer,buttons[{type: reply|copy|url|call|pix, displayText, id, phoneNumber...}]}`. Até 3 `reply`; não misturar `reply` com `call/url/copy` (some no WhatsApp Web). Logo, o botão "Ligar" do template não pode ir junto de "Já tomou".
- **Lista:** `POST /send/list`; **enquete:** `POST /send/poll` `{number,question,options[],maxAnswer}`.
- **Baixar mídia recebida:** `POST /message/downloadmedia` (corpo no swagger: `{message:{conversation}}` — **dúvida**, verificar com uma mídia real).
- **Webhook:** configurado em `POST /instance/connect` com `{webhookUrl, subscribe:["MESSAGE",...], immediate}`. Evento chega como `{event:"Message", data:{Info:{PushName,Sender,...}, Message:{conversation,...}}, instanceId}` (nomes em PascalCase, estilo whatsmeow). Responder 2xx em 30 s; até 5 retentativas a cada 30 s.
- Há `docs/webhooks.md` (29 KB) com mais eventos; só li o início.

## Dúvidas (não inventei)
1. Formato exato de `Info` para grupo/remetente (`Chat`, `Sender`, `IsFromMe`, `IsGroup`, `ID`?), de resposta a botão e de **áudio** (base64 inline ou só via `downloadmedia`).
2. Formato da resposta de envio (onde vem o id da mensagem) — o swagger só diz `object`.
3. Se o evento de **voto em enquete** chega no webhook (só então implementar enquete).
4. Header de assinatura do webhook: a doc não mostra; usar o token do N8N como hoje.

## Pedidos recebidos e ainda NÃO feitos (limite de uso atingido)
- Renomear/reescrever o adaptador como `evolution-go` com as rotas acima (hoje `packages/channels/src/evolution.ts` usa Evolution API v2 — **rotas erradas para o Evolution Go**).
- `supportsButtons` (env, padrão false) com **fallback numerado como caminho padrão**; templates em duas versões a partir da mesma definição; interpretador aceitando `1/2`, `ok`, `já tomou`, ✅/👍 ligado à dose pendente mais provável (várias → perguntar com lista numerada).
- Script `pnpm --filter @medcuidar/channels smoke` (envio real só com confirmação explícita e número por env).
- Atualizar `.env.example` (pasta do agente A; ver `D-para-A-variaveis-de-ambiente.md`) e reexportar workflows N8N com credenciais por nome + instruções de importação em `integrations/n8n/README.md`.
