import { NextResponse, type NextRequest } from "next/server";

import { explainError } from "@/lib/errors";
import { verifyState } from "@/lib/qbo/oauth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadPlatformConfig, platformValue } from "@/lib/platform-setup/server-config";

// Intuit sends the person back here after they signed in and chose a company
// (ONBOARDING_WAVE_B "OAuth"): ?code&state&realmId, or ?error&state.
//   1. the state must carry this server's signature for the signed-in person;
//   2. app.complete_qbo_connect then accepts its nonce once (same person, 15
//      minutes), puts the code in the vault as "oauth.code" and queues the
//      oauth.exchange job; app.fail_qbo_connect records a refusal.
// The code is never logged and never leaves the database call. The person
// always lands back on Accounting › QuickBooks setup with a plain message.

const SETUP = "/accounting/qbo/setup";

function back(request: NextRequest, outcome: "ok" | "error", message: string) {
  const url = new URL(SETUP, request.url);
  url.searchParams.set("connect", outcome);
  url.searchParams.set("msg", message.slice(0, 300));
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  await loadPlatformConfig();
  const secret = platformValue("OAUTH_STATE_SECRET");
  if (secret.length < 32) {
    console.error("[qbo-callback] OAUTH_STATE_SECRET is not set (Platform › Setup, or the portal server's environment); the sign-in cannot be checked");
    return back(request, "error", "QuickBooks isn't configured on the Community Connect server yet (OAUTH_STATE_SECRET is not set). Nothing was connected.");
  }

  let db;
  try {
    db = await createSupabaseServerClient();
  } catch (err) {
    console.error("[qbo-callback] no database client:", err);
    return back(request, "error", "The portal is not configured, so QuickBooks could not be connected.");
  }
  const { data: userData, error: userError } = await db.auth.getUser();
  if (userError || !userData.user) {
    if (userError) console.error("[qbo-callback] could not read the session:", userError.message);
    return back(request, "error", "Your session ended during the QuickBooks sign-in. Sign in and connect QuickBooks again.");
  }

  const state = verifyState(secret, q.get("state"), userData.user.id);
  if (!state) {
    console.error("[qbo-callback] a state that this server did not sign for this person was refused");
    return back(request, "error", "This QuickBooks sign-in link is not valid for you. Start the connection again from QuickBooks setup.");
  }

  const intuitError = q.get("error");
  if (intuitError) {
    const { data, error } = await db.rpc("fail_qbo_connect", { p_nonce: state.nonce, p_error: intuitError });
    if (error) {
      console.error("[qbo-callback] fail_qbo_connect:", error);
      return back(request, "error", `QuickBooks was not connected — ${explainError(error)}.`);
    }
    const r = (data ?? {}) as Record<string, unknown>;
    return back(request, "error", String(r.message ?? r.error ?? "QuickBooks was not connected."));
  }

  const { data, error } = await db.rpc("complete_qbo_connect", {
    p_nonce: state.nonce,
    p_code: q.get("code") ?? "",
    p_realm_id: q.get("realmId") ?? "",
  });
  if (error) {
    console.error("[qbo-callback] complete_qbo_connect:", { code: error.code, message: error.message });
    return back(request, "error", `QuickBooks was not connected — ${explainError(error)}.`);
  }
  const r = (data ?? {}) as Record<string, unknown>;
  if (r.ok !== true) return back(request, "error", String(r.error ?? "QuickBooks was not connected."));
  return back(request, "ok", "Signed in to QuickBooks. Finishing the connection in the background — the company and its chart of accounts appear here within a minute.");
}
