"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { reasonProblem } from "@/lib/payments/change-control";
import { isPluginKey, pluginLabel } from "@/lib/payments/plugins/catalog";
import { untypedRpc } from "@/lib/payments/rpc";
import { isUuid } from "@/lib/search-params";
import { dbWithReason, loadSession, type CrmSession } from "@/lib/session";

// Platform › Payments: Community Connect's pause of a way to pay (docs/PAYMENTS_PLAN.md §2.5, migration 0597). It is the only
// power a platform admin has over payments: it turns a way to pay off for members (for every community or one), never reads a
// credential and never moves money. The database checks the platform admin again, asks for a fresh 2FA check and keeps the
// reason in the audit log; the screen shows each refusal in plain English next to the click.

export type PauseResult = ActionResult & { stepUp?: boolean };

async function platformSession(doing: string): Promise<{ ok: true; session: CrmSession } | { ok: false; error: string }> {
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  if (!state.session.isPlatformAdmin) return { ok: false, error: `Could not ${doing} — only Community Connect platform admins can do this.` };
  return { ok: true, session: state.session };
}

function check(key: string, centerId: string | null, reason: string, doing: string): string | null {
  if (!isPluginKey(key)) return `Could not ${doing} — that is not a payment method Community Connect offers.`;
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
