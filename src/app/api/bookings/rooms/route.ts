import { connection } from "next/server";
import { privateJson } from "@/lib/auth/http";
import { authorizeBookings, bookingErrorResponse, bookingRooms } from "@/lib/bookings/service";

export async function GET() {
  await connection();
  try {
    const { response } = await authorizeBookings();
    if (response) return response;
    return privateJson({ rooms: await bookingRooms() });
  } catch (error) { return bookingErrorResponse(error); }
}
