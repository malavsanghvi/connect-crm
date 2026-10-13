import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Staff change a member's anniversary, dietary needs and emergency contact from the person slide-over. One thin Server Action: it checks
// the shape of the request, reads the current row (the conflict check) and calls the database function AS THE SIGNED-IN PERSON, so
// the database is the gate and the action only reports it in plain words. The session and the database are stand-ins; the fake function
// does what migration 0723 does (an absent key is left alone, null clears, the row is created when there is none).
const stub = vi.hoisted(() => ({
  session: null as unknown,
  signedOut: false,
  activity: [] as { key: string; entity?: unknown }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/activity/with-activity", () => ({
  withActivity: async (key: string, fn: () => Promise<unknown>, opts?: { entityFrom?: unknown }) => {
    stub.activity.push({ key, entity: opts?.entityFrom });
    return fn();
  },
}));
vi.mock("@/lib/session", () => ({
  authorizeAction: vi.fn(),
  authorizeActionWhere: vi.fn(),
  loadSession: vi.fn(async () => (stub.signedOut ? { status: "signed_out" } : { status: "ok", session: stub.session })),
}));

import { saveProfileDetailsAction, type SaveProfileDetailsInput } from "@/app/(app)/households/[id]/profile-details-actions";
import { CONFLICT_PREFIX } from "@/lib/people-v2/inline-edit";
import { revalidatePath } from "next/cache";

import { fakeDb, fakeSession } from "./commands/helpers";

const C = "center-1";
const PERSON = "b0000000-0000-4000-8000-000000000001";
const CHILD = "b0000000-0000-4000-8000-000000000009";

type Row = Record<string, unknown>;
type Patch = Record<string, unknown>;

type Setup = {
  row?: Row | null;
  permissions?: string[];
  rpcError?: { code?: string; message: string };
  readError?: { code?: string; message: string };
  audit?: Row[];
};

const FULL_ROW: Row = {
  person_id: PERSON,
  center_id: C,
  anniversary: "2009-06-20",
  dietary: ["vegetarian"],
  dietary_other: null,
  emergency_contact_name: "Layla Haddad",
  emergency_contact_relationship: "Sister",
  emergency_contact_phone: "+17135550100",
};

function setup(o: Setup = {}) {
  const rows: Row[] = o.row === null ? [] : [{ ...(o.row ?? FULL_ROW) }];
  const calls: { fn: string; args: { p_person: string; p_patch: Patch; p_reason?: string } }[] = [];
  const db = fakeDb({
    tables: {
      person_profile_details: rows,
      audit_log: o.audit ?? [],
      center_users: [{ center_id: C, user_id: "user-ravi", person_id: "p-ravi" }],
      people: [{ id: "p-ravi", first_name: "Ravi", last_name: "Menon", preferred_name: null }],
    },
    failTables: o.readError ? { person_profile_details: o.readError } : undefined,
    rpc: {
      staff_save_profile_details: (a: Record<string, unknown>) => {
        calls.push({ fn: "staff_save_profile_details", args: a as never });
        const patch = a.p_patch as Patch;
        let row = rows[0];
        if (!row) {
          row = { person_id: a.p_person, center_id: C, anniversary: null, dietary: [], dietary_other: null, emergency_contact_name: null, emergency_contact_relationship: null, emergency_contact_phone: null };
          rows.push(row);
        }
        for (const [k, v] of Object.entries(patch)) row[k] = k === "dietary" && v === null ? [] : v;
        return null;
      },
    },
    failRpc: o.rpcError ? { staff_save_profile_details: o.rpcError } : undefined,
  });
  stub.session = fakeSession({ db, permissions: o.permissions ?? ["people.manage"] });
  stub.signedOut = false;
  stub.activity = [];
  return { rows, calls, db };
}

const save = (over: Partial<SaveProfileDetailsInput> = {}) =>
  saveProfileDetailsAction({
    personId: PERSON,
    fields: { dietary: "vegetarian,nut_allergy" },
    expect: { dietary: "vegetarian" },
    label: "Samira's dietary needs",
    ...over,
  });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockClear();
});

