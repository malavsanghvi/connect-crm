// "Giving at a glance": the numbers. Pure: rows in, numbers out; no clock, no database, no formatting of money (integer cents all
// the way; the screen formats at the edge). The rules are the ones the year-end statements and giving.household_summary use:
//   - a gift is a payment that was not an opening balance and did not fail, get voided or stay only authorized;
//   - "Paid" is net of refunds;
//   - a pledge is open while it is open or partly paid and something is still owed;
//   - an open pledge is overdue the day after its due date, or 30 days after it was made when it has no due date.

import { addDays, daysBetween } from "@/lib/dates";

import { inWindow, monthsOfYear, type GlanceWindow } from "./period";

export type GlancePledge = {
  id: string;
  household_id: string;
  /** Who made the pledge (pledges.pledged_by_person_id); null when it is not tied to a person. */
  person_id: string | null;
  amount_cents: number;
  paid_cents: number;
  /** open, partially_paid, paid, written_off or cancelled. */
  status: string;
  /** The day it was made, in the community's time zone. */
  pledged_on: string;
  due_on: string | null;
};

export type GlancePayment = {
  id: string;
  household_id: string;
  /** Who paid (payments.payer_person_id); null when it is not tied to a person. */
  person_id: string | null;
  amount_cents: number;
  refunded_cents: number;
  status: string;
  received_on: string;
  is_opening_balance: boolean;
  /** What the payment went to, by pledge: the campaign or fund name (null for a pledge with neither). */
  allocations: { cause: string | null; cents: number }[];
};

export type GlanceRecurring = {
  id: string;
  household_id: string;
  person_id: string | null;
  amount_cents: number;
  frequency: string;
  status: string;
};

export type GlanceRows = { pledges: GlancePledge[]; payments: GlancePayment[]; recurring: GlanceRecurring[] };

export const GENERAL_CAUSE = "General giving";
export const OTHER_CAUSES = "Others";
/** The same sentence giving.household_summary gives a finance volunteer. */
export const LIMITED_VIEW_NOTE =
  "You can see only the payments you recorded yourself, so the totals and the list of payments may be lower than the household's real giving. Open pledges are complete.";

const NEVER_RECEIVED = new Set(["failed", "voided", "authorized"]);
const OPEN_PLEDGE = new Set(["open", "partially_paid"]);
const OVERDUE_AFTER_NO_DUE_DATE = 30;

export const isGift = (p: GlancePayment): boolean => !p.is_opening_balance && !NEVER_RECEIVED.has(p.status);
const refundedOf = (p: GlancePayment): number => Math.min(Math.max(p.refunded_cents, 0), Math.max(p.amount_cents, 0));
/** What a gift kept after refunds. */
export const netOf = (p: GlancePayment): number => Math.max(p.amount_cents, 0) - refundedOf(p);
export const isOpenPledge = (p: GlancePledge): boolean => OPEN_PLEDGE.has(p.status) && p.amount_cents > p.paid_cents;
const owed = (p: GlancePledge): number => Math.max(p.amount_cents - p.paid_cents, 0);

export type PeriodTotals = {
  pledgedCents: number;
  pledgedCount: number;
  /** Of the pledged amount, what was written off (so a gap is explained). */
  writtenOffCents: number;
  /** Paid so far on the pledges made in the period (bounded by what was pledged). */
  paidOnPledgesCents: number;
  grossCents: number;
  refundedCents: number;
  paidCents: number;
  /** Gifts that kept something after refunds. */
  giftCount: number;
  averageCents: number | null;
  /** Opening balances dated in the period: shown nowhere in the figures, mentioned once. */
  openingBalanceCents: number;
};

export function periodTotals(rows: Pick<GlanceRows, "pledges" | "payments">, from: string | null, to: string | null): PeriodTotals {
  let pledgedCents = 0;
  let pledgedCount = 0;
  let writtenOffCents = 0;
  let paidOnPledgesCents = 0;
  for (const p of rows.pledges) {
    if (p.status === "cancelled" || !inWindow(p.pledged_on, from, to)) continue;
    pledgedCents += p.amount_cents;
    pledgedCount += 1;
    paidOnPledgesCents += Math.min(Math.max(p.paid_cents, 0), p.amount_cents);
    if (p.status === "written_off") writtenOffCents += owed(p);
  }
  let grossCents = 0;
  let refundedCents = 0;
  let giftCount = 0;
  let openingBalanceCents = 0;
  for (const p of rows.payments) {
    if (!inWindow(p.received_on, from, to)) continue;
    if (p.is_opening_balance && !NEVER_RECEIVED.has(p.status)) openingBalanceCents += p.amount_cents;
    if (!isGift(p)) continue;
    grossCents += Math.max(p.amount_cents, 0);
    refundedCents += refundedOf(p);
    if (netOf(p) > 0) giftCount += 1;
  }
  const paidCents = grossCents - refundedCents;
  return {
    pledgedCents,
    pledgedCount,
    writtenOffCents,
    paidOnPledgesCents,
    grossCents,
    refundedCents,
    paidCents,
    giftCount,
    averageCents: giftCount > 0 ? Math.round(paidCents / giftCount) : null,
    openingBalanceCents,
  };
}

