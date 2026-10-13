import { beforeEach, describe, expect, it, vi } from "vitest";

// The Memberships section's three Server Actions. They are thin: check the shape of what came from the browser, ask for BOTH
// people.approve and people.manage, call the database function (or, for the tier, the SAME people.update_household command the
// screens and Niva share) as the signed-in person, and answer { ok, error } in plain words. The database is the real gate. The
// session and the database are stand-ins.
const stub = vi.hoisted(() => ({
  session: null as unknown,
  refusal: null as string | null,
  asked: [] as { doing: string; needs: string }[],
  activity: [] as { key: string; entity?: unknown }[],
  revalidated: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => stub.revalidated.push(p) }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/activity/with-activity", () => ({
  withActivity: async (key: string, fn: () => Promise<unknown>, opts?: { entityFrom?: unknown }) => {
    stub.activity.push({ key, entity: opts?.entityFrom });
    return fn();
  },
}));
vi.mock("@/lib/session", () => ({
  authorizeAction: vi.fn(async () => (stub.refusal ? { ok: false, error: stub.refusal } : { ok: true, session: stub.session })),
  authorizeActionWhere: vi.fn(async (check: (s: unknown) => boolean, doing: string, needs: string) => {
    stub.asked.push({ doing, needs });
    if (stub.refusal) return { ok: false, error: stub.refusal };
    if (!check(stub.session)) return { ok: false, error: `Could not ${doing} — you don't have permission (needs ${needs}).` };
    return { ok: true, session: stub.session };
  }),
  loadSession: vi.fn(async () => ({ status: "ok", session: stub.session })),
  dbWithReason: vi.fn(async () => (stub.session as { db: unknown }).db),
}));

import { assignMembershipAction, changeTierAction, editMembershipAction } from "@/app/(app)/households/[id]/membership-actions";

import { ID, peopleDb, staffSession } from "./commands/people-fixture";

const MEMBERSHIP = "b0000000-0000-4000-8000-0000000000a1";
const NEW_MEMBERSHIP = "b0000000-0000-4000-8000-0000000000a2";
const HOLDER = ID.priya;
const TYPE = ID.type;

function setup(rpc: Record<string, unknown> = {}, over: { permissions?: string[]; failRpc?: Record<string, { code?: string; message: string }>; modulesOff?: string[]; feePledge?: string | null; failTables?: Record<string, { message: string }> } = {}) {
  const { db, tables } = peopleDb({ rpc: { staff_update_membership: null, staff_assign_membership: NEW_MEMBERSHIP, change_household_tier: null, ...rpc }, failRpc: over.failRpc, failTables: over.failTables });
  tables.memberships.push({ id: NEW_MEMBERSHIP, center_id: "center-1", household_id: ID.hhShah, fee_pledge_id: over.feePledge === undefined ? null : over.feePledge });
  stub.session = staffSession(db, over.permissions, over.modulesOff ? { modulesOff: over.modulesOff } : {});
  stub.refusal = null;
  stub.asked = [];
  stub.activity = [];
  stub.revalidated = [];
  return { db };
}

const edit = (over: Partial<Parameters<typeof editMembershipAction>[0]> = {}) =>
  editMembershipAction({ membershipId: MEMBERSHIP, householdId: ID.hhShah, startsOn: "2026-01-01", endsOn: "2026-12-31", notes: "Paid by cheque 4417", reason: "Corrected from the paper form", ...over });
