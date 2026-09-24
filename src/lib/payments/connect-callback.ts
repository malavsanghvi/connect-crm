import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { explainError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { originOf } from "./server";
import { PROCESSOR_LABEL, type Processor } from "./view";

/**
 * The provider sent the person back: hand the code (or merchant id) to
 * app.oauth_store_code as the signed-in user who started (single-use state,
 * 30 minutes). The code goes straight to the vault; the page then shows the
 * connection waiting for the background service.
 */
export async function finishConnect(req: NextRequest, processor: Processor, state: string | null, code: string | null, providerError: string | null) {
  const back = (params: Record<string, string>) =>
    NextResponse.redirect(`${originOf(req.headers, req.nextUrl.origin)}/settings/payments?${new URLSearchParams(params).toString()}`, 303);
  const label = PROCESSOR_LABEL[processor];
  if (providerError) {
    console.warn(`[oauth/${processor}] the provider returned an error: ${providerError}`);
    return back({ connect_error: `${label} did not connect: ${providerError}` });
  }
  if (!state || !code) return back({ connect_error: `${label} sent the person back without an authorization. Start connecting again.` });
  try {
    const db = await createSupabaseServerClient({ reason: `Connecting ${label}` });
    const { error } = await db.rpc("oauth_store_code", { p_state: state, p_code: code });
    if (error) {
      console.error(`[oauth/${processor}] could not keep the authorization:`, error);
      return back({ connect_error: `Could not connect ${label} — ${explainError(error)}.` });
    }
  } catch (err) {
    console.error(`[oauth/${processor}] could not keep the authorization:`, err);
    return back({ connect_error: `Could not connect ${label} — ${err instanceof Error ? err.message : "the server failed"}.` });
  }
  return back({ connected: processor });
}
