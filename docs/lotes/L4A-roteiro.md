# Lote 4A — Roteiro de teste: API, validação do número e simulador de WhatsApp

**Para quem testa:** o dono do projeto, no computador (o simulador é uma tela de administrador).
**Onde:** o staging (`https://automacoes-medcuidar-app.8m5sgi.easypanel.host`, veja `docs/09-deploy-staging.md`, seção 12).
**Tempo:** cerca de 45 minutos (a Parte 0, que você faz uma vez, leva uns 10).
**Como registrar:** preencha `docs/lotes/L4A-validacao.md`.
**Importante:** neste lote **nenhuma mensagem real é enviada** e você **não precisa de número de WhatsApp do sistema**. O "WhatsApp" é o **simulador** dentro do portal, que fala com a mesma API que o N8N vai usar no Lote 4B.

## O que você vai precisar
- A família dos lotes anteriores (administrador, o Adelino e o remédio com estoque). Se quiser começar do zero, cadastre **um remédio com 10 comprimidos** e esquema de **1 dose por dia** em um horário **de 10 minutos atrás** (para a dose já estar "na hora"). Veja o passo 0.
- **Um número de celular qualquer** para cadastrar (pode ser o seu; **nada será enviado a ele**) e **um segundo número qualquer** (pode ser inventado, como `(11) 98888-7777`) para o convite por WhatsApp.
- Um **e-mail seu extra** (ex.: `seunome+rosa@gmail.com`) para a pessoa convidada por WhatsApp concluir o primeiro acesso, e o Appwrite enviando e-mail (SMTP) como no Lote 1.

> Marque cada passo: ✅ passou · ❌ não passou (anote o que viu). O **Resultado esperado** diz o que deveria aparecer.

---

## Parte 0 — Atualizar o staging (você faz uma vez, antes de testar)

O Lote 4A traz **uma migração do banco** e **uma variável opcional que liga o simulador**. Detalhes em `docs/09-deploy-staging.md`, **seção 12**.

> ⚠️ **Variáveis, uma a uma.** A única que você **precisa criar** é `SIMULATOR_ENABLED`. As demais já existem de lotes anteriores. A que **todo mundo esquece**: `APP_URL` é **obrigatória, sem valor padrão** (já existia desde o Lote 1) e agora também forma o link de primeiro acesso. Confira que está igual ao endereço do staging, **sem barra no fim**.

| Variável | Valor de exemplo | Segredo? | Obrigatória? |
|---|---|---|---|
| `SIMULATOR_ENABLED` | `1` | não | só se quiser o simulador (você quer, no staging). **Nunca em produção** |
| `APP_URL` | `https://automacoes-medcuidar-app.8m5sgi.easypanel.host` | não | **sim, sem valor padrão** (já configurada) |
| `SUPPORTS_BUTTONS`, `PLATFORM_KEYS_FROM_PORTAL` | *(não crie agora)* | não | não: ficam para o Lote 4B |
| `DATABASE_URL`, `APPWRITE_*`, `FILE_URL_SECRET`, `APPWRITE_PRESCRIPTIONS_BUCKET_ID` | os de antes | `DATABASE_URL`, `APPWRITE_API_KEY` e `FILE_URL_SECRET` são segredos | sim (já configuradas) |

1. No serviço `medcuidar-web` do EasyPanel → **Environment**: acrescente `SIMULATOR_ENABLED` = `1`. Salve.
2. **Deploy** do código novo (pelo Git, como nos lotes anteriores). Esse deploy já traz o ajuste de layout que você pediu no Lote 3 (botão principal na linha do título).
3. Só depois do deploy, no mesmo serviço, abra **Console** e rode a migração (troque `SENHA_DONO`, `HOST`, `NOME_DO_BANCO`; mantenha as aspas simples):
   ```bash
   DATABASE_URL_ADMIN='postgres://medcuidar_owner:SENHA_DONO@HOST:5432/NOME_DO_BANCO' node /app/migrate/migrate.mjs
   ```
   Deve responder `Migrações aplicadas.`
