export type BookingRoom = {
  id: string; name: string; capacity: number; accessible: boolean; hasProjector: boolean;
  availability: string; equipmentReady: boolean;
  building: { id: string; name: string };
};
export type RoomCandidate = BookingRoom & { eligible: boolean; reasons: string[] };
export type BookingSnapshot = {
  title: string; purpose: string; roomId: string; roomName: string;
  startsAt: string; endsAt: string; attendees: number;
  needsAccessible: boolean; needsProjector: boolean; status: string;
};
export type BookingEvent = {
  id: string; action: string; note: string; actorName: string; actorRole: string; createdAt: string;
  before: BookingSnapshot | null; after: BookingSnapshot;
};
export type Booking = {
  id: string; title: string; purpose: string; startsAt: string; endsAt: string; attendees: number;
  needsAccessible: boolean; needsProjector: boolean; status: "CONFIRMED" | "CANCELLED";
  version: number; createdAt: string; updatedAt: string; cancelledAt: string | null;
  room: BookingRoom; owner: { name: string; department: string | null };
  history: BookingEvent[];
};
export type BookingList = { items: Booking[]; total: number; page: number; pageSize: number; totalPages: number };
export type BookingImpact = {
  incident: { id: string; title: string; roomId: string | null; buildingId: string | null };
  items: Booking[]; total: number; truncated: boolean;
};
