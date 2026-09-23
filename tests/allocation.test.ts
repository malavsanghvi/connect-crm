import { describe, expect, it } from "vitest";

import { orderForAllocation, previewAllocation, type AllocatablePledge } from "@/lib/allocation";

const pledges: AllocatablePledge[] = [
  { id: "c", amount_cents: 10000, paid_cents: 0, pledged_at: "2026-03-01T10:00:00Z", status: "open" },
  { id: "a", amount_cents: 5000, paid_cents: 2000, pledged_at: "2026-01-15T10:00:00Z", status: "partially_paid" },
  { id: "b", amount_cents: 2500, paid_cents: 0, pledged_at: "2026-02-01T10:00:00Z", status: "open" },
  { id: "x", amount_cents: 9999, paid_cents: 9999, pledged_at: "2025-01-01T10:00:00Z", status: "paid" },
  { id: "w", amount_cents: 7000, paid_cents: 0, pledged_at: "2025-06-01T10:00:00Z", status: "written_off" },
];

describe("orderForAllocation", () => {
  it("visits open pledges earliest first and skips closed ones", () => {
    expect(orderForAllocation(pledges).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
  it("uses only the chosen pledges, in the order chosen", () => {
    expect(orderForAllocation(pledges, ["c", "a"]).map((p) => p.id)).toEqual(["c", "a"]);
  });
  it("ignores chosen pledges that are not open", () => {
    expect(orderForAllocation(pledges, ["x", "b"]).map((p) => p.id)).toEqual(["b"]);
  });
});

describe("previewAllocation", () => {
  it("closes the earliest pledge and rolls the overpayment to the next", () => {
    const r = previewAllocation(4000, pledges);
    expect(r.lines).toEqual([
      { pledge_id: "a", amount_cents: 3000, open_before_cents: 3000, open_after_cents: 0, closes: true },
      { pledge_id: "b", amount_cents: 1000, open_before_cents: 2500, open_after_cents: 1500, closes: false },
    ]);
    expect(r.allocated_cents).toBe(4000);
    expect(r.unallocated_cents).toBe(0);
  });

  it("keeps a partly paid pledge open", () => {
    const r = previewAllocation(500, pledges);
    expect(r.lines).toEqual([{ pledge_id: "a", amount_cents: 500, open_before_cents: 3000, open_after_cents: 2500, closes: false }]);
  });

  it("leaves what cannot be placed unallocated", () => {
    const r = previewAllocation(20000, pledges);
    expect(r.lines.map((l) => [l.pledge_id, l.amount_cents, l.closes])).toEqual([
      ["a", 3000, true],
      ["b", 2500, true],
      ["c", 10000, true],
    ]);
    expect(r.unallocated_cents).toBe(4500);
  });

  it("applies only to chosen pledges when some are named", () => {
    const r = previewAllocation(12000, pledges, ["c"]);
    expect(r.lines).toEqual([{ pledge_id: "c", amount_cents: 10000, open_before_cents: 10000, open_after_cents: 0, closes: true }]);
    expect(r.unallocated_cents).toBe(2000);
  });

  it("handles zero, negative and no pledges", () => {
    expect(previewAllocation(0, pledges)).toEqual({ lines: [], allocated_cents: 0, unallocated_cents: 0 });
    expect(previewAllocation(-100, pledges).lines).toEqual([]);
    expect(previewAllocation(5000, [])).toEqual({ lines: [], allocated_cents: 0, unallocated_cents: 5000 });
  });

  it("breaks pledged_at ties deterministically", () => {
    const tie: AllocatablePledge[] = [
      { id: "2", amount_cents: 100, paid_cents: 0, pledged_at: "2026-01-01T00:00:00Z" },
      { id: "1", amount_cents: 100, paid_cents: 0, pledged_at: "2026-01-01T00:00:00Z" },
    ];
    expect(previewAllocation(100, tie).lines[0].pledge_id).toBe("1");
  });
});
