"use client";

import { useState } from "react";
import Link from "next/link";
import type { TriageAdvice } from "@/lib/ai/types";
import { complaintRequest, readable, requestError } from "./complaint-shared";
import { AiButton, AiSource } from "./ai-shared";

export function AiTriage({ incidentId, onSelectIncident }: { incidentId: string; onSelectIncident?: (id: string) => void }) {
  const [advice, setAdvice] = useState<{ id: string; value: TriageAdvice } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const current = advice?.id === incidentId ? advice.value : null;

  async function analyse() {
    setLoading(true); setError("");
    try {
      const value = await complaintRequest<TriageAdvice>(`/api/ai/triage/${encodeURIComponent(incidentId)}`);
      setAdvice({ id: incidentId, value });
    } catch (cause) { setError(requestError(cause)); }
    finally { setLoading(false); }
  }

  return <section className="mt-6 rounded-lg border border-violet-200 bg-violet-50/40 p-4" aria-label="AI triage">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-violet-800">✦ AI triage</h3>
      <AiButton busy={loading} onClick={analyse} className="px-3 py-1.5">{loading ? "Analysing..." : current ? "Re-analyse" : "Analyse"}</AiButton>
    </div>
    {error && <p role="alert" className="mt-2 text-[11px] text-red-700">{error}</p>}
    {!current && !loading && !error && <p className="mt-2 text-[11px] leading-5 text-slate-500">Summarise the issue, suggest priority and technician, and spot duplicates.</p>}
    {current && <div className="mt-3 space-y-3 text-xs leading-5">
      <p>{current.summary}</p>
      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded bg-white p-2"><dt className="text-[10px] text-slate-500">Suggested priority</dt><dd className="font-semibold">{readable(current.suggestedPriority)}</dd></div>
        <div className="rounded bg-white p-2"><dt className="text-[10px] text-slate-500">Issue type</dt><dd className="font-semibold">{readable(current.suggestedCategory)}</dd></div>
      </dl>
      <p className="text-[11px] text-slate-600">{current.priorityReason}</p>
      <div className="rounded bg-white p-2"><p className="text-[10px] text-slate-500">Recommended technician</p><p className="font-semibold">{current.technicianName ?? "None available"}</p><p className="text-[11px] text-slate-600">{current.technicianReason}</p></div>
      <div><p className="text-[10px] font-semibold text-slate-500">Impact</p><p className="text-[11px]">{current.impact}</p></div>
      <div><p className="text-[10px] font-semibold text-slate-500">Next steps</p><ol className="mt-1 list-decimal space-y-1 pl-4 text-[11px]">{current.nextSteps.map((step) => <li key={step}>{step}</li>)}</ol></div>
      {current.related.length > 0 && <div><p className="text-[10px] font-semibold text-slate-500">Possibly related</p><ul className="mt-1 space-y-1">{current.related.map((item) =>
        <li key={item.id} className="text-[11px]"><button type="button" onClick={() => onSelectIncident?.(item.id)} className="font-mono font-semibold text-amber-800 underline">{item.id}</button> {item.title} — <span className="text-slate-500">{item.reason}</span></li>)}</ul></div>}
      <AiSource value={current} />
      <Link href={`/work-orders?incident=${encodeURIComponent(incidentId)}`} prefetch={false} className="block text-[11px] font-semibold text-violet-900 underline underline-offset-4">Apply in work orders — you decide</Link>
    </div>}
  </section>;
}
