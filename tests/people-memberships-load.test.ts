import { describe, expect, it, vi } from "vitest";

// The Memberships section's reads: the memberships of the person and of the family with the family's card line, the holders'
// names, the types with their fee written in the community's currency, and (only for a person who holds both people.approve and
// people.manage) what "Assign a membership" needs. A role that cannot read memberships is told so, never shown an empty list.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { familyFixture } from "@/app/dev/people-family/fixtures";
import { loadMembershipsPanel } from "@/lib/people-v2/memberships-load";

import { fakeDb, fakeSession } from "./commands/helpers";

const CENTER = "center-1";
const TYPES = [
  { id: "t-friend", center_id: CENTER, name: "Friend", tier: "community", fee_cents: 0, period_months: null, active: true },
  { id: "t-annual", center_id: CENTER, name: "Annual member", tier: "yearly", fee_cents: 5000, period_months: 12, active: true },
  { id: "t-life", center_id: CENTER, name: "Lifetime member", tier: "life", fee_cents: 50000, period_months: null, active: true },
  { id: "t-old", center_id: CENTER, name: "Retired plan", tier: "yearly", fee_cents: 1000, period_months: 12, active: false },
];

const row = (o: Record<string, unknown>) => ({
  center_id: CENTER,
  household_id: "hh-hassan",
  person_id: "p-samira",
  membership_type_id: "t-annual",
  tier: "yearly",
  status: "active",
  starts_on: "2026-04-01",
  ends_on: "2099-03-31",
  notes: null,
  fee_pledge_id: null,
  ...o,
});

function world(over: { memberships?: Record<string, unknown>[]; perms?: string[]; modulesOff?: string[]; failTables?: Record<string, { message: string }> } = {}) {
  const db = fakeDb({
    tables: {
      memberships: over.memberships ?? [row({ id: "m1", fee_pledge_id: "pl-1", notes: "Assigned by staff: Paid at the desk" })],
      membership_types: TYPES,
      people: [{ id: "p-visitor", first_name: "Aiko", last_name: "Tanaka", preferred_name: null, member_number: null }],
      households: [],
    },
    failTables: over.failTables,
    rpc: {
      household_card: (a: Record<string, unknown>) =>
        a.p_household === "hh-other"
          ? [{ household_id: "hh-other", household_name: "田中 household", household_number: "0507", org_household_id: "RCC-H-77", primary_member: "田中 美咲", city: "Riverside", zone: null, members: null }]
          : [],
    },
  });
  return fakeSession({ db, permissions: over.perms ?? ["people.view", "people.manage", "people.approve"], modulesOff: over.modulesOff ?? [] });
}

const model = (over: Parameters<typeof familyFixture>[1] = {}) => familyFixture("hassan", over);
const samira = () => model().adults[0];

