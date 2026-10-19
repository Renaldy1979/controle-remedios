# Lote 2 — Roteiro de teste: doses e estoque (o núcleo do problema)

**Para quem testa:** o dono do projeto, no computador **e** no celular.
**Onde:** o staging (`https://automacoes-medcuidar-app.8m5sgi.easypanel.host`, veja `docs/09-deploy-staging.md`).
**Tempo:** cerca de 45 minutos.
**Como registrar:** preencha `docs/lotes/L2-validacao.md`.

## O que você vai precisar
- A família que você criou no Lote 1 (ou uma nova), com o administrador. Vale usar o Adelino e o Zypred já cadastrados.
- Uma segunda pessoa para ver o sino. Pode ser a "Filha" do Lote 1 (perfil **Familiar**) e uma terceira com perfil **Confirmador**. Se elas não existem mais, convide de novo em **Configurações → Pessoas** (e-mails com `+`, como no Lote 1).
- O computador e o celular. Para a segunda pessoa use uma **janela anônima**.

> Marque cada passo: ✅ passou · ❌ não passou (anote o que viu). O **Resultado esperado** diz o que deveria aparecer.

---

## Parte 0 — Atualizar o staging (você faz uma vez, antes de testar)

O Lote 2 traz **uma coluna nova no banco** (`dose_events.remind_again_at`, usada pelo "Lembrar de novo"). O portal novo não sobe certo sem ela.

1. No EasyPanel, no serviço `medcuidar-web`, faça o **deploy** do código novo (pelo Git, como no Lote 1).
2. Depois do deploy, no mesmo serviço abra **Console** e rode (troque `SENHA_DONO`, `HOST` e `NOME_DO_BANCO` pelos valores do dono do Postgres; mantenha as aspas simples):
   ```bash
   DATABASE_URL_ADMIN='postgres://medcuidar_owner:SENHA_DONO@HOST:5432/NOME_DO_BANCO' node /app/migrate/migrate.mjs
   ```
   Deve responder `Migrações aplicadas.` A senha fica só neste comando (não vai para as variáveis do serviço). Pode rodar de novo sem problema.
3. Abra `…/api/health`: deve mostrar `{"status":"ok","database":"ok"}`.

> Não coloque dados de exemplo: o sistema **não** cria remédios nem doses sozinho. Você mesmo vai cadastrar tudo a seguir.

---

## Parte A — Remédio com estoque e as doses do dia

| # | Faça | Resultado esperado |
|---|---|---|
| A1 | **Configurações → Remédios → Novo remédio**. Paciente *Adelino*, nome *Teste Lote 2*, tipo **Comprimido**, unidade **Unidade**, **Estoque inicial 30**. Cadastrar. | Aviso "Teste Lote 2 cadastrado". |
| A2 | **Configurações → Esquemas**, escolha *Teste Lote 2*. Mantenha **Fase única**, toque no **−** de "horas entre as doses" até **8** (24 → 12 → 8), **Primeiro horário do dia: 06:00**, **Salvar esquema**. | Aviso "Esquema de Teste Lote 2 salvo". Os horários gerados são **06:00, 14:00 e 22:00**. |
| A3 | Abra **Pacientes → Adelino**. | O remédio aparece com **3 horários de hoje** (06:00, 14:00, 22:00) e a situação de cada um: *Esquecida* e *Atrasada* para os que já passaram, *Pendente* para os que ainda vão chegar. "0 de 3 doses tomadas hoje". O bloco de estoque mostra **30 comprimidos** e cerca de 10 dias. |
| A4 | Abra o **Início**. | Doses que já passaram aparecem em **Pedem atenção** (com texto "Atrasada há…" ou "Esquecida", não só cor); a próxima aparece em **Próximas doses**; *Estoque perto de acabar* mostra o remédio (cerca de 10 dias = faixa "Atenção"). **Receitas e reposição** mostram "chegam no Lote 3". |
| A5 | Atualize a página várias vezes. | **Nunca** aparecem doses repetidas (são sempre 3 por dia para esse remédio). |

> **Atraso e esquecida:** uma dose fica **atrasada** 15 minutos depois do horário e **esquecida** 2 horas depois. Você muda esses prazos em **Configurações → Avisos → Doses**.

## Parte B — Dar o check, e o estoque baixar sozinho

