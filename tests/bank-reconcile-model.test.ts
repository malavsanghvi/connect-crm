import { describe, expect, it } from "vitest";

import {
  batchSummary,
  groupLines,
  groupOf,
  isBatchEligible,
  kindWord,
  parseStatement,
  rowAction,
  type Candidate,
  type StatementLine,
} from "@/lib/bank-reconcile/model";
import { daysText, householdUnbanked, nextStep, parseUnbanked } from "@/lib/bank-reconcile/unbanked";

// reconcile_statement / unbanked_payments_report answers (0868), their groups, and the action each candidate maps to.

const H = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";

const cand = (o: Partial<Candidate>): Candidate => ({
  tier: "A",
  kind: "payment",
  refId: P,
  householdId: H,
  householdName: "Okafor household",
  label: "Receipt R-2288, check, Oct 6, not yet on the bank",
  reasons: ["Amount matches", "Reference matches"],
  consequence: "The line is attached to this payment. No pledge changes.",
  blocked: false,
  ...o,
});
const line = (id: string, candidates: Candidate[], amountCents = 20000): StatementLine => ({
  id,
  postedOn: "2026-10-14",
  amountCents,
  description: "CHECK 1048 DEPOSITED",
  channel: "check",
  reference: "1048",
  payerName: null,
  candidates,
});

describe("parseStatement", () => {
  const wire = [
    {
      txn: { id: "t1", posted_on: "2026-10-14", amount_cents: 20000, description: "CHECK 1048", channel: "check", reference: "1048", payer_name: null },
      candidates: [{ tier: "A", kind: "proof", ref_id: P, household_id: H, household_name: "Okafor household", label: "Proof", reasons: ["Amount matches"], consequence: "x", blocked: false }],
    },
    { txn: { id: "t2", posted_on: "2026-10-13", amount_cents: 5000, description: "ZELLE", channel: null, reference: null, payer_name: "K MENSAH" }, candidates: [] },
  ];
  it("reads the lines and their candidates", () => {
    const lines = parseStatement(wire)!;
    expect(lines).toHaveLength(2);
    expect(lines[0].candidates[0]).toMatchObject({ tier: "A", kind: "proof", refId: P, householdId: H, reasons: ["Amount matches"] });
    expect(lines[1].candidates).toEqual([]);
    expect(lines[1].payerName).toBe("K MENSAH");
  });
  it("is null for a shape it does not know, never an empty preview", () => {
    expect(parseStatement({})).toBeNull();
    expect(parseStatement([{ txn: null }])).toBeNull();
    expect(parseStatement([{ txn: wire[0].txn, candidates: [{ tier: "Z", kind: "payment", household_id: H }] }])).toBeNull();
    expect(parseStatement([{ txn: wire[0].txn, candidates: [{ tier: "A", kind: "mystery", household_id: H }] }])).toBeNull();
  });
});

describe("groups", () => {
  const certain = line("a", [cand({})]);
  const likely = line("b", [cand({ tier: "B", kind: "proof" })]);
  const possible = line("c", [cand({ tier: "C", kind: "proof" }), cand({ tier: "C", kind: "proof", refId: "x" })]);
  const conflict = line("d", [cand({ tier: "D", kind: "conflict" })]);
  const already = line("e", [cand({ tier: "D", kind: "lookalike", refId: null, blocked: true })]);
  const money = line("f", [cand({ tier: "B", kind: "new_money", refId: null })]);
  const review = line("g", []);
  it("puts a line in the group of its best candidate", () => {
    expect([certain, likely, possible, conflict, already, money, review].map(groupOf)).toEqual(["certain", "likely", "possible", "conflict", "already", "money", "review"]);
  });
  it("lists only the groups that have lines, in the plan's order, and only Certain batches", () => {
    const groups = groupLines([money, certain, review, likely]);
    expect(groups.map((g) => g.key)).toEqual(["certain", "likely", "money", "review"]);
    expect(groups.find((g) => g.key === "certain")?.batch).toBe(true);
    expect(groups.filter((g) => g.batch)).toHaveLength(1);
  });
});

