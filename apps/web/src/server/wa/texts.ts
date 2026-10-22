/**
 * Textos prontos do WhatsApp (pt-BR, curtos, sempre com o nome do paciente, uma ação por mensagem).
 * O núcleo da conversa devolve o texto pronto; o worker só envia pelo provedor. Opções numeradas são o padrão ("Responda 1 para Tomei");
 * com SUPPORTS_BUTTONS=true o texto vai sem as linhas numeradas e `opcoes` traz os rótulos para o provedor desenhar botões.
 */

export interface Opcao {
  numero: number;
  rotulo: string;
}
export interface Resposta {
  texto: string;
  opcoes?: Opcao[];
}

export const supportsButtons = (): boolean => process.env["SUPPORTS_BUTTONS"] === "true";

/** Título em negrito do WhatsApp com ícone: o estado nunca depende só de cor. */
export const titulo = (icone: string, texto: string) => `${icone} *${texto}*`;

export const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

export const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/** Monta o texto com as opções numeradas (ou sem elas, se o canal tem botões). */
export function comOpcoes(texto: string, rotulos: string[]): Resposta {
  if (rotulos.length === 0) return { texto };
  const opcoes = rotulos.map((rotulo, i) => ({ numero: i + 1, rotulo }));
  const linhas = supportsButtons() ? "" : `\n${opcoes.map((o) => `*${o.numero}* — ${o.rotulo}`).join("\n")}`;
  return { texto: `${texto}${linhas}`, opcoes };
}

export const diasTexto = (n: number) => (n <= 0 ? "acaba hoje" : `${n} ${plural(n, "dia", "dias")} de estoque`);
export const NOTA_ESTIMATIVA = "_Estimativa: colírio varia com a gota. Confira o frasco._";
const NIVEL: Record<"ok" | "warning" | "critical", string> = { ok: "🟢 Ok", warning: "🟡 Atenção", critical: "🔴 Crítico" };

/* ---------------------------------------------------------------- doses */

export interface DoseLinha {
  paciente: string;
  remedio: string;
  hora: string;
  dose?: string;
}

export function lembreteDose(p: DoseLinha & { atrasada?: boolean; minutos?: number }): Resposta {
  const cab = p.atrasada ? titulo("⏰", `Dose atrasada — ${p.paciente}`) : titulo("⏰", `Hora do remédio — ${p.paciente}`);
  const min = p.minutos ?? 15;
  return comOpcoes(`${cab}\n${p.remedio}${p.dose ? `, ${p.dose}` : ""}, às ${p.hora}.`, ["Tomei", `Lembrar em ${min} min`]);
}

export function doseEsquecidaFamilia(p: DoseLinha): Resposta {
  return comOpcoes(
    `${titulo("🔴", `Dose esquecida — ${p.paciente}`)}\n${p.remedio} das ${p.hora} não foi confirmada.\nSe ${p.paciente} já tomou, responda "Já tomou".`,
    ["Já tomou"],
  );
}

export const doseAnotada = (p: DoseLinha): Resposta => ({ texto: `${titulo("✅", "Anotado")}\n${p.paciente}: ${p.remedio} das ${p.hora}. Obrigado!` });
export const doseJaAnotada = (p: Pick<DoseLinha, "paciente" | "remedio">): Resposta => ({
  texto: `${titulo("✅", "Já estava anotado")}\n${p.paciente}: ${p.remedio}. Nada foi descontado de novo.`,
});

export function qualDose(linhas: DoseLinha[], acao: "tomei" | "lembrar"): Resposta {
  const cab = acao === "tomei" ? "Qual dose você tomou?" : "Lembrar de qual dose?";
  return comOpcoes(titulo("❓", cab), linhas.map((l) => `${l.paciente} · ${l.remedio} (${l.hora})`));
}

export const nenhumaDose = (): Resposta => ({ texto: `${titulo("ℹ️", "Nenhuma dose pendente")}\nNão achei dose pendente agora.` });
export const lembrarDeNovo = (p: { paciente: string; minutos: number; hora: string }): Resposta => ({
  texto: `${titulo("⏳", "Combinado")}\n${p.paciente}: lembro de novo em ${p.minutos} min (às ${p.hora}).`,
});
export const semRegistro = (): Resposta => ({ texto: `${titulo("ℹ️", "Sem registro")}\nNada foi anotado. Quando tomar, responda "tomei".` });

export function proximasDoses(linhas: Array<DoseLinha & { situacao?: string }>): Resposta {
  if (linhas.length === 0) return { texto: `${titulo("🕒", "Próximas doses")}\nNão há mais doses hoje.` };
  const corpo = linhas.map((l) => `• ${l.hora} · ${l.paciente} — ${l.remedio}${l.dose ? `, ${l.dose}` : ""}${l.situacao ? ` (${l.situacao})` : ""}`).join("\n");
  return { texto: `${titulo("🕒", "Próximas doses")}\n${corpo}` };
}

