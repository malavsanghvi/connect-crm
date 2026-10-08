"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { reasonProblem, zelleChange, type ZelleCurrent } from "@/lib/payments/change-control";
import { pluginByKey } from "@/lib/payments/plugins/catalog";
import { untypedRpc } from "@/lib/payments/rpc";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, dbWithReason } from "@/lib/session";

// Settings › Payments, change control (docs/PAYMENTS_PLAN.md §2.5, migration 0597). Every rule is in the database: who may
// ask (the owner, integrations.manage or giving.manage), who may confirm (a DIFFERENT person with giving.approve, never a
// platform admin), the fresh 2FA check and the reason each of them gives. These actions check the input, call the function
// and put the outcome in plain English next to what was clicked; a refusal is shown as it is, and the detail is logged.

export type ChangeResult<T = undefined> = ActionResult<T> & { stepUp?: boolean };

const PATH = "/settings/payments";

/** Ask for a change to the Zelle address or the name shown in Zelle. A different person confirms it before anything changes. */
export async function requestZelleChangeAction(current: ZelleCurrent, input: { recipient: string; name: string }, reason: string): Promise<ChangeResult> {
  const doing = "ask for the Zelle change";
  const change = zelleChange(
    { recipient: String(current?.recipient ?? ""), name: String(current?.name ?? "") },
    { recipient: String(input?.recipient ?? ""), name: String(input?.name ?? "") },
  );
  if (!change.ok) return { ok: false, error: `Could not ${doing} — ${change.error}` };
  const bad = reasonProblem(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await untypedRpc(db)("request_payee_change", {
    p_center: auth.session.center.id, p_plugin: "zelle", p_changes: change.changes, p_reason: reason.trim(),
  });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath(PATH);
  return { ok: true, message: "Asked. A different person with giving.approve has to confirm it; until then members keep seeing the current details." };
}

/** The second person confirms (the change takes effect) or turns it down. */
export async function decidePayeeChangeAction(requestId: string, approve: boolean, reason: string): Promise<ChangeResult> {
  const yes = approve === true;
  const doing = yes ? "confirm the change" : "turn the change down";
  if (!isUuid(requestId)) return { ok: false, error: `Could not ${doing} — that request was not found. Reload the page.` };
  const bad = reasonProblem(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await untypedRpc(db)("decide_payee_change", { p_request: requestId, p_approve: yes, p_reason: reason.trim() });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath(PATH);
  return {
    ok: true,
    message: yes
      ? "Confirmed. The change took effect, and members see a dated notice for 30 days."
      : "Turned down. Nothing was changed, and the person who asked can see why.",
  };
}

/** Withdraw a request that is still waiting. */
export async function cancelPayeeChangeAction(requestId: string, reason: string): Promise<ChangeResult> {
  const doing = "withdraw the request";
  if (!isUuid(requestId)) return { ok: false, error: `Could not ${doing} — that request was not found. Reload the page.` };
  const bad = reasonProblem(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await untypedRpc(db)("cancel_payee_change", { p_request: requestId, p_reason: reason.trim() });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath(PATH);
  return { ok: true, message: "Withdrawn. Nothing was changed." };
}

/** The treasurer's go-live approval of the Zelle instructions (readiness check 6). A later change stops the pass until it is approved again. */
export async function approveZelleInstructionsAction(note: string): Promise<ChangeResult> {
  const doing = "approve the Zelle instructions";
  const text = String(note ?? "").trim();
  if (text.length > 1000) return { ok: false, error: `Could not ${doing} — keep the note under 1,000 characters.` };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, text || "The treasurer approved the Zelle instructions");
  const { error } = await untypedRpc(db)("approve_zelle_instructions", { p_center: auth.session.center.id, p_note: text || null });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath(PATH);
  return { ok: true, message: "Approved. If the address, the name, the memo, the bank account or the report window changes later, it needs approving again." };
}

/** The owner says Apple Pay or Google Pay is turned on in the Stripe account (readiness fallback until Stripe can be asked). */
export async function confirmWalletAction(key: string, reason: string): Promise<ChangeResult> {
  const plugin = pluginByKey(key);
  const label = plugin?.label ?? String(key).replace(/_/g, " ");
  const doing = `say that ${label} is turned on in Stripe`;
  if (key !== "apple_pay" && key !== "google_pay") return { ok: false, error: `Could not ${doing} — only Apple Pay and Google Pay are confirmed this way.` };
  const bad = reasonProblem(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await untypedRpc(db)("confirm_wallet_in_stripe", { p_center: auth.session.center.id, p_key: key, p_reason: reason.trim() });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath(PATH);
  return { ok: true, message: `Recorded: ${label} is turned on in your Stripe account. Community Connect cannot check that setting yet.` };
}
