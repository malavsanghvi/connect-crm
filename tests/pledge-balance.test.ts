import { describe, expect, it } from "vitest";

import { orderForAllocation, previewAllocation, type AllocatablePledge } from "@/lib/allocation";
import { composeFamilyGiving, owesLine, pledgeDetail } from "@/lib/giving-actions/family-giving";
import { openTotals, type GlancePledge } from "@/lib/giving-glance/summary";
import { OPEN_PLEDGE_STATUSES, isBankReconciled, openBalanceCents, pledgeStanding, softCreditWaitingCents, stillToPayCents, totalPledges } from "@/lib/pledge-balance";
import { pledgeChips, pledgeChipFromParam, summarizeOpen, behindDays, type OpenPledgeLite } from "@/lib/giving-lists/pledges";
import { pledgeStatusText, pledgeViewFromParam, PLEDGE_VIEWS } from "@/lib/giving";
import { summarizePledges } from "@/lib/home/member-work";
import { pledgeExportLines } from "@/lib/giving-export/csv";

// The Open balance rule (owner, 2026-10-15): amount - paid - soft credit, over pledges that are Open or Partly paid. A pledge in Soft
// credit, Paid or Bank reconciled adds nothing; soft credit is its own figure.

// The household of the prototype (Household.dc.html): $740 pledged - $180 paid - $250 soft credit = $310 open.
const okafor = [
  { id: "P-0412", amount_cents: 12000, paid_cents: 12000, soft_credit_cents: 0, status: "paid", reconciled_at: "2026-01-20T12:00:00Z" },
  { id: "P-0398", amount_cents: 6000, paid_cents: 6000, soft_credit_cents: 0, status: "paid", reconciled_at: null },
  { id: "P-0587", amount_cents: 16000, paid_cents: 0, soft_credit_cents: 16000, status: "soft_credit", reconciled_at: null },
  { id: "P-0601", amount_cents: 30000, paid_cents: 0, soft_credit_cents: 9000, status: "open", reconciled_at: null },
  { id: "P-0633", amount_cents: 10000, paid_cents: 0, soft_credit_cents: 0, status: "open", reconciled_at: null },
];

describe("stillToPayCents and openBalanceCents", () => {
  it("leave soft credit out, never go below zero, and count only Open or Partly paid pledges", () => {
    expect(stillToPayCents({ amount_cents: 30000, paid_cents: 0, soft_credit_cents: 9000 })).toBe(21000);
    expect(stillToPayCents({ amount_cents: 30000, paid_cents: 5000 })).toBe(25000);
    expect(stillToPayCents({ amount_cents: 1000, paid_cents: 900, soft_credit_cents: 500 })).toBe(0);
    expect(openBalanceCents({ amount_cents: 30000, paid_cents: 0, soft_credit_cents: 9000, status: "open" })).toBe(21000);
    expect(openBalanceCents({ amount_cents: 16000, paid_cents: 0, soft_credit_cents: 16000, status: "soft_credit" })).toBe(0);
    expect(openBalanceCents({ amount_cents: 12000, paid_cents: 12000, status: "paid" })).toBe(0);
    expect(openBalanceCents({ amount_cents: 12000, paid_cents: 0, status: "written_off" })).toBe(0);
    expect(OPEN_PLEDGE_STATUSES).toEqual(["open", "partially_paid"]);
  });
});

describe("totalPledges (the household tiles)", () => {
  it("adds up the prototype household: $310 open, $250 soft credit waiting, one pledge Bank reconciled", () => {
    const t = totalPledges(okafor);
    expect(t.openCents).toBe(31000);
    expect(t.openCount).toBe(2);
    expect(t.softCreditCents).toBe(25000);
    expect(t.softCreditCount).toBe(2);
    expect(t.reconciledCents).toBe(12000);
    expect(t.reconciledCount).toBe(1);
  });
  it("shows soft credit as its own figure and never inside Open", () => {
    const t = totalPledges([{ amount_cents: 10000, paid_cents: 0, soft_credit_cents: 10000, status: "soft_credit" }]);
    expect(t.openCents).toBe(0);
    expect(t.softCreditCents).toBe(10000);
  });
});

