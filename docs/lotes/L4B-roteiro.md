# Lote 4B — Roteiro de teste: WhatsApp direto no portal (sem N8N)

**Para quem testa:** o dono do projeto. A **Parte A** é no computador, no portal de staging, **sem número de WhatsApp do sistema**. A **Parte B** só vale quando o chip dedicado existir e estiver conectado.
**Onde:** o staging (`https://automacoes-medcuidar-app.8m5sgi.easypanel.host`). Guia de configuração: `docs/11-whatsapp-direto.md`.
**Tempo:** Parte 0 ≈ 15 min · Parte A ≈ 30 min · Parte B ≈ 45 min.
**Como registrar:** preencha `docs/lotes/L4B-validacao.md`.
**O que mudou em relação ao plano antigo:** **não existe mais N8N** (nada de importar fluxos, credenciais, URL de webhook nem "Testar conexão"). O WhatsApp roda **dentro do portal**: o webhook grava numa fila, um *worker* responde e manda os lembretes, e o Claude só entra nas perguntas livres e **só consulta**.

> Marque cada passo: ✅ passou · ❌ não passou (anote o que viu). O **Resultado esperado** diz o que deveria aparecer.

---

## Parte 0 — Atualizar o staging (você faz uma vez)

1. **Código novo:** faça o **Deploy** do `medcuidar-web` pelo Git, como nos lotes anteriores.
2. **Migração do banco** (traz as tabelas da fila, do uso de IA e a coluna do PARAR). No serviço `medcuidar-web` → **Console** (troque `SENHA_DONO`, `HOST`, `NOME_DO_BANCO`; mantenha as aspas simples):
   ```bash
   DATABASE_URL_ADMIN='postgres://medcuidar_owner:SENHA_DONO@HOST:5432/NOME_DO_BANCO' node /app/migrate/migrate.mjs
   ```
   Deve responder `Migrações aplicadas.`
3. **Variáveis novas** (Environment do `medcuidar-web`; detalhes e exemplos em `docs/11-whatsapp-direto.md`, seção 2). **Segredo** = não cole em lugar nenhum além do EasyPanel.

   | Variável | Segredo? | Obrigatória? | Quando |
   |---|---|---|---|
   | `WHATSAPP_WEBHOOK_SECRET` (24+ letras e números sorteados) | **sim** | **sim, sem valor padrão** | agora |
   | `ANTHROPIC_API_KEY` | **sim** | não | agora, **se já tiver a chave** (para testar perguntas livres na Parte A) |
   | `GEMINI_API_KEY` | **sim** | não | quando quiser testar áudio/foto (Parte B) |
   | `AI_MONTHLY_LIMIT_USD` (ex.: `5`) | não | não (padrão 5) | opcional |
   | `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY` (**segredo**), `EVOLUTION_INSTANCE_ID` | `EVOLUTION_API_KEY` **sim** | **sim, sem valor padrão** (para o WhatsApp real) | **só na Parte B**, quando houver número |
   | `WHATSAPP_WORKER_ENABLED` = `1` | não | não (padrão desligado) | **só na Parte B**. Deixe **desligado** enquanto não houver número |
   | `SIMULATOR_ENABLED` = `1` | não | só no staging | já deve estar ligada (Lote 4A) |
   | `APP_URL`, `DATABASE_URL`, `APPWRITE_*`, `FILE_URL_SECRET` | alguns | sim | já configuradas |

   Pode **apagar** `PLATFORM_KEYS_FROM_PORTAL` se existir (era do N8N). Faça **Deploy** depois de mudar variáveis.
4. Abra `…/api/health` → `{"status":"ok","database":"ok"}`.
5. Entre como administrador → **Configurações → WhatsApp**. Deve aparecer o quadro **WhatsApp do sistema**.

---

## Parte A — Sem número de WhatsApp (tudo pelo simulador)

O simulador usa **a mesma fila e o mesmo worker** do WhatsApp real, só com um "provedor de mentira" que não envia nada a ninguém.

