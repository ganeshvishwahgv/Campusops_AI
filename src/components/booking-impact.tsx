"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { BookingImpact as Impact } from "@/lib/bookings/types";
import { complaintRequest, formatDate, requestError } from "./complaint-shared";
import { workButton, workInput, workLabel } from "./work-order-shared";

export function BookingImpact({ initialIncident, revision, busy, onSelect }: {
  initialIncident: string | null; revision: number; busy: boolean; onSelect: (id: string) => void;
}) {
  const [input, setInput] = useState(initialIncident ?? "");
  const [incidentId, setIncidentId] = useState(initialIncident ?? "");
  const [impact, setImpact] = useState<Impact | null>(null);
  const [loading, setLoading] = useState(Boolean(initialIncident));
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!incidentId) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError(""); setImpact(null);
      try {
        const result = await complaintRequest<Impact>(`/api/bookings/impact?${new URLSearchParams({ incidentId })}`, { signal: controller.signal });
        if (!controller.signal.aborted) setImpact(result);
      } catch (cause) { if (!controller.signal.aborted) setError(requestError(cause)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [incidentId, retry, revision]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setIncidentId(input.trim()); setRetry((value) => value + 1);
  }

  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-label="Affected activities">
    <h2 className="text-xl font-bold">Check affected activities</h2><p className="mt-3 max-w-3xl text-sm leading-7 text-slate-500">Find confirmed bookings that are underway or upcoming in an incident’s room. If the incident names only a building, this checks every room in that building.</p>
    <form onSubmit={submit} className="mt-6 max-w-xl"><label htmlFor="impact-incident" className={workLabel}>Complaint / work-order reference</label><div className="flex gap-2"><input id="impact-incident" required maxLength={100} disabled={busy} value={input} onChange={(event) => setInput(event.target.value)} placeholder="For example, INC-004" className={workInput} /><button type="submit" disabled={busy || !input.trim()} className={workButton}>Check</button></div></form>
    {loading && <p role="status" className="mt-6 text-sm text-slate-500">Checking affected bookings...</p>}
    {error && <div role="alert" className="mt-6 text-xs leading-6 text-red-700">{error}<button type="button" onClick={() => setRetry((value) => value + 1)} className="ml-3 font-semibold underline">Retry</button></div>}
    {impact && <div className="mt-7 border-t border-slate-200 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-base font-bold">{impact.incident.title}</h3><p className="mt-2 text-xs text-slate-500">{impact.total} potentially affected booking{impact.total === 1 ? "" : "s"}</p></div><Link href={`/work-orders?incident=${encodeURIComponent(impact.incident.id)}`} prefetch={false} className="text-xs font-semibold text-amber-800 underline underline-offset-4">View work order</Link></div>
      <p className="mt-3 text-xs leading-6 text-slate-500">Location matches help operations review possible disruption. They do not prove an activity is unsafe or recovered. Bookings are not moved automatically.</p>
      {!impact.items.length ? <p className="mt-5 rounded border border-slate-200 bg-[#fafaf8] p-5 text-sm leading-7 text-slate-600">{!impact.incident.roomId && !impact.incident.buildingId ? "This incident has no saved room or building, so no room bookings can be matched." : "No active or upcoming confirmed bookings match this location."}</p> : <ul className="mt-5 grid gap-4 md:grid-cols-2">{impact.items.map((booking) => <li key={booking.id} className="rounded-lg border border-slate-200 p-5"><h4 className="break-words text-sm font-bold">{booking.title}</h4><p className="mt-2 text-xs leading-6 text-slate-600">{booking.room.name} · {booking.attendees} attendees</p><p className="mt-2 text-[11px] leading-6 text-slate-500">{formatDate(booking.startsAt)}<br />to {formatDate(booking.endsAt)}</p><p className="mt-2 text-xs text-slate-500">Booked by {booking.owner.name}</p><button type="button" disabled={busy} onClick={() => onSelect(booking.id)} className={`${workButton} mt-4`}>Review / reschedule</button></li>)}</ul>}
      {impact.truncated && <p className="mt-4 text-xs leading-6 text-amber-800">Showing 100 matching bookings. Use the campus schedule to review the remaining activities.</p>}
    </div>}
  </section>;
}
