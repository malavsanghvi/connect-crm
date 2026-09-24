import type { Metadata } from "next";

import { SetupScreen } from "@/components/setup-screen";
import { readPublicEnv } from "@/lib/env";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const check = readPublicEnv();
  if (!check.ok) return <SetupScreen problems={check.problems} />;
  const sp = await searchParams;
  const rawNext = Array.isArray(sp.next) ? sp.next[0] : sp.next;
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-saffron">Connect</p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-navy">Connect CRM</h1>
          <p className="mt-1 text-sm text-muted">Households, memberships, giving and accounting</p>
        </div>
        <div className="rounded-2xl border border-line bg-card p-7 shadow-sm">
          <LoginForm supabaseUrl={check.env.supabaseUrl} supabaseAnonKey={check.env.supabaseAnonKey} next={next} />
        </div>
        <p className="mt-4 text-center text-xs text-muted">
          Staff sign in with the email on their Connect account. We email a sign-in code — no password.
        </p>
      </div>
    </main>
  );
}
