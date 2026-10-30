import type { Booking, RoomCandidate } from "@/lib/bookings/types";
import type { Recommendation } from "@/lib/ai/types";

export type RoomRecovery = {
  booking: Booking; rooms: RoomCandidate[]; recommendation: Recommendation;
  startsAt: string; endsAt: string; bookingVersion: number;
};
