"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult, type DbErrorLike } from "@/lib/errors";
import {
  MAX_BULK_PAIRS,
  MAX_WINDOW_DAYS,
  MIN_WINDOW_DAYS,
  parseExactConfirm,
  type ExactConfirmOutcome,
} from "@/lib/payments/zelle";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";
import type { AppSupabase } from "@/lib/supabase/server";

// Zelle reports (0582–0583): the treasurer's side. Every rule is in the database; these actions
// check the input, call the RPC and put the outcome in plain English next to what was clicked.
// set_zelle_reporting is the one call through the untyped signature (as src/app/(app)/content/niva/actions.ts
// does): its generated type cannot express "no bank account" (a null p_bank_account).
type RpcCaller = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbErrorLike | null }>;
const untypedRpc = (db: AppSupabase) => db.rpc.bind(db) as unknown as RpcCaller;

const UNEXPECTED_SHAPE = "the database answered in a shape this screen does not understand (has the latest migration been applied?).";

function refresh() {
  revalidatePath("/giving/payments/bank");
  revalidatePath("/settings/payments");
  revalidatePath("/giving/payments");
  revalidatePath("/");
}

export type ExactPairInput = { report_id: string; bank_transaction_id: string };

/** "Confirm N exact matches": only the pairs shown and ticked; the database re-checks each one. */
export async function confirmExactMatchesAction(pairs: ExactPairInput[]): Promise<ActionResult<ExactConfirmOutcome>> {
  const doing = "confirm the exact matches";
  const auth = await authorizeAction("bankConfirm", doing);
  if (!auth.ok) return auth;
  const list = (Array.isArray(pairs) ? pairs : []).filter((p) => p && isUuid(p.report_id) && isUuid(p.bank_transaction_id));
  if (list.length === 0) return { ok: false, error: `Could not ${doing} — tick at least one match.` };
  if (list.length > MAX_BULK_PAIRS) return { ok: false, error: `Could not ${doing} — confirm at most ${MAX_BULK_PAIRS} at a time.` };
  const { data, error } = await auth.session.db.rpc("confirm_exact_zelle_matches", {
    p_center: auth.session.center.id,
    p_pairs: list.map((p) => ({ report_id: p.report_id, bank_transaction_id: p.bank_transaction_id })),
  });
  if (error) return failure(`Could not ${doing}`, error);
  const outcome = parseExactConfirm(data);
  if (!outcome) {
    console.error("[bank/zelle] confirm_exact_zelle_matches returned an unexpected shape:", data);
    return { ok: false, error: `Could not ${doing} — ${UNEXPECTED_SHAPE} Reload the page to see which were recorded.` };
  }
  refresh();
  const n = outcome.confirmed.length;
  const s = outcome.skipped.length;
  const message =
    n === 0
      ? `Nothing was confirmed: ${s === 1 ? "the match is" : `all ${s} matches are`} no longer exact. Match ${s === 1 ? "it" : "them"} by hand.`
      : `Confirmed ${n} Zelle${n === 1 ? "" : "s"}${s > 0 ? `; ${s} skipped (no longer exact)` : ""}.`;
  return n === 0 ? { ok: false, error: `Could not ${doing} — ${message}` } : { ok: true, message, data: outcome };
}

/** Close a member's report with a reason; the member is told why. */
export async function rejectReportAction(reportId: string, reason: string): Promise<ActionResult> {
  const doing = "close the Zelle report";
  const auth = await authorizeAction("bankConfirm", doing);
  if (!auth.ok) return auth;
  if (!isUuid(reportId)) return { ok: false, error: `Could not ${doing} — the report was not found.` };
  const why = String(reason ?? "").trim();
  if (!why) return { ok: false, error: `Could not ${doing} — say why it is not accepted; the member is told.` };
  if (why.length > 500) return { ok: false, error: `Could not ${doing} — the reason can be at most 500 characters.` };
  const { error } = await auth.session.db.rpc("reject_payment_report", { p_report: reportId, p_reason: why });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  return { ok: true, message: "Report closed as not accepted. The member is told why; nothing was credited." };
}

