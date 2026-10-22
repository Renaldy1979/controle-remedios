# Fluxos do N8N (Lote 4B)

Guia para o dono: **`docs/11-n8n-whatsapp.md`**. Roteiro de teste: `docs/lotes/L4B-roteiro.md`.

| Fluxo | Gatilho | O que faz |
|---|---|---|
| `00-captura` | webhook (desligado) | guarda o payload bruto da Evolution Go para conferir o formato |
| `01-conversa` | webhook da Evolution Go | filtra, normaliza o remetente, transcreve áudio, chama `POST /conversa/mensagem`, envia a resposta; `livre` → `01b` |
| `01b-agente` | chamado pelo 01 | agente de IA (Anthropic) só com ferramentas HTTP de **leitura**; `X-Telefone` fixado pelo fluxo |
| `02-lembretes-dose` | a cada 1 min | `GET /lembretes/pendentes` → envia → `POST /lembretes/{id}/enviado` só após envio OK |
| `03-avisos-estoque-receitas` | a cada 30 min | `GET /avisos/estoque` |
| `04-resumo-diario` | a cada 15 min | `GET /avisos/resumo` (a API só devolve no horário da família) |
| `05-teste-conexao` | webhook (Header Auth) | responde `{ ok, versao }` ao botão “Testar conexão” do portal |
| `06-alertas-operacionais` | a cada 5 min + erro de outros fluxos | e-mail ao administrador, sem dados pessoais |

## Como se mexe aqui
- **Não edite `fluxos/*.json` à mão.** Edite `build.mjs` (estrutura dos fluxos) ou `lib/evolution.ts` (código dos nós Code, com testes e fixtures em `lib/`) e rode:
  ```bash
  pnpm n8n:build     # gera fluxos/*.json (a lib é embutida nos nós Code)
  pnpm n8n:validar   # JSON, conexões, segredos, ferramentas do agente, tratamento de erro, "enviado só após envio OK"
  pnpm --filter @medcuidar/n8n test
  ```
- Regras: nenhuma regra de negócio no N8N; telefone só do remetente real (dígitos); credenciais só por **nome** (`MedCuidar API`, `Evolution Go`, `Gemini`, `Anthropic`, `SMTP alertas`, `MedCuidar Teste de conexão`); URLs só no nó **Config**; o agente só lê.
- O replay local que prova o comportamento dos fluxos 01 e 02 contra a API real: `apps/web/src/server/wa/lote4b.replay.test.ts`.
