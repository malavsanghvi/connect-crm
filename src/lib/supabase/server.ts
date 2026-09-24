import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

import type { Database } from "@/lib/database.types";
import { readPublicEnv } from "@/lib/env";
import { PATHNAME_HEADER, newRequestId, traceHeaders } from "@/lib/supabase/trace";

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
  try {
    screen = (await headers()).get(PATHNAME_HEADER);
  } catch (error) {
    // Outside a request scope there is no screen to report; the audit row just has none.
    console.error("[supabase] could not read the request pathname for x-client-screen:", error);
  }
  return createServerClient<Database, "app">(check.env.supabaseUrl, check.env.supabaseAnonKey, {
    db: { schema: "app" },
    global: { headers: traceHeaders({ requestId: opts.requestId ?? newRequestId(), screen, reason: opts.reason }) },
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
