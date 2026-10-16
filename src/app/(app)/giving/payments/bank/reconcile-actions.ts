"use server";

import { revalidatePath } from "next/cache";

import { loadReconcile, type ReconcileModel } from "@/lib/data/giving-reconcile";
import { failure, type ActionResult } from "@/lib/errors";
import { parseDuplicateError } from "@/lib/payments/zelle";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

// The Bank tab's Reconcile view (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md section 5; 0866-0868). Every action here calls ONE
// existing database function that re-checks everything at call time (another treasurer may have acted, a claim may have been
// withdrawn). The batch is the screen calling these one by one: there is no second "bulk" path for money (I7).

function refresh() {
  revalidatePath("/giving/payments/bank");
  revalidatePath("/giving/payments");
  revalidatePath("/giving/proofs");
  revalidatePath("/");
}

type ProofApproved = { state: "approved" | "first_approved" | "merged"; receipt: string | null };

export type ApproveWithLineResult = ActionResult<ProofApproved> & {
  /** The family already has a lookalike of this payment (SQLSTATE CCDUP): merge the proof into it, or say why it is a different gift. */
  duplicate?: { message: string };
};

/**
 * Settles a waiting proof with the bank line in one step: the proof is approved and the line attached to the payment it creates, so
 * its pledges go Paid and then Bank reconciled, and no pledge or payment is created twice. `amountCents` records the bank's amount
 * when it differs from the proof (a short or over payment; the reason is the note and the member is told).
 */
export async function approveProofWithBankLineAction(input: {
  proofId: string;
  txnId: string;
  amountCents?: number | null;
  note?: string | null;
  separateReason?: string | null;
}): Promise<ApproveWithLineResult> {
  // The database function writes the audit row (actor, role, before and after: invariant I9); the activity stream's catalog has no key for it yet.
  const doing = "approve the proof with the bank line";
  const auth = await authorizeAction("bankConfirm", doing);
  if (!auth.ok) return auth;
  const { db } = auth.session;
  if (!isUuid(input.proofId) || !isUuid(input.txnId)) return { ok: false, error: `Could not ${doing} — the proof or the bank line was not found.` };
  const note = (input.note ?? "").trim();
  const reason = (input.separateReason ?? "").trim();
  if (typeof input.separateReason === "string" && !reason) {
    return { ok: false, error: "Could not record it as a separate gift — say why it is a separate gift; the reason is kept in the audit log." };
  }
  if (input.amountCents !== undefined && input.amountCents !== null) {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1) return { ok: false, error: `Could not ${doing} — the amount is not valid.` };
    if (note.length < 5) return { ok: false, error: `Could not ${doing} at a different amount — say why the amount differs, in a few words; the family is told.` };
  }
  const { data, error } = await db.rpc("approve_payment_proof", {
    p_proof: input.proofId,
    p_bank_txn: input.txnId,
    ...(input.amountCents !== undefined && input.amountCents !== null ? { p_amount_cents: input.amountCents } : {}),
    ...(note ? { p_note: note } : {}),
    ...(reason ? { p_separate_reason: reason } : {}),
  });
  if (error) {
    const dup = parseDuplicateError(error);
    if (dup) {
      console.error("[crm] Could not approve the proof (possible double count):", error);
      return { ok: false, error: `Could not ${doing} — ${dup.message || "this family already has a lookalike of this payment."}`, duplicate: { message: dup.message } };
    }
    return failure(`Could not ${doing}`, error);
  }
  const out = (data ?? {}) as { state?: unknown; receipt_number?: unknown };
  const state = out.state === "approved" || out.state === "first_approved" || out.state === "merged" ? out.state : null;
  if (!state) {
    console.error("[bank] approve_payment_proof returned an unexpected answer:", data);
    refresh();
    return { ok: false, error: `Could not ${doing} — the database did not say what happened. Reload the page to check before trying again.` };
  }
  refresh();
  const receipt = typeof out.receipt_number === "string" ? out.receipt_number : null;
  if (state === "first_approved") {
    return {
      ok: true,
      message: "First approval recorded. The amount is over the limit that needs a second person, so the line is attached only after another treasurer approves.",
      data: { state, receipt },
    };
  }
  return {
    ok: true,
    message: `Approved and reconciled${receipt ? `, receipt ${receipt}` : ""}. The proof's pledges are Paid and matched to the bank line; nothing was created twice.`,
    data: { state, receipt },
  };
}

