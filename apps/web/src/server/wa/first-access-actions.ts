"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { consumirLinkPrimeiroAcesso, resolverLinkPrimeiroAcesso, sha256, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { appwriteCode, createUser, deleteUser, sendVerification, signInWithPassword } from "../auth/appwrite";
import { writeSession } from "../auth/session";
import { audit } from "../pg/audit";
import { isUniqueViolation } from "../pg/errors";

export type FirstAccessState = { error?: string; values?: Record<string, string> };

const ERRO_LINK = "Este link não vale mais. Peça um novo link de acesso pelo WhatsApp (responda “link de acesso”) ou a quem administra a família.";
const fd = (f: FormData, k: string) => String(f.get(k) ?? "");

/**
 * Primeiro acesso de quem entrou por convite de WhatsApp (docs/06 seção 2): define e-mail e senha. Cria a conta no
 * Appwrite, grava o e-mail no cadastro e manda o e-mail de confirmação; a pessoa só vira `active` quando confirma o
 * e-mail (a ativação acontece em `getAccess`/`/verificar-email`). O link é de uso único e só é gasto no fim.
 */
export async function completeFirstAccess(_: FirstAccessState, form: FormData): Promise<FirstAccessState> {
  const token = fd(form, "t");
  const parsed = z
    .object({
      email: z.string().trim().toLowerCase().email("Informe um e-mail válido.").max(160),
      senha: z.string().min(8, "A senha precisa ter ao menos 8 caracteres.").max(128, "A senha é longa demais."),
    })
    .safeParse({ email: fd(form, "email"), senha: fd(form, "senha") });
  const keep = { email: fd(form, "email") };
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Confira os dados.", values: keep };
  if (parsed.data.senha !== fd(form, "confirmar")) return { error: "As senhas não conferem.", values: keep };
  if (!token) return { error: ERRO_LINK };

  const link = await resolverLinkPrimeiroAcesso(sha256(token));
  if (!link || link.estadoAcesso !== "whatsapp_verified") return { error: ERRO_LINK };
  const nome = await withFamilia(link.familiaId, async (tx) => {
    const [m] = await tx.select({ name: s.members.name, active: s.members.active, removed: s.members.removedAt }).from(s.members).where(eq(s.members.id, link.membroId));
    return m && m.active && !m.removed ? m.name : null;
  });
  if (!nome) return { error: ERRO_LINK };

  let userId: string | null = null;
  try {
    const u = await createUser(parsed.data.email, parsed.data.senha, nome);
    userId = (u as { $id: string }).$id;
    await withFamilia(link.familiaId, async (tx) => {
      await tx.update(s.members).set({ email: parsed.data.email }).where(and(eq(s.members.id, link.membroId), eq(s.members.accessState, "whatsapp_verified")));
      await audit(tx, { familyId: link.familiaId, memberId: link.membroId }, "member.first_access", "member", link.membroId, {});
    });
    const used = await consumirLinkPrimeiroAcesso(sha256(token));
    if (!used) throw new Error("link_gasto");
    const session = await signInWithPassword(parsed.data.email, parsed.data.senha);
    await writeSession(session.secret, session.expire);
    await sendVerification(session.secret).catch((e) => console.error("[primeiro-acesso] verificação não enviada", appwriteCode(e) ?? ""));
  } catch (e) {
    if (userId) await deleteUser(userId).catch(() => {});
    if (appwriteCode(e) === 409) return { error: "Já existe uma conta com esse e-mail. Use outro e-mail ou peça ajuda a quem administra a família.", values: keep };
    if (appwriteCode(e) === 429) return { error: "Muitas tentativas. Aguarde um pouco e tente de novo.", values: keep };
    if (isUniqueViolation(e)) return { error: "Esse e-mail já é de outra pessoa nesta família.", values: keep };
    if ((e as Error).message === "link_gasto") return { error: ERRO_LINK };
    console.error("[primeiro-acesso]", appwriteCode(e) ?? (e as Error).name);
    return { error: "Não foi possível concluir agora. Tente de novo.", values: keep };
  }
  redirect("/verificar-email");
}
