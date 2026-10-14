import { describe, expect, it } from "vitest";

import { PlanChangedError, buildPaymentChecks, planDraftAllocation, type DraftPlan, type DraftPledge } from "@/lib/payments/payment-draft";

const pledge = (over: Partial<DraftPledge> & Pick<DraftPledge, "id">): DraftPledge => ({
  pledge_number: null,
  source: "general",
  amount_cents: 50000,
  paid_cents: 0,
  status: "open",
  pledged_at: "2026-01-10T12:00:00Z",
  due_on: null,
  fund: null,
  campaign: null,
  ...over,
});

const PARYUSHAN = pledge({ id: "p1", pledge_number: "P-101", campaign: "Paryushan 2026", amount_cents: 50000, paid_cents: 25000, status: "partially_paid", fund: "General fund" });
const BUILDING = pledge({ id: "p2", pledge_number: "P-102", campaign: "Building fund", amount_cents: 100000, pledged_at: "2026-03-01T12:00:00Z" });

const plan = (over: Partial<Parameters<typeof planDraftAllocation>[0]> = {}): DraftPlan =>
  planDraftAllocation({ amountCents: 25000, pledges: [BUILDING, PARYUSHAN], mode: "auto", chosen: null, canAllocate: true, currency: "USD", ...over });

describe("planDraftAllocation: what a payment would close", () => {
  it("closes the earliest open pledge first, in dollars and whole cents, with no questions when it fits exactly", () => {
    const p = plan();
    expect(p.lines.map((l) => [l.pledge_number, l.applied_cents, l.applied, l.closes])).toEqual([["P-101", 25000, "$250.00", true]]);
    expect(p.applied_cents).toBe(25000);
    expect(p.unallocated_cents).toBe(0);
    expect(p.questions).toEqual([]);
    expect(p.after).toEqual(["Paryushan 2026 (P-101) would be paid in full ($500.00 of $500.00)."]);
  });

  it("shows an overpayment as a question and rolls it to the next pledge", () => {
    const p = plan({ amountCents: 40000 });
    expect(p.lines.map((l) => [l.pledge_number, l.applied_cents, l.closes])).toEqual([
      ["P-101", 25000, true],
      ["P-102", 15000, false],
    ]);
    // 15000 into the second pledge leaves it partly paid: a question, not a decision.
    expect(p.questions.map((q) => q.kind)).toEqual(["partial"]);
    expect(p.questions[0].question).toContain("$150.00 of the $1,000.00 still open on Building fund (P-102)");
    expect(p.questions[0].question).toContain("$850.00 left");
  });

  it("asks about money beyond every open pledge: it would stay a general gift", () => {
    const p = plan({ amountCents: 130000 });
    expect(p.applied_cents).toBe(125000);
    expect(p.unallocated_cents).toBe(5000);
    expect(p.unallocated).toBe("$50.00");
    const over = p.questions.find((q) => q.kind === "overpayment")!;
    expect(over.question).toContain("$50.00 more than all of the household's open pledges need ($1,250.00 open)");
    expect(over.question).toContain("general gift, not applied to any pledge");
    expect(p.after.at(-1)).toBe("$50.00 would stay on the payment as a general gift, not applied to any pledge.");
  });

  it("asks which household when there is no open pledge at all", () => {
    const p = plan({ pledges: [pledge({ id: "paid", status: "paid", paid_cents: 50000 })] });
    expect(p.lines).toEqual([]);
    expect(p.unallocated_cents).toBe(25000);
    expect(p.questions.map((q) => q.kind)).toEqual(["no_open_pledge"]);
    expect(p.questions[0].question).toBe("This household has no open pledge, so the whole $250.00 would be recorded as a general gift. Is this the right household?");
  });

  it("applies only the pledges named, in the order named, and says when one cannot take a payment", () => {
    const p = plan({ amountCents: 20000, mode: "choose", chosen: ["p2", "p1"] });
    expect(p.lines.map((l) => l.pledge_number)).toEqual(["P-102"]);
    const gone = planDraftAllocation({
      amountCents: 20000,
      pledges: [BUILDING, pledge({ id: "p3", pledge_number: "P-103", status: "written_off" })],
      mode: "choose",
      chosen: ["p3", "p2"],
      canAllocate: true,
      currency: "USD",
    });
    expect(gone.lines.map((l) => l.pledge_number)).toEqual(["P-102"]);
    expect(gone.questions.find((q) => q.kind === "named_not_open")!.question).toContain("P-103");
    expect(gone.questions.find((q) => q.kind === "named_not_open")!.question).toContain("written off");
  });

  it("leaves it as a general gift when the person chose not to apply it, with no question", () => {
    const p = plan({ mode: "none" });
    expect(p.lines).toEqual([]);
    expect(p.unallocated_cents).toBe(25000);
    expect(p.questions).toEqual([]);
  });

  it("does not show an application that would not happen for a person who cannot apply payments", () => {
    const p = plan({ canAllocate: false });
    expect(p.lines).toEqual([]);
    expect(p.unallocated_cents).toBe(25000);
    expect(p.questions.map((q) => q.kind)).toEqual(["cannot_apply"]);
    expect(p.questions[0].question).toContain("giving.manage");
  });

  it("points out when oldest-first would pay a fee or a store order instead of a gift pledge", () => {
    const fee = pledge({ id: "fee", pledge_number: "PF-1", source: "pathshala_fee", amount_cents: 25000, pledged_at: "2025-12-01T12:00:00Z" });
    const p = plan({ pledges: [fee, BUILDING] });
    expect(p.lines[0].pledge_number).toBe("PF-1");
    const q = p.questions.find((x) => x.kind === "not_a_gift")!;
    expect(q.question).toContain("Pathshala fee (PF-1)");
    expect(q.question).toContain("is not a gift pledge");
    // Naming the pledges is the person deciding: no question.
    expect(plan({ pledges: [fee, BUILDING], mode: "choose", chosen: ["p2"] }).questions.map((x) => x.kind)).not.toContain("not_a_gift");
  });

  it("never invents money: applied plus left over is always the amount, in whole cents", () => {
    for (const cents of [1, 99, 25000, 25001, 124999, 125000, 125001, 999999]) {
      const p = plan({ amountCents: cents });
      expect(p.applied_cents + p.unallocated_cents).toBe(cents);
      expect(Number.isInteger(p.applied_cents) && Number.isInteger(p.unallocated_cents)).toBe(true);
    }
  });
});

