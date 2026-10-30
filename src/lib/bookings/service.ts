import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { canAccessBookings, canViewDashboard } from "@/lib/auth/permissions";
import { clearSessionCookie, getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { privateJson, RequestBodyError } from "@/lib/auth/http";
import { ComplaintError } from "@/lib/complaints/validation";
import { BookingError, requireFuture, validateAvailability, validateBooking, validateBookingAction } from "./validation";

type Reader = Prisma.TransactionClient;
type Actor = Pick<CurrentUser, "id" | "role">;
const roomSelect = {
  id: true, name: true, capacity: true, accessible: true, hasProjector: true, availability: true,
  building: { select: { id: true, name: true } },
  assets: { where: { category: "EQUIPMENT" }, select: { availability: true } },
} as const satisfies Prisma.RoomSelect;
type RoomRow = Prisma.RoomGetPayload<{ select: typeof roomSelect }>;
function roomDto({ assets, ...room }: RoomRow) {
  return { ...room, equipmentReady: assets.every((asset) => asset.availability === "AVAILABLE") };
}
const eventSelect = { id: true, action: true, note: true, actorName: true, actorRole: true, createdAt: true, before: true, after: true } as const;
const bookingSelect = {
  id: true, title: true, purpose: true, startsAt: true, endsAt: true, attendees: true, needsAccessible: true, needsProjector: true,
  status: true, version: true, cancelledAt: true, createdAt: true, updatedAt: true,
  room: { select: roomSelect }, owner: { select: { name: true, department: true } },
} as const satisfies Prisma.RoomBookingSelect;
const historyQuery = { select: eventSelect, orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 100 };
type BookingRow = Prisma.RoomBookingGetPayload<{ select: typeof bookingSelect }>;
function bookingDto(row: BookingRow) { return { ...row, room: roomDto(row.room) }; }
function scope(user: Actor): Prisma.RoomBookingWhereInput { return canViewDashboard(user.role) ? {} : { ownerId: user.id }; }
const txOptions = { timeout: 10000, maxWait: 10000 };

export async function authorizeBookings(adminOnly = false) {
  const user = await getCurrentUser();
  if (!user) {
    const response = privateJson({ error: "Please sign in to continue." }, 401);
    clearSessionCookie(response);
    return { user: null, response };
  }
  if (!canAccessBookings(user.role) || (adminOnly && !canViewDashboard(user.role))) return { user: null, response: privateJson({ error: "Your role cannot access this booking operation." }, 403) };
  return { user, response: null };
}
export function bookingErrorResponse(error: unknown) {
  if (error instanceof ComplaintError || error instanceof RequestBodyError) {
    const response = privateJson({ error: error.message }, error.status);
    if (error.status === 401) clearSessionCookie(response);
    return response;
  }
  console.error("Booking request could not be completed.");
  return privateJson({ error: "The booking service is temporarily unavailable. Please retry." }, 503);
}
async function writeActor(tx: Reader, actorId: string) {
  // A constant SQLite write locks admission before overlap and permission reads.
  const locked = await tx.$executeRaw`UPDATE "WorkflowLock" SET "id" = "id" WHERE "id" = 1`;
  if (locked !== 1) throw new BookingError(503, "Booking storage is not ready. Apply pending migrations.");
  const actor = await tx.user.findFirst({ where: { id: actorId, active: true }, select: { id: true, name: true, role: true } });
  if (!actor) throw new BookingError(401, "Your account is no longer active.");
  if (!canAccessBookings(actor.role)) throw new BookingError(403, "Your role can no longer manage bookings.");
  return actor;
}
export async function getBooking(user: Actor, id: string, tx: Reader = db) {
  const row = id.length <= 100 ? await tx.roomBooking.findFirst({ where: { id, ...scope(user) }, select: { ...bookingSelect, history: historyQuery } }) : null;
  if (!row) throw new BookingError(404, "Booking not found.");
  return { ...bookingDto(row), history: row.history };
}
export async function listBookings(user: Actor, params: URLSearchParams) {
  const rawPage = params.get("page") ?? "1", page = Number(rawPage), status = params.get("status") ?? "ALL", q = (params.get("q") ?? "").trim();
  if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1 || page > 10000 || !["ALL", "CONFIRMED", "CANCELLED"].includes(status) || q.length > 100) throw new BookingError(400, "Choose a valid page, status and search up to 100 characters.");
  const where: Prisma.RoomBookingWhereInput = { ...scope(user), ...(status === "ALL" ? {} : { status: status as "CONFIRMED" | "CANCELLED" }), ...(q ? { OR: [{ id: { contains: q } }, { title: { contains: q } }, { room: { name: { contains: q } } }] } : {}) };
  const [total, rows] = await db.$transaction([
    db.roomBooking.count({ where }),
    db.roomBooking.findMany({ where, select: bookingSelect, orderBy: [{ startsAt: "desc" }, { id: "asc" }], skip: (page - 1) * 20, take: 20 }),
  ]);
  return { items: rows.map((row) => ({ ...bookingDto(row), history: [] })), total, page, pageSize: 20, totalPages: Math.max(1, Math.ceil(total / 20)) };
}
export async function bookingRooms(tx: Reader = db) {
  return (await tx.room.findMany({ select: roomSelect, orderBy: { name: "asc" } })).map(roomDto);
}
type Requirements = ReturnType<typeof validateAvailability>;
async function candidates(tx: Reader, input: Requirements, excludeId?: string) {
  const rooms = await bookingRooms(tx);
  const occupied = await tx.roomBooking.findMany({
    where: { status: "CONFIRMED", startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { roomId: true }, distinct: ["roomId"],
  });
  return rooms.map((room) => {
    const reasons: string[] = [];
    if (room.availability !== "AVAILABLE") reasons.push("Room is not available for booking.");
    if (room.capacity < input.attendees) reasons.push(`Capacity is ${room.capacity}; ${input.attendees} places are needed.`);
    if (input.needsAccessible && !room.accessible) reasons.push("Accessible access is not recorded for this room.");
    if (input.needsProjector && !room.hasProjector) reasons.push("No projector is recorded for this room.");
    if (input.needsProjector && !room.equipmentReady) reasons.push("Room equipment needs attention; projector readiness cannot be confirmed.");
    if (occupied.some((item) => item.roomId === room.id)) reasons.push("Room is already booked during this time.");
    return { ...room, eligible: reasons.length === 0, reasons };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.capacity - b.capacity || a.name.localeCompare(b.name));
}
export async function availability(user: Actor, params: URLSearchParams) {
  const input = validateAvailability(params);
  requireFuture(input.startsAt);
  return db.$transaction(async (tx) => {
    const excludeId = params.get("excludeBookingId") ?? undefined;
    if (excludeId !== undefined) {
      const booking = await getBooking(user, excludeId, tx);
      if (booking.status !== "CONFIRMED") throw new BookingError(409, "Only a confirmed booking can be excluded from its own availability check.");
    }
    return { rooms: await candidates(tx, input, excludeId) };
  });
}
async function validateRoom(tx: Reader, input: ReturnType<typeof validateBooking>, excludeId?: string) {
  requireFuture(input.startsAt);
  const room = (await candidates(tx, input, excludeId)).find((item) => item.id === input.roomId);
  if (!room) throw new BookingError(400, "Choose an existing campus room.");
  if (!room.eligible) throw new BookingError(409, room.reasons.join(" "));
}
function snapshot(row: Pick<BookingRow, "title" | "purpose" | "startsAt" | "endsAt" | "attendees" | "needsAccessible" | "needsProjector" | "status"> & { room: { id: string; name: string } }) {
  return { title: row.title, purpose: row.purpose, roomId: row.room.id, roomName: row.room.name,
    startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), attendees: row.attendees,
    needsAccessible: row.needsAccessible, needsProjector: row.needsProjector, status: row.status };
}
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function replay(tx: Reader, actor: Actor, requestKey: string, requestHash: string) {
  const prior = await tx.bookingEvent.findUnique({ where: { actorId_requestKey: { actorId: actor.id, requestKey } }, select: { bookingId: true, requestHash: true } });
  if (!prior) return null;
  // Scope still applies if a formerly administrative actor lost that access.
  const booking = await getBooking(actor, prior.bookingId, tx);
  if (prior.requestHash !== requestHash) throw new BookingError(409, "This request reference was already used for different details.");
  return { booking, replayed: true };
}
export async function createBooking(actorId: string, key: string, body: Record<string, unknown>) {
  const input = validateBooking(body), requestHash = hash({ action: "CREATE", ...input });
  return db.$transaction(async (tx) => {
    const actor = await writeActor(tx, actorId);
    const previous = await replay(tx, actor, key, requestHash);
    if (previous) return previous;
    await validateRoom(tx, input);
    const row = await tx.roomBooking.create({ data: { ...input, ownerId: actor.id }, select: bookingSelect });
    await tx.bookingEvent.create({ data: { bookingId: row.id, actorId: actor.id, actorName: actor.name, actorRole: actor.role,
      action: "CREATE", note: "Booking confirmed after room and schedule checks.", after: snapshot(row), resultVersion: 0, requestKey: key, requestHash } });
    return { booking: await getBooking(actor, row.id, tx), replayed: false };
  }, txOptions);
}
export async function changeBooking(actorId: string, id: string, key: string, body: Record<string, unknown>) {
  const input = validateBookingAction(body), requestHash = hash({ bookingId: id, ...input });
  return db.$transaction(async (tx) => {
    const actor = await writeActor(tx, actorId);
    const current = await getBooking(actor, id, tx);
    const previous = await replay(tx, actor, key, requestHash);
    if (previous) return previous;
    if (current.version !== input.expectedVersion) throw new BookingError(409, "This booking changed. Refresh and review the latest details before saving.");
    if (current.status !== "CONFIRMED") throw new BookingError(409, "Cancelled bookings cannot be changed. Create a new booking.");
    if (current.endsAt.getTime() <= Date.now()) throw new BookingError(409, "This event has ended. Its booking is retained as history.");
    if (input.action === "UPDATE") await validateRoom(tx, input.booking, id);
    const updated = await tx.roomBooking.updateMany({ where: { id, version: input.expectedVersion }, data: {
      ...(input.action === "UPDATE" ? input.booking : { status: "CANCELLED", cancelledAt: new Date() }), version: { increment: 1 },
    } });
    if (updated.count !== 1) throw new BookingError(409, "This booking changed. Refresh and try again.");
    const next = await tx.roomBooking.findUniqueOrThrow({ where: { id }, select: bookingSelect });
    await tx.bookingEvent.create({ data: { bookingId: id, actorId: actor.id, actorName: actor.name, actorRole: actor.role,
      action: input.action, note: input.note, before: snapshot(current), after: snapshot(next),
      resultVersion: next.version, requestKey: key, requestHash } });
    return { booking: await getBooking(actor, id, tx), replayed: false };
  }, txOptions);
}
export async function bookingImpact(incidentId: string) {
  return db.$transaction(async (tx) => {
    const incident = incidentId.length <= 100 ? await tx.incident.findUnique({ where: { id: incidentId }, select: { id: true, title: true, roomId: true, buildingId: true } }) : null;
    if (!incident) throw new BookingError(404, "Incident not found.");
    if (!incident.roomId && !incident.buildingId) return { incident, items: [], total: 0, truncated: false };
    const where: Prisma.RoomBookingWhereInput = { status: "CONFIRMED", endsAt: { gt: new Date() }, ...(incident.roomId ? { roomId: incident.roomId } : { room: { buildingId: incident.buildingId! } }) };
    const total = await tx.roomBooking.count({ where });
    const rows = await tx.roomBooking.findMany({ where, select: bookingSelect, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: 100 });
    return { incident, items: rows.map((row) => ({ ...bookingDto(row), history: [] })), total, truncated: total > rows.length };
  });
}
