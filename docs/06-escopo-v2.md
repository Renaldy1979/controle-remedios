# 06 — Escopo v2 (fonte da verdade)

Reescopo definido pelo dono em 19/10/2026. **Onde este documento conflitar com `docs/01` a `docs/05`, vale este.** Os demais continuam válidos no que não for contrariado aqui (requisitos de doses, estoque, receitas, reposição, permissões e design).

Referência de padrão: o projeto `controle-financeiro` do dono (Next.js + Postgres/Drizzle com RLS + Appwrite + API pública `/api/v1` + N8N com um fluxo por gatilho).

## 1. Problema e princípios
- **Problema:** o estoque de cada remédio baixa conforme as doses agendadas são dadas. Ao chegar num limite, **todos os envolvidos** são acionados para comprar, e nenhum paciente fica sem remédio.
- **O portal faz tudo, conforme o perfil.** Quem não validou o WhatsApp tem acesso completo ao portal (conforme o perfil), mas **não recebe nada** pelo WhatsApp.
- **O WhatsApp é um acelerador:** lembretes, confirmação de dose, avisos de estoque e consultas. Nada depende só dele.
- Lembretes de dose e de estoque baixo chegam **pelo portal e pelo WhatsApp**.

## 2. Pessoas e famílias
- Uma família tem **1 ou mais pacientes** e **1 ou mais usuários**.
- Usuários podem: comprar, administrar a dose a pacientes, tomar os próprios remédios, ministrar a outros pacientes. **Isto é permissão, não tipo de usuário**: um paciente com conta (ex.: Adelino) pode confirmar a própria dose e a de outro paciente (ex.: Maria, sem conta).
- Perfis configuráveis (liga/desliga por funcionalidade). Perfis iniciais: Administrador (tudo), Familiar, Cuidadora, Confirmador (só dar o check e ver a próxima dose). **Somente leitura** (decisão de 26/10/2026): vê Início, Pacientes, Histórico e Estoque e consulta pelo WhatsApp; **não faz nenhuma ação**, não vê receitas por padrão, não vê dados de contato de outras pessoas e recebe só o resumo diário (nunca lembrete de dose, esquecida, estoque ou reposição); as permissões de ação ficam **travadas** nesse perfil (ver docs/08 Lote 5A). Avisos de esquecida e de estoque vão apenas a quem pode agir.
- **Um telefone verificado pertence a um único usuário em todo o sistema** (como no projeto financeiro). Isso elimina o passo "qual família?".
- **Entrada na família (decisão do dono, 19/10/2026):** o primeiro usuário é o administrador e valida e-mail e WhatsApp. Os demais entram por **convite por e-mail** (mesmo processo do admin) ou por **convite por WhatsApp**: o admin cria o convite informando o **número esperado** e o perfil; o convidado envia o código ao WhatsApp do sistema; o número fica verificado. **Todo usuário precisa de e-mail e senha**; quem entrou pelo WhatsApp só fica totalmente validado no **primeiro acesso ao portal**.
- **Três estados de acesso:**
  | Estado | Como chega | O que pode |
  |---|---|---|
  | `invited` (convidado) | Admin cria o convite (perfil e número esperado) | Nada |
  | `whatsapp_verified` | Envia o código de convite **do número esperado** | Pelo WhatsApp: dar o check, ver a próxima dose, consultar estoque, receber avisos (somente permissões básicas do perfil) |
  | `active` | Primeiro acesso ao portal: define e-mail e senha e confirma o e-mail | Tudo o que o perfil permite, inclusive receitas e administração |
  Receitas, compartilhamento e administração exigem `active`, mesmo que o perfil as permita.
- **Convite por WhatsApp:** código de uso único, expira em 24 h, vale só se vier do número esperado, guardado como hash, com limite de tentativas. O sistema envia ao número verificado um **link de primeiro acesso** (uso único, expira em 24 h) para definir e-mail e senha. O login do portal é sempre o e-mail (o admin pode pré-preencher). "Reenviar link de acesso" disponível ao admin e ao próprio usuário pelo WhatsApp. Desativar um usuário revoga a sessão do Appwrite e a resposta do WhatsApp.

## 3. Autenticação e WhatsApp
- **Login:** e-mail e senha no **Appwrite Auth** (convite por e-mail, redefinição de senha). O Appwrite também guarda o bucket de receitas e anexos.
- **Validação do WhatsApp (depois do login):** o usuário informa o número no portal; o número fica **pendente**. O portal mostra um código de 6 dígitos (vale 15 min, guardado só como hash, limite de tentativas). **O dono do número envia o código ao WhatsApp do sistema.** Só então o número passa a **verificado**. Trocar o número invalida o verificado.
- Usuário **sem número verificado não recebe nenhuma mensagem** e o sistema ignora mensagens dele (resposta genérica).
- A identidade no WhatsApp vem **sempre do remetente real** (nunca de parâmetro escolhido por IA). Ignorar mensagens `fromMe`, status e grupos (exceto avisos configurados para um grupo da família, se for ativado).

