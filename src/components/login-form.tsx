"use client";

import { useState, type FormEvent } from "react";

export function LoginForm({ expired }: { expired: boolean }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: fields.get("username"),
          password: fields.get("password"),
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setError(result?.error ?? "Unable to sign in. Please try again.");
        setPending(false);
        return;
      }
      window.location.replace("/");
    } catch {
      setError("Cannot reach CampusOps. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#fafaf8] font-sans text-[#172b46]">
      <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-5 sm:px-10">
        <span className="text-xl font-black tracking-tight">CAMPUS<span className="text-amber-500">/</span>OPS</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">Easwari Engineering College</span>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 sm:px-10 sm:py-20 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:gap-20">
        <section>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-700">Campus operations &amp; recovery</p>
          <h1 className="mt-4 max-w-lg text-4xl font-bold leading-tight tracking-tight sm:text-5xl">One campus.<br />A coordinated response.</h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-slate-500">Your workspace for campus incidents, resources, and recovery. Sign in to access the tools available for your role.</p>

          <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {/* Keep the existing approximate campus illustration unchanged. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/campus-map.png" alt="Illustrated Easwari campus" className="block h-auto w-full" />
            <p className="border-t border-slate-100 px-4 py-3 font-mono text-[9px] uppercase tracking-wider text-slate-500">Illustrative campus map · Fictional operational records</p>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-7 shadow-sm sm:p-10" aria-labelledby="login-heading">
          <span className="inline-block rounded border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-amber-800">Campus workspace</span>
          <h2 id="login-heading" className="mt-5 text-2xl font-bold tracking-tight">Welcome back</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Sign in with your CampusOps account.</p>

          {expired && <p role="status" className="mt-5 rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900">Your session has ended. Please sign in again.</p>}

          <form onSubmit={submit} className="mt-7 space-y-5">
            <div>
              <label htmlFor="username" className="mb-2 block text-xs font-semibold">Username</label>
              <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={64} disabled={pending} className="w-full rounded border border-slate-300 bg-[#fafaf8] px-3 py-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 disabled:opacity-60" />
            </div>
            <div>
              <label htmlFor="password" className="mb-2 block text-xs font-semibold">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={128} disabled={pending} className="w-full rounded border border-slate-300 bg-[#fafaf8] px-3 py-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 disabled:opacity-60" />
            </div>
            {error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-3 text-xs leading-6 text-red-700">{error}</p>}
            <button type="submit" disabled={pending} className="w-full rounded bg-[#142943] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#213e61] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500 disabled:opacity-60">
              {pending ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="mt-6 border-t border-slate-100 pt-5 text-xs leading-6 text-slate-500">Need an account or a password reset? Contact your CampusOps administrator.</p>
        </section>
      </div>
      <footer className="mx-auto max-w-6xl px-6 pb-8 font-mono text-[9px] uppercase leading-6 tracking-wider text-slate-400 sm:px-10">Hackathon demonstration · Access is managed by your campus administrator</footer>
    </main>
  );
}
