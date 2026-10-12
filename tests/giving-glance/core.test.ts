import { describe, expect, it } from "vitest";

import { chooserParts, givingRuleProblems, givingShowBy, parseGlanceScope, personAndRest, scopeParam, scopeRows } from "@/lib/giving-glance/levels";
import { glanceHref, glanceWindow, glanceYearOf, inWindow, monthsOfYear, parseGlanceYear, yearBounds, yearChoices } from "@/lib/giving-glance/period";
import {
  GENERAL_CAUSE,
  deltaText,
  givingByCause,
  givingByTime,
  isGift,
  netOf,
  openTotals,
  periodTotals,
  summarize,
  timeSeriesText,
  type GlancePayment,
  type GlancePledge,
  type GlanceRecurring,
  type GlanceRows,
} from "@/lib/giving-glance/summary";

// A neutral community (a church with members from several cultures), not a faith-specific one. Money is integer cents.
const HH = "hh-1";
const AMARA = "p-amara";
const MATEO = "p-mateo";
const CHILD = "p-child";

const pledge = (o: Partial<GlancePledge> & { id: string }): GlancePledge => ({
  household_id: HH,
  person_id: null,
  amount_cents: 100_000,
  paid_cents: 0,
  status: "open",
  pledged_on: "2026-02-01",
  due_on: null,
  ...o,
});
const payment = (o: Partial<GlancePayment> & { id: string }): GlancePayment => ({
  household_id: HH,
  person_id: null,
  amount_cents: 10_000,
  refunded_cents: 0,
  status: "settled",
  received_on: "2026-03-01",
  is_opening_balance: false,
  allocations: [],
  ...o,
});
const rows = (r: Partial<GlanceRows>): GlanceRows => ({ pledges: [], payments: [], recurring: [], ...r });
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const TODAY = "2026-10-12";

