# Lote 4A → 4B: o que o N8N encontra pronto

Estado: Lote 4A concluído (aguardando validação do dono). Contrato completo em `docs/10-api-v1.md` e `/api/v1/openapi.json`. Nenhuma alteração em `packages/domain`, `apps/functions` ou `packages/channels`.

## Mapa fluxo → rota (docs/06 seção 5)
| Fluxo N8N | Rota | Observações |
|---|---|---|
| `01-conversa` | `POST /conversa/mensagem` (`Bearer cpl_`, `X-Telefone` = remetente real, `messageId` = id da mensagem da Evolution) | resposta `{ respostas: [{ texto, opcoes? }], intent }`. Enviar cada `texto` ao remetente. `intent: "livre"` com `respostas: []` = chamar o agente de IA (ferramentas: só rotas de leitura com `X-Telefone` fixo vindo do fluxo, nunca parâmetro da IA). Confirmar dose **nunca** passa pela IA. Áudio: transcrever antes e mandar como `texto` |
| `02-lembrete-dose` | `GET /lembretes/pendentes` a cada 1 min (`cpl_`) | cada item tem `telefone`, `texto`, `opcoes`, `id`. Enviar e então `POST /lembretes/{id}/enviado` (ou `{ "falhou": true }` se o envio deu erro). Sem confirmação o lease de 2 min vence e a mensagem volta (até 5 vezes) |
| `03-estoque-baixo` | `GET /avisos/estoque` a cada 30 min | idem; já filtrado por quem pode comprar e tem número verificado |
| `04-resumo-diario` | `GET /avisos/resumo` | a API só devolve a partir de `daily_summary_time` (janela de 3 h); chame a cada 15–30 min |
| `05-teste-conexao` | `GET /sistema/saude` | `{ ok, versao }` |

## Decisões que o 4B herda
- **Chave `cpl_`**: crie com `PLATFORM_KEYS_FROM_PORTAL=1` (Configurações › WhatsApp, só Administrador) e desligue a variável depois; a chave aparece uma vez. Guardar só no N8N (credencial por nome).
- **Envio**: a API já decide o texto. Com a Evolution Go (sem botões estáveis) use sempre o `texto` (já traz "*1* — Tomei"). Com a API oficial da Meta, `SUPPORTS_BUTTONS=true` tira as linhas numeradas do texto e o nó de envio monta botões a partir de `opcoes`.
- **Idempotência**: use o id da mensagem da Evolution como `messageId`; o reenvio devolve a mesma resposta e nunca baixa estoque duas vezes. Para `POST /lembretes/{id}/enviado` não precisa de chave (já é idempotente).
- **Mensagens de convite** (`convite_aceito`) trazem o link de primeiro acesso no texto: não registrar o corpo das mensagens no N8N.
- **Ignorar** no fluxo (docs/06 seção 3): `fromMe`, status e grupos.
- **Fora do 4A**: receita pelo WhatsApp (enviar a imagem): `GET /receitas/{id}/arquivos` já devolve URLs assinadas de 5 a 10 minutos para o agente/fluxo baixar e encaminhar; falta o fluxo e a regra "receita só em conversa privada".
- `rotaFila` conta 600 req/min por chave; `rota` 60 req/min por telefone.
