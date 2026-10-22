# 10 — API `/api/v1` e modelo de conversa (Lote 4A)

Implementa as seções 3, 4, 5 e 6 do `docs/06-escopo-v2.md`. Código: `apps/web/src/server/api` (núcleo, handlers, registro das rotas), `apps/web/src/server/wa` (conversa, fila de saída, verificação do número) e `apps/web/src/app/api/v1/**` (arquivos de rota, finos). O contrato legível por máquina é `GET /api/v1/openapi.json` (gerado de `registry.ts`; um teste confere que bate com as rotas reais).

**Princípio:** a API devolve a **mensagem pronta** e decide **quem, quando e o quê**; o N8N (Lote 4B) só roteia e envia. Nenhuma regra mora no N8N e nada conhece a Evolution Go. As rotas aplicam as **permissões do ator** chamando os **mesmos serviços do portal** (`server/pg/*`); a regra nunca é duplicada.

## 1. Autenticação e identidade

| Cabeçalho | Quando | O que é |
|---|---|---|
| `Authorization: Bearer cdf_…` | rotas de usuário e da fila | chave **da família** (criada pelo Administrador em Configurações › WhatsApp). Só enxerga a própria família |
| `Authorization: Bearer cpl_…` | tudo, e é o **único** que vale em `/conversa/mensagem` e `/telefone/verificar` | chave **da plataforma** (N8N), escopo `conversa`. Vale para todas as famílias |
| `X-Telefone: 5511912345678` | rotas de usuário e de conversa | **remetente real**, só dígitos, DDI+DDD+número. Nunca parâmetro escolhido por IA |
| `Idempotency-Key` | `POST` | repetir a mesma chave devolve a resposta guardada (24 h, cabeçalho `Idempotent-Replay: true`). Mesma chave com outro corpo = `422 idempotencia_conflito` |

- As chaves são guardadas **só como sha256** (`api_keys.key_hash`, `platform_api_keys.key_hash`, índice único); a busca é por hash e a chave em claro **nunca** é comparada, gravada ou logada. Aparece **uma vez**, ao criar; revogar tem efeito imediato (`401`). A chave `cdf_` é criada em Configurações › WhatsApp. A `cpl_` só é criada pelo portal se `PLATFORM_KEYS_FROM_PORTAL=1` (padrão desligado; veja `docs/09`, seção 12).
- **Só número VERIFICADO e membro ativo é atendido.** Telefone desconhecido, só "pendente", de pessoa desativada, sem acesso (`invited`) ou, com chave de família, **de outra família** → sempre o mesmo `404 nao_encontrado` ("Telefone não encontrado, não verificado ou sem acesso."), sem revelar nada.
- **Estados de acesso** (docs/06 seção 2): `active` = tudo o que o perfil permite; `whatsapp_verified` = só dar o check (`doses.confirm`), ver próxima dose (`dashboard.view`), consultar estoque (`stock.view`) e `whatsapp.query` — **mesmo que o perfil seja Administrador** (o nome do perfil é rebatizado para não liberar tudo em `can()`); receitas, compartilhamento, reposição e administração exigem `active` (`403 sem_permissao`).
- **Limite de requisições:** 60 por minuto por telefone (`429 limite_excedido`, `Retry-After`); 600 por minuto por chave nas rotas da fila. Contagem por processo (uma instância do portal).
- **CORS fechado** (nenhum cabeçalho `Access-Control-*`); as rotas só aceitam Bearer (a única exceção é `/arquivos/receita/{id}`, URL assinada de 5 a 10 min).
- **Auditoria:** toda chamada com chave `cpl_` grava em `platform_audit_log` (método, rota, família, status, **telefone mascarado `…1234`**). Ações de dose/estoque/reposição seguem gravando em `audit_log` com o canal.

## 2. Formato

Sucesso: `{ "dados": … }`. Erro: `{ "erro": { "codigo", "mensagem", "detalhes?" } }`.

| Status | `codigo` | Quando |
|---|---|---|
| 400 | `telefone_obrigatorio`, `json_invalido`, `idempotency_key_invalida` | entrada |
| 401 | `nao_autorizado` | sem chave, chave inventada/revogada, prefixo errado |
| 403 | `sem_permissao`, `escopo_insuficiente`, `proibido` | perfil/estado, chave sem escopo, rota só de plataforma |
| 404 | `nao_encontrado` | telefone não atendido; mensagem/receita inexistente |
| 409 | `em_andamento` | a mesma Idempotency-Key ainda está sendo processada |
| 422 | `invalido`, `regra_de_negocio`, `idempotencia_conflito` | validação, regra do domínio, corpo diferente |
| 429 | `limite_excedido` | rate limit |

