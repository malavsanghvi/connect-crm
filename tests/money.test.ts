import { describe, expect, it } from "vitest";

import { formatCents, parseAmountToCents, sumCents } from "@/lib/money";

describe("formatCents", () => {
  it("formats integer cents as dollars", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(10100)).toBe("$101.00");
  });

  it("formats negatives with a leading minus", () => {
    expect(formatCents(-5)).toBe("-$0.05");
    expect(formatCents(-250075)).toBe("-$2,500.75");
  });

  it("never shows a missing amount as $0.00", () => {
    expect(formatCents(null)).toBe("—");
    expect(formatCents(undefined)).toBe("—");
    expect(formatCents(Number.NaN)).toBe("—");
  });

  it("is exact for large amounts and bigint", () => {
    expect(formatCents(900719925474099)).toBe("$9,007,199,254,740.99");
    expect(formatCents(BigInt(5010000))).toBe("$50,100.00");
  });
});

describe("parseAmountToCents", () => {
  it.each([
    ["251", 25100],
    ["251.5", 25150],
    ["251.05", 25105],
    ["$1,234.56", 123456],
    [" 12.00 ", 1200],
    [".5", 50],
    ["-12.00", -1200],
    ["(12.00)", -1200],
    ["$-3.10", -310],
    ["+7", 700],
    ["-$12.50", -1250],
    ["($1,000.00)", -100000],
  ])("parses %j", (input, cents) => {
    expect(parseAmountToCents(input)).toBe(cents);
  });

  it.each(["", "abc", "12.345", "1.2.3", "$", "12,34a", "--5", "-$-5", "(-5)", "+-5", null, undefined])("rejects %j", (input) => {
    expect(parseAmountToCents(input as string)).toBeNull();
  });
});

describe("sumCents", () => {
  it("ignores missing values", () => {
    expect(sumCents([100, null, 250, undefined])).toBe(350);
  });
});
