"use client";

import { useEffect, useState } from "react";
import type { Technician } from "@/lib/workflow/types";
import { complaintRequest, readable, requestError } from "./complaint-shared";
import { WorkforceEditor } from "./workforce-editor";
import { workButton } from "./work-order-shared";

export function WorkforceWorkspace({ revision, onBusy, onSaved }: { revision: number; onBusy: (busy: boolean) => void; onSaved: () => void }) {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const result = await complaintRequest<{ technicians: Technician[] }>("/api/workforce", { signal: controller.signal });
        if (!controller.signal.aborted) setTechnicians(result.technicians);
      } catch (cause) {
        if (!controller.signal.aborted) setError(requestError(cause));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [revision, retry]);

  const selected = technicians.find((person) => person.id === selectedId);

  return <section className="mt-6" aria-label="Technician workforce">
    <div className="mb-5"><h2 className="text-xl font-bold">Technician workforce</h2><p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">Set the skills, duty availability, and workload limit for existing technician accounts. Configure a profile and turn duty on before assigning new work.</p></div>
    {error && <div role="alert" className="mb-5 rounded border border-red-200 bg-red-50 p-4 text-sm leading-7 text-red-700">{error}<button type="button" disabled={busy} onClick={() => setRetry((value) => value + 1)} className={`${workButton} ml-3`}>Retry workforce</button></div>}
    {loading && <p role="status" className="mb-4 text-xs text-slate-500">Checking the latest workforce settings...</p>}
    {!loading && !error && !technicians.length ? <p className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">No technician accounts have been created yet.</p> : <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <ul className="space-y-3">{technicians.map((person) => <li key={person.id}><button type="button" disabled={busy} onClick={() => setSelectedId(person.id)} aria-pressed={selectedId === person.id} className={`w-full rounded-xl border bg-white p-5 text-left shadow-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500 disabled:opacity-60 ${selectedId === person.id ? "border-amber-500 ring-1 ring-amber-200" : "border-slate-200 hover:border-slate-400"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-bold">{person.name}</h3><p className="mt-1 text-xs text-slate-500">{person.department ?? "No department"}</p></div><span className={`rounded border px-2 py-1 text-[10px] font-semibold ${person.eligible ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{!person.active ? "Account inactive" : person.eligible ? "Available for work" : person.onDuty ? "Unavailable" : "Off duty"}</span></div>
        <p className="mt-4 text-xs font-semibold">{person.activeJobs} / {person.maxActiveJobs} active jobs</p><p className="mt-2 text-xs leading-6 text-slate-500">{person.skills.length ? person.skills.map(readable).join(" · ") : "Skills not configured"}</p>
        {person.reasons.length > 0 && <p className="mt-2 text-[11px] leading-5 text-amber-800">{person.reasons.join(" · ")}</p>}
        <span className="mt-4 inline-block text-xs font-semibold text-amber-800">Configure profile →</span>
      </button></li>)}</ul>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">{selected ? <WorkforceEditor key={selected.id} technician={selected} refreshing={loading || Boolean(error)} onBusy={(value) => { setBusy(value); onBusy(value); }} onConflict={() => setRetry((value) => value + 1)} onSaved={(person) => { setTechnicians((current) => current.map((item) => item.id === person.id ? person : item)); onSaved(); }} /> : <div className="py-12 text-center"><h3 className="text-base font-semibold">Select a technician</h3><p className="mt-3 text-xs leading-6 text-slate-500">Review skills, duty hours, and capacity before assigning work.</p></div>}</div>
    </div>}
  </section>;
}
