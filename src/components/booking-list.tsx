"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { BookingList as List } from "@/lib/bookings/types";
import { complaintRequest, formatDate, requestError } from "./complaint-shared";
import { workButton, workInput, workLabel } from "./work-order-shared";
import { BookingStatus } from "./booking-shared";

export function BookingList({ revision, selectedId, admin, busy, onSelect, onNew }: {
  revision: number; selectedId: string | null; admin: boolean; busy: boolean;
  onSelect: (id: string) => void; onNew: () => void;
}) {
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<List | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const params = new URLSearchParams({ page: String(page), status, q: query });
        const result = await complaintRequest<List>(`/api/bookings?${params}`, { signal: controller.signal });
        if (!controller.signal.aborted) {
          if (page > result.totalPages) setPage(result.totalPages);
          else setList(result);
        }
      } catch (cause) { if (!controller.signal.aborted) { setError(requestError(cause)); setList(null); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [revision, page, status, query, retry]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPage(1); setQuery(search.trim()); setRetry((value) => value + 1);
  }

  return <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Booking schedule">
    <div className="border-b border-slate-200 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-bold">{admin ? "Campus bookings" : "My bookings"}</h2><span className="text-xs text-slate-500">{list ? `${list.total} booking${list.total === 1 ? "" : "s"}` : "Loading schedule"}</span></div>
      <p className="mt-2 text-xs leading-6 text-slate-500">Latest start time first. {admin ? "You can manage all campus room bookings." : "Only activities booked by your account appear here."}</p>
      <form onSubmit={submitSearch} className="mt-4 flex gap-2"><label htmlFor="booking-search" className="sr-only">Search bookings</label><input id="booking-search" type="search" maxLength={100} disabled={busy} value={search} onChange={(event) => setSearch(event.target.value)} className={workInput} placeholder="Search activity or room" /><button type="submit" disabled={busy} className={workButton}>Search</button></form>
      <div className="mt-4"><label htmlFor="booking-status" className={workLabel}>Status</label><select id="booking-status" value={status} disabled={busy} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className={workInput}><option value="ALL">All bookings</option><option value="CONFIRMED">Confirmed</option><option value="CANCELLED">Cancelled</option></select></div>
    </div>
    {error ? <div role="alert" className="p-6 text-xs leading-6 text-red-700">{error}<button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 block font-semibold underline">Retry schedule</button></div>
      : loading ? <p role="status" className="p-8 text-center text-sm text-slate-500">Loading bookings...</p>
      : !list?.items.length ? <div className="p-8 text-center"><h3 className="text-sm font-semibold">No bookings found</h3><p className="mt-3 text-xs leading-6 text-slate-500">{query || status !== "ALL" ? "Try a different search or status." : "Reserve a room for your next campus activity."}</p><button type="button" disabled={busy} onClick={onNew} className={`${workButton} mt-4`}>New booking</button></div>
      : <ul className="divide-y divide-slate-100">{list.items.map((booking) => <li key={booking.id}><button type="button" disabled={busy} onClick={() => onSelect(booking.id)} aria-pressed={selectedId === booking.id} className={`w-full border-l-4 p-5 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-amber-500 disabled:opacity-60 ${booking.id === selectedId ? "border-amber-400 bg-amber-50/50" : "border-transparent hover:bg-slate-50"}`}>
        <BookingStatus status={booking.status} /><h3 className="mt-3 break-words text-sm font-bold leading-6">{booking.title}</h3><p className="mt-2 break-words text-xs leading-6 text-slate-600">{booking.room.name}</p><p className="mt-2 text-[11px] leading-6 text-slate-500"><time dateTime={booking.startsAt}>{formatDate(booking.startsAt)}</time><br />to <time dateTime={booking.endsAt}>{formatDate(booking.endsAt)}</time></p><div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500"><span>{booking.attendees} attendees</span>{admin && <span>{booking.owner.name}</span>}</div>
      </button></li>)}</ul>}
    {list && list.totalPages > 1 && !loading && <div className="flex items-center justify-between gap-3 border-t border-slate-200 p-4"><button type="button" disabled={busy || page <= 1} onClick={() => setPage((value) => value - 1)} className={workButton}>Previous</button><span className="text-xs text-slate-500">Page {page} of {list.totalPages}</span><button type="button" disabled={busy || page >= list.totalPages} onClick={() => setPage((value) => value + 1)} className={workButton}>Next</button></div>}
  </section>;
}
