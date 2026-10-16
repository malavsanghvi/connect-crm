import { describe, expect, it } from "vitest";

import {
  approveArgs,
  changesFromForm,
  decisionMessage,
  duplicateFromError,
  isOfflineMethod,
  parseDecision,
  plainDbSentence,
  reasonProblem,
} from "@/lib/payment-proofs/decide";

const ID = "11111111-1111-4111-8111-111111111111";
const PAY = "33333333-3333-4333-8333-333333333333";
const BANK = "44444444-4444-4444-8444-444444444444";

describe("building the approval", () => {
  it("sends only the proof when the treasurer changed nothing", () => {
    expect(approveArgs({ proofId: ID })).toEqual({ ok: true, args: { p_proof: ID } });
    expect(approveArgs({ proofId: ID, amountCents: null, paidOn: null, method: null, note: "  ", bankTxnId: null })).toEqual({ ok: true, args: { p_proof: ID } });
  });

  it("sends integer cents, a real date, a known method and a trimmed note", () => {
    const r = approveArgs({ proofId: ID, amountCents: 18000, paidOn: "2026-10-12", method: "cash", note: "  seen  ", bankTxnId: BANK });
    expect(r).toEqual({ ok: true, args: { p_proof: ID, p_amount_cents: 18000, p_paid_on: "2026-10-12", p_method: "cash", p_note: "seen", p_bank_txn: BANK } });
  });

  it("refuses an amount that is zero, fractional, or over $1,000,000", () => {
    for (const bad of [0, -5, 1.5, 100_000_001, Number.NaN]) expect(approveArgs({ proofId: ID, amountCents: bad }).ok).toBe(false);
    expect(approveArgs({ proofId: ID, amountCents: 100_000_000 }).ok).toBe(true);
  });

  it("refuses a date that is not a date, a method the organization cannot take, and ids that are not ids", () => {
    expect(approveArgs({ proofId: ID, paidOn: "2026-13-45" }).ok).toBe(false);
    expect(approveArgs({ proofId: ID, paidOn: "10/12/2026" }).ok).toBe(false);
    expect(approveArgs({ proofId: ID, method: "card" }).ok).toBe(false);
    expect(approveArgs({ proofId: "nope" }).ok).toBe(false);
    expect(approveArgs({ proofId: ID, mergePaymentId: "x" }).ok).toBe(false);
    expect(approveArgs({ proofId: ID, bankTxnId: "x" }).ok).toBe(false);
  });

  it("asks for a reason with a different gift, and does not mix it with a merge", () => {
    expect(approveArgs({ proofId: ID, separateReason: "no" })).toMatchObject({ ok: false });
    expect(approveArgs({ proofId: ID, separateReason: " A second, separate check " })).toEqual({ ok: true, args: { p_proof: ID, p_separate_reason: "A second, separate check" } });
    expect(approveArgs({ proofId: ID, mergePaymentId: PAY })).toEqual({ ok: true, args: { p_proof: ID, p_merge_payment: PAY } });
    expect(approveArgs({ proofId: ID, mergePaymentId: PAY, separateReason: "separate gift" }).ok).toBe(false);
  });

  it("knows the offline ways of paying", () => {
    expect(isOfflineMethod("check")).toBe(true);
    expect(isOfflineMethod("card")).toBe(false);
    expect(isOfflineMethod(7)).toBe(false);
  });
});

describe("approve with changes", () => {
  const claim = { amountCents: 25000, paidOn: "2026-10-12", method: "check" };

  it("sends only what differs from the claim, as integer cents", () => {
    expect(changesFromForm({ amount: "$180.00", paidOn: "2026-10-12", method: "check" }, claim)).toEqual({ ok: true, amountCents: 18000, paidOn: null, method: null });
    expect(changesFromForm({ amount: "250", paidOn: "2026-10-10", method: "ach" }, claim)).toEqual({ ok: true, amountCents: null, paidOn: "2026-10-10", method: "ach" });
  });

  it("says what is wrong in words", () => {
    expect(changesFromForm({ amount: "abc", paidOn: "2026-10-12", method: "check" }, claim)).toMatchObject({ ok: false });
    expect(changesFromForm({ amount: "0", paidOn: "2026-10-12", method: "check" }, claim)).toMatchObject({ ok: false });
    expect(changesFromForm({ amount: "10", paidOn: "", method: "check" }, claim)).toMatchObject({ ok: false });
    expect(changesFromForm({ amount: "10", paidOn: "2026-10-12", method: "card" }, claim)).toMatchObject({ ok: false });
  });
});

