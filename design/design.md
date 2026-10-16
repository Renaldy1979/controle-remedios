# MedCuidar — Design para implementação

Sistema web responsivo (mobile-first) para famílias controlarem os remédios de idosos: lembretes de dose por WhatsApp, registro de quem deu cada dose, previsão de fim de estoque, receitas e reposição.

Interface em **português do Brasil**. Datas `dd/mm/aaaa` (curta `dd/mm`, com dia da semana `ter, 21/10`), horas em 24h `08:00`.

## Arquivos de referência (protótipos HTML)

| Arquivo | Conteúdo |
|---|---|
| `MedCuidar Design System.dc.html` | Tokens, componentes e estados, modo escuro, guia de uso |
| `MedCuidar App.dc.html` | **App funcional de referência.** Toda a lógica de estado, cálculos e regras está na classe `Component` |
| `MedCuidar Telas.dc.html` | Telas mobile (390px) e desktop (1280px), telas de apoio, WhatsApp |
| `MedCuidar Receitas.dc.html` | Receitas, anexar, compartilhar, reposição e os novos WhatsApp |

Use o `MedCuidar App.dc.html` como especificação de comportamento. Os dados fictícios estão nos `static` da classe (`MEDS`, `PAT`, `RX0`, `PEOPLE`, `STEPS`).

---

## 1. Princípios (não negociáveis)

1. **Acessibilidade primeiro.** Texto base 16px. 14px só para metadado não essencial. Nenhum texto abaixo de 13px.
2. **Alvos de toque ≥ 44px.** Ação principal de dose: 48–56px. "Tirar foto": 64px.
3. **Contraste:** texto principal e secundário AAA (≥ 7:1); metadados e status ≥ 4,5:1.
4. **Estado nunca só por cor.** Todo status = cor + ícone + texto.
5. **Leitura em 3 segundos:** o que precisa de atenção aparece primeiro (alertas no topo do Início).
6. **Tom calmo.** Vermelho só para o que falhou ou vai falhar. Frases gentis ("hora de pedir a receita"), nunca "ALERTA" ou caixa-alta.
7. **Foco sempre visível:** anel duplo `0 0 0 3px <surface>, 0 0 0 5px <brand>`.
8. `prefers-reduced-motion`: desligar shimmer e transições.

---

## 2. Tokens

Implementar como CSS custom properties com tema claro e escuro (`[data-theme="dark"]` ou `prefers-color-scheme`).

### 2.1 Cores — claro / escuro

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--bg` | `#F3F6FC` | `#0B1222` | Fundo da página |
| `--sf` | `#FFFFFF` | `#131C30` | Cartões, superfícies |
| `--sf2` | `#F7F9FD` | `#18233A` | Hover de linha, blocos internos |
| `--bd` | `#E3E8F2` | `#26324D` | Bordas de cartão, divisórias |
| `--bd2` | `#C9D2E3` | `#3A4766` | Bordas de campo e botão secundário |
| `--ink` | `#0E1A33` | `#EEF2FA` | Texto principal (16,8:1) |
| `--ink2` | `#4A5670` | `#B3BDD3` | Texto secundário (7,4:1) |
| `--ink3` | `#5E6A84` | `#9AA5BE` | Metadados (5,4:1) |
| `--br` | `#1F56E0` | `#8AB0FF` | Marca: botões, links, foco |
| `--br2` | `#1742B8` | `#AEC8FF` | Hover da marca |
| `--brt` | `#EAF0FF` | `#172647` | Fundo tonal da marca |
| `--onbr` | `#FFFFFF` | `#0B1222` | Texto sobre `--br` |
| `--neub` / `--neuf` | `#EEF1F7` / `#4A5670` | `#1E2942` / `#C3CCDF` | Chip neutro |
| `--trk` | `#E9EEF7` | `#26324D` | Trilho de barras |
| `--scrim` | `rgba(14,26,51,.5)` | `rgba(0,0,0,.6)` | Fundo de modal |

Azul decorativo (gráficos e ilustração, nunca texto): `#3B74F6`.

### 2.2 Cores semânticas

