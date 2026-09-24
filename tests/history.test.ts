import { describe, expect, it } from "vitest";

import { clientLabel, diffRecord, fieldLabel, formatValue, historyVerb, normalizeHistoryRows } from "@/lib/history";

describe("diffRecord", () => {
  it("lists only changed fields, before → after, skipping bookkeeping", () => {
    const d = diffRecord(
      { id: "p1", center_id: "c", status: "open", amount_cents: 10100, note: null, updated_at: "a" },
      { id: "p1", center_id: "c", status: "written_off", amount_cents: 10100, note: "Moved away", updated_at: "b" },
    );
    expect(d).toEqual([
      { field: "note", label: "Note", before: "—", after: "Moved away", hidden: false },
      { field: "status", label: "Status", before: "open", after: "written_off", hidden: false },
    ]);
  });
  it("formats money, booleans and objects", () => {
    const d = diffRecord({ amount_cents: 10100, directory_opt_in: false, tags: ["a"] }, { amount_cents: 25100, directory_opt_in: true, tags: ["a", "b"] });
    expect(d.map((c) => [c.label, c.before, c.after])).toEqual([
      ["Amount", "$101.00", "$251.00"],
      ["Directory opt in", "No", "Yes"],
      ["Tags", '["a"]', '["a","b"]'],
    ]);
  });
  it("an insert lists the fields it set; a delete lists what it removed", () => {
    expect(diffRecord(null, { id: "x", name: "Paryushan", notes: null, capacity: 300 }).map((c) => [c.field, c.before, c.after])).toEqual([
      ["capacity", "—", "300"],
      ["name", "—", "Paryushan"],
    ]);
    expect(diffRecord({ id: "x", name: "Old", notes: "" }, null).map((c) => [c.field, c.before, c.after])).toEqual([["name", "Old", "—"]]);
  });
  it("shows masked fields as hidden, never their value", () => {
    const d = diffRecord({ first_name: "A", date_of_birth: null }, { first_name: "A", date_of_birth: "***" });
    expect(d).toEqual([{ field: "date_of_birth", label: "Date of birth", before: "—", after: "hidden", hidden: true }]);
    // Masked on both sides: the log cannot tell whether it changed, so it says nothing.
    expect(diffRecord({ date_of_birth: "***" }, { date_of_birth: "***" })).toEqual([]);
  });
  it("tolerates non-object images", () => {
    expect(diffRecord(null, null)).toEqual([]);
    expect(diffRecord([1] as never, "x")).toEqual([]);
  });
});

describe("labels", () => {
  it("fieldLabel", () => {
    expect(fieldLabel("write_off_reason")).toBe("Write off reason");
    expect(fieldLabel("household_id")).toBe("Household");
    expect(fieldLabel("refund_requested_cents")).toBe("Refund requested");
  });
  it("formatValue", () => {
    expect(formatValue(null)).toBe("—");
    expect(formatValue("***")).toBe("hidden");
    expect(formatValue(5, "qty")).toBe("5");
    expect(formatValue("x".repeat(10) as never)).toBe("xxxxxxxxxx");
    expect(formatValue({ a: "y".repeat(300) }).endsWith("…")).toBe(true);
  });
  it("historyVerb", () => {
    expect(historyVerb("pledges.insert")).toBe("Created");
    expect(historyVerb("pledges.update")).toBe("Changed");
    expect(historyVerb("pledges.delete")).toBe("Deleted");
    expect(historyVerb("refund.approve")).toBe("Refund approve");
  });
  it("clientLabel", () => {
    expect(clientLabel("portal", "/giving/pledges")).toBe("Portal · /giving/pledges");
    expect(clientLabel("member", null)).toBe("Member app");
    expect(clientLabel("job", "")).toBe("Scheduled job");
    expect(clientLabel(null, null)).toBeNull();
  });
});

describe("normalizeHistoryRows", () => {
  it("fills missing columns with null and sorts newest first", () => {
    const rows = normalizeHistoryRows([
      { id: 1, occurred_at: "2026-09-01T00:00:00Z", action: "pledges.insert", after: { a: 1 } },
      { id: 2, occurred_at: "2026-09-02T00:00:00Z", action: "pledges.update", actor_name: "Asha Shah", client_app: "portal", reason: "Fix" },
      null,
    ]);
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
    expect(rows[0].actor_name).toBe("Asha Shah");
    expect(rows[1].module).toBeNull();
    expect(rows[1].before).toBeNull();
  });
  it("returns [] for anything else", () => {
    expect(normalizeHistoryRows(null)).toEqual([]);
    expect(normalizeHistoryRows({})).toEqual([]);
  });
});
