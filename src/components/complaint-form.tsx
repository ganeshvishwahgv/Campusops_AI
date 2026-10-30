"use client";

import { useRef, useState, type FormEvent } from "react";
import { categoryOptions, urgencyOptions, type Complaint, type ComplaintOptions } from "@/lib/complaints/types";
import type { ComplaintDraft } from "@/lib/ai/types";
import { complaintRequest, ComplaintRequestError, requestError } from "./complaint-shared";
import { AiButton, AiSource } from "./ai-shared";

const initialForm = {
  title: "", description: "", category: "", reportedUrgency: "MEDIUM",
  buildingId: "", roomId: "", assetId: "", busId: "", locationDetails: "",
};
type FormFields = typeof initialForm;
const fieldLabels: Record<string, string> = {
  title: "Title", description: "Description", category: "Issue type", reportedUrgency: "Reported urgency",
  buildingId: "Campus location", roomId: "Room or venue", assetId: "Equipment", busId: "Bus", locationDetails: "Location details",
};
const inputStyle = "w-full rounded border border-slate-300 bg-[#fafaf8] px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 disabled:opacity-60";
const labelStyle = "mb-2 block text-xs font-semibold text-[#172b46]";

function newSubmissionKey(): string {
  // getRandomValues also supports the explicitly configured HTTP LAN demo.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function ComplaintForm({ options, loading, loadError, onRetry, onSaved }: {
  options: ComplaintOptions | null;
  loading: boolean;
  loadError: string;
  onRetry: () => void;
  onSaved: (complaint: Complaint) => void;
}) {
  const [form, setForm] = useState<FormFields>(initialForm);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const inFlight = useRef(false);
  const [story, setStory] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<ComplaintDraft | null>(null);
  const [draftError, setDraftError] = useState("");
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const rooms = options?.rooms.filter((room) => room.buildingId === form.buildingId) ?? [];
  const assets = options?.assets.filter((asset) => asset.roomId === form.roomId) ?? [];

  function update(field: keyof FormFields, value: string) {
    setForm((previous) => ({
      ...previous, [field]: value,
      ...(field === "buildingId" ? { roomId: "", assetId: "" } : {}),
      ...(field === "roomId" ? { assetId: "" } : {}),
      ...(field === "category" && value !== "TRANSPORT" ? { busId: "" } : {}),
    }));
    setFields((previous) => { const next = { ...previous }; delete next[field]; return next; });
  }

  // Claude only pre-fills the form; the reporter reviews every field before submitting.
  async function fillWithAi() {
    if (story.trim().length < 10) { setDraftError("Describe the problem in at least 10 characters."); return; }
    setDrafting(true); setDraftError("");
    try {
      const result = await complaintRequest<ComplaintDraft>("/api/ai/complaint-draft", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: story.trim() }),
      });
      setDraft(result);
      setForm((previous) => ({
        ...previous, title: result.title, description: previous.description.trim() ? previous.description : story.trim(),
        category: result.category, reportedUrgency: result.reportedUrgency,
        buildingId: result.buildingId ?? previous.buildingId, roomId: result.roomId ?? "", assetId: result.assetId ?? "",
        busId: result.busId ?? "", locationDetails: result.locationDetails || previous.locationDetails,
      }));
      setFields({});
    } catch (cause) { setDraftError(requestError(cause)); }
    finally { setDrafting(false); }
  }

  function errorProps(name: string) {
    return { "aria-invalid": Boolean(fields[name]), "aria-describedby": fields[name] ? `complaint-${name}-error` : undefined };
  }

  function fieldError(name: string) {
    return fields[name] ? <p id={`complaint-${name}-error`} className="mt-2 text-xs leading-5 text-red-700">{fields[name]}</p> : null;
  }

  function focusField(name: string | undefined) {
    if (name) document.getElementById(`complaint-${name}`)?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const errors: Record<string, string> = {};
    if (form.title.trim().length < 5 || form.title.trim().length > 120) errors.title = "Write a title between 5 and 120 characters.";
    if (form.description.trim().length < 20 || form.description.trim().length > 4000) errors.description = "Describe the issue in 20 to 4,000 characters.";
    if (!form.category) errors.category = "Choose an issue type.";
    if (!form.buildingId) errors.buildingId = "Choose the campus location.";
    if (form.locationDetails.trim().length > 200) errors.locationDetails = "Keep location details within 200 characters.";
    setFields(errors);
    setError("");
    if (Object.keys(errors).length) {
      setError("Please check the highlighted fields.");
      focusField(Object.keys(errors)[0]);
      return;
    }
    if (!options) {
      setError("Load the campus locations before submitting your complaint.");
      return;
    }

    inFlight.current = true;
    setPending(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const body = JSON.stringify({
        ...form, title: form.title.trim(), description: form.description.trim(), locationDetails: form.locationDetails.trim(),
        roomId: form.roomId || null, assetId: form.assetId || null, busId: form.busId || null,
      });
      // Keep the same key after a lost response so Retry cannot create a second
      // complaint. Editing the submitted contents starts a new attempt.
      if (attempt.current?.body !== body) attempt.current = { body, key: newSubmissionKey() };
      const result = await complaintRequest<{ complaint: Complaint; replayed: boolean }>("/api/complaints", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key }, body,
      });
      setForm(initialForm);
      attempt.current = null;
      onSaved(result.complaint);
    } catch (cause) {
      setError(requestError(cause) + (cause instanceof ComplaintRequestError ? "" : " Your form is still here; retry to check whether it was saved."));
      if (cause instanceof ComplaintRequestError) {
        setFields(cause.fields);
        focusField(Object.keys(cause.fields)[0]);
      }
    } finally {
      window.clearTimeout(timeout);
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Submit a complaint">
      <div className="border-b border-slate-100 px-6 py-5 sm:px-8">
        <h2 className="text-lg font-bold">Report a campus issue</h2>
        <p className="mt-2 text-xs leading-6 text-slate-500">Describe what happened, who is affected, and where the team should look. Fields marked * are required.</p>
      </div>
      <div className="space-y-6 p-6 sm:p-8">
        {error && <div role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
          <p>{error}</p>
          {Object.keys(fields).length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {Object.entries(fields).map(([field, message]) => <li key={field}><a href={`#complaint-${field}`} className="underline">{fieldLabels[field] ?? field}: {message}</a></li>)}
          </ul>}
        </div>}

        <section aria-label="Describe with AI" className="rounded-lg border border-violet-200 bg-violet-50/50 p-4">
          <label htmlFor="complaint-story" className="mb-2 block text-xs font-semibold text-violet-900">✦ Just tell us what&apos;s wrong — AI will fill in the form</label>
          <textarea id="complaint-story" rows={3} maxLength={4000} value={story} disabled={pending || drafting} onChange={(event) => setStory(event.target.value)}
            placeholder="e.g. The projector in Academic Block classroom 104 keeps switching off and our 2pm lecture can't start" className={inputStyle} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <AiButton busy={drafting} disabled={pending || !story.trim()} onClick={fillWithAi}>{drafting ? "Reading your description..." : "Fill the form for me"}</AiButton>
            <span className="text-[11px] text-slate-500">Check the filled fields below before submitting.</span>
          </div>
          {draftError && <p role="alert" className="mt-2 text-xs text-red-700">{draftError}</p>}
          {draft && <div className="mt-3 text-xs leading-6">
            {draft.followUpQuestions.length > 0 && <><p className="font-semibold text-violet-900">To help the team, please add:</p>
              <ul className="list-disc pl-5 text-slate-700">{draft.followUpQuestions.map((item) => <li key={item}>{item}</li>)}</ul></>}
            <AiSource value={draft} />
          </div>}
        </section>

        <fieldset disabled={pending} className="space-y-6">
          <div>
            <label htmlFor="complaint-title" className={labelStyle}>Short title *</label>
            <input id="complaint-title" name="title" value={form.title} onChange={(event) => update("title", event.target.value)} required minLength={5} maxLength={120} placeholder="For example, projector is not displaying in Classroom 104" className={inputStyle} {...errorProps("title")} />
            {fieldError("title")}
          </div>
          <div>
            <label htmlFor="complaint-description" className={labelStyle}>What happened? *</label>
            <textarea id="complaint-description" name="description" value={form.description} onChange={(event) => update("description", event.target.value)} required minLength={20} maxLength={4000} rows={6} placeholder="Include when it started, what you observed, and how activities are affected." className={`${inputStyle} resize-y leading-6`} {...errorProps("description")} />
            <p className="mt-2 text-right font-mono text-[10px] text-slate-500">{form.description.length.toLocaleString("en-IN")} / 4,000 characters</p>
            {fieldError("description")}
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label htmlFor="complaint-category" className={labelStyle}>Issue type *</label>
              <select id="complaint-category" name="category" value={form.category} onChange={(event) => update("category", event.target.value)} required className={inputStyle} {...errorProps("category")}>
                <option value="">Choose an issue type</option>
                {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {fieldError("category")}
            </div>
            <div>
              <label htmlFor="complaint-reportedUrgency" className={labelStyle}>Reported urgency *</label>
              <select id="complaint-reportedUrgency" name="reportedUrgency" value={form.reportedUrgency} onChange={(event) => update("reportedUrgency", event.target.value)} required className={inputStyle} {...errorProps("reportedUrgency")}>
                {urgencyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {fieldError("reportedUrgency")}
            </div>
          </div>
          <p className="-mt-2 text-xs leading-6 text-slate-500">Your reported urgency is saved for the operations team to review. The team sets its own work priority.</p>

          <div className="border-t border-slate-100 pt-6">
            <h3 className="mb-5 text-sm font-semibold">Where is the issue?</h3>
            {loading && <p role="status" className="mb-4 text-xs text-slate-500">Loading campus locations...</p>}
            {loadError && <div role="alert" className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900">{loadError} <button type="button" onClick={onRetry} disabled={loading} className="font-semibold underline">Retry loading locations</button></div>}
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="complaint-buildingId" className={labelStyle}>Campus location *</label>
                <select id="complaint-buildingId" name="buildingId" value={form.buildingId} onChange={(event) => update("buildingId", event.target.value)} required disabled={!options || loading} className={inputStyle} {...errorProps("buildingId")}>
                  <option value="">Choose a location</option>
                  {options?.buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
                </select>
                {fieldError("buildingId")}
              </div>
              <div>
                <label htmlFor="complaint-roomId" className={labelStyle}>Room or venue <span className="font-normal text-slate-500">(optional)</span></label>
                <select id="complaint-roomId" name="roomId" value={form.roomId} onChange={(event) => update("roomId", event.target.value)} disabled={!form.buildingId || !rooms.length || loading} className={inputStyle} {...errorProps("roomId")}>
                  <option value="">{form.buildingId && !rooms.length ? "No registered rooms here" : "Whole location / not sure"}</option>
                  {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                </select>
                {fieldError("roomId")}
              </div>
              <div>
                <label htmlFor="complaint-assetId" className={labelStyle}>Equipment <span className="font-normal text-slate-500">(optional)</span></label>
                <select id="complaint-assetId" name="assetId" value={form.assetId} onChange={(event) => update("assetId", event.target.value)} disabled={!form.roomId || !assets.length || loading} className={inputStyle} {...errorProps("assetId")}>
                  <option value="">{!form.roomId ? "Choose a room first" : !assets.length ? "No registered equipment here" : "Not applicable / not sure"}</option>
                  {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} ({asset.assetTag})</option>)}
                </select>
                {fieldError("assetId")}
              </div>
              {form.category === "TRANSPORT" && <div>
                <label htmlFor="complaint-busId" className={labelStyle}>Bus <span className="font-normal text-slate-500">(optional)</span></label>
                <select id="complaint-busId" name="busId" value={form.busId} onChange={(event) => update("busId", event.target.value)} disabled={!options || loading} className={inputStyle} {...errorProps("busId")}>
                  <option value="">Not applicable / not sure</option>
                  {options?.buses.map((bus) => <option key={bus.id} value={bus.id}>{bus.fleetCode}</option>)}
                </select>
                {fieldError("busId")}
              </div>}
            </div>
            <div className="mt-6">
              <label htmlFor="complaint-locationDetails" className={labelStyle}>More location details <span className="font-normal text-slate-500">(optional)</span></label>
              <input id="complaint-locationDetails" name="locationDetails" value={form.locationDetails} onChange={(event) => update("locationDetails", event.target.value)} maxLength={200} placeholder="For example, second-floor corridor near the stairs" className={inputStyle} {...errorProps("locationDetails")} />
              {fieldError("locationDetails")}
            </div>
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-6">
          <p className="max-w-sm text-xs leading-6 text-slate-500">Your complaint will be saved and shared with the campus operations team. You can follow its status in My complaints.</p>
          <button type="submit" disabled={pending || !options || loading} className="rounded bg-[#142943] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#213e61] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500 disabled:opacity-50">
            {pending ? "Submitting..." : "Submit complaint"}
          </button>
        </div>
      </div>
    </form>
  );
}
