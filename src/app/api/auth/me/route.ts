import { connection } from "next/server";
import { clearSessionCookie, getCurrentUser } from "@/lib/auth/session";
import { privateJson } from "@/lib/auth/http";

export async function GET() {
  await connection();
  try {
    const user = await getCurrentUser();
    if (user) return privateJson({ user });
    const response = privateJson({ error: "Please sign in to continue." }, 401);
    clearSessionCookie(response);
    return response;
  } catch {
    return privateJson({ error: "Unable to verify your session. Please try again." }, 503);
  }
}
