"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/session";
import { roleLabels } from "@/lib/auth/permissions";
import type { WorkOrder } from "@/lib/workflow/types";
import { complaintRequest, requestError } from "./complaint-shared";
import { LogoutButton } from "./logout-button";
import { NotificationBell } from "@/components/notification-bell";
import { SessionMonitor } from "./session-monitor";
import { WorkOrderList } from "./work-order-list";
import { WorkOrderDetail } from "./work-order-detail";
import { WorkforceWorkspace } from "./workforce-workspace";
import { workButton } from "./work-order-shared";

export function WorkOrdersWorkspace({ user, initialId }: { user: CurrentUser; initialId: string | null }) {
  const technician = user.role === "TECHNICIAN";
  const [tab, setTab] = useState<"queue" | "workforce">("queue");
  const [selectedId, setSelectedId] = useState(initialId);
  const [detail, setDetail] = useState<WorkOrder | null>(null);
  const [loading, setLoading] = useState(Boolean(initialId));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    const id = selectedId;
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const result = await complaintRequest<{ workOrder: WorkOrder }>(`/api/work-orders/${encodeURIComponent(id)}`, { signal: controller.signal });
        if (!controller.signal.aborted) setDetail(result.workOrder);
      } catch (cause) {
        if (!controller.signal.aborted) { setError(requestError(cause)); setDetail(null); }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [selectedId, detailRevision]);

  function select(id: string) {
    if (busy) return;
    if (id !== selectedId) setDetail(null);
    setSelectedId(id); setNotice(""); setError(""); setDetailRevision((value) => value + 1);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      window.requestAnimationFrame(() => document.getElementById("work-order-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  function refresh() {
    setRevision((value) => value + 1); setDetailRevision((value) => value + 1);
  }

  function saved(workOrder: WorkOrder, replayed: boolean) {
    setDetail(workOrder); setRevision((value) => value + 1);
    setNotice(replayed ? "This update was already saved. The latest work order is shown below." : "Update saved. The reporter can see the note and status in their complaint history.");
  }

  return (
    <main className="min-h-screen bg-[#fafaf8] font-sans text-[#172b46]">
      <SessionMonitor />
      <header className="flex flex-wrap items-center justify-between gap-5 bg-[#142943] px-6 py-5 text-white sm:px-10">
        <div><span className="text-xl font-black tracking-tight">CAMPUS<span className="text-amber-400">/</span>OPS</span><p className="mt-1 text-[10px] text-slate-300">Easwari Engineering College</p></div>
        <div className="flex flex-wrap items-center gap-5">
          {!technician && <><Link href="/" prefetch={false} className="text-xs font-semibold text-amber-300 hover:underline">Operations dashboard</Link><Link href="/complaints" prefetch={false} className="text-xs font-semibold text-amber-300 hover:underline">My complaints</Link></>}
          {!technician && <Link href="/bookings" prefetch={false} className="text-xs font-semibold text-amber-300 hover:underline">Room bookings</Link>}
          <div className="text-right"><p className="text-xs font-semibold">{user.name}</p><p className="mt-1 text-[10px] text-slate-300">{roleLabels[user.role]}</p></div><NotificationBell /><LogoutButton />
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-9 sm:px-10 sm:py-12">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">Campus operations</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{technician ? "Your work, in one place." : "From report to resolution."}</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">{technician ? "Start assigned jobs, record blockers, and share what was fixed." : "Review complaints, match technicians to work, and follow every update."}</p></div><button type="button" disabled={busy} onClick={refresh} className={workButton}>Refresh</button></div>
        <nav aria-label="Work order workspace" className="mt-8 flex flex-wrap gap-2 border-b border-slate-200 pb-4">
          {([{ value: "queue", label: technician ? "My work orders" : "Work orders" }, ...(!technician ? [{ value: "workforce", label: "Workforce" }] : [])] as { value: "queue" | "workforce"; label: string }[]).map((item) => <button key={item.value} type="button" disabled={busy} onClick={() => setTab(item.value)} aria-current={tab === item.value ? "page" : undefined} className={`rounded px-5 py-3 text-xs font-semibold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500 ${tab === item.value ? "bg-[#142943] text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{item.label}</button>)}
        </nav>
        {notice && <div role="status" className="mt-6 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-6 text-emerald-900">{notice}</div>}
        {tab === "queue" ? <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <WorkOrderList revision={revision} selectedId={selectedId} technician={technician} busy={busy} onSelect={select} />
          <aside id="work-order-detail" className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-label="Selected work order">
            {error ? <div role="alert" className="text-sm leading-7 text-red-700">{error}<button type="button" onClick={() => setDetailRevision((value) => value + 1)} className="mt-3 block text-xs font-semibold underline">Retry details</button></div>
              : detail ? <><WorkOrderDetail key={detail.id} workOrder={detail} technician={technician} refreshing={loading} onSaved={saved} onBusy={setBusy} onConflict={() => { setDetailRevision((value) => value + 1); setRevision((value) => value + 1); }} />{loading && <p role="status" className="mt-4 text-xs text-slate-500">Checking the latest saved details...</p>}</>
              : <div className="py-12 text-center"><h2 className="text-base font-semibold">{loading ? "Opening work order..." : "Select a work order"}</h2><p className="mt-3 text-xs leading-6 text-slate-500">{technician ? "See the location, issue details, and available work updates here." : "Review the issue, choose a technician, and follow its history here."}</p></div>}
          </aside>
        </div> : <WorkforceWorkspace revision={revision} onBusy={setBusy} onSaved={() => { setRevision((value) => value + 1); setNotice("Technician profile saved. Assignment eligibility now reflects these settings."); }} />}
      </div>
    </main>
  );
}
