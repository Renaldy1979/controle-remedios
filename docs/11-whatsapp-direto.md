# 11 — WhatsApp direto no portal (sem N8N)

Guia para o **dono do projeto** (não precisa ser técnico). Explica o que configurar no EasyPanel, como conectar o número do sistema e o que fazer quando algo não funciona. Complementa `docs/06-escopo-v2.md` (seção 5) e o roteiro `docs/lotes/L4B-roteiro.md`.

> **Resumo em uma frase:** o portal agora conversa sozinho pelo WhatsApp (recebe, responde e manda os lembretes). Não existe mais N8N. Você só precisa de **um número de WhatsApp só do sistema**, da **Evolution Go** apontando para o portal e de **algumas variáveis** no EasyPanel.

## 1. Como funciona (em português simples)

1. A pessoa manda uma mensagem para o número do sistema.
2. A **Evolution Go** (o programa que "segura" o WhatsApp) avisa o portal por um endereço secreto (o *webhook*).
3. O portal guarda a mensagem numa **fila** e responde "recebido" na hora.
4. Um **worker** (um trabalhador que roda dentro do próprio portal) pega a fila **uma conversa por vez e na ordem**, descobre quem é a pessoa **pelo número verificado** e responde:
   - **"tomei", "1", "estoque", "próximas doses", "eu cuido disso", "PARAR", "REATIVAR"…** são tratados pelo próprio sistema, **sem inteligência artificial**. **Confirmar dose nunca passa pela IA.**
   - **Áudio e foto** viram texto pelo **Gemini** (do Google).
   - **Perguntas livres** ("o remédio da Maria vai acabar?") vão para o **Claude** (da Anthropic), que **só consulta** e nunca altera nada.
5. O mesmo worker manda os **lembretes**: dose na hora, dose atrasada/esquecida, estoque baixo, receita vencendo, reposição e resumo do dia.

Regras que valem sempre:
- **Quem não tem número verificado não recebe nem é atendido** pelo WhatsApp (o portal funciona normal).
- A identidade vem **do número de quem escreveu**, nunca do que a IA "acha".
- Toda resposta sai com **"digitando…" e uma pausa de 2 a 6 segundos**, e há um **teto de mensagens por minuto e por hora** (proteção contra bloqueio do número).
- O texto das mensagens **não vai para os registros (logs)**; o conteúdo bruto da mensagem (inclusive áudio e foto) é **apagado assim que a conversa termina**, e as linhas antigas somem em 7 dias.

## 2. Variáveis no EasyPanel

No serviço **`medcuidar-web` → Environment**. Depois de criar ou mudar uma variável, faça **Deploy** (só vale depois de reiniciar). **Segredo?** = nunca cole no chat, em e-mail ou em print; só no EasyPanel.

