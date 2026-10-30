"use client";

import { useEffect } from "react";

export function SessionMonitor() {
  useEffect(() => {
    const controller = new AbortController();
    async function checkSession() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (response.status === 401) window.location.replace("/login?expired=1");
      } catch {
        // A connection failure is not proof that the session has expired.
      }
    }
    const checkVisible = () => {
      if (document.visibilityState === "visible") void checkSession();
    };
    const timer = window.setInterval(checkVisible, 60_000);
    window.addEventListener("focus", checkVisible);
    window.addEventListener("pageshow", checkVisible);
    document.addEventListener("visibilitychange", checkVisible);
    void checkSession();
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", checkVisible);
      window.removeEventListener("pageshow", checkVisible);
      document.removeEventListener("visibilitychange", checkVisible);
    };
  }, []);
  return null;
}
