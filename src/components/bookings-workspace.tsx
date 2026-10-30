"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/session";
import { canAccessComplaints, canViewDashboard, roleLabels } from "@/lib/auth/permissions";
import type { Booking } from "@/lib/bookings/types";
import { complaintRequest, requestError } from "./complaint-shared";
import { LogoutButton } from "./logout-button";
import { SessionMonitor } from "./session-monitor";
import { workButton } from "./work-order-shared";
import { BookingList } from "./booking-list";
import { BookingForm } from "./booking-form";
import { BookingDetail } from "./booking-detail";
import { BookingImpact } from "./booking-impact";

type Tab = "schedule" | "create" | "impact";

export function BookingsWorkspace({ user, initialId, initialIncident }: {
  user: CurrentUser; initialId: string | null; initialIncident: string | null;
}) {
  const admin = canViewDashboard(user.role);
  const [tab, setTab] = useState<Tab>(initialIncident && admin ? "impact" : "schedule");
  const [selectedId, setSelectedId] = useState(initialId);
  const [detail, setDetail] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(Boolean(initialId));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [formGeneration, setFormGeneration] = useState(0);
  const [checkedAt, setCheckedAt] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    const id = selectedId;
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const result = await complaintRequest<{ booking: Booking }>(`/api/bookings/${encodeURIComponent(id)}`, { signal: controller.signal });
        if (!controller.signal.aborted) { setDetail(result.booking); setCheckedAt(Date.now()); }
      } catch (cause) { if (!controller.signal.aborted) { setError(requestError(cause)); setDetail(null); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [selectedId, detailRevision]);

  function select(id: string) {
    if (busy) return;
    if (id !== selectedId) setDetail(null);
    setSelectedId(id); setError(""); setNotice(""); setTab("schedule"); setDetailRevision((value) => value + 1);
    if (window.matchMedia("(max-width: 1023px)").matches) window.requestAnimationFrame(() => document.getElementById("booking-details")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function saved(booking: Booking, replayed: boolean) {
    setDetail(booking); setSelectedId(booking.id); setCheckedAt(Date.now());
    setRevision((value) => value + 1); setFormGeneration((value) => value + 1); setTab("schedule");
    setNotice(replayed ? "This change was already saved. The latest booking is shown below." : booking.status === "CANCELLED" ? "Booking cancelled. The room is available for another activity at that time." : "Booking saved. Its room reservation and history are now up to date.");
  }

  function refresh() { setRevision((value) => value + 1); setDetailRevision((value) => value + 1); }
  const tabs: { value: Tab; label: string }[] = [{ value: "schedule", label: admin ? "Campus schedule" : "My bookings" }, { value: "create", label: "New booking" }, ...(admin ? [{ value: "impact" as const, label: "Affected activities" }] : [])];

  return <main className="min-h-screen bg-[#fafaf8] font-sans text-[#172b46]">
    <SessionMonitor />
    <header className="flex flex-wrap items-center justify-between gap-5 bg-[#142943] px-6 py-5 text-white sm:px-10"><div><span className="text-xl font-black tracking-tight">CAMPUS<span className="text-amber-400">/</span>OPS</span><p className="mt-1 text-[10px] text-slate-300">Easwari Engineering College</p></div><div className="flex flex-wrap items-center gap-5">
      {admin && <><Link href="/" prefetch={false} className="text-xs font-semibold text-amber-300 hover:underline">Operations dashboard</Link><Link href="/work-orders" prefetch={false} className="text-xs font-semibold text-amber-300 hover:underline">Work orders</Link></>}
      {canAccessComplaints(user.role) && <Link href="/complaints" prefetch={false} className="text-xs font-semibold text-amber-300 hover:underline">My complaints</Link>}
      <div className="text-right"><p className="text-xs font-semibold">{user.name}</p><p className="mt-1 text-[10px] text-slate-300">{roleLabels[user.role]}</p></div><LogoutButton />
    </div></header>
    <div className="mx-auto max-w-7xl px-6 py-9 sm:px-10 sm:py-12">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">Campus spaces</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">A room for every plan.</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">Find a suitable room, reserve its time, and keep campus activities organised.</p></div><button type="button" disabled={busy} onClick={refresh} className={workButton}>Refresh</button></div>
      <nav aria-label="Booking workspace" className="mt-8 flex flex-wrap gap-2 border-b border-slate-200 pb-4">{tabs.map((item) => <button key={item.value} type="button" disabled={busy} onClick={() => setTab(item.value)} aria-current={tab === item.value ? "page" : undefined} className={`rounded px-5 py-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500 disabled:opacity-50 ${tab === item.value ? "bg-[#142943] text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{item.label}</button>)}</nav>
      {notice && <div role="status" className="mt-6 rounded border border-emerald-200 bg-emerald-50 p-4 text-xs leading-6 text-emerald-900">{notice}</div>}
      {tab === "schedule" ? <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <BookingList revision={revision} selectedId={selectedId} admin={admin} busy={busy} onSelect={select} onNew={() => setTab("create")} />
        <aside id="booking-details" className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-label="Selected booking">
          {error ? <div role="alert" className="text-xs leading-6 text-red-700">{error}<button type="button" onClick={() => setDetailRevision((value) => value + 1)} className="mt-3 block font-semibold underline">Retry details</button></div> : detail ? <><BookingDetail key={detail.id} booking={detail} refreshing={loading} checkedAt={checkedAt} onSaved={saved} onConflict={refresh} onBusy={setBusy} />{loading && <p role="status" className="mt-4 text-xs text-slate-500">Checking the latest booking...</p>}</> : <div className="py-12 text-center"><h2 className="text-base font-semibold">{loading ? "Opening booking..." : "Select a booking"}</h2><p className="mt-3 text-xs leading-6 text-slate-500">Review the room, time, attendees, and saved changes here.</p></div>}
        </aside>
      </div> : tab === "create" ? <section className="mx-auto mt-6 max-w-3xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-label="New room booking"><BookingForm key={formGeneration} onBusy={setBusy} onSaved={saved} /></section> : admin ? <div className="mt-6"><BookingImpact initialIncident={initialIncident} revision={revision} busy={busy} onSelect={select} /></div> : null}
      <p className="mt-8 text-xs leading-6 text-slate-500">Campus room capacities and operational records are demonstration data. Booking confirmations reserve the recorded room and time; additional event arrangements still need coordination.</p>
    </div>
  </main>;
}
