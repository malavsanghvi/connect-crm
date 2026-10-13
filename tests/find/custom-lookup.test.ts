import { beforeEach, describe, expect, it, vi } from "vitest";

// The find box's lookup, with a stand-in database: a searchable custom field's value finds a person or a family, under the viewer's own
// access (the stand-in does not filter by the typed text: the scoring decides what really matches, as it does in production).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/commands/catalog/household", () => ({
  adultHouseholdCards: vi.fn(async (_db: unknown, ids: string[]) => ({
    cards: ids.map((id) => ({
      household_id: id,
      household_name: id === "h-tanaka" ? "田中 household" : "Hassan household",
      household_number: id === "h-tanaka" ? "0470" : "0301",
      org_household_id: null,
      adults: id === "h-tanaka" ? ["太郎 田中"] : ["Samira Hassan", "Karim Hassan"],
      primary_adult: null,
      zone: null,
      city: "Riverside",
      last_gift_on: null,
      open_pledge_cents: null,
      open_pledge: null,
    })),
    hidden: 0,
    adults: { byHousehold: new Map(), adultIds: new Set(), minorFirstNames: new Map() },
  })),
}));
vi.mock("@/lib/people-v2/load", () => ({ loadZones: vi.fn(async () => ({ zones: [], error: null })) }));

import { findRecords } from "@/lib/data/find";

import { fakeDb, fakeSession } from "../commands/helpers";

const C = "center-1";
const def = (over: Record<string, unknown>) => ({ center_id: C, status: "active", searchable: true, type: "text", ...over });
const person = (over: Record<string, unknown>) => ({
  center_id: C,
  merged_into_id: null,
  preferred_name: null,
  email: null,
  phone_e164: null,
  member_number: null,
  is_deceased: false,
  custom: {},
  ...over,
});

function tables(): Record<string, Record<string, unknown>[]> {
  return {
    custom_field_definitions: [
      def({ entity: "people", key: "skills", label: "Volunteer skills" }),
      def({ entity: "people", key: "diet_note", label: "Diet note" }),
      def({ entity: "people", key: "secret", label: "Private note", searchable: false }),
      def({ entity: "people", key: "kids", label: "Number of kids", type: "number" }),
      def({ entity: "people", key: "skills_ja", label: "ボランティアの技能" }),
      def({ entity: "households", key: "contact_time", label: "Preferred contact time", type: "choice" }),
    ],
    people: [
      person({ id: "p-samira", first_name: "Samira", last_name: "Hassan", date_of_birth: "1984-03-02", custom: { skills: "Catering, first aid", secret: "catering secret", kids: 2 } }),
      person({ id: "p-karim", first_name: "Karim", last_name: "Hassan", date_of_birth: "1982-07-19" }),
      person({ id: "p-layla", first_name: "Layla", last_name: "Hassan", date_of_birth: "2015-05-05", custom: { skills: "Catering helper" } }),
      person({ id: "p-taro", first_name: "太郎", last_name: "田中", date_of_birth: "1990-01-01", custom: { skills_ja: "料理, 応急手当" } }),
    ],
    households: [
      { id: "h-hassan", center_id: C, display_name: "Hassan household", household_number: "0301", merged_into_id: null, custom: { contact_time: "Evening" } },
      { id: "h-tanaka", center_id: C, display_name: "田中 household", household_number: "0470", merged_into_id: null, custom: {} },
    ],
    household_members: [
      { household_id: "h-hassan", person_id: "p-samira", role: "primary", is_primary: true, joined_at: "2020-01-01", left_at: null },
      { household_id: "h-hassan", person_id: "p-karim", role: "spouse", is_primary: false, joined_at: "2020-01-01", left_at: null },
      { household_id: "h-hassan", person_id: "p-layla", role: "child", is_primary: false, joined_at: "2020-01-01", left_at: null },
      { household_id: "h-tanaka", person_id: "p-taro", role: "primary", is_primary: true, joined_at: "2020-01-01", left_at: null },
    ],
    custom_staff_values: [
      { center_id: C, entity: "people", record_key: "p-karim", custom: { diet_note: "Vegetarian catering team" } },
      { center_id: C, entity: "households", record_key: "h-hassan", custom: {} },
    ],
  };
}