/** Paid, net of refunds, between two days: what the person chooser shows beside a name. */
export function paidBetween(payments: GlancePayment[], from: string | null, to: string | null): number {
  let t = 0;
  for (const p of payments) if (isGift(p) && inWindow(p.received_on, from, to)) t += netOf(p);
  return t;
}

export type OpenTotals = {
  cents: number;
  count: number;
  /** Of the open amount, what comes from pledges made in the period. */
  fromPeriodCents: number;
  overdueCents: number;
  overdueCount: number;
  /** Days the oldest overdue pledge is late (0 when nothing is overdue). */
  oldestOverdueDays: number;
};

/** The day an open pledge is due: its due date, or 30 days after it was made. */
export function dueDayOf(p: Pick<GlancePledge, "due_on" | "pledged_on">): string {
  return p.due_on ?? addDays(p.pledged_on, OVERDUE_AFTER_NO_DUE_DATE);
}

/** What is still open as of today (not only the period), and how much of it is late. */
export function openTotals(pledges: GlancePledge[], today: string, from: string | null, to: string | null): OpenTotals {
  const t: OpenTotals = { cents: 0, count: 0, fromPeriodCents: 0, overdueCents: 0, overdueCount: 0, oldestOverdueDays: 0 };
  for (const p of pledges) {
    if (!isOpenPledge(p)) continue;
    const open = owed(p);
    t.cents += open;
    t.count += 1;
    if (inWindow(p.pledged_on, from, to)) t.fromPeriodCents += open;
    const late = daysBetween(dueDayOf(p), today);
    if (late >= 1) {
      t.overdueCents += open;
      t.overdueCount += 1;
      t.oldestOverdueDays = Math.max(t.oldestOverdueDays, late);
    }
  }
  return t;
}

export type CauseShare = { label: string; cents: number; percent: number };

/**
 * What the money paid in the period went to, by campaign or fund (top five, then "Others"). Each payment's net amount is split by its
 * allocations; the part not applied to any pledge, and any pledge with no campaign or fund, is "General giving". The parts add up to
 * Paid exactly (the last cent of a split always lands in General giving).
 */
export function givingByCause(payments: GlancePayment[], from: string | null, to: string | null, top = 5): CauseShare[] {
  const totals = new Map<string, number>();
  const add = (label: string, cents: number) => {
    if (cents !== 0) totals.set(label, (totals.get(label) ?? 0) + cents);
  };
  for (const p of payments) {
    if (!isGift(p) || !inWindow(p.received_on, from, to)) continue;
    const net = netOf(p);
    if (net <= 0) continue;
    const gross = Math.max(p.amount_cents, 1);
    let used = 0;
    for (const a of p.allocations) {
      const share = Math.min(Math.floor((net * Math.max(a.cents, 0)) / gross), net - used);
      used += share;
      add(a.cause ?? GENERAL_CAUSE, share);
    }
    add(GENERAL_CAUSE, net - used);
  }
  const sorted = [...totals.entries()].map(([label, cents]) => ({ label, cents })).sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
  const total = sorted.reduce((s, x) => s + x.cents, 0);
  const shown = sorted.slice(0, top);
  const rest = sorted.slice(top).reduce((s, x) => s + x.cents, 0);
  if (rest > 0) shown.push({ label: OTHER_CAUSES, cents: rest });
  return shown.map((x) => ({ ...x, percent: total > 0 ? Math.round((x.cents * 100) / total) : 0 }));
}

export type Bucket = { key: string; label: string; cents: number };

/**
 * Paid by month for a year (twelve bars, in the community's order), or by year for all time (the last ten years with their gaps
 * filled in). Net of refunds, so the bars add up to Paid.
 */
