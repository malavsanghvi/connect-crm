import { describe, expect, it } from "vitest";

import { parseTimeline, timelineState, timelineText, timelineWhen } from "@/lib/payment-proofs/timeline";

const answer = [
  { at: "2026-10-01T15:00:00Z", kind: "pledged", event: null, text: null, amount_cents: 20000 },
  { at: "2026-10-12T15:00:00Z", kind: "proof", event: "submitted", text: "Sent by Mina. Your pledges show Soft credit while the treasury team checks it.", amount_cents: 20000, proof_id: "pr1" },
  { at: "2026-10-12T16:00:00Z", kind: "proof", event: "question", text: "The treasury team asks: Which bank is the check from?", amount_cents: 20000, proof_id: "pr1" },
  { at: "2026-10-13T15:00:00Z", kind: "proof", event: "approved", text: "Checked and recorded. Receipt R-2026-0007.", amount_cents: 20000, proof_id: "pr1" },
  { at: "2026-10-13T15:00:00Z", kind: "payment", event: null, text: null, amount_cents: 20000, payment_id: "pay1", receipt_number: "R-2026-0007", method: "check", paid_on: "2026-10-12" },
  { at: "2026-10-20T15:00:00Z", kind: "reconciled", event: null, text: null, amount_cents: null, reconciled_kind: "bank" },
];

describe("the timeline of a pledge", () => {
  it("reads what pledge_timeline answers, in the order it was given", () => {
    const t = parseTimeline(answer)!;
    expect(t.map((e) => e.kind + (e.event ? `:${e.event}` : ""))).toEqual(["pledged", "proof:submitted", "proof:question", "proof:approved", "payment", "reconciled"]);
    expect(t[4]).toMatchObject({ amountCents: 20000, receiptNumber: "R-2026-0007", method: "check", paidOn: "2026-10-12" });
    expect(t[5]).toMatchObject({ amountCents: null, reconciledKind: "bank" });
  });

  it("refuses an answer it does not know, so the screen says so instead of showing no history", () => {
    expect(parseTimeline(null)).toBeNull();
    expect(parseTimeline({})).toBeNull();
    expect(parseTimeline([{ at: "2026-10-01T00:00:00Z", kind: "mystery" }])).toBeNull();
    expect(parseTimeline([{ kind: "pledged" }])).toBeNull();
    expect(parseTimeline([])).toEqual([]);
  });

  it("puts a state badge in front of each entry, in the words the household page uses", () => {
    const t = parseTimeline(answer)!;
    expect(t.map((e) => timelineState(e).label)).toEqual(["Open", "Soft credit", "Question asked", "Approved", "Paid", "Bank reconciled"]);
    expect(timelineState({ kind: "proof", event: "rejected" })).toEqual({ label: "Not accepted", tone: "bad" });
    expect(timelineState({ kind: "proof", event: "withdrawn" })).toEqual({ label: "Taken back", tone: "muted" });
    expect(timelineState({ kind: "proof", event: "pledge_cancelled" })).toEqual({ label: "Cancelled", tone: "muted" });
    expect(timelineState({ kind: "proof", event: "merged" })).toEqual({ label: "Kept with the payment", tone: "ok" });
  });

  it("words each entry with the amount in the community's currency and the date in its time zone", () => {
    const t = parseTimeline(answer)!;
    expect(t.map((e) => timelineText(e, "USD", "en-US"))).toEqual([
      "Pledged $200.00.",
      "Proof for $200.00. Sent by Mina. Your pledges show Soft credit while the treasury team checks it.",
      "The treasury team asks: Which bank is the check from?",
      "Checked and recorded. Receipt R-2026-0007.",
      "Receipt R-2026-0007, check: $200.00 applied.",
      "Every payment on it is matched to a bank line.",
    ]);
    expect(timelineText({ ...t[5]!, reconciledKind: "historical" }, "USD")).toBe("Marked reconciled: every payment on it is imported history.");
    expect(timelineWhen(t[0]!, "America/Chicago")).toBe("Oct 1, 2026");
  });
});