describe("the year", () => {
  it("reads the year from the address, and falls back to this year for anything else", () => {
    expect(parseGlanceYear(undefined, 2026)).toEqual({ kind: "year", year: 2026 });
    expect(parseGlanceYear("all", 2026)).toEqual({ kind: "all" });
    expect(parseGlanceYear("ALL", 2026)).toEqual({ kind: "all" });
    expect(parseGlanceYear("2024", 2026)).toEqual({ kind: "year", year: 2024 });
    expect(parseGlanceYear(["2025", "2023"], 2026)).toEqual({ kind: "year", year: 2025 });
    for (const bad of ["1980", "2031", "twenty", "", "2025-26", "-2024", null]) expect(parseGlanceYear(bad, 2026)).toEqual({ kind: "year", year: 2026 });
  });

  it("is the calendar year when the community's year starts in January", () => {
    const w = glanceWindow({ kind: "year", year: 2026 }, TODAY, 1);
    expect(w).toMatchObject({ param: "2026", label: "2026", title: "This year (2026)", from: "2026-01-01", to: "2026-12-31", isCurrent: true });
    expect(w.previous).toEqual({ label: "the same time last year", from: "2025-01-01", to: "2025-10-12" });
    const last = glanceWindow({ kind: "year", year: 2025 }, TODAY, 1);
    expect(last).toMatchObject({ title: "Last year (2025)", from: "2025-01-01", to: "2025-12-31", isCurrent: false });
    expect(last.previous).toEqual({ label: "2024", from: "2024-01-01", to: "2024-12-31" });
    expect(glanceWindow({ kind: "year", year: 2021 }, TODAY, 1).title).toBe("2021");
  });

  it("follows the community's own year when it starts in July, named by the year it starts in", () => {
    // 12 October 2026 is in the year that began on 1 July 2026.
    expect(glanceYearOf("2026-10-12", 7)).toBe(2026);
    expect(glanceYearOf("2026-06-30", 7)).toBe(2025);
    expect(glanceYearOf("2026-07-01", 7)).toBe(2026);
    const w = glanceWindow({ kind: "year", year: 2026 }, TODAY, 7);
    expect(w).toMatchObject({ label: "2026-27", title: "This year (2026-27)", from: "2026-07-01", to: "2027-06-30", isCurrent: true });
    expect(w.previous).toEqual({ label: "the same time last year", from: "2025-07-01", to: "2025-10-12" });
    const prior = glanceWindow({ kind: "year", year: 2025 }, TODAY, 7);
    expect(prior).toMatchObject({ label: "2025-26", title: "Last year (2025-26)", from: "2025-07-01", to: "2026-06-30" });
    expect(prior.previous).toEqual({ label: "2024-25", from: "2024-07-01", to: "2025-06-30" });
    // A year that ends in February knows about leap years.
    expect(yearBounds(2023, 3)).toEqual({ from: "2023-03-01", to: "2024-02-29" });
    expect(yearBounds(2024, 3)).toEqual({ from: "2024-03-01", to: "2025-02-28" });
  });

  it("treats a bad start month as January", () => {
    expect(glanceWindow({ kind: "year", year: 2026 }, TODAY, 13).from).toBe("2026-01-01");
    expect(glanceWindow({ kind: "year", year: 2026 }, TODAY, null).label).toBe("2026");
  });

  it("has no edges and nothing to compare with for all time", () => {
    const w = glanceWindow({ kind: "all" }, TODAY, 7);
    expect(w).toMatchObject({ param: "all", label: "All time", from: null, to: null, previous: null });
    expect(inWindow("1999-01-01", w.from, w.to)).toBe(true);
    expect(inWindow("2026-06-30", "2026-07-01", "2027-06-30")).toBe(false);
    expect(inWindow("2026-07-01", "2026-07-01", "2027-06-30")).toBe(true);
  });

  it("offers this year, last year, each earlier year that has data, then all time", () => {
    const days = ["2019-05-01", "2022-11-02", "2022-12-31T10:00:00Z", "2025-08-01", "2026-01-05", "not a date"];
    const labels = (sel = parseGlanceYear(undefined, 2026)) => yearChoices(days, TODAY, 1, sel).map((c) => c.label);
    expect(labels()).toEqual(["This year (2026)", "Last year (2025)", "2022", "2019", "All time"]);
    expect(yearChoices(days, TODAY, 1, { kind: "year", year: 2026 }).map((c) => [c.param, c.selected])).toEqual([
      ["2026", true],
      ["2025", false],
      ["2022", false],
      ["2019", false],
      ["all", false],
    ]);
    expect(yearChoices([], TODAY, 1, { kind: "all" }).map((c) => c.selected)).toEqual([false, false, true]);
    // A year typed in an address that has no data is still on screen as a chip.
    expect(labels({ kind: "year", year: 2010 })).toContain("2010");
  });

  it("puts a day in the right July year when listing the years", () => {
    // 30 June 2022 is in the year that started in July 2021; 1 July 2022 begins the next one.
    const labels = yearChoices(["2022-06-30", "2022-07-01"], TODAY, 7, { kind: "year", year: 2026 }).map((c) => c.label);
    expect(labels).toEqual(["This year (2026-27)", "Last year (2025-26)", "2022-23", "2021-22", "All time"]);
  });

  it("lists the twelve months of the year in the community's order", () => {
    const w = glanceWindow({ kind: "year", year: 2025 }, TODAY, 7);
    const m = monthsOfYear(w);
    expect(m).toHaveLength(12);
    expect(m[0]).toEqual({ key: "2025-07", label: "Jul" });
    expect(m[5]).toEqual({ key: "2025-12", label: "Dec" });
    expect(m[6]).toEqual({ key: "2026-01", label: "Jan" });
    expect(m[11]).toEqual({ key: "2026-06", label: "Jun" });
    expect(monthsOfYear(glanceWindow({ kind: "all" }, TODAY, 1))).toEqual([]);
  });

  it("builds addresses that carry only what it is told to", () => {
    expect(glanceHref("/households/h1", { tab: "pledges", year: "2025", giving_for: null })).toBe("/households/h1?tab=pledges&year=2025");
    expect(glanceHref("/households/h1", { tab: undefined, year: "" })).toBe("/households/h1");
  });
});

