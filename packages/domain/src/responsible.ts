import type { FamilySettings, RecipientsMode } from "@medcuidar/shared";
import { DEFAULT_TZ, localParts, parseHHmm } from "./time";
import type { CareAssignment, Member } from "./types";

/** Modo efetivo: o do paciente sobrescreve o da família. */
export function effectiveRecipientsMode(
  patient: { reminder_recipients_mode?: RecipientsMode | null },
  settings: Pick<FamilySettings, "reminder_recipients_mode">,
): RecipientsMode {
  return patient.reminder_recipients_mode ?? settings.reminder_recipients_mode;
}

/** A escala cobre o instante? Faixa que cruza a meia-noite (fim ≤ início) pertence ao dia em que começou. */
export function assignmentCovers(a: CareAssignment, datetime: Date, tz: string = DEFAULT_TZ): boolean {
  const { minutes, weekday } = localParts(datetime, tz);
  const start = parseHHmm(a.start_time);
  const end = parseHHmm(a.end_time);
  if (start < end) return a.weekdays.includes(weekday) && minutes >= start && minutes < end;
  if (minutes >= start) return a.weekdays.includes(weekday);
  if (minutes < end) return a.weekdays.includes((weekday + 6) % 7);
  return false;
}

export interface ResolvedRecipients {
  /** Quem está de plantão (escala), por prioridade. Vazio se ninguém cobre. */
  responsible: Member[];
  /** Quem recebe o lembrete, já conforme o modo. */
  recipients: Member[];
  source: "assignments" | "family_fallback" | "all_members";
  /** Sem cobertura de escala: o aviso vai para a família. */
  usedFamilyFallback: boolean;
}

export interface ResolveInput {
  assignments: CareAssignment[];
  members: Member[];
  mode: RecipientsMode;
  datetime: Date;
  tz?: string;
}

function dedupe(list: Member[]): Member[] {
  const seen = new Set<string>();
  return list.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

export function resolveResponsible(input: ResolveInput): ResolvedRecipients {
  const active = input.members.filter((m) => m.active);
  const byId = new Map(active.map((m) => [m.id, m]));
  const responsible = dedupe(
    input.assignments
      .filter((a) => assignmentCovers(a, input.datetime, input.tz))
      .sort((a, b) => a.priority - b.priority)
      .map((a) => byId.get(a.member_id))
      .filter((m): m is Member => !!m),
  );
  const family = active.filter((m) => m.receives_family_alerts);

  if (input.mode === "all_members") {
    return { responsible, recipients: active, source: "all_members", usedFamilyFallback: false };
  }
  if (responsible.length === 0) {
    return { responsible, recipients: family, source: "family_fallback", usedFamilyFallback: true };
  }
  const recipients = input.mode === "assignments_plus_family" ? dedupe([...responsible, ...family]) : responsible;
  return { responsible, recipients, source: "assignments", usedFamilyFallback: false };
}
