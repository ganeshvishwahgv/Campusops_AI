"use client";

import { useState } from "react";

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("Unable to sign out. Please try again.");
      // A full navigation drops authenticated React state and router caches.
      window.location.replace("/login");
    } catch {
      setError("Unable to sign out. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className="max-w-48">
      <button
        type="button"
        onClick={logout}
        disabled={pending}
        className="rounded border border-white/40 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-400 disabled:opacity-60"
      >
        {pending ? "Signing out..." : "Sign out"}
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-amber-200">{error}</p>}
    </div>
  );
}
