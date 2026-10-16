import { plural, replyButton, title } from "./format";
import type { PrescriptionExpiringParams, PrescriptionSharedParams, Rendered } from "./types";

export function prescriptionShared(p: PrescriptionSharedParams): Rendered {
  const lines = [
    title("🧾", `Receita de ${p.patientName}`),
    p.doctorName ? `${p.doctorName}${p.specialty ? ` · ${p.specialty}` : ""}` : "",
    `Remédios: ${p.medications.join(", ")}`,
    p.validUntil ? `Válida até ${p.validUntil}` : "Sem validade informada",
    "🔒 Acesso restrito: dado de saúde. Ao encaminhar, a imagem sai do sistema.",
  ].filter(Boolean);
  const text = lines.join("\n");
  return {
    text,
    media: { url: p.imageUrl, mimeType: p.mimeType, fileName: `receita-${p.patientName}.jpg`, caption: text },
    buttons: [
      replyButton("rx_download", p.familyId, p.prescriptionId, "Baixar"),
      replyButton("rx_forward_pharmacy", p.familyId, p.prescriptionId, "Encaminhar farmácia"),
    ],
  };
}

export function prescriptionForwardInfo(p: { patientName: string }): Rendered {
  return {
    text: `${title("🧾", "Encaminhar para a farmácia")}\nEncaminhe a imagem da receita de ${p.patientName} direto pelo WhatsApp. Ela sai do MedCuidar; envie só para a farmácia.`,
  };
}

export function prescriptionUnavailable(p: { patientName?: string }): Rendered {
  return {
    text: `${title("ℹ️", "Receita indisponível")}\n${p.patientName ? `Não há receita vigente de ${p.patientName} para mostrar` : "Não há receita para mostrar"}, ou você não tem acesso a ela. Veja no painel.`,
  };
}

export function prescriptionExpiring(p: PrescriptionExpiringParams): Rendered {
  const icon = p.daysLeft <= 7 ? "🔴" : "🟡";
  const when = p.daysLeft <= 0 ? "vence hoje" : `vence em ${p.daysLeft} ${plural(p.daysLeft, "dia", "dias")}`;
  return {
    text: `${title(icon, `Receita ${when} — ${p.patientName}`)}\n${p.medications.join(", ")} · válida até ${p.validUntil}.\nPeça uma nova receita ao médico.`,
  };
}
