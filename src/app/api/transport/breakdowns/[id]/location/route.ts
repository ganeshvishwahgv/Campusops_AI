import { authorizeTransport, checkMutationOrigin, privateJson, readJsonBody } from "@/lib/auth/http";
import { complaintErrorResponse } from "@/lib/complaints/service";
import { ComplaintError } from "@/lib/complaints/validation";
import { moveBreakdown } from "@/lib/transport/breakdowns";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { response } = await authorizeTransport();
    if (response) return response;
    const rejected = checkMutationOrigin(request);
    if (rejected) return rejected;
    const { lat, lng } = await readJsonBody(request, 1024);
    if (typeof lat !== "number" || typeof lng !== "number" || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new ComplaintError(400, "Send a valid location.");
    await moveBreakdown((await context.params).id, lat, lng);
    return privateJson({ ok: true });
  } catch (error) { return complaintErrorResponse(error); }
}