| Estado | Fundo | Texto/ícone | Barra | Borda forte | Escuro (fundo / texto / barra) |
|---|---|---|---|---|---|
| **ok** (tomada, estoque ok, vigente) | `#E3F5EC` | `#0B6B4A` | `#1E9E6E` | — | `#0F2E25` / `#6FDDB0` / `#3FBF8A` |
| **pendente** (normal do dia, aguardando) | `#EAF0FF` | `#1742B8` | — | — | `#172647` / `#9DBBFF` |
| **atenção** (atrasada, 8–14 dias, vence em breve) | `#FFF1DF` | `#9A4A00` | `#E08A1E` | `#F2CF9E` | `#33240F` / `#F7BD72` / `#E9A04A` |
| **crítico** (esquecida, ≤ 7 dias, vencida, excluir) | `#FDECEC` | `#B4232A` | `#D8434A` | `#F2B8BA` | `#3A1518` / `#FF9A9A` / `#F06A6A` |

Superfície de cartão "atrasada": `--ltsf: #FFFAF2` (escuro `#1E1A14`).
Botão perigo: `#B4232A`, hover `#8F1A20`, texto branco.

### 2.3 Status → ícone → texto

| Domínio | Estado | Ícone (Material Symbols Rounded, FILL 1) | Rótulo |
|---|---|---|---|
| Dose | Tomada | `check_circle` | Tomada |
| Dose | Pendente | `schedule` | Pendente |
| Dose | Atrasada | `alarm` | Atrasada |
| Dose | Esquecida | `cancel` | Esquecida |
| Estoque | Ok (> 14 dias) | `inventory_2` | Estoque ok |
| Estoque | Atenção (8–14) | `hourglass_bottom` | Atenção |
| Estoque | Crítico (≤ 7) | `report` | Crítico |
| Receita | Vigente | `verified` | Vigente |
| Receita | Vence em ≤ 15 dias | `event_upcoming` | "Vence em X dias" (texto âmbar, chip continua Vigente) |
| Receita | Vencida | `event_busy` | Vencida |
| Receita | Aguardando nova | `hourglass_top` | Aguardando nova |
| Receita | Substituída | `swap_horiz` | Substituída |
| Canal | WhatsApp / Painel | `chat` / `computer` | WhatsApp / Painel |

### 2.4 Tipografia

- **Títulos, horários e números:** Plus Jakarta Sans 600–800.
- **Texto e interface:** Atkinson Hyperlegible Next 400/700 (fallback Atkinson Hyperlegible, depois system-ui).
- **Placeholders de imagem:** monospace.

| Estilo | Fonte · peso | Tamanho/altura | Letter-spacing |
|---|---|---|---|
| Display | Jakarta 800 | 40/44 | -0.025em |
| Título 1 | Jakarta 800 | 28/36 | -0.02em |
| Título 2 | Jakarta 700 | 22/30 | -0.01em |
| Horário | Jakarta 800, `tabular-nums` | 24/28 (destaque 32) | -0.02em |
| Título 3 | Atkinson 700 | 18/26 | 0 |
| Corpo grande | Atkinson 400 | 18/28 | 0 |
| Corpo (base) | Atkinson 400 | 16/24 | 0 |
| Legenda | Atkinson 400 | 14/20 | 0 |

`text-wrap: pretty` em parágrafos e `balance` em títulos.

### 2.5 Espaçamento, raios, sombras

- **Espaçamento base 4:** 4, 8, 12, 16, 20, 24, 32, 48, 64.
- **Raios:** `sm` 8 (checkbox, tag), `md` 12 (botão, campo), `lg` 16 (cartão), `xl` 24 (modal, sheet), `pill` 999 (chip, abas).
- **Sombras** (tom azulado):
  - `sm`: `0 1px 2px rgba(16,40,100,.06)`
  - `md`: `0 4px 16px rgba(23,66,184,.10)`
  - `lg`: `0 16px 40px rgba(23,66,184,.18)`

### 2.6 Ícones

Material Symbols Rounded, preenchido (`'FILL' 1`). Tamanhos: 18–20px em chips, 22–24px em ações, 26–28px em blocos de ícone (48–52px, raio 14, fundo `--brt`).

---

## 3. Componentes

Todos com estados: padrão, hover, foco, desabilitado e erro, quando se aplicam.

