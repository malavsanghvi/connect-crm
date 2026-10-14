"use server";

import { revalidatePath } from "next/cache";

import { withActivity } from "@/lib/activity/with-activity";
import { previewAllocation } from "@/lib/allocation";
import { todayInTz } from "@/lib/dates";
import { explainError, failure, type ActionResult } from "@/lib/errors";
import { formatCents } from "@/lib/money";
import { checkOfflinePayment, type AllocationMode } from "@/lib/payments/offline-payment";
import { parsePossibleDuplicates, type RecordedZelle } from "@/lib/payments/zelle";
import { canAccess } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, type CrmSession } from "@/lib/session";

export type RecordPaymentInput = {
  householdId: string;
  amount: string;
  method: string;
  receivedOn: string;
  /** Check number (check), shares and value (stock), or a reference (other methods). */
  reference?: string;
  envelopeNumber?: string;
  memo?: string;
  /** "auto" = earliest open pledge first; "choose" = only pledgeIds, in that order; "none" = leave unallocated. */
  allocation: AllocationMode;
  pledgeIds?: string[];
};

export type AppliedLine = { pledge_id: string; pledge_number: string | null; amount_cents: number; closed: boolean };

export type RecordPaymentResult = {
  paymentId: string;
  receiptNumber: string | null;
  amountCents: number;
  applied: AppliedLine[];
  unallocatedCents: number;
  /** Set when the payment was saved but applying it to pledges failed or was not permitted. */
  allocationProblem: string | null;
  qboQueued: boolean | null;
};

async function applyToPledges(
  session: CrmSession,
  paymentId: string,
  householdId: string,
  amountCents: number,
  chosen: string[] | null,
): Promise<{ applied: AppliedLine[]; unallocated: number; problem: string | null }> {
  const { db, center } = session;
  const already = await db.from("payment_allocations").select("amount_cents").eq("payment_id", paymentId);
  if (already.error) return { applied: [], unallocated: amountCents, problem: explainError(already.error) };
  const remaining = amountCents - (already.data ?? []).reduce((s, a) => s + a.amount_cents, 0);
  if (remaining <= 0) return { applied: [], unallocated: 0, problem: null };

  const pledgesRes = await db
    .from("pledges")
    .select("id, pledge_number, amount_cents, paid_cents, pledged_at, status")
    .eq("center_id", center.id)
    .eq("household_id", householdId)
    .in("status", ["open", "partially_paid"]);
  if (pledgesRes.error) return { applied: [], unallocated: remaining, problem: explainError(pledgesRes.error) };
  const pledges = pledgesRes.data ?? [];
  const plan = previewAllocation(remaining, pledges, chosen);
  if (plan.lines.length === 0) return { applied: [], unallocated: remaining, problem: null };

  const ins = await db.from("payment_allocations").insert(
    plan.lines.map((l) => ({
      center_id: center.id,
      payment_id: paymentId,
      pledge_id: l.pledge_id,
      amount_cents: l.amount_cents,
      chosen_by_donor: chosen !== null,
    })),
  );
  if (ins.error) {
    console.error("[payments] allocation insert failed:", ins.error);
    return { applied: [], unallocated: remaining, problem: explainError(ins.error) };
  }
  const numbers = new Map(pledges.map((p) => [p.id, p.pledge_number]));
  return {
    applied: plan.lines.map((l) => ({
      pledge_id: l.pledge_id,
      pledge_number: numbers.get(l.pledge_id) ?? null,
      amount_cents: l.amount_cents,
      closed: l.closes,
    })),
    unallocated: plan.unallocated_cents,
    problem: null,
  };
}

export async function recordOfflinePaymentAction(input: RecordPaymentInput): Promise<ActionResult<RecordPaymentResult>> {
  return withActivity("giving.record_payment", () => recordOfflinePayment(input), {
    entityFrom: (result) => ({ kind: "payment", id: result?.data?.paymentId }),
  });
}

