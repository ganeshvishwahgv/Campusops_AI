import { checkMutationOrigin, privateJson, readJsonBody } from "@/lib/auth/http";
import { authorizeWorkflow, updateTechnician, workflowErrorResponse } from "@/lib/workflow/service";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, response } = await authorizeWorkflow(true);
    if (response) return response;
    const rejected = checkMutationOrigin(request);
    if (rejected) return rejected;
    const body = await readJsonBody(request);
    const { id } = await context.params;
    if (id.length > 100) return privateJson({ error: "Technician not found." }, 404);
    return privateJson(await updateTechnician(user.id, id, body));
  } catch (error) { return workflowErrorResponse(error); }
}
