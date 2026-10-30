"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { RoomRecoveryResult } from "@/lib/ai/types";
import type { Booking } from "@/lib/bookings/types";
import { complaintRequest, formatDate, readable, requestError } from "./complaint-shared";
import { fromIstInput, toIstInput } from "./booking-shared";
import { newWorkflowKey, workInput, workLabel } from "./work-order-shared";
import { AiButton, AiSource } from "./ai-shared";

type RoomOption = { id: string; name: string; capacity: number; availability: string; building: string };

function defaultSlot() {
  const start = new Date(Math.ceil((Date.now() + 10 * 60_000) / (15 * 60_000)) * 15 * 60_000);
  return { start: toIstInput(start.toISOString()), end: toIstInput(new Date(start.getTime() + 60 * 60_000).toISOString()) };
}

export function RoomRecovery({ rooms, initialRoomId }: { rooms: RoomOption[]; initialRoomId: string | null }) {
  const ordered = [...rooms].sort((a, b) => Number(a.availability === "AVAILABLE") - Number(b.availability === "AVAILABLE") || a.name.localeCompare(b.name));
  const first = ordered.find((room) => room.id === initialRoomId) ?? ordered[0];
  const [slot] = useState(defaultSlot);
  const [roomId, setRoomId] = useState(first?.id ?? "");
  const [startsAt, setStartsAt] = useState(slot.start);
  const [endsAt, setEndsAt] = useState(slot.end);
  const [attendees, setAttendees] = useState(String(Math.min(first?.capacity ?? 40, 40)));
  const [needsAccessible, setAccessible] = useState(false);
  const [needsProjector, setProjector] = useState(false);
  const [purpose, setPurpose] = useState("Regular class relocated because the scheduled room is out of service.");
  const [result, setResult] = useState<RoomRecoveryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [booking, setBooking] = useState<{ state: "idle" | "saving" | "done"; message: string; key: string }>({ state: "idle", message: "", key: "" });

  async function analyse(event?: FormEvent) {
    event?.preventDefault();
    setError(""); setResult(null); setBooking({ state: "idle", message: "", key: "" });
    let params: URLSearchParams;
    try {
      params = new URLSearchParams({ roomId, startsAt: fromIstInput(startsAt), endsAt: fromIstInput(endsAt), attendees: String(Number(attendees)),
        needsAccessible: String(needsAccessible), needsProjector: String(needsProjector), purpose });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the time slot."); return; }
    setLoading(true);
    try {
      const value = await complaintRequest<RoomRecoveryResult>(`/api/ai/room-recovery?${params}`);
      setResult(value); setChosen(value.recommendation.selectedId);
    } catch (cause) { setError(requestError(cause)); }
    finally { setLoading(false); }
  }

  async function reserve() {
    if (!result || !chosen) return;
    const key = booking.key || newWorkflowKey();
    setBooking({ state: "saving", message: "", key });
    try {
      const saved = await complaintRequest<{ booking: Booking }>("/api/bookings", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ title: `Relocated from ${result.source.name}`.slice(0, 120), purpose: purpose.trim(), roomId: chosen,
          startsAt: fromIstInput(startsAt), endsAt: fromIstInput(endsAt), attendees: Number(attendees), needsAccessible, needsProjector }),
      });
      setBooking({ state: "done", message: `Reserved ${saved.booking.room.name} (${saved.booking.id}).`, key: "" });
    } catch (cause) { setBooking({ state: "idle", message: requestError(cause), key }); }
  }

  const room = (id: string | null) => result?.rooms.find((item) => item.id === id);
  const recommended = room(result?.recommendation.selectedId ?? null);

  return <div className="space-y-5">
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-bold">When a room becomes unavailable</h2>
      <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500">Pick the room that is out of service and the class or event that needs a new home. Rules check capacity, access, equipment and clashes; Claude then picks the best fit and explains why. You confirm before anything is booked.</p>
      <form onSubmit={analyse} className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="md:col-span-2 xl:col-span-1">
          <label htmlFor="recovery-room" className={workLabel}>Room out of service</label>
          <select id="recovery-room" value={roomId} onChange={(event) => setRoomId(event.target.value)} className={workInput}>
            {ordered.map((item) => <option key={item.id} value={item.id}>{item.name} · {readable(item.availability)}</option>)}
          </select>
        </div>
        <div><label htmlFor="recovery-start" className={workLabel}>From (IST)</label><input id="recovery-start" type="datetime-local" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className={workInput} /></div>
        <div><label htmlFor="recovery-end" className={workLabel}>Until (IST)</label><input id="recovery-end" type="datetime-local" required value={endsAt} onChange={(event) => setEndsAt(event.target.value)} className={workInput} /></div>
        <div><label htmlFor="recovery-size" className={workLabel}>People to move</label><input id="recovery-size" type="number" min={1} max={10000} required value={attendees} onChange={(event) => setAttendees(event.target.value)} className={workInput} /></div>
        <div className="flex flex-col justify-end gap-2 text-xs">
          <label className="flex items-center gap-2"><input type="checkbox" checked={needsAccessible} onChange={(event) => setAccessible(event.target.checked)} className="accent-amber-600" />Accessible room required</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={needsProjector} onChange={(event) => setProjector(event.target.checked)} className="accent-amber-600" />Projector required</label>
        </div>
        <div className="md:col-span-2 xl:col-span-3"><label htmlFor="recovery-purpose" className={workLabel}>What is happening there?</label><input id="recovery-purpose" minLength={10} maxLength={500} required value={purpose} onChange={(event) => setPurpose(event.target.value)} className={workInput} placeholder="e.g. Semester exam for 45 students, needs quiet and spacing" /></div>
        <div className="md:col-span-2 xl:col-span-3"><AiButton busy={loading} onClick={() => void analyse()}>{loading ? "Checking rooms and asking Claude..." : "Recommend a replacement room"}</AiButton></div>
      </form>
      {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
    </section>

    {result && <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="rounded-lg border border-violet-200 bg-white p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-violet-800">✦ Recommendation</p>
        {recommended ? <>
          <h3 className="mt-2 text-xl font-bold">{recommended.name}</h3>
          <p className="mt-1 text-xs text-slate-500">{recommended.building.name} · {recommended.capacity} seats · {recommended.accessible ? "Accessible" : "No accessibility recorded"} · {recommended.hasProjector ? "Projector" : "No projector"}</p>
        </> : <h3 className="mt-2 text-lg font-bold text-red-800">No suitable room for this slot</h3>}
        <p className="mt-3 text-sm leading-7">{result.recommendation.reason}</p>
        {result.recommendation.tips.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-600">{result.recommendation.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul>}
        <AiSource value={result.recommendation} />

        <h4 className="mt-6 text-xs font-bold">All rooms checked</h4>
        <ul className="mt-3 space-y-2">
          {result.rooms.map((item) => {
            const rank = result.recommendation.ranking.find((entry) => entry.id === item.id);
            return <li key={item.id}>
              <label className={`flex items-start gap-3 rounded border p-3 text-xs ${!item.eligible ? "border-slate-200 bg-slate-50 text-slate-500" : chosen === item.id ? "border-violet-400 bg-violet-50/60" : "cursor-pointer border-slate-300"}`}>
                <input type="radio" name="recovery-choice" disabled={!item.eligible} checked={chosen === item.id} onChange={() => setChosen(item.id)} className="mt-0.5 accent-violet-700" />
                <span className="min-w-0">
                  <span className="font-semibold">{item.name}</span>{item.id === result.recommendation.selectedId && <span className="ml-2 rounded bg-violet-700 px-1.5 py-0.5 text-[9px] font-bold text-white">AI PICK</span>}
                  <span className="block text-[11px] text-slate-500">{item.building.name} · {item.capacity} seats</span>
                  {item.eligible ? <span className="block text-[11px] text-emerald-800">{rank?.note ?? "Passes all checks"}</span> : <span className="block text-[11px] text-amber-900">{item.reasons.join(" ")}</span>}
                </span>
              </label>
            </li>;
          })}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" disabled={!chosen || booking.state !== "idle"} onClick={reserve} className="rounded bg-[#142943] px-5 py-3 text-xs font-semibold text-white disabled:opacity-50">
            {booking.state === "saving" ? "Reserving..." : booking.state === "done" ? "Reserved" : `Reserve ${room(chosen)?.name ?? "room"} for this slot`}
          </button>
          {booking.message && <p role="status" className={`text-xs ${booking.state === "done" ? "text-emerald-800" : "text-red-700"}`}>{booking.message}</p>}
        </div>
        <p className="mt-2 text-[10px] text-slate-400">The booking service re-checks availability before saving.</p>
      </section>

      <aside className="space-y-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">Out of service</p>
          <h3 className="mt-2 text-sm font-bold">{result.source.name}</h3>
          <p className="mt-1 text-[11px] text-slate-500">{result.source.building.name} · {result.source.capacity} seats · {readable(result.source.availability)}</p>
          <h4 className="mt-4 text-[11px] font-bold">Open incidents here</h4>
          {result.incidents.length ? <ul className="mt-2 space-y-1">{result.incidents.map((item) => <li key={item.id} className="text-[11px]"><Link href={`/work-orders?incident=${encodeURIComponent(item.id)}`} prefetch={false} className="font-mono font-semibold text-amber-800 underline">{item.id}</Link> {item.title}</li>)}</ul> : <p className="mt-1 text-[11px] text-slate-500">None recorded.</p>}
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="text-[11px] font-bold">Upcoming bookings in this room</h4>
          {result.affectedBookings.length ? <ul className="mt-2 space-y-3">{result.affectedBookings.map((item) => <li key={item.id} className="rounded border border-slate-200 p-3 text-[11px] leading-5">
            <p className="font-semibold">{item.title}</p><p className="text-slate-500">{formatDate(item.startsAt)} · {item.attendees} people</p>
            <Link href={`/bookings?booking=${encodeURIComponent(item.id)}`} prefetch={false} className="font-semibold text-violet-800 underline">Relocate with AI →</Link>
          </li>)}</ul> : <p className="mt-1 text-[11px] text-slate-500">No confirmed bookings are affected.</p>}
        </section>
      </aside>
    </div>}
  </div>;
}
