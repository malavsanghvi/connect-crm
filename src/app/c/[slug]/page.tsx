import { createClient } from "@supabase/supabase-js";
import type { Metadata } from "next";

import type { Database } from "@/lib/database.types";
import { todayInTz } from "@/lib/dates";
import { readPublicEnv } from "@/lib/env";
import { newRequestId, traceHeaders } from "@/lib/supabase/trace";
import { explainError } from "@/lib/errors";
import { tenantBranding } from "@/lib/shell";

import { CommunityDashboard } from "./community-dashboard";

// Public, no sign-in (src/lib/supabase/proxy.ts PUBLIC_PATHS has "/c"). Every
// query here uses an anonymous client with no cookies, so a signed-in visitor
// sees exactly what the public sees: only KPIs published as public.

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

function anonClient() {
  const env = readPublicEnv();
  if (!env.ok) return null;
  return {
    env: env.env,
    db: createClient<Database, "app">(env.env.supabaseUrl, env.env.supabaseAnonKey, {
      db: { schema: "app" },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: traceHeaders({ requestId: newRequestId(), screen: "/c" }) },
    }),
  };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const c = anonClient();
  const res = c ? await c.db.from("centers").select("name, short_name").eq("slug", slug).maybeSingle() : null;
  const name = res?.data ? `${res.data.short_name || res.data.name} Community Dashboard` : "Community Dashboard";
  return { title: { absolute: name }, robots: { index: true, follow: true } };
}

export default async function PublicDashboardPage({ params }: { params: Params }) {
  const { slug } = await params;
  const c = anonClient();
  if (!c) return <Problem title="This dashboard is not available" body="The site is not configured yet." />;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(slug)) return <Problem title="Community not found" body={`There is no community at "/c/${slug}".`} />;
  const res = await c.db.from("centers").select("id, slug, name, short_name, time_zone, branding, status, environment").eq("slug", slug).maybeSingle();
  if (res.error) {
    console.error("[public-dashboard] center lookup failed:", res.error);
    return <Problem title="We could not load this dashboard" body={`${explainError(res.error)}. Please try again in a moment.`} retry />;
  }
  if (!res.data || res.data.status !== "active") return <Problem title="Community not found" body={`There is no public dashboard at "/c/${slug}".`} />;
  const center = res.data;
  const b = tenantBranding({ ...center, slug: String(center.slug) }, c.env.supabaseUrl);
  // Sandboxes have no public dashboard (entitlement public_dashboard; app.public_kpis refuses them too).
  if (center.environment === "sandbox") {
    return <Problem title={`${b.shortName} community dashboard`} body={`${b.shortName} is a sandbox. Sandboxes have no public community dashboard; it opens once the community goes live.`} />;
  }
  // Reports & dashboard switched off (Settings › Modules): say so plainly instead of a load error.
  const on = await c.db.rpc("module_enabled", { p_center: center.id, p_module: "reports" });
  if (on.error) console.error("[public-dashboard] module check failed; loading the dashboard anyway:", on.error);
  else if (on.data === false) {
    return <Problem title={`${b.shortName} community dashboard`} body={`${center.name} isn't publishing its community dashboard right now. Please check back later.`} />;
  }
  const raw = center.branding && typeof center.branding === "object" && !Array.isArray(center.branding) ? (center.branding as Record<string, unknown>) : {};
  const joinUrl = [raw.join_url, raw.website_url, raw.website].find((v): v is string => typeof v === "string" && /^https:\/\//i.test(v)) ?? null;

  return (
    <CommunityDashboard
      env={{ supabaseUrl: c.env.supabaseUrl, supabaseAnonKey: c.env.supabaseAnonKey }}
      slug={String(center.slug)}
      name={center.name}
      shortName={b.shortName}
      branding={b}
      today={todayInTz(center.time_zone)}
      joinUrl={joinUrl}
    />
  );
}

function Problem({ title, body, retry = false }: { title: string; body: string; retry?: boolean }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ground px-4">
      <div role="alert" className="max-w-md rounded-[20px] border border-line bg-white p-6 text-center">
        <h1 className="font-display text-[22px] font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-[14px] text-muted">{body}</p>
        {retry ? (
          <a href="" className="cc-btn cc-btn-primary mt-4 inline-flex">
            Try again
          </a>
        ) : null}
      </div>
    </main>
  );
}
