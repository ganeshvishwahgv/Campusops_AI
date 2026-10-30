import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { checkMutationOrigin, privateJson, readJsonBody, RequestBodyError } from "@/lib/auth/http";
import { clearSessionCookie, isSessionToken, SESSION_COOKIE, tokenHash } from "@/lib/auth/session";

export async function POST(request: Request) {
  const rejected = checkMutationOrigin(request);
  if (rejected) return rejected;
  try {
    await readJsonBody(request);
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (isSessionToken(token)) await db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
    const response = privateJson({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    if (error instanceof RequestBodyError) return privateJson({ error: error.message }, error.status);
    return privateJson({ error: "Sign-out could not be completed. Please try again." }, 503);
  }
}