| # | Faça | Resultado esperado |
|---|---|---|
| A1 | **Configurações → WhatsApp**. Olhe o quadro **WhatsApp do sistema**. | Etiqueta **Aguardando conexão**, "Worker desligado", dois blocos **Mensagens recebidas** e **Avisos e lembretes a enviar** (tudo zerado) e **Assistente de perguntas (IA)** com o gasto do mês e o limite (padrão US$ 5,00). **Nada de N8N, "Testar conexão" nem chave `cpl_`.** |
| A2 | Abra **Simulador de WhatsApp** (faixa **"nenhuma mensagem real é enviada"**). Como no Lote 4A, cadastre e verifique seu número (se ainda não estiver). | "✅ Número verificado". Antes da resposta aparece o aviso **"digitando… (simulado: pausa de 2 a 6 s antes de responder)"**. |
| A3 | Envie **tomei** (com uma dose na hora). | "✅ Anotado". Em **Pacientes**, o estoque caiu 1. Envie **tomei** de novo: "Nenhuma dose pendente" (**não** baixa de novo). |
| A4 | Envie **estoque** e **próximas doses**. | Respondem sem IA, com o nome do paciente. |
| A5 | Envie **PARAR**. | "🔕 Avisos pausados". Você **não** recebe mais lembretes na fila, mas o portal e o sino seguem iguais. |
| A6 | No painel da direita, toque em **Atualizar** e depois em **Disparar lembretes agora (simulado)**. | **Nada** é enviado para você (ele PAROU). Se houver outras pessoas com número verificado, os lembretes delas saem. |
| A7 | Envie **estoque** de novo. | **Responde normalmente** (PARAR só pausa os avisos, não o atendimento). |
| A8 | Envie **REATIVAR**. | "🔔 Avisos de volta". Agora **Disparar lembretes agora (simulado)** manda o lembrete da dose (se ainda estiver aberta). |
| A9 | **Só se você já tem `ANTHROPIC_API_KEY`:** envie *"quanto tem de Zypred e quando acaba?"*. | Resposta curta em português, **com os números reais** (dias de estoque). Se perguntar *"posso tomar o dobro?"*: **não dá conselho médico**, manda falar com o médico/farmacêutico. |
| A10 | **Sem a chave da IA:** envie uma pergunta livre, como *"qual a capital da França?"*. | "ℹ️ Assistente indisponível — O assistente de perguntas está indisponível no momento…". Todo o resto (A3, A4) continua funcionando. |
| A11 | Envie *"confirma a dose pra mim"* (com a IA ligada). | O assistente **não confirma**: manda escrever **tomei**. O estoque não mexe. |
| A12 | Volte a **Configurações → WhatsApp**. | **Mensagens recebidas**: pendentes 0, com erro 0. Se a IA respondeu, o **gasto do mês** deixou de ser zero (alguns centavos de dólar) e o número de chamadas subiu. |
| A13 | No bloco da IA, ponha o **limite** em `0` e toque em **Salvar limite**. Volte ao simulador e faça uma pergunta livre. | "⏸️ Assistente pausado — … O administrador já foi avisado". Abra o **sino**: aviso **"Assistente de perguntas pausado"** (uma vez). **tomei/estoque/próximas doses seguem funcionando.** |
| A14 | Ponha o limite de volta em `5` e **Salvar limite**. | O assistente volta a responder. |
| A15 | Digite `abc` no limite e salve. | Mensagem de erro "Informe um valor em dólares…" (nada é salvo). |
| A16 | (Perfil que **não** é administrador) abra **Configurações → WhatsApp**. | **Não** há o quadro "WhatsApp do sistema" nem o simulador. |
| A17 | Confira em **Minha conta** que seu número aparece **Verificado**. | OK. |

**Observação:** a Parte A não testa a Evolution Go, o QR Code nem a entrega pelo celular. Isso é a Parte B.

---

## Parte B — Com o número real (só quando o chip dedicado existir)

**Antes:** chip **dedicado** (nunca o número pessoal), com internet. Leia `docs/11-whatsapp-direto.md`, seções 3 e 4.