## 3. Rotas

Todas em `/api/v1`. Autenticação: **membro** = Bearer + `X-Telefone`; **fila** = Bearer sem telefone; **plataforma** = só `cpl_`.

| Rota | Auth | O que faz |
|---|---|---|
| `GET /doses/proximas` | membro | doses abertas de hoje (pendente, atrasada, esquecida) |
| `GET /doses/dia?data=` | membro | todas as doses do dia com a situação |
| `POST /doses/{id}/confirmar` | membro | confirma a dose; **idempotente** (`messageId` opcional); baixa o estoque uma só vez |
| `POST /doses/{id}/desfazer` | membro | só quem confirmou, em até 30 s; estoque volta como `adjustment` |
| `POST /doses/{id}/registrar-depois` | membro | igual a confirmar, para dose atrasada/esquecida |
| `POST /doses/{id}/lembrar-de-novo` | membro | `{ minutos: 15\|30\|60 }` grava `remind_again_at` |
| `GET /estoque` | membro | visão e previsão de término (colírio = `estimativa: true`) |
| `GET /reposicoes` | membro | reposições abertas e responsável por etapa |
| `POST /reposicoes/{remedioId}/assumir` | membro (`active`) | "eu cuido disso" |
| `POST /reposicoes/{remedioId}/avancar` | membro (`active`) | conclui a etapa (`quantidade` em "Comprado") |
| `GET /receitas` | membro (`active` + `prescriptions.view`) | lista com situação calculada |
| `GET /receitas/{id}/arquivos` | idem | páginas com **URL assinada de 5 a 10 min** (presa a pessoa, arquivo e família); auditado |
| `GET /arquivos/receita/{fileId}?exp&m&f&sig` | assinada | entrega a página; confere a assinatura, a pessoa ativa com `active` e a permissão |
| `GET /pacientes`, `GET /remedios` | membro | leitura |
| `POST /conversa/mensagem` | `cpl_` | conversa em código (seção 4) |
| `POST /telefone/verificar` | `cpl_` | rota "pré-membro": o remetente ainda sem família envia o código de 6 dígitos |
| `GET /lembretes/pendentes` | fila | lembretes de dose e dose esquecida a enviar **agora** |
| `GET /avisos/estoque` | fila | estoque baixo, receita vencendo, reposição |
| `GET /avisos/resumo` | fila | resumo diário |
| `POST /lembretes/{id}/enviado` | fila | marca como enviada (idempotente); `{ falhou: true }` solta o lease |
| `GET /sistema/fila`, `GET /sistema/saude` | plataforma | toda a fila (diagnóstico) e o ping `{ ok, versao }` |
| `GET /openapi.json` | pública | este contrato |

Fica para depois (`/membros`, `/perfis`, `/esquemas`, anexar receita/compartilhar pela API, compra/ajuste de estoque pela API): o portal já faz tudo isso; entram quando um fluxo do N8N precisar.

## 4. Conversa em código (`POST /conversa/mensagem`)

Corpo: `{ "messageId": "<id da mensagem do WhatsApp>", "texto": "tomei" }` (ou `"acao"`: `tomei|lembrar|cuido|estoque|proximas|ajuda`). Resposta: `{ dados: { respostas: [{ texto, opcoes?: [{ numero, rotulo }] }], intent } }`.

