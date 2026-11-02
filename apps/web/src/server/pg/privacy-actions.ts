"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ForbiddenError, UserError } from "./errors";

/** Server Actions de privacidade (aceite, exclusão agendada). A família e a pessoa vêm SEMPRE da sessão. */

export type R<T = void> = { ok: true; data: T } | { ok: false; message: string };

async function run<T>(fn: () => Promise<T>): Promise<R<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: "Só o(a) Administrador(a) da família pode fazer isso." };
    if (e instanceof UserError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Confira os dados." };
    console.error("[privacidade] falhou", (e as Error).name, (e as { code?: unknown }).code ?? "");
    return { ok: false, message: "Não foi possível concluir. Tente de novo." };
  }
}

/** Botão "Li e aceito" da tela /privacidade/aceitar (vale para a versão vigente da política). */
export async function aceitarPrivacidadeAction(): Promise<R> {
  const { getAccess } = await import("./access");
  const a = await getAccess();
  if (a.status !== "privacy") return { ok: true, data: undefined };
  const { acceptPrivacy } = await import("./privacy");
  const r = await run(() => acceptPrivacy({ familyId: a.familyId, memberId: a.memberId }));
  if (r.ok) redirect("/");
  return r;
}

/** Administrador pede a exclusão da família (digita o nome para confirmar). */
export async function pedirExclusaoAction(nome: string): Promise<R<{ dueAt: string }>> {
  return run(async () => {
    const { getContext } = await import("./access");
    const ctx = await getContext();
    if (!ctx) throw new UserError("Sua sessão expirou. Entre de novo.");
    const { requestFamilyDeletion } = await import("./privacy");
    const r = await requestFamilyDeletion(ctx, z.string().trim().min(1, "Digite o nome da família.").max(200).parse(nome));
    return { dueAt: r.dueAt.toISOString() };
  });
}

/** Administrador cancela a exclusão agendada, a partir da tela /exclusao-agendada. */
export async function cancelarExclusaoAction(): Promise<R> {
  const { getAccess } = await import("./access");
  const a = await getAccess();
  if (a.status !== "deletion") return { ok: true, data: undefined };
  const r = await run(async () => {
    const { cancelFamilyDeletion } = await import("./privacy");
    await cancelFamilyDeletion({ familyId: a.familyId, memberId: a.memberId, timezone: a.timezone, member: a.member });
  });
  if (r.ok) redirect("/");
  return r;
}
