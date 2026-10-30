import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ComplaintsWorkspace } from "@/components/complaints-workspace";
import { canAccessComplaints } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata = { title: "Complaints | CampusOps" };

async function ComplaintPageContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessComplaints(user.role)) redirect("/");
  return <ComplaintsWorkspace user={user} />;
}

export default function ComplaintsPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-[#fafaf8] px-6 text-sm text-[#142943]" aria-live="polite">
        Opening your complaints workspace...
      </main>
    }>
      <ComplaintPageContent />
    </Suspense>
  );
}