describe("saveProfileDetailsAction", () => {
  it("calls the database function as the signed-in person with only the fields that changed, and refreshes the screens", async () => {
    const { calls, rows } = setup();
    const r = await save();
    expect(r).toEqual({ ok: true, message: "Saved", changed: true });
    expect(calls).toEqual([{ fn: "staff_save_profile_details", args: { p_person: PERSON, p_patch: { dietary: ["vegetarian", "nut_allergy"] } } }]);
    expect(rows[0].dietary).toEqual(["vegetarian", "nut_allergy"]);
    expect(rows[0].emergency_contact_name).toBe("Layla Haddad");
    expect(revalidatePath).toHaveBeenCalledWith("/households", "layout");
    expect(revalidatePath).toHaveBeenCalledWith(`/people/${PERSON}`, "layout");
  });

  it("is recorded in the activity stream under its own key, about the person and nothing else", async () => {
    setup();
    await save();
    expect(stub.activity).toEqual([{ key: "people.save_profile_details", entity: { kind: "person", id: PERSON } }]);
  });

  it("creates the details when the person has none, from nothing seen", async () => {
    const { calls, rows } = setup({ row: null });
    const r = await save({ fields: { anniversary: "2010-07-04" }, expect: { anniversary: "" }, label: "Samira's wedding anniversary" });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(calls[0].args.p_patch).toEqual({ anniversary: "2010-07-04" });
    expect(rows[0].anniversary).toBe("2010-07-04");
  });

  it("clears a group with null, the emergency contact as one unit", async () => {
    const { calls, rows } = setup();
    const r = await save({
      fields: { emergency_contact_name: "", emergency_contact_relationship: "", emergency_contact_phone: "" },
      expect: { emergency_contact_name: "Layla Haddad", emergency_contact_relationship: "Sister", emergency_contact_phone: "+17135550100" },
      label: "Samira's emergency contact",
    });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(calls[0].args.p_patch).toEqual({ emergency_contact_name: null, emergency_contact_relationship: null, emergency_contact_phone: null });
    expect(rows[0].emergency_contact_phone).toBeNull();
    expect(rows[0].dietary).toEqual(["vegetarian"]);
  });

  it("carries names and notes in other scripts through unchanged", async () => {
    const { calls } = setup();
    await save({
      fields: { dietary: "vegetarian,other", dietary_other: "エビ・カニにアレルギー" },
      expect: { dietary: "vegetarian", dietary_other: "" },
    });
    await save({
      fields: { emergency_contact_name: "田中 健", emergency_contact_phone: "+81398765432" },
      expect: { emergency_contact_name: "Layla Haddad", emergency_contact_phone: "+17135550100" },
      label: "Samira's emergency contact",
    });
    expect(calls[0].args.p_patch).toEqual({ dietary: ["vegetarian", "other"], dietary_other: "エビ・カニにアレルギー" });
    expect(calls[1].args.p_patch).toEqual({ emergency_contact_name: "田中 健", emergency_contact_phone: "+81398765432" });
  });

  it("puts the earlier values back as a compensating change with its own reason, which the conflict check lets through", async () => {
    const { calls, rows } = setup();
    await save({ fields: { dietary: "vegetarian,nut_allergy" }, expect: { dietary: "vegetarian" } });
    // Undo: the earlier values, expecting what the first save wrote, with the reason the page gives it.
    const undone = await save({ fields: { dietary: "vegetarian" }, expect: { dietary: "vegetarian,nut_allergy" }, reason: "Undo of dietary needs change" });
    expect(undone).toMatchObject({ ok: true, changed: true });
    expect(calls[1].args).toEqual({ p_person: PERSON, p_patch: { dietary: ["vegetarian"] }, p_reason: "Undo of dietary needs change" });
    expect(rows[0].dietary).toEqual(["vegetarian"]);
  });

  it("does not run an Undo that would overwrite a newer change by someone else", async () => {
    const { calls, rows } = setup({ row: { ...FULL_ROW, dietary: ["vegan"] } });
    const r = await save({ fields: { dietary: "vegetarian" }, expect: { dietary: "vegetarian,nut_allergy" }, reason: "Undo of dietary needs change" });
    expect(r).toMatchObject({ ok: false, kind: "conflict" });
    expect(calls).toHaveLength(0);
    expect(rows[0].dietary).toEqual(["vegan"]);
  });

  it("sends the reason only when there is one", async () => {
    const { calls } = setup();
    await save({ reason: "   " });
    expect(calls[0].args).not.toHaveProperty("p_reason");
  });
});

