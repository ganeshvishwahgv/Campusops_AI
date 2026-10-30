import { connection } from "next/server";
import { privateJson } from "@/lib/auth/http";
import { authorizeBookings, bookingErrorResponse, getBooking } from "@/lib/bookings/service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { user, response } = await authorizeBookings();
    if (response) return response;
    return privateJson({ booking: await getBooking(user, (await context.params).id) });
  } catch (error) { return bookingErrorResponse(error); }
}
