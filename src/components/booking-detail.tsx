"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Booking } from "@/lib/bookings/types";
import { complaintRequest, ComplaintRequestError, formatDate, readable, requestError } from "./complaint-shared";
import { newWorkflowKey, workButton, workEyebrow, workInput, workLabel } from "./work-order-shared";
import { BookingForm } from "./booking-form";
import { BookingStatus } from "./booking-shared";

export function BookingDetail({ booking, refreshing, checkedAt, onSaved, onConflict, onBusy }: {
  booking: Booking; refreshing: boolean; checkedAt: number;
  onSaved: (booking: Booking, replayed: boolean) => void; onConflict: () => void; onBusy: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState<"details" | "edit" | "cancel">("details");
  const [busy, setBusy] = useState(false);
  const mutable = booking.status === "CONFIRMED" && Date.parse(booking.endsAt) > checkedAt;
  function saved(next: Booking, replayed: boolean) { setMode("details"); onSaved(next, replayed); }
  function reportBusy(value: boolean) { setBusy(value); onBusy(value); }

  return <article>
    <div className="flex flex-wrap justify-between gap-3"><p className={workEyebrow}>Booking details</p><BookingStatus status={booking.status} /></div>
    <h2 className="mt-4 break-words text-xl font-bold leading-8">{booking.title}</h2><p className="mt-2 break-all font-mono text-[10px] leading-5 text-slate-500">Reference: {booking.id}</p>
    <dl className="mt-5 grid gap-x-6 divide-y divide-slate-100 sm:grid-cols-2">{[
      ["Room", booking.room.name], ["Building", booking.room.building.name],
      ["Starts", formatDate(booking.startsAt)], ["Ends", formatDate(booking.endsAt)],
      ["Attendance", `${booking.attendees} people · ${booking.room.capacity} seats`],
      ["Booked by", `${booking.owner.name}${booking.owner.department ? ` · ${booking.owner.department}` : ""}`],
      ["Requirements", [booking.needsAccessible ? "Accessible room" : "", booking.needsProjector ? "Projector" : ""].filter(Boolean).join(" · ") || "Standard room"],
      ["Last updated", formatDate(booking.updatedAt)],
    ].map(([label, value]) => <div key={label} className="py-3"><dt className={workEyebrow}>{label}</dt><dd className="mt-1 break-words text-xs leading-6 text-slate-600">{value}</dd></div>)}</dl>
    <section className="mt-4 border-t border-slate-100 pt-5"><h3 className={workEyebrow}>Activity arrangements</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{booking.purpose}</p></section>
    {mutable ? <section className="mt-6 rounded-lg border border-slate-200 bg-[#fafaf8] p-4 sm:p-5">
      <div className="mb-5 flex flex-wrap gap-2"><button type="button" disabled={busy || refreshing} onClick={() => setMode(mode === "edit" ? "details" : "edit")} className={workButton}>{mode === "edit" ? "Hide edit form" : "Edit / reschedule"}</button><button type="button" disabled={busy || refreshing} onClick={() => setMode(mode === "cancel" ? "details" : "cancel")} className={`${workButton} text-red-700`}>{mode === "cancel" ? "Keep booking" : "Cancel booking"}</button></div>
      {mode === "edit" ? <BookingForm booking={booking} refreshing={refreshing} onBusy={reportBusy} onSaved={saved} onConflict={onConflict} /> : mode === "cancel" ? <CancelBooking booking={booking} refreshing={refreshing} onBusy={reportBusy} onSaved={saved} onConflict={onConflict} /> : <p className="text-xs leading-6 text-slate-500">Changes recheck the room capacity, requirements, and schedule. Cancel to release the room. Ended bookings remain read-only.</p>}
    </section> : <p className="mt-5 rounded border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-500">{booking.status === "CANCELLED" ? "This booking was cancelled and its room reservation has been released." : "This activity has ended. Its saved details and history remain available."}</p>}
    <section className="mt-7 border-t border-slate-200 pt-6" aria-label="Booking history"><h3 className="text-sm font-bold">Booking history</h3><p className="mt-2 text-[11px] text-slate-500">{booking.history.length === 100 ? "Latest 100 updates shown. Earlier history remains saved." : "Most recent updates first."}</p><ol className="mt-5 space-y-5 border-l border-slate-200 pl-4">{booking.history.map((event) => <li key={event.id} className="relative"><span aria-hidden="true" className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-4 ring-white" /><h4 className="text-xs font-bold">{event.action === "CREATE" ? "Booking confirmed" : event.action === "CANCEL" ? "Booking cancelled" : "Booking updated"}</h4><p className="mt-2 text-[11px] leading-5 text-slate-500">{event.actorName} · {readable(event.actorRole)}<br /><time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time></p>
      {event.before && <div className="mt-2 space-y-1 text-xs leading-6 text-slate-600">
        {event.before.title !== event.after.title && <p>Activity: {event.before.title} → {event.after.title}</p>}
        {event.before.roomId !== event.after.roomId && <p>Room: {event.before.roomName} → {event.after.roomName}</p>}
        {(event.before.startsAt !== event.after.startsAt || event.before.endsAt !== event.after.endsAt) && <><p>Previous time: {formatDate(event.before.startsAt)} – {formatDate(event.before.endsAt)}</p><p>New time: {formatDate(event.after.startsAt)} – {formatDate(event.after.endsAt)}</p></>}
        {event.before.attendees !== event.after.attendees && <p>Attendance: {event.before.attendees} → {event.after.attendees}</p>}
        {event.before.needsAccessible !== event.after.needsAccessible && <p>Accessibility requirement: {event.after.needsAccessible ? "required" : "not requested"}</p>}
        {event.before.needsProjector !== event.after.needsProjector && <p>Projector requirement: {event.after.needsProjector ? "required" : "not requested"}</p>}
        {event.before.purpose !== event.after.purpose && <p>Activity arrangements updated.</p>}
      </div>}
      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-slate-700">{event.note}</p>
    </li>)}</ol></section>
  </article>;
}

function CancelBooking({ booking, refreshing, onBusy, onSaved, onConflict }: {
  booking: Booking; refreshing: boolean; onBusy: (busy: boolean) => void;
  onSaved: (booking: Booking, replayed: boolean) => void; onConflict: () => void;
}) {
  const [note, setNote] = useState("");
  const [version, setVersion] = useState(booking.version);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const needsReview = conflict || version !== booking.version;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || inFlight.current || needsReview || refreshing) return;
    setError("");
    if (note.trim().length < 5) { setError("Explain why the booking is being cancelled in at least 5 characters."); return; }
    const body = JSON.stringify({ action: "CANCEL", expectedVersion: version, note: note.trim() });
    if (attempt.current?.body !== body) attempt.current = { body, key: newWorkflowKey() };
    setPending(true); inFlight.current = true; onBusy(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const result = await complaintRequest<{ booking: Booking; replayed: boolean }>(`/api/bookings/${encodeURIComponent(booking.id)}/actions`, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key }, body });
      attempt.current = null; onSaved(result.booking, result.replayed);
    } catch (cause) {
      if (cause instanceof ComplaintRequestError && cause.status === 409) { setConflict(true); onConflict(); }
      setError(`${requestError(cause)}${!(cause instanceof ComplaintRequestError) || cause.status >= 500 ? " Retry the same cancellation to check whether it was saved." : ""}`);
    } finally { window.clearTimeout(timeout); setPending(false); inFlight.current = false; onBusy(false); }
  }
  return <form onSubmit={submit}>
    <h3 className="text-sm font-bold">Cancel this booking</h3><p className="mt-2 text-xs leading-6 text-slate-500">This releases the room for the whole reserved time. Cancelled bookings cannot be restored; make a new booking if needed.</p>
    {needsReview && <div role="alert" className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-xs leading-6 text-amber-900"><p>The booking changed. Review the latest details above before cancelling.</p><button type="button" disabled={pending || refreshing} onClick={() => { setVersion(booking.version); setConflict(false); setError(""); attempt.current = null; }} className="mt-2 font-semibold underline">{refreshing ? "Loading latest details..." : "I have reviewed the latest booking"}</button></div>}
    <div className="mt-4"><label htmlFor="booking-cancel-note" className={workLabel}>Cancellation reason</label><textarea id="booking-cancel-note" required minLength={5} maxLength={2000} rows={3} value={note} disabled={pending || refreshing || needsReview} onChange={(event) => setNote(event.target.value)} className={workInput} /></div>
    {error && <p role="alert" className="mt-4 text-xs leading-6 text-red-700">{error}</p>}
    <button type="submit" disabled={pending || refreshing || needsReview} className="mt-4 rounded bg-red-700 px-5 py-3 text-xs font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-500 disabled:opacity-50">{pending ? "Cancelling..." : "Confirm cancellation"}</button>
  </form>;
}
