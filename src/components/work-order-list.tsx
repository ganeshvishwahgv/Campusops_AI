"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { WorkOrder } from "@/lib/workflow/types";
import { statusOptions } from "@/lib/complaints/types";
import { complaintRequest, ComplaintStatus, formatDate, readable, requestError } from "./complaint-shared";
import { workButton, workInput, WorkPriority } from "./work-order-shared";

type Queue = { items: WorkOrder[]; page: number; pageSize: number; total: number; totalPages: number };

export function WorkOrderList({ revision, selectedId, technician, busy, onSelect }: {
  revision: number; selectedId: string | null; technician: boolean; busy: boolean; onSelect: (id: string) => void;
}) {
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(page), status, q: query });
        const result = await complaintRequest<Queue>(`/api/work-orders?${params}`, { signal: controller.signal });
        if (!controller.signal.aborted) {
          if (result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages);
          else setQueue(result);
        }
      } catch (cause) {
        if (!controller.signal.aborted) { setError(requestError(cause)); setQueue(null); }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [page, status, query, revision, retry]);

  function searchQueue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPage(1); setQuery(search.trim()); setRetry((value) => value + 1);
  }

  return (
    <section aria-label={technician ? "My assigned work" : "Operations queue"} className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-bold">{technician ? "My assigned work" : "Operations queue"}</h2><span className="text-xs text-slate-500">{queue ? `${queue.total} work order${queue.total === 1 ? "" : "s"}` : "Loading queue"}</span></div>
        <p className="mt-2 text-xs leading-6 text-slate-500">Highest priority first, then oldest reported. {technician ? "Only work assigned to you appears here." : "Review new complaints, assign work, and verify resolutions."}</p>
        <form onSubmit={searchQueue} className="mt-4 flex gap-2">
          <label htmlFor="work-search" className="sr-only">Search work orders</label>
          <input id="work-search" type="search" maxLength={100} value={search} disabled={busy} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, reference, or location" className={workInput} />
          <button type="submit" disabled={busy} className={workButton}>Search</button>
        </form>
        <label htmlFor="work-status" className="mt-4 mb-2 block text-xs font-semibold">Status</label>
        <select id="work-status" value={status} disabled={busy} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className={workInput}>
          {statusOptions.filter((item) => !technician || ["ALL", "ASSIGNED", "IN_PROGRESS", "BLOCKED", "RESOLVED", "CLOSED"].includes(item.value)).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>
      {error ? <div role="alert" className="p-6 text-sm leading-7 text-red-700">{error}<button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 block text-xs font-semibold underline">Retry queue</button></div>
        : loading ? <p role="status" className="p-8 text-center text-sm text-slate-500">Loading work orders...</p>
        : !queue?.items.length ? <div className="p-8 text-center"><h3 className="text-sm font-semibold">No work orders found</h3><p className="mt-2 text-xs leading-6 text-slate-500">{query || status !== "ALL" ? "Try another search or status." : technician ? "Your assigned jobs will appear here when operations assigns work to you." : "New campus complaints will appear here for review."}</p></div>
        : <ul className="divide-y divide-slate-100">{queue.items.map((item) => <li key={item.id}>
          <button type="button" disabled={busy} onClick={() => onSelect(item.id)} aria-pressed={selectedId === item.id} className={`w-full border-l-4 px-5 py-5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-amber-500 disabled:opacity-60 ${selectedId === item.id ? "border-amber-400 bg-amber-50/50" : "border-transparent hover:bg-slate-50"}`}>
            <div className="flex flex-wrap gap-2"><WorkPriority value={item.priority} /><ComplaintStatus value={item.status} /></div>
            <h3 className="mt-3 break-words text-sm font-bold leading-6">{item.title}</h3>
            <p className="mt-2 break-words text-xs leading-5 text-slate-500">{item.locationText ?? item.building?.name ?? "Location not specified"} · {readable(item.category)}</p>
            <p className="mt-2 text-xs text-slate-600">{item.assignee?.name ?? "Unassigned"}</p>
            <div className="mt-3 flex flex-wrap justify-between gap-2 text-[10px] text-slate-400"><span className="break-all font-mono">{item.id}</span><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></div>
          </button>
        </li>)}</ul>}
      {queue && queue.totalPages > 1 && !loading && <div className="flex items-center justify-between gap-3 border-t border-slate-200 p-4">
        <button type="button" disabled={page <= 1 || busy} onClick={() => setPage((value) => value - 1)} className={workButton}>Previous</button>
        <span className="text-xs text-slate-500">Page {page} of {queue.totalPages}</span>
        <button type="button" disabled={page >= queue.totalPages || busy} onClick={() => setPage((value) => value + 1)} className={workButton}>Next</button>
      </div>}
    </section>
  );
}
