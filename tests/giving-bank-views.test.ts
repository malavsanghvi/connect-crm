import { describe, expect, it } from "vitest";

import { sampleBankModel } from "@/lib/giving-bank/fixtures";
import {
  bankViewFromParam,
  bankViewKeys,
  depositRows,
  historyRowView,
  matchRows,
  pairPayouts,
  payoutRowView,
  type BankPayoutLineIn,
  type ProviderPayoutIn,
} from "@/lib/giving-bank/views";
import type { DepositLineIn, Family, GiftLineIn } from "@/lib/giving-today/queue";

// Giving › Bank (New look, docs/GIVING_REDESIGN.md slice 4): the pure core. A community club in dollars with Zelle, and an
// allotment society in pounds without it; neither is a faith community.

const USD = { currency: "USD", locale: "en-US", timeZone: "America/Chicago", today: "2026-10-12", zelleWord: "Zelle" };
const GBP = { currency: "GBP", locale: "en-GB", timeZone: "Europe/London", today: "2026-10-12", zelleWord: "Zelle" };
const fam = (name: string, number: string): Family => ({ id: `id-${number}`, name, number, orgId: `X-${number}`, primary: "Alex Morgan", city: "Lakeside" });

const gift = (id: string, cents: number, suggestions: GiftLineIn["suggestions"], originatorKind: string | null = null): GiftLineIn => ({
  id,
  postedOn: "2026-10-05",
  amountCents: cents,
  description: `LINE ${id}`,
  payerName: "PAYER",
  originatorKind,
  suggestions,
  suggestionError: null,
});

describe("which views a community has", () => {
  it("shows Zelle only with Zelle and Card payouts only with Accounting", () => {
    expect(bankViewKeys({ zelle: true, payouts: true })).toEqual(["match", "deposits", "zelle", "payouts", "history"]);
    expect(bankViewKeys({ zelle: false, payouts: false })).toEqual(["match", "deposits", "history"]);
  });

  it("lands the classic screen's addresses in the right view, and an unavailable view on To match", () => {
    const on = { zelle: true, payouts: false };
    expect(bankViewFromParam("gifts", undefined, on)).toEqual({ view: "match", history: "matched" });
    expect(bankViewFromParam("debits", undefined, on)).toEqual({ view: "history", history: "out" });
    expect(bankViewFromParam("ignored", undefined, on)).toEqual({ view: "history", history: "ignored" });
    expect(bankViewFromParam("history", "out", on)).toEqual({ view: "history", history: "out" });
    expect(bankViewFromParam("zelle", undefined, on).view).toBe("zelle");
    expect(bankViewFromParam("payouts", undefined, on).view).toBe("match");
    expect(bankViewFromParam("zelle", undefined, { zelle: false, payouts: true }).view).toBe("match");
    expect(bankViewFromParam(undefined, undefined, on).view).toBe("match");
  });
});

describe("To match and Deposits use Today's rows", () => {
  const adeyemi = fam("Adeyemi household", "0127");
  const exact = [
    { reportId: "r1", bankTransactionId: "g1", amountCents: 5_000, sentOn: "2026-10-08", postedOn: "2026-10-09", confirmation: "ZL1", payerName: null, family: adeyemi },
  ];
  const gifts = [gift("g1", 5_000, []), gift("g2", 12_000, [{ family: adeyemi, reason: "Learned payer name", ambiguous: false, reportId: null }])];

  it("puts the Zelle exact matches first and leaves their lines out of the gift rows", () => {
    const rows = matchRows(gifts, exact, USD, true);
    expect(rows.map((r) => r.row.id)).toEqual(["bank:zelle-exact", "bank:gift:g2"]);
    expect(rows[0].line).toBeNull();
    expect(rows[1].line).toEqual({ id: "g2", amount: "$120.00" });
    const act = rows[1].row.acts[0];
    expect(act.kind === "gift" && act.best?.label).toBe("Confirm $120.00 for Adeyemi household 0127");
  });

  it("names the amount in the community's currency", () => {
    const rows = matchRows([gift("p1", 12_000, [{ family: fam("Price household", "0214"), reason: "", ambiguous: false, reportId: null }])], null, GBP, true);
    const act = rows[0].row.acts[0];
    expect(act.kind === "gift" && act.best?.label).toBe("Confirm £120.00 for Price household 0214");
  });

  it("never confirms an ambiguous family in one click, and lets a line with no suggestion be found in the sheet", () => {
    const rows = matchRows(
      [
        gift("a1", 25_000, [
          { family: fam("Okafor household", "0212"), reason: "Surname", ambiguous: true, reportId: null },
          { family: fam("Okafor family", "0388"), reason: "Surname", ambiguous: true, reportId: null },
        ]),
        gift("n1", 50_000, [], "daf"),
      ],
      null,
      USD,
      true,
    );
    expect(rows[0].row.acts[0]).toMatchObject({ kind: "gift", best: null });
    const others = rows[0].row.acts[0].kind === "gift" ? rows[0].row.acts[0].others : [];
    expect(others.every((o) => o.ambiguous)).toBe(true);
    // A fund grant is never learned as the family's payer name.
    expect(rows[1].row.acts[0]).toMatchObject({ kind: "gift", best: null, others: [], learnPayer: false });
    expect(rows[1].row.title).toBe("Donor-advised fund grant $500.00: choose the family");
  });

  it("lists the lines without buttons for someone who may only look", () => {
    const rows = matchRows(gifts, exact, USD, false);
    expect(rows.map((r) => r.row.id)).toEqual(["bank:gift:g1", "bank:gift:g2"]);
    expect(rows.every((r) => r.row.acts.length === 0 && r.row.info)).toBe(true);
  });

  it("ticks the deposit's payments and never links the Bank tab to itself", () => {
    const deposit = (candidates: DepositLineIn["candidates"]): DepositLineIn => ({ id: "d1", postedOn: "2026-10-08", amountCents: 35_000, description: "DEPOSIT", exact: true, error: null, candidates });
    const withChecks = depositRows(
      [deposit([{ paymentId: "p1", receipt: "R-1", method: "Check", amountCents: 35_000, receivedOn: "2026-10-05", checkNumber: "1042", family: adeyemi, householdName: null }])],
      USD,
      true,
    );
    expect(withChecks[0].row.acts[0]).toMatchObject({ kind: "deposit", label: "Review deposit of $350.00", exact: true });
    const empty = depositRows([deposit([])], USD, true);
    expect(empty[0].row.acts).toEqual([]);
  });
});

