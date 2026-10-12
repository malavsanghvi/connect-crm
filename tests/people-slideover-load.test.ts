import { describe, expect, it, vi } from "vitest";

// The slide-over's loader reads one person and works out what each deep section may say. The database is a stand-in with a small
// community in it; what is checked is what the model carries: a child's contact details never, finance IDs only for finance readers,
// "no access" for a section the role cannot read, and a person who is not in the family of the address.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/data/lookups", async (orig) => ({
  ...(await orig<typeof import("@/lib/data/lookups")>()),
  orgIds: vi.fn(async () => ({ byPerson: new Map([["p-priya", ["0417"]]]), byHousehold: new Map(), error: null })),
  householdsById: vi.fn(async () => ({ map: new Map([["hh-1", { id: "hh-1", display_name: "Shah household", household_number: "H-1001" }]]), error: null })),
}));
vi.mock("@/lib/data/profile-details", () => ({
  loadProfileDetails: vi.fn(async () => ({
    ok: true,
    data: { recorded: true, anniversary: "2009-06-20", dietary: [{ key: "veg", label: "Vegetarian", retired: false }], emergency: null, interests: [], volunteering: null, updatedAt: null, labelsNote: null },
  })),
}));
vi.mock("@/lib/community-locale", () => ({ loadCommunityLocale: vi.fn(async () => ({ languages: ["en", "ja"], known: true, note: null })) }));

import { loadPersonDetail } from "@/lib/people-v2/slideover-load";
import type { FamilyModel } from "@/lib/people-v2/family-model";
import { familyFixture } from "@/app/dev/people-family/fixtures";

import { fakeDb, fakeSession } from "./commands/helpers";

type Row = Record<string, unknown>;
const center_id = "center-1";

function world(over: { failTables?: Record<string, { message: string }> } = {}) {
  const tables: Record<string, Row[]> = {
    people: [
      { id: "p-priya", center_id, first_name: "Priya", last_name: "Shah", preferred_name: null, member_number: "M-1", gender: "female", date_of_birth: "1984-03-02", profession: "Doctor", employer: null, phone_e164: "+15125550101", email: "priya@example.org", language: "en", is_deceased: false, deceased_on: null, merged_into_id: null, interests: [], photo_opt_in: true, new_member_contact_opt_in: false, expertise_opt_in: true, expertise_headline: "GP" },
      { id: "p-zoya", center_id, first_name: "Zoya", last_name: "Shah", preferred_name: null, member_number: "M-3", gender: "female", date_of_birth: "2018-05-05", profession: null, employer: null, phone_e164: "+15125550999", email: "zoya@example.org", language: "en", is_deceased: false, deceased_on: null, merged_into_id: null, interests: [], photo_opt_in: false, new_member_contact_opt_in: false, expertise_opt_in: false, expertise_headline: null },
    ],
    center_users: [{ center_id, person_id: "p-priya", user_id: "u-priya", created_at: "2026-03-03T15:00:00Z" }],
    role_grants: [{ center_id, user_id: "u-priya", role_key: "treasurer", ends_at: null, status: "active" }],
    roles: [{ key: "treasurer", name: "Treasurer" }],
    external_ids: [
      { id: "e1", center_id, person_id: "p-priya", kind: "org_member", system: "org_register", value: "0417", valid_to: null },
      { id: "e2", center_id, person_id: "p-priya", kind: "accounting", system: "quickbooks", value: "1187", valid_to: null },
      { id: "e3", center_id, person_id: "p-priya", kind: "bank_payer", system: "bank", value: "P SHAH", valid_to: null },
    ],
    memberships: [{ id: "m1", person_id: "p-priya", household_id: "hh-1", tier: "yearly", status: "active", starts_on: "2026-01-01", ends_on: "2026-12-31" }],
    volunteer_assignments: [],
    background_checks: [],
  };
  return fakeDb({ tables, ...over });
}

const session = (permissions: string[]) => fakeSession({ db: world(), permissions });
const FULL = ["people.view", "people.manage", "giving.view", "roles.manage", "volunteers.view", "safety.view", "audit.view"];

function family(): FamilyModel {
  const m = familyFixture("hassan");
  const adult = { ...m.adults[0], id: "p-priya", name: "Priya Shah", firstName: "Priya", values: { ...m.adults[0].values, first_name: "Priya", last_name: "Shah" } };
  const child = { ...m.children[0], id: "p-zoya", name: "Zoya Shah", firstName: "Zoya", isChild: true };
  return { ...m, id: "hh-1", adults: [adult], children: [child] };
}

