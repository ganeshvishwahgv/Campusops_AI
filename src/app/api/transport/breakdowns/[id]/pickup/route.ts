import { authorizeTransport, checkMutationOrigin, privateJson, readJsonBody } from "@/lib/auth/http";
import { complaintErrorResponse } from "@/lib/complaints/service";
import { ComplaintError } from "@/lib/complaints/validation";
import { recordPickup } from "@/lib/transport/breakdowns";

// Rescue buses picked students up; share how many are still waiting with every viewer.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { response } = await authorizeTransport();
    if (response) return response;
    const rejected = checkMutationOrigin(request);
    if (rejected) return rejected;
    const { waiting } = await readJsonBody(request, 512);
    if (typeof waiting !== "number" || !Number.isInteger(waiting) || waiting < 0 || waiting > 200) throw new ComplaintError(400, "Send the number of students still waiting.");
    await recordPickup((await context.params).id, waiting);
    return privateJson({ ok: true });
  } catch (error) { return complaintErrorResponse(error); }
}
