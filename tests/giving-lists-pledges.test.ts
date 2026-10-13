import { describe, expect, it } from "vitest";

import { LISTS_COMMUNITY, LISTS_ROLES, LISTS_USERS, ROWING_CLUB, SAMPLE_PLEDGES, samplePledgesModel } from "@/lib/giving-lists/fixtures";
import { recordPaymentHref } from "@/lib/giving-lists/links";
import {
  behindBucket,
  behindDays,
  pledgeChipFromParam,
  pledgeRow,
  selectOpen,
  summarizeOpen,
  type OpenPledgeLite,
  type PledgeIn,
} from "@/lib/giving-lists/pledges";
import type { ListContext, ListRow } from "@/lib/giving-lists/types";
import { TODAY_FAMILIES } from "@/lib/giving-today/fixtures";

const TODAY = "2026-10-12";
const TZ = "America/Chicago";
const F = TODAY_FAMILIES;

const ctx = (over: Omit<Partial<ListContext>, "can"> & { can?: Partial<ListContext["can"]> } = {}): ListContext => ({
  me: LISTS_USERS.grace,
  currency: "USD",
  locale: "en-US",
  timeZone: TZ,
  today: TODAY,
  labels: { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" },
  paypalEmailOnly: false,
  ...over,
  can: { manage: true, approve: false, record: true, allocate: true, bankConfirm: true, ...over.can },
});

const lite = (p: Partial<OpenPledgeLite>): OpenPledgeLite => ({
  id: "p",
  amountCents: 10_000,
  paidCents: 0,
  status: "open",
  pledgedAt: "2026-01-01T15:00:00Z",
  dueOn: null,
  writeOffBy: null,
  ...p,
});

const byNumber = (n: string): PledgeIn => SAMPLE_PLEDGES.find((p) => p.number === n)!;
const kinds = (r: ListRow, where: "primary" | "menu") => r[where].map((a) => a.kind);

describe("behind, as giving.pledges_behind counts it (0656)", () => {
  it("runs from the due date", () => {
    expect(behindDays(lite({ dueOn: "2026-10-11" }), TODAY, TZ)).toBe(1);
    expect(behindDays(lite({ dueOn: "2026-10-12" }), TODAY, TZ)).toBe(0);
    expect(behindDays(lite({ dueOn: "2026-11-01" }), TODAY, TZ)).toBe(0);
  });

  it("without a due date, from 30 days after the pledge, on the community's calendar", () => {
    // 2026-09-12 04:00 UTC is still 11 September in Chicago: due 11 October, one day behind; in Dublin it is the 12th.
    expect(behindDays(lite({ pledgedAt: "2026-09-12T04:00:00Z" }), TODAY, TZ)).toBe(1);
    expect(behindDays(lite({ pledgedAt: "2026-09-12T04:00:00Z" }), TODAY, "Europe/Dublin")).toBe(0);
  });

  it("is never counted for a closed or paid-up pledge", () => {
    expect(behindDays(lite({ dueOn: "2026-01-01", status: "paid" }), TODAY, TZ)).toBe(0);
    expect(behindDays(lite({ dueOn: "2026-01-01", paidCents: 10_000 }), TODAY, TZ)).toBe(0);
    expect(behindDays(lite({ dueOn: "2026-01-01", status: "written_off" }), TODAY, TZ)).toBe(0);
  });

  it("falls in the four buckets the command uses", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91, 400].map(behindBucket)).toEqual([null, "d1_30", "d1_30", "d31_60", "d31_60", "d61_90", "d61_90", "d90_plus", "d90_plus"]);
  });
});

