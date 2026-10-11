import { beforeEach, describe, expect, it, vi } from "vitest";

// The People Server Actions are thin wrappers over the commands now. What is checked here is that each one still answers the
// screen exactly as it always did (same ActionResult, same sentences), that it asks for the same permission with the same
// wording, and that it keeps its activity key. The session and the database are stand-ins.
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
    stub.activity.push({ key, entity: opts?.entityFrom });
    return fn();
  },
}));
vi.mock("@/lib/session", () => ({
  authorizeAction: vi.fn(async (key: string, doing: string) => {
    stub.asked.push({ key, doing });
    return stub.refusal ? { ok: false, error: stub.refusal } : { ok: true, session: stub.session };
  }),
  authorizeActionWhere: vi.fn(),
  dbWithReason: vi.fn(async () => (stub.session as { db: unknown }).db),
}));

import { addPersonAction, dismissDuplicateAction, mergeHouseholdsAction, updateHouseholdAction } from "@/app/(app)/households/actions";
import { decideApplicationAction } from "@/app/(app)/memberships/applications/actions";
import { mergePeopleAction, movePersonAction, updatePersonAction } from "@/app/(app)/people/actions";
import { decideHouseholdRequestAction } from "@/app/(app)/people/requests/actions";
import { dbWithReason } from "@/lib/session";

import { ID, peopleDb, staffSession } from "./commands/people-fixture";

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  return fd;
}

function setup(over: Parameters<typeof peopleDb>[0] = {}) {
  const { db, tables } = peopleDb(over);
  stub.session = staffSession(db);
  stub.refusal = null;
  stub.asked = [];
  stub.activity = [];
  return { db, tables };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(dbWithReason).mockClear();
});

describe("updatePersonAction", () => {
  it("saves what changed and says so, with the same activity key", async () => {
    const { tables } = setup();
    const r = await updatePersonAction(null, form({ id: ID.priya, first_name: "Priya", profession: "Doctor", household_id: ID.hhShah, role: "" }));
    expect(r).toEqual({ ok: true, message: "Saved Priya's profile (profession) · audit logged" });
    expect(tables.people.find((p) => p.id === ID.priya)?.profession).toBe("Doctor");
    expect(stub.activity).toEqual([{ key: "people.update_person", entity: { kind: "person", id: ID.priya } }]);
    expect(stub.asked).toEqual([{ key: "householdsEdit", doing: "save the profile" }]);
  });

  it("answers an unfinished or refused request with the same sentences", async () => {
    setup();
    expect(await updatePersonAction(null, form({ id: "nope" }))).toEqual({ ok: false, error: "Could not save the profile — the person was not found." });
    expect(await updatePersonAction(null, form({ id: ID.priya, first_name: " " }))).toEqual({ ok: false, error: "Could not save the profile — First name is required." });
    stub.refusal = "Could not save the profile — you don't have permission (needs people.manage).";
    expect(await updatePersonAction(null, form({ id: ID.priya, profession: "x" }))).toEqual({ ok: false, error: stub.refusal });
  });

  it("reports a relationship change, and what was saved when the second step fails", async () => {
    setup();
    const r = await updatePersonAction(null, form({ id: ID.rahul, household_id: ID.hhShah, role: "parent" }));
    expect(r).toEqual({ ok: true, message: "Saved Rahul's profile (relationship) · audit logged" });
    setup();
    expect(await updatePersonAction(null, form({ id: ID.rahul, profession: "Chef", household_id: ID.hhShah, role: "primary" }))).toMatchObject({ ok: false });
    expect(await updatePersonAction(null, form({ id: ID.rahul }))).toEqual({ ok: true, message: "No changes to save." });
  });
});

describe("movePersonAction", () => {
  const ok = { id: ID.rahul, from: ID.hhShah, to: ID.hhPatel, role: "parent", first_name: "Rahul" };

  it("moves the person and says so", async () => {
    const { db } = setup();
    const r = await movePersonAction(null, form(ok));
    expect(r).toEqual({ ok: true, message: "Rahul moved · pledges and payments stay with the original household · audit logged" });
    expect(db.rpcCalls.find((c) => c.fn === "move_person_household")?.args).toEqual({ p_person: ID.rahul, p_from: ID.hhShah, p_to: ID.hhPatel, p_role: "parent" });
    expect(stub.asked).toEqual([{ key: "householdsEdit", doing: "move the person" }]);
  });

  it("answers an unfinished form with the same sentences", async () => {
    setup();
    expect(await movePersonAction(null, form({ ...ok, id: "" }))).toEqual({ ok: false, error: "Could not move — the person or their current household was not found." });
    expect(await movePersonAction(null, form({ ...ok, to: "" }))).toEqual({ ok: false, error: "Could not move — choose the household to move to first." });
    expect(await movePersonAction(null, form({ ...ok, role: "primary" }))).toEqual({ ok: false, error: "Could not move — choose their relationship in the new household." });
  });

  it("explains a database refusal in the old words", async () => {
    setup({ failRpc: { move_person_household: { code: "P0001", message: "Choose a different household to move to" } } });
    expect(await movePersonAction(null, form(ok))).toEqual({ ok: false, error: "Could not move Rahul — Choose a different household to move to." });
  });
});

