import "server-only";

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

import { CENTER_COOKIE, currentOrigin } from "@/lib/center-resolve";
import type { Database } from "@/lib/database.types";
import { readPublicEnv } from "@/lib/env";
import { failure, type ActionResult } from "@/lib/errors";
import { DemoBusyError, demoWorkerQuery } from "@/lib/messaging/server-db";
import { clientIpFrom } from "@/lib/platform-onboarding";
import { createSupabaseServerClient, type AppSupabase } from "@/lib/supabase/server";
import { newRequestId, traceHeaders } from "@/lib/supabase/trace";

import { DEMO_SESSION_HOURS, ipLimitKey, parseBanner, parseChoices, type DemoBannerInfo, type DemoChoices } from "./rules";
import { startDemoSession, type StartDeps } from "./start";

// The server side of "Try the demo" (B88 part 2). The portal holds no service-role key: it reaches the demo sign-in through the
// connect_worker connection it already uses for the sign-in hooks and the platform keys (src/lib/messaging/server-db.ts), calling
// only app.worker_demo_begin / worker_demo_attach, which refuse unless the platform switch is on and the limits allow it.

/**
 * A short hash of the visitor's address, for the rate limit and the audit log. The address itself is never stored. An IPv6 visitor is
 * counted by their /64 (one household or one phone gets a whole /64, so counting single addresses would let them start without limit).
 */
export function hashIp(ip: string | null): string {
  return createHash("sha256").update(`weaver-demo-ip:v1:${ipLimitKey(ip)}`).digest("hex").slice(0, 32);
}

// The demo's own one-connection pool (src/lib/messaging/server-db.ts): a burst of starts can never take the connections the Auth
// hooks and the webhooks use.
async function workerCall(sql: string, params: unknown[]): Promise<unknown> {
  const rows = await demoWorkerQuery<{ r: unknown }>(sql, params);
  if (rows === null) throw new Error("The portal has no database connection for sign-in (PORTAL_DATABASE_URL is not set).");
  return rows[0]?.r ?? null;
}

async function visitorIp(): Promise<string | null> {
  try {
    const h = await headers();
    return clientIpFrom(h.get("x-forwarded-for"), h.get("x-real-ip"));
  } catch (error) {
    console.error("[demo] could not read the request headers (the visitor address is unknown):", error);
    return null;
  }
}

/** Start a demo session for a demo person and set the session cookie. On success the caller redirects to "/". */
export async function startDemoFromRequest(personaId: unknown): Promise<ActionResult<{ centerSlug: string; expiresAt: string }>> {
  const check = readPublicEnv();
  if (!check.ok) return { ok: false, error: "Could not start the demo — the site is not configured. Please try again later." };
  const db = await createSupabaseServerClient({ clientApp: "portal", reason: "Try the demo" });
  const deps: StartDeps = {
    hashIp,
    begin: async (persona, ipHash) => {
      try {
        return await workerCall("select app.worker_demo_begin($1, $2) as r", [persona, ipHash]);
      } catch (error) {
        // Others are already waiting for the demo's one connection: say so as the database would (nothing was signed in).
        if (error instanceof DemoBusyError) return { ok: false, code: "busy" };
        throw error;
      }
    },
    endPrevious: async () => {
      // Only someone who is signed in has a previous session to end (and only they may call it).
      const { data: who } = await db.auth.getClaims();
      if (!who?.claims?.sub) return;
      const { error } = await db.rpc("demo_leave");
      if (error) console.error("[demo] ending the previous demo session failed:", error);
    },
    signIn: async (email, password) => {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error || !data.session) return { ok: false, detail: error ?? "no session came back" };
      return { ok: true, accessToken: data.session.access_token };
    },
    signOut: async () => {
      const { error } = await db.auth.signOut({ scope: "local" });
      if (error) throw error;
    },
    attach: (demoSessionId, authSessionId) => workerCall("select app.worker_demo_attach($1, $2) as r", [demoSessionId, authSessionId]),
  };
  const res = await startDemoSession({ personaId, ip: await visitorIp() }, deps);
  if (!res.ok) return res;
  try {
    const origin = await currentOrigin();
    (await cookies()).set(CENTER_COOKIE, res.data!.centerSlug, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: origin.protocol.startsWith("https"),
      maxAge: DEMO_SESSION_HOURS * 60 * 60,
    });
  } catch (error) {
    return failure("Could not start the demo", error);
  }
  return res;
}

/** End the visitor's own demo session (the database deletes its Auth session), sign out here and forget the demo community. */
export async function leaveDemoFromRequest(): Promise<ActionResult> {
  try {
    const db = await createSupabaseServerClient({ clientApp: "portal", reason: "Leave the demo" });
    const { error } = await db.rpc("demo_leave");
    if (error) console.error("[demo] ending the demo session failed (signing out anyway):", error);
    const { error: outError } = await db.auth.signOut({ scope: "local" });
    if (outError) return failure("Could not leave the demo", outError);
    (await cookies()).delete(CENTER_COOKIE);
  } catch (error) {
    return failure("Could not leave the demo", error);
  }
  return { ok: true };
}

/** The people to choose from (public; the database leaves out addresses). Without a database the list is empty and says so. */
export async function loadDemoChoices(): Promise<{ ok: true; choices: DemoChoices } | { ok: false; error: string }> {
  const env = readPublicEnv();
  if (!env.ok) return { ok: false, error: "The site is not configured yet." };
  try {
    const db = createClient<Database, "app">(env.env.supabaseUrl, env.env.supabaseAnonKey, {
      db: { schema: "app" },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: traceHeaders({ requestId: newRequestId(), screen: "/demo" }) },
    });
    const { data, error } = await db.rpc("demo_choices");
    if (error) throw error;
    return { ok: true, choices: parseChoices(data) };
  } catch (error) {
    const r = failure("Could not load the demo people", error);
    return { ok: false, error: r.error };
  }
}

/** For the banner: the signed-in demo person's own session (null when it is not ok; the proxy has already ended those). */
export async function loadDemoBanner(db: Pick<AppSupabase, "rpc">): Promise<DemoBannerInfo | null> {
  try {
    const { data, error } = await db.rpc("demo_session_state");
    if (error) throw error;
    return parseBanner(data);
  } catch (error) {
    console.error("[demo] could not read the demo session for the banner:", error);
    return null;
  }
}
