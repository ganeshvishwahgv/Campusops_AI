import { authorizeDashboard, checkMutationOrigin, privateJson, readJsonBody } from "@/lib/auth/http";
import { ComplaintError } from "@/lib/complaints/validation";
import { askLens, type LensTurn } from "@/lib/ai/operations";
import { aiErrorResponse, aiThrottle } from "@/lib/ai/http";

export async function POST(request: Request) {
  try {
    const { user, response } = await authorizeDashboard();
    if (response) return response;
    const rejected = checkMutationOrigin(request);
    if (rejected) return rejected;
    const limited = aiThrottle(user.id);
    if (limited) return limited;
    const body = await readJsonBody(request, 32 * 1024);
    if (typeof body.question !== "string" || body.question.trim().length < 2 || body.question.length > 1000) {
      throw new ComplaintError(400, "Ask a question of up to 1,000 characters.");
    }
    const history: LensTurn[] = Array.isArray(body.history)
      ? body.history.filter((turn): turn is LensTurn => Boolean(turn) && typeof turn === "object"
          && (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string").slice(-6)
      : [];
    return privateJson(await askLens(body.question.trim(), history));
  } catch (error) { return aiErrorResponse(error); }
}
