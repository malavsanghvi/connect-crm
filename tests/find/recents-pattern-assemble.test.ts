import { describe, expect, it } from "vitest";

import { householdIdsNeeded, toFindRows, CHILD_SUBTITLE } from "@/lib/find/assemble";
import { isChildRecord } from "@/lib/find/child";
import { peopleHomeRequested } from "@/lib/find/home";
import { householdCardLine, idLabel } from "@/lib/find/labels";
import { accentPattern, hitKindVisible, nameColumnFilter, personNameFilter, typedWords } from "@/lib/find/pattern";
import type { RankedItem } from "@/lib/find/rank";
import { familyIdFromPath, parseRecents, pushRecent, recentCookieName, serializeRecents, RECENT_LIMIT } from "@/lib/find/recents";
import type { HouseholdCard } from "@/lib/commands/types";

import { FAMILIES, PEOPLE, RULES } from "./fixtures";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("recent families", () => {
  it("keeps the newest first, no repeats, at most ten", () => {
    let list: string[] = [];
    for (let n = 1; n <= 12; n += 1) list = pushRecent(list, id(n));
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]).toBe(id(12));
    expect(list).not.toContain(id(1));
    expect(pushRecent(list, id(5))[0]).toBe(id(5));
    expect(pushRecent(list, id(5))).toHaveLength(RECENT_LIMIT);
  });

  it("reads only well-formed ids from a cookie, without repeats, at most ten", () => {
    const value = [id(1), "not-an-id", id(1), id(2).toUpperCase(), "", ...Array.from({ length: 20 }, (_, n) => id(100 + n))].join(",");
    const ids = parseRecents(value);
    expect(ids.slice(0, 2)).toEqual([id(1), id(2)]);
    expect(ids).toHaveLength(RECENT_LIMIT);
    expect(parseRecents(null)).toEqual([]);
    expect(parseRecents(serializeRecents([id(3), id(4)]))).toEqual([id(3), id(4)]);
    expect(pushRecent([], "nonsense")).toEqual([]);
  });

  it("names the cookie for the person and the community, so two people on one browser never share a list", () => {
    const a = recentCookieName("11111111-aaaa-4000-8000-000000000001", "cccccccc-0000-4000-8000-000000000001");
    const b = recentCookieName("22222222-aaaa-4000-8000-000000000001", "cccccccc-0000-4000-8000-000000000001");
    const c = recentCookieName("11111111-aaaa-4000-8000-000000000001", "dddddddd-0000-4000-8000-000000000001");
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toMatch(/^weaver_rf_[a-z0-9]+_[a-z0-9]+$/);
  });

  it("recognises a family page and nothing else", () => {
    expect(familyIdFromPath(`/households/${id(7)}`)).toBe(id(7));
    expect(familyIdFromPath(`/households/${id(7)}/`)).toBe(id(7));
    expect(familyIdFromPath(`/households/${id(7)}/edit`)).toBeNull();
    expect(familyIdFromPath("/households")).toBeNull();
    expect(familyIdFromPath("/people")).toBeNull();
  });
});

