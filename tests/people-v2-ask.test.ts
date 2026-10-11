import { describe, expect, it } from "vitest";

import { communityFormat } from "@/lib/community-format";
import { tierLabel } from "@/lib/people";
import { chipsFor, filtersForNiva, filtersFromParams, hasFilters, NO_FILTERS, paramsFromFilters, readAsk, type Zone } from "@/lib/people-v2/ask";
import { filterHouseholds, openTotal, pageOf, showingText, sortHouseholds, sortKey, type BaseHousehold } from "@/lib/people-v2/list";

// The People workspace's ask box is read by rules on the page (no model). Organizations of every kind: a neighbourhood
// association with areas in several languages, a chamber in rupees, a club in pounds.

const ZONES: Zone[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "North Riverside" },
  { id: "22222222-2222-4222-8222-222222222222", name: "São Paulo Norte" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Old Town" },
  { id: "44444444-4444-4444-8444-444444444444", name: "Town" },
];
const vocab = { zones: ZONES, year: 2026 };
const usd = communityFormat({ currency: "USD", country: "US" });
const ctx = { zones: ZONES, fmt: usd, tierLabel };

describe("reading a sentence into filters", () => {
  it("reads the board's sentence into an area, a balance and no RSVP this year, with nothing left to search", () => {
    const r = readAsk("Households in North Riverside with an open balance over $100 that have not RSVP’d this year", vocab);
    expect(r.understood).toBe(true);
    expect(r.filters).toEqual({ ...NO_FILTERS, zone: ZONES[0].id, overCents: 10000, noRsvpYear: 2026 });
    expect(chipsFor(r.filters, ctx).map((c) => c.label)).toEqual(["Area is North Riverside", "Open balance over $100.00", "No RSVP in 2026"]);
  });

  it("reads amounts in any currency symbol, words for comparing, and a balance with no amount", () => {
    expect(readAsk("families who owe more than ₹2,500", vocab).filters.overCents).toBe(250000);
    expect(readAsk("over £50.50 outstanding", vocab).filters.overCents).toBe(5050);
    expect(readAsk("balance of at least 100", vocab).filters.overCents).toBe(9999);
    expect(chipsFor({ ...NO_FILTERS, overCents: 9999 }, ctx)[0].label).toBe("Open balance of at least $100.00");
    expect(readAsk("anyone with an open balance", vocab).filters).toEqual({ ...NO_FILTERS, overCents: 0 });
    expect(chipsFor({ ...NO_FILTERS, overCents: 0 }, ctx)[0].label).toBe("Has an open balance");
    // "moreover" is not "over".
    expect(readAsk("moreover 100", vocab).filters.overCents).toBeNull();
  });

  it("reads RSVP years: this year, last year, a given year", () => {
    expect(readAsk("no RSVP in 2025", vocab).filters.noRsvpYear).toBe(2025);
    expect(readAsk("households that haven't responded last year", vocab).filters.noRsvpYear).toBe(2025);
    expect(readAsk("never RSVPed", vocab).filters.noRsvpYear).toBe(2026);
  });

  it("reads memberships ending and tiers", () => {
    expect(readAsk("memberships ending soon", vocab).filters.endingDays).toBe(60);
    expect(readAsk("membership expiring within 30 days", vocab).filters.endingDays).toBe(30);
    expect(readAsk("up for renewal", vocab).filters.endingDays).toBe(60);
    expect(readAsk("life members in Old Town", vocab).filters).toMatchObject({ tier: "life", zone: ZONES[2].id, q: null });
    expect(readAsk("on an annual membership", vocab).filters.tier).toBe("yearly");
    // "community members" is everyday wording, not the community tier.
    expect(readAsk("community members", vocab).filters.tier).toBeNull();
  });

  it("matches the longest area name, accents included, and never a part of a word", () => {
    expect(readAsk("in Old Town", vocab).filters.zone).toBe(ZONES[2].id);
    expect(readAsk("em são paulo norte", vocab).filters.zone).toBe(ZONES[1].id);
    expect(readAsk("Townsend", vocab).filters).toMatchObject({ zone: null, q: "Townsend" });
  });

  it("turns what is left into a search by name or any identifier", () => {
    expect(readAsk("Okafor", vocab).filters).toEqual({ ...NO_FILTERS, q: "Okafor" });
    expect(readAsk("find member number 1042", vocab).filters.q).toBe("1042");
    expect(readAsk("bank payer ANA LOPEZ", vocab).filters.q).toBe("ANA LOPEZ");
    expect(readAsk("RNA-H-2041", vocab).filters.q).toBe("RNA-H-2041");
    expect(readAsk("Nguyen household in North Riverside", vocab).filters).toMatchObject({ q: "Nguyen", zone: ZONES[0].id });
  });

  it("says when nothing could be read", () => {
    expect(readAsk("show me all the households", vocab)).toEqual({ filters: NO_FILTERS, understood: false });
    expect(readAsk("", vocab).understood).toBe(false);
  });
});

