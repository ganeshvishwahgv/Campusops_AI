import { Suspense } from "react";
import { redirect } from "next/navigation";
import { WorkOrdersWorkspace } from "@/components/work-orders-workspace";
import { canAccessWorkOrders } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata = { title: "Work orders | CampusOps" };
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

async function WorkOrdersContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessWorkOrders(user.role)) redirect("/");
  const query = await searchParams;
  const initialId = typeof query.incident === "string" ? query.incident : null;
  return <WorkOrdersWorkspace user={user} initialId={initialId} />;
}

export default function WorkOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-[#fafaf8] px-6 text-sm text-[#142943]" aria-live="polite">Opening your work orders...</main>}>
      <WorkOrdersContent searchParams={searchParams} />
    </Suspense>
  );
}
