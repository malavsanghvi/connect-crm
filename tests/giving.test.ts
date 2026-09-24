import { describe, expect, it } from "vitest";

import { buildDashboard, compactCount, compactDollars, formatCount, periods } from "@/lib/community-dashboard";
import {
  addMonths,
  allocationPreviewText,
  barPercent,
  buildOptions,
  classifyQboException,
  closeChecklist,
  countersProblem,
  countingStatusText,
  frequencyText,
  longMonth,
  mergeAudience,
  monthYear,
  optionKey,
  optionRows,
  parseBagNumbers,
  paymentRecordedToast,
  pledgeStatusText,
  pledgeViewFromParam,
  qboClassFor,
  receiptPreviewLines,
  recurringKpis,
  recurringStatusText,
  refundStatusText,
  removedTakenKeys,
  stockMemo,
  weekdayMonthDay,
} from "@/lib/giving";
import { parseAmountToCents } from "@/lib/money";
import { isPublicPath } from "@/lib/supabase/proxy";

describe("pledges", () => {
  it("formats the prototype's Mon YYYY date without shifting date-only values", () => {
    expect(monthYear("2026-04-01", "America/Chicago")).toBe("Apr 2026");
    expect(monthYear("2026-05-01T03:00:00Z", "America/Chicago")).toBe("Apr 2026");
    expect(monthYear(null, "UTC")).toBe("—");
  });
  it("shows Closed / Partial / Open", () => {
    expect(pledgeStatusText("paid", 100, 100)).toEqual({ label: "Closed", tone: "ok" });
    expect(pledgeStatusText("partially_paid", 100, 40)).toEqual({ label: "Partial", tone: "warn" });
    expect(pledgeStatusText("open", 100, 0)).toEqual({ label: "Open", tone: "warn" });
    expect(pledgeStatusText("written_off", 100, 0).tone).toBe("muted");
  });
  it("maps old status params to the three chips", () => {
    expect(pledgeViewFromParam("outstanding")).toBe("open");
    expect(pledgeViewFromParam("paid")).toBe("closed");
    expect(pledgeViewFromParam(undefined)).toBe("all");
  });
});

describe("offline payments", () => {
  it("keeps stock details first in the memo", () => {
    expect(stockMemo("10 AAPL · $2,300", "via broker")).toBe("Stock: 10 AAPL · $2,300 · via broker");
    expect(stockMemo("", "note")).toBe("note");
    expect(stockMemo("", "  ")).toBeNull();
  });
  it("describes the allocation and leaves the remainder unapplied (money rule unchanged)", () => {
    const lines = allocationPreviewText({
      lines: [{ pledge_id: "a", amount_cents: 30000, closes: true }],
      unallocatedCents: 10000,
      pledges: [{ id: "a", campaign: "Temple construction", source: "general", pledged_at: "2026-04-10" }],
      mode: "auto",
      hasOpenPledges: true,
      currency: "USD",
      timeZone: "UTC",
    });
    expect(lines[0].text).toBe("Temple construction · Apr 2026 → $300.00 · closes");
    expect(lines[1].text).toBe("Remaining $100.00 stays unapplied as a general gift");
    expect(
      allocationPreviewText({ lines: [], unallocatedCents: 0, pledges: [], mode: "auto", hasOpenPledges: false, currency: "USD", timeZone: "UTC" })[0].text,
    ).toMatch(/No open pledges/);
  });
  it("words the toast honestly about QuickBooks", () => {
    expect(paymentRecordedToast(2, true)).toBe("Payment recorded · 2 pledges updated · QuickBooks sales receipt queued");
    expect(paymentRecordedToast(1, false)).toContain("not yet in the QuickBooks queue");
  });
  it("labels refund requests", () => {
    expect(refundStatusText({ refund_approved_by: "u", refund_second_approver: null, refunded_cents: 0 }).label).toBe("Awaiting 2nd approver");
    expect(refundStatusText({ refund_approved_by: "u", refund_second_approver: "v", refunded_cents: 0 }).label).toBe("Approved");
  });
});

