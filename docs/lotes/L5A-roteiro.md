# Lote 5A — Roteiro rápido (perfil "Somente leitura")

> Para quem só **acompanha** (um sobrinho, uma tia): vê doses, pacientes, histórico e estoque, **não age** e **só recebe o resumo diário** pelo WhatsApp. Decisão do dono em 26/10/2026 (`docs/06-escopo-v2.md` seção 2, `docs/08-lotes.md` item 5A).
> **Nunca cole senhas, chaves ou o segredo do webhook no chat.**

## Parte 0 — Subir a versão e rodar a migração (≈ 10 min)
1. **Variáveis novas: nenhuma.** Não precisa mexer no EasyPanel.
2. **Deploy** do app (o GitHub no commit do Lote 5A ou mais novo).
3. **Migração** (console do app; troque a senha do dono; não cole no chat):
   ```bash
   DATABASE_URL_ADMIN='postgres://medcuidar_owner:SENHA_DONO@automacoes_medcuidar-db:5432/medcuidar' node /app/migrate/migrate.mjs
   ```
   Esperado: `Migrações aplicadas.` (aplica a **0011**: cria o perfil "Somente leitura" na sua família e em qualquer outra; rodar de novo não duplica nem mexe nos outros perfis).
4. Abra `https://automacoes-medcuidar-app.8m5sgi.easypanel.host/api/health` → `{"status":"ok","database":"ok"}`.

## Parte 1 — Conferir o perfil (≈ 5 min)
5. Entre como administrador → **Configurações › Perfis**. Esperado: uma 5ª coluna **"Somente leitura"** (depois de Confirmador). Nela:
   - **Ver doses e estoque** e **Consultar pelo WhatsApp**: **Sim**; **Ver receitas**: **Não**.
   - Todas as outras linhas (confirmar dose, editar remédios, compra/estoque, anexar/compartilhar/excluir receitas, gerenciar usuários) mostram o cadeado e o texto **"ação: indisponível neste perfil"**: não há botão para ligar.
6. **Ver receitas** dessa coluna você **pode** ligar (libera só a leitura). Teste ligar e desligar de novo; ao final deixe **Não**.

## Parte 2 — Convidar e entrar (≈ 10 min)
7. **Configurações › Pessoas › Convidar pessoa** → escolha o perfil **Somente leitura**. Faça pelo **e-mail** de alguém seu (ou um e-mail seu de teste) e abra o link do convite; crie a senha. Esperado: entra no portal.
8. Como essa pessoa, confira o **menu**: só **Início, Pacientes e Histórico** (sem Receitas e sem Ajustes). Em **Início** e **Pacientes** vê as doses e o estoque, mas **não há botões** de "Tomei", "Registrar compra", "Ajustar estoque", "Eu cuido disso", "Anexar receita".
9. Ainda como essa pessoa, tente digitar `/configuracoes` ou `/receitas` no endereço. Esperado: sem acesso (nada de pessoas, perfis, chaves nem receitas).

## Parte 3 — WhatsApp (≈ 10 min)
10. Convide outra pessoa (ou use o mesmo perfil) **por WhatsApp**: o celular dela manda o código de 6 dígitos para o chip. Esperado: "Número verificado".
11. Dessa pessoa, mande **tomei**. Esperado: **"Seu perfil não permite"** (a dose continua aberta e o estoque não muda). Mande também **eu cuido disso**: mesma resposta.
12. Mande **estoque** e **próximas doses**: responde normal (ela pode consultar). **PARAR** e **REATIVAR** continuam funcionando.
13. No horário do **resumo diário** (20:00 por padrão), essa pessoa recebe **só o resumo**: nenhum lembrete de dose, nenhum aviso de esquecida, de estoque baixo, de receita vencendo nem de reposição.

## Parte 4 — Pronto quando
- [ ] Passos 5 e 6 (coluna travada, leitura de receitas liberável).
- [ ] Passos 7 a 9 (entra, vê só leitura, sem botões, sem configurações).
- [ ] Passos 11 e 12 ("tomei" recusado; consultas funcionam).
- [ ] Passo 13 (só o resumo diário).
- Registre o resultado em `docs/lotes/L5A-validacao.md` (ou me conte aqui).

## Quem recebe cada aviso (regra geral, vale para todos os perfis)
| Aviso | Quem recebe |
|---|---|
| Lembrete de dose | quem pode confirmar dose (`doses.confirm`) e está na escala do paciente |
| Dose esquecida | quem pode confirmar dose; entre eles, quem foi marcado em "avisos da família" (se ninguém, todos os que podem confirmar) |
| Estoque baixo | quem pode ajustar estoque ou cuidar da reposição (`stock.adjust` / `replenishment.manage`) ou é administrador |
| Receita vencendo | quem vê receitas **e** pode anexar ou cuidar da reposição |
| Reposição (andamento) | quem pode cuidar da reposição (`replenishment.manage`) |
| Resumo diário | todos com `dashboard.view` (inclui "Somente leitura") |

Em todos os casos: só com **número verificado** e sem ter mandado **PARAR**.

## Se algo não bater
1. A coluna "Somente leitura" não aparece: a migração 0011 não rodou (passo 3).
2. A pessoa vê botões de ação: me mande o nome da tela (a regra do servidor continua valendo e recusa, mas o botão deveria sumir).
3. Receitas aparecem para o perfil: confira em Configurações › Perfis se "Ver receitas" está **Sim** (padrão **Não**).
