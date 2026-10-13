import { describe, expect, it } from "vitest";

import { communityFormat } from "@/lib/community-format";
import { RELIGIOUS_BENEFIT_LINE } from "@/lib/giving";
import { sampleReceiptCopy } from "@/lib/giving-statements/fixtures";
import {
  cleanReceiptNumber,
  parseReceiptCopy,
  printBlockedReason,
  receiptAddressee,
  receiptCopyLines,
  receiptCopyRefusal,
  receiptFamily,
  type ReceiptCopyContext,
} from "@/lib/giving-statements/receipt-copy";
import { LEGACY_KIND, NEUTRAL_KIND } from "@/lib/kind";

const ctx = (o: Partial<ReceiptCopyContext> = {}): ReceiptCopyContext => ({
  centerName: "Lakeside Community Club",
  centerAddress: "1 Lake Road",
  signedBy: "Ana Ruiz, Treasurer",
  note: "Thank you.",
  fmt: communityFormat({ currency: "USD", country: "US" }),
  timeZone: "America/Chicago",
  today: "2027-01-12",
  orgKind: NEUTRAL_KIND,
  ...o,
});

// What app.receipt_copy (0746) answers for a gift a child paid: the database already left the child's name out.
const childPaid = {
  payment_id: "p-6",
  household_id: "h-1",
  household: { name: "Member household", number: "0301", org_id: null, city: "Austin" },
  receipt_number: "R-155-0006",
  received_on: "2025-12-31",
  method: "cash",
  status: "settled",
  amount_cents: 1000,
  refunded_cents: 0,
  receipt_name: null,
  receipt_name_hidden: true,
  joint_receipt: false,
  payer_is_adult: false,
  adults: ["Mira Member", "Dev Member"],
  applied_to: [],
  templates: { ok: true, detail: "Approved." },
};

describe("reading app.receipt_copy", () => {
  it("reads the answer and refuses another shape", () => {
    const c = parseReceiptCopy(childPaid);
    expect(c).toMatchObject({ receiptNumber: "R-155-0006", amountCents: 1000, receiptName: null, receiptNameHidden: true, payerIsAdult: false });
    expect(parseReceiptCopy(null)).toBeNull();
    expect(parseReceiptCopy({ payment_id: "p" })).toBeNull();
    expect(parseReceiptCopy([])).toBeNull();
  });
  it("never keeps a name the database marked hidden, even if one is sent", () => {
    const c = parseReceiptCopy({ ...childPaid, receipt_name: "Kiran Member" });
    expect(c?.receiptName).toBeNull();
    expect(JSON.stringify(receiptCopyLines(c!, ctx()))).not.toContain("Kiran");
  });
  it("reads the templates' approval as not approved unless it says ok", () => {
    expect(parseReceiptCopy({ ...childPaid, templates: null })?.templates.ok).toBe(false);
  });
});

describe("who the copy is addressed to", () => {
  it("the name on the receipt when it is an adult's", () => {
    expect(receiptAddressee(sampleReceiptCopy())).toBe("Chidi Okafor");
  });
  it("a child paid: the household's adults, and the child never appears", () => {
    const c = parseReceiptCopy(childPaid)!;
    expect(receiptAddressee(c)).toBe("Mira Member and Dev Member");
    const lines = receiptCopyLines(c, ctx());
    expect(lines[2].text).toBe("Mira Member and Dev Member · $10.00 by cash on Dec 31, 2025");
  });
  it("a household with only a child: its number, not a name", () => {
    const c = parseReceiptCopy({ ...childPaid, adults: [] })!;
    expect(receiptAddressee(c)).toBe("Household 0301");
    expect(receiptAddressee({ ...c, household: { ...c.household, number: null } })).toBe("The household");
    expect(receiptFamily(c).primary).toBeNull();
  });
});

describe("the lines of the copy", () => {
  it("draws the receipt in the template's order, with the refund, the funds, the note and the copy mark", () => {
    const c = sampleReceiptCopy({ refundedCents: 5000 });
    expect(receiptCopyLines(c, ctx()).map((l) => l.text)).toEqual([
      "Lakeside Community Club · 1 Lake Road",
      "Donation receipt · No. R-2026-0395",
      "Chidi Okafor · $250.00 by check on Mar 14, 2026",
      "Refunded $50.00: the gift is now $200.00",
      "Applied to: Community garden",
      "Thank you. — Ana Ruiz, Treasurer",
      "Copy of receipt R-2026-0395, printed Jan 12, 2027. It is not a new gift.",
    ]);
  });
  it("a non-faith community has no religious-benefits line; a house of worship has it", () => {
    const c = sampleReceiptCopy();
    expect(receiptCopyLines(c, ctx()).some((l) => l.text === RELIGIOUS_BENEFIT_LINE)).toBe(false);
    expect(receiptCopyLines(c, ctx({ orgKind: LEGACY_KIND })).some((l) => l.text === RELIGIOUS_BENEFIT_LINE)).toBe(true);
  });
  it("writes the amount in the community's currency", () => {
    const lines = receiptCopyLines(sampleReceiptCopy(), ctx({ fmt: communityFormat({ currency: "EUR", country: "IE" }) }));
    expect(lines[2].text).toContain("€250.00");
  });
});

describe("when there is no copy, and when printing is off", () => {
  it("refuses an opening balance, a full refund, a payment that did not go through and one without a number", () => {
    expect(receiptCopyRefusal({ status: "settled", receiptNumber: "R-1" }, true)).toMatch(/opening-balance line never gets a receipt/);
    expect(receiptCopyRefusal({ status: "refunded", receiptNumber: "R-1" })).toMatch(/refunded in full/);
    expect(receiptCopyRefusal({ status: "failed", receiptNumber: "R-1" })).toMatch(/did not go through/);
    expect(receiptCopyRefusal({ status: "settled", receiptNumber: " " })).toMatch(/no receipt number/);
    expect(receiptCopyRefusal({ status: "partially_refunded", receiptNumber: "R-1" })).toBeNull();
  });
  it("prints only while the treasurer's approval of the templates is current", () => {
    expect(printBlockedReason(sampleReceiptCopy())).toBeNull();
    expect(printBlockedReason(sampleReceiptCopy({ templates: { ok: false, detail: "The treasurer has not approved the templates yet." } }))).toBe(
      "Printing is off until the treasurer approves the receipt wording. The treasurer has not approved the templates yet.",
    );
  });
  it("takes the receipt number as typed, without the spaces around it", () => {
    expect(cleanReceiptNumber("  R-2026-0395 ")).toBe("R-2026-0395");
    expect(cleanReceiptNumber("")).toBeNull();
    expect(cleanReceiptNumber("x".repeat(65))).toBeNull();
  });
});
