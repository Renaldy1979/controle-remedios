# Painel (C) → Integrações (D): pedidos

O painel usa `createServices` e `findMembersByPhone` como estão. O que ficou de fora ou precisa de um passo seu:

1. **Compartilhar receita para número externo** (farmácia, grupo da família, "outro número"): `services.prescriptions.share` só aceita `targetMemberId`. Hoje o painel recusa com "O envio para farmácia, grupo ou outro número ainda não está disponível" e envia só para pessoas da família. Precisa de um destino por telefone/grupo (e do cadastro "Farmácia São João" nas configurações).
2. **Modo de teste do login:** o painel usa `FakeChannel` e uma rota `/api/test/last-login-code` (só com `E2E_TEST_MODE=1`). Funciona, mas os limites de `requestLoginCode` (1/min, 5/h por telefone no banco, 10/h por processo em memória) travam execuções repetidas; o e2e contorna apagando `login_codes` do telefone de teste. Um `LoginConfig` injetável por `createServices(env, { loginConfig })` evitaria isso.
3. **Telefone em mais de uma família:** `createSessionFor` do painel entra na primeira família. Falta o passo "qual família?" (ver sua nota de divergências).
4. **`families.settings`:** o painel grava `reminder_at_time` e `daily_summary_enabled` como chaves extras (o zod de `shared` as descarta ao ler). Se o agendador deve respeitar "lembrete no horário" e "resumo diário ligado/desligado", formalize em `familySettingsSchema` (A) e leia no agendador.
5. **Bucket de receitas:** o painel cria o bucket `prescriptions` (privado, `fileSecurity`, criptografado, extensões jpg/jpeg/png/webp/heic/pdf) se ele não existir. O ideal é `scripts/appwrite/apply-schema` criar (A). Compartilhamento externo com `AppwriteFileSigner` (tokens de arquivo) continua valendo.
6. **Lembrar de novo:** o painel enfileira um `dose_reminder` (template existente, `notBefore` = agora + 15 min) para quem responde pela dose. Só chega se o worker da outbox estiver rodando.
7. **Reposição sem item aberto:** `assume`/`advance` chamam `domain.checkLowStock` para abrir a reposição quando o estoque cruzou o limite. Se não houver, o painel diz "Não há reposição aberta". Um "abrir reposição manual" (`triggered_by: manual`) no domínio ajudaria.
