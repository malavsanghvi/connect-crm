import { describe, expect, it } from "vitest";

import { MAX_FAMILIES, matchedBy, matchedByText, readListSearch, searchFilter } from "@/lib/giving-lists/search";

const FAMILY = "1a2b3c4d-0000-4000-8000-000000000127";

describe("reading what was typed in a Giving list", () => {
  it("a receipt or pledge number is searched inside the numbers, and as a family identifier too", () => {
    expect(readListSearch("R-2026-0413", "USD")).toEqual({ text: "R-2026-0413", numberToken: "R-2026-0413", amountCents: null, familyText: "R-2026-0413" });
    expect(readListSearch("  receipt   100388 ", "USD")).toMatchObject({ text: "receipt 100388", numberToken: "100388", amountCents: null });
    expect(readListSearch("PL-20455", "USD")?.numberToken).toBe("PL-20455");
  });

  it("a bare number may be an amount, a part of a number or a household number: all three are tried", () => {
    expect(readListSearch("200", "USD")).toEqual({ text: "200", numberToken: "200", amountCents: 20_000, familyText: "200" });
    expect(readListSearch("0127", "USD")).toMatchObject({ numberToken: "0127", familyText: "0127" });
  });

  it("money with a symbol, a code or cents is only an amount, in any currency", () => {
    expect(readListSearch("$200", "USD")).toEqual({ text: "$200", numberToken: null, amountCents: 20_000, familyText: null });
    expect(readListSearch("200.00", "USD")).toMatchObject({ amountCents: 20_000, familyText: null, numberToken: null });
    expect(readListSearch("€250", "EUR")).toMatchObject({ amountCents: 25_000, familyText: null });
    expect(readListSearch("250 €", "EUR")).toMatchObject({ amountCents: 25_000, familyText: null });
    expect(readListSearch("250 EUR", "EUR")).toMatchObject({ amountCents: 25_000, familyText: null });
    expect(readListSearch("CAD 40", "CAD")).toMatchObject({ amountCents: 4_000, familyText: null });
    expect(readListSearch("₹1,25,000", "INR")).toMatchObject({ amountCents: 12_500_000, familyText: null });
  });

  it("a name in any language is a family; nothing is an amount when letters are in it", () => {
    expect(readListSearch("Fernández Ruiz", "EUR")).toEqual({ text: "Fernández Ruiz", numberToken: null, amountCents: null, familyText: "Fernández Ruiz" });
    expect(readListSearch("Okafor", "USD")?.amountCents).toBeNull();
    expect(readListSearch("   ", "USD")).toBeNull();
    expect(readListSearch(undefined, "USD")).toBeNull();
  });

  it("characters that would break the database filter never reach it", () => {
    const s = readListSearch("R-1,(2)*", "USD");
    expect(s?.numberToken).toBe("R-12");
    expect(searchFilter(s!, { numberColumn: "receipt_number", householdIds: [] })).toBe("receipt_number.ilike.*R-12*");
  });
});

describe("the database filter of a list search", () => {
  it("matches a number, an amount or a family the household search found", () => {
    const s = readListSearch("200", "USD")!;
    expect(searchFilter(s, { numberColumn: "receipt_number", householdIds: [FAMILY] })).toBe(
      `receipt_number.ilike.*200*,amount_cents.eq.20000,household_id.in.(${FAMILY})`,
    );
  });

  it("is null when nothing could match, so the list is empty without asking", () => {
    expect(searchFilter(readListSearch("Nobody", "USD")!, { numberColumn: "pledge_number", householdIds: [] })).toBeNull();
  });

  it("never sends more than the first families, and only real ids", () => {
    const ids = Array.from({ length: 80 }, (_, i) => `1a2b3c4d-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const f = searchFilter(readListSearch("Okafor", "USD")!, { numberColumn: null, householdIds: [...ids, "not-an-id"] })!;
    expect(f.split(",").length).toBe(MAX_FAMILIES);
    expect(f).not.toContain("not-an-id");
  });

  it("each row says why it was found", () => {
    const s = readListSearch("413", "USD");
    expect(matchedBy(s, { number: "R-2026-0413", amountCents: 1, householdId: null }, new Set())).toBe("number");
    expect(matchedBy(readListSearch("$40", "USD"), { number: "R-1", amountCents: 4_000, householdId: null }, new Set())).toBe("amount");
    expect(matchedBy(readListSearch("Kim", "USD"), { number: "R-1", amountCents: 1, householdId: FAMILY }, new Set([FAMILY]))).toBe("family");
    expect(matchedByText("number", "receipt number")).toBe("Found by its receipt number");
    expect(matchedBy(null, { number: "R-1", amountCents: 1, householdId: null }, new Set())).toBeNull();
  });
});
