import { describe, expect, it } from "vitest";

import { buildUiRows, enterAction, familyHref, moveActive, NIVA_NO_KEY_TEXT, NIVA_OFF_TEXT, personHref, selectable, understoodLine } from "@/lib/find/rows";
import type { FindFilter, FindResponse, FindRow } from "@/lib/find/types";

const familyRow = (id: string, title: string): FindRow => ({ kind: "family", id, title, cardLine: "No. 0301 · Samira & Karim Hassan · Riverside", why: { code: "name", label: "Name" }, href: familyHref(id), score: 90 });
const personRow = (id: string, title: string, householdId: string | null, child = false): FindRow => ({
  kind: "person",
  id,
  householdId,
  title,
  subtitle: child ? "Child · staff only" : "Spouse",
  familyName: householdId ? "Hassan household" : null,
  cardLine: householdId ? "No. 0301" : null,
  child,
  why: { code: "name", label: "Name" },
  href: personHref(id, householdId),
  score: 80,
});
const filter: FindFilter = { href: "/people?over=10000&said=who%20owes%20more%20than%20%24100%3F", chips: ["Open balance over $100.00"], understood: "Open balance over $100.00" };
const resp = (over: Partial<FindResponse>): FindResponse => ({ query: "sam", kind: "name", rows: [], more: 0, filter: null, problem: null, ...over });

describe("addresses", () => {
  it("a family opens on its page; a person opens their family with their details open, or their own page when in no family", () => {
    expect(familyHref("h1")).toBe("/households/h1");
    expect(familyHref("h1", "p1")).toBe("/households/h1?person=p1");
    expect(personHref("p1", "h1")).toBe("/households/h1?person=p1");
    expect(personHref("p1", null)).toBe("/people/p1");
  });
});

describe("the sentence above the rows", () => {
  it("says what was understood and how many of each", () => {
    expect(understoodLine("name", null, 3, 3)).toBe("a name · 3 families and 3 people");
    expect(understoodLine("phone", null, 0, 1)).toBe("a phone number · 1 person");
    expect(understoodLine("identifier", "payer", 1, 0)).toBe("a name or bank payer name · 1 family");
    expect(understoodLine("question", null, 0, 0)).toBe("a question");
  });
});

describe("buildUiRows", () => {
  it("lists the rows as found, families and people", () => {
    const { rows, understood } = buildUiRows(resp({ rows: [familyRow("h1", "Hassan household"), personRow("p1", "Samira Hassan", "h1")] }), { niva: "off" });
    expect(rows.map((r) => r.type)).toEqual(["family", "person"]);
    expect(understood).toBe("a name · 1 family and 1 person");
  });

  it("a question goes to Niva when Niva is on, with the same words as a list when they can be read", () => {
    const { rows } = buildUiRows(resp({ query: "who owes more than $100?", kind: "question", filter }), { niva: "on" });
    expect(rows.map((r) => r.type)).toEqual(["niva", "filter"]);
    expect(rows[0]).toMatchObject({ type: "niva", text: "who owes more than $100?" });
  });

  it("with Niva off the same words are offered only as a list, and when they cannot be read the box says so plainly", () => {
    const readable = buildUiRows(resp({ query: "who owes more than $100?", kind: "question", filter }), { niva: "off" });
    expect(readable.rows.map((r) => r.type)).toEqual(["filter"]);
    const unreadable = buildUiRows(resp({ query: "how did the gala do?", kind: "question" }), { niva: "off" });
    expect(unreadable.rows).toEqual([{ type: "message", key: "no-niva", text: NIVA_OFF_TEXT, tone: "plain" }]);
    expect(NIVA_OFF_TEXT).toBe("Niva is off; try a name or number.");
  });

  it("with Niva on but no AI key, a question says so instead of offering Niva", () => {
    const { rows } = buildUiRows(resp({ query: "how did the gala do?", kind: "question" }), { niva: "no_key" });
    expect(rows).toEqual([{ type: "message", key: "no-niva", text: NIVA_NO_KEY_TEXT, tone: "plain" }]);
  });

  it("nothing found says so, and offers Niva when Niva is on", () => {
    const off = buildUiRows(resp({ query: "zzz" }), { niva: "off" });
    expect(off.rows).toEqual([{ type: "message", key: "none", text: "No family or person matches “zzz”.", tone: "plain" }]);
    const on = buildUiRows(resp({ query: "zzz" }), { niva: "on" });
    expect(on.rows.map((r) => r.type)).toEqual(["message", "niva"]);
  });

  it("only the typed words are ever handed to Niva: never a row, a family or a child", () => {
    const rows = [familyRow("h1", "Hassan household"), personRow("p2", "Layla Hassan", "h1", true)];
    const { rows: ui } = buildUiRows(resp({ query: "hassan", rows }), { niva: "on" });
    const niva = ui.filter((r) => r.type === "niva");
    expect(niva).toEqual([]); // a result list never adds a Niva row
    const none = buildUiRows(resp({ query: "layla", rows: [] }), { niva: "on" });
    expect(JSON.stringify(none.rows.filter((r) => r.type === "niva"))).toBe(JSON.stringify([{ type: "niva", key: "niva", text: "layla" }]));
  });

  it("a filter sentence shows the list first, then any records for what is left", () => {
    const { rows } = buildUiRows(resp({ query: "life members smith", kind: "filter", filter, rows: [personRow("p1", "Ann Smith", "h1")] }), { niva: "off" });
    expect(rows.map((r) => r.type)).toEqual(["filter", "person"]);
  });

  it("a problem is shown with the rows that did load", () => {
    const { rows } = buildUiRows(resp({ rows: [familyRow("h1", "Hassan household")], problem: "Some matches could not be looked up just now, so this list may be missing a few. Try again." }), { niva: "off" });
    expect(rows.map((r) => r.type)).toEqual(["family", "message"]);
    expect(rows[1]).toMatchObject({ tone: "problem" });
  });

  it("says when more matched than are shown, and adds the palette row only when it exists", () => {
    const { rows } = buildUiRows(resp({ rows: [familyRow("h1", "Hassan household")], more: 4 }), { niva: "on", withPalette: true });
    expect(rows.map((r) => r.type)).toEqual(["family", "message", "palette"]);
    expect(buildUiRows(resp({ rows: [familyRow("h1", "H")] }), { niva: "off", withPalette: true }).rows.map((r) => r.type)).toEqual(["family"]);
  });
});

