import { describe, expect, it } from "vitest";

import { SAMPLE_DRAFTS, SAMPLE_HOUSEHOLDS, sampleRequest } from "@/lib/giving-workspace/fixtures";
import { parsePaymentAsk } from "@/lib/giving-workspace/ask";
import {
  approvalsRow,
  bankRow,
  closeView,
  draftCard,
  draftRequest,
  longDate,
  paidPercent,
  prefillHousehold,
  readRecordPrefill,
  recordPaymentHref,
  recordSwitchOffNote,
  zelleRow,
} from "@/lib/giving-workspace/view";

// The Giving page's sentences and links, from what the existing Giving commands return. Nothing here records money: the card's
// main button is a link to the existing Record payment screen, filled in.
const TODAY = "2026-10-07";
const H = "6f1d2c3b-4a5e-4f60-8a71-9b8c7d6e5f40";

describe("the prefilled link to the Record payment screen", () => {
  it("carries what was asked, under names that do not clash with the payments list's filters", () => {
    const req = draftRequest(parsePaymentAsk("Record a $250 check from Okafor, check number 1043, received Sunday", TODAY), H)!;
    expect(req).toEqual({ household_id: H, amount: "250", method: "check", received_on: "2026-10-04", reference: "1043", allocation: "auto" });
    const href = recordPaymentHref(req);
    expect(href).toBe(`/giving/payments?household=${H}&amount=250&paid_with=check&received=2026-10-04&ref=1043`);
    expect(href).not.toContain("method=");
    expect(recordPaymentHref({ ...req, allocation: "none" })).toContain("apply=none");
  });

  it("has no request until the amount is known, and uses the form's own default method", () => {
    expect(draftRequest(parsePaymentAsk("from Okafor", TODAY), H)).toBeNull();
    expect(draftRequest(parsePaymentAsk("250 from Okafor", TODAY), H)).toEqual({ household_id: H, amount: "250", method: "check", allocation: "auto" });
  });

  it("is read back on the Record payment screen, ignoring anything odd", () => {
    const sp = Object.fromEntries(new URL(`http://x${recordPaymentHref(sampleRequest(H))}`).searchParams);
    expect(readRecordPrefill(sp, TODAY)).toEqual({ amount: "250", method: "check", receivedOn: "2026-10-04", reference: "1043" });
    expect(prefillHousehold(sp)).toBe(H);
    // Nothing in the address: the form renders exactly as it always has.
    expect(readRecordPrefill({}, TODAY)).toBeNull();
    expect(readRecordPrefill({ household: H }, TODAY)).toBeNull();
    expect(readRecordPrefill({ amount: "-5", paid_with: "card", received: "2099-01-01", ref: "x".repeat(121) }, TODAY)).toBeNull();
    expect(readRecordPrefill({ amount: "abc", apply: "none" }, TODAY)).toEqual({ allocation: "none" });
    expect(prefillHousehold({ household: "not-an-id" })).toBeNull();
  });
});