async function recordOfflinePayment(input: RecordPaymentInput): Promise<ActionResult<RecordPaymentResult>> {
  const auth = await authorizeAction("recordPayment", "record the payment");
  if (!auth.ok) return auth;
  const { session } = auth;
  const { db, center } = session;

  const today = todayInTz(center.time_zone);
  // The same checks, in the same words, as the prepared payment (giving.draft_payment) uses: src/lib/payments/offline-payment.ts.
  const checked = checkOfflinePayment(input, today);
  if (!checked.ok) return { ok: false, error: checked.error };
  const { amountCents, method, chosen, memo } = checked.value;

  const ins = await db
    .from("payments")
    .insert({
      center_id: center.id,
      household_id: input.householdId,
      amount_cents: amountCents,
      method,
      status: "captured",
      provider: "offline",
      received_on: input.receivedOn,
      recorded_by: session.userId,
      check_number: checked.value.checkNumber,
      envelope_number: checked.value.envelopeNumber,
      memo,
    })
    .select("id, receipt_number")
    .single();
  if (ins.error) return failure("Could not record the payment", ins.error);
  const payment = ins.data;

  let applied: AppliedLine[] = [];
  let unallocated = amountCents;
  let problem: string | null = null;
  if (input.allocation !== "none") {
    if (canAccess(session, "allocatePayment")) {
      const r = await applyToPledges(session, payment.id, input.householdId, amountCents, chosen);
      applied = r.applied;
      unallocated = r.unallocated;
      problem = r.problem ? `the payment was saved, but applying it to pledges failed — ${r.problem}` : null;
    } else {
      problem = "the payment was saved but not applied to pledges: that needs the giving.manage permission (a treasurer can apply it)";
    }
  }

  let qboQueued: boolean | null = null;
  if (canAccess(session, "qboLedger")) {
    const q = await db.from("ledger_postings").select("id").eq("source_table", "payments").eq("source_id", payment.id).limit(1);
    qboQueued = q.error ? null : (q.data ?? []).length > 0;
  }

  revalidatePath("/giving/payments");
  revalidatePath(`/households/${input.householdId}`);
  return {
    ok: true,
    message: `Recorded ${formatCents(amountCents, center.currency)} — receipt ${payment.receipt_number ?? "pending"}.`,
    data: {
      paymentId: payment.id,
      receiptNumber: payment.receipt_number,
      amountCents,
      applied,
      unallocatedCents: unallocated,
      allocationProblem: problem,
      qboQueued,
    },
  };
}

/** Retry applying an already-recorded payment's remaining amount to pledges. */
export async function applyPaymentAction(input: ApplyPaymentInput): Promise<ReturnType<typeof applyPayment>> {
  return withActivity("giving.apply_payment", () => applyPayment(input), { entityFrom: { kind: "payment", id: input.paymentId } });
}

type ApplyPaymentInput = Parameters<typeof applyPayment>[0];

async function applyPayment(input: {
  paymentId: string;
  householdId: string;
  pledgeIds: string[] | null;
}): Promise<ActionResult<{ applied: AppliedLine[]; unallocatedCents: number }>> {
  const auth = await authorizeAction("allocatePayment", "apply the payment to pledges");
  if (!auth.ok) return auth;
  if (!isUuid(input.paymentId) || !isUuid(input.householdId)) {
    return { ok: false, error: "Could not apply the payment — it was not found." };
  }
  const { db, center } = auth.session;
  const p = await db.from("payments").select("amount_cents, household_id").eq("id", input.paymentId).eq("center_id", center.id).maybeSingle();
  if (p.error) return failure("Could not apply the payment", p.error);
  if (!p.data || p.data.household_id !== input.householdId) return { ok: false, error: "Could not apply the payment — it was not found." };
  const chosen = input.pledgeIds && input.pledgeIds.length > 0 ? input.pledgeIds.filter(isUuid) : null;
  const r = await applyToPledges(auth.session, input.paymentId, input.householdId, p.data.amount_cents, chosen);
  if (r.problem) return { ok: false, error: `Could not apply the payment to pledges — ${r.problem}` };
  revalidatePath("/giving/payments");
  revalidatePath(`/households/${input.householdId}`);
  return {
    ok: true,
    message: r.applied.length > 0 ? "Applied to pledges." : "Nothing left to apply — no open pledges, or the payment is fully applied.",
    data: { applied: r.applied, unallocatedCents: r.unallocated },
  };
}

/**
 * Before a Zelle is recorded by hand: is a Zelle of this family and amount already recorded (by hand,
 * from the bank statement) or reported by a member around that date? A warning only; recording is unchanged.
 */
export async function possibleDuplicateZelleAction(input: {
  householdId: string;
  amountCents: number;
  receivedOn: string;
}): Promise<ActionResult<RecordedZelle[]>> {
  const doing = "check for a Zelle already recorded";
  const auth = await authorizeAction("recordPayment", doing);
  if (!auth.ok) return auth;
  if (!isUuid(input.householdId)) return { ok: false, error: `Could not ${doing} — choose the household first.` };
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) return { ok: true, data: [] };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn)) return { ok: true, data: [] };
  const { data, error } = await auth.session.db.rpc("possible_duplicate_zelle", {
    p_household: input.householdId,
    p_amount_cents: input.amountCents,
    p_on: input.receivedOn,
  });
  if (error) return failure(`Could not ${doing}`, error);
  return { ok: true, data: parsePossibleDuplicates(data) };
}