describe("planDraftAllocation: a stored plan is run exactly, or refused", () => {
  it("stores each line with the pledge as it was, and orders pledges made at the same moment by id", () => {
    const same = "2026-02-01T12:00:00Z";
    const a = pledge({ id: "aaa", pledge_number: "P-10", pledged_at: same, amount_cents: 30000 });
    const b = pledge({ id: "bbb", pledge_number: "P-11", pledged_at: same, amount_cents: 30000 });
    // However the list arrives, the lower id is first and the plan says so.
    for (const order of [[a, b], [b, a]]) {
      const p = planDraftAllocation({ amountCents: 10000, pledges: order, mode: "auto", chosen: null, canAllocate: true, currency: "USD" });
      expect(p.stored).toEqual([{ pledge_id: "aaa", amount_cents: 10000, pledge_amount_cents: 30000, pledge_paid_cents: 0 }]);
    }
  });

  it("gives back the same plan when the pledges are unchanged, whatever order would be worked out now", () => {
    const first = plan({ amountCents: 40000 });
    const again = plan({ amountCents: 40000, forced: first.stored });
    expect(again.lines).toEqual(first.lines);
    expect(again.stored).toEqual(first.stored);
    expect(again.questions).toEqual(first.questions);
  });

  it("refuses a plan when a pledge was paid, changed or closed since the card was made", () => {
    const stored = plan({ amountCents: 25000 }).stored;
    const paidMore = { ...PARYUSHAN, paid_cents: 30000 };
    expect(() => plan({ amountCents: 25000, pledges: [BUILDING, paidMore], forced: stored })).toThrow(PlanChangedError);
    expect(() => plan({ amountCents: 25000, pledges: [BUILDING, paidMore], forced: stored })).toThrow("changed since this card was made (it is now $300.00 paid of $500.00)");
    const raised = { ...PARYUSHAN, amount_cents: 60000 };
    expect(() => plan({ amountCents: 25000, pledges: [BUILDING, raised], forced: stored })).toThrow("changed since this card was made");
    const closed = { ...PARYUSHAN, status: "paid", paid_cents: 50000 };
    expect(() => plan({ amountCents: 25000, pledges: [BUILDING, closed], forced: stored })).toThrow("no longer an open pledge");
    expect(() => plan({ amountCents: 25000, pledges: [BUILDING], forced: stored })).toThrow("no longer an open pledge");
  });

  it("refuses a plan that asks for more than the pledge has open, repeats a pledge, or adds up to more than the payment", () => {
    const line = { pledge_id: "p1", amount_cents: 26000, pledge_amount_cents: 50000, pledge_paid_cents: 25000 };
    expect(() => plan({ amountCents: 30000, forced: [line] })).toThrow("cannot take $260.00 ($250.00 is open)");
    const ok = { ...line, amount_cents: 25000 };
    expect(() => plan({ amountCents: 50000, forced: [ok, ok] })).toThrow("The same pledge is on this card twice");
    expect(() => plan({ amountCents: 10000, forced: [ok] })).toThrow("add up to more than the payment");
  });
});

