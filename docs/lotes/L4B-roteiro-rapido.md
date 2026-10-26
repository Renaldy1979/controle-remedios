# Lote 4B — Roteiro rápido (dono único, WhatsApp real)

> Atalho decidido pelo dono em 26/10/2026: só ele usa o sistema, então **pulamos o simulador, o teste com a família e o aquecimento longo** e ligamos o WhatsApp direto. O roteiro completo (`L4B-roteiro.md`) continua valendo como referência. Passo a passo detalhado de cada item: `docs/11-whatsapp-direto.md`.
> **Nunca cole senhas, chaves ou o segredo do webhook no chat.** Mande só o que o portal mostra (estados, contadores, horários) e linhas de log sem segredos.

## O que você precisa ter (já está pronto)
- Chip dedicado conectado na instância `medcuidar` da Evolution Go.
- Variáveis no `medcuidar-web`: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_ID`, `WHATSAPP_WEBHOOK_SECRET` (+ as de antes: `APP_URL`, `DATABASE_URL`, `APPWRITE_*`, `FILE_URL_SECRET`, `APPWRITE_PRESCRIPTIONS_BUCKET_ID`).

## Parte 1 — Subir a versão nova (≈ 15 min)
1. **Variáveis (EasyPanel → `medcuidar-web` → Environment):**
   - crie **`WHATSAPP_WORKER_ENABLED=1`** (liga o worker agora);
   - confira que **não** existe `WHATSAPP_PROVIDER=fake`; pode manter `SIMULATOR_ENABLED=1` (não atrapalha);
   - apague `PLATFORM_KEYS_FROM_PORTAL` e `ALLOW_PRIVATE_WEBHOOKS` se existirem.
2. **Deploy** do app (o GitHub já está no commit `df44b43` ou mais novo).
3. **Migrações** (console do app; troque a senha do dono; não cole no chat):
   ```bash
   DATABASE_URL_ADMIN='postgres://medcuidar_owner:SENHA_DONO@automacoes_medcuidar-db:5432/medcuidar' node /app/migrate/migrate.mjs
   ```
   Esperado: `Migrações aplicadas.` (aplica de 0007 a 0010).
4. Abra `https://automacoes-medcuidar-app.8m5sgi.easypanel.host/api/health` → `{"status":"ok","database":"ok"}`.
5. Entre no portal como administrador (a conta de sempre).

## Parte 2 — Ligar o webhook (≈ 5 min)
6. Na **Evolution Go**, na instância `medcuidar`, cadastre o **webhook** (campo "Webhook"), assinando **só mensagens recebidas (`MESSAGE`)**, com o endereço:
   `https://automacoes-medcuidar-app.8m5sgi.easypanel.host/api/whatsapp/evolution/<valor de WHATSAPP_WEBHOOK_SECRET>`
   (se a tela não tiver o campo, é `POST /instance/connect` com `webhookUrl` e `subscribe:["MESSAGE"]`, como em `docs/11` seção 3; não coloque a chave no chat, use o seu terminal).
7. No portal: **Configurações › WhatsApp → Consultar agora**. Esperado: instância **Conectada** e selo **Worker ligado**.

## Parte 3 — Primeira conversa de verdade (≈ 10 min)
8. No portal, em **Configurações › WhatsApp → Meu WhatsApp**, digite **o seu número pessoal** (o do seu celular de uso, com DDD, do jeito que o WhatsApp mostra) e toque em **Gerar código**.
9. Do **seu celular pessoal**, salve o número do chip como "MedCuidar", mande um **"oi"** e depois **o código de 6 dígitos**. Esperado: resposta **"Número verificado"** em alguns segundos (o sistema espera 2–6 s de propósito) e a etiqueta **Verificado** no portal.
   *Nono dígito:* se o chip não responder, cadastre o número **sem o 9** (ou com), e tente de novo; me avise qual forma funcionou.
10. Mande, nesta ordem: **ajuda** → **estoque** → **próximas doses**. Esperado: respostas curtas com os dados reais.
11. **Dose real:** em **Configurações › Esquemas**, ponha um horário **daqui a 5 minutos** para um remédio com estoque. Esperado: chega o **lembrete** no seu WhatsApp. Responda **tomei** → "dose confirmada", o estoque cai 1 no portal.
12. **Pergunta livre (Claude):** "o remédio do Adelino vai acabar logo?" → resposta do assistente (só consulta).
13. **Áudio (Gemini):** mande um áudio dizendo "como está o estoque?" → resposta com o estoque. (Áudio dizendo "tomei" não confirma: o sistema pede para escrever.)
14. **PARAR / REATIVAR:** escreva **PARAR** (para de receber avisos) e **REATIVAR**.

## Parte 4 — Pronto quando
- [ ] Passos 9, 10, 11, 12 e 13 funcionaram. 14 é bônus.
- [ ] Em **Configurações › WhatsApp** o quadro mostra mensagens **processadas** e **sem erro**.
- Registre o resultado em `docs/lotes/L4B-validacao.md` (ou me conte aqui).

## Se algo não responder
1. **Quadro "Mensagens recebidas" zerado:** o webhook não chega (segredo/endereço) ou o formato da mensagem é diferente. Confira o segredo no fim do endereço; se estiver certo, me mande a **hora** da mensagem de teste: a correção é uma função pequena no provedor (`provider/evolution-go.ts`).
2. **Pendentes que não andam:** selo **Worker** "desligado" → falta `WHATSAPP_WORKER_ENABLED=1` + Deploy.
3. **Erros no quadro:** leia o motivo resumido (instância desconectada, chave errada) e corrija.
4. Em qualquer caso, copie as **últimas ~30 linhas do log do app** no EasyPanel (aba Logs; elas **não** têm texto de mensagens) e me mande.

## O que foi cortado do plano anterior (e quando volta)
- Simulador e Parte A completa: dispensados (você testa direto no WhatsApp).
- Convite por WhatsApp para familiares e o teste de números não verificados: voltam quando entrar a 2ª pessoa (os testes automáticos já cobrem).
- Teste de queda da Evolution: opcional, depois.