describe("the Tier A batch", () => {
  it("takes only a Certain row that explains money already counted", () => {
    expect(isBatchEligible(line("a", [cand({})]))).toBe(true);
    expect(isBatchEligible(line("a", [cand({ kind: "proof" })]))).toBe(true);
    expect(isBatchEligible(line("a", [cand({ kind: "zelle_report", refId: P })]))).toBe(true);
  });
  it("never takes new money, a blocked row, a lookalike, a conflict, a Tier B row, or a line with two Certain candidates", () => {
    expect(isBatchEligible(line("a", [cand({ kind: "new_money", refId: null })]))).toBe(false);
    expect(isBatchEligible(line("a", [cand({ blocked: true })]))).toBe(false);
    expect(isBatchEligible(line("a", [cand({ kind: "lookalike", refId: null })]))).toBe(false);
    expect(isBatchEligible(line("a", [cand({ kind: "conflict" })]))).toBe(false);
    expect(isBatchEligible(line("a", [cand({ tier: "B" })]))).toBe(false);
    expect(isBatchEligible(line("a", [cand({}), cand({ refId: "other" })]))).toBe(false);
    expect(isBatchEligible(line("a", []))).toBe(false);
  });
  it("summarises each result and never says everything went through when a row did not", () => {
    expect(batchSummary([]).text).toBe("No rows were ticked.");
    expect(batchSummary([{ lineId: "a", ok: true, message: "ok" }]).text).toBe("All 1 row applied.");
    const s = batchSummary([
      { lineId: "a", ok: true, message: "ok" },
      { lineId: "b", ok: false, message: "That payment was already banked." },
    ]);
    expect(s).toMatchObject({ done: 1, failed: 1 });
    expect(s.text).toContain("1 applied, 1 did not go through");
  });
});

describe("what each candidate does", () => {
  const l = line("t", []);
  it("attaches a recorded payment, and approves a waiting proof with the line (nothing created twice)", () => {
    expect(rowAction(cand({ kind: "payment" }), null, l, "USD")).toMatchObject({ type: "attach", paymentId: P });
    expect(rowAction(cand({ kind: "proof" }), null, l, "USD")).toMatchObject({ type: "approve", proofId: P, label: "Approve and reconcile" });
  });
  it("uses the existing confirm flow for a Zelle report and for new money", () => {
    expect(rowAction(cand({ kind: "zelle_report", refId: "rep" }), null, l, "USD")).toEqual({ type: "confirm", householdId: H, reportId: "rep", label: "Confirm" });
    expect(rowAction(cand({ kind: "new_money", refId: null }), null, l, "USD")).toEqual({ type: "confirm", householdId: H, reportId: null, label: "Confirm" });
  });
  it("asks for a choice on a lookalike, and for the bank's amount on a conflict with a proof", () => {
    expect(rowAction(cand({ kind: "lookalike", refId: null }), null, l, "USD")).toEqual({ type: "lookalike", householdId: H });
    expect(rowAction(cand({ kind: "conflict" }), "proof", line("t", [], 18000), "USD")).toMatchObject({ type: "conflict_proof", proofId: P, label: "Approve at $180.00 and reconcile" });
    expect(rowAction(cand({ kind: "conflict" }), "payment", l, "USD")).toEqual({ type: "conflict_payment" });
    expect(rowAction(cand({ kind: "conflict" }), null, l, "USD").type).toBe("none");
    expect(rowAction(cand({ kind: "payment", refId: null }), null, l, "USD").type).toBe("none");
  });
  it("names each kind in words", () => {
    expect(kindWord("payment")).toBe("Banks a payment already recorded");
    expect(kindWord("proof")).toBe("Settles a waiting confirmation");
    expect(kindWord("lookalike")).toBe("Lookalike: blocked");
  });
});

describe("the Unbanked report", () => {
  const wire = [
    { payment_id: "p1", receipt_number: "R-2026-0348", household_id: H, household_name: "Patel household", method: "check", amount_cents: 40000, verified_on: "2026-09-10", source: "proof", days: 35, window: 30, past_window: true },
    { payment_id: "p2", receipt_number: "R-2026-0211", household_id: H, household_name: "Patel household", method: "cash", amount_cents: 6000, verified_on: "2026-09-26", source: "recorded by hand", days: 19, window: 14, past_window: true },
    { payment_id: "p3", receipt_number: null, household_id: "h2", household_name: "Hossain household", method: "ach", amount_cents: 9000, verified_on: "2026-10-08", source: "recorded by hand", days: 7, window: 7, past_window: false },
  ];
  const rows = parseUnbanked(wire)!;
  it("reads the rows and flags the ones past their window", () => {
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.pastWindow).map((r) => r.paymentId)).toEqual(["p1", "p2"]);
    expect(daysText(rows[0])).toBe("35 / 30 · past");
    expect(daysText(rows[2])).toBe("7 / 7 · due today");
    expect(parseUnbanked("nope")).toBeNull();
    expect(parseUnbanked([{ payment_id: "p" }])).toBeNull();
  });
  it("says the next step by method, and waits inside the window", () => {
    expect(nextStep(rows[0])).toBe("Ask the family whether the check was sent");
    expect(nextStep(rows[1])).toBe("Look in the next deposit or offering count");
    expect(nextStep(rows[2])).toBe("Check tomorrow");
    expect(nextStep({ method: "zelle", pastWindow: false, days: 1, window: 5 })).toContain("Nothing to do yet");
  });
  it("adds up one household for its tile", () => {
    expect(householdUnbanked(rows, H)).toEqual({ count: 2, cents: 46000, oldestDays: 35 });
    expect(householdUnbanked(rows, "nobody")).toEqual({ count: 0, cents: 0, oldestDays: 0 });
  });
});
