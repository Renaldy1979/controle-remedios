# Integrações (D) → Orquestrador: onde hospedar agendador, worker e webhook

Nada foi publicado. Recomendação e o que muda no código.

## O que foi possível verificar (sem alterar nada)
- A chave de API do projeto **não tem escopo `functions.read`** (listar Functions e runtimes devolveu 401), então não consegui ver os runtimes instalados nem Functions existentes.
- `GET /health/queue/functions` respondeu `{"size":0}`: o worker de Functions do Appwrite está de pé. Isso **não prova** que o executor e os runtimes Node estão habilitados (`_APP_FUNCTIONS_RUNTIMES`) no template do EasyPanel. Confirmar no console: *Functions → Create → Runtime* lista Node?

## Recomendação: serviço Node no EasyPanel (não Appwrite Functions)
Rodar `apps/functions` como **um serviço Node** (Dockerfile) com servidor HTTP e cron interno de 1 minuto, falando com o Appwrite pela API (como já faz).

| | Serviço Node no EasyPanel | Appwrite Functions |
|---|---|---|
| Webhook do WhatsApp | resposta imediata, sem *cold start* | *cold start* e limite de tempo por execução; o Evolution Go reenvia se passar de 30 s |
| Agendador | `setInterval` de 60 s + trava para não sobrepor | cron do Appwrite (`* * * * *`), mas cada disparo sobe um contêiner |
| Worker da fila | **uma só instância** (a fila usa "lease", sem compare-and-swap): fácil garantir | instâncias concorrentes possíveis → risco de envio duplicado |
| Estado em memória | limite de taxa por telefone funciona | cada execução começa do zero |
| Operação | logs, reinício e variáveis no EasyPanel; mais uma peça para cuidar | depende do executor e dos runtimes do Appwrite; build a cada deploy |
| Falha | ponto único (se cair, tudo para): mitigar com `HEARTBEAT_URL` e reinício automático | falha isolada por execução |

Pesa a favor do serviço Node: o worker precisa ser instância única e o webhook precisa responder rápido.

## O que muda no código (pequeno)
1. `apps/functions/src/server.ts` (novo): `http.createServer` com
   - `POST /whatsapp-inbound` → `handleWhatsappInbound(rt.inbound, { rawBody, headers })`;
   - `POST /scheduler` (segredo `SCHEDULER_TRIGGER_SECRET`) → um passo do agendador + fila;
   - `GET /healthz`;
   - `setInterval(60_000)` chamando o mesmo passo, com trava (`running`) para não sobrepor.
   O login por código não precisa de endpoint: o painel chama `createServices` direto. Os handlers de `src/entries/*` continuam servindo de base se um dia for preciso migrar para Functions.
2. `Dockerfile` (monorepo pnpm, `pnpm --filter @medcuidar/functions deploy`), `PORT` e domínio interno no EasyPanel; só `/whatsapp-inbound` precisa ser alcançável pelo N8N (rede interna).
3. `integrations/n8n`: a URL do nó *Chamar whatsapp-inbound* aponta para o serviço; `disparo-agendador.json` deixa de ser necessário (o cron é interno) e fica como reserva.
4. Variáveis: as do `.env.example`; `APPWRITE_API_KEY` com escopos mínimos de banco, usuários, times e storage (não precisa de `functions.*`). **Trocar a chave que foi colada no chat antes de ir ao ar.**

## Se preferir Appwrite Functions
Funciona sem mudar o código das entradas (`src/entries/*`): criar 3 Functions (`scheduler` com cron, `whatsapp-inbound`, `login-code`), runtime Node 20+, mesmas variáveis, e **garantir instância única** do `scheduler` (o webhook já é idempotente). Exige confirmar que os runtimes estão habilitados e empacotar o monorepo (`pnpm deploy`).

## Pendências para ir ao ar (independentes da hospedagem)
- O **bucket de receitas** não é criado por `scripts/appwrite`; as URLs assinadas esperam `APPWRITE_PRESCRIPTIONS_BUCKET_ID` (padrão `prescriptions`) com *file security* ligada.
- **Índices** sugeridos para o Appwrite filtrar sem erro: `dose_events (status, scheduled_at)`, `notifications_outbox (target_member_id)` e `(target_group_id)`, `treatments (patient_id, medication_id)`.
- Usuários criados no login por código **não entram nos Teams** automaticamente: o painel acessa tudo pelo servidor (modelo atual); se o front passar a ler o banco com a sessão do usuário, será preciso adicioná-lo ao Team da família.
- Validar com número de teste: botões do Evolution Go e o formato real dos eventos (ver `D-para-orquestrador-evolution-go.md`).
- O smoke `e2e:demo` mostrou que a primeira geração de doses do dia cria 10 doses na família demo; ele as remove ao final.
