import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Slice 9, PR B: the Bank tab's bank lines and the year-end totals exported like Pledges and Payments; "export payments 2026" in the
// box opens the list with its Export sheet; the month-end close proves "payouts matched" from app.payouts_close_state (0747).
// Invented rows only.

vi.mock("server-only", () => ({}));
vi.mock("@/components/giving-actions/sheet", () => ({
  GivingSheet: () => null,
  FamilyCard: ({ family }: { family: { name: string } }) => createElement("div", null, family.name),
  NO_UNDO: "",
}));
vi.mock("next/navigation", async (actual) => ({ ...(await actual<typeof import("next/navigation")>()), usePathname: () => "/giving/statements" }));

import { StatementsView } from "@/components/giving-statements/statements-view";
import { closeItems, type CloseProofs } from "@/lib/books/close";
import { payoutProofs } from "@/lib/data/books-close";
import { EMPTY_FOUND, buildGivingLane, readExportCommand, readGivingIntent } from "@/lib/find/giving";
import {
  auditDetail,
  bankLineExportHeader,
  bankLineExportLines,
  filterSentence,
  watermarkLine,
  yearEndExportHeader,
  yearEndExportLines,
  type ExportHousehold,
} from "@/lib/giving-export/csv";
import { bankExportFilter, bankLineKey, yearEndExportFilter } from "@/lib/giving-export/filters";
import { exportHref } from "@/lib/giving-lists/model";
import { sampleStatementsModel } from "@/lib/giving-statements/fixtures";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const households = new Map<string, ExportHousehold>([["h1", { number: "0127", orgId: "CLUB-H-0961", name: "Okafor household" }]]);
const fmt = { currency: "USD", locale: "en-US" };
const lane = (text: string, o: { canExport?: boolean; exportBlocked?: Record<string, string> } = {}) => {
  const intent = readGivingIntent(text, { today: "2026-10-13", fmt, scope: "giving" });
  if (!intent) throw new Error("no intent");
  return buildGivingLane(intent, EMPTY_FOUND, { currency: "USD", locale: "en-US", timeZone: "America/Chicago", canRecord: true, canExport: o.canExport ?? true, exportBlocked: o.exportBlocked });
};

describe("the bank lines export", () => {
  it("writes each line as the statement printed it, with the family it was matched to by number and household name", () => {
    expect(bankLineExportHeader("Club household ID").slice(0, 6)).toEqual(["Posted on", "Account", "Amount", "Currency", "Kind", "Description"]);
    const lines = bankLineExportLines(
      [
        { postedOn: "2026-10-02", account: "Operating ··1560", amountCents: 6_000, channel: "zelle", description: "ZELLE FROM GRACE", payerName: "GRACE", reference: "ZL88", status: "matched", householdId: "h1", receipt: "R-2026-0402", payout: null, deposit: false },
        { postedOn: "2026-10-08", account: "Operating ··1560", amountCents: 49_365, channel: "card_payout", description: "STRIPE TRANSFER", payerName: null, reference: null, status: "payout", householdId: null, receipt: null, payout: "Stripe po_1Q2W3E", deposit: false },
      ],
      households,
      { currency: "EUR" },
    );
    expect(lines[0]).toEqual(["2026-10-02", "Operating ··1560", "60.00", "EUR", "Zelle", "ZELLE FROM GRACE", "GRACE", "ZL88", "Matched", "0127", "CLUB-H-0961", "Okafor household", "R-2026-0402", "", ""]);
    expect(lines[1].slice(8, 14)).toEqual(["Card payout", "", "", "", "", "Stripe po_1Q2W3E"]);
  });

  it("follows the Bank view: Zelle lists reports, so it has no export; the account is in the watermark, never in the audit entry", () => {
    expect(bankLineKey("zelle", "matched")).toBeNull();
    expect(bankLineKey("history", "ignored")).toBe("ignored");
    expect(bankLineKey("payouts", "matched")).toBe("payouts");
    const filter = bankExportFilter("matched", "Operating ··1560");
    expect(filterSentence(filter, "every bank line")).toBe("matched lines, account Operating ··1560");
    expect(auditDetail(filter, 4)).toEqual({ rows: 4, chips: { view: "matched" }, searched: false });
    expect(watermarkLine({ community: "Lakeside Community Club", who: "Grace Okafor", email: null, at: "Oct 13, 2026", list: "bank_lines", filter, rows: 4 })).toContain(
      "Bank lines: matched lines, account Operating ··1560. 4 bank lines.",
    );
  });
});

