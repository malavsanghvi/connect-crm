"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { failure, isStepUpError, type ActionResult, type DbErrorLike } from "@/lib/errors";
import { startProviderCheckout } from "@/lib/payments/checkout";
import { NotConfigured, ProviderError, originOf, paypalReferralUrl, stripeAuthorizeUrl, type CheckoutInfo } from "@/lib/payments/server";
import { loadPlatformConfig } from "@/lib/platform-setup/server-config";
import { pluginByKey } from "@/lib/payments/plugins/catalog";
import { PROCESSOR_LABEL, statementDescriptorProblem, type Processor } from "@/lib/payments/view";
import { authorizeAction, dbWithReason } from "@/lib/session";
import type { AppSupabase } from "@/lib/supabase/server";

// Settings › Payments. Every write is an app.* function that checks the caller
// (owner / integrations.manage for connecting and live; giving.manage too for
// the rest), asks for a fresh 2FA check where it matters (CCSTP → the screen
// verifies and retries) and audits the reason given here.

export type PayResult<T = undefined> = ActionResult<T> & { stepUp?: boolean };

const PATH = "/settings/payments";

// app.set_payment_plugin takes nullable arguments (a null name or order goes back to the catalog's, a null
// switch leaves it as it is), which the generated types cannot say: every argument is a non-null there.
// So it is called through the untyped signature (as src/app/(app)/content/niva/actions.ts does).
type RpcCaller = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbErrorLike | null }>;
const untypedRpc = (db: AppSupabase) => db.rpc.bind(db) as unknown as RpcCaller;

function isProcessor(p: string): p is Processor {
  return p === "stripe" || p === "paypal";
}

function needReason(reason: string, doing: string): string | null {
  const r = String(reason ?? "").trim();
  if (!r) return `Could not ${doing} — say why. The reason is kept in the audit log.`;
  if (r.length > 500) return `Could not ${doing} — keep the reason under 500 characters.`;
  return null;
}

function dbFailure<T>(doing: string, error: unknown): PayResult<T> {
  if (isStepUpError(error)) return { ok: false, stepUp: true, error: `Could not ${doing} — this needs a fresh 2FA check.` };
  return failure(`Could not ${doing}`, error);
}

async function origin(): Promise<string> {
  const h = await headers();
  return originOf(h, "http://localhost:3000");
}

// Donors covering the fee is not offered (owner decision 2026-09-25 #5): no fee is ever added, so
// the setting is always saved off and the database refuses switching it on.
export async function saveProcessorAction(processor: string, methods: string[], descriptor: string, reason: string): Promise<PayResult> {
  const doing = `save the ${PROCESSOR_LABEL[processor as Processor] ?? processor} settings`;
  if (!isProcessor(processor)) return { ok: false, error: `Could not ${doing} — choose Stripe or PayPal.` };
  const bad = statementDescriptorProblem(descriptor ?? "") ?? needReason(reason, doing);
  if (bad) return { ok: false, error: bad.startsWith("Could not") ? bad : `Could not ${doing} — ${bad}` };
  if (!Array.isArray(methods) || methods.length === 0) return { ok: false, error: `Could not ${doing} — choose at least one online method.` };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("set_payment_processor", {
    p_center: auth.session.center.id, p_processor: processor, p_methods: methods, p_statement_descriptor: descriptor.trim(),
    p_donor_covers_fee_allowed: false, p_reason: reason.trim(),
  });
  if (error) return dbFailure(doing, error);
  revalidatePath(PATH);
  return { ok: true, message: `${PROCESSOR_LABEL[processor]} settings saved · audit logged` };
}