describe("loadPersonDetail on a family page", () => {
  it("builds the model for an adult: the account, the roles, the member's own details, privacy values, IDs and memberships", async () => {
    const r = await loadPersonDetail(session(FULL), { personId: "p-priya", family: family() });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const d = r.detail;
    expect(d.person.name).toBe("Priya Shah");
    expect(d.canEdit).toBe(true);
    expect(d.household).toMatchObject({ id: "hh-1" });
    expect(d.account).toEqual({ state: "ok", data: { linkedAt: "2026-03-03T15:00:00Z", hasEmail: true, hasMobile: true, childLoginAge: 13 } });
    expect(d.roles.roles).toEqual({ state: "ok", data: ["Treasurer"] });
    expect(d.roles.waiver).toEqual({ state: "ok", data: "No volunteer shifts" });
    expect(d.roles.background).toEqual({ state: "ok", data: "None on file" });
    expect(d.profileDetails).toMatchObject({ state: "ok", data: { anniversary: "2009-06-20" } });
    expect(d.privacy.values).toEqual({ photo_opt_in: "on", new_member_contact_opt_in: "off", expertise_opt_in: "on", expertise_headline: "GP" });
    expect(d.memberships).toEqual({
      state: "ok",
      data: [{ id: "m1", tier: "yearly", status: "active", startsOn: "2026-01-01", endsOn: "2026-12-31", household: { name: "Shah household", number: "H-1001" } }],
    });
    expect(d.ownerLinks.roles).not.toBeNull();
  });

  it("gives finance IDs only to someone who may read them, and says which kinds are hidden", async () => {
    const withFinance = await loadPersonDetail(session(FULL), { personId: "p-priya", family: family() });
    const without = await loadPersonDetail(session(["people.view", "people.manage"]), { personId: "p-priya", family: family() });
    if (withFinance.status !== "ok" || without.status !== "ok") throw new Error("not loaded");
    const values = (l: typeof withFinance) => (l.detail.ids.state === "ok" ? l.detail.ids.data.rows.map((i) => i.value) : []);
    expect(values(withFinance)).toEqual(["M-1", "0417", "1187", "P SHAH"]);
    expect(values(without)).toEqual(["M-1", "0417"]);
    if (without.detail.ids.state === "ok") {
      expect(without.detail.ids.data.hiddenKinds).toEqual(["Accounting (QuickBooks) customer", "Bank payer name", "Payment-provider customer"]);
      // people.manage may add people-kind IDs, but not finance ones
      expect(without.detail.ids.data.addKinds.map((k) => k.kind)).toEqual(["org_member", "crm", "other"]);
    }
  });

  it("says 'no access' for the roles, waiver and background check a role may not read, instead of an empty list", async () => {
    const r = await loadPersonDetail(session(["people.view"]), { personId: "p-priya", family: family() });
    if (r.status !== "ok") throw new Error("not loaded");
    expect(r.detail.canEdit).toBe(false);
    expect(r.detail.roles).toEqual({ roles: { state: "no-access" }, waiver: { state: "no-access" }, background: { state: "no-access" } });
    expect(r.detail.ownerLinks.roles).toBeNull();
  });

  it("says a section could not be read, in words, while the rest still loads", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = world({ failTables: { memberships: { message: "connection reset" } } });
    const r = await loadPersonDetail(fakeSession({ db, permissions: FULL }), { personId: "p-priya", family: family() });
    if (r.status !== "ok") throw new Error("not loaded");
    expect(r.detail.memberships.state).toBe("error");
    expect(r.detail.roles.roles.state).toBe("ok");
  });

  it("says the person is not here when they are not in this family, or this role cannot see them", async () => {
    expect(await loadPersonDetail(session(FULL), { personId: "p-stranger", family: family() })).toEqual({ status: "not_here" });
    const m = family();
    expect(await loadPersonDetail(session(FULL), { personId: "p-priya", family: { ...m, adults: [] } })).toEqual({ status: "not_here" });
  });

  it("carries the person's role and primary flag from the page's own model", async () => {
    const m = family();
    m.adults[0] = { ...m.adults[0], isPrimary: true, role: "primary" };
    const r = await loadPersonDetail(session(FULL), { personId: "p-priya", family: m });
    if (r.status !== "ok") throw new Error("not loaded");
    expect(r.detail.person).toMatchObject({ isPrimary: true, role: "primary" });
  });
});

describe("a child in the loader (D2)", () => {
  it("never carries the child's mobile or email on the person's own page, though the account facts know they exist", async () => {
    const r = await loadPersonDetail(session(FULL), { personId: "p-zoya", family: null });
    if (r.status !== "ok") throw new Error("not loaded");
    expect(r.detail.person.isChild).toBe(true);
    expect(r.detail.person.values.phone_e164).toBe("");
    expect(r.detail.person.values.email).toBe("");
    expect(JSON.stringify(r.detail)).not.toMatch(/zoya@example|\+15125550999/);
    expect(r.detail.household).toBeNull();
  });

  it("reads an adult in no family from the person's own record, in the community's languages", async () => {
    const r = await loadPersonDetail(session(FULL), { personId: "p-priya", family: null });
    if (r.status !== "ok") throw new Error("not loaded");
    expect(r.detail.person).toMatchObject({ name: "Priya Shah", isChild: false, orgIds: ["0417"], memberNumber: "M-1" });
    expect(r.detail.person.values.phone_e164).toBe("+15125550101");
    expect(r.detail.check.languages.map((l) => l.value)).toContain("ja");
    expect(r.detail.privacy.directory).toBeNull();
  });

  it("says not found for a person who does not exist", async () => {
    expect(await loadPersonDetail(session(FULL), { personId: "p-nobody", family: null })).toEqual({ status: "not_found" });
  });
});
