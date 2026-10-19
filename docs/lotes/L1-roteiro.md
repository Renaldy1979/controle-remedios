# Lote 1 — Roteiro de teste: acesso e cadastros

**Para quem testa:** o dono do projeto, no computador **e** no celular.
**Onde:** o endereço do staging (`https://ENDEREÇO`, veja `docs/09-deploy-staging.md`).
**Tempo:** cerca de 40 minutos.
**Como registrar:** preencha `docs/lotes/L1-validacao.md` (o que passou, ajustes pedidos, pendências).

## O que você vai precisar
- 3 endereços de e-mail que você consiga abrir. Dica: com Gmail, `seunome+admin@gmail.com`, `seunome+filha@gmail.com` e `seunome+lima@gmail.com` chegam todos na mesma caixa.
- O computador e o celular. Para a segunda família use uma **janela anônima** (ou outro navegador), para não misturar com o login da primeira.

> Marque cada passo: ✅ passou · ❌ não passou (anote o que viu). O **Resultado esperado** diz o que deveria aparecer.

---

## Parte A — Conta, e-mail e família

| # | Faça | Resultado esperado |
|---|---|---|
| A1 | Abra o endereço do staging. | Aparece a tela **Entrar**, com cadeado (HTTPS) na barra. Há os links "Esqueci minha senha" e "Criar conta". |
| A2 | Toque em **Criar conta**. Informe seu nome, o e-mail `+admin`, uma senha de 8+ caracteres (repita) e toque **Criar conta**. | Vai para **Confirme o seu e-mail**, mostrando o seu e-mail. |
| A3 | Sem confirmar ainda, toque em **Já confirmei**. | Aparece "Ainda não vimos a confirmação…". O portal **não** deixa seguir. |
| A4 | Abra a sua caixa de e-mail e o e-mail do MedCuidar (veja o spam). Toque no link. | Abre **Confirmar e-mail** com o botão "Confirmar meu e-mail". |
| A5 | Toque em **Confirmar meu e-mail**, depois em **Continuar**. | Aparece "E-mail confirmado!" e a tela **Primeira entrada** (nome da família). |
| A6 | Digite o nome da família (ex.: *Família Souza*) e toque **Criar a família**. | Abre o **Início** com "Primeiros passos" e o aviso "Doses, estoque e receitas chegam nos próximos lotes". O menu mostra o seu nome com o perfil **Administrador**. |
| A7 | Toque em **Minha conta** (menu à esquerda no computador; ícone de pessoa no alto no celular) e depois **Sair**. | Volta para **Entrar**. |
| A8 | Tente entrar com uma senha errada. | Mensagem "E-mail ou senha incorretos." (sem dizer qual dos dois). |
| A9 | Toque em **Esqueci minha senha**, informe o e-mail e envie. Abra o e-mail, toque no link e crie uma nova senha. | Mensagem de que o e-mail foi enviado; depois "Senha atualizada. Entre com a nova senha." Entre com a nova senha: abre o Início. |
| A10 | Em **Minha conta**, informe seu celular com DDD e toque **Salvar número**. | O número fica com a etiqueta **Pendente de validação** e o texto "A validação chega no Lote 4". O portal continua funcionando normalmente. |

## Parte B — Pacientes, remédios e esquemas

| # | Faça | Resultado esperado |
|---|---|---|
| B1 | **Configurações → Pacientes → Cadastrar paciente**: *Adelino Souza*, nascimento `10/03/1942`. Salvar. | Aparece o cartão do Adelino com a idade e "Sem conta no portal". |
| B2 | Cadastre *Maria Souza*, observação "Alzheimer. Não usa celular." e **desmarque** "Usa celular". | O cartão da Maria mostra "Sem celular · os lembretes vão para quem está com ele(a)". |
| B3 | **Configurações → Remédios → Novo remédio**: paciente *Maria*, nome *Zypred*, marcas alternativas `Facoba, Vigadexa`, tipo de uso **Pingar**, unidade **Gotas**. | O campo "Gotas por ml" aparece com 20 e a dica de que o estoque de colírio é **estimativa**. Ao cadastrar, o Zypred aparece na lista da Maria e as marcas viram etiquetas. |
| B4 | Cadastre mais um remédio para o Adelino (ex.: *Losartana 50 mg*, **Comprimido**, **Unidade**). | Aparece na lista do Adelino. |
| B5 | **Configurações → Esquemas**, escolha o Zypred. Desligue **Fase única**, toque **Adicionar fase**. Na **Fase 1**: 3 em 3 horas, dura **15** dias. Na **Fase 2**: 6 em 6 horas, dura "até acabar". Toque **Salvar esquema**. | Aviso "Esquema de Zypred salvo". A barra mostra as duas fases e os horários gerados de cada uma. |
| B6 | Tente salvar uma fase com duração `0`. | Mensagem em vermelho dizendo que a duração precisa ser um número de dias. Nada é salvo. |
| B7 | Abra **Pacientes** (menu). | O cartão da Maria mostra o Zypred, as marcas, "de 3 em 3 h", **Fase 1 de 2 · dia 1** e os horários. |
| B8 | Exclua um remédio de teste e toque em **Desfazer** no aviso. | Some e volta. |

