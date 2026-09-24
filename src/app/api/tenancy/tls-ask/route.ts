import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { portalBaseDomain, slugForDomain } from "@/lib/center-resolve";
import type { Database } from "@/lib/database.types";
import { readPublicEnv } from "@/lib/env";
import { newRequestId, traceHeaders } from "@/lib/supabase/trace";
import { resolveHost } from "@/lib/tenancy";

// Caddy's on-demand TLS "ask" endpoint (deploy/release.sh, SITE_WILDCARD_DOMAIN):
// a certificate is issued only for <slug>.<PORTAL_BASE_DOMAIN> of a real
// community, or for a domain registered in app.center_domains. Anything else
// gets 404, so strangers cannot make the server request certificates for
// arbitrary names.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get("domain") ?? "";
  const r = resolveHost(domain, portalBaseDomain());
  if (r.kind === "subdomain") {
    const env = readPublicEnv();
    if (!env.ok) return new NextResponse("not configured", { status: 503 });
    const db = createClient<Database, "app">(env.env.supabaseUrl, env.env.supabaseAnonKey, {
      db: { schema: "app" },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: traceHeaders({ requestId: newRequestId(), screen: "/api/tenancy/tls-ask" }) },
    });
    // Centers are publicly readable while active or onboarding (0010 centers_public_read).
    const { data, error } = await db.from("centers").select("id").eq("slug", r.slug).maybeSingle();
    if (error) {
      console.error(`[tls-ask] could not check "${domain}":`, error);
      return new NextResponse("lookup failed", { status: 503 });
    }
    return data ? new NextResponse("ok") : new NextResponse("unknown community", { status: 404 });
  }
  if (r.kind === "custom") {
    return (await slugForDomain(r.host)) ? new NextResponse("ok") : new NextResponse("unknown domain", { status: 404 });
  }
  // The base domain itself (the landing address) is always served.
  const base = portalBaseDomain();
  return base && (domain.toLowerCase() === base || domain.toLowerCase() === `www.${base}`)
    ? new NextResponse("ok")
    : new NextResponse("not a portal address", { status: 404 });
}