describe("pledgeStanding", () => {
  it("names Bank reconciled only for a paid pledge with reconciled_at", () => {
    expect(pledgeStanding({ status: "paid", reconciled_at: "2026-01-20T12:00:00Z" })).toBe("bank_reconciled");
    expect(pledgeStanding({ status: "paid", reconciled_at: null })).toBe("paid");
    expect(pledgeStanding({ status: "soft_credit" })).toBe("soft_credit");
    expect(pledgeStanding({ status: "partially_paid" })).toBe("part_paid");
    expect(pledgeStanding({ status: "something_new" })).toBe("open");
    expect(isBankReconciled({ status: "open", reconciled_at: "2026-01-20T12:00:00Z" })).toBe(false);
  });
  it("reports the soft credit waiting on an Open pledge and on a Soft credit pledge, and none elsewhere", () => {
    expect(softCreditWaitingCents({ amount_cents: 30000, paid_cents: 0, soft_credit_cents: 9000, status: "open" })).toBe(9000);
    expect(softCreditWaitingCents({ amount_cents: 16000, paid_cents: 0, soft_credit_cents: 16000, status: "soft_credit" })).toBe(16000);
    expect(softCreditWaitingCents({ amount_cents: 16000, paid_cents: 16000, soft_credit_cents: 0, status: "paid" })).toBe(0);
  });
});

describe("the allocation preview leaves soft credit alone", () => {
  const pledges: AllocatablePledge[] = [
    { id: "a", amount_cents: 30000, paid_cents: 0, soft_credit_cents: 9000, pledged_at: "2026-01-01T10:00:00Z", status: "open" },
    { id: "s", amount_cents: 16000, paid_cents: 0, soft_credit_cents: 16000, pledged_at: "2025-01-01T10:00:00Z", status: "soft_credit" },
    { id: "b", amount_cents: 5000, paid_cents: 0, pledged_at: "2026-02-01T10:00:00Z", status: "open" },
  ];
  it("never selects a Soft credit pledge, however old", () => {
    expect(orderForAllocation(pledges).map((p) => p.id)).toEqual(["a", "b"]);
    expect(orderForAllocation(pledges, ["s", "b"]).map((p) => p.id)).toEqual(["b"]);
  });
  it("applies money only to what is still to pay", () => {
    const r = previewAllocation(30000, pledges);
    expect(r.lines[0]).toEqual({ pledge_id: "a", amount_cents: 21000, open_before_cents: 21000, open_after_cents: 0, closes: true });
    expect(r.lines[1].pledge_id).toBe("b");
    expect(r.unallocated_cents).toBe(4000);
  });
});

describe("one family's giving", () => {
  const rows = okafor.map((p, i) => ({
    id: p.id,
    pledge_number: p.id,
    campaign: null,
    amount_cents: p.amount_cents,
    paid_cents: p.paid_cents,
    soft_credit_cents: p.soft_credit_cents,
    pledged_at: `2026-0${i + 1}-01T10:00:00Z`,
    due_on: null,
    status: p.status,
  }));
  const household = { id: "h", name: "Okafor", number: "H-1042", orgId: null, primary: null, city: null, cardLine: "No. H-1042" };
  it("owes only the Open balance, and keeps soft credit beside it", () => {
    const g = composeFamilyGiving({ household, pledges: rows, payments: [], focus: null });
    expect(g.owesCents).toBe(31000);
    expect(g.pledges.map((p) => p.id)).toEqual(["P-0601", "P-0633"]);
    expect(g.pledges[0].softCreditCents).toBe(9000);
    expect(pledgeDetail(g.pledges[0], "USD")).toContain("$210.00 open");
    expect(pledgeDetail(g.pledges[0], "USD")).toContain("$90.00 soft credit waiting");
    expect(owesLine(g, "USD")).toBe("Owes $310.00 on 2 open pledges.");
  });
});

describe("Giving at a glance", () => {
  const p = (o: Partial<GlancePledge>): GlancePledge => ({
    id: "x",
    household_id: "h",
    person_id: null,
    amount_cents: 10000,
    paid_cents: 0,
    status: "open",
    pledged_on: "2026-01-01",
    due_on: null,
    ...o,
  });
  it("counts amount - paid - soft credit as open, and a Soft credit pledge as not open", () => {
    const t = openTotals([p({ soft_credit_cents: 4000 }), p({ id: "y", status: "soft_credit", soft_credit_cents: 10000 }), p({ id: "z", status: "partially_paid", paid_cents: 2000 })], "2026-10-15", null, null);
    expect(t.cents).toBe(6000 + 8000);
    expect(t.count).toBe(2);
  });
});

