// The Pathshala Server Actions that now run a command (saveClass, addTeacher, saveFeesAction) answer exactly as they did when they did the
// work themselves: the same ActionResult, the same sentences, the same rows written, in the same cases. The expected values below are the
// words and rows of the actions before they ran a command. (One case is deliberately better: a class change that touched no row used to
// say "Class saved."; it now says it could not save.)
import { beforeEach, describe, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({ session: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/activity/with-activity", () => ({
  activityParts: (option: string | { key: string; entityFrom?: unknown; via?: unknown }) =>
    typeof option === "string" ? { key: option, opts: {} } : { key: option.key, opts: { entityFrom: option.entityFrom, via: option.via } },
  withActivity: vi.fn((_key: string, action: () => Promise<unknown>) => action()),
}));
vi.mock("@/lib/pathshala/server", () => ({
  // The real one loads the session; this does the same area check on the held session.
  actionContext: async (check?: (v: unknown) => boolean, denied = "You don't have permission to do that.") => {
    const { FormError } = await import("@/lib/forms");
    const viewer = held.session as { db: unknown; center: { id: string; time_zone: string } };
    if (check && !check(viewer)) throw new FormError(denied);
    return { viewer, supabase: viewer.db, centerId: viewer.center.id, tz: viewer.center.time_zone };
  },
  searchPeople: vi.fn(),
}));

import { refresh } from "next/cache";

import { addTeacher, saveClass } from "@/app/(app)/pathshala/actions";
import { saveFeesAction } from "@/app/(app)/pathshala/terms/[id]/fees/actions";
import { explainError } from "@/lib/errors";

import { ID, learningWorld, traceDb } from "./commands/learning-world";
import { fakeDb, fakeSession, type FakeDbOptions } from "./commands/helpers";

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

const PRINCIPAL = ["pathshala.view", "pathshala.manage"];
const TREASURER = ["pathshala.view", "pathshala.manage", "giving.view", "giving.manage"];

function as(permissions: string[], opts: { world?: FakeDbOptions & { tables: Record<string, Record<string, unknown>[]> }; trace?: Parameters<typeof traceDb>[1] } = {}) {
  const world = opts.world ?? learningWorld();
  const db = fakeDb(world);
  const seen = traceDb(db, opts.trace);
  held.session = fakeSession({ db, permissions, userId: ID.user });
  return { world, db, seen };
}

/** What an action said about a failed database step before it ran a command: "Could not <doing> — <why>." */
const sentence = (doing: string, error: unknown) => {
  const reason = explainError(error);
  return `Could not ${doing} — ${reason}${/[.!?]$/.test(reason) ? "" : "."}`;
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(refresh).mockClear();
});

const CLASS_FORM = { term_id: ID.t1, level_id: ID.lG1, name: "Gujarati 2 · Room D", room: "D", capacity: "12", meets_on: "sunday", starts_time: "10:00", ends_time: "11:00", class_email: "", waitlist_enabled: "on" };