| Componente | Especificação |
|---|---|
| **Botão primário** | h48 (grande 56), r12, `--br`/`--onbr`, 700 16px, ícone opcional à esquerda. Hover `--br2`. Desabilitado `#E3E8F2`/`#7C869C`. Carregando: spinner e texto "Salvando…" |
| **Secundário** | h48, borda 1.5 `--bd2`, fundo `--sf`, texto `--br`. Hover fundo `--brt` e borda `--br` |
| **Fantasma** | sem borda, texto `--br`. Hover `--brt` |
| **Perigo** | `#B4232A`. Versão contorno: borda `--msbd`, texto `--msf` |
| **Botão de ícone** | 44×44, r12, sempre com `aria-label` |
| **Campo** | h48, r12, borda 1.5 `--bd2`. Foco: borda `--br` e halo `0 0 0 3px rgba(31,86,224,.2)`. Erro: borda `#B4232A`, fundo `#FFF8F8`, mensagem 15px 700 com ícone `error`. Rótulo 700 acima; "· opcional" em `--ink3` |
| **Select** | Igual ao campo, chevron `expand_more`. Quando o filtro está ativo: borda `--br` e texto 700 |
| **Chip de seleção** | h44, pill, borda 1.5. Selecionado: `--brt`/`--pnf`/borda `--br`. Usar `aria-pressed` |
| **Checkbox / rádio / switch** | Caixa 24px r8, rádio 24px, switch 52×32 com ícone `check`/`close` no knob. Área clicável ≥ 44px |
| **Chip de status** | Normal h32–36, compacto h28 (14px 700). Sempre ícone + texto |
| **Abas segmentadas** | Trilho `--neub` pill, item h40–44. Ativo: fundo `--br` ou `--sf` com sombra leve |
| **Abas de paciente** | Sublinhado de 3px `--br`, avatar 32 e indicador de alerta (ícone com `aria-label`) |
| **Avatar** | Círculo com iniciais. Cor por **papel**, nunca por status. Selo do WhatsApp verde no canto. Grupo sobreposto com -10px |
| **Cartão de dose** | r16. Bloco de ícone, horário Jakarta 24–32, remédio 18/700, dose, paciente, "Quem dá", fase. Ação "Confirmar dose" h48–52. Variantes: pendente, atrasada (fundo `--ltsf`, borda `--ltbd`, cabeçalho "Atrasada há X"), esquecida (borda `--msbd`, horário riscado), tomada compacta |
| **Cartão de estoque** | Nome, paciente, "X dias" (Jakarta 22–32, cor do nível), "acaba ter, 21/10", barra de 10–12px com escala de 30 dias e marca de aviso, chip de nível. Estoque aproximado (colírio, líquido): linha com ícone `info` |
| **Tabela** | Cabeçalho `--sf2` 14px 700, linhas de 56px, hover `--sf2`. No mobile vira lista de cartões ou rolagem horizontal |
| **Linha do tempo** | Ícone circular de 36px com a cor do estado e linha de 2px `--bd`. Agrupada por dia ("HOJE · QUI, 15/10") |
| **Modal** | r24, ícone de 52px, título Jakarta 22/800, texto `--ink2`, botões Cancelar + ação (+ alternativa opcional). Desktop centralizado; mobile fixado embaixo |
| **Toast** | Fundo `--ink` (escuro: invertido), ícone colorido, ação "Desfazer". Some em 5s (8s com ação). Erro não some sozinho |
| **Matriz de permissões** | Grade funcionalidade × perfil, switch 44×26 com "Sim"/"Não". Administrador bloqueado ("Sempre") |

### Componentes criados para Receitas

| Componente | Especificação |
|---|---|
| **Miniatura de receita** | Proporção 3:4, papel `#FBFAF6` com linhas, contador de páginas no canto. Estados: carregando (shimmer) e erro (`broken_image` "Não carregou") |
| **Cartão de receita** | Miniatura de 76px + paciente + chip de situação + médico + "especialidade · emitida em" + linha de validade (cor e ícone) + chips de remédios |
| **Cartão em destaque** | "Vigente mais recente": borda 1.5 `--br` e miniatura maior |
| **Campo de busca** | h52, r14, ícone `search` e botão de limpar de 44px |
| **Visualizador em tela cheia** | Fundo `#0B1222`. Fechar e baixar no topo; zoom de 100 a 300%; anterior/próxima de 52px; indicadores de página. Carregando: "Carregando foto em alta resolução…". Erro com "Tentar de novo" |
| **Captura** | "Tirar foto" de 64px (`<input type=file accept=image/* capture=environment>`), "Escolher da galeria ou PDF" de 56px (`multiple`, aceita PDF), dicas de enquadramento |
| **Pré-visualização** | Página atual; ações Girar / Recortar / Remover (60px); moldura de recorte com cantos; tira de páginas + "Adicionar página" |
| **Barra de progresso de envio** | 14px, `role=progressbar`, percentual, "Página X de Y · A de B MB". Estado de falha com barra vermelha |
| **Etapas de reposição** | Versão vertical (círculo de 40px + rótulo + tag de estado + responsável + ações na etapa atual) e versão compacta (4 segmentos de 6px + "etapa X de 4" + responsável) |
| **Indicador de acesso restrito** | Pílula com `lock`, "Acesso restrito · 7 pessoas". Ao expandir: quem pode ver e quem não pode, com link para Perfis |
| **Lista de pessoas selecionáveis** | Checkbox de 26px, avatar, nome · papel, linha de status ("Viu em…", "Ainda não viu", "Sem permissão" bloqueado com `lock`) |
| **Bottom sheet** | r24. No mobile alinhado embaixo com margem de 12px; no desktop vira diálogo central de 520px |