describe("mergePeopleAction", () => {
  it("merges, with the reason on the audit row and the fields taken", async () => {
    const { db } = setup();
    const r = await mergePeopleAction(null, form({ keep: ID.priya, drop: ID.priya2, take: ["email", "phone_e164"], reason: "  Same person  " }));
    expect(r).toEqual({ ok: true, message: "Records merged (2 fields taken from the duplicate) · audit logged" });
    expect(db.rpcCalls.find((c) => c.fn === "merge_people")?.args).toEqual({ p_keep: ID.priya, p_drop: ID.priya2, p_take: ["email", "phone_e164"] });
    expect(dbWithReason).toHaveBeenCalledWith(expect.anything(), "Same person");
    expect(stub.asked).toEqual([{ key: "householdsEdit", doing: "merge the records" }]);
  });

  it("answers an unfinished form, and a refusal, with the same sentences", async () => {
    setup({ failRpc: { merge_people: { code: "P0001", message: "One of the two records was already merged" } } });
    expect(await mergePeopleAction(null, form({ keep: ID.priya }))).toEqual({ ok: false, error: "Could not merge — choose both records first." });
    expect(await mergePeopleAction(null, form({ keep: ID.priya, drop: ID.priya2 }))).toEqual({ ok: false, error: "Could not merge the two records — One of the two records was already merged." });
    expect(dbWithReason).not.toHaveBeenCalled();
  });
});

describe("updateHouseholdAction", () => {
  it("saves what changed, with the same activity key", async () => {
    const { tables } = setup();
    const r = await updateHouseholdAction(null, form({ id: ID.hhShah, display_name: "Shah, Priya, Rahul & Zoya", city: "Pflugerville", tier: "" }));
    expect(r).toEqual({ ok: true, message: "Household saved (city) · audit logged" });
    expect(tables.households.find((h) => h.id === ID.hhShah)?.city).toBe("Pflugerville");
    expect(stub.activity).toEqual([{ key: "people.update_household", entity: { kind: "household", id: ID.hhShah } }]);
    expect(stub.asked).toEqual([{ key: "householdsEdit", doing: "save the household" }]);
  });

  it("keeps the tier rules and sentences", async () => {
    setup();
    expect(await updateHouseholdAction(null, form({ id: "x" }))).toEqual({ ok: false, error: "Could not save the household — it was not found." });
    expect(await updateHouseholdAction(null, form({ id: ID.hhShah, tier: "life" }))).toEqual({ ok: false, error: "Could not save — say why the membership tier is changing (it goes in the audit log)." });
    const { db } = setup();
    const r = await updateHouseholdAction(null, form({ id: ID.hhShah, tier: "life", tier_reason: " Paid at the office " }));
    expect(r).toEqual({ ok: true, message: "Household saved (tier to Life) · audit logged" });
    expect(db.rpcCalls.find((c) => c.fn === "change_household_tier")?.args).toEqual({ p_household: ID.hhShah, p_tier: "life", p_reason: "Paid at the office" });
  });
});

describe("addPersonAction", () => {
  const ok = { household_id: ID.hhShah, first_name: "Meera", last_name: "Shah", role: "parent", date_of_birth: "02/02/1955", gender: "", email: "", phone_e164: "" };

  it("adds the person and returns their id", async () => {
    const { db } = setup();
    const r = await addPersonAction(null, form(ok));
    expect(r).toEqual({ ok: true, message: "Meera Shah added to the household · audit logged", data: { personId: "b0000000-0000-4000-8000-0000000000aa" } });
    expect(db.rpcCalls.find((c) => c.fn === "staff_add_person")?.args).toMatchObject({ p_household: ID.hhShah, p_first: "Meera", p_last: "Shah", p_role: "parent", p_dob: "1955-02-02" });
    expect(stub.asked).toEqual([{ key: "householdsEdit", doing: "add the person" }]);
  });

  it("answers an unfinished form with the same sentences", async () => {
    setup();
    expect(await addPersonAction(null, form({ ...ok, household_id: "" }))).toEqual({ ok: false, error: "Could not add the person — the household was not found." });
    expect(await addPersonAction(null, form({ ...ok, last_name: "" }))).toEqual({ ok: false, error: "Could not add the person — first and last name are required." });
    expect(await addPersonAction(null, form({ ...ok, role: "" }))).toEqual({ ok: false, error: "Could not add the person — choose their relationship to the household." });
    expect(await addPersonAction(null, form({ ...ok, role: "primary" }))).toEqual({ ok: false, error: "Could not add the person — choose their relationship to the household." });
    expect(await addPersonAction(null, form({ ...ok, email: "nope" }))).toEqual({ ok: false, error: "Could not add the person — that email address does not look right." });
  });
});

