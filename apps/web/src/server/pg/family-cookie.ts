import "server-only";
import { cookies } from "next/headers";
import { FAMILY_COOKIE, FAMILY_TAB_COOKIE, FAMILY_TTL_SEC } from "../cookies";

export const preferredFamily = async (): Promise<string | null> => (await cookies()).get(FAMILY_COOKIE)?.value ?? null;

/** Grava a família escolhida (só em Server Action). */
export async function writeFamilyChoice(familyId: string): Promise<void> {
  const jar = await cookies();
  const base = { sameSite: "lax" as const, secure: process.env["NODE_ENV"] === "production" && process.env["E2E_TEST_MODE"] !== "1", path: "/", maxAge: FAMILY_TTL_SEC };
  jar.set(FAMILY_COOKIE, familyId, { ...base, httpOnly: true });
  jar.set(FAMILY_TAB_COOKIE, familyId, { ...base, httpOnly: false });
}
