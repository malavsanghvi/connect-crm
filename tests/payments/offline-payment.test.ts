import { describe, expect, it } from "vitest";

import { checkOfflinePayment, type OfflinePaymentInput } from "@/lib/payments/offline-payment";

const HOUSEHOLD = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c2001";
const PLEDGE_A = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c3001";
const PLEDGE_B = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c3002";
const TODAY = "2026-10-11";

const base: OfflinePaymentInput = { householdId: HOUSEHOLD, amount: "250", method: "check", receivedOn: "2026-10-04", reference: "#1043", allocation: "auto" };

function problem(over: Partial<OfflinePaymentInput>, doing?: string): string {
  const r = checkOfflinePayment({ ...base, ...over }, TODAY, doing);
  if (r.ok) throw new Error("expected a problem");
  return r.error;
}

describe("checkOfflinePayment: the Record payment screen's rules and words", () => {
  it("turns dollars into integer cents and cleans the check number", () => {
    const r = checkOfflinePayment({ ...base, amount: "$1,250.50" }, TODAY);
    expect(r).toEqual({
      ok: true,
      value: {
        householdId: HOUSEHOLD,
        amountCents: 125050,
        method: "check",
        receivedOn: "2026-10-04",
        checkNumber: "1043",
        envelopeNumber: null,
        memo: null,
        allocation: "auto",
        chosen: null,
      },
    });
  });

  it("refuses with the screen's own sentences", () => {
    expect(problem({ householdId: "not-an-id" })).toBe("Could not record the payment — choose the household first.");
    expect(problem({ amount: "0" })).toBe("Could not record the payment — enter an amount greater than zero, like 251.00.");
    expect(problem({ amount: "ten dollars" })).toBe("Could not record the payment — enter an amount greater than zero, like 251.00.");
    expect(problem({ amount: "-5" })).toBe("Could not record the payment — enter an amount greater than zero, like 251.00.");
    expect(problem({ method: "bitcoin" })).toBe("Could not record the payment — choose check, cash, ACH, Zelle or stock.");
    expect(problem({ method: "card" })).toBe("Could not record the payment — choose check, cash, ACH, Zelle or stock.");
    expect(problem({ receivedOn: "2026-10-12" })).toBe("Could not record the payment — the received date must be a real date, not in the future.");
    expect(problem({ receivedOn: "yesterday" })).toBe("Could not record the payment — the received date must be a real date, not in the future.");
    expect(problem({ allocation: "choose", pledgeIds: [] })).toBe("Could not record the payment — tick the pledges to apply it to, or switch to earliest-first.");
    expect(problem({ allocation: "choose", pledgeIds: ["nope"] })).toBe("Could not record the payment — tick the pledges to apply it to, or switch to earliest-first.");
    expect(problem({ method: "stock", reference: "  " })).toBe("Could not record the payment — for a stock gift, enter the shares and their value on the date received.");
  });

  it("says 'prepare' for a draft and 'record' for the screen, with the same reasons", () => {
    expect(problem({ amount: "0" }, "prepare the payment")).toBe("Could not prepare the payment — enter an amount greater than zero, like 251.00.");
  });

  it("allows today, and an amount of one cent", () => {
    expect(checkOfflinePayment({ ...base, receivedOn: TODAY, amount: "0.01" }, TODAY)).toMatchObject({ ok: true, value: { amountCents: 1, receivedOn: TODAY } });
  });

  it("keeps the chosen pledges in the order given, and only when choosing", () => {
    expect(checkOfflinePayment({ ...base, allocation: "choose", pledgeIds: [PLEDGE_B, "junk", PLEDGE_A] }, TODAY)).toMatchObject({ ok: true, value: { chosen: [PLEDGE_B, PLEDGE_A] } });
    expect(checkOfflinePayment({ ...base, allocation: "auto", pledgeIds: [PLEDGE_B] }, TODAY)).toMatchObject({ ok: true, value: { chosen: null } });
  });

  it("builds the memo: stock details lead it, other references are marked, a check number is its own field", () => {
    expect(checkOfflinePayment({ ...base, method: "stock", reference: "10 shares, $1,200", memo: "from the estate" }, TODAY)).toMatchObject({
      value: { memo: "Stock: 10 shares, $1,200 · from the estate", checkNumber: null },
    });
    expect(checkOfflinePayment({ ...base, method: "zelle", reference: "WFCT0H7K2M1Q", memo: "Diwali" }, TODAY)).toMatchObject({ value: { memo: "Ref WFCT0H7K2M1Q · Diwali", checkNumber: null } });
    expect(checkOfflinePayment({ ...base, method: "cash", reference: undefined, memo: "  Box 3  " }, TODAY)).toMatchObject({ value: { memo: "Box 3", checkNumber: null } });
    expect(checkOfflinePayment({ ...base, memo: "x".repeat(900), envelopeNumber: "E-" + "9".repeat(80) }, TODAY)).toMatchObject({
      value: { memo: "x".repeat(500), envelopeNumber: ("E-" + "9".repeat(80)).slice(0, 40) },
    });
  });
});
