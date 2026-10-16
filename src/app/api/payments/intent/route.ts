import { NextResponse, type NextRequest } from "next/server";

import { explainError } from "@/lib/errors";
import { startProviderCheckout } from "@/lib/payments/checkout";
import { originOf, tokenClient, type CheckoutInfo } from "@/lib/payments/server";
import { checkoutRefusalMessage, isCheckoutContext, isCheckoutRefusalCode, parseIntentRequest } from "@/lib/payments/view";

// The member app's (and the portal's) way to pay online:
//   POST { center_id, household_id, amount_cents /* the GIFT */, pledge_ids, processor?, context, for_label, return_url?,
//          cover_fee?, chip_in_cents?, pay_method?, expected_total_cents? }
//   Authorization: Bearer <the member's own Supabase access token>
// → app.create_checkout checks the member (adult of the family, open pledges of
//   that family, the organization's default processor; a sandbox is forced to
//   test mode), works out the covered card fee and the Chip In (docs/PAYMENT_ADDONS.md §6.6) and records the checkout;
//   the provider returns its page. This route calculates nothing: the optional fields below are passed through and
//   the Stripe page is built only from the numbers the database returned.
//     cover_fee            true when the payer ticked "add the card fee" (default false)
//     chip_in_cents        the Chip In the payer chose (default 0)
//     pay_method           "card" | "ach", the method chosen first (the database defaults it)
//     expected_total_cents the total the payer saw from app.payment_addons_quote; a different total is refused (409, CCTOT)
//   An app that sends none of them is charged exactly as before.
// Answer: { checkout_id, url, mode, processor, gift_cents?, covered_fee_cents?, chip_in_cents?, total_cents?, lines? } — the app opens url and then
// polls app.checkout_status. The payment itself is recorded only from the
// provider's webhook. A refused add-on answers 409 { error, code } with code CCFEE (card fee not allowed), CCCHP (Chip In not
// available), CCLIM (over the yearly Chip In limit) or CCTOT (the total changed): nothing was charged, and the app asks the
// database for a fresh quote and shows it again. No cookies are used, so any origin may call it.
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
  // An app sending a context this portal does not know is still served (as "other"), but never silently (F17).
  const sent = (body as { context?: unknown }).context;
  if (sent !== undefined && !isCheckoutContext(sent)) {
    console.warn(`[payments/intent] unknown checkout context ${JSON.stringify(sent)} is recorded as "other".`);
  }
  const db = tokenClient(token, "member", "/api/payments/intent");
  if (!db) return reply(503, { error: "Weaver is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)." });
  // The add-ons are sent only when the payer chose them, so a payer who chose none reaches the database exactly as before.
  const { data, error } = await db.rpc("create_checkout", {
    p_center: r.center_id,
    p_household: r.household_id,
    p_amount_cents: r.amount_cents,
    p_pledge_ids: r.pledge_ids,
    p_processor: r.processor as string,
    p_context: r.context,
    p_for_label: r.for_label,
    ...(r.cover_fee ? { p_cover_fee: true } : {}),
    ...(r.chip_in_cents > 0 ? { p_chip_in_cents: r.chip_in_cents } : {}),
    ...(r.pay_method ? { p_pay_method: r.pay_method } : {}),
    ...(r.expected_total_cents !== null ? { p_expected_total_cents: r.expected_total_cents } : {}),
  });
  if (error) {
    if (isCheckoutRefusalCode(error.code)) {
      // The card fee, the Chip In or the total was refused: nothing was created and nothing was charged. The app asks for a fresh quote.
      console.warn(`[payments/intent] create_checkout refused the add-ons (${error.code}):`, error.message);
      return reply(409, { error: checkoutRefusalMessage(error.code, error.message ?? ""), code: error.code });
    }
    const status = error.code === "42501" || /JWT|jwt/.test(error.message) ? 403 : error.code === "CCENT" ? 409 : 400;
    if (status !== 400) console.error("[payments/intent] create_checkout refused:", error);
    return reply(status, { error: explainError(error) });
  }
  const checkout = data as unknown as CheckoutInfo;
  const started = await startProviderCheckout(db, checkout, originOf(req.headers, req.nextUrl.origin), r.return_url);
  if (!started.ok) return reply(started.status, { error: started.error, checkout_id: checkout.checkout_id });
  // What the database decided to charge, so the app can show it again after the payer returns (absent for an older database).
  return reply(200, {
    checkout_id: started.checkoutId,
    url: started.url,
    mode: started.mode,
    processor: started.processor,
    gift_cents: checkout.gift_cents ?? undefined,
    covered_fee_cents: checkout.covered_fee_cents ?? undefined,
    chip_in_cents: checkout.chip_in_cents ?? undefined,
    total_cents: checkout.total_cents ?? undefined,
    pay_method: checkout.pay_method ?? undefined,
    lines: checkout.lines ?? undefined,
  });
}
