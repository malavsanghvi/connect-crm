import type { Metadata } from "next";

import { TenantMark } from "@/components/shell/tenant-mark";
import { SetupScreen } from "@/components/setup-screen";
import { PRODUCT_NAME } from "@/lib/brand";
import { readPublicEnv } from "@/lib/env";
import { explainError } from "@/lib/errors";
import { tenantBranding, type TenantBranding } from "@/lib/shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

type Tenant = { name: string; branding: TenantBranding } | null;

/** The community this portal serves (centers are readable without signing in). */
async function loadTenant(slug: string): Promise<{ tenant: Tenant; problem: string | null }> {
  try {
    const db = await createSupabaseServerClient();
    const { data, error } = await db
      .from("centers")
      .select("name, short_name, slug, branding")
      .eq("slug", slug)
      .maybeSingle();
    if (error) {
      console.error("[login] could not load the center:", error);
      return { tenant: null, problem: `Could not load your community's details — ${explainError(error)}. You can still sign in.` };
    }
    if (!data) {
      console.error(`[login] no active center with slug "${slug}"`);
      return { tenant: null, problem: `No active community is set up with the short name "${slug}". Check NEXT_PUBLIC_CENTER_SLUG.` };
    }
    return { tenant: { name: data.name, branding: tenantBranding({ ...data, slug: String(data.slug) }) }, problem: null };
  } catch (error) {
    console.error("[login] loading the center threw:", error);
    return { tenant: null, problem: `Could not load your community's details — ${explainError(error)}. You can still sign in.` };
  }
}

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
  const { tenant, problem } = await loadTenant(check.env.centerSlug);
  const community = tenant?.name ?? "your community";

  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-[560px_minmax(0,1fr)]">
      <section className="flex flex-col gap-[18px] bg-navy px-8 py-10 text-white lg:p-14">
        <div className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-white">
          {tenant ? (
            <TenantMark branding={tenant.branding} name={tenant.name} size={58} />
          ) : (
            <span aria-hidden className="font-display text-2xl font-semibold text-navy">
              CC
            </span>
          )}
        </div>
        <div>
          <h1 className="font-display text-[38px] font-semibold leading-[1.15]">{PRODUCT_NAME}</h1>
          <p className="mt-1 text-base font-semibold text-navy-200">
            Admin portal{tenant ? ` · ${tenant.name}` : ""}
          </p>
        </div>
        <p className="max-w-[460px] text-base leading-normal text-navy-200">
          Run households, memberships, giving and accounting for {community} in one place. You see only what your role
          allows.
        </p>
        <div className="hidden flex-grow lg:block" />
        <p className="text-[13px] leading-relaxed text-navy-200">
          Every change to a record — payments, approvals, role grants — is kept in a tamper-evident audit log.
          <br />
          You sign in with a one-time code sent to your email. There is no password.
        </p>
      </section>

      <section className="px-6 py-10 sm:px-[72px] lg:py-14">
        <div className="flex w-full max-w-[400px] flex-col gap-4">
          {problem ? (
            <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
              {problem}
            </p>
          ) : null}
          <LoginForm supabaseUrl={check.env.supabaseUrl} supabaseAnonKey={check.env.supabaseAnonKey} next={next} />
        </div>
      </section>
    </main>
  );
}