4. Abra `…/api/health` → `{"status":"ok","database":"ok"}`. Abra `…/api/v1/openapi.json` → aparece um JSON longo com as rotas.
5. Entre como administrador → **Configurações**. Devem aparecer **WhatsApp** e **Simulador de WhatsApp**.

0. **Preparar o remédio (se precisar):** **Configurações → Remédios → Novo remédio** (paciente Adelino, nome **Zypred**, comprimido, unidade, **estoque inicial 10**). Em **Esquemas**, 1 vez ao dia com o **primeiro horário 10 minutos atrás** (ex.: se são 14:25, ponha 14:15). Em **Pacientes → Adelino** a dose aparece e o estoque mostra 10.

---

## Parte A — Cadastrar e verificar o número

| # | Faça | Resultado esperado |
|---|---|---|
| A1 | **Configurações → WhatsApp**. | Cartão **Meu WhatsApp** com a etiqueta **Não informado**. Abaixo, **Pessoas** (você, com "Sem número") e **Chaves de API da família**. |
| A2 | Digite o seu número (com DDD) e toque em **Gerar código**. | A etiqueta vira **Pendente de validação** e aparece uma caixa com **um código de 6 dígitos grande** e o texto "Envie este código, pelo WhatsApp do número …, para o WhatsApp do sistema. Vale até às HH:mm (15 minutos)". Anote o código. |
| A3 | Toque em **Gerar novo código**. | Aparece **outro** código. O primeiro deixa de valer (você vai conferir em A6). |
| A4 | **Configurações → Simulador de WhatsApp**. | No alto, faixa amarela **"Simulador: nenhuma mensagem real é enviada"**. À esquerda a conversa (com o seletor **Falar como**); à direita **"Mensagens que o sistema enviaria agora"**. |
| A5 | Em **Falar como**, escolha você (o número aparece como **pendente**). Escreva **tomei** e envie. | **O simulador não é atendido**: a resposta é genérica ("Não consegui te identificar por aqui…"), **sem nenhum nome, remédio ou família**. O estoque não mexe. |
| A6 | Envie o **primeiro** código (o antigo, de A2). | "⚠️ Código inválido". |
| A7 | Envie o **código atual**, por exemplo `CÓDIGO 123456` ou só os 6 dígitos. | "✅ Número verificado — Pronto, (seu nome)!" |
| A8 | Volte em **Configurações → WhatsApp**. | A etiqueta é **Verificado** e a lista **Pessoas** mostra "Número verificado". |
| A9 | Em **Minha conta** (menu do perfil) olhe o cartão do WhatsApp. | É o mesmo cartão: **Verificado**, com **Trocar número** e **Remover número**. |
| A10 | (Opcional) **Trocar número** e gere um código para outro número. | O número verificado **deixa de valer** na hora: no simulador, escrever como o número antigo volta à resposta genérica. Refaça A2 e A7 para voltar. |

## Parte B — Conversa: confirmar dose, estoque e próximas doses