describe("buildPaymentChecks: the list a reviewer goes through", () => {
  const checks = (over: Partial<Parameters<typeof buildPaymentChecks>[0]> = {}) =>
    buildPaymentChecks({
      currency: "USD",
      amountCents: 25000,
      method: "check",
      checkNumber: "1043",
      receivedOn: "2026-10-04",
      today: "2026-10-11",
      monthClosed: false,
      duplicates: [],
      checkNumberElsewhere: 0,
      plan: plan(),
      household: { number: "H-1001", city: "Sugar Land", adults: ["Priya Shah", "Rahul Shah"] },
      ...over,
    });
  const by = (list: ReturnType<typeof checks>, key: string) => list.find((c) => c.key === key)!;

  it("is all clear for an ordinary payment", () => {
    const list = checks();
    expect(list.map((c) => [c.key, c.status])).toEqual([
      ["household", "ok"],
      ["amount", "ok"],
      ["date", "ok"],
      ["month", "ok"],
      ["duplicates", "ok"],
      ["allocation", "ok"],
      ["second_person", "ok"],
    ]);
    expect(by(list, "household").detail).toContain("household H-1001 · Sugar Land · Priya Shah and Rahul Shah");
    expect(by(list, "amount").detail).toBe("$250.00 by Check, check 1043.");
    expect(by(list, "date").detail).toBe("Received 7 days ago (2026-10-04).");
  });

  it("points at a locked month and says what that means", () => {
    const list = checks({ monthClosed: true });
    expect(by(list, "month").status).toBe("look");
    expect(by(list, "month").detail).toContain("QuickBooks cannot post it until the month is reopened");
  });

  it("says unknown, not fine, when the person cannot see the month-end close", () => {
    expect(by(checks({ monthClosed: null }), "month").status).toBe("unknown");
  });

  it("points at likely duplicates and a repeated check number", () => {
    const list = checks({
      duplicates: [{ payment_id: "x", receipt_number: "R-0042", received_on: "2026-10-03", amount_cents: 25000, method: "check", check_number: "1043", same_check_number: true }],
      checkNumberElsewhere: 2,
    });
    const d = by(list, "duplicates");
    expect(d.status).toBe("look");
    expect(d.detail).toContain("R-0042 on 2026-10-03 for $250.00 (check 1043) may be the same payment");
    expect(d.detail).toContain("check 1043 is already on 2 payments of other households");
  });

  it("includes a Zelle warning, a missing check number, an old date and open questions", () => {
    const list = checks({
      method: "check",
      checkNumber: null,
      receivedOn: "2026-07-01",
      zelleNote: "This may already be recorded: a Zelle of $250.00 recorded by hand. Recording it again counts the gift twice.",
      plan: plan({ amountCents: 40000 }),
    });
    expect(by(list, "amount").status).toBe("look");
    expect(by(list, "date").status).toBe("look");
    expect(by(list, "date").detail).toContain("Dated 102 days ago");
    expect(by(list, "duplicates").detail).toContain("Recording it again counts the gift twice");
    expect(by(list, "allocation").status).toBe("look");
    expect(by(list, "allocation").detail).toBe("1 question to answer first (listed above).");
  });

  it("never names a child: the household line only carries the adults it was given", () => {
    const text = JSON.stringify(checks({ household: { number: "H-1001", city: null, adults: ["Priya Shah"] } }));
    expect(text).not.toContain("Zoya");
  });
});