| # | Faça | Resultado esperado |
|---|---|---|
| B1 | Em **Pacientes → Adelino**, toque no primeiro horário (ou **Confirmar dose** no Início). | Aviso "Teste Lote 2 das HH:mm confirmada" com **Desfazer**. O horário vira **Tomada**, com *seu nome* e a hora de agora. O estoque passa de 30 para **29**. |
| B2 | Confirme as outras duas doses. | "3 de 3 doses tomadas hoje". Estoque: **27**. |
| B3 | Confirme de novo uma dose já tomada (toque duas vezes rápido no mesmo horário, ou confirme no Início e em Pacientes). | O estoque **não** desconta duas vezes. |
| B4 | Confirme uma dose e toque em **Desfazer** no aviso (você tem 8 segundos). | A dose volta a ficar pendente/atrasada e o estoque **volta** (ex.: 28 → 29). Confirmar de novo desconta **uma vez só**. |
| B5 | Numa dose **esquecida** (se houver), toque em **Registrar que tomou depois**. | A dose passa a *Tomada*, com o seu nome e a hora em que você registrou, e o estoque baixa. |
| B6 | Numa dose **atrasada** (Início), toque em **Lembrar de novo**. | Aviso "Vamos lembrar de novo em 15 min". *(O envio do lembrete pelo WhatsApp só existe no Lote 4: aqui fica apenas registrado.)* |
| B7 | **Configurações → Estoque.** | Lista **por urgência**. O cartão do remédio mostra dias restantes, a data em que acaba e "Avisa quando faltarem 7 dias". Em **Movimentações** aparecem: *Saldo inicial +30*, *Dose tomada −1* (uma por dose), *Dose desfeita +1*, etc., com quem fez e quando. |

## Parte C — Compra, ajuste manual e previsão

| # | Faça | Resultado esperado |
|---|---|---|
| C1 | Em **Estoque → Registrar compra**, escolha o remédio e digite **20**. | Antes de registrar aparece "Passa de X para Y dias". Ao registrar: aviso "Compra registrada" e o saldo sobe 20. |
| C2 | Em **Ajuste manual**, informe **quanto tem agora** (ex.: 25) e o motivo "conferi a caixa". | O saldo vira 25 e a movimentação mostra o **ajuste** (a diferença) com o motivo. O saldo **nunca é sobrescrito**: cada mudança é um movimento. |
| C3 | Cadastre um **colírio** (ex.: *Teste colírio*, paciente Maria, tipo **Pingar**, unidade **Gotas**, estoque inicial **120**). | O estoque aparece como "≈ 6,0 ml · 120 gotas" com o aviso de **Estimativa** (colírio é sempre estimativa). |
| C4 | Em **Esquemas**, mude o *Teste colírio* de 24 em 24 h para **3 em 3 h** e salve. | Em **Estoque**, os dias restantes **diminuem** (o consumo por dia aumentou) e a data de término muda. |

## Parte D — O limite de estoque baixo e o sino

**Como forçar o limite:** o aviso sai quando o estoque restante durar **7 dias ou menos** (padrão da família). O jeito mais rápido é baixar o saldo com um **ajuste manual**.

| # | Faça | Resultado esperado |
|---|---|---|
| D1 | Confira que o *Teste Lote 2* tem saldo alto (ex.: 45 = ~15 dias) e que o sino (no alto) está **sem número**, para **você e para a Filha** (janela anônima, perfil Familiar). | Sino sem número nas duas telas. |
| D2 | Em **Estoque → Ajuste manual**, ponha o *Teste Lote 2* em **12** (cerca de 4 dias). | O cartão fica **Crítico** (ícone + texto). O sino mostra **1** em **você**. |
| D3 | Na janela anônima (Filha, Familiar), atualize a página. | O sino da Filha também mostra **1**. |
| D4 | Toque no sino → **Avisos**. | Aparece "Estoque baixo: Teste Lote 2 (Adelino)", "Restam cerca de 4 dias… acaba …", marcado **Novo**, com o link **Ver estoque e registrar compra**. |
| D5 | Confirme mais uma dose, desfaça, confirme de novo. Atualize. | O aviso **não se repete**: continua **1** aviso por pessoa. |
| D6 | Na tela da Filha, toque **Marcar como lido**. | O sino da Filha some; o **seu** continua com 1 (cada pessoa lê o seu). |
| D7 | **Registre uma compra** de 60 e depois baixe o saldo de novo com ajuste para 12. | Um **aviso novo** (nova rodada), uma vez só. |
| D8 | **Configurações → Avisos → Estoque baixo**: aumente o limite padrão (ex.: para 20 dias). | Quem tem estoque abaixo de 20 dias passa a receber o aviso na hora. Também dá para definir **um limite só para um remédio** (lista "Limite por remédio"). |
| D9 | Veja **Quem recebe o aviso de estoque** (mesma tela). | Lista os usuários ativos que podem comprar/administrar (você e a Filha). Cuidadora e Confirmador **não** recebem. Quem não validou o WhatsApp vê o aviso **só no portal** (o envio por WhatsApp é do Lote 4). |

