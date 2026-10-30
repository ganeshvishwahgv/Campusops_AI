import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "@/components/login-form";

async function SignedOutLogin({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect("/");
  const params = await searchParams;
  return <LoginForm expired={params.expired === "1"} />;
}

export default function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-[#fafaf8] text-sm text-[#142943]" aria-live="polite">
        Loading sign in...
      </main>
    }>
      <SignedOutLogin searchParams={searchParams} />
    </Suspense>
  );
}