// ---------------------------------------------------------------------------
describe("saveClass", () => {
  it("creates a class with exactly the row the form always wrote, and says what it always said", async () => {
    const { seen } = as(PRINCIPAL);
    expect(await saveClass(null, null, fd(CLASS_FORM))).toStrictEqual({ ok: true, message: "Class created.", data: undefined });
    expect(seen.writes).toStrictEqual([
      {
        op: "insert",
        table: "pathshala_classes",
        payload: { term_id: ID.t1, level_id: ID.lG1, name: "Gujarati 2 · Room D", room: "D", capacity: 12, meets_on: "sunday", starts_time: "10:00", ends_time: "11:00", class_email: null, waitlist_enabled: true, center_id: "center-1" },
        filters: [],
      },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("writes nulls for what was left blank, and no limit for a blank capacity", async () => {
    const { seen } = as(PRINCIPAL);
    await saveClass(null, null, fd({ term_id: ID.t1, level_id: ID.lG1, name: "Gujarati 3", meets_on: "monday" }));
    expect(seen.writes[0].payload).toStrictEqual({ term_id: ID.t1, level_id: ID.lG1, name: "Gujarati 3", room: null, capacity: null, meets_on: "monday", starts_time: null, ends_time: null, class_email: null, waitlist_enabled: false, center_id: "center-1" });
  });

  it("changes a class with every field of the form, the blank ones cleared, and says 'Class saved.'", async () => {
    const { seen } = as(PRINCIPAL);
    expect(await saveClass(ID.c2, null, fd({ ...CLASS_FORM, room: "", capacity: "", starts_time: "", ends_time: "", waitlist_enabled: "" }))).toStrictEqual({ ok: true, message: "Class saved.", data: undefined });
    expect(seen.writes).toStrictEqual([
      {
        op: "update",
        table: "pathshala_classes",
        payload: { term_id: ID.t1, level_id: ID.lG1, name: "Gujarati 2 · Room D", room: null, capacity: null, meets_on: "sunday", starts_time: null, ends_time: null, class_email: null, waitlist_enabled: false },
        filters: [["id", ID.c2]],
      },
    ]);
  });

  it("keeps the form's own sentences for what was typed wrong", async () => {
    as(PRINCIPAL);
    expect(await saveClass(null, null, fd({ ...CLASS_FORM, term_id: "" }))).toStrictEqual({ ok: false, error: "Term is required." });
    expect(await saveClass(null, null, fd({ ...CLASS_FORM, level_id: "" }))).toStrictEqual({ ok: false, error: "Level is required." });
    expect(await saveClass(null, null, fd({ ...CLASS_FORM, name: "" }))).toStrictEqual({ ok: false, error: "Class name is required." });
    expect(await saveClass(null, null, fd({ ...CLASS_FORM, starts_time: "12:00", ends_time: "11:00" }))).toStrictEqual({ ok: false, error: "The class must end after it starts." });
    expect(await saveClass(null, null, fd({ ...CLASS_FORM, starts_time: "noon" }))).toStrictEqual({ ok: false, error: "Start time must be a time." });
    expect(await saveClass(null, null, fd({ ...CLASS_FORM, capacity: "-1" }))).toStrictEqual({ ok: false, error: "Capacity must be at least 0." });
    expect(await saveClass(null, null, fd({ ...CLASS_FORM, capacity: "lots" }))).toStrictEqual({ ok: false, error: "Capacity must be a whole number." });
    expect(await saveClass(null, null, fd({ ...CLASS_FORM, meets_on: "someday" }))).toStrictEqual({ ok: false, error: "Choose a valid meeting day." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses a person who may not change classes, in the sentence it always used", async () => {
    const { seen } = as(["pathshala.view"]);
    expect(await saveClass(null, null, fd(CLASS_FORM))).toStrictEqual({ ok: false, error: "Only the Pathshala principal can change classes." });
    expect(seen.writes).toEqual([]);
  });

  it("explains a database refusal and never says it saved", async () => {
    const error = { code: "23505", message: "duplicate key value violates unique constraint" };
    as(PRINCIPAL, { trace: { failWrites: { pathshala_classes: error } } });
    expect(await saveClass(null, null, fd(CLASS_FORM))).toStrictEqual({ ok: false, error: sentence("create the class", error) });
    as(PRINCIPAL, { trace: { failWrites: { pathshala_classes: error } } });
    expect(await saveClass(ID.c2, null, fd(CLASS_FORM))).toStrictEqual({ ok: false, error: sentence("save the class", error) });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("no longer says 'Class saved.' when the change touched no class", async () => {
    as(PRINCIPAL, { trace: { updatesTouchNothing: true } });
    expect(await saveClass(ID.c2, null, fd(CLASS_FORM))).toStrictEqual({ ok: false, error: "Could not save the class — it was not found, or you don't have permission to change it." });
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("addTeacher", () => {
  const withLogin = () => {
    const w = learningWorld();
    w.tables.center_users = [{ center_id: "center-1", person_id: ID.dev, user_id: "user-dev" }];
    w.tables.role_grants = [];
    return w;
  };

  it("adds the teacher and, when the person may manage roles, gives the class's Teacher role, saying what it always said", async () => {
    const { seen } = as([...PRINCIPAL, "roles.manage"], { world: withLogin() });
    expect(await addTeacher(ID.c2, null, fd({ person_id: ID.dev, role: "assistant" }))).toStrictEqual({
      ok: true,
      message: "Teacher added. They can now open this class under Pathshala → My classes.",
      data: undefined,
    });
    expect(seen.writes).toStrictEqual([
      { op: "insert", table: "pathshala_teachers", payload: { center_id: "center-1", class_id: ID.c2, person_id: ID.dev, role: "assistant" }, filters: [] },
      {
        op: "insert",
        table: "role_grants",
        payload: { center_id: "center-1", user_id: "user-dev", role_key: "teacher", scope_kind: "class", scope_id: ID.c2, granted_by: ID.user, reason: "Assigned as Pathshala teacher" },
        filters: [],
      },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("says what the center admin must do when the person may not manage roles", async () => {
    const { seen } = as(PRINCIPAL, { world: withLogin() });
    expect(await addTeacher(ID.c2, null, fd({ person_id: ID.dev }))).toStrictEqual({
      ok: true,
      message: "Teacher added. Their access to this class must be granted by a center admin in Settings → Roles and access (role: Teacher, scoped to this class).",
      data: undefined,
    });
    expect(seen.writes.map((w) => w.table)).toEqual(["pathshala_teachers"]);
    expect(seen.writes[0].payload).toStrictEqual({ center_id: "center-1", class_id: ID.c2, person_id: ID.dev, role: "teacher" });
  });

  it("says they have not signed in yet when they have no login", async () => {
    as([...PRINCIPAL, "roles.manage"]);
    expect(await addTeacher(ID.c2, null, fd({ person_id: ID.dev }))).toStrictEqual({
      ok: true,
      message: "Teacher added. They haven't signed in yet, so their class access will need to be granted after they do.",
      data: undefined,
    });
  });

  it("says they already had access when they did", async () => {
    const w = withLogin();
    w.tables.role_grants = [{ id: "g1", center_id: "center-1", user_id: "user-dev", role_key: "teacher", scope_id: ID.c2, ends_at: null }];
    const { seen } = as([...PRINCIPAL, "roles.manage"], { world: w });
    expect(await addTeacher(ID.c2, null, fd({ person_id: ID.dev }))).toStrictEqual({ ok: true, message: "Teacher added. They already had teacher access to this class.", data: undefined });
    expect(seen.writes.map((w) => w.table)).toEqual(["pathshala_teachers"]);
  });

  it("keeps the form's own sentences for what was left out or chosen wrong", async () => {
    as(PRINCIPAL);
    expect(await addTeacher(ID.c2, null, fd({}))).toStrictEqual({ ok: false, error: "Teacher is required." });
    expect(await addTeacher(ID.c2, null, fd({ person_id: ID.dev, role: "head" }))).toStrictEqual({ ok: false, error: "Choose a valid role." });
  });

  it("adds a person who is not an adult when it is the screen asking: the office knows its own teachers", async () => {
    // Niva and the palette refuse a person who is not on file as an adult; the person's own screen is not limited (it never was).
    const { seen } = as(PRINCIPAL);
    expect(await addTeacher(ID.c2, null, fd({ person_id: ID.tia, role: "assistant" }))).toMatchObject({ ok: true });
    expect(seen.writes[0].payload).toStrictEqual({ center_id: "center-1", class_id: ID.c2, person_id: ID.tia, role: "assistant" });
  });

  it("refuses a person who may not assign teachers, in the sentence it always used", async () => {
    const { seen } = as(["pathshala.view"]);
    expect(await addTeacher(ID.c2, null, fd({ person_id: ID.dev }))).toStrictEqual({ ok: false, error: "Only the Pathshala principal can assign teachers." });
    expect(seen.writes).toEqual([]);
  });

  it("explains a database refusal (the same teacher twice) and does not touch their role", async () => {
    const error = { code: "23505", message: 'duplicate key value violates unique constraint "pathshala_teachers_class_id_person_id_key"' };
    const { seen } = as([...PRINCIPAL, "roles.manage"], { world: withLogin(), trace: { failWrites: { pathshala_teachers: error } } });
    expect(await addTeacher(ID.c2, null, fd({ person_id: ID.dev }))).toStrictEqual({ ok: false, error: sentence("add the teacher to this class", error) });
    expect(seen.writes.map((w) => w.table)).toEqual(["pathshala_teachers"]);
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("saveFeesAction", () => {
  const J1 = `fee:${ID.lJ1}`;
  const J2 = `fee:${ID.lJ2}`;
  const G1 = `fee:${ID.lG1}`;

  it("saves only the fees that changed, with the reason, and says which levels it saved", async () => {
    const { db } = as(TREASURER);
    expect(await saveFeesAction(ID.t1, null, fd({ [J1]: "130", [J2]: "150", [G1]: "", reason: "The books cost more" }))).toStrictEqual({
      ok: true,
      message: "Fee saved for 2026-27: Jainism 2 $150.00. The change applies to new registrations only.",
      data: undefined,
    });
    expect(db.rpcCalls.filter((c) => c.fn === "set_pathshala_level_fees")).toStrictEqual([
      { fn: "set_pathshala_level_fees", args: { p_term: ID.t1, p_fees: [{ level_id: ID.lJ2, fee_cents: 15000 }], p_reason: "The books cost more" } },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("names every level it saved, in the order of the form, and sends no reason before the lock", async () => {
    const { db } = as(PRINCIPAL);
    expect(await saveFeesAction(ID.t2, null, fd({ [J1]: "$125", [J2]: "Free" }))).toStrictEqual({ ok: true, message: "Fees saved for 2027-28: Jainism 1 $125.00 and Jainism 2 Free.", data: undefined });
    expect(db.rpcCalls.find((c) => c.fn === "set_pathshala_level_fees")!.args).toStrictEqual({
      p_term: ID.t2,
      p_fees: [
        { level_id: ID.lJ1, fee_cents: 12500 },
        { level_id: ID.lJ2, fee_cents: 0 },
      ],
      p_reason: null,
    });
  });

  it("says there is nothing to save when every fee is as it was", async () => {
    const { db } = as(TREASURER);
    expect(await saveFeesAction(ID.t1, null, fd({ [J1]: "130.00", [J2]: "145", [G1]: "" }))).toStrictEqual({ ok: true, message: "Nothing to save: every fee is as it was.", data: undefined });
    expect(await saveFeesAction(ID.t1, null, fd({}))).toStrictEqual({ ok: true, message: "Nothing to save: every fee is as it was.", data: undefined });
    expect(db.rpcCalls.map((c) => c.fn)).not.toContain("set_pathshala_level_fees");
  });

  it("asks for a reason once registration is open", async () => {
    const { db } = as(TREASURER);
    expect(await saveFeesAction(ID.t1, null, fd({ [J2]: "150" }))).toStrictEqual({ ok: false, error: "Registration is open: say why the fees change. The reason is kept in the audit log." });
    expect(db.rpcCalls.map((c) => c.fn)).not.toContain("set_pathshala_level_fees");
  });

  it("keeps the sentences for a fee typed wrong and a level that is gone", async () => {
    as(TREASURER);
    expect(await saveFeesAction(ID.t1, null, fd({ [J2]: "lots", reason: "x" }))).toStrictEqual({ ok: false, error: "The fee for Jainism 2 must be Free or an amount like 130 or 130.50." });
    expect(await saveFeesAction(ID.t1, null, fd({ [J2]: "0.20", reason: "x" }))).toStrictEqual({ ok: false, error: "A fee is $0 (Free) or at least $0.50 (Jainism 2 was $0.20)." });
    expect(await saveFeesAction(ID.t1, null, fd({ "fee:7d0f3b9a-6a39-4d0c-9f43-0a1a1d7cffff": "10", reason: "x" }))).toStrictEqual({
      ok: false,
      error: "One of the levels on this page no longer exists. Reload the page.",
    });
  });

  it("says who may change the fees when the person may not, and what it always said to a person with no access", async () => {
    as(PRINCIPAL);
    expect(await saveFeesAction(ID.t1, null, fd({ [J2]: "150", reason: "x" }))).toStrictEqual({
      ok: false,
      error: "Registration is open, so fees and rules are locked. Only the treasurer (giving.manage) can change them now, with a reason, for new registrations only.",
    });
    as(["pathshala.view"]);
    expect(await saveFeesAction(ID.t2, null, fd({ [J2]: "150" }))).toStrictEqual({ ok: false, error: "Until registration opens the Pathshala principal (pathshala.manage) sets this term's fees and rules." });
    as(["people.view"]);
    expect(await saveFeesAction(ID.t2, null, fd({ [J2]: "150" }))).toStrictEqual({ ok: false, error: "You don't have access to Pathshala fees." });
    as(PRINCIPAL);
    expect(await saveFeesAction(ID.t0, null, fd({ [J1]: "1" }))).toStrictEqual({ ok: false, error: "The term is closed, so its fees and rules cannot change." });
  });

  it("says when the term is gone", async () => {
    as(PRINCIPAL);
    expect(await saveFeesAction(ID.nobody, null, fd({ [J1]: "1" }))).toStrictEqual({
      ok: false,
      error: "That term no longer exists, or it is a draft only the Pathshala principal can see. Reload the page.",
    });
  });

  it("shows the database's own refusal next to what was done, and never says it saved", async () => {
    const world = learningWorld();
    world.failRpc = { set_pathshala_level_fees: { code: "22023", message: "Set the fee for Gujarati 1 before opening registration." } };
    as(TREASURER, { world });
    const r = await saveFeesAction(ID.t1, null, fd({ [J2]: "150", reason: "x" }));
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/^Could not save the fees — /);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reads a database without the Pathshala fees update as the sentence it always gave", async () => {
    const world = learningWorld();
    world.failTables = { pathshala_level_fees: { code: "42P01", message: 'relation "app.pathshala_level_fees" does not exist' } };
    as(PRINCIPAL, { world });
    expect(await saveFeesAction(ID.t2, null, fd({ [J1]: "1" }))).toStrictEqual({ ok: false, error: "This needs the database update that is on its way (Pathshala levels and fees)." });
  });
});