describe("the year-end totals export", () => {
  it("writes each family's year: adults only, the statement's own total, how it would reach them", () => {
    expect(yearEndExportHeader("Community household ID")).toContain("Given (net of refunds)");
    const lines = yearEndExportLines(
      [{ year: 2025, householdId: "h1", adults: ["Grace Okafor", "Emeka Okafor"], gifts: 12, givenCents: 120_000, refundedCents: 2_500, openingCents: 0, delivery: "By email" }],
      households,
      { currency: "USD" },
    );
    expect(lines[0]).toEqual(["2025", "0127", "CLUB-H-0961", "Okafor household", "Grace Okafor; Emeka Okafor", "12", "1200.00", "25.00", "0.00", "USD", "By email"]);
    expect(filterSentence(yearEndExportFilter(2025, "fix"), "every family that gave")).toBe("given in 2025, the families whose statement needs a fix");
    expect(auditDetail(yearEndExportFilter(2025, "all"), 3)).toEqual({ rows: 3, chips: { year: "2025" }, searched: false });
  });

  it("is offered on the Statements tab with the review's year and Show chip, through the page's slot", () => {
    const model = sampleStatementsModel();
    const out = renderToStaticMarkup(h(StatementsView, { model, exportSlot: h("button", { type: "button" }, "EXPORT-SLOT") }));
    expect(out).toContain("EXPORT-SLOT");
    const empty = sampleStatementsModel({ sample: "off" });
    expect(renderToStaticMarkup(h(StatementsView, { model: empty, exportSlot: h("button", { type: "button" }, "EXPORT-SLOT") }))).not.toContain("EXPORT-SLOT");
  });
});

describe("the export route's address", () => {
  it("keeps the list's filters and drops the page, the ?export=1 that opened the sheet, and any list it was given", () => {
    expect(exportHref("year_end_totals", { year: "2025", show: "fix", page: "3", export: "1", list: "payments" })).toBe("/giving/export?year=2025&show=fix&list=year_end_totals");
  });
});

describe('the box: "export payments 2026"', () => {
  it("reads the list and the year", () => {
    expect(readExportCommand("export payments 2026", "2026-10-13")).toEqual({ kind: "export", list: "payments", year: 2026 });
    expect(readExportCommand("download pledges", "2026-10-13")).toEqual({ kind: "export", list: "pledges", year: null });
    expect(readExportCommand("export bank lines", "2026-10-13")).toEqual({ kind: "export", list: "bank_lines", year: null });
    expect(readExportCommand("export year-end totals 2025", "2026-10-13")).toEqual({ kind: "export", list: "year_end_totals", year: 2025 });
    expect(readExportCommand("export payments 2031", "2026-10-13")).toEqual({ kind: "export", list: "payments", year: null });
    expect(readExportCommand("export the photos", "2026-10-13")).toBeNull();
    expect(readExportCommand("payments 2026", "2026-10-13")).toBeNull();
  });

  it("opens the list for that year with its Export sheet, and nothing is exported until the sheet's own button", () => {
    const l = lane("export payments 2026");
    expect(l.first).toBe(true);
    expect(l.understood).toBe("an export of payments received in 2026");
    expect(l.rows).toHaveLength(1);
    expect(l.rows[0]).toMatchObject({ kind: "go", title: "Export payments received in 2026", href: "/giving/payments?year=2026&export=1" });
    expect(lane("export year-end totals 2025").rows[0]).toMatchObject({ href: "/giving/statements?year=2025&export=1" });
  });

  it("says why instead of a row: no data.export, or the list's add-on switched off", () => {
    expect(lane("export payments 2026", { canExport: false })).toMatchObject({ rows: [], notes: ["Exporting needs the data-export permission (treasurers hold it)."] });
    expect(lane("export bank lines", { exportBlocked: { bank_lines: "Bank reconciliation is switched off for this community, so there are no bank lines to export." } }).notes[0]).toContain(
      "Bank reconciliation is switched off",
    );
  });
});

