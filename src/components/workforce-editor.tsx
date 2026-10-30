"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Technician } from "@/lib/workflow/types";
import { categoryOptions } from "@/lib/complaints/types";
import { complaintRequest, ComplaintRequestError, requestError } from "./complaint-shared";
import { workButton, workInput, workLabel } from "./work-order-shared";

// Duty windows are always entered in India Standard Time, regardless of the
// administrator's browser timezone. IST uses a fixed UTC+05:30 offset.
function toIstInput(value: string | null): string {
  return value ? new Date(new Date(value).getTime() + 330 * 60_000).toISOString().slice(0, 16) : "";
}

function fromIstInput(value: string): string | null {
  return value ? new Date(`${value}:00+05:30`).toISOString() : null;
}

export function WorkforceEditor({ technician, refreshing, onBusy, onSaved, onConflict }: {
  technician: Technician; refreshing: boolean; onBusy: (busy: boolean) => void;
  onSaved: (technician: Technician) => void; onConflict: () => void;
}) {
  const [skills, setSkills] = useState(technician.skills);
  const [onDuty, setOnDuty] = useState(technician.onDuty);
  const [capacity, setCapacity] = useState(String(technician.maxActiveJobs));
  const [from, setFrom] = useState(toIstInput(technician.availableFrom));
  const [until, setUntil] = useState(toIstInput(technician.availableUntil));
  const [formVersion, setFormVersion] = useState(technician.version);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  const needsReview = conflict || formVersion !== technician.version;

  function loadLatest() {
    setSkills(technician.skills); setOnDuty(technician.onDuty); setCapacity(String(technician.maxActiveJobs));
    setFrom(toIstInput(technician.availableFrom)); setUntil(toIstInput(technician.availableUntil));
    setFormVersion(technician.version); setConflict(false); setError(""); setSaved(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || needsReview || refreshing) return;
    setError(""); setSaved(false);
    const maximum = Number(capacity);
    if (!skills.length) { setError("Select at least one skill for this technician."); return; }
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 20) { setError("Set a workload limit between 1 and 20 active jobs."); return; }
    if (maximum < technician.activeJobs) { setError(`The limit cannot be below the current ${technician.activeJobs} active jobs. Reassign or complete work first.`); return; }
    let availableFrom: string | null;
    let availableUntil: string | null;
    try {
      availableFrom = fromIstInput(from); availableUntil = fromIstInput(until);
    } catch {
      setError("Enter valid dates and times for the optional duty window."); return;
    }
    if (availableFrom && availableUntil && availableUntil <= availableFrom) { setError("The duty window must end after it starts."); return; }
    inFlight.current = true; setPending(true); onBusy(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const result = await complaintRequest<{ technician: Technician }>(`/api/workforce/${encodeURIComponent(technician.id)}`, {
        method: "PUT", signal: controller.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: formVersion, skills, onDuty, maxActiveJobs: maximum, availableFrom, availableUntil }),
      });
      setFormVersion(result.technician.version); setConflict(false); setSaved(true); onSaved(result.technician);
    } catch (cause) {
      if (cause instanceof ComplaintRequestError && cause.status === 409) {
        setError(`${cause.message} Review the latest profile before saving again.`); setConflict(true); onConflict();
      } else {
        const fields = cause instanceof ComplaintRequestError ? Object.values(cause.fields).join(" ") : "";
        setError(`${requestError(cause)}${fields ? ` ${fields}` : ""}${!(cause instanceof ComplaintRequestError) || cause.status >= 500 ? " Check the latest profile to see whether your changes were saved." : ""}`);
      }
    } finally {
      window.clearTimeout(timeout); inFlight.current = false; setPending(false); onBusy(false);
    }
  }

  return <form onSubmit={submit}>
    <h3 className="text-lg font-bold">{technician.name}</h3><p className="mt-2 text-xs leading-6 text-slate-500">{technician.department ?? "No department"} · {technician.activeJobs} active jobs</p>
    {!technician.active && <p className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900">This account is inactive and cannot receive new assignments.</p>}
    {needsReview && <div role="alert" className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900"><p>The saved profile or workload has changed. Load the latest settings before editing again.</p><button type="button" disabled={pending || refreshing} onClick={loadLatest} className="mt-2 font-semibold underline underline-offset-4">{refreshing ? "Loading latest profile..." : "Load latest settings"}</button></div>}
    <fieldset disabled={pending || refreshing || needsReview} className="mt-6">
      <legend className={workLabel}>Skills</legend><p className="mb-3 text-xs leading-6 text-slate-500">Select the issue types this technician is qualified to handle.</p>
      <div className="grid gap-2 sm:grid-cols-2">{categoryOptions.map((item) => <label key={item.value} className={`flex items-center gap-2 rounded border p-3 text-xs ${skills.includes(item.value) ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-[#fafaf8]"}`}><input type="checkbox" checked={skills.includes(item.value)} onChange={(event) => { setSaved(false); setSkills((current) => event.target.checked ? [...current, item.value] : current.filter((value) => value !== item.value)); }} className="accent-amber-600" />{item.label}</label>)}</div>
      <div className="mt-6 border-t border-slate-100 pt-5"><label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={onDuty} onChange={(event) => { setOnDuty(event.target.checked); setSaved(false); }} className="h-4 w-4 accent-amber-600" />On duty for new work</label><p className="mt-2 text-xs leading-6 text-slate-500">Turning duty off keeps current assignments. Starting or resuming work requires an available duty window.</p></div>
      <div className="mt-5"><label htmlFor="workforce-capacity" className={workLabel}>Maximum active jobs</label><input id="workforce-capacity" type="number" min={1} max={20} step={1} required value={capacity} onChange={(event) => { setCapacity(event.target.value); setSaved(false); }} className={workInput} /><p className="mt-2 text-xs leading-6 text-slate-500">Assigned, in progress, and blocked jobs count toward this limit. Current load: {technician.activeJobs}.</p></div>
      <div className="mt-6 border-t border-slate-100 pt-5"><h4 className="text-xs font-semibold">Optional duty window</h4><p className="mt-2 text-xs leading-6 text-slate-500">All times are India Standard Time (IST, UTC+05:30). Leave either boundary blank for no limit on that side.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><label htmlFor="workforce-from" className={workLabel}>Available from (IST)</label><input id="workforce-from" type="datetime-local" value={from} onChange={(event) => { setFrom(event.target.value); setSaved(false); }} className={workInput} /></div><div><label htmlFor="workforce-until" className={workLabel}>Available until (IST)</label><input id="workforce-until" type="datetime-local" value={until} onChange={(event) => { setUntil(event.target.value); setSaved(false); }} className={workInput} /></div></div></div>
    </fieldset>
    {error && <p role="alert" className="mt-5 text-xs leading-6 text-red-700">{error}</p>}
    {saved && <p role="status" className="mt-5 text-xs leading-6 text-emerald-800">Profile saved successfully.</p>}
    <div className="mt-6 flex flex-wrap gap-3"><button type="submit" disabled={pending || refreshing || needsReview} className="rounded bg-[#142943] px-5 py-3 text-xs font-semibold text-white hover:bg-[#203e61] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500 disabled:opacity-50">{pending ? "Saving profile..." : "Save profile"}</button>{error && <button type="button" disabled={pending || refreshing} onClick={onConflict} className={workButton}>Check latest profile</button>}</div>
  </form>;
}
