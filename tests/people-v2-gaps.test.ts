import { describe, expect, it } from "vitest";

import { communityFormat } from "@/lib/community-format";
import { classifyInput, readsAsFilter } from "@/lib/find/classify";
import { filterFor } from "@/lib/find/search";
import { tierLabel } from "@/lib/people";
import {
  chipsFor,
  countText,
  effectiveBand,
  filtersForNiva,
  filtersFromParams,
  hasFilters,
  hasGap,
  listFor,
  listHeading,
  NO_FILTERS,
  paramsFromFilters,
  readAsk,
  showText,
  type HouseholdFilters,
  type Zone,
} from "@/lib/people-v2/ask";
import { filterHouseholds, type BaseHousehold } from "@/lib/people-v2/list";

// Contact-gap filters: "adults with no email" is read by rules (no model), becomes chips, a list of PEOPLE, and a count. Neutral
// communities of any kind: the areas are the community's own, and names come in several scripts.

const ZONES: Zone[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "North Riverside" },
  { id: "22222222-2222-4222-8222-222222222222", name: "São Paulo Norte" },
];
const vocab = { zones: ZONES, year: 2026 };
const ctx = { zones: ZONES, fmt: communityFormat({ currency: "EUR", country: "DE" }), tierLabel };
const read = (s: string) => readAsk(s, vocab).filters;
const labels = (f: HouseholdFilters) => chipsFor(f, ctx).map((c) => c.label);

describe("reading the contact gaps", () => {
  it("reads 'adults with no email' as the gap and the band, with nothing left to search", () => {
    const r = readAsk("adults with no email", vocab);
    expect(r.understood).toBe(true);
    expect(r.filters).toEqual({ ...NO_FILTERS, noEmail: true, band: "adults" });
    expect(labels(r.filters)).toEqual(["Adults only", "No email on file"]);
  });

  it.each([
    ["people with no email", "noEmail"],
    ["without an email address", "noEmail"],
    ["missing email", "noEmail"],
    ["who don't have an email", "noEmail"],
    ["no e-mail on file", "noEmail"],
    ["no mobile", "noMobile"],
    ["without a cell phone", "noMobile"],
    ["who have no phone number", "noMobile"],
    ["no mailing address", "noAddress"],
    ["missing address on file", "noAddress"],
    ["not on the app", "notOnApp"],
    ["who are not on the app", "notOnApp"],
    ["no app account", "notOnApp"],
    ["who never signed in to the app", "notOnApp"],
  ] as const)("reads %s as %s and nothing else", (sentence, key) => {
    const f = read(sentence);
    expect(f[key]).toBe(true);
    expect(f.q).toBeNull();
    expect(Object.entries(f).filter(([k, v]) => v !== null && k !== key && k !== "band")).toEqual([]);
  });

  it("reads several gaps in one sentence, and seniors as the band", () => {
    expect(read("adults with no email and no mobile")).toMatchObject({ noEmail: true, noMobile: true, band: "adults", q: null });
    expect(read("seniors with no mobile that are not on the app")).toMatchObject({ noMobile: true, notOnApp: true, band: "seniors", q: null });
    expect(read("adults with no email, no mobile and no address")).toMatchObject({ noEmail: true, noMobile: true, noAddress: true });
  });

  it("keeps the community's own area and a name that is left, in any script", () => {
    expect(read("adults with no email in São Paulo Norte")).toMatchObject({ noEmail: true, zone: ZONES[1].id, q: null });
    expect(read("no email 田中")).toMatchObject({ noEmail: true, q: "田中" });
    expect(read("no mobile Фёдоров")).toMatchObject({ noMobile: true, q: "Фёдоров" });
  });

  it("does not take a plain name, or a word inside a name, for a gap or a band", () => {
    expect(read("Lena Brandt")).toEqual({ ...NO_FILTERS, q: "Lena Brandt" });
    expect(read("Emailova Phones")).toMatchObject({ noEmail: null, noMobile: null });
    expect(read("Adultsson")).toMatchObject({ band: null });
    // A list of children is never offered by words.
    expect(read("children with no email").band).toBeNull();
    expect(read("under 18 with no email").band).toBeNull();
  });

  it("does not disturb the filters it already read", () => {
    const f = read("households in North Riverside with an open balance over 100 that have not RSVP'd this year");
    expect(f).toEqual({ ...NO_FILTERS, zone: ZONES[0].id, overCents: 10000, noRsvpYear: 2026 });
  });
});