export function givingByTime(payments: GlancePayment[], window: GlanceWindow): Bucket[] {
  const gifts = payments.filter((p) => isGift(p) && inWindow(p.received_on, window.from, window.to));
  if (window.from) {
    const months = monthsOfYear(window);
    const sums = new Map(months.map((m) => [m.key, 0]));
    for (const p of gifts) {
      const k = p.received_on.slice(0, 7);
      if (sums.has(k)) sums.set(k, (sums.get(k) ?? 0) + netOf(p));
    }
    return months.map((m) => ({ ...m, cents: sums.get(m.key) ?? 0 }));
  }
  if (gifts.length === 0) return [];
  const yearOf = (day: string) => {
    const y = Number(day.slice(0, 4));
    return Number(day.slice(5, 7)) < window.startMonth ? y - 1 : y;
  };
  const sums = new Map<number, number>();
  for (const p of gifts) sums.set(yearOf(p.received_on), (sums.get(yearOf(p.received_on)) ?? 0) + netOf(p));
  const last = Math.max(...sums.keys());
  const first = Math.max(Math.min(...sums.keys()), last - 9);
  const out: Bucket[] = [];
  for (let y = first; y <= last; y++) {
    const label = window.startMonth === 1 ? String(y) : `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
    out.push({ key: String(y), label, cents: sums.get(y) ?? 0 });
  }
  return out;
}

export type LastGift = { on: string; cents: number };

export function lastGift(payments: GlancePayment[], from: string | null, to: string | null): LastGift | null {
  let best: GlancePayment | null = null;
  for (const p of payments) {
    if (!isGift(p) || netOf(p) <= 0 || !inWindow(p.received_on, from, to)) continue;
    if (!best || p.received_on > best.received_on || (p.received_on === best.received_on && p.id > best.id)) best = p;
  }
  return best ? { on: best.received_on, cents: netOf(best) } : null;
}

export type RecurringSummary = { count: number; items: { amountCents: number; frequency: string }[] };

export function recurringSummary(recurring: GlanceRecurring[]): RecurringSummary {
  const items = recurring.filter((r) => r.status === "active").map((r) => ({ amountCents: r.amount_cents, frequency: r.frequency }));
  return { count: items.length, items };
}

export type GlanceSummary = {
  window: GlanceWindow;
  today: string;
  totals: PeriodTotals;
  /** The same figures for the period before (null for all time). */
  previous: PeriodTotals | null;
  open: OpenTotals;
  /** Paid against pledged for the pledges made in the period, 0 to 100; null when nothing was pledged. */
  fulfilmentPercent: number | null;
  previousFulfilmentPercent: number | null;
  lastGiftInPeriod: LastGift | null;
  /** The latest gift of any time, shown when there is none in the period. */
  lastGiftEver: LastGift | null;
  recurring: RecurringSummary;
  byCause: CauseShare[];
  byTime: Bucket[];
  /** Nothing was pledged or paid in the period (an opening balance does not count). */
  empty: boolean;
};

const percent = (part: number, whole: number): number | null => (whole > 0 ? Math.min(100, Math.max(0, Math.round((part * 100) / whole))) : null);

export function summarize(rows: GlanceRows, window: GlanceWindow, today: string): GlanceSummary {
  const totals = periodTotals(rows, window.from, window.to);
  const previous = window.previous ? periodTotals(rows, window.previous.from, window.previous.to) : null;
  return {
    window,
    today,
    totals,
    previous,
    open: openTotals(rows.pledges, today, window.from, window.to),
    fulfilmentPercent: percent(totals.paidOnPledgesCents, totals.pledgedCents),
    previousFulfilmentPercent: previous ? percent(previous.paidOnPledgesCents, previous.pledgedCents) : null,
    lastGiftInPeriod: lastGift(rows.payments, window.from, window.to),
    lastGiftEver: lastGift(rows.payments, null, null),
    recurring: recurringSummary(rows.recurring),
    byCause: givingByCause(rows.payments, window.from, window.to),
    byTime: givingByTime(rows.payments, window),
    empty: totals.pledgedCount === 0 && totals.giftCount === 0 && totals.refundedCents === 0 && totals.grossCents === 0,
  };
}

/**
 * Plain words for a change: "Up 12% on 2024 ($1,000.00)", "Down 5% on the same time last year ($400.00)", "Same as 2024",
 * "Nothing in 2024". Null when there is nothing to compare with (all time) or nothing on either side.
 */
export function deltaText(now: number, before: number | null, beforeLabel: string, money: (cents: number) => string): string | null {
  if (before === null) return null;
  if (before === 0 && now === 0) return null;
  if (before === 0) return `Nothing ${beforeLabel === "the same time last year" ? "at this time last year" : `in ${beforeLabel}`}`;
  if (now === before) return `Same as ${beforeLabel} (${money(before)})`;
  const pct = Math.round((Math.abs(now - before) * 100) / before);
  const dir = now > before ? "Up" : "Down";
  return pct === 0 ? `${dir} slightly on ${beforeLabel} (${money(before)})` : `${dir} ${pct}% on ${beforeLabel} (${money(before)})`;
}

/** A sentence for a screen reader (and the text under the bars) that says what the bars show. */
export function timeSeriesText(buckets: Bucket[], what: string, money: (cents: number) => string): string {
  if (buckets.length === 0) return `${what}: nothing paid.`;
  return `${what}: ${buckets.map((b) => `${b.label} ${money(b.cents)}`).join(", ")}.`;
}
