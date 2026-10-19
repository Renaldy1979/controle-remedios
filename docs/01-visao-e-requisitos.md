> **Atenção:** o escopo foi redefinido em 19/10/2026. Onde este documento conflitar com `docs/06-escopo-v2.md`, vale o 06 (login por e-mail/senha no Appwrite, Postgres + Drizzle, API `/api/v1` + N8N com um fluxo por gatilho).

# 01 — Visão e requisitos

## Problema
Idosos esquecem de tomar remédios. Quando o remédio acaba, a família só descobre no dia; depois é preciso pedir nova receita ao médico e comprar, e o paciente fica dias sem tomar. Hoje o controle é papel, planilha para impressão e memória de quem está por perto.

## Objetivo
Os pacientes só precisam tomar na hora certa. O sistema lembra, registra quem deu, controla o estoque, prevê quando acaba e organiza a reposição entre as filhas e o sobrinho.

## Pessoas
| Papel | Quem | O que faz |
|---|---|---|
| Administrador | dono do sistema | CRUD total: remédios, esquemas, perfis, usuários |
| Quem administra a dose | cuidadora (dia e noite), sogro (noite e fins de semana), filhas | recebe lembrete e confirma a dose pelo WhatsApp |
| Família | 4 filhas + 1 sobrinho | acompanha, recebe avisos, cuida da reposição |
| Pacientes | Adelino, Maria | não operam o sistema (Maria não usa celular) |

Perfis são configuráveis: cada funcionalidade liga/desliga por perfil.

## Requisitos funcionais

### RF0 Acesso
- RF0.1 Login por **código de 6 dígitos enviado no WhatsApp** para o número cadastrado, com erro e reenvio. Código expira em poucos minutos, uso único, limite de tentativas.
- RF0.2 Só entram números cadastrados em alguma família; resposta igual para número desconhecido.

### RF1 Cadastros
- RF1.1 Famílias, usuários (nome, telefone WhatsApp, perfil) e pacientes.
- RF1.2 Remédios: nome, marcas alternativas ("Facoba ou Vigadexa ou Zypred, só uma"), via de uso (pingar, comprimido, pó dissolvido, líquido, pomada), unidade de controle (unidade, ml, gota, grama), conversão gotas por ml.
- RF1.3 Tratamentos (demandas de uso): remédio + paciente + início + fim opcional.
- RF1.4 Fases do tratamento: periodicidade (de X em X horas ou horários fixos), dia inicial e final da fase, quantidade por dose. Uma fase "até acabar" é permitida. Exemplo: de 3 em 3 h do dia 1 ao 15; de 6 em 6 h do dia 16 ao 20.
- RF1.5 Escala de responsáveis: quem cuida de qual paciente em quais dias e horários (cuidadora de dia, sogro à noite e fins de semana).
- RF1.6 Perfis e permissões por funcionalidade. Perfis iniciais: Administrador (sempre total), Familiar, Cuidadora e Confirmador (ex.: sogro).
- RF1.7 Remédio pode ser marcado como **sem receita** (ex.: Metamucil): não gera pedido de receita na reposição.
- RF1.8 O paciente pode ser também quem confirma (Adelino confirma sozinho as doses da manhã). Maria, sem celular, é confirmada por quem estiver com ela.
- RF1.9 Remover pessoa que consta na escala exige confirmação digitando `REMOVER`.