---

## 4. Layout responsivo

- **Mobile (< 900px):**
  - Header de 64px com logo, tema e sino de alertas com contador.
  - Barra inferior com **5 abas**: Início, Pacientes, Receitas, Histórico, Ajustes. Ícone em pílula de 56×32 e badge de alertas.
  - Padding de 16px.
- **Desktop (≥ 900px):**
  - Menu lateral de 256px: logo, navegação, pacientes com resumo de status, usuário.
  - Header com título da tela e data/hora.
  - Conteúdo com máximo de 1240px e padding de 32px.
- **Grades:**
  - Início: 2 colunas (1.25fr / 1fr). No mobile os blocos vêm nesta ordem: Próximas doses → Estoque → Últimas tomadas → Interações.
  - Pacientes: coluna tripla a partir de 1080px.
  - Configurações: lista de 280px + painel.
  - Receitas: cartões em 2 colunas a partir de 1080px; detalhe em 2 colunas no desktop.
- **Fluxo de anexar:** tela cheia no mobile; diálogo de 560px no desktop.

---

## 5. Telas

### 5.1 Início
1. Saudação + resumo ("2 doses pedem atenção agora · próxima às 15:00").
2. **Alertas** de doses atrasadas e esquecidas (cartões com Confirmar / Lembrar de novo ou Registrar / Ver histórico). Se não houver: "Tudo em dia".
3. **Próximas doses:** a primeira em destaque (horário 32px, "em 50 min", botão Confirmar de 52px) e as demais compactas.
4. **Estoque perto de acabar** (≤ 14 dias, por urgência). Cada item mostra:
   - dias, barra e nível;
   - chip da **situação da receita** ("Receita vence em 10 dias", "Sem receita vigente: pedir ao médico", "Aguardando nova receita", "Não precisa de receita");
   - a **reposição compacta** com o responsável;
   - os botões **Ver receita / Anexar receita / Registrar compra** e **Eu cuido disso / Marcar etapa feita / Ver reposição**.
5. Últimas doses tomadas (quem, quando, canal).
6. Últimas interações (WhatsApp e painel).

### 5.2 Pacientes
- Abas Adelino / Maria com indicador de alerta.
- Resumo: "X de Y doses tomadas" e chips de contagem.
- Para a Maria: aviso de quem confirma por turno.
- Por remédio:
  - nome com **ícone `warning`** quando a receita está vencida, ausente ou aguardando;
  - marcas alternativas, dose e esquema, chips de tipo de uso e fase;
  - **link da receita** (vigente / vence em X dias / vencida → pedir / sem receita → anexar);
  - horários do dia como chips de 44px por status (pendente e atrasada confirmam ao tocar);
  - estoque com dias, barra e data prevista.

### 5.3 Receitas
- **Lista:**
  - acesso restrito e botão **Anexar receita** (56px, largura total no mobile);
  - busca;
  - chips de situação: Todas, Vigentes, Vencidas, Aguardando nova, Substituídas;
  - "Mais filtros" (paciente, médico, remédio, período), sempre visíveis no desktop;
  - ordenação Mais recentes / Mais antigas;
  - destaque da vigente mais recente;
  - estados vazios: nenhuma receita ainda ("Anexar a primeira receita") e nenhum resultado ("Limpar busca e filtros").
- **Detalhe:**
  - situação, acesso restrito, "Receita de {remédios}", paciente · médico, validade;
  - foto grande (toque abre o visualizador) e miniaturas das páginas;
  - ações: Compartilhar (primária), Baixar, Editar, Marcar como substituída, Excluir (com confirmação);
  - Dados (paciente, médico, especialidade, emissão, quem anexou, observações);
  - Remédios desta receita (cada um leva a Pacientes);
  - **Histórico:** cadeia anterior → esta → substituta, mais compartilhamentos e anexo;
  - Quem já visualizou e quem ainda não viu;
  - Quem pode ver.
