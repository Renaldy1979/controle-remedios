# Lote 5B — Roteiro rápido (segurança e privacidade / LGPD)

> Decisões do dono em 02/11/2026 (`docs/13-seguranca-privacidade.md`): controlador = o dono (renaldy.sousa@gmail.com); exclusão da família agendada por **30 dias** (dá para cancelar); exportar e excluir só pelo **Administrador**.
> **Nunca cole senhas, chaves ou o segredo do webhook no chat.**

## Parte 0 — Subir a versão e rodar a migração (≈ 10 min)
1. **Variáveis novas: nenhuma.**
2. **Deploy** do `medcuidar-web` (commit do Lote 5B ou mais novo). Se o serviço de backup usa a mesma imagem de dependências, não precisa refazer.
3. **Migração** (console do app; troque a senha do dono; não cole no chat):
   ```bash
   DATABASE_URL_ADMIN='postgres://medcuidar_owner:SENHA_DONO@automacoes_medcuidar-db:5432/medcuidar' node /app/migrate/migrate.mjs
   ```
   Esperado: `Migrações aplicadas.` (aplica a **0012**: colunas de aceite e autorização e as funções da exclusão).
4. `…/api/health` → `{"status":"ok","database":"ok"}`.

## Parte 1 — Política e aceite (≈ 10 min)
5. Abra `…/privacidade` **sem entrar** (janela anônima). Esperado: a política, com seu e-mail como contato.
6. Entre com o seu usuário. Esperado: aparece **"Sua privacidade"** com a política e o botão **Li e aceito** (todo mundo que já existia aceita uma vez). Clique. Esperado: vai para o painel e **não pergunta de novo** nos próximos logins.
7. Convide uma pessoa de teste por **e-mail**: ao entrar pela primeira vez ela também vê a tela de aceite. Convide outra por **WhatsApp**: a mensagem de "Número verificado/Bem-vindo(a)" traz o **link da política** (o aceite fica registrado nessa hora).

## Parte 2 — Autorização do paciente (≈ 5 min)
8. **Configurações › Pacientes › Cadastrar paciente**. Preencha o nome e clique **Salvar** sem marcar nada. Esperado: erro **"Confirme a autorização para cadastrar os dados de saúde."**
9. Marque **"Tenho autorização desta pessoa, ou sou o responsável por ela"** e salve. Esperado: cadastra.
10. Edite um paciente que já existia (cadastrado antes do lote): o campo aparece **sem ser obrigatório**; marcar registra a declaração.

## Parte 3 — Exportar (≈ 5 min)
11. **Configurações › Privacidade e dados**. Com o perfil de Administrador aparecem **Baixar os dados** e **Excluir a família…**; com outro perfil só a política (e o aviso de que exportar/excluir é do Administrador).
12. **Baixar os dados**: abre/baixa `medcuidar-dados-AAAA-MM-DD.json`. Confira: tem seus pacientes, remédios, doses, estoque, receitas (sem as fotos) e a auditoria; **não tem** senhas, hashes de chave nem códigos.

## Parte 4 — Excluir a família (use uma família de TESTE, não a real) (≈ 15 min)
13. Crie uma conta e uma família de teste (ou use a que o roteiro 5A criou). **Configurações › Privacidade e dados › Excluir a família…**. Digite um nome **errado** → erro "O nome digitado não confere". Digite o nome certo → **Agendar a exclusão**.
14. Esperado: a tela **"Exclusão agendada"** com a data (hoje + 30 dias) e o botão **Cancelar a exclusão**. Nenhum lembrete de WhatsApp sai dessa família e o WhatsApp dela deixa de responder.
15. Entre com **outra pessoa** dessa família (que não seja Administrador): vê a mesma tela, **sem** o botão de cancelar.
16. Como Administrador, **Cancelar a exclusão**. Esperado: volta ao painel, tudo como antes.
17. (Opcional, prova da exclusão definitiva) Agende de novo e, no console do Postgres, adiante o relógio: `UPDATE families SET deleted_at = now() - interval '31 days' WHERE name = 'NOME DA FAMÍLIA DE TESTE';`. Em até 6 h (ou ao reiniciar o `medcuidar-web`) a rotina apaga a família: o login dela deixa de funcionar e as fotos de receita somem do bucket. **Só faça isso com a família de teste.**

## Parte 5 — Segurança (≈ 10 min)
18. Cabeçalhos: no navegador (F12 › Rede), abra qualquer página e veja nas respostas `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` e `Strict-Transport-Security`. A receita em PDF continua abrindo na tela.
19. Limite de login: tente entrar **9 vezes** com a senha errada para o mesmo e-mail. Esperado: a partir da 9ª, **"Muitas tentativas erradas. Aguarde N min"**. Depois de 15 min (ou reiniciando o app) volta a aceitar.
20. WhatsApp: com mais de 9 doses pendentes, **tomei** mostra a lista e a última opção é **Todas (as N pendentes)**; o número dela (pode ser **10**) ou **todos** confirma tudo. Doses pendentes de até 48 h entram.

## Parte 6 — Rotação de chaves e backup (sua lista; ver docs/13 seção 4)
21. Troque, uma por vez, no provedor **e** no EasyPanel, reiniciando o serviço depois: `EVOLUTION_API_KEY` e `EVOLUTION_INSTANCE_TOKEN`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `WHATSAPP_WEBHOOK_SECRET` (muda a URL do webhook na Evolution) e `FILE_URL_SECRET`. Confira que o WhatsApp responde e uma receita abre. **Não** troque a `BACKUP_ENCRYPTION_KEY`.
22. Logs do staging: no EasyPanel, abra os logs do `medcuidar-web` de hoje e procure por nome, e-mail, telefone ou texto de mensagem. Esperado: **nada** (só códigos de erro e contagens). Se achar algo, me mande o trecho **sem apagar a linha**, trocando só o dado pessoal por `XXX`.