export interface EstoqueLinha {
  paciente: string;
  remedio: string;
  dias: number;
  nivel: "ok" | "warning" | "critical";
  estimativa: boolean;
}

export function estoque(linhas: EstoqueLinha[]): Resposta {
  if (linhas.length === 0) return { texto: `${titulo("📦", "Estoque")}\nNão há remédios com estoque cadastrado.` };
  const corpo = linhas.map((l) => `${NIVEL[l.nivel]} · ${l.paciente} — ${l.remedio}: ${diasTexto(l.dias)}${l.estimativa ? " (estimativa)" : ""}`).join("\n");
  return { texto: `${titulo("📦", "Estoque")}\n${corpo}${linhas.some((l) => l.estimativa) ? `\n${NOTA_ESTIMATIVA}` : ""}` };
}

export function estoqueBaixo(p: { paciente: string; remedio: string; dias: number; estimativa: boolean }): Resposta {
  const icone = p.dias <= 3 ? "🔴" : "🟡";
  return comOpcoes(
    `${titulo(icone, `Estoque baixo — ${p.paciente}`)}\n${p.remedio}: ${diasTexto(p.dias)}${p.estimativa ? " (estimativa)" : ""}.${p.estimativa ? `\n${NOTA_ESTIMATIVA}` : ""}`,
    ["Eu cuido disso"],
  );
}

export const reposicaoAssumida = (p: { paciente: string; remedio: string }): Resposta => ({
  texto: `${titulo("🤝", "Reposição assumida")}\nVocê cuida de ${p.remedio} (${p.paciente}).`,
});
export const reposicaoNaoEncontrada = (): Resposta => ({ texto: `${titulo("ℹ️", "Nada para assumir")}\nNão há reposição esperando alguém agora.` });
export const qualReposicao = (linhas: Array<{ paciente: string; remedio: string }>): Resposta =>
  comOpcoes(titulo("❓", "De qual remédio você cuida?"), linhas.map((l) => `${l.paciente} · ${l.remedio}`));

export const receitaVencendo = (p: { paciente: string; remedios: string; dias: number; validade: string }): Resposta => ({
  texto: `${titulo(p.dias <= 7 ? "🔴" : "🟡", `Receita ${p.dias <= 0 ? "vence hoje" : `vence em ${p.dias} ${plural(p.dias, "dia", "dias")}`} — ${p.paciente}`)}\n${p.remedios} · válida até ${p.validade}.\nPeça uma nova receita ao médico.`,
});

export const avisoReposicao = (p: { titulo: string; corpo: string }): Resposta => ({ texto: `${titulo("🔄", p.titulo)}\n${p.corpo}` });

export function resumoDiario(p: {
  data: string;
  pacientes: Array<{ nome: string; tomadas: number; esquecidas: number; pendentes: number }>;
  estoqueCritico: EstoqueLinha[];
}): Resposta {
  const partes = [titulo("🌙", `Resumo do dia — ${p.data}`)];
  for (const pt of p.pacientes) {
    partes.push(`• ${pt.nome}: ${pt.tomadas} ${plural(pt.tomadas, "tomada", "tomadas")}, ${pt.esquecidas} ${plural(pt.esquecidas, "esquecida", "esquecidas")}${pt.pendentes > 0 ? `, ${pt.pendentes} ${plural(pt.pendentes, "pendente", "pendentes")}` : ""}`);
  }
  if (p.estoqueCritico.length > 0) {
    partes.push("", "🔴 Estoque crítico:");
    for (const l of p.estoqueCritico) partes.push(`• ${l.paciente} — ${l.remedio}: ${diasTexto(l.dias)}${l.estimativa ? " (estimativa)" : ""}`);
    if (p.estoqueCritico.some((l) => l.estimativa)) partes.push(NOTA_ESTIMATIVA);
  }
  return { texto: partes.join("\n") };
}

/* ---------------------------------------------------------------- sistema */

export const ajuda = (): Resposta => ({
  texto: [
    titulo("💬", "Como posso ajudar"),
    'Quando chegar o lembrete, responda "tomei" ou "1".',
    "Você também pode escrever:",
    '• "estoque"',
    '• "próximas doses"',
    '• "lembrar de novo"',
    '• "eu cuido disso" (quando avisarem que o estoque está baixo)',
  ].join("\n"),
});

export const semPermissao = (): Resposta => ({
  texto: `${titulo("🔒", "Sem acesso")}\nSeu perfil não permite isso pelo WhatsApp. Peça pelo portal ou fale com quem administra a família.`,
});
export const precisaPortal = (): Resposta => ({
  texto: `${titulo("🔒", "Só pelo portal")}\nIsso exige o acesso completo. Termine o primeiro acesso ao portal (peça "link de acesso" aqui) e use o portal.`,
});
export const respostaLivre = (): Resposta => ({
  texto: `${titulo("💬", "Não entendi")}\nResponda "ajuda" para ver o que eu faço por aqui.`,
});
export const mensagemRepetida = (): Resposta => ({ texto: "Já recebi esta mensagem. Nada foi feito de novo." });

