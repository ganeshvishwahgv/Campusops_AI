"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Booking, RoomCandidate } from "@/lib/bookings/types";
import { complaintRequest, ComplaintRequestError, readable, requestError } from "./complaint-shared";
import { newWorkflowKey, workButton, workInput, workLabel } from "./work-order-shared";
import { bookingSubmit, fromIstInput, toIstInput } from "./booking-shared";
import type { RoomAdvice } from "@/lib/ai/types";
import { AiButton, AiSource } from "./ai-shared";

export function BookingForm({ booking, refreshing = false, onBusy, onSaved, onConflict }: {
  booking?: Booking; refreshing?: boolean; onBusy: (busy: boolean) => void;
  onSaved: (booking: Booking, replayed: boolean) => void; onConflict?: () => void;
}) {
  const [title, setTitle] = useState(booking?.title ?? "");
  const [purpose, setPurpose] = useState(booking?.purpose ?? "");
  const [startsAt, setStartsAt] = useState(booking ? toIstInput(booking.startsAt) : "");
  const [endsAt, setEndsAt] = useState(booking ? toIstInput(booking.endsAt) : "");
  const [attendees, setAttendees] = useState(String(booking?.attendees ?? ""));
  const [needsAccessible, setAccessible] = useState(booking?.needsAccessible ?? false);
  const [needsProjector, setProjector] = useState(booking?.needsProjector ?? false);
  const [roomId, setRoomId] = useState(booking?.room.id ?? "");
  const [note, setNote] = useState("");
  const [version, setVersion] = useState(booking?.version ?? 0);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [rooms, setRooms] = useState<RoomCandidate[] | null>(null);
  const [checkedKey, setCheckedKey] = useState("");
  const [advice, setAdvice] = useState<{ key: string; value: RoomAdvice["recommendation"] } | null>(null);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const criteriaKey = JSON.stringify({ startsAt, endsAt, attendees, needsAccessible, needsProjector, version });
  const roomsCurrent = checkedKey === criteriaKey;
  const reviewRequired = Boolean(booking && (conflict || version !== booking.version));

  function criteria() {
    const start = fromIstInput(startsAt);
    const end = fromIstInput(endsAt);
    const size = Number(attendees);
    if (!Number.isInteger(size) || size < 1 || size > 10000) throw new Error("Enter an attendance from 1 to 10,000.");
    if (end <= start) throw new Error("The end time must be after the start time.");
    if (Date.parse(start) < Date.now()) throw new Error("Choose a start time in the future.");
    if (Date.parse(end) - Date.parse(start) > 7 * 86_400_000) throw new Error("A booking can last up to seven days.");
    if (Date.parse(start) - Date.now() > 365 * 86_400_000) throw new Error("Choose a start time within the next year.");
    return { startsAt: start, endsAt: end, attendees: size, needsAccessible, needsProjector };
  }

  async function checkRooms() {
    if (checking || pending || uncertain || reviewRequired || refreshing) return;
    setError("");
    let values;
    try { values = criteria(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the booking dates and attendance."); return; }
    setChecking(true); onBusy(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const params = new URLSearchParams({ startsAt: values.startsAt, endsAt: values.endsAt, attendees: String(values.attendees), needsAccessible: String(needsAccessible), needsProjector: String(needsProjector), ...(booking ? { excludeBookingId: booking.id } : {}) });
      const result = await complaintRequest<{ rooms: RoomCandidate[] }>(`/api/bookings/availability?${params}`, { signal: controller.signal });
      setRooms(result.rooms); setCheckedKey(criteriaKey);
    } catch (cause) { setError(requestError(cause)); setCheckedKey(""); }
    finally { window.clearTimeout(timeout); setChecking(false); onBusy(false); }
  }

  // Same deterministic availability check, plus Claude's pick among the eligible rooms.
  async function askAi() {
    if (checking || pending || uncertain || reviewRequired || refreshing) return;
    setError("");
    let values;
    try { values = criteria(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the booking dates and attendance."); return; }
    setChecking(true); onBusy(true);
    try {
      const params = new URLSearchParams({ startsAt: values.startsAt, endsAt: values.endsAt, attendees: String(values.attendees), needsAccessible: String(needsAccessible), needsProjector: String(needsProjector), purpose: `${title}. ${purpose}`.slice(0, 500), ...(booking ? { excludeBookingId: booking.id } : {}) });
      const result = await complaintRequest<RoomAdvice>(`/api/ai/rooms?${params}`);
      setRooms(result.rooms); setCheckedKey(criteriaKey); setAdvice({ key: criteriaKey, value: result.recommendation });
      if (result.recommendation.selectedId) setRoomId(result.recommendation.selectedId);
    } catch (cause) { setError(requestError(cause)); setCheckedKey(""); }
    finally { setChecking(false); onBusy(false); }
  }

  function reviewLatest() {
    if (!booking) return;
    setTitle(booking.title); setPurpose(booking.purpose);
    setStartsAt(toIstInput(booking.startsAt)); setEndsAt(toIstInput(booking.endsAt)); setAttendees(String(booking.attendees));
    setAccessible(booking.needsAccessible); setProjector(booking.needsProjector); setRoomId(booking.room.id);
    setVersion(booking.version); setConflict(false); setError(""); setCheckedKey(""); attempt.current = null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || uncertain || checking || refreshing || reviewRequired) return;
    setError("");
    let values;
    try { values = criteria(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the booking dates and attendance."); return; }
    if (!roomsCurrent || !rooms?.some((room) => room.id === roomId && room.eligible)) { setError("Check availability and select a suitable room before saving."); return; }
    if (title.trim().length < 3 || purpose.trim().length < 10) { setError("Add a title of at least 3 characters and a purpose of at least 10 characters."); return; }
    if (booking && note.trim().length < 5) { setError("Explain the change in at least 5 characters."); return; }
    const body = JSON.stringify({ title: title.trim(), purpose: purpose.trim(), roomId, ...values, ...(booking ? { action: "UPDATE", expectedVersion: version, note: note.trim() } : {}) });
    if (attempt.current?.body !== body) attempt.current = { body, key: newWorkflowKey() };
    await sendAttempt();
  }

  // An uncertain save must reuse its original payload even if time has passed
  // or the committed booking now makes its own room appear unavailable.
  async function sendAttempt() {
    if (inFlight.current || !attempt.current) return;
    const savedAttempt = attempt.current;
    setError("");
    inFlight.current = true; setPending(true); onBusy(true);
    let stillUncertain = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const path = booking ? `/api/bookings/${encodeURIComponent(booking.id)}/actions` : "/api/bookings";
      const result = await complaintRequest<{ booking: Booking; replayed: boolean }>(path, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", "Idempotency-Key": savedAttempt.key }, body: savedAttempt.body });
      attempt.current = null; setUncertain(false); setVersion(result.booking.version); setConflict(false); setNote("");
      onSaved(result.booking, result.replayed);
    } catch (cause) {
      stillUncertain = !(cause instanceof ComplaintRequestError) || cause.status >= 500;
      setUncertain(stillUncertain);
      if (!stillUncertain) attempt.current = null;
      if (cause instanceof ComplaintRequestError && cause.status === 409) {
        setCheckedKey("");
        if (booking) { setConflict(true); onConflict?.(); }
        setError(`${cause.message} ${booking ? "Review the latest booking and check room availability again." : "Check room availability again before choosing a room."}`);
      } else {
        const fields = cause instanceof ComplaintRequestError ? Object.values(cause.fields).join(" ") : "";
        setError(`${requestError(cause)} ${fields}${!(cause instanceof ComplaintRequestError) || cause.status >= 500 ? " Your details are still here. Retry the same booking to check whether it was saved." : ""}`);
      }
    } finally { window.clearTimeout(timeout); inFlight.current = false; setPending(false); onBusy(stillUncertain); }
  }

  return <form onSubmit={submit} className="space-y-5">
    <div><h2 className="text-lg font-bold">{booking ? "Edit or reschedule" : "Plan a campus activity"}</h2><p className="mt-2 text-xs leading-6 text-slate-500">Choose a time and your requirements, then compare available rooms. The room is reserved only after you save.</p></div>
    {reviewRequired && <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-4 text-xs leading-6 text-amber-900"><p>This booking or its availability changed. Review the saved details before editing again. Your change note is kept.</p><button type="button" disabled={refreshing || pending} onClick={reviewLatest} className="mt-2 font-semibold underline underline-offset-4">{refreshing ? "Loading latest details..." : "Load latest booking details"}</button></div>}
    <fieldset disabled={pending || uncertain || checking || reviewRequired || refreshing} className="space-y-5">
      <div><label htmlFor="booking-title" className={workLabel}>Activity title</label><input id="booking-title" required minLength={3} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} className={workInput} placeholder="For example, first-year orientation" /></div>
      <div><label htmlFor="booking-purpose" className={workLabel}>Purpose and arrangements</label><textarea id="booking-purpose" required minLength={10} maxLength={2000} rows={3} value={purpose} onChange={(event) => setPurpose(event.target.value)} className={workInput} placeholder="Describe the activity and how the room will be used." /><p className="mt-1 text-[11px] text-slate-500">Visible to you and operations administrators.</p></div>
      <div className="rounded border border-slate-200 bg-[#fafaf8] p-4"><p className="mb-4 text-xs leading-6 text-slate-600">All dates and times below are India Standard Time (IST, UTC+05:30).</p><div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="booking-start" className={workLabel}>Starts at (IST)</label><input id="booking-start" type="datetime-local" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className={workInput} /></div><div><label htmlFor="booking-end" className={workLabel}>Ends at (IST)</label><input id="booking-end" type="datetime-local" required value={endsAt} onChange={(event) => setEndsAt(event.target.value)} className={workInput} /></div></div><p className="mt-3 text-[11px] leading-5 text-slate-500">Book within the next year, for up to seven days. Back-to-back bookings are allowed.</p></div>
      <div><label htmlFor="booking-attendees" className={workLabel}>Number of attendees</label><input id="booking-attendees" type="number" required min={1} max={10000} step={1} value={attendees} onChange={(event) => setAttendees(event.target.value)} className={workInput} /></div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="flex items-center gap-3 rounded border border-slate-200 p-3 text-xs"><input type="checkbox" checked={needsAccessible} onChange={(event) => setAccessible(event.target.checked)} className="accent-amber-600" />Accessible room required</label><label className="flex items-center gap-3 rounded border border-slate-200 p-3 text-xs"><input type="checkbox" checked={needsProjector} onChange={(event) => setProjector(event.target.checked)} className="accent-amber-600" />Projector required</label></div>
      <section aria-label="Available rooms" className="border-t border-slate-200 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-bold">Choose a room</h3><div className="flex flex-wrap gap-2"><button type="button" onClick={checkRooms} className={workButton}>{rooms ? "Recheck availability" : "Find suitable rooms"}</button><AiButton onClick={askAi}>Let AI pick the best room</AiButton></div></div>
        {advice && advice.key === criteriaKey && <div className="mt-3 rounded border border-violet-200 bg-violet-50/50 p-3 text-xs leading-6"><p><span className="font-semibold text-violet-900">✦ AI recommendation:</span> {advice.value.reason}</p>{advice.value.tips.length > 0 && <ul className="mt-1 list-disc pl-5 text-[11px] text-slate-600">{advice.value.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul>}<AiSource value={advice.value} /></div>}
        <p className="mt-2 text-xs leading-6 text-slate-500">Capacity, access, saved room readiness, and overlapping bookings are checked. Projector requests also require listed equipment to be available.</p>
        {rooms && !roomsCurrent && <p className="mt-3 text-xs leading-6 text-amber-800">The time or requirements changed. Recheck availability before saving.</p>}
        {!rooms ? <p className="mt-4 rounded border border-dashed border-slate-300 p-5 text-xs leading-6 text-slate-500">Enter your dates and attendance, then find suitable rooms. Your current room {booking ? `is ${booking.room.name}.` : "will appear here once selected."}</p> : <div className="mt-4 space-y-3">{rooms.map((room) => <label key={room.id} className={`flex items-start gap-3 rounded border p-4 ${!room.eligible || !roomsCurrent ? "border-slate-200 bg-slate-50" : room.id === roomId ? "border-amber-500 bg-amber-50/50 ring-1 ring-amber-200" : "cursor-pointer border-slate-300 bg-white"}`}>
          <input type="radio" name="booking-room" checked={roomId === room.id} value={room.id} disabled={!room.eligible || !roomsCurrent} onChange={() => setRoomId(room.id)} className="mt-1 accent-amber-600" />
          <span className="min-w-0"><span className="block break-words text-xs font-bold">{room.name}{advice?.key === criteriaKey && advice.value.selectedId === room.id && <span className="ml-2 rounded bg-violet-700 px-1.5 py-0.5 text-[9px] font-bold text-white">AI PICK</span>}</span><span className="mt-1 block text-[11px] leading-5 text-slate-500">{room.building.name} · {room.capacity} seats · {readable(room.availability)}</span><span className="block text-[11px] leading-5 text-slate-500">{room.accessible ? "Accessible" : "No accessibility provision recorded"} · {room.hasProjector ? "Projector listed" : "No projector listed"}</span>{room.reasons.length ? <span className="mt-2 block text-[11px] leading-5 text-amber-900">{room.reasons.join(" ")}</span> : <span className="mt-2 block text-[11px] font-semibold text-emerald-800">{roomsCurrent ? "Suitable for this booking" : "Availability needs rechecking"}</span>}</span>
        </label>)}{!rooms.some((room) => room.eligible) && <p className="text-xs leading-6 text-amber-900">No room meets these requirements at this time. Choose another time or revise the activity; a smaller room cannot hold extra attendees.</p>}</div>}
      </section>
      {booking && <div><label htmlFor="booking-note" className={workLabel}>Reason for the change</label><textarea id="booking-note" required minLength={5} maxLength={2000} rows={3} value={note} onChange={(event) => setNote(event.target.value)} className={workInput} /><p className="mt-1 text-[11px] text-slate-500">Saved in the booking history.</p></div>}
    </fieldset>
    {checking && <p role="status" className="text-xs text-slate-500">Checking rooms and schedule conflicts...</p>}
    {error && <p role="alert" className="text-xs leading-6 text-red-700">{error}</p>}
    {uncertain && <div role="status" className="rounded border border-amber-300 bg-amber-50 p-4 text-xs leading-6 text-amber-900"><p>The save result has not been confirmed. Check the same request before changing these details.</p><button type="button" disabled={pending} onClick={() => void sendAttempt()} className={`${workButton} mt-3`}>{pending ? "Checking save..." : "Retry / check this save"}</button></div>}
    {!uncertain && <button type="submit" disabled={pending || checking || refreshing || reviewRequired || !roomsCurrent || !roomId || !rooms?.some((room) => room.id === roomId && room.eligible)} className={bookingSubmit}>{pending ? "Saving booking..." : booking ? "Save booking changes" : "Confirm booking"}</button>}
    <p className="text-[11px] leading-5 text-slate-500">Room readiness comes from saved campus records. Confirm any additional equipment or arrangements with operations.</p>
  </form>;
}