- **Anexar, em 3 passos:**
  1. Câmera ou galeria/PDF.
  2. Pré-visualização: girar, recortar, remover, adicionar páginas.
  3. Dados. Obrigatórios: **paciente, data, remédios**. Médico é opcional, com sugestões. Em "Mais detalhes": validade (30 dias / 60 dias / 6 meses / sem validade, com prévia "Vence em…"), especialidade e observações. Mostrar quem vai poder ver.

  Depois vem o **Envio** (progresso; Cancelar; falha → Tentar de novo / Enviar quando a conexão voltar) e a tela **Receita salva** (Compartilhar com a família / Ver receita / Concluir).
- **Compartilhar** (sheet):
  - aba **Na família:** pessoas com checkbox; quem não tem permissão aparece bloqueado; status de visualização;
  - aba **Pelo WhatsApp:** finalidade (Para a farmácia / Para quem vai comprar / Outro), que preenche a mensagem; destino (Farmácia, grupo da família, quem assumiu a compra, outro número); mensagem editável; prévia do balão; aviso "A imagem sai do MedCuidar".

### 5.4 Reposição (sheet)
- 4 etapas: **Pedir receita ao médico → Receita recebida → Comprado → Estoque atualizado**.
- Cada etapa mostra o estado (Concluída / Etapa atual / A fazer / Não se aplica) e o responsável com data ("Beatriz vai comprar · desde 15/10 · 09:40", ou "Ninguém assumiu ainda" em âmbar).
- Na etapa atual: **Eu cuido disso** (ou **Assumir no lugar**) e **Marcar como feito**. Na etapa 2 sem receita vigente, o botão vira "Anexar receita recebida" e abre o fluxo de anexar.
- Lista de **Registros**: cada ação vira um registro com data e responsável.
- Remédio sem receita (otc): as etapas 1 e 2 ficam como "Não se aplica".

### 5.5 Histórico
- Filtros: paciente, remédio, pessoa, período e chips de status (+ **Receitas e reposição**).
- Contador de registros e alternância Linha do tempo / Tabela (tabela é o padrão no desktop).
- Registros de dose mostram quem deu, quando e o canal. Eventos de receita (anexada, compartilhada, substituída, reposição assumida ou concluída) entram na mesma linha do tempo.
- Estado vazio com "Limpar filtros".

### 5.6 Configurações
| Subtela | Conteúdo |
|---|---|
| Remédios | Lista por paciente + edição: nome, **marcas alternativas** ("só uma delas"), tipo de uso, unidade de controle, conversão gotas/ml (padrão 20), quantidade por dose, excluir |
| Esquemas | Várias fases ou fase única; barra de fases com marcador de "Hoje"; periodicidade em horas (+/−); duração; primeiro horário; horários gerados |
| Estoque | Aviso de estoque aproximado; lista por urgência; **Registrar compra** (com prévia "passa de X para Y dias"); **Ajuste manual**; movimentações |
| Usuários | Pacientes (Maria: "lembretes vão para quem está com ela") e pessoas com perfil e status do WhatsApp |
| Perfis | Matriz com 11 funcionalidades, incluindo **Ver, Anexar, Compartilhar e Excluir receitas** |
| Avisos | Antecedência padrão (7 dias) e exceções por remédio; quem recebe; lembrete no horário; resumo às 20:00; repetir (15 min / 30 min / 1 h); atrasada após 15 min; esquecida após 2 h; noite → Seu João |

### 5.7 Apoio
- Login por WhatsApp (celular → código de 6 dígitos, com erro e reenvio), login desktop em 2 colunas.
- Estados vazios, carregando (skeleton com shimmer), erro de conexão (dados do cache + "Tentar de novo"), confirmação destrutiva (digitar REMOVER quando há impacto em escala de pessoas).

### 5.8 Mensagens de WhatsApp
Regras:
- Texto curto, sempre com o **nome do paciente**.
- Uma ação por botão.
- Título com ícone e cor do estado.

Mensagens:
- Lembrete de dose ["Tomei", "Lembrar em 15 min"].
- Dose esquecida para a família ["Ligar", "Ele já tomou"].
- Estoque baixo ["Eu cuido disso", "Ver receita"].
- Resposta a "como está o estoque?".
- Pedido da foto da receita → confirmação "Receita do Adelino salva".
- Receita compartilhada (imagem, dados, validade, aviso de acesso restrito) ["Baixar", "Encaminhar para a farmácia"].

---

