# 11 — WhatsApp de verdade: N8N + Evolution Go (Lote 4B)

Guia para quem **não é técnico**. Você vai: importar 8 fluxos no seu N8N, criar 6 credenciais, ligar o webhook da Evolution Go, conectar o número do sistema por QR Code e ativar tudo na ordem certa. Tempo estimado: 1 hora (sem o número) + 30 min (com o número).

**Como as peças conversam:** a Evolution Go recebe/envia as mensagens do WhatsApp → o N8N só **roteia** → o portal (API `/api/v1`) decide tudo e devolve o texto pronto. Nenhuma regra mora no N8N. Só quem tem o **número verificado** é atendido. O agente de IA só **lê** (estoque, doses, reposições, receitas); confirmar dose nunca passa por IA. Contrato da API: `docs/10-api-v1.md`.

## 0. Antes de começar (tenha à mão)
- Endereço do portal (ex.: `https://automacoes-medcuidar-app.8m5sgi.easypanel.host`) e acesso de **Administrador**.
- Endereço do seu N8N e do seu Evolution Go (EasyPanel).
- `GLOBAL_API_KEY` da Evolution Go (está no `.env`/variáveis do serviço dela).
- Uma chave do Gemini (Google AI Studio) e uma da Anthropic (console.anthropic.com).
- Uma conta de e-mail para enviar os alertas (SMTP).
- No portal, a variável `PLATFORM_KEYS_FROM_PORTAL=1` ligada **só enquanto cria a chave** (veja o roteiro `docs/lotes/L4B-roteiro.md`, Parte 0).

## (a) Importar os fluxos e criar as credenciais

### Importar
Os arquivos estão em `integrations/n8n/fluxos/`. No N8N: **Workflows › ⋯ › Import from file**, um por vez, nesta ordem:
`01b-agente` · `01-conversa` · `02-lembretes-dose` · `03-avisos-estoque-receitas` · `04-resumo-diario` · `05-teste-conexao` · `06-alertas-operacionais` · `00-captura`.
Todos entram **desligados**. (Se você mexe no código do repositório: `pnpm n8n:build` gera os arquivos e `pnpm n8n:validar` confere.)

### Credenciais (use os nomes EXATOS)
Em **Credentials › Create credential**:

| Nome (exato) | Tipo no N8N | O que preencher |
|---|---|---|
| `MedCuidar API` | **Header Auth** | Name: `Authorization` · Value: `Bearer ` + a chave `cpl_…` (um espaço depois de Bearer). A chave é criada no portal: Configurações › WhatsApp › “Chave da plataforma (N8N)” |
| `MedCuidar Teste de conexão` | **Header Auth** | Name: `X-MedCuidar-Token` · Value: o segredo mostrado pelo botão “Gerar segredo” (portal, Configurações › WhatsApp › “WhatsApp do sistema (N8N)”) |
| `Evolution Go` | **Custom Auth** | JSON: `{"headers": {"apikey": "SUA_GLOBAL_API_KEY", "instanceId": "UUID_DA_INSTANCIA"}}` |
| `Gemini` | **Google Gemini(PaLM) API** | a chave do Gemini |
| `Anthropic` | **Anthropic** | a chave da Anthropic |
| `SMTP alertas` | **SMTP** | servidor, porta, usuário e senha do e-mail que envia os alertas |

> Confirme com a documentação da sua versão da Evolution Go qual valor vai em `apikey` (a `GLOBAL_API_KEY` ou o token da instância) e qual em `instanceId` (o UUID da instância). O N8N guarda tudo criptografado; **nunca** cole chaves dentro dos fluxos.

### Ligar as credenciais aos fluxos
Abra cada fluxo; nos nós com um aviso vermelho de credencial, escolha a credencial de mesmo nome. Depois preencha o nó **Config** (primeiro nó de cada fluxo):
- `apiBase`: `https://ENDERECO-DO-PORTAL/api/v1`
- `evolutionBase`: o endereço da sua Evolution Go (sem barra no fim)
- Só no `06`: `emailAdmin` (quem recebe os alertas) e `emailRemetente`.