describe("the key figures", () => {
  const w2026 = glanceWindow({ kind: "year", year: 2026 }, TODAY, 1);

  it("counts what was received and shows it net of refunds", () => {
    const r = rows({
      payments: [
        payment({ id: "a", amount_cents: 100_00, refunded_cents: 25_00, status: "partially_refunded" }),
        payment({ id: "b", amount_cents: 50_00 }),
        payment({ id: "c", amount_cents: 80_00, refunded_cents: 80_00, status: "refunded" }),
        payment({ id: "d", amount_cents: 999_00, status: "failed" }),
        payment({ id: "e", amount_cents: 999_00, status: "voided" }),
        payment({ id: "f", amount_cents: 999_00, status: "authorized" }),
        payment({ id: "g", amount_cents: 700_00, is_opening_balance: true }),
        payment({ id: "h", amount_cents: 40_00, received_on: "2025-05-05" }),
      ],
    });
    const t = periodTotals(r, w2026.from, w2026.to);
    expect(t.grossCents).toBe(230_00);
    expect(t.refundedCents).toBe(105_00);
    expect(t.paidCents).toBe(125_00);
    // The fully refunded gift kept nothing, so it is not counted as a gift; the average is of what was kept.
    expect(t.giftCount).toBe(2);
    expect(t.averageCents).toBe(62_50);
    expect(t.openingBalanceCents).toBe(700_00);
    expect(isGift(r.payments[3])).toBe(false);
    expect(netOf(r.payments[2])).toBe(0);
    // All time includes the 2025 gift; last year's window sees only that one.
    expect(periodTotals(r, null, null).paidCents).toBe(165_00);
    const last = glanceWindow({ kind: "year", year: 2025 }, TODAY, 1);
    expect(periodTotals(r, last.from, last.to).paidCents).toBe(40_00);
  });

  it("never lets a refund larger than the gift push the total below zero", () => {
    const t = periodTotals(rows({ payments: [payment({ id: "x", amount_cents: 10_00, refunded_cents: 99_00 })] }), null, null);
    expect(t.paidCents).toBe(0);
    expect(t.giftCount).toBe(0);
    expect(t.averageCents).toBeNull();
  });

  it("adds up the pledges made in the period, leaving out cancelled ones, and says what fulfilment is", () => {
    const r = rows({
      pledges: [
        pledge({ id: "1", amount_cents: 1000_00, paid_cents: 400_00, status: "partially_paid" }),
        pledge({ id: "2", amount_cents: 500_00, paid_cents: 500_00, status: "paid" }),
        pledge({ id: "3", amount_cents: 300_00, paid_cents: 0, status: "cancelled" }),
        pledge({ id: "4", amount_cents: 200_00, paid_cents: 50_00, status: "written_off" }),
        pledge({ id: "5", amount_cents: 900_00, pledged_on: "2025-04-01", paid_cents: 900_00, status: "paid" }),
      ],
    });
    const s = summarize(r, w2026, TODAY);
    expect(s.totals).toMatchObject({ pledgedCents: 1700_00, pledgedCount: 3, writtenOffCents: 150_00, paidOnPledgesCents: 950_00 });
    expect(s.fulfilmentPercent).toBe(56);
    expect(s.previous?.pledgedCents).toBe(900_00);
    expect(s.previousFulfilmentPercent).toBe(100);
    // Nothing pledged means no percentage, not 0%.
    expect(summarize(rows({}), w2026, TODAY).fulfilmentPercent).toBeNull();
  });

  it("reports what is still open as of today, not only what was pledged in the period", () => {
    const r = rows({
      pledges: [
        pledge({ id: "old", amount_cents: 600_00, paid_cents: 100_00, status: "partially_paid", pledged_on: "2024-03-01", due_on: "2024-06-01" }),
        pledge({ id: "new", amount_cents: 400_00, due_on: "2026-12-31" }),
        pledge({ id: "done", amount_cents: 400_00, paid_cents: 400_00, status: "paid" }),
        pledge({ id: "gone", amount_cents: 400_00, status: "written_off" }),
      ],
    });
    const o = openTotals(r.pledges, TODAY, w2026.from, w2026.to);
    expect(o).toMatchObject({ cents: 900_00, count: 2, fromPeriodCents: 400_00 });
    expect(summarize(r, glanceWindow({ kind: "year", year: 2021 }, TODAY, 1), TODAY).open.cents).toBe(900_00);
  });

  it("finds what is overdue: past its due date, or 30 days after it was made when it has none", () => {
    const r = rows({
      pledges: [
        pledge({ id: "late", amount_cents: 100_00, due_on: "2026-10-01" }),
        pledge({ id: "today", amount_cents: 100_00, due_on: TODAY }),
        pledge({ id: "future", amount_cents: 100_00, due_on: "2026-10-13" }),
        pledge({ id: "nodue-late", amount_cents: 70_00, pledged_on: "2026-08-01" }),
        pledge({ id: "nodue-fresh", amount_cents: 70_00, pledged_on: "2026-09-20" }),
        pledge({ id: "nodue-edge", amount_cents: 70_00, pledged_on: "2026-09-12" }),
      ],
    });
    const o = openTotals(r.pledges, TODAY, null, null);
    // late: 11 days; nodue-late: due 31 Aug, 42 days; nodue-edge: due 12 Oct, not yet late.
    expect(o).toMatchObject({ overdueCount: 2, overdueCents: 170_00, oldestOverdueDays: 42, count: 6, cents: 510_00 });
    expect(openTotals([], TODAY, null, null)).toMatchObject({ overdueCount: 0, oldestOverdueDays: 0 });
  });

  it("shows the last gift in the period and, when there is none, the latest of any time", () => {
    const r = rows({
      payments: [
        payment({ id: "a", received_on: "2025-12-24", amount_cents: 75_00 }),
        payment({ id: "b", received_on: "2025-12-24", amount_cents: 20_00 }),
        payment({ id: "c", received_on: "2026-04-02", amount_cents: 30_00, status: "failed" }),
      ],
    });
    const s = summarize(r, w2026, TODAY);
    expect(s.lastGiftInPeriod).toBeNull();
    expect(s.lastGiftEver).toEqual({ on: "2025-12-24", cents: 20_00 });
    expect(summarize(r, glanceWindow({ kind: "year", year: 2025 }, TODAY, 1), TODAY).lastGiftInPeriod?.on).toBe("2025-12-24");
  });

  it("lists active recurring gifts only", () => {
    const rec: GlanceRecurring[] = [
      { id: "r1", household_id: HH, person_id: AMARA, amount_cents: 50_00, frequency: "monthly", status: "active" },
      { id: "r2", household_id: HH, person_id: null, amount_cents: 20_00, frequency: "weekly", status: "paused" },
    ];
    expect(summarize(rows({ recurring: rec }), w2026, TODAY).recurring).toEqual({ count: 1, items: [{ amountCents: 50_00, frequency: "monthly" }] });
  });

  it("is empty only when nothing was pledged or paid in the period", () => {
    expect(summarize(rows({}), w2026, TODAY).empty).toBe(true);
    expect(summarize(rows({ payments: [payment({ id: "o", is_opening_balance: true })] }), w2026, TODAY).empty).toBe(true);
    expect(summarize(rows({ payments: [payment({ id: "p" })] }), w2026, TODAY).empty).toBe(false);
    expect(summarize(rows({ pledges: [pledge({ id: "q" })] }), w2026, TODAY).empty).toBe(false);
    expect(summarize(rows({ pledges: [pledge({ id: "q", pledged_on: "2025-01-01" })] }), w2026, TODAY).empty).toBe(true);
  });

  it("compares with the same time last year while the year is still going", () => {
    const r = rows({
      payments: [
        payment({ id: "now", received_on: "2026-05-01", amount_cents: 600_00 }),
        payment({ id: "before-today", received_on: "2025-05-01", amount_cents: 400_00 }),
        // After this day last year: not part of the like-for-like comparison.
        payment({ id: "later", received_on: "2025-12-01", amount_cents: 900_00 }),
      ],
    });
    const s = summarize(r, w2026, TODAY);
    expect(s.previous?.paidCents).toBe(400_00);
    expect(deltaText(s.totals.paidCents, s.previous?.paidCents ?? null, s.window.previous!.label, money)).toBe("Up 50% on the same time last year ($400.00)");
  });
});

