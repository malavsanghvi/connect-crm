import { describe, expect, it, vi } from "vitest";

import { loadRoleFilter, roleShown } from "@/lib/role-tags";

describe("which roles a kind lists", () => {
  it("an untagged role is listed for every kind", () => {
    expect(roleShown([], ["chamber_of_commerce"])).toBe(true);
    expect(roleShown(null, ["chamber_of_commerce"])).toBe(true);
    expect(roleShown(undefined, ["jain_center"])).toBe(true);
  });
  it("a tagged role is listed for the experiences it names and everything that inherits from them", () => {
    expect(roleShown(["jain_center"], ["jain_center"])).toBe(true);
    expect(roleShown(["jain_center"], ["chamber_of_commerce"])).toBe(false);
    expect(roleShown(["jain_center", "faith_other"], ["church", "faith_other"])).toBe(true);
  });
});

// A stand-in for the two reads the loader makes.
function fakeDb(roles: { data: unknown; error: unknown }, kind: { data: unknown; error: unknown }) {
  return {
    from: (table: string) => ({
      select: () => (table === "roles" ? Promise.resolve(roles) : { eq: () => ({ maybeSingle: () => Promise.resolve(kind) }) }),
    }),
  } as never;
}

describe("loadRoleFilter", () => {
  const tags = { data: [{ key: "boli_recorder", category_keys: ["jain_center"] }, { key: "center_admin", category_keys: [] }, { key: "teacher", category_keys: ["jain_center", "faith_other"] }], error: null };
  it("lists a role by the kind's lineage", async () => {
    const chamber = await loadRoleFilter(fakeDb(tags, { data: { key: "chamber_of_commerce", lineage: ["chamber_of_commerce"] }, error: null }), "chamber_of_commerce");
    expect([chamber("boli_recorder"), chamber("center_admin"), chamber("teacher")]).toEqual([false, true, false]);
    const church = await loadRoleFilter(fakeDb(tags, { data: { key: "church", lineage: ["faith_other", "church"] }, error: null }), "church");
    expect([church("boli_recorder"), church("teacher")]).toEqual([false, true]);
    const jain = await loadRoleFilter(fakeDb(tags, { data: { key: "jain_center", lineage: null }, error: null }), "jain_center");
    expect([jain("boli_recorder"), jain("teacher")]).toEqual([true, true]);
  });
  it("lists every role when the database has no tags yet, quietly", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const missing = await loadRoleFilter(fakeDb({ data: null, error: { code: "42703", message: "column roles.category_keys does not exist" } }, { data: null, error: null }), "chamber_of_commerce");
    expect(missing("boli_recorder")).toBe(true);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
  it("lists every role, and says so in the log, when the read fails for another reason", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = await loadRoleFilter(fakeDb({ data: null, error: { code: "XX000", message: "boom" } }, { data: null, error: null }), "chamber_of_commerce");
    expect(broken("boli_recorder")).toBe(true);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
