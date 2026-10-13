import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadCustomFields } from "@/lib/people-v2/custom-load";

import { fakeDb, fakeSession } from "./commands/helpers";

const C = "center-1";
type Row = Record<string, unknown>;
const def = (over: Row): Row => ({
  id: `d-${String(over.key)}`,
  center_id: C,
  entity: "people",
  type: "text",
  choices: [],
  sensitivity: "staff",
  searchable: false,
  source: "manual",
  source_import_run: null,
  status: "active",
  sort: 0,
  ...over,
});

const DEFS = [
  def({ key: "volunteer_skills", label: "Volunteer skills", sort: 2 }),
  def({ key: "shirt_size", label: "Shirt size", type: "choice", choices: ["S", "M"], sort: 1, sensitivity: "member_self" }),
  def({ key: "retired", label: "Retired field", status: "archived" }),
  def({ key: "hometown", label: "Hometown", entity: "households" }),
  def({ key: "payment_note", label: "Payment note", entity: "payments" }),
];

function load(
  over: { permissions?: string[]; canEdit?: boolean; defs?: Row[]; failTables?: Record<string, { code?: string; message: string }>; failRpc?: Record<string, { message: string }>; personIds?: string[]; householdId?: string | null } = {},
) {
  const db = fakeDb({
    tables: { custom_field_definitions: over.defs ?? DEFS },
    rpc: {
      custom_values: (a: Record<string, unknown>) => {
        const ids = a.p_ids as string[];
        return ids.map((id) => ({ record_key: id, custom: a.p_entity === "people" ? { volunteer_skills: `skills of ${id}`, shirt_size: "M" } : { hometown: "Beirut" } }));
      },
    },
    failTables: over.failTables,
    failRpc: over.failRpc,
  });
  const center = { id: C, slug: "riverside", name: "Riverside Community", short_name: "RC", time_zone: "Europe/Paris", currency: "EUR", branding: {}, feature_flags: {}, rules: {}, status: "active", environment: "production" };
  const session = fakeSession({ db, center, permissions: over.permissions ?? ["people.view"], kind: { key: "chamber_of_commerce", label: "Chamber of commerce", faithBased: false, usesTradition: false, terms: {}, modules: {} } });
  return { db, rpcCalls: (db as unknown as { rpcCalls: { fn: string; args: Record<string, unknown> }[] }).rpcCalls, promise: loadCustomFields(session, { personIds: over.personIds ?? ["p1", "p2"], householdId: over.householdId === undefined ? "h1" : over.householdId, canEdit: over.canEdit ?? false }) };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadCustomFields", () => {
  it("says there is no access for a role that cannot read people or settings, and reads nothing", async () => {
    const { db, promise } = load({ permissions: ["giving.view"] });
    expect(await promise).toEqual({ state: "no-access" });
    expect((db as unknown as { calls: unknown[] }).calls).toEqual([]);
  });

  it("gives the community's fields for people and households, the values of each person and the household, and the access", async () => {
    const { promise, rpcCalls } = load({ canEdit: true });
    const r = await promise;
    expect(r.state).toBe("ok");
    if (r.state !== "ok") return;
    expect(r.people.active.map((d) => d.key).sort()).toEqual(["shirt_size", "volunteer_skills"]);
    expect(r.households.active.map((d) => d.key)).toEqual(["hometown"]);
    expect(r.values).toEqual({
      p1: { volunteer_skills: "skills of p1", shirt_size: "M" },
      p2: { volunteer_skills: "skills of p2", shirt_size: "M" },
      h1: { hometown: "Beirut" },
    });
    expect(r.access).toEqual({ canEdit: true, canDefine: false });
    expect(r.kind).toEqual({ key: "chamber_of_commerce", label: "Chamber of commerce", faithBased: false });
    expect(r.community).toBe("Riverside Community");
    expect(r.currency).toBe("EUR");
    expect(r.settingsHref).toBeNull();
    expect(rpcCalls.map((c) => [c.fn, c.args.p_entity])).toEqual([
      ["custom_values", "people"],
      ["custom_values", "households"],
    ]);
  });

  it("keeps archived fields out of the cards and shows them to settings holders only (for Manage)", async () => {
    const plain = await load({ permissions: ["people.manage"], canEdit: true }).promise;
    expect(plain.state === "ok" && plain.people.archived).toEqual([]);
    const admin = await load({ permissions: ["people.manage", "settings.manage"], canEdit: true }).promise;
    expect(admin.state === "ok" && admin.people.archived.map((d) => d.key)).toEqual(["retired"]);
    expect(admin.state === "ok" && admin.settingsHref).toBe("/settings/custom-fields");
    expect(admin.state === "ok" && admin.access).toEqual({ canEdit: true, canDefine: true });
  });

  it("never lets someone edit who cannot: the page's own answer is not widened by a permission", async () => {
    const r = await load({ permissions: ["people.manage"], canEdit: false }).promise;
    expect(r.state === "ok" && r.access.canEdit).toBe(false);
  });

  it("reads no values when there are no fields to show, or no record", async () => {
    const none = load({ defs: [] });
    const r = await none.promise;
    expect(r).toMatchObject({ state: "ok", values: {}, people: { active: [], archived: [] } });
    expect(none.rpcCalls).toEqual([]);
    const noHousehold = load({ householdId: null, personIds: ["p9"] });
    await noHousehold.promise;
    expect(noHousehold.rpcCalls.map((c) => c.args.p_entity)).toEqual(["people"]);
  });

  it("says in words when the fields or the values could not be read, never an empty group", async () => {
    const a = await load({ failTables: { custom_field_definitions: { message: "boom" } } }).promise;
    expect(a).toMatchObject({ state: "error" });
    expect(a.state === "error" && a.message).toMatch(/^Could not load the custom fields: /);
    const b = await load({ failRpc: { custom_values: { message: "boom" } } }).promise;
    expect(b.state === "error" && b.message).toMatch(/^Could not load the custom details: /);
  });

  it("treats a database that has no custom fields yet as no fields", async () => {
    const r = await load({ failTables: { custom_field_definitions: { code: "42P01", message: 'relation "app.custom_field_definitions" does not exist' } } }).promise;
    expect(r).toMatchObject({ state: "ok", people: { active: [] } });
  });
});
