"use client";

import type { Provenance } from "@/lib/ai/types";

export function AiSource({ value }: { value: Provenance }) {
  const claude = value.source === "CLAUDE";
  return <div className="mt-3 space-y-1">
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${claude ? "border-violet-200 bg-violet-50 text-violet-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
      <span aria-hidden="true">{claude ? "✦" : "⚙"}</span>
      {claude ? `Claude AI · ${value.model}` : "Rule-based fallback"}
    </span>
    {value.notice && <p className="text-[10px] leading-5 text-slate-500">{value.notice}</p>}
  </div>;
}

export function AiButton({ children, busy, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button type="button" {...props} disabled={busy || props.disabled}
    className={`inline-flex items-center justify-center gap-2 rounded bg-gradient-to-r from-[#142943] to-[#3b2a6b] px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ""}`}>
    <span aria-hidden="true" className={busy ? "animate-spin" : ""}>✦</span>{children}
  </button>;
}
