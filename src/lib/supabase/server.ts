import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "@/lib/database.types";
import { readPublicEnv } from "@/lib/env";

export type AppSupabase = SupabaseClient<Database, "app">;

/**
 * Server-side Supabase client bound to the signed-in user's cookies.
 * Create one per request (never share across requests). Every query runs
 * as the user, so RLS in the database decides what comes back.
 */
export async function createSupabaseServerClient(): Promise<AppSupabase> {
  const check = readPublicEnv();
  if (!check.ok) {
    throw new Error(
      `Supabase is not configured: ${check.problems.map((p) => `${p.name} ${p.problem}`).join("; ")}`,
    );
  }
  const cookieStore = await cookies();
  return createServerClient<Database, "app">(check.env.supabaseUrl, check.env.supabaseAnonKey, {
    db: { schema: "app" },
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
