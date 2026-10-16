"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { reasonProblem } from "@/lib/payments/change-control";
import { FEE_CLASS_SHORT, isFeeClass, parseFeeRateForm, rateText } from "@/lib/payments/chip-in-platform";
import { isPluginKey, pluginLabel } from "@/lib/payments/plugins/catalog";
import { untypedRpc } from "@/lib/payments/rpc";
import { isUuid } from "@/lib/search-params";
import { dbWithReason, loadSession, type CrmSession } from "@/lib/session";

// Platform › Payments: Community Connect's pause of a way to pay (docs/PAYMENTS_PLAN.md §2.5, migration 0597): it turns a way to pay
// off for members (for every community or one). The database checks the platform admin again, asks for a fresh 2FA check and keeps
// the reason in the audit log; the screen shows each refusal in plain English next to the click. The other thing a platform admin does
// here (0862, docs/PAYMENT_ADDONS.md §11.2) is set the Stripe fee-rate ESTIMATE (addFeeRateAction), with a reason and an audit entry
// but no 2FA code (owner rule of 2026-10-14). Neither ever reads a credential or moves money.

export type PauseResult = ActionResult & { stepUp?: boolean };

async function platformSession(doing: string): Promise<{ ok: true; session: CrmSession } | { ok: false; error: string }> {
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  if (!state.session.isPlatformAdmin) return { ok: false, error: `Could not ${doing} — only Weaver platform admins can do this.` };
  return { ok: true, session: state.session };
}

function check(key: string, centerId: string | null, reason: string, doing: string): string | null {
  if (!isPluginKey(key)) return `Could not ${doing} — that is not a payment method Weaver offers.`;
  if (centerId !== null && !isUuid(centerId)) return `Could not ${doing} — choose a community from the list, or every community.`;
  return reasonProblem(reason, doing);
}

/** Pause a way to pay for every community (centerId null) or for one. */
export async function suspendPluginAction(key: string, centerId: string | null, reason: string): Promise<PauseResult> {
  const doing = `pause ${pluginLabel(key)}`;
  const bad = check(key, centerId, reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await untypedRpc(db)("suspend_payment_plugin", { p_key: key, p_center: centerId, p_reason: reason.trim() });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/platform/payments");
  return {
    ok: true,
    message: `${pluginLabel(key)} is paused${centerId ? " for that community" : " for every community"}. New payments with it cannot start; money that already arrived is recorded as before.`,
  };
}

/** Resume it. */
export async function liftPauseAction(key: string, centerId: string | null, reason: string): Promise<PauseResult> {
  const doing = `resume ${pluginLabel(key)}`;
  const bad = check(key, centerId, reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await untypedRpc(db)("lift_payment_plugin_suspension", { p_key: key, p_center: centerId, p_reason: reason.trim() });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/platform/payments");
  return { ok: true, message: `${pluginLabel(key)} is resumed${centerId ? " for that community" : " for every community"}.` };
}

/**
 * Add a Stripe fee-rate row (docs/PAYMENT_ADDONS.md §5.3, §11.2; app.platform_set_fee_rate: platform admins only, a reason required,
 * audited, no fresh 2FA code by the owner's rule of 2026-10-14). The rate is only an ESTIMATE of what Stripe charges, used to work
 * out the card fee a member may choose to cover; the fee recorded on a payment is always Stripe's own. A blank `center` is the
 * platform default (Platform › Payments); a community's id is that community's own rate (its approved nonprofit pricing, say).
 * Rates are never edited: a change adds a row, and the earlier ones stay on record. The form takes percent and dollars; they become
 * basis points and integer cents in parseFeeRateForm.
 */
export async function addFeeRateAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const methodClass = String(formData.get("method_class") ?? "");
  const doing = isFeeClass(methodClass) ? `save the ${FEE_CLASS_SHORT[methodClass].toLowerCase()} fee rate` : "save the fee rate";
  const centerText = String(formData.get("center") ?? "").trim();
  const center = centerText === "" ? null : centerText;
  if (center !== null && !isUuid(center)) return { ok: false, error: `Could not ${doing} — the form is out of date. Reload and try again.` };
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const reason = String(formData.get("reason") ?? "").trim();
  const noReason = reasonProblem(reason, doing);
  if (noReason) return { ok: false, error: noReason };
  const parsed = parseFeeRateForm({
    methodClass,
    percent: String(formData.get("percent") ?? ""),
    fixed: String(formData.get("fixed") ?? ""),
    cap: String(formData.get("cap") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.ok) return { ok: false, error: `Could not ${doing} — ${parsed.error}` };
  const rate = parsed.value;
  const db = await dbWithReason(auth.session, reason);
  // A null organization (the platform default) and a null cap (no cap) are not something the generated types can say.
  const { error } = await untypedRpc(db)("platform_set_fee_rate", {
    p_center: center,
    p_method_class: rate.methodClass,
    p_bps: rate.bps,
    p_fixed_cents: rate.fixedCents,
    p_cap_cents: rate.capCents,
    p_source_note: rate.sourceNote,
    p_reason: reason,
  });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/platform/payments");
  if (center) revalidatePath(`/platform/centers/${center}`);
  return {
    ok: true,
    message: `${FEE_CLASS_SHORT[rate.methodClass]} fee estimate is now ${rateText(rate)}${center ? " for this organization" : " for every organization without a rate of its own"} · audit logged`,
  };
}
