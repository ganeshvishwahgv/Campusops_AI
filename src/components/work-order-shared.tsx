"use client";

import type { WorkflowEvent } from "@/lib/workflow/types";
import { ComplaintStatus, formatDate, readable } from "./complaint-shared";

export const workInput = "w-full rounded border border-slate-300 bg-[#fafaf8] px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 disabled:opacity-60";
export const workButton = "rounded border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50";
export const workLabel = "mb-2 block text-xs font-semibold text-[#172b46]";
export const workEyebrow = "font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500";

export function newWorkflowKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function WorkPriority({ value }: { value: string }) {
  const style = value === "CRITICAL" ? "text-red-700 bg-red-50 border-red-200" : value === "HIGH" ? "text-amber-900 bg-amber-50 border-amber-200" : "text-slate-600 bg-slate-50 border-slate-200";
  return <span className={`inline-flex rounded border px-2 py-1 text-[10px] font-semibold ${style}`}>{readable(value)} priority</span>;
}

const eventLabels: Record<string, string> = {
  SUBMITTED: "Complaint submitted", TRIAGE: "Reviewed by operations", ASSIGN: "Technician assigned",
  START: "Work started", BLOCK: "Work blocked", RESUME: "Work resumed", RESOLVE: "Resolution recorded",
  CLOSE: "Complaint closed", REOPEN: "Returned for more work",
};

export function WorkOrderTimeline({ history }: { history: WorkflowEvent[] }) {
  return (
    <section className="mt-7 border-t border-slate-200 pt-6" aria-label="Status history">
      <h3 className="text-sm font-bold">Status history</h3>
      {!history.length ? <p className="mt-3 text-xs leading-6 text-slate-500">No workflow updates have been recorded for this complaint yet. History begins when the operations team uses this workflow.</p> : <>
        <p className="mt-2 text-[11px] leading-5 text-slate-500">{history.length === 100 ? "Showing the latest 100 updates, most recent first. Older updates remain saved." : "Most recent updates first."}</p>
        <ol className="mt-4 space-y-5 border-l border-slate-200 pl-4">
          {history.map((event) => <li key={event.id} className="relative">
            <span aria-hidden="true" className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-4 ring-white" />
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-semibold">{eventLabels[event.action] ?? readable(event.action)}</h4><ComplaintStatus value={event.toStatus} /></div>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">{event.actorName} · {readable(event.actorRole)}</p>
            <time dateTime={event.createdAt} className="text-[10px] text-slate-500">{formatDate(event.createdAt)}</time>
            {event.fromStatus && event.fromStatus !== event.toStatus && <p className="mt-2 text-xs text-slate-600">{readable(event.fromStatus)} → {readable(event.toStatus)}</p>}
            {event.fromCategory && event.fromCategory !== event.toCategory && <p className="mt-1 text-xs text-slate-600">Issue type: {readable(event.fromCategory)} → {readable(event.toCategory)}</p>}
            {event.fromPriority && event.fromPriority !== event.toPriority && <p className="mt-1 text-xs text-slate-600">Priority: {readable(event.fromPriority)} → {readable(event.toPriority)}</p>}
            {event.fromAssigneeName !== event.toAssigneeName && <p className="mt-1 text-xs text-slate-600">Assigned technician: {event.fromAssigneeName ?? "Unassigned"} → {event.toAssigneeName ?? "Unassigned"}</p>}
            {event.note && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-slate-700">{event.note}</p>}
          </li>)}
        </ol>
      </>}
    </section>
  );
}
