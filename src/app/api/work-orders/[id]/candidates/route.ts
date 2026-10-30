import { connection } from "next/server";
import { privateJson } from "@/lib/auth/http";
import { assignmentCandidates, authorizeWorkflow, workflowErrorResponse } from "@/lib/workflow/service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { user, response } = await authorizeWorkflow(true);
    if (response) return response;
    const { id } = await context.params;
    return privateJson(await assignmentCandidates(user, id));
  } catch (error) { return workflowErrorResponse(error); }
}
