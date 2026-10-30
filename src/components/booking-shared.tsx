"use client";

export const bookingSubmit = "rounded bg-[#142943] px-5 py-3 text-xs font-semibold text-white hover:bg-[#203e61] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50";

// An explicit fixed offset keeps entered campus times consistent across browsers.
export function toIstInput(value: string): string {
  return new Date(new Date(value).getTime() + 330 * 60_000).toISOString().slice(0, 16);
}

export function fromIstInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Enter a complete date and time.");
  return new Date(`${value}:00+05:30`).toISOString();
}

export function BookingStatus({ status }: { status: string }) {
  return <span className={`inline-flex rounded border px-2 py-1 text-[10px] font-semibold ${status === "CANCELLED" ? "border-slate-200 bg-slate-50 text-slate-600" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{status === "CANCELLED" ? "Cancelled" : "Confirmed"}</span>;
}