| # | Faça | Resultado esperado |
|---|---|---|
| B1 | No simulador, toque em **Atualizar** no painel da direita. | Aparece **"Hora do remédio — Adelino"** (Zypred, hora, **1 — Tomei** e **2 — Lembrar em 15 min**), para você. É a fila que o N8N leria no Lote 4B. |
| B2 | Toque em **Marcar como enviada**. | A mensagem some do painel e **aparece na conversa**, como se tivesse chegado no seu celular. |
| B3 | Envie **1**. | "✅ Anotado — Adelino: Zypred das HH:mm". |
| B4 | Abra **Pacientes → Adelino** (ou o Início). | A dose está **tomada, "por (você), canal WhatsApp"** e o estoque caiu de **10 para 9**. |
| B5 | Volte ao simulador e envie **tomei** de novo. | "Nenhuma dose pendente agora". **Nada é descontado de novo** (estoque continua 9). |
| B6 | Envie **estoque**. | "📦 Estoque — … Adelino — Zypred: N dias de estoque". Colírio, se houver, vem marcado como **estimativa**. |
| B7 | Envie **próximas doses**. | "🕒 Próximas doses" com as de hoje (ou "Não há mais doses hoje"). |
| B8 | Envie **ajuda** e depois uma frase solta, como *qual a melhor dieta?* | A ajuda lista o que dá para escrever. A frase solta mostra o aviso **"Texto livre: o agente de IA chega no Lote 4B"** (nenhuma resposta inventada). |
| B9 | (Se houver duas doses abertas ao mesmo tempo, ex.: dois remédios no mesmo horário) envie **tomei**. | Em vez de escolher uma, o sistema pergunta **"Qual dose você tomou?"** com a lista **1, 2…**; **só depois** da sua escolha baixa o estoque. Nunca adivinha. |

## Parte C — Fila de lembretes: dose e estoque baixo

| # | Faça | Resultado esperado |
|---|---|---|
| C1 | **Configurações → Estoque** e ajuste o saldo do Zypred para um valor **abaixo do limite** (ex.: 2 comprimidos). | O sino mostra o aviso de estoque baixo (como no Lote 2). |
| C2 | No simulador, **Atualizar**. | Aparece **"Estoque baixo — Adelino"** (Zypred, N dias) com **1 — Eu cuido disso**, para quem pode comprar. Quem não tem número verificado **não** aparece na fila (vê só o sino). |
| C3 | **Marcar como enviada** e envie **1**. | "🤝 Reposição assumida — Você cuida de Zypred". Em **Início/Estoque** a reposição mostra você como responsável. |
| C4 | Na conversa, envie **lembrar de novo** quando houver uma dose pendente (cadastre outra dose para daqui a pouco, se precisar). | "⏳ Combinado — lembro de novo em 15 min". Passado esse tempo, **Atualizar** mostra o novo lembrete. |

## Parte D — Convite por WhatsApp e primeiro acesso

| # | Faça | Resultado esperado |
|---|---|---|
| D1 | **Configurações → Pessoas → Convidar pessoa → Por código de WhatsApp**. Nome **Rosa**, perfil **Familiar**, celular = o **segundo número**. **Gerar código**. | O código aparece **uma vez**; vale 24 horas e só para aquele número. Anote. |
| D2 | No simulador, em **Falar como** escolha **Outro número…**, digite **um número diferente** do convidado e envie o código. | "⚠️ Código inválido". O código **não vale para outro número**. |
| D3 | Troque o número para o **segundo número** (o esperado) e envie o código. | "✅ Bem-vindo(a), Rosa" e um **link** `…/primeiro-acesso?t=…` ("vale 24 h, uso único"). Copie o link. |
| D4 | Ainda como Rosa, envie **estoque** e **tomei** (quando houver dose). | Funcionam: ela já dá o check e consulta estoque. Mas **eu cuido disso** responde "Só pelo portal" (receitas, reposição e administração exigem o acesso completo). |
| D5 | Em **Configurações → WhatsApp**, na lista **Pessoas**. | Rosa aparece com **WhatsApp verificado** e o botão **Reenviar link de acesso**. |
| D6 | Abra o link do D3 numa **janela anônima**. | Tela **Primeiro acesso**: "Rosa, você entrou na família … como Familiar. Seu WhatsApp já está confirmado". Campos: e-mail, senha, repita a senha. |
| D7 | Preencha com o e-mail extra e uma senha (8+ caracteres) e toque em **Criar meu acesso**. | Vai para **Confirme o seu e-mail**. Chega um e-mail do Appwrite. |
| D8 | Abra o e-mail, confirme e toque em **Já confirmei**. | Rosa entra no portal da família com o perfil **Familiar**. Em **Configurações → WhatsApp** (como admin), ela é **Acesso completo**. |
| D9 | Abra o **mesmo link** de novo. | "Este link não vale mais". |
| D10 | (Opcional) Crie outro convite e, antes de a pessoa usar, toque em **Reenviar link de acesso** quando ela estiver "WhatsApp verificado". | Aparece um **link novo**; o anterior deixa de valer. |

