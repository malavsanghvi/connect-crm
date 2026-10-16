import { describe, expect, it } from "vitest";

import { parseBankStatementCsv } from "@/lib/csv";
import { buildTestStatement, isTestCommunity, sampleLines, type SampleSource } from "@/lib/test-statement";

const source = (over: Partial<SampleSource> = {}): SampleSource => ({
  today: "2026-10-16",
  format: "chase_csv",
  pledges: [
    { payer: "Anita Bhandari", cents: 15100 },
    { payer: "Tarun Patni", cents: 5100 },
  ],
  payments: [{ payer: "Meera Doshiwal", method: "check", cents: 25100, checkNumber: "1042" }],
  proofs: [{ payer: "Asha Varma", method: "zelle", cents: 50000, reference: null }],
  ...over,
});

describe("the Test Bank Statement", () => {
  it("is offered only in a sandbox or a demo community", () => {
    expect(isTestCommunity({ environment: "sandbox" })).toBe(true);
    expect(isTestCommunity({ environment: "production", rules: { demo: true } })).toBe(true);
    expect(isTestCommunity({ environment: "production" }, true)).toBe(true);
    expect(isTestCommunity({ environment: "production", rules: {} })).toBe(false);
    expect(isTestCommunity({ environment: "production", rules: null })).toBe(false);
  });

  it("makes a line for each thing the Reconcile view does, and the exact amounts of what is waiting", () => {
    const lines = sampleLines(source());
    const amounts = lines.map((l) => l.cents);
    // Open pledges (the uncovered amount), a recorded payment, a waiting confirmation, an unknown payer, an unexplained deposit, a fee.
    expect(amounts).toEqual(expect.arrayContaining([15100, 5100, 25100, 50000, 7500, 25000, -1200]));
    expect(lines.find((l) => l.cents === 25100)?.check).toBe("1042");
    expect(lines.find((l) => l.cents === 50000)?.description).toMatch(/^Zelle payment from Asha Varma /);
    expect(lines.find((l) => l.cents === 7500)?.description).toContain("Jordan Visitor");
    // Newest first.
    expect(lines.map((l) => l.daysAgo)).toEqual([...lines.map((l) => l.daysAgo)].sort((a, b) => a - b));
  });

  it("still has the unknown payer, the deposit and the fee in a community with no data yet", () => {
    const lines = sampleLines(source({ pledges: [], payments: [], proofs: [] }));
    expect(lines.map((l) => l.cents).sort((a, b) => a - b)).toEqual([-1200, 7500, 25000]);
  });

  it("writes a Chase file the importer reads without a complaint, money in only unless debits are asked for", () => {
    const { csv } = buildTestStatement(source());
    expect(csv.split("\n")[0]).toBe("Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #");
    const parsed = parseBankStatementCsv(csv);
    expect(parsed.format).toBe("chase_csv");
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.every((r) => r.amount_cents > 0)).toBe(true);
    expect(parsed.skippedDebits).toBe(1);
    expect(parseBankStatementCsv(csv, { includeDebits: true }).rows.some((r) => r.amount_cents === -1200)).toBe(true);
    expect(parsed.rows.find((r) => r.amount_cents === 25100)?.check_or_slip).toBe("1042");
    // The dates run back from today in the community's own calendar.
    expect(parsed.periodEnd).toBe("2026-10-15");
    expect(parsed.periodStart).toBe("2026-10-08");
  });

  it("writes the generic file for an account set up for it", () => {
    const { csv } = buildTestStatement(source({ format: "generic_csv" }));
    expect(csv.split("\n")[0]).toBe("Date,Amount,Description,Check number");
    const parsed = parseBankStatementCsv(csv);
    expect(parsed.format).toBe("generic_csv");
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.find((r) => r.amount_cents === 25100)?.check_or_slip).toBe("1042");
  });

  it("quotes a name that has a comma in it", () => {
    const { csv } = buildTestStatement(source({ pledges: [{ payer: 'Rao, "Mina"', cents: 10000 }], payments: [], proofs: [] }));
    const parsed = parseBankStatementCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.find((r) => r.amount_cents === 10000)?.description).toContain('Rao, "Mina"');
  });
});
