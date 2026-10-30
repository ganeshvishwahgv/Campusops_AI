"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "./complaint-shared";

type Notification = { id: string; kind: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };
type Feed = { items: Notification[]; unread: number };

const icons: Record<string, string> = {
  TASK_ASSIGNED: "🛠", TASK_REASSIGNED: "↪", COMPLAINT_RESOLVED: "✅", COMPLAINT_CLOSED: "✔", COMPLAINT_UPDATE: "ℹ",
  NEW_COMPLAINT: "📝", WORK_RESOLVED: "✅", WORK_BLOCKED: "⛔", BUS_BREAKDOWN: "🚨", TRANSPORT_REPORT: "🚌",
};

async function send(path: string, init?: RequestInit): Promise<Feed | null> {
  const response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return null;
  return response.json();
}

export function NotificationBell() {
  const router = useRouter();
  const [feed, setFeed] = useState<Feed>({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Notification | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const result = await send("/api/notifications").catch(() => null);
    if (!result) return;
    // Pop a short toast for anything that arrived since the last check (not on first load).
    if (seen.current) {
      const fresh = result.items.find((item) => !item.readAt && !seen.current!.has(item.id));
      if (fresh) setToast(fresh);
    }
    seen.current = new Set(result.items.map((item) => item.id));
    setFeed(result);
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 15_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(first); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!panel.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);

  async function markRead(body: object) {
    const result = await send("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (result) setFeed(result);
  }

  async function openItem(item: Notification) {
    if (!item.readAt) await markRead({ ids: [item.id] });
    setOpen(false); setToast(null);
    if (item.link) router.push(item.link);
  }

  return <div ref={panel} className="relative">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`Notifications${feed.unread ? `, ${feed.unread} unread` : ""}`}
      className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/25 text-base hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-400">
      <span aria-hidden="true">🔔</span>
      {feed.unread > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] rounded-full bg-amber-400 px-1 text-center text-[10px] font-bold leading-[18px] text-[#142943]">{feed.unread > 99 ? "99+" : feed.unread}</span>}
    </button>

    {open && <div className="absolute right-0 z-[2000] mt-2 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-lg border border-slate-200 bg-white text-[#172b46] shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-bold">Notifications</p>
        <button type="button" disabled={!feed.unread} onClick={() => void markRead({ all: true })} className="text-[11px] font-semibold text-amber-800 hover:underline disabled:opacity-40">Mark all read</button>
      </div>
      <ul className="max-h-[420px] divide-y divide-slate-100 overflow-auto">
        {feed.items.map((item) => <li key={item.id}>
          <button type="button" onClick={() => void openItem(item)} className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50 ${item.readAt ? "" : "bg-amber-50/60"}`}>
            <span aria-hidden="true" className="text-base">{icons[item.kind] ?? "•"}</span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold leading-5">{item.title}</span>
              <span className="mt-0.5 block text-[11px] leading-5 text-slate-600">{item.body}</span>
              <span className="mt-1 block text-[10px] text-slate-400">{formatDate(item.createdAt)}</span>
            </span>
            {!item.readAt && <span aria-label="Unread" className="ml-auto mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />}
          </button>
        </li>)}
        {!feed.items.length && <li className="px-4 py-8 text-center text-xs text-slate-500">No notifications yet.</li>}
      </ul>
    </div>}

    {toast && !open && <div role="status" className="fixed right-4 bottom-4 z-[2000] w-[min(360px,calc(100vw-32px))] rounded-lg border border-amber-300 bg-white p-4 text-[#172b46] shadow-2xl">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-lg">{icons[toast.kind] ?? "🔔"}</span>
        <button type="button" onClick={() => void openItem(toast)} className="min-w-0 text-left">
          <span className="block text-xs font-bold">{toast.title}</span>
          <span className="mt-1 block text-[11px] leading-5 text-slate-600">{toast.body}</span>
        </button>
        <button type="button" aria-label="Dismiss" onClick={() => setToast(null)} className="ml-auto text-slate-400 hover:text-slate-700">✕</button>
      </div>
    </div>}
  </div>;
}