describe("the chips and the aging buckets", () => {
  const open = [
    lite({ id: "a", dueOn: "2026-10-01", amountCents: 50_000, paidCents: 10_000 }),
    lite({ id: "b", dueOn: "2026-06-01", writeOffBy: "u" }),
    lite({ id: "c", dueOn: "2026-12-01", pledgedAt: "2026-03-01T15:00:00Z" }),
    lite({ id: "d", status: "partially_paid", paidCents: 2_500, pledgedAt: "2026-10-10T15:00:00Z" }),
  ];

  it("count the open, the behind (with what is owed), the waiting and each bucket", () => {
    const s = summarizeOpen(open, TODAY, TZ);
    expect(s.open).toEqual({ count: 4, cents: 40_000 + 10_000 + 10_000 + 7_500 });
    expect(s.behind).toEqual({ count: 2, cents: 50_000 });
    expect(s.waiting).toBe(1);
    expect(s.buckets.d1_30).toEqual({ count: 1, cents: 40_000 });
    expect(s.buckets.d90_plus).toEqual({ count: 1, cents: 10_000 });
  });

  it("select newest first, and a bucket shows only its own", () => {
    expect(selectOpen(open, "open", null, TODAY, TZ).map((p) => p.id)).toEqual(["d", "c", "b", "a"]);
    expect(selectOpen(open, "behind", null, TODAY, TZ).map((p) => p.id).sort()).toEqual(["a", "b"]);
    expect(selectOpen(open, "waiting", null, TODAY, TZ).map((p) => p.id)).toEqual(["b"]);
    expect(selectOpen(open, "open", "d90_plus", TODAY, TZ).map((p) => p.id)).toEqual(["b"]);
  });

  it("old addresses land on the right chip; the New look opens on Open", () => {
    expect(pledgeChipFromParam(undefined)).toBe("open");
    expect(pledgeChipFromParam("written_off")).toBe("closed");
    expect(pledgeChipFromParam("waiting")).toBe("waiting");
    expect(pledgeChipFromParam("all")).toBe("all");
  });
});

describe("a pledge row acts as Today does", () => {
  it("names the amount and the family, with the household card, never by name alone", () => {
    const r = pledgeRow(byNumber("PL-0455"), F.adeyemi, ctx());
    expect(r.title).toBe("Pledge PL-0455 · $800.00 open of $1,200.00");
    expect(r.family).toEqual(F.adeyemi);
    expect(r.status).toEqual({ label: "12 days behind", tone: "warn" });
    expect(r.menu).toContainEqual({ kind: "record_payment", householdId: F.adeyemi.id, href: recordPaymentHref(F.adeyemi.id), label: "Record payment" });
    expect(r.menu).toContainEqual(expect.objectContaining({ kind: "request_write_off", openCents: 80_000, reference: "PL-0455" }));
    expect(r.menu.at(-1)).toEqual({ kind: "link", href: `/households/${F.adeyemi.id}?tab=pledges`, label: "Open family" });
  });

  it("the second approver sees the evidence and approves; never their own request (the row says so)", () => {
    const p = byNumber("PL-0388");
    const approver = pledgeRow(p, F.okafor2, ctx({ me: LISTS_USERS.lee, can: { manage: false, approve: true } }));
    expect(approver.primary).toEqual([expect.objectContaining({ kind: "approve", table: "pledges", label: "Approve $150.00 write-off for Okafor family 0388" })]);
    expect(approver.lines.join(" ")).toContain("Write-off asked by Grace Lindqvist on");
    expect(approver.lines.join(" ")).toContain("Reason: “Moved away in August”");
    const own = pledgeRow(p, F.okafor2, ctx({ can: { approve: true } }));
    expect(kinds(own, "primary")).toEqual([]);
    expect(own.note).toBe("You asked for this write-off, so a different person with approval rights approves it.");
    expect(kinds(own, "menu")).toContain("withdraw_write_off");
  });

  it("after two approvals a treasurer completes it; anyone else is told who does", () => {
    const p = byNumber("PL-0412");
    expect(pledgeRow(p, F.nguyen, ctx()).primary).toEqual([
      expect.objectContaining({ kind: "complete_write_off", label: "Write off $120.00 for Nguyen household 0441" }),
    ]);
    const approver = pledgeRow(p, F.nguyen, ctx({ me: LISTS_USERS.lee, can: { manage: false, approve: true } }));
    expect(approver.primary).toEqual([]);
    expect(approver.note).toBe("Approved by two people. A treasurer completes the write-off.");
  });

  it("a finance volunteer can record a payment but never asks for a write-off", () => {
    const r = pledgeRow(byNumber("PL-0455"), F.adeyemi, ctx({ me: LISTS_USERS.ama, can: { manage: false, approve: false, allocate: false } }));
    expect(kinds(r, "menu")).toEqual(["record_payment", "link"]);
  });

  it("a treasurer can change an open pledge's due date, not before the day it was pledged (0775); nobody else is offered it", () => {
    const p = byNumber("PL-0455");
    const r = pledgeRow(p, F.adeyemi, ctx());
    expect(r.menu).toContainEqual({
      kind: "change_due",
      id: p.id,
      reference: "PL-0455",
      dueOn: p.dueOn,
      pledgedOn: new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(p.pledgedAt)),
      label: "Change due date…",
    });
    expect(kinds(pledgeRow(p, F.adeyemi, ctx({ can: { manage: false } })), "menu")).not.toContain("change_due");
    expect(kinds(pledgeRow(byNumber("PL-0301"), F.kim, ctx()), "menu")).not.toContain("change_due");
  });

  it("a closed pledge only opens the family; a written-off one says why and what QuickBooks did", () => {
    const r = pledgeRow(byNumber("PL-0301"), F.kim, ctx());
    expect(r.status.label).toBe("Written off");
    expect(r.lines).toContain("Reason: “Hardship”");
    expect(r.lines).toContain("Posted to QuickBooks as a credit memo.");
    expect(kinds(r, "menu")).toEqual(["link"]);
  });
});

