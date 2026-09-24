"use server";

import { revalidatePath } from "next/cache";

import { previewAllocation } from "@/lib/allocation";
import { todayInTz } from "@/lib/dates";
import { explainError, failure, type ActionResult } from "@/lib/errors";
import { OFFLINE_METHODS } from "@/lib/labels";
import { formatCents, parseAmountToCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, type CrmSession } from "@/lib/session";

type OfflineMethod = (typeof OFFLINE_METHODS)[number];

export type RecordPaymentInput = {
  householdId: string;
  amount: string;
  method: string;
  receivedOn: string;
  checkNumber?: string;
  envelopeNumber?: string;
  memo?: string;
  /** "auto" = earliest open pledge first; "choose" = only pledgeIds, in that order; "none" = leave unallocated. */
  allocation: "auto" | "choose" | "none";
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
  const auth = await authorizeAction("recordPayment", "record the payment");
  if (!auth.ok) return auth;
  const { session } = auth;
  const { db, center } = session;

  const amountCents = parseAmountToCents(input.amount);
  const method = input.method as OfflineMethod;
  const today = todayInTz(center.time_zone);
  if (!isUuid(input.householdId)) return { ok: false, error: "Could not record the payment — choose the household first." };
  if (amountCents === null || amountCents <= 0) {
    return { ok: false, error: "Could not record the payment — enter an amount greater than zero, like 251.00." };
  }
  if (!OFFLINE_METHODS.includes(method)) return { ok: false, error: "Could not record the payment — choose check, cash, ACH, Zelle or stock." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn) || input.receivedOn > today) {
    return { ok: false, error: "Could not record the payment — the received date must be a real date, not in the future." };
  }
  const chosen = input.allocation === "choose" ? (input.pledgeIds ?? []).filter(isUuid) : null;
  if (input.allocation === "choose" && (!chosen || chosen.length === 0)) {
    return { ok: false, error: "Could not record the payment — tick the pledges to apply it to, or switch to earliest-first." };
  }
  const clip = (v: string | undefined, n: number) => (v ?? "").trim().slice(0, n) || null;

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
      check_number: method === "check" ? clip(input.checkNumber, 40) : null,
      envelope_number: clip(input.envelopeNumber, 40),
      memo: clip(input.memo, 500),
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
export async function applyPaymentAction(input: {
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
