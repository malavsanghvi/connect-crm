import { describe, expect, it } from "vitest";

import { MAX_CANDIDATES, depositSetsSentence, findDepositSets, type DepositPayment } from "@/lib/bank-reconcile/deposit-sets";

// The bounded subset-sum behind "Bank these payments" (plan 5.6): all the candidates first, then oldest first, at most 3 sets, and when
// more than one set fits nothing is chosen for the person.

const pay = (id: string, amountCents: number, receivedOn: string | null): DepositPayment => ({ id, amountCents, receivedOn, receipt: `R-${id}` });
const count = (n: number) => `${n} ${n === 1 ? "payment" : "payments"}`;

describe("findDepositSets", () => {
  it("prefers all the candidates when they add up (the prototype's four payments, $1,260)", () => {
    const r = findDepositSets([pay("a", 30000, "2026-10-05"), pay("b", 41000, "2026-10-06"), pay("c", 35000, "2026-10-09"), pay("d", 20000, "2026-10-11")], 126000);
    expect(r).toMatchObject({ sets: [["a", "b", "c", "d"]], allFit: true, ambiguous: false, complete: true });
  });

  it("finds the one subset that adds up, oldest first, and says only one fits", () => {
    const r = findDepositSets([pay("a", 30000, "2026-10-05"), pay("b", 41000, "2026-10-06"), pay("c", 35000, "2026-10-09"), pay("x", 7777, "2026-10-10")], 76000);
    // 41000 + 35000 = 76000 is the only way to $760.00.
    expect(r.sets).toEqual([["b", "c"]]);
    expect(r.allFit).toBe(false);
    expect(r.ambiguous).toBe(false);
    expect(r.complete).toBe(true);
    expect(depositSetsSentence(r, count)).toContain("Only one set");
  });

  it("returns up to 3 sets, oldest payments first, and chooses nothing when more than one fits", () => {
    // Four 10.00 checks and a 20.00 check: $20.00 can be made 5 ways. The oldest-first ones come first.
    const r = findDepositSets(
      [pay("p1", 1000, "2026-10-01"), pay("p2", 1000, "2026-10-02"), pay("p3", 1000, "2026-10-03"), pay("p4", 1000, "2026-10-04"), pay("big", 2000, "2026-10-05"), pay("odd", 333, "2026-10-06")],
      2000,
    );
    expect(r.sets).toHaveLength(3);
    expect(r.sets[0]).toEqual(["p1", "p2"]);
    expect(r.sets[1]).toEqual(["p1", "p3"]);
    expect(r.sets[2]).toEqual(["p1", "p4"]);
    expect(r.ambiguous).toBe(true);
    expect(r.complete).toBe(false); // more than the three sets listed fit
    expect(depositSetsSentence(r, count)).toMatch(/combinations add up/);
    expect(depositSetsSentence(r, count)).toContain("Nothing is chosen for you");
  });

  it("says two combinations when exactly two fit", () => {
    const r = findDepositSets([pay("a", 500, "2026-10-01"), pay("b", 700, "2026-10-02"), pay("c", 300, "2026-10-03"), pay("d", 900, "2026-10-04")], 1200);
    // 500+700 and 300+900
    expect(r.sets).toEqual([["a", "b"], ["c", "d"]]);
    expect(r.ambiguous).toBe(true);
    expect(r.complete).toBe(true);
    expect(depositSetsSentence(r, count)).toMatch(/^2 combinations/);
  });

  it("returns nothing when no set adds up, and says so", () => {
    const r = findDepositSets([pay("a", 1000, "2026-10-01"), pay("b", 2000, "2026-10-02")], 1500);
    expect(r.sets).toEqual([]);
    expect(r.complete).toBe(true);
    expect(depositSetsSentence(r, count)).toContain("No combination");
  });

  it("is exact to the cent and ignores non-positive or fractional amounts", () => {
    const r = findDepositSets([pay("a", 1001, "2026-10-01"), pay("b", 0, "2026-10-02"), pay("c", -500, "2026-10-02"), pay("d", 10.5, "2026-10-03"), pay("e", 999, "2026-10-04")], 2000);
    expect(r.sets).toEqual([["a", "e"]]);
    expect(findDepositSets([pay("a", 1000, "2026-10-01")], 0).sets).toEqual([]);
    expect(findDepositSets([pay("a", 1000, "2026-10-01")], Number.NaN).sets).toEqual([]);
    expect(findDepositSets([], 1000).sets).toEqual([]);
  });

  it("searches only the oldest 40 payments and says how many were left out", () => {
    const many = Array.from({ length: 45 }, (_, i) => pay(`m${String(i).padStart(2, "0")}`, 100 + i, `2026-09-${String((i % 28) + 1).padStart(2, "0")}`));
    // A target that only the newest (left out) payments could make is not found, and the result is not "complete".
    const r = findDepositSets(many, 1);
    expect(r.searched).toBe(MAX_CANDIDATES);
    expect(r.leftOut).toBe(5);
    expect(r.sets).toEqual([]);
    expect(r.complete).toBe(false);
  });

  it("stops at the step bound and does not claim the result is complete", () => {
    // Every amount is even and the target is odd: no set fits, but only trying them all can show it.
    const forty = Array.from({ length: 40 }, (_, i) => pay(`q${String(i).padStart(2, "0")}`, 1000 + 2 * (i % 7), `2026-09-${String((i % 28) + 1).padStart(2, "0")}`));
    const r = findDepositSets(forty, 20_001, { maxNodes: 500 });
    expect(r.complete).toBe(false);
    expect(r.sets).toEqual([]);
    expect(depositSetsSentence(r, count)).toContain("in the time allowed");
  });

  it("does not choose a single set when the search was cut short", () => {
    const items = Array.from({ length: 30 }, (_, i) => pay(`z${String(i).padStart(2, "0")}`, 100, `2026-09-${String((i % 28) + 1).padStart(2, "0")}`));
    // Many sets fit; with a tiny bound only the first is found before the cut.
    const r = findDepositSets(items, 300, { maxNodes: 40 });
    if (r.sets.length === 1) {
      expect(r.ambiguous).toBe(true);
      expect(depositSetsSentence(r, count)).toContain("did not look at every combination");
    }
    expect(r.complete).toBe(false);
  });

  it("orders payments with no date last, and breaks ties by receipt", () => {
    const r = findDepositSets([pay("undated", 500, null), pay("old", 500, "2026-01-01"), pay("x", 700, "2026-02-01")], 1200);
    // 500 + 700: both 500s fit with 700; a payment with no date counts as the newest, so the dated one comes first.
    expect(r.sets).toEqual([["old", "x"], ["x", "undated"]]);
  });
});
