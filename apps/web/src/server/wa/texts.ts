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
  /** quantidade restante já formatada como no portal ("11 comprimidos", "≈ 120 ml", "200 g", "≈ 1,8 ml · 36 gotas") */
  quantidade?: string;
}

/** " · 11 comprimidos" quando a quantidade é conhecida. */
const qtd = (l: Pick<EstoqueLinha, "quantidade">) => (l.quantidade ? `${l.quantidade} · ` : "");

export function estoque(linhas: EstoqueLinha[]): Resposta {
  if (linhas.length === 0) return { texto: `${titulo("📦", "Estoque")}\nNão há remédios com estoque cadastrado.` };
  const corpo = linhas.map((l) => `${NIVEL[l.nivel]} · ${l.paciente} — ${l.remedio}: ${qtd(l)}${diasTexto(l.dias)}${l.estimativa ? " (estimativa)" : ""}`).join("\n");
  return { texto: `${titulo("📦", "Estoque")}\n${corpo}${linhas.some((l) => l.estimativa) ? `\n${NOTA_ESTIMATIVA}` : ""}` };
}

/** Pergunta de estoque de um remédio/paciente citado que não tem estoque cadastrado. */
export const estoqueNaoEncontrado = (citados: string[]): Resposta => ({
  texto: `${titulo("📦", "Estoque")}\nNão há estoque cadastrado para ${citados.join(" e ")}. Registre uma compra no portal para acompanhar.`,
});

