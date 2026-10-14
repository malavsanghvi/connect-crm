import { describe, expect, it } from "vitest";

import { toCsv } from "@/lib/import/templates";
import { NO_FILTERS, type HouseholdFilters } from "@/lib/people-v2/ask";
import {
  contactCell,
  exportFileName,
  gapPeople,
  hasGaps,
  householdExportLines,
  householdIdsOf,
  inBand,
  matchesSearch,
  PEOPLE_EXPORT_HEADER,
  peopleExportLines,
  type ExportCard,
  type GapPerson,
} from "@/lib/people-v2/gaps";

// A contact-gap list is a list of ADULTS: a child has no email or mobile field, and a child's record is never part of a work list or an
// export (D2). Everyone here is invented, in several scripts, in a community that is not a faith community.

const TODAY = "2026-10-12";
const ctx = { today: TODAY, majority: 18 };
const home = (id: string, over: Partial<NonNullable<GapPerson["household"]>> = {}) => ({ id, name: `${id} household`, number: "0101", hasAddress: true, zoneId: null, ...over });

const person = (id: string, name: string, over: Partial<GapPerson> = {}): GapPerson => ({
  id,
  name,
  memberNumber: null,
  email: "x@example.org",
  phone: "+15555550100",
  dateOfBirth: "1980-01-01",
  role: "spouse",
  onApp: true,
  onTeam: false,
  household: home("h1"),
  ...over,
});

const PEOPLE: GapPerson[] = [
  person("p-okafor", "Tunde Okafor", { email: null }),
  person("p-nakamura", "田中 花子", { email: "", household: home("h2") }),
  person("p-fedorov", "Фёдор Иванов", { phone: null, household: home("h3", { hasAddress: false }) }),
  person("p-child", "Layla Hassan", { email: null, phone: null, dateOfBirth: "2015-03-04", role: "child" }),
  person("p-child-nodob", "Omar Hassan", { email: null, phone: null, dateOfBirth: null, role: "child" }),
  person("p-sibling-nodob", "Noor Hassan", { email: null, dateOfBirth: null, role: "sibling" }),
  person("p-primary-nodob", "Priya Shah", { email: null, dateOfBirth: null, role: "primary", household: home("h4") }),
  person("p-teen", "Tess Teen", { email: null, dateOfBirth: "2008-11-01", role: "child" }),
  person("p-senior", "María Fernández", { email: null, dateOfBirth: "1950-05-05", household: home("h5"), onApp: false }),
  person("p-loner", "Lena Brandt", { email: null, household: null, dateOfBirth: "1993-02-02", role: null }),
  person("p-team", "Sam Team", { email: null, onTeam: true, household: home("h6") }),
];
const f = (over: Partial<HouseholdFilters>): HouseholdFilters => ({ ...NO_FILTERS, ...over });
const ids = (list: GapPerson[]) => list.map((p) => p.id);

describe("who has a gap", () => {
  it("counts a missing, empty or blank value as a gap, and a value as none", () => {
    expect(hasGaps(PEOPLE[0], f({ noEmail: true }))).toBe(true);
    expect(hasGaps(PEOPLE[1], f({ noEmail: true }))).toBe(true);
    expect(hasGaps(person("x", "X", { email: "   " }), f({ noEmail: true }))).toBe(true);
    expect(hasGaps(PEOPLE[2], f({ noEmail: true }))).toBe(false);
    expect(hasGaps(PEOPLE[2], f({ noMobile: true }))).toBe(true);
    expect(hasGaps(PEOPLE[0], f({ noMobile: true }))).toBe(false);
  });

  it("takes a person with no family, or a family with no street address, as having no address", () => {
    expect(hasGaps(PEOPLE[2], f({ noAddress: true }))).toBe(true);
    expect(hasGaps(PEOPLE[9], f({ noAddress: true }))).toBe(true);
    expect(hasGaps(PEOPLE[0], f({ noAddress: true }))).toBe(false);
  });

  it("takes someone with no signed-in account as not on the app, and wants every gap that is asked", () => {
    expect(hasGaps(PEOPLE[8], f({ notOnApp: true }))).toBe(true);
    expect(hasGaps(PEOPLE[0], f({ notOnApp: true }))).toBe(false);
    expect(hasGaps(PEOPLE[8], f({ notOnApp: true, noEmail: true }))).toBe(true);
    expect(hasGaps(PEOPLE[2], f({ noMobile: true, noEmail: true }))).toBe(false);
  });
});

