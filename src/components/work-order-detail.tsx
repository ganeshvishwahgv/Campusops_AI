"use client";

import Link from "next/link";
import type { WorkOrder } from "@/lib/workflow/types";
import { ComplaintStatus, formatDate, readable } from "./complaint-shared";
import { WorkOrderActions } from "./work-order-actions";
import { workEyebrow, WorkOrderTimeline, WorkPriority } from "./work-order-shared";

export function WorkOrderDetail({ workOrder, technician, refreshing, onSaved, onBusy, onConflict }: {
  workOrder: WorkOrder; technician: boolean; refreshing: boolean;
  onSaved: (workOrder: WorkOrder, replayed: boolean) => void; onBusy: (busy: boolean) => void; onConflict: () => void;
}) {
  return <article>
    <div className="flex flex-wrap justify-between gap-3"><p className={workEyebrow}>Work order details</p><ComplaintStatus value={workOrder.status} /></div>
    <h2 className="mt-4 break-words text-xl font-bold leading-8">{workOrder.title}</h2>
    <p className="mt-2 break-all font-mono text-[10px] leading-5 text-slate-500">Reference: {workOrder.id}</p>
    <div className="mt-4"><WorkPriority value={workOrder.priority} /></div>
    {!technician && <Link href={`/bookings?incident=${encodeURIComponent(workOrder.id)}`} prefetch={false} className="mt-4 inline-block text-xs font-semibold text-amber-800 underline underline-offset-4">Check affected room bookings</Link>}
    <dl className="mt-5 grid gap-x-6 divide-y divide-slate-100 sm:grid-cols-2">
      {[
        ["Location", workOrder.locationText ?? workOrder.building?.name ?? "Not specified"],
        ["Issue type", readable(workOrder.category)],
        ["Assigned technician", workOrder.assignee?.name ?? "Unassigned"],
        ["Reported by", workOrder.reporter.name],
        ["Reported urgency", workOrder.reportedUrgency ? readable(workOrder.reportedUrgency) : "Not recorded"],
        ...(workOrder.room ? [["Room / venue", workOrder.room.name]] : []),
        ...(workOrder.asset ? [["Equipment", workOrder.asset.name]] : []),
        ...(workOrder.bus ? [["Bus", workOrder.bus.fleetCode]] : []),
        ["Reported", formatDate(workOrder.createdAt)],
        ["Last updated", formatDate(workOrder.updatedAt)],
        ...(workOrder.resolvedAt ? [["Resolved", formatDate(workOrder.resolvedAt)]] : []),
        ...(workOrder.closedAt ? [["Closed", formatDate(workOrder.closedAt)]] : []),
      ].map(([label, value]) => <div key={label} className="py-3"><dt className={workEyebrow}>{label}</dt><dd className="mt-1 break-words text-xs leading-6 text-slate-600">{value}</dd></div>)}
    </dl>
    <section className="mt-4 border-t border-slate-100 pt-5"><h3 className={workEyebrow}>Reported issue</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{workOrder.description}</p></section>
    {workOrder.blockedReason && <div className="mt-5 rounded border border-amber-200 bg-amber-50 p-4"><h3 className="text-xs font-bold text-amber-900">Work is blocked</h3><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-amber-900">{workOrder.blockedReason}</p></div>}
    {workOrder.resolutionNote && <div className="mt-5 rounded border border-emerald-200 bg-emerald-50 p-4"><h3 className="text-xs font-bold text-emerald-900">Resolution</h3><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-emerald-900">{workOrder.resolutionNote}</p></div>}
    <WorkOrderActions workOrder={workOrder} technician={technician} refreshing={refreshing} onSaved={onSaved} onBusy={onBusy} onConflict={onConflict} />
    <WorkOrderTimeline history={workOrder.history} />
  </article>;
}