export function estoqueBaixo(p: { paciente: string; remedio: string; dias: number; estimativa: boolean; quantidade?: string }): Resposta {
  const icone = p.dias <= 3 ? "🔴" : "🟡";
  const restam = p.quantidade ? `\nRestam ${p.quantidade} (${diasTexto(p.dias).replace(" de estoque", "")}).` : "";
  return comOpcoes(
    `${titulo(icone, `Estoque baixo — ${p.paciente}`)}\n${p.remedio}: ${diasTexto(p.dias)}${p.estimativa ? " (estimativa)" : ""}.${restam}${p.estimativa ? `\n${NOTA_ESTIMATIVA}` : ""}`,
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
  pacientes: Array<{ nome: string; tomadas: number; esquecidas: number; pendentes: number; puladas?: number }>;
  estoqueCritico: EstoqueLinha[];
}): Resposta {
  const partes = [titulo("🌙", `Resumo do dia — ${p.data}`)];
  for (const pt of p.pacientes) {
    partes.push(`• ${pt.nome}: ${pt.tomadas} ${plural(pt.tomadas, "tomada", "tomadas")}, ${pt.esquecidas} ${plural(pt.esquecidas, "esquecida", "esquecidas")}${pt.pendentes > 0 ? `, ${pt.pendentes} ${plural(pt.pendentes, "pendente", "pendentes")}` : ""}${(pt.puladas ?? 0) > 0 ? `, ${pt.puladas} ${plural(pt.puladas!, "pulada", "puladas")}` : ""}`);
  }
  if (p.estoqueCritico.length > 0) {
    partes.push("", "🔴 Estoque crítico:");
    for (const l of p.estoqueCritico) partes.push(`• ${l.paciente} — ${l.remedio}: ${qtd(l)}${diasTexto(l.dias)}${l.estimativa ? " (estimativa)" : ""}`);
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
/** Perfil "Somente leitura": acompanha, mas não age (nem pelo portal), então não adianta mandar pedir no portal. */
export const semPermissaoLeitura = (): Resposta => ({
  texto: `${titulo("🔒", "Seu perfil não permite")}
Seu perfil é só de acompanhamento: você vê as doses e o estoque, mas não confirma doses nem faz compras. Quem cuida do remédio recebe esses avisos.`,
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

/* ---------------------------------------------------------------- vários remédios juntos (grupo) e "um por um" */

export interface DoseItem {
  remedio: string;
  /** quantidade da dose já formatada ("1 comprimido") */
  dose?: string;
}

/** "Losartana e Omeprazol" / "A, B e C". */
export const listaDeNomes = (nomes: string[]): string => (nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`);

const itensDe = (doses: DoseItem[]) => doses.map((d) => `• ${d.remedio}${d.dose ? `, ${d.dose}` : ""}`).join("\n");

/** Lembrete de VÁRIAS doses do mesmo paciente e horário numa mensagem só. */
export function lembreteGrupo(p: { paciente: string; hora: string; doses: DoseItem[]; atrasada?: boolean; minutos?: number }): Resposta {
  const cab = p.atrasada ? titulo("⏰", `Remédios atrasados — ${p.paciente} (${p.hora})`) : titulo("⏰", `Hora dos remédios — ${p.paciente} (${p.hora})`);
  return comOpcoes(`${cab}\n${itensDe(p.doses)}`, ["Tomei todos", "Vou confirmar um por um", `Lembrar daqui a ${p.minutos ?? 15} min`]);
}

/** Aviso à família: várias doses do mesmo paciente e horário não foram confirmadas. */
export function doseEsquecidaGrupo(p: { paciente: string; hora: string; doses: DoseItem[] }): Resposta {
  return comOpcoes(
    `${titulo("🔴", `Remédios esquecidos — ${p.paciente} (${p.hora})`)}\n${itensDe(p.doses)}\nNão foram confirmados. Se ${p.paciente} já tomou, responda:`,
    ["Já tomou todos"],
  );
}

export const grupoAnotado = (p: { paciente: string; hora: string; remedios: string[] }): Resposta => ({
  texto: `${titulo("✅", "Anotado")}\n${listaDeNomes(p.remedios)} (${p.paciente}, ${p.hora}). Obrigado!`,
});

export const dosesJaAnotadas = (): Resposta => ({ texto: `${titulo("ℹ️", "Já anotado")}\nEssas doses já foram anotadas. Nada foi feito de novo.` });

export const lembrarGrupo = (p: { paciente: string; hora: string; minutos: number; horaLembrete: string }): Resposta => ({
  texto: `${titulo("⏳", "Combinado")}\nLembro de novo em ${p.minutos} min (às ${p.horaLembrete}): ${p.paciente}, remédios das ${p.hora}.`,
});

/** Pergunta do fluxo "um por um" (dose por dose). */
export function perguntaUm(p: { paciente: string; hora: string; remedio: string; dose?: string; n: number; total: number }): Resposta {
  return comOpcoes(
    `${titulo("💊", `${p.remedio} — ${p.paciente} (${p.hora})`)}${p.total > 1 ? ` · ${p.n} de ${p.total}` : ""}${p.dose ? `\n${p.dose}.` : ""}`,
    // "Tomei todos" (os que faltam) só aparece quando ainda há outro depois desta dose
    ["Tomei", "Lembrar daqui a 15 min", "Não vou tomar", ...(p.total - p.n >= 1 ? [`Tomei todos (os ${p.total - p.n + 1} que faltam)`] : [])],
  );
}

export const respostaUm = (r: "tomou" | "lembrar" | "pulou", remedio: string, horaLembrete?: string): string =>
  r === "tomou" ? `✅ ${remedio} anotado.` : r === "lembrar" ? `🔁 ${remedio}: lembro às ${horaLembrete ?? "daqui a pouco"}.` : `⏭️ ${remedio}: anotei que não vai tomar.`;

/** Fim do "um por um": uma linha de resumo ("Losartana ✅, Omeprazol 🔁 lembrar às 08:15"). */
export function resumoUmPorUm(p: { paciente: string; hora: string; feitos: Array<{ remedio: string; r: "tomou" | "lembrar" | "pulou"; hora?: string }> }): Resposta {
  const linha = p.feitos.map((f) => `${f.remedio} ${f.r === "tomou" ? "✅" : f.r === "lembrar" ? `🔁 lembrar às ${f.hora ?? "daqui a pouco"}` : "⏭️ não vai tomar"}`).join(", ");
  return { texto: `${titulo("✅", `Pronto — ${p.paciente} (${p.hora})`)}\n${linha}.` };
}

export const dosePulada = (p: { paciente: string; remedio: string }): Resposta => ({
  texto: `${titulo("⏭️", "Anotado")}\n${p.paciente}: ${p.remedio} não será tomado. Fica no histórico do portal.`,
});