| # | Faça | Resultado esperado |
|---|---|---|
| B0 | **Conectar.** Crie a instância na Evolution Go, leia o **QR Code** com o celular do chip, preencha `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_ID`, ponha o webhook em `https://…/api/whatsapp/evolution/<WHATSAPP_WEBHOOK_SECRET>`, ligue `WHATSAPP_WORKER_ENABLED=1` e faça **Deploy**. Em **Configurações → WhatsApp** toque em **Consultar agora**. | Etiqueta **Conectada** e **Worker ligado**. |
| B1 | **Captura do formato real.** Do **seu** celular, mande "oi" para o número do sistema. | Como seu número ainda não foi verificado, você recebe a **resposta genérica** ("Não consegui te identificar por aqui…"). **Se nada chegar:** veja **Mensagens recebidas** (erro?) e a seção 3 do `docs/11` ("Se o formato real for diferente") e **pare aqui** avisando o que viu. |
| B1b | **Nono dígito (use o número real do dono e o de um familiar, em DDD de Minas).** Cadastre cada um como a pessoa usa. Em **Configurações → WhatsApp** veja o número e depois mande "oi" de cada celular. Depois do passo B2 de cada um, aguarde um lembrete. | Cada pessoa é reconhecida **mesmo que o WhatsApp entregue o número com o 9 e o cadastro esteja sem (ou o contrário)**. Se alguém não for reconhecido, **anote o que o painel mostra** (contagem em "Mensagens recebidas") e se a conta é antiga. Os lembretes chegam **uma vez só**. Anote (sem copiar o número inteiro): o WhatsApp dessa pessoa usa a forma **com** ou **sem** o 9? |
| B2 | **Validar o próprio número.** Em **Configurações → WhatsApp** gere o código (como no 4A) e **envie o código** pelo seu WhatsApp para o número do sistema. | "✅ Número verificado". A etiqueta no portal vira **Verificado**. **Anote:** a resposta demorou entre 2 e 6 segundos? Apareceu "digitando…"? |
| B3 | **Lembrete.** Cadastre uma dose para **daqui a 2 a 3 minutos** (Esquemas) e espere. | Chega no seu celular **"⏰ Hora do remédio — …"** com as opções **1 — Tomei** / **2 — Lembrar em 15 min**, com um "digitando…" antes. **Um só**, sem repetir. |
| B4 | Responda **1** (ou **tomei**). | "✅ Anotado". O estoque no portal cai 1. Mande **tomei** outra vez: "Nenhuma dose pendente". |
| B5 | Mande **estoque** (texto) e depois um **áudio** dizendo "como está o estoque?" (precisa de `GEMINI_API_KEY`). | As duas respostas listam o estoque. Mande um áudio dizendo **"tomei"**: o sistema pede para **escrever** *tomei* (não confirma por áudio). |
| B6 | **Pergunta livre** (precisa da chave da IA): *"o Adelino já tomou o remédio hoje?"*. | Resposta curta com a informação real (quem marcou e a que horas). Pergunte *"posso dar mais um comprimido?"*: orienta falar com o médico/farmacêutico. |
| B7 | **Número não verificado ignorado.** Peça a alguém de **outro número** (não cadastrado) para escrever "tomei" ao sistema. | A pessoa recebe **só a resposta genérica**. **Nada** muda no seu estoque nem aparece no histórico da família. |
| B8 | **Convite por WhatsApp.** Convide uma pessoa (Configurações → Pessoas → Por código de WhatsApp), com o celular real dela. Ela envia o código ao número do sistema. | Ela recebe **"Bem-vindo(a)"** com o **link de primeiro acesso** (uso único, 24 h). Ela já consegue "tomei" e "estoque". |
| B9 | **PARAR de verdade.** Essa pessoa escreve **PARAR**, depois você gera um lembrete. | Ela **não** recebe o lembrete; os outros recebem. **REATIVAR** traz de volta. |
| B10 | **Derrubar a Evolution.** Desconecte o aparelho no WhatsApp do chip (ou pare o serviço da Evolution). Espere uns 3 minutos e toque em **Consultar agora**. | Estado **Desconectada**; no **sino** do administrador: **"WhatsApp do sistema desconectado"** (uma vez só). Reconecte o QR Code: o estado volta a **Conectada** e chega um aviso "reconectado". |
| B11 | Mande 5 ou 6 mensagens seguidas, rápido. | As respostas saem **uma por vez**, com pausa entre elas (sem rajada). Nenhuma é respondida em dobro. |

---

## Limitações conhecidas do Lote 4B
- O **formato real** do que a Evolution Go manda ainda não foi conferido com mensagens reais (passo B1).
- **"Tomei" por áudio** não confirma a dose (a transcrição pode errar): pede o texto. **Foto** nunca confirma nada.
- O celular do Brasil com ou sem o 9 é reconhecido pelas duas formas; o envio guarda a forma que funcionou. A consulta de número da Evolution Go e o texto do erro de número inexistente **ainda não foram vistos com número real** (passo B1b).
- Resposta que ficou no meio do envio quando o servidor caiu **não é reenviada** (preferimos perder a responder em dobro).
- Tetos de mensagens por minuto/hora valem por servidor (um portal).
- Custos de IA são **estimativas** feitas com a tabela de preços do código; vale a fatura da Anthropic/Google.
- A API oficial da Meta não está implementada (a interface está pronta).

## Se algo falhar
Veja a tabela **sintoma → causa → correção** em `docs/11-whatsapp-direto.md`, seção 7.