describe("when someone else changed it first", () => {
  it("writes nothing, says who and when, and gives back every field of the group so Use theirs refreshes it all", async () => {
    const { calls } = setup({
      row: { ...FULL_ROW, dietary: ["vegan", "other"], dietary_other: "no onions" },
      permissions: ["people.manage", "audit.view"],
      audit: [{ center_id: C, record_table: "person_profile_details", record_id: PERSON, occurred_at: "2026-10-13T11:58:00Z", actor_user_id: "user-ravi" }],
    });
    const r = await save();
    expect(r).toMatchObject({ ok: false, kind: "conflict" });
    if (r.ok || r.kind !== "conflict") throw new Error("expected a conflict");
    expect(r.error.startsWith(CONFLICT_PREFIX)).toBe(true);
    expect(r.conflict).toEqual({ theirs: { dietary: "vegan,other", dietary_other: "no onions" }, who: "Ravi", at: "2026-10-13T11:58:00Z" });
    expect(calls).toHaveLength(0);
  });

  it("still conflicts, without a name, for someone who may not read the history", async () => {
    setup({ row: { ...FULL_ROW, anniversary: "2011-01-01" } });
    const r = await save({ fields: { anniversary: "2010-07-04" }, expect: { anniversary: "2009-06-20" }, label: "Samira's wedding anniversary" });
    if (r.ok || r.kind !== "conflict") throw new Error("expected a conflict");
    expect(r.conflict).toEqual({ theirs: { anniversary: "2011-01-01" }, who: null, at: null });
  });

  it("is not a conflict when the other change left this value as the person saw it, or in another order", async () => {
    const { calls } = setup({ row: { ...FULL_ROW, dietary: ["vegetarian", "vegan"] } });
    const r = await save({ fields: { dietary: "vegan" }, expect: { dietary: "vegan,vegetarian" } });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(calls).toHaveLength(1);
  });

  it("does nothing, and says so, when the value is already what was asked for", async () => {
    const { calls } = setup();
    const r = await save({ fields: { dietary: "vegetarian" }, expect: { dietary: "" } });
    expect(r).toEqual({ ok: true, message: "No changes to save.", changed: false });
    expect(calls).toHaveLength(0);
  });
});

