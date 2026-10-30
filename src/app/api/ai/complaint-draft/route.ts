import { checkMutationOrigin, privateJson, readJsonBody } from "@/lib/auth/http";
import { authorizeComplaints } from "@/lib/complaints/service";
import { ComplaintError } from "@/lib/complaints/validation";
import { draftComplaint } from "@/lib/ai/operations";
import { aiErrorResponse, aiThrottle } from "@/lib/ai/http";

export async function POST(request: Request) {
  try {
    const { user, response } = await authorizeComplaints();
    if (response) return response;
    const rejected = checkMutationOrigin(request);
    if (rejected) return rejected;
    const limited = aiThrottle(user.id);
    if (limited) return limited;
    const { text } = await readJsonBody(request, 8 * 1024);
    if (typeof text !== "string" || text.trim().length < 10 || text.trim().length > 4000) {
      throw new ComplaintError(400, "Describe the problem in 10 to 4,000 characters.");
    }
    // A draft only pre-fills the form; the reporter reviews it and normal validation runs on submit.
    return privateJson(await draftComplaint(text.trim()));
  } catch (error) { return aiErrorResponse(error); }
}
