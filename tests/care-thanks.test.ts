import { describe, expect, it } from "vitest";

import {
  dueLine,
  giftLine,
  howLine,
  medianLine,
  onTimeLine,
  openLine,
  parseHouseholdThanks,
  parseThanksCounts,
  parseThanksQueue,
  parseThanksSettings,
  parseThanksSummary,
  personalLine,
  thanksTaskCopy,
  waysFor,
} from "@/lib/care/thanks";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const row = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  household: { id: "h1", name: "Mensah family", number: "H-1", adults: [{ person_id: "p1", name: "Ama Mensah", is_primary: true }] },
  gift_on: "2026-10-11",
  due_on: "2026-10-13",
  overdue: true,
  days_overdue: 3,
  needs_personal: true,
  amount_cents: null,
  thanked_at: null,
  how: null,
  set_aside_at: null,
  set_aside_reason: null,
  ...over,
});

describe("reading the thank-you list", () => {
  it("reads the rows, the counts and the state of a good answer", () => {
    const q = parseThanksQueue({
      state: "ok", filter: "overdue", rows: [row(), row({ id: "t2", amount_cents: 12000, needs_personal: false })], total: 7,
      counts: { open: 4, overdue: 2, personal_open: 1, done: 9, set_aside: 0 }, window_days: 2, amounts: false, today: "2026-10-16", can_manage: true,
    });
    expect(q.state).toBe("ok");
    if (q.state !== "ok") return;
    expect(q.filter).toBe("overdue");
    expect(q.rows.map((r) => r.id)).toEqual(["t1", "t2"]);
    expect(q.rows[0].household.name).toBe("Mensah family");
    expect(q.rows[0].amountCents).toBeNull();
    expect(q.rows[1].amountCents).toBe(12000);
    expect(q.counts).toEqual({ open: 4, overdue: 2, personalOpen: 1, done: 9, setAside: 0 });
    expect(q.total).toBe(7);
    expect(q.canManage).toBe(true);
  });

  it("keeps the two states that are not a list, and never invents rows from nonsense", () => {
    expect(parseThanksQueue({ state: "not_set_up", can_manage: true })).toEqual({ state: "not_set_up", canManage: true });
    expect(parseThanksQueue({ state: "giving_off" })).toEqual({ state: "giving_off" });
    const bad = parseThanksQueue({ state: "ok", rows: [{ nothing: 1 }, "x", null], counts: "no" });
    expect(bad.state === "ok" && bad.rows).toEqual([]);
    expect(bad.state === "ok" && bad.counts.open).toBe(0);
  });

  it("reads the summary and the household list", () => {
    const s = parseThanksSummary({ state: "ok", days: 90, window_days: 2, gifts: 5, thanked: 3, open: 2, overdue: 2, median_hours: 60.5, on_time_share: 0.6 });
    expect(s).toMatchObject({ state: "ok", gifts: 5, thanked: 3, medianHours: 60.5, onTimeShare: 0.6 });
    expect(parseThanksSummary({ state: "ok" })).toMatchObject({ medianHours: null, onTimeShare: null });
    const h = parseHouseholdThanks({ state: "ok", amounts: true, window_days: 3, open: [{ id: "a", gift_on: "2026-10-01", due_on: "2026-10-04", overdue: true, needs_personal: true, amount_cents: 5000 }, { id: "" }] });
    expect(h).toEqual({ state: "ok", amounts: true, windowDays: 3, open: [{ id: "a", giftOn: "2026-10-01", dueOn: "2026-10-04", overdue: true, needsPersonal: true, amountCents: 5000 }] });
  });

  it("reads the rules, with the defaults for what is missing", () => {
    expect(parseThanksSettings({})).toEqual({ saved: false, thankWindowDays: 2, firstGiftPersonal: true, personalFromCents: null, countFees: false, thanksFrom: null, today: null, canManage: false });
    expect(parseThanksSettings({ saved: true, thank_window_days: 5, first_gift_personal: false, personal_from_cents: 50000, count_fees: true, thanks_from: "2026-09-16", can_manage: true }))
      .toMatchObject({ saved: true, thankWindowDays: 5, firstGiftPersonal: false, personalFromCents: 50000, countFees: true, thanksFrom: "2026-09-16", canManage: true });
  });
});

describe("the sentences", () => {
  it("says the gift with its amount, or says to thank them warmly when there is none", () => {
    expect(giftLine({ giftOn: "2026-10-11", amountCents: 12000 }, money)).toBe("$120.00 gift on 11 October 2026");
    expect(giftLine({ giftOn: "2026-10-11", amountCents: null }, money)).toBe("A gift on 11 October 2026. Thank them warmly.");
  });

  it("says what is due and what closes the step", () => {
    expect(dueLine({ overdue: true, daysOverdue: 3, dueOn: "2026-10-13" })).toBe("Overdue by 3 days");
    expect(dueLine({ overdue: true, daysOverdue: 1, dueOn: "2026-10-13" })).toBe("Overdue by a day");
    expect(dueLine({ overdue: false, daysOverdue: null, dueOn: "2026-10-18" })).toBe("Due 18 October 2026");
    expect(personalLine(true)).toContain("call");
    expect(personalLine(false)).toContain("receipt");
  });

  it("says how a step was closed, the median time and the share on time", () => {
    expect(howLine("receipt", "2026-10-12T10:00:00Z")).toBe("Receipt sent 12 October 2026");
    expect(howLine("touch", null)).toBe("Thanked");
    expect(medianLine(null)).toBeNull();
    expect(medianLine(0.4)).toBe("under an hour");
    expect(medianLine(1)).toBe("about 1 hour");
    expect(medianLine(5.2)).toBe("about 5 hours");
    expect(medianLine(120)).toBe("about 5 days");
    expect(onTimeLine(0.6)).toBe("60% on time");
    expect(onTimeLine(null)).toBeNull();
  });

  it("heads the list with the open count", () => {
    expect(openLine({ open: 0, overdue: 0 })).toBe("Every gift is thanked.");
    expect(openLine({ open: 1, overdue: 0 })).toBe("1 gift to thank");
    expect(openLine({ open: 4, overdue: 2 })).toBe("4 gifts to thank, 2 overdue");
  });

  it("offers a personal step only the ways that close it", () => {
    expect(waysFor(true).map((w) => w.channel)).toEqual(["phone", "post", "in_person"]);
    expect(waysFor(false).map((w) => w.channel)).toEqual(["phone", "post", "in_person", "email", "text"]);
  });
});

describe("Home's row for the gifts to thank", () => {
  it("reads the three numbers, and nothing before the rules are saved or while Giving is off", () => {
    expect(parseThanksCounts({ state: "ok", open: 4, overdue: 1, personal_open: 2 })).toEqual({ open: 4, overdue: 1, personalOpen: 2 });
    expect(parseThanksCounts({ state: "not_set_up" })).toBeNull();
    expect(parseThanksCounts({ state: "giving_off" })).toBeNull();
    expect(parseThanksCounts("nonsense")).toBeNull();
  });

  it("words the row, and draws none when nothing waits", () => {
    expect(thanksTaskCopy({ open: 4, overdue: 1, personalOpen: 2 })).toEqual({ title: "4 gifts to thank", meta: "1 overdue · 2 need a personal thank-you" });
    expect(thanksTaskCopy({ open: 1, overdue: 0, personalOpen: 0 })).toEqual({ title: "1 gift to thank", meta: "Within the window" });
    expect(thanksTaskCopy({ open: 0, overdue: 0, personalOpen: 0 })).toBeNull();
    expect(thanksTaskCopy(null)).toBeNull();
  });
});
