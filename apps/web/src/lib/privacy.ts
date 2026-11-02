/**
 * Política de privacidade do MedCuidar (docs/13). Sobe a versão sempre que o texto mudar de forma relevante:
 * todo usuário do portal precisa aceitar a versão vigente de novo (tela /privacidade/aceitar).
 */
export const PRIVACY_VERSION = "2026-11-02";
export const PRIVACY_UPDATED = "02/11/2026";
export const CONTROLLER = { nome: "Renaldy Sousa", email: "renaldy.sousa@gmail.com" } as const;
/** Dias entre pedir a exclusão da família e a exclusão definitiva (dá tempo de cancelar). */
export const DELETION_GRACE_DAYS = 30;

export interface PrivacySection {
  id: string;
  title: string;
  paragraphs: string[];
}

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    id: "quem",
    title: "Quem cuida dos seus dados",
    paragraphs: [
      `O MedCuidar é um sistema para famílias acompanharem os remédios de pessoas idosas. O responsável pelos dados (controlador, nos termos da LGPD, Lei 13.709/2018) é ${CONTROLLER.nome}. Fale com ele pelo e-mail ${CONTROLLER.email}.`,
    ],
  },
  {
    id: "dados",
    title: "Quais dados são guardados",
    paragraphs: [
      "Dados de quem usa o sistema: nome, e-mail, telefone de WhatsApp (se informado), perfil de acesso e as ações feitas (por exemplo, quem confirmou uma dose).",
      "Dados de saúde das pessoas cuidadas (dados pessoais sensíveis): nome, data de nascimento, observações, remédios, doses e horários, confirmações de dose, estoque, receitas médicas (fotos ou PDF, com médico, validade e itens) e o histórico de reposição.",
      "Mensagens de WhatsApp trocadas com o sistema: o texto fica só o tempo necessário para responder; os registros de auditoria não guardam o conteúdo das mensagens.",
    ],
  },
  {
    id: "para-que",
    title: "Para que usamos",
    paragraphs: [
      "Só para o cuidado dos remédios: lembrar das doses, registrar o que foi tomado, controlar o estoque e avisar quando o remédio vai acabar, guardar as receitas e conduzir a reposição. Não vendemos, não compartilhamos para publicidade e não usamos os dados para outra finalidade.",
      "Base legal: o consentimento da pessoa cuidada ou do seu responsável, e a tutela da saúde (LGPD, art. 7º e art. 11). Quem cadastra uma pessoa declara ter a autorização dela ou ser o responsável por ela, principalmente quando ela não consegue decidir sozinha (por exemplo, na demência).",
    ],
  },
  {
    id: "com-quem",
    title: "Com quem os dados passam",
    paragraphs: [
      "Servidor e armazenamento: o sistema roda em um servidor privado (VPS) contratado pelo controlador, com banco de dados isolado por família. As fotos das receitas ficam em um armazenamento privado do mesmo servidor e só abrem com link temporário.",
      "WhatsApp: os lembretes e as respostas passam pelo WhatsApp (Meta) e pelo provedor de conexão. Só recebe mensagens quem tem o número verificado.",
      "Inteligência artificial: quando alguém faz uma pergunta livre pelo WhatsApp, o texto da pergunta e os dados necessários para responder (por exemplo, remédios e estoque) são enviados à Anthropic (assistente de texto). Áudios e fotos enviados ao sistema são transcritos pelo Google (Gemini). Esses provedores ficam fora do Brasil. A assistente só lê dados; nunca confirma dose nem altera nada.",
      "Cópia de segurança: uma cópia diária do banco, criptografada com chave que só o controlador tem, é guardada na Cloudflare (R2). Sem a chave, o conteúdo não pode ser lido.",
    ],
  },
  {
    id: "quanto-tempo",
    title: "Por quanto tempo guardamos",
    paragraphs: [
      "Os dados ficam enquanto a família usar o sistema. Quando o administrador pede a exclusão, a família fica bloqueada por 30 dias (dá para desistir) e depois tudo é apagado de vez: banco de dados, contas de acesso e fotos das receitas.",
      "As cópias de segurança são apagadas sozinhas: o banco em até 30 dias e as fotos em até 35 dias depois da exclusão.",
    ],
  },
  {
    id: "direitos",
    title: "Seus direitos",
    paragraphs: [
      "Você pode pedir: confirmação de que tratamos seus dados, acesso, correção, anonimização, portabilidade, informação sobre com quem compartilhamos, revogação do consentimento e eliminação dos dados.",
      "O administrador da família consegue exportar todos os dados e pedir a exclusão em Configurações › Privacidade e dados. Os demais pedidos, ou a exclusão por quem não é administrador, podem ser feitos pelo e-mail do controlador, com resposta em até 15 dias.",
    ],
  },
  {
    id: "seguranca",
    title: "Como protegemos",
    paragraphs: [
      "Cada família só enxerga os próprios dados (isolamento no banco de dados). A conexão é criptografada (HTTPS), as senhas ficam no serviço de login e nunca em texto, as receitas só abrem com link temporário, e as consultas e exclusões de receita são registradas. Ninguém além do controlador acessa o servidor.",
      "Nenhum sistema é totalmente imune a falhas. Se houver um incidente que possa causar dano a você, avisaremos você e a Autoridade Nacional de Proteção de Dados (ANPD), como a lei exige.",
    ],
  },
  {
    id: "mudancas",
    title: "Mudanças nesta política",
    paragraphs: [
      `Esta é a versão de ${PRIVACY_UPDATED}. Se o texto mudar de forma relevante, pediremos que você leia e aceite de novo antes de continuar usando o sistema.`,
    ],
  },
];
