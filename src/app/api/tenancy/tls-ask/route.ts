import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";
import { readPublicEnv } from "@/lib/env";
import { newRequestId, traceHeaders } from "@/lib/supabase/trace";

// Caddy's on-demand TLS "ask" endpoint (deploy/caddy-sites.mjs): a certificate is
// issued only when app.tls_host_allowed (0330) says so — the portal domain saved in
// Platform setup, the organizations' base domain (saved there, or this server's
// PORTAL_BASE_DOMAIN), <slug>.<base> of a real community, or an organization's own
// domain in app.center_domains. Anything else gets 404, so strangers cannot make the
// server request certificates for arbitrary names. IP addresses are never approved
// here: the droplet's own address has an explicitly configured certificate.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const domain = (request.nextUrl.searchParams.get("domain") ?? "").trim();
  if (!domain) return new NextResponse("no domain given", { status: 400 });
  const env = readPublicEnv();
  if (!env.ok) return new NextResponse("not configured", { status: 503 });
  const db = createClient<Database, "app">(env.env.supabaseUrl, env.env.supabaseAnonKey, {
    db: { schema: "app" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: traceHeaders({ requestId: newRequestId(), screen: "/api/tenancy/tls-ask" }) },
  });
  const { data, error } = await db.rpc("tls_host_allowed", { p_host: domain, p_env_base: process.env.PORTAL_BASE_DOMAIN ?? undefined });
  if (error) {
    // 503: Caddy does not issue, and asks again on the next handshake.
    console.error(`[tls-ask] could not check "${domain}":`, error);
    return new NextResponse("lookup failed", { status: 503 });
  }
  return data ? new NextResponse(`ok: ${data}`) : new NextResponse("not a portal address", { status: 404 });
}
