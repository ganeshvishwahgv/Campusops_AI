import { connection } from "next/server";
import { checkMutationOrigin, privateJson, readJsonBody } from "@/lib/auth/http";
import { validateSubmissionKey } from "@/lib/complaints/validation";
import { authorizeBookings, bookingErrorResponse, createBooking, listBookings } from "@/lib/bookings/service";

export async function GET(request: Request) {
  await connection();
  try {
    const { user, response } = await authorizeBookings();
    if (response) return response;
    return privateJson(await listBookings(user, new URL(request.url).searchParams));
  } catch (error) { return bookingErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const { user, response } = await authorizeBookings();
    if (response) return response;
    const rejected = checkMutationOrigin(request);
    if (rejected) return rejected;
    const key = validateSubmissionKey(request.headers.get("Idempotency-Key"));
    const result = await createBooking(user.id, key, await readJsonBody(request, 12 * 1024));
    return privateJson(result, result.replayed ? 200 : 201);
  } catch (error) { return bookingErrorResponse(error); }
}
