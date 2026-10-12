import { describe, expect, it } from "vitest";

import { filtersFromParams, NO_FILTERS, paramsFromFilters, readAsk } from "@/lib/people-v2/ask";
import {
  cleanViewName,
  inOrder,
  limitProblem,
  MAX_NAME,
  MAX_PINS,
  MAX_VIEWS,
  nextPosition,
  sameViewName,
  suggestedViewName,
  viewFilters,
  viewHref,
  viewParams,
  viewToSave,
  type SavedViewRow,
} from "@/lib/people-v2/saved-views";

// A person's own saved views: what is kept, how it is cleaned, how it opens again, and the limits (the database holds the same numbers:
// migration 0722). Names come in many scripts, and a typed search is never kept.

const row = (over: Partial<SavedViewRow>): SavedViewRow => ({ id: "v1", name: "Adults with no email", list: "people", params: { noemail: "1", band: "adults" }, sort: null, position: 0, createdAt: "2026-10-12T10:00:00Z", ...over });

describe("a view's name", () => {
  it("is trimmed, on one line, with single spaces", () => {
    expect(cleanViewName("  Adults   with\tno email \n")).toEqual({ ok: true, name: "Adults with no email" });
    expect(cleanViewName("a\u0000b\u007fc")).toEqual({ ok: true, name: "a b c" });
  });

  it("is 1 to 60 characters, counted as people see them, in any script", () => {
    expect(cleanViewName("名".repeat(MAX_NAME))).toEqual({ ok: true, name: "名".repeat(MAX_NAME) });
    expect(cleanViewName("名".repeat(MAX_NAME + 1))).toMatchObject({ ok: false });
    expect(cleanViewName("🙂".repeat(MAX_NAME))).toMatchObject({ ok: true });
    expect(cleanViewName("🙂".repeat(MAX_NAME + 1))).toMatchObject({ ok: false });
    expect(cleanViewName("x".repeat(MAX_NAME))).toMatchObject({ ok: true });
  });

  it("says in words what is wrong", () => {
    expect(cleanViewName("   ")).toEqual({ ok: false, error: "Give the view a name first." });
    expect(cleanViewName(undefined)).toEqual({ ok: false, error: "Give the view a name first." });
    expect(cleanViewName(42)).toMatchObject({ ok: false });
    expect(cleanViewName("x".repeat(61))).toEqual({ ok: false, error: "Use 60 characters or fewer for the name." });
  });

  it("is the same name in any case, with or without accents, in any script", () => {
    expect(sameViewName("Adults with no email", "ADULTS WITH NO EMAIL")).toBe(true);
    expect(sameViewName("Sénior", "senior")).toBe(true);
    expect(sameViewName("Москва", "москва")).toBe(true);
    expect(sameViewName("名簿", "名簿")).toBe(true);
    expect(sameViewName("Adults", "Seniors")).toBe(false);
    expect(sameViewName("", "")).toBe(false);
  });
});

describe("what a view keeps", () => {
  it("keeps the filters as address values, and never a typed search", () => {
    const filters = { ...readAsk("adults with no email in Riverside Zoya Shah", { zones: [{ id: "11111111-1111-4111-8111-111111111111", name: "Riverside" }], year: 2026 }).filters };
    expect(filters.q).toBe("Zoya Shah");
    const params = viewParams(filters);
    expect(params).toEqual({ noemail: "1", band: "adults", zone: "11111111-1111-4111-8111-111111111111" });
    expect(JSON.stringify(params)).not.toContain("Zoya");
  });

  it("checks what came from the browser: the list, the filters and the sort", () => {
    const ok = viewToSave({ name: " No mobile ", list: "people", params: { nomobile: "1", band: "seniors", q: "Priya", bogus: "x", noemail: "yes" }, sort: "area" });
    expect(ok).toEqual({ ok: true, view: { name: "No mobile", list: "people", params: { nomobile: "1", band: "seniors" }, sort: "area" } });
    expect(viewToSave({ name: "x", list: "reviews", params: { noemail: "1" }, sort: null })).toEqual({ ok: false, error: "That list cannot be saved as a view." });
    expect(viewToSave({ name: "x", list: "people", params: {}, sort: null })).toMatchObject({ ok: false });
    expect(viewToSave({ name: "x", list: "people", params: { q: "only a search" }, sort: null })).toEqual({ ok: false, error: "There is no filter to save yet. Add a filter to the list, then save it." });
    expect(viewToSave({ name: "x", list: "people", params: "nope", sort: null })).toMatchObject({ ok: false });
    expect(viewToSave({ name: "x", list: "households", params: ["a"], sort: null })).toMatchObject({ ok: false });
    expect(viewToSave({ name: "", list: "households", params: { ending: "60" }, sort: null })).toEqual({ ok: false, error: "Give the view a name first." });
  });

  it("keeps a sort only when it is a real one other than the default", () => {
    const base = { name: "n", list: "households", params: { ending: "60" } };
    expect(viewToSave({ ...base, sort: "open" })).toMatchObject({ ok: true, view: { sort: "open" } });
    expect(viewToSave({ ...base, sort: "name" })).toMatchObject({ ok: true, view: { sort: null } });
    expect(viewToSave({ ...base, sort: "drop table" })).toMatchObject({ ok: true, view: { sort: null } });
    expect(viewToSave({ ...base, sort: 5 })).toMatchObject({ ok: true, view: { sort: null } });
  });

  it("ignores a value too long to be a filter", () => {
    const r = viewToSave({ name: "n", list: "people", params: { nomobile: "1", zone: "z".repeat(500) }, sort: null });
    expect(r).toMatchObject({ ok: true, view: { params: { nomobile: "1" } } });
  });
});

