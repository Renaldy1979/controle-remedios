# Lote 3 — Roteiro de teste: receitas e reposição

**Para quem testa:** o dono do projeto, no computador **e** no celular.
**Onde:** o staging (`https://automacoes-medcuidar-app.8m5sgi.easypanel.host`, veja `docs/09-deploy-staging.md`).
**Tempo:** cerca de 60 minutos (a Parte 0, que você faz uma vez, leva uns 15).
**Como registrar:** preencha `docs/lotes/L3-validacao.md`.

## O que você vai precisar
- A família do Lote 1 e 2 (administrador, o Adelino cadastrado) e a **Filha** (perfil **Familiar**). Se ela não existe mais, convide de novo em **Configurações → Pessoas** (e-mail com `+`, como antes).
- Uma terceira pessoa com perfil **Confirmador** (ex.: `seunome+neto@gmail.com`): ela serve para provar que **quem não pode ver receitas não vê**. Convide em **Configurações → Pessoas**.
- O computador e o celular. Para a Filha e o Confirmador use **janelas anônimas** diferentes (ou outros navegadores).
- **2 ou 3 fotos** de uma receita qualquer (pode ser uma foto de teste, de revista, de uma folha com texto) e, se quiser, **um PDF** pequeno.
- Acesso ao **Console do Appwrite** (Parte 0).

> Marque cada passo: ✅ passou · ❌ não passou (anote o que viu). O **Resultado esperado** diz o que deveria aparecer.

---

## Parte 0 — Atualizar o staging (você faz uma vez, antes de testar)

O Lote 3 precisa de **três coisas novas**: o **bucket de receitas** no Appwrite, a **chave do Appwrite com mais permissões** e **uma migração do banco**. Todos os passos detalhados estão em `docs/09-deploy-staging.md`, **seção 11**; aqui vai o resumo na ordem.

> **Já feito pelo dono:** os passos 1 e 2 (criar o bucket e ampliar a chave) **já foram feitos**. Abaixo fica só **como conferir** que estão certos. Conferência de leitura feita pelo desenvolvimento em 21/10/2026 com a chave do `.env`: bucket `prescriptions` existe, **sem nenhuma permissão**, file security ligada, criptografia ligada, máximo 15 MB, extensões jpg/jpeg/png/webp/pdf/heic, antivírus desligado (opcional), 0 arquivos. Confira no Console que o do **staging** está igual.

1. **Conferir o bucket** (seção 11.1; criado pelo dono): Console do Appwrite → **Storage → Create bucket**, ID `prescriptions`, **sem permissões**, **File security ligada**, tamanho máximo **15 MB**, extensões `jpg, jpeg, png, webp, heic, pdf`, **Encryption ligada** (antivírus se aparecer). Se já existir um `prescriptions` vazio, só confira esses ajustes.
2. **Conferir a chave** (seção 11.2; já ampliada pelo dono): **API keys → `medcuidar-staging`** → acrescente os escopos `files.read`, `files.write` e `buckets.read` (**só esses**).
3. **Variáveis** (seção 11.3): no serviço `medcuidar-web` do EasyPanel acrescente `APPWRITE_PRESCRIPTIONS_BUCKET_ID` = `prescriptions` e `FILE_URL_SECRET` = 32 ou mais letras e números aleatórios (é um segredo).
4. **Deploy** do código novo (pelo Git, como no Lote 1). Só depois do deploy, no mesmo serviço, abra **Console** e **rode a migração** (o Lote 3 **traz** migração `0005`; troque `SENHA_DONO`, `HOST` e `NOME_DO_BANCO`, mantenha as aspas simples):
   ```bash
   DATABASE_URL_ADMIN='postgres://medcuidar_owner:SENHA_DONO@HOST:5432/NOME_DO_BANCO' node /app/migrate/migrate.mjs
   ```
   Deve responder `Migrações aplicadas.` (pode rodar de novo sem problema).
5. Abra `…/api/health`: deve mostrar `{"status":"ok","database":"ok"}`.
6. Entre como administrador e abra **Receitas → Anexar receita**: **não** pode aparecer o aviso amarelo "O armazenamento das receitas ainda não foi configurado". Se aparecer, volte aos passos 1 a 3 (e faça o Deploy de novo depois de mexer nas variáveis).

---

## Parte A — Configurações como árvore (ajuste que você pediu no Lote 2)

