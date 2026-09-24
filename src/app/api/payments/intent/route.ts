import { NextResponse, type NextRequest } from "next/server";

import { explainError } from "@/lib/errors";
import { startProviderCheckout } from "@/lib/payments/checkout";
import { originOf, tokenClient, type CheckoutInfo } from "@/lib/payments/server";
import { parseIntentRequest } from "@/lib/payments/view";

// The member app's (and the portal's) way to pay online:
//   POST { center_id, household_id, amount_cents, pledge_ids, processor?, context, for_label, return_url? }
//   Authorization: Bearer <the member's own Supabase access token>
// → app.create_checkout checks the member (adult of the family, open pledges of
//   that family, the organization's default processor; a sandbox is forced to
//   test mode) and records the checkout; the provider returns its page.
// Answer: { checkout_id, url, mode, processor } — the app opens url and then
// polls app.checkout_status. The payment itself is recorded only from the
// provider's webhook. No cookies are used, so any origin may call it.
export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "600",
};
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: CORS });

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return reply(401, { error: "Sign in to pay." });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "The request body must be JSON." });
  }
  const parsed = parseIntentRequest(body);
  if (!parsed.ok) return reply(400, { error: parsed.error });
  const r = parsed.value;
  const db = tokenClient(token, "member", "/api/payments/intent");
  if (!db) return reply(503, { error: "Community Connect is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)." });
  const { data, error } = await db.rpc("create_checkout", {
    p_center: r.center_id,
    p_household: r.household_id,
    p_amount_cents: r.amount_cents,
    p_pledge_ids: r.pledge_ids,
    p_processor: r.processor as string,
    p_context: r.context,
    p_for_label: r.for_label,
  });
  if (error) {
    const status = error.code === "42501" || /JWT|jwt/.test(error.message) ? 403 : error.code === "CCENT" ? 409 : 400;
    if (status !== 400) console.error("[payments/intent] create_checkout refused:", error);
    return reply(status, { error: explainError(error) });
  }
  const started = await startProviderCheckout(db, data as unknown as CheckoutInfo, originOf(req.headers, req.nextUrl.origin), r.return_url);
  if (!started.ok) return reply(started.status, { error: started.error, checkout_id: (data as { checkout_id?: string }).checkout_id });
  return reply(200, { checkout_id: started.checkoutId, url: started.url, mode: started.mode, processor: started.processor });
}