| Variável | Exemplo | Segredo? | Obrigatória? |
|---|---|---|---|
| `WHATSAPP_WEBHOOK_SECRET` | `k3Jd9sLq2VxP7mT4wNb8Zc5H` (24+ letras e números sorteados) | **sim** | **sim, sem valor padrão** (sem ela a rota do webhook responde "não encontrado") |
| `EVOLUTION_BASE_URL` | `https://evolution.seu-dominio.com.br` (sem `/` no fim) | não | **sim, sem valor padrão**, para o WhatsApp real |
| `EVOLUTION_INSTANCE_TOKEN` | o **token da instância** (veja abaixo onde achar) | **sim** | **sim para o WhatsApp real** (sem valor padrão). É ele que a Evolution Go exige para enviar mensagens. Sem ele o portal usa `EVOLUTION_API_KEY`, o que pode dar erro 401 |
| `EVOLUTION_API_KEY` | a chave global (`GLOBAL_API_KEY`) da Evolution Go | **sim** | não, se você tem o token da instância. É o plano B (fallback) quando `EVOLUTION_INSTANCE_TOKEN` não existe |
| `EVOLUTION_INSTANCE_ID` | `0b6e8a1c-…` (o UUID da instância criada) | não | **sim, sem valor padrão**, para o WhatsApp real |
| `WHATSAPP_WORKER_ENABLED` | `1` | não | não (padrão **desligado**). Ligue **só quando houver número conectado** |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | **sim** | não. Sem ela, perguntas livres respondem *"o assistente de perguntas está indisponível"* e **todo o resto funciona** |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | não | não (padrão `claude-sonnet-5-5`) |
| `GEMINI_API_KEY` | `AIza…` | **sim** | não. Sem ela, áudio e foto respondem *"não consegui entender"* e pedem texto |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | não | não (padrão `gemini-3.5-flash-lite`). **Não use o `gemini-2.5-flash`: foi aposentado pelo Google (desligamento anunciado em 16/10/2026) e responde erro 404.** Se o modelo configurado der 404, o sistema tenta **uma vez** o `gemini-3.5-flash` antes de desistir |
| `AI_MONTHLY_LIMIT_USD` | `5` | não | não (padrão **5** dólares por família por mês) |
| `WHATSAPP_WORKER_CONCURRENCY` | `2` | não | não (padrão 2 respostas ao mesmo tempo; máximo 8) |
| `WHATSAPP_MAX_PER_MINUTE` / `WHATSAPP_MAX_PER_HOUR` | `12` / `150` | não | não (padrões 12 e 150) |
| `WHATSAPP_PROVIDER` | `evolution-go` | não | não (padrão `evolution-go`). `fake` é só para teste e **é recusado em produção** |
| `SIMULATOR_ENABLED` | `1` | não | só no staging (liga o simulador). **Nunca em produção** |
| `APP_URL`, `DATABASE_URL`, `APPWRITE_*`, `FILE_URL_SECRET` | os de antes | `DATABASE_URL`, `APPWRITE_API_KEY`, `FILE_URL_SECRET` são segredos | sim (já configuradas) |

**Saíram:** `PLATFORM_KEYS_FROM_PORTAL` e `ALLOW_PRIVATE_WEBHOOKS` (eram do N8N). Se estiverem no seu EasyPanel, pode apagar.

**Como sortear o `WHATSAPP_WEBHOOK_SECRET`:** use um gerador de senhas (24 caracteres, só letras e números). Evite símbolos (`/`, `?`, `#`), porque o segredo vira parte do endereço.

## 3. Criar a instância na Evolution Go e conectar o número

> **Antes de tudo — o número.** Use um **chip dedicado ao sistema** (um número que **só** o MedCuidar usa). **Nunca o seu número pessoal** nem o de um familiar: se o WhatsApp bloquear, você não perde seus contatos nem suas conversas.

1. Abra o painel da Evolution Go (o endereço do `EVOLUTION_BASE_URL`; o EasyPanel mostra o serviço) e **crie uma instância** (nome sugerido: `medcuidar`). Copie o **ID (UUID)** da instância: ele vai em `EVOLUTION_INSTANCE_ID`. Copie também o **token da instância** (na tela da instância no painel da Evolution Go, campo "token"): ele vai em **`EVOLUTION_INSTANCE_TOKEN`**. **Nunca cole o token no chat, em e-mail ou em print**; só no EasyPanel. A **chave global** (`GLOBAL_API_KEY`) fica nas variáveis do próprio serviço da Evolution: ela vai em `EVOLUTION_API_KEY`.
2. Na instância, escolha **Conectar** e leia o **QR Code** com o celular do chip: WhatsApp → **Aparelhos conectados → Conectar um aparelho**. Espere ficar **conectado**.
3. **Aponte o webhook para o portal.** O endereço é:

   ```
   https://SEU-PORTAL/api/whatsapp/evolution/SEU_WHATSAPP_WEBHOOK_SECRET
   ```

   (troque `SEU-PORTAL` pelo endereço do portal, ex.: `automacoes-medcuidar-app.8m5sgi.easypanel.host`, e `SEU_WHATSAPP_WEBHOOK_SECRET` pelo valor da variável). Na Evolution Go isso é feito no cadastro do webhook da instância (campo de endereço do webhook, assinando só o evento de **mensagens**; pela API é `POST /instance/connect` com `webhookUrl` e `subscribe: ["MESSAGE"]`). Se a tela da sua versão for diferente, procure por "Webhook".
