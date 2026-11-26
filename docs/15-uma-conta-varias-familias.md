# 15 — Uma conta, várias famílias (Lote 5E)

Contrato do Lote 5E. Pedido e decisões do dono em 26/11/2026. **Onde este documento conflitar com os anteriores sobre login, convite, vínculo ou número de WhatsApp, vale este.** Ainda não implementado.

## 1. Problema
Hoje um login pertence a uma única família (`members_appwrite_user_uq`) e um número verificado existe uma única vez no sistema (`members_phone_verified_uq`). Quem é cuidadora numa família precisaria de outro e-mail e senha para ter a própria.

## 2. Decisões do dono
- **Um login por pessoa**, com um vínculo por família. Cada vínculo tem o seu perfil.
- **WhatsApp atende todas as famílias** da pessoa. Quando houver dúvida, o sistema pergunta.
- **Sem limite de famílias.** O sistema vai ser um SaaS com cobrança por família; até lá, qualquer pessoa cria quantas quiser. Cobrança está fora deste lote.
- **Ordem:** validação do 5C → 5E → piloto (5D).

## 3. Modelo
- **Pessoa** = conta do Appwrite. **Vínculo** = linha de `members` (continua com `family_id`, perfil, nome, estado de acesso e permissões próprios). Não há tabela nova de usuários.
- `members_appwrite_user_uq` vira índice único em `(family_id, appwrite_user_id)`.
- `resolve_member_by_appwrite_user` passa a devolver **todos** os vínculos, com o nome da família.
- O RLS e `withFamilia` **não mudam**: cada requisição trabalha em uma família só.

## 4. Portal
### 4.1 Família ativa
- Cookie httpOnly `mc_familia` com o id da família escolhida. Ele é **só preferência**: a cada requisição o servidor confere que está na lista de vínculos utilizáveis da conta logada. Valor desconhecido é ignorado.
- Um vínculo utilizável: entra direto. Vários e nenhuma escolha válida: tela **Escolher família** (nome da família e o perfil da pessoa nela). Menu: **Trocar de família**; o nome da família ativa fica sempre visível.
- Vínculos desativados, removidos ou de família inativa não aparecem. Sem nenhum utilizável: a tela de acesso desativado também oferece **Criar minha família**.
- Aceite de privacidade e exclusão agendada continuam **por vínculo/família**. Uma família com exclusão agendada não impede o uso das outras.
- Toda troca de família recarrega os dados (nenhum cache do navegador atravessa a troca).

### 4.2 Criar a própria família
Qualquer conta com e-mail confirmado pode criar famílias, mesmo já participando de outras, e vira Administrador da nova. A nova começa vazia: nada é copiado.

### 4.3 Convite por e-mail
- **Conta nova** (e-mail nunca confirmado e sem vínculo): como hoje. Define a senha, e as sessões antigas são derrubadas (proteção contra quem cadastrou o e-mail de outra pessoa e não confirmou).
- **Conta existente** (e-mail já confirmado ou com algum vínculo): **não muda senha nem nome e não derruba sessões**. A tela pede para entrar com a senha atual (com "Esqueci minha senha") e então **Aceitar convite**. A conta logada precisa ter o mesmo e-mail do convite.
- A situação da conta é lida no Appwrite **antes** de consumir o link mágico, porque o próprio link marca o e-mail como confirmado.
- Quem administra a família não é informado se o e-mail já tinha conta.

### 4.4 Primeiro acesso de quem veio pelo WhatsApp
A tela oferece **Criar meu acesso** (como hoje) ou **Já tenho conta**. No segundo caminho a pessoa entra e o vínculo é ligado à conta (o link prova o número; a senha prova a conta). A ativação automática por e-mail (`activate_member_by_email`) **continua valendo só para conta sem nenhum vínculo**.

