import "server-only";

import type { AppSupabase } from "@/lib/supabase/server";

import { NotConfigured, ProviderError, createProviderCheckout, type CheckoutInfo } from "./server";

export type Started = { ok: true; checkoutId: string; url: string; mode: string; processor: string } | { ok: false; error: string; status: number };

/**
 * The provider half of a checkout the database already accepted
 * (app.create_checkout / app.create_processor_test_checkout): ask Stripe or
 * PayPal for the page the payer goes to, then attach it (app.attach_checkout),
 * or mark the checkout failed with the provider's reason. Never pretends: the
 * payment is recorded only when the provider's webhook says it was paid.
 */
export async function startProviderCheckout(db: AppSupabase, info: CheckoutInfo, origin: string, to: string | null): Promise<Started> {
  const back = (result: string) => {
    const q = new URLSearchParams({ checkout: info.checkout_id, result });
    if (to) q.set("to", to);
    return `${origin}/api/payments/return?${q.toString()}`;
  };
  let page: { providerRef: string; url: string };
  try {
    page = await createProviderCheckout(info, back("success"), back("cancel"));
  } catch (err) {
    const message = err instanceof NotConfigured || err instanceof ProviderError ? err.message : "the payment provider could not be reached";
    if (!(err instanceof NotConfigured || err instanceof ProviderError)) console.error("[payments] checkout failed:", err);
    const { error } = await db.rpc("fail_checkout", { p_checkout: info.checkout_id, p_error: message });
    if (error) console.error("[payments] could not mark the checkout failed:", error);
    return { ok: false, error: message, status: err instanceof NotConfigured ? 503 : 502 };
  }
  const { error } = await db.rpc("attach_checkout", { p_checkout: info.checkout_id, p_provider_ref: page.providerRef, p_checkout_url: page.url });
  if (error) {
    console.error("[payments] could not attach the provider checkout:", error);
    return { ok: false, error: "The checkout was created at the provider but could not be saved here. Nothing was charged; try again.", status: 500 };
  }
  return { ok: true, checkoutId: info.checkout_id, url: page.url, mode: info.mode, processor: info.processor };
}