describe("reject and ask need words the family will read", () => {
  it("refuses an empty or one-word answer, and an essay", () => {
    expect(reasonProblem("", "reject")).toContain("Say why");
    expect(reasonProblem("ab", "ask")).toContain("Write what you need");
    expect(reasonProblem("x".repeat(501), "reject")).toContain("500");
    expect(reasonProblem("The photo does not show the amount.", "reject")).toBeNull();
  });
});

describe("reading the answer", () => {
  it("reads the state, receipt, amount and notice", () => {
    const d = parseDecision({ state: "approved", payment_id: PAY, receipt_number: "R-2026-0412", proof: { approved_amount_cents: 18000, amount_cents: 25000 }, notice: { queued: 2, failed: 0 } });
    expect(d).toEqual({ state: "approved", paymentId: PAY, receipt: "R-2026-0412", amountCents: 18000, notice: { queued: 2, failed: 0 } });
    expect(parseDecision({ state: "first_approved", proof: { amount_cents: 300000 } })?.amountCents).toBe(300000);
  });

  it("does not guess when the answer is not one it knows", () => {
    expect(parseDecision(null)).toBeNull();
    expect(parseDecision({ state: "weird" })).toBeNull();
    expect(parseDecision("approved")).toBeNull();
  });

  it("says what happened, including whether the family was told", () => {
    const money = (c: number) => `$${(c / 100).toFixed(2)}`;
    const approved = parseDecision({ state: "approved", receipt_number: "R-9", proof: { approved_amount_cents: 18000 }, notice: { queued: 2, failed: 0 } })!;
    expect(decisionMessage(approved, { reconciled: true, money })).toBe(
      "Approved. The $180.00 payment is recorded and its pledges are paid. Receipt R-9. It was matched to the bank line. The family was told.",
    );
    const failed = parseDecision({ state: "rejected", notice: { queued: 1, failed: 1 } })!;
    expect(decisionMessage(failed, { reconciled: false, money })).toContain("could not be notified");
    const none = parseDecision({ state: "needs_info", notice: { queued: 0, failed: 0 } })!;
    expect(decisionMessage(none, { reconciled: false, money })).toContain("no account to notify");
    expect(decisionMessage(parseDecision({ state: "first_approved" })!, { reconciled: false, money })).toContain("second person");
    expect(decisionMessage(parseDecision({ state: "merged", notice: { queued: 1, failed: 0 } })!, { reconciled: false, money })).toContain("No new payment was made");
  });
});

describe("what the database refused", () => {
  it("uses the database's own sentence when it wrote one", () => {
    expect(plainDbSentence({ code: "42501", message: "You cannot review a payment confirmation from your own household. Another member of the treasury team must." })).toContain("own household");
    expect(plainDbSentence({ code: "22023", message: "This payment confirmation was already approved by someone else." })).toContain("already approved");
  });

  it("leaves Postgres' own messages to the generic explanation", () => {
    expect(plainDbSentence({ code: "42501", message: "permission denied for table payment_proofs" })).toBeNull();
    expect(plainDbSentence({ code: "42501", message: 'new row violates row-level security policy for table "x"' })).toBeNull();
    expect(plainDbSentence({ code: "23505", message: 'duplicate key value violates unique constraint "x"' })).toBeNull();
    expect(plainDbSentence({ code: "XX000", message: "Something broke." })).toBeNull();
    expect(plainDbSentence(null)).toBeNull();
  });

  it("reads the lookalikes out of a CCDUP error, and nothing out of any other error", () => {
    const err = { code: "CCDUP", message: "This family already has a lookalike", details: JSON.stringify([{ kind: "payment", id: PAY, label: "Receipt R-2291", certain: false }]) };
    expect(duplicateFromError(err)).toEqual([{ kind: "payment", id: PAY, label: "Receipt R-2291", certain: false }]);
    expect(duplicateFromError({ code: "CCDUP", details: "not json" })).toEqual([]);
    expect(duplicateFromError({ code: "22023", details: "[]" })).toBeNull();
    expect(duplicateFromError(null)).toBeNull();
  });
});