describe("bhandar counting", () => {
  it("parses bag numbers", () => {
    expect(parseBagNumbers("1041, 1042 1041;1043")).toEqual(["1041", "1042", "1043"]);
  });
  it("needs two counters from different households", () => {
    expect(countersProblem([{ userId: "a", householdId: "h1" }])).toMatch(/two counters/);
    expect(countersProblem([{ userId: "a", householdId: "h1" }, { userId: "b", householdId: "h1" }])).toMatch(/different households/);
    expect(countersProblem([{ userId: "a", householdId: "h1" }, { userId: "b", householdId: null }])).toBeNull();
  });
  it("describes the session state", () => {
    expect(countingStatusText({ total_cents: 341200, deposit_ref: "D1", payment_id: "p", counted_on: "2026-09-21" }, "2026-09-24").label).toBe(
      "Deposited · matched",
    );
    expect(countingStatusText({ total_cents: 0, deposit_ref: null, payment_id: null, counted_on: "2026-09-28" }, "2026-09-24").label).toBe("Scheduled");
  });
});

describe("recurring", () => {
  it("uses human status text, including pending_payment_method", () => {
    expect(recurringStatusText({ status: "failed", next_charge_on: "2026-09-25" }).label).toBe("Payment failed · retry Sep 25");
    expect(recurringStatusText({ status: "paused", next_charge_on: null }).label).toBe("Paused by donor");
    expect(recurringStatusText({ status: "pending_payment_method", next_charge_on: null })).toEqual({ label: "Waiting for a payment method", tone: "warn" });
    expect(frequencyText("special_day")).toBe("Yearly · on special day");
  });
  it("computes the KPI row from active gifts only", () => {
    const k = recurringKpis(
      [
        { status: "active", amount_cents: 2100, frequency: "monthly", updated_at: "2026-09-01T00:00:00Z" },
        { status: "active", amount_cents: 50000, frequency: "quarterly", updated_at: "2026-09-01T00:00:00Z" },
        { status: "paused", amount_cents: 10800, frequency: "yearly", updated_at: "2026-09-01T00:00:00Z" },
        { status: "pending_payment_method", amount_cents: 999, frequency: "monthly", updated_at: "2026-09-01T00:00:00Z" },
        { status: "failed", amount_cents: 1100, frequency: "monthly", updated_at: "2026-09-10T00:00:00Z" },
        { status: "failed", amount_cents: 1100, frequency: "monthly", updated_at: "2026-08-10T00:00:00Z" },
      ],
      "2026-09-01",
      "UTC",
    );
    expect(k).toEqual({ active: 2, paused: 1, pending: 1, monthlyRunRateCents: 2100 + Math.round(50000 / 3), failedThisMonth: 1 });
  });
});

describe("opportunities", () => {
  it("builds tier and pujan options with stable keys", () => {
    const r = buildOptions(
      "tier",
      [
        { label: "Gold", amount: "2500", recognition: "Named at the event" },
        { key: "plat", label: "Platinum", amount: "5000" },
        { label: "", amount: "" },
      ],
      parseAmountToCents,
    );
    expect(r).toEqual({
      ok: true,
      options: [
        { key: "gold", label: "Gold", amount_cents: 250000, recognition: "Named at the event" },
        { key: "plat", label: "Platinum", amount_cents: 500000, recognition: null },
      ],
    });
    const m = buildOptions("multi", [{ label: "Pehli aarti", amount: "251" }], parseAmountToCents);
    expect(m.ok && m.options[0]).toEqual({ key: "pehli-aarti", label: "Pehli aarti", amount_cents: 25100, note: null, fixed: true });
    expect(buildOptions("amount", [{ label: "", amount: "10000" }], parseAmountToCents)).toEqual({ ok: true, options: [{ amount_cents: 1000000 }] });
    expect(buildOptions("open", [], parseAmountToCents)).toEqual({ ok: true, options: [] });
  });
  it("refuses bad rows", () => {
    expect(buildOptions("multi", [{ label: "A", amount: "x" }], parseAmountToCents).ok).toBe(false);
    expect(buildOptions("tier", [{ label: "A", amount: "1" }, { label: "a", amount: "2" }], parseAmountToCents).ok).toBe(false);
    expect(buildOptions("tier", [], parseAmountToCents).ok).toBe(false);
  });
  it("keeps keys unique and round-trips options", () => {
    const taken = new Set(["gold"]);
    expect(optionKey("Gold", taken)).toBe("gold-2");
    expect(optionRows("tier", [{ key: "g", label: "Gold", amount_cents: 250000, recognition: "x" }])).toEqual([
      { key: "g", label: "Gold", amount: "2500", recognition: "x" },
    ]);
  });
  it("blocks removing options families already pledged for", () => {
    expect(removedTakenKeys([{ key: "a", taken_count: 1 }, { key: "b", taken_count: 0 }], [])).toEqual(["a"]);
  });
  it("merges alert audiences and skips untargetable ones", () => {
    expect(mergeAudience(["all_members", "life_members", "past_donors"])).toEqual({ all_members: true, membership_tiers: ["life"] });
    expect(mergeAudience(["temple_interest"])).toBeNull();
  });
});

