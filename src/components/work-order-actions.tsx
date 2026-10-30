"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Technician, WorkOrder } from "@/lib/workflow/types";
import { categoryOptions, urgencyOptions } from "@/lib/complaints/types";
import { complaintRequest, ComplaintRequestError, readable, requestError } from "./complaint-shared";
import { newWorkflowKey, workButton, workInput, workLabel } from "./work-order-shared";

const actions: Record<string, { label: string; submit: string; help: string }> = {
  TRIAGE: { label: "Review and triage", submit: "Save review", help: "Confirm the issue type and operations priority before assigning a technician." },
  ASSIGN: { label: "Assign or reassign technician", submit: "Assign work", help: "Choose an available technician with the right skill and capacity. Reassignment returns this job to Assigned." },
  START: { label: "Start work", submit: "Start work", help: "Confirm that you are beginning this assigned job." },
  BLOCK: { label: "Report a blocker", submit: "Mark blocked", help: "Explain what is preventing the work and what is needed to continue." },
  RESUME: { label: "Resume work", submit: "Resume work", help: "Confirm that the blocker has been cleared and work can continue." },
  RESOLVE: { label: "Record resolution", submit: "Mark resolved", help: "Describe the fix and how you checked it. Operations will review the resolution before closing." },
  CLOSE: { label: "Verify and close", submit: "Close complaint", help: "Confirm the resolution is satisfactory. Closed complaints cannot be reopened." },
  REOPEN: { label: "Return for more work", submit: "Return to triage", help: "Explain what is still wrong. This clears the assignment and resolution so the complaint can be reviewed again." },
};

function availableActions(status: string, technician: boolean): string[] {
  if (technician) {
    if (status === "ASSIGNED") return ["START", "BLOCK"];
    if (status === "IN_PROGRESS") return ["RESOLVE", "BLOCK"];
    if (status === "BLOCKED") return ["RESUME"];
    return [];
  }
  if (["REPORTED", "NEEDS_CLARIFICATION"].includes(status)) return ["TRIAGE"];
  if (status === "TRIAGED") return ["ASSIGN", "TRIAGE"];
  if (["ASSIGNED", "IN_PROGRESS", "BLOCKED"].includes(status)) return ["ASSIGN"];
  if (status === "RESOLVED") return ["CLOSE", "REOPEN"];
  return [];
}