No `01-conversa`, nó **Chamar agente**: escolha o fluxo `MedCuidar · 01b Agente` na lista. Troque também o final do caminho do webhook (`medcuidar-whatsapp-TROQUE-ESTE-CODIGO`) por um código só seu, longo e aleatório: **esse caminho é a “senha” do webhook**, porque a Evolution Go não envia cabeçalho de autenticação. Faça o mesmo no `00-captura`.

## (b) Webhook da Evolution Go
1. No N8N, abra o `01-conversa`, clique no nó **Webhook Evolution** e copie a **Production URL** (termina com o seu código).
2. No painel da Evolution Go: **Instâncias › (sua instância) › Conectar/engrenagem** → campo **Webhook URL**: cole a URL; em **Eventos**, marque **MESSAGE** (e, se quiser acompanhar a conexão, **CONNECTION**). Salve/Conecte.
3. Para **conferir o formato real** das mensagens (recomendado na 1ª vez): ative o fluxo `00-captura`, aponte *temporariamente* o webhook para a URL de produção dele, mande mensagens de teste (texto, áudio) de um número de teste, e veja em **Executions** o que chegou. Depois **desative o `00` e apague as execuções** (têm telefone e texto) e aponte o webhook de volta para o `01`. Se o formato diferir do esperado (campo do remetente, áudio), avise: os pontos marcados `TODO verificar com mensagem real` em `integrations/n8n/lib/evolution.ts` são os únicos que podem precisar de ajuste.

## (c) Criar a instância e conectar o número do sistema
1. Painel da Evolution Go › **Instâncias › + Nova Instância**: nome (letras, números, `-`, `_`), token em branco (gera sozinho). Anote o UUID/token para a credencial `Evolution Go`.
2. **Conectar** (deixe “Telefone para Pairing Code” vazio) → aparece o **QR Code**. No celular do número do sistema: WhatsApp › Configurações › **Dispositivos conectados › Conectar dispositivo** e escaneie. O status fica “Conectado”.

**Boas práticas anti-bloqueio (leia):** a Evolution Go não é a API oficial; o WhatsApp pode banir números que parecem robô.
- Use um **número dedicado** (chip novo), **nunca o seu número pessoal**. Esse chip só serve ao MedCuidar.
- O sistema **só responde a quem fala primeiro** e só manda lembretes a quem **verificou o número**. Não mande mensagem em massa nem para quem não pediu.
- **Aquecimento gradual:** nos primeiros 3 a 7 dias use o chip como pessoa (conversa com familiares, foto de perfil, nome) e só então ligue os fluxos 02 a 04; comece com 1 pessoa, depois acrescente as demais.
- Evite rajadas: os fluxos já limitam o ciclo (10 a 20 mensagens) e esperam 4 s entre envios; não aumente sem necessidade.
- Mantenha o celular do chip com internet de vez em quando e o WhatsApp atualizado.
- Se o número for banido: crie outro chip, nova instância, escaneie o QR e atualize a credencial `Evolution Go` — o portal e os fluxos não mudam.

## (d) Ativar na ordem certa
1. **05 Teste de conexão** → ative. No portal, cole a URL de **produção** do webhook (nó “Ping do portal”) em Configurações › WhatsApp › “WhatsApp do sistema (N8N)”, gere o segredo, crie a credencial `MedCuidar Teste de conexão` e toque em **Testar conexão**. Deve aparecer “N8N conectado”.
2. **01b Agente** → ative (é chamado pelo 01).
3. **01 Conversa** → ative. Teste mandando “ajuda” do seu número já verificado.
4. **02 Lembretes de dose** → ative (roda a cada 1 minuto).
5. **03 Avisos de estoque e receitas** e **04 Resumo diário** → ative.
6. **06 Alertas operacionais** → ative; depois, nos fluxos `01` e `02`: ⚙ **Settings › Error workflow** → `MedCuidar · 06 Alertas operacionais`.
7. **00 Captura** fica **desligado** (só para investigar).

