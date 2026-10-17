# Workflows N8N do MedCuidar

O N8N **transporta e orquestra**; não decide estoque nem estado de dose (isso é `packages/domain`, chamado pelas Functions em `apps/functions`). Os JSONs podem ser importados num N8N que já existe: **não contêm segredos** — usam credenciais por nome e marcadores `TROQUE-...` nos endereços.

| Arquivo | Para quê |
|---|---|
| `whatsapp-entrada.json` | Webhook do Evolution Go → filtra o evento `Message` → chama a Function `whatsapp-inbound` |
| `transcricao-audio.json` | Transcrição de áudio via Gemini como serviço trocável (`TRANSCRIPTION_PROVIDER=n8n`). Por padrão a Function chama o Gemini direto |
| `alertas-operacionais.json` | Recebe alertas da Function (fila `dead`, WhatsApp fora do ar, agendador com erro) e avisa o administrador por e-mail |
| `disparo-agendador.json` | Reserva do cron do Appwrite: chama a Function `scheduler` a cada minuto. Mantenha **inativo** se o cron do Appwrite estiver ligado |

## 1. Criar as credenciais (Credentials → Create), com **exatamente estes nomes**
| Nome | Tipo | Configuração | Usada em |
|---|---|---|---|
| `MedCuidar Webhook Secret` | Header Auth | Name `x-medcuidar-secret`, Value = `WHATSAPP_WEBHOOK_SECRET` da Function | `whatsapp-entrada` |
| `MedCuidar Alertas` | Header Auth | Name `x-medcuidar-secret`, Value = `ALERTS_WEBHOOK_SECRET` da Function | `alertas-operacionais`, `transcricao-audio` (autentica o webhook de entrada) |
| `MedCuidar Scheduler` | Header Auth | Name `x-medcuidar-secret`, Value = `SCHEDULER_TRIGGER_SECRET` | `disparo-agendador` |
| `Gemini API Key` | Header Auth | Name `x-goog-api-key`, Value = chave do Gemini | `transcricao-audio` |
| `SMTP MedCuidar` | SMTP | servidor de e-mail do dono | `alertas-operacionais` |

Os valores ficam só no cofre de credenciais do N8N e nas variáveis da Function; nada disso vai para o Git.

## 2. Importar
Workflows → *Import from file* → um arquivo por vez. Em cada nó com ícone de credencial, abra e **selecione a credencial de mesmo nome** (o N8N não casa por nome sozinho se o ID for diferente). Depois edite os marcadores:

- `whatsapp-entrada`: no nó *Webhook Evolution Go*, troque `TROQUE-ESTE-TOKEN` no **path** por um texto aleatório longo (o Evolution Go não consegue enviar cabeçalho de autenticação, então o segredo é o próprio endereço). No nó *Chamar whatsapp-inbound*, troque a URL pela da Function `whatsapp-inbound`.
- `alertas-operacionais`: remetente e destinatário no nó de e-mail.
- `disparo-agendador`: URL da Function `scheduler`.

Ative cada workflow só depois de configurar. Na Function, defina `ALERTS_WEBHOOK_URL` = URL de produção do webhook `medcuidar-alertas` e `TRANSCRIPTION_N8N_URL` (se usar a transcrição por N8N) = URL do webhook `medcuidar-transcrever`.

## 3. Apontar o Evolution Go para o N8N
Na conexão da instância (docs.evolutionfoundation.com.br/evolution-go/webhooks):

```bash
curl -X POST "$EVOLUTION_BASE_URL/instance/connect" \
  -H "apikey: $EVOLUTION_API_KEY" -H "instanceId: $EVOLUTION_INSTANCE_ID" -H "Content-Type: application/json" \
  -d '{"webhookUrl":"https://<n8n>/webhook/medcuidar-evolution-go-<seu-token>","subscribe":["MESSAGE"],"immediate":true}'
```
Com `WEBHOOK_FILES=true` (padrão do Evolution Go) o áudio chega em base64 no próprio evento. O Evolution Go repete até 5 vezes (a cada 30 s) se não receber 2xx: a Function é idempotente.

## Contrato com a Function
`POST` na Function `whatsapp-inbound` com `{"provider":"evolution-go","payload":<evento bruto>}` e o cabeçalho `x-medcuidar-secret` (a credencial acima; a Function também aceita assinatura HMAC `x-medcuidar-signature`). Resposta: `{ok:true}` (200) mesmo para telefone desconhecido; `401` segredo inválido; `500` para o N8N repetir.

## Monitoramento do agendador
A Function `scheduler` faz um ping a `HEARTBEAT_URL` (monitor de *push*, por exemplo Uptime Kuma ou Healthchecks) a cada minuto. Se o ping parar, o monitor externo avisa.

> Os JSONs foram escritos à mão no formato de exportação do N8N 1.x e **ainda não foram importados numa instância real**. Se algum nó acusar versão incompatível, ajuste o `typeVersion` no editor e reexporte.
