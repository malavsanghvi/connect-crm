import { describe, expect, it } from "vitest";

import type { HealthFacts } from "@/lib/care/health";
import { parseSignsWatch, weakSigns, weakSignsLine, type CareTodayIn } from "@/lib/care/watch";
import { CARE_SIGN_ROWS, buildQueue, careRows, groupLabel, queueTiles, type TodayCan, type TodayContext, type TodayInput } from "@/lib/giving-today/queue";

// DonorDelight, Today groups (0890): the shortlist of households that may be cooling, the sign rules decide, and the Care group on
// Giving > Today shows them only to a care holder, by household card, with every reason and no amount.

const TODAY = "2026-10-12";
const CTX = { today: TODAY, historyMonths: 30, giving: true };
const NONE: TodayCan = { approve: false, manage: false, bankConfirm: false, allocate: false, countRecord: false, closeManage: false };

function head(id: string, name: string, extra: Record<string, unknown> = {}) {
  return { id, name, number: `0${id.length}${id}`, org_household_id: `H-${id}`, city: "Lakeside", zone: null, primary_member: `${name} primary`, adults: [], merged: false, ...extra };
}
function facts(id: string, x: Partial<HealthFacts>): HealthFacts {
  return { householdId: id, gifts12: 0, giftsPrev12: 0, firstGiftOn: null, lastGiftOn: null, part12: 0, lastPartOn: null, opened12: 0, touches12: 0, asks12: 0, noAsk12: 0, lastTouchAt: null, unthanked: null, ...x };
}

const WATCH = parseSignsWatch({
  state: "ok",
  total: 5,
  rows: [
    { household: head("a", "Alpha"), owner: "Ravi Rel", last_touch_at: null },
    { household: head("b", "Bravo"), owner: null, last_touch_at: "2026-09-01T10:00:00Z" },
    { household: head("c", "Charlie"), owner: "Ravi Rel", last_touch_at: null },
    { household: head("d", "Delta"), owner: null, last_touch_at: null },
    { household: { id: "", name: "No id" }, owner: null },
  ],
});

describe("parseSignsWatch", () => {
  it("reads the households (a row without an id is dropped) and the total", () => {
    expect(WATCH.state).toBe("ok");
    expect(WATCH.total).toBe(5);
    expect(WATCH.rows.map((r) => r.household.id)).toEqual(["a", "b", "c", "d"]);
    expect(WATCH.rows[0].owner).toBe("Ravi Rel");
    expect(WATCH.rows[1].lastTouchAt).toBe("2026-09-01T10:00:00Z");
  });
  it("giving off, an empty answer and nonsense are safe", () => {
    expect(parseSignsWatch({ state: "giving_off", total: 0, rows: [] })).toEqual({ state: "giving_off", total: 0, rows: [] });
    expect(parseSignsWatch(null)).toEqual({ state: "ok", total: 0, rows: [] });
    expect(parseSignsWatch("x").rows).toEqual([]);
  });
});

describe("weakSigns: the sign rules decide, the shortlist only proposes", () => {
  // a: gave twice the year before, nothing since -> At risk. b: one gift against three -> Cooling.
  // c: gave as often as before and took part -> not weak (the shortlist was wider than the rules). d: nothing for two years -> Lapsed, not weak.
  const f = [
    facts("a", { giftsPrev12: 2, lastGiftOn: "2025-11-01" }),
    facts("b", { gifts12: 1, giftsPrev12: 3, lastGiftOn: "2026-09-20", part12: 1, lastPartOn: "2026-09-20" }),
    facts("c", { gifts12: 2, giftsPrev12: 2, lastGiftOn: "2026-08-01", part12: 1, lastPartOn: "2026-08-01" }),
    facts("d", { lastGiftOn: "2024-01-01" }),
  ];
  const weak = weakSigns(WATCH, f, CTX);

  it("keeps only Cooling and At risk, At risk first", () => {
    expect(weak.map((w) => [w.household.id, w.level, w.label])).toEqual([
      ["a", "at_risk", "At risk"],
      ["b", "cooling", "Cooling"],
    ]);
  });
  it("every sign carries its reasons in words, and the owner (or none)", () => {
    expect(weak[0].reasons[0]).toBe("Gave 2 times the year before, and not in the last 12 months");
    expect(weak[1].reasons[0]).toBe("Gave fewer times (1) than the year before (3)");
    expect(weak[0].owner).toBe("Ravi Rel");
    expect(weak[1].owner).toBeNull();
  });
  it("a household with no facts is left out, never guessed", () => {
    expect(weakSigns(WATCH, [f[0]], CTX).map((w) => w.household.id)).toEqual(["a"]);
  });
  it("a community with under a year of records has no weak sign yet", () => {
    expect(weakSigns(WATCH, f, { ...CTX, historyMonths: 4 })).toEqual([]);
  });
  it("without Giving there are no gift rules, so no weak sign", () => {
    expect(weakSigns(WATCH, f, { ...CTX, giving: false })).toEqual([]);
  });
  it("keeps the database's order inside a level (the longest quiet first)", () => {
    const two = parseSignsWatch({ state: "ok", total: 2, rows: [{ household: head("x", "X") }, { household: head("y", "Y") }] });
    const ff = [facts("x", { gifts12: 1, giftsPrev12: 2, lastGiftOn: "2026-09-01" }), facts("y", { gifts12: 1, giftsPrev12: 2, lastGiftOn: "2026-02-01" })];
    expect(weakSigns(two, ff, CTX).map((w) => w.household.id)).toEqual(["x", "y"]);
  });
  it("the facts carry no amount, so neither does the sign", () => {
    expect(JSON.stringify(weak)).not.toMatch(/amount|cents|\$/i);
  });
  it("the headline", () => {
    expect(weakSignsLine(1)).toBe("1 household is cooling or at risk");
    expect(weakSignsLine(3)).toBe("3 households are cooling or at risk");
  });
});

