"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/session";
import { canAccessBookings, canViewDashboard, roleLabels } from "@/lib/auth/permissions";
import type { Complaint, ComplaintOptions } from "@/lib/complaints/types";
import { ComplaintForm } from "./complaint-form";
import { ComplaintList } from "./complaint-list";
import { ComplaintDetail } from "./complaint-detail";
import { complaintRequest, requestError } from "./complaint-shared";
import { LogoutButton } from "./logout-button";
import { NotificationBell } from "@/components/notification-bell";
import { SessionMonitor } from "./session-monitor";

export function ComplaintsWorkspace({ user }: { user: CurrentUser }) {
  const [tab, setTab] = useState<"report" | "requests">("report");
  const [options, setOptions] = useState<ComplaintOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [optionsRevision, setOptionsRevision] = useState(0);
  const [revision, setRevision] = useState(0);
  const [listGeneration, setListGeneration] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Complaint | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [savedReference, setSavedReference] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function loadOptions() {
      setOptionsLoading(true);
      setOptionsError("");
      try {
        const result = await complaintRequest<ComplaintOptions>("/api/complaints/options", { signal: controller.signal });
        if (!controller.signal.aborted) setOptions(result);
      } catch (cause) {
        if (!controller.signal.aborted) setOptionsError(requestError(cause));
      } finally {
        if (!controller.signal.aborted) setOptionsLoading(false);
      }
    }
    void loadOptions();
    return () => controller.abort();
  }, [optionsRevision]);

  useEffect(() => {
    if (!selectedId) return;
    const id = selectedId;
    const controller = new AbortController();
    async function loadDetail() {
      setDetailLoading(true);
      setDetailError("");
      try {
        const result = await complaintRequest<{ complaint: Complaint }>(`/api/complaints/${encodeURIComponent(id)}`, { signal: controller.signal });
        if (!controller.signal.aborted) setDetail(result.complaint);
      } catch (cause) {
        if (!controller.signal.aborted) { setDetail(null); setDetailError(requestError(cause)); }
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false);
      }
    }
    void loadDetail();
    return () => controller.abort();
  }, [selectedId, revision]);

  useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState === "visible") setRevision((value) => value + 1); };
    const timer = window.setInterval(refreshVisible, 60_000);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("pageshow", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("pageshow", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, []);

  function saved(complaint: Complaint) {
    setSavedReference(complaint.id);
    setListGeneration((value) => value + 1);
    setSelectedId(complaint.id);
    setDetail(complaint);
    setTab("requests");
    setRevision((value) => value + 1);
  }

  function selectComplaint(complaint: Complaint) {
    setSelectedId(complaint.id);
    setDetail(complaint);
    setDetailError("");
    document.getElementById("complaint-details")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  return (
    <main className="min-h-screen bg-[#fafaf8] font-sans text-[#172b46]">
      <SessionMonitor />
      <header className="flex flex-wrap items-center justify-between gap-5 bg-[#142943] px-6 py-5 text-white sm:px-10">
        <div><span className="text-xl font-black tracking-tight">CAMPUS<span className="text-amber-400">/</span>OPS</span><p className="mt-1 text-[10px] text-slate-300">Easwari Engineering College</p></div>
        <div className="flex flex-wrap items-center gap-5">
          {canViewDashboard(user.role) && <Link href="/" prefetch={false} className="text-xs font-semibold text-amber-300 underline-offset-4 hover:underline">Operations dashboard</Link>}
          {canViewDashboard(user.role) && <Link href="/work-orders" prefetch={false} className="text-xs font-semibold text-amber-300 underline-offset-4 hover:underline">Work orders</Link>}
          {canAccessBookings(user.role) && <Link href="/bookings" prefetch={false} className="text-xs font-semibold text-amber-300 underline-offset-4 hover:underline">Room bookings</Link>}
          <div className="text-right"><p className="text-xs font-semibold">{user.name}</p><p className="mt-1 text-[10px] text-slate-300">{roleLabels[user.role]}</p></div>
          <NotificationBell /><LogoutButton />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-9 sm:px-10 sm:py-12">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">Campus help desk</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Report it. Keep track of it.</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">Send a campus issue to the operations team and check the saved status of your complaints here.</p></div>
          <span className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">Your own requests</span>
        </div>

        <nav aria-label="Complaint workspace" className="mt-8 flex flex-wrap gap-2 border-b border-slate-200 pb-4">
          {([{ value: "report", label: "Report an issue" }, { value: "requests", label: "My complaints" }] as const).map((item) => <button key={item.value} type="button" onClick={() => setTab(item.value)} aria-current={tab === item.value ? "page" : undefined} className={`rounded px-5 py-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500 ${tab === item.value ? "bg-[#142943] text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{item.label}</button>)}
        </nav>

        {savedReference && <div role="status" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <div><p className="text-sm font-semibold">Complaint submitted successfully</p><p className="mt-1 break-all text-xs leading-6">Your reference is <span className="font-mono font-semibold">{savedReference}</span>. It has been saved for the operations team.</p></div>
          <button type="button" onClick={() => { setSavedReference(""); setTab("report"); }} className="text-xs font-semibold underline underline-offset-4">Report another issue</button>
        </div>}

        <section hidden={tab !== "report"} className="mt-6" aria-label="Report an issue">
          <ComplaintForm options={options} loading={optionsLoading} loadError={optionsError} onRetry={() => setOptionsRevision((value) => value + 1)} onSaved={saved} />
        </section>

        <section hidden={tab !== "requests"} className="mt-6" aria-label="My complaints">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-bold">My complaints</h2><p className="mt-1 text-xs leading-6 text-slate-500">Only complaints submitted by your account appear here. Refresh to check for updates.</p></div>
            <button type="button" onClick={() => setRevision((value) => value + 1)} className="rounded border border-slate-300 bg-white px-4 py-2 text-xs font-semibold hover:bg-slate-50">Refresh</button>
          </div>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <ComplaintList key={listGeneration} revision={revision} selectedId={selectedId} onSelect={selectComplaint} onNew={() => setTab("report")} />
            <aside id="complaint-details" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-6" aria-label="Selected complaint">
              {detailError ? <div role="alert" className="text-sm leading-7 text-red-700">{detailError}<button type="button" onClick={() => setRevision((value) => value + 1)} className="mt-3 block text-xs font-semibold underline">Retry details</button></div> : detail ? <ComplaintDetail complaint={detail} /> : <div className="py-8 text-center"><p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">Complaint details</p><h3 className="mt-4 text-base font-semibold">{detailLoading ? "Opening your request..." : "Select a complaint"}</h3><p className="mt-3 text-xs leading-6 text-slate-500">See your submitted details, reference number, and current status here.</p></div>}
              {detail && detailLoading && <p role="status" className="mt-4 text-[10px] text-slate-400">Checking the latest saved status...</p>}
            </aside>
          </div>
        </section>
        <p className="mt-8 text-xs leading-6 text-slate-500">The operations team reviews complaints and assigns technicians. Check My complaints for saved status updates and resolution notes.</p>
      </div>
    </main>
  );
}
