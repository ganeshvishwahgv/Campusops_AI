"use client";

export class ComplaintRequestError extends Error {
  constructor(message: string, public status: number, public fields: Record<string, string> = {}) {
    super(message);
  }
}

export async function complaintRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin" });
  if (response.status === 401 || response.status === 403) {
    window.location.replace(response.status === 401 ? "/login?expired=1" : "/");
    throw new ComplaintRequestError("Your access has changed. Opening your workspace...", response.status);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ComplaintRequestError(result?.error ?? "Unable to complete this request. Please try again.", response.status, result?.fields ?? {});
  }
  if (!result) throw new ComplaintRequestError("The server returned an incomplete response. Please try again.", 503);
  return result as T;
}

export function requestError(error: unknown): string {
  return error instanceof ComplaintRequestError
    ? error.message
    : "Cannot reach CampusOps. Check your connection and try again.";
}

export function readable(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }) + " IST";
}

export function ComplaintStatus({ value }: { value: string }) {
  const style = ["RESOLVED", "CLOSED"].includes(value)
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : value === "BLOCKED"
      ? "border-red-200 bg-red-50 text-red-700"
      : ["REPORTED", "NEEDS_CLARIFICATION"].includes(value)
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-blue-200 bg-blue-50 text-blue-800";
  return <span className={`inline-flex rounded border px-2 py-1 text-[10px] font-semibold ${style}`}>{readable(value)}</span>;
}