4. No portal (**Configurações › WhatsApp**) toque em **Consultar agora**: o estado deve virar **Conectada**.
5. No EasyPanel, ponha `WHATSAPP_WORKER_ENABLED=1` e faça **Deploy**. Em **Configurações › WhatsApp** o quadro mostra **Worker ligado**.

### Se o formato real das mensagens for diferente do esperado
O formato do que a Evolution Go manda foi montado pela documentação; **ainda não foi conferido com mensagens reais**. Se você mandar "oi" e nada acontecer, ou o portal ignorar a mensagem:
- Em **Configurações › WhatsApp**, veja se **Mensagens recebidas** mostra pendentes ou erros (a causa resumida aparece, sem o texto da mensagem).
- Se estiver tudo zerado, o portal está **ignorando** o evento (formato diferente). Isso é esperado de acontecer só uma vez: guarde a data/hora da mensagem de teste e **me avise** (ou ao orquestrador). As funções que decidem o formato são pequenas e ficam em `apps/web/src/server/wa/provider/evolution-go.ts`, marcadas com `TODO verificar com mensagem real`, e têm teste por exemplo de mensagem (`provider/fixtures/eventos.json`). A correção é trocar o exemplo e a função, sem mexer no resto.
- **Voltar atrás é simples:** desligue `WHATSAPP_WORKER_ENABLED` (tira do ar o worker) ou troque o segredo do webhook. O portal continua normal.

## 4. Boas práticas para não ter o número bloqueado

O WhatsApp bloqueia números que parecem "robôs de spam". O sistema ajuda (pausas, tetos, "digitando…"), mas o uso certo é o que mais protege:

- **Chip dedicado**, com plano de dados ativo. Nunca o número pessoal.
- **Só responder a quem fala primeiro** ou a quem **verificou o número** no portal. O sistema nunca manda mensagem a quem não verificou. **Não** adicione desconhecidos.
- **Evite rajadas.** Não cadastre dezenas de pessoas de uma vez no mesmo dia.
- **Aquecimento gradual.** Na primeira semana, use com **poucas pessoas** (você e mais uma ou duas). Aumente aos poucos.
- **Peça para salvarem o número** como "MedCuidar" nos contatos (contato salvo reduz denúncias).
- Mantenha o celular do chip com **bateria e internet**, e abra o WhatsApp dele de vez em quando.
- **"PARAR"** funciona: quem não quiser mais os avisos escreve **PARAR** (e volta com **REATIVAR**). Respeite sempre.
- Se o painel mostrar **Desconectada**, reconecte o QR Code o quanto antes. O sistema **avisa o administrador no sino do portal** quando isso acontece.

## 5. Custos estimados da IA e como ajustar o limite

- **Claude** (`claude-sonnet-5-5`): US$ 2 por milhão de palavras-pedaço (tokens) de entrada e US$ 10 por milhão de saída. Uma pergunta típica usa cerca de 1.500 tokens de entrada e 200 de saída, com o texto fixo do assistente guardado em cache (mais barato nas próximas perguntas). **Ordem de grandeza: de US$ 0,003 a US$ 0,01 por pergunta** (menos de 6 centavos de real). Com 10 perguntas por dia o custo mensal fica em **poucos dólares**.
- **Gemini** (áudio e foto, `gemini-3.5-flash-lite`): US$ 0,30 por milhão de tokens de texto/imagem e US$ 2,50 por milhão de áudio e de saída (tabela do Google conferida em 05/10/2026). Um áudio de 10 segundos custa uma fração de centavo.
- **Limite mensal:** o padrão é **US$ 5 por família por mês**. Para mudar, **Configurações › WhatsApp → "Assistente de perguntas" → Limite mensal (US$) → Salvar limite**. O valor **0** pausa o assistente. Ao chegar no limite, o assistente de perguntas **pausa**, você recebe um **aviso no sino do portal** (uma vez por mês) e as pessoas recebem *"o assistente de perguntas está pausado neste mês"*. **Confirmar dose, estoque e próximas doses continuam funcionando.** O áudio e a foto continuam sendo lidos (custam muito pouco) e contam no gasto.
- O quadro mostra **gasto do mês, limite e nº de chamadas**. Os preços ficam em `apps/web/src/server/wa/ia/precos.ts`; se a Anthropic ou o Google mudarem os preços, o gasto mostrado pode divergir um pouco da fatura (a fatura de cada empresa é a que vale).

