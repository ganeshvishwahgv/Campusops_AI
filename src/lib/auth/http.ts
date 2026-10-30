import "server-only";
import { NextResponse } from "next/server";
import { clearSessionCookie, getCurrentUser } from "./session";
import { canViewDashboard } from "./permissions";
import { mutationOriginError } from "./origin";

export function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" },
  });
}

export async function authorizeDashboard() {
  const user = await getCurrentUser();
  if (!user) {
    const response = privateJson({ error: "Please sign in to continue." }, 401);
    clearSessionCookie(response);
    return { response, user: null };
  }
  if (!canViewDashboard(user.role)) {
    return { response: privateJson({ error: "Your role cannot access the operations dashboard." }, 403), user: null };
  }
  return { response: null, user };
}

// Every mutation must call this guard. Never trust forwarded-host as the origin.
export function checkMutationOrigin(request: Request): NextResponse | null {
  const error = mutationOriginError(request, {
    production: process.env.NODE_ENV === "production",
    configuredOrigin: process.env.APP_ORIGIN,
  });
  if (error === "configuration") {
    return privateJson({ error: "Sign-in is unavailable until the server origin is configured correctly." }, 503);
  }
  if (error === "forbidden") {
    return privateJson({ error: "This request did not come from this CampusOps site." }, 403);
  }
  return null;
}

export class RequestBodyError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function readJsonBody(request: Request, maxBytes = 4096): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new RequestBodyError(415, "Send a JSON request.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError(400, "Send a valid JSON object.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError(413, "The request is too large.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new RequestBodyError(400, "Send a valid JSON object."); }
}