/** Para número desconhecido, não verificado ou sem acesso: a MESMA resposta, sem revelar nada. */
export const desconhecido = (): Resposta => ({
  texto: `${titulo("👋", "MedCuidar")}\nNão consegui te identificar por aqui. Se você participa de uma família no MedCuidar, valide este número no portal (Configurações › WhatsApp) e envie o código.`,
});

export const codigoInvalido = (): Resposta => ({ texto: `${titulo("⚠️", "Código inválido")}\nConfira o código e o número, ou peça um novo código.` });
export const codigoBloqueado = (): Resposta => ({ texto: `${titulo("⏳", "Muitas tentativas")}\nAguarde 15 minutos e tente de novo.` });
export const numeroEmUso = (): Resposta => ({ texto: `${titulo("⚠️", "Número em uso")}\nEste número já está ligado a outra pessoa no sistema.` });

export const numeroVerificado = (p: { nome: string }): Resposta => ({
  texto: `${titulo("✅", "Número verificado")}\nPronto, ${primeiroNome(p.nome)}! A partir de agora você recebe os lembretes por aqui.`,
});

export const conviteAceito = (p: { nome: string; link: string }): Resposta => ({
  texto: `${titulo("✅", `Bem-vindo(a), ${primeiroNome(p.nome)}`)}\nSeu número foi confirmado. Já dá para dar o check das doses por aqui.\nPara terminar o cadastro, defina seu e-mail e senha no link abaixo (vale 24 h, uso único):\n${p.link}`,
});

export const linkAcesso = (p: { link: string }): Resposta => ({
  texto: `${titulo("🔗", "Link de primeiro acesso")}\nDefina seu e-mail e senha aqui (vale 24 h, uso único):\n${p.link}`,
});
export const linkAcessoNaoPrecisa = (): Resposta => ({ texto: `${titulo("ℹ️", "Acesso completo")}\nVocê já tem acesso ao portal. Entre com seu e-mail e senha.` });

/* ---------------------------------------------------------------- Lote 4B: PARAR/REATIVAR, mídia e agente de IA */

export const avisosPausados = (): Resposta => ({
  texto: `${titulo("🔕", "Avisos pausados")}
Você não vai mais receber lembretes e avisos por aqui. Continuo respondendo se você escrever. Para voltar, envie *REATIVAR*.`,
});
export const avisosReativados = (): Resposta => ({ texto: `${titulo("🔔", "Avisos de volta")}
Pronto, você volta a receber os lembretes e avisos.` });
export const pedeTexto = (): Resposta => ({ texto: "Por enquanto eu só entendo texto, áudio e foto. Pode escrever o que precisa?" });
export const fotoGrande = (): Resposta => ({ texto: "Essa foto ficou grande demais para eu abrir. Pode mandar outra menor ou escrever o que precisa?" });
export const audioLongo = (): Resposta => ({ texto: "Esse áudio ficou longo demais. Pode mandar um mais curto (até 3 minutos) ou escrever?" });
export const midiaNaoAbriu = (): Resposta => ({ texto: "Não consegui abrir esse arquivo. Pode mandar de novo ou escrever o que precisa?" });
export const audioNaoEntendido = (): Resposta => ({ texto: "Não consegui entender o áudio. Pode mandar de novo ou escrever?" });
export const fotoNaoLida = (): Resposta => ({ texto: "Não consegui ler a foto. Pode escrever o que precisa?" });
export const instabilidade = (): Resposta => ({ texto: "Estou com uma instabilidade agora. Tente de novo daqui a pouco, por favor." });
export const assistenteIndisponivel = (): Resposta => ({
  texto: `${titulo("ℹ️", "Assistente indisponível")}
O assistente de perguntas está indisponível no momento. Você ainda pode responder *tomei*, *estoque* ou *próximas doses*.`,
});
export const assistentePausado = (): Resposta => ({
  texto: `${titulo("⏸️", "Assistente pausado")}
O assistente de perguntas está pausado neste mês. O administrador já foi avisado. Você ainda pode responder *tomei*, *estoque* ou *próximas doses*.`,
});
export const assistenteErro = (): Resposta => ({ texto: "Não consegui responder agora. Tente de novo em instantes, por favor." });
export const assistenteRecusou = (): Resposta => ({ texto: "Não consigo ajudar com isso por aqui. Para dúvidas sobre remédios, fale com o médico ou o farmacêutico." });
export const assistenteLonga = (): Resposta => ({ texto: "A resposta ficou longa demais. Pode perguntar de um jeito mais específico?" });