describe("only adults are ever on a gap list", () => {
  it("leaves out a child, a teenager, and anyone with no birth date who is not a head, a spouse or a parent", () => {
    const list = gapPeople(PEOPLE, f({ noEmail: true }), ctx);
    expect(ids(list)).toEqual(expect.arrayContaining(["p-okafor", "p-nakamura", "p-primary-nodob", "p-senior", "p-loner", "p-team"]));
    for (const child of ["p-child", "p-child-nodob", "p-sibling-nodob", "p-teen"]) expect(ids(list)).not.toContain(child);
    expect(list.map((p) => p.name)).not.toContain("Layla Hassan");
  });

  it("is adults even when the address asks for under 18, for everyone or for nothing", () => {
    for (const band of ["minors", null, "adults"] as const) {
      const list = gapPeople(PEOPLE, f({ noEmail: true, band }), ctx);
      expect(ids(list)).not.toContain("p-child");
      expect(ids(list)).toContain("p-okafor");
    }
    // Even a list with no gap at all (an age band only) never holds a child.
    expect(ids(gapPeople(PEOPLE, f({ band: "minors" }), ctx))).toEqual([]);
    expect(ids(gapPeople(PEOPLE, f({}), ctx))).not.toContain("p-child");
  });

  it("uses the community's own age of majority, never below 18", () => {
    const young = person("p-19", "Nineteen", { email: null, dateOfBirth: "2007-06-01", role: "child" });
    expect(inBand(young, f({ noEmail: true }), { today: TODAY, majority: 18 })).toBe(true);
    expect(inBand(young, f({ noEmail: true }), { today: TODAY, majority: 21 })).toBe(false);
    expect(inBand(young, f({ noEmail: true }), { today: TODAY, majority: 16 })).toBe(true);
    expect(inBand(person("p-17", "Seventeen", { dateOfBirth: "2009-06-01", role: "child" }), f({ noEmail: true }), { today: TODAY, majority: 16 })).toBe(false);
  });

  it("reads seniors as 65 and over, and 'on a team or role' as adults on a team", () => {
    expect(ids(gapPeople(PEOPLE, f({ noEmail: true, band: "seniors" }), ctx))).toEqual(["p-senior"]);
    expect(ids(gapPeople(PEOPLE, f({ noEmail: true, band: "roles" }), ctx))).toEqual(["p-team"]);
    expect(ids(gapPeople(PEOPLE, f({ band: "seniors" }), ctx))).toEqual(["p-senior"]);
  });

  it("narrows by area, and by a typed search through the person or the family", () => {
    const zoned = PEOPLE.map((p) => (p.id === "p-okafor" ? { ...p, household: home("h1", { zoneId: "z-north" }) } : p));
    expect(ids(gapPeople(zoned, f({ noEmail: true, zone: "z-north" }), ctx))).toEqual(["p-okafor"]);
    expect(ids(gapPeople(PEOPLE, f({ noEmail: true, q: "okafor" }), ctx))).toEqual(["p-okafor"]);
    expect(ids(gapPeople(PEOPLE, f({ noEmail: true, q: "田中" }), ctx))).toEqual(["p-nakamura"]);
    expect(ids(gapPeople(PEOPLE, f({ noEmail: true, q: "maria fernandez" }), ctx))).toEqual(["p-senior"]);
    expect(ids(gapPeople(PEOPLE, f({ noEmail: true, q: "0102" }), { ...ctx, searchIds: new Set(["h2"]) }))).toEqual(["p-nakamura"]);
    expect(matchesSearch(PEOPLE[0], null, null)).toBe(true);
    expect(matchesSearch(PEOPLE[0], "zzz", null)).toBe(false);
  });

  it("puts people in name order, any script, and names the families they are in", () => {
    const list = gapPeople(PEOPLE, f({ noEmail: true }), ctx);
    expect(list.map((p) => p.name)).toEqual([...list.map((p) => p.name)].sort((a, b) => new Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare(a, b)));
    expect([...householdIdsOf(list)].sort()).toEqual(["h1", "h2", "h4", "h5", "h6"]);
  });
});