describe("the Care group on Today", () => {
  const signs = weakSigns(WATCH, [facts("a", { giftsPrev12: 2, lastGiftOn: "2025-11-01" }), facts("b", { gifts12: 1, giftsPrev12: 3, lastGiftOn: "2026-09-20" })], CTX);
  const care: CareTodayIn = { thanks: { open: 3, overdue: 1, personalOpen: 2 }, signs, more: false };

  it("a thank-you row with the counts, then a row per household with its card and reasons", () => {
    const rows = careRows(care);
    expect(rows.map((r) => r.id)).toEqual(["care:thanks", "care:sign:a", "care:sign:b"]);
    expect(rows[0].title).toBe("3 gifts to thank");
    expect(rows[0].lines[0]).toBe("1 overdue · 2 need a personal thank-you");
    expect(rows[0].count).toBe(3);
    expect(rows[1].title).toBe("At risk");
    expect(rows[1].family?.name).toBe("Alpha");
    expect(rows[1].family?.orgId).toBe("H-a");
    expect(rows[1].lines).toContain("Relationship owner: Ravi Rel");
    expect(rows[2].lines.at(-1)).toBe("Needs a relationship owner");
    expect(rows.every((r) => r.group === "care")).toBe(true);
  });
  it("your week comes first, with its two numbers and a button that opens it (slice 5)", () => {
    const rows = careRows({ ...care, week: { tasks: 4, overdue: 1 } });
    expect(rows[0]).toMatchObject({ id: "care:week", title: "Your week: 4 care tasks", count: 4, lines: ["1 overdue"] });
    expect(rows[0].acts).toEqual([{ kind: "link", href: "/care/week", label: "Open your week", primary: true }]);
    expect(careRows({ ...care, week: { tasks: 0, overdue: 0 } }).some((r) => r.id === "care:week")).toBe(false);
    expect(careRows({ ...care, week: null }).some((r) => r.id === "care:week")).toBe(false);
  });
  it("every button opens the Care card or the DonorDelight list; none asks anyone for money", () => {
    const acts = careRows(care).flatMap((r) => r.acts);
    expect(acts.every((a) => a.kind === "link")).toBe(true);
    expect(acts.map((a) => (a.kind === "link" ? a.href : ""))).toEqual(["/care/thanks", "/households/a", "/households/b"]);
  });
  it("nothing waiting is no row; a sign row stands for one household", () => {
    expect(careRows({ thanks: null, signs: [], more: false })).toEqual([]);
    expect(careRows({ thanks: { open: 0, overdue: 0, personalOpen: 0 }, signs: [], more: true })).toEqual([]);
    expect(careRows(care).filter((r) => r.id.startsWith("care:sign")).every((r) => r.count === 1)).toBe(true);
  });
  it("more than five signs: five rows and one row pointing at the list", () => {
    const many = parseSignsWatch({ state: "ok", total: 8, rows: Array.from({ length: 8 }, (_, i) => ({ household: head(`h${i}`, `House ${i}`) })) });
    const ff = many.rows.map((r) => facts(r.household.id, { giftsPrev12: 2, lastGiftOn: "2025-11-01" }));
    const rows = careRows({ thanks: null, signs: weakSigns(many, ff, CTX), more: true });
    expect(rows.filter((r) => r.id.startsWith("care:sign:"))).toHaveLength(CARE_SIGN_ROWS);
    const more = rows.find((r) => r.id === "care:signs-more");
    expect(more?.title).toBe("3 more households to look at");
    expect(more?.count).toBe(3);
  });

  function ctx(visibleCare: boolean): TodayContext {
    return {
      can: NONE, currency: "USD", locale: "en-US", timeZone: "America/Chicago", today: TODAY, labels: { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" },
      countsWord: "Cash counts", zelleWord: "Zelle", careWord: "Donor care",
      visible: { approvals: false, bank: false, pledges: false, counts: false, books: false, care: visibleCare },
    };
  }
  const input = (c: TodayInput["care"]): TodayInput => ({ tasks: [], taskFailures: [], families: {}, bank: null, behind: null, apply: null, counts: null, close: null, care: c });

  it("the group is the kind's word and counts what a person can act on", () => {
    const q = buildQueue(input({ state: "ok", data: care }), ctx(true));
    expect(q.tiles.map((t) => [t.key, t.label, t.count])).toEqual([["all", "Everything", 5], ["care", "Donor care", 5]]);
    expect(groupLabel("care", { countsWord: "x" })).toBe("Care");
  });
  it("whoever holds no care key gets no row and no tile", () => {
    const q = buildQueue(input(null), ctx(false));
    expect(q.rows).toEqual([]);
    expect(q.tiles.map((t) => t.key)).toEqual(["all"]);
    expect(queueTiles([], { countsWord: "x", visible: { approvals: true, bank: true, pledges: true, counts: true, books: true } }, new Set()).map((t) => t.key)).not.toContain("care");
  });
  it("a read that failed is a problem next to the group, never an empty group", () => {
    const q = buildQueue(input({ state: "error", error: "Could not load DonorDelight: the database said no." }), ctx(true));
    expect(q.rows).toEqual([]);
    expect(q.problems).toEqual([{ group: "care", message: "Could not load DonorDelight: the database said no." }]);
  });
  it("marking a row done takes it out of the tile", () => {
    const q = buildQueue(input({ state: "ok", data: care }), ctx(true));
    const t = queueTiles(q.rows, ctx(true), new Set(["care:sign:a"]));
    expect(t.find((x) => x.key === "care")?.count).toBe(4);
  });
});
