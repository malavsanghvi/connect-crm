import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

import type { Database } from "@/lib/database.types";
import { readPublicEnv } from "@/lib/env";
import { requestIsHttps } from "@/lib/https";
import { PATHNAME_HEADER, newRequestId, traceHeaders } from "@/lib/supabase/trace";
import { normalizeBaseDomain, sharedCookieDomain } from "@/lib/tenancy";

export type AppSupabase = SupabaseClient<Database, "app">;

export type ServerClientOptions = {
  /** Correlates every change in one server request / action (defaults to a new uuid). */
  requestId?: string;
  /** Why the change is being made (sent as x-audit-reason; the audit log keeps it). */
  reason?: string;
};

/**
 * Server-side Supabase client bound to the signed-in user's cookies.
 * Create one per request (never share across requests). Every query runs
 * as the user, so RLS in the database decides what comes back.
 *
 * It sends the traceability headers (src/lib/supabase/trace.ts): the app,
 * the request id, the screen (pathname set by the proxy) and, when given,
 * the reason.
 */
export async function createSupabaseServerClient(opts: ServerClientOptions = {}): Promise<AppSupabase> {
  const check = readPublicEnv();
  if (!check.ok) {
    throw new Error(
      `Supabase is not configured: ${check.problems.map((p) => `${p.name} ${p.problem}`).join("; ")}`,
    );
  }
  const cookieStore = await cookies();
  let screen: string | null = null;
  let host: string | null = null;
  let https = false;
  try {
    const h = await headers();
    screen = h.get(PATHNAME_HEADER);
    host = h.get("host");
    https = requestIsHttps(h.get("x-forwarded-proto"));
  } catch (error) {
    // Outside a request scope there is no screen to report; the audit row just has none.
    console.error("[supabase] could not read the request pathname for x-client-screen:", error);
  }
  return createServerClient<Database, "app">(check.env.supabaseUrl, check.env.supabaseAnonKey, {
    db: { schema: "app" },
    global: { headers: traceHeaders({ requestId: opts.requestId ?? newRequestId(), screen, reason: opts.reason }) },
    // One sign-in for every <slug>.<PORTAL_BASE_DOMAIN> portal (the organization switcher); host-only elsewhere.
    // o-https: Secure session cookies whenever the request came over HTTPS.
    cookieOptions: { domain: sharedCookieDomain(host, normalizeBaseDomain(process.env.PORTAL_BASE_DOMAIN)), secure: https },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch (error) {
          // Expected when called while rendering a Server Component: cookies
          // are read-only there. src/proxy.ts refreshes the session on every
          // request, so the token written here is not lost. Server Actions
          // (where cookies ARE writable) never reach this branch.
          if (process.env.NODE_ENV === "development") {
            console.warn("[supabase] session cookie refresh deferred to the proxy:", error);
          }
        }
      },
    },
  });
}
