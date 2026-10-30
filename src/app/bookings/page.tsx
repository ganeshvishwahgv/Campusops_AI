import { Suspense } from "react";
import { redirect } from "next/navigation";
import { BookingsWorkspace } from "@/components/bookings-workspace";
import { canAccessBookings, canViewDashboard } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata = { title: "Room bookings | CampusOps" };
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

async function BookingsContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessBookings(user.role)) redirect("/");
  const params = await searchParams;
  return <BookingsWorkspace user={user}
    initialId={typeof params.booking === "string" ? params.booking : null}
    initialIncident={canViewDashboard(user.role) && typeof params.incident === "string" ? params.incident : null} />;
}

export default function BookingsPage({ searchParams }: { searchParams: SearchParams }) {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-[#fafaf8] px-6 text-sm text-[#142943]" aria-live="polite">Opening room bookings...</main>}>
    <BookingsContent searchParams={searchParams} />
  </Suspense>;
}