describe("keys", () => {
  const rows = buildUiRows(resp({ rows: [familyRow("h1", "Hassan household"), personRow("p1", "Samira Hassan", "h1"), personRow("p2", "Omar Hassan", "h1", true)], more: 2 }), { niva: "on" }).rows;

  it("the arrow keys move through the rows that can be chosen and wrap round", () => {
    expect(selectable(rows)).toHaveLength(3);
    expect(moveActive(-1, 3, "ArrowDown")).toBe(0);
    expect(moveActive(0, 3, "ArrowDown")).toBe(1);
    expect(moveActive(2, 3, "ArrowDown")).toBe(0);
    expect(moveActive(0, 3, "ArrowUp")).toBe(2);
    expect(moveActive(-1, 3, "ArrowUp")).toBe(2);
    expect(moveActive(0, 0, "ArrowDown")).toBe(-1);
  });

  it("Enter opens the family of the highlighted row (the first when none is)", () => {
    expect(enterAction(rows, 0)).toEqual({ type: "open", href: "/households/h1", familyId: "h1" });
    expect(enterAction(rows, -1)).toEqual({ type: "open", href: "/households/h1", familyId: "h1" });
    expect(enterAction(rows, 1)).toEqual({ type: "open", href: "/households/h1?person=p1", familyId: "h1" });
    expect(enterAction(rows, 2)).toEqual({ type: "open", href: "/households/h1?person=p2", familyId: "h1" });
  });

  it("Enter on a question asks Niva; Shift+Enter asks Niva with the typed words when it is on, and does nothing when it is off", () => {
    const q = buildUiRows(resp({ query: "who owes more than $100?", kind: "question", filter }), { niva: "on" }).rows;
    expect(enterAction(q, 0)).toEqual({ type: "niva", text: "who owes more than $100?" });
    expect(enterAction(q, 1)).toEqual({ type: "open", href: filter.href, familyId: null });
    expect(enterAction(rows, 0, { shift: true, niva: "on", typed: "sam" })).toEqual({ type: "niva", text: "sam" });
    expect(enterAction(rows, 0, { shift: true, niva: "off", typed: "sam" })).toEqual({ type: "none" });
  });

  it("Enter with nothing to choose does nothing", () => {
    expect(enterAction([], 0)).toEqual({ type: "none" });
    expect(enterAction(buildUiRows(resp({ query: "zzz" }), { niva: "off" }).rows, 0)).toEqual({ type: "none" });
  });
});
