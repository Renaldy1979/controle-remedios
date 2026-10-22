# Lote 4B — Roteiro de teste: N8N e WhatsApp real (Evolution Go)

**Para quem testa:** o dono do projeto.
**Onde:** o staging (`https://automacoes-medcuidar-app.8m5sgi.easypanel.host`), o seu N8N e a sua Evolution Go (EasyPanel).
**Tempo:** Parte 0 ≈ 30 min (uma vez); Parte A ≈ 30 min (**sem número**); Parte B ≈ 45 min (**com o número do sistema**).
**Como registrar:** preencha `docs/lotes/L4B-validacao.md`.
**Guia passo a passo de tudo (credenciais, webhook, QR Code, anti-bloqueio, custos, falhas): `docs/11-n8n-whatsapp.md`.**

**Importante:** a Parte A **não precisa de número** de WhatsApp do sistema. A Parte B só pode ser feita depois que você criar o número (chip dedicado; **não use o seu pessoal**). Se a Parte B revelar diferenças de formato nas mensagens reais, é esperado: elas estão listadas em "O que só se confirma com número real" no fim.

> Marque: ✅ passou · ❌ não passou (anote o que viu).

---

## Parte 0 — Preparar (uma vez)

> ⚠️ **Variáveis, uma a uma.** Marque **OBRIGATÓRIA** só onde não há valor padrão.

| Variável (serviço `medcuidar-web`) | Valor | Segredo? | Obrigatória? |
|---|---|---|---|
| `PLATFORM_KEYS_FROM_PORTAL` | `1` | não | só **enquanto criar a chave `cpl_`** (passo 4). Depois remova e faça deploy |
| `FILE_URL_SECRET` | o de antes | **sim** | **OBRIGATÓRIA, sem valor padrão** (já existe). Agora também protege o segredo do teste de conexão: se você trocá-la, gere o segredo de novo |
| `APP_URL`, `DATABASE_URL`, `APPWRITE_*` | os de antes | alguns | **OBRIGATÓRIAS** (já configuradas) |
| `SIMULATOR_ENABLED` | `1` (como no 4A) | não | opcional |
| `ALLOW_PRIVATE_WEBHOOKS` | **não defina** | não | só testes automáticos; é recusada com `APP_ENV=production` |

1. **Deploy** do código do Lote 4B (pelo Git, como antes). Ele traz **uma migração nova** (`0007`, tabela `family_integrations`).
2. No **Console** do serviço, rode a migração (troque `SENHA_DONO`, `HOST`, `NOME_DO_BANCO`; mantenha as aspas simples):
   ```bash
   DATABASE_URL_ADMIN='postgres://medcuidar_owner:SENHA_DONO@HOST:5432/NOME_DO_BANCO' node /app/migrate/migrate.mjs
   ```
   Deve responder `Migrações aplicadas.`
3. Abra `…/api/health` → `{"status":"ok","database":"ok"}`.
4. Adicione `PLATFORM_KEYS_FROM_PORTAL=1`, faça **Deploy**, entre como Administrador → **Configurações › WhatsApp › Chave da plataforma (N8N)** → nome `N8N do staging` → **Criar chave**. **Copie a chave `cpl_…` agora** (aparece uma vez). No N8N crie a credencial **`MedCuidar API`** (Header Auth; Name `Authorization`; Value `Bearer ` + a chave). Depois **remova** `PLATFORM_KEYS_FROM_PORTAL` e faça Deploy.
5. **Importe os 8 fluxos** de `integrations/n8n/fluxos/` no seu N8N e crie as demais credenciais (`Evolution Go`, `Gemini`, `Anthropic`, `SMTP alertas`), com os nomes exatos — tudo em `docs/11-n8n-whatsapp.md`, seção (a). Preencha o nó **Config** de cada fluxo e troque o final do caminho dos webhooks.

## Parte A — Sem número de WhatsApp

| # | Faça | Resultado esperado |
|---|---|---|
| A1 | **Configurações › WhatsApp** (como Administrador). | Cartão **WhatsApp do sistema (N8N)** com a etiqueta **Aguardando conexão** e o texto "WhatsApp do sistema: aguardando conexão". **Testar conexão** está desligado. |
| A2 | Ative o fluxo **05** no N8N. Cole no portal a **Production URL** do nó "Ping do portal" e toque **Salvar endereço**. | "Endereço salvo". Se colar um endereço `http://`, interno (`localhost`, `10.…`) ou com usuário e senha: **recusa** com mensagem clara. |
| A3 | Toque **Gerar segredo**. | O segredo `whsec_…` aparece **uma vez**, com o passo a passo "Credenciais › Header Auth `MedCuidar Teste de conexão`, Name `X-MedCuidar-Token`". Crie a credencial no N8N e ligue-a ao nó do fluxo 05. |
| A4 | Toque **Testar conexão**. | Mensagem verde "Conectado ao N8N (fluxos versão 1.0.0) em N ms" e a etiqueta vira **N8N conectado**. |
| A5 | (Opcional) Troque uma letra do segredo na credencial do N8N e teste de novo. | Mensagem "O N8N recusou o segredo…" e volta a **Aguardando conexão**. Desfaça. |
| A6 | No N8N, ative **01b Agente** e **01 Conversa**. Abra o 01, nó **Webhook Evolution**, e use **Listen for test event**. Em um terminal, mande um payload de exemplo (troque `5511912345678` por **seu número já verificado** no portal e `ENDERECO` pela URL de **teste** do webhook): `curl -X POST "ENDERECO" -H "Content-Type: application/json" -d '{"event":"Message","data":{"Info":{"Chat":"5511912345678@s.whatsapp.net","Sender":"5511912345678@s.whatsapp.net","IsFromMe":false,"IsGroup":false,"ID":"TESTE-001","Timestamp":"AGORA-EM-ISO-8601"},"Message":{"conversation":"estoque"}}}'` (use o horário atual no lugar de `AGORA-EM-ISO-8601`, ex.: `2026-10-22T14:00:00-03:00`; mensagens com mais de 60 min são ignoradas). | A execução percorre **Normaliza → Conversa (API)**; no nó "Conversa (API)" a saída tem **`dados.respostas[0].texto`** com "📦 Estoque…" e `intent: "estoque"`. O nó "Envia resposta" **falha** (ainda não há Evolution conectada): é esperado na Parte A. |
| A7 | Repita o curl com o campo `"IsFromMe":true`, depois com `"Chat":"120363000000000000@g.us","IsGroup":true`. | O fluxo termina em **Ignorado**, sem chamar a API. |
| A8 | Repita o curl com um número **que não está verificado**. | A API devolve a resposta **genérica** (`intent: "desconhecido"`), sem nome de paciente ou remédio. |
| A9 | Repita o curl do passo A6 duas vezes com a **mesma** `ID` e com a mensagem `tomei` (com uma dose na hora). | O estoque baixa **uma vez só**. |
| A10 | No computador do projeto: `pnpm n8n:validar` e `pnpm n8n:build` (se tiver o repositório). | `n8n:validar — 8 fluxos OK`; `n8n:build` não altera nada (`git status` limpo). |
| A11 | Ative **06 Alertas operacionais** com um endereço errado em `evolutionBase` e espere 15 min (3 checagens). | Chega **um** e-mail "[MedCuidar] WhatsApp fora do ar", **sem telefone nem nome**. Corrija o endereço: chega "voltou ao normal". |