describe("card payouts: the provider's side and the bank's side in one row", () => {
  const providers: ProviderPayoutIn[] = [
    { id: "p1", provider: "stripe", ref: "po_1", grossCents: 51_200, feeCents: 1_515, netCents: 49_685, arrivesOn: "2026-10-07" },
    { id: "p2", provider: "stripe", ref: "po_2", grossCents: 20_000, feeCents: 610, netCents: 19_390, arrivesOn: "2026-10-01" },
    { id: "p3", provider: "square", ref: "sq_3", grossCents: 1_000, feeCents: 30, netCents: 970, arrivesOn: "2026-09-20" },
  ];
  const lines: BankPayoutLineIn[] = [
    { id: "b1", postedOn: "2026-10-08", amountCents: 49_365, description: "STRIPE TRANSFER", payoutId: null },
    { id: "b2", postedOn: "2026-10-01", amountCents: 19_390, description: "STRIPE TRANSFER", payoutId: "p2" },
    { id: "b3", postedOn: "2026-09-01", amountCents: 7_000, description: "SQUARE INC", payoutId: null },
  ];

  it("pairs the linked payout first, then by date, and leaves the rest alone", () => {
    const pairs = pairPayouts(providers, lines);
    const byBank = new Map(pairs.map((p) => [p.bank?.id ?? `provider:${p.provider?.id}`, p]));
    expect(byBank.get("b2")).toMatchObject({ how: "linked", differenceCents: 0 });
    expect(byBank.get("b1")).toMatchObject({ how: "date", differenceCents: -320 });
    expect(byBank.get("b1")?.provider?.id).toBe("p1");
    // 19 days apart: not the same payout.
    expect(byBank.get("b3")).toMatchObject({ how: "none", provider: null });
    expect(byBank.get("provider:p3")).toMatchObject({ how: "none", bank: null });
    expect(pairs).toHaveLength(4);
  });

  it("chooses the closest amount when two payouts arrive near the same bank line", () => {
    const pairs = pairPayouts(
      [
        { id: "x", provider: "stripe", ref: "x", grossCents: 0, feeCents: 0, netCents: 10_000, arrivesOn: "2026-10-05" },
        { id: "y", provider: "stripe", ref: "y", grossCents: 0, feeCents: 0, netCents: 12_000, arrivesOn: "2026-10-05" },
      ],
      [{ id: "l", postedOn: "2026-10-06", amountCents: 11_990, description: "", payoutId: null }],
    );
    expect(pairs.find((p) => p.bank?.id === "l")?.provider?.id).toBe("y");
  });

  it("says the difference, how the two were paired, and when a side is missing", () => {
    const pairs = pairPayouts(providers, lines);
    const view = (bank: string) => payoutRowView(pairs.find((p) => p.bank?.id === bank)!, USD);
    expect(view("b1").difference).toEqual({ text: "$3.20 less at the bank than the payout", tone: "warn" });
    expect(view("b1").how).toBe("Paired by date: the bank line is within 3 days of the payout. Not confirmed.");
    expect(view("b1").provider).toMatchObject({ title: "Stripe payout po_1", gross: "$512.00", fees: "$15.15", net: "$496.85" });
    expect(view("b2")).toMatchObject({ difference: { text: "No difference", tone: "ok" }, attention: false, how: "The bank line names this payout." });
    expect(view("b3")).toMatchObject({ difference: { text: "No payout from the provider found for this bank line" }, attention: true });
    const lonely = payoutRowView(pairs.find((p) => p.provider?.id === "p3" && !p.bank)!, USD);
    expect(lonely.difference.text).toBe("Not seen at the bank");
    const recent = payoutRowView({ provider: { ...providers[0], arrivesOn: "2026-10-11" }, bank: null, how: "none", differenceCents: null }, USD);
    expect(recent).toMatchObject({ difference: { text: "Not at the bank yet", tone: "muted" }, attention: false });
  });

  it("writes the difference in pounds for a community that pays in pounds", () => {
    const row = payoutRowView(
      { provider: providers[0], bank: { ...lines[0], amountCents: 50_005 }, how: "date", differenceCents: 320 },
      GBP,
    );
    expect(row.difference.text).toBe("£3.20 more at the bank than the payout");
  });
});

