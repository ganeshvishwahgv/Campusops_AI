import { connection } from "next/server";
import { privateJson } from "@/lib/auth/http";
import { authorizeWorkflow, getWorkOrder, workflowErrorResponse } from "@/lib/workflow/service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { user, response } = await authorizeWorkflow();
    if (response) return response;
    const { id } = await context.params;
    return privateJson({ workOrder: await getWorkOrder(user, id) });
  } catch (error) { return workflowErrorResponse(error); }
}