## 6. O que o assistente de IA pode e não pode

- **Pode consultar:** estoque e previsão, próximas doses, doses do dia, se uma dose já foi tomada (e por quem), reposições em andamento e receitas vigentes.
- **Respeita o perfil de quem pergunta:** quem não pode ver estoque ou receitas recebe a resposta "seu perfil não permite". Quem só validou o WhatsApp (ainda não fez o primeiro acesso ao portal) **não** consulta receitas.
- **Nunca escreve:** não confirma dose, não desfaz, não registra compra, não ajusta estoque. Para confirmar, a pessoa escreve **tomei**.
- **Nunca dá conselho médico:** sobre dose, trocar, pular ou parar remédio, sintomas, interações → orienta falar com o médico ou o farmacêutico (e o SAMU, 192, em emergência).
- **Nunca inventa números:** só usa o que a consulta devolveu.
- **Áudio:** vira texto e responde a consultas ("como está o estoque?"). **"Tomei" por áudio não confirma a dose** (a transcrição pode errar): o sistema pede para escrever *tomei*. **Foto:** a leitura vira texto para o assistente; nada é confirmado a partir de foto.

## 7. Quando algo não funciona (sintoma → causa → correção)

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Mando "oi" e **ninguém responde**; "Mensagens recebidas" **zerado** | O webhook da Evolution não chega ao portal, o segredo do endereço está errado ou o formato da mensagem é diferente | Confira o endereço do webhook (o segredo no fim do endereço tem que ser igual ao `WHATSAPP_WEBHOOK_SECRET`, sem espaço) e se a variável existe no EasyPanel. Com segredo errado o portal responde "não encontrado" de propósito. Veja a seção 3 sobre o formato |
| Mensagens ficam em **"pendentes"** e não andam | O worker está desligado ou sem batimento | Veja o selo **Worker**: se estiver "desligado", ponha `WHATSAPP_WORKER_ENABLED=1` e faça Deploy. "Sem batimento recente": o servidor reiniciou ou há dois portais; espere 1 minuto |
| **"Evolution recusou a chave (401)"** no painel, ou aviso no sino "WhatsApp do sistema: chave recusada" | A Evolution Go exige o **token da instância** para enviar mensagens e o portal está usando a chave global (ou uma chave errada) | Crie/ajuste `EVOLUTION_INSTANCE_TOKEN` com o token da instância e faça Deploy. O sistema **pausa o envio por 10 minutos** depois de 3 recusas seguidas, avisa uma vez no sino e depois tenta de novo sozinho; as mensagens **não se perdem** |
| **Mensagens com erro** no quadro | O envio falhou 5 vezes (instância desconectada, Evolution fora do ar, chave errada) | Leia o motivo resumido, corrija (reconectar o número, conferir `EVOLUTION_*`). As novas mensagens voltam a fluir; as que deram erro **não** são reenviadas sozinhas |
| Estado da instância **Desconectada** (e aviso no sino) | O celular do chip perdeu a conexão ou o WhatsApp derrubou o aparelho | Na Evolution Go, leia o QR Code de novo. Depois toque em **Consultar agora** |
| Estado **"Aguardando conexão"** | Faltam as variáveis `EVOLUTION_*` ou ainda não houve consulta | Preencha as três variáveis, faça Deploy e toque em **Consultar agora** |
| Pessoa diz que **não recebe lembretes** | Número não verificado, ou ela escreveu **PARAR**, ou o perfil não permite confirmar doses | Em **Configurações › WhatsApp → Pessoas** veja "Número verificado". Peça para escrever **REATIVAR** |
| **"Não consegui te identificar por aqui"** para alguém que devia ser atendido | Número não verificado, desativado ou escrito diferente (ou duas pessoas com as duas formas, com e sem o 9, do mesmo número) | Confira o número da pessoa; refaça a verificação. O nono dígito é tratado sozinho; se duas pessoas tiverem as duas formas do mesmo número, nenhuma é reconhecida (seção 8) |
| *"O assistente de perguntas está indisponível"* | `ANTHROPIC_API_KEY` ausente ou inválida | Cadastre a chave no EasyPanel e faça Deploy. O resto funciona sem ela |
| *"O assistente de perguntas está pausado neste mês"* | Limite mensal de IA atingido | Aumente o limite em Configurações › WhatsApp, ou espere o mês virar |
| Áudio ou foto: *"não consegui entender"* / *"não consegui ler a foto"* | Veja o motivo em **Configurações › WhatsApp** ("Última falha de áudio/foto"): **modelo aposentado/404** → troque `GEMINI_MODEL` para `gemini-3.5-flash-lite` (ou apague a variável); **chave recusada (401/403)** → confira `GEMINI_API_KEY`; **formato não aceito** (a Gemini aceita ogg, mp3, wav, aac, flac, aiff, m4a, opus, webm); **vazia** (áudio sem fala); **sem conteúdo** (o webhook da Evolution não trouxe o áudio e o download falhou: ligue `WEBHOOK_FILES` na Evolution Go) | Corrija a causa mostrada e mande outro áudio. O log (`etapa: gemini`) traz o status HTTP, o `error.status`, o tipo e o tamanho em KB, sem conteúdo |
| **"Mensagens do WhatsApp não estão saindo"** no sino | 5 falhas de envio seguidas | Confira se o número está conectado e as variáveis `EVOLUTION_*` |
| Dois lembretes iguais | Não deveria acontecer (há trava contra duplicidade) | Anote a hora e avise: é um defeito |
| A tela do simulador não aparece | `SIMULATOR_ENABLED` não está `1` (ou você não é Administrador) | Só no staging; produção fica sem simulador |

