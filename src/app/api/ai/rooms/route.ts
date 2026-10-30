import { connection } from "next/server";
import { privateJson } from "@/lib/auth/http";
import { authorizeBookings, bookingErrorResponse } from "@/lib/bookings/service";
import { adviseBookingRoom } from "@/lib/ai/rooms";
import { aiThrottle } from "@/lib/ai/http";

export async function GET(request: Request) {
  await connection();
  try {
    const { user, response } = await authorizeBookings();
    if (response) return response;
    const limited = aiThrottle(user.id);
    if (limited) return limited;
    return privateJson(await adviseBookingRoom(user, new URL(request.url).searchParams));
  } catch (error) { return bookingErrorResponse(error); }
}