## Parte C — Pessoas, convites e perfis

| # | Faça | Resultado esperado |
|---|---|---|
| C1 | **Configurações → Pessoas → Convidar pessoa**. Deixe **Por e-mail**, nome *Filha*, e-mail `+filha`, perfil **Familiar**. | Aviso "Convite enviado a Filha". Na lista: **Convite pendente** com a validade (24 h). |
| C2 | No **celular**, abra o e-mail do convite e toque no link. | Tela "Você foi convidado(a)…" com o nome da família e o perfil **Familiar**. |
| C3 | Crie uma senha e toque **Criar senha e entrar**. | Entra no portal como *Filha* (perfil Familiar). Em **Configurações** ela vê poucas opções (sem Pessoas nem Perfis). |
| C4 | Tente abrir o mesmo link de convite outra vez. | "Este convite não vale mais." (uso único) |
| C5 | No computador, em **Pessoas**, toque **Editar** na Filha e troque o perfil para **Confirmador**. | Aviso de salvo. |
| C6 | No celular da Filha, atualize a página. | O item **Configurações** **desapareceu** do menu. Se ela digitar `/configuracoes/usuarios` no endereço, não aparece nada de administração. |
| C7 | **Convidar pessoa → Por código de WhatsApp**: nome *Dona Zélia*, celular `(99) 98888-7777`, perfil **Cuidadora**. Toque **Gerar código**. | Aparece um **código de 6 números** grande, o aviso "aparece só uma vez" e "O uso do código pelo WhatsApp chega no Lote 4". **Anote o código.** |
| C8 | Feche o aviso e olhe a lista. Atualize a página. | Dona Zélia aparece como **Convite pendente** ("Convite por WhatsApp · vale até…"). **O código não aparece mais em lugar nenhum.** |
| C9 | Em Dona Zélia, toque **Novo código**. | Aparece um código diferente (o anterior deixa de valer). |
| C10 | Toque **Desativar** na Filha e confirme. | Aviso "desativada". No celular dela, ao atualizar, volta para **Entrar**. Tentar entrar com a senha dela **não funciona**. |
| C11 | Toque **Reativar** na Filha. | Ela volta a ser **Ativa** e consegue entrar de novo. |
| C12 | **Configurações → Perfis**: ligue "Gerenciar usuários e perfis" para **Familiar** e desligue de novo. | A grade muda na hora e o **Administrador** aparece travado ("Sempre"). |

## Parte D — Segunda família (isolamento)

| # | Faça | Resultado esperado |
|---|---|---|
| D1 | Numa **janela anônima**, abra o staging e crie outra conta com o e-mail `+lima`. Confirme o e-mail e crie a família *Família Lima*. | Abre o Início, **vazio**: "Primeiros passos" sem pacientes e sem pessoas além de você. |
| D2 | Confira **Pacientes**, **Configurações → Pacientes / Remédios / Esquemas / Pessoas**. | Tudo vazio. **Nenhum** Adelino, Maria, Zypred, Filha ou Dona Zélia. |
| D3 | Cadastre um paciente *Teste Lima*. Volte à janela da primeira família e atualize. | O *Teste Lima* **não aparece** na primeira família. |

## Parte E — Celular, acessibilidade e aparência

| # | Faça | Resultado esperado |
|---|---|---|
| E1 | No celular, percorra Início, Pacientes e Configurações. | Nada fica cortado; botões fáceis de tocar; texto legível sem dar zoom. |
| E2 | Ative o **modo escuro** (ícone no menu). | Textos e botões continuam legíveis; avisos têm ícone **e** texto (não só cor). |
| E3 | Abra **Receitas** e **Histórico**. | Aparece "chega no Lote 3" / "chega no Lote 2", sem erro. |

---

## Limitações conhecidas (esperadas neste lote)
- Doses, estoque, receitas, histórico e avisos **ainda não existem** (próximos lotes).
- O WhatsApp fica **pendente**; a validação do número e o uso do código de convite chegam no **Lote 4**.
- O link do e-mail de convite do Appwrite vale por pouco tempo; se vencer, a própria tela oferece "Enviar um novo e-mail".
- Esquemas aceitam fases por **intervalo de horas** (ex.: 6 em 6 h). Horários fixos no dia (ex.: 8h, 14h, 20h) ainda não.
- Cada remédio é cadastrado para **um** paciente (para o mesmo remédio em dois pacientes, cadastre duas vezes).

## Quando terminar
Preencha `docs/lotes/L1-validacao.md`. O Lote 2 só começa depois do "validado".