| # | Faça | Resultado esperado |
|---|---|---|
| A1 | No **computador**, abra **Configurações** no menu lateral. | Abre a página **Configurações** com uma lista de cartões (Remédios, Esquemas, Estoque, Pacientes, Pessoas, Perfis, Avisos), cada um com ícone e uma frase curta. No menu lateral, **Configurações** tem uma setinha. |
| A2 | Toque em **Remédios**. | Abre **a página própria** `…/configuracoes/remedios`. Título grande **Remédios**, acima dele o caminho **Configurações › Remédios**. No menu lateral, **Configurações** fica **aberta** e **Remédios** aparece destacado. Já não parece que você está "editando um remédio": é a página da lista. |
| A3 | Pelo menu lateral, toque em **Esquemas**, depois **Estoque**, **Pessoas**… | Cada um abre sua página, com seu título e o caminho "Configurações › …". O item atual fica destacado em cada uma. |
| A4 | Toque na **setinha** ao lado de **Configurações** no menu. Depois use o **teclado**: `Tab` até a setinha e `Enter`. | A lista de opções **recolhe e abre**. Com o leitor de tela/teclado, a setinha anuncia "aberto/fechado". |
| A5 | No **celular**, toque em **Ajustes** (barra de baixo). | Abre a página **Configurações** com os cartões grandes (fáceis de tocar). |
| A6 | Toque em **Estoque**, depois em **← Configurações** (no alto). | Abre a página Estoque e o botão **voltar** leva de novo à lista. |
| A7 | Entre como o **Confirmador** (janela anônima). | Ele **não** vê **Configurações** no menu. Se digitar o endereço `…/configuracoes/perfis`, aparece "Esta área não está liberada para o seu perfil". |
| A8 | Entre como a **Filha (Familiar)**. | Ela vê em Configurações só **Estoque** (e o que o perfil dela permite); não vê Pessoas nem Perfis. |
| A9 | Abra o endereço antigo `…/configuracoes/usuarios`. | Leva para `…/configuracoes/pessoas` (o link antigo continua valendo). |

## Parte B — Anexar a receita (foto e PDF), ver e validade

| # | Faça | Resultado esperado |
|---|---|---|
| B1 | **Configurações → Remédios → Novo remédio**. Paciente *Adelino*, nome **Teste Lote 3**, tipo **Comprimido**, unidade **Unidade**, **Estoque inicial 60**. Confira a caixa **Este remédio exige receita** (vem marcada). Cadastrar. | Aviso "Teste Lote 3 cadastrado". Em **Esquemas** deixe de 8 em 8 horas (como no Lote 2). |
| B2 | Abra **Pacientes → Adelino** e o **Início**. | O *Teste Lote 3* mostra **"Sem receita anexada"** (com ícone e texto). No Início, em **Receitas**, ele aparece com os botões **Anexar receita**. |
| B3 | No **celular**, abra **Receitas → Anexar a primeira receita → Tirar foto**. Tire a foto da primeira página. | A foto aparece com **Girar**, **Recortar** e **Remover**. |
| B4 | Toque em **Adicionar página** e escolha a **segunda foto** (ou um **PDF**). Toque em **Continuar**. | "Página 2 de 2". As duas aparecem como miniaturas no alto. |
| B5 | No passo 3: confira o paciente, a **Data da receita** (digite só números: `19102026` vira `19/10/2026`), escolha o remédio **Teste Lote 3** e toque em **Mais detalhes**: médico, especialidade, **Validade 30 dias**, vias de controle especial, observações. **Salvar receita**. | Barra de envio e **"Receita salva"**. Aparece também "Vence em dd/mm/aaaa". |
| B6 | Toque em **Ver receita**. | Página da receita: situação **Vigente**, "Válida até …", as 2 páginas, **Anexada por (seu nome) e quando**, remédio, observações. |
| B7 | Toque na foto grande. | **Tela cheia**: ← → trocam de página, **+ e −** dão zoom (até 300%), **Esc** fecha. Se a página 2 for PDF, ele aparece num quadro. |
| B8 | Volte à página da receita e atualize. | Em **Quem já viu** aparece **o seu nome** com a hora. |
| B9 | **Pacientes → Adelino** e **Início**. | O *Teste Lote 3* mostra **"Receita vigente"**, com **Ver receita** (abre a mesma receita). |
| B10 | Tente anexar um **arquivo que não é foto nem PDF** ou **um com mais de 15 MB**. | A tela recusa e diz por quê ("não é foto nem PDF" / "passa de 15 MB"); nada é enviado. |

## Parte C — Compartilhar e quem pode ver

