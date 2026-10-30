import { connection } from "next/server";
import { privateJson } from "@/lib/auth/http";
import { authorizeBookings, availability, bookingErrorResponse } from "@/lib/bookings/service";

export async function GET(request: Request) {
  await connection();
  try {
    const { user, response } = await authorizeBookings();
    if (response) return response;
    return privateJson(await availability(user, new URL(request.url).searchParams));
  } catch (error) { return bookingErrorResponse(error); }
}