/** Undo a match with a reason (giving.manage). The database refuses a line that created its own payment, or one QuickBooks already has. */
export async function unreconcileBankLineAction(input: { txnId: string; reason: string }): Promise<ActionResult> {
  const doing = "undo the match";
  const auth = await authorizeAction("givingManage", doing);
  if (!auth.ok) return auth;
  if (!isUuid(input.txnId)) return { ok: false, error: `Could not ${doing} — the bank line was not found.` };
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) return { ok: false, error: `Could not ${doing} — say why you are undoing it, in a few words; the reason is kept in the audit log.` };
  const { error } = await auth.session.db.rpc("unreconcile_bank_line", { p_txn: input.txnId, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  return { ok: true, message: "Match undone. The bank line is back in Gifts to match, and the payment is not on the bank again." };
}

/**
 * The reconciliation preview (app.reconcile_statement): every unmatched incoming line of the account with its best candidates. READ ONLY.
 * It is a server action, not page work, so applying a row (which refreshes the page) does not work the whole preview out again.
 */
export async function loadReconcileAction(input: { accountId: string | null }): Promise<ActionResult<ReconcileModel>> {
  const auth = await authorizeAction("bank", "read the reconciliation preview");
  if (!auth.ok) return auth;
  if (input.accountId !== null && !isUuid(input.accountId)) return { ok: false, error: "Could not read the reconciliation preview — choose the bank account first." };
  try {
    return { ok: true, data: await loadReconcile(auth.session, input.accountId) };
  } catch (error) {
    return failure("Could not read the reconciliation preview", error);
  }
}

export type LookalikePayment ={ id: string; receipt: string | null; method: string; receivedOn: string | null; amountCents: number };
export type LookalikeProof = { id: string; method: string; paidOn: string | null; reference: string | null; amountCents: number };

/**
 * What a "lookalike" row looks like: the unbanked payments and waiting proofs of this family with exactly the line's amount, so the
 * treasurer can attach the line to one of them. Read only; the family comes from the row, never from a name.
 */
export async function lookalikeOptionsAction(input: { txnId: string; householdId: string }): Promise<ActionResult<{ payments: LookalikePayment[]; proofs: LookalikeProof[] }>> {
  const doing = "look up the payment it looks like";
  const auth = await authorizeAction("bankConfirm", doing);
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  if (!isUuid(input.txnId) || !isUuid(input.householdId)) return { ok: false, error: `Could not ${doing} — choose the line first.` };
  const txn = await db.from("bank_transactions").select("amount_cents").eq("id", input.txnId).eq("center_id", center.id).maybeSingle();
  if (txn.error) return failure(`Could not ${doing}`, txn.error);
  if (!txn.data) return { ok: false, error: `Could not ${doing} — the bank line was not found.` };
  const [pay, proofs] = await Promise.all([
    db
      .from("payments")
      .select("id, receipt_number, method, received_on, amount_cents")
      .eq("center_id", center.id)
      .eq("household_id", input.householdId)
      .eq("provider", "offline")
      .eq("amount_cents", txn.data.amount_cents)
      .is("deposit_bank_transaction_id", null)
      .in("status", ["captured", "pending_clearing"])
      .order("received_on", { ascending: false })
      .limit(10),
    db
      .from("payment_proofs")
      .select("id, method, paid_on, reference, amount_cents")
      .eq("center_id", center.id)
      .eq("household_id", input.householdId)
      .eq("amount_cents", txn.data.amount_cents)
      .in("status", ["submitted", "needs_info"])
      .order("paid_on", { ascending: false })
      .limit(10),
  ]);
  if (pay.error) return failure(`Could not ${doing}`, pay.error);
  if (proofs.error) return failure(`Could not ${doing}`, proofs.error);
  return {
    ok: true,
    data: {
      payments: (pay.data ?? []).map((p) => ({ id: p.id, receipt: p.receipt_number, method: p.method, receivedOn: p.received_on, amountCents: p.amount_cents })),
      proofs: (proofs.data ?? []).map((p) => ({ id: p.id, method: p.method, paidOn: p.paid_on, reference: p.reference, amountCents: p.amount_cents })),
    },
  };
}
