import { beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions of the saved views and pins: they check access, check the shape of what came from the browser, write through the
// person's own session and say in words what happened. A write that failed is never "Saved", and the technical detail is logged.

vi.mock("server-only", () => ({}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
const activityKeys: string[] = [];
vi.mock("@/lib/activity/with-activity", () => ({
  withActivity: async (key: string, action: () => Promise<unknown>) => {
    activityKeys.push(key);
    return action();
  },
}));

type Call = { table: string; op: "select" | "insert" | "update" | "delete"; filters: Record<string, unknown>; payload?: unknown; single: boolean };
type Reply = { data?: unknown; error?: { code?: string; message?: string } | null };
let script: (c: Call) => Reply = () => ({ data: [], error: null });
const calls: Call[] = [];

function builder(table: string) {
  const call: Call = { table, op: "select", filters: {}, single: false };
  let touched = false;
  const b: Record<string, unknown> = {};
  const chain = (name: string, fn?: (...a: unknown[]) => void) => {
    b[name] = (...args: unknown[]) => {
      fn?.(...args);
      return b;
    };
  };
  b.select = () => {
    touched = true;
    return b;
  };
  b.insert = (payload: unknown) => {
    call.op = "insert";
    call.payload = payload;
    return b;
  };
  b.update = (payload: unknown) => {
    call.op = "update";
    call.payload = payload;
    return b;
  };
  b.delete = () => {
    call.op = "delete";
    return b;
  };
  for (const f of ["eq", "is", "in", "not"]) chain(f, (col, val) => (call.filters[`${f}:${String(col)}`] = val));
  for (const f of ["limit", "order", "range"]) chain(f);
  b.single = () => {
    call.single = true;
    return b;
  };
  b.maybeSingle = () => {
    call.single = true;
    return b;
  };
  b.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    void touched;
    calls.push(call);
    try {
      const reply = script(call);
      const data = call.single && Array.isArray(reply.data) ? (reply.data[0] ?? null) : reply.data;
      resolve({ data: data ?? null, error: reply.error ?? null });
    } catch (e) {
      reject(e);
    }
  };
  return b;
}

let allowed = true;
const session = { db: { from: (t: string) => builder(t) }, center: { id: "center-1" }, userId: "user-1" };
vi.mock("@/lib/session", () => ({
  authorizeAction: async (_key: string, doing: string) =>
    allowed ? { ok: true, session } : { ok: false, error: `Could not ${doing} — you don't have permission (needs people.view or people.manage).` },
}));

import { deleteViewAction, renameViewAction, saveViewAction, setPinAction } from "@/app/(app)/people/saved-actions";

const UUID = "3f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const HOUSEHOLD = "9b2f6c64-1111-4222-8333-444455556666";
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  calls.length = 0;
  activityKeys.length = 0;
  revalidatePath.mockClear();
  errorSpy.mockClear();
  allowed = true;
  script = () => ({ data: [], error: null });
});

const writes = () => calls.filter((c) => c.op !== "select");
const input = { name: "Adults with no email", list: "people", params: { noemail: "1", band: "adults", q: "Zoya Shah" }, sort: null };

