import { describe, expect, it } from "vitest";

import { LISTS_USERS, ROWING_CLUB, SAMPLE_FLAGGED, SAMPLE_PAYMENTS, samplePaymentsModel } from "@/lib/giving-lists/fixtures";
import {
  flaggedRow,
  grantRow,
  methodChips,
  paymentRow,
  paymentViewChips,
  paymentViewFromParam,
  refundable,
  sourceChips,
  type PaymentIn,
} from "@/lib/giving-lists/payments";
import type { ListContext, ListRow } from "@/lib/giving-lists/types";
import { TODAY_FAMILIES } from "@/lib/giving-today/fixtures";
import { buildQueue } from "@/lib/giving-today/queue";
import { activeGivingTab, givingTabs } from "@/lib/giving-today/tabs";
import { NEUTRAL_KIND } from "@/lib/kind";
import { makeTask, type GivingTaskDetail } from "@/lib/tasks";

const F = TODAY_FAMILIES;

const ctx = (over: Omit<Partial<ListContext>, "can"> & { can?: Partial<ListContext["can"]> } = {}): ListContext => ({
  me: LISTS_USERS.grace,
  currency: "USD",
  locale: "en-US",
  timeZone: "America/Chicago",
  today: "2026-10-12",
  labels: { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" },
  paypalEmailOnly: false,
  ...over,
  can: { manage: true, approve: false, record: true, allocate: true, bankConfirm: true, ...over.can },
});

const byReceipt = (r: string): PaymentIn => {
  const p = SAMPLE_PAYMENTS.find((x) => x.receipt === r)!;
  return { ...p, appliedCents: p.appliedFull };
};
const kinds = (r: ListRow, where: "primary" | "menu") => r[where].map((a) => a.kind);
const rowsOf = (m: { body: { state: string } }) => (m.body as unknown as { rows: ListRow[] }).rows;

describe("a payment row", () => {
  it("says how it came, what is applied and who recorded it; a treasurer can ask for a refund from its menu", () => {
    const r = paymentRow(byReceipt("R-2026-0413"), F.adeyemi, ctx());
    expect(r.title).toBe("Receipt R-2026-0413 · $200.00");
    expect(r.lines).toEqual(["Check · no. 1042 · recorded by hand", "Fully applied to pledges", "Recorded by Ama Mensah", "Waiting for the bank deposit"]);
    expect(r.menu).toContainEqual(expect.objectContaining({ kind: "request_refund", refundableCents: 20_000, reference: "R-2026-0413", label: "Refund…" }));
    expect(r.menu.at(-1)).toEqual({ kind: "link", href: `/households/${F.adeyemi.id}?tab=payments`, label: "Open family" });
  });

  it("writes cheque where English does, for a community outside the United States and Canada", () => {
    expect(paymentRow(byReceipt("R-2026-0413"), F.adeyemi, ctx({ locale: "en-IE", currency: "EUR" })).lines[0]).toMatch(/^Cheque/);
  });

  it("a second approver approves a refund someone else asked for, with the evidence; never their own", () => {
    const p = byReceipt("R-2026-0398");
    const approver = paymentRow(p, F.adeyemi, ctx({ me: LISTS_USERS.lee, can: { manage: false, approve: true } }));
    expect(approver.primary).toEqual([expect.objectContaining({ kind: "approve", table: "payments", label: "Approve $40.00 refund for Adeyemi household 0127" })]);
    expect(approver.lines).toContain("Reason: “Paid twice at the autumn fair”");
    expect(approver.lines.some((l) => l.startsWith("Refund of $40.00 asked by Sam Carter on"))).toBe(true);
    const own = paymentRow(p, F.adeyemi, ctx({ me: LISTS_USERS.sam, can: { approve: true } }));
    expect(own.primary.map((a) => a.kind)).not.toContain("approve");
    expect(own.note).toBe("You asked for this refund, so a different person with approval rights approves it.");
    expect(own.status).toEqual({ label: "Refund asked", tone: "warn" });
  });

  it("an approved refund is recorded the way its provider needs, always naming the amount and the family", () => {
    const stripe = paymentRow(byReceipt("R-2026-0377"), F.kim, ctx());
    expect(stripe.primary).toEqual([expect.objectContaining({ kind: "provider_refund", provider: "stripe", label: "Refund $25.00 to Kim household 0398 through Stripe" })]);
    const paypal = paymentRow(byReceipt("R-2026-0355"), F.lindqvist, ctx());
    expect(paypal.primary).toEqual([expect.objectContaining({ kind: "provider_refund", provider: "paypal" })]);
    const byHand = paymentRow(byReceipt("R-2026-0355"), F.lindqvist, ctx({ paypalEmailOnly: true }));
    expect(byHand.primary).toEqual([expect.objectContaining({ kind: "paypal_refund", label: "Record $60.00 PayPal refund for Lindqvist household 0305" })]);
    const offline = paymentRow({ ...byReceipt("R-2026-0398"), refundSecond: LISTS_USERS.lee }, F.adeyemi, ctx());
    expect(offline.primary).toEqual([expect.objectContaining({ kind: "record_refund", amountCents: 4_000, label: "Record $40.00 refund for Adeyemi household 0127" })]);
    const notTreasurer = paymentRow(byReceipt("R-2026-0377"), F.kim, ctx({ me: LISTS_USERS.lee, can: { manage: false, approve: true } }));
    expect(notTreasurer.primary).toEqual([]);
    expect(notTreasurer.note).toBe("Approved by two people. A treasurer records the refund.");
  });

  it("a recorded refund is said once; one refund request per payment", () => {
    const r = paymentRow(byReceipt("R-2026-0340"), F.fernandez, ctx());
    expect(r.amountNote).toBe("−$100.00 refunded");
    expect(r.note).toBe("Refund of $100.00 recorded. One refund request per payment for now.");
    expect(kinds(r, "menu")).toEqual(["link"]);
  });

  it("a payment not applied yet can be applied by whoever may allocate", () => {
    const r = paymentRow({ ...byReceipt("R-2026-0360"), appliedCents: 0 }, F.nguyen, ctx());
    expect(r.primary).toEqual([expect.objectContaining({ kind: "apply", label: "Apply $120.00 to Nguyen household 0441's pledges" })]);
    expect(paymentRow({ ...byReceipt("R-2026-0360"), appliedCents: null }, F.nguyen, ctx()).primary).toEqual([]);
  });

  it("failed, voided and authorized payments cannot be refunded", () => {
    expect(refundable({ refundedCents: 0, amountCents: 100, status: "failed" })).toBe(false);
    expect(refundable({ refundedCents: 0, amountCents: 100, status: "authorized" })).toBe(false);
    expect(refundable({ refundedCents: 100, amountCents: 100, status: "refunded" })).toBe(false);
    expect(refundable({ refundedCents: 40, amountCents: 100, status: "partially_refunded" })).toBe(true);
  });
});

describe("a refund made in a card provider's dashboard", () => {
  const f = SAMPLE_FLAGGED[0];
  it("needs a treasurer first, then a different approver", () => {
    expect(flaggedRow(f, F.kim, ctx()).primary).toEqual([expect.objectContaining({ kind: "flagged", stage: "first", label: "Approve $15.00 card refund for Kim household 0398 (first approval)" })]);
    const first = { ...f, firstApprover: LISTS_USERS.grace, firstApproverName: "Grace Lindqvist" };
    expect(flaggedRow(first, F.kim, ctx({ can: { approve: true } })).note).toBe("You approved it first, so a different person with approval rights approves it second.");
    expect(flaggedRow(first, F.kim, ctx({ me: LISTS_USERS.lee, can: { manage: false, approve: true } })).primary).toEqual([expect.objectContaining({ stage: "second" })]);
  });
});

describe("grants to match", () => {
  it("open the matching sheet for whoever confirms bank lines, and say the receipt rule", () => {
    const m = samplePaymentsModel("treasurer", { view: "grants" });
    const [open, matched] = rowsOf(m);
    expect(open.primary).toEqual([expect.objectContaining({ kind: "grant_match", grant: "daf", source: "FIDELITY CHARITABLE", label: "Match $250.00…" })]);
    expect(open.lines).toContain("No tax receipt: the fund's sponsor receipts the donor.");
    expect(matched.status.label).toBe("Matched");
    expect(matched.family).toEqual(F.nguyen);
    expect(grantRow({ ...{ id: "g", postedOn: "2026-10-01", amountCents: 1, description: "", payerName: null, reference: null, checkOrSlip: "SLIP 9", kind: "matching_gift", status: "unmatched", matchedFamily: null } }, ctx({ can: { bankConfirm: false } })).note).toBe(
      "A treasurer matches it to the family.",
    );
  });
});

describe("the views of Payments", () => {
  it("All, Refunds, Grants and Recurring, each only when its add-on is on (the counts have their own tab since slice 5)", () => {
    const m = samplePaymentsModel("treasurer");
    expect(m.views.map((v) => v.label)).toEqual(["All payments", "Refunds", "Grants to match", "Recurring"]);
    // Three requests waiting for someone, and one refund made in a card provider's dashboard.
    expect(m.views.find((v) => v.key === "refunds")?.count).toBe(4);
    const off = samplePaymentsModel("treasurer", {}, undefined, { modulesOff: ["giving_recurring", "giving_bank"] });
    expect(off.views.map((v) => v.key)).toEqual(["all", "refunds"]);
  });

  it("an add-on that is off says so at its address, never an empty page", () => {
    const m = samplePaymentsModel("treasurer", { view: "recurring" }, undefined, { modulesOff: ["giving_recurring"] });
    expect(m.body).toMatchObject({ state: "off", title: "Recurring gifts is switched off" });
  });

  it("a finance volunteer sees only what they recorded, never the Refunds or Recurring views", () => {
    const m = samplePaymentsModel("volunteer");
    expect(rowsOf(m).map((r) => r.reference)).toEqual(["R-2026-0413", "R-2026-0322"]);
    expect(m.note).toContain("Limited view");
    expect(m.views.map((v) => v.key)).toEqual(["all", "grants"]);
    expect(rowsOf(m).every((r) => r.menu.every((a) => a.kind === "link"))).toBe(true);
    expect(samplePaymentsModel("volunteer", { view: "recurring" }).body).toMatchObject({ state: "no_access", access: "recurring" });
  });

  it("method and source chips: Zelle only where its plugin is on; one card chip for every card", () => {
    expect(methodChips(null, "en-US", ["zelle"], () => "#").map((c) => c.label)).toContain("Zelle");
    expect(methodChips(null, "en-IE", [], () => "#").map((c) => c.label)).toEqual(["All methods", "Cheque", "Cash", "Card", "Bank transfer", "Stock", "Fund grants and matching gifts", "PayPal or Venmo", "Other"]);
    expect(sourceChips(null, false, () => "#").map((c) => c.key)).toEqual(["", "offline", "online"]);
    const card = samplePaymentsModel("treasurer", { method: "card" });
    expect(rowsOf(card).map((r) => r.reference)).toEqual(["R-2026-0377"]);
    const online = samplePaymentsModel("treasurer", { source: "online" });
    expect(rowsOf(online).map((r) => r.reference)).toEqual(["R-2026-0377", "R-2026-0355"]);
  });

  it("a search by receipt opens the one payment's actions; by amount in euros in a non-faith club", () => {
    const one = samplePaymentsModel("treasurer", { q: "R-2026-0398" });
    expect(one.expandSingle).toBe(true);
    expect(rowsOf(one).map((r) => r.reference)).toEqual(["R-2026-0398"]);
    const euros = samplePaymentsModel("treasurer", { q: "€35" }, ROWING_CLUB);
    expect(rowsOf(euros).map((r) => r.reference)).toEqual(["R-2026-0322"]);
    expect(rowsOf(euros)[0].found).toBe("Found by its amount");
    expect(euros.methods.map((c) => c.label)).not.toContain("Zelle");
  });

  it("old view addresses and the Recurring address light the Payments tab", () => {
    expect(paymentViewFromParam("nonsense")).toBe("all");
    expect(paymentViewChips({ refunds: "no_access", grants: "off", recurring: "on" }, {}, "recurring", () => "#").map((c) => [c.key, c.on])).toEqual([
      ["all", false],
      ["recurring", true],
    ]);
    // The counts moved to their own tab: the old view address is no view of Payments any more (the route sends it on).
    expect(paymentViewFromParam("counts")).toBe("all");
    const tabs = givingTabs({ permissions: ["giving.view", "giving.manage"], isPlatformAdmin: false, modulesOff: [], kind: NEUTRAL_KIND });
    expect(activeGivingTab(tabs, "/giving/recurring")).toBe("payments");
    expect(tabs.map((t) => t.key)).not.toContain("recurring");
  });
});

describe("Today records an approved refund in place, for every provider Weaver can refund (slice 3)", () => {
  const refund = (provider: string): GivingTaskDetail => ({
    kind: "refund",
    stage: "complete",
    id: "5e4d3c2b-0000-4000-8000-000000000003",
    householdId: F.kim.id,
    amountCents: 2_500,
    reference: "R-2026-0377",
    reason: "Charged for a cancelled event",
    askedBy: "Grace Lindqvist",
    mine: false,
    since: "2026-10-08T10:00:00Z",
    provider,
    count: 1,
  });
  const today = (provider: string, paypalEmailOnly = false) => {
    const q = buildQueue(
      {
        tasks: [makeTask("refund", "x", "Record refund", "", [], undefined, refund(provider))],
        taskFailures: [],
        families: { [F.kim.id]: F.kim },
        bank: null,
        behind: null,
        apply: null,
        counts: null,
        close: null,
      },
      {
        can: { approve: false, manage: true, bankConfirm: false, allocate: false, countRecord: false, closeManage: false },
        currency: "USD",
        locale: "en-US",
        timeZone: "America/Chicago",
        today: "2026-10-12",
        labels: { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" },
        countsWord: "Cash counts",
        zelleWord: "Zelle",
        paypalEmailOnly,
        visible: { approvals: true, bank: false, pledges: false, counts: false, books: false },
      },
    );
    return q.rows[0].acts[0];
  };

  it("through Stripe or PayPal (the fresh code is asked for by the database), by hand for a PayPal connected by email", () => {
    expect(today("stripe")).toMatchObject({ kind: "provider_refund", provider: "stripe", label: "Refund $25.00 to Kim household 0398 through Stripe" });
    expect(today("paypal")).toMatchObject({ kind: "provider_refund", provider: "paypal" });
    expect(today("paypal", true)).toMatchObject({ kind: "paypal_refund", label: "Record $25.00 PayPal refund for Kim household 0398" });
    expect(today("offline")).toMatchObject({ kind: "record_refund", label: "Record $25.00 refund for Kim household 0398" });
  });

  it("a provider it cannot refund goes to that one refund in Payments", () => {
    expect(today("square")).toEqual({ kind: "link", href: "/giving/payments?view=refunds&q=R-2026-0377", label: "Refund in Payments", primary: true });
  });
});