describe("refusals, in words", () => {
  it("says 'You don't have access to this area' for someone without people.manage, before asking the database anything", async () => {
    const { calls, db } = setup({ permissions: ["people.view"] });
    const r = await save();
    expect(r).toEqual({ ok: false, kind: "access", error: "You don't have access to this area. Samira's dietary needs was not changed." });
    expect(calls).toHaveLength(0);
    expect(db.calls).toHaveLength(0);
  });

  it("says the same when the database refuses (the real gate), and logs the detail on the server", async () => {
    setup({ rpcError: { code: "42501", message: "Changing a member's details needs the people.manage permission" } });
    const r = await save();
    expect(r).toMatchObject({ ok: false, kind: "access" });
    if (r.ok) throw new Error("expected a refusal");
    expect(r.error).toMatch(/^You don't have access to this area\./);
    expect(console.error).toHaveBeenCalled();
  });

  it("brings the database's own sentence through for a value it will not keep", async () => {
    setup({ rpcError: { code: "23514", message: "The wedding anniversary cannot be in the future." } });
    const r = await save({ fields: { anniversary: "2030-01-01" }, expect: { anniversary: "2009-06-20" }, label: "Samira's wedding anniversary" });
    expect(r).toEqual({ ok: false, kind: "other", error: "Could not save Samira's wedding anniversary — The wedding anniversary cannot be in the future." });
  });

  it("says in words when the database cannot be reached, and never says Saved", async () => {
    setup({ rpcError: { message: "fetch failed" } });
    const r = await save();
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected a failure");
    expect(r.error).toContain("Could not save Samira's dietary needs");
    expect(r.error).toContain("could not be reached");
    expect(r.error).not.toMatch(/saved/i);
  });

  it("says so when the current details cannot be read, and writes nothing", async () => {
    const { calls } = setup({ readError: { message: "connection reset" } });
    const r = await save();
    expect(r).toMatchObject({ ok: false });
    if (r.ok) throw new Error("expected a failure");
    expect(r.error).toContain("Could not save Samira's dietary needs");
    expect(calls).toHaveLength(0);
  });

  it("asks for a new sign-in when the session has ended", async () => {
    setup();
    stub.signedOut = true;
    const r = await save();
    expect(r).toEqual({ ok: false, kind: "other", error: "Could not save Samira's dietary needs — your session has expired. Sign in again." });
  });

  it("refuses a request that is not shaped right, without touching the database", async () => {
    const { calls, db } = setup();
    const label = "Samira's dietary needs";
    const cases: [Partial<SaveProfileDetailsInput>, RegExp][] = [
      [{ fields: { center_id: "x" } }, /cannot be changed here/],
      [{ fields: { person_id: PERSON } }, /cannot be changed here/],
      [{ expect: { first_name: "x" } }, /cannot be changed here/],
      [{ fields: {} }, /nothing to change/],
      [{ fields: { anniversary: "06/20/2009" } }, /date was not understood/],
      [{ fields: { dietary: "Vegan;drop" } }, /dietary choice was not understood/],
      [{ fields: { emergency_contact_phone: "7135550100" } }, /country code/],
      [{ fields: { dietary_other: "x".repeat(2001) } }, /too long/],
      [{ personId: "not-a-uuid" }, /person was not found/],
    ];
    for (const [over, expected] of cases) {
      const r = await save({ ...over, label });
      expect(r.ok, JSON.stringify(over)).toBe(false);
      if (r.ok) continue;
      expect(r.error).toMatch(/^Could not save Samira's dietary needs — /);
      expect(r.error).toMatch(expected);
    }
    expect(calls).toHaveLength(0);
    expect(db.calls).toHaveLength(0);
  });
});

describe("a child's details", () => {
  it("are saved the same way: dietary needs and an emergency contact matter for a child", async () => {
    const { calls } = setup({ row: null });
    const r = await save({
      personId: CHILD,
      fields: { dietary: "nut_allergy", emergency_contact_name: "Layla Haddad", emergency_contact_relationship: "Mother", emergency_contact_phone: "+17135550100" },
      expect: { dietary: "", emergency_contact_name: "", emergency_contact_relationship: "", emergency_contact_phone: "" },
      label: "Zoya's emergency contact",
    });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(calls[0].args.p_person).toBe(CHILD);
    expect(stub.activity[0].entity).toEqual({ kind: "person", id: CHILD });
  });

  it("are not offered to Niva or the palette: no command touches them, and the action imports no assistant code", () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
    for (const f of files(join(process.cwd(), "src", "lib", "commands", "catalog"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/person_profile_details|staff_save_profile_details|emergency_contact/);
    }
    const source = readFileSync(join(process.cwd(), "src", "app", "(app)", "households", "[id]", "profile-details-actions.ts"), "utf8");
    const imports = source.split("\n").filter((l) => l.startsWith("import")).join("\n");
    expect(imports).not.toMatch(/commands\/(?!revalidate)|assistant|anthropic|niva|\/ai\b/i);
  });
});