## (e) Custos de IA e como limitar
- **Transcrição de áudio (Gemini Flash):** centavos por mês para uso familiar (um áudio de 10 s custa uma fração de centavo).
- **Agente (Anthropic, modelo `claude-haiku-5-5` por padrão no nó “Modelo Anthropic”):** só roda para perguntas que **não** são comandos (“tomei”, “estoque”, “próximas doses”… são resolvidos sem IA). Estimativa: cada pergunta livre ≈ 1.500–3.000 tokens de entrada e 200–400 de saída → ordem de **R$ 0,02 a R$ 0,10 por pergunta**; 100 perguntas/mês ≈ poucos reais. Confira preços atuais no console da Anthropic.
- **Como limitar:** (1) defina um **limite mensal de gasto** no console da Anthropic e do Google; (2) no nó “Modelo Anthropic”, `maxTokensToSample` já é 600; (3) o agente tem no máximo 6 passos por pergunta e memória de 6 mensagens; (4) para desligar a IA sem mexer em mais nada, **desative o fluxo 01b**: a conversa em código continua funcionando e as perguntas livres recebem a mensagem padrão de falha temporária.

## (f) Quando algo falha
| Sintoma | Causa provável | O que fazer |
|---|---|---|
| “Testar conexão” diz *recusou o segredo* | credencial `MedCuidar Teste de conexão` com valor diferente do segredo atual | gere novo segredo no portal e atualize o Value da credencial |
| “Testar conexão”: *Webhook não encontrado* | fluxo 05 desativado, ou URL de teste (`webhook-test`) | ative o 05 e use a **Production URL** |
| “Testar conexão”: *Essa URL não é permitida* | URL com IP/nome interno, http, ou usuário/senha | use o endereço **público https** do N8N |
| “Testar conexão”: *demorou demais* / *não foi possível conectar* | N8N fora do ar ou bloqueado | verifique o serviço no EasyPanel |
| Mensagem enviada ao número do sistema e nada acontece | webhook da Evolution não aponta para o `01`, fluxo 01 desativado, instância desconectada | confira a URL do webhook, o fluxo ativo e o status “Conectado”; veja **Executions** do 01 |
| Execução do 01 termina em “Ignorado” | mensagem de grupo, enviada por você mesmo, status ou mais antiga que 60 min | normal. Para outros casos, use o fluxo 00 e compare o formato |
| O sistema responde “não reconheci seu número” | número não verificado ou sem acesso | verifique o número em Minha conta (código por WhatsApp) |
| Erro 401 na “Conversa (API)” | credencial `MedCuidar API` errada, chave revogada ou sem `Bearer ` | crie nova chave `cpl_` e atualize a credencial |
| Erro 429 | muitas mensagens do mesmo número em 1 minuto | aguarde; é proteção |
| “Envia resposta” falha (502/401) | Evolution fora do ar, instância desconectada, `apikey`/`instanceId` errados | reconecte o QR; confira a credencial `Evolution Go` |
| Lembretes não chegam | fluxo 02 desativado; nenhum número verificado; dose já tomada; Evolution fora | veja Executions do 02; o simulador do portal mostra a fila |
| O mesmo lembrete chega repetido | falha de envio repetida (a API reenvia até 5 vezes) | resolva o envio (linha acima); mensagens enviadas OK nunca repetem |
| Áudio não é entendido | credencial `Gemini` ausente, áudio longo/ruidoso, ou formato da mídia ainda não confirmado | veja a execução; use o fluxo 00 para checar onde está a mídia |
| Agente responde “não consegui consultar” | credencial `Anthropic` ausente, ou usuário sem permissão | confira a credencial; no portal, o perfil precisa de acesso |
| Não recebo e-mail de alerta | `SMTP alertas` ou e-mails do `06` errados; fluxo 06 desligado | teste o nó “Envia e-mail” manualmente |
| Número do sistema foi banido | uso fora das boas práticas | veja (c): novo chip, nova instância, atualizar credencial |

## Limitações conhecidas
- Formato real do webhook (remetente `@lid`, áudio, id de envio) e a rota de saúde da Evolution (`/server/ok`) **só se confirmam com número real** (ver roteiro, Parte B).
- A Evolution Go não tem botões estáveis: o sistema usa opções numeradas (“1 — Tomei”).
- Memória do agente fica só na memória do N8N (some se ele reiniciar) — de propósito: nenhum dado de saúde é gravado fora do portal.
- O alerta do `06` depende do fluxo estar ativo; se o próprio N8N cair, use também um monitor externo (Uptime Kuma/Healthchecks) no portal e no N8N.
