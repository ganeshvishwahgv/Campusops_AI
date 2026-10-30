"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LensAnswer } from "@/lib/ai/types";
import { complaintRequest, requestError } from "./complaint-shared";
import { AiButton, AiSource } from "./ai-shared";

type Turn = { role: "user" | "assistant"; text: string; answer?: LensAnswer };
const starters = [
  "What should I prioritise in the next hour?",
  "Which rooms are out of service and what does that affect?",
  "Which technicians have spare capacity right now?",
  "Are any incidents likely duplicates of each other?",
];

export function OpsLens({ onSelectIncident }: { onSelectIncident: (id: string) => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [turns, loading]);

  async function ask(text: string, event?: FormEvent) {
    event?.preventDefault();
    const q = text.trim();
    if (!q || loading) return;
    setError(""); setQuestion("");
    const history = turns.map(({ role, text: content }) => ({ role, text: content }));
    setTurns((list) => [...list, { role: "user", text: q }]);
    setLoading(true);
    try {
      const answer = await complaintRequest<LensAnswer>("/api/ai/lens", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, history }),
      });
      setTurns((list) => [...list, { role: "assistant", text: answer.answer, answer }]);
    } catch (cause) { setError(requestError(cause)); }
    finally { setLoading(false); }
  }

  const last = [...turns].reverse().find((turn) => turn.answer)?.answer;

  return <section className="flex min-h-[560px] flex-col overflow-hidden rounded-lg border border-violet-200 bg-white" aria-label="OpsLens">
    <div className="border-b border-violet-100 bg-gradient-to-r from-white to-violet-50 p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-violet-800">✦ OpsLens</p>
      <p className="mt-2 text-xs leading-6 text-slate-600">Ask about incidents, rooms, bookings, technicians and buses. Answers use a live snapshot of campus records; OpsLens reads data but never changes it.</p>
    </div>
    <div className="flex-1 space-y-4 overflow-auto p-5" aria-live="polite">
      {!turns.length && <div className="grid gap-2 sm:grid-cols-2">{starters.map((text) => <button key={text} type="button" onClick={() => void ask(text)} className="rounded-lg border border-slate-200 p-3 text-left text-xs hover:border-violet-400 hover:bg-violet-50/40">{text}</button>)}</div>}
      {turns.map((turn, index) => <div key={index} className={turn.role === "user" ? "flex justify-end" : ""}>
        <div className={`max-w-[85%] rounded-lg px-4 py-3 text-xs leading-6 ${turn.role === "user" ? "bg-[#142943] text-white" : "border border-slate-200 bg-[#fafaf8]"}`}>
          <p className="whitespace-pre-wrap break-words">{turn.text}</p>
          {turn.answer && turn.answer.references.length > 0 && <p className="mt-2 flex flex-wrap gap-2 text-[10px]">{turn.answer.references.map((ref) => /^(INC|REQ)-/.test(ref)
            ? <button key={ref} type="button" onClick={() => onSelectIncident(ref)} className="font-mono font-semibold text-amber-800 underline">{ref}</button>
            : <span key={ref} className="rounded bg-white px-1.5 py-0.5 text-slate-500">{ref}</span>)}</p>}
          {turn.answer && <AiSource value={turn.answer} />}
        </div>
      </div>)}
      {loading && <p className="text-xs text-violet-800"><span className="animate-pulse">✦ Thinking...</span></p>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <div ref={end} />
    </div>
    {last && last.followUps.length > 0 && !loading && <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-3">{last.followUps.map((text) => <button key={text} type="button" onClick={() => void ask(text)} className="rounded-full border border-violet-200 px-3 py-1 text-[11px] text-violet-900 hover:bg-violet-50">{text}</button>)}</div>}
    <form onSubmit={(event) => void ask(question, event)} className="flex gap-2 border-t border-slate-200 p-4">
      <input aria-label="Ask OpsLens" value={question} maxLength={1000} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask anything about campus operations..." className="min-w-0 flex-1 rounded border border-slate-300 bg-[#fafaf8] px-3 py-2.5 text-sm outline-none focus:border-violet-500" />
      <AiButton busy={loading} onClick={() => void ask(question)} disabled={!question.trim()}>Ask</AiButton>
    </form>
  </section>;
}