export function WorkOrderActions({ workOrder, technician, refreshing, onSaved, onBusy, onConflict }: {
  workOrder: WorkOrder; technician: boolean; refreshing: boolean;
  onSaved: (workOrder: WorkOrder, replayed: boolean) => void; onBusy: (busy: boolean) => void; onConflict: () => void;
}) {
  const [action, setAction] = useState("");
  const [category, setCategory] = useState(workOrder.category);
  const [priority, setPriority] = useState(workOrder.priority);
  const [assigneeId, setAssigneeId] = useState("");
  const [note, setNote] = useState("");
  const [formVersion, setFormVersion] = useState(workOrder.version);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Technician[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const [candidateRevision, setCandidateRevision] = useState(0);
  const inFlight = useRef(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const available = availableActions(workOrder.status, technician);
  const selectedAction = available.includes(action) ? action : "";
  const needsReview = conflict || formVersion !== workOrder.version;

  useEffect(() => {
    if (technician || selectedAction !== "ASSIGN") return;
    const controller = new AbortController();
    async function load() {
      setCandidateLoading(true); setCandidateError(""); setCandidates([]);
      try {
        const result = await complaintRequest<{ candidates: Technician[] }>(`/api/work-orders/${encodeURIComponent(workOrder.id)}/candidates`, { signal: controller.signal });
        if (!controller.signal.aborted) setCandidates(result.candidates);
      } catch (cause) {
        if (!controller.signal.aborted) setCandidateError(requestError(cause));
      } finally {
        if (!controller.signal.aborted) setCandidateLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [workOrder.id, workOrder.version, technician, selectedAction, candidateRevision]);

  function reviewLatest() {
    setFormVersion(workOrder.version); setConflict(false); setError("");
    setCategory(workOrder.category); setPriority(workOrder.priority); setAssigneeId("");
    if (!available.includes(action)) setAction("");
    attempt.current = null;
    setCandidateRevision((value) => value + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || needsReview || refreshing) return;
    setError("");
    if (!selectedAction) { setError("Choose an update to make."); return; }
    if (note.trim().length < 5 || note.trim().length > 2000) { setError("Write a note between 5 and 2,000 characters."); document.getElementById("work-note")?.focus(); return; }
    if (selectedAction === "ASSIGN" && !candidates.some((person) => person.id === assigneeId && person.eligible && person.id !== workOrder.assignee?.id)) { setError("Choose an eligible technician other than the current assignee."); return; }
    const body = JSON.stringify({ action: selectedAction, expectedVersion: formVersion, note: note.trim(), ...(selectedAction === "TRIAGE" ? { category, priority } : {}), ...(selectedAction === "ASSIGN" ? { assigneeId } : {}) });
    if (attempt.current?.body !== body) attempt.current = { body, key: newWorkflowKey() };
    inFlight.current = true; setPending(true); onBusy(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const result = await complaintRequest<{ workOrder: WorkOrder; replayed: boolean }>(`/api/work-orders/${encodeURIComponent(workOrder.id)}/actions`, {
        method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key }, body,
      });
      attempt.current = null; setAction(""); setNote(""); setAssigneeId("");
      setFormVersion(result.workOrder.version); setCategory(result.workOrder.category); setPriority(result.workOrder.priority); setConflict(false);
      onSaved(result.workOrder, result.replayed);
    } catch (cause) {
      if (cause instanceof ComplaintRequestError && cause.status === 409) {
        setConflict(true); setError(`${cause.message} Review the latest details before trying again.`); onConflict();
      } else {
        const fields = cause instanceof ComplaintRequestError ? Object.values(cause.fields).join(" ") : "";
        setError(`${requestError(cause)}${fields ? ` ${fields}` : ""}${!(cause instanceof ComplaintRequestError) || cause.status >= 500 ? " Your note is still here. Retry the same update to check whether it was saved." : ""}`);
      }
    } finally {
      window.clearTimeout(timeout); inFlight.current = false; setPending(false); onBusy(false);
    }
  }

  return <section className="mt-7 rounded-lg border border-slate-200 bg-[#fafaf8] p-4 sm:p-5" aria-label="Update work order">
    <h3 className="text-sm font-bold">{technician ? "Update your work" : "Manage this work order"}</h3>
    {!available.length ? <p className="mt-3 text-xs leading-6 text-slate-500">{workOrder.status === "CLOSED" ? "This complaint is closed. Its details and history remain available." : "The resolution is waiting for operations to verify it."}</p> : <form onSubmit={submit} className="mt-4">
      {needsReview && <div role="alert" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-xs leading-6 text-amber-900"><p>The work order or its assignment conditions changed. Review the details above before making another update. Your note has been kept.</p><button type="button" disabled={refreshing || pending} onClick={reviewLatest} className="mt-2 font-semibold underline underline-offset-4">{refreshing ? "Loading latest details..." : "I have reviewed the latest details"}</button></div>}
      <fieldset disabled={pending || needsReview || refreshing}>
        <label htmlFor="work-action" className={workLabel}>Update</label>
        <select id="work-action" value={selectedAction} onChange={(event) => { setAction(event.target.value); setError(""); }} className={workInput} required>
          <option value="">Choose an update</option>{available.map((value) => <option key={value} value={value}>{actions[value].label}</option>)}
        </select>
        {selectedAction && <p className="mt-2 text-xs leading-6 text-slate-500">{actions[selectedAction].help}</p>}
        {selectedAction === "TRIAGE" && <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="work-category" className={workLabel}>Reviewed issue type</label><select id="work-category" value={category} onChange={(event) => setCategory(event.target.value)} className={workInput}>{categoryOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          <div><label htmlFor="work-priority" className={workLabel}>Operations priority</label><select id="work-priority" value={priority} onChange={(event) => setPriority(event.target.value)} className={workInput}>{urgencyOptions.map((item) => <option key={item.value} value={item.value}>{readable(item.value)}</option>)}</select></div>
        </div>}
        {selectedAction === "ASSIGN" && <div className="mt-5">
          <div className="flex items-center justify-between gap-3"><p className={workLabel}>Technician</p><button type="button" disabled={candidateLoading} onClick={() => setCandidateRevision((value) => value + 1)} className="mb-2 text-[11px] font-semibold underline">Refresh availability</button></div>
          {candidateLoading ? <p role="status" className="text-xs text-slate-500">Checking skills, duty, and workload...</p> : candidateError ? <p role="alert" className="text-xs leading-6 text-red-700">{candidateError}</p> : !candidates.length ? <p className="text-xs leading-6 text-slate-500">No technician accounts are available. Configure existing technician accounts in Workforce.</p> : <div className="space-y-2">{candidates.map((person) => {
            const current = person.id === workOrder.assignee?.id;
            const disabled = !person.eligible || current;
            return <label key={person.id} className={`flex items-start gap-3 rounded border bg-white p-3 ${disabled ? "border-slate-200 opacity-65" : assigneeId === person.id ? "border-amber-500 ring-1 ring-amber-200" : "cursor-pointer border-slate-300"}`}>
              <input type="radio" name="technician" value={person.id} disabled={disabled} checked={assigneeId === person.id} onChange={() => setAssigneeId(person.id)} className="mt-1 accent-amber-600" />
              <span className="min-w-0"><span className="block text-xs font-semibold">{person.name}{current ? " · current assignee" : ""}</span><span className="mt-1 block text-[11px] leading-5 text-slate-500">{person.department ?? "No department"} · {person.activeJobs}/{person.maxActiveJobs} active jobs</span><span className="block text-[11px] leading-5 text-slate-500">{person.skills.length ? person.skills.map(readable).join(", ") : "Skills not configured"}</span>{person.reasons.length > 0 && <span className="mt-1 block text-[11px] leading-5 text-amber-800">{person.reasons.join(" · ")}</span>}</span>
            </label>;
          })}</div>}
          {!candidateLoading && candidates.length > 0 && !candidates.some((person) => person.eligible && person.id !== workOrder.assignee?.id) && <p className="mt-3 text-xs leading-6 text-amber-800">No eligible replacement is currently available. Check skills, duty hours, and capacity in Workforce.</p>}
        </div>}
        {selectedAction && <div className="mt-5"><label htmlFor="work-note" className={workLabel}>{selectedAction === "RESOLVE" ? "Resolution and verification" : selectedAction === "BLOCK" ? "Blocker and next step" : "Update note"}</label><textarea id="work-note" required minLength={5} maxLength={2000} rows={4} value={note} onChange={(event) => setNote(event.target.value)} className={workInput} aria-describedby="work-note-help" /><p id="work-note-help" className="mt-2 text-[11px] leading-5 text-slate-500">Visible to the person who reported this complaint. Include a useful update in 5–2,000 characters.</p></div>}
      </fieldset>
      {error && <p role="alert" className="mt-4 text-xs leading-6 text-red-700">{error}</p>}
      <button type="submit" disabled={pending || needsReview || refreshing || !selectedAction || (selectedAction === "ASSIGN" && (candidateLoading || Boolean(candidateError)))} className="mt-5 rounded bg-[#142943] px-5 py-3 text-xs font-semibold text-white hover:bg-[#203e61] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Saving update..." : selectedAction ? actions[selectedAction].submit : "Choose an update"}</button>
      {error && !needsReview && <button type="button" disabled={pending} onClick={() => { setError(""); onConflict(); }} className={`${workButton} ml-2 mt-3`}>Check latest status</button>}
    </form>}
  </section>;
}
