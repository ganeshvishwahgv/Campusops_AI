import { Suspense } from "react";
import { redirect } from "next/navigation";
import { canManageTransport, canViewDashboard, roleLabels } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import Link from "next/link";
import TransportPanel from "@/components/transport-panel";
import { LogoutButton } from "@/components/logout-button";
import { NotificationBell } from "@/components/notification-bell";
import { SessionMonitor } from "@/components/session-monitor";

export const metadata = { title: "Transport recovery | CampusOps" };

async function TransportContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageTransport(user.role)) redirect("/");
  return <main className="min-h-screen bg-[#fafaf8] text-[#172b46]">
    <SessionMonitor />
    <header className="flex flex-wrap items-center justify-between gap-4 bg-[#142943] px-6 py-5 text-white">
      <div><span className="text-xl font-black tracking-tight">CAMPUS<span className="text-amber-400">/</span>OPS</span><p className="mt-1 text-[10px] text-slate-300">Easwari Engineering College · Transport control</p></div>
      <div className="flex items-center gap-5">
        {canViewDashboard(user.role) && <Link href="/" prefetch={false} className="text-xs font-semibold text-amber-300 hover:underline">Main dashboard</Link>}
        <div className="text-right"><p className="text-xs font-semibold">{user.name}</p><p className="mt-1 text-[10px] text-slate-300">{roleLabels[user.role]}</p></div>
        <NotificationBell /><LogoutButton />
      </div>
    </header>
    <section className="mx-auto max-w-[1500px] px-5 py-8 sm:px-8"><h1 className="text-3xl font-bold tracking-tight">Transportation and rescue</h1><p className="mt-3 mb-7 text-sm leading-7 text-slate-500">Follow the live fleet, handle breakdowns, and dispatch nearby buses with free seats.</p><TransportPanel canAssign={canViewDashboard(user.role)} /></section>
  </main>;
}

export default function TransportPage() {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-[#fafaf8] text-sm text-[#142943]">Opening transport recovery...</main>}><TransportContent /></Suspense>;
}
