import { daysText, ESTIMATE_NOTE, title } from "./format";
import type { DailySummaryParams, LoginCodeParams, Rendered } from "./types";

export function help(): Rendered {
  return {
    text: [
      title("💬", "Como posso ajudar"),
      'Quando chegar o lembrete, toque em "Tomei".',
      "Você também pode escrever ou mandar áudio:",
      '• "tomei o Zypred"',
      '• "como está o estoque?"',
      '• "quais as próximas doses?"',
      '• "já tomou o Zypred?"',
    ].join("\n"),
  };
}

export function noPermission(): Rendered {
  return { text: `${title("🔒", "Sem acesso")}\nSeu perfil não permite isso pelo WhatsApp. Fale com o administrador da família.` };
}

export function transcriptionFailed(): Rendered {
  return { text: `${title("🎙️", "Não consegui ouvir o áudio")}\nTente de novo ou escreva a mensagem.` };
}

export function loginCode(p: LoginCodeParams): Rendered {
  return {
    text: `${title("🔐", "Código de acesso MedCuidar")}\n*${p.code}*\nVale por ${p.minutes} minutos. Não compartilhe com ninguém.`,
  };
}

export function operationalNotice(p: { text: string }): Rendered {
  return { text: `${title("⚙️", "Aviso do sistema")}\n${p.text}` };
}

export function dailySummary(p: DailySummaryParams): Rendered {
  const parts: string[] = [title("🌙", `Resumo do dia — ${p.date}`)];
  for (const pt of p.patients) {
    parts.push(`• ${pt.name}: ${pt.taken} tomadas, ${pt.missed} esquecidas${pt.pending > 0 ? `, ${pt.pending} pendentes` : ""}`);
  }
  if (p.criticalStock.length > 0) {
    parts.push("", "🔴 Estoque crítico:");
    for (const s of p.criticalStock) {
      parts.push(`• ${s.patientName} — ${s.medicationName}: ${daysText(s.daysLeft)}${s.isEstimate ? " (estimativa)" : ""}`);
    }
    if (p.criticalStock.some((s) => s.isEstimate)) parts.push(ESTIMATE_NOTE);
  }
  if (p.openReplenishments > 0) parts.push("", `🔄 Reposições em andamento: ${p.openReplenishments}`);
  return { text: parts.join("\n") };
}