describe("History", () => {
  const line = { id: "h1", postedOn: "2026-10-02", amountCents: 6_000, description: "ZELLE", status: "matched", family: fam("Lindqvist household", "0305"), receipt: "R-2026-0402", by: "Sam Carter", at: "2026-10-03T15:00:00Z", notes: null, isDeposit: false };

  it("says who matched a line to which family, with the receipt", () => {
    const row = historyRowView(line, "matched", USD, true);
    expect(row.what).toBe("Matched to Lindqvist household 0305, receipt R-2026-0402 by Sam Carter on Oct 3, 2026");
    expect(row.act).toBeNull();
  });

  it("lets a treasurer restore an ignored line and ignore money out; nobody else", () => {
    const ignored = { ...line, status: "ignored", family: null, notes: "Own transfer" };
    expect(historyRowView(ignored, "ignored", USD, true)).toMatchObject({ act: "restore", what: "Ignored by Sam Carter on Oct 3, 2026: Own transfer" });
    expect(historyRowView(ignored, "ignored", USD, false).act).toBeNull();
    const out = { ...line, amountCents: -18_000, family: null, by: null, at: null };
    expect(historyRowView(out, "out", USD, true)).toMatchObject({ act: "ignore", negative: true, amount: "-$180.00" });
  });
});

describe("the page model for each role and community", () => {
  it("gives a treasurer of the club every view, with counts", () => {
    const m = sampleBankModel({ community: "club", role: "treasurer" });
    expect(m.views.map((v) => v.label)).toEqual(["To match", "Deposits", "Zelle", "Card payouts", "History"]);
    // One payout differs from its bank line; one is linked and equal; one arrives today and is not due at the bank yet.
    expect(m.views.find((v) => v.key === "payouts")?.count).toBe(1);
    expect(m.can).toEqual({ confirm: true, ignore: true, import: true, configureZelle: true, pairPayouts: true });
    expect(m.note).toBeNull();
  });

  it("has no Zelle for the allotment society, and amounts in pounds", () => {
    const m = sampleBankModel({ community: "allotment", role: "treasurer" });
    expect(m.views.map((v) => v.key)).toEqual(["match", "deposits", "payouts", "history"]);
    expect(m.rows[0].line?.amount).toBe("£120.00");
    expect(JSON.stringify(m)).not.toContain("Zelle payment");
  });

  it("hides Card payouts without Accounting, with no error", () => {
    const m = sampleBankModel({ role: "treasurer", accounting: false, view: "payouts" });
    expect(m.views.map((v) => v.key)).not.toContain("payouts");
    expect(m.view).toBe("match");
    expect(m.problems).toEqual([]);
    expect(m.body).toEqual({ state: "ok" });
  });

  it("lets a finance volunteer match but not set aside, and someone with giving.view only look", () => {
    const volunteer = sampleBankModel({ role: "volunteer" });
    expect(volunteer.can).toMatchObject({ confirm: true, ignore: false, import: true });
    const viewer = sampleBankModel({ role: "viewer" });
    expect(viewer.can.confirm).toBe(false);
    expect(viewer.note).toBe("You can see the bank lines. Matching them needs giving.record_offline or giving.manage.");
    expect(viewer.rows.every((r) => r.row.acts.length === 0)).toBe(true);
  });

  it("says who has no access instead of drawing an empty list", () => {
    expect(sampleBankModel({ role: "approver" }).body).toEqual({ state: "no_access", area: "Bank reconciliation", access: "bank" });
  });
});
