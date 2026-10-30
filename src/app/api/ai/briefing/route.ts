import { connection } from "next/server";
import { authorizeDashboard, privateJson } from "@/lib/auth/http";
import { operationsBriefing } from "@/lib/ai/operations";
import { aiErrorResponse, aiThrottle } from "@/lib/ai/http";

export async function GET() {
  await connection();
  try {
    const { user, response } = await authorizeDashboard();
    if (response) return response;
    const limited = aiThrottle(user.id);
    if (limited) return limited;
    return privateJson(await operationsBriefing());
  } catch (error) { return aiErrorResponse(error); }
}