## 4. Arquitetura
> **Decisão do dono (22/10/2026): SEM N8N.** O WhatsApp roda direto no portal, com o Claude chamado por código (API da Anthropic, *tool use*). Motivos: importação manual de fluxos, ids de credencial que quebram, fluxos grandes sem testes e uma peça a mais para operar. Padrão: lote AG1 do projeto `controle-financeiro` (somente leitura).

```
Portal Next.js ──► serviços (regras: @medcuidar/domain) ──► Postgres (Drizzle, RLS por família)
   │  ▲  rota do webhook ─► fila (Postgres) ─► worker ─► núcleo da conversa ─► provedor (Evolution Go | Meta)
   │  └─ API /api/v1 (mesmos serviços; chaves cdf_; integrações futuras)
   └─► Appwrite (Auth + bucket)        Claude (Messages API, só leitura) · Gemini (áudio/imagem → texto)
```
- **Banco: Postgres + Drizzle**, com migrações versionadas. Todo acesso a dados de negócio passa por `withFamilia(familiaId, tx => ...)`, que define `app.familia_id` na transação; o **RLS** do Postgres impede ler outra família mesmo em caso de bug. Transações reais substituem as soluções de idempotência por índice único do Appwrite (índices únicos continuam, como defesa).
- **API `/api/v1`** (Next.js route handlers), com:
  - chave Bearer por família (`cdf_`) e chave de plataforma para o N8N (`cpl_`, escopo `conversa`), guardadas só como hash, revogáveis;
  - identificação por `X-Telefone` (só dígitos, DDI+DDD+número); telefone não verificado/desconhecido → resposta genérica;
  - `Idempotency-Key` (24 h) com resposta guardada e lock consultivo, derivada do id da mensagem do WhatsApp;
  - erros no formato `{ "erro": { "codigo", "mensagem", "detalhes?" } }`, OpenAPI em `/api/v1/openapi.json`, auditoria das chamadas da plataforma.
- **Provedor de WhatsApp atrás de uma interface** no portal (`parseWebhook`, `enviarTexto`, `presença`, `status da instância`, extração de mídia): hoje Evolution Go, amanhã a API oficial da Meta. Nada de Evolution fora da implementação do provedor. As mensagens (texto e opções numeradas) são geradas pelo núcleo da conversa.
- A chave de plataforma `cpl_` e a URL do webhook do N8N **deixaram de existir no portal** (Lote 4B); a `cdf_` e a API `/api/v1` ficam para integrações futuras. Detalhes de operação: `docs/11-whatsapp-direto.md`.
- **Dados de saúde:** sem dados pessoais em logs; arquivos de receita só com URL assinada de curta duração; auditoria de visualização, compartilhamento e exclusão.