describe("the confirmation card", () => {
  it("shows the board's rows: the household with its number, the amount, method, day, what it applies to and what happens after", () => {
    const v = draftCard(SAMPLE_DRAFTS[SAMPLE_HOUSEHOLDS.first], { locale: "en-US", about: "Spring appeal pledge" });
    expect(v.rows.map((r) => r.label)).toEqual(["Household", "Amount", "Method", "Received", "Applies to", "After this"]);
    expect(v.rows[0].value).toBe("Chidi & María Okafor Household (0212)");
    expect(v.rows[1]).toEqual({ label: "Amount", value: "$250.00", tone: "money" });
    expect(v.rows[2].value).toBe("Check · number 1043");
    expect(v.rows[3].value).toBe("Sunday, October 4, 2026");
    expect(v.rows[4].value).toBe("Spring appeal 2026 (P-0193): $250.00 of $250.00 still open");
    expect(v.rows[5].value).toContain("would be paid in full ($500.00 of $500.00)");
    expect(v.applies).toBe(true);
    expect(v.recordLabel).toBe("Record payment · $250.00");
    expect(v.notes).toEqual([]);
    expect(v.checks.map((c) => c.label)).toContain("The right household");
  });

  it("asks in the person's own words when the household has no open pledge", () => {
    const v = draftCard(SAMPLE_DRAFTS[SAMPLE_HOUSEHOLDS.second], { locale: "en-US", about: "Spring appeal pledge" });
    expect(v.rows[4]).toEqual({ label: "Applies to", value: "No open pledge: a general gift", tone: "danger" });
    expect(v.notes).toEqual([
      { text: "You mentioned “Spring appeal pledge”, but this household has no open pledge, so the whole $250.00 would be recorded as a general gift. Is this the right household?", tone: "danger" },
    ]);
    expect(v.recordLabel).toBe("Record as a general gift · $250.00");
    expect(draftCard(SAMPLE_DRAFTS[SAMPLE_HOUSEHOLDS.second], { locale: "en-US" }).notes[0].text).toMatch(/^This household has no open pledge/);
  });

  it("writes days the community's way", () => {
    expect(longDate("2026-10-04", "en-GB")).toMatch(/^Sunday,? 4 October 2026$/);
    expect(longDate("bad", "en-US")).toBe("bad");
  });

  it("says plainly why the card cannot record by itself", () => {
    expect(recordSwitchOffNote("Lakeside Community Club")).toMatch(/switched off for Lakeside Community Club: it moves money, so an owner switches it on first\. Until then, Record payment opens with everything filled in\./);
  });
});

describe("the side lists", () => {
  it("never shows a pledge list as done before it is", () => {
    expect(paidPercent({ pledged_cents: 0, paid_cents: 0 })).toBe(0);
    expect(paidPercent({ pledged_cents: 9_600_000, paid_cents: 6_455_000 })).toBe(67);
    expect(paidPercent({ pledged_cents: 1000, paid_cents: 999 })).toBe(99);
  });

  it("counts the month-end checks", () => {
    const v = closeView({ month: "October 2026", locked: false, ready_to_lock: false, done: ["A", "B", "C"], blockers: [{ item: "Review refunds", why: "1 refund" }] });
    expect(v.title).toBe("October 2026 close: 3 of 4 checks");
    expect(v.items.at(-1)).toEqual({ text: "Review refunds", done: false, why: "1 refund" });
    expect(closeView({ month: "September 2026", locked: true, ready_to_lock: false, done: [], blockers: [] }).title).toBe("September 2026 is locked");
  });

  it("words what is waiting", () => {
    const bank = bankRow({ as_of: TODAY, gifts: 1, gifts_cents: 100, gifts_total: "$1.00", deposits: 0, deposits_cents: 0, deposits_total: "$0.00", debits: 0, payouts: 0, oldest_posted_on: "2026-10-06", oldest_days: 1, lines: [], where_to_match: "/giving/payments/bank" });
    expect(bank).toMatchObject({ text: "1 bank line to match", detail: "1 gift ($1.00) · oldest 1 day", count: 1 });
    const none = bankRow({ ...{ as_of: TODAY, gifts: 0, gifts_cents: 0, gifts_total: "$0.00", deposits: 0, deposits_cents: 0, deposits_total: "$0.00", debits: 0, payouts: 0, oldest_posted_on: null, oldest_days: null, lines: [], where_to_match: "/giving/payments/bank" } });
    expect(none).toMatchObject({ text: "Every bank line is matched or set aside", detail: null, count: 0 });
    expect(zelleRow({ as_of: TODAY, waiting: 2, reported: 2, unmatched: 0, past_window: 1, total_cents: 100, total: "$1.00", exact_matches: 0, reports: [], where_to_match: "" }, "Zelle").text).toBe("2 Zelle reports waiting for the bank");
    expect(approvalsRow({ total: 2, refunds: 1, write_offs: 1, provider_refunds: 0, items: [], note: null })).toMatchObject({ text: "2 requests waiting for a second approver", detail: "1 refund · 1 write-off", href: "/approvals" });
  });
});
