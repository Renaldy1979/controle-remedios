# 08 — Entrega por lotes

**Regra:** cada lote termina com algo que o dono **abre e testa** num ambiente de staging, com um **roteiro de teste** passo a passo. O lote só é dado como pronto quando (1) os testes automáticos passam, (2) o orquestrador conferiu e (3) **o dono validou o roteiro**. O lote seguinte só começa depois do "validado".

Fluxo de cada lote: construir → testes automáticos → orquestrador confere → publicar no staging → dono roda o roteiro → registrar o resultado em `docs/lotes/L<n>-validacao.md` (ok, ajustes pedidos, pendências) → corrigir → "validado".

**Ambiente de teste:** staging no EasyPanel (portal Next.js + Postgres), com URL para abrir no computador e no celular. O dono cria os serviços no EasyPanel seguindo `docs/09-deploy-staging.md` (entregue no Lote 1).

## Modelo de entrada na família (definido pelo dono)
- **Primeiro usuário = administrador.** Cria a conta (e-mail e senha), **valida o e-mail** (Appwrite) e informa e valida o **WhatsApp**. Sem WhatsApp verificado ele usa o portal normalmente, só não recebe mensagens.
- **Convite por e-mail:** o convidado faz o mesmo processo do admin (valida o e-mail, define a senha).
- **Convite por WhatsApp:** o admin gera um código de convite para a pessoa. O convidado salva o número do sistema e **envia o código** por WhatsApp; o número é reconhecido como verificado e ele **entra na família já validado**. Indicado para quem usa WhatsApp mas não tem familiaridade com e-mail.
- **Todo usuário precisa de e-mail e senha** (decisão do dono). Quem entra pelo WhatsApp fica `whatsapp_verified` (pode dar o check, ver a próxima dose, consultar estoque e receber avisos) e só vira `active` no **primeiro acesso ao portal**, por um link de uso único enviado ao WhatsApp dele. Receitas, compartilhamento e administração exigem `active`. Detalhes em `docs/06` seção 2.
- O convite por WhatsApp fica preso ao **número esperado** informado pelo admin, vale uma vez e expira em 24 h.

---

## Lote 1 — Acesso e cadastros
**Você testa:** abrir o portal pelo link, criar a conta de administrador, validar o e-mail, entrar, cadastrar a família, convidar um membro por e-mail, configurar perfis e cadastrar pacientes, remédios e esquemas.
- Staging no ar com HTTPS (portal + Postgres).
- Criar conta (e-mail e senha), validar e-mail, entrar/sair, redefinir senha.
- Primeira entrada cria a **família** e o administrador. Campo do número de WhatsApp (fica "pendente": a validação real chega no Lote 4).
- Convidar por e-mail e aceitar o convite; **criar o convite por WhatsApp** (número esperado, perfil, código de uso único com validade). O uso do código, o link de primeiro acesso e a tela de primeiro acesso chegam no Lote 4. O modelo de dados já nasce com os três estados (`invited`, `whatsapp_verified`, `active`).
- Perfis e permissões (matriz) e usuários da família; a tela se adapta ao perfil (Confirmador não vê Configurações).
- Cadastro de **pacientes** (um ou mais; paciente pode ter conta), **remédios** (marcas alternativas, via de uso, unidade) e **esquemas com fases**.
- Isolamento: uma segunda família criada no staging não enxerga nada da primeira.

**Roteiro:** 1) criar conta e validar e-mail; 2) criar a família; 3) convidar uma filha por e-mail e entrar com ela; 4) confirmar que o perfil Confirmador não vê Configurações; 5) cadastrar Adelino e Maria; 6) cadastrar o Zypred com duas fases (3 em 3 h por 15 dias, depois 6 em 6 h); 7) criar uma segunda família com outro e-mail e conferir que não vê os dados da primeira.

**Fora do lote:** doses, estoque, receitas, WhatsApp.
**Precisa do dono:** criar no EasyPanel o Postgres e o serviço do portal (passo a passo no `docs/09`); confirmar que o Appwrite envia e-mail (SMTP).

## Lote 2 — Doses e estoque (o núcleo do problema)
**Você testa:** a agenda do dia, dar o check, ver o estoque baixar e o aviso de estoque baixo.
- Doses do dia geradas a partir das fases; **Início** com próximas doses, atrasadas e esquecidas.
- Confirmar dose, desfazer, registrar que tomou depois; quem deu e quando.
- **Estoque:** saldo inicial (compra), baixa automática a cada dose confirmada, ajuste manual, previsão de término (colírio sinalizado como estimativa).
- Limite configurável (padrão e por remédio); ao atingir, **aviso no portal** (sino) para todos os usuários com permissão de comprar ou administrar.
- Pacientes que dão dose a outros pacientes; permissões valendo (Confirmador só dá o check e vê a próxima).

**Roteiro:** 1) cadastrar um remédio com 10 comprimidos e esquema de 1 por dia; 2) confirmar 3 doses e ver o saldo cair; 3) desfazer uma e ver o saldo voltar; 4) baixar o estoque até o limite e ver o aviso no sino de dois usuários; 5) ver a previsão de término mudar ao trocar a fase; 6) entrar como Confirmador e conferir o que ele vê.

## Lote 3 — Receitas e reposição
**Você testa:** anexar a foto da receita pelo celular, ver o histórico e conduzir uma reposição até o estoque ser atualizado.
- Upload de fotos/PDF no bucket do Appwrite, páginas, validade, situação (vigente, vence em X dias, vencida), visualizador e histórico.
- Compartilhar dentro do portal e controle de quem pode ver.
- **Reposição** em 4 etapas (pedir receita, receita recebida, comprado, estoque atualizado) com "Eu cuido disso" e responsável por etapa; registrar a compra soma ao estoque.

