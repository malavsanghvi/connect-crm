import { beforeEach, describe, expect, it, vi } from "vitest";

// The two Server Actions of the Add a family sheet: addFamilyAction (through the command people.add_household) and the live
// findFamilyMatchesAction. Same ActionResult shapes the sheet reads, same sentences, the permission asked with the same words, the
// activity key recorded, and never a child's name in an answer. The session and the database are stand-ins.
const stub = vi.hoisted(() => ({
  session: null as unknown,
  refusal: null as string | null,
  asked: [] as { key: string; doing: string }[],
  activity: [] as { key: string; entity?: unknown }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/activity/with-activity", () => ({
  withActivity: async (key: string, fn: () => Promise<unknown>, opts?: { entityFrom?: unknown }) => {
    const result = await fn();
    const from = opts?.entityFrom;
    stub.activity.push({ key, entity: typeof from === "function" ? (from as (r: unknown) => unknown)(result) : from });
    return result;
  },
}));
vi.mock("@/lib/session", () => ({
  authorizeAction: vi.fn(async (key: string, doing: string) => {
    stub.asked.push({ key, doing });
    return stub.refusal ? { ok: false, error: stub.refusal } : { ok: true, session: stub.session };
  }),
  authorizeActionWhere: vi.fn(),
  dbWithReason: vi.fn(),
}));

import { addFamilyAction, findFamilyMatchesAction } from "@/app/(app)/people/add-family-actions";

import { ID, peopleDb, staffSession } from "./commands/people-fixture";

const NEW_HH = "a0000000-0000-4000-8000-0000000000f1";
const NEW_PERSON = "b0000000-0000-4000-8000-0000000000f1";
const CREATED = { created: true, household_id: NEW_HH, person_id: NEW_PERSON, household_number: "H-1201" };
const SOME = {
  total: 5,
  matches: [
    { household_id: ID.hhShah, reasons: ["mobile", "name"], strength: 8 },
    { household_id: ID.hhPatel, reasons: ["last_name"], strength: 1 },
  ],
};

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

