import { authorizeDashboard, checkMutationOrigin, privateJson, readJsonBody } from "@/lib/auth/http";
import { complaintErrorResponse } from "@/lib/complaints/service";
import { ComplaintError } from "@/lib/complaints/validation";
import { findRescuePlan } from "@/lib/transport/rescue";
import { parseFleet } from "@/lib/transport/validation";

export async function POST(request: Request) {
  try {
    const { response } = await authorizeDashboard();
    if (response) return response;
    const rejected = checkMutationOrigin(request);
    if (rejected) return rejected;
    const body = await readJsonBody(request, 64 * 1024);
    const fleet = parseFleet(body.fleet);
    const broken = fleet.find((bus) => bus.id === body.brokenBusId);
    if (!broken) throw new ComplaintError(404, "Bus not found.");
    return privateJson(findRescuePlan(broken, fleet));
  } catch (error) { return complaintErrorResponse(error); }
}