function setup(over: { permissions?: string[]; failTables?: Record<string, { message: string }> } = {}) {
  const db = fakeDb({ tables: tables(), rpc: { resolve_identifier: [] }, failTables: over.failTables });
  const session = fakeSession({ db, permissions: over.permissions ?? ["people.view"] });
  return { db, session };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the find box finds a record by a searchable custom field", () => {
  it("finds people by a value kept on the record and by a staff-only value, and says why", async () => {
    const { session } = setup();
    const res = await findRecords(session, "catering");
    expect(res.problem).toBeNull();
    const people = res.rows.filter((r) => r.kind === "person");
    const why = Object.fromEntries(people.map((r) => [r.id, r.why.label]));
    expect(why["p-samira"]).toBe("Custom field: Volunteer skills · Catering, first aid");
    expect(why["p-karim"]).toBe("Custom field: Diet note · Vegetarian catering team");
    // the family of an adult who matched is there too, and says who
    const families = res.rows.filter((r) => r.kind === "family");
    expect(families.map((f) => f.id)).toEqual(["h-hassan"]);
    expect(families[0].why.label).toMatch(/^Custom field: .* · (Samira|Karim) Hassan$/);
  });

  it("shows a child's row with the field's name only, never what it holds (D2), and only to a viewer who may open People", async () => {
    const withPeople = await findRecords(setup().session, "catering");
    const layla = withPeople.rows.find((r) => r.kind === "person" && r.id === "p-layla");
    expect(layla?.why.label).toBe("Custom field: Volunteer skills");
    expect(layla && "subtitle" in layla && layla.subtitle).toBe("Child · staff only");
    const without = await findRecords(setup({ permissions: [] }).session, "catering");
    expect(without.rows.find((r) => r.id === "p-layla")).toBeUndefined();
  });

  it("looks only in fields marked searchable and only in text-like ones", async () => {
    const { session } = setup();
    expect((await findRecords(session, "secret")).rows).toEqual([]);
    expect((await findRecords(session, "two")).rows).toEqual([]);
  });

  it("finds a family on a household field", async () => {
    const res = await findRecords(setup().session, "evening");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ kind: "family", id: "h-hassan" });
    expect(res.rows[0].why.label).toBe("Custom field: Preferred contact time · Evening");
    expect(res.rows[0]).toHaveProperty("cardLine");
  });

  it("finds a value written in another script, from a field named in another script", async () => {
    const res = await findRecords(setup().session, "料理");
    const taro = res.rows.find((r) => r.kind === "person");
    expect(taro?.id).toBe("p-taro");
    expect(taro?.why.label).toBe("Custom field: ボランティアの技能 · 料理, 応急手当");
  });

  it("does not look in custom fields for a phone number, an email or an ID", async () => {
    for (const typed of ["(713) 555-0136", "samira@example.org", "10482"]) {
      const { db, session } = setup();
      await findRecords(session, typed);
      const tablesRead = (db as unknown as { calls: { table: string }[] }).calls.map((c) => c.table);
      expect(tablesRead).not.toContain("custom_field_definitions");
      expect(tablesRead).not.toContain("custom_staff_values");
    }
  });

  it("keeps the rest of the results and says so when the custom fields could not be read", async () => {
    const { session } = setup({ failTables: { custom_field_definitions: { message: "boom" } } });
    const res = await findRecords(session, "samira");
    expect(res.rows.some((r) => r.kind === "person" && r.id === "p-samira")).toBe(true);
    expect(res.problem).toMatch(/could not be looked up/);
  });
});
