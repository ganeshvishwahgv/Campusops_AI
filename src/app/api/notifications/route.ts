import { connection } from "next/server";
import { checkMutationOrigin, privateJson, readJsonBody } from "@/lib/auth/http";
import { clearSessionCookie, getCurrentUser } from "@/lib/auth/session";
import { complaintErrorResponse } from "@/lib/complaints/service";
import { ComplaintError } from "@/lib/complaints/validation";
import { listNotifications, markRead } from "@/lib/notifications/service";
import { settleReturns } from "@/lib/transport/breakdowns";

async function signedIn() {
  const user = await getCurrentUser();
  if (user) return { user, response: null };
  const response = privateJson({ error: "Please sign in to continue." }, 401);
  clearSessionCookie(response);
  return { user: null, response };
}

export async function GET() {
  await connection();
  try {
    const { user, response } = await signedIn();
    if (response) return response;
    await settleReturns();
    return privateJson(await listNotifications(user.id));
  } catch (error) { return complaintErrorResponse(error); }
}

// Body: { ids: string[] } or { all: true }. Users can only mark their own notifications.
export async function POST(request: Request) {
  try {
    const { user, response } = await signedIn();
    if (response) return response;
    const rejected = checkMutationOrigin(request);
    if (rejected) return rejected;
    const body = await readJsonBody(request, 8 * 1024);
    if (body.all === true) return privateJson(await markRead(user.id, "ALL"));
    if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string" || id.length > 100)) throw new ComplaintError(400, "Send notification ids or all: true.");
    return privateJson(await markRead(user.id, body.ids as string[]));
  } catch (error) { return complaintErrorResponse(error); }
}