describe("the Pledges model (dev preview data, the same pure core)", () => {
  it("opens on Open with every count and the buckets", () => {
    const m = samplePledgesModel("treasurer");
    expect(m.chips.map((c) => [c.label, c.count, c.on])).toEqual([
      ["Open", 6, true],
      ["Behind", 4, false],
      ["Waiting for approval", 2, false],
      ["Closed", 2, false],
      ["All", 8, false],
    ]);
    expect(m.buckets.map((b) => b.label)).toEqual(["1 to 30 days · $800.00", "31 to 60 days · $0.00", "61 to 90 days · $150.00", "Over 90 days · $920.00"]);
    expect(m.body.state === "ok" && m.body.rows).toHaveLength(6);
  });

  it("a search that finds one pledge opens its actions", () => {
    const m = samplePledgesModel("treasurer", { q: "PL-0412" });
    expect(m.expandSingle).toBe(true);
    expect(m.body.state === "ok" && m.body.rows.map((r) => r.reference)).toEqual(["PL-0412"]);
    expect(m.body.state === "ok" && m.body.rows[0].found).toBe("Found by its pledge number");
  });

  it("finds a family by name and by amount, in a non-faith community in euros", () => {
    const m = samplePledgesModel("treasurer", { q: "okafor", status: "all" }, ROWING_CLUB);
    expect(m.body.state === "ok" && m.body.rows.map((r) => r.reference).sort()).toEqual(["PL-0350", "PL-0388"]);
    expect(m.body.state === "ok" && m.body.rows[0].amount).toMatch(/€/);
    const byAmount = samplePledgesModel("treasurer", { q: "€75", status: "all" }, ROWING_CLUB);
    expect(byAmount.body.state === "ok" && byAmount.body.rows.map((r) => r.reference)).toEqual(["PL-0480"]);
  });

  it("Record payment falls back to today's form where the sheet cannot open; a volunteer gets it too", () => {
    expect(samplePledgesModel("treasurer").recordHref).toBe("/giving/payments?record=1");
    expect(samplePledgesModel("volunteer").recordHref).toBe("/giving/payments?record=1");
    expect(samplePledgesModel("approver").recordHref).toBeNull();
    expect(LISTS_ROLES.approver.permissions).not.toContain("giving.manage");
    expect(LISTS_COMMUNITY.currency).toBe("USD");
  });
});