describe("the database net", () => {
  it("widens a typed Latin word to its accented forms and leaves other scripts as typed", () => {
    expect(accentPattern("sofia")).toContain("[iì");
    expect(accentPattern("Sofía")).toBe(accentPattern("sofia"));
    expect(accentPattern("田中")).toBe("田中");
    expect(accentPattern("निकुंज")).toBe("निकुंज");
  });

  it("never passes on a character that means something in a pattern or a filter", () => {
    expect(typedWords('a.b, (c) "d" e*f %g')).toEqual(["a", "b", "c", "d"]); // four words at most
    expect(typedWords("one two three four five six")).toHaveLength(4);
    const f = personNameFilter("Sam, (x)")!;
    expect(f).not.toContain("(x)");
    expect(f).toMatch(/^and\(or\(/); // two words: "sam" and "x"
  });

  it("builds the or() text for one word and for several", () => {
    expect(personNameFilter("sam")).toMatch(/^first_name\.imatch\..*,last_name\.imatch\..*,preferred_name\.imatch\./);
    expect(personNameFilter("sam nakamura")).toMatch(/^and\(or\(first_name\.imatch\..*\),or\(first_name\.imatch\./);
    expect(personNameFilter("   ")).toBeNull();
    expect(nameColumnFilter("hassan", "display_name")).toMatch(/^display_name\.imatch\./);
    expect(nameColumnFilter("b m", "display_name")).toBe("and(display_name.imatch.b,display_name.imatch.m)");
  });

  it("finance identifiers are visible only to finance readers", () => {
    for (const kind of ["accounting", "bank_payer", "payment_provider"]) {
      expect(hitKindVisible(kind, false), kind).toBe(false);
      expect(hitKindVisible(kind, true), kind).toBe(true);
    }
    for (const kind of ["connect_member", "connect_household", "org_member", "org_household", "crm", "other"]) expect(hitKindVisible(kind, false), kind).toBe(true);
  });
});

const card = (over: Partial<HouseholdCard> = {}): HouseholdCard => ({
  household_id: "h-hassan",
  household_name: "Hassan household",
  household_number: "0301",
  org_household_id: "RCC-H-1102",
  adults: ["Samira Hassan", "Karim Hassan"],
  primary_adult: "Samira Hassan",
  zone: "North Riverside",
  city: "Riverside",
  last_gift_on: null,
  open_pledge_cents: null,
  open_pledge: null,
  ...over,
});

describe("the card line and the rows", () => {
  it("shows the number, the organization's own ID, the adults, the city and the area, never a name alone", () => {
    expect(householdCardLine(card())).toBe("No. 0301 · RCC-H-1102 · Samira Hassan & Karim Hassan · Riverside · North Riverside");
    expect(householdCardLine(card({ household_number: null, org_household_id: null, adults: [], city: null, zone: null }))).toBe("No household number");
    expect(householdCardLine(card({ adults: ["A", "B", "C", "D", "E"] }))).toContain("A & B & C +2");
    expect(householdCardLine(card({ zone: "Riverside" }))).not.toMatch(/Riverside · Riverside/);
  });

  it("labels identifiers in the organization's words", () => {
    expect(idLabel({ kind: "org_household", system: "x" }, RULES)).toBe("Household ID");
    expect(idLabel({ kind: "connect_household", system: "connect" }, RULES)).toBe("Household no.");
  });

  const items: RankedItem[] = [
    { kind: "family", scored: { item: FAMILIES.hassan, score: 90, why: { code: "name", label: "Name" } } },
    { kind: "person", scored: { item: PEOPLE.layla, score: 70, why: { code: "name", label: "Name" } } },
    { kind: "person", scored: { item: PEOPLE.ana, score: 60, why: { code: "email", label: "Email ana@lopezbakery.example" } } },
    { kind: "family", scored: { item: FAMILIES.nakamura, score: 50, why: { code: "name", label: "Name" } } },
  ];

  it("needs a card for each family and each person's family", () => {
    expect(householdIdsNeeded(items).sort()).toEqual(["h-hassan", "h-lopez", "h-nakamura"]);
  });

  it("draws a family only with its card; a family whose card cannot be read is left out, never shown as a name alone", () => {
    const rows = toFindRows(items, new Map([["h-hassan", card()]]));
    expect(rows.filter((r) => r.kind === "family").map((r) => r.id)).toEqual(["h-hassan"]);
    expect(rows[0]).toMatchObject({ kind: "family", title: "Hassan household", href: "/households/h-hassan" });
    expect((rows[0] as { cardLine: string }).cardLine).toContain("No. 0301");
  });

  it("a child is a 'Child · staff only' row that opens the family with their details; the card line names adults only", () => {
    const rows = toFindRows(items, new Map([["h-hassan", card()]]));
    const child = rows.find((r) => r.kind === "person" && r.id === "p-layla");
    expect(child).toMatchObject({ kind: "person", subtitle: CHILD_SUBTITLE, child: true, href: "/households/h-hassan?person=p-layla" });
    // The card line lists the adults of the family, never the child.
    expect((child as { cardLine: string }).cardLine).not.toContain("Layla");
  });

  it("a person in no family opens on their own page", () => {
    const loner: RankedItem[] = [{ kind: "person", scored: { item: { ...PEOPLE.ana, householdId: null, relationship: null }, score: 50, why: { code: "name", label: "Name" } } }];
    expect(toFindRows(loner, new Map())[0]).toMatchObject({ href: "/people/p-ana", subtitle: "Not in a family", cardLine: null });
  });
});

describe("who is a child, and which address is the home", () => {
  it("is a child under the community's age of majority by birth date, never under 18; with no birth date only a recorded child", () => {
    expect(isChildRecord("2015-06-01", "primary", "2026-10-12", 18)).toBe(true);
    expect(isChildRecord("2008-10-13", null, "2026-10-12", 18)).toBe(true);
    expect(isChildRecord("2008-10-12", null, "2026-10-12", 18)).toBe(false);
    expect(isChildRecord("2007-01-01", null, "2026-10-12", 21)).toBe(true);
    expect(isChildRecord("2005-01-01", null, "2026-10-12", 10)).toBe(false); // 18 is the floor
    expect(isChildRecord(null, "child", "2026-10-12")).toBe(true);
    expect(isChildRecord(null, null, "2026-10-12")).toBe(false);
    expect(isChildRecord(null, "spouse", "2026-10-12")).toBe(false);
  });

  it("/people is the home with no list address, and a list with any", () => {
    expect(peopleHomeRequested({})).toBe(true);
    expect(peopleHomeRequested({ foo: "x" })).toBe(true);
    for (const key of ["q", "zone", "tier", "over", "norsvp", "ending", "view", "sort", "said", "band", "page", "hh", "ask"]) {
      expect(peopleHomeRequested({ [key]: "1" }), key).toBe(false);
    }
    expect(peopleHomeRequested({ q: "  " })).toBe(true);
    expect(peopleHomeRequested({ view: ["people"] })).toBe(false);
  });
});