const assign = (over: Partial<Parameters<typeof assignMembershipAction>[0]> = {}) =>
  assignMembershipAction({ householdId: ID.hhShah, holderId: HOLDER, typeId: TYPE, startsOn: "2026-10-14", endsOn: "2027-10-14", reason: "Paid at the office desk", recordFee: true, ...over });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("editMembershipAction", () => {
  it("calls the database function with the dates, the note and the reason, asks for both permissions, and records the activity", async () => {
    const { db } = setup();
    const r = await edit();
    expect(r).toEqual({ ok: true, message: "Membership saved · audit logged" });
    expect(db.rpcCalls).toEqual([
      { fn: "staff_update_membership", args: { p_membership: MEMBERSHIP, p_starts_on: "2026-01-01", p_ends_on: "2026-12-31", p_notes: "Paid by cheque 4417", p_reason: "Corrected from the paper form" } },
    ]);
    expect(stub.asked).toEqual([{ doing: "save the membership", needs: "people.approve and people.manage" }]);
    expect(stub.activity).toEqual([{ key: "people.edit_membership", entity: { kind: "household", id: ID.hhShah } }]);
    expect(stub.revalidated).toEqual([`/households/${ID.hhShah}`, "/people"]);
  });

  it("sends no end date and no note as null", async () => {
    const { db } = setup();
    expect((await edit({ endsOn: null, notes: null })).ok).toBe(true);
    expect(db.rpcCalls[0].args).toMatchObject({ p_ends_on: null, p_notes: null });
  });

  it("does not understand a request that is not the shape it should be, and calls nothing", async () => {
    const { db } = setup();
    const not = { ok: false, error: "Could not save the membership — the request was not understood. Nothing was changed." };
    expect(await edit({ membershipId: "m1" })).toEqual(not);
    expect(await edit({ householdId: "nope" })).toEqual(not);
    expect(await edit({ startsOn: "2026-02-30" })).toEqual(not);
    expect(await edit({ startsOn: "" })).toEqual(not);
    expect(await edit({ endsOn: "2300-01-01" })).toEqual(not);
    expect(await edit({ notes: "n".repeat(2001) })).toEqual(not);
    expect(await edit({ reason: "r".repeat(1001) })).toEqual(not);
    expect(await editMembershipAction(null as never)).toEqual(not);
    expect(db.rpcCalls).toEqual([]);
    expect(stub.asked).toEqual([]);
  });

  it("refuses, in the access sentence, everyone who does not hold both permissions, and writes nothing", async () => {
    for (const permissions of [["people.view", "people.manage"], ["people.view", "people.approve"], ["people.view"], []]) {
      const { db } = setup({}, { permissions });
      expect(await edit()).toEqual({ ok: false, error: "You don't have access to this area. Nothing was changed." });
      expect(db.rpcCalls).toEqual([]);
      expect(stub.revalidated).toEqual([]);
    }
  });

  it("keeps the sentence for an expired session, and says when the Membership module is off", async () => {
    setup();
    stub.refusal = "Could not save the membership — your session has expired. Sign in again.";
    expect(await edit()).toEqual({ ok: false, error: stub.refusal });
    const { db } = setup({}, { modulesOff: ["membership"] });
    const r = await edit();
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("switched off") });
    expect(db.rpcCalls).toEqual([]);
  });

  it("says what the database said when it refuses for a reason the person can fix, never 'Saved'", async () => {
    setup({}, { failRpc: { staff_update_membership: { code: "22023", message: "An active membership cannot be given an end date in the past. To end it today, choose today as the end date" } } });
    const r = await edit();
    expect(r).toEqual({ ok: false, error: "Could not save the membership — An active membership cannot be given an end date in the past. To end it today, choose today as the end date." });
    expect(stub.revalidated).toEqual([]);
  });

  it("reads a refusal for lack of permission as the access sentence, and keeps a switched-off module's own words", async () => {
    setup({}, { failRpc: { staff_update_membership: { code: "42501", message: "Editing a membership needs the people.approve and people.manage permissions" } } });
    expect(await edit()).toEqual({ ok: false, error: "You don't have access to this area. Nothing was changed." });
    setup({}, { failRpc: { staff_update_membership: { code: "42501", message: "The Membership module is switched off for this community." } } });
    expect(await edit()).toEqual({ ok: false, error: "Could not save the membership — The Membership module is switched off for this community." });
  });

  it("explains a database that could not be reached, in words", async () => {
    setup({}, { failRpc: { staff_update_membership: { message: "fetch failed" } } });
    const r = await edit();
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("Could not save the membership — the database could not be reached") });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("assignMembershipAction", () => {
  it("calls the database function with everything it needs, and says whether a fee pledge was recorded", async () => {
    const { db } = setup({}, { feePledge: "b0000000-0000-4000-8000-0000000000f9" });
    const r = await assign();
    expect(r).toEqual({ ok: true, message: "Membership assigned · audit logged", membershipId: NEW_MEMBERSHIP, feeRecorded: true });
    expect(db.rpcCalls).toEqual([
      {
        fn: "staff_assign_membership",
        args: { p_household: ID.hhShah, p_person: HOLDER, p_type: TYPE, p_starts_on: "2026-10-14", p_ends_on: "2027-10-14", p_reason: "Paid at the office desk", p_record_fee: true },
      },
    ]);
    expect(stub.asked).toEqual([{ doing: "assign the membership", needs: "people.approve and people.manage" }]);
    expect(stub.activity).toEqual([{ key: "people.assign_membership", entity: { kind: "household", id: ID.hhShah } }]);
    expect(stub.revalidated).toEqual([`/households/${ID.hhShah}`, "/people"]);
  });

  it("says no pledge came of it when none was recorded (no fee, or Pledges & donations off), and does not fail", async () => {
    setup({}, { feePledge: null });
    expect(await assign()).toMatchObject({ ok: true, feeRecorded: false });
  });

  it("says it could not tell when the new membership cannot be read back", async () => {
    setup({}, { failTables: { memberships: { message: "connection reset" } } });
    expect(await assign()).toMatchObject({ ok: true, feeRecorded: null, membershipId: NEW_MEMBERSHIP });
    expect(console.error).toHaveBeenCalled();
  });

  it("sends no holder and no end date as null, and never asks for a fee that was not asked for", async () => {
    const { db } = setup();
    await assign({ holderId: null, endsOn: null, recordFee: false });
    expect(db.rpcCalls[0].args).toMatchObject({ p_person: null, p_ends_on: null, p_record_fee: false });
  });

  it("does not understand a request that is not the shape it should be, and calls nothing", async () => {
    const { db } = setup();
    const not = { ok: false, error: "Could not assign the membership — the request was not understood. Nothing was changed." };
    expect(await assign({ householdId: "h1" })).toEqual(not);
    expect(await assign({ holderId: "samira" })).toEqual(not);
    expect(await assign({ typeId: "" })).toEqual(not);
    expect(await assign({ startsOn: "tomorrow" })).toEqual(not);
    expect(await assign({ endsOn: "1800-01-01" })).toEqual(not);
    expect(await assign({ recordFee: "yes" as never })).toEqual(not);
    expect(await assign({ reason: "r".repeat(1001) })).toEqual(not);
    expect(db.rpcCalls).toEqual([]);
  });

  it("refuses, in the access sentence, everyone who does not hold both permissions", async () => {
    for (const permissions of [["people.view", "people.manage"], ["people.view", "people.approve"], ["people.view"]]) {
      const { db } = setup({}, { permissions });
      expect(await assign()).toEqual({ ok: false, error: "You don't have access to this area. Nothing was changed." });
      expect(db.rpcCalls).toEqual([]);
    }
  });

  it("says what the database said: a family that already has one, a child as holder", async () => {
    setup({}, { failRpc: { staff_assign_membership: { code: "22023", message: "This family already has an active Yearly membership (since Jan 1, 2026). To move it to a different tier, use Change tier" } } });
    expect(await assign()).toEqual({ ok: false, error: "Could not assign the membership — This family already has an active Yearly membership (since Jan 1, 2026). To move it to a different tier, use Change tier." });
    setup({}, { failRpc: { staff_assign_membership: { code: "22023", message: "A child cannot be the holder of a membership. Choose an adult of the family" } } });
    expect(await assign()).toMatchObject({ ok: false, error: expect.stringContaining("A child cannot be the holder") });
  });

  it("works for a family and a holder named in other scripts", async () => {
    const { db } = setup();
    expect((await assign({ holderId: ID.rahul })).ok).toBe(true);
    expect(db.rpcCalls[0].args).toMatchObject({ p_person: ID.rahul });
  });
});

