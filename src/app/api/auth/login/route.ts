import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { isValidUsername, normalizeUsername, verifyPassword } from "@/lib/auth/password";
import { consumeLoginAttempt, usernameThrottleKey } from "@/lib/auth/throttle";
import { checkMutationOrigin, privateJson, readJsonBody, RequestBodyError } from "@/lib/auth/http";
import { isSessionToken, newSessionToken, SESSION_COOKIE, SESSION_SECONDS, setSessionCookie, tokenHash } from "@/lib/auth/session";

export async function POST(request: Request) {
  const rejected = checkMutationOrigin(request);
  if (rejected) return rejected;
  try {
    const body = await readJsonBody(request);
    if (typeof body.username !== "string" || typeof body.password !== "string") {
      return privateJson({ error: "Enter your username and password." }, 400);
    }
    const username = normalizeUsername(body.username);
    const retryAfter = await consumeLoginAttempt(username.slice(0, 64));
    if (retryAfter !== null) {
      const response = privateJson({ error: "Too many sign-in attempts. Please wait and try again." }, 429);
      response.headers.set("Retry-After", String(retryAfter));
      return response;
    }
    const credential = isValidUsername(username) ? await db.credential.findUnique({
      where: { username }, select: { id: true, userId: true, passwordHash: true, user: { select: { active: true } } },
    }) : null;
    const validPassword = await verifyPassword(body.password, credential?.passwordHash ?? null);
    const invalid = () => privateJson({ error: "Invalid username or password." }, 401);
    if (!validPassword || !credential?.user.active) return invalid();

    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
    const previous = (await cookies()).get(SESSION_COOKIE)?.value;
    const saved = await db.$transaction(async (tx) => {
      // Prevent a concurrent password reset/deactivation from granting a session.
      const current = await tx.credential.findFirst({
        where: { id: credential.id, passwordHash: credential.passwordHash, user: { active: true } },
        select: { userId: true },
      });
      if (!current) return false;
      if (isSessionToken(previous)) await tx.session.deleteMany({ where: { tokenHash: tokenHash(previous) } });
      await tx.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      await tx.session.create({ data: { userId: current.userId, tokenHash: tokenHash(token), expiresAt } });
      await tx.loginThrottle.deleteMany({ where: { key: usernameThrottleKey(username) } });
      return true;
    });
    if (!saved) return invalid();
    const response = privateJson({ ok: true });
    setSessionCookie(response, token, expiresAt);
    return response;
  } catch (error) {
    if (error instanceof RequestBodyError) return privateJson({ error: error.message }, error.status);
    // Do not log request bodies, password hashes or session tokens.
    console.error("Sign-in failed because authentication storage was unavailable.");
    return privateJson({ error: "Sign-in is temporarily unavailable. Please try again." }, 503);
  }
}