describe("mergeHouseholdsAction and dismissDuplicateAction", () => {
  it("merge the households with the same message", async () => {
    const { db } = setup();
    const r = await mergeHouseholdsAction(null, form({ keep: ID.hhShah, drop: ID.hhShah2, reason: "" }));
    expect(r).toEqual({ ok: true, message: "Households merged · members moved · the duplicate's giving history stays on it · audit logged" });
    expect(db.rpcCalls.find((c) => c.fn === "merge_households")?.args).toEqual({ p_keep: ID.hhShah, p_drop: ID.hhShah2 });
    expect(await mergeHouseholdsAction(null, form({ keep: ID.hhShah }))).toEqual({ ok: false, error: "Could not merge — choose both households first." });
  });

  it("dismiss a suggested pair once, and say so when it was already resolved", async () => {
    const { tables } = setup();
    expect(await dismissDuplicateAction(null, form({ candidate: ID.candPerson }))).toEqual({ ok: true, message: "Marked as not a duplicate" });
    expect(tables.merge_candidates.find((c) => c.id === ID.candPerson)?.status).toBe("dismissed");
    expect(await dismissDuplicateAction(null, form({ candidate: ID.candPerson }))).toEqual({ ok: false, error: "Could not dismiss — it was already resolved, or you can't change it." });
    expect(await dismissDuplicateAction(null, form({ candidate: "" }))).toEqual({ ok: false, error: "Could not dismiss — the suggested duplicate was not found." });
  });
});

describe("decideApplicationAction", () => {
  it("approves, with the same activity key, permission and sentence", async () => {
    const { tables } = setup();
    const r = await decideApplicationAction(null, form({ id: ID.app, decision: "approve" }));
    expect(r.ok).toBe(true);
    expect(tables.membership_applications[0].status).toBe("approved");
    expect(stub.activity).toEqual([{ key: "people.decide_application", entity: { kind: "application", id: ID.app } }]);
    expect(stub.asked).toEqual([{ key: "applicationsDecide", doing: "approve the application" }]);
  });

  it("declines only with a reason, and answers the old sentences", async () => {
    const { tables } = setup();
    expect(await decideApplicationAction(null, form({ id: ID.app, decision: "reject", reason: "" }))).toEqual({
      ok: false,
      error: "Could not decline the application — give a reason (it is kept for the applicant's record).",
    });
    expect(stub.asked.at(-1)).toEqual({ key: "applicationsDecide", doing: "decline the application" });
    expect(await decideApplicationAction(null, form({ id: ID.app, decision: "maybe" }))).toEqual({ ok: false, error: "Could not record the decision — choose approve or decline." });
    expect(await decideApplicationAction(null, form({ id: ID.app, decision: "reject", reason: "Not a resident" }))).toEqual({ ok: true, message: "Declined. The reason is saved with the application." });
    expect(tables.membership_applications[0].status).toBe("rejected");
  });
});

describe("decideHouseholdRequestAction", () => {
  it("approves with a relationship and declines with a reason, in the old words", async () => {
    const { db } = setup();
    expect(await decideHouseholdRequestAction(null, form({ id: ID.reqAdult, decision: "approve", role: "" }))).toEqual({ ok: false, error: "Could not approve the request — choose their relationship to the household first." });
    expect(await decideHouseholdRequestAction(null, form({ id: ID.reqAdult, decision: "reject", reason: "" }))).toEqual({ ok: false, error: "Could not decline the request — give a reason (it is kept for the household's record)." });
    expect(await decideHouseholdRequestAction(null, form({ id: ID.reqAdult, decision: "approve", role: "parent" }))).toEqual({ ok: true, message: "Request approved — they're now in the household · audit logged" });
    expect(await decideHouseholdRequestAction(null, form({ id: ID.reqAdult, decision: "reject", reason: "Not a relative" }))).toEqual({ ok: true, message: "Request declined · audit logged" });
    expect(db.rpcCalls.filter((c) => c.fn === "decide_household_change_request").map((c) => c.args)).toEqual([
      { p_request: ID.reqAdult, p_decision: "approve", p_role: "parent" },
      { p_request: ID.reqAdult, p_decision: "reject", p_reason: "Not a relative" },
    ]);
    expect(stub.asked.map((a) => a.key)).toEqual(["householdRequestsDecide", "householdRequestsDecide", "householdRequestsDecide", "householdRequestsDecide"]);
    expect(stub.asked.map((a) => a.doing)).toEqual(["approve the request", "decline the request", "approve the request", "decline the request"]);
  });

  it("answers a bad decision or id in the old words", async () => {
    setup();
    expect(await decideHouseholdRequestAction(null, form({ id: ID.reqAdult, decision: "maybe" }))).toEqual({ ok: false, error: "Could not record the decision — choose approve or decline." });
    expect(await decideHouseholdRequestAction(null, form({ id: "x", decision: "approve" }))).toEqual({ ok: false, error: "Could not approve the request — it was not found." });
  });
});