describe("the contact-gap chips, the address and the rule that a gap list is adults", () => {
  it("makes 'Adults only' a chip that cannot be removed when a gap is asked and no band was", () => {
    const chips = chipsFor({ ...NO_FILTERS, noEmail: true }, ctx);
    expect(chips).toEqual([
      { key: "band", label: "Adults only", fixed: true },
      { key: "noEmail", label: "No email on file" },
    ]);
  });

  it("shows an asked band as a chip that can be removed", () => {
    const chips = chipsFor({ ...NO_FILTERS, noMobile: true, band: "seniors" }, ctx);
    expect(chips[0]).toEqual({ key: "band", label: "Seniors 65+" });
    expect(chipsFor({ ...NO_FILTERS, band: "minors" }, ctx)).toEqual([{ key: "band", label: "Under 18" }]);
  });

  it("makes a gap list adults even when the address asks for under 18 or everyone", () => {
    expect(effectiveBand({ ...NO_FILTERS, noEmail: true, band: "minors" })).toBe("adults");
    expect(effectiveBand({ ...NO_FILTERS, noEmail: true, band: null })).toBe("adults");
    expect(effectiveBand({ ...NO_FILTERS, noEmail: true, band: "seniors" })).toBe("seniors");
    expect(effectiveBand({ ...NO_FILTERS, noEmail: true, band: "roles" })).toBe("roles");
    expect(effectiveBand({ ...NO_FILTERS, band: "minors" })).toBe("minors");
    expect(effectiveBand(NO_FILTERS)).toBe("all");
    expect(chipsFor({ ...NO_FILTERS, noEmail: true, band: "minors" }, ctx)[0]).toEqual({ key: "band", label: "Adults only", fixed: true });
  });

  it("round-trips through the address, and ignores what is malformed", () => {
    const f: HouseholdFilters = { ...NO_FILTERS, noEmail: true, noMobile: true, noAddress: true, notOnApp: true, band: "seniors", zone: ZONES[0].id };
    const params = paramsFromFilters(f);
    expect(params).toMatchObject({ noemail: "1", nomobile: "1", noaddress: "1", noapp: "1", band: "seniors", zone: ZONES[0].id });
    expect(filtersFromParams(params)).toEqual(f);
    expect(filtersFromParams({ noemail: "yes", nomobile: "true", band: "all" })).toEqual(NO_FILTERS);
    expect(filtersFromParams({ band: "teenagers" }).band).toBeNull();
    expect(filtersFromParams({ band: "minors" }).band).toBe("minors");
    expect(hasFilters(f)).toBe(true);
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it("opens a list of people when only person-level filters are asked, else the families", () => {
    expect(listFor({ ...NO_FILTERS, noEmail: true })).toBe("people");
    expect(listFor({ ...NO_FILTERS, band: "seniors" })).toBe("people");
    expect(listFor({ ...NO_FILTERS, noEmail: true, zone: ZONES[0].id })).toBe("people");
    expect(listFor({ ...NO_FILTERS, noEmail: true, overCents: 0 })).toBe("households");
    expect(listFor({ ...NO_FILTERS, tier: "life", band: "adults" })).toBe("households");
    expect(listFor(NO_FILTERS)).toBe("households");
    expect(hasGap({ ...NO_FILTERS, band: "adults" })).toBe(false);
  });

  it("says what the list is, and counts it ('Show 42 adults with no email')", () => {
    const f = read("adults with no email");
    expect(listHeading(f)).toBe("Adults with no email");
    expect(showText(f, 42)).toBe("Show 42 adults with no email");
    expect(showText(f, 1)).toBe("Show 1 adult with no email");
    expect(showText(f, null)).toBe("Show adults with no email");
    expect(countText(f, 6)).toBe("6 adults");
    expect(countText(f, 1)).toBe("1 adult");
    expect(listHeading(read("seniors with no mobile who are not on the app"))).toBe("Seniors with no mobile who are not on the app");
    expect(listHeading(read("adults with no email, no mobile and no address"))).toBe("Adults with no email, no mobile and no address");
    expect(listHeading(read("not on the app"))).toBe("Adults not on the app");
    expect(showText({ ...NO_FILTERS, overCents: 0 }, 3)).toBeNull();
    expect(listHeading(NO_FILTERS)).toBeNull();
    expect(countText({ ...NO_FILTERS, noEmail: true }, 1234, "de-DE")).toBe("1.234 adults");
  });

  it("puts nothing about a person in the words sent to Niva", () => {
    const f = { ...read("adults with no email"), q: "Zoya Shah" };
    const sentence = filtersForNiva(f, ctx);
    expect(sentence).toBe("adults only, no email on file, matching a search typed on the screen");
    expect(sentence).not.toContain("Zoya");
  });
});

describe("the find box and the gap filters", () => {
  it("reads 'adults with no email' as a filter (two words or more), and a single word as a name", () => {
    expect(classifyInput("adults with no email", vocab).kind).toBe("filter");
    expect(classifyInput("no email", vocab).kind).toBe("filter");
    expect(classifyInput("adults", vocab).kind).toBe("name");
    expect(readsAsFilter("seniors not on the app", vocab)).not.toBeNull();
    expect(readsAsFilter("Samira Hassan", vocab)).toBeNull();
  });

  it("offers the sentence as a list of adults, in the People list, with its own row text", () => {
    const f = filterFor("adults with no email", vocab, ctx.fmt);
    expect(f).not.toBeNull();
    expect(f?.list).toBe("people");
    expect(f?.label).toBe("Show adults with no email");
    expect(f?.href).toContain("view=people");
    expect(f?.href).toContain("noemail=1");
    expect(f?.href).toContain("band=adults");
    expect(f?.chips).toEqual(["Adults only", "No email on file"]);
  });

  it("keeps a question that is also a filter a list of adults", () => {
    const f = filterFor("show adults with no email", vocab, ctx.fmt);
    expect(f?.list).toBe("people");
    expect(classifyInput("show adults with no email", vocab).kind).toBe("question");
  });

  it("leaves the families filters as they were (no 'people' list, no label)", () => {
    const f = filterFor("households with an open balance over 100", vocab, ctx.fmt);
    expect(f?.list).toBeUndefined();
    expect(f?.label).toBeUndefined();
    expect(f?.href).not.toContain("view=people");
  });
});

describe("a gap on the list of families", () => {
  const rows: BaseHousehold[] = [
    { id: "h1", name: "Okafor household", number: "0101", zoneId: null, city: null, tiers: [] },
    { id: "h2", name: "Nakamura household", number: "0102", zoneId: null, city: null, tiers: [] },
  ];
  const sets = { searchIds: null, balances: null, rsvpd: null, ending: null };

  it("keeps the families that have an adult with the gap, and all of them when that could not be read", () => {
    expect(filterHouseholds(rows, { ...NO_FILTERS, noEmail: true }, { ...sets, gap: new Set(["h2"]) }).map((h) => h.id)).toEqual(["h2"]);
    expect(filterHouseholds(rows, { ...NO_FILTERS, noEmail: true }, { ...sets, gap: null }).map((h) => h.id)).toEqual(["h1", "h2"]);
    expect(filterHouseholds(rows, NO_FILTERS, { ...sets, gap: new Set(["h2"]) }).map((h) => h.id)).toEqual(["h1", "h2"]);
  });
});
