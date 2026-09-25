import { describe, expect, it } from "vitest";

import { givingHistoryTotals, OPENING_BALANCE_HINT, parseYearEndStatement } from "@/lib/giving";

// Wave F f-money: year-end statements leave out opening-balance lines (0522).
describe("year-end statements and opening balances", () => {
  it("reads app.year_end_statement's answer", () => {
    expect(
      parseYearEndStatement({
        tax_year: 2025, gift_count: 2, total_cents: 15000, lines: [],
        left_out: { opening_balance_count: 1, opening_balance_cents: "50000", reason: "Opening-balance lines are left out: …" },
      }),
    ).toEqual({ tax_year: 2025, gift_count: 2, total_cents: 15000, left_out: { opening_balance_count: 1, opening_balance_cents: 50000, reason: "Opening-balance lines are left out: …" } });
    expect(parseYearEndStatement({ tax_year: 2025, gift_count: 0, total_cents: 0, left_out: { opening_balance_count: 0, opening_balance_cents: 0, reason: null } })?.left_out.reason).toBeNull();
  });
  it("refuses an answer of the wrong shape rather than showing zero", () => {
    expect(parseYearEndStatement(null)).toBeNull();
    expect(parseYearEndStatement([])).toBeNull();
    expect(parseYearEndStatement({ tax_year: 2025 })).toBeNull();
  });
  it("keeps opening balances apart in the giving history totals", () => {
    expect(
      givingHistoryTotals([
        { amount_cents: 10000, is_opening_balance: false },
        { amount_cents: 50000, is_opening_balance: true },
        { amount_cents: 2500 },
      ]),
    ).toEqual({ receivedCents: 12500, openingCents: 50000, openingCount: 1 });
  });
  it("says why an opening balance is not on a statement", () => {
    expect(OPENING_BALANCE_HINT).toMatch(/before the imported payment history/);
    expect(OPENING_BALANCE_HINT).toMatch(/left out of year-end statements/);
  });
});