describe("changeTierAction", () => {
  it("runs the SAME people.update_household command with the tier and its reason, and says what changed", async () => {
    const { db } = setup();
    const r = await changeTierAction({ householdId: ID.hhShah, tier: "life", reason: "  Paid the life fee at the office  " });
    expect(r).toEqual({ ok: true, message: "The family now holds a Life membership · audit logged" });
    expect(db.rpcCalls.find((c) => c.fn === "change_household_tier")?.args).toEqual({ p_household: ID.hhShah, p_tier: "life", p_reason: "Paid the life fee at the office" });
    expect(stub.activity).toEqual([{ key: "people.update_household", entity: { kind: "household", id: ID.hhShah } }]);
    expect(stub.asked).toEqual([{ doing: "change the membership tier", needs: "people.approve and people.manage" }]);
    expect(stub.revalidated).toContain(`/households/${ID.hhShah}`);
  });

  it("refuses without both permissions, before the command is reached", async () => {
    const { db } = setup({}, { permissions: ["people.view", "people.manage"] });
    expect(await changeTierAction({ householdId: ID.hhShah, tier: "life", reason: "x" })).toEqual({ ok: false, error: "You don't have access to this area. Nothing was changed." });
    expect(db.rpcCalls).toEqual([]);
  });

  it("asks for a reason and understands only a tier it knows", async () => {
    const { db } = setup();
    expect(await changeTierAction({ householdId: ID.hhShah, tier: "life", reason: "   " })).toEqual({
      ok: false,
      error: "Could not change the membership tier — say why the tier is changing (it goes in the audit log).",
    });
    expect(await changeTierAction({ householdId: ID.hhShah, tier: "gold", reason: "x" })).toMatchObject({ ok: false, error: expect.stringContaining("the request was not understood") });
    expect(await changeTierAction({ householdId: "nope", tier: "life", reason: "x" })).toMatchObject({ ok: false });
    expect(db.rpcCalls).toEqual([]);
  });

  it("says what went wrong when the database refuses", async () => {
    setup({}, { failRpc: { change_household_tier: { code: "22023", message: "No life membership type is set up for this center" } } });
    const r = await changeTierAction({ householdId: ID.hhShah, tier: "life", reason: "Paid the life fee" });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("Could not change the membership tier") });
    expect((r as { error: string }).error).toContain("No life membership type is set up");
  });
});
