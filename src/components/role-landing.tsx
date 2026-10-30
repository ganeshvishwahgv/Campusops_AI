import type { Role } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/lib/auth/session";
import { roleLabels } from "@/lib/auth/permissions";
import { LogoutButton } from "@/components/logout-button";
import { NotificationBell } from "@/components/notification-bell";
import { SessionMonitor } from "@/components/session-monitor";

const upcoming: Partial<Record<Role, { title: string; description: string }>> = {
  DEPARTMENT_MANAGER: { title: "Department workspace", description: "Department-scoped incidents, assignments, and approvals are planned for a later project stage." },
  PROCUREMENT_APPROVER: { title: "Procurement workspace", description: "Purchase review and approval workflows are planned for a later project stage." },
};

export function RoleLanding({ user }: { user: CurrentUser }) {
  const workspace = upcoming[user.role];
  return (
    <main className="min-h-screen bg-[#fafaf8] font-sans text-[#172b46]">
      <SessionMonitor />
      <header className="flex flex-wrap items-center justify-between gap-5 bg-[#142943] px-6 py-5 text-white sm:px-10">
        <div><span className="text-xl font-black tracking-tight">CAMPUS<span className="text-amber-400">/</span>OPS</span><p className="mt-1 text-[10px] text-slate-300">Easwari Engineering College</p></div>
        <div className="flex items-center gap-5"><div className="text-right"><p className="text-xs font-semibold">{user.name}</p><p className="mt-1 text-[10px] text-slate-300">{roleLabels[user.role]}</p></div><NotificationBell /><LogoutButton /></div>
      </header>
      <section className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber-700">Signed in · {roleLabels[user.role]}</p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">{workspace?.title ?? "Your workspace"}</h1>
        <p className="mt-3 text-sm text-slate-500">Welcome, {user.name}.{user.department ? ` ${user.department} department.` : ""}</p>
        <div className="mt-8 rounded-lg border border-slate-200 bg-white p-7">
          <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-[9px] font-semibold uppercase text-amber-800">Module not yet available</span>
          <h2 className="mt-5 text-lg font-semibold">Your account is ready</h2>
          <p className="mt-3 text-sm leading-7 text-slate-600">{workspace?.description ?? "Tools for this role are planned for a later project stage."}</p>
          <p className="mt-4 text-sm leading-7 text-slate-500">The operations dashboard is currently available to facilities and system administrators. Your role has access to this account landing page only.</p>
        </div>
        <p className="mt-6 text-xs leading-6 text-slate-500">If your assigned role is incorrect, contact your CampusOps administrator.</p>
      </section>
    </main>
  );
}
