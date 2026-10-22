# Integrações (D) → Orquestrador: Evolution Go

> **Atualização (Lote 4B):** o adaptador vive agora em `apps/web/src/server/wa/provider/evolution-go.ts` (sem N8N); as dúvidas abaixo seguem valendo e estão marcadas `TODO verificar com mensagem real`. Roteiro: `docs/lotes/L4B-roteiro.md`, passo B1.

Estado: adaptador `evolution-go` implementado (`packages/channels/src/evolution-go.ts`); o adaptador da Evolution API v2 foi **removido**. Fontes: swagger oficial `EvolutionAPI/evolution-go/docs/swagger.json` e docs.evolutionfoundation.com.br/evolution-go (webhooks, send-a-*).

## Confirmado na documentação e implementado
- Autenticação: cabeçalhos `apikey` (GLOBAL_API_KEY) e `instanceId` (UUID da instância).
- `POST /send/text {number,text}` · `/send/media {number,type,url,caption,filename}` · `/send/button {number,title,description,footer,buttons[{type:"reply",displayText,id}]}` (até 3 `reply`; **não misturar com `call/url/copy`** — a ligação vira linha de texto) · `/message/downloadmedia`.
- Webhook: configurado em `POST /instance/connect {webhookUrl, subscribe:["MESSAGE"], immediate}`; evento `{event:"Message", data:{Info:{Chat,Sender,SenderAlt,IsFromMe,IsGroup,ID,Timestamp,MediaType}, Message:{conversation|extendedTextMessage|audioMessage|imageMessage..., base64}}}`; 2xx em 30 s, até 5 retentativas.
- **Botões são opcionais**: `SUPPORTS_BUTTONS=false` (padrão) envia texto com opções numeradas; as respostas "1", "2", "ok", "tomei", "já tomou", ✅/👍 e áudio transcrito são interpretadas na entrada. Mais de uma dose possível → lista numerada, nunca adivinha. Enquete **não** implementada: a doc não mostra o evento de voto no webhook.

## Ainda NÃO verificado com mensagem real (isolado em funções pequenas, com `TODO verificar com mensagem real` e teste por fixture)
1. `extractSentMessageId` — a doc é inconsistente (`messageId` no schema, `data.Info.ID` no exemplo). Se nenhum vier, geramos um id sintético em vez de falhar (a mensagem já foi enviada; falhar duplicaria no reenvio).
2. `senderPhoneFromInfo` — remetente em grupo e em `@lid` (usa `Sender`, cai para `SenderAlt`).
3. `buttonIdFromMessage` — grafia do id de resposta de botão (`selectedButtonID`/`Id`...): só relevante com `SUPPORTS_BUTTONS=true`.
4. Mídia: `Message.base64` (WEBHOOK_FILES=true) ou `mediaUrl`; o corpo de `/message/downloadmedia` na doc é `{message:{conversation}}` — enviamos o objeto `Message` recebido; formato da resposta (`extractDownloadedMedia`) é suposição.
5. `/send/media` com `base64`: enviamos como data URI em `url` (suposição); preferir URL assinada.
6. Grupo: `number` = JID do grupo (`...@g.us`) — a doc não detalha; validar.
7. O Evolution Go não envia cabeçalho de autenticação no webhook: o workflow de entrada usa um **token no caminho** do webhook do N8N.

## Roteiro com número de teste (quando existir)
1. `pnpm --filter @medcuidar/channels smoke` (mostra o plano) e depois `SMOKE_TO=<número de teste> SMOKE_CONFIRM=ENVIAR pnpm --filter @medcuidar/channels smoke`.
2. Configurar o webhook (README de `integrations/n8n`), mandar "oi", "1", "tomei", um áudio, e conferir os pontos 1–6 acima.