describe("what a row and an export line show", () => {
  it("shows a dash where a value is missing, and a phone the way people read it", () => {
    expect(contactCell(null, "email")).toBe("—");
    expect(contactCell("  ", "phone")).toBe("—");
    expect(contactCell("+17135550138", "phone")).toBe("(713) 555-0138");
    expect(contactCell("+442071838750", "phone")).toBe("+442071838750");
    expect(contactCell(" a@b.org ", "email")).toBe("a@b.org");
  });

  it("writes one line per adult with the family's card, never a child, and keeps formulas from running", () => {
    const list = gapPeople([...PEOPLE, person("p-formula", "=HYPERLINK(1)", { email: null, household: home("h7") })], f({ noEmail: true }), ctx);
    const cards = new Map<string, ExportCard>([
      ["h1", { name: "Okafor household", number: "0101", orgId: "RN-H-0101", city: "Riverside", zone: "North", adults: ["Tunde Okafor"] }],
      ["h2", { name: "Nakamura household", number: "0102", orgId: null, city: null, zone: null, adults: ["田中 花子"] }],
    ]);
    const lines = peopleExportLines(list, cards, (role) => (role ? role.toUpperCase() : ""), TODAY);
    const csv = toCsv([[...PEOPLE_EXPORT_HEADER], ...lines]);
    expect(csv.split("\r\n")[0]).toBe(PEOPLE_EXPORT_HEADER.join(","));
    expect(csv).toContain("Tunde Okafor");
    expect(csv).toContain("Okafor household");
    expect(csv).toContain("RN-H-0101");
    expect(csv).toContain("田中 花子");
    for (const child of ["Layla Hassan", "Omar Hassan", "Noor Hassan", "Tess Teen"]) expect(csv).not.toContain(child);
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(lines).toHaveLength(list.length);
    const okafor = lines.find((l) => l[0] === "Tunde Okafor");
    expect(okafor?.[5]).toBe("Yes");
    expect(okafor?.[6]).toBe(46);
  });

  it("writes a family line from its card (adults only, no child's name) with the balance only for those who may see giving", () => {
    const cards = new Map<string, ExportCard>([["h1", { name: "Hassan household", number: "0301", orgId: "RN-H-1102", city: "Riverside", zone: "North Riverside", adults: ["Samira Hassan", "Karim Hassan"] }]]);
    const rows = [{ id: "h1", number: "0301", openCents: 30000 }];
    const withBalance = householdExportLines(rows, cards, { withBalance: true, areaOf: () => "North Riverside" });
    expect(withBalance[0]).toEqual(["0301", "RN-H-1102", "Hassan household", "Samira Hassan; Karim Hassan", "Riverside", "North Riverside", "300.00"]);
    const without = householdExportLines(rows, cards, { withBalance: false, areaOf: () => null });
    expect(without[0]).toEqual(["0301", "RN-H-1102", "Hassan household", "Samira Hassan; Karim Hassan", "Riverside", "North Riverside"]);
    expect(householdExportLines([{ id: "gone", number: "9", openCents: null }], new Map(), { withBalance: true, areaOf: () => null })[0]).toEqual(["9", "", "", "", "", "", ""]);
  });

  it("names the file after the list and the day, safely, in any script", () => {
    expect(exportFileName("Adults with no email", "2026-10-12")).toBe("adults-with-no-email-2026-10-12.csv");
    expect(exportFileName("Señoras sin correo", "2026-10-12")).toBe("senoras-sin-correo-2026-10-12.csv");
    expect(exportFileName("名簿", "2026-10-12")).toBe("list-2026-10-12.csv");
    expect(exportFileName("../../etc/passwd", "2026-10-12")).toBe("etc-passwd-2026-10-12.csv");
  });
});