- **Idempotente por `messageId`** em duas camadas: a resposta fica guardada em `idempotency` (`msg:<messageId>`; reenvio devolve a mesma resposta) e o registro em `message_log` + `dose_events.source_message_id` impedem uma segunda baixa. A mesma mensagem nunca desconta duas vezes.
- **Sem IA.** Interpretação determinística (`wa/interpret.ts`, regras do escopo anterior): código de verificação/convite (`123456`, `CÓDIGO 123456`), confirmar dose (`tomei`, `ok`, `✅`, `👍`, `1`), `2`/"lembrar de novo", "eu cuido disso", "estoque", "próximas doses", "link de acesso", "ajuda".
- **Ambiguidade nunca é adivinhada.** Várias doses abertas → lista numerada ("Qual dose você tomou?") e só a resposta seguinte confirma. `1`/`2` sem pergunta recente não fazem nada. O contexto das opções fica em `conversation_state` (uma linha por pessoa; lembretes enviados, avisos de estoque e a lista em aberto; expira em 6 h, a lista em 30 min).
- **`intent: "livre"` e `respostas: []`** quando nada casa: é o sinal para o fluxo do N8N (4B) chamar o agente de IA. Confirmar dose **nunca** passa por IA.
- **Remetente sem acesso:** só aceita códigos. Código de verificação do número (`verify_pending_phone`: 15 min, hash sha256, 5 tentativas, bloqueio de 15 min) e código de convite (`consume_whatsapp_invite`: preso ao número esperado, uso único, 24 h). Resposta de convite aceito inclui o **link de primeiro acesso** (`/primeiro-acesso?t=`, uso único, 24 h). Qualquer outra coisa: a resposta genérica.
- `intent` possíveis: `codigo`, `opcao`, `dose_tomada`, `nao_tomou`, `lembrar_depois`, `eu_cuido`, `estoque`, `proximas_doses`, `dose_status`, `link_acesso`, `ajuda`, `livre`, `repetida`, `desconhecido`, `codigo_invalido`, `numero_verificado`, `convite_aceito`, `sem_permissao`.

## 5. Mensagens prontas e fila de saída

Textos em `wa/texts.ts` (pt-BR, curtos, sempre com o nome do paciente, uma ação por mensagem). Opções numeradas são o padrão (`*1* — Tomei`); com `SUPPORTS_BUTTONS=true` o texto vai sem as linhas numeradas e `opcoes` traz os rótulos para o N8N desenhar botões.

Tabela `outbound_messages` (RLS por família, `UNIQUE (family_id, dedupe_key)`): a API **gera** as linhas (uma por destinatário com número verificado) e o N8N **reivindica** e **confirma**.

| Tipo | Quando entra | Quem recebe | Chave de dedupe |
|---|---|---|---|
| `dose_reminder` | dose chegou na hora (e "lembrar de novo") | `reminder_recipients_mode` do paciente/família: **todos** os verificados (padrão) ou escala, só quem tem `doses.confirm` | `dose:<id>:remind:<membro>` e `…:again:<instante>:<membro>` |
| `dose_missed` | dose passou de `missed_after_min` | família (quem recebe alertas da família; se ninguém marcou, todos os verificados com `dashboard.view`) | `dose:<id>:missed:<membro>` |
| `low_stock` | aviso do sino de estoque baixo | quem pode comprar (`stock.adjust`/`replenishment.manage`, já escolhido pelo portal); "Eu cuido disso" só com acesso `active` | `notif:<id>` |
| `rx_expiring`, `replenishment` | aviso do sino de receita/reposição | idem sino; exige `active` | `notif:<id>` |
| `daily_summary` | depois de `daily_summary_time` (janela de 3 h) | verificados com `dashboard.view` | `summary:<data>:<membro>` |

- **Só gera para número VERIFICADO.** Os demais veem o aviso no portal (sino, já existente).
- **Reivindicar com lease:** `GET /lembretes/pendentes` (e `/avisos/*`) decide e entrega o que enviar agora com `SELECT … FOR UPDATE SKIP LOCKED`, dá um lease de 2 minutos (`claimed_until`) e conta a entrega. Duas chamadas simultâneas nunca entregam a mesma mensagem. Sem confirmação o lease vence e ela volta (no máximo 5 vezes).
- **Obsoleta é descartada:** dose já resolvida (no portal ou no WhatsApp), pessoa que perdeu o número ou foi desativada.
- `POST /lembretes/{id}/enviado` é idempotente. O `id` é opaco (`<família>.<mensagem>`). `?somenteLer=1` só espia (usado pelo simulador).
- Ao entregar um lembrete, o contexto da pessoa passa a apontar para ele (o "1" dela significa "Tomei" daquela dose).

## 6. Simulador (`SIMULATOR_ENABLED=1`)

`/configuracoes/simulador` (item na árvore, só Administrador, só com a variável; sem ela a tela e as ações recusam). Fala pela **mesma** `POST /conversa/mensagem`, dentro do processo, trocando a chave `cpl_` por um segredo gerado na subida do servidor (nunca sai do processo). O painel lateral lê a fila pelas rotas `/lembretes/pendentes` e `/avisos/*` (presas à família, `somenteLer`) e "marcar como enviada" chama `POST /lembretes/{id}/enviado`. Um número verificado em **outra** família é recusado. **Nenhum canal real existe neste lote.**