| # | Faça | Resultado esperado |
|---|---|---|
| C1 | Na receita, toque em **Compartilhar**. | Só existe **"Na família"** (o envio pelo WhatsApp chega no Lote 4). Aparecem a Filha e o Confirmador; o **Confirmador** vem **bloqueado**, com "Sem permissão para ver receitas". |
| C2 | Marque a **Filha** e toque em **Compartilhar com 1**. | Aviso "Receita compartilhada com Filha". Na página da receita, no **Histórico**, aparece "Compartilhada com Filha" (por você, com a hora). |
| C3 | Na janela da **Filha**, abra **Receitas**. | A receita aparece com a etiqueta **"Compartilhada por (seu nome)"**. Abra a receita e a foto em tela cheia. |
| C4 | Volte à janela do administrador e atualize a receita. | Em **Quem já viu** aparecem **você e a Filha**. A etiqueta "Compartilhada por…" some para ela. |
| C5 | Na janela do **Confirmador**, abra **Receitas** (menu ou endereço). | Não existe "Receitas" no menu dele e a tela diz **"Esta área não está liberada para o seu perfil"**. Em **Pacientes** ele vê **"Receita vigente"** (só a situação), **sem** botão para abrir a receita. |
| C6 | Na página da receita (administrador), toque em **Acesso restrito · N pessoas**. | Lista **quem pode ver** e **quem não pode** (o Confirmador). |

## Parte D — Avisos "a receita vence em X dias"

| # | Faça | Resultado esperado |
|---|---|---|
| D1 | Cadastre o remédio **Teste vencimento** (Adelino, comprimido, **exige receita**). Anexe **uma** receita só dele, com **Data da receita = 20 dias atrás** (digite a data) e **Validade 30 dias** (vence em 10 dias). | A receita aparece como **Vigente** e **"Vence em 10 dias"** (com ícone de calendário e texto, não só cor). Em **Pacientes** o remédio diz **"Receita vence em 10 dias"**. |
| D2 | Olhe o **sino**, de você **e da Filha** (atualize a página). | Cada um tem **1 aviso novo**: "Receita vence em 10 dias: Teste vencimento (Adelino)", com o link para a receita. |
| D3 | O **Confirmador** e a **Cuidadora** (se existir): olhe o sino. | **Não** recebem esse aviso. |
| D4 | Atualize a página várias vezes. | O aviso **não se repete** (um por pessoa). |
| D5 | Cadastre **Teste vencimento 2** (exige receita) e anexe uma receita só dele com **Data = 28 dias atrás** e **Validade 30 dias** (vence em 2 dias). | **Um aviso novo** para você e para a Filha: "Receita vence em 2 dias…" (o limite de 3 dias). Atualizar de novo não repete. |

> Os avisos saem em **15, 7, 3 e 0 dias** antes de vencer (e mais um depois de vencida), **uma vez por limite**, e só pela receita que **hoje cobre** o remédio (a mais nova). Por isso o teste usa um remédio só para a receita que vence.

## Parte E — Reposição: do estoque baixo até o estoque atualizado

| # | Faça | Resultado esperado |
|---|---|---|
| E1 | **Configurações → Estoque → Ajuste manual**: ponha o *Teste Lote 3* em **6** (cerca de 2 dias), motivo "conferi". | O cartão fica **Crítico**. |
| E2 | Abra o **Início**. | No cartão do *Teste Lote 3*: situação da receita, **"Reposição · etapa 1 de 4 · pedir receita ao médico"**, **"Ninguém assumiu ainda"** e os botões **Ver receita**, **Registrar compra** e **Eu cuido disso**. A reposição **abriu sozinha**. |
| E3 | Na janela da **Filha**, abra o Início e toque em **Eu cuido disso**. | Aviso "Combinado: Teste Lote 3. A família foi avisada." O cartão dela passa a dizer **"Você vai pedir a receita"**. |
| E4 | No administrador, atualize o Início e toque em **Ver reposição**. | A folha mostra as **4 etapas** (Pedir receita ao médico, Receita recebida, Comprado, Estoque atualizado), a etapa atual e **"Filha vai pedir a receita"** com o dia e hora. **Duas pessoas não ficam na mesma etapa**: o botão agora é **Assumir no lugar**. |
| E5 | Toque em **Assumir no lugar**. | "Você vai pedir a receita". Em **Registros**: "Assumiu: vai pedir a receita" (Filha) e o seu, cada um com data e hora. O sino da Filha avisa a troca. |
| E6 | Na janela da Filha, tente **marcar a etapa como feita**. | Ela **não** consegue concluir a etapa que você assumiu ("Outra pessoa assumiu esta etapa…"). |
| E7 | No administrador, toque em **Marcar etapa feita**. | "Etapa concluída". Agora é a etapa **2 de 4 · receita recebida**, e a receita atual passa a **"Aguardando nova receita"**. |
| E8 | Toque em **Eu cuido disso** e depois em **Anexar receita recebida** (ou **Marcar etapa feita**). Anexe **uma foto** da receita nova (data de hoje). | A receita nova é salva e a reposição **avança sozinha** para **etapa 3 de 4 · comprado**. A receita antiga (que estava "aguardando nova") aparece como **Substituída** em **Receitas → Substituídas**. |
| E9 | Toque em **Eu cuido disso** e **Marcar etapa feita**; informe **60** em "Quanto foi comprado?" e **Confirmar compra**. | "Compra registrada: 60…". O cartão **sai** de "Estoque perto de acabar". |
| E10 | **Configurações → Estoque**. | O saldo subiu **6 → 66**. Em **Movimentações** aparece **"Compra · Teste Lote 3 +60"** (uma só vez). A previsão em dias subiu. |
| E11 | Abra o **Histórico** (menu). | Junto das doses aparecem os eventos: **Receita anexada**, **Receita compartilhada**, **Assumiu a reposição**, **Etapa de reposição concluída** e **Reposição concluída**, com quem fez e a hora. |
| E12 | Remédio **sem receita**: cadastre **Teste sem receita** (Pacientes: Adelino) **desmarcando** "Este remédio exige receita", estoque 60, e baixe o estoque para 3 (ajuste). | A reposição abre já na **etapa 3 de 4 · comprado** (as etapas 1 e 2 aparecem como **"Não se aplica"**, "Vendido sem receita"). |
| E13 | Em **Registrar compra** (Estoque) do *Teste sem receita*, informe 30. | A compra entra **uma vez** e a reposição **se encerra**. |