## Parte E — Perfis e permissões

| # | Faça | Resultado esperado |
|---|---|---|
| E1 | Entre como **Confirmador** (troque o perfil da Filha em **Pessoas → Editar**, ou convide outra pessoa). | Ela vê **Início** e **Pacientes**. **Não** vê Histórico, Estoque, Configurações nem o aviso de estoque no sino. |
| E2 | Como Confirmador, no **Início**: veja a próxima dose e toque **Confirmar dose**. | Funciona; a dose fica *Tomada* com o nome dela e o canal **Painel**. O estoque baixa normalmente. Ela **não** vê números de estoque. |
| E3 | Como Confirmador, tente abrir `/configuracoes/estoque` e `/historico` digitando o endereço. | "Esta área não está liberada para o seu perfil". |
| E4 | **Paciente com conta:** em **Pacientes → editar Adelino**, ligue a conta dele a uma pessoa (perfil Cuidadora ou Familiar). Entre com essa pessoa e confirme **a dose do Adelino** e **a de outro paciente** (ex.: Maria). | As duas funcionam, porque o que vale é a **permissão** "Confirmar dose" do perfil (não o tipo de usuário). Se você desligar "Confirmar dose" desse perfil em **Perfis**, as duas deixam de funcionar. |
| E5 | Como **Familiar** ou **Cuidadora**: abra o **Histórico**. | Vê o histórico. Só quem tem "Registrar compra e ajustar estoque" consegue registrar compra/ajuste. |

## Parte F — Histórico

| # | Faça | Resultado esperado |
|---|---|---|
| F1 | Abra **Histórico**. | Tabela (computador) ou linha do tempo (celular) com as doses: remédio, paciente, **situação** (texto + ícone), **quem deu**, **quando** e **canal** (Painel). |
| F2 | Filtre por **Paciente**, **Remédio**, **Quem deu**, **Período** (Hoje, Ontem, 7 ou 30 dias, Tudo) e por **situação** (Tomadas, Atrasadas, Esquecidas, Pendentes). | A lista muda e o contador ("N registros") acompanha. Sem resultado: "Nenhum registro com esses filtros" e **Limpar filtros**. |

## Parte G — Isolamento, celular e aparência

| # | Faça | Resultado esperado |
|---|---|---|
| G1 | Numa janela anônima, crie uma **segunda família** (e-mail novo, como no Lote 1) e cadastre um remédio com estoque 5. | Nada da primeira família aparece (doses, estoque, avisos, histórico). O aviso de estoque baixo dela **não** chega ao sino da primeira, e vice-versa. |
| G2 | No **celular**: Início, Pacientes, Estoque, Histórico e Avisos. | Nada cortado; botões fáceis de tocar; textos legíveis sem zoom; o sino aparece no topo. |
| G3 | **Modo escuro.** | Textos e botões legíveis; situações com ícone **e** texto. |

---

## Limitações conhecidas (esperadas neste lote)
- **WhatsApp:** nenhum lembrete de dose nem aviso sai pelo WhatsApp. "Lembrar de novo" só **registra o pedido**. O envio, o resumo diário e a escolha de quem recebe cada aviso são do **Lote 4**.
- **Receitas e reposição** (anexar foto, validade, "Eu cuido disso") são do **Lote 3**: o Início mostra só um aviso.
- As doses são geradas **ao abrir o portal** (e ao salvar um esquema). Se ninguém abrir o portal num dia, as doses desse dia só existem depois que alguém abrir. A geração automática sem o portal aberto chega com o agendador do Lote 4 (a função `ensureDosesForDay` já existe para isso).
- Um remédio recém-cadastrado já mostra as doses de **hoje** desde a meia-noite: as que já passaram aparecem como *atrasadas/esquecidas* (dá para "Registrar que tomou depois"). Isso é proposital, para você poder testar três doses a qualquer hora do dia.
- O **Desfazer** vale por 8 segundos na tela (o servidor aceita até 30 s) e só para quem deu o check.
- O aviso de estoque baixo usa o **limite em dias** (padrão 7). Remédios sem estoque registrado não geram aviso: registre uma compra ou o estoque inicial.
- O número de dias restantes considera o esquema atual (fases incluídas). Se a fase mudar, a previsão muda.
- Cada remédio é de **um** paciente (como no Lote 1).

## Quando terminar
Preencha `docs/lotes/L2-validacao.md`. O Lote 3 só começa depois do "validado".