## 6. Regras de negócio

- **Dias de estoque** = `floor(estoque / (doses por dia × quantidade por dose))`. A data prevista é hoje + dias.
- **Nível de estoque:** ≤ 7 crítico; 8–14 atenção; > 14 ok.
- **Dose:** pendente até o horário; vira **atrasada** após 15 min (configurável), com lembrete repetido; vira **esquecida** após 2 h e a família é avisada.
- **Responsável pela dose:** pela faixa do horário (Rosa 6h–14h, Lúcia 14h–22h, Seu João à noite; Adelino confirma sozinho as doses da manhã).
- **Confirmar dose** desconta do estoque e oferece **Desfazer** por 8 s.
- **Situação da receita:**
  1. Se existe substituta → `substituída`.
  2. Senão, se tem pedido pendente → `aguardando`.
  3. Senão, se `emissão + validade < hoje` → `vencida`.
  4. Senão → `vigente` ("vence em X dias" se faltam ≤ 15).
  5. Sem validade → vigente "Sem validade informada".
- **Receita de um remédio:** a vigente mais recente; senão a aguardando; senão "não precisa" (otc); senão vencida ("pedir ao médico"); senão "sem receita".
- **Salvar uma receita nova** marca como substituídas as vencidas ou aguardando do mesmo paciente com remédios em comum. Também avança a reposição desses remédios para "Comprado".
- **Concluir "Estoque atualizado"** soma a compra ao estoque e encerra a reposição.
- **Visibilidade das receitas** segue a permissão "Ver receitas" do perfil. Por padrão: Administrador, Familiar e Cuidadora podem ver; Confirmador não.
- **Validação do formulário de receita:** data no formato `dd/mm/aaaa` e não futura; pelo menos 1 remédio.

---

## 7. Dados fictícios (para seed e testes)

- **Hoje:** quinta, 15/10/2026, 14:10.
- **Pacientes:**
  - Adelino Souza, 84 anos, usa WhatsApp.
  - Maria Souza, 81 anos, tem Alzheimer e não usa celular.
- **Pessoas:**
  - Ana (administradora, filha)
  - Beatriz, Cláudia, Denise (filhas)
  - Lucas (sobrinho)
  - Rosa e Lúcia (cuidadoras)
  - Seu João (sogro, confirmador)
- **Remédios:** Zypred (colírio, 3 em 3 h, fase 1 de 2, dia 7 de 15, 6 dias de estoque; alternativas Facoba e Vigadexa), Losartana, Omeprazol, Sinvastatina, Memantina, Metamucil (sem receita), Donepezila, Lactulose.
- **Receitas:**
  - Zypred: Dra. Helena Prado, Oftalmologista, emitida há 20 dias, **vence em 10 dias**, substitui a de julho.
  - Donepezila + Memantina: vence em 5 dias, controle especial em 2 vias.
  - Omeprazol: vencida.
  - Lactulose: aguardando nova.
  - Losartana + Sinvastatina: vigente.

---

## 8. Acessibilidade — checklist de implementação

- [ ] `aria-label` em todos os botões que só têm ícone.
- [ ] Atributos de estado:
  - `aria-pressed` em chips;
  - `role="switch"` + `aria-checked` nos switches;
  - `role="checkbox"` / `role="radio"` nas listas de seleção;
  - `role="tablist"` / `role="tab"` nas abas.
- [ ] `role="progressbar"` com `aria-valuenow` no envio de receitas.
- [ ] `role="dialog"` + `aria-modal` + foco preso e devolvido ao fechar. `Esc` fecha.
- [ ] Toasts em `role="status"`; erros de formulário em `role="alert"` ou ligados ao campo com `aria-describedby`.
- [ ] Imagens de receita com `alt` descritivo ("Receita de Zypred, página 1 de 2").
- [ ] Teclado: ← → no visualizador; `+`/`-` para zoom.
- [ ] Testar com zoom de 200% e fonte grande do sistema.

## 9. Dados de saúde

- Indicador "Acesso restrito" em toda a área de receitas e no fluxo de anexar.
- Sempre mostrar **quem pode ver** e **quem já viu**.
- Ao compartilhar pelo WhatsApp, avisar que a imagem sai do sistema.
- Registrar cada visualização, compartilhamento, anexo, troca e exclusão.
- Fotos com URLs assinadas e de curta duração. Miniaturas com resolução reduzida e imagem completa sob demanda (conexões lentas).
- Upload retomável: as fotos ficam no aparelho até o envio terminar.