describe('the month-end close: "payouts matched" from app.payouts_close_state', () => {
  const base: CloseProofs = { exceptions: { ok: true, value: 0 }, refundRequests: { ok: true, value: 0 }, flaggedRefunds: 0, payouts: { ok: false, why: "error" }, bankPayouts: null };
  const f = { monthLabel: "October 2026", currency: "USD", locale: "en-US" };
  const item = (p: CloseProofs, checklist: Record<string, boolean> = {}) => closeItems(checklist, p, f).find((i) => i.key === "payouts_matched")!;
  const state = (o: Record<string, unknown>) => ({
    data: { payouts: 3, paired: 3, unpaired: 0, explained: 1, net_cents: 412_550, bank_on: true, bank_lines: 3, bank_lines_unpaired: 0, bank_cents: 412_350, proven: true, ...o },
    error: null,
  });

  it("is proven when proven is true, and says how many differences were explained", () => {
    expect(item({ ...base, ...payoutProofs(state({})) })).toMatchObject({
      done: true,
      proven: true,
      manual: false,
      sub: "Checked by Weaver: all 3 card payouts are paired with their bank lines (1 difference explained)",
    });
  });

  it("stays a person's check while anything is unpaired, with both sides and what is left", () => {
    const i = item({ ...base, ...payoutProofs(state({ paired: 2, unpaired: 1, bank_lines_unpaired: 1, proven: false })) });
    expect(i).toMatchObject({ done: false, proven: false, manual: true });
    expect(i.sub).toBe(
      "3 card payouts arrived in October 2026, $4,125.50 net; the bank shows 3 card payout lines, $4,123.50: a difference of $2.00. 1 card payout not paired with a bank line; 1 bank card-payout line not paired with a payout: pair them in Giving › Bank › Card payouts (Explain and accept), or mark this done.",
    );
    expect(item({ ...base, ...payoutProofs(state({ paired: 2, unpaired: 1, proven: false })) }, { payouts_matched: true }).sub).toMatch(/^Marked done · /);
  });

  it("with Bank reconciliation off (proven null) stays a person's check, even with every payout marked matched; a month with none is proven", () => {
    const off = payoutProofs(state({ bank_on: false, bank_lines: null, bank_lines_unpaired: null, bank_cents: null, proven: null }));
    expect(off.bankPayouts).toBeNull();
    expect(item({ ...base, ...off })).toMatchObject({ done: false, proven: false, manual: true });
    expect(item({ ...base, ...payoutProofs(state({ payouts: 0, paired: 0, explained: 0, net_cents: 0, bank_on: false, proven: null })) })).toMatchObject({
      done: true,
      proven: true,
      sub: "Checked by Weaver: no card payouts arrived in October 2026",
    });
  });

  it("never reads a failed or odd answer as nothing to check, and says no access when the reader may not ask", () => {
    expect(payoutProofs({ data: null, error: { message: "timeout" } }).payouts).toEqual({ ok: false, why: "error" });
    expect(payoutProofs({ data: [], error: null }).payouts).toEqual({ ok: false, why: "error" });
    expect(payoutProofs(null)).toEqual({ payouts: { ok: false, why: "no_access" }, bankPayouts: null, pairing: null });
    expect(item({ ...base, ...payoutProofs({ data: null, error: { message: "timeout" } }) }).sub).toBe("Could not read the card payouts");
  });
});