describe("receipts, accounting", () => {
  it("previews the receipt with the center's name and the note", () => {
    const l = receiptPreviewLines({
      kind: "year_end_statement",
      centerName: "Test Center",
      centerAddress: null,
      signedBy: "Treasurer",
      note: "Thank you.",
      year: 2026,
      currency: "USD",
    });
    expect(l[0].text).toBe("Test Center");
    expect(l[1].text).toContain("Year-end statement 2025");
    expect(l[l.length - 1].text).toBe("Thank you. — Treasurer");
  });
  it("offers Apply fix only when the named mapping is now mapped and approved", () => {
    const m = [{ purpose: "store.gift_packing", label: "Store gift packing", mapped: true, approved: true }];
    expect(classifyQboException("No income account mapped for store.gift_packing", m).applyPurpose).toBe("store.gift_packing");
    expect(classifyQboException("No income account mapped for store.gift_packing", [{ ...m[0], approved: false }]).applyPurpose).toBeNull();
    expect(classifyQboException("Token expired", m).fix).toMatch(/Reconnect/);
    expect(classifyQboException(null, m).applyPurpose).toBeNull();
    expect(qboClassFor("income.boli")).toBe("Fund, event");
    expect(qboClassFor("store.sales")).toBe("Store");
  });
  it("builds the close checklist", () => {
    const items = closeChecklist({ payouts_matched: true }, 2);
    expect(items[0]).toMatchObject({ done: false, sub: "2 left · fix on the sync tab" });
    expect(items[1].done).toBe(true);
    expect(closeChecklist({ payouts_matched: true, refunds_reviewed: true, statements_generated: true }, 0).every((i) => i.done)).toBe(true);
    expect(closeChecklist({}, null)[0].sub).toMatch(/Could not count/);
  });
  it("does month arithmetic", () => {
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(longMonth("2026-09-01")).toBe("September 2026");
    expect(weekdayMonthDay("2026-10-06")).toBe("Tue, Oct 6");
    expect(barPercent(50, 200)).toBe(25);
    expect(barPercent(0, 200)).toBe(0);
  });
});

describe("public community dashboard", () => {
  it("is reachable without a session", () => {
    expect(isPublicPath("/c/jsh")).toBe(true);
    expect(isPublicPath("/c")).toBe(true);
    expect(isPublicPath("/campaigns")).toBe(false);
    expect(isPublicPath("/giving/pledges")).toBe(false);
  });
  it("has the four periods", () => {
    const p = periods("2026-09-24");
    expect(p.map((x) => x.label)).toEqual(["This year", "Last 12 months", "2025", "All time"]);
    expect(p[0]).toMatchObject({ from: "2026-01-01", to: "2026-09-24" });
    expect(p[1].from).toBe("2025-09-25"); // 365 days inclusive
    expect(p[3].comparison).toBeNull();
  });
  it("formats numbers", () => {
    expect(formatCount(28450)).toBe("28,450");
    expect(formatCount(null)).toBe("—");
    expect(compactCount(4980)).toBe("5.0k");
    expect(compactDollars(412000000)).toBe("$4.12M");
    expect(compactDollars(1000000000)).toBe("$10M");
  });
  it("shows only what the RPC returned, with deltas and suppression", () => {
    const period = periods("2026-09-24")[0];
    const v = buildDashboard(
      {
        as_of: "2026-09-22T05:00:00Z",
        metrics: { member_families: 1184, events_held: 146, samayik: null },
        deltas: { member_families: { new_in_period: 62 }, events_held: { change_pct: 14 } },
        families_by_zone: [
          { zone: "Southwest", families: 260 },
          { zone: "Tiny", families: null },
        ],
      },
      period,
    );
    expect(v.asOf).toBe("2026-09-22");
    expect(v.summary.map((t) => [t.label, t.value, t.delta])).toEqual([
      ["Member families", "1,184", "+62 new this year"],
      ["Events held", "146", "+14% vs last year"],
    ]);
    expect(v.practice[0]).toMatchObject({ value: "—", suppressed: true });
    expect(v.zones?.[1]).toEqual({ zone: "Tiny", families: null, pct: 0 });
    expect(v.months).toBeNull();
    expect(v.campaign).toBeNull();
    expect(buildDashboard({ metrics: {} }, period).empty).toBe(true);
  });
});