## Parte E — Chaves de API

| # | Faça | Resultado esperado |
|---|---|---|
| E1 | **Configurações → WhatsApp → Chaves de API da família**: nome *Teste* → **Criar chave**. | Caixa **"Copie agora: esta chave não será mostrada de novo"** com `cdf_…`. Toque em **Copiar** e depois em **Já copiei**. |
| E2 | Recarregue a página. | A chave aparece na lista **só com o nome e "cdf_…"**, "último uso: nunca". **O valor não aparece mais.** |
| E3 | (Opcional, para quem tem terminal) com a chave e o seu número verificado: `curl -H "Authorization: Bearer cdf_…" -H "X-Telefone: 55SEUNUMERO" https://…/api/v1/doses/proximas` | Responde `{"dados":[…]}`. Sem o cabeçalho de telefone: erro `telefone_obrigatorio`. Com um número que não é seu: `404`, **igual** a um número inexistente. |
| E4 | Toque em **Revogar**. | A chave fica **Revogada**. O mesmo `curl` agora dá `401 nao_autorizado`. |
| E5 | Abra `…/api/v1/openapi.json`. | Lista todas as rotas (doses, estoque, reposições, receitas, conversa, fila…). |

## Parte F — Segurança e o que **não** deve acontecer

| # | Conferir | Resultado esperado |
|---|---|---|
| F1 | Entre como **Filha (Familiar)** ou outro perfil sem Administrador. | Ela **não** vê **Simulador** nem **Chaves de API**; em **Minha conta** só vê o próprio número. |
| F2 | Com um perfil sem `members.manage`, abra `…/configuracoes/whatsapp` direto. | "Esta área não está liberada para o seu perfil". |
| F3 | O Confirmador **não** vê Configurações (como no Lote 1). | Igual ao Lote 1. |
| F4 | No simulador, tente falar como um **número que já pertence a outra família** (se tiver uma segunda família). | Recusa: "Esse número já pertence a outro cadastro". |

---

## Limitações conhecidas do Lote 4A
- **Nenhum envio real.** O envio pelo WhatsApp, o número do sistema, o Evolution Go, o N8N e o agente de IA são do **Lote 4B**.
- O limite de requisições (60 por minuto por telefone) vale por processo: com uma só instância do portal é exato.
- Resposta repetida de um **código de convite** (o mesmo `messageId` reenviado) não é guardada, porque a família só se conhece depois do código; pedir "link de acesso" gera outro link.
- `/membros`, `/perfis`, `/esquemas`, compra e ajuste de estoque pela API ficam para quando um fluxo do N8N precisar (o portal faz tudo isso).
- Receita pelo WhatsApp (envio da imagem) é do 4B; no 4A só existe a URL assinada de curta duração pela API.
- A auditoria de visualização de receita pela API grava `rx.api_urls` (quem pediu as URLs) e `rx.file_opened` (quem abriu a página).

## Se algo falhar
| Sintoma | O que fazer |
|---|---|
| Não aparece **Simulador** em Configurações | Falta `SIMULATOR_ENABLED=1` no serviço (ou você não é Administrador). Corrija e faça **Deploy** de novo |
| "relation outbound_messages does not exist" nos logs | A migração do passo 3 não rodou |
| O link do WhatsApp aponta para o endereço errado | `APP_URL` está diferente do endereço do staging (obrigatória, sem valor padrão) |
| O e-mail de confirmação não chega | O Appwrite precisa do SMTP (Lote 1). Dá para reenviar em **Confirme o seu e-mail** |