## 5. Proteções obrigatórias
| Ação numa família | Regra |
|---|---|
| Desativar pessoa | Encerra **só o vínculo**. Não bloqueia o login nem derruba sessões; o acesso já é negado a cada requisição pelo banco. |
| Reativar pessoa | Reativa só o vínculo. |
| Excluir a família (30 dias) | O login no Appwrite só é apagado se a conta **não tiver vínculo em outra família** (função segura no banco que responde só sim/não). |
| Exportar dados | Somente da família ativa. |

**Ajuste único na publicação:** contas bloqueadas no Appwrite por desativações antigas precisam ser liberadas (comando idempotente, que mostra apenas contagens).

## 6. WhatsApp
### 6.1 Número
- Um número verificado pertence a **uma pessoa**. Índice passa a `(family_id, phone_verified)`; o banco recusa o mesmo número ligado a **duas contas diferentes** (`em_uso`), com trava para corrida.
- Numa segunda família, a pessoa pode tocar em **Usar este número aqui também** quando a mesma conta já o verificou em outra. É uma ação explícita; nada é copiado sozinho.
- Convite por WhatsApp para um número já verificado em outra família passa a ser aceito (o código sai do próprio aparelho), salvo conflito de contas.
- Trocar ou remover o número numa família não mexe nas outras.
- **PARAR e REATIVAR valem para o número**, ou seja, para todas as famílias.

### 6.2 Conversa
O remetente verificado vira uma **lista de vínculos**; cada um com as permissões daquela família. Com um vínculo só, tudo continua como hoje.
| Pedido | Com dois ou mais vínculos |
|---|---|
| Confirmar, desfazer, lembrar depois, "eu cuido disso" | Junta as candidatas das famílias permitidas. Todas na mesma família: age como hoje. Em mais de uma: opções numeradas com o nome da família. **Nunca adivinha.** |
| Resposta numerada | Resolve contra a pergunta **mais recente**; cada opção guarda a sua família. |
| Estoque e próximas doses (sem IA) | Mostra todas, separadas por família. |
| Pergunta livre (IA) | Pergunta "Sobre qual família?" (ou reconhece o nome citado) e mantém a escolha por 30 min. **Dados de duas famílias nunca vão no mesmo pedido ao modelo**; o custo é registrado na família escolhida. |
| Link de acesso | Se houver mais de um vínculo pendente, pergunta qual. |

- Toda mensagem enviada a quem tem 2+ famílias **identifica a família** (lembretes, avisos e respostas).
- Uma mensagem recebida age **uma única vez**, mesmo repetida pelo provedor (idempotência atual mantida).
- Confirmar dose continua sem passar por IA; a identidade vem sempre do remetente real.
- **API `/api/v1`:** com chave de família, só vale o vínculo daquela família. Com chave de plataforma, telefone ambíguo continua respondendo `404`.

## 7. Entrega em duas partes, cada uma validada pelo dono
- **5E-A (portal):** seções 3 a 5. O número continua valendo em uma só família.
- **5E-B (WhatsApp):** seção 6.

## 8. Testes obrigatórios
- Isolamento: conta em A e B nunca lê A com B ativa, inclusive com cookie `mc_familia` forjado com uma terceira família.
- Perfis diferentes na mesma conta: permissão de administrador em B não vale em A.
- Convite para conta existente não altera senha, nome nem sessões; conta não confirmada segue o caminho de conta nova.
- Desativar em A mantém o login e o acesso a B. Excluir A mantém a conta de quem está em B e apaga a de quem só estava em A.
- Número: mesma conta em duas famílias aceito; duas contas diferentes recusado, também em corrida.
- Conversa: pendência em uma ou duas famílias, resposta numerada, mensagem repetida, PARAR, pergunta livre sem mistura de dados.

## 9. Publicar e voltar atrás
A migração só afrouxa índices e troca funções. **Voltar para a versão anterior é seguro apenas enquanto ninguém tiver dois vínculos**, porque o código antigo usaria um deles ao acaso. Depois disso, corrigir para a frente. Faça o backup manual antes de migrar (`docs/14-operacao.md`).
