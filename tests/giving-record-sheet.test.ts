import { describe, expect, it } from "vitest";

import { composeFamilyGiving, owesLine, paymentTitle, type GivingHousehold } from "@/lib/giving-actions/family-giving";
import { householdRef, recordButtonLabel, recordedLabel, recordedLines, sheetStart, whatHappens } from "@/lib/giving-actions/record-sheet";

// The Record payment sheet's words (docs/GIVING_REDESIGN.md section 5): the button names the amount and the family, what happens is
// said before the click, someone who may not apply payments is told so, and a family is never named by its name alone.

const patel = { id: "h1", name: "Patel", number: "0127", orgId: "RCC-H-1127", primary: "Asha Patel", city: "Riverside" };
const pledges = [
  { id: "a", pledge_number: "PL-20455", amount_cents: 50000, paid_cents: 30000, pledged_at: "2026-01-10" },
  { id: "b", pledge_number: "PL-20460", amount_cents: 30000, paid_cents: 0, pledged_at: "2026-03-01" },
];
const base = { pledges, mode: "auto" as const, chosen: [], canAllocate: true, currency: "USD", locale: "en-US" };

describe("the button", () => {
  it("names the amount, the method and the family with its number", () => {
    expect(recordButtonLabel({ amount: "200", method: "check", family: patel, currency: "USD" })).toBe("Record $200.00 check for the Patel household 0127");
    expect(recordButtonLabel({ amount: "45.5", method: "zelle", family: patel, currency: "USD" })).toBe("Record $45.50 Zelle payment for the Patel household 0127");
    expect(recordButtonLabel({ amount: "5000", method: "cash", family: { ...patel, name: "Otieno household", number: "0031" }, currency: "KES", locale: "en-KE" }).replace(/\s/g, " ")).toBe(
      "Record Ksh 5,000.00 cash for the Otieno household 0031",
    );
  });

  it("asks for what is missing instead of naming nothing", () => {
    expect(recordButtonLabel({ amount: "200", method: "check", family: null, currency: "USD" })).toBe("Choose the family first");
    expect(recordButtonLabel({ amount: "abc", method: "check", family: patel, currency: "USD" })).toBe("Enter the amount");
  });

  it("keeps a name that already says household, and says when no number is on file", () => {
    expect(householdRef({ name: "Okafor Household", number: "0212" })).toBe("the Okafor Household 0212");
    expect(householdRef({ name: "Lindqvist", number: null })).toBe("the Lindqvist household");
  });

  it("after the server said so: Recorded as the receipt number, and what it was applied to", () => {
    expect(recordedLabel({ receiptNumber: "R-2026-0413" })).toBe("Recorded as R-2026-0413");
    expect(recordedLabel({ receiptNumber: null })).toBe("Recorded (receipt number pending)");
    const r = { receiptNumber: "R-1", amountCents: 30000, applied: [{ pledge_number: "PL-20455", amount_cents: 20000, closed: true }], unallocatedCents: 10000 };
    expect(recordedLines(r, "USD")).toEqual(["Applied to PL-20455 ($200.00, closed).", "$100.00 stays unapplied as a general gift."]);
  });
});

describe("what happens, before the click", () => {
  it("closes the earliest pledge and says what stays open", () => {
    expect(whatHappens({ ...base, amountCents: 20000 })).toBe("Closes PL-20455 and leaves $300.00 open.");
    expect(whatHappens({ ...base, amountCents: 10000 })).toBe("Pays $100.00 toward PL-20455 and leaves $400.00 open.");
    expect(whatHappens({ ...base, amountCents: 30000 })).toBe("Closes PL-20455, pays $100.00 toward PL-20460 and leaves $200.00 open.");
    expect(whatHappens({ ...base, amountCents: 60000 })).toBe("Closes PL-20455 and PL-20460 and leaves nothing open. $100.00 stays unapplied as a general gift.");
  });

  it("follows the chosen pledge, and a general gift", () => {
    expect(whatHappens({ ...base, amountCents: 30000, mode: "choose", chosen: ["b"] })).toBe("Closes PL-20460 and leaves $200.00 open.");
    expect(whatHappens({ ...base, amountCents: 30000, mode: "none" })).toBe("Recorded as a general gift, not applied to any pledge.");
    expect(whatHappens({ ...base, amountCents: 30000, pledges: [] })).toBe("No open pledge: the full $300.00 is recorded as a general gift.");
  });

  it("tells someone who may not apply payments that it is recorded but not applied", () => {
    expect(whatHappens({ ...base, amountCents: 20000, canAllocate: false })).toBe("Recorded but not applied: a treasurer can apply it to the family's pledges.");
  });
});

describe("the fields it opens with", () => {
  it("takes what the box read, else a check received today; never a date in the future", () => {
    expect(sheetStart({ amount: "200.00", method: "zelle", receivedOn: "2026-10-12", reference: "ZL1" }, "2026-10-13", true)).toEqual({
      amount: "200.00",
      method: "zelle",
      receivedOn: "2026-10-12",
      reference: "ZL1",
      mode: "auto",
    });
    expect(sheetStart({ receivedOn: "2026-12-01", amount: "-5" }, "2026-10-13", false)).toEqual({ amount: "", method: "check", receivedOn: "2026-10-13", reference: "", mode: "none" });
  });
});

describe("a family's giving", () => {
  const household: GivingHousehold = { ...patel, cardLine: "No. 0127 · RCC-H-1127 · Asha & Ravi Patel · Riverside" };
  const pledge = (id: string, at: string, amount: number, paid: number, status = "open") => ({ id, pledge_number: `PL-${id}`, campaign: null, amount_cents: amount, paid_cents: paid, pledged_at: at, due_on: null, status });
  const pay = (id: string, on: string) => ({ id, receipt_number: `R-${id}`, amount_cents: 1000, refunded_cents: 0, method: "check", status: "captured", received_on: on });

  it("owes what is open on its open pledges, oldest pledge first, newest gift first", () => {
    const g = composeFamilyGiving({ household, pledges: [pledge("2", "2026-05-01", 30000, 0), pledge("1", "2026-01-01", 50000, 38800)], payments: [pay("a", "2026-09-01"), pay("b", "2026-10-01")], focus: null });
    expect(g.owesCents).toBe(41200);
    expect(g.pledges.map((p) => p.id)).toEqual(["1", "2"]);
    expect(g.payments.map((p) => p.id)).toEqual(["b", "a"]);
    expect(owesLine(g, "USD")).toBe("Owes $412.00 on 2 open pledges.");
    expect(owesLine({ owesCents: 0, pledges: [] }, "USD")).toBe("Owes nothing: no open pledge.");
  });

  it("puts the payment the box found first, even an older one", () => {
    const recent = ["a", "b", "c", "d", "e"].map((id, i) => pay(id, `2026-10-0${i + 1}`));
    const old = pay("old", "2025-01-01");
    const g = composeFamilyGiving({ household, pledges: [], payments: recent, focus: { kind: "payment", id: "old" }, focusPayment: old });
    expect(g.payments[0].id).toBe("old");
    expect(g.focus).toEqual({ kind: "payment", id: "old" });
    expect(paymentTitle(g.payments[0], "USD")).toBe("R-old · $10.00 Check");
    const missing = composeFamilyGiving({ household, pledges: [], payments: recent, focus: { kind: "payment", id: "gone" } });
    expect(missing.focus).toBeNull();
  });
});
