import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { connection } from "next/server";
import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma/enums";

export const SESSION_COOKIE = "campusops_session";
export const SESSION_SECONDS = 8 * 60 * 60;
export type CurrentUser = { id: string; name: string; role: Role; department: string | null };
export const currentUserSelect = { id: true, name: true, role: true, department: true } as const;

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isSessionToken(token: string | undefined): token is string {
  return Boolean(token && /^[A-Za-z0-9_-]{43}$/.test(token));
}

// Re-read the active flag and role on every request; no shared or private cache.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  // Partial prefetching can have a cookie value during a prerender. Expiry
  // must still use the actual request time, never a prefetched timestamp.
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isSessionToken(token)) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: { expiresAt: true, user: { select: { ...currentUserSelect, active: true } } },
  });
  if (!session || session.expiresAt.getTime() <= Date.now() || !session.user.active) return null;
  const { id, name, role, department } = session.user;
  return { id, name, role, department };
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" || process.env.APP_ORIGIN?.startsWith("https://") === true,
    path: "/",
  };
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set(SESSION_COOKIE, token, { ...cookieOptions(), expires: expiresAt, maxAge: SESSION_SECONDS });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(), expires: new Date(0), maxAge: 0 });
}
