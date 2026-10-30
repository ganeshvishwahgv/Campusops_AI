import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/session";
import { availability } from "@/lib/bookings/service";
import { BookingError } from "@/lib/bookings/validation";
import type { RoomCandidate } from "@/lib/bookings/types";
import type { RoomAdvice, RoomRecoveryResult } from "./types";
import { structured, withFallback } from "./client";

type Actor = Pick<CurrentUser, "id" | "role">;
type Need = { attendees: number; needsAccessible: boolean; needsProjector: boolean; purpose?: string; preferBuildingId?: string | null; avoidRoomId?: string | null };

const RoomChoice = z.object({
  selectedId: z.string().nullable(),
  reason: z.string(),
  ranking: z.array(z.object({ id: z.string(), note: z.string() })),
  tips: z.array(z.string()),
});

// Seat fit comes first: the fewest empty seats wins. Staying in the original
// building only breaks near-ties (worth up to 10 seats).
const SAME_BUILDING_SEATS = 10;
function spare(room: RoomCandidate, need: Need) { return room.capacity - need.attendees; }
function fitScore(room: RoomCandidate, need: Need) {
  return spare(room, need) + (room.building.id === need.preferBuildingId ? 0 : SAME_BUILDING_SEATS);
}
function rankByFit(rooms: RoomCandidate[], need: Need) {
  return rooms.filter((room) => room.eligible).sort((a, b) => fitScore(a, need) - fitScore(b, need) || Number(b.accessible) - Number(a.accessible) || a.name.localeCompare(b.name));
}

function rulesChoice(rooms: RoomCandidate[], need: Need) {
  const ranked = rankByFit(rooms, need);
  const best = ranked[0];
  return {
    selectedId: best?.id ?? null,
    reason: best
      ? `${best.name} fits ${need.attendees} people with only ${spare(best, need)} empty seat${spare(best, need) === 1 ? "" : "s"} — the tightest fit that passes every capacity, access, equipment and schedule check${best.building.id === need.preferBuildingId ? ", and it is in the same building" : ""}.`
      : "No room passes the capacity, accessibility, equipment and schedule checks for this time. Try another time slot or split the group.",
    ranking: ranked.slice(0, 4).map((room) => ({ id: room.id, note: `${room.capacity} seats · ${spare(room, need)} spare · ${room.building.name}` })),
    tips: best ? ["Inform attendees of the new venue before the start time.", "Confirm the room is unlocked and equipment works 15 minutes early."] : ["Consider splitting the group across two smaller rooms.", "Ask facilities whether the original room can be restored in time."],
  };
}

/** Rank deterministic room candidates with Claude; the choice is restricted to eligible rooms. */
export async function recommendRoom(rooms: RoomCandidate[], need: Need) {
  const pool = rooms.filter((room) => room.id !== need.avoidRoomId)
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || (a.eligible ? fitScore(a, need) - fitScore(b, need) : a.capacity - b.capacity));
  const eligibleIds = new Set(pool.filter((room) => room.eligible).map((room) => room.id));
  const tightest = rankByFit(pool, need)[0];
  const recommendation = await withFallback(async () => {
    if (!eligibleIds.size) return rulesChoice(pool, need);
    const candidates = pool.filter((room) => room.eligible).map((room) => ({
      id: room.id, name: room.name, building: room.building.name, sameBuilding: room.building.id === need.preferBuildingId,
      capacity: room.capacity, spareSeats: spare(room, need), accessible: room.accessible, hasProjector: room.hasProjector,
    }));
    const choice = await structured(RoomChoice,
      `Recommend the single best room for this group. Every candidate below has already passed capacity, accessibility, equipment and double-booking checks, and they are sorted from tightest fit (fewest spareSeats) to loosest.
Rules, in order of importance:
1. Pick the room with the FEWEST spareSeats. Do not pick a bigger room just because it is bigger or has more space; empty seats are wasted space that another class could use.
2. Only if two rooms are within 10 spare seats of each other, prefer sameBuilding: true.
3. Only skip the tightest room if the purpose clearly needs something it lacks (for example a lab session needs a LAB, or an exam needs at least one empty seat between students — then use attendees × 2 as the seats needed).
Return selectedId, a one-to-two sentence reason that quotes the capacity and spare seats, a ranking of up to four rooms (tightest fit first) with a short note each, and two or three practical tips for moving people.`,
      { need, candidates, excludedRooms: pool.filter((room) => !room.eligible).map((room) => ({ name: room.name, why: room.reasons })) },
      { maxTokens: 3000, effort: "medium" });
    // Never trust a model to override the deterministic eligibility checks.
    const picked = pool.find((room) => room.id === choice.selectedId);
    if (!picked || !eligibleIds.has(picked.id)) return rulesChoice(pool, need);
    // Guard against wasteful picks: more than 25 extra empty seats beyond the tightest fit
    // is only accepted when the purpose mentions an exam (spacing) or a lab.
    const justified = /exam|test|lab|practical/i.test(need.purpose ?? "");
    if (tightest && !justified && spare(picked, need) - spare(tightest, need) > 25) return rulesChoice(pool, need);
    return { ...choice, ranking: choice.ranking.filter((item) => eligibleIds.has(item.id)) };
  }, () => rulesChoice(pool, need));
  return { rooms: pool, recommendation } satisfies RoomAdvice;
}

/** Room suggestions for the booking form; uses the same permission-scoped availability check. */
export async function adviseBookingRoom(user: Actor, params: URLSearchParams): Promise<RoomAdvice> {
  const { rooms } = await availability(user, params);
  const purpose = (params.get("purpose") ?? "").slice(0, 500);
  return recommendRoom(rooms, {
    attendees: Number(params.get("attendees")), needsAccessible: params.get("needsAccessible") === "true",
    needsProjector: params.get("needsProjector") === "true", purpose,
  });
}

/** For a room taken out of service: find what is affected and where to move people. */
export async function roomRecovery(user: Actor, params: URLSearchParams): Promise<RoomRecoveryResult> {
  const roomId = params.get("roomId") ?? "";
  const source = roomId.length <= 100 ? await db.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, availability: true, capacity: true, hasProjector: true, building: { select: { id: true, name: true } } },
  }) : null;
  if (!source) throw new BookingError(404, "Room not found.");
  const [incidents, bookings, { rooms }] = await Promise.all([
    db.incident.findMany({ where: { roomId: source.id, status: { notIn: ["RESOLVED", "CLOSED"] } }, select: { id: true, title: true, priority: true, status: true }, take: 20 }),
    db.roomBooking.findMany({
      where: { roomId: source.id, status: "CONFIRMED", endsAt: { gt: new Date() } },
      select: { id: true, title: true, startsAt: true, endsAt: true, attendees: true },
      orderBy: { startsAt: "asc" }, take: 50,
    }),
    availability(user, params),
  ]);
  const advice = await recommendRoom(rooms, {
    attendees: Number(params.get("attendees")), needsAccessible: params.get("needsAccessible") === "true",
    needsProjector: params.get("needsProjector") === "true", purpose: (params.get("purpose") ?? "").slice(0, 500),
    preferBuildingId: source.building.id, avoidRoomId: source.id,
  });
  return {
    ...advice,
    source: { id: source.id, name: source.name, availability: source.availability, capacity: source.capacity, building: source.building },
    incidents,
    affectedBookings: bookings.map((booking) => ({
      id: booking.id, title: booking.title, attendees: booking.attendees,
      startsAt: booking.startsAt.toISOString(), endsAt: booking.endsAt.toISOString(),
    })),
  };
}
