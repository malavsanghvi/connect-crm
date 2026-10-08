import { describe, expect, it } from "vitest";

import { ownerEmailText, parseKindPreview } from "@/lib/kind-change";

// What app.category_change_preview / app.set_center_category answer (migration 0594).
const preview = {
  center_id: "7b1c0f4e-0000-4000-8000-000000000001",
  center_name: "Houston Chamber",
  from: { key: "jain_center", label: "Jain Center" },
  to: { key: "chamber_of_commerce", label: "Chamber of commerce", active: false },
  changed: true,
  hidden: [{ module: "bolis", label: "Bolis", becomes: "never", records: 120, tables: { bolis: 3, boli_pledges: 117 }, text: "Bolis: 120 records will be hidden, not deleted (117 in boli pledges, 3 in bolis)." }],
  available: [{ module: "store", label: "Store", becomes: "off", text: "Store: becomes available and starts off; it can be switched on in Settings › Modules." }],
  unchanged: 15,
  tradition: { before: "shvetambar_murtipujak", after: "other" },
  paths_kept: 4,
  summary: ["Bolis: 120 records will be hidden, not deleted.", "Words, tabs and shared libraries follow the new category on the next app refresh.", "Nothing is deleted; changing back restores it."],
  email_status: "queued",
};

describe("parseKindPreview", () => {
  it("reads what will be hidden and what becomes available", () => {
    const p = parseKindPreview(preview)!;
    expect(p.from).toEqual({ key: "jain_center", label: "Jain Center" });
    expect(p.to).toEqual({ key: "chamber_of_commerce", label: "Chamber of commerce", active: false });
    expect(p.hidden).toEqual([{ module: "bolis", label: "Bolis", text: expect.stringContaining("120 records") }]);
    expect(p.available.map((l) => l.module)).toEqual(["store"]);
    expect(p.summary).toHaveLength(3);
    expect(p.pathsKept).toBe(4);
    expect(p.emailStatus).toBe("queued");
    expect(p.changed).toBe(true);
  });
  it("copes with a preview that changes nothing", () => {
    const p = parseKindPreview({ from: { key: "a_kind", label: "A" }, to: { key: "a_kind", label: "A", active: true }, changed: false, hidden: [], available: [], summary: [] })!;
    expect(p.changed).toBe(false);
    expect(p.summary).toEqual([]);
    expect(p.emailStatus).toBeNull();
  });
  it("refuses anything else", () => {
    expect(parseKindPreview(null)).toBeNull();
    expect(parseKindPreview({ from: {}, to: {} })).toBeNull();
    expect(parseKindPreview([1, 2])).toBeNull();
  });
});

describe("what happened to the email to the owner", () => {
  it("says so plainly, and never claims an email that was not sent", () => {
    expect(ownerEmailText("queued")).toEqual({ tone: "ok", text: "The owner was emailed." });
    expect(ownerEmailText("no_owner").tone).toBe("warn");
    expect(ownerEmailText("not_set_up").text).toMatch(/could not be emailed/);
    expect(ownerEmailText("failed: bounced").tone).toBe("warn");
    expect(ownerEmailText(null).text).toMatch(/Tell them yourself/);
  });
});