describe("filters in the address", () => {
  it("round-trips and ignores anything malformed", () => {
    const f = { ...NO_FILTERS, zone: ZONES[0].id, tier: "life" as const, overCents: 10000, noRsvpYear: 2026, endingDays: 60, q: "Okafor" };
    const p = paramsFromFilters(f);
    expect(p).toEqual({ zone: ZONES[0].id, tier: "life", over: "10000", norsvp: "2026", ending: "60", q: "Okafor" });
    expect(filtersFromParams(p)).toEqual(f);
    expect(filtersFromParams({ zone: "not-a-uuid", tier: "gold", over: "-5", norsvp: "26", ending: "999", q: "x" })).toEqual(NO_FILTERS);
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it("never puts a typed search into what Niva is told (D2)", () => {
    const f = { ...NO_FILTERS, q: "Ada Okafor", zone: ZONES[0].id };
    const said = filtersForNiva(f, ctx);
    expect(said).toBe("area is North Riverside, matching a search typed on the screen");
    expect(said).not.toContain("Ada");
  });

  it("writes money in the organization's own currency", () => {
    const inr = communityFormat({ currency: "INR", country: "IN" });
    expect(chipsFor({ ...NO_FILTERS, overCents: 12500000 }, { ...ctx, fmt: inr })[0].label).toBe("Open balance over ₹1,25,000.00");
  });
});

describe("the household list", () => {
  const rows: BaseHousehold[] = [
    { id: "a", name: "Okafor household", number: "0212", zoneId: ZONES[0].id, city: "Riverside", tiers: ["yearly"] },
    { id: "b", name: "García López household", number: "0562", zoneId: ZONES[0].id, city: null, tiers: ["life"] },
    { id: "c", name: "Nguyen household", number: "0301", zoneId: null, city: "Hillcrest", tiers: [] },
    { id: "d", name: "Haddad household", number: "0847", zoneId: null, city: null, tiers: ["yearly"] },
  ];
  const balances = new Map([
    ["a", 25000],
    ["b", 48000],
    ["c", 9000],
  ]);

  it("applies every filter it has an answer for", () => {
    const f = { ...NO_FILTERS, zone: ZONES[0].id, overCents: 10000, noRsvpYear: 2026 };
    const out = filterHouseholds(rows, f, { searchIds: null, balances, rsvpd: new Set(["b"]), ending: null });
    expect(out.map((h) => h.id)).toEqual(["a"]);
    expect(filterHouseholds(rows, { ...NO_FILTERS, q: "x" }, { searchIds: new Set(["c"]), balances: null, rsvpd: null, ending: null }).map((h) => h.id)).toEqual(["c"]);
    expect(filterHouseholds(rows, { ...NO_FILTERS, tier: "life" }, { searchIds: null, balances: null, rsvpd: null, ending: null }).map((h) => h.id)).toEqual(["b"]);
    expect(filterHouseholds(rows, { ...NO_FILTERS, endingDays: 60 }, { searchIds: null, balances: null, rsvpd: null, ending: new Set(["d"]) }).map((h) => h.id)).toEqual(["d"]);
  });

  it("sorts by name, by open balance and by area (no area last)", () => {
    const zoneName = (id: string | null) => ZONES.find((z) => z.id === id)?.name ?? null;
    expect(sortHouseholds(rows, "name", { balances, zoneName }).map((h) => h.id)).toEqual(["b", "d", "c", "a"]);
    expect(sortHouseholds(rows, "open", { balances, zoneName }).map((h) => h.id)).toEqual(["b", "a", "c", "d"]);
    expect(sortHouseholds(rows, "area", { balances, zoneName }).map((h) => h.id)).toEqual(["c", "b", "a", "d"]);
    expect(sortKey("open")).toBe("open");
    expect(sortKey("evil")).toBe("name");
  });

  it("pages, totals and says what it shows", () => {
    const s = pageOf(rows, 9, 3);
    expect(s).toMatchObject({ page: 2, pages: 2, from: 4, to: 4, total: 4 });
    expect(openTotal(rows, balances)).toBe(82000);
    expect(openTotal(rows, null)).toBeNull();
    expect(showingText(pageOf(rows, 1, 3))).toBe("Showing 3 of 4");
    expect(showingText(s)).toBe("Showing 4–4 of 4");
    expect(showingText(pageOf(rows, 1, 10))).toBe("Showing all 4");
    expect(showingText(pageOf([], 1, 10))).toBe("");
  });
});