describe("saving a view", () => {
  it("writes the person's own view, without the typed search, last in their order", async () => {
    script = (c) => (c.op === "insert" ? { data: [{ id: UUID, name: "Adults with no email" }] } : { data: [{ id: "a", name: "Old one", position: 3 }] });
    const res = await saveViewAction(input);
    expect(res).toEqual({ ok: true, message: "Saved “Adults with no email”.", data: { id: UUID, name: "Adults with no email" } });
    const insert = writes()[0];
    expect(insert.table).toBe("people_saved");
    expect(insert.payload).toEqual({ center_id: "center-1", user_id: "user-1", kind: "view", name: "Adults with no email", list_view: "people", params: { noemail: "1", band: "adults" }, sort: null, position: 4 });
    expect(JSON.stringify(insert.payload)).not.toContain("Zoya");
    expect(revalidatePath).toHaveBeenCalledWith("/people");
    expect(activityKeys).toEqual(["people.save_view"]);
  });

  it("reads only this person's views in this community to check the name and the limit", async () => {
    script = (c) => (c.op === "insert" ? { data: [{ id: UUID, name: "x" }] } : { data: [] });
    await saveViewAction(input);
    expect(calls[0].filters).toMatchObject({ "eq:center_id": "center-1", "eq:user_id": "user-1", "eq:kind": "view" });
  });

  it("refuses a person without access, and writes nothing", async () => {
    allowed = false;
    const res = await saveViewAction(input);
    expect(res).toEqual({ ok: false, error: "Could not save the view — you don't have permission (needs people.view or people.manage)." });
    expect(calls).toHaveLength(0);
  });

  it("says what is wrong with the name or the list, and writes nothing", async () => {
    expect(await saveViewAction({ ...input, name: "   " })).toEqual({ ok: false, error: "Give the view a name first." });
    expect(await saveViewAction({ ...input, name: "x".repeat(61) })).toMatchObject({ ok: false, error: "Use 60 characters or fewer for the name." });
    expect(await saveViewAction({ ...input, params: { q: "only a search" } })).toMatchObject({ ok: false, error: expect.stringContaining("no filter to save") });
    expect(await saveViewAction({ ...input, list: "reviews" })).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });

  it("refuses a name the person already uses, in any case or script, without writing", async () => {
    script = () => ({ data: [{ id: "a", name: "ADULTS WITH NO EMAIL", position: 0 }] });
    const res = await saveViewAction(input);
    expect(res).toEqual({ ok: false, error: "You already have a saved view called “Adults with no email”. Choose another name, or delete that one first." });
    expect(writes()).toHaveLength(0);
    script = () => ({ data: [{ id: "a", name: "名簿", position: 0 }] });
    expect(await saveViewAction({ ...input, name: "名簿" })).toMatchObject({ ok: false });
    expect(writes()).toHaveLength(0);
  });

  it("stops at the limit in plain words", async () => {
    script = () => ({ data: Array.from({ length: 30 }, (_, i) => ({ id: `v${i}`, name: `View ${i}`, position: i })) });
    const res = await saveViewAction(input);
    expect(res).toEqual({ ok: false, error: "You can keep up to 30 saved views. Delete one you no longer use, then save this one." });
    expect(writes()).toHaveLength(0);
  });

  it("is never 'Saved' when the write failed, says why, and logs the detail", async () => {
    script = (c) => (c.op === "insert" ? { data: null, error: { code: "42501", message: 'new row violates row-level security policy for table "people_saved"' } } : { data: [] });
    const res = await saveViewAction(input);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("Could not save the view — you don't have permission to make this change.");
    expect(errorSpy).toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("turns a duplicate the database caught (two quick saves) into the same plain sentence", async () => {
    script = (c) => (c.op === "insert" ? { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "people_saved_one_view_name"' } } : { data: [] });
    expect(await saveViewAction(input)).toEqual({ ok: false, error: "You already have a saved view called “Adults with no email”. Choose another name, or delete that one first." });
  });

  it("says when the views could not be read, instead of saving blind", async () => {
    script = () => ({ data: null, error: { message: "fetch failed" } });
    const res = await saveViewAction(input);
    expect(res).toMatchObject({ ok: false, error: "Could not save the view — the database could not be reached — check the connection and try again." });
    expect(writes()).toHaveLength(0);
  });
});

describe("renaming a view", () => {
  const mine = [
    { id: UUID, name: "Old name" },
    { id: "other", name: "Seniors" },
  ];

  it("renames only the person's own view", async () => {
    script = (c) => (c.op === "update" ? { data: [{ id: UUID, name: "New name" }] } : { data: mine });
    const res = await renameViewAction({ id: UUID, name: "  New   name " });
    expect(res).toEqual({ ok: true, message: "Renamed to “New name”.", data: { id: UUID, name: "New name" } });
    const update = writes()[0];
    expect(update.payload).toEqual({ name: "New name" });
    expect(update.filters).toMatchObject({ "eq:id": UUID, "eq:center_id": "center-1", "eq:user_id": "user-1", "eq:kind": "view" });
    expect(activityKeys).toEqual(["people.rename_view"]);
  });

  it("refuses a name another of their views has, a view that is not theirs, and a bad id or name", async () => {
    script = () => ({ data: mine });
    expect(await renameViewAction({ id: UUID, name: "seniors" })).toMatchObject({ ok: false, error: expect.stringContaining("already have a saved view called") });
    expect(await renameViewAction({ id: "0b2f6c64-1111-4222-8333-444455556666", name: "Fine" })).toMatchObject({ ok: false, error: expect.stringContaining("not found") });
    expect(await renameViewAction({ id: "nope", name: "Fine" })).toMatchObject({ ok: false });
    expect(await renameViewAction({ id: UUID, name: "" })).toEqual({ ok: false, error: "Give the view a name first." });
    expect(writes()).toHaveLength(0);
  });

  it("lets a view keep its own name (changing the case)", async () => {
    script = (c) => (c.op === "update" ? { data: [{ id: UUID, name: "OLD NAME" }] } : { data: mine });
    expect(await renameViewAction({ id: UUID, name: "OLD NAME" })).toMatchObject({ ok: true });
  });

  it("is not 'Renamed' when no row changed, or the write failed", async () => {
    script = (c) => (c.op === "update" ? { data: [] } : { data: mine });
    expect(await renameViewAction({ id: UUID, name: "New" })).toMatchObject({ ok: false, error: expect.stringContaining("may already have been deleted") });
    script = (c) => (c.op === "update" ? { data: null, error: { code: "XX000", message: "boom" } } : { data: mine });
    const res = await renameViewAction({ id: UUID, name: "New" });
    expect(res).toEqual({ ok: false, error: "Could not rename the view — boom." });
    expect(errorSpy).toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleting a view", () => {
  it("deletes only the person's own view and says nothing else was changed", async () => {
    script = () => ({ data: [{ id: UUID }] });
    const res = await deleteViewAction({ id: UUID });
    expect(res).toEqual({ ok: true, message: "Deleted. Only your saved view is gone: no family or person was changed." });
    expect(calls[0]).toMatchObject({ op: "delete", table: "people_saved" });
    expect(calls[0].filters).toMatchObject({ "eq:id": UUID, "eq:center_id": "center-1", "eq:user_id": "user-1", "eq:kind": "view" });
    expect(activityKeys).toEqual(["people.delete_view"]);
  });

  it("is not 'Deleted' when nothing was deleted or the write failed", async () => {
    script = () => ({ data: [] });
    expect(await deleteViewAction({ id: UUID })).toMatchObject({ ok: false, error: expect.stringContaining("may already have been deleted") });
    script = () => ({ data: null, error: { code: "XX000", message: "boom" } });
    expect(await deleteViewAction({ id: UUID })).toEqual({ ok: false, error: "Could not delete the view — boom." });
    expect(await deleteViewAction({ id: "nope" })).toMatchObject({ ok: false });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("refuses a person without access", async () => {
    allowed = false;
    expect(await deleteViewAction({ id: UUID })).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });
});

describe("pinning a family", () => {
  it("pins a family the person can see, last in their order", async () => {
    script = (c) => {
      if (c.table === "households") return { data: [{ id: HOUSEHOLD }] };
      return c.op === "insert" ? { data: [{ id: "pin-1" }] } : { data: [{ id: "p0", household_id: "other", position: 2 }] };
    };
    const res = await setPinAction({ householdId: HOUSEHOLD, pinned: true });
    expect(res).toEqual({ ok: true, message: "Pinned. It is at the top of the People home.", data: { pinned: true } });
    expect(writes()[0].payload).toEqual({ center_id: "center-1", user_id: "user-1", kind: "pin", household_id: HOUSEHOLD, position: 3 });
    expect(revalidatePath).toHaveBeenCalledWith("/people");
    expect(revalidatePath).toHaveBeenCalledWith(`/households/${HOUSEHOLD}`);
    expect(activityKeys).toEqual(["people.pin_family"]);
  });

  it("reads the family under the person's own session first, and refuses one they cannot see", async () => {
    script = (c) => (c.table === "households" ? { data: [] } : { data: [] });
    const res = await setPinAction({ householdId: HOUSEHOLD, pinned: true });
    expect(res).toEqual({ ok: false, error: "Could not pin the family — it was not found, or you can't see it." });
    expect(calls[0]).toMatchObject({ table: "households" });
    expect(calls[0].filters).toMatchObject({ "eq:id": HOUSEHOLD, "eq:center_id": "center-1", "is:merged_into_id": null });
    expect(writes()).toHaveLength(0);
  });

  it("says 'Already pinned' without a second pin", async () => {
    script = (c) => (c.table === "households" ? { data: [{ id: HOUSEHOLD }] } : { data: [{ id: "p0", household_id: HOUSEHOLD, position: 0 }] });
    expect(await setPinAction({ householdId: HOUSEHOLD, pinned: true })).toEqual({ ok: true, message: "Already pinned.", data: { pinned: true } });
    expect(writes()).toHaveLength(0);
  });

  it("stops at the limit in plain words", async () => {
    script = (c) => (c.table === "households" ? { data: [{ id: HOUSEHOLD }] } : { data: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, household_id: `h${i}`, position: i })) });
    expect(await setPinAction({ householdId: HOUSEHOLD, pinned: true })).toEqual({ ok: false, error: "You can pin up to 40 families. Unpin one you no longer need, then pin this one." });
    expect(writes()).toHaveLength(0);
  });

  it("is not 'Pinned' when the write failed, and logs the detail", async () => {
    script = (c) => {
      if (c.table === "households") return { data: [{ id: HOUSEHOLD }] };
      return c.op === "insert" ? { data: null, error: { code: "23503", message: "fk" } } : { data: [] };
    };
    const res = await setPinAction({ householdId: HOUSEHOLD, pinned: true });
    expect(res).toEqual({ ok: false, error: "Could not pin the family — it refers to a record that does not exist, or other records still depend on it." });
    expect(errorSpy).toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("unpins only the person's own pin of that family", async () => {
    script = () => ({ data: [{ id: "pin-1" }] });
    const res = await setPinAction({ householdId: HOUSEHOLD, pinned: false });
    expect(res).toEqual({ ok: true, message: "Unpinned.", data: { pinned: false } });
    expect(calls[0]).toMatchObject({ op: "delete" });
    expect(calls[0].filters).toMatchObject({ "eq:center_id": "center-1", "eq:user_id": "user-1", "eq:kind": "pin", "eq:household_id": HOUSEHOLD });
    expect(activityKeys).toEqual(["people.unpin_family"]);
    script = () => ({ data: null, error: { code: "XX000", message: "boom" } });
    expect(await setPinAction({ householdId: HOUSEHOLD, pinned: false })).toEqual({ ok: false, error: "Could not unpin the family — boom." });
  });

  it("refuses a bad family id and a person without access", async () => {
    expect(await setPinAction({ householdId: "nope", pinned: true })).toEqual({ ok: false, error: "Could not pin the family — the family was not found." });
    allowed = false;
    expect(await setPinAction({ householdId: HOUSEHOLD, pinned: true })).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });
});
