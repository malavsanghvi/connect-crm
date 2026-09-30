import { describe, expect, it } from "vitest";

import { autoMapColumns, buildHouseholdFile, buildPaymentFile, methodOf, missingRequired, toPayerInputs, validateDonations } from "@/lib/onboarding/donations";
import { applyDecisions, matchPayers } from "@/lib/onboarding/match";

const headers = ["Donor", "Gift Amount", "Payment Date", "Payment Method", "Email Address", "Mobile", "Street", "ZIP Code", "Campaign", "Internal code"];
const rows = [
  ["Malav Sanghvi", "$1,001.00", "09/02/2024", "Zelle", "Malav@Example.com", "281-555-0142", "12 Lotus Lane", "77478", "Paryushan", "A-1"],
  ["Sanghvi, Malav & Palak", "251", "2024-10-03", "Cheque", "", "(281) 555 0142", "12 Lotus Ln", "77478", "Diwali", ""],
  ["", "10", "2024-10-03", "cash", "", "", "", "", "", ""],
  ["Amit Patel", "abc", "2024-10-03", "cash", "bad-email", "", "", "", "", ""],
];

describe("donation mapping", () => {
  it("maps columns by their words; unknown ones become custom data; all-blank ones are skipped", () => {
    const c = autoMapColumns(headers, rows);
    expect(c.slice(0, 8)).toEqual(["name", "amount", "date", "method", "email", "phone", "address1", "zip"]);
    expect(c[8]).toBe("memo"); // "Campaign" is a known word for the memo
    expect(c[9]).toBe("custom");
    expect(missingRequired(c)).toHaveLength(0);
    expect(missingRequired(["name"]).map((f) => f.key)).toEqual(["amount", "date"]);
  });

  it("recognises how it was paid", () => {
    expect(methodOf("Cheque").value).toBe("check");
    expect(methodOf("Credit Card").value).toBe("card");
    expect(methodOf("Zelle payment").value).toBe("zelle");
    expect(methodOf("Fidelity Charitable").value).toBe("daf");
    expect(methodOf("barter").known).toBe(false);
  });
});

describe("donation validation", () => {
  const choices = autoMapColumns(headers, rows);
  const v = validateDonations(headers, rows, choices);
  it("keeps the good rows and lists the bad ones by the file's own row number", () => {
    expect(v.rows.map((r) => r.rowNo)).toEqual([2, 3]);
    expect([...v.badRows].sort()).toEqual([4, 5]);
    expect(v.problems.find((p) => p.rowNo === 4)?.column).toBe("Payer name");
    expect(v.problems.find((p) => p.rowNo === 5 && p.column === "Amount")).toBeTruthy();
  });
  it("drops a bad optional value with a warning instead of failing the row", () => {
    expect(v.problems.some((p) => p.rowNo === 5 && p.column === "Email" && p.level === "warning")).toBe(true);
  });
  it("types the values: cents, ISO date, E.164 phone, lower-cased email, method", () => {
    const r = v.rows[0]!;
    expect(r.amountCents).toBe(100100);
    expect(r.receivedOn).toBe("2024-09-02");
    expect(r.phone).toBe("+12815550142");
    expect(r.email).toBe("malav@example.com");
    expect(r.method).toBe("zelle");
    expect(r.extras).toEqual({ "Internal code": "A-1" });
  });
});

describe("onboarding files for the import tool", () => {
  const choices = autoMapColumns(headers, rows);
  const v = validateDonations(headers, rows, choices);
  const m = matchPayers(toPayerInputs(v.rows));
  const groups = applyDecisions(m, new Set());
  it("two spellings of one family become one household with both names kept", () => {
    expect(groups).toHaveLength(1);
    const h = buildHouseholdFile(groups, v.rows, v.rows);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]![0]).toBe("ONB-H-00001");
    expect(h.rows[0]![7]).toContain("Malav Sanghvi");
    expect(h.rows[0]![2]).toBe("12 Lotus Lane");
  });
  it("every payment links to its household with a stable number and dollars", () => {
    const p = buildPaymentFile(groups, v.rows);
    expect(p.rows).toHaveLength(2);
    expect(p.rows.every((r) => r[1] === "ONB-H-00001")).toBe(true);
    expect(p.rows[0]![2]).toBe("1001.00");
    expect(new Set(p.rows.map((r) => r[0])).size).toBe(2);
    expect(p.headers).toContain("Internal code");
  });
});