## Parte B — Com número real (só depois de criar o número do sistema)

Pré-requisito: Evolution Go com a instância **Conectada** (QR Code), credencial `Evolution Go` criada, webhook da instância apontando para o fluxo **01** (`docs/11`, seções b e c). Use **seu próprio celular** como "usuário" (o chip do sistema é outro aparelho).

| # | Faça | Resultado esperado |
|---|---|---|
| B0 | (Recomendado) Ative o fluxo **00 Captura**, aponte o webhook para ele, mande "oi" e um áudio de teste do seu celular; veja **Executions**. Depois desative o 00 e **apague as execuções**. Passe-me o formato (sem dados pessoais) se algo diferir do documentado. | Você vê `event: "Message"`, `Info.Sender`/`Chat` com seu número e `Message.conversation`. |
| B1 | Em **Minha conta** (portal) cadastre seu número e gere o código. Pelo seu WhatsApp, mande o código **para o número do sistema**. | Resposta "✅ Número verificado". A etiqueta no portal vira **Verificado**. |
| B2 | Cadastre uma dose para daqui a 2 minutos (estoque 10) e ative o fluxo **02**. | Chega no seu WhatsApp "⏰ Hora do remédio — …" com **1 — Tomei** e **2 — Lembrar em 15 min**. No N8N, a execução marca **Marca enviada**. |
| B3 | Responda **tomei** (ou **1**). | "✅ Anotado…". No portal o estoque **baixou 1**. |
| B4 | Responda **tomei** outra vez. | "Nenhuma dose pendente"; o estoque **não** baixa de novo. |
| B5 | Pergunte **como está o estoque?** | Resposta pronta em código (sem IA) com os dias de estoque. |
| B6 | Pergunte algo livre: **a receita do Adelino está válida?** | Responde o agente de IA, com dados reais (confira com o portal); se perguntar algo fora do assunto, ele diz que só ajuda com os remédios. Peça **"confirma a dose pra mim"**: ele **não confirma** (explica que é responder "tomei"). |
| B7 | Mande um **áudio** dizendo "tomei". | O sistema entende e confirma a dose (se houver uma aberta) ou diz que não há dose pendente. Um áudio mudo/ilegível: "Não consegui entender o áudio…". |
| B8 | Com um **segundo número não verificado**, mande "tomei". | **Resposta genérica**, sem nenhum dado da família; nada muda no portal. |
| B9 | **Convite por WhatsApp:** no portal convide uma pessoa por código; do celular dela, mande o código ao número do sistema. | "✅ Bem-vindo(a)…" com o **link de primeiro acesso**. |
| B10 | Deixe o estoque baixo (ajuste no portal) e espere o fluxo **03** (até 30 min). | Chega "📦 Estoque baixo…" só para quem pode comprar e tem número verificado. |
| B11 | **Derrube a Evolution Go** (pare o serviço no EasyPanel) por ~15 min. | Chega o e-mail de alerta do fluxo 06 (sem dados pessoais). Os lembretes **não se perdem**: ao religar e reconectar, saem no próximo ciclo e só são marcados como enviados após o envio OK. |
| B12 | Mande uma mensagem **de dentro de um grupo** onde o número do sistema esteja, e uma pelo próprio número do sistema. | Nada acontece (ignoradas). |

## O que só se confirma com número real
Estes pontos estão isolados em funções pequenas de `integrations/n8n/lib/evolution.ts` (marcadas `TODO verificar com mensagem real`): remetente em `@lid`, formato da mídia do áudio e do `/message/downloadmedia`, id da mensagem enviada, e a rota de saúde `/server/ok` do fluxo 06.

## Limitações conhecidas
- Sem botões (Evolution Go): opções numeradas. Memória do agente só enquanto o N8N não reinicia. O alerta depende do N8N no ar (use também um monitor externo).
- Receita por WhatsApp (enviar imagem) fica para o Lote 5.
