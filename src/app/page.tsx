import { Suspense } from "react";
import { redirect } from "next/navigation";
import Dashboard from "@/components/dashboard";
import { RoleLanding } from "@/components/role-landing";
import { getCurrentUser } from "@/lib/auth/session";
import { canViewDashboard } from "@/lib/auth/permissions";

async function AuthenticatedWorkspace() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "STUDENT" || user.role === "FACULTY") redirect("/complaints");
  if (user.role === "TECHNICIAN") redirect("/work-orders");
  if (user.role === "DEPARTMENT_MANAGER") redirect("/bookings");

  return canViewDashboard(user.role)
    ? <Dashboard user={user} />
    : <RoleLanding user={user} />;
}

export default function Home() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-[#fafaf8] px-6 text-sm text-[#142943]" aria-live="polite">
        Opening your CampusOps workspace...
      </main>
    }>
      <AuthenticatedWorkspace />
    </Suspense>
  );
}
