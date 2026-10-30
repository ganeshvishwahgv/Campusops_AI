import { connection } from "next/server";
import { privateJson } from "@/lib/auth/http";
import { authorizeBookings, bookingErrorResponse, bookingImpact } from "@/lib/bookings/service";

export async function GET(request: Request) {
  await connection();
  try {
    const { response } = await authorizeBookings(true);
    if (response) return response;
    return privateJson(await bookingImpact(new URL(request.url).searchParams.get("incidentId") ?? ""));
  } catch (error) { return bookingErrorResponse(error); }
}
