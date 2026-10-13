"use server";

import { revalidatePath } from "next/cache";

import { withActivity } from "@/lib/activity/with-activity";
import { failure } from "@/lib/errors";
import { explainProblem, isDifferenceCode } from "@/lib/giving-payouts/explain";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

// Pair a card payout with the bank's card-payout line, explaining a difference, or undo the pairing (slice 9; app.explain_payout
// and app.unpair_payout, 0747). giving.manage; Giving, Bank reconciliation and Accounting on; the database checks it all again,
// refuses another community's rows and a locked month, and keeps the reason in the audit log. Nothing here moves money.

export type PayoutPairResult = { ok: true; differenceCents: number; already: boolean } | { ok: false; error: string; stepUp?: boolean };

function refresh() {
  revalidatePath("/giving/payments/bank");
  revalidatePath("/giving");
  revalidatePath("/accounting/close");
}

export async function explainPayoutAction(input: { payoutId: string; bankLineId: string; differenceCents: number; code: string | null; note: string }): Promise<PayoutPairResult> {
  return withActivity("giving.explain_payout", () => explainPayout(input));
}

async function explainPayout(input: { payoutId: string; bankLineId: string; differenceCents: number; code: string | null; note: string }): Promise<PayoutPairResult> {
  const auth = await authorizeAction("payoutPair", "pair the payout with the bank");
  if (!auth.ok) return auth;
  if (!isUuid(input.payoutId) || !isUuid(input.bankLineId)) return { ok: false, error: "Could not pair the payout — choose the payout and its bank line again." };
  const missing = explainProblem(input.differenceCents, input.code, input.note ?? "");
  if (missing) return { ok: false, error: `Could not accept the difference — ${missing[0].toLowerCase()}${missing.slice(1)}` };
  const { data, error } = await auth.session.db.rpc("explain_payout", {
    p_payout: input.payoutId,
    p_bank_line: input.bankLineId,
    p_code: isDifferenceCode(input.code) ? input.code : undefined,
    p_note: input.note.trim() || undefined,
  });
  if (error) return failure("Could not pair the payout with the bank line", error);
  const out = (data ?? {}) as { difference_cents?: number; already?: boolean };
  refresh();
  return { ok: true, differenceCents: Number(out.difference_cents ?? 0), already: out.already === true };
}

export async function unpairPayoutAction(input: { payoutId: string; reason: string }): Promise<{ ok: true; already: boolean } | { ok: false; error: string; stepUp?: boolean }> {
  return withActivity("giving.unpair_payout", () => unpairPayout(input));
}

async function unpairPayout(input: { payoutId: string; reason: string }): Promise<{ ok: true; already: boolean } | { ok: false; error: string; stepUp?: boolean }> {
  const auth = await authorizeAction("payoutPair", "undo the pairing");
  if (!auth.ok) return auth;
  if (!isUuid(input.payoutId)) return { ok: false, error: "Could not undo the pairing — choose the payout again." };
  if (!input.reason?.trim()) return { ok: false, error: "Could not undo the pairing — say why; the reason is kept in the audit log." };
  const { data, error } = await auth.session.db.rpc("unpair_payout", { p_payout: input.payoutId, p_reason: input.reason.trim() });
  if (error) return failure("Could not undo the pairing", error);
  refresh();
  return { ok: true, already: (data as { already?: boolean } | null)?.already === true };
}
