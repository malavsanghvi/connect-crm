import { describe, expect, it } from "vitest";

import { closeChecklist, writeOffPostingText } from "@/lib/giving";
import { LEDGER_TXN_LABEL, QBO_PURPOSES } from "@/lib/labels";
import { PURPOSE_TYPES, TEST_POST_EXPLAINED, TEST_POST_HOW_TO_VOID } from "@/lib/qbo/setup";

// Wave E · e-money: the owner's money decisions of 2026-09-25 as the portal shows them.
describe("pledge write-off in QuickBooks (0412)", () => {
  it("says what the write-off became", () => {
    expect(writeOffPostingText(null)).toBeNull();
    expect(writeOffPostingText({ status: "posted", qbo_entity: "CreditMemo", qbo_ref: "3001", last_error: null })).toEqual({
      tone: "ok",
      label: "QuickBooks: credit memo #3001 posted",
    });
    expect(writeOffPostingText({ status: "skipped", qbo_entity: null, qbo_ref: null, last_error: "Nothing to post: cash basis." })).toEqual({
      tone: "muted",
      label: "QuickBooks: nothing posted — Nothing to post: cash basis.",
    });
    expect(writeOffPostingText({ status: "failed", qbo_entity: "JournalEntry", qbo_ref: null, last_error: null })?.tone).toBe("bad");
    expect(writeOffPostingText({ status: "queued", qbo_entity: null, qbo_ref: null, last_error: null })).toEqual({
      tone: "warn",
      label: "QuickBooks: waiting to post",
    });
  });
  it("has a mapping purpose and a sync label, mirroring app.qbo_purposes()", () => {
    expect(QBO_PURPOSES.some((p) => p.purpose === "pledge_writeoffs")).toBe(true);
    expect(PURPOSE_TYPES.pledge_writeoffs).toEqual(["Expense", "Other Expense", "Income", "Other Income"]);
    expect(LEDGER_TXN_LABEL.pledge_writeoff).toBe("Pledge write-off");
  });
});

describe("month-end close names flagged refunds (#6)", () => {
  it("counts refunds made in Stripe or PayPal that wait for approval, without ticking the item", () => {
    const items = closeChecklist({}, 0, 2);
    const r = items.find((i) => i.key === "refunds_reviewed")!;
    expect(r.done).toBe(false);
    expect(r.sub).toBe("2 refunds made in Stripe or PayPal wait for two approvals (Giving › Payments)");
    expect(closeChecklist({ refunds_reviewed: true }, 0, 1).find((i) => i.key === "refunds_reviewed")!.sub).toMatch(/^Marked done · 1 refund made/);
    expect(closeChecklist({}, 0).find((i) => i.key === "refunds_reviewed")!.sub).toBe("Mark done");
  });
});

describe("the live QuickBooks test post is explained (#10)", () => {
  it("names the four real $1.00 entries and how to void them", () => {
    expect(TEST_POST_EXPLAINED).toMatch(/four real \$1\.00 entries/);
    expect(TEST_POST_EXPLAINED).toMatch(/sales receipt, a refund receipt, a deposit and a journal entry/);
    expect(TEST_POST_HOW_TO_VOID).toMatch(/More › Void/);
  });
});
