# Lote 5E-A — Roteiro de teste (uma conta em várias famílias, no portal)

Contrato: `docs/15-uma-conta-varias-familias.md`. O WhatsApp continua como antes (um número em uma família só); a parte dele é o 5E-B.

O caso real: sua esposa usa o MedCuidar **para ela mesma** (uma família só dela) e também é **filha** na família dos pais dela. São famílias distintas, com um único login. Aqui o roteiro usa duas contas: **a sua** (administrador da família de teste dos pais) e **a da sua esposa** ("Paula" nos passos; numa janela anônima). Se preferir não usar o e-mail real dela agora, use um segundo e-mail seu.

## Parte 0 — Publicar (uma vez)
1. Backup manual antes de migrar: no console do `medcuidar-backup`, `node src/cli.mjs once` (esperado: `backup concluído`).
2. Aplique a migração `0013` como nos lotes anteriores (`docs/14-operacao.md`, seção 4) e faça o **Deploy** do `medcuidar-web`.
3. No log do portal deve aparecer uma vez `[contas] ajuste do Lote 5E: liberadas=… falhas=0`. Ele libera logins que desativações antigas tinham bloqueado.
4. Confira `/api/health?completo=1` e entre com a sua conta: tudo como antes, sem tela nova (você só tem uma família).

**Voltar atrás:** a versão anterior só é segura **enquanto ninguém tiver duas famílias** (docs/15, seção 9). Faça a Parte 1 em diante apenas quando decidir ficar nesta versão.

## Parte 1 — Quem já tem conta recebe um convite
5. Na janela anônima, **Criar conta** como Paula, confirme o e-mail e crie a "Família Paula Teste".
6. Na sua janela: Configurações › Pessoas › **Convidar pessoa** por e-mail, usando o e-mail da Paula, perfil **Cuidadora**.
7. Abra o link do e-mail do convite na janela da Paula. Esperado: **não** pede para criar senha; mostra "Sua conta continua a mesma" com o botão **Aceitar convite** (ou, se ela não estiver logada, pede a senha atual).
8. Aceite (e aceite a política, se aparecer). Esperado: ela entra na sua família, e o menu mostra o nome da família e **Trocar de família**.

## Parte 2 — Trocar e conferir o isolamento
9. **Trocar de família** → escolha a "Família Paula Teste". Esperado: nada da sua família aparece (pacientes, remédios, pessoas).
10. Volte à sua. Como Cuidadora, ela **não** vê as opções de administrador, mesmo sendo administradora na própria.
11. No celular (ou janela estreita): uma faixa no topo mostra a família atual e **Trocar**.
12. **Duas abas:** abra o portal em duas abas da Paula. Na segunda, troque de família. Volte à primeira. Esperado: ela recarrega sozinha na nova família.
13. Saia e entre de novo. Esperado: abre na última família usada.

## Parte 3 — Criar outra família
14. **Minha conta** › **Criar outra família**. Esperado: família nova e vazia, ela como Administradora.

## Parte 4 — Desativar e excluir não atingem as outras
15. Na sua janela, **desative** a Paula. Esperado: ela perde só o acesso à sua família; continua entrando nas dela.
16. **Reative** e confirme que a sua família volta a aparecer para ela.
17. Exclusão de família: **não teste na sua família real.** Se quiser, peça a exclusão da "Família Paula Teste" e confira que a tela de exclusão oferece **Minhas famílias**; depois cancele.

## Parte 4b — Sair por conta própria
18. Como Paula, na **sua** família (onde ela é Cuidadora): Minha conta › **Sair desta família** → confirmar. Esperado: ela sai só da sua; as dela continuam.
19. Como Paula, na família dela (onde é a única Administradora): **Sair desta família**. Esperado: recusa explicando que precisa passar o perfil Administrador antes ou pedir a exclusão.
20. Reative a Paula na sua família (Configurações › Pessoas › Reativar) para seguir usando.

## Parte 5 — Convite pelo WhatsApp para quem já tem conta (opcional)
21. Se tiver um segundo número livre (que não esteja verificado em nenhuma família): convide-o por código de WhatsApp, envie o código, abra o link de primeiro acesso e use **Já tenho conta no MedCuidar**.

## Registro
Preencha `docs/lotes/L5E-A-validacao.md`. O 5E-B (WhatsApp) só começa com **validado**.
