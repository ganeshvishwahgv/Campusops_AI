import { checkMutationOrigin, privateJson, readJsonBody } from "@/lib/auth/http";
import { validateSubmissionKey } from "@/lib/complaints/validation";
import { authorizeWorkflow, performAction, workflowErrorResponse } from "@/lib/workflow/service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, response } = await authorizeWorkflow();
    if (response) return response;
    const rejected = checkMutationOrigin(request);
    if (rejected) return rejected;
    const key = validateSubmissionKey(request.headers.get("Idempotency-Key"));
    const body = await readJsonBody(request, 12 * 1024);
    const { id } = await context.params;
    return privateJson(await performAction(user.id, id, key, body));
  } catch (error) { return workflowErrorResponse(error); }
}