### RF2 Doses
- RF2.1 O sistema gera os eventos de dose de cada dia a partir das fases.
- RF2.2 Lembrete no WhatsApp na hora da dose. Destinatários configuráveis: todos os números da família (padrão), só a escala de responsáveis, ou escala com a família em cópia.
- RF2.3 Confirmação por botão "Tomei", texto ou áudio. O telefone identifica quem deu.
- RF2.4 Aviso à família quando a dose se aproxima (configurável) e quando é esquecida.
- RF2.5 Estados da dose: pendente, tomada, atrasada, esquecida, pulada (com motivo).
- RF2.6 Confirmação manual pelo painel, com registro de quem e quando.
- RF2.7 **Desfazer** a confirmação por 8 s (devolve o estoque); **Registrar que tomou depois** para dose esquecida; **Lembrar em 15 min** (15/30/60 configurável).
- RF2.8 Prazos configuráveis por família: atrasada após 15 min, esquecida após 2 h.
- RF2.9 **Resumo diário** às 20:00 para a família (tomadas, esquecidas, estoque). Horário configurável.

### RF3 Estoque
- RF3.1 Saldo por paciente e remédio via livro-razão (compra, dose, ajuste).
- RF3.2 Previsão de término considerando as fases futuras e doses tomadas corretamente.
- RF3.3 Alerta de estoque baixo: antecedência padrão da família, com exceção por remédio.
- RF3.4 Ajuste manual (olhando o frasco); colírio sinalizado como estimativa.

### RF4 Receitas
- RF4.1 Anexar fotos/PDFs (várias páginas), com paciente, data, médico, validade, remédios vinculados e observações. Obrigatórios: paciente, data (não futura) e pelo menos 1 remédio. Validade com atalhos (30 dias, 60 dias, 6 meses, sem validade). Marcar **controle especial** (número de vias) quando for o caso.
- RF4.2 Situações: vigente, vencida, aguardando nova, substituída. Histórico em linha do tempo.
- RF4.3 Compartilhar dentro do sistema e pelo WhatsApp; registrar quem visualizou.
- RF4.4 Aviso "receita vence em X dias" e "sem receita vigente".

### RF5 Reposição
- RF5.1 Fluxo por remédio: pedir receita → receita recebida → comprado → estoque atualizado.
- RF5.2 Cada etapa com responsável e data (evita duas pessoas fazendo o mesmo).
- RF5.3 Botão "Eu cuido disso" no aviso do WhatsApp assume a etapa atual.

### RF6 Consultas no WhatsApp
- "Como está o estoque?", "Quais os próximos remédios?", "Já tomou o X?". Respostas filtradas pelas permissões de quem pergunta.
- Receber foto de receita direto na conversa e anexar ao paciente (fase 2).

### RF7 Painel
Telas: Início, Pacientes, Receitas, Histórico de doses, Configurações (remédios, esquemas, estoque, usuários, perfis, avisos). Detalhes visuais em `design/design.md`.

## Requisitos não funcionais
- Multifamília com isolamento total (futuro microSaaS).
- Lembrete não pode falhar em silêncio: fila de saída com retentativa e painel de falhas.
- Mobile-first, acessível, claro/escuro.
- LGPD: dados de saúde, consentimento, trilha de auditoria, exclusão sob pedido.
- Observabilidade: logs estruturados sem dados pessoais; alerta se o agendador parar.

## Fora do escopo agora
Validade do remédio, cobrança/planos do SaaS, app nativo, integração com farmácias.

## Decisões do dono (15/10/2026)
1. **Destinatários do lembrete:** por padrão, todos os números cadastrados da família recebem o lembrete. Isso é configurável (por família e por paciente): todos, só a escala de responsáveis, ou escala com a família como cópia. A escala (RF1.5) continua existindo para quando o dono quiser restringir. Se a dose for confirmada por um, os demais recebem "Fulano já deu".
2. **Transcrição de áudio:** Google Gemini (o dono já tem plano com créditos e usa em outros projetos). O provedor entra pelo adaptador `transcription` para ser trocável.
3. **Tempo sem confirmação:** 15 minutos para reenviar o lembrete (padrão), configurável por família.
4. **Número de WhatsApp:** será criado no momento certo. Até lá, desenvolver com o simulador e número de teste.

## Observação de design
O Claude Design está ajustando a tela de enviar receita; o `design.md` virá junto com o HTML das telas.
