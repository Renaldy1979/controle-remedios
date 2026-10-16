# Workflows N8N do MedCuidar

O N8N **transporta e orquestra**; não decide estoque nem estado de dose (isso é `packages/domain`, chamado pelas Functions em `apps/functions`).

| Arquivo | Para quê |
|---|---|
| `whatsapp-entrada.json` | Webhook da Evolution → confere o token → assina o corpo (HMAC) → chama a Function `whatsapp-inbound` |
| `transcricao-audio.json` | Transcrição de áudio via Gemini, como serviço trocável (`TRANSCRIPTION_PROVIDER=n8n`). Por padrão a Function chama o Gemini direto |
| `alertas-operacionais.json` | Recebe alertas da Function (fila `dead`, Evolution fora do ar, agendador com erro) e avisa o administrador por e-mail |
| `disparo-agendador.json` | Reserva do cron do Appwrite: chama a Function `scheduler` a cada minuto. Mantenha **inativo** se o cron do Appwrite estiver ligado |

Todos importam com `active: false`.

## Importar
N8N → Workflows → Import from file. Depois configure as credenciais (o e-mail usa SMTP) e ative.

## Variáveis de ambiente do N8N
| Variável | Uso |
|---|---|
| `NODE_FUNCTION_ALLOW_BUILTIN=crypto` | o nó Code de `whatsapp-entrada` usa `crypto` |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` | as expressões leem `$env` |
| `EVOLUTION_WEBHOOK_TOKEN` | token que a Evolution envia no cabeçalho `x-evolution-token` |
| `WHATSAPP_WEBHOOK_SECRET` | o **mesmo** segredo da Function `whatsapp-inbound` (assinatura HMAC-SHA256) |
| `INBOUND_FUNCTION_URL` | URL pública da Function `whatsapp-inbound` |
| `SCHEDULER_FUNCTION_URL`, `SCHEDULER_TRIGGER_SECRET` | URL e segredo da Function `scheduler` (só para `disparo-agendador`) |
| `ALERTS_WEBHOOK_SECRET` | segredo do cabeçalho `x-medcuidar-secret` (alertas e transcrição) |
| `ADMIN_EMAIL`, `ALERTS_FROM_EMAIL` | destino e remetente do aviso |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | só se usar `transcricao-audio` |

Na Function: `ALERTS_WEBHOOK_URL` = URL do webhook `medcuidar-alertas` do N8N.

## Evolution API — configurar o webhook da instância
- URL: `https://<n8n>/webhook/medcuidar-evolution`
- Eventos: `MESSAGES_UPSERT` (os demais são ignorados pela Function)
- Cabeçalho: `x-evolution-token: <EVOLUTION_WEBHOOK_TOKEN>`
- Incluir mídia em base64 (`webhook_base64: true`) — evita uma chamada extra para baixar o áudio.

## Contrato com a Function
`POST INBOUND_FUNCTION_URL` com corpo `{"provider":"evolution","payload":<corpo bruto da Evolution>}` e cabeçalho `x-medcuidar-signature: sha256=<hmac hex do corpo>`. Resposta sempre `{ok:true}` (200), mesmo para telefone desconhecido; `401` para assinatura inválida; `500` para o N8N repetir (a Function é idempotente).

## Monitoramento do agendador
A Function `scheduler` faz um ping a `HEARTBEAT_URL` (monitor de *push*, por exemplo Uptime Kuma ou Healthchecks) a cada minuto. Se o ping parar, o monitor externo avisa — assim a queda do próprio agendador não depende dele para ser detectada.

> Estes JSONs foram escritos à mão seguindo o formato de exportação do N8N 1.x e **ainda não foram importados numa instância real** (não há N8N disponível no ambiente de desenvolvimento). Se algum nó acusar versão incompatível na importação, ajuste o `typeVersion` pelo editor e reexporte.
