"use client";

import type { Complaint } from "@/lib/complaints/types";
import { ComplaintStatus, formatDate, readable } from "./complaint-shared";
import { WorkOrderTimeline } from "./work-order-shared";

const eyebrow = "font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500";
const statusDescriptions: Record<string, string> = {
  REPORTED: "Your complaint has been saved and is waiting for the operations team to review it.",
  NEEDS_CLARIFICATION: "More information is needed. Contact the campus operations team with this complaint reference.",
  TRIAGED: "The operations team has reviewed this complaint.",
  ASSIGNED: "Work has been assigned for this complaint.",
  IN_PROGRESS: "Work on this complaint is in progress.",
  BLOCKED: "Work is blocked. The operations team needs to resolve a dependency before continuing.",
  RESOLVED: "This complaint has been marked as resolved.",
  CLOSED: "This complaint has been closed.",
};

export function ComplaintDetail({ complaint }: { complaint: Complaint }) {
  return (
    <article>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={eyebrow}>Complaint details</p>
        <ComplaintStatus value={complaint.status} />
      </div>
      <h2 className="mt-4 break-words text-lg font-bold leading-7">{complaint.title}</h2>
      <p className="mt-3 break-all font-mono text-[10px] leading-5 text-slate-500">Reference: {complaint.id}</p>
      <p className="mt-5 rounded border border-slate-200 bg-[#fafaf8] p-4 text-xs leading-6 text-slate-600">{statusDescriptions[complaint.status] ?? "The saved status is shown above."}</p>
      <dl className="mt-5 divide-y divide-slate-100">
        {[
          ["Location", complaint.locationText ?? complaint.building?.name ?? "Not specified"],
          ["Issue type", readable(complaint.category)],
          ["Reported urgency", complaint.reportedUrgency ? readable(complaint.reportedUrgency) : "Not recorded"],
          ...(complaint.asset ? [["Equipment", complaint.asset.name]] : []),
          ...(complaint.bus ? [["Bus", complaint.bus.fleetCode]] : []),
          ["Submitted", formatDate(complaint.createdAt)],
          ["Last updated", formatDate(complaint.updatedAt)],
          ...(complaint.resolvedAt ? [["Resolved", formatDate(complaint.resolvedAt)]] : []),
          ...(complaint.closedAt ? [["Closed", formatDate(complaint.closedAt)]] : []),
        ].map(([label, value]) => <div key={label} className="py-3"><dt className={eyebrow}>{label}</dt><dd className="mt-1 break-words text-xs leading-6 text-slate-600">{value}</dd></div>)}
      </dl>
      <div className="mt-5 border-t border-slate-100 pt-5">
        <h3 className={eyebrow}>Your description</h3>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{complaint.description}</p>
      </div>
      <WorkOrderTimeline history={complaint.history} />
    </article>
  );
}