describe("the New look's Pledges list", () => {
  const lite = (o: Partial<OpenPledgeLite>): OpenPledgeLite => ({ id: "x", amountCents: 10000, paidCents: 0, status: "open", pledgedAt: "2026-09-01T10:00:00Z", dueOn: null, writeOffBy: null, ...o });
  it("sums the open amount after soft credit and keeps Soft credit pledges out of Open", () => {
    const s = summarizeOpen([lite({ softCreditCents: 3000 }), lite({ id: "y", status: "soft_credit", softCreditCents: 10000 })], "2026-10-15", "America/Chicago");
    expect(s.open).toEqual({ count: 1, cents: 7000 });
  });
  it("is not behind on a pledge that is only still owed in soft credit", () => {
    expect(behindDays(lite({ status: "open", softCreditCents: 10000, dueOn: "2026-09-01" }), "2026-10-15", "America/Chicago")).toBe(0);
    expect(behindDays(lite({ status: "open", dueOn: "2026-09-01" }), "2026-10-15", "America/Chicago")).toBeGreaterThan(0);
  });
  it("has a Soft credit chip with its own count, and All counts it", () => {
    const summary = summarizeOpen([lite({})], "2026-10-15", "America/Chicago");
    const chips = pledgeChips(summary, 4, "soft", null, (k) => `/x?status=${k}`, 2);
    const soft = chips.find((c) => c.key === "soft");
    expect(soft).toMatchObject({ label: "Soft credit", count: 2, on: true });
    expect(chips.find((c) => c.key === "all")?.count).toBe(1 + 4 + 2);
    expect(pledgeChipFromParam("soft")).toBe("soft");
    expect(pledgeChipFromParam("soft_credit")).toBe("soft");
  });
});

describe("the classic Pledges list", () => {
  it("has a Soft credit filter and says Soft credit and Bank reconciled", () => {
    expect(PLEDGE_VIEWS.soft.statuses).toEqual(["soft_credit"]);
    expect(pledgeViewFromParam("soft")).toBe("soft");
    expect(pledgeStatusText("soft_credit", 16000, 0)).toEqual({ label: "Soft credit", tone: "warn" });
    expect(pledgeStatusText("paid", 12000, 12000, "2026-01-20T12:00:00Z")).toEqual({ label: "Bank reconciled", tone: "ok" });
    expect(pledgeStatusText("paid", 12000, 12000, null)).toEqual({ label: "Closed", tone: "ok" });
  });
});

describe("the member app's open pledges card", () => {
  it("leaves the soft credit out of what is left", () => {
    const s = summarizePledges([{ amount_cents: 30000, paid_cents: 0, soft_credit_cents: 9000 }]);
    expect(s.leftCents).toBe(21000);
  });
});

describe("the pledge export", () => {
  const households = new Map([["h", { number: "0388", orgId: "", name: "Nguyen household" }]]);
  it("states soft credit and Bank reconciled, and Open leaves soft credit out", () => {
    const lines = pledgeExportLines(
      [
        { number: "P-1", pledgedOn: "2026-02-01T15:00:00Z", dueOn: null, householdId: "h", campaign: null, status: "open", amountCents: 30000, paidCents: 0, writeOffWaiting: false, softCreditCents: 9000 },
        { number: "P-2", pledgedOn: "2026-02-01T15:00:00Z", dueOn: null, householdId: "h", campaign: null, status: "paid", amountCents: 12000, paidCents: 12000, writeOffWaiting: false, bankReconciled: true },
        { number: "P-3", pledgedOn: "2026-02-01T15:00:00Z", dueOn: null, householdId: "h", campaign: null, status: "paid", amountCents: 6000, paidCents: 6000, writeOffWaiting: false, bankReconciled: false },
        { number: "P-4", pledgedOn: "2026-02-01T15:00:00Z", dueOn: null, householdId: "h", campaign: null, status: "soft_credit", amountCents: 16000, paidCents: 0, writeOffWaiting: false, softCreditCents: 16000 },
      ],
      households as never,
      { currency: "USD" },
    );
    // columns: ... Status(7) Amount(8) Paid(9) Open(10) Currency(11) Write-off(12) Soft credit waiting(13) Bank reconciled(14)
    expect(lines[0].slice(7)).toEqual(["Open", "300.00", "0.00", "210.00", "USD", "", "90.00", ""]);
    expect(lines[1].slice(13)).toEqual(["0.00", "Yes"]);
    expect(lines[2].slice(13)).toEqual(["0.00", "No"]);
    expect(lines[3].slice(7, 11)).toEqual(["Soft credit", "160.00", "0.00", "0.00"]);
    expect(lines[3][13]).toBe("160.00");
  });
});
