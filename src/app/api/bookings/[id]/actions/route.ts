import { checkMutationOrigin, privateJson, readJsonBody } from "@/lib/auth/http";
import { validateSubmissionKey } from "@/lib/complaints/validation";
import { authorizeBookings, bookingErrorResponse, changeBooking } from "@/lib/bookings/service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, response } = await authorizeBookings();
    if (response) return response;
    const rejected = checkMutationOrigin(request);
    if (rejected) return rejected;
    const key = validateSubmissionKey(request.headers.get("Idempotency-Key"));
    const body = await readJsonBody(request, 24 * 1024);
    return privateJson(await changeBooking(user.id, (await context.params).id, key, body));
  } catch (error) { return bookingErrorResponse(error); }
}
