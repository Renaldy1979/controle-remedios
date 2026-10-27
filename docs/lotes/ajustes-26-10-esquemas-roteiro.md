# Ajustes de 26/10/2026 — Esquemas e "tomei" no WhatsApp (roteiro rápido)

> Pedidos do dono depois do Lote 5A. Sem variáveis novas e sem migração: só fazer o deploy.

## 1. Horário padrão e resumo do dia (Configurações › Esquemas › Editar esquema)
1. **Remédios › Novo remédio** (qualquer um). Abra **Esquemas** e escolha o remédio novo.
   Esperado: **Primeiro horário do dia** já vem com o **próximo horário redondo** (22:21 → **22:30**; 22:30 → 23:00; depois das 23:30 vira 00:00 e a data de início vai para amanhã) e **Começa em** com a data de hoje. Remédio com esquema já ajustado não muda.
2. Logo abaixo de **Horários gerados** aparece o quadro **Resumo do que vai acontecer**:
   - **Todos os dias:** quantas doses e quais horários (o dia termina à meia-noite e o esquema recomeça no primeiro horário).
   - **Hoje (dd/mm):** quantas doses ainda faltam e quais, e as que já passaram.
   - Se o primeiro horário corta o dia (ex.: de hora em hora começando às 22:30 → só 22:30 e 23:30, **todos os dias**), um **Atenção** explica e sugere começar às **00:00** para ter as 24 doses.

## 2. Calendário dos esquemas (Configurações › Esquemas › aba Calendário)
3. Abra a aba **Calendário**. Esperado: o mês atual, com **quantas doses** cada dia (texto, não só cor); hoje com contorno escuro.
4. Toque num dia: abaixo aparecem horário, remédio e dose daquele dia. Use as setas para trocar de mês.
5. Filtros **Paciente** e **Remédio** (o de remédio só lista os do paciente escolhido). As fases (ex.: 3 em 3 h por 15 dias, depois 6 em 6 h) aparecem mudando conforme o dia.
   *O calendário mostra o que o esquema prevê; não mostra o que já foi tomado (isso fica no Início e no Histórico).*

## 3. "tomei" com vários remédios (WhatsApp)
6. Com 2 ou mais doses do mesmo paciente e horário abertas, mande **tomei**. Esperado: **não** volta o menu; já pergunta a **1ª dose** (1 de N) com **1 Tomei · 2 Lembrar · 3 Não vou tomar · 4 Tomei todos (os N que faltam)**.
7. Responda **1** em cada uma até o fim (resumo "Pronto — …"), ou **4**/**todos** no meio para confirmar o restante de uma vez. Na última dose a opção 4 não aparece.
8. **tomei Losartana** (citando o remédio) continua confirmando só aquele.

## Pronto quando
- [ ] 1 e 2 mostram o horário sugerido e o resumo corretos.
- [ ] 3 a 5: o calendário bate com os esquemas.
- [ ] 6 a 8 funcionam no WhatsApp real.
