# Ajustes de 26 e 27/10/2026 — Esquemas, calendário e "tomei" no WhatsApp (roteiro rápido)

> Pedidos do dono depois do Lote 5A. Sem variáveis novas e sem migração: só fazer o deploy. A regra nova do intervalo está em `docs/06-escopo-v2.md` seção 9.

## 1. Esquema com intervalo contínuo (Configurações › Esquemas › Editar esquema)
1. **Remédios › Novo remédio** (qualquer um). Abra **Esquemas** e escolha o remédio novo.
   Esperado: **Hora da primeira dose** já vem com o **próximo horário redondo** (22:21 → **22:30**; depois das 23:30 vira 00:00 de amanhã) e **Começa em** com a data de hoje. Remédio com esquema já ajustado não muda.
2. **Não existe mais "fase única".** Sempre aparece a duração: o botão **Até acabar o estoque do remédio** (ligado por padrão) ou, desligado, **Por quantos dias você vai tomar**. **Adicionar fase** só se você quiser mais de uma.
3. **Intervalo contínuo (a hora de início é a âncora).** Teste: primeira dose **15:00**, **6 em 6 h**. Em **Como vai ficar**: *Hoje: 15:00 e 21:00; Amanhã: 03:00, 09:00, 15:00 e 21:00*. Troque para **8 em 8 h às 08:00**: o dia seguinte tem 00:00, 08:00 e 16:00 (3 doses, não 2).
4. Com mais de uma fase (ex.: 3 em 3 h por 15 dias, depois 6 em 6 h), a fase 2 começa no dia 16 **no mesmo horário da âncora**. Conferir na aba Calendário que a virada de fase faz sentido.
5. Salve e abra **Pacientes**: as doses de hoje batem com o "Hoje" do resumo.
   *Esquemas antigos que não fechavam o dia (ex.: 8 em 8 h às 08:00, que dava só 08:00 e 16:00) passam a seguir a regra contínua; revise os seus.*

## 2. Calendário dos esquemas (aba Calendário)
6. Abra a aba **Calendário**. Esperado: o mês atual, com **quantas doses** cada dia (texto, não só cor); hoje com contorno escuro. Toque num dia para ver horário, remédio e dose; setas trocam o mês.
7. Filtros **Paciente** e **Remédio** (o de remédio só lista os do paciente escolhido).
   *O calendário mostra o que o esquema prevê; não mostra o que já foi tomado (isso fica no Início e no Histórico).*

## 3. "tomei" com vários remédios (WhatsApp)
8. Com 2 ou mais doses do mesmo paciente e horário abertas, mande **tomei**. Esperado: **não** volta o menu; já pergunta a **1ª dose** (1 de N) com **1 Tomei · 2 Lembrar · 3 Não vou tomar · 4 Tomei todos (os N que faltam)**.
9. Responda **1** em cada uma até o fim (resumo "Pronto — …"), ou **4**/**todos** no meio para confirmar o restante de uma vez. Na última dose a opção 4 não aparece.
10. **tomei Losartana** (citando o remédio) continua confirmando só aquele.

## Pronto quando
- [ ] 1 a 5: horário sugerido, duração sempre escolhida e intervalo contínuo corretos (item 3 principalmente).
- [ ] 6 e 7: o calendário bate com os esquemas.
- [ ] 8 a 10 funcionam no WhatsApp real.
