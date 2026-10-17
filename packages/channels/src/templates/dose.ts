import { clip, replyButton, title } from "./format";
import type { DoseChooseParams, DoseMissedFamilyParams, DoseReminderParams, Rendered } from "./types";

export function doseReminder(p: DoseReminderParams): Rendered {
  const head = p.late ? title("⏰", `Dose atrasada — ${p.patientName}`) : title("⏰", `Hora do remédio — ${p.patientName}`);
  const min = p.snoozeMin ?? 15;
  return {
    text: `${head}\n${p.medicationName}, ${p.doseText}, às ${p.time}.`,
    buttons: [
      replyButton("dose_taken", p.familyId, p.doseEventId, "Tomei"),
      replyButton("dose_snooze", p.familyId, p.doseEventId, `Lembrar em ${min} min`),
    ],
  };
}

export function doseMissedFamily(p: DoseMissedFamilyParams): Rendered {
  const buttons = [replyButton("dose_taken", p.familyId, p.doseEventId, "Já tomou")];
  if (p.callPhone) buttons.unshift({ id: `call:${p.doseEventId}`, label: "Ligar", kind: "call", phone: p.callPhone });
  return {
    text: `${title("🔴", `Dose esquecida — ${p.patientName}`)}\n${p.medicationName} das ${p.time} não foi confirmada.\nSe ${p.patientName} já tomou, toque em "Já tomou".`,
    buttons,
  };
}

export function doseConfirmed(p: { patientName: string; medicationName: string; time: string }): Rendered {
  return { text: `${title("✅", "Anotado")}\n${p.patientName}: ${p.medicationName} das ${p.time}. Obrigado!` };
}

export function doseAlreadyRecorded(p: { patientName: string; medicationName: string }): Rendered {
  return { text: `${title("✅", "Já estava anotado")}\n${p.patientName}: ${p.medicationName}. Nada foi descontado de novo.` };
}

export function doseChoose(p: DoseChooseParams): Rendered {
  const lines = p.options.map((o) => `• ${o.patientName} — ${o.medicationName} (${o.time})`).join("\n");
  const more = p.moreCount > 0 ? `\nHá mais ${p.moreCount} depois dessas. Responda "tomei" de novo para ver.` : "";
  return {
    text: `${title("❓", "Qual dose você tomou?")}\n${lines}${more}`,
    buttons: p.options.slice(0, 3).map((o) => replyButton("dose_taken", p.familyId, o.doseEventId, clip(`${o.patientName.split(" ")[0]} · ${o.medicationName}`))),
  };
}

export function noPendingDose(p: { medicationName?: string; patientName?: string }): Rendered {
  const who = [p.medicationName, p.patientName].filter(Boolean).join(" de ");
  return {
    text: `${title("ℹ️", "Nenhuma dose pendente")}\n${who ? `Não achei dose pendente de ${who} agora.` : "Não achei dose pendente agora."}`,
  };
}

export function snoozeAck(p: { patientName: string; minutes: number; time: string }): Rendered {
  return { text: `${title("⏳", "Combinado")}\n${p.patientName}: lembro de novo em ${p.minutes} min (às ${p.time}).` };
}

export function notTakenAck(): Rendered {
  return { text: `${title("ℹ️", "Sem registro")}\nNada foi anotado. Quando tomar, responda "tomei".` };
}