## Parte F — Segurança dos arquivos

| # | Faça | Resultado esperado |
|---|---|---|
| F1 | Na página da receita, **clique com o botão direito na foto → Copiar endereço da imagem**. Abra o endereço numa **janela anônima** (sem login). | **Não abre** a imagem (erro de acesso). |
| F2 | Cole o mesmo endereço na janela do **Confirmador** (logado). | **Não abre** (sem permissão). |
| F3 | Na janela da **Filha**, cole também o endereço copiado pelo administrador. | **Não abre** (o link é da pessoa que o gerou). |
| F4 | No administrador, espere **mais de 10 minutos** com o endereço copiado e abra-o de novo. | **Não abre** mais (o link vale só uns minutos); a tela gera links novos sozinha ao atualizar. |
| F5a | Copie o endereço direto do arquivo no Appwrite (Console → Storage → Receitas → arquivo → **View**/endereço) e abra numa **janela anônima**. | **Não abre** (erro de acesso): o bucket não tem permissão pública e o arquivo foi gravado sem permissão nenhuma. |
| F5 | No **Console do Appwrite → Storage → Receitas → Files**. | Os arquivos têm nome **`rx-p1.jpg`**, **`rx-p2.jpg`** (neutro) e **nenhuma permissão de leitura**. O bucket não tem "Any" nas permissões. |
| F6 | Comece a anexar uma receita e **desligue a internet** do aparelho antes de **Salvar receita**. | O envio avisa que **não foi salvo** e que as fotos continuam no aparelho; **Tentar de novo** funciona quando a internet volta. |

## Parte G — Excluir e desfazer

| # | Faça | Resultado esperado |
|---|---|---|
| G1 | Na página de uma receita de teste, toque em **Excluir** e confirme. | Aviso "Receita excluída" com **Desfazer**. A receita some da lista e o endereço da foto passa a **não abrir**. |
| G2 | Toque em **Desfazer** (você tem alguns segundos). | A receita **volta**. |
| G3 | Exclua de novo e **não** desfaça; abra o **Histórico**. | Aparece "Receita excluída" com quem fez e a hora. |
| G4 | A Filha (Familiar não tem a permissão de excluir): abra uma receita. | **Não** existe o botão **Excluir** para ela. |

---

## O que **não** vem neste lote (para você não estranhar)
- Compartilhar a receita **pelo WhatsApp** e os avisos de receita/reposição **no WhatsApp**: Lote 4. Hoje tudo é no portal (sino).
- A foto de uma receita **excluída** continua guardada no bucket até a limpeza definitiva (Lote 5).
- Recortar a foto: o botão marca a área, mas o recorte automático é simples (gire e reduza no aparelho funcionam).
- Remédios criados **antes** do Lote 3 não exigem receita até você abrir **Configurações → Remédios** e marcar **Este remédio exige receita**.
- Limite de envio: até **20 páginas por receita**, **15 MB cada**, e cerca de **30 MB no total** de uma vez (fotos do celular são reduzidas sozinhas antes de enviar).