describe("opening a saved view", () => {
  it("opens the same list with its filters in the address, so each is a chip", () => {
    expect(viewHref(row({}))).toBe("/people?noemail=1&band=adults&view=people");
    expect(viewHref(row({ list: "households", params: { ending: "60", tier: "life" }, sort: "open" }))).toBe("/people?tier=life&ending=60&view=households&sort=open");
    expect(viewHref(row({ list: "households", params: { ending: "60" }, sort: "name" }))).toBe("/people?ending=60&view=households");
  });

  it("reads the stored filters the way the page reads an address: what is malformed or no longer valid is dropped", () => {
    expect(viewFilters(row({ params: { noemail: "1", band: "teenagers", zone: "not-a-uuid", over: "abc", q: "Zoya" } }))).toEqual({ ...NO_FILTERS, noEmail: true });
    expect(viewHref(row({ params: { q: "Zoya", noemail: "1" } }))).not.toContain("Zoya");
    expect(viewHref(row({ list: "bogus" as never }))).toContain("view=households");
  });

  it("round-trips: what the list had is what the view opens", () => {
    const filters = { ...NO_FILTERS, noEmail: true, notOnApp: true, band: "seniors" as const, zone: "11111111-1111-4111-8111-111111111111" };
    const saved = viewToSave({ name: "Seniors off the app", list: "people", params: paramsFromFilters(filters), sort: null });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const stored = row({ ...saved.view, id: "v2", position: 0, createdAt: "x" });
    expect(viewFilters(stored)).toEqual(filtersFromParams(paramsFromFilters(filters)));
    expect(viewFilters(stored)).toEqual(filters);
  });
});

describe("a suggested name", () => {
  it("is the list's heading, else its chips in words, always a valid name", () => {
    expect(suggestedViewName({ ...NO_FILTERS, noEmail: true }, [])).toBe("Adults with no email");
    expect(suggestedViewName({ ...NO_FILTERS, endingDays: 60 }, ["Membership ends within 60 days"])).toBe("Membership ends within 60 days");
    expect(suggestedViewName(NO_FILTERS, [])).toBe("My view");
    const long = suggestedViewName({ ...NO_FILTERS, endingDays: 60 }, ["x".repeat(80)]);
    expect([...long].length).toBeLessThanOrEqual(MAX_NAME);
    expect(cleanViewName(long).ok).toBe(true);
  });
});

describe("order and limits", () => {
  it("shows views and pins by position, then by when they were made, then by id, the same every time", () => {
    const a = { id: "b", position: 1, createdAt: "2026-10-12T10:00:00Z" };
    const b = { id: "a", position: 1, createdAt: "2026-10-12T10:00:00Z" };
    const c = { id: "c", position: 0, createdAt: "2026-10-13T10:00:00Z" };
    const d = { id: "d", position: 1, createdAt: "2026-10-11T10:00:00Z" };
    expect(inOrder([a, b, c, d]).map((x) => x.id)).toEqual(["c", "d", "a", "b"]);
    expect(inOrder([d, c, b, a]).map((x) => x.id)).toEqual(["c", "d", "a", "b"]);
  });

  it("puts a new one last", () => {
    expect(nextPosition([])).toBe(0);
    expect(nextPosition([{ position: 0 }, { position: 4 }, { position: 2 }])).toBe(5);
  });

  it("holds the same limits as the database", () => {
    expect(MAX_VIEWS).toBe(30);
    expect(MAX_PINS).toBe(40);
    expect(limitProblem("view", MAX_VIEWS - 1)).toBeNull();
    expect(limitProblem("view", MAX_VIEWS)).toBe("You can keep up to 30 saved views. Delete one you no longer use, then save this one.");
    expect(limitProblem("pin", MAX_PINS - 1)).toBeNull();
    expect(limitProblem("pin", MAX_PINS)).toBe("You can pin up to 40 families. Unpin one you no longer need, then pin this one.");
  });
});
