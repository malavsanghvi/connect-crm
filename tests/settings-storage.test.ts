import { beforeEach, describe, expect, it, vi } from "vitest";

// Settings › Storage: the keeping period of the buckets a community may change (imports, recordings and, from
// migration 0587, homework answers), with the session and the rules writer replaced: what is checked is what the
// action accepts, what it writes and what the page can show for each bucket.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  authorizeAction: async () => ({ ok: true, session: { center: { id: "00000000-0000-4000-8000-000000000001" }, db: {} } }),
}));
const written = vi.fn();
vi.mock("@/lib/data/center-rules-write", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/data/center-rules-write")>();
  return {
    ...real,
    writeCenterRules: async (
      _session: unknown,
      change: { mode: string; rules: Record<string, unknown> },
      expected: number | null,
      what: string,
      message: (version: number) => string,
    ) => {
      written({ change, expected, what });
      return { ok: true as const, message: message(7) };
    },
  };
});

import { saveRetentionAction } from "@/app/(app)/settings/storage/actions";
import { parseStorageOverview, retentionBucket, RETENTION_BUCKETS, STORAGE_AREAS } from "@/lib/setup";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeEach(() => written.mockReset());

describe("the buckets whose retention a community may change", () => {
  it("are imports, recordings and homework answers, each with a row the page can show", () => {
    expect(Object.keys(RETENTION_BUCKETS).sort()).toEqual(["homework", "imports", "recordings"]);
    for (const bucket of Object.keys(RETENTION_BUCKETS)) expect(STORAGE_AREAS[bucket]?.label).toBeTruthy();
    expect(STORAGE_AREAS.homework).toMatchObject({ label: "Homework answers" });
    expect(STORAGE_AREAS.homework?.kept).toMatch(/180 days/);
  });

  it("every bucket the storage overview lists (0587) has a row of its own, so none shows a raw bucket id", () => {
    const listed = ["branding", "content", "photos", "store", "statements", "recordings", "homework", "imports", "org-documents", "exports"];
    expect(listed.filter((b) => !STORAGE_AREAS[b])).toEqual([]);
    const o = parseStorageOverview({
      available: true, limit_bytes: null, used_bytes: 0,
      areas: [{ bucket: "homework", public: false, max_file_bytes: 26214400, types: ["image/jpeg"], files: 0, bytes: 0, retention_days: 180, retention_editable: true, module: "gyan_path", module_on: true }],
    });
    expect(o.areas[0]).toMatchObject({ bucket: "homework", retention_days: 180, retention_editable: true });
    expect(retentionBucket("homework")).toMatchObject({ subject: "Homework answers" });
  });

  it("only the three own names are buckets: nothing is looked up on the object's prototype", () => {
    for (const name of ["", "exports", "statements", "constructor", "toString", "__proto__", "hasOwnProperty"]) expect(retentionBucket(name)).toBeNull();
  });
});

describe("saveRetentionAction", () => {
  it("saves the homework answers' retention (the row 0587 adds to the page used to be refused)", async () => {
    const out = await saveRetentionAction(null, form({ bucket: "homework", days: "180", version: "6" }));
    expect(out).toEqual({ ok: true, message: "Homework answers are kept 180 days · rules version 7 · audit logged" });
    expect(written).toHaveBeenCalledWith({
      change: { mode: "patch", rules: { storage: { retention_days: { homework: 180 } } } },
      expected: 6,
      what: "the retention of homework answers",
    });
  });

  it("still saves imports and recordings", async () => {
    expect(await saveRetentionAction(null, form({ bucket: "imports", days: "30", version: "" }))).toMatchObject({ ok: true, message: "Import files are kept 30 days · rules version 7 · audit logged" });
    expect(await saveRetentionAction(null, form({ bucket: "recordings", days: "45", version: "2" }))).toMatchObject({ ok: true, message: "Recordings are kept 45 days · rules version 7 · audit logged" });
    expect(written.mock.calls.map((c) => c[0].change.rules)).toEqual([
      { storage: { retention_days: { imports: 30 } } },
      { storage: { retention_days: { recordings: 45 } } },
    ]);
  });

  it("refuses every other bucket in plain English and writes nothing", async () => {
    for (const bucket of ["exports", "statements", "org-documents", "constructor", ""]) {
      const out = await saveRetentionAction(null, form({ bucket, days: "30", version: "1" }));
      expect(out).toEqual({ ok: false, error: "Could not save the retention — only import files, recordings and homework answers can be changed. Reload and try again." });
    }
    expect(written).not.toHaveBeenCalled();
  });

  it("checks the number of days (1 to 3,650) and the page's version before writing", async () => {
    expect(await saveRetentionAction(null, form({ bucket: "homework", days: "0", version: "1" }))).toEqual({
      ok: false, error: "Could not save the retention of homework answers — Enter the number of days to keep files, from 1 to 3,650.",
    });
    expect(await saveRetentionAction(null, form({ bucket: "homework", days: "4000", version: "1" }))).toMatchObject({ ok: false });
    expect(await saveRetentionAction(null, form({ bucket: "homework", days: "30", version: "x" }))).toEqual({
      ok: false, error: "Could not save the retention of homework answers — the page is out of date. Reload and try again.",
    });
    expect(written).not.toHaveBeenCalled();
  });
});