describe("loadMembershipsPanel", () => {
  it("reads the family's memberships with the family's card line, the holder, the type, the note and the pledge", async () => {
    const r = await loadMembershipsPanel(world(), { person: samira(), model: model() });
    if (r.state !== "ok") throw new Error("expected ok");
    expect(r.data.rows).toEqual([
      {
        id: "m1",
        householdId: "hh-hassan",
        tier: "yearly",
        typeName: "Annual member",
        status: "active",
        startsOn: "2026-04-01",
        endsOn: "2099-03-31",
        notes: "Assigned by staff: Paid at the desk",
        holder: { id: "p-samira", name: "Samira Hassan" },
        household: ["Hassan household", "No. 0301", "RCC-H-1102", "Samira & Karim Hassan", "Riverside, North Riverside"],
        hasFeePledge: true,
        fixedTerm: true,
      },
    ]);
    expect(r.data.canChange).toBe(true);
    expect(r.data.truncated).toBe(false);
  });

  it("gives a person who holds both permissions what Assign needs: the active types with their fee in the community's currency, the adults, the live membership", async () => {
    const r = await loadMembershipsPanel(world(), { person: samira(), model: model() });
    if (r.state !== "ok") throw new Error("expected ok");
    const a = r.data.assign;
    expect(a).not.toBeNull();
    expect(a?.householdId).toBe("hh-hassan");
    expect(a?.household[0]).toBe("Hassan household");
    expect(a?.types).toEqual([
      { id: "t-friend", name: "Friend", tier: "community", feeCents: 0, feeLabel: null, periodMonths: null },
      { id: "t-annual", name: "Annual member", tier: "yearly", feeCents: 5000, feeLabel: "$50.00", periodMonths: 12 },
      { id: "t-life", name: "Lifetime member", tier: "life", feeCents: 50000, feeLabel: "$500.00", periodMonths: null },
    ]);
    expect(a?.holders).toEqual([
      { id: "p-samira", name: "Samira Hassan" },
      { id: "p-karim", name: "Karim Hassan" },
    ]);
    expect(a?.defaultHolderId).toBe("p-samira");
    expect(a?.givingOn).toBe(true);
    expect(a?.live).toEqual({ id: "m1", tier: "yearly", typeName: "Annual member", endsOn: "2099-03-31" });
  });

  it("defaults the holder to the primary adult when the section is opened from a child, and never offers a child as holder", async () => {
    const m = model();
    const r = await loadMembershipsPanel(world(), { person: m.children[0], model: m });
    if (r.state !== "ok") throw new Error("expected ok");
    expect(r.data.assign?.defaultHolderId).toBe("p-samira");
    expect(r.data.assign?.holders.map((h) => h.name)).toEqual(["Samira Hassan", "Karim Hassan"]);
  });

  it("shows a membership the person holds in another family with that family's own card line, and a holder who is not in the family by name", async () => {
    const memberships = [row({ id: "m1" }), row({ id: "m2", household_id: "hh-other", person_id: "p-visitor", tier: "community", membership_type_id: "t-friend", ends_on: null, starts_on: "2020-01-01" })];
    const r = await loadMembershipsPanel(world({ memberships }), { person: samira(), model: model() });
    if (r.state !== "ok") throw new Error("expected ok");
    const other = r.data.rows.find((x) => x.id === "m2");
    expect(other?.household).toEqual(["田中 household", "No. 0507", "RCC-H-77", "田中 美咲", "Riverside"]);
    expect(other?.holder).toEqual({ id: "p-visitor", name: "Aiko Tanaka" });
    expect(other?.fixedTerm).toBe(false);
  });

  it("does not offer Assign, and does not send the types, to a person who cannot change memberships", async () => {
    for (const perms of [["people.view", "people.manage"], ["people.view", "people.approve"], ["people.view"]]) {
      const r = await loadMembershipsPanel(world({ perms }), { person: samira(), model: model() });
      if (r.state !== "ok") throw new Error("expected ok");
      expect(r.data.canChange).toBe(false);
      expect(r.data.assign).toBeNull();
      expect(r.data.rows).toHaveLength(1);
    }
  });

  it("says the person has no access to this area, never an empty list", async () => {
    const r = await loadMembershipsPanel(world({ perms: ["events.view"] }), { person: samira(), model: model() });
    expect(r).toEqual({ state: "no-access" });
  });

  it("knows when Pledges & donations is off, and when the family has no live membership", async () => {
    const memberships = [row({ id: "m1", ends_on: "2026-03-31" })];
    const r = await loadMembershipsPanel(world({ memberships, modulesOff: ["giving"] }), { person: samira(), model: model() });
    if (r.state !== "ok") throw new Error("expected ok");
    expect(r.data.assign?.givingOn).toBe(false);
    expect(r.data.assign?.live).toBeNull();
  });

  it("does not offer Assign for a household that was merged into another", async () => {
    const r = await loadMembershipsPanel(world(), { person: samira(), model: { ...model(), mergedIntoId: "hh-keep" } });
    if (r.state !== "ok") throw new Error("expected ok");
    expect(r.data.assign).toBeNull();
  });

  it("shows the most recent ones, and says there are more", async () => {
    const many = Array.from({ length: 61 }, (_, i) => row({ id: `m${i}`, status: "ended", starts_on: `2020-01-${String((i % 28) + 1).padStart(2, "0")}`, ends_on: "2021-01-01" }));
    const r = await loadMembershipsPanel(world({ memberships: many }), { person: samira(), model: model() });
    if (r.state !== "ok") throw new Error("expected ok");
    expect(r.data.rows).toHaveLength(60);
    expect(r.data.truncated).toBe(true);
  });

  it("says a read that failed in words, logs the detail, and never shows an empty list", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await loadMembershipsPanel(world({ failTables: { memberships: { message: "connection reset" } } }), { person: samira(), model: model() });
    expect(r).toMatchObject({ state: "error", message: expect.stringContaining("Could not load the memberships") });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