**Roteiro:** 1) anexar uma receita com duas páginas pelo celular; 2) ver o aviso "vence em X dias"; 3) abrir a reposição de um remédio no limite; 4) outra pessoa assume a compra; 5) registrar a compra e ver o estoque e a previsão atualizarem; 6) conferir que um perfil sem permissão não vê a receita.

## Lote 4A — API, validação do número e simulador de WhatsApp
Primeira metade do WhatsApp, **testável sem número real**: o dono usa um **simulador de WhatsApp dentro do portal** (só para o administrador, com aviso "nenhuma mensagem real é enviada"), que fala com a mesma API que o N8N vai usar.
- **API `/api/v1`** no portal: chaves por família (`cdf_`) e de plataforma (`cpl_`, escopo conversa) guardadas só como hash e revogáveis; identificação pelo telefone do remetente (`X-Telefone`), só número verificado é atendido; `Idempotency-Key`; erros padronizados; OpenAPI em `/api/v1/openapi.json`.
- **Validação do número depois do login** (o portal mostra um código de 6 dígitos, vale 15 min; o dono do número o envia ao WhatsApp do sistema). Só número verificado recebe mensagens.
- **Conversa em código, sem IA:** código de verificação, confirmar dose ("tomei", 1/2, ok, ✅), lembrar de novo, "eu cuido disso", consultas simples (estoque, próximas doses). Texto livre fora disso devolve "livre" (o agente de IA chega no 4B).
- **Mensagens prontas** (lembrete de dose, esquecida, estoque baixo, receita vencendo, reposição, resumo diário) geradas pela API; fila de mensagens a enviar com marcação idempotente de enviadas.
- **Convite por WhatsApp completo:** o convidado envia o código **do número esperado** → fica `whatsapp_verified` com permissões básicas → recebe o **link de primeiro acesso** → define e-mail e senha → vira `active`.
- Configurações → WhatsApp: estado do número, chaves de API (mostradas uma vez).

**Roteiro (no staging, com o simulador):** 1) cadastrar o seu número e ver "pendente"; 2) enviar o código no simulador e ver "verificado"; 3) usuário sem número verificado: o simulador não é atendido; 4) "tomei" confirma a dose e baixa o estoque; 5) "estoque" e "próximas doses"; 6) ver a fila de lembretes que o sistema gera para a dose e para o estoque baixo; 7) convidar uma pessoa por código de WhatsApp e concluir o primeiro acesso; 8) criar e revogar uma chave de API.

## Lote 4B — WhatsApp direto no portal, sem N8N (revisado em 22/10/2026)
O dono trocou o N8N por código no portal (`docs/06` seção 5). Entrega: webhook da Evolution Go na rota do portal, **fila no Postgres e worker**, núcleo da conversa (o do 4A, agora alimentado pelo WhatsApp real), **agente Claude só de leitura** para perguntas livres, áudio e imagem via Gemini, **lembretes agendados** (dose, esquecida, estoque, receita, reposição, resumo) pelo mesmo worker, anti-bloqueio (presença "digitando…", pausas, teto de ritmo, PARAR/REATIVAR), observabilidade e alerta de desconexão, e a limpeza do que era do N8N (fluxos, validador, teste de conexão, chave `cpl_` no portal).
- **Parte A, sem número:** tudo funciona no **simulador** (mesma conversa, agora passando pela fila e pelo worker), com o Claude de verdade nas perguntas livres e o modelo simulado nos testes automáticos.
- **Parte B, com número real:** o dono conecta o chip dedicado por QR Code, valida o próprio número pelo WhatsApp, recebe o lembrete, responde "tomei", pergunta "como está o estoque?" (texto e áudio), vê um número não verificado ser ignorado, convida por código de WhatsApp e confere o alerta de desconexão.
**Precisa do dono (fora do chat):** variáveis no EasyPanel (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, base/chave/instância da Evolution Go, segredo do caminho do webhook) e o número de WhatsApp do sistema.
## Lote 5 — Qualidade, segurança e piloto
**Você testa:** o uso real com a família por duas semanas.
- Revisão de segurança e LGPD (RLS, chaves, logs sem dados pessoais, URLs assinadas), acessibilidade, e2e, backup e restauração testados.
- Trocar as chaves usadas em desenvolvimento, apagar dados de demonstração.
- Cadastro real dos sogros e acompanhamento com conferência paralela ao papel.

---

## O que cada lote entrega (definição de pronto)
1. URL de staging com a versão do lote e dados de exemplo.
2. Roteiro de teste de uma página (acima, refinado) em `docs/lotes/L<n>-roteiro.md`.
3. Testes automáticos verdes (unidade, integração e e2e do que mudou), lint e tipos limpos.
4. Lista de limitações conhecidas.
5. Registro da validação do dono em `docs/lotes/L<n>-validacao.md`.

## Situação atual
- **Lote 4B (revisado em 22/10/2026) construído**, aguardando validação do dono: ver `docs/lotes/L4B-roteiro.md` (Parte A sem número, Parte B com número real) e `docs/11-whatsapp-direto.md`.
- Fundação Postgres (sessão R1) em andamento: é o primeiro passo do Lote 1.
- Reaproveitados nos próximos lotes: domínio, telas e design já feitos.
