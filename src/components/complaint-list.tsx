"use client";

import { useEffect, useState, type FormEvent } from "react";
import { statusOptions, type Complaint } from "@/lib/complaints/types";
import { ComplaintStatus, complaintRequest, ComplaintRequestError, formatDate, requestError } from "./complaint-shared";

type ComplaintListData = { items: Complaint[]; page: number; pageSize: number; total: number; totalPages: number };

export function ComplaintList({ revision, selectedId, onSelect, onNew }: {
  revision: number;
  selectedId: string | null;
  onSelect: (complaint: Complaint) => void;
  onNew: () => void;
}) {
  const [list, setList] = useState<ComplaintListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function loadList() {
      setLoading(true);
      setError("");
      try {
        const parameters = new URLSearchParams({ page: String(page), status, q: query });
        const result = await complaintRequest<ComplaintListData>(`/api/complaints?${parameters}`, { signal: controller.signal });
        if (!controller.signal.aborted) setList(result);
      } catch (cause) {
        if (!controller.signal.aborted) {
          if (cause instanceof ComplaintRequestError && [401, 403].includes(cause.status)) setList(null);
          setError(requestError(cause));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadList();
    return () => controller.abort();
  }, [page, status, query, revision, retry]);

  function searchRequests(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setQuery(search.trim());
    setRetry((value) => value + 1);
  }

  function clearFilters() {
    setSearch("");
    setQuery("");
    setStatus("ALL");
    setPage(1);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-busy={loading}>
      <div className="space-y-4 border-b border-slate-200 p-5">
        <form onSubmit={searchRequests} className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="complaint-search" className="sr-only">Search your complaints</label>
            <input id="complaint-search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} placeholder="Search your complaints..." className="w-full rounded border border-slate-300 bg-[#fafaf8] px-3 py-2.5 text-xs outline-none focus:border-amber-500" />
          </div>
          <button type="submit" className="rounded bg-[#142943] px-4 py-2 text-xs font-semibold text-white hover:bg-[#213e61]">Search</button>
        </form>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="complaint-status-filter" className="text-xs font-semibold">Status</label>
          <select id="complaint-status-filter" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="rounded border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-amber-500">
            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <p className="ml-auto text-[10px] text-slate-500" aria-live="polite">{loading ? "Loading requests..." : list ? `${list.total} matching ${list.total === 1 ? "request" : "requests"}` : ""}</p>
        </div>
      </div>
      {error && <div role="alert" className="border-b border-red-200 bg-red-50 p-4 text-xs leading-6 text-red-800">{error} <button type="button" onClick={() => setRetry((value) => value + 1)} className="font-semibold underline">Retry</button></div>}
      <div className="divide-y divide-slate-100">
        {list?.items.map((complaint) => <button key={complaint.id} type="button" onClick={() => onSelect(complaint)} aria-pressed={selectedId === complaint.id} className={`block w-full border-l-[3px] p-5 text-left transition focus-visible:outline-2 focus-visible:outline-amber-500 ${selectedId === complaint.id ? "border-amber-400 bg-amber-50/40" : "border-transparent hover:bg-slate-50"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3"><span className="break-all font-mono text-[9px] text-slate-500">{complaint.id}</span><ComplaintStatus value={complaint.status} /></div>
          <h3 className="mt-3 break-words text-sm font-semibold leading-6">{complaint.title}</h3>
          <p className="mt-1 break-words text-xs leading-6 text-slate-500">{complaint.locationText ?? complaint.building?.name ?? "Location not specified"}</p>
          <p className="mt-2 text-[10px] text-slate-400">Submitted {formatDate(complaint.createdAt)}</p>
        </button>)}
        {!loading && !error && !list?.items.length && <div className="px-6 py-12 text-center">
          <p className="text-sm font-semibold">{query || status !== "ALL" ? "No complaints match these filters" : "No complaints submitted yet"}</p>
          <p className="mt-3 text-xs leading-6 text-slate-500">{query || status !== "ALL" ? "Try another search or choose All statuses." : "Once you submit an issue, its reference and saved status will appear here."}</p>
          <button type="button" onClick={query || status !== "ALL" ? clearFilters : onNew} className="mt-4 text-xs font-semibold text-amber-800 underline underline-offset-4">{query || status !== "ALL" ? "Clear filters" : "Report an issue"}</button>
        </div>}
        {loading && !list && <p role="status" className="px-6 py-10 text-center text-sm text-slate-500">Loading your complaints...</p>}
      </div>
      {list && list.total > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
        <button type="button" disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded border border-slate-200 px-3 py-2 text-xs disabled:opacity-40">Previous</button>
        <p className="text-[10px] text-slate-500">Page {list.page} of {Math.max(1, list.totalPages)}</p>
        <button type="button" disabled={loading || page >= list.totalPages} onClick={() => setPage((value) => value + 1)} className="rounded border border-slate-200 px-3 py-2 text-xs disabled:opacity-40">Next</button>
      </div>}
    </div>
  );
}