function setup(rpc: Record<string, unknown> = {}, over: { failRpc?: Record<string, { code?: string; message: string }>; modulesOff?: string[] } = {}) {
  const { db } = peopleDb({ rpc: { household_possible_matches: { total: 0, matches: [] }, add_household: CREATED, ...rpc }, failRpc: over.failRpc });
  stub.session = staffSession(db, undefined, over.modulesOff ? { modulesOff: over.modulesOff } : {});
  stub.refusal = null;
  stub.asked = [];
  stub.activity = [];
  return { db };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("addFamilyAction", () => {
  const ok = { first_name: "Nia", last_name: "Okafor", contact: "(512) 555-0188", street: "12 River Road" };

  it("adds the family and says so, asking for the same permission, with the activity key", async () => {
    const { db } = setup();
    const r = await addFamilyAction(null, form(ok));
    expect(r).toEqual({ ok: true, message: "Family added: Nia Okafor · household H-1201 · audit logged", data: { created: true, householdId: NEW_HH, personId: NEW_PERSON, householdNumber: "H-1201" } });
    expect(db.rpcCalls.find((c) => c.fn === "add_household")?.args).toEqual({
      p_center: "center-1",
      p_first: "Nia",
      p_last: "Okafor",
      p_phone: "+15125550188",
      p_email: null,
      p_street: "12 River Road",
      p_none_of_these: false,
    });
    expect(stub.asked).toEqual([{ key: "householdsEdit", doing: "add the family" }]);
    expect(stub.activity).toEqual([{ key: "people.add_household", entity: { kind: "household", id: NEW_HH } }]);
  });

  it("reads the one box as an email when it has an at sign", async () => {
    const { db } = setup();
    await addFamilyAction(null, form({ ...ok, contact: "Nia@Example.org" }));
    expect(db.rpcCalls.find((c) => c.fn === "add_household")?.args).toMatchObject({ p_phone: null, p_email: "nia@example.org" });
  });

  it("answers with the cards of the families that may already be this one, and adds nothing", async () => {
    const { db } = setup({ household_possible_matches: SOME, add_household: { created: false, total: 5, matches: SOME.matches } });
    const r = await addFamilyAction(null, form(ok));
    expect(r).toEqual({
      ok: true,
      message: "Nothing was added. 5 families may already be this one. Open the right one, or say that none of them is the same family.",
      data: {
        created: false,
        total: 5,
        matches: [
          { householdId: ID.hhShah, reasons: ["mobile", "name"], householdNumber: "H-1001", orgHouseholdId: "2041", adults: ["Priya Shah", "Rahul Shah"], city: "Austin", zone: "North" },
          { householdId: ID.hhPatel, reasons: ["last_name"], householdNumber: "H-1002", orgHouseholdId: "2042", adults: ["Nikhil Patel"], city: "Austin", zone: "South" },
        ],
      },
    });
    expect(JSON.stringify(r)).not.toMatch(/Zoya|Aarav/);
    // An unsuccessful add is not recorded against any household.
    expect(stub.activity).toEqual([{ key: "people.add_household", entity: null }]);
    expect(db.rpcCalls.filter((c) => c.fn === "add_household")).toHaveLength(1);
  });

  it("adds it after 'none of these'", async () => {
    const { db } = setup({ add_household: CREATED });
    const r = await addFamilyAction(null, form({ ...ok, none_of_these: "yes" }));
    expect(r).toMatchObject({ ok: true, data: { created: true } });
    expect(db.rpcCalls.find((c) => c.fn === "add_household")?.args).toMatchObject({ p_none_of_these: true });
    expect((await addFamilyAction(null, form({ ...ok, none_of_these: "maybe" }))).ok).toBe(true);
    expect(db.rpcCalls.filter((c) => c.fn === "add_household")[1].args).toMatchObject({ p_none_of_these: false });
  });

  it("answers each mistake, a refusal and a database failure in plain words", async () => {
    setup();
    expect(await addFamilyAction(null, form({ ...ok, first_name: " " }))).toEqual({ ok: false, error: "Could not add the family — enter the first adult's first and last name." });
    expect(await addFamilyAction(null, form({ ...ok, contact: "nia@" }))).toEqual({ ok: false, error: "Could not add the family — that email address does not look right." });
    expect(await addFamilyAction(null, form({ ...ok, contact: "512 55" }))).toMatchObject({ ok: false, error: expect.stringMatching(/^Could not add the family — Enter the mobile number with its area code/) });
    stub.refusal = "Could not add the family — you don't have permission (needs people.manage).";
    expect(await addFamilyAction(null, form(ok))).toEqual({ ok: false, error: stub.refusal });
    setup({}, { failRpc: { add_household: { code: "22023", message: "A first and last name are required" } } });
    expect(await addFamilyAction(null, form(ok))).toEqual({ ok: false, error: "Could not add the family — A first and last name are required." });
  });

  it("works for a name in Chinese", async () => {
    const { db } = setup();
    const r = await addFamilyAction(null, form({ first_name: "明", last_name: "李", contact: "ming@example.org" }));
    expect(r).toMatchObject({ ok: true, message: "Family added: 明 李 · household H-1201 · audit logged" });
    expect(db.rpcCalls.find((c) => c.fn === "add_household")?.args).toMatchObject({ p_first: "明", p_last: "李" });
  });
});

describe("findFamilyMatchesAction", () => {
  const draft = { firstName: "Priya", lastName: "Shah", contact: "", street: "" };

  it("looks, with what was typed, and answers with cards: adults only, never a name alone", async () => {
    const { db } = setup({ household_possible_matches: SOME });
    const r = await findFamilyMatchesAction({ ...draft, contact: "(512) 555-0101" });
    expect(db.rpcCalls.find((c) => c.fn === "household_possible_matches")?.args).toEqual({ p_center: "center-1", p_first: "Priya", p_last: "Shah", p_phone: "+15125550101", p_email: null });
    expect(r).toMatchObject({ ok: true, data: { total: 5, matches: [{ householdId: ID.hhShah, householdNumber: "H-1001", adults: ["Priya Shah", "Rahul Shah"] }, { householdId: ID.hhPatel }] } });
    expect(JSON.stringify(r)).not.toMatch(/Zoya|Aarav/);
    expect(stub.asked).toEqual([{ key: "householdsEdit", doing: "check for families that may already be here" }]);
  });

  it("does not look until there is something to look for, and does not call a half-typed number a mistake", async () => {
    const { db } = setup({ household_possible_matches: SOME });
    expect(await findFamilyMatchesAction({ firstName: "P", lastName: "S", contact: "", street: "" })).toEqual({ ok: true, data: { total: 0, matches: [] } });
    expect(await findFamilyMatchesAction({ firstName: "", lastName: "", contact: "512 55", street: "" })).toEqual({ ok: true, data: { total: 0, matches: [] } });
    expect(db.rpcCalls).toEqual([]);
    await findFamilyMatchesAction({ ...draft, contact: "512 55" });
    expect(db.rpcCalls[0].args).toMatchObject({ p_phone: null, p_email: null });
  });

  it("says why it could not look, and who may not", async () => {
    setup({}, { failRpc: { household_possible_matches: { code: "22023", message: "The People module is not part of this organization" } } });
    expect(await findFamilyMatchesAction(draft)).toEqual({ ok: false, error: "Could not check for families that may already be here — The People module is not part of this organization." });
    setup({}, { failRpc: { household_possible_matches: { code: "42501", message: "Adding a family needs the people.manage permission" } } });
    expect(await findFamilyMatchesAction(draft)).toEqual({ ok: false, error: "Could not check for families that may already be here — you don't have permission to make this change." });
    stub.refusal = "Could not check for families that may already be here — you don't have permission (needs people.manage).";
    expect(await findFamilyMatchesAction(draft)).toEqual({ ok: false, error: stub.refusal });
    setup({}, { modulesOff: ["people"] });
    expect(await findFamilyMatchesAction(draft)).toMatchObject({ ok: false, error: expect.stringContaining("is switched off") });
  });

});
