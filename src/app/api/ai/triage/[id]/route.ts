import { connection } from "next/server";
import { privateJson } from "@/lib/auth/http";
import { authorizeWorkflow, workflowErrorResponse } from "@/lib/workflow/service";
import { triageIncident } from "@/lib/ai/operations";
import { aiThrottle } from "@/lib/ai/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { user, response } = await authorizeWorkflow(true);
    if (response) return response;
    const limited = aiThrottle(user.id);
    if (limited) return limited;
    const { id } = await context.params;
    return privateJson(await triageIncident(user, id));
  } catch (error) { return workflowErrorResponse(error); }
}