/** Bookkeeping only: the report is the Zelle already recorded as this payment. */
export async function linkReportAction(reportId: string, paymentId: string, reason: string): Promise<ActionResult> {
  const doing = "link the report to the payment";
  const auth = await authorizeAction("bankConfirm", doing);
  if (!auth.ok) return auth;
  if (!isUuid(reportId) || !isUuid(paymentId)) return { ok: false, error: `Could not ${doing} — choose the payment first.` };
  const why = String(reason ?? "").trim();
  if (!why) return { ok: false, error: `Could not ${doing} — say why; the reason is kept in the audit log.` };
  const { error } = await auth.session.db.rpc("link_payment_report", { p_report: reportId, p_payment: paymentId, p_reason: why });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  return { ok: true, message: "Report linked to the recorded payment. Nothing about the payment changed." };
}

/**
 * The report window and the bank account Zelle lines arrive in (centers.rules.payments.zelle). Choosing the account for the
 * first time is saved at once. CHANGING an account that is already chosen is a payee change (migration 0597): the window is
 * saved, the account is not, and a request waits for a second person. The answer says which, never "Saved" for the account
 * when only a request was made.
 */
export async function saveZelleReportingAction(
  windowDays: number,
  bankAccountId: string | null,
  reason: string,
): Promise<ActionResult<{ windowDays: number; bankAccountId: string | null; pendingChange: boolean }>> {
  const doing = "save the Zelle report settings";
  const auth = await authorizeAction("paymentSettings", doing);
  if (!auth.ok) return auth;
  const days = Number(windowDays);
  if (!Number.isInteger(days) || days < MIN_WINDOW_DAYS || days > MAX_WINDOW_DAYS) {
    return { ok: false, error: `Could not ${doing} — the report window is ${MIN_WINDOW_DAYS} to ${MAX_WINDOW_DAYS} days.` };
  }
  const account = bankAccountId && bankAccountId.trim() ? bankAccountId.trim() : null;
  if (account !== null && !isUuid(account)) return { ok: false, error: `Could not ${doing} — choose one of the bank accounts, or any account.` };
  const why = String(reason ?? "").trim();
  if (!why) return { ok: false, error: `Could not ${doing} — say why you are changing it; the reason is kept in the audit log.` };
  const { data, error } = await untypedRpc(auth.session.db)("set_zelle_reporting", {
    p_center: auth.session.center.id,
    p_window_days: days,
    p_bank_account: account,
    p_reason: why,
  });
  if (error) return failure(`Could not ${doing}`, error);
  const saved = data as { report_window_days?: unknown; bank_account_id?: unknown; pending_change?: unknown } | null;
  const savedDays = typeof saved?.report_window_days === "number" ? saved.report_window_days : days;
  const savedAccount = typeof saved?.bank_account_id === "string" ? saved.bank_account_id : null;
  const pendingChange = typeof saved?.pending_change === "string" && saved.pending_change !== "";
  refresh();
  if (pendingChange) {
    return {
      ok: true,
      message:
        `The report window is saved: reports are flagged after ${savedDays} days. The bank account is NOT changed yet: changing it needs a second person. ` +
        `A different person with giving.approve has to confirm it (Settings › Payments, Changes to where gifts go; it needs a fresh 2FA check and a reason). ` +
        `Until then Zelle lines are matched against ${savedAccount ? "the account that was chosen before" : "any account"}.`,
      data: { windowDays: savedDays, bankAccountId: savedAccount, pendingChange: true },
    };
  }
  return {
    ok: true,
    message: `Saved: reports are flagged after ${savedDays} days${savedAccount ? " and matched against the chosen account only" : ""}.`,
    data: { windowDays: savedDays, bankAccountId: savedAccount, pendingChange: false },
  };
}