## 5. WhatsApp direto no portal (sem N8N)
**Entrada:** rota `POST /api/whatsapp/evolution/[segredo]` (segredo no caminho, comparado em tempo constante; pública só para ela): valida o payload, ignora `fromMe`, grupos e eventos que não são mensagem, **deduplica pelo id da mensagem**, grava na **fila do Postgres** e responde 200 na hora.
**Worker** (iniciado no servidor Next, seguro com reinício): pega itens com `FOR UPDATE SKIP LOCKED`, **uma conversa por telefone por vez e em ordem**, com trava que expira, retentativa com recuo e limite de tentativas; nunca responde duas vezes à mesma mensagem.
**Núcleo da conversa (em código, testado):** identifica o membro pelo telefone **verificado** (senão, resposta genérica); código de verificação; **confirmar dose, desfazer, lembrar de novo, "eu cuido disso", estoque e próximas doses sem IA**; PARAR/REATIVAR (sem modelo); áudio e imagem → texto pelo Gemini (o Claude só recebe texto); ambiguidade → opções numeradas, nunca adivinha.
**Agente de IA (Claude, Messages API com *tool use* e prompt caching):** só para perguntas livres, com ferramentas **somente de leitura** chamadas **em processo**, dentro de `withFamilia`, com as permissões do membro identificado; o telefone **nunca** é parâmetro de ferramenta; **nenhuma ferramenta escreve**; confirmar dose nunca passa pelo modelo; erro do modelo vira mensagem amigável sem detalhe; custo de IA registrado por família com limite configurável.
**Saída e lembretes (o mesmo worker, no lugar das agendas do N8N):** lembrete de dose, dose esquecida, estoque baixo, receita vencendo, reposição e resumo diário. O agendador decide quem/quando/texto, grava na fila de saída com `dedupe_key` e envia pelo provedor com **presença "digitando…" e pausa aleatória** antes de cada resposta, teto de ritmo e escalonamento anti-bloqueio. Falha de envio vai para retentativa sem duplicar. Só número **verificado** recebe.
**Observabilidade:** logs sem conteúdo de mensagem nem dado de saúde (id, etapa, duração, tokens, erro); fila pendente/com erro e estado da instância visíveis em Configurações › WhatsApp; alerta ao administrador quando a instância desconecta ou os envios falham em sequência.
**Segredos só em variáveis de ambiente:** `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, base/chave/instância da Evolution Go e o segredo do caminho do webhook. Nunca no chat, no código ou em logs.
## 6. API v1 — escopo inicial
`/doses` (listar próximas/do dia, confirmar, desfazer, registrar depois), `/estoque` (visão, compra, ajuste), `/reposicoes` (listar, assumir, avançar), `/receitas` (listar, anexar, compartilhar, URL assinada), `/pacientes`, `/remedios`, `/esquemas`, `/membros`, `/perfis`, `/lembretes/pendentes`, `/avisos/estoque`, `/avisos/resumo`, `/telefone/verificar` (rota "pré-membro": código enviado pelo remetente), `/openapi.json`, `/sistema/*` (rotas de plataforma). Todas aplicam as permissões do ator.

## 7. O que reaproveitar do que já foi construído
> **Atualização (Lote 4B):** `packages/db`, `scripts/appwrite`, `apps/functions`, `packages/channels` e os JSON antigos de `integrations/n8n` foram **removidos** (ver `docs/handoffs/L4B-limpeza.md`).

| Parte | Destino |
|---|---|
| `packages/domain` (doses, estoque, previsão, escala, reposição, receitas) | **Mantém** (puro e testado), pequenos ajustes |
| `design/` e `apps/web` (telas, componentes, acessibilidade) | **Mantém**; trocar a camada de dados e o login |
| `packages/shared` | Mantém tipos/permissões; as coleções do Appwrite saem, entra o schema Drizzle |
| `packages/db` (FamilyScopedDb/Appwrite), `scripts/appwrite` | **Substituídos** por Postgres + Drizzle + RLS. O Appwrite fica só com Auth e bucket |
| `apps/functions` (agendador, fila, webhook, login por código) | **Substituído** por rotas da API e fluxos do N8N; reaproveitar testes e regras |
| `packages/channels` | **Sai**; o texto das mensagens passa a ser gerado pela API; o envio é do N8N |
| `integrations/n8n` | **Removido** (decisão de 22/10: sem N8N). A normalização do payload da Evolution Go e as regras de mensagem viram o módulo do provedor e o núcleo da conversa no portal (seção 5) |

## 8. Fases
- **R1 — Fundação v2:** Postgres (Docker local) + Drizzle + migrações + RLS + `withFamilia`; schema completo; seed demo; testes de isolamento (um banco, duas famílias, tentativas de cruzar dados).
- **R2 — API v1:** chaves, identificação por telefone, idempotência, OpenAPI, erros; rotas de doses/estoque/reposição/receitas sobre o domínio; testes.
- **R3 — Portal:** login Appwrite (e-mail/senha, convite, redefinição), validação do WhatsApp, camada de dados trocada para a API/Postgres, notificações no portal, bucket de receitas.
- **R4 — WhatsApp direto no portal (sem N8N):** webhook, fila, worker, núcleo da conversa, agente Claude só de leitura, lembretes agendados, simulador, roteiro com número de teste.
- **R5 — Qualidade e segurança:** RLS, LGPD, e2e, acessibilidade.
- **R6 — Piloto:** deploy no EasyPanel (portal, Postgres, Evolution Go já existente), família real, 2 semanas com conferência.

## 9. Decisões do dono registradas
Login e-mail/senha (Appwrite); validação do número depois do login, com o dono enviando o código ao sistema; sem WhatsApp verificado = sem mensagens; conversa **híbrida**; Postgres + Drizzle no EasyPanel; reaproveitar o que serve. **Revisão de 22/10/2026: sem N8N** — WhatsApp direto no portal (webhook + fila + worker), conversa em código e agente Claude (só leitura) por *tool use*, como no lote AG1 do projeto financeiro; escolhido por simplicidade operacional e testabilidade.

## 10. Pendências
- Criar o Postgres de produção no EasyPanel (quando chegar o piloto).
- Número de WhatsApp para o sistema (ainda não existe): a Parte B do `docs/lotes/L4B-roteiro.md` só roda depois dele.
- Trocar a chave de API do Appwrite colada no chat e apagar a família demo do Appwrite antes do piloto.