## 8. Limitações conhecidas
- O formato real do webhook da Evolution Go ainda **não foi conferido com mensagens reais** (por isso a Parte B do roteiro começa com um teste de captura).
- **Nono dígito:** o portal reconhece o celular brasileiro **com ou sem o 9** (cadastre como a pessoa usa). Se duas pessoas tiverem as duas formas do mesmo número, nenhuma é atendida (por segurança). Para os lembretes, o sistema pergunta à Evolution Go qual forma existe no WhatsApp e guarda a que funcionou; se o número não existir numa forma, tenta a outra **uma vez**. Detalhes em `docs/handoffs/L4B-limpeza.md`. A consulta `/user/check` e o texto do erro **ainda não foram conferidos com número real**.
- **Avisos antigos não viram mensagem:** o aviso de dose esquecida só é enviado se o horário foi nas últimas 6 horas; doses mais antigas aparecem só no portal. Ao ligar o worker não chega uma enxurrada de avisos de ontem.
- Os tetos de mensagens por minuto/hora valem **por servidor**. Com um único portal (o normal), valem para o número inteiro.
- Se o processo cair no meio de **enviar** uma resposta, ela **não é reenviada** (preferimos perder uma resposta a responder em dobro). O mesmo vale para lembretes cujo envio não teve resposta clara do provedor.
- O sistema só trata texto, áudio e foto. Figurinha, vídeo, documento e localização recebem *"só entendo texto, áudio e foto"*. Grupos são ignorados.
- O provedor oficial da Meta ainda não está implementado (a interface já permite trocar).
