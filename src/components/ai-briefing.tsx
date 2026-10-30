"use client";

import { useEffect, useState } from "react";
import type { Briefing } from "@/lib/ai/types";
import { complaintRequest, requestError } from "./complaint-shared";
import { AiButton, AiSource } from "./ai-shared";

export function AiBriefing({ onSelectIncident, onAskLens }: { onSelectIncident: (id: string) => void; onAskLens: () => void }) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const result = await complaintRequest<Briefing>("/api/ai/briefing", { signal: controller.signal });
        if (!controller.signal.aborted) setBriefing(result);
      } catch (cause) { if (!controller.signal.aborted) setError(requestError(cause)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  return <section aria-label="AI operations briefing" className="overflow-hidden rounded-lg border border-violet-200 bg-gradient-to-br from-white via-white to-violet-50/70">
    <div className="flex flex-wrap items-start justify-between gap-3 p-5">
      <div className="min-w-0 max-w-3xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-violet-800">✦ Shift briefing</p>
        {loading && !briefing ? <div className="mt-3 space-y-2" aria-live="polite"><div className="h-5 w-72 max-w-full animate-pulse rounded bg-violet-100" /><div className="h-3 w-full animate-pulse rounded bg-slate-100" /><p className="sr-only">Generating briefing...</p></div>
          : briefing ? <>
            <h2 className="mt-2 text-lg font-bold leading-7">{briefing.headline}</h2>
            <p className="mt-2 text-xs leading-6 text-slate-600">{briefing.situation}</p>
          </> : <p role="alert" className="mt-2 text-xs text-red-700">{error || "Briefing unavailable."}</p>}
        {briefing && <AiSource value={briefing} />}
      </div>
      <div className="flex gap-2">
        <AiButton busy={loading} onClick={() => setRevision((value) => value + 1)}>{loading ? "Analysing..." : "Refresh briefing"}</AiButton>
        <button type="button" onClick={onAskLens} className="rounded border border-violet-300 bg-white px-4 py-2.5 text-xs font-semibold text-violet-900 hover:bg-violet-50">Ask OpsLens</button>
      </div>
    </div>
    {briefing && (briefing.risks.length > 0 || briefing.actions.length > 0) && <div className="grid gap-4 border-t border-violet-100 p-5 lg:grid-cols-2">
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Top risks</h3>
        <ul className="mt-3 space-y-3">
          {briefing.risks.map((risk) => <li key={risk.title} className="rounded border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold">{risk.title}</p>
            <p className="mt-1 text-[11px] leading-5 text-slate-600">{risk.detail}</p>
            {risk.incidentIds.length > 0 && <p className="mt-2 flex flex-wrap gap-2">{risk.incidentIds.map((id) => <button key={id} type="button" onClick={() => onSelectIncident(id)} className="font-mono text-[10px] font-semibold text-amber-800 underline underline-offset-2">{id}</button>)}</p>}
          </li>)}
        </ul>
      </div>
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Recommended actions</h3>
        <ol className="mt-3 space-y-2">
          {briefing.actions.map((action, index) => <li key={action} className="flex gap-3 text-xs leading-5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#142943] text-[10px] font-bold text-white">{index + 1}</span>{action}</li>)}
        </ol>
      </div>
    </div>}
  </section>;
}