describe("plain words for a change", () => {
  it("says up, down, same or nothing, and nothing at all when there is nothing to compare", () => {
    expect(deltaText(150, 100, "2024", money)).toBe("Up 50% on 2024 ($1.00)");
    expect(deltaText(50, 100, "2024", money)).toBe("Down 50% on 2024 ($1.00)");
    expect(deltaText(100, 100, "2024", money)).toBe("Same as 2024 ($1.00)");
    expect(deltaText(996, 1000, "2024", money)).toBe("Down slightly on 2024 ($10.00)");
    expect(deltaText(500, 0, "2024", money)).toBe("Nothing in 2024");
    expect(deltaText(500, 0, "the same time last year", money)).toBe("Nothing at this time last year");
    expect(deltaText(0, 0, "2024", money)).toBeNull();
    expect(deltaText(500, null, "2024", money)).toBeNull();
  });
});

describe("where the money went and when", () => {
  it("splits each gift by what it paid, the rest being general giving, and always adds up to Paid", () => {
    const r = rows({
      payments: [
        payment({ id: "a", amount_cents: 100_00, allocations: [{ cause: "Building fund", cents: 60_00 }, { cause: "Youth camp", cents: 30_00 }] }),
        // A refund is taken off in proportion, with the last cent landing in general giving.
        payment({ id: "b", amount_cents: 33_33, refunded_cents: 10_00, allocations: [{ cause: "Building fund", cents: 33_33 }] }),
        payment({ id: "c", amount_cents: 20_00, allocations: [{ cause: null, cents: 20_00 }] }),
        payment({ id: "d", amount_cents: 15_00 }),
        payment({ id: "e", amount_cents: 9_00, status: "failed", allocations: [{ cause: "Ignored", cents: 9_00 }] }),
      ],
    });
    const causes = givingByCause(r.payments, null, null);
    const paid = periodTotals(r, null, null).paidCents;
    expect(causes.reduce((s, c) => s + c.cents, 0)).toBe(paid);
    expect(causes.map((c) => c.label)).not.toContain("Ignored");
    expect(causes[0]).toMatchObject({ label: "Building fund" });
    expect(causes.find((c) => c.label === GENERAL_CAUSE)?.cents).toBe(10_00 + 20_00 + 15_00);
    expect(causes.reduce((s, c) => s + c.percent, 0)).toBeGreaterThanOrEqual(99);
  });

  it("shows the five largest and groups the rest as Others", () => {
    const payments = ["A", "B", "C", "D", "E", "F", "G"].map((name, i) =>
      payment({ id: name, amount_cents: (10 - i) * 1000, allocations: [{ cause: `Fund ${name}`, cents: (10 - i) * 1000 }] }),
    );
    const causes = givingByCause(payments, null, null);
    expect(causes.map((c) => c.label)).toEqual(["Fund A", "Fund B", "Fund C", "Fund D", "Fund E", "Others"]);
    expect(causes[5].cents).toBe(5000 + 4000);
    expect(givingByCause([], null, null)).toEqual([]);
  });

  it("gives twelve monthly bars for a July year that add up to Paid, and yearly bars for all time", () => {
    const w = glanceWindow({ kind: "year", year: 2025 }, TODAY, 7);
    const r = rows({
      payments: [
        payment({ id: "a", received_on: "2025-07-04", amount_cents: 10_00 }),
        payment({ id: "b", received_on: "2025-12-25", amount_cents: 70_00, refunded_cents: 20_00 }),
        payment({ id: "c", received_on: "2026-06-30", amount_cents: 5_00 }),
        payment({ id: "d", received_on: "2026-07-01", amount_cents: 99_00 }),
        payment({ id: "e", received_on: "2025-06-30", amount_cents: 99_00 }),
      ],
    });
    const bars = givingByTime(r.payments, w);
    expect(bars.map((b) => b.label)).toEqual(["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"]);
    expect(bars.reduce((s, b) => s + b.cents, 0)).toBe(periodTotals(r, w.from, w.to).paidCents);
    expect(bars.find((b) => b.key === "2025-12")?.cents).toBe(50_00);
    const all = givingByTime(r.payments, glanceWindow({ kind: "all" }, TODAY, 7));
    expect(all.map((b) => [b.label, b.cents])).toEqual([
      ["2024-25", 99_00],
      ["2025-26", 10_00 + 50_00 + 5_00],
      ["2026-27", 99_00],
    ]);
    expect(givingByTime([], glanceWindow({ kind: "all" }, TODAY, 1))).toEqual([]);
  });

  it("describes the bars in words for a screen reader", () => {
    expect(timeSeriesText([{ key: "1", label: "Jan", cents: 100 }, { key: "2", label: "Feb", cents: 0 }], "Paid by month", money)).toBe("Paid by month: Jan $1.00, Feb $0.00.");
    expect(timeSeriesText([], "Paid by month", money)).toBe("Paid by month: nothing paid.");
  });
});