export async function setDefaultAction(processor: string | null, reason: string): Promise<PayResult> {
  const doing = processor ? `make ${PROCESSOR_LABEL[processor as Processor] ?? processor} the default` : "clear the default processor";
  if (processor !== null && !isProcessor(processor)) return { ok: false, error: `Could not ${doing} — choose Stripe or PayPal.` };
  const bad = needReason(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("set_default_payment_processor", { p_center: auth.session.center.id, p_processor: processor as string, p_reason: reason.trim() });
  if (error) return dbFailure(doing, error);
  revalidatePath(PATH);
  return { ok: true, message: processor ? `${PROCESSOR_LABEL[processor as Processor]} is now the default at checkout` : "No default processor" };
}

export async function setModeAction(processor: string, mode: string, reason: string): Promise<PayResult> {
  const doing = `switch ${PROCESSOR_LABEL[processor as Processor] ?? processor} to ${mode} mode`;
  if (!isProcessor(processor) || (mode !== "test" && mode !== "live")) return { ok: false, error: `Could not ${doing} — unknown processor or mode.` };
  const bad = needReason(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("set_payment_mode", { p_center: auth.session.center.id, p_processor: processor, p_mode: mode, p_reason: reason.trim() });
  if (error) return dbFailure(doing, error);
  revalidatePath(PATH);
  return { ok: true, message: `${PROCESSOR_LABEL[processor]} is in ${mode} mode · audit logged` };
}

/** Starts Stripe Connect or "Connect with PayPal"; the screen then sends the person to the provider. */
export async function startConnectAction(processor: string, reason: string): Promise<PayResult<{ url: string }>> {
  const doing = `connect ${PROCESSOR_LABEL[processor as Processor] ?? processor}`;
  if (!isProcessor(processor)) return { ok: false, error: `Could not ${doing} — choose Stripe or PayPal.` };
  const bad = needReason(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const base = await origin();
  const callback = `${base}/api/oauth/${processor}/callback`;
  const db = await dbWithReason(auth.session, reason);
  const { data, error } = await db.rpc("begin_payment_connect", {
    p_center: auth.session.center.id, p_processor: processor, p_redirect_uri: callback, p_reason: reason.trim(),
  });
  if (error) return dbFailure(doing, error);
  const d = data as { state: string; mode: "test" | "live" };
  await loadPlatformConfig();
  try {
    const url =
      processor === "stripe"
        ? stripeAuthorizeUrl(d.state, callback)
        : await paypalReferralUrl(d.mode, d.state.split(".")[0] ?? d.state, `${callback}?state=${encodeURIComponent(d.state)}`);
    return { ok: true, data: { url }, message: `Opening ${PROCESSOR_LABEL[processor]}…` };
  } catch (err) {
    if (err instanceof NotConfigured || err instanceof ProviderError) return { ok: false, error: `Could not ${doing} — ${err.message}` };
    console.error(`[settings/payments] ${doing} failed:`, err);
    return { ok: false, error: `Could not ${doing} — the provider could not be reached. Try again.` };
  }
}

export async function sendPaypalCodeAction(email: string): Promise<PayResult<{ sent: boolean }>> {
  const doing = "send the PayPal verification code";
  const e = String(email ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, error: `Could not ${doing} — enter the PayPal Business account's email address.` };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, `Verify the PayPal Business email ${e}`);
  const { data, error } = await db.rpc("start_paypal_email_verification", { p_center: auth.session.center.id, p_email: e });
  if (error) return dbFailure(doing, error);
  const d = data as { sent: boolean; reason?: string };
  revalidatePath(PATH);
  if (!d.sent) {
    // Logged once per attempt; the o-messaging service is what sends the code.
    console.error("[settings/payments] the PayPal code was not sent: app.enqueue_message (o-messaging) is not available in this database");
    return {
      ok: false,
      error: "Could not send the code — email sending isn't set up on Weaver yet, so no code was made. Use \"Connect with PayPal\" instead, or try again once email sending is set up.",
    };
  }
  return { ok: true, data: { sent: true }, message: `A 6-digit code was sent to ${e}. It works for 15 minutes.` };
}

export async function confirmPaypalCodeAction(code: string): Promise<PayResult> {
  const doing = "verify the PayPal Business email";
  if (!/^\d{6}$/.test(String(code ?? "").trim())) return { ok: false, error: `Could not ${doing} — enter the 6-digit code from the email.` };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, "Verify the PayPal Business email");
  const { data, error } = await db.rpc("confirm_paypal_email", { p_center: auth.session.center.id, p_code: code.trim() });
  if (error) return dbFailure(doing, error);
  const d = data as { ok: boolean; detail: string; pending?: boolean };
  revalidatePath(PATH);
  if (!d.ok) return { ok: false, error: `Could not ${doing} — ${d.detail}` };
  // Replacing a saved email is a payee change (migration 0597): the code is checked, the email is NOT changed until a second person confirms.
  return { ok: true, message: d.pending === true ? `Not changed yet. ${d.detail}` : d.detail };
}

export async function disconnectAction(processor: string, reason: string): Promise<PayResult> {
  const doing = `disconnect ${PROCESSOR_LABEL[processor as Processor] ?? processor}`;
  if (!isProcessor(processor)) return { ok: false, error: `Could not ${doing} — choose Stripe or PayPal.` };
  const bad = needReason(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("disconnect_payment_processor", { p_center: auth.session.center.id, p_processor: processor, p_reason: reason.trim() });
  if (error) return dbFailure(doing, error);
  revalidatePath(PATH);
  return { ok: true, message: `${PROCESSOR_LABEL[processor]} disconnected. Nothing was deleted; revoke Weaver's access in the ${PROCESSOR_LABEL[processor]} dashboard too.` };
}

/** The $1 test: a real $1 checkout at the provider (test card in test mode), refunded automatically. */
export async function runTestAction(processor: string): Promise<PayResult<{ url: string }>> {
  const doing = `start the $1 test of ${PROCESSOR_LABEL[processor as Processor] ?? processor}`;
  if (!isProcessor(processor)) return { ok: false, error: `Could not ${doing} — choose Stripe or PayPal.` };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, `$1 test of ${PROCESSOR_LABEL[processor]}`);
  const { data, error } = await db.rpc("create_processor_test_checkout", { p_center: auth.session.center.id, p_processor: processor });
  if (error) return dbFailure(doing, error);
  const started = await startProviderCheckout(db, data as unknown as CheckoutInfo, await origin(), "settings");
  revalidatePath(PATH);
  if (!started.ok) return { ok: false, error: `Could not ${doing} — ${started.error}` };
  return { ok: true, data: { url: started.url }, message: `Pay the $1 on the ${PROCESSOR_LABEL[processor]} page; it is refunded automatically.` };
}

export async function saveMethodAction(method: string, accepted: boolean, instructions: Record<string, string>, sort: number, reason: string): Promise<PayResult> {
  const doing = `save how members pay by ${method.replace(/_/g, " ")}`;
  const bad = needReason(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(instructions ?? {})) if (typeof v === "string" && v.trim()) clean[k] = v.trim().slice(0, 600);
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("set_payment_method", {
    p_center: auth.session.center.id, p_method: method as never, p_accepted: accepted, p_instructions: clean, p_sort: sort, p_reason: reason.trim(),
  });
  if (error) return dbFailure(doing, error);
  revalidatePath(PATH);
  return { ok: true, message: accepted ? "Saved · members see these instructions" : "Saved · not offered to members" };
}

export async function setOfflineOnlyAction(on: boolean, reason: string): Promise<PayResult> {
  const doing = on ? "choose offline payments only" : "turn off offline-only";
  const bad = needReason(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("set_payments_offline_only", { p_center: auth.session.center.id, p_on: on, p_reason: reason.trim() });
  if (error) return dbFailure(doing, error);
  revalidatePath(PATH);
  return { ok: true, message: on ? "Offline payments only · card payments can be added later" : "Online payments can be offered again" };
}

export async function syncPayoutsAction(): Promise<PayResult> {
  const doing = "sync the payouts";
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const { error } = await auth.session.db.rpc("request_payout_sync", { p_center: auth.session.center.id });
  if (error) return dbFailure(doing, error);
  revalidatePath(PATH);
  return { ok: true, message: "Payout sync queued for the background service" };
}

/**
 * A payment plugin's switch, or its name and order (docs/PAYMENTS_PLAN.md §2.3). Writes through
 * app.set_payment_plugin (0580), which turns the plugin on or off with the same database functions
 * the old checkboxes used (the Stripe/PayPal method list, the offline method rows). A null name or
 * order goes back to the catalog's. Live mode is not switched here (setModeAction).
 */
export async function setPluginAction(
  key: string, enabled: boolean, labelOverride: string | null, sort: number | null, reason: string, change: "switch" | "rename" = "switch",
): Promise<PayResult> {
  const plugin = pluginByKey(key);
  const name = String(labelOverride ?? "").trim() || null;
  const label = name ?? plugin?.label ?? String(key).replace(/_/g, " ");
  const on = enabled === true;
  const doing = change === "rename" ? `save the name and order of ${label}` : `turn ${on ? "on" : "off"} ${label}`;
  if (!plugin) return { ok: false, error: `Could not ${doing} — that is not a payment method Weaver offers.` };
  if (name && name.length > 40) return { ok: false, error: `Could not ${doing} — the name members see can be at most 40 characters.` };
  if (sort !== null && (!Number.isInteger(sort) || sort < 0 || sort > 999)) {
    return { ok: false, error: `Could not ${doing} — the order is a whole number from 0 to 999.` };
  }
  const bad = needReason(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  // A rename or reorder never touches the switch (null = leave it as it is in the database, even if this
  // page was open before another administrator flipped it); a switch change always says which way.
  const { error } = await untypedRpc(db)("set_payment_plugin", {
    p_center: auth.session.center.id, p_key: plugin.key, p_enabled: change === "rename" ? null : on, p_config: null, p_label_override: name, p_sort: sort,
    p_reason: reason.trim(),
  });
  if (error) {
    if (isStepUpError(error)) return { ok: false, stepUp: true, error: `Could not ${doing} — this needs a fresh 2FA check.` };
    return failure(change === "rename" ? `Could not ${doing}` : `Could not turn ${on ? "on" : "off"} ${label}`, error);
  }
  revalidatePath(PATH);
  return {
    ok: true,
    message: change === "rename" ? `${label} saved · audit logged` : `${label} is ${on ? "on" : "off"} · audit logged`,
  };
}
