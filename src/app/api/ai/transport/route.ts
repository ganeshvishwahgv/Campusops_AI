import { authorizeTransport, checkMutationOrigin, privateJson, readJsonBody } from "@/lib/auth/http";
import { ComplaintError } from "@/lib/complaints/validation";
import { findRescuePlan } from "@/lib/transport/rescue";
import { transportBrief } from "@/lib/ai/operations";
import { aiErrorResponse, aiThrottle } from "@/lib/ai/http";
import { parseFleet } from "@/lib/transport/validation";

export async function POST(request: Request) {
  try {
    const { user, response } = await authorizeTransport();
    if (response) return response;
    const rejected = checkMutationOrigin(request);
    if (rejected) return rejected;
    const limited = aiThrottle(user.id);
    if (limited) return limited;
    const body = await readJsonBody(request, 64 * 1024);
    const fleet = parseFleet(body.fleet);
    const broken = fleet.find((bus) => bus.id === body.brokenBusId && bus.status === "BREAKDOWN");
    if (!broken) throw new ComplaintError(404, "Report a breakdown before requesting a dispatch brief.");
    // Recompute the plan server-side so the brief always explains the rule-based allocation.
    return privateJson(await transportBrief(findRescuePlan(broken, fleet), fleet));
  } catch (error) { return aiErrorResponse(error); }
}