describe("whose giving: household or person", () => {
  const adults = [
    { id: AMARA, name: "Amara Okafor" },
    { id: MATEO, name: "Mateo Silva" },
  ];
  const ids = new Set(adults.map((a) => a.id));
  const r = rows({
    pledges: [
      pledge({ id: "p1", person_id: AMARA, amount_cents: 500_00 }),
      pledge({ id: "p2", person_id: null, amount_cents: 300_00 }),
      pledge({ id: "p3", person_id: CHILD, amount_cents: 100_00 }),
    ],
    payments: [
      payment({ id: "y1", person_id: AMARA, amount_cents: 200_00 }),
      payment({ id: "y2", person_id: MATEO, amount_cents: 120_00 }),
      payment({ id: "y3", person_id: null, amount_cents: 75_00 }),
      payment({ id: "y4", person_id: CHILD, amount_cents: 5_00 }),
    ],
    recurring: [{ id: "r1", household_id: HH, person_id: MATEO, amount_cents: 25_00, frequency: "monthly", status: "active" }],
  });
  const w = glanceWindow({ kind: "year", year: 2026 }, TODAY, 1);

  it("defaults to the household when the setting is missing or unreadable", () => {
    expect(givingShowBy({})).toBe("household");
    expect(givingShowBy(null)).toBe("household");
    expect(givingShowBy({ giving: { show_by: "nonsense" } })).toBe("household");
    expect(givingShowBy({ giving: "person" })).toBe("household");
    expect(givingShowBy({ giving: { show_by: "person" } })).toBe("person");
    expect(givingShowBy({ giving: { show_by: "household" } })).toBe("household");
  });

  it("checks the stored setting in plain words", () => {
    expect(givingRuleProblems(undefined)).toEqual([]);
    expect(givingRuleProblems({})).toEqual([]);
    expect(givingRuleProblems({ show_by: "person" })).toEqual([]);
    expect(givingRuleProblems({ show_by: "family" })).toEqual([`"giving.show_by" must be "household" or "person".`]);
    expect(givingRuleProblems("x")).toEqual([`"giving" must be an object.`]);
  });

  it("only picks an adult of the household from the address", () => {
    expect(parseGlanceScope(AMARA, ids)).toEqual({ kind: "person", personId: AMARA });
    expect(parseGlanceScope("none", ids)).toEqual({ kind: "rest" });
    expect(parseGlanceScope(CHILD, ids)).toEqual({ kind: "household" });
    expect(parseGlanceScope("someone-else", ids)).toEqual({ kind: "household" });
    expect(parseGlanceScope(undefined, ids)).toEqual({ kind: "household" });
    expect(scopeParam({ kind: "rest" })).toBe("none");
    expect(scopeParam({ kind: "person", personId: MATEO })).toBe(MATEO);
    expect(scopeParam({ kind: "household" })).toBeNull();
  });

  it("splits into each adult plus 'Not tied to a person', which add up to the household", () => {
    const c = chooserParts(r, adults, w);
    expect(c.everyone).toEqual({ paidCents: 400_00, pledgedCents: 900_00 });
    expect(c.people.map((p) => [p.name, p.paidCents, p.pledgedCents])).toEqual([
      ["Amara Okafor", 200_00, 500_00],
      ["Mateo Silva", 120_00, 0],
    ]);
    // What was recorded under a child is in the remainder; the child is not named anywhere.
    expect(c.rest).toEqual({ paidCents: 80_00, pledgedCents: 400_00 });
    expect(c.people.reduce((s, p) => s + p.paidCents, c.rest.paidCents)).toBe(c.everyone.paidCents);
    expect(c.people.reduce((s, p) => s + p.pledgedCents, c.rest.pledgedCents)).toBe(c.everyone.pledgedCents);
    expect(JSON.stringify(c)).not.toContain(CHILD);
  });

  it("scopes every kind of row", () => {
    const amara = scopeRows(r, { kind: "person", personId: AMARA }, ids);
    expect([amara.pledges.length, amara.payments.length, amara.recurring.length]).toEqual([1, 1, 0]);
    const rest = scopeRows(r, { kind: "rest" }, ids);
    expect([rest.pledges.length, rest.payments.length, rest.recurring.length]).toEqual([2, 2, 0]);
    expect(scopeRows(r, { kind: "household" }, ids)).toBe(r);
    const mateo = summarize(scopeRows(r, { kind: "person", personId: MATEO }, ids), w, TODAY);
    expect(mateo.recurring.count).toBe(1);
    expect(mateo.totals.paidCents).toBe(120_00);
  });

  it("splits one person from the rest of the household (the person page)", () => {
    const { mine, rest } = personAndRest(r, AMARA);
    expect(mine.payments.map((p) => p.id)).toEqual(["y1"]);
    expect(rest.payments.map((p) => p.id)).toEqual(["y2", "y3", "y4"]);
    expect(mine.payments.length + rest.payments.length).toBe(r.payments.length);
    expect(mine.pledges.length + rest.pledges.length).toBe(r.pledges.length);
  });
});
