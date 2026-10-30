import { ComplaintError } from "@/lib/complaints/validation";
import { expectedVersion } from "@/lib/workflow/validation";

export class BookingError extends ComplaintError {}
const fields = ["title", "purpose", "roomId", "startsAt", "endsAt", "attendees", "needsAccessible", "needsProjector"];
function strict(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new BookingError(400, "Unsupported booking fields.");
}
function text(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) throw new BookingError(400, `${label} must contain ${min}–${max} characters.`);
  return value.trim();
}
export function bookingDate(value: unknown): Date {
  if (typeof value !== "string") throw new BookingError(400, "Booking dates must include a valid date, time, and timezone.");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new BookingError(400, "Booking dates must include a valid date, time, and timezone.");
  const [, y, m, d, h, minute, second, , zone] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offsetValid = zone === "Z" || (Number(zone.slice(1, 3)) <= 14 && Number(zone.slice(4)) < 60 && (Number(zone.slice(1, 3)) < 14 || Number(zone.slice(4)) === 0));
  const parsed = new Date(value);
  if (year < 2000 || year > 9998 || month < 1 || month > 12 || day < 1 || day > daysInMonth || Number(h) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59 || !offsetValid || !Number.isFinite(parsed.getTime())) throw new BookingError(400, "Enter valid calendar dates and times.");
  return parsed;
}
function requirements(body: Record<string, unknown>) {
  const startsAt = bookingDate(body.startsAt), endsAt = bookingDate(body.endsAt);
  if (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 7 * 86400000) throw new BookingError(400, "The end must follow the start, with a duration of at most seven days.");
  if (typeof body.attendees !== "number" || !Number.isInteger(body.attendees) || body.attendees < 1 || body.attendees > 10000) throw new BookingError(400, "Enter an attendance from 1 to 10,000.");
  if (typeof body.needsAccessible !== "boolean" || typeof body.needsProjector !== "boolean") throw new BookingError(400, "Choose accessibility and projector requirements.");
  return { startsAt, endsAt, attendees: body.attendees, needsAccessible: body.needsAccessible, needsProjector: body.needsProjector };
}
export function validateBooking(body: Record<string, unknown>) {
  strict(body, fields);
  return { title: text(body.title, "Event title", 3, 120), purpose: text(body.purpose, "Purpose", 10, 2000), roomId: text(body.roomId, "Room reference", 1, 100), ...requirements(body) };
}
export function validateBookingAction(body: Record<string, unknown>) {
  if (body.action !== "UPDATE" && body.action !== "CANCEL") throw new BookingError(400, "Choose a supported booking action.");
  strict(body, ["action", "expectedVersion", "note", ...(body.action === "UPDATE" ? fields : [])]);
  const base = { expectedVersion: expectedVersion(body.expectedVersion), note: text(body.note, "Update note", 5, 2000) };
  if (body.action === "CANCEL") return { ...base, action: "CANCEL" as const };
  const values = Object.fromEntries(fields.map((field) => [field, body[field]]));
  return { ...base, action: "UPDATE" as const, booking: validateBooking(values) };
}
export function validateAvailability(params: URLSearchParams) {
  const value = (key: string) => {
    const input = params.get(key);
    if (input !== "true" && input !== "false") throw new BookingError(400, "Choose accessibility and projector requirements.");
    return input === "true";
  };
  return requirements({ startsAt: params.get("startsAt"), endsAt: params.get("endsAt"), attendees: Number(params.get("attendees")), needsAccessible: value("needsAccessible"), needsProjector: value("needsProjector") });
}
export function requireFuture(startsAt: Date) {
  const now = Date.now();
  if (startsAt.getTime() < now || startsAt.getTime() > now + 365 * 86400000) throw new BookingError(400, "Choose a future start within the next 365 days.");
}
