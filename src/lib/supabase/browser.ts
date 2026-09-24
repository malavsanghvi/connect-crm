"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import type { PublicEnv } from "@/lib/env";
import { tracingFetch } from "@/lib/supabase/trace";

let client: SupabaseClient<Database, "app"> | null = null;

/** Browser Supabase client (auth UI only). The env is passed in from the server so a missing value is caught once, on the server. */
export function getSupabaseBrowserClient(env: Pick<PublicEnv, "supabaseUrl" | "supabaseAnonKey">) {
  if (!client) {
    client = createBrowserClient<Database, "app">(env.supabaseUrl, env.supabaseAnonKey, {
      db: { schema: "app" },
      // x-client-app, a fresh x-request-id and the current screen on every request.
      global: { fetch: tracingFetch(() => window.location.pathname) },
    });
  }
  return client;
}
