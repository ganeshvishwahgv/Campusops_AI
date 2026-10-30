import { connection } from "next/server";
import { privateJson } from "@/lib/auth/http";
import { authorizeBookings, bookingErrorResponse } from "@/lib/bookings/service";
import { roomRecovery } from "@/lib/ai/rooms";
import { aiThrottle } from "@/lib/ai/http";

export async function GET(request: Request) {
  await connection();
  try {
    const { user, response } = await authorizeBookings(true);
    if (response) return response;
    const limited = aiThrottle(user.id);
    if (limited) return limited;
    return privateJson(await roomRecovery(user, new URL(request.url).searchParams));
  } catch (error) { return bookingErrorResponse(error); }
}
